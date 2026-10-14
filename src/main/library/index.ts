// The library's side of main (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M1): the derived index (the index's
// `LibraryStore`, migration 9) kept right by the sync over the engine host's library reads, `library.list`, `.get` and
// `.spaces` answered from it, and `library.changed` told once per tick after the index committed a change. Main never
// opens the host's `store.sqlite`. Started after the index opens and before the first window loads.
import type { EventName, EventPayload } from '@shared/ipc/schema';
import type { Index } from '../index/index';
import type { registerMainHandler } from '../ipc/router';
import { registerLibraryFiles, type LibraryFilesDeps } from './files';
import { registerLibraryHandlers } from './register';
import { hostLibrarySource, type LibraryHost } from './source';
import { LibrarySync } from './sync';

export interface LibraryDeps {
  index: Pick<Index, 'library' | 'unavailable'>;
  hosts: LibraryHost;
  register: typeof registerMainHandler;
  emit: <N extends EventName>(name: N, payload: EventPayload<N>) => boolean;
  tickMs?: number; // library.changed coalescing; 16 ms
  settleMs?: number; // the text's settle (sync.ts's TEXT_SETTLE_MS)
  e2e?: boolean; // MAWS_E2E=1: installs the seam below
  files?: LibraryFilesDeps; // M5b: the viewers' and the library's reach to a byte kind's stored file (files.ts)
}

// The end-to-end seam (MAWS_E2E=1 only), read in main by `app.evaluate` (e2e/library.spec.ts): main's library stops
// following change events until the next host connection (sync.ts's `holdRefreshes`).
export interface LibraryE2eSeam {
  holdRefreshes(): Promise<void>;
}
type SeamGlobal = { __maws_library?: LibraryE2eSeam };

const TICK_MS = 16;

export function startLibrary({ index, hosts, register, emit, tickMs = TICK_MS, settleMs, e2e = false, files }: LibraryDeps): { stop(): void } {
  registerLibraryHandlers(index, register);
  if (files) registerLibraryFiles(register, files); // the store's files, whatever the index's state
  if (index.unavailable !== null) {
    console.warn(`[library] the index is unavailable (${index.unavailable}); the library answers empty and follows no host change this run`);
    return { stop: () => {} };
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const offChange = index.library.onChange(() => {
    timer ??= setTimeout(() => {
      timer = null;
      emit('library.changed', { revision: index.library.revision });
    }, tickMs);
  });
  const sync = new LibrarySync(index.library, hostLibrarySource(hosts), { settleMs });
  sync.start();
  if (e2e) (globalThis as SeamGlobal).__maws_library = { holdRefreshes: () => sync.holdRefreshes() };
  return {
    stop: () => {
      if (e2e) delete (globalThis as SeamGlobal).__maws_library;
      sync.stop();
      offChange();
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
