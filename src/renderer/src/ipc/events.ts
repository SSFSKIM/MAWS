// The one subscription point that feeds the shell's stores from X2 events (C5 execution document, Renderer stores).
// C1's ordering rule: every event is subscribed before any snapshot command runs; each snapshot then reconciles with
// the events that raced it inside its store (by revision for sessions, projects and digests; by buffer and replay for
// attention). The layout hydrates once the sessions are known, so a persisted tab of a vanished session is dropped,
// unless a registered tab retention (C10's) keeps it.
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { EventPayload, MawsBridge, SessionDigest } from '@shared/ipc/schema';
import { currentTabRetention, unstartedProjectOf } from '../keymap/actions-runtime';
import { useAttention } from '../stores/attention';
import { createFreshness } from '../stores/freshness';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { ipc } from './client';
// C8a start
import { useGit } from '../stores/git';
import { queryClient } from './query';
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
}

// Debt wave 5 (the cold first paint): the record side's events (records, removals, projects, digests, the discovery
// pass's progress) are applied together once per window rather than one by one, so a flood of them (a cold index
// announces every session in the store, twice over with its seed digests) costs the page one store write per kind and
// one render per window instead of one render per event. 0 applies each event as it arrives. A snapshot reply applies
// after the window's events that preceded it, and the layout's hydration drains the window once its reads are in and
// before it captures the early changes it replays, so its tab check sees every event received and the removals the
// drain makes are replayed with the rest.
export const SHELL_BATCH_MS = 16;

type Queued =
  | { t: 'changed'; e: EventPayload<'session.changed'> }
  | { t: 'removed'; e: EventPayload<'session.removed'> }
  | { t: 'projects'; e: EventPayload<'session.projects.changed'> }
  | { t: 'digest'; d: SessionDigest }
  | { t: 'progress'; e: EventPayload<'fs.scanProgress'> };

