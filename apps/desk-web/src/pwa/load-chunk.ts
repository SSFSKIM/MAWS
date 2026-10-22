// A tab can outlive the hashed assets of its build. Retry by loading the current document, once per recovery:
// the tab keeps the guard across navigation, and only the import that failed succeeding clears it. Clearing on
// boot (or another chunk's success) would loop when the broken chunk is deeper than the initial screen.
const KEY = 'desk.chunk-recovery';
const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

export async function loadChunk<T>(id: string, load: () => Promise<T>): Promise<T> {
  let loaded: T;
  try {
    loaded = await load();
  } catch (error) {
    if (error instanceof Error && CHUNK_ERROR.test(error.message)) {
      try {
        if (!sessionStorage.getItem(KEY)) {
          sessionStorage.setItem(KEY, id); // If storage is unavailable, do not risk a reload loop.
          location.reload();
          return await new Promise<T>(() => {}); // Keep Suspense, rather than unmounting the UI while navigating.
        }
      } catch { /* Keep the original import error for the boundary. */ }
    }
    throw error;
  }
  try {
    if (sessionStorage.getItem(KEY) === id) sessionStorage.removeItem(KEY);
  } catch { /* Loading succeeded even when this tab cannot use storage. */ }
  return loaded;
}
