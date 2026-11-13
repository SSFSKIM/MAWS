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
// The project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §J.1): main's `org.projects`
// is held whole (`registry`), and its locations on other machines are records in `projects` too (`stores/registry.ts`),
// under the address of the machine and its row id there, wherever no record that machine answered itself holds it.
import { create } from 'zustand';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionEvent } from '@shared/graph/events';
import type { EventPayload, ProjectRecord, SessionDigest } from '@shared/ipc/schema';
import type { OrgMember, OrgProjects, OrgRows, RemoteRow } from '@shared/ipc/schema/org';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import type { NeedsYouRow } from '../attention/derive';
import { orderProjects, seenAt, sortSessions, type SidebarSort } from '../overview/derive';
import { EMPTY_REGISTRY, registryRecords } from './registry';

export interface SessionsState {
  loaded: boolean;
  // UX wave U7, ticket 407 (Interfaces §B): a read of this Mac's sessions was refused (its daemon restarting) and none has
  // succeeded since; set and cleared only by the local snapshot's reads (`ipc/events.ts`), never timed out.
  reconnecting: boolean;
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
  // P5 O7 M2: those `keep` answers true for stay (a lane B session main still holds over that machine's link).
  forgetStatuses(machine: MachineRef, keep?: (appSessionId: AppSessionId) => boolean): void;
  // P5 O6 M4: the machine's link came up as a new generation, whose counters start afresh. What the store reconciles that
  // machine by is forgotten; its records, projects, digests and statuses stay shown until its next snapshot replaces them.
  resetMachine(machine: MachineRef): void;
  setLoaded(): void; // the local machine's snapshot is in
  setReconnecting(on: boolean): void;
  // P5 O8 M2 (Interfaces §G): other machines' sessions as their signed listings say them, by address, and the RL2
  // roster the rows cover (those machines take no record snapshot). Replaced whole by each `org.rows` answer or event.
  listed: ReadonlyMap<AppSessionId, ListedSession>;
  listedMachines: ReadonlySet<MachineRef>;
  // P5 O8 M5 (Interfaces §L): the owners the rows name, by member id, and the signed-in member they were computed for
  // ("you"; null signed out), replaced with the rows so a row's owners are always read against their own payload.
  members: ReadonlyMap<string, OrgMember>;
  member: string | null;
  applyRows(rows: OrgRows): void;
  // The project registry (§J.1): main's whole value (`org.projects`, `org.projects.changed`; signed out, none), and its
  // locations on machines other than `local` as records in `projects`.
  registry: OrgProjects;
  applyRegistry(registry: OrgProjects, local: MachineRef): void;
  // P5 O7 M10 (A; docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M10's *A remote session ranks by a stale
  // activity time*): another machine's lane B session has no digest (no lane B module emits one), so the latest turn
  // start or end its stream delivered to this window is kept per session, as the digest's fold reads them (a child
  // agent's turn and an echo receipt are none), for the sidebar's activity (`overview/derive.ts`, `seenActivity`). Fed
  // with other machines' batches only (`connectShell`); a removed record's goes with it.
  turnsSeen: ReadonlyMap<AppSessionId, number>;
  applyTurnsSeen(batch: EventPayload<'session.eventBatch'>): void;
  addUnstarted(appSessionId: AppSessionId, entry: UnstartedSession): void;
  dropUnstarted(appSessionId: AppSessionId): void;
  // The UX wave, U9 (M4, "What this window did shows at once"; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-
  // machines.md): a listed row follows the hub's listing, which arrives seconds after an act made here on another
  // machine's session. What this window did to an address (archived it; gave it a title) is kept for this run and applied
  // where `applyRows` builds the listings, until a listing newer than the one held at the act replaces it, or an unarchive
  // made here clears the archive. A record of another machine's held at the address is written the same at the act, with
  // no revision, so what that machine says next still replaces it (a kept record's feed may have closed with its tab).
  acted: ReadonlyMap<AppSessionId, ActedHere>;
  noteArchived(appSessionId: AppSessionId): void;
  noteRenamed(appSessionId: AppSessionId, title: string): void;
  noteUnarchived(appSessionId: AppSessionId): void;
  // The UX wave, U9 (S-05, M5; Interfaces §10; ../lane-b/live-word.ts): the live word of each listed session that takes
  // one now, applied on its listing entry (`ListedSession.live`) here and at every `applyRows`, so the word is there from
  // the moment the entry arrives and gone the moment the window stops deriving it.
  liveWords: ReadonlyMap<AppSessionId, LiveWord>;
  applyLive(words: ReadonlyMap<AppSessionId, LiveWord>): void;
}

/** What this window did to another machine's session (`acted`): `listedAt`, the revision of the listing held at the act. */
export interface ActedHere {
  archived: boolean;
  title: string | null;
  listedAt: number;
  hidden: ListedSession | null; // the listing an archive took out, given back at an unarchive made here
}

