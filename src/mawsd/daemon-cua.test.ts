// The daemon-owned cua sockets and a session's capabilities inside `mawsd` (P5 O5 M5;
// docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, M5, Interfaces §H, §I; acceptance 3 and 9): a launch is told the
// daemon's own socket for its session; it listens only while the attached app's machine.client names its cua directory,
// relays each connection there, and stops at the app's departure; a raw session.status sets up a running engine's socket
// and names its engine; `session.capabilities` answers cold and `session.capabilitiesChanged` follows each flip once.
// Over the daemon in this process (the scene's platform is linux: no peer identity addon, the uid is the boundary) and
// stand-in hosts on real sockets (test/support/mawsd-scene.ts).
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { MACHINE_SPINE_CAPABILITY } from '@shared/host/socket-protocol';
import { machineName } from '@shared/machine/identity';
import { cuaSocketDir } from '@shared/daemon/files';
import { takeSpineLock } from '../services/settings/spine-lock';
import type { SpineDeps } from '../services/spine-root';
import type { RunningDaemon } from './daemon';
import type { SpineEntry } from './spine-seam';
import { MawsdScene, until, type RawApp } from '../../test/support/mawsd-scene';

let scene: MawsdScene;
const closers: (() => void)[] = [];

beforeEach(() => {
  scene = new MawsdScene('maws-mc-');
  onTestFailed(() => void process.stdout.write(`--- mawsd's log\n${scene.logs.join('\n')}\n`));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  for (const close of closers.splice(0)) close();
  await scene.dispose();
  vi.restoreAllMocks();
});

const MACHINE = machineName({}, hostname());
const S = '0b6f3c1e-7d2a-4c59-9e41-2f8a6b0d5c73';
const NO_BROWSER = { available: false, reason: `no browser is attached on ${MACHINE}` };

async function awake(daemon: RunningDaemon) {
  void daemon.hosts.wake('engine-host');
  await until(() => scene.engines.length > 0 && daemon.hosts.snapshot('engine-host').state === 'ready', 5_000, 'the engine host');
  return scene.lastEngine();
}

// The app: attached on engine-host.sock and machine.sock (both its pid), its own cua socket for S an echo of what it hears
async function attachApp(): Promise<{ engine: RawApp; machine: RawApp; dir: string; heard: () => string; peers: Socket[] }> {
  const dir = mkdtempSync('/tmp/mcapp-'); // short, as the app's `<userData>/browser/cua` is
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const chunks: Buffer[] = [];
  const peers: Socket[] = [];
  const server: Server = createServer((socket) => {
    peers.push(socket);
    socket.on('data', (chunk) => {
      chunks.push(chunk);
      socket.write(Buffer.concat([Buffer.from('app:'), chunk]));
    });
    socket.on('error', () => {});
  });
  await new Promise<void>((resolve) => server.listen(join(dir, `${S}.sock`), resolve));
  closers.push(() => server.close());
  const engine = await scene.app('engine-host', { capabilities: [MACHINE_SPINE_CAPABILITY] });
  const machine = await scene.app('machine', { capabilities: [MACHINE_SPINE_CAPABILITY] });
  machine.ready();
  expect(await machine.request('machine.client', { browserSocket: dir })).toMatchObject({ ok: true });
  return { engine, machine, dir, heard: () => Buffer.concat(chunks).toString(), peers };
}

// An observer on machine.sock (a CLI's pid, not the app's): the capability events it hears
async function observer(): Promise<{ client: RawApp; changes: () => { appSessionId: string; capabilities: Record<string, unknown> }[] }> {
  const client = await scene.app('machine', { capabilities: [], appPid: 1 });
  client.ready();
  return { client, changes: () => client.events('session.capabilitiesChanged') as never };
}

function engineSide(path: string) {
  const socket = connect(path);
  const heard: Buffer[] = [];
  let closed = false;
  socket.on('data', (chunk) => void heard.push(chunk));
  socket.on('error', () => {});
  socket.on('close', () => void (closed = true));
  closers.push(() => socket.destroy());
  return { socket, heard: () => Buffer.concat(heard).toString(), closed: () => closed };
}

// The scene's profile is under the OS temp directory, too long for a session's socket there: the cua directory falls back
// to the short `tmp` the daemon is given
const TMP = '/tmp';
const socketOf = () => join(cuaSocketDir(scene.root, TMP), `${S}.sock`);

const running = (pid: number) => ({ appSessionId: S, status: { appSessionId: S, process: 'running', pid } });

