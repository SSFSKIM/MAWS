// `mawsd`'s side of the cutover (P5 O3-D M5a; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §L and
// §A's bindings; D10, D21, D44(3), D46): the refusal of an app that runs a spine of its own at engine-host.sock, its exit
// asking nothing, and the yield to one from before O3-A, all behind `claimSpine` (off until M5b, so an app of today sees
// nothing new); the second signal behind its own switch; no relay event for a post-D app; the spine's intercepts on a
// post-D app's relay, on the endpoint's `machine` route and with the spine cold; the trash and the browser socket the
// spine is bound to. Over the daemon in this process, stand-in hosts on real sockets (test/support/mawsd-scene.ts) and a
// stand-in of the services chunk with the real spine.lock.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, lutimesSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { MACHINE_SPINE_CAPABILITY, PEER_CAPABILITIES, SOCKET_PROTOCOL } from '@shared/host/socket-protocol';
import type { AppSessionId } from '@shared/graph/ids';
import { wireFingerprint } from '@shared/ipc/wire-fingerprint';
import { buildIdOf, procStartOf } from '../engine-host/supervisor-files';
import { SPINE_LOCK, takeSpineLock } from '../services/settings/spine-lock';
import type { SpineDeps } from '../services/spine-root';
import { couldHaveWritten, SINGLETON_LOCK_SIGNAL_DEFAULT, SPINE_LOCK_FILE } from './daemon';
import type { DaemonServices, EndpointModule } from './endpoint-seam';
import type { SpineEntry } from './spine-seam';
import { MawsdScene, sleep, until } from '../../test/support/mawsd-scene';

let scene: MawsdScene;
let children: ChildProcess[];

beforeEach(() => {
  scene = new MawsdScene('maws-ml-');
  children = [];
  onTestFailed(() => void process.stdout.write(`--- mawsd's log\n${scene.logs.join('\n')}\n`));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  for (const child of children) child.kill('SIGKILL');
  await scene.dispose();
  vi.restoreAllMocks();
});

const POST_D = [...PEER_CAPABILITIES.app, MACHINE_SPINE_CAPABILITY]; // an app's hello from M5b on
const REWOUND = { rewound: true, reason: null, error: null, prefillText: null, precedingAssistantUuid: null, files: null };
const REWIND = { appSessionId: 'app-1', targetMessageUuid: 'm-target', lastSeenMessageUuid: 'm-seen', files: false };

// An app process of another build: a live pid with a real start time, which the test ends.
async function otherApp(): Promise<number> {
  const child = spawn('/bin/sleep', ['600'], { stdio: 'ignore' });
  children.push(child);
  await new Promise((resolve) => child.once('spawn', resolve));
  return child.pid!;
}

// The services chunk as the seam loads it: the real lock, and a root that registers one command and intercepts the
// rewind and lane B's claimed op (D47), noting each it is handed
function standInChunk() {
  const noted: unknown[] = [];
  const stops = vi.fn();
  const deps: SpineDeps[] = [];
  const load = async (): Promise<SpineEntry> => ({
    takeSpineLock,
    openSpineData: async (_profile, { lock }) => ({ lock: lock!, refused: lock!.refused, machineSettings: null as never, paths: { client: '', machine: '' } }),
    startSpine: (started) => {
      deps.push(started);
      started.bus.register('session.launchMode', () => ({ mode: 'index' }));
      started.bus.intercept('session.rewind', (input) => (noted.push(input), REWOUND));
      started.bus.intercept('host.op', (input) => (noted.push(input), { state: 'done', result: { ok: true, value: REWOUND } }));
      return { view: { engineStatuses: () => [], on: () => () => {} } as never, settled: async () => {}, busy: () => false, stop: stops };
    },
  });
  return { load, noted, stops, deps };
}

function endpoint() {
  let services: DaemonServices | null = null;
  const module: EndpointModule = { start: async (started) => void (services = started), stop: async () => {}, status: () => null, enrollment: () => null, cli: async () => ({ code: 0, out: '' }) };
  return { module, services: () => services! };
}

const spineState = async () => (await scene.daemons.at(-1)!.status()).spine?.state;

