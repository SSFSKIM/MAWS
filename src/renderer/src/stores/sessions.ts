// Sessions as the shell sees them (C5 execution document, Renderer stores; C5's file alone, C4 adds no renderer session
// store): C4's records and projects, C5's digests and C3's engine statuses, fed by `ipc/events.ts`.
//
// Reconciliation keeps the higher revision (C1's rule). The record side carries one index-wide counter, so each record
// remembers the revision that last wrote it, and a removal leaves a tombstone: a snapshot older than an event never
// overwrites or resurrects what the event said, and a snapshot newer than a local record that it no longer lists
// removes it. Absence from a snapshot is also a fact as of its revision: an event for a session the store does not hold
// is taken only if it is newer than the latest snapshot, so a late change cannot resurrect what the snapshot dropped.
// A held record's events are judged against that record's own revision alone, so the counter advancing elsewhere
// rejects nothing. Digests carry a per-session revision that main never repeats for an app id, even across a removal;
// a removed session's digest and engine status go with its record, and the revision it last had still refuses a late
// digest from before the removal. Projects travel as a whole list with the index revision.
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
  // Sessions created and not yet sent (owner design 2026-09-28): an app id with a setup intent and no record, whose tab
  // shows the project it was created in. Transient; an entry goes when its record arrives or its tab closes.
  unstarted: Map<AppSessionId, UnstartedSession>;
  recordsVersion: number; // bumped on every write to `records`; selectors memoise on the versions
  projectsVersion: number;
  digestsVersion: number;
  applyList(snapshot: { sessions: SessionRecord[]; revision: number }): void;
  applyChanged(event: EventPayload<'session.changed'>): boolean; // whether it was newer than what the store knew
  applyRemoved(event: EventPayload<'session.removed'>): boolean;
  applyProjects(list: { projects: ProjectRecord[]; revision: number }): void;
  applyDigests(digests: SessionDigest[]): void;
  applyDigest(digest: SessionDigest): void;
  applyStatus(event: EventPayload<'session.status'>): void;
  applyStatuses(statuses: EngineSessionStatus[]): void; // C3's process table (`engine.sessions`) at connect
  setLoaded(): void;
  addUnstarted(appSessionId: AppSessionId, entry: UnstartedSession): void;
  dropUnstarted(appSessionId: AppSessionId): void;
}

export interface UnstartedSession {
  projectId: ProjectId | null;
  createdAt: string;
}

export function createSessionsStore() {
  const recordRevs = new Map<AppSessionId, number>(); // revision that last wrote each record, or removed it
  const forgottenDigestRevs = new Map<AppSessionId, number>(); // the digest revision a removed session last had
  let projectsRevision = -1;
  let listRevision = -1; // the latest session.list snapshot applied
  // The revision an event about a session must exceed to be news: a held record's own; for one not held, also the
  // latest snapshot, whose silence about it is as new as the snapshot. (The counter is index-wide and bumped on every
  // change, so no two events share a revision; an equal one is the same fact again.)
  const known = (id: AppSessionId, held: boolean) => Math.max(recordRevs.get(id) ?? -1, held ? -1 : listRevision);

  return create<SessionsState>()((set, get) => {
    // A record arriving for an unstarted session makes it an ordinary session.
    const started = (records: Map<AppSessionId, SessionRecord>) => {
      const unstarted = get().unstarted;
      if (![...unstarted.keys()].some((id) => records.has(id))) return unstarted;
      return new Map([...unstarted].filter(([id]) => !records.has(id)));
    };
    // A session whose record goes takes its digest and engine status along.
    const forget = (removed: AppSessionId[]) => {
      const { digests, engine } = get();
      const gone = removed.filter((id) => digests.has(id) || engine.has(id));
      if (gone.length === 0) return {};
      const nextDigests = new Map(digests);
      const nextEngine = new Map(engine);
      for (const id of gone) {
        const digest = digests.get(id);
        if (digest) forgottenDigestRevs.set(id, digest.revision);
        nextDigests.delete(id);
        nextEngine.delete(id);
      }
      return { digests: nextDigests, engine: nextEngine, digestsVersion: get().digestsVersion + 1 };
    };
    const writeRecords = (records: Map<AppSessionId, SessionRecord>, revision: number) => {
      const removed = [...get().records.keys()].filter((id) => !records.has(id));
      set({
        records,
        recordsVersion: get().recordsVersion + 1,
        revision: Math.max(get().revision, revision),
        unstarted: started(records),
        ...forget(removed),
      });
    };
    const keepDigests = (incoming: SessionDigest[]) => {
      const digests = new Map(get().digests);
      let changed = false;
      for (const d of incoming) {
        const current = digests.get(d.appSessionId)?.revision ?? forgottenDigestRevs.get(d.appSessionId) ?? -1;
        if (current >= d.revision) continue;
        digests.set(d.appSessionId, d);
        forgottenDigestRevs.delete(d.appSessionId);
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
      unstarted: new Map(),
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
        listRevision = Math.max(listRevision, revision);
        writeRecords(records, revision);
      },
      applyChanged({ record, revision }) {
        if (revision <= known(record.appId, get().records.has(record.appId))) return false;
        recordRevs.set(record.appId, revision);
        writeRecords(new Map(get().records).set(record.appId, record), revision);
        return true;
      },
      applyRemoved({ appSessionId, revision }) {
        const held = get().records.has(appSessionId);
        if (revision <= known(appSessionId, held)) return false;
        recordRevs.set(appSessionId, revision);
        if (!held) return false; // nothing to remove; the tombstone still guards against a late change
        const records = new Map(get().records);
        records.delete(appSessionId);
        writeRecords(records, revision);
        return true;
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
      // Statuses carry no revision. The table is read after the subscription, and the host sends its events and its
      // answer down one channel, so a status that arrived before the table is no newer than it and one after it is
      // newer: the table overwrites what it lists and keeps what it does not.
      applyStatuses(statuses) {
        if (statuses.length === 0) return;
        const engine = new Map(get().engine);
        for (const status of statuses) engine.set(status.appSessionId, status);
        set({ engine });
      },
      setLoaded() {
        set({ loaded: true });
      },
      addUnstarted(appSessionId, entry) {
        set({ unstarted: new Map(get().unstarted).set(appSessionId, entry) });
      },
      dropUnstarted(appSessionId) {
        if (!get().unstarted.has(appSessionId)) return;
        const unstarted = new Map(get().unstarted);
        unstarted.delete(appSessionId);
        set({ unstarted });
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
