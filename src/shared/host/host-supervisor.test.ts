// P5 O2 M3: the host supervisor's core in a plain Node process (no Electron, which this file never mocks), and what a
// relay (`mawsd`, M5) needs of it: an external ready line, the recycle, on-demand hosts, raw forwarding, the relayed
// transport, the build policies, the start strategies, a pty host's death, and private paths. Each host is a stand-in
// served by the real socket layer and runtime on a real Unix socket (test/support/fake-supervisor.ts), with fake pids.
import { EventEmitter } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import type { SpawnOptions } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as z from 'zod';
import { fakeProfile, FakeProcesses, FakeSupervisor, type FakeProfile, type FakeSupervisorOptions } from '../../../test/support/fake-supervisor';
import type { WireRegistry } from '../ipc/registry';
import type { CommandName, CommandResult, HostState } from '../ipc/schema';
import { HostPingSchema } from '../ipc/schema/common';
import { createHostRuntime, type HostEmit } from './runtime';
import { PTY_FRAMES_CAPABILITY, SOCKET_PROTOCOL } from './socket-protocol';
import { appIdentity } from './identity'; // P5 O16 M3b fix wave 2
import { createHostSupervisor, REQUEST_TIMEOUT_MS, type HostOwner, type HostSpec, type HostSupervisor, type HostSupervisorOptions } from './host-supervisor';
import type { DetachedTransportOptions, HostFiles } from './detached-transport';

const TIMING = { connectTimeoutMs: 200, helloTimeoutMs: 150, startTimeoutMs: 1_200, pidPollMs: 20, waitRetryMs: 80, killGraceMs: 60 };
const BACKOFF = [30, 60, 90] as const;
const ITEMS = { appSessionId: 'app-1', items: [] } as never;

const until = (check: () => boolean, timeout = 3_000) => vi.waitFor(() => expect(check()).toBe(true), { timeout, interval: 5 });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeCandidate extends EventEmitter {
  unref = vi.fn();
  constructor(
    readonly pid: number,
    readonly command: string,
    readonly args: string[],
    readonly options: SpawnOptions,
  ) {
    super();
  }
}

let profile: FakeProfile;
let processes: FakeProcesses;
let fakes: FakeSupervisor[];
let candidates: FakeCandidate[];
let onSpawn: (candidate: FakeCandidate) => void;
let spawn: ReturnType<typeof vi.fn<(command: string, args: string[], options: SpawnOptions) => FakeCandidate>>;
let emitted: [string, unknown][];
let logs: string[];
let made: HostSupervisor[];

