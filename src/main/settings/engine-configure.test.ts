import { describe, expect, it, vi } from 'vitest';
import type { CommandResult, HostState, Settings } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V3 } from '@shared/settings/defaults';
import { startEngineConfigure, type EngineConfigureDeps } from './engine-configure';

const INFO = { path: '/Users/new/.local/share/claude/versions/2.1.283', expectedVersion: '2.1.283', version: '2.1.283', ok: true, error: null };
const host = (state: HostState['state']): HostState => ({ state, pid: state === 'ready' ? 1 : null, restarts: 0, revision: 0 });

function harness(initial: HostState['state'] = 'starting', dispatch?: EngineConfigureDeps['dispatch']) {
  let settings: Settings = SETTINGS_DEFAULTS_V3;
  const settingsListeners = new Set<(s: Settings) => void>();
  const stateListeners = new Set<(s: HostState) => void>();
  let current = host(initial);
  const deps: EngineConfigureDeps = {
    settings: () => settings,
    onSettingsChanged: (l) => (settingsListeners.add(l), () => void settingsListeners.delete(l)),
    hostState: () => current,
    onHostState: (l) => (stateListeners.add(l), () => void stateListeners.delete(l)),
    dispatch: dispatch ?? vi.fn(async (): Promise<CommandResult<'engine.configure'>> => ({ ok: true, value: INFO })),
  };
  const stop = startEngineConfigure(deps);
  return {
    dispatch: deps.dispatch as ReturnType<typeof vi.fn>,
    stop,
    change(next: Settings) {
      settings = next;
      settingsListeners.forEach((l) => l(next));
    },
    moveHost(state: HostState['state']) {
      current = host(state);
      stateListeners.forEach((l) => l(current));
    },
    listeners: () => settingsListeners.size + stateListeners.size,
  };
}

describe('engine.configure is sent after the settings load and on every change of settings.engine', () => {
  it('sends the configuration once the engine host is ready, and again each time it is ready after a restart', () => {
    const h = harness('starting');
    expect(h.dispatch).not.toHaveBeenCalled();
    h.moveHost('ready');
    expect(h.dispatch).toHaveBeenCalledExactlyOnceWith({ binaryPath: null, expectedVersion: '2.1.283' });
    h.moveHost('crashed');
    h.moveHost('restarting');
    h.moveHost('ready');
    expect(h.dispatch).toHaveBeenCalledTimes(2); // a restarted host starts unconfigured
  });

  it('sends at once when the host is already ready', () => {
    expect(harness('ready').dispatch).toHaveBeenCalledOnce();
  });

  it('sends on a change of the binary path or the pin, and not on any other change', () => {
    const h = harness('ready');
    h.change({ ...SETTINGS_DEFAULTS_V3, theme: 'dark', gateway: { ...SETTINGS_DEFAULTS_V3.gateway, relayUnreachable: 'wait' } });
    h.change({ ...SETTINGS_DEFAULTS_V3, engine: { ...SETTINGS_DEFAULTS_V3.engine, subagentModel: 'haiku' } }); // C10's launch reads it, not the host
    expect(h.dispatch).toHaveBeenCalledOnce();
    h.change({ ...SETTINGS_DEFAULTS_V3, engine: { binaryPath: '/opt/claude', pinnedVersion: '2.1.283', subagentModel: null } });
    h.change({ ...SETTINGS_DEFAULTS_V3, engine: { binaryPath: '/opt/claude', pinnedVersion: '2.1.290', subagentModel: null } });
    expect(h.dispatch.mock.calls).toEqual([
      [{ binaryPath: null, expectedVersion: '2.1.283' }],
      [{ binaryPath: '/opt/claude', expectedVersion: '2.1.283' }],
      [{ binaryPath: '/opt/claude', expectedVersion: '2.1.290' }],
    ]);
  });

  it('logs a refused or failed send and keeps going; stop unsubscribes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dispatch = vi.fn(async (): Promise<CommandResult<'engine.configure'>> => ({ ok: false, error: { code: 'host_unavailable', message: 'engine-host is crashed' } }));
    const h = harness('ready', dispatch);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[settings] engine.configure failed', expect.objectContaining({ code: 'host_unavailable' })));
    dispatch.mockRejectedValueOnce(new Error('port closed'));
    h.moveHost('ready');
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[settings] engine.configure failed', expect.any(Error)));
    h.stop();
    expect(h.listeners()).toBe(0);
    warn.mockRestore();
  });
});