describe('the daemon-owned cua sockets (P5 O5 M5)', () => {
  it('a launch is told the daemon\'s own socket for the session, the same path at every launch', async () => {
    let deps: SpineDeps | null = null;
    const load = async (): Promise<SpineEntry> => ({
      takeSpineLock,
      openSpineData: async (_profile, { lock }) => ({ lock: lock!, refused: lock!.refused, machineSettings: null as never, paths: { client: '', machine: '' } }),
      startSpine: (started) => {
        deps = started;
        started.bus.register('session.launchMode', () => ({ mode: 'index' }));
        return { view: { engineStatuses: () => [], on: () => () => {}, unavailable: () => null, records: () => [] } as never, settled: async () => {}, busy: () => false, stop: () => {} };
      },
    });
    await scene.start({ spine: { load }, tmp: TMP });
    const client = await scene.app('machine', { capabilities: [MACHINE_SPINE_CAPABILITY] });
    expect(await client.request('session.launchMode')).toMatchObject({ ok: true });
    const path = deps!.browserSocket(S as never);
    expect(path).toBe(socketOf());
    expect(deps!.browserSocket(S as never)).toBe(path);
    expect(existsSync(path!), 'nothing listens while no app is attached').toBe(false);
  });

  it('listens while the attached app names its cua directory, relays there byte for byte, and stops at the app\'s departure', async () => {
    const daemon = await scene.start({ permanentClient: true, tmp: TMP });
    const engine = await awake(daemon);
    const watch = await observer();
    await until(() => engine.emitRaw('session.status', running(4_321)), 3_000, 'the link’s ready line');
    const path = socketOf();
    expect(await watch.client.request('session.capabilities', { appSessionId: S })).toMatchObject({ ok: true, value: { browser: NO_BROWSER } });
    expect(existsSync(path)).toBe(false);

    const app = await attachApp();
    await until(() => existsSync(path), 1_000, 'the socket listening within a second of the attachment');
    await until(() => watch.changes().length === 1, 3_000, 'the flip’s event');
    expect(watch.changes()[0]).toMatchObject({ appSessionId: S, capabilities: { browser: { available: true } } });
    expect(await watch.client.request('session.capabilities', { appSessionId: S })).toMatchObject({ ok: true, value: { browser: { available: true } } });

    const side = engineSide(path);
    side.socket.write('frame-1');
    await until(() => side.heard() === 'app:frame-1', 3_000, 'the relayed answer');
    expect(app.heard()).toBe('frame-1');

    app.machine.leave();
    app.engine.leave();
    await until(side.closed, 3_000, 'the relayed connection’s end at the app’s departure');
    await until(() => !existsSync(path), 3_000, 'the socket gone');
    await until(() => watch.changes().length === 2, 3_000, 'the flip back');
    expect(watch.changes()[1]).toMatchObject({ appSessionId: S, capabilities: { browser: NO_BROWSER } });
    expect(watch.changes()).toHaveLength(2); // one event per flip
  });

  // A cold reading enrols the session for the event: a window that asked before any launch hears the flip
  it('posts session.capabilitiesChanged for a session only ever asked about, at the attachment, loading nothing', async () => {
    await scene.start({ permanentClient: true, tmp: TMP });
    const watch = await observer();
    expect(await watch.client.request('session.capabilities', { appSessionId: S })).toMatchObject({ ok: true, value: { browser: NO_BROWSER } });
    await attachApp();
    await until(() => watch.changes().length === 1, 3_000, 'the flip’s event for the session asked about');
    expect(watch.changes()[0]).toMatchObject({ appSessionId: S, capabilities: { browser: { available: true } } });
    expect(scene.logs.some((line) => line.includes('[spine] loaded'))).toBe(false);
  });

  it('an exited engine whose socket no launch here was told (a trust bootstrap’s) gives it up', async () => {
    const daemon = await scene.start({ permanentClient: true, tmp: TMP });
    const engine = await awake(daemon);
    await attachApp();
    await until(() => engine.emitRaw('session.status', running(4_321)), 3_000, 'the link’s ready line');
    const path = socketOf();
    await until(() => existsSync(path), 1_000, 'the running engine’s socket');
    engine.emitRaw('session.status', { appSessionId: S, status: { appSessionId: S, process: 'exited', pid: null } });
    await until(() => !existsSync(path), 3_000, 'a trust bootstrap’s socket gone at its exit');
  });

  // Acceptance 14: an idle mawsd holds no native addon; the peer check's loads at the first session's socket, once
  it('loads the peer identity addon at no start, attachment or capability reading, and once at the first session\'s socket', async () => {
    let loads = 0;
    const daemon = await scene.start({ permanentClient: true, tmp: TMP, cua: { loadAddon: () => (loads++, null) } });
    const engine = await awake(daemon);
    const watch = await observer();
    await attachApp();
    expect(await watch.client.request('session.capabilities', { appSessionId: S })).toMatchObject({ ok: true });
    expect(loads).toBe(0);
    await until(() => engine.emitRaw('session.status', running(4_321)), 3_000, 'the link’s ready line');
    await until(() => existsSync(socketOf()), 1_000, 'the running engine’s socket');
    engine.emitRaw('session.status', running(4_322));
    await until(() => scene.logs.some((line) => line.includes('[cua] no peer identity addon on this platform')), 1_000, 'the load’s line');
    expect(loads).toBe(1);
  });

  it('answers session.capabilities cold with the render entries\' reason where the runtime is absent, loading nothing', async () => {
    await scene.start({ permanentClient: true, tmp: TMP });
    const client = await scene.app('machine', { capabilities: [] });
    const answer = await client.request('session.capabilities', { appSessionId: S });
    expect(answer).toMatchObject({
      ok: true,
      value: {
        artifact_screenshot: { available: false, reason: `the render service is unavailable on ${MACHINE}: the render runtime is not installed on ${MACHINE}` },
        artifact_export: { available: false },
        browser: NO_BROWSER,
      },
    });
    expect(scene.logs.some((line) => line.includes('the render seam loaded'))).toBe(false);
    expect(scene.logs.some((line) => line.includes('[spine] loaded'))).toBe(false);
  });
});

