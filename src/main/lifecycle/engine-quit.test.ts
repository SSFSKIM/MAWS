import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V10 } from '@shared/settings/defaults';
import { engineQuitDeps } from './engine-quit';

// The engine host's half of the quit guard (E10 execution document, §Design 5).
describe('the engine host at quit', () => {
  const settingsWith = (extra: Partial<Settings>): Settings => ({ ...SETTINGS_DEFAULTS_V10, ...extra });
  const hostsIn = (transport: 'utility' | 'detached') => ({ stopAllForQuit: vi.fn<(graceMs: number) => Promise<void>>(async () => {}), facts: vi.fn(() => ({ transport })) });

  it('stops every session through the quit’s stop-all with the 5 s grace, in either mode', async () => {
    for (const transport of ['utility', 'detached'] as const) {
      const hosts = hostsIn(transport);
      await engineQuitDeps(hosts, () => settingsWith({})).shutdownEngine();
      expect(hosts.stopAllForQuit).toHaveBeenCalledExactlyOnceWith(5_000);
    }
  });

  it('offers keep only when the engine host runs detached', () => {
    expect(engineQuitDeps(hostsIn('detached'), () => settingsWith({})).keepOffered()).toBe(true);
    expect(engineQuitDeps(hostsIn('utility'), () => settingsWith({})).keepOffered()).toBe(false);
  });

  it('reads the keep default from settings version 10 at each question, keep by default', () => {
    let settings = settingsWith({});
    const deps = engineQuitDeps(hostsIn('detached'), () => settings);
    expect(deps.keepDefault()).toBe(true);
    settings = settingsWith({ supervisor: { idleExitMinutes: 10, keepRunningDefault: false } });
    expect(deps.keepDefault()).toBe(false);
    settings = settingsWith({ supervisor: { idleExitMinutes: null, keepRunningDefault: true } });
    expect(deps.keepDefault()).toBe(true);
  });
});
