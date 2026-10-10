import { connect, type Socket } from 'node:net';
import { statSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectFakeHost } from '../../../../test/support/cua-fake-host';
import { PEER_AUTH_VERSION, PEER_ROOT_WAIT_MS, type PeerAddon } from './peer';
import { A, harness, takeDown, testPeer, tracked } from './server.fake';

// Who may connect to a session's socket (cua docs/doperpowers/specs/2026-10-09-maws-socket-peer-auth-design.md, M2;
// Acceptance 3): every accepted socket is held unread until its peer is judged, waits a bounded while for the session's
// engine to become known, and is destroyed unread when refused. The peer's identity comes from a double of the addon
// (one fixed peer pid per case, a process table of three), over real sockets; the server-side sockets are seen through
// `node:net`'s createServer, wrapped to keep each accepted socket.

const accepted = vi.hoisted(() => [] as import('node:net').Socket[]);
vi.mock('node:net', async (importOriginal) => {
  const net = await importOriginal<typeof import('node:net')>();
  const createServer = ((...args: Parameters<typeof net.createServer>) => {
    const server = net.createServer(...args);
    server.on('connection', (socket) => void accepted.push(socket));
    return server;
  }) as typeof net.createServer;
  return { ...net, createServer, default: { ...net, createServer } };
});

afterEach(async () => {
  await takeDown();
  accepted.length = 0;
});

const ENGINE = 5000; // the session's engine
const CHILD = 5001; // its cua serve
const STRANGER = 6000; // a Terminal's nc, under launchd
const uid = process.getuid!();

function fakeAddon(): PeerAddon & { peerPid: number } {
  const table = new Map([
    [ENGINE, { ppid: 1, start: 10 }],
    [CHILD, { ppid: ENGINE, start: 20 }],
    [STRANGER, { ppid: 1, start: 30 }],
  ]);
  const addon = {
    peerPid: CHILD,
    version: PEER_AUTH_VERSION,
    peer: () => ({ pid: addon.peerPid, uid }),
    process: (pid: number) => table.get(pid) ?? null,
  };
  return addon;
}

// A raw client that writes a request at once and keeps what it hears, and whether the server closed it.
function rawClient(path: string) {
  const socket: Socket = connect(path);
  const heard: Buffer[] = [];
  let closed = false;
  socket.on('data', (chunk) => void heard.push(chunk));
  const frames = () => {
    const all = Buffer.concat(heard);
    let count = 0;
    for (let at = 0; at + 4 <= all.length; at += 4 + all.readUInt32LE(at)) if (at + 4 + all.readUInt32LE(at) <= all.length) count += 1;
    return count;
  };
  socket.on('error', () => {});
  socket.on('close', () => void (closed = true));
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tabs.query', params: {} }));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  socket.write(Buffer.concat([header, body]));
  return { socket, heard: () => Buffer.concat(heard).length, frames, closed: () => closed };
}