describe('the render cache’s flips on Linux (P5 O5 M6, fix wave 1)', () => {
  it('an install and an uninstall are each posted once, with no other transition, while a session is tracked', async () => {
    const cacheRoot = join(scene.root, 'render');
    mkdirSync(cacheRoot);
    let installed = false;
    const absent = `the render runtime 44.4.5 is not installed on ${MACHINE}: run mawsd render install`;
    const runtime = () => (installed ? { available: true as const } : { available: false as const, reason: absent });
    const daemon = await scene.start({ permanentClient: true, tmp: TMP, render: { runtime, cacheRoot } });
    const engine = await awake(daemon);
    const watch = await observer();
    await until(() => engine.emitRaw('session.status', running(4_321)), 3_000, 'the link’s ready line');
    await attachApp();
    await until(() => watch.changes().length === 1, 3_000, 'the browser’s flip: S is tracked');

    installed = true; // as render-install.ts publishes: its unpack, its staging, its entry, renamed in the cache's root
    mkdirSync(join(cacheRoot, '.unpack-44.4.5-aaaaaaaaaaaa-1'));
    mkdirSync(join(cacheRoot, '44.4.5-aaaaaaaaaaaa'));
    rmSync(join(cacheRoot, '.unpack-44.4.5-aaaaaaaaaaaa-1'), { recursive: true });
    await until(() => watch.changes().length === 2, 3_000, 'the install’s flip');
    expect(watch.changes()[1]).toEqual({ appSessionId: S, capabilities: { artifact_screenshot: { available: true }, artifact_export: { available: true }, browser: { available: true } } });

    installed = false;
    rmSync(join(cacheRoot, '44.4.5-aaaaaaaaaaaa'), { recursive: true });
    await until(() => watch.changes().length === 3, 3_000, 'the uninstall’s flip');
    const unavailable = { available: false, reason: `the render service is unavailable on ${MACHINE}: ${absent}` };
    expect(watch.changes()[2]).toEqual({ appSessionId: S, capabilities: { artifact_screenshot: unavailable, artifact_export: unavailable, browser: { available: true } } });
    await new Promise((resolve) => setTimeout(resolve, 800)); // past the watch's quiet period
    expect(watch.changes()).toHaveLength(3); // one event per flip
  });

  it('the watch is open only while a session is tracked and a client hears the events: no client, no watch; released at the last client, at the session’s end and at the exit', async () => {
    const watches: { open: boolean }[] = [];
    const watchCache = () => {
      const watch = { open: true };
      watches.push(watch);
      return { close: () => void (watch.open = false) };
    };
    const open = () => watches.filter((watch) => watch.open).length;
    const daemon = await scene.start({ permanentClient: true, tmp: TMP, render: { runtime: () => ({ available: true as const }), cacheRoot: join(scene.root, 'render'), watchCache } });
    const engine = await awake(daemon);
    await until(() => engine.emitRaw('session.status', running(4_321)), 3_000, 'the link’s ready line');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(watches, 'a tracked session with no client to hear of a flip (a VM no app ever attached to): no watch').toHaveLength(0);

    const first = await observer();
    await until(() => open() === 1, 3_000, 'the watch opened by the first client (S was tracked all along)');
    first.client.leave();
    await until(() => open() === 0, 3_000, 'the watch released at the last client’s departure, S still tracked');
    await observer();
    await until(() => open() === 1, 3_000, 'the watch reopened by the next client');
    expect(watches).toHaveLength(2);

    engine.emitRaw('session.status', { appSessionId: S, status: { appSessionId: S, process: 'exited', pid: null } }); // no launch here was told it: forgotten
    await until(() => open() === 0, 3_000, 'the watch released at the last session, the client still there');
    engine.emitRaw('session.status', running(4_322));
    await until(() => open() === 1, 3_000, 'reopened by a session again');
    await daemon.stop('test over');
    expect(open(), 'released at the exit').toBe(0);
    expect(watches).toHaveLength(3);
  });
});