describe('the refusal at engine-host.sock (§L), behind claimSpine', () => {
  it('is off by default, until M5b: an app whose hello lists no machine.spine is welcomed as today', async () => {
    await scene.start();
    const app = await scene.app();
    expect(app.welcomed()).toBe(true);
  });

  it('refuses a hello without machine.spine with mawsd’s own refuse wire line, wakes no engine host, and its exit asks nothing', async () => {
    await scene.start({ claimSpine: true });
    const app = await scene.app();
    expect(app.first).toEqual({ t: 'refuse', reason: 'wire', protocol: SOCKET_PROTOCOL, buildId: buildIdOf(scene.self), wire: wireFingerprint(), liveSessions: 0 });
    expect(scene.logs).toContainEqual(expect.stringMatching(/^engine-host\.sock: refuse wire to appPid \d+ \(build raw-app\): its hello lists no machine\.spine, so it runs a spine of its own/));
    app.exit('now');
    await until(() => scene.logs.includes('engine-host.sock: exit now on a connection the relay refused itself: nothing asked of the engine-host'), 3_000, 'the exit');
    await sleep(100);
    expect(scene.spawn).not.toHaveBeenCalled(); // no host woken for it, none replaced
    expect(scene.logs.some((line) => line.includes('Restart now'))).toBe(false);
  });

  it('welcomes a hello that lists machine.spine; an exit after the upstream’s reflected refusal still replaces an incompatible engine host', async () => {
    const old = await scene.engine({ protocol: 99, counts: { liveSessions: 3, rows: 3 } });
    await scene.start({ claimSpine: true });
    const refused = await scene.app('engine-host', { capabilities: POST_D });
    expect(refused.first).toMatchObject({ t: 'refuse', reason: 'protocol', protocol: 99, liveSessions: 3 }); // the upstream's, reflected
    refused.exit('now');
    await until(() => scene.engines.length === 2, 5_000, 'the replacement');
    expect(old.supervisor.exits).toContain('now');
    const app = await scene.app('engine-host', { capabilities: POST_D });
    expect(app.first).toMatchObject({ t: 'welcome', pid: scene.lastEngine().pid });
  });
});

describe('the yield (§L), behind claimSpine', () => {
  it('to a refused app that holds no spine.lock: the loaded spine released, the lock given up, every load refused while it lives, loaded again once it is gone', async () => {
    const chunk = standInChunk();
    await scene.start({ claimSpine: true, spine: { load: chunk.load, timing: { yieldCheckMs: 20 } } });
    const client = await scene.app('machine');
    expect(await client.request('session.launchMode')).toMatchObject({ ok: true });
    expect(JSON.parse(readFileSync(join(scene.root, SPINE_LOCK), 'utf8'))).toMatchObject({ pid: process.pid });
    const pid = await otherApp();
    const refused = await scene.app('engine-host', { appPid: pid });
    expect(refused.first).toMatchObject({ t: 'refuse', reason: 'wire' });
    await until(() => chunk.stops.mock.calls.length === 1, 3_000, 'the release');
    expect(await spineState()).toBe('yielded');
    expect(existsSync(join(scene.root, SPINE_LOCK))).toBe(false);
    expect(await client.request('session.launchMode')).toMatchObject({ ok: false, error: { code: 'host_unavailable', message: expect.stringContaining(`yielded to pid ${pid}`) } });
    children.pop()!.kill('SIGKILL');
    await vi.waitFor(async () => expect(await spineState()).toBe('cold'), { timeout: 3_000 });
    expect(await client.request('session.launchMode')).toMatchObject({ ok: true });
    expect(JSON.parse(readFileSync(join(scene.root, SPINE_LOCK), 'utf8'))).toMatchObject({ pid: process.pid });
  });

  it('not to a refused app that holds spine.lock (O3-A to O3-C): the lock refuses mawsd’s spine instead', async () => {
    const pid = await otherApp();
    writeFileSync(join(scene.root, SPINE_LOCK), JSON.stringify({ pid, procStart: procStartOf(pid), protocol: 3, buildId: '0.9.0+o3c-app', socketPath: '', startedAt: new Date().toISOString() }));
    const chunk = standInChunk();
    await scene.start({ claimSpine: true, spine: { load: chunk.load, lockWaitMs: 50 } });
    const refused = await scene.app('engine-host', { appPid: pid });
    expect(refused.first).toMatchObject({ t: 'refuse', reason: 'wire' });
    expect(scene.logs).toContainEqual(expect.stringMatching(/so it runs a spine of its own, and holds spine\.lock$/));
    const client = await scene.app('machine');
    expect(await client.request('session.launchMode')).toMatchObject({ ok: false, error: { code: 'host_unavailable', message: expect.stringContaining(`spine.lock is held by pid ${pid} (build 0.9.0+o3c-app)`) } });
    expect(await spineState()).toBe('refused');
  });

  it('nothing of it without claimSpine: a refused-looking app is welcomed and the spine stays loaded', async () => {
    const chunk = standInChunk();
    await scene.start({ spine: { load: chunk.load } });
    const client = await scene.app('machine');
    expect(await client.request('session.launchMode')).toMatchObject({ ok: true });
    const app = await scene.app('engine-host', { appPid: await otherApp() });
    expect(app.welcomed()).toBe(true);
    await sleep(50);
    expect(await spineState()).toBe('loaded');
    expect(chunk.stops).not.toHaveBeenCalled();
  });
});

