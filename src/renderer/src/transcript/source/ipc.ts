// The transcript's X2 adapters (C6 execution document, Public surface and "X2 surface C6 consumes"), one call each:
// `ipcSource` follows a session (or one child agent, choosing its provenance) under the store's hydration protocol, the default `loadSpill`
// reads a spilled result, `ipcRewind` backs the receipt's Undo, `ipcOpenExternal` opens a markdown link. Each has an
// `…Over(client)` form so tests drive it with a fake X2 client; the plain forms use the app's validated client.
import type { SessionEvent } from '@shared/graph/events';
import { FOLLOW_RELEASED } from '@shared/graph/history-window';
import type { AgentId, AppSessionId, EventId, MessageUuid, SessionId } from '@shared/graph/ids';
import type { CommandName, CommandOutput, CommandResult, MawsBridge } from '@shared/ipc/schema';
import { bareOf, isAddress, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { isAppSynthesised } from '@shared/sessions/app-events';
import { ipc } from '../../ipc/client';
import { useTranscriptStore } from '../../stores/transcript';
import { useHosts } from '../../stores/hosts'; // the UX wave, U9 (O-11b)
import { turnId as turnIdOf } from '../model/keys';
import type { TranscriptState } from '../model/reduce';
import type { Spill, TurnId } from '../model/rows';
import type { RewindInterface } from '../view/context';
import { HISTORY_OMITTED, HISTORY_TOO_LARGE, historyGapEvent, unseenTurnEndEvent } from '../model/gap'; // P5 O7 M2; M4: HISTORY_OMITTED; M8: unseenTurnEndEvent
import { remoteMachineName } from '../../lane-a/remote-session'; // P5 O7 M2: a machine's name for the bar's words
import { historyReadsNow, isRemoteLaneB, remoteLaneBStateOf, whenHistoryReads } from '../../lane-b/remote-session'; // P5 O15 M2b: the stream's latest answer at a loss; U9 M5: the settled word
import { HistoryPager, withHistoryGap, withOmittedBar, withoutOlderThanWindow } from './older';
import type { TranscriptSource } from './types';

// How much of a spilled result is read into the detail (residue *Spilled results*): past it, the head and Open full log.
export const SPILL_READ_BYTES = 2 * 1024 * 1024;

const valueOf = <N extends CommandName>(result: CommandResult<N>): CommandOutput<N> => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

// `session.eventBatch` carries every event of an app session, a followed child's own slice included (C4 emits it with
// `agentId` set). The parent takes its own events and the child traffic it indexes under the parent tool use
// (`parentToolUseId` set), never a child's slice, which would render as top-level. C3 tags the parent's lifecycle reports
// on a local agent (`subagent.*`, `task.updated`) with the agent they concern, so a top-level event whose task id is its
// own agent id is such a report: the parent's, never part of the child's slice (for local agents the two ids carry the
// same string, C1 Interfaces).
const reportsOnOwnAgent = (event: SessionEvent) => event.agentId !== null && 'taskId' in event && (event.taskId as string | null) === (event.agentId as string);
const ofParent = (event: SessionEvent) => event.agentId === null || event.parentToolUseId !== null || reportsOnOwnAgent(event);
const ownOf = (agentId: AgentId) => (event: SessionEvent) => event.agentId === agentId && !reportsOnOwnAgent(event);

// A session's snapshot, waiting out a session the engine host does not know yet. A session started through "+" gets its
// record (and so its transcript pane) before C3's launch has wired its stream, and its engine id is bound only once the
// engine reports it (C10's setup order), so a read in between is refused with `unknown app session` (X2, fs.ts). The
// read is asked again at each sign the host may now answer, the session's status, a batch of its events or a change
// to its record, and the refusal stands once KNOWN_WAIT_MS pass with none that helps, or the subscription ends. The
// signs are listened for before the first read, so one that arrives while the refusal is on its way is not missed.
export const KNOWN_WAIT_MS = 150_000; // C10's launch watchdog: a launch that reports nothing for this long has failed
const UNKNOWN_SESSION = 'unknown app session';
const CHILD_BACKFILL_WAIT_MS = 30_000;

// What a snapshot's wait hears from its subscription: the batches it receives for the session (a sign, without a second
// `session.eventBatch` listener) and its end (the key detached: the wait gives up at once).
interface KnownWatch {
  batch: (() => void) | null;
  ended: AbortController;
}

// The long-transcript window: the host answers a disk-backed session whose transcript it is still reading through with
// an empty, incomplete page (never the oldest records), and sends the newest window as a batch once it has; the
// snapshot asks again at that batch or the follow's next state, for the window and its `earlier` cursor.
export const BACKFILL_WAIT_MS = 60_000;
const backfilling = (page: CommandOutput<'session.events'>) => !page.complete && page.events.length === 0 && page.historyUnavailable !== true;

async function eventsOnceKnown(client: MawsBridge, appSessionId: AppSessionId, watch: KnownWatch | null): Promise<CommandResult<'session.events'>> {
  let signalled = false;
  let wake: (() => void) | null = null;
  const signal = () => {
    signalled = true;
    wake?.();
  };
  const offs = [
    client.on('session.status', (payload) => payload.appSessionId === appSessionId && signal()),
    client.on('session.changed', (payload) => payload.record.appId === appSessionId && signal()),
    client.on('fs.followState', (payload) => payload.appSessionId === appSessionId && payload.agentId === null && payload.state !== 'backfilling' && signal()),
  ];
  if (watch) watch.batch = signal;
  const ended = watch?.ended.signal ?? null;
  const deadline = Date.now() + KNOWN_WAIT_MS;
  const backfillDeadline = Date.now() + BACKFILL_WAIT_MS;
  try {
    for (;;) {
      signalled = false;
      const result = await client.invoke('session.events', { appSessionId, afterSeq: null, limit: null });
      const reading = result.ok && backfilling(result.value);
      if (!reading && (result.ok || !result.error.message.startsWith(UNKNOWN_SESSION) || ended?.aborted)) return result;
      if (reading && (ended?.aborted || Date.now() >= backfillDeadline)) return result;
      if (signalled) continue;
      // true at a sign; false when the time is up or the subscription ended
      const woke = await new Promise<boolean>((resolve) => {
        const stop = () => {
          clearTimeout(timer);
          ended?.removeEventListener('abort', stop);
          resolve(signalled);
        };
        const timer = setTimeout(stop, (reading ? backfillDeadline : deadline) - Date.now());
        wake = stop;
        ended?.addEventListener('abort', stop);
      });
      wake = null;
      if (!woke) return result;
    }
  } finally {
    for (const off of offs) off();
    if (watch) watch.batch = null;
  }
}

// The UX wave, U9 (O-11b; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, M3): a first read of a session
// on this Mac that failed because its engine host was away (`host_unavailable`: a restart, an update's handover) is made
// again at the host's next ready, once per ready, while the key stays hydrating (the pane's "Loading…"). The ready is the
// engine host's state as the hosts store holds it, ordered by its revision: one newer than the read's start that is
// already there when the failure is processed is that ready, taken at once. With no ready within HOST_RETURN_WAIT_MS, or a
// second failure, the read fails as before ("Couldn’t load this conversation", with Retry), and a later ready still reads
// it again. No timer retries: one read per ready cannot loop against a host that keeps failing. Another machine's session
// heals at its link's return instead (the ticket on history read after a link's return), and any other failure fails at once.
export const HOST_RETURN_WAIT_MS = 15_000;
const engineHost = () => useHosts.getState().hosts.engine;
const engineRevision = () => engineHost()?.revision ?? -1;

// The revision of the first ready newer than `after`, or null at `ms` or when `ended` aborts first.
function readyAfter(after: number, ms: number, ended: AbortSignal | null): Promise<number | null> {
  return new Promise((resolve) => {
    let off = () => {};
    const done = (revision: number | null) => {
      clearTimeout(timer);
      off();
      ended?.removeEventListener('abort', abort);
      resolve(revision);
    };
    const abort = () => done(null);
    const check = () => {
      const host = engineHost();
      if (host?.state === 'ready' && host.revision > after) done(host.revision);
    };
    const timer = setTimeout(() => done(null), ms);
    ended?.addEventListener('abort', abort);
    off = useHosts.subscribe(check);
    check();
  });
}

// After a read the host's absence failed for good: once the key has failed, it is read again at a ready newer than
// `after` (the ready the failed read was made at, or the revision when the wait ran out), one already in the hosts store
// when the key fails included (a ready that overtook the read), so each ready is taken once. Nothing is asked once the
// key is let go, whole, or read again by someone else (a Retry), whose read waits for its own ready.
function readAgainAtReady(key: string, after: number): void {
  const transcripts = () => useTranscriptStore.getState();
  let failed = false;
  let done = false;
  const stop = () => {
    done = true;
    offHosts();
    offTranscripts();
  };
  const check = () => {
    if (done) return;
    const phase = transcripts().entries[key]?.phase;
    if (!transcripts().attached(key) || phase === 'live' || (failed && phase !== 'failed')) return stop();
    if (phase !== 'failed') return;
    failed = true;
    const host = engineHost();
    if (host?.state !== 'ready' || host.revision <= after) return;
    stop();
    void transcripts().retry(key);
  };
  const offHosts = useHosts.subscribe(check);
  const offTranscripts = useTranscriptStore.subscribe(check);
  check();
}

async function eventsOnceHostIsBack(client: MawsBridge, appSessionId: AppSessionId, watch: KnownWatch | null): Promise<CommandResult<'session.events'>> {
  const from = engineRevision();
  const first = await eventsOnceKnown(client, appSessionId, watch);
  const away = (result: CommandResult<'session.events'>) => !result.ok && result.error.code === 'host_unavailable';
  if (machineOf(appSessionId) !== client.localMachine || !away(first)) return first;
  const ended = watch?.ended.signal ?? null;
  const ready = await readyAfter(from, HOST_RETURN_WAIT_MS, ended);
  if (ended?.aborted) return first;
  if (ready === null) {
    readAgainAtReady(appSessionId, engineRevision());
    return first;
  }
  const second = await eventsOnceKnown(client, appSessionId, watch);
  if (away(second) && !ended?.aborted) readAgainAtReady(appSessionId, ready);
  return second;
}

// The events main synthesises for a session (`isAppSynthesised`, as C10's `relay:direct_fallback` notice) are emitted
// once as a `session.eventBatch` and journalled nowhere, so no `session.events` snapshot carries them; main's read model
// keeps them (debt wave 5), and a session's snapshot reads them from there (`session.appEvents`, after the journal's, so
// one posted in between is in the held batches or in main's answer, and the store deduplicates by id) and places each
// at its time. So a transcript hydrated again (Retry, a reset, a tab closed and opened, a page reload) shows them.
function withAppEvents(app: SessionEvent[], events: SessionEvent[]): SessionEvent[] {
  const missing = app.filter((event) => !events.some((e) => e.id === event.id));
  if (missing.length === 0) return events;
  const out = [...events];
  for (const event of missing) {
    const at = out.findIndex((e) => Date.parse(e.at) > Date.parse(event.at));
    out.splice(at < 0 ? out.length : at, 0, event);
  }
  return out;
}

// E10: an engine host that dies (a supervisor's kill -9, a utility host's crash) takes its engine processes along and
// sends no `process.exited` for them, and a successor that never ran the session never will, so a turn the live stream
// left running would read Working for good. When the host regains ready after a departure while this subscription's
// stream says the process runs, its table is read: a host that lists the session (a same-pid reconnect, or one that
// exited it and is replaying that) speaks for it through its stream; one that does not has no process for it, and the
// source closes it as the reducer closes any crashed process, with an app-synthesised exit (its id under the app id, so
// the disk-form filter lets it pass; its time the departure's). The exit lives in this transcript's state only: a later
// hydration reads the session from disk through the successor. A read asked before a later departure says nothing; the
// next ready asks again. P5 O6: the host is the session's machine's; another machine's host state crosses its link too,
// and says nothing of this session.
function onHostLoss(client: MawsBridge, appSessionId: AppSessionId, running: () => SessionEvent | null, lost: (exit: SessionEvent) => void): () => void {
  const machine = machineOf(appSessionId);
  let departedAt: string | null = null; // when the host was first heard leaving ready with the process running
  let heard = 0;
  let disposed = false; // P5 O16 M3c fix wave 1: the subscription ended; a pending adoption wait ends with it
  const waits = new Set<() => void>();
  const off = client.on('engine.hostState', ({ state }, from) => {
    if (from.machine !== machine) return;
    const asked = ++heard;
    if (state !== 'ready') {
      if (running() !== null) departedAt ??= new Date().toISOString();
      return;
    }
    const at = departedAt;
    departedAt = null;
    if (at === null || running() === null) return;
    const listed = async (): Promise<boolean | null> => {
      const result = await client.invoke('engine.sessions', undefined, { machine });
      return asked !== heard || !result.ok || running() === null ? null : result.value.some((status) => status.appSessionId === appSessionId);
    };
    void (async () => {
      let found = await listed();
      if (disposed) return; // P5 O16 M3c fix wave 2: the subscription ended during the read: no wait outlives it
      // P5 O16 M3c: a successor that holds session hosts lists a session only once it has adopted it, and its ready
      // comes before its start's adoptions end: this machine's host is asked again once main's status says they ended.
      // O16 panel 1 (sweep#4): another machine's, once its engine host's own status, asked on that machine, says so
      const stale = () => disposed || asked !== heard;
      if (found === false && (await (machine === client.localMachine ? adoptionsEnded(client, stale, waits) : remoteAdoptionsEnded(client, machine, stale, waits)))) found = await listed();
      if (disposed || asked !== heard) return; // a later departure: the next ready asks again
      const last = running();
      if (found !== false || last === null) return;
      lost({
        // P5 O6 M2: under the bare app id, as main's synthesised ids are
        id: `${bareOf(appSessionId)}:host-lost:${at}` as EventId, sessionId: last.sessionId, at, seq: null, agentId: null, parentToolUseId: null,
        kind: 'process.exited', code: null, signal: null, reason: 'crash', lostAttentionCount: 0, budget: null,
      });
    })();
  });
  return () => {
    disposed = true;
    off();
    for (const cancel of [...waits]) cancel();
  };
}

// P5 O16 M3c: settles once main's host status says the local engine host's start-up adoptions are not under way (its
// first status heard, and `holder.adopting` not true) or the host left ready; true when that host holds session hosts,
// so its table may have changed since it was read, false (at once) for one that holds none. `stale`: a later departure
// was heard, and the answer no longer matters. P5 O16 M3c fix wave 1: `waits` holds its cancel while it waits, so the
// subscription's end removes its listener (settled false).
function adoptionsEnded(client: MawsBridge, stale: () => boolean, waits: Set<() => void>): Promise<boolean> {
  type Status = CommandOutput<'host.status'>;
  const read = (status: Status): boolean | null => {
    if (status.state !== 'ready') return true;
    if (status.supervisor === null) return null;
    if (status.supervisor.holder === undefined) return false;
    return status.supervisor.holder.adopting === true ? null : true;
  };
  return new Promise((resolve) => {
    let done = false;
    const settle = (value: boolean) => {
      if (done) return;
      done = true;
      off();
      waits.delete(cancel);
      resolve(value);
    };
    const cancel = () => settle(false);
    waits.add(cancel);
    const hear = (status: Status) => {
      if (stale()) return settle(false);
      const ended = read(status);
      if (ended !== null) settle(ended);
    };
    const off = client.on('host.status', (status, { machine }) => void (machine === client.localMachine && hear(status)));
    void client.invoke('host.status', undefined).then((result) => (result.ok ? hear(result.value) : settle(false)));
  });
}

// O16 panel 1 (sweep#4): `adoptionsEnded` for another machine's engine host, whose status main does not push here
// (`host.status` and `host.supervisorStatus` events are each app's own): that host's `host.supervisorStatus`, asked over
// the machine link every REMOTE_ADOPTIONS_POLL_MS while its holder says it adopts. True once it no longer adopts; false
// at once for a host that holds no session hosts, and for a read that fails (told as before); false when `stale`, or
// cancelled through `waits` at the subscription's end.
export const REMOTE_ADOPTIONS_POLL_MS = 500;
function remoteAdoptionsEnded(client: MawsBridge, machine: MachineRef, stale: () => boolean, waits: Set<() => void>): Promise<boolean> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const settle = (value: boolean) => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimeout(timer);
      waits.delete(cancel);
      resolve(value);
    };
    const cancel = () => settle(false);
    waits.add(cancel);
    const ask = () => {
      timer = null;
      if (stale()) return settle(false);
      void client.invoke('host.supervisorStatus', undefined, { machine }).then((result) => {
        if (done) return;
        if (stale() || !result.ok) return settle(false);
        const holder = result.value.holder;
        if (holder === undefined) return settle(false);
        if (holder.adopting !== true) return settle(true);
        timer = setTimeout(ask, REMOTE_ADOPTIONS_POLL_MS);
      });
    };
    ask();
  });
}

