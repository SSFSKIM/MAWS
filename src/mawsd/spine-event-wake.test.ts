// A spine loaded by the engine host's events wakes no engine host that nobody wants (spine-seam.ts, `wanted`): the race
// P5 O16's M2b found on the daemon shape (e2e:supervisor-daemon case (e), runs 41214627305 and 41217185059). With no app,
// mawsd asks the engine host to exit when idle and the spine releases on its quiet clock; a session's idle release then
// sends the release's events, which load the spine again, and the load's parts talk to the host as it exits. A request
// that lands between the host's close and its park was held, and launched a successor at the park. Here the spine is
// composed from the services entry over a scratch profile, as daemon-spine.test.ts composes it; its link is the
// supervisor core with mawsd's on-demand engine host (host-supervisor.ts), served by a stand-in on the real socket layer
// (test/support/fake-supervisor.ts) with fake pids, which gives the spine's connect-time commands the smallest valid
// answers (test/support/fake-spine-host.ts).
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_CLIENT, type ClientPort } from '@shared/client/port';
import { createHostSupervisor, type HostSupervisor } from '@shared/host/host-supervisor';
import type { MachineRef } from '@shared/machine/ref';
import { ev } from '../../test/support/events';
import { FakeSpineHost } from '../../test/support/fake-spine-host';
import { fakeProfile, FakeProcesses, FakeSupervisor, type FakeProfile } from '../../test/support/fake-supervisor';
import { createServicesFront, type ServicesFront } from './front';
import { DISCOVERY_WAKE_BOUND_MS } from './discovery-wake';
import { createLazySpine, type LazySpine, type SpineEntry } from './spine-seam';

const MACHINE = 'TestMachineRef00000000' as MachineRef;
const BUILD = '0.0.0+spine-event-wake-test';
const TIMING = { connectTimeoutMs: 200, helloTimeoutMs: 150, startTimeoutMs: 1_200, pidPollMs: 20, waitRetryMs: 80, killGraceMs: 60 };
const noClientPort = new Proxy({}, { get: () => () => NO_CLIENT }) as ClientPort;
// What the spine sends the engine host at a connect, answered by FakeSpineHost's table
const ANSWERED = ['fs.scan', 'fs.state', 'fs.bind', 'fs.unbind', 'fs.holders', 'engine.sessions', 'engine.configure', 'engine.policy.set', 'host.configure', 'artifacts.setDefaults', 'library.snapshot'];
// The configuration a welcomed engine host is given: the machine settings' relays at its `ready`, the index's sync at its streaming
const CONFIGURATION = ['engine.configure', 'engine.policy.set', 'host.configure', 'fs.scan'];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let profile: FakeProfile;
let sminos: string;
let processes: FakeProcesses;
let answers: FakeSpineHost;
let hosts: FakeSupervisor[];
let received: Map<number, string[]>;
let exiting: Set<number>;
let spawn: ReturnType<typeof vi.fn>;
let supervisor: HostSupervisor;
let spine: LazySpine;
let front: ServicesFront;
let logs: string[];
let needs: number;

// An engine host process mawsd spawned: it records each command it is sent, and one that is exiting when idle exits as
// the next command reaches it, leaving it unanswered
async function engineHost(pid: number): Promise<FakeSupervisor> {
  const names: string[] = [];
  received.set(pid, names);
  const host: FakeSupervisor = new FakeSupervisor(profile, processes, {
    pid,
    register: (on) => {
      for (const name of ANSWERED) {
        on(name as never, (async (input: unknown) => {
          names.push(name);
          if (exiting.has(pid)) {
            void host.die();
            return new Promise(() => {});
          }
          const result = await answers.dispatch('engine-host', name, input);
          if (!result.ok) throw new Error(result.error.message);
          return result.value;
        }) as never);
      }
    },
  });
  hosts.push(host);
  return host.start();
}

