import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { PEER_AUTH_VERSION, PEER_ROOT_WAIT_MS, type PeerAddon } from '../main/browser/cua/peer';
import { createCuaSockets, type CuaSocketsOptions } from './cua-socket';

// The daemon's per-session cua sockets (P5 O5 M5; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §H;
// acceptance 3): listening only while a tab engine is attached, each accepted peer checked against the session's
// engine before anything is read, then relayed byte for byte to the attached app's own socket for the session. Real
// sockets in a scratch directory; the peer's identity from a double of the addon (one peer pid per case).

const A = 'A' as AppSessionId;
const B = 'B' as AppSessionId;
const ENGINE = 5000;
const CHILD = 5001; // the engine's cua serve
const STRANGER = 6000; // a same-user process under launchd
const OTHER_ENGINE = 7000; // session B's engine
const uid = process.getuid!();

function fakeAddon(): PeerAddon & { peerPid: number } {
  const table = new Map([
    [ENGINE, { ppid: 1, start: 10 }],
    [CHILD, { ppid: ENGINE, start: 20 }],
    [STRANGER, { ppid: 1, start: 30 }],
    [OTHER_ENGINE, { ppid: 1, start: 40 }],
  ]);
  const addon = { peerPid: CHILD, version: PEER_AUTH_VERSION, peer: () => ({ pid: addon.peerPid, uid }), process: (pid: number) => table.get(pid) ?? null };
  return addon;
}

const roots: string[] = [];
const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// A scratch profile's cua directory and an app's directory beside it (the relay's target).
function stand(options: Partial<CuaSocketsOptions> = {}) {
  const root = mkdtempSync('/tmp/mcuad-');
  roots.push(root);
  const appDir = join(root, 'app');
  mkdirSync(appDir, { mode: 0o700 });
  const logs: string[] = [];
  const changes: number[] = [];
  const sockets = createCuaSockets({ dir: join(root, 'mawsd', 'cua'), addon: null, uidBoundary: false, log: (line) => void logs.push(line), onChange: () => void changes.push(1), ...options });
  closers.push(() => sockets.close());
  return { root, appDir, sockets, logs, changes };
}

// The app's own socket for a session: every byte it hears, what it writes back, whether it closed.
function appSocket(appDir: string, appSessionId: string) {
  const heard: Buffer[] = [];
  const peers: Socket[] = [];
  const server: Server = createServer((socket) => {
    peers.push(socket);
    socket.on('data', (chunk) => void heard.push(chunk));
    socket.on('error', () => {});
  });
  const path = join(appDir, `${appSessionId}.sock`);
  const listening = new Promise<void>((resolve) => server.listen(path, resolve));
  closers.push(() => server.close());
  return { server, path, listening, heard: () => Buffer.concat(heard), peers };
}

// The engine side: a raw client that keeps what it hears and whether it closed.
function engineClient(path: string, write?: Buffer) {
  const socket: Socket = connect(path);
  const heard: Buffer[] = [];
  let closed = false;
  socket.on('data', (chunk) => void heard.push(chunk));
  socket.on('error', () => {});
  socket.on('close', () => void (closed = true));
  if (write) socket.write(write);
  closers.push(() => socket.destroy());
  return { socket, heard: () => Buffer.concat(heard), closed: () => closed };
}

const until = async (done: () => boolean, ms = 2000) => {
  const deadline = Date.now() + ms;
  while (!done()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
const exists = (path: string) => statSync(path, { throwIfNoEntry: false }) !== undefined;

describe('the directory', () => {
  it('is made 0700 at start and swept of a dead daemon\'s sockets', () => {
    const root = mkdtempSync('/tmp/mcuad-');
    roots.push(root);
    const dir = join(root, 'mawsd', 'cua');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, 'old.sock'), '');
    const sockets = createCuaSockets({ dir, addon: null, uidBoundary: true, log: () => {} });
    closers.push(() => sockets.close());
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(existsSync(join(dir, 'old.sock'))).toBe(false);
  });

  it('refuses a directory of a wider mode rather than adopting it', () => {
    const root = mkdtempSync('/tmp/mcuad-');
    roots.push(root);
    const dir = join(root, 'cua');
    mkdirSync(dir, { mode: 0o755 });
    expect(() => createCuaSockets({ dir, addon: null, uidBoundary: true, log: () => {} })).toThrow(/mode|0755|group|other/i);
  });
});

