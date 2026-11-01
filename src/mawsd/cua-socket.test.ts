import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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
function stand({ addon = null, ...options }: Partial<CuaSocketsOptions> & { addon?: PeerAddon | null } = {}) {
  const root = mkdtempSync('/tmp/mcuad-');
  roots.push(root);
  const appDir = join(root, 'app');
  mkdirSync(appDir, { mode: 0o700 });
  const logs: string[] = [];
  const changes: number[] = [];
  const sockets = createCuaSockets({ dir: join(root, 'mawsd', 'cua'), loadAddon: () => addon, uidBoundary: false, log: (line) => void logs.push(line), onChange: () => void changes.push(1), ...options });
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
  it('is made 0700 at start', () => {
    const root = mkdtempSync('/tmp/mcuad-');
    roots.push(root);
    const dir = join(root, 'mawsd', 'cua');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, 'old.sock'), '');
    const sockets = createCuaSockets({ dir, loadAddon: () => null, uidBoundary: true, log: () => {} });
    closers.push(() => sockets.close());
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(existsSync(join(dir, 'old.sock'))).toBe(true); // not a socket: refused in place, never unlinked
  });

  it('sweeps a dead daemon\'s socket, and leaves a symlink or a non-socket in place with a line', async () => {
    const root = mkdtempSync('/tmp/mcuad-');
    roots.push(root);
    const dir = join(root, 'mawsd', 'cua');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(join(root, 'mawsd'), 0o700);
    // a socket file nothing listens on, as a crashed daemon leaves it: a second name of a listener's, which outlives it
    const dead = createServer();
    await new Promise<void>((resolve) => dead.listen(join(root, 'live.sock'), resolve));
    linkSync(join(root, 'live.sock'), join(dir, 'dead.sock'));
    await new Promise<void>((resolve) => dead.close(() => resolve()));
    expect(lstatSync(join(dir, 'dead.sock')).isSocket()).toBe(true);
    writeFileSync(join(root, 'elsewhere'), '');
    symlinkSync(join(root, 'elsewhere'), join(dir, 'link.sock'));
    writeFileSync(join(dir, 'plain.sock'), '');
    const logs: string[] = [];
    const sockets = createCuaSockets({ dir, loadAddon: () => null, uidBoundary: true, log: (line) => void logs.push(line) });
    closers.push(() => sockets.close());
    expect(existsSync(join(dir, 'dead.sock'))).toBe(false);
    expect(lstatSync(join(dir, 'link.sock')).isSymbolicLink()).toBe(true);
    expect(existsSync(join(dir, 'plain.sock'))).toBe(true);
    expect(logs.filter((line) => line.includes('left in place'))).toHaveLength(2);
  });

  it('refuses a directory of a wider mode rather than adopting it', () => {
    const root = mkdtempSync('/tmp/mcuad-');
    roots.push(root);
    const dir = join(root, 'cua');
    mkdirSync(dir, { mode: 0o755 });
    expect(() => createCuaSockets({ dir, loadAddon: () => null, uidBoundary: true, log: () => {} })).toThrow(/mode|0755|group|other/i);
  });
});

// Acceptance 14: nothing O5 adds runs at an idle mawsd's start, a native addon included; the addon loads at the first
// socket a session creates, once
describe('the peer identity addon loads lazily', () => {
  it('not at start nor at a tab engine\'s attachment; at the first session\'s socket, once for every socket after it', () => {
    let loads = 0;
    const { sockets, appDir } = stand({ loadAddon: () => (loads++, null), uidBoundary: true });
    sockets.target(appDir);
    sockets.engineProcess(A, null);
    expect(loads).toBe(0);
    sockets.ensure(A);
    expect(loads).toBe(1);
    sockets.ensure(B);
    sockets.engineProcess(B, 4_321);
    expect(loads).toBe(1);
  });

  it('a path past sun_path creates no socket and loads nothing', () => {
    const root = mkdtempSync('/tmp/mcuad-');
    roots.push(root);
    let loads = 0;
    const sockets = createCuaSockets({ dir: join(root, 'd'.repeat(90)), loadAddon: () => (loads++, null), uidBoundary: true, log: () => {} });
    closers.push(() => sockets.close());
    expect(sockets.ensure(A)).toBeNull();
    expect(loads).toBe(0);
  });
});