export function connectShell(
  client: MawsBridge = ipc,
  stores: ShellStores = { sessions: useSessions, attention: useAttention, layout: useLayout },
  { batchMs = SHELL_BATCH_MS }: { batchMs?: number } = {},
): () => void {
  const sessions = () => stores.sessions.getState();
  const attention = () => stores.attention.getState();
  const freshness = createFreshness();
  let connected = true;
  const on: MawsBridge['on'] = (name, listener) => client.on(name, (payload) => connected && listener(payload));
  let hostState: EventPayload<'engine.hostState'>['state'] | null = null; // E10: the engine host's last state heard
  let departures = 0; // E10: how often the engine host was heard leaving ready; a table read before the latest is stale

  // In arrival order; consecutive changes and consecutive digests go to the store as one call each.
  const apply = (queue: Queued[]) => {
    for (let i = 0; i < queue.length; ) {
      const item = queue[i];
      if (item.t === 'changed' || item.t === 'digest') {
        let j = i;
        while (j < queue.length && queue[j].t === item.t) j++;
        const run = queue.slice(i, j);
        if (item.t === 'changed') sessions().applyChangedMany(run.map((q) => (q as Extract<Queued, { t: 'changed' }>).e));
        else sessions().applyDigests(run.map((q) => (q as Extract<Queued, { t: 'digest' }>).d));
        i = j;
        continue;
      }
      if (item.t === 'removed') {
        // A stale removal (older than what the store knows) leaves the session, so its tabs stay too; so does a tab the
        // registered retention keeps (a rolled-back provisional record, whose tab shows the failure).
        if (sessions().applyRemoved(item.e) && !currentTabRetention()?.retains(item.e.appSessionId)) stores.layout.getState().dropSession(item.e.appSessionId);
      } else if (item.t === 'projects') sessions().applyProjects(item.e);
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
    on('session.changed', (e) => enqueue({ t: 'changed', e })),
    on('session.removed', (e) => enqueue({ t: 'removed', e })),
    on('session.projects.changed', (e) => enqueue({ t: 'projects', e })),
    on('session.digest', (d) => enqueue({ t: 'digest', d })),
    on('fs.scanProgress', (e) => enqueue({ t: 'progress', e })),
    on('session.status', (e) => sessions().applyStatus(e)),
    on('attention.changed', (e) => attention().applyChanged(e)),
    on('attention.notified', (e) => attention().applyNotified(e)),
    // E10: after a reconnect with windows open (a supervisor's crash and restart, Stop all, Restart now) the process
    // table is read again when the engine host regains ready, once per transition (X13 "Main's resync"). A host leaving
    // ready takes its statuses along, as in main: the successor's table (and its connect burst, which main relays after
    // the ready event) says again what is live, and a session it no longer runs reads not live.
    on('engine.hostState', ({ state }) => {
      const regained = state === 'ready' && hostState !== 'ready';
      hostState = state;
      if (state !== 'ready') {
        departures++;
        sessions().forgetStatuses();
      }
      if (regained) readEngineTable();
    }),
  ];

  // Replies apply only while this connection is live; the stores' own revisions decide against events.
  const live = freshness.stamp();
  const answer = async <T>(label: string, request: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>, apply: (value: T) => void) => {
    const result = await request;
    if (!live()) return;
    // A snapshot nobody answers leaves its store empty and live on events: a degraded start, not a fault in the page.
    // (In launch mode `index` before C3 and C4 land, the record side and attention have no answerer at all.)
    if (!result.ok) console.warn(`[shell] ${label} unavailable; starting empty`, result.error);
    else {
      flushNow();
      apply(result.value);
    }
  };

  // C3's process table, so a live session reads live after a reload before its next status (debt wave 3); read again
  // when the engine host regains ready (E10, above).
  const readEngineTable = () => {
    const asked = departures;
    void answer('engine.sessions', client.invoke('engine.sessions', undefined), (statuses) => {
      if (asked === departures) sessions().applyStatuses(statuses);
    });
  };
  readEngineTable();

  attention().beginSnapshot();
  void answer('attention.list', client.invoke('attention.list', undefined), (items) => attention().applySnapshot(items)).then(() => {
    if (live() && !attention().loaded) attention().applySnapshot([]); // no answerer: start empty, keep what was buffered
  });

  // W12: a session's tabs live in its project's set: the record's project, else its unstarted intent's; a record whose
  // project changes (a refold) moves its tabs (the layout ignores this until it has hydrated). A session with neither
  // (a removal on its way to closing its tabs, a draft whose intent was just discarded) is not known: its tabs stay put.
  const projectOf = (id: AppSessionId): ProjectId | null | undefined => {
    const record = sessions().records.get(id);
    if (record) return record.projectId;
    const retention = currentTabRetention();
    const unstarted = retention ? retention.retains(id) : sessions().unstarted.has(id);
    return unstarted ? unstartedProjectOf(id) : undefined;
  };
  const offRefile = stores.sessions.subscribe((state, previous) => {
    if (state.records !== previous.records) stores.layout.getState().refileTabs();
  });

  void Promise.all([
    answer('session.list', client.invoke('session.list', {}), (value) => sessions().applyList(value)),
    answer('session.projects.list', client.invoke('session.projects.list', undefined), (value) => sessions().applyProjects(value)),
    answer('session.digests', client.invoke('session.digests', undefined), ({ digests }) => sessions().applyDigests(digests)),
  ]).then(async () => {
    if (!live()) return;
    sessions().setLoaded();
    const retention = currentTabRetention();
    if (retention) await retention.ready;
    if (!live()) return;
    await stores.layout.getState().hydrate(client, (id) => sessions().records.has(id) || (retention?.retains(id) ?? false), { settle: flushNow, projectOf });
  });

  return () => {
    connected = false;
    offRefile();
    if (timer) clearTimeout(timer);
    timer = null;
    queued = [];
    freshness.advance();
    offs.forEach((off) => off());
  };
}

// C8a start: the panel summary's pushed facts (C8a execution document, Repository map). A separate connection, mounted
// by App.tsx's C8a block and by the `#panel` harness: C4's `git.changed` into the git store, and `fs.workflowChanged`
// invalidating that session's cached `fs.workflows` (a disk-only session's Background work).
export function connectPanelEvents(client: MawsBridge = ipc): () => void {
  const offs = [
    client.on('git.changed', (event) => useGit.getState().applyChanged(event)),
    client.on('fs.workflowChanged', ({ appSessionId }) => void queryClient.invalidateQueries({ queryKey: ['maws', 'fs.workflows', { appSessionId }] })),
  ];
  return () => offs.forEach((off) => off());
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