beforeEach(async () => {
  profile = fakeProfile('maws-sew-');
  sminos = mkdtempSync('/tmp/o3d-s-');
  processes = new FakeProcesses();
  answers = new FakeSpineHost();
  await answers.ready(); // it answers from here
  hosts = [];
  received = new Map();
  exiting = new Set();
  logs = [];
  needs = 0;
  spawn = vi.fn(() => {
    const child = Object.assign(new EventEmitter(), { pid: processes.newPid(), unref: () => {} });
    queueMicrotask(() => void engineHost(child.pid));
    return child;
  });
  // mawsd's engine host (daemon.ts): detached, on demand, ready by mawsd's own word at each welcome
  supervisor = createHostSupervisor({
    hosts: { 'engine-host': { modulePath: profile.modulePath, serviceName: 'maws-supervisor', transport: 'detached', readyBy: 'external', onDemand: true } },
    emit: () => true,
    userData: () => profile.userData,
    packaged: () => false,
    restartBackoffMs: [30, 60, 90],
    detached: { spawn: spawn as never, ...processes.deps, timing: TIMING, log: (line) => void logs.push(`[hosts] ${line}`) },
  });
  supervisor.onState('engine-host', (state) => {
    if (state.state === 'ready') supervisor.sayReady('engine-host');
  });
  spine = createLazySpine({
    profileDir: profile.userData,
    build: BUILD,
    hosts: supervisor,
    intercept: () => null,
    load: async () => (await import('../services/entry')) as SpineEntry,
    deps: () => ({
      profile: profile.userData,
      machine: MACHINE,
      bus: front.bus,
      clientPort: noClientPort,
      interest: () => new Set(),
      browserSocket: () => null,
      trash: async () => {},
      engineEnv: Promise.resolve({ HOME: profile.root }),
      env: { SMINOS_HOME: sminos },
      packaged: false,
      appPath: profile.root,
      devRoot: profile.root,
      home: profile.root,
    }),
    quietMs: () => 50,
    reexecute: false,
    wakeOnEvents: true,
    // mawsd's (daemon.ts), less its park clock: a host that is not streaming is sent a ping, which the supervisor holds
    // while the host starts or closes and for which it launches a parked one
    needEngine: () => {
      needs += 1;
      if (!supervisor.streaming('engine-host')) void supervisor.dispatch('engine-host', 'engine.ping', undefined);
    },
    endLink: async () => {},
    restart: () => {},
    exitForYield: () => {},
    collected: () => {},
    onState: (state) => {
      if (state !== 'loading' && state !== 'loaded' && state !== 'releasing') front.unbind();
    },
    log: (line) => void logs.push(line),
    lockWaitMs: 50,
  });
  front = createServicesFront({
    spine,
    hosts: { forward: async () => ({ t: 'res', id: 'x', ok: false, error: { code: 'host_unavailable', message: 'none' } }), onRaw: () => () => {}, onStreaming: () => () => {}, parked: () => true },
    intercept: () => null,
    daemon: async () => undefined,
    identity: () => ({ ref: MACHINE, name: 'test', project: { key: `machine:${MACHINE}`, name: 'test', smnsId: null } }),
    isApp: () => false,
    log: () => {},
  });
  for (const method of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => {}); // the parts' own lines
});

afterEach(async () => {
  try {
    await spine.stop();
    front.close();
    await supervisor.stop();
    for (const host of hosts) await host.die();
  } finally {
    vi.restoreAllMocks();
    rmSync(sminos, { recursive: true, force: true });
    profile.dispose();
  }
});

// mawsd's timeline in case (e): an app's spine command loads the spine and its attachment wakes the engine host, which
// the load's parts configure; the app gone, the spine releases on its quiet clock and the host is asked to exit when idle;
// then a session's idle release sends its events, which load the spine again, and the host exits (its last row released)
// as the first of that load's requests reaches it. Answers the host, gone.
async function raceTheIdleExit(): Promise<FakeSupervisor> {
  await supervisor.start();
  await spine.ensure('command');
  supervisor.wake('engine-host');
  await vi.waitFor(() => expect(hosts).toHaveLength(1));
  const first = hosts[0]!;
  await vi.waitFor(() => expect(received.get(first.pid)).toEqual(expect.arrayContaining(CONFIGURATION)), { timeout: 10_000 });
  spine.quiet(true);
  await vi.waitFor(() => expect(spine.state()).toBe('cold'), { timeout: 10_000 });
  spine.quiet(false); // the load below stays loaded through the checks
  expect(supervisor.exitSupervisor('idle', 'engine-host')).toBe(true);
  await vi.waitFor(() => expect(first.exits).toEqual(['idle']));
  exiting.add(first.pid);
  const sent = received.get(first.pid)!.length;
  expect(first.emit('session.eventBatch', { appSessionId: 'app-released' as never, events: [ev('turn.ended', { id: 'app-released:L1:9:0', seq: 9 })] })).toBe(true);
  await vi.waitFor(() => expect(spine.state()).toBe('loaded'), { timeout: 10_000 });
  await vi.waitFor(() => expect(processes.alive.has(first.pid)).toBe(false));
  expect(received.get(first.pid)!.length).toBeGreaterThan(sent); // the load did reach it as it exited
  expect(logs).toContain('[spine] loading (event)');
  return first;
}

