// A tab can outlive its build's hashed assets. Reload at most once per entry URL in this tab, regardless of
// which chunk failed. Keep each build's marker: even alternating stale indexes must not make a reload loop.
let reloading = false;
function reloadBuild(): boolean {
  if (reloading) return true;
  try {
    const entry = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src ?? 'unknown';
    const key = `desk.chunk-recovery:${entry}`;
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1'); // Without a durable guard, fail visibly rather than loop.
    location.reload();
    reloading = true;
    return true;
  } catch { return false; }
}

/** Vite emits this for JS imports and CSS preloads, including imports outside the lazy views below. */
export function installChunkRecovery(): () => void {
  const onError = (event: Event) => { if (reloadBuild()) event.preventDefault(); };
  window.addEventListener('vite:preloadError', onError);
  return () => window.removeEventListener('vite:preloadError', onError);
}

/** Any rejected import is recoverable once; browser error wording is not an interface. */
export async function loadChunk<T>(load: () => Promise<T>): Promise<T> {
  try {
    const loaded = await load();
    // A prevented Vite preload error can resolve to undefined. Keep Suspense until navigation completes.
    return reloading ? await new Promise<T>(() => {}) : loaded;
  } catch (error) {
    if (reloadBuild()) return await new Promise<T>(() => {});
    throw error;
  }
}
