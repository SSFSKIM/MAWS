// `mawsd` (P5 O2 M5; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M5's Proves): the daemon in this process over a
// temp profile, its upstream hosts stood in for by the real socket layer and runtime on real Unix sockets, spawned
// through a fake spawn (test/support/mawsd-scene.ts). Its start and files, the handshake's reflection, raw forwarding,
// the interceptions, the ready line and the recycle, the departure's drain, and the document channels.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { createConnection } from 'node:net';
import { SOCKET_PROTOCOL } from '@shared/host/socket-protocol';
import { WIRE_MINOR } from '@shared/ipc/wire';
import type { AppSessionId } from '@shared/graph/ids';
import { readOrMintMachineRef } from '@shared/machine/identity-file';
import { buildIdOf } from '../engine-host/supervisor-files';
import type { FakeSupervisor } from '../../test/support/fake-supervisor';
import { takeSpineLock } from '../services/settings/spine-lock';
import type { SpineEntry } from './spine-seam';
import { MawsdScene, RawApp, sleep, until, type StandIn } from '../../test/support/mawsd-scene';

let scene: MawsdScene;

beforeEach(() => {
  scene = new MawsdScene();
  onTestFailed(() => void process.stdout.write(`--- mawsd's log\n${scene.logs.join('\n')}\n`));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(async () => {
  await scene.dispose();
  vi.restoreAllMocks();
});

const mode = (path: string) => statSync(path).mode & 0o777;
const ACTOR = { kind: 'session' as const, appSessionId: 'app-1' as AppSessionId };
const ARTIFACT = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';

describe('the idle collection (P5 Decision Log 124)', () => {
  it('collects once it serves with no client, and not while a client is on a socket', async () => {
    await scene.start();
    await until(() => scene.collect.mock.calls.length === 1, 5_000, 'the start’s collection');
    expect(scene.logs.some((line) => /^idle: collected in \d+ ms, heap /.test(line))).toBe(true);
    const app = await scene.app('machine');
    await app.request('daemon.status');
    await sleep(20);
    expect(scene.collect).toHaveBeenCalledOnce();
  });

  it('collects nothing once its exit began, a collection already queued included', async () => {
    const daemon = await scene.start(); // its start's entry is queued behind this turn
    await daemon.stop('test');
    await sleep(20);
    expect(scene.collect).not.toHaveBeenCalled();
  });
});

describe('the start', () => {
  it('serves three private sockets with both hosts parked and nothing spawned; its directory, token and endpoint directory private', async () => {
    const daemon = await scene.start();
    expect(scene.spawn).not.toHaveBeenCalled();
    expect(daemon.hosts.parked('engine-host')).toBe(true);
    expect(daemon.hosts.parked('pty-host')).toBe(true);
    expect(mode(scene.paths.dir)).toBe(0o700);
    expect(mode(join(scene.paths.dir, 'mawsd.token'))).toBe(0o600);
    expect(mode(scene.paths.endpoint)).toBe(0o700);
    for (const path of Object.values(scene.paths.sockets)) expect(mode(path)).toBe(0o600);
    expect(readdirSync(scene.paths.endpoint)).toEqual([]); // mawsd never writes inside it
    expect(scene.logs.some((line) => line.includes('serving; engine host parked, pty host parked'))).toBe(true);
  });

  it('corrects a wider endpoint directory to 0700, and refuses one that is a symlink (exit 1)', async () => {
    mkdirSync(scene.paths.endpoint, { recursive: true, mode: 0o700 });
    chmodSync(scene.paths.dir, 0o700);
    chmodSync(scene.paths.endpoint, 0o755);
    const daemon = await scene.start();
    expect(mode(scene.paths.endpoint)).toBe(0o700);
    await daemon.stop('test');
    scene.daemons.length = 0;
    rmSync(scene.paths.endpoint, { recursive: true });
    symlinkSync(scene.root, scene.paths.endpoint);
    scene.exits.length = 0;
    await expect(scene.start()).rejects.toThrow('did not start');
    expect(scene.exits).toEqual([1]);
    expect(scene.logs.some((line) => line.includes(scene.paths.endpoint) && line.includes('is a symlink'))).toBe(true);
    expect(existsSync(join(scene.paths.dir, 'mawsd.lock'))).toBe(false); // released
  });

  it('refuses a directory that is a symlink before writing anything, on its refusal channel (exit 1)', async () => {
    const real = join(scene.root, 'elsewhere');
    mkdirSync(real, { mode: 0o700 });
    symlinkSync(real, scene.paths.dir);
    await expect(scene.start()).rejects.toThrow('did not start');
    expect(scene.exits).toEqual([1]);
    expect(scene.logs).toEqual([expect.stringMatching(new RegExp(`^refused: mawsd cannot start in ${scene.paths.dir}: .*${scene.paths.dir}.*is a symlink`))]);
    expect(readdirSync(real)).toEqual([]);
  });

  it('a held lock: a private daemon exits 3, a unit one 0, and the holder keeps serving', async () => {
    await scene.start();
    await expect(scene.start({ kind: 'private' })).rejects.toThrow('did not start');
    await expect(scene.start({ kind: 'unit' })).rejects.toThrow('did not start');
    expect(scene.exits).toEqual([3, 0]);
    const app = await scene.app();
    expect(app.welcomed()).toBe(true);
  });

  it('the machine ref: minted at <profile>/machine.json when absent and kept across restarts; one the app minted is read', async () => {
    const first = await scene.start();
    const file = join(scene.root, 'machine.json');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ version: 1, ref: first.ref });
    expect(first.ref).toMatch(/^[A-Za-z0-9_-]{22}$/);
    await first.stop('test');
    const second = await scene.start();
    expect(second.ref).toBe(first.ref);
    expect(scene.logs.filter((line) => line === `machine ${first.ref}`)).toHaveLength(2);
    await second.stop('test');
    const other = new MawsdScene();
    try {
      const minted = readOrMintMachineRef(other.root); // the app minted it first
      await expect(other.start()).resolves.toMatchObject({ ref: minted });
    } finally {
      await other.dispose();
    }
  });

  it('a malformed machine.json stops it (exit 1, the log naming the path), and nothing rewrites the file', async () => {
    const file = join(scene.root, 'machine.json');
    writeFileSync(file, '{"version":1,"ref":"no spaces allowed"}', { mode: 0o600 });
    await expect(scene.start()).rejects.toThrow('did not start');
    expect(scene.exits).toEqual([1]);
    expect(scene.logs.some((line) => line.startsWith('fatal:') && line.includes(file))).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('{"version":1,"ref":"no spaces allowed"}');
    expect(existsSync(join(scene.paths.dir, 'mawsd.lock'))).toBe(false);
  });

  it('on darwin, excludes <profile>/mawsd from Time Machine unless tmutil says it is excluded', async () => {
    const first = await scene.start({ platform: 'darwin' });
    expect(scene.commands).toEqual([
      ['/usr/bin/tmutil', 'isexcluded', scene.paths.dir],
      ['/usr/bin/tmutil', 'addexclusion', scene.paths.dir],
    ]);
    await first.stop('test');
    scene.commands.length = 0;
    await scene.start({
      platform: 'darwin',
      runCommand: (command, args) => {
        scene.commands.push([command, ...args]);
        return { status: 0, stdout: `[Excluded]    ${scene.paths.dir}\n` };
      },
    });
    expect(scene.commands).toEqual([['/usr/bin/tmutil', 'isexcluded', scene.paths.dir]]);
  });

  it('a failing tmutil is logged, not fatal; linux runs none', async () => {
    await scene.start({ platform: 'darwin', runCommand: () => ({ status: 1, stdout: '' }) });
    expect(scene.logs.some((line) => line.includes('could not exclude') && line.includes('tmutil exited 1'))).toBe(true);
    const other = new MawsdScene();
    try {
      await other.start();
      expect(other.commands).toEqual([]);
    } finally {
      await other.dispose();
    }
  });
});

