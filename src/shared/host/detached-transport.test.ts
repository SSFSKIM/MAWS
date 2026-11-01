import { EventEmitter } from 'node:events';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import type { SpawnOptions } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureConsole } from '../../../test/support/console-capture';
import { connectLines } from '../../../test/support/socket-lines';
import { fakeProfile, FakeProcesses, FakeSupervisor, type FakeProfile, type FakeSupervisorOptions } from '../../../test/support/fake-supervisor';
import { ATTACHMENT_CAPABILITY, PTY_FRAMES_CAPABILITY, SOCKET_PROTOCOL } from '@shared/host/socket-protocol';
import type { HostState } from '@shared/ipc/schema';
import { WIRE_MINOR } from '@shared/ipc/wire';
import { wireFingerprint } from '@shared/ipc/wire-fingerprint';
import { SocketPort } from '@shared/host/socket-port';
import { buildIdOf, SUPERVISOR_FILES } from '../../engine-host/supervisor-files';
import { engineHostSettled } from '../../services/sessions/service-register';
import { supervisorEnv, type DetachedTransportOptions } from './detached-transport';
import { appIdentity } from './identity';

// engineHostSettled's module reaches main's router, which imports electron; the supervisor itself no longer does (P5 O2 M3).
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/nonexistent' }, utilityProcess: {}, MessageChannelMain: class {} }));

import { createHostSupervisor, type HostDispatch, type HostOwner, type HostSupervisor, type HostSpec } from './host-supervisor';

// Short clocks: the state table is the same, the waits are not.
// P5 O16 M3b: `exitWaitMs`, how long an idle-armed host's pid may outlive its closed socket (#413), short enough that a
// quiet close of one still reconnects within a test's wait
const TIMING = { connectTimeoutMs: 200, helloTimeoutMs: 150, startTimeoutMs: 1_200, pidPollMs: 20, waitRetryMs: 80, killGraceMs: 60, exitWaitMs: 600 };
// P5 O16 M3b: an engine host from before the handover (no `host.holder`), which main serves and asks to exit when idle
const BEFORE_HOLDER = { capabilities: [PTY_FRAMES_CAPABILITY, ATTACHMENT_CAPABILITY] };
const BACKOFF = [30, 60, 90] as const;

// P5 O16 M3c fix wave 2: an engine host's status as it pushes it (host.supervisorStatus), for a fake to emit
const supervisorStatus = (pid: number, over: Record<string, unknown> = {}) => ({ mode: 'detached', pid, startedAt: 't', buildId: 'b', protocol: SOCKET_PROTOCOL, wire: 'w', liveSessions: 1, rows: 1, idleExitMs: 600_000, idleExitAt: null, exitWhenIdle: false, socketPath: null, logPath: null, orphansKilled: 0, ...over });
const holding = (pid: number, inFlight: number | undefined, tool?: string) => ({ ...supervisorStatus(pid), holder: { hosts: 1, adopted: 0, failed: 0, gate: null, handover: 'none', ...(inFlight !== undefined && { inFlight }), ...(tool !== undefined && { tool }) } });
const until = (check: () => boolean, timeout = 3_000) => vi.waitFor(() => expect(check()).toBe(true), { timeout, interval: 5 });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeCandidate extends EventEmitter {
  unref = vi.fn();
  constructor(
    readonly pid: number | undefined,
    readonly args: string[],
    readonly options: SpawnOptions,
    private readonly processes: FakeProcesses,
  ) {
    super();
  }
  exit(code: number | null, signal: NodeJS.Signals | null = null) {
    if (this.pid !== undefined) this.processes.alive.delete(this.pid);
    queueMicrotask(() => this.emit('exit', code, signal));
  }
}

let profile: FakeProfile;
let processes: FakeProcesses;
let fakes: FakeSupervisor[];
let candidates: FakeCandidate[];
let onSpawn: (candidate: FakeCandidate) => void;
let spawn: ReturnType<typeof vi.fn<(command: string, args: string[], options: SpawnOptions) => FakeCandidate>>;
let emit: ReturnType<typeof vi.fn<(name: string, payload: unknown) => boolean>>;
let logs: string[];
let errors: ReturnType<typeof vi.spyOn>;
let supervisor: HostSupervisor;
let states: HostState[];
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  profile = fakeProfile();
  processes = new FakeProcesses();
  fakes = [];
  candidates = [];
  logs = [];
  states = [];
  env = { HOME: '/home/owner', MAWS_HOST_MODE: 'detached', NODE_OPTIONS: '--inspect', MAWS_E2E: '1', MAWS_RELAY_URL: 'http://127.0.0.1:18641' };
  // By default a candidate starts a supervisor that serves, as the detached entry does.
  onSpawn = (candidate) => void startFake({ pid: candidate.pid! });
  spawn = vi.fn((_command: string, args: string[], options: SpawnOptions) => {
    const candidate = new FakeCandidate(processes.newPid(), args, options, processes);
    candidates.push(candidate);
    queueMicrotask(() => onSpawn(candidate));
    return candidate;
  });
  emit = vi.fn<(name: string, payload: unknown) => boolean>(() => true);
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  supervisor = makeSupervisor();
});

afterEach(async () => {
  supervisor.stop();
  for (const fake of fakes) await fake.die();
  errors.mockRestore();
  profile.dispose();
});

function makeSupervisor(packaged = false, timing: Partial<typeof TIMING> = {}, extra: Partial<DetachedTransportOptions> = {}, spec: Partial<HostSpec> = {} /* P5 O16 M3b */): HostSupervisor {
  const made = createHostSupervisor({
    hosts: { 'engine-host': { modulePath: profile.modulePath, serviceName: 'maws-engine-host', transport: 'detached', ...spec } } as Record<HostOwner, HostSpec>,
    emit,
    restartBackoffMs: BACKOFF,
    userData: () => profile.userData, // P5 O2 M3: the core's own, which the transport options below override
    packaged: () => packaged,
    detached: {
      userData: () => profile.userData,
      packaged: () => packaged,
      env: () => env,
      spawn: spawn as never,
      ...processes.deps,
      timing: { ...TIMING, ...timing },
      log: (line) => void logs.push(line),
      ...extra,
    },
  });
  made.onState('engine-host', (state) => void states.push(state));
  return made;
}

async function startFake(options: Partial<FakeSupervisorOptions> = {}): Promise<FakeSupervisor> {
  const fake = new FakeSupervisor(profile, processes, { pid: options.pid ?? processes.newPid(), ...options });
  fakes.push(fake);
  return fake.start();
}

// A supervisor whose host.stopAll answers, then exits as the real one does (the answer first, then the exit order).
async function startStoppable(options: Partial<FakeSupervisorOptions> = {}) {
  const asked: number[] = [];
  const self: FakeSupervisor = await startFake({
    ...options,
    register: (on) => {
      on('host.stopAll', async ({ graceMs }) => {
        asked.push(graceMs);
        setImmediate(() => void self.die());
        return { stopped: 1, forced: 0 };
      });
    },
  });
  return { fake: self, asked };
}

const state = () => supervisor.snapshot('engine-host');
const ping = () => supervisor.dispatch('engine-host', 'engine.ping', undefined);
const stateNames = () => states.map((s) => s.state);

