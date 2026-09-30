import { describe, expect, it, vi } from 'vitest';
import type { CommandResult, HostState, Settings } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V4 } from '@shared/settings/defaults';
import { startEngineConfigure, type EngineConfigureDeps } from './engine-configure';

const INFO = { path: '/Users/new/.local/share/claude/versions/2.1.283', expectedVersion: '2.1.283', version: '2.1.283', ok: true, error: null };
const host = (state: HostState['state']): HostState => ({ state, pid: state === 'ready' ? 1 : null, restarts: 0, revision: 0 });

// C12: the owner's Mac, 32 GiB: 25% is 8 GiB
const TOTAL_MEM = 32 * 1024 ** 3;
const DEFAULT_LIMIT_KIB = 8 * 1024 * 1024;

function harness(initial: HostState['state'] = 'starting', dispatch?: EngineConfigureDeps['dispatch']) {
  let settings: Settings = SETTINGS_DEFAULTS_V4;
  const settingsListeners = new Set<(s: Settings) => void>();
  const stateListeners = new Set<(s: HostState) => void>();
  let current = host(initial);
  const deps: EngineConfigureDeps = {
    settings: () => settings,
    onSettingsChanged: (l) => (settingsListeners.add(l), () => void settingsListeners.delete(l)),
    hostState: () => current,
    onHostState: (l) => (stateListeners.add(l), () => void stateListeners.delete(l)),
    dispatch: dispatch ?? vi.fn(async (): Promise<CommandResult<'engine.configure'>> => ({ ok: true, value: INFO })),
    // C12 start
    dispatchPolicy: vi.fn(async (policy): Promise<CommandResult<'engine.policy.set'>> => ({ ok: true, value: { limitKiB: policy.limitKiB, totalKiB: 0, sampledAt: null, over: false, overWithoutCandidate: false, candidates: 0, settling: 0, releasing: null, blocked: [], lastRelease: null } })),
    totalMemBytes: TOTAL_MEM,
    // C12 end
  };
  const stop = startEngineConfigure(deps);
  return {
    dispatch: deps.dispatch as ReturnType<typeof vi.fn>,
    policy: deps.dispatchPolicy as ReturnType<typeof vi.fn>, // C12
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
    h.change({ ...SETTINGS_DEFAULTS_V4, theme: 'dark', gateway: { ...SETTINGS_DEFAULTS_V4.gateway, relayUnreachable: 'wait' } });
    h.change({ ...SETTINGS_DEFAULTS_V4, engine: { ...SETTINGS_DEFAULTS_V4.engine, subagentModel: 'haiku' } }); // C10's launch reads it, not the host
    expect(h.dispatch).toHaveBeenCalledOnce();
    h.change({ ...SETTINGS_DEFAULTS_V4, engine: { ...SETTINGS_DEFAULTS_V4.engine /* C12 */, binaryPath: '/opt/claude', pinnedVersion: '2.1.283', subagentModel: null } });
    h.change({ ...SETTINGS_DEFAULTS_V4, engine: { ...SETTINGS_DEFAULTS_V4.engine /* C12 */, binaryPath: '/opt/claude', pinnedVersion: '2.1.290', subagentModel: null } });
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

// C12 start: the memory budget's policy (C12 execution document, Interfaces "Settings, version 4"): pushed whenever the
// host is ready and whenever the budget or the stateful list changes; the default is 25% of physical memory.
describe('engine.policy.set follows settings.engine’s budget and stateful servers', () => {
  const engine = (over: Partial<Settings['engine']>): Settings => ({ ...SETTINGS_DEFAULTS_V4, engine: { ...SETTINGS_DEFAULTS_V4.engine, ...over } });

  it('pushes the default (25% of physical memory, no stateful servers) once the host is ready, and again after a restart', () => {
    const h = harness('starting');
    expect(h.policy).not.toHaveBeenCalled();
    h.moveHost('ready');
    expect(h.policy).toHaveBeenCalledExactlyOnceWith({ limitKiB: DEFAULT_LIMIT_KIB, statefulMcpServers: [] });
    h.moveHost('crashed');
    h.moveHost('ready');
    expect(h.policy).toHaveBeenCalledTimes(2);
  });

  it('pushes at once when the host is already ready', () => {
    expect(harness('ready').policy).toHaveBeenCalledOnce();
  });

  it('pushes on a change of the budget or the stateful list, in KiB, and on nothing else', () => {
    const h = harness('ready');
    h.change({ ...SETTINGS_DEFAULTS_V4, theme: 'dark' });
    h.change(engine({ subagentModel: 'haiku' }));
    h.change(engine({ binaryPath: '/opt/claude' })); // the binary's own push, not the policy's
    expect(h.policy).toHaveBeenCalledOnce();
    h.change(engine({ binaryPath: '/opt/claude', memoryBudgetMiB: 6144 }));
    h.change(engine({ binaryPath: '/opt/claude', memoryBudgetMiB: 6144, statefulMcpServers: ['c12-kernel'] }));
    h.change(engine({ binaryPath: '/opt/claude', memoryBudgetMiB: 6144, statefulMcpServers: ['c12-kernel'] })); // the same again
    h.change(engine({ binaryPath: '/opt/claude', memoryBudgetMiB: null, statefulMcpServers: ['c12-kernel'] }));
    expect(h.policy.mock.calls).toEqual([
      [{ limitKiB: DEFAULT_LIMIT_KIB, statefulMcpServers: [] }],
      [{ limitKiB: 6144 * 1024, statefulMcpServers: [] }],
      [{ limitKiB: 6144 * 1024, statefulMcpServers: ['c12-kernel'] }],
      [{ limitKiB: DEFAULT_LIMIT_KIB, statefulMcpServers: ['c12-kernel'] }],
    ]);
  });

  it('logs a refused push and keeps going', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness('starting');
    h.policy.mockResolvedValueOnce({ ok: false, error: { code: 'host_unavailable', message: 'engine-host is crashed' } });
    h.moveHost('ready');
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[settings] engine.policy.set failed', expect.objectContaining({ code: 'host_unavailable' })));
    h.moveHost('ready');
    expect(h.policy).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
// C12 end