describe('the upstreams and machine.sock', () => {
  it('spawns the pty host on demand with its own Node, --disable-sigusr1, its bundle --detached over its directory, as maws-pty-host', async () => {
    await scene.start();
    const app = await scene.app('pty-host');
    expect(app.welcomed()).toBe(true);
    expect(scene.spawn).toHaveBeenCalledOnce();
    const [command, args, options] = scene.spawn.mock.calls[0]!;
    expect(command).toBe('/opt/maws/node');
    expect(args).toEqual(['--disable-sigusr1', scene.ptyProfile.modulePath, '--detached', scene.paths.ptyHost]);
    expect(options).toMatchObject({ argv0: 'maws-pty-host', env: expect.objectContaining({ MAWS_USER_DATA: scene.root }) });
  });

  it('serves daemon.status to several clients at once, with its local-only fields; the read wakes the engine host and never the pty host', async () => {
    const daemon = await scene.start();
    const [a, b] = await Promise.all([scene.app('machine'), scene.app('machine')]);
    const [first, second] = await Promise.all([a.request('daemon.status'), b.request('daemon.status')]);
    expect(second).toMatchObject({ ok: true });
    expect(first).toMatchObject({
      ok: true,
      value: {
        pid: process.pid,
        kind: 'private',
        machine: daemon.ref,
        profile: scene.root,
        logPath: scene.paths.log,
        build: { version: '0.0.0-test', buildId: buildIdOf(scene.self), engineHostBuildId: buildIdOf(scene.profile.modulePath) },
        hosts: { 'engine-host': { state: 'ready', pid: scene.lastEngine().pid }, 'pty-host': { state: 'parked', pid: null } },
        clients: { engineHost: false, ptyHost: false, machine: 2 },
        endpoint: { present: false, detail: null },
      },
    });
    expect(scene.spawn).toHaveBeenCalledOnce();
  });

  it('a wrong token on any socket is closed with nothing written', async () => {
    await scene.start();
    for (const socket of ['engine-host', 'pty-host', 'machine'] as const) {
      const app = await scene.app(socket, { token: 'not-the-token' });
      expect(app.first).toBeNull();
      expect(app.closed).toBe(true);
    }
    expect(scene.spawn).not.toHaveBeenCalled();
  });
});

