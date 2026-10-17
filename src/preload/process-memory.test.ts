// P3-E (E2 M6; parent Decision Log 42(5), E2's execution Decision Log 38): the app window's preload exposes
// `window.__maws_processMemory` only when its own `process.env.MAWS_E2E` is '1', and the getter is nothing but the
// renderer's documented `process.getProcessMemoryInfo()` (https://www.electronjs.org/docs/latest/api/process#processgetprocessmemoryinfo,
// listed in the sandboxed renderers' subset): no other process or env surface reaches the page.
import { describe, expect, it, vi } from 'vitest';
import { exposeProcessMemory, PROCESS_MEMORY_GLOBAL } from './process-memory';

const harness = (env: Record<string, string | undefined>) => {
  const exposed = new Map<string, unknown>();
  const bridge = { exposeInMainWorld: vi.fn((key: string, api: unknown) => void exposed.set(key, api)) };
  const info = { private: 345_678, shared: 12_000, residentSet: 0 };
  const getProcessMemoryInfo = vi.fn(() => Promise.resolve(info));
  exposeProcessMemory(env, bridge, getProcessMemoryInfo);
  return { exposed, bridge, getProcessMemoryInfo, info };
};

describe('the e2e-only renderer memory getter', () => {
  it('is absent in production: no MAWS_E2E, or any value but "1"', () => {
    for (const env of [{}, { MAWS_E2E: '0' }, { MAWS_E2E: 'true' }, { MAWS_E2E: '' }, { MAWS_DASHBOARD_E2E: '1' }]) {
      const h = harness(env);
      expect(h.bridge.exposeInMainWorld, JSON.stringify(env)).not.toHaveBeenCalled();
      expect(h.exposed.size).toBe(0);
    }
  });

  it('under MAWS_E2E=1 exposes one function, which answers the process’s own memory info and nothing else', async () => {
    const h = harness({ MAWS_E2E: '1' });
    expect([...h.exposed.keys()]).toEqual([PROCESS_MEMORY_GLOBAL]);
    expect(PROCESS_MEMORY_GLOBAL).toBe('__maws_processMemory');
    const getter = h.exposed.get(PROCESS_MEMORY_GLOBAL) as (...args: unknown[]) => Promise<unknown>;
    expect(typeof getter).toBe('function');
    expect(h.getProcessMemoryInfo).not.toHaveBeenCalled(); // nothing read until asked
    await expect(getter('ignored', { env: true })).resolves.toBe(h.info);
    expect(h.getProcessMemoryInfo).toHaveBeenCalledTimes(1);
    expect(h.getProcessMemoryInfo).toHaveBeenCalledWith();
  });
});
