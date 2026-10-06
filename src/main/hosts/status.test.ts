// E10 Task 2.3b: `host.status`, composed in main from the supervisor's last status and main's own facts, and the two
// actions behind it (`host.restart`, `host.openLog`).
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: vi.fn() } }));

import { SOCKET_PROTOCOL } from '@shared/host/socket-protocol';
import type { CommandResult, HostState } from '@shared/ipc/schema';
import type { HostStatus, SupervisorStatus } from '@shared/ipc/schema/host';
import { validateEventPayload } from '@shared/ipc/validate';
import { CommandFailure } from '../ipc/router';
import type { HostFacts } from './supervisor';
import { startHostStatus, type HostStatusDeps } from './status';

const APP_BUILD = 'b0b0b0b0b0b0b0b0';
const APP_WIRE = 'w1w1w1w1w1w1w1w1';

const supervisorStatus = (over: Partial<SupervisorStatus> = {}): SupervisorStatus => ({
  mode: 'detached', pid: 4242, startedAt: '2026-10-06T10:00:00.000Z', buildId: APP_BUILD, protocol: SOCKET_PROTOCOL, wire: APP_WIRE,
  liveSessions: 2, rows: 3, idleExitMs: 600_000, idleExitAt: null, exitWhenIdle: false,
  socketPath: '/u/supervisor/host.sock', logPath: '/u/supervisor/host.log', orphansKilled: 0, ...over,
});

function harness(transport: HostFacts['transport'] = 'detached') {
  let state: HostState = { state: 'starting', pid: null, restarts: 0, revision: 0 };
  let facts: HostFacts = { transport, reason: null, refused: null, waitingLiveSessions: null, lastExit: null };
  const stateListeners = new Set<(s: HostState) => void>();
  const eventListeners = new Set<(s: SupervisorStatus) => void>();
  const handlers = new Map<string, (input: unknown) => unknown>();
  const emitted: HostStatus[] = [];
  const restartSupervisor = vi.fn(async (): Promise<CommandResult<'host.restart'>> => ({ ok: true, value: undefined }));
  const openPath = vi.fn<(path: string) => Promise<string>>(async () => '');
  const deps: HostStatusDeps = {
    hosts: {
      snapshot: () => state,
      onState: (_owner, l) => (stateListeners.add(l), () => void stateListeners.delete(l)),
      onEvent: ((_name: string, l: (s: SupervisorStatus) => void) => (eventListeners.add(l), () => void eventListeners.delete(l))) as HostStatusDeps['hosts']['onEvent'],
      facts: () => facts,
      restartSupervisor,
    },
    appBuildId: () => APP_BUILD,
    appWire: () => APP_WIRE,
    logPath: () => (transport === 'detached' ? '/u/supervisor/host.log' : null),
    emit: (status) => void emitted.push(status),
    register: ((name: string, handler: (input: unknown) => unknown) => void handlers.set(name, handler)) as HostStatusDeps['register'],
    openPath,
  };
  const service = startHostStatus(deps);
  return {
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
    status(next: SupervisorStatus) {
      eventListeners.forEach((l) => l(next));
    },
    listeners: () => stateListeners.size + eventListeners.size,
  };
}

describe('host.status', () => {
  it('answers with no supervisor while none has reported, and is emitted at every transition', async () => {
    const h = harness();
    await expect(h.call('host.status')).resolves.toEqual({
      transport: 'detached', state: 'starting', supervisor: null, appBuildId: APP_BUILD, appWire: APP_WIRE, matches: null, reason: null, waitingLiveSessions: null, lastExit: null,
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
    h.status(supervisorStatus({ wire: 'other' }));
    expect(h.emitted.at(-1)?.matches).toBe('wire');
    h.status(supervisorStatus({ protocol: SOCKET_PROTOCOL + 1 }));
    expect(h.emitted.at(-1)?.matches).toBe('protocol');
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

  it('a utility host reports its own transport', async () => {
    const h = harness('utility');
    h.move({ state: 'ready', pid: 9 });
    h.status(supervisorStatus({ mode: 'utility', socketPath: null, logPath: null }));
    await expect(h.call('host.status')).resolves.toMatchObject({ transport: 'utility', supervisor: { mode: 'utility' }, matches: 'same' });
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