describe('the handshake reflects the upstream', () => {
  // M5 review: an app that sends its hello and leaves while the host starts is never attached
  it('an app that leaves while its hello is held is never attached, so nothing counts it as a client', async () => {
    scene.engineSpawn = null; // the host comes up when the test says
    const daemon = await scene.start();
    const socket = createConnection(scene.paths.sockets['engine-host']);
    socket.on('error', () => {});
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
    socket.write(`${JSON.stringify({ t: 'hello', protocol: SOCKET_PROTOCOL, token: scene.token(), minor: WIRE_MINOR, build: 'raw-app', capabilities: [], appPid: process.pid })}\n`);
    await until(() => scene.spawn.mock.calls.length === 1, 3_000, 'the wake');
    socket.end(); // its FIN, while the hello is held
    await sleep(50);
    await scene.engine({ pid: (scene.spawn.mock.results[0]!.value as { pid: number }).pid });
    await until(() => daemon.hosts.snapshot('engine-host').state === 'ready', 3_000, 'the host');
    await sleep(100);
    expect((await daemon.status()).clients.engineHost).toBe(false);
    expect(scene.logs.some((line) => line.includes('engine-host.sock: client connected'))).toBe(false);
    expect(scene.logs.some((line) => line.includes('closed a connection whose peer left before its admission answered'))).toBe(true);
    socket.destroy();
  });

  it('a hello wakes the parked engine host and is welcomed with its pid, start, build and counts, its capabilities with mawsd’s', async () => {
    scene.engineSpawn = { counts: { liveSessions: 2, rows: 5 } };
    await scene.start();
    const app = await scene.app();
    expect(scene.spawn).toHaveBeenCalledOnce();
    const engine = scene.lastEngine();
    expect(app.first).toMatchObject({
      t: 'welcome',
      protocol: SOCKET_PROTOCOL,
      pid: engine.pid,
      build: buildIdOf(scene.profile.modulePath),
      startedAt: engine.supervisor.readLockFile().startedAt,
      liveSessions: 2,
      rows: 5,
    });
    expect(app.first!.capabilities).toContain('socket.ptyFrames');
    expect(app.first!.pid).not.toBe(process.pid);
  });

  it('holds a hello while the host starts, and closes it unanswered when no welcome comes within the hold', async () => {
    scene.engineSpawn = { answer: 'silent' };
    await scene.start({ helloHoldMs: 300 });
    const started = Date.now();
    const app = await scene.app();
    expect(app.first).toBeNull();
    expect(app.closed).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(280);
    expect(scene.logs.some((line) => line.includes('closed a connection') && line.includes('no welcome within 0.3 s'))).toBe(true);
  });

  it('an incompatible host still running sessions: its refusal as received; exit now on it replaces the host, and the next hello is welcomed by the replacement', async () => {
    const old = await scene.engine({ protocol: 99, counts: { liveSessions: 3, rows: 3 } });
    await scene.start();
    const refused = await scene.app();
    expect(refused.first).toMatchObject({ t: 'refuse', reason: 'protocol', protocol: 99, liveSessions: 3 });
    refused.exit('now');
    await until(() => scene.engines.length === 2, 5_000, 'the replacement');
    expect(old.supervisor.exits).toEqual(['idle', 'now']); // mawsd's transport asked it to exit when idle as it waited (E10)
    const app = await scene.app();
    expect(app.first).toMatchObject({ t: 'welcome', pid: scene.lastEngine().pid });
  });

  it('end to end: main’s relayed transport reads the refusal, waits, and after Restart now is welcomed by the replacement within its start budget', async () => {
    await scene.engine({ protocol: 99, counts: { liveSessions: 3, rows: 3 } });
    await scene.start();
    const main = scene.appHosts();
    void main.start();
    await until(() => main.refusal('engine-host') !== null, 5_000, 'main to read the refusal');
    expect(main.refusal('engine-host')).toMatchObject({ reason: 'protocol', liveSessions: 3 });
    void main.restartSupervisor({ stopSessions: false }); // the banner's Restart now
    await until(() => main.snapshot('engine-host').state === 'ready', 6_000, 'main to be welcomed');
    expect(scene.engines).toHaveLength(2);
    expect(main.welcome('engine-host')?.pid).toBe(scene.lastEngine().pid);
  });
});