beforeEach(() => {
  profile = fakeProfile('maws-hs-');
  processes = new FakeProcesses();
  fakes = [];
  candidates = [];
  emitted = [];
  logs = [];
  made = [];
  onSpawn = (candidate) => void startFake({ pid: candidate.pid });
  spawn = vi.fn((command: string, args: string[], options: SpawnOptions) => {
    const candidate = new FakeCandidate(processes.newPid(), command, args, options);
    candidates.push(candidate);
    queueMicrotask(() => onSpawn(candidate));
    return candidate;
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  for (const supervisor of made) supervisor.stop();
  for (const fake of fakes) await fake.die();
  vi.restoreAllMocks();
  profile.dispose();
});

async function startFake(options: Partial<FakeSupervisorOptions> = {}, at: FakeProfile = profile): Promise<FakeSupervisor> {
  const fake = new FakeSupervisor(at, processes, { pid: options.pid ?? processes.newPid(), ...options });
  fakes.push(fake);
  return fake.start();
}

function detachedOptions(extra: Partial<DetachedTransportOptions> = {}): Partial<Omit<DetachedTransportOptions, 'modulePath'>> {
  return { spawn: spawn as never, ...processes.deps, timing: TIMING, log: (line) => void logs.push(line), ...extra };
}

function makeSupervisor(hosts: Partial<Record<HostOwner, Partial<HostSpec>>> = { 'engine-host': {} }, options: Partial<HostSupervisorOptions> = {}): HostSupervisor {
  const specs = Object.fromEntries(
    Object.entries(hosts).map(([owner, spec]) => [owner, { modulePath: profile.modulePath, serviceName: `maws-${owner}`, transport: 'detached' as const, ...spec }]),
  );
  const supervisor = createHostSupervisor({
    hosts: specs,
    emit: ((name: string, payload: unknown) => (emitted.push([name, payload]), true)) as never,
    restartBackoffMs: BACKOFF,
    userData: () => profile.userData,
    packaged: () => false,
    detached: detachedOptions(),
    ...options,
  });
  made.push(supervisor);
  return supervisor;
}

const states = (supervisor: HostSupervisor, owner: HostOwner = 'engine-host') => {
  const seen: HostState[] = [];
  supervisor.onState(owner, (state) => void seen.push(state));
  return seen;
};
const ping = (supervisor: HostSupervisor) => supervisor.dispatch('engine-host', 'engine.ping', undefined);
const heard = (name: string) => emitted.filter(([n]) => n === name).length;

// A second host's files beside the supervisor's, as `mawsd`'s pty host has its own directory.
function siblingProfile(name: string): FakeProfile {
  const dir = join(profile.root, name);
  return { ...profile, dir, socketPath: join(dir, 'host.sock') };
}
const filesOf = (at: FakeProfile): HostFiles => ({ dir: at.dir, lock: 'host.lock', token: 'host.token', socket: at.socketPath, log: 'host.log' });

describe('the host supervisor outside Electron', () => {
  it('runs detached hosts with no utility launcher, and refuses a utility host at construction', async () => {
    const fake = await startFake();
    const supervisor = makeSupervisor();
    await supervisor.start();
    await expect(ping(supervisor)).resolves.toMatchObject({ ok: true, value: { pid: fake.pid } });
    expect(() => makeSupervisor({ 'pty-host': { transport: 'utility' } })).toThrow('pty-host asks for a utility process, which this process cannot launch');
  });
});

describe('an external ready line (readyBy: external)', () => {
  it('runs no resync and sends no ready until sayReady: no burst before it, the stream after it', async () => {
    const fake = await startFake();
    const supervisor = makeSupervisor({ 'engine-host': { readyBy: 'external' } });
    const resync = vi.fn(async () => {});
    supervisor.setResync('engine-host', resync);
    const streamed = vi.fn();
    supervisor.onStreaming('engine-host', streamed);
    await supervisor.start();
    expect(supervisor.snapshot('engine-host').state).toBe('ready');
    await expect(ping(supervisor)).resolves.toMatchObject({ ok: true }); // requests are served before the ready line
    await sleep(40);
    expect(fake.emit('session.brokerItems', ITEMS)).toBe(false); // the host holds its events: no client said ready
    expect(resync).not.toHaveBeenCalled();
    expect(streamed).not.toHaveBeenCalled();
    supervisor.sayReady('engine-host');
    await until(() => fake.emit('session.brokerItems', ITEMS));
    await until(() => heard('session.brokerItems') === 1);
    expect(streamed).toHaveBeenCalledOnce();
    expect(supervisor.streaming('engine-host')).toBe(true);
  });

  it('a sayReady with no connection served is said on the next one, after the held requests', async () => {
    const supervisor = makeSupervisor({ 'engine-host': { readyBy: 'external' } });
    onSpawn = () => {}; // nothing answers yet
    void supervisor.start();
    const answered = ping(supervisor);
    supervisor.sayReady('engine-host');
    expect(supervisor.streaming('engine-host')).toBe(false);
    const fake = await startFake({ pid: candidates[0]!.pid });
    await expect(answered).resolves.toMatchObject({ ok: true, value: { pid: fake.pid } });
    await until(() => fake.emit('session.brokerItems', ITEMS));
    expect(supervisor.streaming('engine-host')).toBe(true);
  });
});

describe('recycle', () => {
  it('drains the old connection (a line the host wrote before it saw the end still arrives), then reconnects at once with no crash count, sending the held requests', async () => {
    const fake = await startFake();
    const supervisor = makeSupervisor();
    const seen = states(supervisor);
    const raw: { name: string; payload: unknown }[] = [];
    supervisor.onRaw('engine-host', (message) => void raw.push(message));
    await supervisor.start();
    await until(() => fake.emit('session.brokerItems', ITEMS)); // ready: the host streams
    await until(() => raw.length > 0);
    await sleep(20);
    raw.length = 0;
    const order: string[] = [];
    const recycled = supervisor.recycle('engine-host', { drained: () => void order.push('drained') }).then(() => void order.push('welcomed'));
    expect(fake.emit('session.brokerItems', { appSessionId: 'app-late', items: [] } as never)).toBe(true); // written before the host read the end
    const held = ping(supervisor); // held for the fresh connection
    expect(supervisor.snapshot('engine-host').state).toBe('restarting');
    await recycled;
    expect(order).toEqual(['drained', 'welcomed']);
    expect(raw).toEqual([{ name: 'session.brokerItems', payload: { appSessionId: 'app-late', items: [] } }]);
    expect(emitted.at(-1)).toEqual(['session.brokerItems', { appSessionId: 'app-late', items: [] }]);
    await expect(held).resolves.toMatchObject({ ok: true, value: { pid: fake.pid } });
    expect(fake.connections).toHaveLength(2);
    expect(spawn).not.toHaveBeenCalled();
    expect(supervisor.snapshot('engine-host')).toMatchObject({ state: 'ready', pid: fake.pid, restarts: 0 });
    expect(supervisor.facts('engine-host').lastExit).toBeNull();
    expect(seen.map((s) => s.state)).toEqual(['ready', 'restarting', 'ready']);
  });

  // M5 review: a quit's departure recycles a host a stop-all (or exit now) is ending; it must park, not reconnect
  for (const asked of ['stop-all', 'exit now'] as const) {
    it(`of an on-demand host asked to exit (${asked}): drains in order, reconnects nothing, parks and resolves`, async () => {
      onSpawn = (candidate) => void startFake({ pid: candidate.pid, onExitNow: () => {} }); // the exit comes 100 ms later
      const supervisor = makeSupervisor({ 'engine-host': { onDemand: true } });
      await supervisor.start();
      supervisor.wake('engine-host');
      await until(() => supervisor.snapshot('engine-host').state === 'ready');
      const fake = fakes.at(-1)!;
      if (asked === 'stop-all') supervisor.expectExit('engine-host');
      else supervisor.exitSupervisor('now', 'engine-host');
      setTimeout(() => void fake.die(), 100);
      const order: string[] = [];
      await supervisor.recycle('engine-host', { drained: () => void order.push('drained') }).then(() => void order.push('settled'));
      expect(order).toEqual(['drained', 'settled']);
      await until(() => supervisor.parked('engine-host'));
      await sleep(200);
      expect(spawn).toHaveBeenCalledOnce();
      expect(supervisor.parked('engine-host')).toBe(true);
      expect(supervisor.facts('engine-host').lastExit).toBeNull(); // no crash
    });
  }

  // M5 re-review: an idle-armed host that exits during a recycle's drain parks; one still running is reconnected
  it('of an idle-armed on-demand host that exits during the drain: parks, no successor spawned', async () => {
    const supervisor = makeSupervisor({ 'engine-host': { onDemand: true } });
    await supervisor.start();
    supervisor.wake('engine-host');
    await until(() => supervisor.snapshot('engine-host').state === 'ready');
    const fake = fakes.at(-1)!;
    expect(supervisor.expectIdleExit('engine-host')).toBe(true);
    fake.connections.at(-1)!.allowHalfOpen = true; // its side stays open while the drain runs
    setTimeout(() => void fake.die(), 100); // it exits once idle, 100 ms into the drain
    const order: string[] = [];
    await supervisor.recycle('engine-host', { drained: () => void order.push('drained') }).then(() => void order.push('settled'));
    expect(order).toEqual(['drained', 'settled']);
    await until(() => supervisor.parked('engine-host'));
    await sleep(200);
    expect(spawn).toHaveBeenCalledOnce();
    expect(supervisor.parked('engine-host')).toBe(true);
    expect(supervisor.facts('engine-host').lastExit).toBeNull();
  });

  it('of an idle-armed host still running: reconnects to it, armed still', async () => {
    const fake = await startFake();
    const supervisor = makeSupervisor({ 'engine-host': { onDemand: true } });
    await supervisor.start();
    await expect(supervisor.adopt('engine-host')).resolves.toBe(true);
    expect(supervisor.expectIdleExit('engine-host')).toBe(true);
    await supervisor.recycle('engine-host');
    expect(supervisor.snapshot('engine-host')).toMatchObject({ state: 'ready', pid: fake.pid });
    expect(supervisor.parked('engine-host')).toBe(false);
    await fake.die(); // its idle exit, on the fresh link
    await until(() => supervisor.parked('engine-host'));
    expect(spawn).not.toHaveBeenCalled();
  });

  it('with nothing served, runs drained and resolves at once', async () => {
    const supervisor = makeSupervisor({ 'engine-host': { onDemand: true } });
    await supervisor.start();
    const drained = vi.fn();
    await supervisor.recycle('engine-host', { drained });
    expect(drained).toHaveBeenCalledOnce();
  });
});

describe('an on-demand host', () => {
  it('is parked from start (nothing spawned), launches at the first request, parks at a deliberate exit, and launches again at wake', async () => {
    const supervisor = makeSupervisor({ 'engine-host': { onDemand: true } });
    await supervisor.start();
    expect(supervisor.parked('engine-host')).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
    await expect(ping(supervisor)).resolves.toMatchObject({ ok: true }); // the request woke it
    expect(spawn).toHaveBeenCalledOnce();
    expect(supervisor.parked('engine-host')).toBe(false);
    const first = fakes[0]!;
    expect(supervisor.exitSupervisor('now')).toBe(true); // the fake exits at once
    await until(() => supervisor.parked('engine-host'));
    await sleep(60);
    expect(spawn).toHaveBeenCalledOnce(); // parked: nothing relaunched it
    expect(supervisor.snapshot('engine-host').state).toBe('restarting'); // what it reports while parked
    expect(processes.alive.has(first.pid)).toBe(false);
    supervisor.wake('engine-host');
    await until(() => supervisor.snapshot('engine-host').state === 'ready');
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(supervisor.snapshot('engine-host').pid).toBe(fakes[1]!.pid);
  });

  it('a forwarded host.stopAll, its close made deliberate, parks it', async () => {
    const supervisor = makeSupervisor({ 'engine-host': { onDemand: true } });
    await startFake({ register: (on) => on('host.stopAll', async () => (setImmediate(() => void fakes[0]!.die()), { stopped: 0, forced: 0 })) });
    await supervisor.start();
    await expect(supervisor.adopt('engine-host')).resolves.toBe(true);
    expect(supervisor.expectExit('engine-host')).toBe(true);
    await expect(supervisor.forward('engine-host', { name: 'host.stopAll', input: { graceMs: 1 } })).resolves.toMatchObject({ ok: true });
    await until(() => supervisor.parked('engine-host'));
    expect(spawn).not.toHaveBeenCalled();
  });

  it('adopt connects to a live lock holder with no spawn; with none answering it spawns nothing and stays parked', async () => {
    const supervisor = makeSupervisor({ 'engine-host': { onDemand: true } });
    await supervisor.start();
    await expect(supervisor.adopt('engine-host')).resolves.toBe(false); // no lock at all
    expect(supervisor.parked('engine-host')).toBe(true);
    const silent = await startFake({ answer: 'silent' }); // a live lock holder that never answers
    await expect(supervisor.adopt('engine-host')).resolves.toBe(false);
    expect(supervisor.parked('engine-host')).toBe(true);
    await silent.die();
    const fake = await startFake();
    await expect(supervisor.adopt('engine-host')).resolves.toBe(true);
    expect(supervisor.parked('engine-host')).toBe(false);
    expect(supervisor.snapshot('engine-host')).toMatchObject({ state: 'ready', pid: fake.pid });
    expect(spawn).not.toHaveBeenCalled();
  });
});

// The panel's sweep#3: a command the daemon runs for main keeps its own completion budget across the host binding.
describe('a request’s deadline', () => {
  it('is its name’s own budget where the host spec gives one, REQUEST_TIMEOUT_MS for every other name', async () => {
    let answer: (value: { stopped: number; forced: number }) => void = () => {};
    await startFake({
      register: (on) => {
        on('host.stopAll', () => new Promise((resolve) => (answer = resolve)));
        on('engine.binaryInfo', () => new Promise(() => {})); // never answered
      },
    });
    const supervisor = makeSupervisor({ 'engine-host': { requestBudgetsMs: { 'host.stopAll': REQUEST_TIMEOUT_MS + 5_000 } } });
    await supervisor.start();
    await until(() => supervisor.snapshot('engine-host').state === 'ready');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); // the host is up: only the requests' timers run from here
    try {
      let budgeted: CommandResult<CommandName> | null = null;
      void supervisor.dispatch('engine-host', 'host.stopAll', { graceMs: 1 }).then((result) => (budgeted = result));
      const other = supervisor.dispatch('engine-host', 'engine.binaryInfo', undefined);
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1_000); // an 11 s stop
      await expect(other).resolves.toMatchObject({ ok: false, error: { code: 'timeout' } });
      expect(budgeted, 'still within its own budget').toBeNull();
      answer({ stopped: 1, forced: 0 });
      vi.useRealTimers();
      await until(() => budgeted !== null);
      expect(budgeted).toEqual({ ok: true, value: { stopped: 1, forced: 0 } });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('raw forwarding', () => {
  // A newer build's registry: engine.ping answers a field this build lacks, and it emits an event this build lacks.
  const NEWER = {
    commands: { 'engine.ping': { input: z.void(), output: HostPingSchema.extend({ extra: z.string() }), owner: 'engine-host' as const } },
    events: { 'session.brokerItems': z.unknown(), 'probe.newEvent': z.strictObject({ m: z.number() }) },
    hostEvents: ['session.brokerItems', 'probe.newEvent'],
    ptyHostEvents: [],
    machineEvents: [],
    mainOnly: new Set<string>(),
  } as const satisfies WireRegistry;

  it('forward answers an output as received, keys this build lacks included; onRaw hears an event onEvent drops', async () => {
    let hostEmit!: HostEmit<WireRegistry>;
    const runtime = createHostRuntime<WireRegistry>(
      (on, e) => {
        hostEmit = e;
        on('engine.ping', async () => ({ pid: 1, uptimeMs: 1, hostVersion: 'newer', extra: 'kept' }));
      },
      { registry: NEWER },
    );
    await startFake({ runtime });
    const supervisor = makeSupervisor();
    const raw: { name: string; payload: unknown }[] = [];
    supervisor.onRaw('engine-host', (message) => void raw.push(message));
    await supervisor.start();
    const forwarded = await supervisor.forward('engine-host', { name: 'engine.ping', input: undefined });
    expect(forwarded).toEqual({ t: 'res', id: expect.any(String), ok: true, value: { pid: 1, uptimeMs: 1, hostVersion: 'newer', extra: 'kept' } });
    await expect(ping(supervisor)).resolves.toEqual({ ok: true, value: { pid: 1, uptimeMs: 1, hostVersion: 'newer' } }); // dispatch reads tolerantly
    await until(() => hostEmit('probe.newEvent', { m: 7 }));
    await until(() => raw.length === 1);
    expect(raw).toEqual([{ name: 'probe.newEvent', payload: { m: 7 } }]);
    expect(emitted).toEqual([]);
  });

  it('forward answers a host that is not there with an error response', async () => {
    const supervisor = makeSupervisor();
    await expect(supervisor.forward('pty-host', { name: 'pty.list', input: undefined })).resolves.toMatchObject({ t: 'res', ok: false, error: { code: 'host_unavailable' } });
  });
});

describe('the relayed transport and the build policies', () => {
  // A relay holds the lock and reflects an incompatible host's refusal; `exit now` makes it replace that host, and the
  // relay itself stays up.
  async function startRelay() {
    const relay = await startFake({ protocol: 99, onExitNow: (self) => void (self.options.protocol = SOCKET_PROTOCOL) });
    return relay;
  }

  it('relayed: after exit now on a refused connection with nothing live, reconnects while the lock holder lives and is welcomed', async () => {
    const relay = await startRelay();
    const supervisor = makeSupervisor({ 'engine-host': { detached: detachedOptions({ relayed: true, buildPolicy: 'serve' }) } });
    await supervisor.start();
    expect(relay.exits).toEqual(['now']);
    expect(supervisor.snapshot('engine-host')).toMatchObject({ state: 'ready', pid: relay.pid });
    expect(processes.alive.has(relay.pid)).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('not relayed, the same scene waits for the lock holder to die, which never comes (held_lock)', async () => {
    await startRelay();
    const supervisor = makeSupervisor();
    await supervisor.start();
    expect(supervisor.snapshot('engine-host').state).toBe('crashed');
    expect(supervisor.facts('engine-host').reason).toBe('held_lock');
  });

  it('waiting carries the whole refusal line, for a relay to reflect, and a retry’s changed line with the same count replaces it', async () => {
    const fake = await startFake({ protocol: 99, counts: { liveSessions: 2, rows: 2 } });
    const supervisor = makeSupervisor();
    const seen = states(supervisor);
    await supervisor.start();
    expect(supervisor.facts('engine-host')).toMatchObject({ reason: 'incompatible', refused: 'protocol', waitingLiveSessions: 2 });
    expect(supervisor.refusal('engine-host')).toEqual({ t: 'refuse', reason: 'protocol', protocol: 99, buildId: expect.any(String), wire: expect.any(String), liveSessions: 2 });
    const before = seen.length;
    // another incompatible host in its place: another protocol and build, the same live count
    fake.options.protocol = 98;
    fake.options.buildId = 'replacement-build';
    await until(() => supervisor.refusal('engine-host')?.protocol === 98);
    expect(supervisor.refusal('engine-host')).toMatchObject({ protocol: 98, buildId: 'replacement-build', liveSessions: 2 });
    expect(seen.length).toBeGreaterThan(before); // announced, so host.status and a relay read the new line
    await sleep(200); // further retries with the same line report nothing new
    const settled = seen.length;
    await sleep(200);
    expect(seen.length).toBe(settled);
  });

  it('serve: another build is served, with nothing live or with sessions live, and never asked to exit', async () => {
    const idle = await startFake({ buildId: 'another-build' });
    const supervisor = makeSupervisor({ 'engine-host': { detached: detachedOptions({ buildPolicy: 'serve' }) } });
    await supervisor.start();
    expect(supervisor.snapshot('engine-host')).toMatchObject({ state: 'ready', pid: idle.pid });
    supervisor.stop();
    await idle.die();
    const busy = await startFake({ buildId: 'another-build', counts: { liveSessions: 2, rows: 2 } });
    const again = makeSupervisor({ 'engine-host': { detached: detachedOptions({ buildPolicy: 'serve' }) } });
    await again.start();
    expect(again.snapshot('engine-host')).toMatchObject({ state: 'ready', pid: busy.pid });
    await sleep(40);
    expect([...idle.exits, ...busy.exits]).toEqual([]);
  });

  it('replace (the default): another build with nothing live is asked to exit now, with sessions live to exit when idle', async () => {
    const idle = await startFake({ buildId: 'another-build' });
    const supervisor = makeSupervisor();
    await supervisor.start();
    expect(idle.exits).toEqual(['now']);
    expect(spawn).toHaveBeenCalledOnce();
  });
});

describe('the start strategies', () => {
  it('spawn: the given command, arguments, environment and argv0, logging into the given files', async () => {
    const at = siblingProfile('pty-host');
    onSpawn = (candidate) => void startFake({ pid: candidate.pid }, at);
    const start = { kind: 'spawn' as const, command: '/opt/node', args: ['pty-host.js', '--detached', at.dir], env: { MAWS_USER_DATA: profile.userData }, argv0: 'maws-pty-host' };
    const supervisor = makeSupervisor({ 'pty-host': { detached: detachedOptions({ files: filesOf(at), start }) } });
    await supervisor.start();
    expect(supervisor.snapshot('pty-host').state).toBe('ready');
    expect(spawn).toHaveBeenCalledOnce();
    const [candidate] = candidates;
    expect([candidate!.command, candidate!.args]).toEqual(['/opt/node', ['pty-host.js', '--detached', at.dir]]);
    expect(candidate!.options).toMatchObject({ detached: true, env: { MAWS_USER_DATA: profile.userData }, argv0: 'maws-pty-host' });
  });

  it('default: E10’s spawn of the engine-host bundle as the supervisor', async () => {
    const supervisor = makeSupervisor();
    await supervisor.start();
    expect(candidates[0]!.args).toEqual(['--disable-sigusr1', profile.modulePath, '--detached', profile.dir]);
    expect(candidates[0]!.options).toMatchObject({ argv0: 'maws-supervisor', env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1', MAWS_USER_DATA: profile.userData }) });
  });

  it('unit: asks the unit once and polls its socket until it answers, spawning nothing', async () => {
    let asked = 0;
    const start = { kind: 'unit' as const, start: async () => void (asked++, setTimeout(() => void startFake(), 100)) };
    const supervisor = makeSupervisor({ 'engine-host': { detached: detachedOptions({ start }) } });
    await supervisor.start();
    expect(supervisor.snapshot('engine-host').state).toBe('ready');
    expect(asked).toBe(1);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('unit: a unit that will not start leaves the host crashed with its reason', async () => {
    const start = { kind: 'unit' as const, start: () => Promise.reject(new Error('launchctl: bootstrap failed')) };
    const supervisor = makeSupervisor({ 'engine-host': { detached: detachedOptions({ start }) } });
    await supervisor.start();
    expect(supervisor.snapshot('engine-host').state).toBe('crashed');
    expect(logs.some((line) => line.includes('asking the unit to start'))).toBe(true);
  });

  it('none: polls only, connecting once something else starts the host, and gives up past the budget', async () => {
    const supervisor = makeSupervisor({ 'engine-host': { detached: detachedOptions({ start: { kind: 'none' } }) } });
    setTimeout(() => void startFake(), 100);
    await supervisor.start();
    expect(supervisor.snapshot('engine-host').state).toBe('ready');
    await fakes[0]!.die();
    const alone = makeSupervisor({ 'engine-host': { detached: detachedOptions({ start: { kind: 'none' } }) } });
    await alone.start();
    expect(alone.snapshot('engine-host').state).toBe('crashed');
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('a detached pty host’s death', () => {
  const spawnInput = { appSessionId: 'app-1', label: 't1', cwd: '/', cols: 80, rows: 24 };
  async function ptyHost() {
    const at = siblingProfile('pty-host');
    const runtime = createHostRuntime((on) => on('pty.spawn', async () => ({ ptyId: 'pty-1' as never, pid: 4242 }))); // a pty host's
    const fake = await startFake({ runtime }, at);
    const supervisor = makeSupervisor({ 'pty-host': { detached: detachedOptions({ files: filesOf(at), start: { kind: 'none' } }) } });
    await supervisor.start();
    await expect(supervisor.dispatch('pty-host', 'pty.spawn', spawnInput)).resolves.toMatchObject({ ok: true });
    return { fake, supervisor };
  }

  it('a crash (the welcomed pid gone) says pty.exit for every pty it was told of', async () => {
    const { fake } = await ptyHost();
    await fake.die({ keepLock: true });
    await until(() => heard('pty.exit') === 1);
    expect(emitted.find(([name]) => name === 'pty.exit')).toEqual(['pty.exit', { ptyId: 'pty-1', exitCode: null, signal: null }]);
  });

  it('a quiet loss (the pid lives, the link closed) says nothing: the shells live on', async () => {
    const { fake, supervisor } = await ptyHost();
    fake.dropClient();
    await until(() => supervisor.snapshot('pty-host').state === 'ready' && fake.connections.length === 2);
    await sleep(40);
    expect(heard('pty.exit')).toBe(0);
  });
});

describe('private paths (acceptance 9)', () => {
  it('a symlinked host directory is unreachable, with a line naming the path; nothing is spawned into it', async () => {
    const target = mkdtempSync(join(tmpdir(), 'maws-hs-target-'));
    symlinkSync(target, profile.dir);
    try {
      const supervisor = makeSupervisor();
      await supervisor.start();
      expect(supervisor.snapshot('engine-host').state).toBe('crashed');
      expect(logs).toContain(`${profile.dir} is a symlink`);
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('a host directory more open than 0700 is unreachable before its token is read', async () => {
    await startFake();
    chmodSync(profile.dir, 0o755);
    const supervisor = makeSupervisor();
    await supervisor.start();
    expect(supervisor.snapshot('engine-host').state).toBe('crashed');
    expect(logs).toContain(`${profile.dir} is mode 0755, more open than 0700`);
  });

  it('a socket path that is a symlink is unreachable', async () => {
    const real = await startFake();
    const moved = join(profile.dir, 'real.sock');
    renameSync(profile.socketPath, moved);
    symlinkSync(moved, profile.socketPath);
    const supervisor = makeSupervisor();
    await supervisor.start();
    expect(supervisor.snapshot('engine-host').state).toBe('crashed');
    expect(logs).toContain(`${profile.socketPath} is a symlink`);
    expect(real.connections).toHaveLength(0);
  });

  it('a socket path that is a regular file is unreachable, not replaced', async () => {
    mkdirSync(profile.dir, { mode: 0o700 });
    writeFileSync(profile.socketPath, '');
    const supervisor = makeSupervisor();
    await supervisor.start();
    expect(logs).toContain(`${profile.socketPath} is not a socket`);
    expect(spawn).not.toHaveBeenCalled();
  });
});

// P5 O2 M5: what `mawsd`'s relay needs beyond M3's list: the welcome's facts to reflect, an exit-when-idle it can take
// back, and the replaced loss told apart.
describe('what mawsd reflects and takes back (P5 O2 M5)', () => {
  it('welcome(owner) holds the served welcome’s pid and counts until the link goes', async () => {
    const fake = await startFake({ counts: { liveSessions: 2, rows: 5 } });
    const supervisor = makeSupervisor();
    expect(supervisor.welcome('engine-host')).toBeNull();
    await supervisor.start();
    expect(supervisor.welcome('engine-host')).toMatchObject({ pid: fake.pid, liveSessions: 2, rows: 5, peer: { major: SOCKET_PROTOCOL } });
    fake.dropClient();
    await until(() => supervisor.welcome('engine-host') === null);
  });

  it('disarmExit: once taken back, an exit-when-idle’s close is no longer read as deliberate', async () => {
    const fake = await startFake();
    const supervisor = makeSupervisor({ 'engine-host': { onDemand: true } });
    await supervisor.start();
    await expect(supervisor.adopt('engine-host')).resolves.toBe(true);
    expect(supervisor.exitSupervisor('idle')).toBe(true);
    await until(() => fake.exits.includes('idle'));
    expect(supervisor.disarmExit('engine-host')).toBe(true);
    await fake.die({ keepLock: true }); // a crash now, not the idle exit it was once asked for
    await until(() => spawn.mock.calls.length === 1); // relaunched by the crash ladder, not parked
    expect(supervisor.parked('engine-host')).toBe(false);
  });

  it('without disarmExit the same close parks the host, as the idle exit it was asked for', async () => {
    const fake = await startFake();
    const supervisor = makeSupervisor({ 'engine-host': { onDemand: true } });
    await supervisor.start();
    await expect(supervisor.adopt('engine-host')).resolves.toBe(true);
    expect(supervisor.exitSupervisor('idle')).toBe(true);
    await until(() => fake.exits.includes('idle'));
    await fake.die();
    await until(() => supervisor.parked('engine-host'));
    await sleep(60);
    expect(spawn).not.toHaveBeenCalled();
  });

  // M5 review: host.exitWhenIdle {armed: true} writes no exit line, so the relay tells the transport it was answered
  it('expectIdleExit: an exit when idle armed by command parks the host when it goes; disarmExit takes it back', async () => {
    const fake = await startFake();
    const supervisor = makeSupervisor({ 'engine-host': { onDemand: true } });
    await supervisor.start();
    await expect(supervisor.adopt('engine-host')).resolves.toBe(true);
    expect(supervisor.expectIdleExit('engine-host')).toBe(true);
    expect(fake.exits).toEqual([]); // nothing written: the command armed it
    await fake.die();
    await until(() => supervisor.parked('engine-host'));
    await sleep(60);
    expect(spawn).not.toHaveBeenCalled();
    await expect(ping(supervisor)).resolves.toMatchObject({ ok: true }); // woken: the spawned one
    expect(spawn).toHaveBeenCalledOnce();
    const next = fakes.at(-1)!;
    expect(supervisor.expectIdleExit('engine-host')).toBe(true);
    expect(supervisor.disarmExit('engine-host')).toBe(true);
    await next.die({ keepLock: true }); // a crash now
    await until(() => spawn.mock.calls.length === 2); // the crash ladder, not a park
    expect(supervisor.parked('engine-host')).toBe(false);
  });

  it('onParked tells each park and each leaving of it', async () => {
    const parks: [HostOwner, boolean][] = [];
    const supervisor = makeSupervisor({ 'engine-host': { onDemand: true } }, { onParked: (owner, parked) => void parks.push([owner, parked]) });
    await supervisor.start();
    expect(parks).toEqual([['engine-host', true]]);
    await expect(ping(supervisor)).resolves.toMatchObject({ ok: true });
    expect(parks).toEqual([['engine-host', true], ['engine-host', false]]);
    expect(supervisor.exitSupervisor('now')).toBe(true);
    await until(() => parks.length === 3);
    expect(parks.at(-1)).toEqual(['engine-host', true]);
  });

  it('onReplaced tells a relay its host was taken by another client', async () => {
    await startFake();
    const replaced: HostOwner[] = [];
    const supervisor = makeSupervisor({ 'engine-host': {} }, { onReplaced: (owner) => void replaced.push(owner) });
    await supervisor.start();
    const other = makeSupervisor({ 'engine-host': {} }); // a second client takes the supervisor
    await other.start();
    await until(() => replaced.length === 1);
    expect(replaced).toEqual(['engine-host']);
    expect(supervisor.snapshot('engine-host').state).toBe('crashed');
  });
});

// P5 O16 M3b fix wave 2 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3): a completion (DRAIN_REPLIES) goes to the
// host that raised its request and never waits for, wakes or launches another; on main's daemon shape, with its
// engine-host link down, it goes by the machine link to `mawsd`'s front, for an app that reads the requests there.
describe('a completion of an engine host’s request', () => {
  const ANSWER = { appSessionId: 'app-1', requestId: 'req-1', result: { ok: false, error: 'closed' } };
  const answers = (seen: unknown[]) => createHostRuntime((on) => on('maws.pane.answer', async (input) => (seen.push(input), { outcome: 'delivered' as const })));

  it('to a parked engine host: host_unavailable at once, nothing spawned, the host still parked', async () => {
    const supervisor = makeSupervisor({ 'engine-host': { onDemand: true } });
    await supervisor.start();
    await expect(supervisor.dispatch('engine-host', 'maws.pane.answer', ANSWER)).resolves.toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(supervisor.completionGone('engine-host', 'maws.pane.answer', ANSWER)).toBe(true);
    expect(supervisor.completionGone('engine-host', 'engine.ping', undefined)).toBe(false); // any other name is a need as before
    await sleep(60);
    expect(spawn).not.toHaveBeenCalled();
    expect(supervisor.parked('engine-host')).toBe(true);
  });

  it('during a recycle: held, and sent on the same host’s fresh link', async () => {
    const seen: unknown[] = [];
    await startFake({ runtime: answers(seen) });
    const supervisor = makeSupervisor();
    await supervisor.start();
    const recycled = supervisor.recycle('engine-host');
    const answered = supervisor.dispatch('engine-host', 'maws.pane.answer', ANSWER);
    await recycled;
    await expect(answered).resolves.toEqual({ ok: true, value: { outcome: 'delivered' } });
    expect(seen).toEqual([ANSWER]);
  });

  it('main’s daemon shape, its engine-host link down: by the machine link, keeping its deadline; any other name waits for the engine host as before', async () => {
    const machineSeen: unknown[] = [];
    const at = siblingProfile('machine');
    await startFake({ runtime: answers(machineSeen) }, at);
    const supervisor = makeSupervisor({ 'engine-host': { onDemand: true }, machine: { detached: detachedOptions({ files: filesOf(at), start: { kind: 'none' } }) } });
    await supervisor.start();
    await until(() => supervisor.snapshot('machine').state === 'ready');
    await expect(supervisor.dispatch('engine-host', 'maws.pane.answer', ANSWER)).resolves.toEqual({ ok: true, value: { outcome: 'delivered' } });
    expect(machineSeen).toEqual([ANSWER]);
    expect(supervisor.completionGone('engine-host', 'maws.pane.answer', ANSWER)).toBe(false); // it has a route
    expect(spawn).not.toHaveBeenCalled();
    await expect(ping(supervisor)).resolves.toMatchObject({ ok: true }); // a need: it woke the engine host
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('an app whose machine-link hello does not list machine.spine reads no requests there: no fallback', async () => {
    const machineSeen: unknown[] = [];
    const at = siblingProfile('machine');
    await startFake({ runtime: answers(machineSeen) }, at);
    const identity = appIdentity(profile.modulePath, {}, 'detached', [PTY_FRAMES_CAPABILITY]);
    const supervisor = makeSupervisor({ 'engine-host': { onDemand: true }, machine: { detached: detachedOptions({ files: filesOf(at), start: { kind: 'none' }, identity }) } });
    await supervisor.start();
    await until(() => supervisor.snapshot('machine').state === 'ready');
    await expect(supervisor.dispatch('engine-host', 'maws.pane.answer', ANSWER)).resolves.toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(machineSeen).toEqual([]);
  });
});