// A session's events can reach `session.eventBatch` in both forms at once: a disk follower started by an earlier read
// (C4's backfill: `seq: null`, ids from the transcript's uuids) keeps delivering what a resumed launch's live journal
// also delivers (its row's `seq`, ids under the app session id), under different ids, so id deduplication cannot merge
// them. Live wins: once the attachment has seen a live-form event (the snapshot's or a batch's), disk-form events are
// dropped; the disk history before the launch has already arrived by then. Batches that arrive before the snapshot
// answers are held and passed through that filter once it has, so a follower's copy delivered during the round trip
// drops too. An event the app synthesises (`seq: null`, its id also under the app session id, as C10's route notice)
// is neither form's copy of the other and always passes.
// W7 (charter §4.3 as amended 2026-10-01): once MAWS's process has exited, a foreign process that holds the session
// writes it; the live stream is not its history any more. When the record turns foreign-live (a terminal or job holds
// it) after this attachment saw the live form, the source resets, and the hydration reads the transcript from disk,
// which C3 then answers (src/engine-host/ipc.ts), followed read-only from there.
const isTurnEvent = (event: SessionEvent) => event.kind === 'turn.started' || event.kind === 'turn.ended'; // P5 O7 M8

function sessionSource(client: MawsBridge, appSessionId: AppSessionId): TranscriptSource {
  const liveForm = (event: SessionEvent) => event.seq !== null;
  // P5 O6 M2: an event id is its machine's, under the bare app id (main's synthesised ones and C3's live ones alike)
  const diskForm = (event: SessionEvent) => event.seq === null && !isAppSynthesised(bareOf(appSessionId), event);
  // Per subscription (the store subscribes once per attachment, then snapshots): whether it has seen the live form, the
  // batches that arrived before its snapshot answered, and its filter. A snapshot serves the subscription made just
  // before it, so a second subscription or a stale snapshot never delivers into another's listener.
  interface Subscription extends KnownWatch {
    live: boolean;
    held: SessionEvent[][] | null;
    pass(batch: SessionEvent[]): void;
    foreign: boolean; // W7: the record's latest custody seen, a foreign holder's (remembered while the snapshot is pending)
    running: SessionEvent | null; // E10: the latest live-form event since the last exit the subscription delivered
    gapped: boolean; // P5 O7 M8: a gap was told and no live turn event arrived since (`remote.gap`'s healing, below)
  }
  let latest: Subscription | null = null;
  const track = (subscription: Subscription, events: SessionEvent[]) => {
    for (const event of events) {
      if (event.kind === 'process.exited') subscription.running = null;
      else if (liveForm(event)) subscription.running = event;
    }
  };
  const resets = new Set<() => void>();
  // The long-transcript window: the history's older pages (older.ts). Main's app events older than the newest window
  // wait aside for the page that holds their time.
  let appAside: SessionEvent[] = [];
  // The long-transcript window: the engine host released the disk follow this source reads (the session left every
  // client's interest while the source stayed mounted, as a side thread off screen), so the transcript's later writes
  // no longer reach it. At the next sign of new history, the record's change, the source reads the host again.
  let stale = false;
  let gaps = 0; // P5 O7 M2: the gap bars `remote.gap` put in, each an id of its own
  // P5 O7 M2 (the milestone review): the windows main last said were too large for the channel (`remote.historyTooLarge`),
  // each said just before the read it answers `historyUnavailable`; that read's bar takes their words, once
  // (heard while subscribed: the source's reads, its snapshot's and its older pages', run while it is)
  const tooLarge = new Set<'newest' | 'older'>();
  const tooLargeWords = (window: 'newest' | 'older'): string | undefined => {
    if (!tooLarge.delete(window)) return undefined;
    return HISTORY_TOO_LARGE[window](remoteMachineName(appSessionId));
  };
  // P5 O7 M4 (acceptance 12): a page a budgeted read answered with items left out marks where they were
  const omittedWords = (omitted: { events: number; bytes: number }) => HISTORY_OMITTED(omitted.events, omitted.bytes, remoteMachineName(appSessionId));
  const gapPlaces = new WeakMap<SessionEvent, GapPlace>(); // P5 O7 M2: a gap told during a read, by where it goes
  // P5 O15 M2b: the gaps an armed subscription heard, carried into the subscription its re-read makes (below)
  let carried: { gap: SessionEvent; place: GapPlace }[] = [];
  // P5 O7 M2 (M2's reviews): a gap told while the history was being read is held behind it, and so would land after the
  // events the read already holds of the launch it names. It goes before the first of them at or after its `at` instead
  // (a lost range's end), or before the launch's first event without one (a relaunch's `snapshot`), by the live journal's
  // ids, `<app>:<launchId>:<seq>:<i>`; one the read holds no such event for stays held, after the history and before what
  // came after it. The pager is started from what this answers, so an older page's rebuild keeps it.
  const placeHeldGaps = (events: SessionEvent[], subscription: { held: SessionEvent[][] | null }, bareApp: string): SessionEvent[] => {
    if (subscription.held === null) return events;
    let placed = events;
    subscription.held = subscription.held.filter((batch) => {
      const where = batch.length === 1 ? gapPlaces.get(batch[0]) : undefined;
      if (where === undefined) return true;
      const index = placed.findIndex((event) => atOrAfter(event, bareApp, where));
      if (index < 0) return true;
      placed = [...placed.slice(0, index), batch[0], ...placed.slice(index)];
      return false;
    });
    return placed;
  };
  const atOf = (event: SessionEvent) => Date.parse(event.at);
  const pager = new HistoryPager(
    async (before, seek) => {
      tooLarge.delete('older');
      const page = valueOf(await client.invoke('session.events', { appSessionId, afterSeq: null, limit: null, before, ...(seek && { seek }) }));
      return withOmittedBar(withHistoryGap(page, bareOf(appSessionId), tooLargeWords('older')), bareOf(appSessionId), omittedWords); // P5 O7 M2; M4: the omitted bar
    },
    (page, last) => {
      const from = page[0] === undefined ? Infinity : atOf(page[0]);
      const placed = last ? appAside : appAside.filter((event) => atOf(event) >= from);
      appAside = appAside.filter((event) => !placed.includes(event));
      return withAppEvents(placed, page);
    },
    () => queueMicrotask(() => {
      for (const listener of [...resets]) listener();
    }),
  );
  // W7: a subscription that has the live form while its record is foreign-live starts over from disk, once.
  const resetIfOverturned = (subscription: Subscription) => {
    if (!subscription.live || !subscription.foreign) return;
    subscription.live = false;
    queueMicrotask(() => {
      for (const listener of [...resets]) listener();
    });
  };
  return {
    key: appSessionId,
    subscribe(listener) {
      const subscription: Subscription = {
        live: false,
        foreign: false, // W7
        running: null, // E10
        gapped: false, // P5 O7 M8
        held: [],
        batch: null,
        ended: new AbortController(),
        pass(batch) {
          const events = batch.filter((event) => {
            if (liveForm(event)) subscription.live = true;
            return shown(event);
          });
          track(subscription, events);
          if (events.length === 0) return;
          pager.delivered(events);
          listener(events);
        },
      };
      // what the key shows: the parent's own events and the child traffic under its tool uses, the live form once seen
      const shown = (event: SessionEvent) => ofParent(event) && !(subscription.live && diskForm(event));
      latest = subscription;
      // P5 O15 M2b (Decision Log 39): another machine's session whose subscription lives through its link's loss (its
      // tab holds the key while the machine is offline, lane-b/transcript-hold.ts). Armed at main's own word of the loss
      // (a `remote.session` whose link is `down`, after one that said it `up`: a source that attached during the loss has
      // nothing armed), with the stream's answer that word carries (`answer.n`), until main says a later one: that answer
      // decides. Main counts an answer only from the machine (a `subbed`, or an end the machine sends while the link is
      // up), so nothing it does while the link is down passes for the return's. `replay` (the paused subscription resumed
      // from its cursor) delivers what the loss held back, and nothing is read again; any other (`missing`, `snapshot`: a
      // relaunch or a lost range; `unavailable`, `ended`: B lost or ended the launch meanwhile) starts the key over staged
      // from the whole history, at that answer, so never before the stream's `subbed`. A `remote.gap` heard while armed
      // (the stream's own, told in its `subbed` just before the answer, or a history read's, whenever it answers) waits
      // for the answer: it joins the re-read, its bar carried into it, or after a `replay` draws its bar as before.
      let armedAt: number | null = null; // the answer main's word of the loss carried, while the return's is to come
      const waiting: { gap: SessionEvent; place: GapPlace }[] = []; // gaps heard while armed
      let linkWas = remoteLaneBStateOf(appSessionId)?.link.state ?? null; // the link as main last said it
      const remote = machineOf(appSessionId) !== client.localMachine;
      const offStream = !remote ? () => {} : client.on('remote.session', ({ address, link, answer }) => {
        if (address !== appSessionId) return;
        const was = linkWas;
        linkWas = link.state;
        const n = answer?.n ?? 0;
        if (armedAt === null) {
          if (link.state === 'down' && was === 'up') armedAt = n;
          return;
        }
        if (n <= armedAt) return;
        armedAt = null;
        const gaps = waiting.splice(0);
        if (answer!.mode !== 'replay') reread(gaps);
        else for (const held of gaps) tellGap(held.gap, held.place);
      });
      let rereading: { gap: SessionEvent; place: GapPlace }[] | null = null; // the gaps the re-read carries, once queued
      // one re-read, carrying the gaps heard while armed
      const reread = (held: { gap: SessionEvent; place: GapPlace }[]) => {
        if (rereading !== null) return void rereading.push(...held);
        rereading = held;
        // after this event's dispatch: a subscription the re-read makes must not hear the gap that started it
        queueMicrotask(() => {
          const gaps = rereading!;
          rereading = null;
          if (latest !== subscription) return; // ended meanwhile: a hydration after it reads the history anyway
          carried = gaps;
          pager.refresh(); // the store rebuilds the key, staged; its snapshot, with no history prepared, asks the host
          carried = [];
          // no store hears the rebuild (a bare subscriber): the gaps are told here, as an unarmed one's are
          if (latest === subscription) for (const held of gaps) tellGap(held.gap, held.place);
        });
      };
      const off = client.on('session.eventBatch', (batch) => {
        if (batch.appSessionId !== appSessionId) return;
        // P5 O7 M8, by arrival: only a turn of the parent's own, as the key shows it (a child's slice is not)
        if ((subscription.gapped || heldHeal !== null) && batch.events.some((event) => isTurnEvent(event) && shown(event))) liveTurnArrived();
        subscription.batch?.();
        if (subscription.held) subscription.held.push(batch.events);
        else subscription.pass(batch.events);
      });
      // W7: the record's custody, kept even while the snapshot is pending; foreign-live with the live form seen (now, or
      // once the snapshot establishes it) starts the key over from disk
      const offChanged = client.on('session.changed', ({ record }) => {
        if (record.appId !== appSessionId) return;
        subscription.foreign = record.holder.kind === 'terminal' || record.holder.kind === 'background_job';
        resetIfOverturned(subscription);
        // stale: a staged rebuild whose snapshot asks the host, once this subscription's own snapshot is in
        if (stale && latest === subscription && subscription.held === null) {
          stale = false;
          pager.refresh();
        }
      });
      // A release, not any stop: a resume's handoff to the live stream stops the follow with no message.
      const offReleased = client.on('fs.followState', (state) => {
        if (state.appSessionId === appSessionId && state.agentId === null && state.state === 'stopped' && state.message === FOLLOW_RELEASED && !subscription.live) stale = true;
      });
      const offLoss = onHostLoss(client, appSessionId, () => subscription.running, (exit) => { // E10
        if (subscription.held) subscription.held.push([exit]);
        else subscription.pass([exit]);
      });
      // P5 O7 M8 (M8, "What draws Working…"; m8-4a's task review): what a gap lost may be a turn's end, which would leave
      // the turn open, drawn Working…, for good. Main re-reads the session after a gap and flushes the batches it holds
      // before it says the re-read status, so arrival order is the machine's: the first status since the gap that says
      // no turn runs, with no live turn event arrived in between, closes the turns left open (an unseen turn end,
      // model/gap.ts: the turns alone, never the process). A turn event arriving after the gap means the stream speaks
      // for its turns again: the healing stands down, and a heal still held behind a hydration is withdrawn (a new turn's
      // start closes the one before it by its own rule). History a snapshot replays is not an arrival. The status is
      // listened to only while a gap waits to heal.
      let offHeal: (() => void) | null = null;
      let heldHeal: SessionEvent[] | null = null; // the heal's batch while it waits in `held`
      const stopHealing = () => {
        subscription.gapped = false;
        offHeal?.();
        offHeal = null;
      };
      const liveTurnArrived = () => {
        if (heldHeal !== null && subscription.held) subscription.held = subscription.held.filter((batch) => batch !== heldHeal);
        heldHeal = null;
        stopHealing();
      };
      const closeUnseen = () => {
        const sessionId = subscription.running?.sessionId ?? (bareOf(appSessionId) as string as SessionId);
        const unseen = [unseenTurnEndEvent(bareOf(appSessionId), `${Date.now()}:${++gaps}`, new Date().toISOString(), sessionId)];
        if (subscription.held) {
          heldHeal = unseen;
          subscription.held.push(unseen);
        } else subscription.pass(unseen);
      };
      const awaitHealing = () => {
        subscription.gapped = true;
        offHeal ??= client.on('session.status', ({ appSessionId: said, status }) => {
          if (said !== appSessionId || status.turn !== null) return; // still running, as the machine says
          closeUnseen();
          stopHealing();
        });
      };
      // P5 O7 M2: a remote lane B stream that went on past events it could not deliver says so in order with its batches;
      // the gap bar goes in here, where they would have been (model/gap.ts)
      const tellGap = (gap: SessionEvent, place: GapPlace) => {
        if (subscription.held) {
          gapPlaces.set(gap, place); // placed by the snapshot when the history it reads holds its place
          subscription.held.push([gap]);
        } else subscription.pass([gap]);
        awaitHealing(); // P5 O7 M8
      };
      const offGap = client.on('remote.gap', ({ appSessionId: gapped, launchId, at }) => {
        if (gapped !== appSessionId) return;
        const sessionId = subscription.running?.sessionId ?? (bareOf(appSessionId) as string as SessionId);
        const gap = historyGapEvent(bareOf(appSessionId), `${launchId}:${Date.now()}:${++gaps}`, new Date().toISOString(), sessionId);
        const place = { launchId, at: at ?? null };
        if (armedAt === null) tellGap(gap, place);
        else waiting.push({ gap, place }); // P5 O15 M2b: the stream's answer decides
      });
      // P5 O15 M2b: the gaps the re-read that made this subscription carries, held behind its snapshot as any gap is
      for (const held of carried.splice(0)) tellGap(held.gap, held.place);
      const offTooLarge = client.on('remote.historyTooLarge', ({ appSessionId: said, window }) => {
        if (said === appSessionId) tooLarge.add(window);
      });
      return () => {
        off();
        offChanged();
        offReleased();
        offLoss();
        offGap();
        offStream();
        stopHealing();
        offTooLarge();
        subscription.held = null;
        subscription.pass = () => {};
        subscription.ended.abort();
        if (latest === subscription) latest = null;
      };
    },
    // The store orders and deduplicates by event id (ruling 5 of the wave-2 ledger); `lastSeq` is C3's own cursor. The
    // held batches are passed before the snapshot returns, while the store still buffers.
    async snapshot() {
      const subscription = latest;
      // A rebuild (an older page joined the history) answers the pager's history; any other snapshot asks the host.
      let events = pager.takeRebuilt();
      if (events === null) {
        stale = false; // this read follows the transcript again
        tooLarge.delete('newest');
        // the UX wave, U9 (M5, the ticket on history read after a link's return): another machine's history is read once main settled that machine's generation, or
        // at the backstop, never beside its live sessions' resumes; at once when either has passed or it is not up
        const machine = machineOf(appSessionId);
        if (machine !== client.localMachine && isRemoteLaneB(appSessionId) && !historyReadsNow(machine)) await whenHistoryReads(machine);
        const read = valueOf(await eventsOnceHostIsBack(client, appSessionId, subscription));
        const answer = withOmittedBar(withHistoryGap(read, bareOf(appSessionId), tooLargeWords('newest')), bareOf(appSessionId), omittedWords); // P5 O7 M2: the gap bar at a page partly gone; M4: and the omitted bar after its rows
        const app = valueOf(await client.invoke('session.appEvents', { appSessionId })).events;
        const earlier = answer.earlier ?? null;
        const first = answer.events[0];
        const placed = earlier === null || first === undefined ? app : app.filter((event) => atOf(event) >= atOf(first));
        events = withAppEvents(placed, answer.events);
        // P5 O7 M2: a gap told while this was read takes its place in it before the pager keeps it as the history its
        // older pages rebuild from
        if (subscription) events = placeHeldGaps(events, subscription, bareOf(appSessionId));
        // The pager and the app events set aside are the source's, not the subscription's: a snapshot whose
        // subscription has ended or been superseded (a close and reopen with two reads in flight) answers only its own
        // hydration, which discards it. Were it to finish last and start the pager over, the pager's log and cursor
        // would be its older window, and the next older page's rebuild would drop what the current one has shown.
        if (latest === subscription && !subscription?.ended.signal.aborted) {
          appAside = app.filter((event) => !placed.includes(event));
          pager.started(events, earlier, answer.cronHistory);
        }
      }
      if (subscription) {
        if (events.some(liveForm)) subscription.live = true;
        track(subscription, events); // E10
        const waiting = withoutOlderThanWindow(subscription.held ?? [], events, diskForm); // the long-transcript window
        subscription.held = null;
        for (const batch of waiting) subscription.pass(batch);
        resetIfOverturned(subscription); // W7: a turn to foreign-live heard while this snapshot was on its way
      }
      return events;
    },
    onReset(listener) {
      resets.add(listener);
      return () => resets.delete(listener);
    },
    onRebuild: (listener) => pager.onRebuild(listener),
    older: pager,
  };
}