describe('listening follows the attached tab engine', () => {
  it('a session\'s socket listens only while a tab engine is attached, 0600, and its file goes when none is', async () => {
    const { sockets, appDir, changes } = stand({ uidBoundary: true });
    const path = sockets.ensure(A)!;
    expect(path.endsWith('/mawsd/cua/A.sock')).toBe(true);
    expect(sockets.ensure(A)).toBe(path); // stable: the next launch is told the same path
    expect(exists(path)).toBe(false);
    expect(sockets.inspect()).toEqual({ A: { listening: false, relayed: 0, refused: 0 } });

    sockets.target(appDir);
    await until(() => exists(path));
    await until(() => (statSync(path).mode & 0o777) === 0o600);
    expect(sockets.inspect().A!.listening).toBe(true);
    expect(changes).toHaveLength(1);

    sockets.target(appDir); // the same app told again: nothing changes
    expect(changes).toHaveLength(1);
    sockets.target(null);
    expect(exists(path)).toBe(false);
    expect(sockets.inspect().A!.listening).toBe(false);
    expect(changes).toHaveLength(2);
    const refused = engineClient(path);
    await until(refused.closed); // nothing listens: cua's host reads no browser, and retries
  });

  it('a session ensured while a tab engine is attached listens at once; a removed session\'s socket goes', async () => {
    const { sockets, appDir } = stand({ uidBoundary: true });
    sockets.target(appDir);
    const path = sockets.ensure(B)!;
    await until(() => exists(path));
    sockets.remove(B);
    expect(exists(path)).toBe(false);
    expect(sockets.inspect()).toEqual({});
  });

  it('a path past sun_path is none, logged once', () => {
    const root = mkdtempSync('/tmp/mcuad-');
    roots.push(root);
    const logs: string[] = [];
    const sockets = createCuaSockets({ dir: join(root, 'd'.repeat(90)), addon: null, uidBoundary: true, log: (line) => void logs.push(line) });
    closers.push(() => sockets.close());
    expect(sockets.ensure(A)).toBeNull();
    expect(sockets.ensure(A)).toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/longer than a Unix socket allows/);
  });
});

describe('the peer check, before anything is read', () => {
  it('a peer that does not descend from the session\'s engine is destroyed unread, counted and logged; the app hears nothing', async () => {
    const addon = fakeAddon();
    const { sockets, appDir, logs } = stand({ addon });
    const app = appSocket(appDir, A);
    await app.listening;
    sockets.target(appDir);
    sockets.engineProcess(A, ENGINE);
    addon.peerPid = STRANGER;
    const client = engineClient(sockets.ensure(A)!, Buffer.from('hello?'));
    await until(client.closed);
    expect(client.heard().length).toBe(0);
    expect(app.peers).toHaveLength(0);
    expect(sockets.inspect().A).toEqual({ listening: true, relayed: 0, refused: 1 });
    expect(logs).toContain(`cua socket of A: refused peer pid ${STRANGER} (not_descendant)`);
  });

  it('another session\'s engine is refused at this session\'s socket', async () => {
    const addon = fakeAddon();
    const { sockets, appDir } = stand({ addon });
    sockets.target(appDir);
    sockets.engineProcess(A, ENGINE);
    sockets.engineProcess(B, OTHER_ENGINE);
    addon.peerPid = OTHER_ENGINE;
    const client = engineClient(sockets.ensure(A)!);
    await until(client.closed);
    expect(sockets.inspect().A!.refused).toBe(1);
  });

  it('a peer accepted before its engine is known waits for it, then is relayed', async () => {
    const addon = fakeAddon();
    const { sockets, appDir } = stand({ addon });
    const app = appSocket(appDir, A);
    await app.listening;
    sockets.target(appDir);
    const client = engineClient(sockets.ensure(A)!, Buffer.from('early'));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(app.peers).toHaveLength(0);
    sockets.engineProcess(A, ENGINE);
    await until(() => app.heard().toString() === 'early');
    expect(client.closed()).toBe(false);
  });

  it('a peer whose engine never becomes known is refused no_root once the wait is out', async () => {
    const addon = fakeAddon();
    const { sockets, appDir, logs } = stand({ addon });
    sockets.target(appDir);
    const client = engineClient(sockets.ensure(A)!);
    await until(client.closed, PEER_ROOT_WAIT_MS + 1000);
    expect(logs).toContain(`cua socket of A: refused peer pid ${CHILD} (no_root)`);
  }, 10_000);

  it('without the addon where the uid is the boundary (Linux), a peer is let in and one line per socket says so', async () => {
    const { sockets, appDir, logs } = stand({ uidBoundary: true });
    const app = appSocket(appDir, A);
    await app.listening;
    sockets.target(appDir);
    const path = sockets.ensure(A)!;
    engineClient(path, Buffer.from('one'));
    await until(() => app.peers.length === 1);
    engineClient(path, Buffer.from('two'));
    await until(() => app.peers.length === 2);
    expect(logs.filter((line) => line.includes('module_unavailable'))).toEqual(['cua socket of A: no peer identity check here (module_unavailable): the uid is the boundary']);
  });

  it('without the addon where it is expected (macOS), every peer is refused, one line per socket', async () => {
    const { sockets, appDir, logs } = stand({ uidBoundary: false });
    sockets.target(appDir);
    const path = sockets.ensure(A)!;
    const one = engineClient(path);
    const two = engineClient(path);
    await until(() => one.closed() && two.closed());
    expect(sockets.inspect().A!.refused).toBe(2);
    expect(logs.filter((line) => line.includes('module_unavailable'))).toEqual(['cua socket of A: refused peers (module_unavailable; run scripts/build-peer-auth.sh)']);
  });
});

