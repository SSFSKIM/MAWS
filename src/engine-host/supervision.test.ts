// The supervisor's own life (E10 execution document, §Design 1 "Idle exit, and idle rows", "Stop all"; Task 2.3): the
// idle exit's clock, exit-when-idle, the idle-row release's policy, the host.* commands and the status event, over a
// fake process table and plugin runner with the clock faked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandInput, CommandName, CommandOutput } from '@shared/ipc/schema';
import type { SupervisorStatus } from '@shared/ipc/schema/host';
import { validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import { endableClientRef, type ClientRef } from '@shared/ipc/client'; // P5 O2 M2
import type { MachineRole } from './role'; // P5 O2 M2
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import { GROWTH_BYTES, idleCollector } from '@shared/host/idle-collect';
import { READ_LINES } from '@shared/plugins/cli';
import type { BinaryCheck } from './binary-info';
import { scriptedSession } from './conformance/session-harness';
import { PluginsRunner } from './plugins/runner';
import { ProcessTable } from './process-table';
import { MemorySessionStateStore } from './store/memory-session-state-store';
import { DEFAULT_IDLE_EXIT_MS, RELEASE_WHILE_CONNECTED, SERVER_RELEASE_MS, Supervision, type SupervisorExit, type SupervisorIdentity } from './supervision';

const T0 = new Date('2026-10-06T10:00:00.000Z');
const IDLE = 60_000;
const IDENTITY: SupervisorIdentity = { pid: 4321, startedAt: T0.toISOString(), buildId: '0123456789abcdef', protocol: 1, wire: 'fedcba9876543210', socketPath: null, logPath: null };
const DETACHED: SupervisorIdentity = { ...IDENTITY, socketPath: '/u/supervisor/host.sock', logPath: '/u/supervisor/host.log' };

function harness(mode: 'utility' | 'detached' = 'detached', role: MachineRole = 'laptop') {
  const rows: { lifecycle: 'starting' | 'initializing' | 'ready' | 'exiting' | 'exited'; status: () => { holder: { pid: number; holderId: string; adopted: boolean } | null } }[] = [];
  const statusListeners = new Set<() => void>();
  const rowListeners = new Set<() => void>();
  const releases: { idleMs: number | null; active: boolean; ignoreInterest?: boolean }[] = [];
  const interest: { holder: ClientRef; sessions: readonly string[] }[] = []; // P5 O2 M2
  const table = {
    list: () => rows,
    onChange: (listener: () => void) => (statusListeners.add(listener), () => statusListeners.delete(listener)),
    onRowsChanged: (listener: () => void) => (rowListeners.add(listener), () => rowListeners.delete(listener)),
    setIdleRelease: (policy: { idleMs: number | null; active: boolean; ignoreInterest?: boolean }) => void releases.push({ ...policy }),
    setInterest: (holder: ClientRef, sessions: readonly string[]) => void interest.push({ holder, sessions: [...sessions] }), // P5 O2 M2
  };
  const plugins = { held: false, idle: new Set<() => void>() };
  const emitted: SupervisorStatus[] = [];
  const lines: string[] = [];
  let shutdowns = 0;
  const shutdown = vi.fn(async (graceMs: number) => {
    shutdowns += 1;
    void graceMs;
    for (const row of rows) row.lifecycle = 'exited';
    for (const listener of statusListeners) listener(); // the rows' exits arrive during the shutdown
    return { stopped: rows.length, forced: 0 };
  });
  const supervision = new Supervision({
    mode, identity: IDENTITY, table: table as never, role, // P5 O2 M2
    plugins: { busy: () => plugins.held, onIdle: (listener) => (plugins.idle.add(listener), () => plugins.idle.delete(listener)), onBusy: () => () => {} },
    shutdown,
    emit: (status) => {
      const checked = validateEventPayload('host.supervisorStatus', status);
      if (!checked.ok) throw new Error(`invalid host.supervisorStatus: ${JSON.stringify(checked.issues)}`);
      emitted.push(status);
      return true;
    },
    log: (line) => void lines.push(line),
  });
  const handlers = new Map<string, (input: unknown, ctx: { client: ClientRef }) => Promise<unknown>>();
  const hooks: (() => void)[] = [];
  supervision.register((name, handler) => void handlers.set(name, handler as (input: unknown, ctx: { client: ClientRef }) => Promise<unknown>), { onConnect: (hook) => void hooks.push(hook) });
  const call = async <N extends CommandName>(name: N, input: CommandInput<N>, client: ClientRef = endableClientRef('1')): Promise<CommandOutput<N>> => {
    const value = await handlers.get(name)!(input, { client });
    const checked = validateCommandOutput(name, value);
    if (!checked.ok) throw new Error(`invalid output of ${name}: ${checked.error.message}`);
    return checked.value;
  };
  const exits: SupervisorExit[] = [];
  const start = () => supervision.started(DETACHED, (reason) => void exits.push(reason));
  const launch = (hosted = false) => {
    rows.push({ lifecycle: 'ready', status: () => ({ holder: hosted ? { pid: 7000 + rows.length, holderId: `L${rows.length}`, adopted: false } : null }) }); // P5 O16 M2: under a session host
    for (const listener of rowListeners) listener();
  };
  const exitRow = (i = 0) => {
    rows[i]!.lifecycle = 'exited';
    for (const listener of statusListeners) listener();
  };
  const pluginsIdle = () => {
    plugins.held = false;
    for (const listener of plugins.idle) listener();
  };
  return { supervision, rows, releases, interest, plugins, emitted, lines, shutdown, shutdowns: () => shutdowns, handlers, hooks, call, exits, start, launch, exitRow, pluginsIdle };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the supervisor’s idle exit (detached)', () => {
  it('exits after the idle time with no client, no live row and an empty plugin runner; the status names when', async () => {
    const h = harness();
    h.start();
    expect(h.supervision.status()).toMatchObject({ mode: 'detached', idleExitMs: DEFAULT_IDLE_EXIT_MS, idleExitAt: new Date(T0.getTime() + DEFAULT_IDLE_EXIT_MS).toISOString(), socketPath: DETACHED.socketPath });
    await vi.advanceTimersByTimeAsync(DEFAULT_IDLE_EXIT_MS - 1);
    expect(h.exits).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.exits).toEqual(['idle']);
  });

  it('waits while a client is connected; its disconnect starts the clock afresh, a connect resets it', async () => {
    const h = harness();
    h.start();
    await h.call('host.configure', { idleExitMs: IDLE });
    h.supervision.clientChanged(true);
    expect(h.supervision.status().idleExitAt).toBeNull();
    await vi.advanceTimersByTimeAsync(5 * IDLE);
    expect(h.exits).toEqual([]);
    h.supervision.clientChanged(false);
    await vi.advanceTimersByTimeAsync(IDLE / 2);
    h.supervision.clientChanged(true);
    h.supervision.clientChanged(false);
    await vi.advanceTimersByTimeAsync(IDLE - 1);
    expect(h.exits).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.exits).toEqual(['idle']);
  });

  it('waits while a row is live: the clock starts at the last live row’s exit, and a launch resets it', async () => {
    const h = harness();
    h.start();
    await h.call('host.configure', { idleExitMs: IDLE });
    h.launch();
    await vi.advanceTimersByTimeAsync(5 * IDLE);
    expect(h.exits).toEqual([]);
    h.exitRow();
    await vi.advanceTimersByTimeAsync(IDLE - 10);
    h.launch(); // a launch inside the window
    await vi.advanceTimersByTimeAsync(5 * IDLE);
    expect(h.exits).toEqual([]);
    vi.setSystemTime(Date.now() + 1_000);
    const exitedAt = Date.now();
    h.exitRow(1);
    expect(h.supervision.status().idleExitAt).toBe(new Date(exitedAt + IDLE).toISOString());
    await vi.advanceTimersByTimeAsync(IDLE);
    expect(h.exits).toEqual(['idle']);
  });

  it('waits while the plugin runner holds an operation, and starts the clock when it is empty', async () => {
    const h = harness();
    h.plugins.held = true;
    h.start();
    await h.call('host.configure', { idleExitMs: IDLE });
    await vi.advanceTimersByTimeAsync(5 * IDLE);
    expect(h.exits).toEqual([]);
    h.pluginsIdle();
    await vi.advanceTimersByTimeAsync(IDLE);
    expect(h.exits).toEqual(['idle']);
  });

  it('is checked when it fires: work the runner took unannounced keeps the supervisor, and its end re-arms the clock', async () => {
    const h = harness();
    h.start();
    await h.call('host.configure', { idleExitMs: IDLE });
    await vi.advanceTimersByTimeAsync(IDLE / 2);
    h.plugins.held = true; // a read started without a change the supervisor hears of
    await vi.advanceTimersByTimeAsync(IDLE);
    expect(h.exits).toEqual([]);
    expect(h.supervision.status().idleExitAt).toBeNull();
    h.pluginsIdle();
    await vi.advanceTimersByTimeAsync(IDLE);
    expect(h.exits).toEqual(['idle']);
  });

  it('host.configure moves the deadline from the same start, and null is never', async () => {
    const h = harness();
    h.start();
    await h.call('host.configure', { idleExitMs: IDLE });
    await vi.advanceTimersByTimeAsync(IDLE / 2);
    expect(await h.call('host.configure', { idleExitMs: 2 * IDLE })).toBeUndefined();
    expect(h.supervision.status().idleExitAt).toBe(new Date(T0.getTime() + 2 * IDLE).toISOString());
    await vi.advanceTimersByTimeAsync(IDLE);
    expect(h.exits).toEqual([]);
    await h.call('host.configure', { idleExitMs: null });
    await vi.advanceTimersByTimeAsync(100 * IDLE);
    expect(h.exits).toEqual([]);
    expect(h.supervision.status()).toMatchObject({ idleExitMs: null, idleExitAt: null });
  });

  it('never exits before it serves (no exit is known until the entry starts it), nor in utility mode', async () => {
    const before = harness();
    await vi.advanceTimersByTimeAsync(2 * DEFAULT_IDLE_EXIT_MS);
    expect(before.exits).toEqual([]);
    const utility = harness('utility');
    utility.supervision.clientChanged(false);
    await vi.advanceTimersByTimeAsync(2 * DEFAULT_IDLE_EXIT_MS);
    expect(utility.supervision.status()).toMatchObject({ mode: 'utility', idleExitAt: null, socketPath: null, logPath: null });
  });
});