// D21: the profile's SingletonLock, Chromium's `<host>-<pid>` symlink, read at each load attempt
describe('the second signal (D21), on since the probe answered, under claimSpine', () => {
  async function singleton(): Promise<number> {
    const pid = await otherApp();
    symlinkSync(`${hostname()}-${pid}`, join(scene.root, 'SingletonLock'));
    return pid;
  }

  // e2e:settings' probe (hosted run 40978897272): macOS Electron's SingletonLock is a symlink `<host>-<pid>` naming the
  // app's own pid, and a clean quit removes it
  it('is on by default, and off without claimSpine or with its own switch off', async () => {
    expect(SINGLETON_LOCK_SIGNAL_DEFAULT).toBe(true);
    await singleton();
    for (const options of [{}, { singletonSignal: true }, { claimSpine: true, singletonSignal: false }]) {
      const chunk = standInChunk();
      const daemon = await scene.start({ ...options, spine: { load: chunk.load } });
      expect(await (await scene.app('machine')).request('session.launchMode')).toMatchObject({ ok: true });
      await daemon.stop('test');
    }
  });

  it('with claimSpine, a load attempt yields to the live app the SingletonLock names, until a hello of that pid lists machine.spine', async () => {
    const pid = await singleton();
    const chunk = standInChunk();
    await scene.start({ claimSpine: true, spine: { load: chunk.load } });
    const client = await scene.app('machine');
    expect(await client.request('session.launchMode')).toMatchObject({ ok: false, error: { code: 'host_unavailable', message: expect.stringContaining(`yielded to pid ${pid}`) } });
    expect(scene.logs).toContainEqual(`[spine] SingletonLock names pid ${pid}, a live app that reads no spine of the machine’s and holds no spine.lock`);
    await scene.app('machine', { appPid: pid, capabilities: POST_D }); // a post-D app is never yielded to
    expect(scene.logs).toContainEqual(`[spine] pid ${pid} reads the machine’s spine (its hello lists machine.spine): the yield to it lifted`);
    expect(await client.request('session.launchMode')).toMatchObject({ ok: true });
  });

  it('a stale SingletonLock, left by a crash, is no signal: its pid gone, or alive but started after the lock was written (reused)', async () => {
    const reused = await otherApp();
    symlinkSync(`${hostname()}-${reused}`, join(scene.root, 'SingletonLock'));
    const before = new Date(Date.now() - 3_600_000);
    lutimesSync(join(scene.root, 'SingletonLock'), before, before); // written an hour before that process started
    const chunk = standInChunk();
    const daemon = await scene.start({ claimSpine: true, spine: { load: chunk.load } });
    expect(await (await scene.app('machine')).request('session.launchMode')).toMatchObject({ ok: true });
    await daemon.stop('test');
    rmSync(join(scene.root, 'SingletonLock'));
    const gone = spawn('/bin/sleep', ['0']);
    await new Promise((exited) => gone.once('exit', exited));
    symlinkSync(`${hostname()}-${gone.pid}`, join(scene.root, 'SingletonLock'));
    const again = standInChunk();
    await scene.start({ claimSpine: true, spine: { load: again.load } });
    expect(await (await scene.app('machine')).request('session.launchMode')).toMatchObject({ ok: true });
  });

  // Fix round 2: a start `ps` cannot give (it failed, or its line does not parse) proves nothing stale: the signal holds
  it('the lock’s writer: a pid that started at or before the lock was written, or whose start is unknown', () => {
    const written = Date.parse('2026-10-29T17:05:09Z');
    expect(couldHaveWritten('Thu Oct 29 17:05:09 2026', written)).toBe(true);
    expect(couldHaveWritten('Thu Oct 29 17:05:10 2026', written)).toBe(false);
    expect(couldHaveWritten(null, written)).toBe(true);
    expect(couldHaveWritten('not a start', written)).toBe(true);
  });

  it('a SingletonLock of another host, or naming a pid that holds spine.lock, is no signal', async () => {
    const pid = await otherApp();
    symlinkSync(`another-host-${pid}`, join(scene.root, 'SingletonLock'));
    const chunk = standInChunk();
    const daemon = await scene.start({ claimSpine: true, singletonSignal: true, spine: { load: chunk.load } });
    expect(await (await scene.app('machine')).request('session.launchMode')).toMatchObject({ ok: true });
    expect(await spineState()).toBe('loaded');
    await daemon.stop('test');
  });
});

