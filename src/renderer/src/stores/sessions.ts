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
import type { OrgMember, OrgRows, RemoteRow } from '@shared/ipc/schema/org';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
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
  // Debt wave 5: the engine host's discovery pass while it reads (`fs.scanProgress` below its total), else null; the
  // Overview says that indexing continues while it is set.
  indexing: { scanned: number; total: number } | null;
  applyScanProgress(progress: EventPayload<'fs.scanProgress'>): void;
  // P5 O6 M4: every write names the machine it came from, whose partition alone it is reconciled against (see below).
  applyList(snapshot: { sessions: SessionRecord[]; revision: number }, machine: MachineRef): void;
  applyChanged(event: EventPayload<'session.changed'>, machine: MachineRef): boolean; // whether it was newer than what the store knew
  applyChangedMany(events: EventPayload<'session.changed'>[], machine: MachineRef): void; // the same rule per event, in order, in one write
  applyRemoved(event: EventPayload<'session.removed'>, machine: MachineRef): boolean;
  applyProjects(list: { projects: ProjectRecord[]; revision: number }, machine: MachineRef): void; // that machine's projects only
  applyDigests(digests: SessionDigest[], machine: MachineRef): void;
  applyDigest(digest: SessionDigest, machine: MachineRef): void;
  applyStatus(event: EventPayload<'session.status'>, machine: MachineRef): void;
  applyStatuses(statuses: EngineSessionStatus[], machine: MachineRef): void; // C3's process table (`engine.sessions`) at connect
  // E10: the machine's engine host left ready (P5 O6 M4: or its link went down), so no status it sent still holds.
  forgetStatuses(machine: MachineRef): void;
  // P5 O6 M4: the machine's link came up as a new generation, whose counters start afresh. What the store reconciles that
  // machine by is forgotten; its records, projects, digests and statuses stay shown until its next snapshot replaces them.
  resetMachine(machine: MachineRef): void;
  setLoaded(): void; // the local machine's snapshot is in
  // P5 O8 M2 (Interfaces §G): other machines' sessions as their signed listings say them, by address, and the RL2
  // roster the rows cover (those machines take no record snapshot). Replaced whole by each `org.rows` answer or event.
  listed: ReadonlyMap<AppSessionId, ListedSession>;
  listedMachines: ReadonlySet<MachineRef>;
  // P5 O8 M5 (Interfaces §L): the owners the rows name, by member id, and the signed-in member they were computed for
  // ("you"; null signed out), replaced with the rows so a row's owners are always read against their own payload.
  members: ReadonlyMap<string, OrgMember>;
  member: string | null;
  applyRows(rows: OrgRows): void;
  addUnstarted(appSessionId: AppSessionId, entry: UnstartedSession): void;
  dropUnstarted(appSessionId: AppSessionId): void;
}

// P5 O8 M2: a listed session is a `RemoteRow` with its address, never a `SessionRecord`: a listing has no directory, model,
// mode, holder or lineage, and a record built from one would plant made-up values in their readers.
export type ListedSession = RemoteRow & { appId: AppSessionId };

export interface UnstartedSession {
  projectId: ProjectId | null;
  createdAt: string;
}

// P5 O6 M4 (docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "One store per kind, partitioned inside"): one
// store, whose reconciliation state is kept per machine, since each machine's counters are its own process's. A
// partition's ids are those the calls that named its machine wrote, never parsed from the id strings.
interface Partition {
  records: Set<AppSessionId>; // the held records written for this machine
  projects: Set<ProjectId>;
  statuses: Set<AppSessionId>;
  recordRevs: Map<AppSessionId, number>; // revision that last wrote each record, or removed it
  digestRevs: Map<AppSessionId, number>; // the digest revision to beat: the held digest's, or the one a removed session last had
  listRevision: number; // the latest session.list snapshot applied
  projectsRevision: number;
}