describe('a spine loaded by the engine host’s events, as the host exits when idle', () => {
  it('spawns no engine host: the host parks', async () => {
    await raceTheIdleExit();
    await vi.waitFor(() => expect(supervisor.parked('engine-host') || spawn.mock.calls.length > 1).toBe(true), { timeout: 5_000 });
    await sleep(TIMING.pidPollMs * 10);
    expect(spawn, logs.join('\n')).toHaveBeenCalledOnce(); // the first host's spawn alone
    expect(supervisor.parked('engine-host')).toBe(true);
  }, 30_000);

  it('the next engine host that is wanted is given the configuration at its welcome, under the same load', async () => {
    await raceTheIdleExit();
    await vi.waitFor(() => expect(supervisor.parked('engine-host')).toBe(true), { timeout: 5_000 });
    supervisor.wake('engine-host'); // wanted again: an app attaches
    await vi.waitFor(() => expect(hosts).toHaveLength(2));
    const next = hosts[1]!;
    await vi.waitFor(() => expect(received.get(next.pid)).toEqual(expect.arrayContaining(CONFIGURATION)), { timeout: 10_000 });
    expect(spine.state()).toBe('loaded');
    expect(logs.filter((line) => line.startsWith('[spine] loading'))).toEqual(['[spine] loading (command)', '[spine] loading (event)']);
  }, 30_000);
});

// The session service's boot waits for the engine host's first streaming in its load, and its commands wait for the boot
// (src/services/sessions/service.ts): with the host parked and no app to wake it, such a command is the need that wakes
// it. Each answers within the host's launch and the boot; the bound is the one a discovery read keeps for the same
// callers (discovery-wake.ts: the tightest caller deadline, 10 s, less the answer's way back).
describe('a command that waits on the engine host, with the spine cold and the host parked', () => {
  // the answer, or a refusal naming the bound once it has passed with none
  const within = <T>(answer: Promise<T>) => Promise.race([answer, sleep(DISCOVERY_WAKE_BOUND_MS).then(() => ({ ok: false, error: `no answer within ${DISCOVERY_WAKE_BOUND_MS} ms` }))]);
  const BOOT_WAITERS: [string, unknown][] = [
    ['session.intent.list', undefined],
    ['session.create', { projectId: null, location: null }],
    ['session.acquire', { appSessionId: 'app-unknown', reason: 'read' }],
  ];

  it('wakes the host, and each command that waits on the session service’s boot answers within the bound', async () => {
    await supervisor.start();
    expect(supervisor.parked('engine-host')).toBe(true);
    const started = Date.now();
    const answered = await Promise.all(BOOT_WAITERS.map(([name, input]) => within(front.dispatch(name, input))));
    expect(Date.now() - started).toBeLessThan(DISCOVERY_WAKE_BOUND_MS);
    expect(answered.map((answer) => answer.ok)).toEqual([true, true, true]);
    expect(answered[2]).toMatchObject({ value: { status: 'refused', reason: 'unknown_session' } }); // answered after the boot
    expect(spawn).toHaveBeenCalledOnce();
    expect(supervisor.snapshot('engine-host').state).toBe('ready');
    expect(logs.filter((line) => line.startsWith('[spine] loading'))).toEqual(['[spine] loading (command)']);
  }, 30_000);

  it('a command that never waits on the boot wakes nothing', async () => {
    await supervisor.start();
    expect(await front.dispatch('attention.list', undefined)).toMatchObject({ ok: true });
    expect(spine.state()).toBe('loaded');
    await sleep(TIMING.pidPollMs * 10);
    expect(needs).toBe(0);
    expect(spawn).not.toHaveBeenCalled();
    expect(supervisor.parked('engine-host')).toBe(true);
  }, 30_000);

  it('after an event’s load parked the host, a command that waits on the boot wakes it and answers', async () => {
    await raceTheIdleExit();
    await vi.waitFor(() => expect(supervisor.parked('engine-host')).toBe(true), { timeout: 5_000 });
    expect(spawn).toHaveBeenCalledOnce();
    const started = Date.now();
    expect(await within(front.dispatch('session.intent.list', undefined))).toMatchObject({ ok: true, value: { intents: [] } });
    expect(Date.now() - started).toBeLessThan(DISCOVERY_WAKE_BOUND_MS);
    expect(spawn).toHaveBeenCalledTimes(2);
  }, 30_000);
});
