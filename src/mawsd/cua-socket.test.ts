import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { PEER_AUTH_VERSION, PEER_ROOT_WAIT_MS, type PeerAddon } from '../main/browser/cua/peer';
import { createCuaSockets, loadCuaBroker, PENDING_BUDGET, type CuaSocketsOptions } from './cua-socket';
import type { BrowserDemand, BrowserRouteReading, BrowserTarget } from './cua-broker'; // P5 O17 M1
import { browserCapability } from './session-capabilities'; // P5 O17 M1

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
const NEXT_ENGINE = 5100; // an engine that replaced session A's
const NEXT_CHILD = 5101; // its cua serve
const uid = process.getuid!();

// `peerReads` counts the peer check's reads of a socket's peer: the check runs, and its verdict acts, in one turn
function fakeAddon(): PeerAddon & { peerPid: number; peerReads: number } {
  const table = new Map([
    [ENGINE, { ppid: 1, start: 10 }],
    [CHILD, { ppid: ENGINE, start: 20 }],
    [STRANGER, { ppid: 1, start: 30 }],
    [OTHER_ENGINE, { ppid: 1, start: 40 }],
    [NEXT_ENGINE, { ppid: 1, start: 50 }],
    [NEXT_CHILD, { ppid: NEXT_ENGINE, start: 60 }],
  ]);
  const addon = {
    peerPid: CHILD,
    peerReads: 0,
    version: PEER_AUTH_VERSION,
    peer: () => (addon.peerReads++, { pid: addon.peerPid, uid }),
    process: (pid: number) => table.get(pid) ?? null,
  };
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

  // what was checked against one engine is that engine's: the app sees only the daemon, so it cannot hold a replacement
  // engine's boundary itself (panel scalpel-1#1)
  it.each([
    ['replaced by another', NEXT_ENGINE],
    ['gone', null],
  ])('a peer checked under the session\'s engine is never relayed once that engine is %s, even while its connect is still retrying', async (_, next) => {
    const addon = fakeAddon();
    const { sockets, appDir } = stand({ addon, relayConnectWaitMs: 2000 });
    sockets.target(appDir); // the app's socket for A does not listen yet: the relay's connect retries
    sockets.engineProcess(A, ENGINE);
    const client = engineClient(sockets.ensure(A)!, Buffer.from('OLD_ENGINE'));
    await until(() => addon.peerReads > 0); // checked against ENGINE and let in
    sockets.engineProcess(A, next);
    const app = appSocket(appDir, A);
    await app.listening;
    await until(() => client.closed() || app.heard().length > 0);
    expect(app.heard().toString()).toBe('');
    expect(client.closed()).toBe(true);
    expect(app.peers).toHaveLength(0);
  });

  it('a relayed pair ends when its engine is replaced, and lives through a repeated status of the same engine', async () => {
    const addon = fakeAddon();
    const { sockets, appDir } = stand({ addon });
    const app = appSocket(appDir, A);
    await app.listening;
    sockets.target(appDir);
    sockets.engineProcess(A, ENGINE);
    const client = engineClient(sockets.ensure(A)!, Buffer.from('a'));
    await until(() => app.heard().toString() === 'a');
    sockets.engineProcess(A, ENGINE); // the same engine's next status
    client.socket.write('b');
    await until(() => app.heard().toString() === 'ab');
    sockets.engineProcess(A, NEXT_ENGINE);
    await until(client.closed);
    addon.peerPid = NEXT_CHILD;
    engineClient(sockets.ensure(A)!, Buffer.from('next'));
    await until(() => app.heard().toString() === 'abnext');
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

// P5 O17 M1 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §B, §C; acceptance 1's cold half and 2):
// with no app attached and the session's route cold (the route's readings a stub until M5's browser-route.ts), the
// socket listens while the session's engine is live; a peer the check admits is handed to the cold broker, a chunk
// loaded only then; the pending budget counts the broker's promotions beside the peer-root waits, one counter.
describe('the cold route (P5 O17 M1)', () => {
  const frame = (message: unknown) => {
    const body = Buffer.from(JSON.stringify(message));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    return Buffer.concat([header, body]);
  };
  const messagesOf = (bytes: Buffer) => {
    const out: { id?: unknown; method?: string; result?: unknown; error?: { message: string } }[] = [];
    for (let at = 0; at + 4 <= bytes.length; ) {
      const length = bytes.readUInt32LE(at);
      if (at + 4 + length > bytes.length) break;
      out.push(JSON.parse(bytes.subarray(at + 4, at + 4 + length).toString('utf8')));
      at += 4 + length;
    }
    return out;
  };

  // The route's stub: every session cold at epoch e1 and live unless told otherwise; ensureBrowser held open
  function coldStand(options: Partial<CuaSocketsOptions> & { addon?: PeerAddon | null } = {}) {
    const readings = new Map<AppSessionId, BrowserRouteReading>();
    const live = new Map<AppSessionId, boolean>();
    const targets = new Map<AppSessionId, string>(); // P5 O17 M5: the render host's socket in `headless`
    const demands: BrowserDemand[] = [];
    let loads = 0;
    const stood = stand({
      cold: {
        machine: 'mini',
        version: 'test',
        reading: (appSessionId) => readings.get(appSessionId) ?? { state: 'cold', epoch: 'e1' },
        live: (appSessionId) => live.get(appSessionId) ?? true,
        ensureBrowser: (demand) => (demands.push(demand), new Promise<BrowserTarget>(() => {})),
        target: (appSessionId) => (readings.get(appSessionId)?.state === 'headless' ? (targets.get(appSessionId) ?? null) : null),
      },
      loadBroker: () => (loads++, loadCuaBroker()),
      ...options,
    });
    return { ...stood, readings, live, targets, demands, loads: () => loads };
  }

  it('listens with no app while the route is cold and the engine live, stops when it is not, and listens while starting', async () => {
    const { sockets, readings, live } = coldStand({ uidBoundary: true });
    const path = sockets.ensure(A)!;
    await until(() => exists(path));
    expect(sockets.inspect().A!.listening).toBe(true);
    live.set(A, false);
    sockets.routeChanged(A);
    expect(exists(path)).toBe(false);
    readings.set(A, { state: 'starting', epoch: 'e1' });
    sockets.routeChanged(A);
    await until(() => exists(path));
    readings.set(A, { state: 'none', epoch: 'e2' });
    sockets.routeChanged(A);
    expect(exists(path)).toBe(false);
    expect(sockets.inspect().A!.listening).toBe(false);
  });

  it('an admitted peer is greeted by the broker and answered cold; the chunk loads once, at the first admitted peer', async () => {
    const addon = fakeAddon();
    const { sockets, loads, demands } = coldStand({ addon });
    sockets.engineProcess(A, ENGINE);
    const path = sockets.ensure(A)!;
    await until(() => exists(path));
    expect(loads()).toBe(0);
    const client = engineClient(path, frame({ jsonrpc: '2.0', id: 1, method: 'tabs.query', params: {} }));
    await until(() => messagesOf(client.heard()).length === 2);
    expect(messagesOf(client.heard())).toEqual([
      { jsonrpc: '2.0', method: 'hello', params: { extensionId: 'maws', extensionInstanceId: 'maws:A', version: 'test', protocolVersion: 1, profileName: 'MAWS' } },
      { jsonrpc: '2.0', id: 1, result: [] },
    ]);
    engineClient(path);
    await until(() => sockets.inspect().A!.relayed === 0 && loads() === 1);
    expect(demands).toHaveLength(0);
  });

  it('a rejected peer gets no hello and nothing is imported; nor does a capability read, a listener or the inspection import anything', async () => {
    const addon = fakeAddon();
    const { sockets, loads } = coldStand({ addon });
    sockets.engineProcess(A, ENGINE);
    addon.peerPid = STRANGER;
    const path = sockets.ensure(A)!;
    await until(() => exists(path));
    browserCapability({ machine: 'mini', appSessionId: A, path, tabEngine: sockets.tabEngine(), headless: null });
    sockets.inspect();
    const client = engineClient(path, frame({ jsonrpc: '2.0', id: 1, method: 'tabs.query', params: {} }));
    await until(client.closed);
    expect(client.heard().length).toBe(0);
    expect(sockets.inspect().A!.refused).toBe(1);
    expect(loads()).toBe(0);
  });

  it('the pending budget counts promotions and peer-root waits together, per session and across the daemon', async () => {
    expect(PENDING_BUDGET).toEqual({ session: 8, total: 64 });
    const table = new Map([
      [ENGINE, { ppid: 1, start: 10 }],
      [CHILD, { ppid: ENGINE, start: 20 }],
    ]);
    const addon: PeerAddon = { version: PEER_AUTH_VERSION, peer: () => ({ pid: CHILD, uid }), process: (pid: number) => table.get(pid) ?? null };
    const { sockets, demands } = coldStand({ addon, pendingBudget: { session: 2, total: 3 } });
    sockets.engineProcess(A, ENGINE);
    const a = sockets.ensure(A)!;
    await until(() => exists(a));
    const promoting = engineClient(a, frame({ jsonrpc: '2.0', id: 1, method: 'tabs.create', params: {} }));
    await until(() => demands.length === 1); // a promotion holds A's first place
    table.delete(ENGINE); // A's engine no longer reads live: the next peers wait for it
    engineClient(a);
    await until(() => sockets.inspect().A!.waiting === 1); // A's second place
    const pastA = engineClient(a);
    await until(pastA.closed, 1000);
    expect(sockets.inspect().A).toMatchObject({ waiting: 1, refused: 1 });
    table.set(ENGINE, { ppid: 1, start: 10 }); // admitted again, but its trigger finds A's places taken
    const refusedTrigger = engineClient(a, frame({ jsonrpc: '2.0', id: 2, method: 'tabs.create', params: {} }));
    await until(refusedTrigger.closed, 1000);
    expect(messagesOf(refusedTrigger.heard()).find((message) => message.id === 2)?.error?.message).toMatch(/too many connections waiting/);
    expect(demands).toHaveLength(1);
    // across the daemon: A's two and B's root wait are the three
    const b = sockets.ensure(B)!;
    await until(() => exists(b));
    engineClient(b);
    await until(() => sockets.inspect().B!.waiting === 1);
    const pastTotal = engineClient(b);
    await until(pastTotal.closed, 1000);
    expect(sockets.inspect().B).toMatchObject({ waiting: 1, refused: 1 });
    expect(promoting.closed()).toBe(false);
  });

  it('an app’s attachment ends the cold connections and relays the next; its departure leaves the socket cold', async () => {
    const addon = fakeAddon();
    const { sockets, appDir } = coldStand({ addon });
    sockets.engineProcess(A, ENGINE);
    const path = sockets.ensure(A)!;
    await until(() => exists(path));
    const cold = engineClient(path);
    await until(() => messagesOf(cold.heard()).length === 1);
    const app = appSocket(appDir, A);
    await app.listening;
    sockets.target(appDir);
    await until(cold.closed);
    engineClient(path, Buffer.from('relayed'));
    await until(() => app.heard().toString() === 'relayed');
    sockets.target(null);
    expect(exists(path)).toBe(true); // still listening, cold
    const again = engineClient(path);
    await until(() => messagesOf(again.heard()).length === 1);
  });

  it('a new epoch ends what the old one admitted; a replaced engine and a removed session end the cold connections too', async () => {
    const addon = fakeAddon();
    const { sockets, readings } = coldStand({ addon });
    sockets.engineProcess(A, ENGINE);
    const path = sockets.ensure(A)!;
    await until(() => exists(path));
    const first = engineClient(path);
    await until(() => messagesOf(first.heard()).length === 1);
    readings.set(A, { state: 'cold', epoch: 'e2' });
    sockets.routeChanged(A);
    await until(first.closed);
    const second = engineClient(path);
    await until(() => messagesOf(second.heard()).length === 1);
    sockets.engineProcess(A, NEXT_ENGINE);
    await until(second.closed);
    addon.peerPid = NEXT_CHILD;
    const third = engineClient(path);
    await until(() => messagesOf(third.heard()).length === 1);
    sockets.remove(A);
    await until(third.closed);
  });

  // The review's finding (M1 fix 1): a checked peer held for the broker's chunk is its session's, under the epoch and the
  // engine it was checked in; a teardown while the chunk loads ends it, and at the load nothing else admits it
  function heldLoader() {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    return { loadBroker: () => gate.then(() => loadCuaBroker()), release };
  }
  // `peers` checked and let in: judgePeer reads the peer twice per check (once more after the walk)
  const checked = async (addon: { peerReads: number }, peers: number) => {
    await until(() => addon.peerReads === 2 * peers);
    await new Promise((resolve) => setImmediate(resolve));
  };

  it.each([
    ['its engine is replaced', 'engine'],
    ['its route moves to a new epoch', 'epoch'],
    ['its route moves to a new epoch nobody announced', 'silent epoch'],
    ['its engine and epoch both move (the review’s case)', 'both'],
  ] as const)('a peer waiting for the broker’s chunk is never admitted once %s', async (_, what) => {
    const addon = fakeAddon();
    const loader = heldLoader();
    const { sockets, readings, demands, logs } = coldStand({ addon, loadBroker: loader.loadBroker });
    sockets.engineProcess(A, ENGINE);
    readings.set(A, { state: 'cold', epoch: 'old-epoch' });
    const path = sockets.ensure(A)!;
    await until(() => exists(path));
    const client = engineClient(path, frame({ jsonrpc: '2.0', id: 1, method: 'tabs.create', params: {} }));
    await checked(addon, 1);
    if (what === 'engine' || what === 'both') sockets.engineProcess(A, NEXT_ENGINE);
    if (what !== 'engine') readings.set(A, { state: 'cold', epoch: 'new-epoch' });
    if (what === 'epoch' || what === 'both') sockets.routeChanged(A);
    if (what !== 'silent epoch') await until(client.closed); // ended at once, while the chunk still loads
    loader.release();
    await until(() => logs.includes('[cua] the cold broker loaded'));
    await until(client.closed);
    expect(client.heard().length).toBe(0);
    expect(demands).toHaveLength(0);
  });

  // The cross-milestone review's finding: a peer waiting for its engine's root was admitted in the period it was accepted
  // in, and is ended with that period (§B: the handover ends pending connections), never served under the next one
  it.each([
    ['the route moves to a new epoch', 'epoch'],
    ['the route moves to a new epoch nobody announced', 'silent epoch'],
    ['an app attaches', 'app'],
  ] as const)('a peer waiting for its engine’s root is ended, never admitted under the next epoch, when %s', async (_, what) => {
    const addon = fakeAddon();
    const { sockets, readings, demands, loads, appDir } = coldStand({ addon });
    readings.set(A, { state: 'cold', epoch: 'old-epoch' });
    const path = sockets.ensure(A)!;
    await until(() => exists(path));
    const client = engineClient(path, frame({ jsonrpc: '2.0', id: 1, method: 'tabs.create', params: {} }));
    await until(() => sockets.inspect().A!.waiting === 1); // no engine known yet: a root wait
    const app = appSocket(appDir, A);
    await app.listening;
    if (what === 'app') sockets.target(appDir);
    readings.set(A, { state: what === 'app' ? 'relay' : 'cold', epoch: 'new-epoch' });
    if (what !== 'silent epoch') {
      sockets.routeChanged(A);
      await until(client.closed, 1000); // at once, well inside the root wait
      expect(sockets.inspect().A!.waiting).toBe(0);
    }
    sockets.engineProcess(A, ENGINE); // the engine becomes known: nothing of the old epoch is decided under the new one
    await until(client.closed, 1000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.heard().length).toBe(0);
    expect(app.peers).toHaveLength(0);
    expect(demands).toHaveLength(0);
    expect(loads()).toBe(0);
    expect(sockets.inspect().A).toMatchObject({ waiting: 0, refused: 0 });
  });

  it('a peer waiting for its engine’s root under the current epoch is still decided at the root', async () => {
    const addon = fakeAddon();
    const { sockets, readings } = coldStand({ addon });
    readings.set(A, { state: 'cold', epoch: 'e1' });
    const path = sockets.ensure(A)!;
    await until(() => exists(path));
    const client = engineClient(path);
    await until(() => sockets.inspect().A!.waiting === 1);
    sockets.routeChanged(A); // read anew, the same epoch: the wait stands
    sockets.engineProcess(A, ENGINE);
    await until(() => messagesOf(client.heard()).length === 1); // the broker's hello
    expect(client.closed()).toBe(false);
  });

  it('a peer waiting for the broker’s chunk ends with its session; a session made again under the same id never admits it', async () => {
    const addon = fakeAddon();
    const loader = heldLoader();
    const { sockets, demands, logs } = coldStand({ addon, loadBroker: loader.loadBroker });
    sockets.engineProcess(A, ENGINE);
    const path = sockets.ensure(A)!;
    await until(() => exists(path));
    const client = engineClient(path, frame({ jsonrpc: '2.0', id: 1, method: 'tabs.create', params: {} }));
    await checked(addon, 1);
    sockets.remove(A);
    await until(client.closed);
    sockets.ensure(A);
    sockets.engineProcess(A, ENGINE);
    loader.release();
    await until(() => logs.includes('[cua] the cold broker loaded'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.heard().length).toBe(0);
    expect(demands).toHaveLength(0);
  });

  it('peers waiting for the broker’s chunk count in the pending budget; at the load the current ones are admitted', async () => {
    const addon = fakeAddon();
    const loader = heldLoader();
    const { sockets } = coldStand({ addon, loadBroker: loader.loadBroker, pendingBudget: { session: 2, total: 64 } });
    sockets.engineProcess(A, ENGINE);
    const path = sockets.ensure(A)!;
    await until(() => exists(path));
    const held = [engineClient(path), engineClient(path)];
    await checked(addon, 2);
    const past = engineClient(path);
    await until(past.closed, 1000);
    expect(sockets.inspect().A!.refused).toBe(1);
    loader.release();
    await until(() => held.every((client) => messagesOf(client.heard()).length === 1));
    engineClient(path); // the chunk loaded: admitted at once, the places back
    await until(() => sockets.inspect().A!.refused === 1 && held.every((client) => !client.closed()));
  });

  it('with no app, the departure line says which sockets keep listening cold', async () => {
    const { sockets, appDir, logs, live } = coldStand({ uidBoundary: true });
    live.set(B, false);
    sockets.ensure(A);
    sockets.ensure(B);
    sockets.target(appDir);
    sockets.target(null);
    expect(logs.at(-1)).toBe("[cua] no tab engine is attached: 1 of the sessions' sockets keep listening on their cold route, the others stop");
  });
  // P5 O17 M5 (§B): `headless` relays a new connection straight to the render host, never through the broker
  it('in headless, relays a newly admitted peer straight to the render host’s socket, the broker never loaded, until the epoch moves on', async () => {
    const addon = fakeAddon();
    const { sockets, readings, targets, loads, root } = coldStand({ addon });
    const render = appSocket(root, 'render-A'); // the render host's socket for A, its own hello first
    render.server.on('connection', (socket) => void socket.write('render-host:hello'));
    await render.listening;
    targets.set(A, render.path);
    readings.set(A, { state: 'headless', epoch: 'e1' });
    sockets.engineProcess(A, ENGINE);
    const path = sockets.ensure(A)!;
    await until(() => exists(path));
    const client = engineClient(path, Buffer.from('tabs.create'));
    await until(() => client.heard().toString() === 'render-host:hello' && render.heard().toString() === 'tabs.create');
    expect(sockets.inspect().A!.relayed).toBe(1);
    expect(loads(), 'no broker on the headless path').toBe(0);
    readings.set(A, { state: 'cold', epoch: 'e2' }); // the render host ended: a new period
    sockets.routeChanged(A);
    await until(client.closed);
    await until(() => render.peers.every((peer) => peer.destroyed || peer.readableEnded));
  });
});
