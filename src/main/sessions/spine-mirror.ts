// Main's view of the spine on the daemon shape (P5 O3-D M5b; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md,
// Interfaces §F; D14, D19; contract O3X4): a mirror of what `mawsd`'s spine holds, read over main's `machine` transport
// and held in memory, so every synchronous member of `SpineView` answers from memory as the in-process backing does
// (src/services/sessions/spine-view.ts). Only `acquire` and `fileLinkedPaths` cross the socket.
//
// At each streaming of the `machine` host (main's transport registers no resync, so it streams from its welcome) the
// mirror reads its snapshot: `session.list {includeArchived: true}`, `session.projects.list` (its `rows`),
// `session.digests`, `attention.list`, `session.intent.list`, `session.visible` and `session.launchMode`, and in launch
// mode scenario `session.engineStatuses` (M5b fix round 6: the scenario's statuses, which no stream carries); and, beside it,
// tells `mawsd` this app's browser socket directory (`machine.client`) and follows every live session from the cursors
// it holds (`session.follow`, `live: true`). It follows the front's events through `hosts.onEvent` (validated by main's
// supervisor): `session.changed`, `session.removed`, `session.projects.changed`, `session.digest`, `attention.changed`
// with its `silent` ids, `session.intent.changed`, `session.visibleChanged`; and the streams' `session.status` (the
// engine statuses, each stream's first status its snapshot, so they never depend on the spine being loaded, D19) and
// `session.eventBatch` (the cursors only).
//
// The race between a snapshot in flight and the events heard meanwhile has one rule: an event always wins over the
// snapshot it raced, since the spine emits after it mutates. Per member the ids an event touched while that member's
// snapshot was out (every id, for a whole-list event such as `session.projects.changed`) keep the event's rows; the
// snapshot gives the others. No order is assumed between paths (D43).
//
// `unavailable()` is null once every member's snapshot of this streaming answered (`SCENARIO_UNAVAILABLE` in launch mode
// scenario, as in process); before that the daemon's refusal (`daemon.status.spine.refused`), the snapshot's failure, or
// the machine host's state. A snapshot that fails is read again after a backoff, and at each new daemon status. While the
// machine host does not stream (a `mawsd` restart) the maps are kept, stale and readable, and refilled at its next
// streaming. `availability` fires at each change of `unavailable()`. The first snapshot fires no event per record or
// digest (the readers start from `availability`), and its attention items are told silent (what the app found is not
// news); a later snapshot fires what changed.
//
// The cursor main presents for a session (§C) is the last delivered event of its current launch; with none yet, the row
// its stream opened at (the launch's `lastEventSeq` at its first status, `idx` -1), so a re-follow after a `mawsd`
// restart replays exactly what the first opening would have sent.
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, AttentionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { midTurnCountOf } from '@shared/engine/mid-turn';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { HostSupervisor } from '@shared/host/host-supervisor';
import { eventPosition } from '@shared/host/stream-catchup';
import type { CommandInput, CommandName, CommandOutput, CommandResult, ProjectRecord, SessionDigest } from '@shared/ipc/schema';
import type { StreamCursor } from '@shared/ipc/schema/session';
import type { SetupIntent } from '@shared/sessions/intent';
import type { AcquireOutcome } from '@shared/sessions/setup';
import { SCENARIO_UNAVAILABLE, type SpineView, type SpineViewEvents } from '@shared/spine/view';

export type MirrorHosts = Pick<HostSupervisor, 'dispatch' | 'onEvent' | 'onStreaming' | 'streaming' | 'onState' | 'snapshot'>;

export interface SpineMirrorOptions {
  hosts: MirrorHosts;
  spineRefused(): string | null; // the daemon's last `daemon.status.spine.refused`
  onDaemonStatus(listener: () => void): () => void; // a new `daemon.status` was read
  browserSocket(): string | null; // this app's cua socket directory, told at each streaming (`machine.client`)
  retryMs?: number; // the first backoff after a snapshot failed (doubling to RETRY_MAX_MS)
  log(line: string): void;
}