describe('requests and events pass raw', () => {
  it('an output and an event with keys no registry names reach the app as received', async () => {
    scene.engineSpawn = { answers: { 'probe.newer': (input) => ({ echoed: input, extra: { deep: [1, 2] } }) } };
    await scene.start();
    const app = await scene.app();
    const answer = await app.request('probe.newer', { unknownKey: true });
    expect(answer).toMatchObject({ ok: true, value: { echoed: { unknownKey: true }, extra: { deep: [1, 2] } } });
    app.ready();
    const engine = scene.lastEngine();
    await until(() => engine.emitRaw('probe.event', { newer: 'field', n: 1 }), 3_000, 'a ready link');
    await until(() => app.events().length === 1);
    expect(app.events()).toEqual([{ newer: 'field', n: 1 }]);
  });
});

describe('the interceptions', () => {
  it('host.interest: the union across two attachments, a remote viewer and a recycle goes upstream', async () => {
    const daemon = await scene.start();
    const first = await scene.app();
    await first.request('host.interest', { sessions: ['a', 'b'] });
    const engine = scene.lastEngine();
    expect(engine.named('host.interest').at(-1)).toEqual({ sessions: ['a', 'b'] });
    daemon.services.interest.report('viewer-1', ['z' as AppSessionId]);
    await until(() => JSON.stringify(engine.named('host.interest').at(-1)) === JSON.stringify({ sessions: ['a', 'b', 'z'] }));
    first.leave();
    await until(() => JSON.stringify(engine.named('host.interest').at(-1)) === JSON.stringify({ sessions: ['z'] }), 5_000, 'the departure’s union');
    const second = await scene.app();
    await second.request('host.interest', { sessions: ['c'] });
    expect(engine.named('host.interest').at(-1)).toEqual({ sessions: ['c', 'z'] });
    // each recycled link starts with the union (an attach recycles)
    expect(engine.supervisor.connections.length).toBeGreaterThanOrEqual(4);
  });

  it('host.stopAll parks the engine host (nothing respawns), and the next attach wakes a fresh one', async () => {
    let stopped: StandIn | null = null;
    scene.engineSpawn = {
      answers: {
        'host.stopAll': () => {
          stopped = scene.lastEngine();
          setTimeout(() => void stopped!.supervisor.die(), 10); // it exits once every session is stopped
          return { stopped: 0 };
        },
      },
    };
    const daemon = await scene.start();
    const app = await scene.app();
    expect(await app.request('host.stopAll')).toMatchObject({ ok: true });
    await until(() => daemon.hosts.parked('engine-host'), 3_000, 'the park');
    await until(() => app.closed, 3_000, 'the app’s connection to close');
    await sleep(200);
    expect(scene.spawn).toHaveBeenCalledOnce();
    const next = await scene.app();
    expect(scene.spawn).toHaveBeenCalledTimes(2);
    expect(next.first).toMatchObject({ t: 'welcome', pid: scene.lastEngine().pid });
    expect(next.first!.pid).not.toBe(stopped!.pid);
  });

  it('host.configure sets the park clock: with no app and no interest the engine host is asked to exit when idle after it', async () => {
    const daemon = await scene.start();
    const app = await scene.app();
    await app.request('host.configure', { idleExitMs: 200 });
    const engine = scene.lastEngine();
    expect(engine.named('host.configure')).toEqual([{ idleExitMs: 200 }]); // forwarded
    app.leave();
    await until(() => engine.supervisor.exits.includes('idle'), 3_000, 'exit idle');
    expect(daemon.hosts.parked('engine-host')).toBe(false); // armed only: the host decides when it is idle
    const back = await scene.app(); // an attach disarms it
    expect(back.welcomed()).toBe(true);
    await until(() => engine.named('host.exitWhenIdle').some((input) => JSON.stringify(input) === JSON.stringify({ armed: false })), 3_000, 'the disarm');
  });

  it('a refuse replaced from the upstream (an embedded app took the engine host) ends mawsd with exit 0', async () => {
    await scene.start();
    const app = await scene.app();
    const engine = scene.lastEngine();
    const embedded = await scene.app('engine-host', { token: engine.supervisor.token }).catch(() => null); // mawsd's socket: refused
    expect(embedded?.welcomed() ?? false).toBe(false);
    const taker = await RawApp.connect(scene.profile.socketPath, engine.supervisor.token);
    scene.apps.push(taker);
    expect(taker.welcomed()).toBe(true);
    await until(() => scene.exits.includes(0), 5_000, 'mawsd’s exit');
    expect(scene.logs.some((line) => line.includes('the engine-host was taken by another client'))).toBe(true);
    await until(() => app.closed);
  });

  // M5 review: a quit's departure recycle must not override a deliberate exit
  for (const asked of ['host.stopAll', 'exit now'] as const) {
    it(`${asked} then the app's draining close at once: one spawn, and the host parks (the departure does not reconnect it)`, async () => {
      const exitLater = (self: FakeSupervisor) => void setTimeout(() => void self.die(), 100);
      scene.engineSpawn = { onExitNow: exitLater, answers: { 'host.stopAll': () => (exitLater(scene.lastEngine().supervisor), { stopped: 0 }) } };
      const daemon = await scene.start();
      const app = await scene.app();
      app.ready();
      if (asked === 'host.stopAll') expect(await app.request('host.stopAll')).toMatchObject({ ok: true });
      else {
        await app.request('engine.ping'); // the attach's recycle is over
        app.exit('now');
        await until(() => scene.lastEngine().supervisor.exits.includes('now'));
      }
      app.leave(); // main's quit right after
      await until(() => daemon.hosts.parked('engine-host'), 3_000, 'the park');
      await sleep(300);
      expect(scene.spawn).toHaveBeenCalledOnce();
      expect(daemon.hosts.parked('engine-host')).toBe(true);
    });
  }

  it('host.exitWhenIdle is tracked on the link that answers it: armed, the host’s idle exit parks it; disarmed, its exit is a crash', async () => {
    const daemon = await scene.start();
    const app = await scene.app();
    expect(await app.request('host.exitWhenIdle', { armed: true })).toMatchObject({ ok: true }); // sent just after the attach
    const first = scene.lastEngine();
    expect(first.named('host.exitWhenIdle')).toEqual([{ armed: true }]);
    app.leave(); // the departure's recycle keeps the arming (per process)
    await until(() => app.closed);
    await until(() => daemon.hosts.snapshot('engine-host').state === 'ready', 3_000, 'the fresh link');
    await first.supervisor.die(); // it exits once idle
    await until(() => daemon.hosts.parked('engine-host'), 3_000, 'the park');
    await sleep(200);
    expect(scene.spawn).toHaveBeenCalledOnce();

    const back = await scene.app(); // wakes a fresh one
    expect(scene.spawn).toHaveBeenCalledTimes(2);
    await back.request('host.exitWhenIdle', { armed: true });
    await back.request('host.exitWhenIdle', { armed: false });
    await scene.lastEngine().supervisor.die({ keepLock: true }); // a crash now
    await until(() => scene.spawn.mock.calls.length === 3, 3_000, 'the crash ladder’s relaunch');
    expect(daemon.hosts.parked('engine-host')).toBe(false);
  });

  it('exit idle from the app is ignored; exit now makes the engine host exit and park', async () => {
    const daemon = await scene.start();
    const app = await scene.app();
    const engine = scene.lastEngine();
    app.exit('idle');
    await sleep(100);
    expect(engine.supervisor.exits).toEqual([]);
    app.exit('now');
    await until(() => engine.supervisor.exits.includes('now'));
    await until(() => daemon.hosts.parked('engine-host'), 3_000, 'the park');
    await sleep(200);
    expect(scene.spawn).toHaveBeenCalledOnce();
  });
});

