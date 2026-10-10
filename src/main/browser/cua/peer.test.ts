import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ANCESTRY_LIMIT,
  authorizePeer,
  descends,
  loadPeerAddon,
  PEER_AUTH_VERSION,
  peerAddonPath,
  rootOf,
  socketFd,
  type PeerAddon,
  type ProcessRoot,
} from './peer';

// The peer identity addon and its policy (cua docs/doperpowers/specs/2026-10-09-maws-socket-peer-auth-design.md, M1;
// Acceptance 1 and 2). The first half drives the committed prebuild against real processes and a real socket; the
// second drives the policy with doubles of the addon.

// The SHA-256 of native/peer-auth/peer-auth.c, pinned identically in cua's test/chrome-peer.test.mjs: a change to the
// source in one repository fails here until both copies match again (native/peer-auth/README.md).
const PEER_AUTH_SOURCE_SHA256 = '5c94d2b4606c66a09b5011f29ce0d6915101fdc0533d01163957304af3c16483';

const appRoot = process.cwd(); // vitest runs from the repository root
const uid = process.getuid!();

describe('the addon (the committed prebuild, real processes)', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  const addon = (): PeerAddon => {
    const loaded = loadPeerAddon(peerAddonPath({ packaged: false, resourcesPath: '/nowhere', appRoot }));
    expect(loaded).not.toBeNull();
    return loaded!;
  };

  // A listening socket in a scratch directory and a connector script that holds its connection until the server
  // closes it (so an orphaned connector never outlives the test).
  async function listening(): Promise<{ path: string; connector: string; accepted: () => Promise<Socket> }> {
    const dir = mkdtempSync('/tmp/mpeer-');
    const path = join(dir, 's.sock');
    const connector = join(dir, 'connector.cjs');
    writeFileSync(
      connector,
      "const s = require('node:net').connect(process.argv[2]); s.on('close', () => process.exit(0)); s.on('error', () => process.exit(1)); setTimeout(() => process.exit(2), 20000);\n",
    );
    const waiting: ((socket: Socket) => void)[] = [];
    const sockets: Socket[] = [];
    const server: Server = createServer({ pauseOnConnect: true }, (socket) => {
      sockets.push(socket);
      waiting.shift()?.(socket);
    });
    await new Promise<void>((resolve) => server.listen(path, resolve));
    cleanups.push(() => {
      for (const socket of sockets) socket.destroy();
      server.close();
      rmSync(dir, { recursive: true, force: true });
    });
    return { path, connector, accepted: () => new Promise((resolve) => waiting.push(resolve)) };
  }

  function child(command: string, args: string[]): ChildProcess {
    const spawned = spawn(command, args, { stdio: 'ignore' });
    cleanups.push(() => spawned.kill());
    return spawned;
  }

  it('reports a connecting child: its pid and our uid, its parent and a stable start; it descends from the test process', async () => {
    const peerAuth = addon();
    const { path, connector, accepted } = await listening();
    const connecting = child(process.execPath, [connector, path]);
    const socket = await accepted();
    const fd = socketFd(socket);
    expect(fd).toEqual(expect.any(Number));
    expect(peerAuth.peer(fd!)).toEqual({ pid: connecting.pid, uid });
    const first = peerAuth.process(connecting.pid!);
    expect(first?.ppid).toBe(process.pid);
    expect(peerAuth.process(connecting.pid!)?.start).toBe(first?.start);
    const root = rootOf(process.pid, peerAuth)!;
    expect(root.pid).toBe(process.pid);
    expect(descends(connecting.pid!, [root], peerAuth.process)).toBe(true);
    expect(authorizePeer(fd, [root], { addon: peerAuth, now: Date.now(), uid })).toBeNull();
  });

  it('refuses a connector reparented to launchd: it does not descend from the test process', async () => {
    const peerAuth = addon();
    const { path, connector, accepted } = await listening();
    const orphaning = child('/bin/sh', ['-c', `("${process.execPath}" "${connector}" "${path}" &)`]);
    const socket = await accepted();
    const { pid } = peerAuth.peer(socketFd(socket)!);
    expect(pid).not.toBe(orphaning.pid);
    expect(peerAuth.process(pid)?.ppid).toBe(1);
    const root = rootOf(process.pid, peerAuth)!;
    expect(descends(pid, [root], peerAuth.process)).toBe(false);
    expect(authorizePeer(socketFd(socket), [root], { addon: peerAuth, now: Date.now(), uid })).toEqual({ reason: 'not_descendant', pid });
  });

  it('reads an exited process as null', () => {
    const exited = spawnSync('/usr/bin/true');
    expect(exited.status).toBe(0);
    expect(addon().process(exited.pid)).toBeNull();
    expect(rootOf(exited.pid, addon())).toBeNull();
  });

  it('throws a plain Error carrying the system error when the descriptor is not a socket', () => {
    expect(() => addon().peer(0x7fff)).toThrow(/getsockopt\(LOCAL_PEERPID\): Bad file descriptor/);
    expect(() => addon().peer('3' as unknown as number)).toThrow(TypeError);
  });

  it('is the version the loader pins, built from the source both repositories carry', () => {
    expect(addon().version).toBe(PEER_AUTH_VERSION);
    const source = readFileSync(join(appRoot, 'native', 'peer-auth', 'peer-auth.c'));
    expect(createHash('sha256').update(source).digest('hex')).toBe(PEER_AUTH_SOURCE_SHA256);
  });
});

