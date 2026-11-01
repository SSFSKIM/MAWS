// E10 Task 2.3b: `host.status`, composed in main from the supervisor's last status and main's own facts, and the two
// actions behind it (`host.restart`, `host.openLog`).
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: vi.fn() } }));

import { SOCKET_PROTOCOL } from '@shared/host/socket-protocol';
import type { CommandResult, HostState } from '@shared/ipc/schema';
import type { HostStatus, SupervisorStatus } from '@shared/ipc/schema/host';
import { validateEventPayload } from '@shared/ipc/validate';
import type { DaemonStatus } from '@shared/ipc/schema/daemon';
import { daemonStatus } from '../../../test/support/builders';
import { CommandFailure } from '../ipc/router';
import type { HostFacts } from './supervisor';
import type { EngineHandoverState } from '@shared/host/host-supervisor';
import type { EngineHandoverWatch } from './engine-handover';
import { startHostStatus, type HostStatusDeps } from './status';

const APP_BUILD = 'b0b0b0b0b0b0b0b0';
const APP_WIRE = 'w1w1w1w1w1w1w1w1';
const MAIN_BUILD = { version: '0.0.0', commit: 'ac8724a6', builtAt: '2026-10-08T09:05:53.000Z' }; // E11 §2.7

const supervisorStatus = (over: Partial<SupervisorStatus> = {}): SupervisorStatus => ({
  mode: 'detached', pid: 4242, startedAt: '2026-10-06T10:00:00.000Z', buildId: APP_BUILD, protocol: SOCKET_PROTOCOL, wire: APP_WIRE,
  liveSessions: 2, rows: 3, idleExitMs: 600_000, idleExitAt: null, exitWhenIdle: false,
  socketPath: '/u/supervisor/host.sock', logPath: '/u/supervisor/host.log', orphansKilled: 0, ...over,
});