export function createSessionsStore() {
  const partitions = new Map<MachineRef, Partition>();
  const partition = (machine: MachineRef): Partition => {
    let p = partitions.get(machine);
    if (!p) {
      p = { records: new Set(), projects: new Set(), statuses: new Set(), recordRevs: new Map(), digestRevs: new Map(), listRevision: -1, projectsRevision: -1 };
      partitions.set(machine, p);
    }
    return p;
  };
  // The revision an event about a session must exceed to be news: a held record's own; for one not held, also the
  // latest snapshot, whose silence about it is as new as the snapshot. (The counter is index-wide and bumped on every
  // change, so no two events share a revision; an equal one is the same fact again.)
  const known = (p: Partition, id: AppSessionId, held: boolean) => Math.max(p.recordRevs.get(id) ?? -1, held ? -1 : p.listRevision);

  return create<SessionsState>()((set, get) => {
    // A record arriving for an unstarted session makes it an ordinary session.
    const started = (records: Map<AppSessionId, SessionRecord>) => {
      const unstarted = get().unstarted;
      if (![...unstarted.keys()].some((id) => records.has(id))) return unstarted;
      return new Map([...unstarted].filter(([id]) => !records.has(id)));
    };
    // A session whose record goes takes its digest and engine status along. Its digest revision stays, so a late digest
    // from before the removal is still refused.
    const forget = (p: Partition, removed: AppSessionId[]) => {
      for (const id of removed) {
        p.records.delete(id);
        p.statuses.delete(id);
      }
      const { digests, engine } = get();
      const gone = removed.filter((id) => digests.has(id) || engine.has(id));
      if (gone.length === 0) return {};
      const nextDigests = new Map(digests);
      const nextEngine = new Map(engine);
      for (const id of gone) {
        nextDigests.delete(id);
        nextEngine.delete(id);
      }
      return { digests: nextDigests, engine: nextEngine, digestsVersion: get().digestsVersion + 1 };
    };
    const writeRecords = (p: Partition, records: Map<AppSessionId, SessionRecord>, revision: number, removed: AppSessionId[]) => {
      set({
        records,
        recordsVersion: get().recordsVersion + 1,
        revision: Math.max(get().revision, revision),
        unstarted: started(records),
        ...forget(p, removed),
      });
    };
    // Changes applied in order, each against what the store knew before it; one write for all that were news. Whether any was.
    const changeMany = (events: EventPayload<'session.changed'>[], machine: MachineRef): boolean => {
      const p = partition(machine);
      let records: Map<AppSessionId, SessionRecord> | null = null;
      let latest = -1;
      for (const { record, revision } of events) {
        if (revision <= known(p, record.appId, (records ?? get().records).has(record.appId))) continue;
        p.recordRevs.set(record.appId, revision);
        p.records.add(record.appId);
        (records ??= new Map(get().records)).set(record.appId, record);
        latest = Math.max(latest, revision);
      }
      if (records === null) return false;
      writeRecords(p, records, latest, []);
      return true;
    };
    const keepDigests = (incoming: SessionDigest[], machine: MachineRef) => {
      const p = partition(machine);
      let digests: Map<AppSessionId, SessionDigest> | null = null;
      for (const d of incoming) {
        if ((p.digestRevs.get(d.appSessionId) ?? -1) >= d.revision) continue;
        p.digestRevs.set(d.appSessionId, d.revision);
        (digests ??= new Map(get().digests)).set(d.appSessionId, d);
      }
      if (digests !== null) set({ digests, digestsVersion: get().digestsVersion + 1 });
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
      indexing: null,
      listed: new Map(),
      listedMachines: new Set(),
      members: new Map(),
      member: null,
      applyRows({ machines, rows, members, member }) {
        const listed = new Map<AppSessionId, ListedSession>();
        for (const row of rows) {
          const appId = addressOf(row.machine, row.session as AppSessionId);
          listed.set(appId, { ...row, appId });
        }
        set({ listed, listedMachines: new Set(machines), members: new Map(members.map((m) => [m.id, m])), member });
      },
      applyList({ sessions, revision }, machine) {
        const p = partition(machine);
        const records = new Map(get().records);
        const listed = new Set<AppSessionId>();
        for (const r of sessions) {
          listed.add(r.appId);
          if ((p.recordRevs.get(r.appId) ?? -1) > revision) continue; // an event (or a removal) is newer
          records.set(r.appId, r);
          p.recordRevs.set(r.appId, revision);
          p.records.add(r.appId);
        }
        const removed = [...p.records].filter((id) => !listed.has(id) && (p.recordRevs.get(id) ?? -1) <= revision);
        for (const id of removed) records.delete(id);
        p.listRevision = Math.max(p.listRevision, revision);
        writeRecords(p, records, revision, removed);
      },
      applyChanged(event, machine) {
        return changeMany([event], machine);
      },
      applyChangedMany(events, machine) {
        changeMany(events, machine);
      },
      applyScanProgress({ scanned, total }) {
        const indexing = scanned < total ? { scanned, total } : null;
        const current = get().indexing;
        if (current?.scanned === indexing?.scanned && current?.total === indexing?.total) return;
        set({ indexing });
      },
      applyRemoved({ appSessionId, revision }, machine) {
        const p = partition(machine);
        const held = get().records.has(appSessionId);
        if (revision <= known(p, appSessionId, held)) return false;
        p.recordRevs.set(appSessionId, revision);
        if (!held) return false; // nothing to remove; the tombstone still guards against a late change
        const records = new Map(get().records);
        records.delete(appSessionId);
        writeRecords(p, records, revision, [appSessionId]);
        return true;
      },
      applyProjects({ projects, revision }, machine) {
        const p = partition(machine);
        if (revision < p.projectsRevision) return;
        p.projectsRevision = revision;
        const next = new Map([...get().projects].filter(([id]) => !p.projects.has(id)));
        p.projects = new Set(projects.map((project) => project.id));
        for (const project of projects) next.set(project.id, project);
        set({ projects: next, projectsVersion: get().projectsVersion + 1 });
      },
      applyDigests: keepDigests,
      applyDigest: (digest, machine) => keepDigests([digest], machine),
      applyStatus({ appSessionId, status }, machine) {
        partition(machine).statuses.add(appSessionId);
        set({ engine: new Map(get().engine).set(appSessionId, status) });
      },
      // Statuses carry no revision. The table is read after the subscription, and the host sends its events and its
      // answer down one channel, so a status that arrived before the table is no newer than it and one after it is
      // newer: the table overwrites what it lists and keeps what it does not.
      applyStatuses(statuses, machine) {
        if (statuses.length === 0) return;
        const p = partition(machine);
        const engine = new Map(get().engine);
        for (const status of statuses) {
          engine.set(status.appSessionId, status);
          p.statuses.add(status.appSessionId);
        }
        set({ engine });
      },
      // E10, as main forgets them (C12, `hostEventSource`): a host that left ready took its processes' statuses along; the
      // next generation's table and burst say again what is live. P5 O6 M4: one machine's statuses, the others' stand.
      forgetStatuses(machine) {
        const p = partition(machine);
        if (p.statuses.size === 0) return;
        const engine = new Map(get().engine);
        for (const id of p.statuses) engine.delete(id);
        p.statuses = new Set();
        set({ engine });
      },
      resetMachine(machine) {
        const p = partition(machine);
        p.recordRevs = new Map();
        p.digestRevs = new Map();
        p.listRevision = -1;
        p.projectsRevision = -1;
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

// The projects the app lists, in their order: every project but those removed from the sidebar (W11, I5: the list
// carries hidden ones, marked, so their sessions stay out of the sidebar and "Hidden projects…" can offer them back).
const projectOrderMemo = memo<number, ProjectRecord[]>();
export function selectProjectOrder(state: SessionsState): ProjectRecord[] {
  return projectOrderMemo(state.projects, state.projectsVersion, () => orderProjects([...state.projects.values()].filter((p) => !p.hidden)), (a, b) => a === b);
}

// The projects removed from the sidebar, by name.
const hiddenProjectsMemo = memo<number, ProjectRecord[]>();
export function selectHiddenProjects(state: SessionsState): ProjectRecord[] {
  return hiddenProjectsMemo(state.projects, state.projectsVersion, () => [...state.projects.values()].filter((p) => p.hidden).sort((a, b) => a.name.localeCompare(b.name)), (a, b) => a === b);
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