describe('the loader', () => {
  it('finds the prebuild under the packaged resources, or under the development app root', () => {
    expect(peerAddonPath({ packaged: true, resourcesPath: '/App/Contents/Resources', appRoot: '/src' })).toBe('/App/Contents/Resources/peer-auth/peer-auth.node');
    expect(peerAddonPath({ packaged: false, resourcesPath: '/App/Contents/Resources', appRoot: '/src' })).toBe('/src/native/peer-auth/prebuilds/darwin-arm64/peer-auth.node');
  });

  it('reports unavailable for a missing file, and off Apple silicon macOS without trying', () => {
    const real = peerAddonPath({ packaged: false, resourcesPath: '/nowhere', appRoot });
    expect(loadPeerAddon(join(appRoot, 'native', 'peer-auth', 'missing.node'))).toBeNull();
    expect(loadPeerAddon(real, { platform: 'linux', arch: 'arm64' })).toBeNull();
    expect(loadPeerAddon(real, { platform: 'darwin', arch: 'x64' })).toBeNull();
    expect(loadPeerAddon(real, { platform: 'darwin', arch: 'arm64' })).not.toBeNull();
  });
});

// A process table of doubles: pid → { ppid, start }; `peerPids` answers successive peer() reads.
function fakeAddon(table: Record<number, { ppid: number; start: number }>, peerPids: number[], peerUid = uid): PeerAddon & { reads: number } {
  const fake = {
    reads: 0,
    version: PEER_AUTH_VERSION,
    peer(fd: number) {
      if (fd !== 7) throw new Error('getsockopt(LOCAL_PEERPID): Bad file descriptor');
      const pid = peerPids[Math.min(fake.reads, peerPids.length - 1)]!;
      fake.reads += 1;
      return { pid, uid: peerUid };
    },
    process: (pid: number) => table[pid] ?? null,
  };
  return fake;
}

// A chain of `length` processes from the peer (pid 1000) up to the root (pid 1000 + length - 1), under launchd.
function chain(length: number): Record<number, { ppid: number; start: number }> {
  const table: Record<number, { ppid: number; start: number }> = {};
  for (let i = 0; i < length; i += 1) table[1000 + i] = { ppid: i === length - 1 ? 1 : 1001 + i, start: 1000 - i };
  return table;
}

