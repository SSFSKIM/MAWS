// The library's side of main (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M1): the derived index (the index's
// `LibraryStore`, migration 9) kept right by the sync over the engine host's library reads, `library.list`, `.get` and
// `.spaces` answered from it, and `library.changed` told once per tick after the index committed a change. Main never
// opens the host's `store.sqlite`. Started after the index opens and before the first window loads.
import type { EventName, EventPayload } from '@shared/ipc/schema';
import type { Index } from '../index/index';
import type { registerMainHandler } from '../ipc/router';
import { registerLibraryHandlers } from './register';
import { hostLibrarySource, type LibraryHost } from './source';
import { LibrarySync } from './sync';

export interface LibraryDeps {
  index: Pick<Index, 'library' | 'unavailable'>;
  hosts: LibraryHost;
  register: typeof registerMainHandler;
  emit: <N extends EventName>(name: N, payload: EventPayload<N>) => boolean;
  tickMs?: number; // library.changed coalescing; 16 ms
}

const TICK_MS = 16;

export function startLibrary({ index, hosts, register, emit, tickMs = TICK_MS }: LibraryDeps): { stop(): void } {
  registerLibraryHandlers(index, register);
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
  const sync = new LibrarySync(index.library, hostLibrarySource(hosts));
  sync.start();
  return {
    stop: () => {
      sync.stop();
      offChange();
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