const until = async (done: () => boolean, ms = 2000) => {
  const deadline = Date.now() + ms;
  while (!done()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
const listening = (path: string) => until(() => statSync(path, { throwIfNoEntry: false }) !== undefined);

describe('the socket file', () => {
  it('is 0600 once it listens', async () => {
    const h = harness();
    const path = h.backend.socketPathFor(A)!;
    await listening(path);
    await until(() => (statSync(path).mode & 0o777) === 0o600);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe('a peer judged at accept, before anything is read', () => {
  it('a peer outside the engine\'s tree is destroyed at once, unread, with one log line and the count', async () => {
    const addon = fakeAddon();
    const h = harness({ peer: { addon } });
    h.backend.engineProcess(A, ENGINE);
    addon.peerPid = STRANGER;
    const client = rawClient(h.backend.socketPathFor(A)!);
    await until(client.closed);
    expect(client.heard()).toBe(0); // no hello
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.bytesRead).toBe(0);
    expect(h.logs).toEqual([`cua socket of A: refused peer pid ${STRANGER} (not_descendant)`]);
    expect(h.backend.inspect()).toMatchObject({ peerModule: 'loaded', sessions: { A: { connections: 0, refused: 1 } } });
  });

  it('a peer under the engine is accepted and hears the hello; its early request is answered once it is let in', async () => {
    const addon = fakeAddon();
    const h = harness({ peer: { addon } });
    h.backend.engineProcess(A, ENGINE);
    const host = await connectFakeHost(h.backend.socketPathFor(A)!);
    tracked.hosts.push(host);
    expect(host.hello).toMatchObject({ extensionInstanceId: 'maws:A' });
    const early = rawClient(h.backend.socketPathFor(A)!);
    await until(() => early.frames() === 2); // the hello, then the answer to what it wrote before it was let in
    await until(() => h.backend.inspect().sessions.A!.connections === 2);
    expect(h.backend.inspect().sessions.A).toMatchObject({ connections: 2, refused: 0 });
    early.socket.destroy();
  });

  it('a root user\'s peer is refused uid_mismatch', async () => {
    const addon = fakeAddon();
    addon.peer = () => ({ pid: CHILD, uid: 0 });
    const h = harness({ peer: { addon } });
    h.backend.engineProcess(A, ENGINE);
    const client = rawClient(h.backend.socketPathFor(A)!);
    await until(client.closed);
    expect(h.logs).toEqual([`cua socket of A: refused peer pid ${CHILD} (uid_mismatch)`]);
  });

  it('without the addon every peer is refused at once, and the line names the build script', async () => {
    const h = harness({ peer: { addon: null } });
    h.backend.engineProcess(A, ENGINE);
    const client = rawClient(h.backend.socketPathFor(A)!);
    await until(client.closed);
    expect(client.heard()).toBe(0);
    expect(accepted[0]!.bytesRead).toBe(0);
    expect(h.logs).toEqual([
      'the peer identity addon did not load: every cua connection will be refused (run scripts/build-peer-auth.sh)', // at start
      'cua socket of A: refused peer (module_unavailable; run scripts/build-peer-auth.sh)',
    ]);
    expect(h.backend.inspect()).toMatchObject({ peerModule: 'unavailable', sessions: { A: { connections: 0, refused: 1 } } });
  });

  it('with no peer option at all the backend fails closed', async () => {
    const h = harness({ peer: null });
    expect(h.backend.inspect().peerModule).toBe('unavailable');
  });

  it('the committed addon loaded reports loaded, and the test process as trusted root lets its own host in', async () => {
    const h = harness({ peer: testPeer() });
    expect(h.backend.inspect().peerModule).toBe('loaded');
    const host = await h.host(A);
    expect(host.hello).toMatchObject({ extensionInstanceId: 'maws:A' });
    expect(h.backend.inspect().sessions.A).toMatchObject({ connections: 1, refused: 0 });
  });
});

describe('the wait for the session\'s engine', () => {
  it('a root arriving within the wait accepts, and the hello follows', async () => {
    const addon = fakeAddon();
    const h = harness({ peer: { addon } });
    const path = h.backend.socketPathFor(A)!;
    const hosting = connectFakeHost(path);
    await until(() => accepted.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(accepted[0]!.bytesRead).toBe(0); // held unread while it waits
    h.backend.engineProcess(A, ENGINE);
    const host = await hosting;
    tracked.hosts.push(host);
    expect(host.hello).toMatchObject({ extensionInstanceId: 'maws:A' });
    expect(h.backend.inspect().sessions.A).toMatchObject({ connections: 1, refused: 0 });
  });

  it('a peer whose engine never becomes known is refused no_root once the wait is out, its bytes unread; a root set later changes nothing', async () => {
    const addon = fakeAddon();
    const h = harness({ peer: { addon } });
    const client = rawClient(h.backend.socketPathFor(A)!);
    const started = Date.now();
    await until(client.closed, PEER_ROOT_WAIT_MS + 1000);
    expect(Date.now() - started).toBeGreaterThanOrEqual(PEER_ROOT_WAIT_MS - 50);
    expect(client.heard()).toBe(0);
    expect(accepted[0]!.bytesRead).toBe(0);
    expect(h.logs).toEqual([`cua socket of A: refused peer pid ${CHILD} (no_root)`]);
    h.backend.engineProcess(A, ENGINE);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.backend.inspect().sessions.A).toMatchObject({ connections: 0, refused: 1 });
  }, 10_000);

  it('an engine that exited clears the root: the next peer waits, then is refused no_root', async () => {
    const addon = fakeAddon();
    const h = harness({ peer: { addon } });
    h.backend.engineProcess(A, ENGINE);
    h.backend.engineProcess(A, null);
    const client = rawClient(h.backend.socketPathFor(A)!);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(client.closed()).toBe(false); // waiting
    await until(client.closed, PEER_ROOT_WAIT_MS + 1000);
    expect(h.logs).toEqual([`cua socket of A: refused peer pid ${CHILD} (no_root)`]);
  }, 10_000);

  it('a root whose process is gone matches nothing', async () => {
    const addon = fakeAddon();
    const h = harness({ peer: { addon } });
    h.backend.engineProcess(A, 7777); // no such process
    const client = rawClient(h.backend.socketPathFor(A)!);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(client.closed()).toBe(false);
  });

  it('closeSession and dispose destroy the sockets still waiting', async () => {
    const addon = fakeAddon();
    const h = harness({ peer: { addon } });
    const one = rawClient(h.backend.socketPathFor(A)!);
    const two = rawClient(h.backend.socketPathFor('B' as never)!);
    await until(() => accepted.length === 2);
    h.backend.closeSession(A);
    await until(one.closed);
    expect(two.closed()).toBe(false);
    h.backend.dispose();
    await until(two.closed);
    expect([one.heard(), two.heard()]).toEqual([0, 0]);
    expect(h.logs).toEqual([]); // nothing judged, nothing refused
  });

  it('closeSession clears the session\'s root: its next socket waits again', async () => {
    const addon = fakeAddon();
    const h = harness({ peer: { addon } });
    h.backend.engineProcess(A, ENGINE);
    h.backend.closeSession(A);
    const client = rawClient(h.backend.socketPathFor(A)!);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(client.closed()).toBe(false);
    h.backend.engineProcess(A, ENGINE);
    await until(() => client.heard() > 0);
  });
});