function harness(transport: HostFacts['transport'] = 'detached', shape: Pick<HostStatusDeps, 'daemon' | 'daemonUnavailable' | 'spineRefused' | 'engineHandover'> = {}) {
  let state: HostState = { state: 'starting', pid: null, restarts: 0, revision: 0 };
  let machine: HostState = { state: 'ready', pid: 77, restarts: 0, revision: 0 }; // the daemon shape's machine.sock
  let facts: HostFacts = { transport, reason: null, refused: null, waitingLiveSessions: null, lastExit: null };
  const stateListeners = new Set<(s: HostState) => void>();
  const machineListeners = new Set<(s: HostState) => void>();
  let machineStreaming = true; // from main's ready line on machine.sock until it leaves ready
  const streamingListeners = new Set<() => void>();
  const eventListeners = new Set<(s: SupervisorStatus) => void>();
  let handover: EngineHandoverState | null = null; // P5 O16 M3c fix wave 2: main's own transport's (the embedded shape)
  const handoverListeners = new Set<(s: EngineHandoverState | null) => void>();
  const handlers = new Map<string, (input: unknown) => unknown>();
  const emitted: HostStatus[] = [];
  const restartSupervisor = vi.fn(async (): Promise<CommandResult<'host.restart'>> => ({ ok: true, value: undefined }));
  const openPath = vi.fn<(path: string) => Promise<string>>(async () => '');
  const asked: string[] = [];
  const askedOn: string[] = []; // the host each ask went to
  let answer: (owner: string) => Promise<CommandResult<'host.supervisorStatus'>> = async () => ({ ok: false, error: { code: 'host_unavailable', message: 'not yet' } });
  const deps: HostStatusDeps = {
    hosts: {
      snapshot: (owner) => (owner === 'machine' ? machine : state),
      dispatch: (async (owner: string, name: string) => (asked.push(name), askedOn.push(owner), answer(owner))) as HostStatusDeps['hosts']['dispatch'],
      streaming: (owner) => owner === 'machine' && machineStreaming,
      onStreaming: (owner, l) => {
        if (owner !== 'machine') return () => {};
        streamingListeners.add(l);
        return () => void streamingListeners.delete(l);
      },
      onState: (owner, l) => {
        const listeners = owner === 'machine' ? machineListeners : stateListeners;
        listeners.add(l);
        return () => void listeners.delete(l);
      },
      onEvent: ((_name: string, l: (s: SupervisorStatus) => void) => (eventListeners.add(l), () => void eventListeners.delete(l))) as HostStatusDeps['hosts']['onEvent'],
      facts: () => facts,
      restartSupervisor,
      handoverState: () => handover, // P5 O16 M3c fix wave 2
      onHandover: (_owner, l) => (handoverListeners.add(l), () => void handoverListeners.delete(l)),
    },
    appBuildId: () => APP_BUILD,
    appWire: () => APP_WIRE,
    mainBuild: MAIN_BUILD,
    logPath: () => (transport === 'detached' ? '/u/supervisor/host.log' : null),
    emit: (status) => void emitted.push(status),
    register: ((name: string, handler: (input: unknown) => unknown) => void handlers.set(name, handler)) as HostStatusDeps['register'],
    openPath,
    ...shape,
  };
  const service = startHostStatus(deps);
  const h = {
    service,
    emitted,
    restartSupervisor,
    openPath,
    call: (name: string, input?: unknown) => Promise.resolve(handlers.get(name)!(input)),
    move(next: Partial<HostState>, nextFacts: Partial<HostFacts> = {}) {
      facts = { ...facts, ...nextFacts };
      state = { ...state, ...next, revision: state.revision + 1 };
      stateListeners.forEach((l) => l(state));
    },
    // machine.sock's `ready` state comes before main's ready line, from which it streams (the host supervisor's order)
    moveMachine(next: Partial<HostState>, stream = true) {
      machine = { ...machine, ...next, revision: machine.revision + 1 };
      machineStreaming = false;
      machineListeners.forEach((l) => l(machine));
      if (machine.state === 'ready' && stream) h.streamMachine();
    },
    streamMachine() {
      machineStreaming = true;
      streamingListeners.forEach((l) => l());
    },
    status(next: SupervisorStatus) {
      eventListeners.forEach((l) => l(next));
    },
    handover(next: EngineHandoverState | null) {
      handover = next;
      handoverListeners.forEach((l) => l(next));
    },
    asked,
    askedOn,
    answerWith(next: (owner: string) => Promise<CommandResult<'host.supervisorStatus'>>) {
      answer = next;
    },
    listeners: () => stateListeners.size + machineListeners.size + streamingListeners.size + eventListeners.size + handoverListeners.size,
  };
  return h;
}