// A child agent's source owns its provenance (Child source provenance): live while the child runs in the parent's
// process (the parent's stream and snapshot, filtered by agent; no disk follower), disk otherwise (fs.agentEvents,
// which starts following). The snapshot decides from the parent's lifecycle events for the child: live when the
// parent's live journal started it (`subagent.started` or `task.started`) and nothing ended it since (its finish, or
// the parent's `process.exited`), so a drill-in opened before the child's first event still follows the live stream;
// disk otherwise (it ended, or the parent is disk-backed). The parent's report that the child ended joins the child's
// slice, where it closes the child's open turn (reduce.ts). A live child that ends switches to disk and signals a
// reset, so the store rebuilds the key from the disk transcript. Disk provenance is final, but lifecycle is not:
// the same agent id can resume, and a parent relaunch can stop its disk follower.
//
// The remote drill-in (2026-11-06): a child of another machine's session is live whenever the launch's slice holds its
// start, its end included, and its end switches nothing: main reads that slice in pages the channel carries
// (remote-history.ts), while a disk window crosses as one answer, and that machine's disk follow sends nothing here.
// So it is disk-backed only when the launch never started it (an earlier launch's child, a session not live there),
// and a start it hears then (a resume), or while its slice is read, takes it back to the stream; a gap in the
// session's stream (`remote.gap`) reads a live one again, since the gap may have taken its rows or its end.
//
// The same events reach `session.eventBatch` in two forms, the live journal's (with their row's `seq`) and the disk
// transcript's (`seq: null`, ruling 5 of the wave-2 ledger), under different ids, so id deduplication cannot merge
// them: the source passes only the form of its provenance. Batches that arrive before the provenance is known are held
// and passed through that filter once it is.
interface Subscriber {
  listener: (events: SessionEvent[]) => void;
  held: SessionEvent[][]; // batches that arrived before the provenance was decided, then the events a disk read holds back
  ended: AbortController;
}