describe('the detached transport: connecting', () => {
  it('connects to a running supervisor, serves requests, and relays its events after the ready line', async () => {
    const fake = await startFake();
    await supervisor.start();
    expect(state()).toMatchObject({ state: 'ready', pid: fake.pid, restarts: 0 });
    expect(spawn).not.toHaveBeenCalled();
    await expect(ping()).resolves.toEqual({ ok: true, value: { pid: fake.pid, uptimeMs: 1, hostVersion: 'fake' } });
    await until(() => fake.emit('session.brokerItems', { appSessionId: 'app-1', items: [] } as never));
    await until(() => emit.mock.calls.some(([name]) => name === 'session.brokerItems'));
  });

  it('runs the resync between the welcome and the ready line, with dispatch working and no event delivered', async () => {
    const fake = await startFake();
    let release!: () => void;
    const seen: unknown[] = [];
    supervisor.setResync('engine-host', async (dispatch) => {
      seen.push(await dispatch('engine-host', 'engine.ping', undefined));
      seen.push(fake.emit('session.brokerItems', { appSessionId: 'app-1', items: [] } as never)); // not ready yet: dropped
      await new Promise<void>((resolve) => (release = resolve));
    });
    await supervisor.start();
    await until(() => seen.length === 2);
    expect(seen).toEqual([{ ok: true, value: expect.objectContaining({ pid: fake.pid }) }, false]);
    await sleep(30);
    expect(fake.emit('session.brokerItems', { appSessionId: 'app-1', items: [] } as never)).toBe(false);
    release();
    await until(() => fake.emit('session.brokerItems', { appSessionId: 'app-1', items: [] } as never));
  });

  // E10 (Decision Log, onStreaming): the streaming listeners run once per connection, after the ready line
  it('fires onStreaming after the ready line, again after a reconnect; a close mid-resync cancels it and carries none of its requests over', async () => {
    // the listener's command is answered by an event, as fs.scan's discoveries are
    const fake = await startFake({
      register: (on, hostEmit) =>
        on('engine.sessions', async () => {
          hostEmit('session.brokerItems', { appSessionId: 'app-1', items: [] } as never);
          return [];
        }),
    });
    let signals: AbortSignal[] = [];
    const releases: (() => void)[] = [];
    let resyncDispatch: HostDispatch | null = null;
    supervisor.setResync('engine-host', (dispatch, signal) => {
      resyncDispatch = dispatch;
      signals = [...signals, signal];
      return new Promise<void>((resolve) => void releases.push(resolve));
    });
    const streamed = vi.fn(() => void supervisor.dispatch('engine-host', 'engine.sessions', undefined));
    supervisor.onStreaming('engine-host', streamed);
    const heard = () => emit.mock.calls.filter(([name]) => name === 'session.brokerItems').length;
    await supervisor.start();
    await until(() => signals.length === 1);
    fake.dropClient(); // the connection closes mid-resync, the supervisor lives on
    await until(() => signals[0]!.aborted);
    expect(signals[0]!.reason).toBe('transition');
    const late = resyncDispatch!('engine-host', 'engine.ping', undefined);
    await expect(late).resolves.toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    await until(() => signals.length === 2); // reconnected: a resync of its own
    releases[0]!(); // the cancelled one settles late: nothing is said for it
    await sleep(30);
    expect(streamed).not.toHaveBeenCalled();
    expect(fake.emit('session.brokerItems', { appSessionId: 'app-1', items: [] } as never)).toBe(false);
    releases[1]!();
    await until(() => heard() === 1); // the listener's command went after the ready line: its event reaches main
    expect(streamed).toHaveBeenCalledOnce();
  });

  it('starts a supervisor when none is running: the spawn as specified', async () => {
    await supervisor.start();
    expect(spawn).toHaveBeenCalledOnce();
    const [command, args, options] = spawn.mock.calls[0];
    expect(command).toBe(process.execPath);
    expect(args).toEqual(['--disable-sigusr1', profile.modulePath, '--detached', profile.dir]); // no inspector on SIGUSR1, from exec on
    expect(options).toMatchObject({ detached: true, cwd: process.cwd(), argv0: 'maws-supervisor' });
    const stdio = options.stdio as unknown[];
    expect(stdio[0]).toBe('ignore');
    expect(typeof stdio[1]).toBe('number');
    expect(stdio[2]).toBe(stdio[1]);
    expect(options.env).toEqual({ HOME: '/home/owner', MAWS_E2E: '1', MAWS_RELAY_URL: 'http://127.0.0.1:18641', ELECTRON_RUN_AS_NODE: '1', MAWS_USER_DATA: profile.userData });
    expect(candidates[0].unref).toHaveBeenCalledOnce();
    expect(statSync(profile.dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(profile.dir, 'host.log')).mode & 0o777).toBe(0o600);
    expect(state()).toMatchObject({ state: 'ready', pid: candidates[0].pid });
  });

  it('builds the environment at the spawn, after main set it, and drops the dev relay when packaged', async () => {
    supervisor.stop();
    supervisor = makeSupervisor(true);
    env = { ...env, MAWS_E2E_ENGINE_BIN: '/bin/fake' }; // changed after the supervisor was made
    await supervisor.start();
    expect(spawn.mock.calls[0][2].env).toMatchObject({ MAWS_E2E_ENGINE_BIN: '/bin/fake' });
    expect(spawn.mock.calls[0][2].env).not.toHaveProperty('MAWS_RELAY_URL');
    expect(supervisorEnv({ A: '1', NODE_OPTIONS: 'x', MAWS_HOST_MODE: 'detached' }, { userData: '/u', packaged: false })).toEqual({ A: '1', ELECTRON_RUN_AS_NODE: '1', MAWS_USER_DATA: '/u' });
  });

  it('connects to the holder when its candidate exits 3 (another supervisor took the lock)', async () => {
    let other: FakeSupervisor | null = null;
    onSpawn = (candidate) => {
      void startFake().then((fake) => {
        other = fake;
        candidate.exit(3);
      });
    };
    await supervisor.start();
    expect(spawn).toHaveBeenCalledOnce();
    expect(state()).toMatchObject({ state: 'ready', pid: other!.pid });
  });

  it('a live holder that never answers a connect leaves the host crashed (held_lock) at the budget, spawning nothing', async () => {
    const holder = processes.newPid();
    await startFake({ pid: holder }).then((fake) => fake.die({ keepLock: true }));
    processes.alive.set(holder, `start-${holder}`); // its socket is gone, its pid lives on
    const started = Date.now();
    await supervisor.start();
    expect(Date.now() - started).toBeGreaterThanOrEqual(TIMING.startTimeoutMs - 50);
    expect(state()).toMatchObject({ state: 'crashed' });
    expect(spawn).not.toHaveBeenCalled();
    expect(errors.mock.calls.flat().join(' ')).toContain(`a supervisor (pid ${holder}) holds the lock and does not answer`);
  });

  // P5 O16 M3c fix wave 2 (D63; concern 1): a relay holds the app's hello while its engine host hands over, and reports it
  // (`waitingOn`, main's daemon shape): the start budget holds, both ways main used to fail, and a report that ends falls
  // back to today's bound
  it('a lock holder that holds the hello while a handover is reported fails nothing; once the report ends, today’s bound applies', async () => {
    let waiting = true;
    supervisor.stop();
    supervisor = makeSupervisor(false, {}, { waitingOn: () => waiting });
    const relay = await startFake({ answer: 'silent' });
    void supervisor.start();
    await sleep(TIMING.startTimeoutMs * 2);
    expect(state().state).not.toBe('crashed');
    expect(relay.connections.length).toBeGreaterThanOrEqual(2); // retried every pidPollMs meanwhile
    expect(spawn).not.toHaveBeenCalled();
    expect(processes.kills).toEqual([]);
    const ended = Date.now();
    waiting = false;
    await until(() => state().state === 'crashed', TIMING.startTimeoutMs * 3);
    // a whole budget from the last retry that saw the report (one hello's wait and a poll before its end, at most)
    expect(Date.now() - ended).toBeGreaterThanOrEqual(TIMING.startTimeoutMs - TIMING.helloTimeoutMs - 2 * TIMING.pidPollMs - 50);
    expect(supervisor.facts('engine-host').reason).toBe('held_lock');
  });

  it('a candidate it started that holds the hello while a handover is reported is never stopped; once the report ends, it is', async () => {
    let waiting = true;
    supervisor.stop();
    supervisor = makeSupervisor(false, {}, { waitingOn: () => waiting });
    onSpawn = (candidate) => void startFake({ pid: candidate.pid!, answer: 'silent' }); // `mawsd`, holding the hello
    void supervisor.start();
    await sleep(TIMING.startTimeoutMs * 2);
    expect(state().state).not.toBe('crashed');
    expect(processes.kills).toEqual([]);
    expect(spawn).toHaveBeenCalledOnce();
    waiting = false;
    await until(() => state().state === 'crashed', TIMING.startTimeoutMs * 3);
    expect(processes.kills[0]).toEqual([candidates[0].pid, 'SIGTERM']);
  });

  it('a candidate alive and never answering is stopped (SIGTERM, then SIGKILL) and the host left crashed (held_lock)', async () => {
    onSpawn = () => {}; // it never listens
    processes.onKill = () => {}; // and ignores SIGTERM
    await supervisor.start();
    expect(state()).toMatchObject({ state: 'crashed' });
    const pid = candidates[0].pid!;
    expect(processes.kills).toEqual([[pid, 'SIGTERM']]);
    await until(() => processes.kills.length === 2);
    expect(processes.kills[1]).toEqual([pid, 'SIGKILL']);
    expect(errors.mock.calls.flat().join(' ')).toContain(`the supervisor it started (pid ${pid}) never answered`);
  });

  it('a hello unanswered while the lock’s pid lives is retried, and crashed at the budget', async () => {
    const silent = await startFake({ answer: 'silent' });
    await supervisor.start();
    expect(silent.connections.length).toBeGreaterThanOrEqual(2);
    expect(state()).toMatchObject({ state: 'crashed' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('a hello unanswered with the lock’s pid dead spawns a fresh supervisor', async () => {
    const silent = await startFake({ answer: 'silent' });
    processes.alive.delete(silent.pid); // the socket answers connects; the process named by the lock is gone
    await supervisor.start();
    expect(spawn).toHaveBeenCalledOnce(); // the candidate's polls may meet the silent socket until it listens there
    expect(state()).toMatchObject({ state: 'ready', pid: candidates[0].pid });
  });

  it('holds a request dispatched while starting and answers it after the welcome', async () => {
    onSpawn = (candidate) => void sleep(100).then(() => startFake({ pid: candidate.pid! }));
    void supervisor.start();
    const reply = ping();
    expect(state().state).toBe('starting');
    const answer = await reply;
    expect(answer).toMatchObject({ ok: true, value: { pid: candidates[0].pid } });
  });

  it('re-reads the token once after a token refusal (a supervisor rotated it), and gives up on a second', async () => {
    const fake = await startFake();
    writeFileSync(join(profile.dir, 'host.token'), 'stale');
    let refusals = 0;
    const log = fake.logs.push.bind(fake.logs);
    fake.logs.push = (...lines: string[]) => {
      if (lines.some((line) => line.includes('wrong or missing token')) && ++refusals === 1) writeFileSync(join(profile.dir, 'host.token'), fake.token);
      return log(...lines);
    };
    await supervisor.start();
    expect(refusals).toBe(1);
    expect(state()).toMatchObject({ state: 'ready', pid: fake.pid });

    supervisor.stop();
    supervisor = makeSupervisor();
    fake.token = 'rotated-again';
    await supervisor.start();
    expect(state()).toMatchObject({ state: 'crashed' });
    expect(errors.mock.calls.flat().join(' ')).toContain('refused the token twice');
  });
});

describe('the detached transport: a served connection ends', () => {
  it('a close while the welcomed pid lives reconnects with no crash count and answers held requests', async () => {
    const fake = await startFake();
    await supervisor.start();
    fake.dropClient();
    await until(() => state().state === 'restarting');
    const reply = ping(); // held while restarting
    await until(() => state().state === 'ready');
    await expect(reply).resolves.toMatchObject({ ok: true, value: { pid: fake.pid } });
    expect(state()).toMatchObject({ state: 'ready', pid: fake.pid, restarts: 0 });
    expect(stateNames()).toEqual(['ready', 'restarting', 'ready']);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('a close after main asked the supervisor to exit spawns a fresh one only once the welcomed pid is dead', async () => {
    let gone = false;
    const fake = await startFake({
      onExitNow: (self) => {
        self.dropClient(); // the exit order closes the client while the process is still stopping its sessions
        void sleep(150).then(async () => {
          gone = true;
          await self.die();
        });
      },
    });
    let spawnedWhileAlive = false;
    onSpawn = (candidate) => {
      spawnedWhileAlive ||= !gone;
      void startFake({ pid: candidate.pid! });
    };
    await supervisor.start();
    expect(supervisor.exitSupervisor('now')).toBe(true);
    await until(() => state().state === 'restarting');
    await until(() => state().state === 'ready');
    expect(fake.exits).toEqual(['now']);
    expect(spawnedWhileAlive).toBe(false);
    expect(state()).toMatchObject({ pid: candidates[0].pid, restarts: 0 });
    expect(stateNames()).toEqual(['ready', 'restarting', 'ready']);
  });

  it('an armed exit-when-idle: a close while it lives is quiet, the close at its exit deliberate (no crash count)', async () => {
    const fake = await startFake();
    await supervisor.start();
    expect(supervisor.exitSupervisor('idle')).toBe(true);
    await until(() => fake.exits.length === 1);
    expect(fake.exits).toEqual(['idle']);
    fake.dropClient(); // a socket error: it lives on, armed
    await until(() => state().state === 'restarting');
    await until(() => state().state === 'ready');
    expect(state()).toMatchObject({ pid: fake.pid, restarts: 0 });
    await fake.die(); // the last live row is gone: it exits, as main asked on the earlier connection
    await until(() => state().state === 'ready' && state().pid !== fake.pid);
    expect(state()).toMatchObject({ pid: candidates[0].pid, restarts: 0 });
    expect(errors.mock.calls.flat().join(' ')).not.toContain('unexpectedly');
  });

  it('a close with the welcomed pid dead is a crash: counted, restarted after the backoff, the stale lock taken over', async () => {
    const fake = await startFake();
    await supervisor.start();
    await fake.die({ keepLock: true }); // kill -9: the lock and token stay behind
    await until(() => state().state === 'ready' && state().pid !== fake.pid);
    expect(state()).toMatchObject({ pid: candidates[0].pid, restarts: 1 });
    expect(stateNames()).toEqual(['ready', 'restarting', 'restarting', 'ready']);
    expect(errors.mock.calls.flat().join(' ')).toContain('unexpectedly');
  });

  it('`refuse replaced` leaves the host crashed with no respawn', async () => {
    const fake = await startFake();
    await supervisor.start();
    const other = await connectLines(profile.socketPath);
    other.send({ t: 'hello', protocol: SOCKET_PROTOCOL, token: fake.token, minor: WIRE_MINOR, build: buildIdOf(profile.modulePath), capabilities: [], appPid: 1 });
    await other.next((line) => (line as { t: string }).t === 'welcome');
    await until(() => state().state === 'crashed');
    await sleep(BACKOFF[2] + TIMING.pidPollMs * 5);
    expect(state().state).toBe('crashed');
    expect(spawn).not.toHaveBeenCalled();
    expect(fake.connections).toHaveLength(2);
    other.socket.destroy();
  });

  it('a `refuse replaced` with a field this build does not know is still a replacement, the field dropped and logged', async () => {
    const fake = await startFake();
    await supervisor.start();
    const refuse = { t: 'refuse', reason: 'replaced', protocol: SOCKET_PROTOCOL, buildId: 'newer', wire: wireFingerprint(), liveSessions: 0, newer: true };
    fake.connections.at(-1)!.end(`${JSON.stringify(refuse)}\n`); // as a replaced connection ends: the refusal, then the close
    await until(() => state().state === 'crashed');
    expect(spawn).not.toHaveBeenCalled();
    expect(logs).toContain('dropped newer from socket refuse, a field this build does not know (logged once per message and path)');
  });

  it('an exit the socket refuses to write is not remembered: the later death is a crash', async () => {
    const fake = await startFake();
    await supervisor.start();
    const write = vi.spyOn(SocketPort.prototype, 'postMessage').mockReturnValueOnce(false);
    expect(supervisor.exitSupervisor('idle')).toBe(false);
    write.mockRestore();
    await sleep(50);
    expect(fake.exits).toEqual([]);
    await fake.die();
    await until(() => state().state === 'ready' && state().pid !== fake.pid);
    expect(state()).toMatchObject({ pid: candidates[0].pid, restarts: 1 }); // counted: no exit was asked
  });

  it('stop() closes the socket without an exit, leaves the supervisor serving, and restarts nothing', async () => {
    const fake = await startFake();
    await supervisor.start();
    const pending = ping();
    supervisor.stop();
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    await until(() => !fake.connected());
    await sleep(BACKOFF[2] + TIMING.pidPollMs * 5);
    expect(fake.exits).toEqual([]);
    expect(processes.alive.has(fake.pid)).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
    expect(fake.connections).toHaveLength(1);
    await expect(ping()).resolves.toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    // it still serves: another client is welcomed
    const next = await connectLines(profile.socketPath);
    next.send({ t: 'hello', protocol: SOCKET_PROTOCOL, token: fake.token, minor: WIRE_MINOR, build: buildIdOf(profile.modulePath), capabilities: [], appPid: 2 });
    await expect(next.next()).resolves.toMatchObject({ t: 'welcome', pid: fake.pid });
    next.socket.destroy();
  });

  // E11 (tracker row E10 "keep-quit close counts in-flight lines delivered"): the deliberate close drains, so an event
  // the supervisor wrote (and counted delivered) before it saw main's end still reaches main's listeners
  it('stop() still reads the events the supervisor wrote before it saw the end', async () => {
    const fake = await startFake();
    await supervisor.start();
    const before = { appSessionId: 'app-before', items: [] } as never;
    await until(() => fake.emit('session.brokerItems', before)); // main's ready reached the supervisor
    supervisor.stop();
    const inFlight = { appSessionId: 'app-in-flight', items: [] } as never;
    expect(fake.emit('session.brokerItems', inFlight)).toBe(true); // written: main's end has not reached the supervisor
    await until(() => emit.mock.calls.some(([name, payload]) => name === 'session.brokerItems' && (payload as { appSessionId: string }).appSessionId === 'app-in-flight'));
    await until(() => !fake.connected());
    expect(fake.exits).toEqual([]);
  });

  // E11 (E10 keep-quit drain, W-A row 128 follow-up): main's shutdown waits on this before the process exits
  // Decision Log 28 (W-B review): nothing to drain answers nothing, so an ordinary quit keeps Electron's own path
  it('stop() answers once the drained connection has closed, and nothing when nothing is served', async () => {
    const fake = await startFake();
    await supervisor.start();
    await until(() => fake.emit('session.brokerItems', { appSessionId: 'app-before', items: [] } as never)); // main's ready reached it
    let closed = false;
    const stopping = supervisor.stop()!.then(() => (closed = true));
    expect(closed).toBe(false);
    expect(fake.emit('session.brokerItems', { appSessionId: 'app-in-flight', items: [] } as never)).toBe(true);
    await stopping;
    expect(emit.mock.calls.some(([name, payload]) => name === 'session.brokerItems' && (payload as { appSessionId: string }).appSessionId === 'app-in-flight')).toBe(true);
    expect(fake.connected()).toBe(false);
    expect(supervisor.stop()).toBeUndefined(); // stopped already
    const idle = makeSupervisor();
    expect(idle.stop()).toBeUndefined(); // never started: nothing to drain
  });
});

describe('the detached transport: a request held and never sent', () => {
  it('fails on stop()', async () => {
    onSpawn = () => {}; // the candidate never listens
    void supervisor.start();
    const reply = ping();
    await sleep(50);
    supervisor.stop();
    await expect(reply).resolves.toMatchObject({ ok: false, error: { code: 'host_unavailable', message: expect.stringContaining('was stopped') } });
  });

  it('fails when the host reaches crashed', async () => {
    onSpawn = (candidate) => candidate.exit(1);
    void supervisor.start();
    const reply = ping(); // held through two backoffs, failed at the third exit
    await expect(reply).resolves.toMatchObject({ ok: false, error: { code: 'host_unavailable', message: expect.stringContaining('is crashed') } });
    expect(spawn).toHaveBeenCalledTimes(3);
  });

  it('times out at 10 s when neither happens', async () => {
    supervisor.stop();
    supervisor = makeSupervisor(false, { startTimeoutMs: 60_000 });
    onSpawn = () => {}; // the candidate never listens, within a budget longer than the request's
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      void supervisor.start();
      const reply = ping();
      let settled = false;
      void reply.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(9_990);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(20);
      await expect(reply).resolves.toMatchObject({ ok: false, error: { code: 'timeout' } });
      expect(state().state).toBe('starting');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the detached transport: early exits and the crash ladder', () => {
  // P5 O16 M3c fix wave 1: a host whose last status said it was handing over (another client asked it: `mawsd restart
  // --engine-host`) leaves as planned, not as a crash: no crash count, no backoff, three of them within the window
  // P5 O16 M3c fix wave 2 (the re-review's item 6): planned only on the old host's word that its handover completed (every
  // row detached), which it says after the drain settled and before its exit; its intent alone (`draining`) is no evidence
  it('the close of a host whose last status said its handover detached every row is no crash: three within the window, uncounted', async () => {
    const draining = (pid: number) => ({ ...supervisorStatus(pid), holder: { hosts: 1, adopted: 0, failed: 0, gate: null, handover: 'draining', detached: true } });
    let host = await startFake();
    await supervisor.start();
    for (let round = 0; round < 3; round += 1) {
      const before = host.pid;
      await until(() => host.emit('host.supervisorStatus', draining(before) as never));
      await until(() => emit.mock.calls.some(([name, payload]) => name === 'host.supervisorStatus' && (payload as { pid: number }).pid === before));
      await host.die();
      await until(() => state().state === 'ready' && state().pid !== before);
      host = fakes.at(-1)!;
    }
    expect(state()).toMatchObject({ state: 'ready', restarts: 0 });
    expect(supervisor.facts('engine-host').lastExit).toBeNull();
    expect(errors.mock.calls.flat().join(' ')).not.toContain('unexpectedly');
    // a real crash still counts
    const crashed = host.pid;
    await host.die();
    await until(() => state().state === 'ready' && state().pid !== crashed);
    expect(state().restarts).toBe(1);
    expect(supervisor.facts('engine-host').lastExit).not.toBeNull();
  });

  it('a host killed mid-drain, after it said draining and before its rows detached, is a crash: counted, backed off, told', async () => {
    const host = await startFake();
    await supervisor.start();
    const pid = host.pid;
    await until(() => host.emit('host.supervisorStatus', { ...supervisorStatus(pid), holder: { hosts: 1, adopted: 0, failed: 0, gate: null, handover: 'draining', inFlight: 1, tool: 'artifact_list' } } as never));
    await until(() => emit.mock.calls.some(([name, payload]) => name === 'host.supervisorStatus' && (payload as { pid: number }).pid === pid));
    await host.die(); // SIGKILL while its tool still runs
    await until(() => state().state === 'ready' && state().pid !== pid);
    expect(state().restarts).toBe(1); // the crash ladder's backoff and count
    expect(supervisor.facts('engine-host').lastExit).not.toBeNull();
    expect(errors.mock.calls.flat().join(' ')).toContain('unexpectedly');
  });

  it('backs off on repeated early exits and stays crashed after three within the window', async () => {
    const exitedAt: number[] = [];
    onSpawn = (candidate) => {
      exitedAt.push(Date.now());
      candidate.exit(candidates.length === 2 ? 143 : 1); // 143: a start a SIGTERM aborted, an ordinary early exit
    };
    await supervisor.start();
    await sleep(BACKOFF[2] * 3);
    expect(spawn).toHaveBeenCalledTimes(3);
    expect(exitedAt[1] - exitedAt[0]).toBeGreaterThanOrEqual(BACKOFF[0] - 5);
    expect(exitedAt[2] - exitedAt[1]).toBeGreaterThanOrEqual(BACKOFF[1] - 5);
    expect(state()).toMatchObject({ state: 'crashed', restarts: 2 });
    expect(stateNames()).toEqual(['restarting', 'restarting', 'crashed']);
    await expect(ping()).resolves.toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
  });

  it('a candidate that exits early once is restarted and then served', async () => {
    onSpawn = (candidate) => {
      if (candidates.length === 1) candidate.exit(1);
      else void startFake({ pid: candidate.pid! });
    };
    await supervisor.start();
    expect(state()).toMatchObject({ state: 'ready', pid: candidates[1].pid, restarts: 1 });
  });
});

describe('the detached transport: the build and wire handshake (§Design 6’s table; P5 O1 M6: a wire refusal is the protocol-2 window’s)', () => {
  const live = (liveSessions: number) => ({ counts: { liveSessions, rows: liveSessions } });

  it('same protocol, wire and build: served, nothing asked of it', async () => {
    const fake = await startFake(live(2));
    await supervisor.start();
    expect(state()).toMatchObject({ state: 'ready', pid: fake.pid });
    await sleep(30);
    expect(fake.exits).toEqual([]);
  });

  it('another build, nothing live: exit now, then a fresh supervisor once the old pid is dead, unseen', async () => {
    const old = await startFake({ buildId: 'older-build' });
    await supervisor.start();
    expect(old.exits).toEqual(['now']);
    expect(processes.alive.has(old.pid)).toBe(false);
    expect(state()).toMatchObject({ state: 'ready', pid: candidates[0].pid });
    expect(stateNames()).toEqual(['ready']);
  });

  it('another build, sessions live: served and asked to exit when idle, once per supervisor process; its exit is deliberate', async () => {
    const old = await startFake({ buildId: 'older-build', ...live(1), ...BEFORE_HOLDER });
    await supervisor.start();
    expect(state()).toMatchObject({ state: 'ready', pid: old.pid });
    await until(() => old.exits.length === 1);
    expect(old.exits).toEqual(['idle']);
    old.dropClient(); // a socket error: the same process is reconnected to, and not asked again
    await until(() => state().state === 'restarting');
    await until(() => state().state === 'ready');
    await sleep(30);
    expect(old.exits).toEqual(['idle']);
    old.counts = { liveSessions: 0, rows: 1 };
    await old.die(); // its last live row went idle: it exits, as asked
    await until(() => state().state === 'ready' && state().pid !== old.pid);
    expect(state()).toMatchObject({ pid: candidates[0].pid, restarts: 0 });
    expect(errors.mock.calls.flat().join(' ')).not.toContain('unexpectedly');
  });

  it('a protocol-2 supervisor of another wire (refused on the wire) with nothing live: exit now on the refused connection, then a fresh supervisor once the old pid is dead', async () => {
    const old = await startFake({ speaks: 'protocol-2', wire: 'other-wire' });
    await supervisor.start();
    expect(old.exits).toEqual(['now']);
    expect(processes.alive.has(old.pid)).toBe(false);
    expect(state()).toMatchObject({ state: 'ready', pid: candidates[0].pid });
  });

  it('a refused protocol with nothing live: the same', async () => {
    const old = await startFake({ protocol: SOCKET_PROTOCOL + 1 });
    await supervisor.start();
    expect(old.exits).toEqual(['now']);
    expect(state()).toMatchObject({ state: 'ready', pid: candidates[0].pid });
  });

  it('a protocol-2 supervisor of another wire with sessions live: exit when idle asked once on a refused connection, waiting (crashed), session commands unavailable, retried until it is gone', async () => {
    const old = await startFake({ speaks: 'protocol-2', wire: 'other-wire', ...live(2) });
    await supervisor.start();
    expect(state().state).toBe('crashed');
    expect(supervisor.facts('engine-host')).toMatchObject({ reason: 'incompatible', refused: 'wire', waitingLiveSessions: 2 });
    await expect(engineHostSettled(supervisor)).resolves.toBeUndefined();
    await expect(ping()).resolves.toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    await until(() => old.exits.length === 1);
    const tries = old.connections.length;
    await until(() => old.connections.length > tries + 1); // asked again every waitRetryMs
    expect(old.exits).toEqual(['idle']); // once per supervisor process, not at every retry
    // logged on entry and when the live count changes, not at every retry; the count reaches host.status
    const waitingLines = () => logs.filter((line) => line.includes('waiting')).length;
    const waitingErrors = () => errors.mock.calls.flat().join('\n').split('incompatible supervisor').length - 1;
    expect([waitingLines(), waitingErrors()]).toEqual([1, 1]);
    old.counts = { liveSessions: 1, rows: 2 };
    await until(() => waitingLines() === 2);
    expect(supervisor.facts('engine-host').waitingLiveSessions).toBe(1);
    const seen = old.connections.length;
    await until(() => old.connections.length > seen + 1);
    expect([waitingLines(), waitingErrors()]).toEqual([2, 2]);
    expect(logs.filter((line) => line.includes('waiting')).at(-1)).toContain('runs 1 sessions');
    expect(stateNames()).toEqual(['crashed', 'crashed']); // the count changed: host.status is told
    expect(old.exits).toEqual(['idle']);
    await old.die(); // its sessions went idle: it exits
    await until(() => state().state === 'ready');
    expect(state().pid).toBe(candidates[0].pid);
    expect(supervisor.facts('engine-host')).toMatchObject({ reason: null, refused: null, waitingLiveSessions: null });
  });

  // E11 (tracker row E10 "arming without a holder pid logs every retry"): with no lock to read (missing or unparseable)
  // the arming cannot be remembered by pid; it is still written at each retry (idempotent in the supervisor, and the
  // process behind the socket may have changed), but logged once per wait
  it('an incompatible supervisor with no readable lock: exit when idle written at each retry, logged once per wait', async () => {
    const old = await startFake({ speaks: 'protocol-2', wire: 'other-wire', ...live(2) });
    writeFileSync(join(profile.dir, SUPERVISOR_FILES.lock), '{ not json');
    await supervisor.start();
    expect(supervisor.facts('engine-host')).toMatchObject({ reason: 'incompatible', refused: 'wire', waitingLiveSessions: 2 });
    await until(() => old.exits.length >= 3); // three retries, each armed again
    const asked = () => logs.filter((line) => line.includes('to exit when idle')).length;
    expect(asked()).toBe(1);
    expect(logs.find((line) => line.includes('to exit when idle'))).toBe('asked the incompatible supervisor to exit when idle');
    await old.die(); // the wait ends: a fresh supervisor is served
    await until(() => state().state === 'ready');
  });

  it('a refused protocol with sessions live: the same wait, and another incompatible process is asked again', async () => {
    const first = await startFake({ protocol: SOCKET_PROTOCOL + 1, ...live(1) });
    await supervisor.start();
    expect(supervisor.facts('engine-host')).toMatchObject({ reason: 'incompatible', refused: 'protocol', waitingLiveSessions: 1 });
    await until(() => first.exits.length === 1);
    expect(first.exits).toEqual(['idle']);
    await first.die();
    const second = await startFake({ protocol: SOCKET_PROTOCOL + 1, ...live(3) });
    await until(() => second.exits.length === 1);
    expect(second.exits).toEqual(['idle']);
    expect(supervisor.facts('engine-host').waitingLiveSessions).toBe(3);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('engineHostSettled answers while waiting when the wait follows a ready host’s restart', async () => {
    const first = await startFake();
    await supervisor.start();
    await first.die({ keepLock: true }); // a crash: restarting, then the attempt finds an incompatible one
    await until(() => state().state === 'restarting');
    const settled = engineHostSettled(supervisor);
    await startFake({ speaks: 'protocol-2', wire: 'other-wire', ...live(2) });
    await expect(settled).resolves.toBeUndefined();
    expect(state().state).toBe('crashed');
    expect(supervisor.facts('engine-host').reason).toBe('incompatible');
    await expect(ping()).resolves.toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
  });

  it('host.restart while waiting: exit now on a refused connection, then a fresh supervisor once the old pid is dead, with no crash count', async () => {
    const old = await startFake({ speaks: 'protocol-2', wire: 'other-wire', ...live(2) });
    await supervisor.start();
    expect(state().state).toBe('crashed');
    await expect(supervisor.restartSupervisor({ stopSessions: true })).resolves.toEqual({ ok: true, value: undefined });
    const reply = ping(); // held while it restarts
    await until(() => state().state === 'ready');
    await expect(reply).resolves.toMatchObject({ ok: true, value: { pid: candidates[0].pid } });
    expect(old.exits.at(-1)).toBe('now');
    expect(processes.alive.has(old.pid)).toBe(false);
    expect(state()).toMatchObject({ pid: candidates[0].pid, restarts: 0 });
    expect(supervisor.facts('engine-host')).toMatchObject({ reason: null, refused: null, waitingLiveSessions: null, lastExit: null });
  });

  it('a crash at the limit after a wait reads as no incompatible supervisor', async () => {
    onSpawn = (candidate) => {
      candidate.exit(1);
      // between the second early exit and the next attempt, an incompatible supervisor appears
      if (candidates.length === 2) void startFake({ speaks: 'protocol-2', wire: 'other-wire', ...live(2) });
    };
    await supervisor.start();
    expect(supervisor.facts('engine-host').reason).toBe('incompatible');
    await fakes[0].die(); // its sessions ended: the next retry spawns, and that candidate dies early too (the third)
    await until(() => candidates.length === 3 && state().state === 'crashed' && supervisor.facts('engine-host').reason !== 'incompatible');
    expect(supervisor.facts('engine-host')).toMatchObject({ reason: null, refused: null, waitingLiveSessions: null });
  });
});

// P5 O1 M6 (OX1): the wire's major. Any minor of it is served; through the protocol-2 window a supervisor a pre-O1 app
// left running is served when its fingerprint is this app's, and waited for (as before) when it is not.
describe('the detached transport: the wire major and the protocol-2 window (P5 O1 M6)', () => {
  const live = (liveSessions: number) => ({ counts: { liveSessions, rows: liveSessions } });

  it('serves a supervisor of another minor, keeping what its welcome said (peer) and logging it at connect', async () => {
    const fake = await startFake({ minor: 7, capabilities: ['probe.extra'] });
    await supervisor.start();
    expect(state()).toMatchObject({ state: 'ready', pid: fake.pid });
    expect(supervisor.peer('engine-host')).toEqual({ major: 3, minor: 7, build: buildIdOf(profile.modulePath), capabilities: ['probe.extra'] });
    expect(logs).toContain(`connected to supervisor pid ${fake.pid} build ${buildIdOf(profile.modulePath)} wire 3.7 capabilities [probe.extra] (0 live of 0 rows)`);
    expect(fake.peer()).toEqual({ major: 3, minor: WIRE_MINOR, build: buildIdOf(profile.modulePath), capabilities: ['socket.ptyFrames', 'machine.spine', 'machine.connectors', 'host.holder'] }); // P5 O2 M4: socket.ptyFrames; P5 O3-D: the app's own list, not the wire's union (machine.spine from M5b, machine.connectors from O4 M2, host.holder from O16 M3b)
    fake.dropClient();
    await until(() => state().state === 'restarting');
    expect(supervisor.peer('engine-host')).toBeNull();
  });

  it('a protocol-2 supervisor of this fingerprint with sessions live is served as protocol 2, another build, asked to exit when idle', async () => {
    const old = await startFake({ speaks: 'protocol-2', buildId: 'pre-o1-build', ...live(1) });
    await supervisor.start();
    expect(state()).toMatchObject({ state: 'ready', pid: old.pid });
    expect(old.logs).toContain('refused protocol 3 (this supervisor speaks 2)');
    expect(logs).toContain(`supervisor pid ${old.pid} speaks protocol 2 with this app's wire ${wireFingerprint()}; speaking protocol 2 to it`);
    expect(supervisor.peer('engine-host')).toEqual({ major: 2, minor: 0, build: 'pre-o1-build', capabilities: [] });
    await until(() => old.exits.length === 1);
    expect(old.exits).toEqual(['idle']); // the other-build path: served until its sessions are idle
    await expect(ping()).resolves.toEqual({ ok: true, value: { pid: old.pid, uptimeMs: 1, hostVersion: 'fake' } });
    await until(() => old.emit('session.brokerItems', { appSessionId: 'app-1', items: [] } as never));
    await until(() => emit.mock.calls.some(([name]) => name === 'session.brokerItems'));
    await sleep(30);
    expect(old.connected()).toBe(true); // nothing protocol 2's strict envelope refuses was sent
    expect(old.logs.filter((line) => line.startsWith('closed the client'))).toEqual([]);
    expect(supervisor.facts('engine-host')).toMatchObject({ reason: null, refused: null });
  });

  it('a protocol-2 supervisor of this fingerprint with nothing live is replaced, as another build is', async () => {
    const old = await startFake({ speaks: 'protocol-2', buildId: 'pre-o1-build' });
    await supervisor.start();
    expect(old.exits).toEqual(['now']);
    expect(state()).toMatchObject({ state: 'ready', pid: candidates[0].pid });
  });

  it('a protocol-2 supervisor of another fingerprint is never sent protocol 2’s hello: main waits, refused on the wire', async () => {
    const old = await startFake({ speaks: 'protocol-2', wire: 'other-wire', ...live(1) });
    await supervisor.start();
    expect(supervisor.facts('engine-host')).toMatchObject({ reason: 'incompatible', refused: 'wire', waitingLiveSessions: 1 });
    expect(old.logs.some((line) => line.startsWith('refused wire'))).toBe(false);
    expect(logs.some((line) => line.includes('speaking protocol 2'))).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('a supervisor of another major refuses `protocol`, and main waits on it as before', async () => {
    const old = await startFake({ protocol: SOCKET_PROTOCOL + 1, ...live(1) });
    await supervisor.start();
    expect(supervisor.facts('engine-host')).toMatchObject({ reason: 'incompatible', refused: 'protocol', waitingLiveSessions: 1 });
    expect(old.logs.join('\n')).toContain(`refused protocol ${SOCKET_PROTOCOL}`);
  });
});

describe('the detached transport: MAWS_E2E_BUILD_ID and MAWS_E2E_WIRE_MAJOR', () => {
  const withIdentity = (env: NodeJS.ProcessEnv) => {
    supervisor.stop();
    supervisor = makeSupervisor(false, {}, { identity: appIdentity(profile.modulePath, { MAWS_E2E: '1', ...env }) });
  };

  it('a build override makes the running supervisor another build (served, exit when idle); the one main starts after Restart now is its own', async () => {
    withIdentity({ MAWS_E2E_BUILD_ID: 'stale' });
    const { fake, asked } = await startStoppable({ counts: { liveSessions: 1, rows: 1 }, ...BEFORE_HOLDER });
    await supervisor.start();
    expect(state()).toMatchObject({ state: 'ready', pid: fake.pid });
    await until(() => fake.exits.length === 1);
    expect(fake.exits).toEqual(['idle']);
    await expect(supervisor.restartSupervisor({ stopSessions: true })).resolves.toEqual({ ok: true, value: undefined });
    expect(asked).toHaveLength(1);
    await until(() => state().state === 'ready' && state().pid !== fake.pid);
    await sleep(50);
    expect(spawn).toHaveBeenCalledOnce(); // served, not replaced as another build
    expect(fakes.at(-1)!.exits).toEqual([]);
  });

  it('a major override makes the running supervisor incompatible (waiting); after Restart now main serves the one it starts', async () => {
    withIdentity({ MAWS_E2E_WIRE_MAJOR: '4' });
    const old = await startFake({ counts: { liveSessions: 2, rows: 2 } });
    await supervisor.start();
    expect(supervisor.facts('engine-host')).toMatchObject({ reason: 'incompatible', refused: 'protocol', waitingLiveSessions: 2 });
    expect(old.logs.join('\n')).toContain('refused protocol 4');
    await supervisor.restartSupervisor({ stopSessions: false });
    await until(() => state().state === 'ready');
    await sleep(50);
    expect(spawn).toHaveBeenCalledOnce();
    expect(state().pid).toBe(candidates[0].pid);
  });
});

// E10 Task 2.3b: what main asks of the supervisor (Stop all, Restart now, the quit's stop-all), told apart from a crash.
describe('the detached transport: deliberate stops, restarts and the quit', () => {
  it('Stop all (restart with stopSessions): host.stopAll, then a fresh supervisor once the old pid is dead, with no crash count', async () => {
    const { fake, asked } = await startStoppable({ counts: { liveSessions: 2, rows: 2 } });
    await supervisor.start();
    await expect(supervisor.restartSupervisor({ stopSessions: true })).resolves.toEqual({ ok: true, value: undefined });
    expect(asked).toEqual([5_000]);
    await until(() => state().state === 'ready' && state().pid !== fake.pid);
    expect(state()).toMatchObject({ pid: candidates[0].pid, restarts: 0 });
    expect(stateNames()).toEqual(['ready', 'restarting', 'ready']);
    expect(supervisor.facts('engine-host')).toMatchObject({ transport: 'detached', reason: null, lastExit: null });
    expect(errors.mock.calls.flat().join(' ')).not.toContain('unexpectedly');
  });

  it('Restart now without stopSessions: exit now, then a fresh supervisor, with no crash count', async () => {
    const fake = await startFake();
    await supervisor.start();
    await expect(supervisor.restartSupervisor({ stopSessions: false })).resolves.toEqual({ ok: true, value: undefined });
    await until(() => state().state === 'ready' && state().pid !== fake.pid);
    expect(fake.exits).toEqual(['now']);
    expect(state()).toMatchObject({ pid: candidates[0].pid, restarts: 0 });
    expect(supervisor.facts('engine-host').lastExit).toBeNull();
  });

  it('a stop-all that fails is answered with its error, and the exit that follows it anyway is deliberate', async () => {
    const self: FakeSupervisor = await startFake({
      register: (on) =>
        on('host.stopAll', async () => {
          setImmediate(() => void self.die()); // every stop-all ends the supervisor (supervision.ts)
          throw new Error('the ladder failed');
        }),
    });
    await supervisor.start();
    await expect(supervisor.restartSupervisor({ stopSessions: true })).resolves.toMatchObject({ ok: false, error: { code: 'internal' } });
    await until(() => state().state === 'ready' && state().pid !== self.pid);
    expect(state().restarts).toBe(0);
    expect(supervisor.facts('engine-host').lastExit).toBeNull();
  });

  it('a stop-all that outlives the request deadline still makes the close that follows deliberate (it may still be stopping)', async () => {
    let finish!: () => void;
    const self: FakeSupervisor = await startFake({
      register: (on) => on('host.stopAll', () => new Promise((resolve) => (finish = () => resolve({ stopped: 1, forced: 0 })))),
    });
    await supervisor.start();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const restarting = supervisor.restartSupervisor({ stopSessions: true });
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(restarting).resolves.toMatchObject({ ok: false, error: { code: 'timeout' } });
    } finally {
      vi.useRealTimers();
    }
    finish();
    await self.die();
    await until(() => state().state === 'ready' && state().pid !== self.pid);
    expect(state().restarts).toBe(0);
    expect(supervisor.facts('engine-host').lastExit).toBeNull();
  });

  it('a crash records the last exit: the code and signal of a supervisor this run spawned, the time', async () => {
    await supervisor.start(); // spawned by this run
    const first = candidates[0];
    first.exit(null, 'SIGKILL');
    await fakes[0].die({ keepLock: true });
    await until(() => state().state === 'ready' && state().pid !== first.pid);
    const { lastExit } = supervisor.facts('engine-host');
    expect(lastExit).toMatchObject({ code: null, signal: 'SIGKILL' });
    expect(Date.parse(lastExit!.at)).toBeGreaterThan(0);
  });

  it('stopAllForQuit: host.stopAll, and the close that follows spawns nothing; the pid stays for the quit’s kill rung', async () => {
    const { fake, asked } = await startStoppable();
    await supervisor.start();
    await supervisor.stopAllForQuit(4_000);
    expect(asked).toEqual([4_000]);
    await until(() => !processes.alive.has(fake.pid));
    await sleep(BACKOFF[2] + TIMING.pidPollMs * 5);
    expect(spawn).not.toHaveBeenCalled();
    expect(state()).toMatchObject({ state: 'ready', pid: fake.pid });
    expect(stateNames()).toEqual(['ready']);
    await expect(ping()).resolves.toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    await expect(supervisor.restartSupervisor({ stopSessions: true })).resolves.toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('stopAllForQuit with no supervisor served (restarting after a crash) stops the transport: nothing spawns, held requests fail', async () => {
    const fake = await startFake();
    await supervisor.start();
    onSpawn = () => {}; // a successor would never answer; none may be started at all
    await fake.die({ keepLock: true });
    await until(() => state().state === 'restarting');
    const held = ping();
    await supervisor.stopAllForQuit(5_000);
    await expect(held).resolves.toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    await sleep(BACKOFF[2] + TIMING.pidPollMs * 5);
    expect(spawn).not.toHaveBeenCalled();
    expect(processes.kills).toEqual([]); // the welcomed pid is dead: nothing to signal
  });

  describe('stopAllForQuit while restarting after a quiet close (the welcomed supervisor lives, unserved)', () => {
    it('SIGTERMs the supervisor the lock names, so its exit order stops every row; nothing reconnects or spawns', async () => {
      const fake = await startFake({ counts: { liveSessions: 2, rows: 2 } });
      await supervisor.start();
      fake.dropClient(); // a socket error: it lives on, still running its sessions
      await until(() => state().state === 'restarting');
      await supervisor.stopAllForQuit(5_000);
      expect(processes.kills).toEqual([[fake.pid, 'SIGTERM']]);
      await sleep(BACKOFF[2] + TIMING.pidPollMs * 5);
      expect(spawn).not.toHaveBeenCalled();
      expect(state().state).toBe('restarting');
    });

    it('signals nothing when the lock’s pid is now another process (a reused pid)', async () => {
      const fake = await startFake();
      await supervisor.start();
      fake.dropClient();
      await until(() => state().state === 'restarting');
      processes.alive.set(fake.pid, 'another process');
      await supervisor.stopAllForQuit(5_000);
      expect(processes.kills).toEqual([]);
    });

    it('signals nothing when the lock names another process than the one this app was served by', async () => {
      const fake = await startFake();
      await supervisor.start();
      fake.dropClient();
      await until(() => state().state === 'restarting');
      const other = processes.newPid();
      const lock = JSON.parse(readFileSync(join(profile.dir, SUPERVISOR_FILES.lock), 'utf8')) as Record<string, unknown>;
      writeFileSync(join(profile.dir, SUPERVISOR_FILES.lock), JSON.stringify({ ...lock, pid: other, procStart: `start-${other}` }));
      await supervisor.stopAllForQuit(5_000);
      expect(processes.kills).toEqual([]);
    });
  });

  it('stopAllForQuit after another client took the supervisor signals nothing: it serves that client now', async () => {
    const fake = await startFake();
    await supervisor.start();
    const other = await connectLines(profile.socketPath);
    other.send({ t: 'hello', protocol: SOCKET_PROTOCOL, token: fake.token, minor: WIRE_MINOR, build: buildIdOf(profile.modulePath), capabilities: [], appPid: 1 });
    await until(() => state().state === 'crashed');
    await supervisor.stopAllForQuit(5_000);
    expect(processes.kills).toEqual([]);
    other.socket.destroy();
  });

  it('a held lock: the reason says so; restart kills the holder after its start time is checked, then starts afresh', async () => {
    const holder = processes.newPid();
    await startFake({ pid: holder }).then((fake) => fake.die({ keepLock: true }));
    processes.alive.set(holder, `start-${holder}`); // alive, never answering
    await supervisor.start();
    expect(state().state).toBe('crashed');
    expect(supervisor.facts('engine-host')).toMatchObject({ reason: 'held_lock', lastExit: null });
    await expect(supervisor.restartSupervisor({ stopSessions: true })).resolves.toEqual({ ok: true, value: undefined });
    expect(processes.kills).toEqual([[holder, 'SIGTERM']]);
    await until(() => state().state === 'ready');
    expect(state()).toMatchObject({ pid: candidates[0].pid });
    expect(supervisor.facts('engine-host').reason).toBeNull();
  });

  it('host.restart while starting answers ok and does nothing: the attempt under way reaches the supervisor', async () => {
    onSpawn = (candidate) => void sleep(100).then(() => startFake({ pid: candidate.pid! }));
    void supervisor.start();
    await until(() => spawn.mock.calls.length === 1);
    expect(state().state).toBe('starting');
    await expect(supervisor.restartSupervisor({ stopSessions: true })).resolves.toEqual({ ok: true, value: undefined });
    await until(() => state().state === 'ready');
    expect(spawn).toHaveBeenCalledOnce();
    expect(state()).toMatchObject({ pid: candidates[0].pid, restarts: 0 });
    expect(stateNames()).toEqual(['ready']);
  });

  it('host.restart while restarting answers ok and does nothing: the reconnect under way reaches the same supervisor', async () => {
    const fake = await startFake();
    await supervisor.start();
    fake.dropClient();
    await until(() => state().state === 'restarting');
    await expect(supervisor.restartSupervisor({ stopSessions: true })).resolves.toEqual({ ok: true, value: undefined });
    await until(() => state().state === 'ready');
    await sleep(30);
    expect(state()).toMatchObject({ pid: fake.pid, restarts: 0 });
    expect(fake.exits).toEqual([]);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('killHeldSupervisor refuses the supervisor it serves', async () => {
    const fake = await startFake();
    await supervisor.start();
    await expect(supervisor.killHeldSupervisor()).resolves.toBe(false);
    expect(processes.kills).toEqual([]);
    expect(state()).toMatchObject({ state: 'ready', pid: fake.pid });
  });

  it('killHeldSupervisor leaves a pid whose start time no longer matches the lock’s (a reused pid)', async () => {
    const holder = processes.newPid();
    await startFake({ pid: holder }).then((fake) => fake.die({ keepLock: true }));
    processes.alive.set(holder, 'another process');
    await expect(supervisor.killHeldSupervisor()).resolves.toBe(false);
    expect(processes.kills).toEqual([]);
  });

  it('a holder that ignores SIGTERM is killed with SIGKILL past the grace', async () => {
    const holder = processes.newPid();
    await startFake({ pid: holder }).then((fake) => fake.die({ keepLock: true }));
    processes.alive.set(holder, `start-${holder}`);
    processes.onKill = (pid, signal) => void (signal === 'SIGKILL' && processes.alive.delete(pid));
    await expect(supervisor.killHeldSupervisor()).resolves.toBe(true);
    expect(processes.kills).toEqual([[holder, 'SIGTERM'], [holder, 'SIGKILL']]);
    expect(processes.alive.has(holder)).toBe(false);
  });

  it('an incompatible supervisor with sessions live: the reason is incompatible, and what it refused', async () => {
    await startFake({ speaks: 'protocol-2', wire: 'other-wire', counts: { liveSessions: 2, rows: 2 } });
    await supervisor.start();
    expect(supervisor.facts('engine-host')).toMatchObject({ reason: 'incompatible', refused: 'wire' });
  });

  it('`refuse replaced` is crashed with no reason the schema names', async () => {
    const fake = await startFake();
    await supervisor.start();
    const other = await connectLines(profile.socketPath);
    other.send({ t: 'hello', protocol: SOCKET_PROTOCOL, token: fake.token, minor: WIRE_MINOR, build: buildIdOf(profile.modulePath), capabilities: [], appPid: 1 });
    await until(() => state().state === 'crashed');
    expect(supervisor.facts('engine-host')).toMatchObject({ reason: null, lastExit: null });
    other.socket.destroy();
  });
});

// P5 O1 M6: a newer supervisor's socket-layer messages are read tolerantly after the welcome as before it.
describe('the detached transport: a newer supervisor’s document close', () => {
  it('a `documents.closed` with a field this build does not know still ends the window’s port, the field dropped and logged', async () => {
    const dropped = captureConsole('warn', /^\[hosts\] dropped /);
    const ends: unknown[] = [];
    const fake = await startFake({ register: (_on, _emit, client) => client.onDocPort((_message, end) => void ends.push(end)) });
    await supervisor.start();
    const port = Object.assign(new EventEmitter(), { postMessage: vi.fn(), start: vi.fn(), close: vi.fn() });
    expect(supervisor.postDocPort({ t: 'doc', channel: 7, artifactId: '11111111-1111-4111-8111-111111111111', actor: { kind: 'human' } }, port as never)).toBe(true);
    await until(() => ends.length === 1);
    fake.connections.at(-1)!.write(`${JSON.stringify({ t: 'documents.closed', channel: 7, reason: 'host', newer: true })}\n`);
    await until(() => port.close.mock.calls.length === 1);
    expect(errors).not.toHaveBeenCalled();
    expect(dropped.lines()).toEqual(['[hosts] dropped newer from socket documents.closed, a field this build does not know (logged once per message and path)']);
  });
});

// P5 O16 M3b (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3; D9, D40, D56; #413): the handover as `mawsd`'s
// transport drives it. A served host asked to hand over leaves `ready` (requests held for the successor), is asked again
// while it defers, and its close after the drain starts the successor, never a park, whatever is held and whatever the
// park clock asked meanwhile. Another build with sessions live that hands over is never served. A host asked to exit when
// idle whose pid outlives its socket is read as that exit, not as a quiet close.
describe('the detached transport: the handover', () => {
  const onDemand = () => {
    supervisor.stop();
    supervisor = makeSupervisor(false, {}, {}, { onDemand: true });
  };
  // A host that answers host.handover from `state()` (deferred while calls are in flight), recording each ask.
  async function handingOverFake(options: Partial<FakeSupervisorOptions> = {}, inFlight = { count: 0 }) {
    const asked: unknown[] = [];
    const fake = await startFake({
      ...options,
      register: (on) => {
        on('host.handover', async (input) => {
          asked.push(input);
          return inFlight.count > 0 ? { state: 'deferred' as const, inFlight: inFlight.count } : { state: 'detaching' as const };
        });
      },
    });
    return { fake, asked, inFlight };
  }

  it('a deferred handover leaves ready and is asked again; its close after the drain starts the successor, the park clock’s exit and no held request notwithstanding', async () => {
    onDemand();
    const { fake: old, asked, inFlight } = await handingOverFake({}, { count: 1 });
    await supervisor.start();
    supervisor.wake('engine-host');
    await until(() => state().state === 'ready');
    expect(await supervisor.handover('engine-host', 40)).toEqual({ ok: true, value: { state: 'deferred', inFlight: 1 } });
    expect(asked[0]).toEqual({ graceMs: 40 });
    expect(state().state).toBe('restarting'); // a draining host is not ready (D56)
    await until(() => asked.length >= 2); // asked again, WAIT_RETRY_MS on
    expect(logs).toContain(`engine host pid ${old.pid} defers its handover: 1 calls in flight`);
    expect(supervisor.exitSupervisor('idle')).toBe(true); // the park clock fired meanwhile
    await until(() => old.exits.includes('idle'));
    inFlight.count = 0;
    await old.die(); // the drain settled: the host exits
    await until(() => state().state === 'ready' && state().pid !== old.pid);
    expect(spawn).toHaveBeenCalledOnce();
    expect(supervisor.parked('engine-host')).toBe(false);
  });

  it('a request made while it hands over is held and answered by the successor', async () => {
    const { fake: old } = await handingOverFake();
    await supervisor.start();
    await until(() => state().state === 'ready');
    expect(await supervisor.handover('engine-host', 0)).toEqual({ ok: true, value: { state: 'detaching' } });
    const pinged = ping();
    await old.die();
    const answer = await pinged;
    expect(answer).toMatchObject({ ok: true });
    expect((answer as { value: { pid: number } }).value.pid).not.toBe(old.pid);
  });

  it('refuses a host that does not list host.holder, and reconnects to one whose ask failed', async () => {
    const plain = await startFake({ capabilities: [] });
    await supervisor.start();
    await until(() => state().state === 'ready');
    expect(await supervisor.handover('engine-host', 0)).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(state()).toMatchObject({ state: 'ready', pid: plain.pid });
    supervisor.stop();
    await plain.die();

    supervisor = makeSupervisor();
    const failing = await startFake({
      register: (on) => {
        on('host.handover', async () => {
          throw new Error('no drain here');
        });
      },
    });
    await supervisor.start();
    await until(() => state().state === 'ready');
    expect(await supervisor.handover('engine-host', 0)).toMatchObject({ ok: false, error: { code: 'internal' } });
    await until(() => state().state === 'ready');
    expect(state().pid).toBe(failing.pid);
    expect(spawn).not.toHaveBeenCalled();
  });

  // P5 O16 M3c fix wave 2 (D63): an update waits for quiet. Another build with sessions live that hands over is served
  // while MAWS tool calls run on it (never asked to exit when idle), and asked to hand over once, at its first pushed
  // status that says nothing is in flight (or says nothing of it: a capable build before the report)
  it('another build with sessions live that hands over is served while its calls run, and asked once at its first quiet status', async () => {
    const { fake: old, asked } = await handingOverFake({ buildId: 'an-older-build', counts: { liveSessions: 2, rows: 2 } });
    await supervisor.start();
    expect(state()).toMatchObject({ state: 'ready', pid: old.pid }); // served, and ready (#409, #411)
    await until(() => old.emit('host.supervisorStatus', holding(old.pid, 2, 'artifact_list') as never));
    await until(() => supervisor.handoverState('engine-host')?.inFlight === 2);
    expect(supervisor.handoverState('engine-host')).toEqual({ state: 'waiting', inFlight: 2, tool: 'artifact_list' });
    await sleep(TIMING.waitRetryMs * 2);
    expect(asked).toEqual([]);
    expect(old.exits).toEqual([]); // never asked to exit when idle
    expect(await ping()).toMatchObject({ ok: true, value: { pid: old.pid } }); // the app works meanwhile
    old.emit('host.supervisorStatus', holding(old.pid, 0) as never);
    await until(() => asked.length === 1);
    expect(asked[0]).toEqual({ graceMs: 10_000 });
    expect(supervisor.handoverState('engine-host')).toMatchObject({ state: 'draining' });
    old.emit('host.supervisorStatus', holding(old.pid, 0) as never); // a second quiet report asks nothing more
    await sleep(20);
    expect(asked).toHaveLength(1);
    await old.die(); // drained at once: it detaches and exits
    await until(() => state().state === 'ready' && state().pid !== old.pid);
    expect(supervisor.handoverState('engine-host')).toBeNull();
    expect(spawn).toHaveBeenCalledOnce();
    expect(errors.mock.calls.flat().join(' ')).not.toContain('unexpectedly');
  });

  it('a capable build whose status says nothing of its calls in flight is asked at its first status', async () => {
    const { fake: old, asked } = await handingOverFake({ buildId: 'an-older-build', counts: { liveSessions: 1, rows: 1 } });
    await supervisor.start();
    await until(() => old.emit('host.supervisorStatus', holding(old.pid, undefined) as never));
    await until(() => asked.length === 1);
    await old.die();
    await until(() => state().state === 'ready' && state().pid !== old.pid);
  });

  it('a call racing the quiet report defers the handover: the host leaves ready at the ask, is asked again, and its successor follows its exit', async () => {
    const { fake: old, asked, inFlight } = await handingOverFake({ buildId: 'an-older-build', counts: { liveSessions: 1, rows: 1 } }, { count: 1 });
    await supervisor.start();
    await until(() => old.emit('host.supervisorStatus', holding(old.pid, 0) as never)); // quiet, then a call starts before the freeze
    await until(() => asked.length === 1);
    expect(state().state).toBe('restarting'); // D56: not ready from the freeze
    await until(() => logs.includes(`engine host pid ${old.pid} defers its handover: 1 calls in flight`));
    expect(supervisor.handoverState('engine-host')).toMatchObject({ state: 'draining', inFlight: 1 });
    await until(() => asked.length >= 2); // the deferral's retry
    const pinged = ping(); // held for the successor
    inFlight.count = 0;
    await old.die();
    expect(await pinged).toMatchObject({ ok: true });
    await until(() => state().state === 'ready' && state().pid !== old.pid);
    expect(supervisor.handoverState('engine-host')).toBeNull();
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('a host that is never quiet keeps the old build served, and says why', async () => {
    const { fake: old, asked } = await handingOverFake({ buildId: 'an-older-build', counts: { liveSessions: 1, rows: 1 } });
    await supervisor.start();
    for (let k = 1; k <= 4; k += 1) {
      await until(() => old.emit('host.supervisorStatus', holding(old.pid, k, 'show_pane') as never));
      await until(() => supervisor.handoverState('engine-host')?.inFlight === k);
      await sleep(TIMING.waitRetryMs);
    }
    expect(asked).toEqual([]);
    expect(state()).toMatchObject({ state: 'ready', pid: old.pid });
    expect(supervisor.handoverState('engine-host')).toEqual({ state: 'waiting', inFlight: 4, tool: 'show_pane' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('the owner’s handover (restart --engine-host) asks at once during the wait, and a later quiet report asks nothing more', async () => {
    const { fake: old, asked } = await handingOverFake({ buildId: 'an-older-build', counts: { liveSessions: 1, rows: 1 } }, { count: 1 });
    await supervisor.start();
    await until(() => old.emit('host.supervisorStatus', holding(old.pid, 1, 'artifact_list') as never));
    await until(() => supervisor.handoverState('engine-host') !== null);
    expect(await supervisor.handover('engine-host', 0)).toEqual({ ok: true, value: { state: 'deferred', inFlight: 1 } });
    const before = asked.length;
    old.emit('host.supervisorStatus', holding(old.pid, 0) as never);
    await sleep(TIMING.waitRetryMs / 2);
    expect(asked.length).toBe(before);
  });

  it('a failed ask clears the wait at its recycle, and the reconnected host waits for quiet again', async () => {
    let fail = true;
    const asked: unknown[] = [];
    const old = await startFake({
      buildId: 'an-older-build', counts: { liveSessions: 1, rows: 1 },
      register: (on) => {
        on('host.handover', async (input) => {
          asked.push(input);
          if (fail) throw new Error('no drain here');
          return { state: 'detaching' as const };
        });
      },
    });
    const told: unknown[] = [];
    supervisor.onHandover('engine-host', (current) => void told.push(current));
    await supervisor.start();
    await until(() => old.emit('host.supervisorStatus', holding(old.pid, 0) as never));
    await until(() => asked.length === 1);
    await until(() => told.at(-1) === null && state().state === 'ready');
    expect(told.map((t) => (t as { state?: string } | null)?.state ?? null)).toEqual(['draining', null]);
    fail = false;
    await until(() => old.emit('host.supervisorStatus', holding(old.pid, 0) as never) && asked.length === 2);
    await old.die();
    await until(() => state().state === 'ready' && state().pid !== old.pid);
  });

  // P5 O16 M3c fix wave 1 (the version skew between two capable builds, which e2e:cross-build cannot run before landing):
  // a host of another build at an older or a newer minor of the major, listing host.holder, hands over as one at this
  // minor does, and the successor this app starts is welcomed and served
  for (const skew of [-1, 1]) {
    it(`another build a minor ${skew < 0 ? 'behind' : 'ahead'} that lists host.holder hands over, and the successor is served`, async () => {
      const { fake: old, asked } = await handingOverFake({ buildId: 'another-build', minor: WIRE_MINOR + skew, counts: { liveSessions: 1, rows: 1 } });
      await supervisor.start(); // fix wave 2: served while it waits for quiet
      await until(() => old.emit('host.supervisorStatus', holding(old.pid, 0) as never));
      await until(() => asked.length === 1);
      expect(asked[0]).toEqual({ graceMs: 10_000 });
      await old.die(); // drained at once: it detaches and exits
      await until(() => state().state === 'ready' && state().pid !== old.pid);
      expect(supervisor.peer('engine-host')).toMatchObject({ major: SOCKET_PROTOCOL, minor: WIRE_MINOR });
      expect(spawn).toHaveBeenCalledOnce();
    });
  }

  it('a host asked to exit when idle whose pid outlives its closed socket is read as that exit, not a quiet close (#413)', async () => {
    onDemand();
    const old = await startFake({
      onExitIdle: (self) => {
        for (const socket of self.connections) socket.destroy();
        setTimeout(() => void self.die(), 10 * TIMING.pidPollMs); // a slow exit: the pid outlives the socket
      },
    });
    await supervisor.start();
    supervisor.wake('engine-host');
    await until(() => state().state === 'ready');
    expect(supervisor.exitSupervisor('idle')).toBe(true);
    await until(() => supervisor.parked('engine-host'));
    expect(states.filter((s) => s.state === 'ready').map((s) => s.pid)).toEqual([old.pid]); // never reconnected to it
    expect(spawn).not.toHaveBeenCalled();
  });
});
