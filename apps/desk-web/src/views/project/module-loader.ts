// A chunk loaded once, the first time a view wants it, and shared by every view after: the session view's (DC9), whose
// view and header word draw from one load rather than two lazy components (React draws a Suspense boundary that
// follows a suspended one only on a later pre-render pass). A failed load is not kept, so a retry asks again; the view
// says what failed and offers the retry, and a reload, since a browser may keep the failed module itself (Chrome's
// module map refuses a second `import()` of the same URL without fetching it).
import { useEffect, useState } from 'react';

export type ModuleLoader<M> = { loaded(): M | null; load(): Promise<M> };

export function moduleLoader<M>(load: () => Promise<M>): ModuleLoader<M> {
  let module: M | null = null;
  let pending: Promise<M> | null = null;
  return {
    loaded: () => module,
    load: () =>
      (pending ??= load().then(
        (value) => (module = value),
        (error: unknown) => {
          pending = null;
          throw error;
        },
      )),
  };
}

/** The module once loaded; while `wanted`, it is loaded. `failed` holds why the last load failed, until `retry`. */
export function useLoadedModule<M>(loader: ModuleLoader<M>, wanted: boolean): { module: M | null; failed: string | null; retry: () => void } {
  const [module, setModule] = useState<M | null>(loader.loaded);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted || module !== null || failed !== null) return;
    let current = true;
    loader.load().then(
      (value) => current && setModule(() => value),
      (error: unknown) => current && setFailed(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      current = false;
    };
  }, [loader, wanted, module, failed]);
  return { module, failed, retry: () => setFailed(null) };
}