// The remote drill-in (2026-11-06): no follow state of another machine's reaches this page (its session's stream carries
// the journal's events and the panels' notices, never `fs.followState`), so a read of a child there that waits on one is
// asked again this often instead, within the same bound.
export const REMOTE_FOLLOW_POLL_MS = 1_000;

function childSource(client: MawsBridge, appSessionId: AppSessionId, agentId: AgentId): TranscriptSource {
  const remote = machineOf(appSessionId) !== client.localMachine;
  const followPollMs = remote ? REMOTE_FOLLOW_POLL_MS : null;
  let provenance: 'undecided' | 'live' | 'disk' = 'undecided';
  // The long-transcript window: the disk snapshot whose `fs.agentEvents` answer is on its way. The child's events that
  // batches carry meanwhile are held until it completes, then those older than the window it answered are dropped
  // before they are passed on. What the batches say of the child's lifecycle is taken at once, as at any other time:
  // a start heard meanwhile decides whether the answer is joined with an end.
  let reading: object | null = null;
  let ended: SessionEvent | null = null; // the parent's report that the child ended, for the disk slice
  const resets = new Set<() => void>();
  const subscribers = new Set<Subscriber>();
  const lifecycleSeen = new Set<EventId>();
  let lifecycleRevision = 0;
  let resetPending = false;
  // The long-transcript window: the engine host released this child's disk follow (as the session source's `stale`);
  // the next record change of its session reads the child again.
  let stale = false;
  // For local agents the engine's task id and the sidecar's agent id carry the same string (C1 Interfaces, observed in
  // the fixtures); X1 keeps them as two types, so the comparison is on the strings.
  const names = (taskId: string) => taskId === (agentId as string);
  const own = ownOf(agentId);
  const starts = (event: SessionEvent) => (event.kind === 'subagent.started' || event.kind === 'task.started') && names(event.taskId);
  const finishes = (event: SessionEvent) => (event.kind === 'subagent.finished' || event.kind === 'task.notification') && names(event.taskId);
  const exits = (event: SessionEvent) => event.kind === 'process.exited' && event.agentId === null;
  const liveForm = (event: SessionEvent) => event.seq !== null;
  const ownOnDisk = (event: SessionEvent) => own(event) && !liveForm(event); // never the parent's reports, whatever their form
  // An exit ends the child only if it follows the child's start in the stream that carried it: an exit the parent's
  // snapshot holds, by its position there; any other exit, once a start has been seen (the snapshot's or a batch's).
  // An explicit child finish survives parent exits until another child start clears it. A replay or backfill batch
  // can carry an exit of an earlier run, which says nothing about a child started since.
  let startAt = -1; // the child's start in the parent's snapshot
  let startedInStream = false;
  let startsHeard = 0; // the remote drill-in: starts a batch carried, so a snapshot knows one came while its slice was read
  // E11 (W-C; E10's host loss): the parent's latest live-form event while the child is live, for the loss's exit, and
  // the exit the source synthesised when the host died with the child running: no journal holds it, so the disk re-read
  // after the switch keeps it as the child's end unless the parent started the child again after it.
  let lastLive: SessionEvent | null = null;
  let hostLost: SessionEvent | null = null;
  const exitsAt = new Map<EventId, number>(); // the parent's snapshot's exits, by position
  const endsChild = (event: SessionEvent) => {
    if (finishes(event)) return true;
    if (!exits(event) || (ended !== null && finishes(ended))) return false;
    const at = exitsAt.get(event.id);
    return at === undefined ? startAt >= 0 || startedInStream : startAt >= 0 && at > startAt;
  };
  // One batch under the current provenance: its own events in that form, the parent's finish for the child, and while
  // live an exit that ends it, pass into the child's state; an end seen while live switches this machine's child to disk.
  const receive = (subscriber: Subscriber, events: SessionEvent[]) => {
    if (provenance === 'undecided') {
      subscriber.held.push(events);
      return;
    }
    const passed: SessionEvent[] = [];
    let changedEnd = false;
    for (const event of events) {
      const ends = endsChild(event);
      if ((starts(event) || ends) && !lifecycleSeen.has(event.id)) {
        lifecycleSeen.add(event.id);
        lifecycleRevision++;
        if (starts(event)) {
          startedInStream = true;
          startsHeard++;
          ended = null;
          hostLost = null;
          if (remote && provenance === 'disk' && liveForm(event)) provenance = 'live'; // a resume, which the stream carries
        } else {
          ended = event;
          changedEnd = true;
        }
      }
      if ((own(event) && liveForm(event) === (provenance === 'live')) || (provenance === 'live' && ends)) passed.push(event);
      if (provenance === 'live' && liveForm(event)) lastLive = event;
    }
    if (passed.length > 0 && reading !== null) subscriber.held.push(passed); // the long-transcript window
    else if (passed.length > 0) {
      pager.delivered(passed);
      subscriber.listener(passed);
    }
    // On disk too, a newly observed finish must follow the complete backfill, not overtake it in a batch. Another
    // machine's child the stream carries stays on it, closed by its end there.
    if (changedEnd && ended !== null && !(remote && provenance === 'live')) toDisk();
  };
  const flush = () => {
    for (const subscriber of subscribers) for (const events of subscriber.held.splice(0)) receive(subscriber, events);
  };
  const decide = (chosen: 'live' | 'disk') => {
    provenance = chosen;
    flush();
  };
  // The reset is signalled once the batch that carried the end has been delivered, so the store's new subscription can
  // never receive that batch a second time.
  // The long-transcript window: a disk-backed child's older pages (older.ts).
  const pager = new HistoryPager(
    async (before, seek) => valueOf(await client.invoke('fs.agentEvents', { appSessionId, agentId, before, ...(seek && { seek }) })),
    (page) => page,
    () => queueMicrotask(() => {
      for (const listener of [...resets]) listener();
    }),
  );
  // The parent's events for this child. A disk-backed parent whose follow is still reading its transcript through
  // answers an empty, incomplete page, which says nothing of the child's lifecycle, and since the parent then
  // broadcasts only its newest window, an old finish would never arrive later: a completed child would read working.
  // Such a page is asked again once the parent's follow reports its next state (another machine's: at each
  // REMOTE_FOLLOW_POLL_MS), or once BACKFILL_WAIT_MS pass, unless the child's subscribers all detach.
  const parentEvents = async (attached: Subscriber[], detached: () => boolean): Promise<SessionEvent[]> => {
    let signalled: boolean; // a state heard since the latest read was asked
    let wake: (() => void) | null = null;
    const signal = () => {
      signalled = true;
      wake?.();
    };
    const off = client.on('fs.followState', (state) => state.appSessionId === appSessionId && state.agentId === null && state.state !== 'backfilling' && signal());
    for (const subscriber of attached) subscriber.ended.signal.addEventListener('abort', signal);
    const deadline = Date.now() + BACKFILL_WAIT_MS;
    try {
      for (;;) {
        signalled = false;
        const page = valueOf(await client.invoke('session.events', { appSessionId, afterSeq: null, limit: null, agentId }));
        if (!backfilling(page) || detached() || Date.now() >= deadline) return page.events;
        if (!signalled) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          await new Promise<void>((resolve) => {
            wake = resolve;
            timer = setTimeout(resolve, Math.min(deadline - Date.now(), followPollMs ?? Infinity));
          });
          clearTimeout(timer);
          wake = null;
        }
        if (detached()) return [];
      }
    } finally {
      off();
      for (const subscriber of attached) subscriber.ended.signal.removeEventListener('abort', signal);
    }
  };
  const signalReset = () => {
    if (resetPending) return;
    resetPending = true;
    queueMicrotask(() => {
      resetPending = false;
      for (const listener of [...resets]) listener();
    });
  };
  const toDisk = () => {
    decide('disk');
    signalReset();
  };
  return {
    key: `${appSessionId}:${agentId}`,
    agentId,
    subscribe(listener) {
      const subscriber: Subscriber = { listener, held: [], ended: new AbortController() };
      subscribers.add(subscriber);
      const off = client.on('session.eventBatch', (batch) => {
        if (batch.appSessionId === appSessionId) receive(subscriber, batch.events);
      });
      const offFollow = client.on('fs.followState', (state) => {
        // Both resume and the index's live-status handling stop all session followers. The child's stopped event
        // comes after its entry was removed, unlike parent status (which can precede the index's queued unfollow).
        if (state.appSessionId !== appSessionId || state.agentId !== agentId || state.state !== 'stopped' || provenance !== 'disk') return;
        // A release is no reason to follow again at once, which would only be released again two minutes later.
        if (state.message === FOLLOW_RELEASED) stale = true;
        else toDisk();
      });
      const offChanged = client.on('session.changed', ({ record }) => {
        if (record.appId !== appSessionId || !stale) return;
        stale = false;
        pager.refresh();
      });
      // E11 (W-C): the session source's host-loss rule, for the parent's process as the live child sees it; the exit
      // ends the child as any parent exit does (closed as stopped, then the switch to disk)
      const offLoss = onHostLoss(client, appSessionId, () => (provenance === 'live' && ended === null ? lastLive : null), (exit) => {
        hostLost = exit;
        receive(subscriber, [exit]);
      });
      // The remote drill-in: a gap in the session's stream (a range its journal could not give back, an event too large
      // to carry) may have taken the child's rows or its end, so a child the stream carries is read again from the slice.
      const offGap = remote ? client.on('remote.gap', ({ appSessionId: gapped }) => void (gapped === appSessionId && provenance === 'live' && signalReset())) : () => {};
      return () => {
        subscribers.delete(subscriber);
        subscriber.ended.abort();
        off();
        offFollow();
        offChanged();
        offLoss();
        offGap();
      };
    },
    async snapshot() {
      // A rebuild (an older page joined the disk history) answers the pager's history.
      const rebuilt = pager.takeRebuilt();
      if (rebuilt !== null) return rebuilt;
      const attached = [...subscribers];
      const detached = () => attached.length > 0 && attached.every((subscriber) => !subscribers.has(subscriber));
      const revision = lifecycleRevision;
      const heardBefore = startsHeard;
      const lostBefore = hostLost;
      const onDisk = () => provenance === 'disk'; // read after the await: the child may have ended meanwhile
      // Even disk provenance must refresh lifecycle: a closed/reopened child may have resumed unobserved. The parent's
      // events for this child alone (`agentId`: its own and the parent's reports on it, with the parent's exits, in
      // order), however long the parent's history: a disk-backed parent answers one window, which may not hold them.
      const parent = await parentEvents(attached, detached);
      if (detached()) return [];
      const started = parent.findLastIndex(starts);
      startAt = started;
      exitsAt.clear();
      parent.forEach((event, i) => {
        if (exits(event)) exitsAt.set(event.id, i);
        if (starts(event) || finishes(event) || exits(event)) lifecycleSeen.add(event.id);
      });
      const finished = parent.findLastIndex(finishes);
      // Once this run has its own outcome, a later parent exit cannot replace it with stopped.
      const end = finished > started ? finished : parent.findLastIndex((event, i) => started >= 0 && i > started && exits(event));
      // A batch heard during the read is newer than the snapshot; never restore its superseded completion. A host loss
      // the parent's read cannot show stays the end of the run it ended (E11).
      const lost = hostLost !== null && (started < 0 || Date.parse(parent[started].at) <= Date.parse(hostLost.at)) ? hostLost : null;
      if (revision === lifecycleRevision) ended = end > started || (started < 0 && end >= 0) ? parent[end] : lost;
      // Another machine's child is the stream's whenever the launch started it, or a start came while the slice was read
      // (heard, or held for the provenance), the slice's own end joining it; an end only a batch carried stays behind that
      // batch's rows, and a host loss told before this read stands as the end of the run it ended (E11).
      const liveStart = started >= 0 && liveForm(parent[started]);
      const heardStart = remote && (startsHeard !== heardBefore || [...subscribers].some((subscriber) => subscriber.held.some((batch) => batch.some((event) => starts(event) && liveForm(event) && !lifecycleSeen.has(event.id)))));
      if (remote ? liveStart || heardStart : liveStart && end < started && !onDisk()) {
        const sliceEnd = !remote ? null : end > started ? parent[end] : started >= 0 && lostBefore !== null && Date.parse(parent[started].at) <= Date.parse(lostBefore.at) ? lostBefore : null;
        const sliceLast = parent.findLast(liveForm) ?? null;
        // another machine's: the slice's latest first, so what the batches held or already heard (newer) stands over it
        if (remote && provenance !== 'live') lastLive = sliceLast;
        decide('live');
        if (!remote) lastLive = sliceLast;
        const live = parent.filter((event) => own(event) && liveForm(event));
        const history = sliceEnd === null ? live : [...live, sliceEnd];
        pager.started(history, null);
        return history;
      }
      // The child's events are held, not passed, until the disk answer is in (the long-transcript window: `reading`).
      const token = {};
      reading = token;
      if (!onDisk()) decide('disk');
      // An incomplete snapshot is not terminal history. Listen before reading so a completed backfill during the
      // round trip is not missed; re-read on its following state (another machine's: at each REMOTE_FOLLOW_POLL_MS),
      // never spin on a reloading/error follower.
      let changed: boolean;
      let failure: string | null = null;
      let wake: (() => void) | null = null;
      const signal = () => { changed = true; wake?.(); };
      const offFollow = client.on('fs.followState', (state) => {
        if (state.appSessionId !== appSessionId || state.agentId !== agentId) return;
        if (state.state === 'error') failure = state.message ?? 'Child transcript backfill failed';
        if (state.state === 'following' || state.state === 'error' || state.state === 'stopped') signal();
      });
      for (const subscriber of attached) subscriber.ended.signal.addEventListener('abort', signal);
      // Reusing an already-errored follower may emit no state at all. Bound this hydration, not each wake,
      // without claiming to know the follower's unexposed phase or failure.
      const timer = setTimeout(() => {
        failure = 'Timed out waiting for child transcript backfill';
        signal();
      }, CHILD_BACKFILL_WAIT_MS);
      try {
        for (;;) {
          changed = false;
          stale = false; // this read follows the child's transcript again
          const disk = valueOf(await client.invoke('fs.agentEvents', { appSessionId, agentId }));
          if (detached()) return [];
          if (disk.complete) {
            const history = ended === null ? disk.events : [...disk.events, ended];
            pager.started(history, disk.earlier ?? null);
            for (const subscriber of subscribers) subscriber.held = withoutOlderThanWindow(subscriber.held, history, ownOnDisk);
            return history; // the held batches pass on as this returns (finally), so the hydration drains them after it
          }
          if (failure !== null) throw new Error(failure);
          let poll: ReturnType<typeof setTimeout> | undefined;
          if (!changed) await new Promise<void>((resolve) => {
            wake = resolve;
            if (followPollMs !== null) poll = setTimeout(resolve, followPollMs);
          });
          clearTimeout(poll);
          wake = null;
          if (detached()) return [];
          if (failure !== null) throw new Error(failure);
        }
      } finally {
        clearTimeout(timer);
        offFollow();
        for (const subscriber of attached) subscriber.ended.signal.removeEventListener('abort', signal);
        if (reading === token) {
          reading = null;
          flush();
        }
      }
    },
    onReset(listener) {
      resets.add(listener);
      return () => resets.delete(listener);
    },
    onRebuild: (listener) => pager.onRebuild(listener),
    older: pager,
  };
}