describe('a post-D app on engine-host.sock (whatever claimSpine)', () => {
  it('hears no engine-host event on its relay (its events come on machine.sock); an app of today hears them from its ready', async () => {
    await scene.start();
    const spineApp = await scene.app('engine-host', { capabilities: POST_D });
    spineApp.ready();
    await spineApp.request('engine.ping');
    const engine = scene.lastEngine();
    expect(engine.send({ n: 1 })).toBe(true);
    await spineApp.request('engine.ping'); // after the event on the host's one link
    await sleep(50);
    expect(spineApp.events()).toEqual([]);
    spineApp.leave();
    await until(() => spineApp.closed, 3_000, 'the departure');
    const today = await scene.app();
    today.ready();
    await today.request('engine.ping');
    expect(scene.lastEngine().send({ n: 2 })).toBe(true);
    await until(() => today.events().length === 1, 3_000, 'the event');
  });
});

// D44(3): the spine's intercepts on every path a conversation act reaches mawsd by
describe('the spine’s intercepts on every path (D44(3))', () => {
  it('a post-D app’s relay: its session.rewind goes through the spine’s intercept, the spine loaded for it; an app of today’s goes on raw', async () => {
    const chunk = standInChunk();
    await scene.start({ spine: { load: chunk.load } });
    const today = await scene.app();
    await today.request('session.rewind', REWIND);
    expect(chunk.noted).toEqual([]);
    expect(await spineState()).toBe('cold'); // an app of today keeps its own spine's note: mawsd's is not loaded for it
    today.leave();
    await until(() => today.closed, 3_000, 'the departure');
    const app = await scene.app('engine-host', { capabilities: POST_D });
    expect(await app.request('session.rewind', REWIND)).toMatchObject({ t: 'res', ok: true, value: REWOUND });
    expect(chunk.noted).toEqual([REWIND]);
    expect(await spineState()).toBe('loaded');
    expect(scene.lastEngine().named('session.rewind')).toEqual([REWIND]); // today's only: the stand-in intercept answered the post-D app's
  });

  it('the endpoint’s machine route: dispatch(machine, session.rewind) through the loaded spine’s intercept', async () => {
    const seam = endpoint();
    const chunk = standInChunk();
    await scene.start({ endpoint: seam.module, spine: { load: chunk.load } });
    expect(await seam.services().dispatch('machine', 'session.launchMode', undefined)).toMatchObject({ ok: true });
    expect(await seam.services().dispatch('machine', 'session.rewind', REWIND)).toMatchObject({ ok: true, value: REWOUND });
    expect(chunk.noted).toEqual([REWIND]);
  });

  // D47: a phone's rewind reaches mawsd through the endpoint's engine-host route, as lane B's claimed op or bare
  const CLAIMED = { opId: 'phone-op-00000001', opCreated: '2026-10-30T00:00:00.000Z', member: 'member-1', device: 'phone-1', fingerprint: 'fp-1', name: 'session.rewind', input: REWIND, context: { launchId: 'l', engineSessionId: 'e' } };

  it('under claimSpine, the spine cold: the endpoint’s engine-host route of a claimed rewind (host.op) and of a bare one loads it, and its intercepts note both', async () => {
    const seam = endpoint();
    const chunk = standInChunk();
    await scene.start({ claimSpine: true, endpoint: seam.module, spine: { load: chunk.load } });
    expect(await spineState()).toBe('cold');
    expect(await seam.services().dispatch('engine-host', 'host.op', CLAIMED)).toMatchObject({ ok: true, value: { state: 'done', result: { ok: true, value: REWOUND } } });
    expect(await spineState()).toBe('loaded');
    expect(await seam.services().dispatch('engine-host', 'session.rewind', REWIND)).toMatchObject({ ok: true, value: REWOUND });
    expect(chunk.noted).toEqual([CLAIMED, REWIND]);
    expect(scene.engines.flatMap((engine) => [...engine.named('host.op'), ...engine.named('session.rewind')])).toEqual([]); // none reached the engine host
  });

  it('under claimSpine, a claimed op of a name the spine does not intercept goes on raw, the spine left cold', async () => {
    const seam = endpoint();
    const chunk = standInChunk();
    await scene.start({ claimSpine: true, endpoint: seam.module, spine: { load: chunk.load } });
    await seam.services().dispatch('engine-host', 'host.op', { ...CLAIMED, name: 'session.stop', input: { appSessionId: 'app-1' } });
    expect(scene.lastEngine().named('host.op')).toHaveLength(1);
    expect(await spineState()).toBe('cold');
    expect(chunk.noted).toEqual([]);
  });

  it('with claimSpine off (today), the endpoint’s engine-host route forwards a claimed rewind and a bare one raw, the spine left cold', async () => {
    const seam = endpoint();
    const chunk = standInChunk();
    await scene.start({ endpoint: seam.module, spine: { load: chunk.load } });
    await seam.services().dispatch('engine-host', 'host.op', CLAIMED);
    await seam.services().dispatch('engine-host', 'session.rewind', REWIND);
    expect(scene.lastEngine().named('host.op')).toHaveLength(1);
    expect(scene.lastEngine().named('session.rewind')).toHaveLength(1);
    expect(await spineState()).toBe('cold');
    expect(chunk.noted).toEqual([]);
  });

  it('the spine cold: a rewind from the endpoint loads it, and the load’s intercept notes it', async () => {
    const seam = endpoint();
    const chunk = standInChunk();
    await scene.start({ endpoint: seam.module, spine: { load: chunk.load } });
    expect(await spineState()).toBe('cold');
    expect(await seam.services().dispatch('machine', 'session.rewind', REWIND)).toMatchObject({ ok: true, value: REWOUND });
    expect(chunk.noted).toEqual([REWIND]);
    expect(await spineState()).toBe('loaded');
  });
});

