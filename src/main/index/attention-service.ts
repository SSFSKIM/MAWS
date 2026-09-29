// C3's attention service over the index (C4 execution document, Interfaces "Index": `Index.attention` implements C3's
// `AttentionStore` port). The service is C3's, unchanged; this starts it with the index as its store, and answers C3's
// ask that attention retires on the archive path: an archive the index records — `session.update { archived: true }`,
// or a transcript removed from disk — reaches the service as the `session.forgotten` the engine host sends when it
// archives a live session, so the service retires the session in memory, in the renderer and in the store at once. An
// index this app cannot read (a newer version's) leaves the items to C3's file store, as before the index existed.
import type { AppSessionId } from '@shared/graph/ids';
import type { EventPayload } from '@shared/ipc/schema';
import { FileAttentionStore } from '../attention/file-attention-store';
import { startAttentionService, type AttentionService, type AttentionServiceDeps } from '../attention/service';
import type { Index } from './index';

type Forgotten = (payload: EventPayload<'session.forgotten'>) => void;

export function startIndexAttention(index: Index, deps: Omit<AttentionServiceDeps, 'store'> & { fallbackFile: string }): AttentionService {
  const { fallbackFile, ...serviceDeps } = deps;
  const forgotten = new Set<Forgotten>();
  const onEvent: AttentionServiceDeps['onEvent'] = (name, listener) => {
    const off = deps.onEvent(name, listener);
    if (name !== 'session.forgotten') return off;
    forgotten.add(listener as Forgotten);
    return () => {
      off();
      forgotten.delete(listener as Forgotten);
    };
  };
  const usable = index.unavailable === null;
  const service = startAttentionService({ ...serviceDeps, onEvent, store: usable ? index.attention : new FileAttentionStore(fallbackFile) });
  if (!usable) return service;

  // Archive transitions, from the records as the index commits them; one already archived at start is not retired again.
  const archived = new Set<AppSessionId>(index.sessions.list({ includeArchived: true }).flatMap((record) => (record.archived ? [record.appId] : [])));
  const offChange = index.sessions.onChange((record) => {
    if (!record.archived) {
      archived.delete(record.appId);
      return;
    }
    if (archived.has(record.appId)) return;
    archived.add(record.appId);
    for (const listener of forgotten) listener({ appSessionId: record.appId });
  });
  return {
    ...service,
    stop: () => {
      offChange();
      service.stop();
    },
  };
}