describe('exit-when-idle (detached)', () => {
  it('fires at the last live row’s exit, client connected or not', async () => {
    const h = harness();
    h.start();
    h.supervision.clientChanged(true);
    h.launch();
    h.launch();
    await h.call('host.exitWhenIdle', { armed: true });
    expect(h.supervision.status().exitWhenIdle).toBe(true);
    h.exitRow(0);
    expect(h.exits).toEqual([]);
    h.exitRow(1);
    expect(h.exits).toEqual(['exitWhenIdle']);
    h.exitRow(1);
    expect(h.exits).toEqual(['exitWhenIdle']); // once
  });

  it('armed with nothing live, it exits at once; it waits for the plugin runner; disarmed, it does not', async () => {
    const now = harness();
    now.start();
    now.supervision.armExitWhenIdle(true); // the socket layer's exit {when: 'idle'}
    expect(now.exits).toEqual(['exitWhenIdle']);
    const busy = harness();
    busy.plugins.held = true;
    busy.start();
    busy.supervision.clientChanged(true);
    busy.supervision.armExitWhenIdle(true);
    expect(busy.exits).toEqual([]);
    busy.pluginsIdle();
    expect(busy.exits).toEqual(['exitWhenIdle']);
    const disarmed = harness();
    disarmed.start();
    disarmed.supervision.clientChanged(true);
    disarmed.launch();
    disarmed.supervision.armExitWhenIdle(true);
    disarmed.supervision.armExitWhenIdle(false);
    disarmed.exitRow();
    expect(disarmed.exits).toEqual([]);
  });

  it('a utility host refuses it: it ends with the app', async () => {
    const h = harness('utility');
    await expect(h.handlers.get('host.exitWhenIdle')!({ armed: true }, { client: endableClientRef('1') })).rejects.toMatchObject({ ipcError: { code: 'internal' } });
  });
});