// One source per key and client: C5's agent tab and C8's drill-in mount the same source, hence one attachment and one
// state in the store.
const sources = new WeakMap<MawsBridge, Map<string, TranscriptSource>>();

// P5 O7 M2: where a held gap goes, and whether an event of the history is at or after it: an event of the gap's launch
// (by its live journal id, `<app>:<launchId>:<seq>:<i>`) at or after `at`, or any of the launch's without one.
interface GapPlace {
  launchId: string;
  at: { seq: number; idx?: number } | null;
}
function atOrAfter(event: SessionEvent, bareApp: string, { launchId, at }: GapPlace): boolean {
  const prefix = `${bareApp}:${launchId}:`;
  if (!event.id.startsWith(prefix)) return false;
  if (at === null) return true;
  const [seq, idx] = event.id.slice(prefix.length).split(':').map(Number);
  return seq > at.seq || (seq === at.seq && idx >= (at.idx ?? 0));
}

export function ipcSourceOver(client: MawsBridge, appSessionId: AppSessionId, agentId?: AgentId): TranscriptSource {
  const key = agentId === undefined ? appSessionId : `${appSessionId}:${agentId}`;
  let known = sources.get(client);
  if (!known) sources.set(client, (known = new Map()));
  let source = known.get(key);
  if (!source) known.set(key, (source = agentId === undefined ? sessionSource(client, appSessionId) : childSource(client, appSessionId, agentId)));
  return source;
}

