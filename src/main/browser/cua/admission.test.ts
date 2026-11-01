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
// `node:net`'s createServer, wrapped to keep each accepted socket (and, for a case that asks, to see it before the
// server does).

const accepted = vi.hoisted(() => [] as import('node:net').Socket[]);
const onAccepted = vi.hoisted(() => ({ hook: null as ((socket: import('node:net').Socket) => void) | null }));
vi.mock('node:net', async (importOriginal) => {
  const net = await importOriginal<typeof import('node:net')>();
  const createServer = ((...args: Parameters<typeof net.createServer>) => {
    const server = net.createServer(...args);
    server.prependListener('connection', (socket) => {
      accepted.push(socket);
      onAccepted.hook?.(socket);
    });
    return server;
  }) as typeof net.createServer;
  return { ...net, createServer, default: { ...net, createServer } };
});

afterEach(async () => {
  await takeDown();
  accepted.length = 0;
  onAccepted.hook = null;
});

const ENGINE = 5000; // the session's engine
const CHILD = 5001; // its cua serve
const STRANGER = 6000; // a Terminal's nc, under launchd
const DAEMON = 4000; // the attached mawsd (P5 O5 M5), the engine's ancestor through its engine host
const ENGINE_HOST = 4500;
const NEXT_DAEMON = 4001; // a mawsd that replaced it
const MACHINE_FD = 901; // the app's machine.sock connection: its peer is the daemon actually attached
const uid = process.getuid!();

function fakeAddon(): PeerAddon & { peerPid: number; table: Map<number, { ppid: number; start: number }>; fds: Map<number, { pid: number; uid: number } | 'closed'> } {
  const table = new Map([
    [ENGINE, { ppid: 1, start: 10 }],
    [CHILD, { ppid: ENGINE, start: 20 }],
    [STRANGER, { ppid: 1, start: 30 }],
    [DAEMON, { ppid: 1, start: 5 }],
    [ENGINE_HOST, { ppid: DAEMON, start: 6 }],
    [NEXT_DAEMON, { ppid: 1, start: 8 }],
  ]);
  const addon = {
    table,
    fds: new Map<number, { pid: number; uid: number } | 'closed'>(), // a descriptor's own peer; any other's is `peerPid`
    peerPid: CHILD,
    version: PEER_AUTH_VERSION,
    peer: (fd: number) => {
      const own = addon.fds.get(fd);
      if (own === 'closed') throw new Error('EBADF');
      return own ?? { pid: addon.peerPid, uid };
    },
    process: (pid: number) => table.get(pid) ?? null,
  };
  return addon;
}

