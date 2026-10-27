// `mawsd` (P5 O2 M5; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M5's Proves): the daemon in this process over a
// temp profile, its upstream hosts stood in for by the real socket layer and runtime on real Unix sockets, spawned
// through a fake spawn (test/support/mawsd-scene.ts). Its start and files, the handshake's reflection, raw forwarding,
// the interceptions, the ready line and the recycle, the departure's drain, and the document channels.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { SOCKET_PROTOCOL } from '@shared/host/socket-protocol';
import type { AppSessionId } from '@shared/graph/ids';
import { readOrMintMachineRef } from '@shared/machine/identity-file';
import { buildIdOf } from '../engine-host/supervisor-files';
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
  async function departure(halfOpen: boolean): Promise<{ departing: unknown[]; next: unknown[] }> {
    const daemon = await scene.start({ halfOpen });
    const main = scene.appHosts();
    const departing: unknown[] = [];
    main.onRaw('engine-host', (message) => void departing.push(message.payload));
    await main.start();
    const engine = scene.lastEngine();
    await until(() => engine.emitRaw('probe.event', { n: 0 }), 3_000, 'main ready');
    await until(() => departing.length === 1);
    daemon.services.onAttachment((attached) => {
      if (!attached) engine.send({ n: 1 }); // written before the upstream sees mawsd's end
    });
    const drained = main.stop();
    await drained;
    await until(() => daemon.hosts.snapshot('engine-host').state === 'ready', 3_000, 'the fresh link');
    await sleep(150);
    engine.send({ n: 2 }); // after: held for the next app
    const second = await scene.app();
    second.ready();
    await until(() => second.events().length >= 1, 3_000, 'the next burst');
    await sleep(100);
    return { departing, next: second.events() };
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