// Connections whose engine is not known yet are held unread, each with a descriptor and a timer: a bounded number, per
// session and across the daemon; the excess is refused at once, and a held one's place comes back at its verdict
describe('the sockets waiting for their engine', () => {
  it('are bounded per session: the excess refused at once, the places back once the wait is out', async () => {
    const addon = fakeAddon();
    const { sockets, appDir } = stand({ addon, pendingBudget: { session: 2, total: 10 } });
    sockets.target(appDir);
    const path = sockets.ensure(A)!;
    const held = [engineClient(path), engineClient(path)];
    await until(() => sockets.inspect().A!.waiting === 2);
    const third = engineClient(path);
    await until(third.closed, 1000);
    expect(sockets.inspect().A).toMatchObject({ waiting: 2, refused: 1 });
    await until(() => held.every((client) => client.closed()), PEER_ROOT_WAIT_MS + 1000); // no_root, each
    expect(sockets.inspect().A).toMatchObject({ waiting: 0, refused: 3 });
    engineClient(path);
    await until(() => sockets.inspect().A!.waiting === 1);
  });

  it('are bounded across the daemon', async () => {
    const addon = fakeAddon();
    const { sockets, appDir } = stand({ addon, pendingBudget: { session: 5, total: 3 } });
    sockets.target(appDir);
    const a = sockets.ensure(A)!;
    const b = sockets.ensure(B)!;
    engineClient(a);
    engineClient(a);
    engineClient(b);
    await until(() => sockets.inspect().A!.waiting + sockets.inspect().B!.waiting === 3);
    const fourth = engineClient(b);
    await until(fourth.closed, 1000);
    expect(sockets.inspect().B).toMatchObject({ waiting: 1, refused: 1 });
  });
});

describe('listening follows the attached tab engine', () => {
  it('a session\'s socket listens only while a tab engine is attached, 0600, and its file goes when none is', async () => {
    const { sockets, appDir, changes } = stand({ uidBoundary: true });
    const path = sockets.ensure(A)!;
    expect(path.endsWith('/mawsd/cua/A.sock')).toBe(true);
    expect(sockets.ensure(A)).toBe(path); // stable: the next launch is told the same path
    expect(exists(path)).toBe(false);
    expect(sockets.inspect()).toEqual({ A: { listening: false, relayed: 0, refused: 0, waiting: 0 } });

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
    const sockets = createCuaSockets({ dir: join(root, 'd'.repeat(90)), loadAddon: () => null, uidBoundary: true, log: (line) => void logs.push(line) });
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
    expect(sockets.inspect().A).toEqual({ listening: true, relayed: 0, refused: 1, waiting: 0 });
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
    expect(sockets.inspect().A).toEqual({ listening: true, relayed: 1, refused: 0, waiting: 0 });

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

  // The relay's target is checked as every local socket a host connects to is (private-path.ts): an absent socket is
  // waited for, anything else is refused
  it.each([
    ['a symlink', (appDir: string, path: string) => (writeFileSync(join(appDir, 'x'), ''), symlinkSync(join(appDir, 'x'), path)), 'symlink'],
    ['a non-socket', (_appDir: string, path: string) => writeFileSync(path, ''), 'not a socket'],
  ])('refuses to relay to %s at the tab engine\'s path', async (_, make, said) => {
    const addon = fakeAddon();
    const { sockets, appDir, logs } = stand({ addon, relayConnectWaitMs: 2000 });
    make(appDir, join(appDir, `${A}.sock`));
    sockets.target(appDir);
    sockets.engineProcess(A, ENGINE);
    const client = engineClient(sockets.ensure(A)!);
    await until(client.closed, 1000); // at once, not after the wait
    expect(logs.some((line) => line.startsWith('cua socket of A: the attached app\'s socket is refused') && line.includes(said))).toBe(true);
  });

  it('refuses to relay to a socket in a directory others can enter', async () => {
    const addon = fakeAddon();
    const { sockets, appDir, logs } = stand({ addon, relayConnectWaitMs: 2000 });
    const app = appSocket(appDir, A);
    await app.listening;
    chmodSync(appDir, 0o755);
    sockets.target(appDir);
    sockets.engineProcess(A, ENGINE);
    const client = engineClient(sockets.ensure(A)!);
    await until(client.closed, 1000);
    expect(app.peers).toHaveLength(0);
    expect(logs.some((line) => line.startsWith('cua socket of A: the attached app\'s socket is refused') && line.includes('0755'))).toBe(true);
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