// P5 O2 M2: the idle release keyed on interest (idle-release.ts holds the rule; Supervision its policy). Only the one
// test below reads whether it runs with a client connected (RELEASE_WHILE_CONNECTED), so an owner reversal is local.
describe('the idle release’s policy', () => {
  it('is active from the start with no client connected, with the idle time; interest is ignored while exit-when-idle is armed', async () => {
    const h = harness();
    expect(h.releases.at(-1)).toEqual({ idleMs: DEFAULT_IDLE_EXIT_MS, active: true, ignoreInterest: false });
    h.start();
    await h.call('host.configure', { idleExitMs: IDLE });
    expect(h.releases.at(-1)).toEqual({ idleMs: IDLE, active: true, ignoreInterest: false });
    h.supervision.armExitWhenIdle(true);
    expect(h.releases.at(-1)).toEqual({ idleMs: IDLE, active: true, ignoreInterest: true });
    h.supervision.armExitWhenIdle(false);
    expect(h.releases.at(-1)).toEqual({ idleMs: IDLE, active: true, ignoreInterest: false });
    await h.call('host.configure', { idleExitMs: null });
    expect(h.releases.at(-1)).toMatchObject({ idleMs: null }); // a laptop set to never
    const count = h.releases.length;
    h.launch();
    h.exitRow();
    expect(h.releases).toHaveLength(count); // set on a change of policy only
  });

  // The app-connected release (P5 Decision Logs 29 and 44; O2's pre-flight item 3): the one condition, the one test.
  it('runs while a client is connected too, in either mode: a session nobody holds interest in is released with MAWS open', async () => {
    expect(RELEASE_WHILE_CONNECTED).toBe(true);
    const detached = harness();
    detached.start();
    detached.supervision.clientChanged(true);
    expect(detached.releases.at(-1)).toMatchObject({ active: true });
    const utility = harness('utility'); // main is its client for its whole life
    expect(utility.releases.at(-1)).toMatchObject({ active: true });
  });

  it('takes the machine role’s idle time: a laptop’s is the idle exit’s, a server’s 24 hours whatever the app set; the status reports both', async () => {
    const laptop = harness('detached', 'laptop');
    await laptop.call('host.configure', { idleExitMs: IDLE });
    expect(laptop.releases.at(-1)).toMatchObject({ idleMs: IDLE });
    expect((await laptop.call('host.supervisorStatus', undefined)).release).toEqual({ role: 'laptop', idleMs: IDLE });
    const server = harness('detached', 'server');
    await server.call('host.configure', { idleExitMs: IDLE });
    expect(server.releases.at(-1)).toMatchObject({ idleMs: SERVER_RELEASE_MS });
    expect(SERVER_RELEASE_MS).toBe(24 * 60 * 60_000);
    expect((await server.call('host.supervisorStatus', undefined)).release).toEqual({ role: 'server', idleMs: SERVER_RELEASE_MS });
    expect((await server.call('host.supervisorStatus', undefined)).idleExitMs).toBe(IDLE); // the supervisor's own idle exit keeps the app's
  });

  it('host.interest hands the asking connection and its full set to the table', async () => {
    const h = harness();
    const connection = endableClientRef('3');
    await h.call('host.interest', { sessions: ['a', 'b'] }, connection);
    await h.call('host.interest', { sessions: [] }, connection);
    expect(h.interest.map(({ holder, sessions }) => [holder.id, sessions])).toEqual([['3', ['a', 'b']], ['3', []]]);
  });
});

