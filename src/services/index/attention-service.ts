// C3's attention service over the index (C4 execution document, Interfaces "Index": `Index.attention` implements C3's
// `AttentionStore` port). The service is C3's, unchanged; this starts it with the index as its store, and answers C3's
// ask that attention retires on the archive path: an archive the index records — `session.update { archived: true }`,
// or a transcript removed from disk — reaches the service as the `session.forgotten` the engine host sends when it
// archives a live session, so the service retires the session in memory, in the renderer and in the store at once. An
// index this app cannot read (a newer version's) leaves the items to C3's file store, as before the index existed.
// The owner's ruling (2026-10-30): the service reads "seen" from the index's unread rule (IndexSessionSource): a
// session a client shows is being seen now (`seenNow`, which records that look as the record's last-seen mark, so it
// outlasts the reader), else it was last seen at its record's `lastSeen.at` (set when a client starts showing it, at
// each transcript advance while one does, by `seenNow`, and by Mark all read); each move of that mark reaches the
// service as `seen`, which retires the errors it covers. `seenNow`'s write reaches `seen` synchronously, inside the
// service's derive or load: `seen` retires only the open errors at or before the mark, from a copy of the session's items.
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { EventPayload } from '@shared/ipc/schema';
import { FileAttentionStore } from '../attention/file-attention-store';
import { startAttentionService, type AttentionService, type AttentionServiceDeps } from '../attention/service';
import type { Index } from './index';

type Forgotten = (payload: EventPayload<'session.forgotten'>) => void;

const lastSeenOf = (record: SessionRecord | null): number | null => (record?.lastSeen.at ? Date.parse(record.lastSeen.at) : null);

export function startIndexAttention(index: Index, deps: Omit<AttentionServiceDeps, 'store' | 'seenAt'> & { fallbackFile: string; seenNow?: (appSessionId: AppSessionId) => boolean }): AttentionService {
  const { fallbackFile, seenNow, ...serviceDeps } = deps;
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
  const seenAt = (id: AppSessionId) => (seenNow?.(id) ? Infinity : usable ? lastSeenOf(index.sessions.get(id)) : null);
  const service = startAttentionService({ ...serviceDeps, onEvent, seenAt, store: usable ? index.attention : new FileAttentionStore(fallbackFile) });
  if (!usable) return service;

  // Archive transitions, from the records as the index commits them; one already archived at start is not retired again.
  const archived = new Set<AppSessionId>(index.sessions.list({ includeArchived: true }).flatMap((record) => (record.archived ? [record.appId] : [])));
  const offChange = index.sessions.onChange((record) => {
    const seen = lastSeenOf(record);
    if (seen !== null) service.seen(record.appId, seen);
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
