// P5 O5 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §E): main's entry runs the bootstrap every mode
// shares, in today's order and before any root loads, then loads the app's root.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const order: string[] = [];
vi.mock('electron', () => ({
  app: {
    setPath: (name: string, path: string) => order.push(`setPath ${name} ${path}`),
    commandLine: { appendSwitch: (name: string) => order.push(`switch ${name}`), getSwitchValue: () => '' },
  },
}));
vi.mock('./stdio-guard', () => ({ guardStdio: () => order.push('guardStdio') }));
vi.mock('./chromium-features', () => ({ STARTUP_DISABLED_FEATURES: [], disableChromiumFeatures: () => order.push('disableChromiumFeatures') }));
vi.mock('./artifacts/protocol', () => ({ registerStoreSchemes: () => order.push('registerStoreSchemes') }));
vi.mock('./app', () => {
  order.push('app');
  return {};
});

describe("main's entry", () => {
  const env = { ...process.env };
  beforeEach(() => {
    order.length = 0;
    vi.resetModules();
    process.env.MAWS_USER_DATA = '/scratch/profile';
    process.env.MAWS_E2E = '1';
  });
  const listeners = process.listeners('SIGUSR1');
  afterEach(() => {
    process.env = { ...env };
    for (const listener of process.listeners('SIGUSR1')) if (!listeners.includes(listener)) process.off('SIGUSR1', listener);
  });

  it('runs the shared bootstrap, then loads the app root', async () => {
    await import('./index');
    await vi.waitFor(() => expect(order).toContain('app'));
    expect(order).toEqual(['guardStdio', 'setPath userData /scratch/profile', 'switch use-mock-keychain', 'disableChromiumFeatures', 'registerStoreSchemes', 'app']);
    expect(process.listenerCount('SIGUSR1')).toBe(listeners.length + 1); // the inspector refusal
  });
});