describe('the policy (doubles)', () => {
  const ACCEPT = 6; // ms since the epoch; every start in the tables is earlier (in µs)
  const table = { 100: { ppid: 50, start: 400 }, 50: { ppid: 10, start: 300 }, 10: { ppid: 1, start: 200 }, 60: { ppid: 1, start: 250 } };
  const root: ProcessRoot = { pid: 10, start: 200 };

  it('accepts a descendant of a live root, and the root process itself', () => {
    expect(authorizePeer(7, [root], { addon: fakeAddon(table, [100]), now: ACCEPT, uid })).toBeNull();
    expect(authorizePeer(7, [root], { addon: fakeAddon(table, [10]), now: ACCEPT, uid })).toBeNull();
  });

  it('accepts a descendant of any live root of the list (the session root beside trusted roots)', () => {
    expect(authorizePeer(7, [{ pid: 60, start: 250 }, root], { addon: fakeAddon(table, [100]), now: ACCEPT, uid })).toBeNull();
  });

  it('refuses for the first of the five reasons, in order', () => {
    const stranger = fakeAddon(table, [60], uid + 1);
    expect(authorizePeer(undefined, [], { addon: null, now: ACCEPT, uid })).toEqual({ reason: 'module_unavailable', pid: null });
    expect(authorizePeer(undefined, [], { addon: stranger, now: ACCEPT, uid })).toEqual({ reason: 'peer_unavailable', pid: null });
    expect(authorizePeer(8, [], { addon: stranger, now: ACCEPT, uid })).toEqual({ reason: 'peer_unavailable', pid: null });
    expect(authorizePeer(7, [], { addon: stranger, now: ACCEPT, uid })).toEqual({ reason: 'uid_mismatch', pid: 60 });
    expect(authorizePeer(7, [], { addon: fakeAddon(table, [60]), now: ACCEPT, uid })).toEqual({ reason: 'no_root', pid: 60 });
    expect(authorizePeer(7, [root], { addon: fakeAddon(table, [60]), now: ACCEPT, uid })).toEqual({ reason: 'not_descendant', pid: 60 });
  });

  it('matches nothing to a dead root (its pid now names a process with another start)', () => {
    const dead: ProcessRoot = { pid: 10, start: 199 };
    expect(descends(100, [dead], (pid) => table[pid as keyof typeof table] ?? null)).toBe(false);
    expect(authorizePeer(7, [dead], { addon: fakeAddon(table, [100]), now: ACCEPT, uid })).toEqual({ reason: 'no_root', pid: 100 });
    expect(authorizePeer(7, [dead, { pid: 60, start: 250 }], { addon: fakeAddon(table, [100]), now: ACCEPT, uid })).toEqual({ reason: 'not_descendant', pid: 100 });
  });

  it('refuses when the peer pid read again after the walk has changed (the descriptor moved)', () => {
    const moved = fakeAddon(table, [100, 60]);
    expect(authorizePeer(7, [root], { addon: moved, now: ACCEPT, uid })).toEqual({ reason: 'not_descendant', pid: 100 });
    expect(moved.reads).toBe(2);
  });

  it('refuses a peer whose process started after the accept (the connector is gone and its pid reused)', () => {
    const reused = { ...table, 100: { ppid: 50, start: ACCEPT * 1000 + 1 } };
    expect(authorizePeer(7, [root], { addon: fakeAddon(reused, [100]), now: ACCEPT, uid })).toEqual({ reason: 'not_descendant', pid: 100 });
    const atAccept = { ...table, 100: { ppid: 50, start: ACCEPT * 1000 } };
    expect(authorizePeer(7, [root], { addon: fakeAddon(atAccept, [100]), now: ACCEPT, uid })).toBeNull();
  });

  it('refuses a peer that exits during the walk', () => {
    const { 100: _gone, ...rest } = table;
    expect(_gone).toBeDefined();
    expect(authorizePeer(7, [root], { addon: fakeAddon(rest, [100]), now: ACCEPT, uid })).toEqual({ reason: 'not_descendant', pid: 100 });
  });

  it(`walks at most ${ANCESTRY_LIMIT} steps: a root 64 parents up is met, 65 is not`, () => {
    expect(ANCESTRY_LIMIT).toBe(64);
    const near = chain(65); // the peer and 64 ancestors: the root is 64 steps up
    expect(descends(1000, [{ pid: 1064, start: near[1064]!.start }], (pid) => near[pid] ?? null)).toBe(true);
    const far = chain(66); // the root is 65 steps up
    expect(descends(1000, [{ pid: 1065, start: far[1065]!.start }], (pid) => far[pid] ?? null)).toBe(false);
    expect(authorizePeer(7, [{ pid: 1065, start: far[1065]!.start }], { addon: fakeAddon(far, [1000]), now: ACCEPT, uid })).toEqual({ reason: 'not_descendant', pid: 1000 });
  });

  it('stops at launchd and the kernel, never matching them as roots', () => {
    const lookup = (pid: number) => ({ 0: { ppid: 0, start: 1 }, 1: { ppid: 0, start: 2 }, 5: { ppid: 1, start: 3 } })[pid] ?? null;
    expect(descends(5, [{ pid: 1, start: 2 }], lookup)).toBe(false);
    expect(descends(5, [{ pid: 0, start: 1 }], lookup)).toBe(false);
  });
});