describe('the ready line, the recycle and the burst', () => {
  it('no event before the app’s ready, the burst after it; an event between attachments reaches the next app in its burst', async () => {
    await scene.start();
    const first = await scene.app();
    const engine = scene.lastEngine();
    const linksAtWelcome = engine.supervisor.connections.length;
    await until(() => engine.supervisor.connections.length > linksAtWelcome || linksAtWelcome >= 2, 3_000, 'the recycle at attach');
    await sleep(100);
    expect(engine.send({ n: 1 })).toBe(false); // the recycled link has not said ready: held for the burst
    await sleep(50);
    expect(first.events()).toEqual([]);
    first.ready();
    await until(() => first.events().length === 1, 3_000, 'the burst');
    expect(first.events()).toEqual([{ n: 1 }]);
    expect(engine.send({ n: 2 })).toBe(true);
    await until(() => first.events().length === 2);
    const linksBefore = engine.supervisor.connections.length;
    first.leave();
    await until(() => first.closed, 3_000, 'the departure');
    await until(() => engine.supervisor.connections.length > linksBefore, 3_000, 'the recycle at departure');
    await sleep(100);
    expect(engine.send({ n: 3 })).toBe(false); // between attachments: held
    const second = await scene.app();
    second.ready();
    await until(() => second.events().length === 1, 3_000, 'the second burst');
    expect(second.events()).toEqual([{ n: 3 }]);
    expect(first.events()).toEqual([{ n: 1 }, { n: 2 }]);
  });
});

