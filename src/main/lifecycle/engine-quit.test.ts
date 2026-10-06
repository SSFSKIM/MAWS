import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '@shared/ipc/schema';
import { engineQuitDeps, keepRunningDefaultOf } from './engine-quit';

// The engine host's half of the quit guard (E10 execution document, §Design 5).
describe('the engine host at quit', () => {
  const settingsWith = (extra: object) => ({ version: 9, ...extra }) as unknown as Settings;
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

  it('reads the keep default from the setting at each question, true where the setting is absent', () => {
    expect(keepRunningDefaultOf(settingsWith({}))).toBe(true);
    expect(keepRunningDefaultOf(settingsWith({ supervisor: { idleExitMinutes: 10 } }))).toBe(true);
    expect(keepRunningDefaultOf(settingsWith({ supervisor: { idleExitMinutes: 10, keepRunningDefault: false } }))).toBe(false);
    let settings = settingsWith({ supervisor: { keepRunningDefault: true } });
    const deps = engineQuitDeps(hostsIn('detached'), () => settings);
    expect(deps.keepDefault()).toBe(true);
    settings = settingsWith({ supervisor: { keepRunningDefault: false } });
    expect(deps.keepDefault()).toBe(false);
  });
});
