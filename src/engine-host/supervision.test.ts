// The supervisor's own life (E10 execution document, §Design 1 "Idle exit, and idle rows", "Stop all"; Task 2.3): the
// idle exit's clock, exit-when-idle, the idle-row release's policy, the host.* commands and the status event, over a
// fake process table and plugin runner with the clock faked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandInput, CommandName, CommandOutput } from '@shared/ipc/schema';
import type { SupervisorStatus } from '@shared/ipc/schema/host';
import { validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import { DEFAULT_IDLE_EXIT_MS, Supervision, type SupervisorExit, type SupervisorIdentity } from './supervision';

const T0 = new Date('2026-10-06T10:00:00.000Z');
const IDLE = 60_000;
const IDENTITY: SupervisorIdentity = { pid: 4321, startedAt: T0.toISOString(), buildId: '0123456789abcdef', protocol: 1, wire: 'fedcba9876543210', socketPath: null, logPath: null };
const DETACHED: SupervisorIdentity = { ...IDENTITY, socketPath: '/u/supervisor/host.sock', logPath: '/u/supervisor/host.log' };

function harness(mode: 'utility' | 'detached' = 'detached') {
  const rows: { lifecycle: 'starting' | 'initializing' | 'ready' | 'exiting' | 'exited' }[] = [];
  const statusListeners = new Set<() => void>();
  const rowListeners = new Set<() => void>();
  const releases: { idleMs: number | null; active: boolean }[] = [];
  const table = {
    list: () => rows,
    onChange: (listener: () => void) => (statusListeners.add(listener), () => statusListeners.delete(listener)),
    onRowsChanged: (listener: () => void) => (rowListeners.add(listener), () => rowListeners.delete(listener)),
    setIdleRelease: (policy: { idleMs: number | null; active: boolean }) => void releases.push({ ...policy }),
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
    mode, identity: IDENTITY, table: table as never,
    plugins: { busy: () => plugins.held, onIdle: (listener) => (plugins.idle.add(listener), () => plugins.idle.delete(listener)) },
    shutdown,
    emit: (status) => {
      const checked = validateEventPayload('host.supervisorStatus', status);
      if (!checked.ok) throw new Error(`invalid host.supervisorStatus: ${JSON.stringify(checked.issues)}`);
      emitted.push(status);
      return true;
    },
    log: (line) => void lines.push(line),
  });
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const hooks: (() => void)[] = [];
  supervision.register((name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>), { onConnect: (hook) => void hooks.push(hook) });
  const call = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> => {
    const value = await handlers.get(name)!(input);
    const checked = validateCommandOutput(name, value);
    if (!checked.ok) throw new Error(`invalid output of ${name}: ${checked.error.message}`);
    return checked.value;
  };
  const exits: SupervisorExit[] = [];
  const start = () => supervision.started(DETACHED, (reason) => void exits.push(reason));
  const launch = () => {
    rows.push({ lifecycle: 'ready' });
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
  return { supervision, rows, releases, plugins, emitted, lines, shutdown, shutdowns: () => shutdowns, handlers, hooks, call, exits, start, launch, exitRow, pluginsIdle };
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
    await expect(h.handlers.get('host.exitWhenIdle')!({ armed: true })).rejects.toMatchObject({ ipcError: { code: 'internal' } });
  });
});

describe('the idle-row release’s policy', () => {
  it('is active while no client is connected or exit-when-idle is armed, with the idle time; never in utility mode', async () => {
    const h = harness();
    expect(h.releases.at(-1)).toEqual({ idleMs: DEFAULT_IDLE_EXIT_MS, active: true });
    h.start();
    h.supervision.clientChanged(true);
    expect(h.releases.at(-1)).toEqual({ idleMs: DEFAULT_IDLE_EXIT_MS, active: false });
    await h.call('host.configure', { idleExitMs: IDLE });
    expect(h.releases.at(-1)).toEqual({ idleMs: IDLE, active: false });
    h.supervision.armExitWhenIdle(true);
    expect(h.releases.at(-1)).toEqual({ idleMs: IDLE, active: true }); // even with the client there
    h.supervision.armExitWhenIdle(false);
    h.supervision.clientChanged(false);
    expect(h.releases.at(-1)).toEqual({ idleMs: IDLE, active: true });
    const count = h.releases.length;
    h.launch();
    h.exitRow();
    expect(h.releases).toHaveLength(count); // set on a change of policy only
    const utility = harness('utility');
    utility.supervision.clientChanged(false);
    expect(utility.releases.every((policy) => !policy.active)).toBe(true);
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
    const answered = h.call('host.stopAll', { graceMs: 5000 });
    let answer: unknown = null;
    void answered.then((value) => (answer = value));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(answer).toEqual({ stopped: 2, forced: 0 });
    expect(h.exits).toEqual([]); // the runtime posts the answer before the exit runs
    expect(h.shutdown).toHaveBeenCalledExactlyOnceWith(5000);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.exits).toEqual(['stopAll']);
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
  it('answers the status and emits it on every change, never twice the same, and always in the connect burst', async () => {
    const h = harness();
    h.start();
    h.supervision.clientChanged(true);
    const status = await h.call('host.supervisorStatus', undefined);
    expect(status).toEqual({ mode: 'detached', ...DETACHED, liveSessions: 0, rows: 0, idleExitMs: DEFAULT_IDLE_EXIT_MS, idleExitAt: null, exitWhenIdle: false, orphansKilled: 0 });
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
});