describe('the departure drains both hops', () => {
  // Main leaves with its real draining close (the host supervisor's stop); an event the engine host writes as mawsd
  // takes the departure (before it sees mawsd's end) reaches the departing app, one written after reaches the next app.
  // `stall`: the upstream writes the in-flight event `emitMs` after the departure and closes its side at `closeMs` (by
  // default it writes it at once, as mawsd takes the departure, and closes at mawsd's end).
  async function departure(halfOpen: boolean, stall: { emitMs: number; closeMs: number } | null = null) {
    const daemon = await scene.start({ halfOpen });
    const main = scene.appHosts();
    const departing: unknown[] = [];
    main.onRaw('engine-host', (message) => void departing.push(message.payload));
    await main.start();
    const engine = scene.lastEngine();
    await until(() => engine.emitRaw('probe.event', { n: 0 }), 3_000, 'main ready');
    await until(() => departing.length === 1);
    daemon.services.onAttachment((attached) => {
      if (attached) return;
      if (!stall) return void engine.send({ n: 1 }); // written before the upstream sees mawsd's end
      // The host is still writing as mawsd's end arrives: its side stays open past that end (half-open), and it closes
      // only at `closeMs`, as a host busy writing would.
      const link = engine.supervisor.connections.at(-1)!;
      link.allowHalfOpen = true;
      setTimeout(() => void engine.send({ n: 1 }), stall.emitMs);
      setTimeout(() => void link.end(), stall.closeMs);
    });
    const began = Date.now();
    await main.stop(); // its real draining close, ended when mawsd ends the app's side
    const appSideEndedMs = Date.now() - began;
    await until(() => daemon.hosts.snapshot('engine-host').state === 'ready', 5_000, 'the fresh link');
    await sleep(150);
    engine.send({ n: 2 }); // after: held for the next app
    const second = await scene.app();
    second.ready();
    await until(() => second.events().length >= 1, 3_000, 'the next burst');
    await sleep(100);
    return { departing, next: second.events(), appSideEndedMs };
  }

  it('a half-open relay: the event in flight reaches the departing app, the next one the next app, neither lost nor doubled', async () => {
    const { departing, next } = await departure(true);
    expect(departing).toEqual([{ n: 0 }, { n: 1 }]);
    expect(next).toEqual([{ n: 2 }]);
  });

  it('the same scene with a relay that is not half-open loses the event in flight (the test discriminates)', async () => {
    const { departing, next } = await departure(false);
    expect(departing).toEqual([{ n: 0 }]);
    expect(next).toEqual([{ n: 2 }]);
  });

  it('an event the upstream writes later but inside the 500 ms bound still reaches the departing app', async () => {
    const { departing, next, appSideEndedMs } = await departure(true, { emitMs: 200, closeMs: 250 });
    expect(departing).toEqual([{ n: 0 }, { n: 1 }]);
    expect(next).toEqual([{ n: 2 }]);
    expect(appSideEndedMs).toBeGreaterThanOrEqual(200); // the app's side stayed open for it
  });

  it('a stalled upstream: the bound ends the app’s side at 500 ms, inside main’s 1 s grace, and what comes after is counted lost', async () => {
    const { departing, next, appSideEndedMs } = await departure(true, { emitMs: 700, closeMs: 800 });
    expect(appSideEndedMs).toBeGreaterThanOrEqual(450);
    expect(appSideEndedMs).toBeLessThan(950); // mawsd's bound, not main's grace, ended it
    expect(departing).toEqual([{ n: 0 }]);
    expect(next).toEqual([{ n: 2 }]); // the host counted n 1 delivered: a consumer's death would lose it too
    await until(() => scene.logs.some((line) => line.includes('1 events the engine-host wrote before it saw the app\'s end came after its side ended and were lost')), 3_000, 'the lost count');
  });
});