// The app's machine link ready, connected to `pid`: the backend reads the connected daemon from it
function attach(backend: { relay(fd: number | null): void }, addon: ReturnType<typeof fakeAddon>, pid: number, peerUid = uid) {
  addon.fds.set(MACHINE_FD, { pid, uid: peerUid });
  backend.relay(MACHINE_FD);
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
    const h = harness({ peer: null });
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

  // The e2e reads the server through Playwright's evaluate, which Node's inspector runs at the next interrupt, between
  // any two calls of main's synchronous code; so the moment a write reaches the host is a moment the server can be read.
  it('the hello goes out only once the connection is counted: a reading taken as the host can first hear it finds the host', async () => {
    const addon = fakeAddon();
    const h = harness({ peer: { addon } });
    h.backend.engineProcess(A, ENGINE);
    const atWrite: number[] = [];
    onAccepted.hook = (socket) => {
      const write = socket.write.bind(socket) as Socket['write'];
      socket.write = ((...args: Parameters<Socket['write']>) => {
        atWrite.push(h.backend.inspect().sessions.A!.connections);
        return write(...args);
      }) as Socket['write'];
    };
    const host = await connectFakeHost(h.backend.socketPathFor(A)!);
    tracked.hosts.push(host);
    expect(host.hello).toMatchObject({ extensionInstanceId: 'maws:A' });
    expect(atWrite[0]).toBe(1); // the hello's write
  });

  it('a refused peer is counted before its socket closes: a reading taken as the peer can first see the close finds the refusal', async () => {
    const addon = fakeAddon();
    const h = harness({ peer: { addon } });
    h.backend.engineProcess(A, ENGINE);
    addon.peerPid = STRANGER;
    const atDestroy: number[] = [];
    onAccepted.hook = (socket) => {
      const destroy = socket.destroy.bind(socket);
      socket.destroy = ((error?: Error) => {
        atDestroy.push(h.backend.inspect().sessions.A!.refused);
        return destroy(error);
      }) as Socket['destroy'];
    };
    const client = rawClient(h.backend.socketPathFor(A)!);
    await until(client.closed);
    expect(atDestroy[0]).toBe(1);
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

  // macOS: the committed peer identity addon is a darwin-arm64 prebuild, loaded only on Apple silicon macOS.
  it.skipIf(process.platform !== 'darwin')('the committed addon loaded reports loaded, and the test process as trusted root lets its own host in', async () => {
    const h = harness({ peer: testPeer() });
    expect(h.backend.inspect().peerModule).toBe('loaded');
    const host = await h.host(A);
    expect(host.hello).toMatchObject({ extensionInstanceId: 'maws:A' });
    expect(h.backend.inspect().sessions.A).toMatchObject({ connections: 1, refused: 0 });
  });
});

describe('a connection\'s close', () => {
  it('is one line naming the session, how long the connection lasted and the cause: the host\'s end, the session removed', async () => {
    const addon = fakeAddon();
    const h = harness({ peer: { addon } });
    h.backend.engineProcess(A, ENGINE);
    const one = await connectFakeHost(h.backend.socketPathFor(A)!);
    const two = await connectFakeHost(h.backend.socketPathFor(A)!);
    tracked.hosts.push(one, two);
    await one.close();
    await until(() => h.logs.length === 1);
    h.backend.closeSession(A);
    await two.closed;
    await until(() => h.logs.length === 2);
    expect(h.logs.map((line) => line.replace(/after \d+ ms/, 'after N ms'))).toEqual([
      "a cua host's connection on A's socket closed after N ms: the host ended it",
      "a cua host's connection on A's socket closed after N ms: its session was removed",
    ]);
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

// P5 O5 M5 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §H): on the daemon shape the engine's peer is
// checked by `mawsd`, which relays the connection from its own process; the app admits it by the daemon's exact instance
// (the peer of the app's live machine.sock connection, its start read then), at once, without waiting for the session's
// engine; a change of that identity ends what the old one relayed.
describe('the daemon\'s relay', () => {
  it('is admitted by its exact instance at once, with no engine known for the session', async () => {
    const addon = fakeAddon();
    const h = harness({ peer: { addon } });
    attach(h.backend, addon, DAEMON);
    addon.peerPid = DAEMON;
    const started = Date.now();
    const host = await connectFakeHost(h.backend.socketPathFor(A)!);
    tracked.hosts.push(host);
    expect(host.hello).toMatchObject({ extensionInstanceId: 'maws:A' });
    expect(Date.now() - started).toBeLessThan(PEER_ROOT_WAIT_MS);
    expect(h.backend.inspect().sessions.A).toMatchObject({ connections: 1, refused: 0 });
  });

  it('refuses the daemon\'s pid once another process holds it, a descendant of the daemon that is not the daemon, and the daemon after it detached', async () => {
    const addon = fakeAddon();
    const h = harness({ peer: { addon } });
    h.backend.engineProcess(A, ENGINE);
    attach(h.backend, addon, DAEMON);
    addon.table.set(DAEMON, { ppid: 1, start: 99 }); // the daemon exited and its pid was taken
    addon.peerPid = DAEMON;
    const reused = rawClient(h.backend.socketPathFor(A)!);
    await until(reused.closed);
    addon.table.set(DAEMON, { ppid: 1, start: 5 });
    addon.peerPid = ENGINE_HOST;
    const hostOfEngines = rawClient(h.backend.socketPathFor(A)!);
    await until(hostOfEngines.closed);
    h.backend.relay(null);
    addon.peerPid = DAEMON;
    const detached = rawClient(h.backend.socketPathFor(A)!);
    await until(detached.closed);
    expect([reused.heard(), hostOfEngines.heard(), detached.heard()]).toEqual([0, 0, 0]);
    expect(h.logs).toEqual([
      `cua socket of A: refused peer pid ${DAEMON} (not_descendant)`,
      `cua socket of A: refused peer pid ${ENGINE_HOST} (not_descendant)`,
      `cua socket of A: refused peer pid ${DAEMON} (not_descendant)`,
    ]);
  });

  it('is read again at each attachment: a daemon restarted under the same pid with another start is refused until relay() reads it', async () => {
    const addon = fakeAddon();
    const h = harness({ peer: { addon } });
    h.backend.engineProcess(A, ENGINE);
    attach(h.backend, addon, DAEMON);
    addon.table.set(DAEMON, { ppid: 1, start: 7 });
    addon.peerPid = DAEMON;
    const before = rawClient(h.backend.socketPathFor(A)!);
    await until(before.closed);
    attach(h.backend, addon, DAEMON); // the app's machine link reconnected: the instance read again
    const after = await connectFakeHost(h.backend.socketPathFor(A)!);
    tracked.hosts.push(after);
    expect(after.hello).toMatchObject({ extensionInstanceId: 'maws:A' });
  });

  // the welcome's pid may name a process that took a dead daemon's pid before the app read it; the connected socket's
  // peer is the daemon that is there
  it('trusts the daemon connected on the machine link, never a pid that another process took', async () => {
    const addon = fakeAddon();
    const h = harness({ peer: { addon } });
    h.backend.engineProcess(A, ENGINE);
    addon.table.set(DAEMON, { ppid: 1, start: 99 }); // the old daemon's pid, a stranger's now
    attach(h.backend, addon, NEXT_DAEMON); // what the machine link is connected to
    addon.peerPid = DAEMON;
    const taken = rawClient(h.backend.socketPathFor(A)!);
    await until(taken.closed);
    addon.peerPid = NEXT_DAEMON;
    const daemon = await connectFakeHost(h.backend.socketPathFor(A)!);
    tracked.hosts.push(daemon);
    expect(daemon.hello).toMatchObject({ extensionInstanceId: 'maws:A' });
  });

  it('trusts no machine link peer of another user, nor one whose descriptor cannot be read', async () => {
    const addon = fakeAddon();
    const h = harness({ peer: { addon } });
    h.backend.engineProcess(A, ENGINE);
    attach(h.backend, addon, DAEMON, uid + 1);
    addon.peerPid = DAEMON;
    const other = rawClient(h.backend.socketPathFor(A)!);
    await until(other.closed);
    addon.fds.set(MACHINE_FD, 'closed'); // the connection ended before its peer was read
    h.backend.relay(MACHINE_FD);
    const unread = rawClient(h.backend.socketPathFor(A)!);
    await until(unread.closed);
    expect([other.heard(), unread.heard()]).toEqual([0, 0]);
  });

  // what a daemon relayed it relayed as that daemon: when the app's machine link loses it or reaches another, its
  // connections end (their leases with them); a connection from the session's own engine stays
  it.each([
    ['the machine link down', (backend: { relay(fd: number | null): void }) => backend.relay(null)],
    ['another daemon attached', (backend: { relay(fd: number | null): void }, addon: ReturnType<typeof fakeAddon>) => attach(backend, addon, NEXT_DAEMON)],
  ])('ends the connections the daemon relayed at %s, and keeps the engine\'s own', async (_, change) => {
    const addon = fakeAddon();
    const h = harness({ peer: { addon } });
    h.backend.engineProcess(A, ENGINE);
    attach(h.backend, addon, DAEMON);
    addon.peerPid = DAEMON;
    const relayed = await connectFakeHost(h.backend.socketPathFor(A)!);
    tracked.hosts.push(relayed);
    expect(await relayed.request('tabs.query', {})).toEqual([]);
    addon.peerPid = CHILD;
    const own = await connectFakeHost(h.backend.socketPathFor(A)!);
    tracked.hosts.push(own);
    expect(h.backend.inspect().sessions.A).toMatchObject({ connections: 2 });
    change(h.backend, addon);
    await relayed.closed;
    expect(relayed.socketState()).toMatchObject({ open: false, endedByMaws: true });
    expect(await own.request('tabs.query', {})).toEqual([]);
    expect(h.backend.inspect().sessions.A).toMatchObject({ connections: 1 });
  });

  it('keeps what the daemon relayed when the same daemon is read again', async () => {
    const addon = fakeAddon();
    const h = harness({ peer: { addon } });
    attach(h.backend, addon, DAEMON);
    addon.peerPid = DAEMON;
    const relayed = await connectFakeHost(h.backend.socketPathFor(A)!);
    tracked.hosts.push(relayed);
    attach(h.backend, addon, DAEMON); // a machine state change that reached the same daemon
    expect(await relayed.request('tabs.query', {})).toEqual([]);
  });
});