describe('host.status', () => {
  it('answers with no supervisor while none has reported, and is emitted at every transition', async () => {
    const h = harness();
    await expect(h.call('host.status')).resolves.toEqual({
      transport: 'detached', state: 'starting', supervisor: null, appBuildId: APP_BUILD, appWire: APP_WIRE, mainBuild: MAIN_BUILD, matches: null, reason: null, waitingLiveSessions: null, lastExit: null,
      daemon: null, daemonUnavailable: null, // P5 O2 M7: the embedded shape
      spineRefused: null, // P5 O3-A: this run holds spine.lock
    });
    h.move({ state: 'ready', pid: 4242 });
    expect(h.emitted.at(-1)).toMatchObject({ state: 'ready', supervisor: null, matches: null });
  });

  it('carries the supervisor’s last status, emitted on every one, and how its build compares with the app’s', () => {
    const h = harness();
    h.move({ state: 'ready', pid: 4242 });
    h.status(supervisorStatus());
    expect(h.emitted.at(-1)).toMatchObject({ supervisor: supervisorStatus(), matches: 'same' });
    h.status(supervisorStatus({ buildId: 'older', liveSessions: 1 }));
    expect(h.emitted.at(-1)).toMatchObject({ supervisor: { liveSessions: 1 }, matches: 'build' });
    // P5 O1 M6: a supervisor that sends its status was welcomed, so another minor (its own fingerprint) or a protocol-2
    // supervisor through the window is another build, not another wire
    h.status(supervisorStatus({ buildId: 'older', wire: 'other' }));
    expect(h.emitted.at(-1)?.matches).toBe('build');
    h.status(supervisorStatus({ buildId: 'pre-o1', protocol: 2 }));
    expect(h.emitted.at(-1)?.matches).toBe('build');
    h.status(supervisorStatus({ wire: 'other' }));
    expect(h.emitted.at(-1)?.matches).toBe('same');
    for (const status of h.emitted) expect(validateEventPayload('host.status', status).ok).toBe(true);
  });

  it('drops the supervisor when the host leaves ready, and names why it is crashed', () => {
    const h = harness();
    h.move({ state: 'ready', pid: 4242 });
    h.status(supervisorStatus());
    h.move({ state: 'crashed' }, { reason: 'held_lock' });
    expect(h.emitted.at(-1)).toMatchObject({ state: 'crashed', supervisor: null, matches: null, reason: 'held_lock' });
    h.move({ state: 'crashed' }, { reason: 'incompatible', refused: 'wire', waitingLiveSessions: 2 });
    expect(h.emitted.at(-1)).toMatchObject({ reason: 'incompatible', matches: 'wire', waitingLiveSessions: 2 }); // what the incompatible one refused, and runs
  });

  it('names the sessions an incompatible supervisor still runs while it is waited for, and none otherwise', () => {
    const h = harness();
    h.move({ state: 'crashed' }, { reason: 'incompatible', refused: 'protocol', waitingLiveSessions: 3 });
    expect(h.emitted.at(-1)).toMatchObject({ state: 'crashed', matches: 'protocol', waitingLiveSessions: 3 });
    h.move({ state: 'crashed' }, { waitingLiveSessions: 1 }); // its sessions go idle one by one
    expect(h.emitted.at(-1)?.waitingLiveSessions).toBe(1);
    h.move({ state: 'restarting' }, { reason: null, refused: null, waitingLiveSessions: null });
    expect(h.emitted.at(-1)).toMatchObject({ matches: null, reason: null, waitingLiveSessions: null });
    for (const status of h.emitted) expect(validateEventPayload('host.status', status).ok).toBe(true);
  });

  it('the last unexpected exit counts the rows live at the last status, once per exit', () => {
    const h = harness();
    h.move({ state: 'ready', pid: 4242 });
    h.status(supervisorStatus({ liveSessions: 3 }));
    h.move({ state: 'restarting', pid: null }); // the close, before the exit is known
    const exit = { code: 137, signal: null, at: '2026-10-06T10:05:00.000Z' };
    h.move({ state: 'restarting', restarts: 1 }, { lastExit: exit });
    expect(h.emitted.at(-1)?.lastExit).toEqual({ ...exit, interrupted: 3 });
    h.move({ state: 'ready', pid: 5151 });
    h.status(supervisorStatus({ pid: 5151, liveSessions: 0 }));
    expect(h.emitted.at(-1)?.lastExit).toEqual({ ...exit, interrupted: 3 }); // the successor's count does not rewrite it
  });

  it('a count is spent by the exit it was captured into: a candidate dying before any status interrupted nothing', () => {
    const h = harness();
    h.move({ state: 'ready', pid: 4242 });
    h.status(supervisorStatus({ liveSessions: 3 }));
    const first = { code: null, signal: 'SIGKILL', at: '2026-10-06T10:05:00.000Z' };
    h.move({ state: 'restarting', pid: null }, { lastExit: first });
    expect(h.emitted.at(-1)?.lastExit).toEqual({ ...first, interrupted: 3 });
    const second = { code: 1, signal: null, at: '2026-10-06T10:05:01.000Z' }; // the successor exits before any welcome
    h.move({ state: 'restarting', restarts: 1 }, { lastExit: second });
    expect(h.emitted.at(-1)?.lastExit).toEqual({ ...second, interrupted: 0 });
  });

  // P5 O16 M3b (D21): a crashed host that hosted sessions is succeeded by one that adopts them, so the exit is told once
  // the successor's adoptions have ended, with how many it adopted; until then the status keeps the exit before it
  const holder = (hosts: number, adopted: number, adopting: boolean) => ({ hosts, adopted, failed: 0, gate: null, handover: 'none' as const, adopting });
  it('an exit of a host that hosted sessions is told once its successor’s adoptions end, counting the sessions it adopted', () => {
    const h = harness();
    h.move({ state: 'ready', pid: 4242 });
    h.status(supervisorStatus({ liveSessions: 3, holder: holder(2, 0, false) }));
    const exit = { code: 137, signal: null, at: '2026-10-06T10:05:00.000Z' };
    h.move({ state: 'restarting', pid: null }, { lastExit: exit });
    expect(h.emitted.at(-1)?.lastExit).toBeNull(); // the adoption's count is awaited
    h.move({ state: 'ready', pid: 5151 });
    h.status(supervisorStatus({ pid: 5151, liveSessions: 2, holder: holder(2, 2, true) }));
    expect(h.emitted.at(-1)?.lastExit).toBeNull(); // still adopting
    h.status(supervisorStatus({ pid: 5151, liveSessions: 2, holder: holder(2, 2, false) }));
    expect(h.emitted.at(-1)?.lastExit).toEqual({ ...exit, interrupted: 1, adopted: 2 });
    h.status(supervisorStatus({ pid: 5151, liveSessions: 2, holder: holder(2, 2, false) }));
    expect(h.emitted.at(-1)?.lastExit).toEqual({ ...exit, interrupted: 1, adopted: 2 }); // once
    for (const status of h.emitted) expect(validateEventPayload('host.status', status).ok).toBe(true);
  });

  it('an exit of a host that hosted none is told at once, as before; one whose successor never comes is told when the host gives up', () => {
    const h = harness();
    h.move({ state: 'ready', pid: 4242 });
    h.status(supervisorStatus({ liveSessions: 1, holder: holder(0, 0, false) }));
    const exit = { code: 1, signal: null, at: '2026-10-06T10:05:00.000Z' };
    h.move({ state: 'restarting', pid: null }, { lastExit: exit });
    expect(h.emitted.at(-1)?.lastExit).toEqual({ ...exit, interrupted: 1 });

    const g = harness();
    g.move({ state: 'ready', pid: 4242 });
    g.status(supervisorStatus({ liveSessions: 2, holder: holder(2, 0, false) }));
    g.move({ state: 'restarting', pid: null }, { lastExit: exit });
    expect(g.emitted.at(-1)?.lastExit).toBeNull();
    g.move({ state: 'crashed', pid: null });
    expect(g.emitted.at(-1)?.lastExit).toEqual({ ...exit, interrupted: 2 });
  });

  // P5 O16 M3c: a host whose last status said it was handing over left by design (another client asked it: `mawsd restart
  // --engine-host`, `mawsd` of another build), so its exit is no unexpected one, its successor's adoptions or not
  // P5 O16 M3c fix wave 2 (the re-review's item 6): on the old host's word that its rows detached, not on its intent
  it('the exit of a host whose last status said its handover detached every row is not told', () => {
    const h = harness();
    h.move({ state: 'ready', pid: 4242 });
    h.status(supervisorStatus({ liveSessions: 1, holder: holder(1, 0, false) }));
    h.status(supervisorStatus({ liveSessions: 1, holder: { ...holder(1, 0, false), handover: 'draining' } }));
    h.status(supervisorStatus({ liveSessions: 1, holder: { ...holder(1, 0, false), handover: 'draining', detached: true } }));
    h.move({ state: 'restarting', pid: null }, { lastExit: { code: 0, signal: null, at: '2026-10-06T10:05:00.000Z' } });
    h.move({ state: 'ready', pid: 5151 });
    h.status(supervisorStatus({ pid: 5151, liveSessions: 1, holder: holder(1, 1, true) }));
    h.status(supervisorStatus({ pid: 5151, liveSessions: 1, holder: holder(1, 1, false) }));
    expect(h.emitted.map((status) => status.lastExit)).toEqual(h.emitted.map(() => null));
    // a later crash of the successor is told as before
    const crash = { code: null, signal: 'SIGKILL', at: '2026-10-06T10:06:00.000Z' };
    h.move({ state: 'restarting', pid: null }, { lastExit: crash });
    h.move({ state: 'ready', pid: 6161 });
    h.status(supervisorStatus({ pid: 6161, liveSessions: 1, holder: holder(1, 1, false) }));
    expect(h.emitted.at(-1)?.lastExit).toEqual({ ...crash, interrupted: 0, adopted: 1 });
  });

  it('the exit of a host killed mid-drain (it said draining, never detached) is told as the crash it was', () => {
    const h = harness();
    h.move({ state: 'ready', pid: 4242 });
    h.status(supervisorStatus({ liveSessions: 1, holder: { ...holder(1, 0, false), handover: 'draining', inFlight: 1, tool: 'artifact_list' } }));
    const crash = { code: null, signal: 'SIGKILL', at: '2026-10-06T10:05:00.000Z' };
    h.move({ state: 'restarting', pid: null }, { lastExit: crash });
    h.move({ state: 'ready', pid: 5151 });
    h.status(supervisorStatus({ pid: 5151, liveSessions: 1, holder: holder(1, 1, false) }));
    expect(h.emitted.at(-1)?.lastExit).toEqual({ ...crash, interrupted: 0, adopted: 1 });
  });

  it('a successor that lists no holder counts nothing adopted', () => {
    const h = harness();
    h.move({ state: 'ready', pid: 4242 });
    h.status(supervisorStatus({ liveSessions: 2, holder: holder(1, 0, false) }));
    const exit = { code: null, signal: 'SIGKILL', at: '2026-10-06T10:05:00.000Z' };
    h.move({ state: 'restarting', pid: null }, { lastExit: exit });
    h.move({ state: 'ready', pid: 5151 });
    h.status(supervisorStatus({ pid: 5151, liveSessions: 0 }));
    expect(h.emitted.at(-1)?.lastExit).toEqual({ ...exit, interrupted: 2 });
  });

  it('a utility host reports its own transport', async () => {
    const h = harness('utility');
    h.move({ state: 'ready', pid: 9 });
    h.status(supervisorStatus({ mode: 'utility', socketPath: null, logPath: null }));
    await expect(h.call('host.status')).resolves.toMatchObject({ transport: 'utility', supervisor: { mode: 'utility' }, matches: 'same' });
  });

  // P5 O2 M7: on the daemon shape the engine host is `mawsd`'s to update, so the banner's comparison is with the build
  // the daemon would start, not the app's own
  it('on the daemon shape reports the daemon and compares the engine host with the build the daemon would start', () => {
    let daemon: DaemonStatus | null = null;
    const h = harness('detached', { daemon: () => daemon });
    h.move({ state: 'ready', pid: 4242 });
    h.status(supervisorStatus());
    expect(h.emitted.at(-1)).toMatchObject({ transport: 'daemon', daemon: null, matches: null }); // not yet read: no banner either way
    daemon = daemonStatus({ build: { ...daemonStatus().build, engineHostBuildId: APP_BUILD } });
    h.service.refresh();
    expect(h.emitted.at(-1)).toMatchObject({ transport: 'daemon', daemon, matches: 'same' });
    daemon = daemonStatus({ build: { ...daemonStatus().build, engineHostBuildId: 'newer00000000000' } }); // the daemon would start another
    h.service.refresh();
    expect(h.emitted.at(-1)?.matches).toBe('build'); // though the engine host is this app's own build
    h.status(supervisorStatus({ buildId: 'newer00000000000' }));
    expect(h.emitted.at(-1)?.matches).toBe('same');
    h.move({ state: 'crashed' }, { reason: 'incompatible', refused: 'protocol', waitingLiveSessions: 1 });
    expect(h.emitted.at(-1)).toMatchObject({ transport: 'daemon', matches: 'protocol' }); // a refusal says itself, as embedded
    for (const status of h.emitted) expect(validateEventPayload('host.status', status).ok).toBe(true);
  });

  // M5b fix round 2 (e2e:connectors hot relaunch): on the daemon shape mawsd's link to the engine host is permanent, so an
  // app that attaches to a running host gets no connect burst and no host.supervisorStatus until the host's status
  // changes; main asks for it each time the host is ready, an event heard while the answer is out winning over it
  it('on the daemon shape asks the supervisor’s status at each ready, a status heard meanwhile winning', async () => {
    const h = harness('detached', { daemon: () => null });
    h.answerWith(async () => ({ ok: true, value: supervisorStatus({ pid: 4242 }) }));
    h.move({ state: 'ready', pid: 4242 });
    expect(h.asked).toEqual(['host.supervisorStatus']);
    await vi.waitFor(() => expect(h.emitted.at(-1)?.supervisor?.pid).toBe(4242));

    let release!: (result: CommandResult<'host.supervisorStatus'>) => void;
    h.answerWith(() => new Promise((resolve) => (release = resolve)));
    h.move({ state: 'restarting', pid: null });
    expect(h.emitted.at(-1)?.supervisor).toBeNull();
    h.move({ state: 'ready', pid: 5151 });
    h.status(supervisorStatus({ pid: 5151, liveSessions: 4 })); // the host's own, newer than the answer below
    release({ ok: true, value: supervisorStatus({ pid: 5151, liveSessions: 1 }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.emitted.at(-1)?.supervisor).toMatchObject({ pid: 5151, liveSessions: 4 });
    expect(h.asked).toHaveLength(2);
  });

  // M5b fix round 4: a post-D app hears host.supervisorStatus on machine.sock (mawsd's relay keeps engine-host events off
  // engine-host.sock), so the ask goes there too: on one ordered connection an event the host sent before its answer
  // arrives before it, and the event-wins rule above covers the one sent after. Asked over engine-host.sock, the answer
  // could overtake an older event still on machine.sock, which then rolled the status back.
  it('on the daemon shape asks over machine.sock, where the events come, so an event sent before the answer never lands after it', async () => {
    const h = harness('detached', { daemon: () => null });
    // each socket delivers in the order the engine host sent; engine-host.sock is the faster one here
    const sockets: Record<string, (() => void)[]> = { machine: [], other: [] };
    const sent = (on: string, deliver: () => void) => void sockets[on === 'machine' ? 'machine' : 'other']!.push(deliver);
    sent('machine', () => h.status(supervisorStatus({ liveSessions: 1 }))); // sent before the read, still on its way
    sent('machine', () => h.status(supervisorStatus({ liveSessions: 2 }))); // the change the read reflects
    h.answerWith((owner) => new Promise((resolve) => sent(owner, () => resolve({ ok: true, value: supervisorStatus({ liveSessions: 2 }) }))));
    h.move({ state: 'ready', pid: 4242 });
    expect(h.askedOn).toEqual(['machine']);
    const from = h.emitted.length;
    for (const on of ['other', 'machine']) {
      for (const deliver of sockets[on]!) {
        deliver();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    expect(h.emitted.slice(from).map((status) => status.supervisor?.liveSessions)).toEqual([1, 2]); // never back to 1
    expect(h.service.status().supervisor?.liveSessions).toBe(2);
  });

  // M5b fix round 4: machine.sock can restream while engine-host.sock stays (a dropped socket), losing the events between;
  // main asks again then, and only while the engine host is ready
  it('on the daemon shape asks again when machine.sock is ready again, while the engine host is ready', async () => {
    const h = harness('detached', { daemon: () => null });
    h.answerWith(async () => ({ ok: true, value: supervisorStatus({ liveSessions: 3 }) }));
    h.move({ state: 'ready', pid: 4242 });
    h.moveMachine({ state: 'restarting', pid: null }); // machine.sock drops; engine-host.sock stays
    h.moveMachine({ state: 'ready', pid: 78 });
    expect(h.askedOn).toEqual(['machine', 'machine']); // the engine host's ready, then machine.sock's
    h.move({ state: 'restarting', pid: null });
    h.moveMachine({ state: 'restarting', pid: null });
    h.moveMachine({ state: 'ready', pid: 79 }); // the engine host is not ready: nothing to ask yet
    h.move({ state: 'ready', pid: 5151 });
    expect(h.askedOn).toHaveLength(3); // asked once both are ready
    await vi.waitFor(() => expect(h.emitted.some((status) => status.supervisor?.liveSessions === 3)).toBe(true));
  });

  // M5b fix round 5: machine.sock is `ready` before main's ready line, and the front sends that connection no event until
  // the line; a read begun at `ready` could be answered before a change whose event the front then never sent
  it('on the daemon shape asks over machine.sock only once it streams, not at its ready state', () => {
    const h = harness('detached', { daemon: () => null });
    h.move({ state: 'ready', pid: 4242 });
    h.moveMachine({ state: 'restarting', pid: null });
    h.moveMachine({ state: 'ready', pid: 78 }, false); // welcomed; main's ready line not yet sent
    h.move({ state: 'restarting', pid: null });
    h.move({ state: 'ready', pid: 4242 }); // nor does the engine host's ready ask while machine.sock does not stream
    expect(h.askedOn).toEqual(['machine']);
    h.streamMachine();
    expect(h.askedOn).toEqual(['machine', 'machine']);
  });

  it('the embedded shape waits for the connect burst and asks nothing', () => {
    const h = harness('detached');
    h.move({ state: 'ready', pid: 4242 });
    expect(h.asked).toEqual([]);
  });

  it('says why a launch asked for the daemon runs embedded', async () => {
    const h = harness('detached', { daemonUnavailable: 'no LaunchAgent is installed' });
    await expect(h.call('host.status')).resolves.toMatchObject({ transport: 'detached', daemon: null, daemonUnavailable: 'no LaunchAgent is installed' });
  });

  // P5 O3-A (the O3 document §2; O3-A acceptance 5): a run refused the spine says so, naming the holder, for Diagnostics
  it('carries why this run does not run the spine, in the answer and in every emission', async () => {
    const refused = 'spine.lock is held by pid 4242 (build 1.0.0+abc), so this run starts none of the machine\'s services and writes none of its files';
    const h = harness('detached', { spineRefused: refused });
    await expect(h.call('host.status')).resolves.toMatchObject({ spineRefused: refused });
    h.move({ state: 'ready', pid: 4242 });
    expect(h.emitted.at(-1)).toMatchObject({ spineRefused: refused });
    expect(validateEventPayload('host.status', h.emitted.at(-1)).ok).toBe(true);
  });

  // P5 O3-D M5b: on the daemon shape the spine is `mawsd`'s, so why it does not run is the daemon's last word on it
  it('on the daemon shape carries the daemon’s spine refusal, read at each status', async () => {
    const refused = 'spine.lock is held by pid 4242 (build 1.0.0+abc)';
    let daemon: DaemonStatus | null = null;
    const h = harness('detached', { daemon: () => daemon, spineRefused: 'this run’s own refusal, which the daemon shape never has' });
    await expect(h.call('host.status')).resolves.toMatchObject({ spineRefused: null }); // no daemon.status yet
    daemon = daemonStatus({ spine: { state: 'refused', refused, loadedAt: null, heldDropped: 0 } });
    await expect(h.call('host.status')).resolves.toMatchObject({ spineRefused: refused });
    daemon = daemonStatus({ spine: { state: 'loaded', refused: null, loadedAt: '2026-10-29T10:00:00.000Z', heldDropped: 0 } });
    await expect(h.call('host.status')).resolves.toMatchObject({ spineRefused: null });
  });

  it('stop unsubscribes', () => {
    const h = harness();
    h.service.stop();
    expect(h.listeners()).toBe(0);
  });
});

describe('host.restart and host.openLog', () => {
  it('host.restart asks the supervisor and relays its refusal as the command’s error', async () => {
    const h = harness();
    await expect(h.call('host.restart', { stopSessions: true })).resolves.toBeUndefined();
    expect(h.restartSupervisor).toHaveBeenCalledWith({ stopSessions: true });
    h.restartSupervisor.mockResolvedValueOnce({ ok: false, error: { code: 'host_unavailable', message: 'gone' } });
    await expect(h.call('host.restart', { stopSessions: false })).rejects.toBeInstanceOf(CommandFailure);
  });

  it('host.openLog opens the supervisor’s log, also while none is connected; a utility host keeps none', async () => {
    const h = harness();
    await h.call('host.openLog');
    expect(h.openPath).toHaveBeenCalledWith('/u/supervisor/host.log');
    h.openPath.mockResolvedValueOnce('no application can open it');
    await expect(h.call('host.openLog')).rejects.toMatchObject({ error: { code: 'internal', message: expect.stringContaining('no application can open it') } });
    const utility = harness('utility');
    await expect(utility.call('host.openLog')).rejects.toMatchObject({ error: { code: 'internal' } });
    expect(utility.openPath).not.toHaveBeenCalled();
  });
});

// P5 O16 M3c fix wave 2 (D63): an update that waits for MAWS tool calls says so in host.status (`handover`): from main's
// own transport on the embedded shape, from mawsd's report on the daemon shape; absent when nothing is waited for
describe('host.status’s handover', () => {
  it('on the embedded shape, main’s own transport’s wait, emitted at each change, absent with nothing in flight', async () => {
    const h = harness();
    h.move({ state: 'ready', pid: 4242 });
    expect(h.emitted.at(-1)).not.toHaveProperty('handover');
    h.handover({ state: 'waiting', inFlight: 2, tool: 'artifact_list' });
    expect(h.emitted.at(-1)?.handover).toEqual({ inFlight: 2, tool: 'artifact_list' });
    expect(validateEventPayload('host.status', h.emitted.at(-1)).ok).toBe(true);
    h.handover({ state: 'draining', inFlight: 1 });
    expect(h.emitted.at(-1)?.handover).toEqual({ inFlight: 1 });
    h.handover({ state: 'draining', inFlight: 0 });
    expect(h.emitted.at(-1)).not.toHaveProperty('handover');
    h.handover(null);
    await expect(h.call('host.status')).resolves.not.toHaveProperty('handover');
    h.service.stop();
    expect(h.listeners()).toBe(0);
  });

  it('on the daemon shape, mawsd’s report, emitted at each change', () => {
    let reason: ReturnType<EngineHandoverWatch['reason']> = null;
    const changes = new Set<() => void>();
    const engineHandover: EngineHandoverWatch = { drainingAt: () => null, reason: () => reason, onChange: (l) => (changes.add(l), () => void changes.delete(l)), bind: () => () => {} };
    const h = harness('detached', { daemon: () => null, engineHandover });
    reason = { inFlight: 3, tool: 'show_pane' };
    changes.forEach((l) => l());
    expect(h.emitted.at(-1)?.handover).toEqual({ inFlight: 3, tool: 'show_pane' });
    reason = null;
    changes.forEach((l) => l());
    expect(h.emitted.at(-1)).not.toHaveProperty('handover');
    h.service.stop();
    expect(changes.size).toBe(0);
  });
});