describe('document channels', () => {
  it('relay both ways on the app’s channel numbers; an app’s documents.open at 2^31 is closed with reason host', async () => {
    await scene.start();
    const app = await scene.app();
    app.post({ t: 'documents.open', channel: 1, artifactId: ARTIFACT, actor: ACTOR });
    const engine = scene.lastEngine();
    await until(() => engine.docs.length === 1, 3_000, 'the channel upstream');
    expect(engine.docs[0]!.message).toMatchObject({ artifactId: ARTIFACT, actor: ACTOR });
    app.port!.postDoc(1, Uint8Array.of(1, 2, 3));
    await until(() => app.frames.length === 1, 3_000, 'the echo');
    expect(engine.docs[0]!.frames).toEqual([Uint8Array.of(1, 2, 3)]);
    expect(app.frames).toEqual([{ channel: 1, bytes: Uint8Array.of(1, 2, 3, 0xff) }]);
    app.post({ t: 'documents.open', channel: 2 ** 31, artifactId: ARTIFACT, actor: ACTOR });
    await until(() => app.messages.some((message) => message.t === 'documents.closed'), 3_000, 'the close');
    expect(app.messages.filter((message) => message.t === 'documents.closed')).toEqual([{ t: 'documents.closed', channel: 2 ** 31, reason: 'host' }]);
    expect(engine.docs).toHaveLength(1);
    app.post({ t: 'documents.close', channel: 1 });
    await until(() => engine.docs[0]!.closed, 3_000, 'the app’s close upstream');
  });
});