// P5 O8 M2: a listed session is a `RemoteRow` with its address, never a `SessionRecord`: a listing has no directory, model,
// mode, holder or lineage, and a record built from one would plant made-up values in their readers. The UX wave, U9
// (S-05): `live`, the turn of the session's open tab, while the window derives one (`applyLive`); state of the run.
export type ListedSession = RemoteRow & { appId: AppSessionId; live?: LiveWord };
/** The UX wave, U9 (S-05): a remote lane B session's open tab's turn, `running` while its held status has one. */
export type LiveWord = 'running' | 'resting';
/** The listing with the live word it takes now, or without one. */
const withLive = (entry: ListedSession, word: LiveWord | undefined): ListedSession => {
  if (entry.live === word) return entry;
  if (word !== undefined) return { ...entry, live: word };
  const rest = { ...entry };
  delete rest.live;
  return rest;
};

// A turn's start or end as the digest's fold reads it (src/services/sessions/digest.ts): the session's own, never a child
// agent's, and an echo receipt is no turn.
const isTurn = (event: SessionEvent): boolean =>
  event.agentId === null && event.parentToolUseId === null && (event.kind === 'turn.started' || (event.kind === 'turn.ended' && !event.isEchoReceipt));

export interface UnstartedSession {
  projectId: ProjectId | null;
  createdAt: string;
  // the project registry's M11: the registry project a New chat with no project here was opened in (a project with no
  // folder on this Mac, started on one of its locations elsewhere: sidebar/registry-new-chat.ts)
  registry?: string;
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

  // The project registry: its records (`registryRecords`), and which of them `projects` holds now: those at an address no
  // record a machine answered itself holds.
  let fromRegistry = new Map<ProjectId, ProjectRecord>();
  let placed = new Set<ProjectId>();
  const answered = (projects: ReadonlyMap<ProjectId, ProjectRecord>) => [...projects].filter(([id]) => !placed.has(id)); // the machines' own records
  // `projects` from the machines' own records: each registry record placed where none of them is
  const withRegistry = (own: Iterable<[ProjectId, ProjectRecord]>): Map<ProjectId, ProjectRecord> => {
    const next = new Map(own);
    placed = new Set();
    for (const [id, record] of fromRegistry) {
      if (next.has(id)) continue;
      next.set(id, record);
      placed.add(id);
    }
    return next;
  };

