// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadChunk } from './load-chunk';

const failed = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/ProjectView-old.js'));
const reload = vi.fn();
beforeEach(() => {
  sessionStorage.clear();
  reload.mockClear();
  vi.stubGlobal('location', { reload });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('a lazy chunk lost across a deploy', () => {
  it.each([
    'Failed to fetch dynamically imported module: /assets/old.js', // Chromium
    'Importing a module script failed.', // Safari (home-screen app)
    'error loading dynamically imported module: /assets/old.js', // Firefox
    'Unable to preload CSS for /assets/old.css', // Vite
  ])('reloads the current URL once for %s, keeping Suspense pending during navigation', async (message) => {
    const settled = vi.fn();
    void loadChunk('project', () => Promise.reject(new TypeError(message))).then(settled, settled);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(settled).not.toHaveBeenCalled();
  });

  it('keeps its guard across a fresh JS instance and unrelated successful imports; a second failure cannot loop', async () => {
    void loadChunk('project', failed).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    vi.resetModules(); // full page reload, but the tab keeps sessionStorage
    const nextPage = await import('./load-chunk');
    expect(await nextPage.loadChunk('dialog', async () => 'dialog')).toBe('dialog');
    await expect(nextPage.loadChunk('project', failed)).rejects.toThrow('dynamically imported');
    await expect(nextPage.loadChunk('depth', failed)).rejects.toThrow('dynamically imported');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('rearms only after the failed import succeeds, so a later deployment can recover too', async () => {
    void loadChunk('project', failed).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await loadChunk('project', async () => 'current build')).toBe('current build');
    void loadChunk('depth', failed).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('never reloads without a durable guard or for an application error', async () => {
    await expect(loadChunk('project', () => Promise.reject(new Error('render bug')))).rejects.toThrow('render bug');
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => { throw new Error('storage disabled'); } });
    await expect(loadChunk('project', failed)).rejects.toThrow('dynamically imported');
    expect(reload).not.toHaveBeenCalled();
  });
});