describe('host.stopAll', () => {
  it('detached: stops every row, answers, and only then exits as stopAll; no other exit pre-empts it', async () => {
    const h = harness();
    h.start();
    h.supervision.clientChanged(true);
    h.launch();
    h.launch();
    h.supervision.armExitWhenIdle(true); // the rows' exits during the stop would otherwise exit first
    expect(await h.call('host.stopAll', { graceMs: 5000 })).toEqual({ stopped: 2, forced: 0 });
    expect(h.exits).toEqual([]); // the runtime posts the answer before the exit runs
    expect(h.shutdown).toHaveBeenCalledExactlyOnceWith(5000);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.exits).toEqual(['stopAll']);
  });

  it('detached: a stop-all whose shutdown fails still exits, after its error answer, with the failure logged', async () => {
    const h = harness();
    h.start();
    h.supervision.clientChanged(true);
    h.launch();
    h.shutdown.mockRejectedValueOnce(new Error('ladder broke'));
    await expect(h.call('host.stopAll', { graceMs: 0 })).rejects.toThrow('ladder broke');
    expect(h.exits).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.exits).toEqual(['stopAll']);
    expect(h.lines).toContainEqual(expect.stringContaining('stop all failed: ladder broke'));
  });

  it('utility: answers engine.shutdown’s body and exits nothing (main forks a fresh host)', async () => {
    const h = harness('utility');
    h.launch();
    expect(await h.call('host.stopAll', { graceMs: 0 })).toEqual({ stopped: 1, forced: 0 });
    await vi.advanceTimersByTimeAsync(DEFAULT_IDLE_EXIT_MS);
    expect(h.exits).toEqual([]);
  });
});