describe('the spine’s bindings (§A)', () => {
  it('trash: mawsd’s own move into the user’s trash directory (D10), here the freedesktop one under XDG_DATA_HOME', async () => {
    const chunk = standInChunk();
    const data = join(scene.root, 'xdg-data');
    await scene.start({ env: { MAWS_USER_DATA: scene.root, XDG_DATA_HOME: data }, spine: { load: chunk.load } });
    expect(await (await scene.app('machine')).request('session.launchMode')).toMatchObject({ ok: true });
    mkdirSync(join(scene.root, 'gone'));
    writeFileSync(join(scene.root, 'gone', 'transcript.jsonl'), '{}');
    await chunk.deps[0]!.trash(join(scene.root, 'gone'));
    expect(existsSync(join(scene.root, 'gone'))).toBe(false);
    expect(readFileSync(join(data, 'Trash', 'files', 'gone', 'transcript.jsonl'), 'utf8')).toBe('{}');
    expect(readFileSync(join(data, 'Trash', 'info', 'gone.trashinfo'), 'utf8')).toContain(`Path=${join(scene.root, 'gone')}`);
  });

  it('browserSocket: the attached app’s, from its machine.client; another client’s is not the app’s; null once the app left', async () => {
    const chunk = standInChunk();
    await scene.start({ spine: { load: chunk.load } });
    const app = await scene.app(); // attached on engine-host.sock, this process's pid
    const machine = await scene.app('machine'); // the same app's machine transport
    const other = await scene.app('machine', { appPid: 1 }); // a CLI, a second client
    expect(await machine.request('session.launchMode')).toMatchObject({ ok: true });
    const id = 'app-1' as AppSessionId;
    expect(chunk.deps[0]!.browserSocket(id)).toBeNull();
    expect(await other.request('machine.client', { browserSocket: '/tmp/not-the-app.sock' })).toMatchObject({ ok: true });
    expect(chunk.deps[0]!.browserSocket(id)).toBeNull();
    expect(await machine.request('machine.client', { browserSocket: '/tmp/cua.sock' })).toMatchObject({ ok: true });
    expect(chunk.deps[0]!.browserSocket(id)).toBe('/tmp/cua.sock');
    app.leave();
    await until(() => app.closed, 3_000, 'the app’s departure');
    expect(chunk.deps[0]!.browserSocket(id)).toBeNull();
  });
});

it('SPINE_LOCK_FILE is the spine lock’s own name', () => {
  expect(SPINE_LOCK_FILE).toBe(SPINE_LOCK);
});