export const ipcSource = (appSessionId: AppSessionId, agentId?: AgentId): TranscriptSource => ipcSourceOver(ipc, appSessionId, agentId);

// Spills whose last read came back truncated (`fs.readSpill`'s flag). `loadSpill` answers only the content (its
// callback shape is frozen), so the loader asks here whether what it got was the whole result.
const truncatedSpills = new Set<string>();
export const spillWasTruncated = (path: string) => truncatedSpills.has(path);

export const ipcLoadSpillOver = (client: MawsBridge) => async (spill: Spill, appSessionId: AppSessionId | null = null): Promise<string> => {
  const machine = appSessionId === null ? client.localMachine : machineOf(appSessionId); // P5 O6 M4: the row's session's machine holds the file
  const read = valueOf(await client.invoke('fs.readSpill', { path: spill.path, length: SPILL_READ_BYTES }, { machine }));
  if (read.truncated) truncatedSpills.add(spill.path);
  else truncatedSpills.delete(spill.path);
  return read.content;
};

export const ipcLoadSpill = ipcLoadSpillOver(ipc);

// P5 O7 M3: a link out of another machine's session goes to main told that machine, which refuses a loopback link of it
// there (it would open this Mac's localhost) and opens any other as before; a forward never reaches here (App.tsx's E4d).
export const ipcOpenExternalOver = (client: MawsBridge) => (url: string, appSessionId: AppSessionId | null = null) => {
  const machine = appSessionId !== null && isAddress(appSessionId) ? machineOf(appSessionId) : client.localMachine;
  const opened = machine === client.localMachine ? client.invoke('layout.openExternal', { url }) : client.invoke('layout.openExternal', { url }, { machine });
  void opened.then((result) => {
    if (!result.ok) console.warn(`[transcript] could not open ${url}: ${result.error.message}`);
  });
};

