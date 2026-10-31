// The one subscription point that feeds the shell's stores from X2 events (C5 execution document, Renderer stores).
// C1's ordering rule: every event is subscribed before any snapshot command runs; each snapshot then reconciles with
// the events that raced it inside its store (by revision for sessions, projects and digests; by buffer and replay for
// attention). The layout hydrates once the sessions are known, so a persisted tab of a vanished session is dropped,
// unless a registered tab retention (C10's) keeps it.
// P5 O6 M4: the subscriptions are made once, and each event goes to the partition of the machine it came from; each
// machine's snapshots are taken when its link comes up, and again for each new generation of it (`connectShell`).
// P5 O8 M2 (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, "The snapshot rule"): the org's rows (`org.rows`,
// `org.rows.changed`) fill the sessions store's listed partition; a machine they cover takes no record snapshot and loads
// when they have.
import type { AppSessionId } from '@shared/graph/ids';
import type { EventPayload, MawsBridge, SessionDigest } from '@shared/ipc/schema';
import type { MachineState } from '@shared/ipc/schema/machines';
import type { OrgRows } from '@shared/ipc/schema/org';
import { machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { currentTabRetention, unstartedProjectOf } from '../keymap/actions-runtime';
import { useAttention } from '../stores/attention';
import { createFreshness, type Freshness } from '../stores/freshness';
import { useLayout } from '../stores/layout';
import { useMachines } from '../stores/machines';
import { useSessions } from '../stores/sessions';
import { selectOrgIndex, sessionSetKey, setKeyOfProject } from '../stores/org-projects'; // P5 O6 M5
import { displayTitle } from '../sessions/title'; // P5 O6 M2: a session tab's last-known title
import type { RekeyOf } from '../stores/layout-model';
import type { TabSetKey } from '@shared/ipc/schema/layout';
import { ipc } from './client';
import { checkoutKey } from './machine';
// C8a start
import { useGit } from '../stores/git';
import { queryClient } from './query';
import type { ScmStatus } from '@shared/ipc/schema/scm';
import { invalidateScmQueries, refreshPublishedPrState /* P5 E312 */, SCM_STATUS_QUERIES, scmStatusKey } from '../tools/scm/queries';
// C8a end
// C8c start
import { useFiles } from '../tools/code/files/store';
import { useViewer } from '../tools/code/viewer/viewer-store';
// C8c end
// E5 start
import { pushUnsavedFiles, unsavedFailures } from '../tools/code/viewer/viewer-store';
// E5 end
// C8b start
import { agentWorkClient, type AgentWorkClient } from '../tools/agents/client';
// C8b end

export interface ShellStores {
  sessions: typeof useSessions;
  attention: typeof useAttention;
  layout: typeof useLayout;
  machines: typeof useMachines; // P5 O6 M4
}

// Debt wave 5 (the cold first paint): the record side's events (records, removals, projects, digests, the discovery
// pass's progress) are applied together once per window rather than one by one, so a flood of them (a cold index
// announces every session in the store, twice over with its seed digests) costs the page one store write per kind and
// one render per window instead of one render per event. 0 applies each event as it arrives. A snapshot reply applies
// after the window's events that preceded it, and the layout's hydration drains the window once its reads are in and
// before it captures the early changes it replays, so its tab check sees every event received and the removals the
// drain makes are replayed with the rest.
export const SHELL_BATCH_MS = 16;

// P5 O6 M4: each queued event keeps the machine it came from, whose partition it is applied to.
type Queued = { m: MachineRef } & (
  | { t: 'changed'; e: EventPayload<'session.changed'> }
  | { t: 'removed'; e: EventPayload<'session.removed'> }
  | { t: 'projects'; e: EventPayload<'session.projects.changed'> }
  | { t: 'digest'; d: SessionDigest }
  | { t: 'progress'; e: EventPayload<'fs.scanProgress'> }
);

// P5 O6 M4 (docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "`connectShell` per machine"): what the shell
// knows of one machine's link. The local machine's is up for the app's life, generation 0; another's follows
// `machines.changed`.
interface Link {
  up: boolean;
  generation: number | null; // the generation whose snapshot was taken (or is being), null before the first
  freshness: Freshness; // advanced when the link goes down or comes up anew, so a reply from before applies nothing
  hostState: EventPayload<'engine.hostState'>['state'] | null; // E10: its engine host's last state heard (unknown: null)
  departures: number; // E10: how often its engine host was heard leaving ready; a table read before the latest is stale
}

export function connectShell(
  client: MawsBridge = ipc,
  stores: ShellStores = { sessions: useSessions, attention: useAttention, layout: useLayout, machines: useMachines },
  { batchMs = SHELL_BATCH_MS }: { batchMs?: number } = {},
): () => void {
  const sessions = () => stores.sessions.getState();
  const attention = () => stores.attention.getState();
  const local = client.localMachine;
  const connection = createFreshness();
  let connected = true;
  const on: MawsBridge['on'] = (name, listener) => client.on(name, (payload, from) => connected && listener(payload, from));
  const rosterFreshness = createFreshness(); // advanced by every `machines.changed`, which a `machines.list` answer must not undo
  const rowsFreshness = createFreshness(); // P5 O8 M2: advanced by every `org.rows.changed`, which an `org.rows` answer must not undo
  const links = new Map<MachineRef, Link>();
  const linkOf = (machine: MachineRef): Link => {
    let link = links.get(machine);
    if (!link) links.set(machine, (link = { up: machine === local, generation: null, freshness: createFreshness(), hostState: null, departures: 0 }));
    return link;
  };

  // l1-sessions-13: an archive main made on its own (the project command's, the inactivity sweep's) closes the session's
  // tabs as the renderer's own archive does, when the store took the change (a stale one leaves the record and its tabs)
  // and it is the owner's archive (`update`; a transcript gone from disk archives as `facts`, and keeps its tab open).
  // Only an archive of a record held unarchived counts, so hydration's snapshot and the archived records it lists keep
  // their tabs as before.
  const closeArchived = (events: EventPayload<'session.changed'>[], before: ReadonlyMap<AppSessionId, { archived: boolean }>) => {
    const after = sessions().records;
    const closed = new Set<AppSessionId>();
    for (const { record, cause } of events) {
      const id = record.appId;
      if (cause !== 'update' || !record.archived || closed.has(id)) continue;
      if (before.get(id)?.archived === false && after.get(id)?.archived === true) {
        closed.add(id);
        stores.layout.getState().dropSession(id);
      }
    }
  };

  // In arrival order; consecutive changes and consecutive digests of one machine go to the store as one call each.
  const apply = (queue: Queued[]) => {
    for (let i = 0; i < queue.length; ) {
      const item = queue[i];
      const { m } = item;
      if (item.t === 'changed' || item.t === 'digest') {
        let j = i;
        while (j < queue.length && queue[j].t === item.t && queue[j].m === m) j++;
        const run = queue.slice(i, j);
        if (item.t === 'changed') {
          const events = run.map((q) => (q as Extract<Queued, { t: 'changed' }>).e);
          const before = sessions().records;
          sessions().applyChangedMany(events, m);
          closeArchived(events, before);
        } else sessions().applyDigests(run.map((q) => (q as Extract<Queued, { t: 'digest' }>).d), m);
        i = j;
        continue;
      }
      if (item.t === 'removed') {
        // A stale removal (older than what the store knows) leaves the session, so its tabs stay too; so does a tab the
        // registered retention keeps (a rolled-back provisional record, whose tab shows the failure).
        if (sessions().applyRemoved(item.e, m) && !currentTabRetention()?.retains(item.e.appSessionId)) stores.layout.getState().dropSession(item.e.appSessionId);
      } else if (item.t === 'projects') sessions().applyProjects(item.e, m);
      else sessions().applyScanProgress(item.e);
      i++;
    }
  };
  let queued: Queued[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    const queue = queued;
    queued = [];
    if (connected) apply(queue);
  };
  const flushNow = () => {
    if (timer) clearTimeout(timer);
    if (timer || queued.length > 0) flush();
  };
  const enqueue = (item: Queued) => {
    if (batchMs <= 0) return apply([item]);
    queued.push(item);
    timer ??= setTimeout(flush, batchMs);
  };

  const offs = [
    on('session.changed', (e, { machine: m }) => enqueue({ t: 'changed', e, m })),
    on('session.removed', (e, { machine: m }) => enqueue({ t: 'removed', e, m })),
    on('session.projects.changed', (e, { machine: m }) => enqueue({ t: 'projects', e, m })),
    on('session.digest', (d, { machine: m }) => enqueue({ t: 'digest', d, m })),
    on('fs.scanProgress', (e, { machine: m }) => enqueue({ t: 'progress', e, m })),
    on('session.status', (e, { machine }) => sessions().applyStatus(e, machine)),
    on('attention.changed', (e, { machine }) => attention().applyChanged(e, machine)),
    on('attention.notified', (e) => attention().applyNotified(e)),
    // E10: after a reconnect with windows open (a supervisor's crash and restart, Stop all, Restart now) the process
    // table is read again when the engine host regains ready, once per transition (X13 "Main's resync"). A host leaving
    // ready takes its statuses along, as in main: the successor's table (and its connect burst, which main relays after
    // the ready event) says again what is live, and a session it no longer runs reads not live. P5 O6 M4: per machine,
    // so one machine's host leaving blanks only its own sessions' statuses (the survey's §7.11).
    on('engine.hostState', ({ state }, { machine }) => {
      const link = linkOf(machine);
      const regained = state === 'ready' && link.hostState !== 'ready';
      link.hostState = state;
      if (state !== 'ready') {
        link.departures++;
        sessions().forgetStatuses(machine);
      }
      if (regained && !sessions().listedMachines.has(machine)) readEngineTable(machine);
    }),
    on('machines.changed', ({ machines }) => {
      rosterFreshness.advance();
      takeRoster(machines);
    }),
    on('org.rows.changed', (rows) => {
      rowsFreshness.advance();
      takeRows(rows);
    }),
  ];

  // Replies apply only while this connection and the machine's link generation are live; the stores' own revisions
  // decide against events. Whether the reply applied.
  const answer = async <T>(label: string, live: () => boolean, request: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>, apply: (value: T) => void, failed?: () => void): Promise<boolean> => {
    const result = await request;
    if (!live()) return false;
    // A snapshot nobody answers leaves its store empty and live on events: a degraded start, not a fault in the page.
    // (In launch mode `index` before C3 and C4 land, the record side and attention have no answerer at all.)
    if (!result.ok) {
      console.warn(`[shell] ${label} unavailable; starting empty`, result.error);
      failed?.();
      return false;
    }
    flushNow();
    apply(result.value);
    return true;
  };
  const stampOf = (link: Link) => {
    const live = connection.stamp();
    const linked = link.freshness.stamp();
    return () => live() && linked();
  };

  // C3's process table, so a live session reads live after a reload before its next status (debt wave 3); read again
  // when the machine's engine host regains ready (E10, above).
  const readEngineTable = (machine: MachineRef) => {
    const link = linkOf(machine);
    const asked = link.departures;
    void answer('engine.sessions', stampOf(link), client.invoke('engine.sessions', undefined, { machine }), (statuses) => {
      if (asked === link.departures) sessions().applyStatuses(statuses, machine);
    });
  };

  // One machine's snapshots, under C1's ordering rule (every event is subscribed above, and each store reconciles the
  // events that raced its snapshot). Whether its record side's snapshot applied, so the machine counts as loaded.
  const snapshot = (machine: MachineRef): Promise<boolean> => {
    const link = linkOf(machine);
    const live = stampOf(link);
    const opts = { machine };
    readEngineTable(machine);
    attention().beginSnapshot(machine);
    void answer('attention.list', live, client.invoke('attention.list', undefined, opts), (items) => attention().applySnapshot(items, machine), () => attention().cancelSnapshot(machine));
    return Promise.all([
      answer('session.list', live, client.invoke('session.list', {}, opts), (value) => sessions().applyList(value, machine)),
      answer('session.projects.list', live, client.invoke('session.projects.list', undefined, opts), (value) => sessions().applyProjects(value, machine)),
      answer('session.digests', live, client.invoke('session.digests', undefined, opts), ({ digests }) => sessions().applyDigests(digests, machine)),
    ]).then((applied) => applied.every(Boolean));
  };

  // Another machine's link, as the roster says: down keeps its records and attention as last known and forgets its
  // statuses; up as a new generation resets what its partition reconciles by, drops its events still queued from the
  // generation before, and takes its snapshot, after which the layout settles its tabs.
  const takeRoster = (machines: MachineState[]) => {
    stores.machines.getState().applyRoster(machines);
    for (const m of machines) {
      if (m.ref === local) continue;
      const link = linkOf(m.ref);
      if (m.state !== 'up') {
        // A machine not up has no live host here, whether or not this page saw it up: its statuses go, those heard
        // before the first roster included (forgetting none is a no-op).
        link.up = false;
        link.hostState = null;
        link.departures++;
        link.freshness.advance();
        sessions().forgetStatuses(m.ref);
        continue;
      }
      if (link.up && link.generation === m.generation) continue;
      link.up = true;
      link.hostState = null; // unknown until its first event; counted ready while the link is up
      link.freshness.advance();
      // Every generation the page learns is new to it, the first included: what it heard before (events that came ahead
      // of the first roster) belongs to no generation it has reconciled, and could outrank a restarted machine's counter.
      // The snapshot taken below is newer than all of it.
      queued = queued.filter((q) => q.m !== m.ref);
      sessions().resetMachine(m.ref);
      link.generation = m.generation;
      // P5 O8 M2: a machine the rows cover answers none of the five reads; it loads with its rows (`takeRows`)
      if (sessions().listedMachines.has(m.ref)) continue;
      void snapshot(m.ref).then((applied) => {
        if (!applied) return;
        stores.machines.getState().setLoaded(m.ref);
        stores.layout.getState().settleMachine(m.ref);
      });
    }
  };
  // P5 O8 M2 ("The snapshot rule"): the rows replace the listed partition whole. A machine they name loads only once this
  // run's hub snapshot has applied (`complete`) with none of its records awaiting verification (`pending`); until then
  // `knownTab` keeps its restored tabs, and when it loads the layout settles them as a snapshot's machine's.
  let covered = new Set<MachineRef>();
  const takeRows = (rows: OrgRows) => {
    sessions().applyRows(rows);
    const pending = new Set(rows.pending);
    const now = new Set(rows.complete ? rows.machines.filter((m) => m !== local && !pending.has(m)) : []);
    for (const m of now) {
      if (covered.has(m)) continue;
      stores.machines.getState().setLoaded(m);
      stores.layout.getState().settleMachine(m);
    }
    covered = now;
  };
  const rowsLive = rowsFreshness.stamp();
  void client.invoke('org.rows', undefined).then((result) => {
    if (!connected) return;
    if (!result.ok) console.warn('[shell] org.rows unavailable; no other machine’s rows', result.error);
    else if (rowsLive()) takeRows(result.value);
  });

  const rosterLive = rosterFreshness.stamp();
  const roster = client.invoke('machines.list', undefined).then((result) => {
    if (!connected) return;
    if (!result.ok) {
      console.warn('[shell] machines.list unavailable; keeping every other machine’s tabs', result.error);
      stores.machines.getState().rosterFailed();
    } else if (rosterLive()) takeRoster(result.value.machines);
  });

  // W12: a session's tabs live in its project's set: the record's project, else its unstarted intent's; a record whose
  // project changes (a refold) moves its tabs (the layout ignores this until it has hydrated). A session with neither
  // (a removal on its way to closing its tabs, a draft whose intent was just discarded) is not known: its tabs stay put.
  // P5 O6 M5: the set is the session's row's (`stores/org-projects.ts`): its org project's, or its machine's own when no
  // checkout lists its directory; so a change of any machine's projects can move tabs too. A session of a machine whose
  // snapshot has not completed this run is not known yet: its records may have landed before its projects, and filing
  // it then would move its tabs out of their restored set (the branch review), so nothing of it moves until it loads.
  const projectOf = (id: AppSessionId): TabSetKey | null | undefined =>
    !stores.machines.getState().loaded.has(machineOf(id)) ? undefined : sessionSetKey(sessions(), local, id, () => {
      const retention = currentTabRetention();
      const unstarted = retention ? retention.retains(id) : sessions().unstarted.has(id);
      return unstarted ? unstartedProjectOf(id) : undefined;
    });
  // P5 O6 M5 ("Migrating project-keyed state"): a layout key that is a project's address is from before M5. It becomes
  // the set that project's sessions file under once its machine has loaded and has derived the project's key; a project
  // its loaded machine no longer lists is gone; anything else waits for that machine's next projects. A project not
  // derived yet whose sessions file under its address meanwhile (a listed checkout's, `setKeyOfProject`) answers that
  // address: its set is already where it belongs, and its tabs refile as any set's do.
  const rekeyOf: RekeyOf = (address) => {
    if (!stores.machines.getState().loaded.has(machineOf(address))) return 'wait';
    const project = sessions().projects.get(address);
    if (project === undefined) return 'gone';
    const key = setKeyOfProject(selectOrgIndex(sessions(), local), project);
    return project.org === undefined && key !== address ? 'wait' : key;
  };
  // P5 O6 M2 (M6's scene): a held session's title, which its tabs keep for when it is not held
  const titleOf = (id: AppSessionId): string | undefined => {
    const record = sessions().records.get(id);
    return record === undefined ? undefined : displayTitle(record);
  };
  const offRefile = stores.sessions.subscribe((state, previous) => {
    if (state.projects !== previous.projects) stores.layout.getState().rekeyProjects();
    if (state.records !== previous.records || state.projects !== previous.projects) stores.layout.getState().refileTabs();
    if (state.records !== previous.records) stores.layout.getState().refreshTabTitles();
  });
  const offRekey = stores.machines.subscribe((state, previous) => {
    if (state.loaded === previous.loaded) return;
    stores.layout.getState().rekeyProjects();
    stores.layout.getState().refileTabs(); // what waited for the machine's whole snapshot files now
  });

  // P5 O6 M4 ("The layout across machines"): a tab is kept when its session is held or retained; a tab of another
  // machine also while that machine has not loaded this run, or while no roster has answered (a failed or missing roster
  // is never an absence). A machine absent from an answered roster is no longer configured, and its tabs go.
  // P5 O8 M2: and a tab whose address is listed.
  const knownTab = (id: AppSessionId): boolean => {
    if (sessions().records.has(id) || sessions().listed.has(id) || (currentTabRetention()?.retains(id) ?? false)) return true;
    const machine = machineOf(id);
    if (machine === local) return false;
    const { roster: state, machines, loaded } = stores.machines.getState();
    return state !== 'answered' || (machines.has(machine) && !loaded.has(machine));
  };

  // The local machine's link is the app's own, up for its life: its snapshot is taken now, and the layout hydrates once
  // it is in and the roster has answered or failed.
  const localSnapshot = snapshot(local);
  void Promise.all([localSnapshot, roster]).then(async ([applied]) => {
    if (!connected) return;
    sessions().setLoaded();
    if (applied) stores.machines.getState().setLoaded(local);
    const retention = currentTabRetention();
    if (retention) await retention.ready;
    if (!connected) return;
    await stores.layout.getState().hydrate(client, knownTab, { settle: flushNow, projectOf, rekeyOf, titleOf });
  });

  return () => {
    connected = false;
    offRefile();
    offRekey();
    if (timer) clearTimeout(timer);
    timer = null;
    queued = [];
    connection.advance();
    offs.forEach((off) => off());
  };
}

// C8a start: the panel summary's pushed facts (C8a execution document, Repository map). A separate connection, mounted
// by App.tsx's C8a block and by the `#panel` harness: C4's `git.changed` into the git store, and `fs.workflowChanged`
// invalidating that session's cached `fs.workflows` (a disk-only session's Background work). E11 W-D: the one listener
// for the scm queries the summary's push row and the Source control tool share (tools/scm/queries.ts): a head or refs
// move re-reads both for every session whose checkout is in that repository, and a session's setup (trust recorded in
// main) re-reads every session's `scm.status`. P5 E312: a session's published change re-asks gh for its PR state.
export function connectPanelEvents(client: MawsBridge = ipc): () => void {
  const offs = [
    client.on('git.changed', (event, { machine }) => {
      useGit.getState().applyChanged(event, machine);
      // P5 O6 M4: a repository is a machine's, so only that machine's sessions in it are read again.
      if (event.reason === 'head' || event.reason === 'refs') invalidateScmQueries((appSessionId) => machineOf(appSessionId) === machine && repoRootOf(appSessionId) === event.repoRoot);
    }),
    // P5 O3-E: a machine's host heard again (main's host.status, emitted after it re-reads the daemon at each ready of
    // the machine host): the git watches it could not answer are asked again (stores/git.ts)
    client.on('host.status', (_status, { machine }) => useGit.getState().retryUnanswered(machine)),
    client.on('session.setup', () => invalidateScmQueries(() => true, [SCM_STATUS_QUERIES])),
    client.on('fs.workflowChanged', ({ appSessionId }) => void queryClient.invalidateQueries({ queryKey: ['maws', 'fs.workflows', { appSessionId }] })),
    client.on('session.status', ({ appSessionId, status }) => refreshPublishedPrState(appSessionId, status.published, client)), // P5 E312
  ];
  return () => offs.forEach((off) => off());
}

// The repository a session's checkout is in, as the git store knows it (the surfaces that read the scm queries watch
// the checkout): the checkout from the session's record, else from its `scm.status` answer.
function repoRootOf(appSessionId: AppSessionId): string | null {
  const record = useSessions.getState().records.get(appSessionId);
  const checkout = record ? (record.worktree?.path ?? record.directory) : queryClient.getQueryData<ScmStatus>(scmStatusKey(appSessionId))?.directory;
  return checkout === undefined ? null : (useGit.getState().entries.get(checkoutKey(machineOf(appSessionId), checkout))?.status?.repoRoot ?? null);
}
// C8a end

// C8c start: the code tools' pushed facts (C8c execution document, Repository map). Mounted by App.tsx's C8c block:
// main's `files.changed` into the Files tool's listings and watches, then into the file viewer's tabs (in that order,
// so an `invalidated` directory is being re-watched before the viewer waits on it).
export function connectCodeEvents(client: MawsBridge = ipc): () => void {
  const offFiles = client.on('files.changed', (event) => {
    useFiles.getState().applyChanged(event);
    useViewer.getState().applyChanged(event);
  });
  // E5 start (M5): the quit guard's unsaved files. The window's dirty file tabs go to main on every change of the set,
  // and main's Save all saves them and is answered with those left unsaved (after the saves' own pushes).
  const offUnsaved = pushUnsavedFiles(client);
  // A Save all that throws still answers (fix wave 1), every dirty tab unsaved (a merge-view tab as its conflict, E11
  // W-D), so main never waits out its bound.
  const offSaveAll = client.on('layout.saveAll', ({ requestId }) =>
    void useViewer
      .getState()
      .saveAll()
      .catch((error: unknown) => {
        console.error('[editor] Save all failed; answering every dirty tab unsaved', error);
        return unsavedFailures(useViewer.getState().entries);
      })
      .then((failed) => client.invoke('layout.saveAllDone', { requestId, failed }))
      .then((result) => {
        if (!result.ok) console.warn('[editor] could not answer Save all', result.error);
      })
      .catch((error: unknown) => console.error('[editor] could not answer Save all', error)),
  );
  return () => {
    offFiles();
    offUnsaved();
    offSaveAll();
  };
  // E5 end
}
// C8c end
// C8b start: the agent tools' one pushed fact outside their stores (C8b execution document, Repository map). A task
// list changed on disk invalidates the checklist's query for that list id (C4 names the list by its sanitised directory,
// the key the checklist queries). Mounted by App.tsx's C8b block and by the `#panel` harness; the task-graph and relay
// stores subscribe to their own inputs, and the status comes from C5's useSessions.
export function connectAgentWorkEvents(client: AgentWorkClient = agentWorkClient()): () => void {
  return client.onTasksChanged(({ listId }) => void queryClient.invalidateQueries({ queryKey: ['fs.tasks', listId] }));
}
// C8b end