describe('host.supervisorStatus', () => {
  // P5 O16 M2: the live rows under a session host, which `mawsd`'s daemon.status counts; none in utility mode
  it('counts the live rows under a session host in detached mode, and carries no holder in utility mode', async () => {
    const h = harness();
    h.start();
    h.launch(true);
    h.launch(false);
    h.launch(true);
    expect((await h.call('host.supervisorStatus', undefined)).holder).toEqual({ hosts: 2, adopted: 0, failed: 0, gate: null, handover: 'none' });
    h.exitRow(0);
    expect((await h.call('host.supervisorStatus', undefined)).holder?.hosts).toBe(1);
    expect(harness('utility').supervision.status()).not.toHaveProperty('holder');
  });

  it('answers the status and emits it on every change, never twice the same, and always in the connect burst', async () => {
    const h = harness();
    h.start();
    h.supervision.clientChanged(true);
    const status = await h.call('host.supervisorStatus', undefined);
    expect(status).toEqual({ mode: 'detached', ...DETACHED, liveSessions: 0, rows: 0, idleExitMs: DEFAULT_IDLE_EXIT_MS, idleExitAt: null, exitWhenIdle: false, orphansKilled: 0, release: { role: 'laptop', idleMs: DEFAULT_IDLE_EXIT_MS } /* P5 O2 M2 */, holder: { hosts: 0, adopted: 0, failed: 0, gate: null, handover: 'none' } /* P5 O16 M2 */ });
    expect(h.emitted.at(-1)).toEqual(status);
    const count = h.emitted.length;
    h.supervision.clientChanged(true); // nothing changed
    expect(h.emitted).toHaveLength(count);
    h.launch();
    expect(h.emitted.at(-1)).toMatchObject({ liveSessions: 1, rows: 1 });
    h.exitRow();
    expect(h.emitted.at(-1)).toMatchObject({ liveSessions: 0, rows: 1 });
    await h.call('host.configure', { idleExitMs: IDLE });
    expect(h.emitted.at(-1)).toMatchObject({ idleExitMs: IDLE });
    const before = h.emitted.length;
    expect(h.hooks).toHaveLength(1);
    h.hooks[0]!();
    expect(h.emitted).toHaveLength(before + 1);
    expect(h.emitted.at(-1)).toEqual(await h.call('host.supervisorStatus', undefined));
  });

  // Task 2.5: the sweep runs after the supervisor serves, so its count reaches the status (and the app) when it ends
  it('carries the orphans the start-up sweep stopped, emitted when the sweep ends', async () => {
    const h = harness();
    h.start();
    expect((await h.call('host.supervisorStatus', undefined)).orphansKilled).toBe(0);
    h.supervision.orphansSwept(2);
    expect(h.emitted.at(-1)).toMatchObject({ orphansKilled: 2 });
    expect((await h.call('host.supervisorStatus', undefined)).orphansKilled).toBe(2);
    const count = h.emitted.length;
    h.supervision.orphansSwept(2);
    expect(h.emitted).toHaveLength(count);
  });
});