// P5 O3-D M2 (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §A and §B): the seam and the front in the
// daemon, over a stand-in of the services chunk (the real spine inside the seam is daemon-spine.test.ts's)
describe('the spine (P5 O3-D M2)', () => {
  // The services chunk as the seam loads it: the real lock, data and a root that registers one command
  function standInChunk() {
    const loads = vi.fn();
    const stops = vi.fn();
    const load = async (): Promise<SpineEntry> => {
      loads();
      return {
        takeSpineLock,
        openSpineData: async (_profile, { lock }) => ({ lock: lock!, refused: lock!.refused, machineSettings: null as never, paths: { client: '', machine: '' } }),
        startSpine: (deps) => {
          deps.bus.register('session.launchMode', () => ({ mode: 'index' }));
          return { view: { engineStatuses: () => [], on: () => () => {} } as never, settled: async () => {}, busy: () => false, stop: stops };
        },
      };
    };
    return { load, loads, stops };
  }

  it('loads the services chunk only at the first spine command, answers it on machine.sock, and daemon.status carries the spine', async () => {
    const chunk = standInChunk();
    await scene.start({ spine: { load: chunk.load } });
    const client = await scene.app('machine');
    expect(await client.request('machine.identity')).toMatchObject({ ok: true, value: { ref: expect.any(String), project: expect.any(Object) } });
    expect(await client.request('daemon.status')).toMatchObject({ ok: true, value: { spine: { state: 'cold', refused: null, loadedAt: null, heldDropped: 0 } } });
    expect(chunk.loads).not.toHaveBeenCalled();
    expect(await client.request('session.launchMode')).toMatchObject({ ok: true, value: { mode: 'index' } });
    expect(chunk.loads).toHaveBeenCalledOnce();
    expect(await client.request('daemon.status')).toMatchObject({ ok: true, value: { spine: { state: 'loaded', loadedAt: expect.any(String) } } });
    expect(scene.logs).toContainEqual(expect.stringMatching(/^spine: loaded in \d+ ms$/));
  });

  it('a unit daemon releases after the quiet period and exits 75; a private one releases and stays', async () => {
    for (const kind of ['unit', 'private'] as const) {
      const chunk = standInChunk();
      const daemon = await scene.start({ kind, spine: { load: chunk.load }, env: { MAWS_USER_DATA: scene.root, MAWS_SPINE_QUIET_MS: '50' } });
      const client = await scene.app('machine');
      expect(await client.request('session.launchMode')).toMatchObject({ ok: true });
      client.destroy();
      await until(() => scene.logs.includes('spine: released'), 5_000, 'the release');
      expect(chunk.stops).toHaveBeenCalledOnce();
      if (kind === 'unit') {
        await until(() => scene.exits.includes(75), 5_000, 'the re-execution');
        expect(scene.logs).toContainEqual('exited (spine released, code 75)');
      } else {
        await sleep(50);
        expect(scene.exits).toEqual([75]); // the unit's, nothing more
        expect((await daemon.status()).spine).toMatchObject({ state: 'cold' });
        await daemon.stop('test');
      }
      scene.logs.length = 0;
    }
  });
});