export const ipcOpenExternal = ipcOpenExternalOver(ipc);

// The prompt a turn's files rewind to: the user message that opened it (a turn is keyed `turn:<its uuid>`). An
// engine-initiated turn has none.
function promptOf(state: TranscriptState | undefined, turnId: TurnId): MessageUuid | null {
  for (const event of state?.turns.get(turnId)?.events ?? []) {
    if (event.kind === 'user.message' && event.messageUuid !== null && turnIdOf.ofMessage(event.messageUuid) === turnId) return event.messageUuid;
  }
  return null;
}

export const REWIND_REFUSAL = { noPrompt: 'This turn has no prompt to rewind to', disabled: 'File checkpoints are off for this session', failed: 'Rewind failed' } as const;

// `session.rewindFiles` behind the receipt (C3): the dry run answers `canUndo`, with `enabled: false` (checkpointing
// off) as a refusal; the engine has no forward rewind, so Reapply is not offered.
export function ipcRewindOver(client: MawsBridge, appSessionId: AppSessionId, stateOf: () => TranscriptState | undefined): RewindInterface {
  const rewind = async (turnId: TurnId, dryRun: boolean) => {
    const userMessageUuid = promptOf(stateOf(), turnId);
    if (userMessageUuid === null) return { ok: false, reason: REWIND_REFUSAL.noPrompt };
    const result = await client.invoke('session.rewindFiles', { appSessionId, userMessageUuid, dryRun });
    if (!result.ok) return { ok: false, reason: result.error.message };
    if (!result.value.enabled) return { ok: false, reason: result.value.message ?? REWIND_REFUSAL.disabled };
    return { ok: result.value.ok, reason: result.value.ok ? null : (result.value.message ?? REWIND_REFUSAL.failed), files: result.value.changedFiles };
  };
  return {
    canUndo: (turnId) => rewind(turnId, true),
    async undo(turnId) {
      const outcome = await rewind(turnId, false);
      if (!outcome.ok) throw new Error(outcome.reason ?? REWIND_REFUSAL.failed);
    },
  };
}

// The rewind interface of a session followed through `ipcSource` (its store key is the app session id).
export const ipcRewind = (appSessionId: AppSessionId): RewindInterface =>
  ipcRewindOver(ipc, appSessionId, () => useTranscriptStore.getState().entries[appSessionId]?.state);