  return create<SessionsState>()((set, get) => {
    // The UX wave, U9: a held record at `appSessionId` written as this window's act left it, its revision untouched, so
    // what its machine says next replaces it (`noteArchived`, `noteRenamed`, `noteUnarchived`); nothing with none held.
    const heldAs = (records: ReadonlyMap<AppSessionId, SessionRecord>, appSessionId: AppSessionId, write: (record: SessionRecord) => SessionRecord) => {
      const held = records.get(appSessionId);
      if (held === undefined) return {};
      const next = write(held);
      return next === held ? {} : { records: new Map(records).set(appSessionId, next), recordsVersion: get().recordsVersion + 1 };
    };
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
      const { digests, engine, turnsSeen } = get();
      const seen = removed.some((id) => turnsSeen.has(id)) ? { turnsSeen: new Map([...turnsSeen].filter(([id]) => !removed.includes(id))) } : {};
      const gone = removed.filter((id) => digests.has(id) || engine.has(id));
      if (gone.length === 0) return seen;
      const nextDigests = new Map(digests);
      const nextEngine = new Map(engine);
      for (const id of gone) {
        nextDigests.delete(id);
        nextEngine.delete(id);
      }
      return { digests: nextDigests, engine: nextEngine, digestsVersion: get().digestsVersion + 1, ...seen };
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
      reconnecting: false,
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
      registry: EMPTY_REGISTRY,
      acted: new Map(),
      liveWords: new Map(),
      applyLive(words) {
        const listed = new Map(get().listed);
        for (const [appId, entry] of listed) listed.set(appId, withLive(entry, words.get(appId)));
        set({ liveWords: words, listed });
      },
      applyRegistry(registry, local) {
        fromRegistry = registryRecords(registry, local);
        set({ registry, projects: withRegistry(answered(get().projects)), projectsVersion: get().projectsVersion + 1 });
      },
      turnsSeen: new Map(),
      applyTurnsSeen({ appSessionId, events }) {
        const held = get().turnsSeen.get(appSessionId) ?? Number.NEGATIVE_INFINITY;
        const latest = Math.max(held, ...events.filter(isTurn).map((event) => Date.parse(event.at)).filter(Number.isFinite));
        if (latest > held) set({ turnsSeen: new Map(get().turnsSeen).set(appSessionId, latest) });
      },
      applyRows({ machines, rows, members, member }) {
        const listed = new Map<AppSessionId, ListedSession>();
        const acted = new Map(get().acted);
        for (const row of rows) {
          const appId = addressOf(row.machine, row.session as AppSessionId);
          const entry: ListedSession = { ...row, appId };
          const note = acted.get(appId); // the UX wave, U9: what this window did, until a newer listing says otherwise
          if (note !== undefined && row.revision > note.listedAt) acted.delete(appId);
          else if (note?.archived === true) {
            acted.set(appId, { ...note, hidden: entry });
            continue;
          } else if (note?.title != null) entry.title = note.title;
          listed.set(appId, withLive(entry, get().liveWords.get(appId)));
        }
        set({ listed, acted, listedMachines: new Set(machines), members: new Map(members.map((m) => [m.id, m])), member });
      },
      noteArchived(appSessionId) {
        const { listed, acted, records } = get();
        const listing = listed.get(appSessionId) ?? null;
        const prior = acted.get(appSessionId);
        const note: ActedHere = { archived: true, title: prior?.title ?? null, listedAt: listing?.revision ?? prior?.listedAt ?? -1, hidden: listing ?? prior?.hidden ?? null };
        const nextListed = new Map(listed);
        nextListed.delete(appSessionId);
        set({ acted: new Map(acted).set(appSessionId, note), listed: nextListed, ...heldAs(records, appSessionId, (r) => ({ ...r, archived: true })) });
      },
      noteRenamed(appSessionId, title) {
        const { listed, acted, records } = get();
        const listing = listed.get(appSessionId);
        const prior = acted.get(appSessionId);
        const note: ActedHere = { archived: prior?.archived ?? false, title, listedAt: listing?.revision ?? prior?.listedAt ?? -1, hidden: prior?.hidden ?? null };
        set({
          acted: new Map(acted).set(appSessionId, note),
          ...(listing === undefined ? {} : { listed: new Map(listed).set(appSessionId, { ...listing, title }) }),
          ...heldAs(records, appSessionId, (r) => ({ ...r, title: { ...r.title, text: title, source: 'user' } })),
        });
      },
      noteUnarchived(appSessionId) {
        const { listed, acted, records } = get();
        const prior = acted.get(appSessionId);
        const nextActed = new Map(acted);
        if (prior?.title != null) nextActed.set(appSessionId, { ...prior, archived: false, hidden: null });
        else nextActed.delete(appSessionId);
        // the listing as it was at the archive, with the live word the window holds now (the one kept is stale)
        const restored = prior?.hidden == null ? null : withLive(prior.title === null ? prior.hidden : { ...prior.hidden, title: prior.title }, get().liveWords.get(appSessionId));
        const back = restored !== null && !listed.has(appSessionId) ? { listed: new Map(listed).set(appSessionId, restored) } : {};
        set({ acted: nextActed, ...back, ...heldAs(records, appSessionId, (r) => (r.archived ? { ...r, archived: false } : r)) });
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
        // the machine's own records replace what it said before, and any registry record at their addresses
        const next = new Map(answered(get().projects).filter(([id]) => !p.projects.has(id)));
        p.projects = new Set(projects.map((project) => project.id));
        for (const project of projects) next.set(project.id, project);
        set({ projects: withRegistry(next), projectsVersion: get().projectsVersion + 1 });
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
      forgetStatuses(machine, keep) {
        const p = partition(machine);
        const kept = keep === undefined ? new Set<AppSessionId>() : new Set([...p.statuses].filter(keep));
        if (kept.size === p.statuses.size) return;
        const engine = new Map(get().engine);
        for (const id of p.statuses) if (!kept.has(id)) engine.delete(id);
        p.statuses = kept;
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
      setReconnecting(on) {
        if (get().reconnecting !== on) set({ reconnecting: on });
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

// P5 O7 M10 (A): one session's activity this window saw beyond its record (`seenActivity`'s entry: its listing's issue, the
// turns its stream delivered here), for its row's age; undefined with neither.
export const selectSeenAt = (state: Pick<SessionsState, 'listed' | 'turnsSeen'>, appSessionId: AppSessionId): number | undefined =>
  seenAt(state.listed.get(appSessionId), state.turnsSeen.get(appSessionId));

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

type SortKey = { records: number; digests: number; sort: SidebarSort; rows: NeedsYouRow[]; now: number }; // `rows` comes memoised from selectNeedsYou
const sortedMemo = new Map<string, ReturnType<typeof memo<SortKey, SessionRecord[]>>>();
export function selectSortedSessions(state: SessionsState, projectId: ProjectId | null, sort: SidebarSort, rows: NeedsYouRow[], now: number): SessionRecord[] {
  const id = projectId ?? '\u0000none';
  let m = sortedMemo.get(id);
  if (!m) sortedMemo.set(id, (m = memo<SortKey, SessionRecord[]>()));
  return m(
    state.records,
    { records: state.recordsVersion, digests: state.digestsVersion, sort, rows, now },
    () => sortSessions(selectSessionsOf(state, projectId), sort, { digests: state.digests, rows, now }),
    (a, b) => a.records === b.records && a.digests === b.digests && a.sort === b.sort && a.rows === b.rows && a.now === b.now,
  );
}