export interface SpineMirror {
  readonly view: SpineView;
  stop(): void;
}

export const RETRY_MS = 2_000;
export const RETRY_MAX_MS = 60_000;

type Member = 'records' | 'projects' | 'digests' | 'attention' | 'intents' | 'visible' | 'mode' | 'statuses';
// What an event touched while its member's snapshot was out: ids, or the whole list
type Raced = { ids: Set<string>; whole: boolean };

export function createMirrorSpineView(options: SpineMirrorOptions): SpineMirror {
  const { hosts, log } = options;
  const records = new Map<AppSessionId, SessionRecord>();
  let listed: readonly ProjectRecord[] = [];
  let rows: readonly ProjectRecord[] = [];
  const digests = new Map<AppSessionId, SessionDigest>();
  const attention = new Map<AppSessionId, readonly AttentionItem[]>();
  const intents = new Map<AppSessionId, SetupIntent>();
  const visible = new Set<AppSessionId>();
  let mode: 'index' | 'scenario' = 'index';
  const statuses = new Map<AppSessionId, EngineSessionStatus>();
  const cursors = new Map<AppSessionId, StreamCursor>();

  const listeners: { [E in keyof SpineViewEvents]: Set<SpineViewEvents[E]> } = {
    availability: new Set(), record: new Set(), projects: new Set(), digest: new Set(), attention: new Set(), engine: new Set(), intent: new Set(), visible: new Set(),
  };
  const fire = <E extends keyof SpineViewEvents>(event: E, ...args: Parameters<SpineViewEvents[E]>) => {
    for (const listener of [...listeners[event]]) {
      try {
        (listener as (...a: Parameters<SpineViewEvents[E]>) => void)(...args);
      } catch (error) {
        log(`[spine-mirror] a ${event} listener failed: ${messageOf(error)}`);
      }
    }
  };

  // ---- availability ---------------------------------------------------------------------------------------------------
  let generation = 0; // one per streaming; a snapshot answer of an earlier one is dropped
  let loaded = false; // every member's snapshot of this streaming answered
  let everLoaded = false;
  let failure: string | null = null;
  let stopped = false;
  const unavailable = (): string | null => {
    if (!hosts.streaming('machine')) {
      const { state } = hosts.snapshot('machine');
      return `the machine daemon is ${state === 'ready' ? 'connecting' : state}`;
    }
    if (!loaded) return options.spineRefused() ?? failure ?? 'the machine daemon’s spine is loading';
    return mode === 'scenario' ? SCENARIO_UNAVAILABLE : null;
  };
  let told: string | null | undefined; // what `availability` last said
  const availabilityChanged = () => {
    const now = unavailable();
    if (now === told) return;
    told = now;
    fire('availability', now);
  };

  // ---- the snapshot ---------------------------------------------------------------------------------------------------
  const raced: Partial<Record<Member, Raced>> = {};
  const touch = (member: Member, id: string | null) => {
    const race = raced[member];
    if (race === undefined) return;
    if (id === null) race.whole = true;
    else race.ids.add(id);
  };
  const read = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> => {
    const answer = (await hosts.dispatch('machine', name, input)) as CommandResult<N>;
    if (!answer.ok) throw new Error(answer.error.message);
    return answer.value;
  };

  // A keyed member's snapshot taken over what the events left: the raced ids keep their present rows, the snapshot gives
  // the others; what changed is told (but not by the first snapshot, `quiet`)
  function settle<K extends string, T>(map: Map<K, T>, snapshot: readonly T[], keyOf: (row: T) => K, race: Raced, quiet: boolean, tell: (id: K, row: T | null) => void): void {
    if (race.whole) return;
    const next = new Map<K, T>();
    for (const row of snapshot) if (!race.ids.has(keyOf(row))) next.set(keyOf(row), row);
    for (const id of race.ids as Set<K>) if (map.has(id)) next.set(id, map.get(id)!);
    const removed = [...map.keys()].filter((id) => !next.has(id));
    const changed = [...next].filter(([id, row]) => !map.has(id) || (!race.ids.has(id) && JSON.stringify(map.get(id)) !== JSON.stringify(row)));
    map.clear();
    for (const [id, row] of next) map.set(id, row);
    if (quiet) return;
    for (const id of removed) tell(id, null);
    for (const [id, row] of changed) tell(id, row);
  }

  const snapshotReads: { member: Member; take(gen: number, race: Raced): Promise<void> }[] = [
    {
      member: 'records',
      take: async (gen, race) => {
        const { sessions } = await read('session.list', { includeArchived: true });
        if (gen === generation) settle(records, sessions, (r) => r.appId, race, !everLoaded, (id, r) => fire('record', id, r));
      },
    },
    {
      member: 'projects',
      take: async (gen, race) => {
        const answer = await read('session.projects.list', undefined);
        if (gen !== generation || race.whole) return;
        listed = answer.projects;
        rows = answer.rows ?? answer.projects;
        fire('projects');
      },
    },
    {
      member: 'digests',
      take: async (gen, race) => {
        const answer = await read('session.digests', undefined);
        if (gen === generation) settle(digests, answer.digests, (d) => d.appSessionId as AppSessionId, race, !everLoaded, (_id, d) => d && fire('digest', d));
      },
    },
    {
      member: 'attention',
      take: async (gen, race) => {
        const items = await read('attention.list', undefined);
        if (gen !== generation || race.whole) return;
        const grouped = new Map<AppSessionId, AttentionItem[]>();
        for (const one of items) grouped.set(one.appSessionId as AppSessionId, [...(grouped.get(one.appSessionId as AppSessionId) ?? []), one]);
        // told per session: the first snapshot's items silent (found, not new), a later one's as any change
        const first = !everLoaded;
        const before = new Map(attention);
        for (const id of [...attention.keys()]) if (!race.ids.has(id)) attention.delete(id);
        for (const [id, list] of grouped) if (!race.ids.has(id)) attention.set(id, list);
        for (const [id, list] of before) if (!race.ids.has(id) && !grouped.has(id) && list.length > 0) fire('attention', id, [], new Set());
        for (const [id, list] of grouped) {
          if (race.ids.has(id) || (!first && JSON.stringify(before.get(id)) === JSON.stringify(list))) continue;
          fire('attention', id, list, new Set(first ? list.map((one) => one.id as AttentionId) : []));
        }
      },
    },
    {
      member: 'intents',
      take: async (gen, race) => {
        const answer = await read('session.intent.list', undefined);
        if (gen === generation) settle(intents, answer.intents, (i) => i.appSessionId as AppSessionId, race, false, (id, i) => fire('intent', id, i));
      },
    },
    {
      member: 'visible',
      take: async (gen, race) => {
        const answer = await read('session.visible', undefined);
        if (gen !== generation || race.whole) return;
        const shown = new Set(answer.sessions as AppSessionId[]);
        for (const id of race.ids as Set<AppSessionId>) if (visible.has(id)) shown.add(id);
        else shown.delete(id);
        const gone = [...visible].filter((id) => !shown.has(id));
        const came = [...shown].filter((id) => !visible.has(id));
        visible.clear();
        for (const id of shown) visible.add(id);
        for (const id of gone) fire('visible', id, false);
        for (const id of came) fire('visible', id, true);
      },
    },
    {
      member: 'mode',
      take: async (gen) => {
        const answer = await read('session.launchMode', undefined);
        if (gen === generation) mode = answer.mode;
      },
    },
    {
      // M5b fix round 6: a scenario's statuses are the spine's own (D11), its load emits none of them and no engine host
      // holds them, so no stream carries them; read here, each taken as a first-heard status is unless one was heard
      // while the read was out. In launch mode index every live session's status comes from its stream (D19), and the
      // spine's fold, which may lag the streams, is not applied.
      member: 'statuses',
      take: async (gen, race) => {
        const [launch, answer] = await Promise.all([read('session.launchMode', undefined), read('session.engineStatuses', undefined)]);
        if (gen !== generation || launch.mode !== 'scenario') return;
        for (const status of answer.statuses) if (!race.ids.has(status.appSessionId)) takeStatus(status.appSessionId as AppSessionId, status);
      },
    },
  ];

  let retry: ReturnType<typeof setTimeout> | null = null;
  let backoff = options.retryMs ?? RETRY_MS;
  let loading: number | null = null; // the generation whose snapshot is out: one at a time per streaming
  function load(): void {
    if (stopped || !hosts.streaming('machine') || loading === generation) return;
    if (retry) clearTimeout(retry);
    retry = null;
    const gen = generation;
    loading = gen;
    const races = snapshotReads.map(({ member }) => (raced[member] = { ids: new Set(), whole: false }));
    void Promise.allSettled(snapshotReads.map(({ take }, i) => take(gen, races[i]!))).then((results) => {
      if (loading === gen) loading = null;
      if (gen !== generation || stopped) return;
      for (const { member } of snapshotReads) delete raced[member];
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failed) {
        failure = `the machine daemon’s spine could not be read: ${messageOf(failed.reason)}`;
        log(`[spine-mirror] ${failure}; reading it again in ${backoff} ms`);
        retry = setTimeout(load, backoff);
        retry.unref?.();
        backoff = Math.min(backoff * 2, RETRY_MAX_MS);
      } else {
        failure = null;
        loaded = true;
        everLoaded = true;
        backoff = options.retryMs ?? RETRY_MS;
      }
      availabilityChanged();
    });
  }

  // ---- the streams ----------------------------------------------------------------------------------------------------
  const knownRecord = (status: EngineSessionStatus) => records.has(status.appSessionId as AppSessionId);
  function follow(): void {
    const socket = options.browserSocket();
    void hosts.dispatch('machine', 'machine.client', { browserSocket: socket }).then((answer) => {
      if (!answer.ok) log(`[spine-mirror] machine.client: ${answer.error.code} ${answer.error.message}`);
    });
    const gen = generation;
    const sessions = [...statuses].filter(([, status]) => status.process !== 'exited').map(([appSessionId]) => ({ appSessionId, cursor: cursors.get(appSessionId) ?? null }));
    void hosts.dispatch('machine', 'session.follow', { sessions, live: true }).then((answer) => {
      if (!answer.ok) return log(`[spine-mirror] session.follow: ${answer.error.code} ${answer.error.message}`);
      if (gen !== generation || stopped) return;
      for (const stream of (answer.value as CommandOutput<'session.follow'>).streams) {
        const id = stream.appSessionId as AppSessionId;
        if (stream.mode === 'missing') log(`[spine-mirror] ${id}'s stream lost the range after its cursor; it goes on from its journal's last row`);
        // not live on the engine host now (replaced, or parked, meanwhile): the status held is stale. A scenario's
        // statuses are the spine's own emits, which no engine host holds (D11)
        if (mode !== 'scenario' && stream.launchId === null && statuses.has(id) && statuses.get(id)!.process !== 'exited') {
          statuses.delete(id);
          cursors.delete(id);
          fire('engine', id, null);
        }
      }
    });
  }
  const advance = (appSessionId: AppSessionId, events: readonly SessionEvent[]) => {
    for (const event of events) {
      const at = eventPosition(appSessionId, event);
      if (at === null) continue;
      const cursor = cursors.get(appSessionId);
      if (cursor && cursor.launchId === at.launch && (at.seq < cursor.seq || (at.seq === cursor.seq && at.idx <= cursor.idx))) continue;
      cursors.set(appSessionId, { launchId: at.launch, seq: at.seq, idx: at.idx });
    }
  };

  // A status heard, or (in launch mode scenario) read: a launch new to the mirror opens its cursor at its last journaled row
  function takeStatus(id: AppSessionId, status: EngineSessionStatus): void {
    const cursor = cursors.get(id);
    if (cursor?.launchId !== status.launchId) cursors.set(id, { launchId: status.launchId, seq: status.lastEventSeq, idx: -1 });
    statuses.set(id, status);
    fire('engine', id, status);
  }

  // ---- the events -----------------------------------------------------------------------------------------------------
  const offs = [
    hosts.onEvent('session.changed', ({ record }) => {
      const id = record.appId as AppSessionId;
      records.set(id, record);
      touch('records', id);
      fire('record', id, record);
    }),
    hosts.onEvent('session.removed', ({ appSessionId }) => {
      const id = appSessionId as AppSessionId;
      for (const member of ['records', 'digests', 'attention', 'visible'] as const) touch(member, id);
      records.delete(id);
      digests.delete(id);
      attention.delete(id);
      visible.delete(id);
      statuses.delete(id);
      cursors.delete(id);
      fire('record', id, null);
    }),
    hosts.onEvent('session.projects.changed', (change) => {
      listed = change.projects;
      if (change.rows) rows = change.rows;
      touch('projects', null);
      fire('projects');
    }),
    hosts.onEvent('session.digest', (digest) => {
      const id = digest.appSessionId as AppSessionId;
      digests.set(id, digest);
      touch('digests', id);
      fire('digest', digest);
    }),
    hosts.onEvent('attention.changed', ({ appSessionId, items, silent }) => {
      const id = appSessionId as AppSessionId;
      attention.set(id, items);
      touch('attention', id);
      fire('attention', id, items, new Set((silent ?? []) as AttentionId[]));
    }),
    hosts.onEvent('session.intent.changed', ({ appSessionId, intent }) => {
      const id = appSessionId as AppSessionId;
      if (intent) intents.set(id, intent);
      else intents.delete(id);
      touch('intents', id);
      fire('intent', id, intent);
    }),
    hosts.onEvent('session.visibleChanged', ({ appSessionId, visible: shown }) => {
      const id = appSessionId as AppSessionId;
      touch('visible', id);
      if (visible.has(id) === shown) return;
      if (shown) visible.add(id);
      else visible.delete(id);
      fire('visible', id, shown);
    }),
    hosts.onEvent('session.status', ({ appSessionId, status }) => {
      touch('statuses', appSessionId);
      takeStatus(appSessionId as AppSessionId, status);
    }),
    hosts.onEvent('session.eventBatch', ({ appSessionId, events }) => advance(appSessionId as AppSessionId, events)),
    hosts.onStreaming('machine', () => {
      generation += 1;
      loaded = false;
      failure = null;
      availabilityChanged();
      load();
      follow();
    }),
    hosts.onState('machine', (state) => {
      if (state.state !== 'ready') loaded = false;
      availabilityChanged();
    }),
    options.onDaemonStatus(() => {
      if (!loaded) load();
      availabilityChanged();
    }),
  ];

  const view: SpineView = {
    unavailable,
    record: (id) => records.get(id) ?? null,
    records: () => [...records.values()],
    projects: () => listed,
    projectRows: () => rows,
    project: (id) => rows.find((row) => row.id === id) ?? null,
    digest: (id) => digests.get(id) ?? null,
    digests: () => [...digests.values()],
    attention: (id) => attention.get(id) ?? [],
    allAttention: () => attention,
    engineStatuses: () => [...statuses.values()].filter(knownRecord),
    midTurnCount: () => midTurnCountOf([...statuses.values()].filter(knownRecord)),
    intent: (id) => intents.get(id) ?? null,
    intents: () => [...intents.values()],
    known: (id) => records.has(id) || intents.has(id),
    visibleSessions: () => [...visible],
    on(event, listener) {
      listeners[event].add(listener);
      return () => void listeners[event].delete(listener);
    },
    async acquire(appSessionId, reason) {
      return (await read('session.acquire', { appSessionId, reason })) as AcquireOutcome;
    },
    async fileLinkedPaths(appSessionId) {
      try {
        return (await read('library.fileLinkedPaths', { appSessionId })).paths;
      } catch (error) {
        log(`[spine-mirror] library.fileLinkedPaths for ${appSessionId}: ${messageOf(error)}; none admitted`);
        return [];
      }
    },
  };
  told = unavailable();
  if (hosts.streaming('machine')) {
    load();
    follow();
  }
  return {
    view,
    stop() {
      stopped = true;
      if (retry) clearTimeout(retry);
      offs.forEach((off) => off());
    },
  };
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