describe('the relay', () => {
  it('carries frames byte-exact both ways, and the pair ends together from either side', async () => {
    const addon = fakeAddon();
    const { sockets, appDir } = stand({ addon });
    const app = appSocket(appDir, A);
    await app.listening;
    sockets.target(appDir);
    sockets.engineProcess(A, ENGINE);
    const toApp = Buffer.from(Array.from({ length: 300_000 }, (_, i) => i % 251));
    const client = engineClient(sockets.ensure(A)!, toApp);
    await until(() => app.heard().length === toApp.length, 5000);
    expect(app.heard().equals(toApp)).toBe(true);
    const toEngine = Buffer.from(Array.from({ length: 200_000 }, (_, i) => (i * 7) % 256));
    app.peers[0]!.write(toEngine);
    await until(() => client.heard().length === toEngine.length, 5000);
    expect(client.heard().equals(toEngine)).toBe(true);
    expect(sockets.inspect().A).toEqual({ listening: true, relayed: 1, refused: 0 });

    app.peers[0]!.destroy(); // the app ended it: the engine side ends too
    await until(client.closed);

    const second = engineClient(sockets.ensure(A)!, Buffer.from('x'));
    await until(() => app.peers.length === 2);
    let appClosed = false;
    app.peers[1]!.on('close', () => void (appClosed = true));
    second.socket.destroy(); // the engine side ended it: the app side ends too
    await until(() => appClosed);
  });

  it('waits a bounded while for the app\'s socket to listen, then relays', async () => {
    const addon = fakeAddon();
    const { sockets, appDir } = stand({ addon, relayConnectWaitMs: 2000 });
    sockets.target(appDir);
    sockets.engineProcess(A, ENGINE);
    engineClient(sockets.ensure(A)!, Buffer.from('held'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const app = appSocket(appDir, A); // the app's socket comes up once it hears the session's status
    await app.listening;
    await until(() => app.heard().toString() === 'held');
  });

  it('gives the engine side up when the app\'s socket never listens', async () => {
    const addon = fakeAddon();
    const { sockets, appDir, logs } = stand({ addon, relayConnectWaitMs: 300 });
    sockets.target(appDir);
    sockets.engineProcess(A, ENGINE);
    const client = engineClient(sockets.ensure(A)!);
    await until(client.closed);
    expect(logs.some((line) => line.startsWith('cua socket of A: the attached app\'s socket did not answer'))).toBe(true);
  });

  it('the tab engine\'s departure ends every relayed connection, and stops the listener', async () => {
    const addon = fakeAddon();
    const { sockets, appDir } = stand({ addon });
    const app = appSocket(appDir, A);
    await app.listening;
    sockets.target(appDir);
    sockets.engineProcess(A, ENGINE);
    const client = engineClient(sockets.ensure(A)!, Buffer.from('x'));
    await until(() => app.peers.length === 1);
    sockets.target(null);
    await until(client.closed);
  });

  it('a new tab engine ends the connections relayed to the old one and relays the next to itself', async () => {
    const addon = fakeAddon();
    const { root, sockets, appDir } = stand({ addon });
    const oldApp = appSocket(appDir, A);
    await oldApp.listening;
    sockets.target(appDir);
    sockets.engineProcess(A, ENGINE);
    const client = engineClient(sockets.ensure(A)!, Buffer.from('old'));
    await until(() => oldApp.peers.length === 1);
    const nextDir = join(root, 'next');
    mkdirSync(nextDir, { mode: 0o700 });
    const nextApp = appSocket(nextDir, A);
    await nextApp.listening;
    sockets.target(nextDir);
    await until(client.closed);
    engineClient(sockets.ensure(A)!, Buffer.from('new'));
    await until(() => nextApp.heard().toString() === 'new');
  });

  it('remove and close end the relayed connections and the sockets waiting', async () => {
    const addon = fakeAddon();
    const { sockets, appDir } = stand({ addon });
    const app = appSocket(appDir, A);
    await app.listening;
    sockets.target(appDir);
    sockets.engineProcess(A, ENGINE);
    const relayed = engineClient(sockets.ensure(A)!, Buffer.from('x'));
    const waiting = engineClient(sockets.ensure(B)!); // B's engine is not known: it waits
    await until(() => app.peers.length === 1);
    sockets.remove(A);
    await until(relayed.closed);
    expect(waiting.closed()).toBe(false);
    sockets.close();
    await until(waiting.closed);
  });
});