// P5 Decision Log 124's idle collection: the supervisor's quiet, told on each change from the moment it serves and its
// startup has settled, over the real plugin runner.
describe('the supervisor’s quiet', () => {
  type Lifecycle = EngineSessionStatus['process'];
  // A row at rest unless `over` says otherwise: the fields E10's isIdleRow reads.
  const resting = (over: Partial<EngineSessionStatus> = {}) => ({ process: 'ready', engineState: 'idle', turn: null, busy: false, backgroundTasks: [], pendingRequests: 0, pendingPlan: null, queue: { length: 0, paused: false }, heldPeerMessages: [], mcpServers: [], ...over }) as unknown as EngineSessionStatus;

  function quietHarness(mode: 'utility' | 'detached' = 'detached', startup?: Promise<unknown>) {
    const rows: { lifecycle: Lifecycle; now: EngineSessionStatus; status(): EngineSessionStatus }[] = [];
    const listeners = { status: new Set<() => void>(), rows: new Set<() => void>(), interest: new Set<() => void>() };
    let interested = false;
    let answerBinary: ((check: BinaryCheck) => void) | null = null;
    const plugins = new PluginsRunner({
      binary: () => new Promise<BinaryCheck>((resolve) => (answerBinary = resolve)),
      captureEnv: async () => ({}),
      reloadTargets: () => [],
      emit: () => {},
      changed: () => {},
    });
    const told: (boolean | 'dropped')[] = []; // each change of the quiet told (it is told at every refresh), and each dropped holding
    let last: boolean | null = null;
    const supervision = new Supervision({
      mode, identity: IDENTITY, role: 'laptop',
      table: {
        list: () => rows,
        onChange: (listener: () => void) => (listeners.status.add(listener), () => listeners.status.delete(listener)),
        onRowsChanged: (listener: () => void) => (listeners.rows.add(listener), () => listeners.rows.delete(listener)),
        setIdleRelease: () => {},
        setInterest: () => {},
        interested: () => interested,
        launching: () => false,
        onHoldChanged: (listener: () => void) => (listeners.interest.add(listener), () => listeners.interest.delete(listener)),
      } as never,
      plugins,
      shutdown: () => new Promise(() => {}), // a stop-all's rows still stopping
      emit: () => true,
      log: () => {},
      collector: {
        set: (quiet) => {
          if (quiet !== last) told.push(quiet);
          last = quiet;
        },
        dropped: () => void told.push('dropped'),
      },
      startup,
    });
    const handlers = new Map<string, (input: unknown, ctx: { client: ClientRef }) => Promise<unknown>>();
    supervision.register((name, handler) => void handlers.set(name, handler as (input: unknown, ctx: { client: ClientRef }) => Promise<unknown>), { onConnect: () => {} });
    const fire = (set: Set<() => void>) => set.forEach((listener) => listener());
    const exits: SupervisorExit[] = [];
    return {
      supervision, told, exits,
      start: () => supervision.started(DETACHED, (reason) => void exits.push(reason)),
      launch: (status: EngineSessionStatus) => {
        const row = { lifecycle: status.process, now: status, status: () => row.now };
        rows.push(row);
        fire(listeners.rows);
      },
      change: (i: number, status: EngineSessionStatus) => {
        rows[i]!.now = status;
        rows[i]!.lifecycle = status.process;
        fire(listeners.status);
      },
      interest: (on: boolean) => {
        interested = on;
        fire(listeners.interest);
      },
      // A plugin operation, queued at once; `end` lets it run and fail at its binary check, which empties the runner.
      operation: () => {
        void plugins.start('install', { plugin: 'probe@scratch' }, '/', '/bin/claude');
        return {
          end: async () => {
            await vi.advanceTimersByTimeAsync(0); // the queue's turn: the operation runs, waiting on the probe
            answerBinary!({ path: '/bin/claude', testedVersion: '2.1.290', version: null, ok: false, error: 'no engine binary', declaresSystemPromptSnapshot: false });
            await vi.advanceTimersByTimeAsync(0);
          },
        };
      },
      stopAll: () => void handlers.get('host.stopAll')!({ graceMs: 100 }, { client: endableClientRef('1') }),
    };
  }

  it('a detached host is quiet from its start with nothing live, and not while a row starts, runs a turn or waits', () => {
    const h = quietHarness();
    expect(h.told).toEqual([]); // not serving yet
    h.start();
    expect(h.told).toEqual([true]);
    h.launch(resting({ process: 'starting' }));
    h.change(0, resting());
    h.change(0, resting({ turn: { id: 'app:L1:1:0' } as never, engineState: 'running' }));
    h.change(0, resting({ engineState: 'requires_action', pendingRequests: 1 }));
    h.change(0, resting()); // the kept session's turn ended: the entry its collection runs at
    expect(h.told).toEqual([true, false, true, false, true]);
  });

  it('holds while a client holds interest, and comes back when it ends', () => {
    const h = quietHarness();
    h.start();
    h.interest(true);
    h.interest(false);
    expect(h.told).toEqual([true, false, true]);
  });

  it('holds from the moment the plugin runner takes an operation until it is empty again', async () => {
    const h = quietHarness();
    h.start();
    const op = h.operation();
    expect(h.told).toEqual([true, false]);
    await op.end();
    expect(h.told).toEqual([true, false, true]);
  });

  it('tells a dropped holding when a live row ends with the host quiet: an idle release, or an engine’s exit', () => {
    const h = quietHarness();
    h.start();
    h.launch(resting());
    h.launch(resting());
    h.change(0, resting({ process: 'exiting' })); // the idle release stops it
    h.change(0, resting({ process: 'exited' }));
    expect(h.told).toEqual([true, false, true, 'dropped']);
    h.change(1, resting({ process: 'exited' })); // its engine exited on its own
    expect(h.told).toEqual([true, false, true, 'dropped', 'dropped']);
  });

  it('tells no dropped holding for a row that ends while the host is not quiet', () => {
    const h = quietHarness();
    h.start();
    h.launch(resting());
    h.interest(true);
    h.change(0, resting({ process: 'exited' }));
    expect(h.told).toEqual([true, false]);
  });

  it('a utility host serves from its register', () => {
    const h = quietHarness('utility');
    h.launch(resting());
    expect(h.told).toEqual([true]);
  });

  it('waits for the startup gate to settle, resolved or rejected, in either mode', async () => {
    let resolve!: () => void;
    const utility = quietHarness('utility', new Promise<void>((done) => (resolve = done)));
    expect(utility.told).toEqual([]); // still seeding
    resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(utility.told).toEqual([true]);
    let reject!: (error: Error) => void;
    const detached = quietHarness('detached', new Promise<void>((_, fail) => (reject = fail)));
    detached.start();
    expect(detached.told).toEqual([]);
    reject(new Error('the seed failed'));
    await vi.advanceTimersByTimeAsync(0);
    expect(detached.told).toEqual([true]);
  });

  it('is told not quiet when it leaves, and stays so', () => {
    const h = quietHarness();
    h.start();
    h.supervision.armExitWhenIdle(true); // nothing live: it leaves at once
    expect(h.exits).toEqual(['exitWhenIdle']);
    expect(h.told).toEqual([true, false]);
    h.interest(true);
    h.interest(false);
    expect(h.told).toEqual([true, false]);
  });

  it('is told not quiet at a stop-all, in a utility host too, and stays so while its rows stop', () => {
    const h = quietHarness('utility');
    h.launch(resting());
    h.stopAll();
    expect(h.told).toEqual([true, false]);
    h.change(0, resting({ process: 'exited' }));
    expect(h.told).toEqual([true, false]);
  });
});

