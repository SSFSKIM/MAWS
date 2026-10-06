// E10 Task 2.3b: main pushes the supervisor's idle time (`host.configure`) at every ready, as engine.configure is.
import { describe, expect, it, vi } from 'vitest';
import type { CommandResult, HostState, Settings } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V9 } from '@shared/settings/defaults';
import { DEFAULT_IDLE_EXIT_MS, idleExitMsOf, startHostConfigure, type HostConfigureDeps } from './host-configure';

const host = (state: HostState['state']): HostState => ({ state, pid: state === 'ready' ? 1 : null, restarts: 0, revision: 0 });

// Settings version 10 (M3) adds `supervisor`; until then the push reads it when present and defaults otherwise.
const withIdle = (idleExitMinutes: number | null): Settings => ({ ...SETTINGS_DEFAULTS_V9, supervisor: { idleExitMinutes, keepRunningDefault: true } }) as Settings;

function harness(initial: HostState['state'], env: Record<string, string | undefined> = {}, settings: Settings = SETTINGS_DEFAULTS_V9) {
  let current = host(initial);
  let now = settings;
  const settingsListeners = new Set<(s: Settings) => void>();
  const stateListeners = new Set<(s: HostState) => void>();
  const dispatch = vi.fn(async (): Promise<CommandResult<'host.configure'>> => ({ ok: true, value: undefined }));
  const deps: HostConfigureDeps = {
    settings: () => now,
    onSettingsChanged: (l) => (settingsListeners.add(l), () => void settingsListeners.delete(l)),
    hostState: () => current,
    onHostState: (l) => (stateListeners.add(l), () => void stateListeners.delete(l)),
    dispatch,
    env,
  };
  const stop = startHostConfigure(deps);
  return {
    dispatch,
    stop,
    moveHost(state: HostState['state']) {
      current = host(state);
      stateListeners.forEach((l) => l(current));
    },
    change(next: Settings) {
      now = next;
      settingsListeners.forEach((l) => l(next));
    },
    listeners: () => settingsListeners.size + stateListeners.size,
  };
}

describe('the idle time main pushes', () => {
  it('is the setting in minutes, null for never, and 10 minutes while settings carry no supervisor section', () => {
    expect(idleExitMsOf(withIdle(3), {})).toBe(180_000);
    expect(idleExitMsOf(withIdle(null), {})).toBeNull();
    expect(idleExitMsOf(SETTINGS_DEFAULTS_V9, {})).toBe(DEFAULT_IDLE_EXIT_MS);
    expect(DEFAULT_IDLE_EXIT_MS).toBe(600_000);
  });

  it('is MAWS_E2E_SUPERVISOR_IDLE_MS under the e2e harness, in place of the setting; ignored elsewhere or when not a positive integer', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(idleExitMsOf(withIdle(null), { MAWS_E2E: '1', MAWS_E2E_SUPERVISOR_IDLE_MS: '1500' })).toBe(1_500);
    expect(idleExitMsOf(withIdle(3), { MAWS_E2E_SUPERVISOR_IDLE_MS: '1500' })).toBe(180_000);
    expect(idleExitMsOf(withIdle(3), { MAWS_E2E: '1', MAWS_E2E_SUPERVISOR_IDLE_MS: 'soon' })).toBe(180_000);
    expect(idleExitMsOf(withIdle(3), { MAWS_E2E: '1', MAWS_E2E_SUPERVISOR_IDLE_MS: '0' })).toBe(180_000);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('host.configure is pushed at every ready and on a change of the idle time', () => {
  it('pushes once the engine host is ready, and again at each ready after a restart or reconnect', () => {
    const h = harness('starting', {}, withIdle(5));
    expect(h.dispatch).not.toHaveBeenCalled();
    h.moveHost('ready');
    expect(h.dispatch).toHaveBeenCalledExactlyOnceWith({ idleExitMs: 300_000 });
    h.moveHost('restarting');
    h.moveHost('ready');
    expect(h.dispatch).toHaveBeenCalledTimes(2);
  });

  it('pushes at once when the host is already ready', () => {
    expect(harness('ready').dispatch).toHaveBeenCalledExactlyOnceWith({ idleExitMs: DEFAULT_IDLE_EXIT_MS });
  });

  it('pushes on a change of the idle time while ready, not on any other change, and not while the host is away', () => {
    const h = harness('ready', {}, withIdle(5));
    h.change({ ...withIdle(5), theme: 'dark' });
    expect(h.dispatch).toHaveBeenCalledOnce();
    h.change(withIdle(null));
    expect(h.dispatch).toHaveBeenLastCalledWith({ idleExitMs: null });
    h.moveHost('restarting');
    h.change(withIdle(7));
    expect(h.dispatch).toHaveBeenCalledTimes(2);
    h.moveHost('ready'); // the change reaches the next host at its ready
    expect(h.dispatch).toHaveBeenLastCalledWith({ idleExitMs: 420_000 });
  });

  it('logs a refused push and keeps going; stop unsubscribes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness('starting');
    h.dispatch.mockResolvedValueOnce({ ok: false, error: { code: 'host_unavailable', message: 'gone' } });
    h.moveHost('ready');
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[settings] host.configure failed', expect.objectContaining({ code: 'host_unavailable' })));
    h.stop();
    expect(h.listeners()).toBe(0);
    warn.mockRestore();
  });
});
