// Sessions as the shell sees them (C5 execution document, Renderer stores; C5's file alone, C4 adds no renderer session
// store): C4's records and projects, C5's digests and C3's engine statuses, fed by `ipc/events.ts`.
//
// Reconciliation keeps the higher revision (C1's rule). The record side carries one index-wide counter, so each record
// remembers the revision that last wrote it, and a removal leaves a tombstone: a snapshot older than an event never
// overwrites or resurrects what the event said, and a snapshot newer than a local record that it no longer lists
// removes it. Digests carry a per-session revision; projects travel as a whole list with the index revision.
import { create } from 'zustand';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { EventPayload, ProjectRecord, SessionDigest } from '@shared/ipc/schema';
import type { NeedsYouRow } from '../attention/derive';
import { orderProjects, sortSessions, type SidebarSort } from '../overview/derive';

export interface SessionsState {
  loaded: boolean;
  revision: number; // the highest record-side revision seen
  projects: Map<ProjectId, ProjectRecord>;
  records: Map<AppSessionId, SessionRecord>;
  digests: Map<AppSessionId, SessionDigest>;
  engine: Map<AppSessionId, EngineSessionStatus>; // C3's session.status when present; null-tolerant
  recordsVersion: number; // bumped on every write to `records`; selectors memoise on the versions
  projectsVersion: number;
  digestsVersion: number;
  applyList(snapshot: { sessions: SessionRecord[]; revision: number }): void;
  applyChanged(event: EventPayload<'session.changed'>): void;
  applyRemoved(event: EventPayload<'session.removed'>): void;
  applyProjects(list: { projects: ProjectRecord[]; revision: number }): void;
  applyDigests(digests: SessionDigest[]): void;
  applyDigest(digest: SessionDigest): void;
  applyStatus(event: EventPayload<'session.status'>): void;
  setLoaded(): void;
}

export function createSessionsStore() {
  const recordRevs = new Map<AppSessionId, number>(); // revision that last wrote each record, or removed it
  let projectsRevision = -1;

  return create<SessionsState>()((set, get) => {
    const writeRecords = (records: Map<AppSessionId, SessionRecord>, revision: number) =>
      set({ records, recordsVersion: get().recordsVersion + 1, revision: Math.max(get().revision, revision) });
    const keepDigests = (incoming: SessionDigest[]) => {
      const digests = new Map(get().digests);
      let changed = false;
      for (const d of incoming) {
        const current = digests.get(d.appSessionId);
        if (current && current.revision >= d.revision) continue;
        digests.set(d.appSessionId, d);
        changed = true;
      }
      if (changed) set({ digests, digestsVersion: get().digestsVersion + 1 });
    };

    return {
      loaded: false,
      revision: 0,
      projects: new Map(),
      records: new Map(),
      digests: new Map(),
      engine: new Map(),
      recordsVersion: 0,
      projectsVersion: 0,
      digestsVersion: 0,
      applyList({ sessions, revision }) {
        const records = new Map(get().records);
        const listed = new Set<AppSessionId>();
        for (const r of sessions) {
          listed.add(r.appId);
          if ((recordRevs.get(r.appId) ?? -1) > revision) continue; // an event (or a removal) is newer
          records.set(r.appId, r);
          recordRevs.set(r.appId, revision);
        }
        for (const id of [...records.keys()]) if (!listed.has(id) && (recordRevs.get(id) ?? -1) <= revision) records.delete(id);
        writeRecords(records, revision);
      },
      applyChanged({ record, revision }) {
        if ((recordRevs.get(record.appId) ?? -1) > revision) return;
        recordRevs.set(record.appId, revision);
        writeRecords(new Map(get().records).set(record.appId, record), revision);
      },
      applyRemoved({ appSessionId, revision }) {
        if ((recordRevs.get(appSessionId) ?? -1) > revision) return;
        recordRevs.set(appSessionId, revision);
        const records = new Map(get().records);
        records.delete(appSessionId);
        writeRecords(records, revision);
      },
      applyProjects({ projects, revision }) {
        if (revision < projectsRevision) return;
        projectsRevision = revision;
        set({ projects: new Map(projects.map((p) => [p.id, p])), projectsVersion: get().projectsVersion + 1 });
      },
      applyDigests: keepDigests,
      applyDigest: (digest) => keepDigests([digest]),
      applyStatus({ appSessionId, status }) {
        set({ engine: new Map(get().engine).set(appSessionId, status) });
      },
      setLoaded() {
        set({ loaded: true });
      },
    };
  });
}

export const useSessions = createSessionsStore();

// Selectors that return arrays are memoised on the versions of the maps they read, so a component receives the same
// array until an input actually changes. Each memo is keyed by the state's own maps, so stores never share entries.
function memo<K, V>(): (owner: object, key: K, compute: () => V, same: (a: K, b: K) => boolean) => V {
  const cache = new WeakMap<object, { key: K; value: V }>();
  return (owner, key, compute, same) => {
    const hit = cache.get(owner);
    if (hit && same(hit.key, key)) return hit.value;
    const value = compute();
    cache.set(owner, { key, value });
    return value;
  };
}

const projectOrderMemo = memo<number, ProjectRecord[]>();
export function selectProjectOrder(state: SessionsState): ProjectRecord[] {
  return projectOrderMemo(state.projects, state.projectsVersion, () => orderProjects(state.projects.values()), (a, b) => a === b);
}

const sessionsOfMemo = new Map<string, ReturnType<typeof memo<number, SessionRecord[]>>>();
export function selectSessionsOf(state: SessionsState, projectId: ProjectId | null): SessionRecord[] {
  const key = projectId ?? '\u0000none';
  let m = sessionsOfMemo.get(key);
  if (!m) sessionsOfMemo.set(key, (m = memo<number, SessionRecord[]>()));
  return m(
    state.records,
    state.recordsVersion,
    () => [...state.records.values()].filter((r) => !r.archived && r.projectId === projectId),
    (a, b) => a === b,
  );
}

type SortKey = { records: number; digests: number; sort: SidebarSort; rows: NeedsYouRow[] }; // `rows` comes memoised from selectNeedsYou
const sortedMemo = new Map<string, ReturnType<typeof memo<SortKey, SessionRecord[]>>>();
export function selectSortedSessions(state: SessionsState, projectId: ProjectId | null, sort: SidebarSort, rows: NeedsYouRow[]): SessionRecord[] {
  const id = projectId ?? '\u0000none';
  let m = sortedMemo.get(id);
  if (!m) sortedMemo.set(id, (m = memo<SortKey, SessionRecord[]>()));
  return m(
    state.records,
    { records: state.recordsVersion, digests: state.digestsVersion, sort, rows },
    () => sortSessions(selectSessionsOf(state, projectId), sort, { digests: state.digests, rows }),
    (a, b) => a.records === b.records && a.digests === b.digests && a.sort === b.sort && a.rows === b.rows,
  );
}