// P5 Decision Log 124: the collection asks Supervision's quiet again as it runs, over the sources' live state, so a
// source that has begun work and not yet told it (or tells it late) holds the collection off. One row per source the
// quiet reads that can turn busy after an entry (the serving and the startup gate only ever turn it quiet, above): a
// source added to the quiet with no row here is a signal the collection cannot see.
describe('the engine host’s collection, asked again as it runs', () => {
  const MIB = GROWTH_BYTES;
  type Row = { lifecycle: EngineSessionStatus['process']; now: EngineSessionStatus; status(): EngineSessionStatus };
  const resting = (over: Partial<EngineSessionStatus> = {}) => ({ process: 'ready', engineState: 'idle', turn: null, busy: false, backgroundTasks: [], pendingRequests: 0, pendingPlan: null, queue: { length: 0, paused: false }, heldPeerMessages: [], mcpServers: [], ...over }) as unknown as EngineSessionStatus;
  const row = (status: EngineSessionStatus): Row => {
    const made: Row = { lifecycle: status.process, now: status, status: () => made.now };
    return made;
  };

  // A real collector over Supervision's quiet; each heap reading grown, so only the quiet decides
  function collecting(over: { table?: object; plugins?: ConstructorParameters<typeof Supervision>[0]['plugins'] } = {}) {
    const rows: Row[] = [];
    const listeners = new Set<() => void>();
    const add = (listener: () => void) => (listeners.add(listener), () => listeners.delete(listener));
    const state = { interested: false, launching: false, pluginsBusy: false };
    const deferred: (() => void)[] = [];
    const collect = vi.fn();
    let grown = 0;
    const collector = idleCollector({ log: () => {}, collect, heap: () => ({ used: (grown += 2) * MIB, physical: grown * MIB }), defer: (run) => void deferred.push(run), quiet: () => supervision.quiet() });
    const supervision = new Supervision({
      mode: 'utility', identity: IDENTITY, role: 'laptop',
      table: (over.table ?? { list: () => rows, onChange: add, onRowsChanged: add, setIdleRelease: () => {}, setInterest: () => {}, interested: () => state.interested, launching: () => state.launching, onHoldChanged: add }) as never,
      plugins: over.plugins ?? { busy: () => state.pluginsBusy, onIdle: () => () => {}, onBusy: () => () => {} },
      shutdown: () => new Promise(() => {}),
      emit: () => true,
      log: () => {},
      collector,
    });
    const handlers = new Map<string, (input: unknown, ctx: { client: ClientRef }) => Promise<unknown>>();
    supervision.register((name, handler) => void handlers.set(name, handler as (input: unknown, ctx: { client: ClientRef }) => Promise<unknown>), { onConnect: () => {} });
    const told = () => listeners.forEach((listener) => listener()); // a source tells its change
    // an entry: the host busy and quiet again, told, with its collection queued behind this turn
    const enter = () => {
      state.interested = true;
      told();
      state.interested = false;
      told();
      expect(deferred).toHaveLength(1);
    };
    const turn = () => deferred.splice(0).forEach((run) => run());
    return { rows, state, supervision, collect, told, enter, turn, handlers };
  }

  const pending: [string, (h: ReturnType<typeof collecting>) => void][] = [
    ['a row’s turn', (h) => void (h.rows[0]!.now = resting({ turn: { id: 'app:L1:1:0' } as never }))],
    ['a row’s work in flight (a send whose queue tells once its save settles)', (h) => void (h.rows[0]!.now = resting({ busy: true }))],
    ['a row’s engine working', (h) => void (h.rows[0]!.now = resting({ engineState: 'running' }))],
    ['a row’s engine waiting on the owner', (h) => void (h.rows[0]!.now = resting({ engineState: 'requires_action' }))],
    ['a row’s pending request', (h) => void (h.rows[0]!.now = resting({ pendingRequests: 1 }))],
    ['a row’s pending plan', (h) => void (h.rows[0]!.now = resting({ pendingPlan: {} as never }))],
    ['a row’s queued message', (h) => void (h.rows[0]!.now = resting({ queue: { length: 1, paused: false } }))],
    ['a row’s background task', (h) => void (h.rows[0]!.now = resting({ backgroundTasks: [{ taskId: 't' as never, taskType: 'local_agent', description: 'd', ambient: false }] }))],
    ['a row’s cron', (h) => void (h.rows[0]!.now = resting({ work: { unknown: null, crons: [{}] } } as never))],
    ['a row’s work the host cannot read', (h) => void (h.rows[0]!.now = resting({ work: { unknown: 'unreadable', crons: [] } } as never))],
    ['a row’s held peer message', (h) => void (h.rows[0]!.now = resting({ heldPeerMessages: [{}] } as never))],
    ['a row stopping', (h) => Object.assign(h.rows[0]!, { lifecycle: 'exiting', now: resting({ process: 'exiting' }) })],
    ['a new row starting', (h) => void h.rows.push(row(resting({ process: 'starting' })))],
    ['interest in a session', (h) => void (h.state.interested = true)],
    ['a launch preparing its row', (h) => void (h.state.launching = true)],
    ['the plugin runner holding work', (h) => void (h.state.pluginsBusy = true)],
    ['a stop-all', (h) => void h.handlers.get('host.stopAll')!({ graceMs: 100 }, { client: endableClientRef('1') })],
  ];

  it.each(pending)('%s, pending as the collection runs, holds it off', (_, pend) => {
    const h = collecting();
    h.rows.push(row(resting()));
    h.told();
    h.turn();
    expect(h.collect).toHaveBeenCalledOnce(); // its start's entry
    h.enter();
    pend(h); // told to no one yet
    h.turn();
    expect(h.supervision.quiet()).toBe(false);
    expect(h.collect).toHaveBeenCalledOnce();
  });

  it('collects at the next reading that finds it quiet once the source has settled, told late or not at all', () => {
    const h = collecting();
    h.rows.push(row(resting()));
    h.told();
    h.turn();
    h.enter();
    h.rows[0]!.now = resting({ busy: true });
    h.turn();
    h.rows[0]!.now = resting(); // its work ended, and nothing told it
    h.told(); // any later refresh
    h.turn();
    expect(h.collect).toHaveBeenCalledTimes(2);
  });

  // The reviewer's reproduction (round 3, finding 1): the real table and session, the queue's save held. The send marks
  // its use, which tells a status still at rest, then makes the queue busy, which it tells only once the save settles.
  it('holds off over a real session whose send’s queue save is still pending', async () => {
    const table = new ProcessTable({ ps: async () => '' });
    const store = new MemorySessionStateStore();
    const save = store.saveQueue.bind(store);
    const held: (() => void)[] = [];
    let hold = false;
    store.saveQueue = async (id, queue) => {
      if (hold) await new Promise<void>((resolve) => void held.push(resolve));
      return save(id, queue);
    };
    const s = scriptedSession({ spec: { appSessionId: 'app-q' as AppSessionId }, session: { store } });
    table.reserve('app-q' as AppSessionId, () => s.session);
    await s.session.start();
    const h = collecting({ table, plugins: { busy: () => false, onIdle: () => () => {}, onBusy: () => () => {} } });
    h.turn();
    expect(h.collect).toHaveBeenCalledOnce(); // its start's entry
    const holder = endableClientRef('main');
    table.setInterest(holder, ['app-q' as AppSessionId]);
    table.setInterest(holder, []); // the tab closed: an entry, its collection queued
    hold = true;
    const sent = s.session.send('hi');
    await vi.waitFor(() => expect(held).toHaveLength(1)); // its linked reads prepared, its save pending
    expect(s.session.status().busy).toBe(true);
    h.turn();
    expect(h.collect).toHaveBeenCalledOnce();
    held[0]!();
    await sent;
  });

  // The reviewer's reproduction (round 3, finding 2): the real runner, its binary check held. A read has no operation;
  // it holds the runner from its entry, so its preparation is work.
  it('holds off while a plugin read prepares, its binary check still pending', async () => {
    let answer!: (check: BinaryCheck) => void;
    const plugins = new PluginsRunner({
      binary: () => new Promise<BinaryCheck>((resolve) => (answer = resolve)),
      captureEnv: async () => ({}),
      reloadTargets: () => [],
      emit: () => {},
      changed: () => {},
    });
    const h = collecting({ plugins });
    h.turn();
    h.enter();
    const read = plugins.read(READ_LINES.installed, '/');
    expect(plugins.busy()).toBe(true);
    h.turn();
    expect(h.collect).toHaveBeenCalledOnce();
    answer({ path: '/bin/claude', testedVersion: '2.1.290', version: null, ok: false, error: 'no engine binary', declaresSystemPromptSnapshot: false });
    await expect(read).rejects.toThrow('no engine binary');
    expect(plugins.busy()).toBe(false);
    h.turn(); // the read's end told the runner idle: an entry
    expect(h.collect).toHaveBeenCalledTimes(2);
  });
});
