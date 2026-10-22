// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as initial from './load-chunk';

let recovery = initial;
const reload = vi.fn();
let uninstall: (() => void) | undefined;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const failed = () => Promise.reject(new Error('a browser-specific import failure'));
async function nextPage(entry = '/assets/index-one.js') {
  uninstall?.();
  const script = document.createElement('script');
  script.src = entry;
  vi.spyOn(document, 'querySelector').mockReturnValue(script);
  vi.resetModules();
  recovery = await import('./load-chunk');
}
beforeEach(async () => {
  sessionStorage.clear();
  reload.mockClear();
  vi.stubGlobal('location', { reload });
  await nextPage();
});
afterEach(() => { uninstall?.(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('a code chunk lost across a deploy', () => {
  it.each([new TypeError('Importing a module script failed.'), new Error('new browser wording'), { arbitrary: 'rejection' }])('reloads on any import rejection, without matching its text: %s', async (error) => {
    const settled = vi.fn();
    void recovery.loadChunk(() => Promise.reject(error)).then(settled, settled);
    await tick();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(settled).not.toHaveBeenCalled(); // Keep Suspense while the new document loads.
  });

  it('keeps the per-build guard across reloads and successful imports, so repeated or different failures cannot loop', async () => {
    void recovery.loadChunk(failed).catch(() => {});
    await tick();
    await nextPage();
    expect(await recovery.loadChunk(async () => 'project')).toBe('project');
    await expect(recovery.loadChunk(failed)).rejects.toThrow('browser-specific');
    await expect(recovery.loadChunk(failed)).rejects.toThrow('browser-specific');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('lets a later build recover, without forgetting a build that already failed', async () => {
    void recovery.loadChunk(failed).catch(() => {});
    await tick();
    await nextPage('/assets/index-two.js');
    void recovery.loadChunk(failed).catch(() => {});
    await tick();
    expect(reload).toHaveBeenCalledTimes(2);
    await nextPage(); // Even an old index served again cannot restart the cycle.
    await expect(recovery.loadChunk(failed)).rejects.toThrow('browser-specific');
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('handles Vite preload failures outside a lazy wrapper, suppressing the error only while reloading', async () => {
    uninstall = recovery.installChunkRecovery();
    const first = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(first);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(first.defaultPrevented).toBe(true);
    await nextPage();
    uninstall = recovery.installChunkRecovery();
    const repeated = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(repeated);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(repeated.defaultPrevented).toBe(false);
  });

  it('keeps a lazy import pending when Vite prevented its rejection during recovery', async () => {
    uninstall = recovery.installChunkRecovery();
    let resolve!: (module: string) => void;
    const settled = vi.fn();
    void recovery.loadChunk(() => new Promise<string>((done) => { resolve = done; })).then(settled, settled);
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    resolve('module');
    await tick();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(settled).not.toHaveBeenCalled();
  });

  it('never reloads without a durable guard; the original error reaches the boundary', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => { throw new Error('storage disabled'); } });
    await expect(recovery.loadChunk(failed)).rejects.toThrow('browser-specific');
    expect(reload).not.toHaveBeenCalled();
  });
});
