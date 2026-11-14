// One lane B session on another machine, as main follows it while a tab holds it (P5 O7 M2, docs/doperpowers/plans/
// 2026-10-28-p5-o7-remote-lane-b.md, "The record", "One subscription per session", "An idle session's stream", "The
// capability list"; Interfaces §J, §K). Its record, its stream and its capabilities, folded from the link and told to the
// renderer as the events it already consumes for a local session, emitted for the machine (`emitFrom`).
//
// - The record. `session.get` over the link (a `view` call), emitted as `session.changed {record, cause: 'live'}`, so the
//   sessions store holds a record under the address and the pane takes its started branch. A session the machine can't
//   place yet (null, or `grade`: a fresh session whose engine hasn't reported its id) is asked again at 0.5, 1, 2 and 4 s,
//   then the stream ends "can't place"; a later `start` (a click: the tab's interest read again) tries again. Board #525:
//   `grade` is also the word for a member below View there, so on a session the org rows list as another member's its
//   first one is said at once (`readRefused`, the reason `READ_REFUSED`, which the renderer words with whom to ask) while
//   the ladder asks on, quietly; an owner's stays "not placed yet". A read the
//   link could not carry (offline, a timeout, the machine's index unavailable) is asked again on the idle backoff without
//   counting. The subscription opens once the record is had.
// - The stream. One `full` subscription. Its parts become `session.status`, `session.queue`, `session.catalogChanged`
//   and, for the broker's items still waiting on a person, `attention.changed` for that session (the renderer never reads
//   `session.brokerItems`), unless the machine's attention feed follows it (P5 O7 M6 fix wave 1, `attentionFed`: the
//   feed's list is the machine's whole one, and the feed's cache is what a page is told again); its events `session.eventBatch`, coalesced per macrotask into batches of at most `batchMax`,
//   flushed before anything else is said. Every payload is read tolerantly first (the machine may be a newer build of the
//   wire's major: its unknown keys are dropped), and an event that still doesn't read is a gap (below).
// - Gaps. The first `subbed` of a subscription says nothing, nor does a later `replay`. A later `snapshot` (a relaunch, a
//   `/clear`) or `missing` (a range the journal lost), a fresh subscription's `missing` from a cursor this session held,
//   and an event too large to carry (`omitted`) each emit `remote.gap {appSessionId, launchId, at?}` before what follows.
//   A snapshot's is told at its `subbed`, before the launch's first event. A `missing` stream goes on from what the
//   machine still has of the launch (lane B's streams from the launch's start), so its hole ends at the first event it
//   delivers: its gap is told just before that event, with its place (`at`), or with none when the stream ends or answers
//   another `subbed` first; an omitted event's names its own place.
// - Idle. An `ended('unavailable')` is a placed session that isn't live (released as idle, or the host parked): the stream
//   is `idle`, its status forgotten. Each try of a subscription places the session on the machine's engine host (waking a
//   parked one) and reports the session as watched, which restarts the machine's park clock (O5's landing audit), so it
//   is not tried again blindly. While the session's checkout feed carries its record (`followed`, P5 O7 M4), it is
//   subscribed again from its cursor only when the record says it runs (its holder `self`) or names another engine
//   session (`recordChanged`), or when the feed opens again (`kick`: what changed meanwhile went untold). Without such a
//   feed (a peer without `rl2.feeds`) it is tried on a backoff from 1 s doubling to `idleProbeMaxMs`, well past the
//   machine's park window, so the host parks between tries. `kick` subscribes at once (a resume this app asked for, the
//   feed's opening). A record that says the session runs while a try is still out, unanswered (the opening's first try
//   too: fix wave 2), is kept for that try, and taken once it ends `unavailable` (one more try, each record at most once); a feed that stops following (`unfollowed`: a next
//   channel's peer without feeds) puts a waiting stream on the backoff (fix wave 1). `removed` and `closed` end it for
//   good; any other end ends the stream with its reason.
// - P5 O7 M8 ("Operations and panel events"; Interfaces §U): the machine's notices beside the stream's state, each its
//   local event under the machine's address: `{operation}` as `session.operation`, `{subagents}` as
//   `fs.subagentsChanged`, `{workflow}` as `fs.workflowChanged`, `{tasks}` as `fs.tasksChanged`. `{side}` says nothing of
//   its own: it follows a side question's completion, its `operation`, which the side store already patches its log from
//   or lists it again on (src/renderer/src/side/store.ts, `onSideOperation`). A completion the channel lost is asked of
//   the machine at every `subbed` (each opening, the link's own resubscriptions included) for the receipts this
//   session's waiters hold (`awaitOperation`, from the adapter's receipts): `session.operations` answers each with its
//   completion (emitted), `pending` (kept for its part) or `unknown` (settled as failed, LOST_OPERATION). A completion is
//   emitted once, a late one once more; one for an opId settled here is dropped. An `ended('behind')` (a notice past
//   the machine's bound) opens again from the cursor at once, and that opening asks; one with no progress since the last
//   backs off, and three in a row show the gap and fall back to the idle backoff (`#behind`). At each opening after the first
//   (m8-3's task review) every panel is made to list again, since a notice may have been lost on the way: the session's
//   task list (`fs.tasksChanged`), its subagents (`fs.subagents` read, said as `fs.subagentsChanged` unless a newer part
//   came first), its workflow runs (`fs.workflowChanged` naming no run, `runId: ''`: the list as a whole) and, for the
//   side questions, which have no change event of their own, `remote.reopened`.
// - An event that doesn't read (P5 O7 M8, "What draws Working…") is a gap at its place, never a silent drop: the
//   session's status and record are read again (`session.status`, `session.get`) and folded in, so a turn a dropped
//   `turn.ended` left open closes by the machine's word; a status the stream delivers meanwhile stands over the re-read.
// - `remote.session` at each change (the link's state and caps included), said once per change.
// - The UX wave, U9 (M5, "The settled word"; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md): one
//   standing at any moment, read in one synchronous reading (`standing`). Placing from the first record read through
//   every retry of it (a read in flight, the ladder's timer, the back-off after a transient failure) until the record is
//   had and its subscription registered in the same step, or the session is given up (the ladder's end, `removed`,
//   `closed`); awaiting while a subscription is out unanswered, which a kept subscription is again from main's word of a
//   loss (`lost`) to its next `subbed`; quiet otherwise; none once let go. Each change is told (`standingChanged`) after
//   what the session said for it, so the machine's round (./remote.ts) speaks after the answer that carried it.
// - A replay (`replay`): the record, the last of each part and `remote.session` said again, for a page that has just
//   subscribed (a reload, a second window); what it said before was said to no one listening.
import { readTolerant } from '@shared/ipc/tolerant';
import { SESSION_OPERATIONS_MAX, type OperationCommand, type OperationEvent, type OperationOutcome } from '@shared/engine/operations';
import { AttentionItemSchema, type AttentionItem } from '@shared/graph/attention';
import { waits } from '@shared/attention/kinds';
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import { sanitiseListId } from '@shared/engine/task-list';
import type { SessionRecord } from '@shared/graph/session';
import { REGISTRY } from '@shared/ipc/registry';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import type { RemoteAnswer, RemoteStreamState } from '@shared/ipc/schema/remote';
import { codecOf } from '@shared/ipc/validate';
import type { MachineRef } from '@shared/machine/ref';
import { LINK_REGISTRY } from '../machines/link-surface';
import type { Cursor } from '../../../apps/org-protocol/src/index.ts';
import type { RemoteLink, Subscription, SubscriptionSink } from '../machines/remote/link';
import { controlsOverlay, remoteLinkView, sessionReason } from './remote-outcomes';

export interface RemoteSessionState {
  machine: MachineRef;
  /** The bare appSessionId. */
  app: string;
  /** The last `status` part: an engine-host act's context. Null while not live. */
  status: Record<string, unknown> | null;
  /** `session.get`'s answer, emitted as `session.changed`. */
  record: SessionRecord | null;
  stream: RemoteStreamState;
  /** The current launchId. */
  launch: string | null;
  /** Sends waiting behind the one in flight. */
  sends: number;
  /** Why the stream ended, while it has: `unplaced`, `closed`, `removed`, or the endpoint's reason. */
  ended: string | null;
  /**
   * Board #525: the record read was refused `grade`, its latest answer: the member holds less than View there, or the
   * machine hasn't placed a just-started session (one word for both). Said at once; the ladder asks on, quietly.
   */
  readRefused?: true;
}

export interface RemoteSessionTiming {
  recordRetryMs: readonly number[];
  /** A record read the link couldn't carry is asked again after the first, doubling to the second. */
  idleRetryMs: readonly [number, number];
  /** With no feed carrying the record, an idle stream is tried again on the idle backoff doubling to this. */
  idleProbeMaxMs: number;
  batchMax: number;
}

export interface RemoteSessionDeps {
  machine: MachineRef;
  app: string;
  link: RemoteLink;
  emit<N extends EventName>(machine: MachineRef, name: N, payload: EventPayload<N>): void;
  timing: RemoteSessionTiming;
  /** The revision a `session.changed` carries: rising across the app's run. */
  revision(): number;
  /** P5 O7 M4: the stream was subscribed (the session is placed): what follows it beside the stream opens now. */
  subscribed?(): void;
  /** Whether the session's checkout feed carries its record now (`recordChanged`): an idle stream waits for it. */
  followed?(): boolean;
  /**
   * P5 O7 M6 fix wave 1: whether the machine's attention feed is the session's attention now. Its items are the machine's
   * whole list (derived errors and every other item), where the stream's are the broker's alone: while the feed follows,
   * the stream keeps its items but says none, so neither overwrites the other.
   */
  attentionFed?(): boolean;
  /** Fix wave 4: the stream's items changed (said or not): the machine's effective items may be these. */
  attentionChanged?(): void;
  /**
   * Board #525: whether the org rows list the session as another member's. Only then is a `grade` refusal of its record
   * said as `READ_REFUSED`; an owner's (a session this app spawned or resumed included) is the machine not placing it yet.
   */
  othersSession?(): boolean;
  /**
   * P5 O15 M2b: the session's next answer count (`remote.session`'s `answer.n`), kept by the adapter for the session
   * across its records, so it only grows; absent, the record counts from 1.
   */
  nextAnswer?(): number;
  /** The UX wave, U9 (M5): the lane's standing may have changed, told after what was said for it. */
  standingChanged?(): void;
  log(line: string): void;
}

/** The UX wave, U9 (M5): a lane's part in its machine's settled word; `null` once let go. */
export type LaneStanding = 'placing' | 'awaiting' | 'quiet';

const events = codecOf(REGISTRY);
const link = codecOf(LINK_REGISTRY);
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Call errors that say nothing about the session: the link or the machine's index couldn't answer now. */
const TRANSIENT = new Set(['offline', 'timeout', 'unavailable']);
/** P5 O7 M8: the words of an operation the machine says it doesn't know (`session.operations`' `unknown`). */
export const LOST_OPERATION = 'the machine lost this operation’s result; check the transcript';
/** m8-3 review (B): a `behind` with no progress since the last backs off from this, doubling to the cap. */
const BEHIND_FIRST_MS = 250;
const BEHIND_MAX_MS = 5_000;
/** Reopens in a row with no progress before the stream shows the gap and falls back to the idle backoff. */
const BEHIND_STALLS = 3;
/** Operations remembered past their completion, so a repeat or a late one for a settled op is told apart. */
const OPS_KEPT = 256;
/** An operation this session heard of: its receipt waiting, its completion said (`late` once more), or settled here. */
type Op = { command: OperationCommand; state: 'waiting' | 'completed' | 'lost'; lateSaid: boolean };

export class RemoteSession {
  readonly state: RemoteSessionState;
  readonly #deps: RemoteSessionDeps;
  #running = false;
  /** The current subscription's, or record read's: a callback of an earlier one is ignored. */
  #token: object = {};
  #sub: Subscription | null = null;
  /** The position this session's stream stood at, kept across fresh subscriptions. */
  #cursor: Cursor | null = null;
  #pendingGap: string | null = null; // the launch of a `missing` gap not told yet: its place is the next event's
  #timer: ReturnType<typeof setTimeout> | null = null;
  /** A record said the session runs while the try out was not yet answered: one more try once it ends. */
  #started = false;
  /** The subscription out has had its `subbed`. */
  #answered = false;
  /** The UX wave, U9 (M5): the subscription out is unanswered: since it was made, or since main's word of a loss. */
  #awaiting = false;
  #backoffMs: number;
  #batch: SessionEvent[] = [];
  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  #waiters = new Set<() => void>();
  #offs: Array<() => void> = [];
  #said = '';
  /** The last queue, catalog (with its launch) and waiting items the stream gave, said again by a replay. */
  #lastParts: { queue?: Record<string, unknown>; catalog?: { launchId: string; catalog: Record<string, unknown> }; items?: AttentionItem[] } = {};
  /** P5 O7 M8: the operations heard of, oldest first. */
  #ops = new Map<string, Op>();
  /** m8-3 review (B): where the stream stood at its last `behind`, and the reopens in a row since that made no progress. */
  #behindAt: { at: Cursor | null; stalls: number; fallbackMs: number } | null = null;
  /** m8-3 review: the last workflow run the stream named, said again at a reopening. */
  /** m8-3 review round 2: `subagents` parts the stream delivered, so a reopening's read that answers after one is dropped. */
  #subagentParts = 0;
  /** P5 O7 M8: the `subbed`s heard, each an opening the waiters are asked at. */
  #openings = 0;
  /** M8 review: records the checkout feed delivered, so a gap's re-read that answers after one doesn't roll it back. */
  #records = 0;
  /** P5 O7 M8: status parts the stream delivered, so a re-read that answers after one doesn't replace it. */
  #statuses = 0;
  /** P5 O7 M8: a re-read after a gap is out; `again`: another gap came meanwhile, so one more follows it. */
  #rereading: { token: object; again: boolean } | null = null;
  /** P5 O15 M2b: the stream's latest answer, said with `remote.session`. */
  #answer: RemoteAnswer | null = null;

  constructor(deps: RemoteSessionDeps) {
    this.#deps = deps;
    this.#backoffMs = deps.timing.idleRetryMs[0];
    this.state = { machine: deps.machine, app: deps.app, status: null, record: null, stream: 'opening', launch: null, sends: 0, ended: null };
  }

  get link(): RemoteLink {
    return this.#deps.link;
  }

  /** Opens the session: its record, then its stream. A running one is left as it is, unless its stream ended (a retry). */
  start(): void {
    if (this.#running && this.state.stream !== 'ended') return;
    if (this.state.ended === 'removed' && this.link.refusal() !== null) return;
    this.#halt();
    this.#running = true;
    this.state.stream = 'opening';
    this.state.ended = null;
    if (this.#offs.length === 0) this.#offs = [this.link.onState(() => this.publish()), this.link.onCaps(() => this.publish())];
    this.publish();
    if (this.state.record === null) void this.#readRecord(0, this.#token);
    else this.#subscribe();
    this.#deps.standingChanged?.();
  }

  /** Closes the stream; with `ended`, says so as its last state (the link closed), else quietly (the tab let it go). */
  stop(ended?: string): void {
    this.#running = false;
    this.#halt();
    for (const off of this.#offs.splice(0)) off();
    if (ended !== undefined) {
      this.state.stream = 'ended';
      this.state.ended = ended;
      this.state.status = null;
      this.publish(true);
    }
    this.#deps.standingChanged?.();
  }

  /**
   * The UX wave, U9 (M5): the lane's standing now: placing while its record is being had, awaiting while a subscription
   * is out unanswered, quiet otherwise; null once let go (not running).
   */
  standing(): LaneStanding | null {
    if (!this.#running) return null;
    if (this.#sub !== null && this.#awaiting) return 'awaiting';
    if (this.state.record === null && this.state.stream !== 'ended') return 'placing';
    return 'quiet';
  }

  /** The UX wave, U9 (M5): main's word of the link's loss (`down` after `up`): a subscription kept across it awaits its next answer. */
  lost(): void {
    if (!this.#running || this.#sub === null) return;
    this.#awaiting = true;
  }

  /** Subscribes at once if the stream waits to be subscribed again (a resume this app asked for completed). */
  kick(): void {
    if (!this.#running || this.#sub !== null || this.state.record === null || this.state.stream === 'ended') return;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#backoffMs = this.#deps.timing.idleRetryMs[0];
    this.#subscribe();
  }

  /**
   * The session's record as the machine changed it (its checkout feed): told, and an idle stream subscribed again at once
   * when it says the session runs (its holder `self`) or names another engine session.
   */
  recordChanged(record: SessionRecord): void {
    if (!this.#running) return;
    const before = this.state.record;
    this.#records += 1;
    this.state.record = record;
    this.#deps.emit(this.state.machine, 'session.changed', { record, cause: 'live', revision: this.#deps.revision() });
    if (record.holder.kind !== 'self' && record.engineSessionId === before?.engineSessionId) return;
    if (this.#sub !== null && !this.#answered) this.#started = true; // a try out, unanswered: kept for its end
    else if (this.state.stream === 'idle') this.kick();
  }

  /** The record no longer follows (the feed ended for good, not as a stop): a stream waiting on it tries on the backoff. */
  unfollowed(): void {
    if (!this.#running || this.state.stream !== 'idle' || this.#sub !== null || this.#timer !== null) return;
    this.#later(() => this.#subscribe(), this.#deps.timing.idleProbeMaxMs);
  }

  /**
   * The context an engine-host act is sealed with: the launch and its engine session while its process is `ready`, else
   * null. The engine host keeps a row for a launch that ended (a crash, a stop, a budget or idle release: `exited`, both
   * ids still set) and the stream goes on publishing it, so the ids alone don't say the launch takes acts.
   */
  context(): { launchId: string; engineSessionId: string } | null {
    const status = this.state.status;
    if (status?.process !== 'ready') return null;
    return typeof status.launchId === 'string' && typeof status.engineSessionId === 'string' ? { launchId: status.launchId, engineSessionId: status.engineSessionId } : null;
  }

  /** Whether a launch is on its way to `ready` (`starting`, `initializing`): an act waits for it rather than resuming. */
  launching(): boolean {
    const process = this.state.status?.process;
    return process === 'starting' || process === 'initializing';
  }

  /** The context once the stream delivers one, or null at `deadline` (epoch ms) or at `stop`. */
  whenContext(deadline: number, now: () => number): Promise<{ launchId: string; engineSessionId: string } | null> {
    const ready = this.context();
    if (ready !== null || !this.#running) return Promise.resolve(ready);
    return new Promise((resolve) => {
      const done = () => {
        const context = this.context();
        if (context === null && this.#running && now() < deadline) return;
        clearTimeout(timer);
        this.#waiters.delete(done);
        resolve(context);
      };
      const timer = setTimeout(() => {
        this.#waiters.delete(done);
        resolve(this.context());
      }, Math.max(0, deadline - now()));
      this.#waiters.add(done);
    });
  }

  /** Says again what a page that just subscribed missed: the record, the last of each part, and `remote.session`. */
  replay(): void {
    const app = this.state.app;
    if (this.state.record !== null) this.#deps.emit(this.state.machine, 'session.changed', { record: this.state.record, cause: 'live', revision: this.#deps.revision() });
    if (this.state.status !== null) this.#emit('session.status', { appSessionId: app, status: this.state.status });
    const { queue, catalog, items } = this.#lastParts;
    if (queue !== undefined) this.#emit('session.queue', { ...queue, appSessionId: app });
    if (catalog !== undefined) this.#emit('session.catalogChanged', { appSessionId: app, ...catalog });
    if (items !== undefined && this.#deps.attentionFed?.() !== true) this.#emit('attention.changed', { appSessionId: app, items });
    this.publish(true);
  }

  /** The session's task list as the task panel derives it (its status's `taskListId`, else its record's engine session), or null. */
  taskList(): string | null {
    const id = this.state.status !== null ? this.state.status.taskListId : this.state.record?.engineSessionId;
    return typeof id === 'string' ? sanitiseListId(id) : null;
  }

  /** P5 O7 M8: the openings answered so far (each `subbed`): an act made under one names it to `awaitOperation`. */
  openings(): number {
    return this.#openings;
  }

  /**
   * P5 O7 M8: a receipt of this session's operation (the adapter's act answered `{opId}`): its completion is waited for,
   * and asked of the machine at each opening until it comes. One whose completion came first waits for nothing. `since`,
   * the opening its act was made under: a receipt heard after a later opening reconciled (RL4 recovered it once the link
   * resubscribed) missed that opening's ask, so it is asked now.
   */
  awaitOperation(opId: string, command: OperationCommand, since?: number): void {
    if (this.#ops.has(opId)) return;
    this.#remember(opId, { command, state: 'waiting', lateSaid: false });
    if (since !== undefined && since !== this.#openings && this.#answered && this.#sub !== null) void this.#readOperations([opId], this.#token);
  }

  /** P5 O7 M6 fix wave 3: the broker's items the stream last delivered (none before its first part). */
  attentionItems(): AttentionItem[] {
    return this.#lastParts.items ?? [];
  }

  /** P5 O7 M6 fix wave 1: the stream's items said again, once the machine's attention feed stopped following (an endpoint without it). */
  replayAttention(): void {
    const items = this.#lastParts.items;
    if (items !== undefined && this.#deps.attentionFed?.() !== true) this.#emit('attention.changed', { appSessionId: this.state.app, items });
  }

  /** `remote.session` now, if it changed since it was last said (`force`: said whatever). */
  publish(force = false): void {
    const view = remoteLinkView(this.link);
    const payload = {
      address: this.state.app,
      link: view,
      stream: this.state.stream,
      controls: controlsOverlay(this.state, view, this.link.name),
      reason: sessionReason(this.state, view, this.link.name),
      answer: this.#answer,
    };
    const text = JSON.stringify(payload);
    if (!force && text === this.#said) return;
    this.#said = text;
    this.#deps.emit(this.state.machine, 'remote.session', payload as EventPayload<'remote.session'>);
  }

  // ---- The record ------------------------------------------------------------------------------------------------------

  async #readRecord(attempt: number, token: object): Promise<void> {
    const { timing } = this.#deps;
    const answer = await this.link.call('session.get', { appSessionId: this.state.app });
    if (this.#token !== token || !this.#running) return;
    // board #525: a refusal at the member's grade is said at once; any later answer about the session (never a transient
    // one, which says nothing of it) takes its place
    const refused = !answer.ok && answer.error.code === 'grade';
    if (this.state.readRefused && !refused && (answer.ok || !TRANSIENT.has(answer.error.code))) delete this.state.readRefused;
    if (answer.ok) {
      const read = link.readCommandOutput('session.get', answer.output);
      if (read.ok && read.value !== null) {
        this.state.record = read.value as SessionRecord;
        this.#deps.emit(this.state.machine, 'session.changed', { record: this.state.record, cause: 'live', revision: this.#deps.revision() });
        this.#subscribe(); // the hand-over: the record had and its subscription out in one step
        this.publish();
        this.#deps.standingChanged?.();
        return;
      }
      if (!read.ok) this.#deps.log(`lane B: ${this.link.name}/${this.state.app}: session.get answered a record that doesn't read: ${read.error.message}`);
    } else if (answer.error.code === 'removed' || answer.error.code === 'closed') {
      return this.stop(answer.error.code);
    } else if (TRANSIENT.has(answer.error.code)) {
      return this.#later(() => void this.#readRecord(attempt, token));
    } else if (refused && !this.state.readRefused && this.#deps.othersSession?.() === true) {
      this.state.readRefused = true;
      this.publish();
    }
    if (attempt >= timing.recordRetryMs.length) {
      this.state.stream = 'ended';
      this.state.ended = 'unplaced';
      this.publish();
      this.#deps.standingChanged?.();
      return;
    }
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#readRecord(attempt + 1, token);
    }, timing.recordRetryMs[attempt]);
  }

  // ---- The stream ------------------------------------------------------------------------------------------------------

  #subscribe(): void {
    const token = {};
    this.#token = token;
    this.#answered = false;
    this.#awaiting = true;
    const mine = () => this.#token === token && this.#running;
    let first = true; // this subscription's first `subbed`
    const carried = this.#cursor !== null;
    const sink: SubscriptionSink = {
      subbed: (mode, at) => {
        if (!mine()) return;
        this.#flush();
        const gap = first ? mode === 'missing' && carried : mode !== 'replay';
        first = false;
        this.#started = false;
        this.#answered = true;
        this.#awaiting = false;
        this.#backoffMs = this.#deps.timing.idleRetryMs[0];
        this.state.launch = at.epoch;
        this.#tellPendingGap();
        // A `missing` stream goes on from what the machine still has of the launch: the hole ends at the first event it
        // delivers, so its gap is told there, with that place
        if (gap && mode === 'missing') {
          this.state.stream = 'gap';
          this.#pendingGap = at.epoch;
        } else if (gap) this.#gap(at.epoch);
        else this.state.stream = 'live';
        this.#answeredWith(mode);
        this.publish();
        this.#openings += 1;
        this.#askOperations(token);
        if (this.#openings > 1) this.#relist(token);
        this.#deps.standingChanged?.();
      },
      snapshot: (at, value) => {
        if (!mine()) return;
        this.#flush();
        this.#parts(at.epoch, value);
        if (this.state.stream === 'gap' || this.state.stream === 'opening' || this.state.stream === 'idle') this.state.stream = 'live';
        this.publish();
        for (const waiter of [...this.#waiters]) waiter();
      },
      event: (at, body) => {
        if (!mine()) return;
        const place = { seq: at.seq, ...(at.idx !== undefined && { idx: at.idx }) };
        if (this.#pendingGap !== null) this.#tellPendingGap(at.epoch === this.#pendingGap ? place : undefined);
        if (isObject(body) && body.omitted !== undefined) {
          this.#flush();
          this.#gap(at.epoch, place);
          this.publish();
          return;
        }
        const read = readTolerant(SessionEventSchema, body);
        if (!read.ok) {
          this.#deps.log(`lane B: ${this.link.name}/${this.state.app}: an event at ${at.epoch}:${at.seq}:${at.idx ?? ''} doesn't read; a gap there, the status and record read again`);
          this.#flush();
          this.#gap(at.epoch, place);
          this.publish();
          this.#readAgain(token);
          return;
        }
        this.#batch.push(read.value);
        if (this.#batch.length >= this.#deps.timing.batchMax) this.#flush();
        else this.#flushTimer ??= setTimeout(() => this.#flush(), 0);
      },
      paused: () => {
        if (!mine()) return;
        this.#flush();
        this.state.stream = 'paused';
        this.publish();
      },
      resumed: () => {
        if (!mine()) return;
        this.state.stream = 'live';
        this.publish();
      },
      ended: (reason) => {
        if (!mine()) return;
        this.#flush();
        this.#tellPendingGap();
        this.#cursor = this.#sub?.cursor() ?? this.#cursor;
        this.#sub = null;
        this.#awaiting = false;
        this.#token = {}; // m8-3 review: a read made for this subscription (a gap's re-read, an operations ask) is not taken after its end
        this.#ended(reason);
        this.#deps.standingChanged?.();
      },
    };
    this.#sub = this.link.subscribe({ session: { lane: 'B', id: this.state.app }, view: 'full', cursor: this.#cursor }, sink);
    this.#deps.subscribed?.();
  }

  /** A subscription's end, its subscription already let go: stopped, opened again, idle or ended as the reason says. */
  #ended(reason: string): void {
    if (reason === 'removed' || reason === 'closed') return this.stop(reason);
    // P5 O7 M8: the machine ended it past its notices' bound; the session runs on, so it is opened again from where
    // it stood, and that opening asks for the completions it missed
    if (reason === 'behind') return this.#behind();
    this.state.status = null;
    if (reason !== 'unavailable') {
      this.state.stream = 'ended';
      this.state.ended = reason;
      this.#endAnswered('ended');
      this.publish();
      return;
    }
    this.state.stream = 'idle';
    this.#endAnswered('unavailable');
    this.publish();
    if (this.#started) {
      this.#started = false;
      return this.#subscribe();
    }
    if (!this.#deps.followed?.()) this.#later(() => this.#subscribe(), this.#deps.timing.idleProbeMaxMs);
  }

  /** The replace-whole parts of a snapshot, the status first. */
  #parts(launchId: string, value: unknown): void {
    if (!isObject(value)) return;
    const app = this.state.app;
    if (isObject(value.status)) {
      this.#statuses += 1;
      this.state.status = value.status;
      if (typeof value.status.launchId === 'string') this.state.launch = value.status.launchId;
      this.#emit('session.status', { appSessionId: app, status: value.status });
    }
    if (isObject(value.queue)) {
      this.#lastParts.queue = value.queue;
      this.#emit('session.queue', { ...value.queue, appSessionId: app });
    }
    if (isObject(value.catalog)) {
      this.#lastParts.catalog = { launchId, catalog: value.catalog };
      this.#emit('session.catalogChanged', { appSessionId: app, launchId, catalog: value.catalog });
    }
    if (Array.isArray(value.pendingItems)) {
      const items: AttentionItem[] = [];
      for (const raw of value.pendingItems) {
        const read = readTolerant(AttentionItemSchema, raw);
        if (read.ok && waits(read.value)) items.push(read.value); // UC-1: a machine on an older build still sends delivered items
      }
      this.#lastParts.items = items;
      if (this.#deps.attentionFed?.() !== true) this.#emit('attention.changed', { appSessionId: app, items });
      this.#deps.attentionChanged?.();
    }
    // P5 O7 M8: the notices; `side` is its completion's `operation` already (the header)
    if (isObject(value.operation)) this.#operation(value.operation);
    if (isObject(value.subagents)) {
      this.#subagentParts += 1;
      this.#emit('fs.subagentsChanged', { appSessionId: app, agents: value.subagents.agents });
    }
    if (isObject(value.workflow)) this.#emit('fs.workflowChanged', { appSessionId: app, runId: value.workflow.runId });
    if (isObject(value.tasks)) this.#emit('fs.tasksChanged', { listId: value.tasks.listId });
  }

  // ---- Operations (P5 O7 M8) -------------------------------------------------------------------------------------------

  /**
   * A completion, from the stream or the machine's answer: said once, a late one once more; nothing for an op settled
   * here. A waiter that never saw its first is given the late one the machine kept in its place as its first.
   */
  #operation(raw: Record<string, unknown>): void {
    const read = events.readEventPayload('session.operation', { ...raw, appSessionId: this.state.app });
    if (!read.ok) return this.#deps.log(`lane B: ${this.link.name}/${this.state.app}: session.operation doesn't read; left out`);
    const event = read.value as OperationEvent;
    const op = this.#ops.get(event.opId);
    if (op?.state === 'lost') return this.#deps.log(`lane B: ${this.link.name}/${this.state.app}: ${event.opId} completed after it was settled lost; dropped`);
    if (event.late ? op?.lateSaid === true : op?.state === 'completed') return;
    const first = op === undefined || op.state === 'waiting'; // a late one heard before its receipt is the first this app saw
    this.#remember(event.opId, { command: event.command, state: 'completed', lateSaid: op?.lateSaid === true || event.late });
    this.#deps.emit(this.state.machine, 'session.operation', first && event.late ? { ...event, late: false } : event);
  }

  /** The waiters' opIds asked of the machine, for the subscription `token` is. */
  #askOperations(token: object): void {
    const waiting = [...this.#ops].filter(([, op]) => op.state === 'waiting').map(([opId]) => opId);
    for (let i = 0; i < waiting.length; i += SESSION_OPERATIONS_MAX) void this.#readOperations(waiting.slice(i, i + SESSION_OPERATIONS_MAX), token);
  }

  async #readOperations(opIds: string[], token: object): Promise<void> {
    const answer = await this.link.call('session.operations', { appSessionId: this.state.app, opIds });
    if (this.#token !== token || !this.#running) return; // the next opening asks again
    const read = answer.ok ? link.readCommandOutput('session.operations', answer.output) : null;
    if (read === null || !read.ok) return this.#deps.log(`lane B: ${this.link.name}/${this.state.app}: session.operations ${answer.ok ? 'answered what doesn’t read' : `failed (${answer.error.code})`}; asked again at the next opening`);
    for (const outcome of (read.value as { outcomes: OperationOutcome[] }).outcomes) {
      if ('event' in outcome) this.#operation(outcome.event);
      else if ('unknown' in outcome) this.#lose(outcome.opId);
    }
  }

  /** A waiter the machine doesn't know: settled as failed, and anything heard of it later dropped. */
  #lose(opId: string): void {
    const op = this.#ops.get(opId);
    if (op?.state !== 'waiting') return;
    this.#remember(opId, { ...op, state: 'lost' });
    const event: OperationEvent = { appSessionId: this.state.app as OperationEvent['appSessionId'], opId, command: op.command, late: false, outcome: { ok: false, error: { code: 'engine_error', message: LOST_OPERATION, engineCode: null } } };
    this.#deps.emit(this.state.machine, 'session.operation', event);
  }

  /** An op's state, newest last; past OPS_KEPT the oldest settled ones go (a waiting one stays). */
  #remember(opId: string, op: Op): void {
    this.#ops.delete(opId);
    this.#ops.set(opId, op);
    for (const [old, kept] of this.#ops) {
      if (this.#ops.size <= OPS_KEPT) break;
      if (kept.state !== 'waiting') this.#ops.delete(old);
    }
  }

  // ---- `behind` (P5 O7 M8; m8-3's task review, B) --------------------------------------------------------------------

  /**
   * An `ended('behind')`: opened again at once when the cursor moved since the last one; while it stands, after
   * BEHIND_FIRST_MS doubling to BEHIND_MAX_MS; after BEHIND_STALLS reopens in a row with no progress, the stream shows
   * the gap and is tried on a backoff of the idle one's steps, its own, which an opening's `subbed` doesn't reset and only
   * progress does.
   */
  #behind(): void {
    const at = this.#cursor;
    const last = this.#behindAt;
    const moved = last === null || JSON.stringify(last.at) !== JSON.stringify(at);
    const stalls = moved ? 0 : last.stalls + 1;
    // the fallback's own backoff, kept across the openings (a `subbed` resets the idle one) and reset only by progress
    const [firstMs, capMs] = this.#deps.timing.idleRetryMs;
    const fallbackMs = moved ? firstMs : last.fallbackMs;
    this.#behindAt = { at, stalls, fallbackMs: stalls >= BEHIND_STALLS ? Math.min(fallbackMs * 2, capMs) : fallbackMs };
    if (stalls === 0) return this.#subscribe();
    if (stalls >= BEHIND_STALLS) {
      this.#deps.log(`lane B: ${this.link.name}/${this.state.app}: the stream ended behind ${stalls} times in a row with no progress; tried again in ${fallbackMs} ms`);
      this.state.stream = 'gap';
      this.publish();
    }
    this.#timer = setTimeout(
      () => {
        this.#timer = null;
        if (this.#running) this.#subscribe();
      },
      stalls >= BEHIND_STALLS ? fallbackMs : Math.min(BEHIND_FIRST_MS * 2 ** (stalls - 1), BEHIND_MAX_MS),
    );
  }

  // ---- The panels across a reopening (m8-3's task review) ------------------------------------------------------------

  /** Every panel made to list again: a notice it lists by may have been lost between the openings. */
  #relist(token: object): void {
    const app = this.state.app;
    const list = this.taskList();
    if (list !== null) this.#emit('fs.tasksChanged', { listId: list });
    this.#emit('remote.reopened', { appSessionId: app });
    // the runs as a whole (no run in particular, `runId: ''`): both of the workflow panels list them again on any change
    this.#emit('fs.workflowChanged', { appSessionId: app, runId: '' });
    void this.#readSubagents(token);
  }

  /** The subagents read and said, unless the stream delivered a `subagents` part while the read was out (it is newer). */
  async #readSubagents(token: object): Promise<void> {
    const parts = this.#subagentParts;
    const answer = await this.link.call('fs.subagents', { appSessionId: this.state.app });
    if (this.#token !== token || !this.#running || this.#subagentParts !== parts) return;
    const read = answer.ok ? link.readCommandOutput('fs.subagents', answer.output) : null;
    if (read?.ok === true) return this.#emit('fs.subagentsChanged', { appSessionId: this.state.app, agents: (read.value as { agents: unknown }).agents });
    this.#deps.log(`lane B: ${this.link.name}/${this.state.app}: fs.subagents at a reopening ${answer.ok ? 'answered what doesn’t read' : `failed (${answer.error.code})`}; its panel lists at its next change`);
  }

  // ---- An event that doesn't read (P5 O7 M8) --------------------------------------------------------------------------

  /**
   * The status and record read again after a gap; a status part the stream, or a record the checkout feed, delivered
   * meanwhile stands. One read is out at a time per subscription: gaps that come while it is make one more after it,
   * not one each.
   */
  #readAgain(token: object): void {
    if (this.#rereading?.token === token) {
      this.#rereading.again = true;
      return;
    }
    const reading = { token, again: false };
    this.#rereading = reading;
    void this.#reread(token).finally(() => {
      if (this.#rereading !== reading) return;
      this.#rereading = null;
      if (reading.again && this.#token === token && this.#running) this.#readAgain(token);
    });
  }

  async #reread(token: object): Promise<void> {
    const app = this.state.app;
    const statuses = this.#statuses;
    const records = this.#records;
    const [status, record] = await Promise.all([this.link.call('session.status', { appSessionId: app }), this.link.call('session.get', { appSessionId: app })]);
    if (this.#token !== token || !this.#running) return;
    const readStatus = status.ok ? link.readCommandOutput('session.status', status.output) : null;
    if (readStatus?.ok === true && this.#statuses === statuses) {
      this.#flush();
      this.#parts(this.state.launch ?? '', { status: readStatus.value });
      if (this.state.stream === 'gap') this.state.stream = 'live';
      for (const waiter of [...this.#waiters]) waiter();
    } else if (readStatus?.ok !== true) this.#deps.log(`lane B: ${this.link.name}/${app}: the status read again after a gap ${status.ok ? 'doesn’t read' : `failed (${status.error.code})`}`);
    const readRecord = record.ok ? link.readCommandOutput('session.get', record.output) : null;
    if (readRecord?.ok === true && readRecord.value !== null && this.#records === records) {
      this.state.record = readRecord.value as SessionRecord;
      this.#deps.emit(this.state.machine, 'session.changed', { record: this.state.record, cause: 'live', revision: this.#deps.revision() });
    }
    this.publish();
  }

  /** A payload read as this build reads it, then emitted for the machine; one that doesn't read is left out, logged. */
  #emit(name: EventName, payload: unknown): void {
    const read = events.readEventPayload(name, payload);
    if (!read.ok) return this.#deps.log(`lane B: ${this.link.name}/${this.state.app}: ${name} doesn't read; left out`);
    this.#deps.emit(this.state.machine, name, read.value as never);
  }

  /** P5 O15 M2b: the machine answered the stream (a `subbed`, or an end leaving it idle or ended). */
  #answeredWith(mode: RemoteAnswer['mode']): void {
    this.#answer = { n: this.#deps.nextAnswer?.() ?? (this.#answer?.n ?? 0) + 1, mode };
  }

  /**
   * An end is the stream's answer only while the link is up: an end the link makes itself (its refusal, its close: a
   * `removed` or `closed` end goes to `stop`, which answers nothing) or one made with no channel current (a `busy`
   * refusal while offline) says nothing of what the machine answered, so a page never takes it for the return's.
   */
  #endAnswered(mode: 'ended' | 'unavailable'): void {
    if (this.link.state() === 'up') this.#answeredWith(mode);
  }

  #gap(launchId: string, at?: EventPayload<'remote.gap'>['at']): void {
    this.state.stream = 'gap';
    this.#deps.emit(this.state.machine, 'remote.gap', { appSessionId: this.state.app as EventPayload<'remote.gap'>['appSessionId'], launchId, ...(at !== undefined && { at }) });
  }

  /** A `missing` gap still waiting for its place, told now: at `at`, or with none (the stream went on without an event). */
  #tellPendingGap(at?: EventPayload<'remote.gap'>['at']): void {
    const launchId = this.#pendingGap;
    if (launchId === null) return;
    this.#pendingGap = null;
    this.#flush();
    const stream = this.state.stream;
    this.#gap(launchId, at);
    this.state.stream = stream; // the stream's state is the subscription's own by now
  }

  #flush(): void {
    if (this.#flushTimer !== null) clearTimeout(this.#flushTimer);
    this.#flushTimer = null;
    if (this.#batch.length === 0) return;
    const batch = this.#batch;
    this.#batch = [];
    const { batchMax } = this.#deps.timing;
    for (let i = 0; i < batch.length; i += batchMax) this.#emit('session.eventBatch', { appSessionId: this.state.app, events: batch.slice(i, i + batchMax) });
  }

  /** Runs `again` on the idle backoff, doubling up to `cap`. */
  #later(again: () => void, cap = this.#deps.timing.idleRetryMs[1]): void {
    const delay = this.#backoffMs;
    this.#backoffMs = Math.min(this.#backoffMs * 2, cap);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (this.#running) again();
    }, delay);
  }

  /** Every timer, subscription and wait of the run before. */
  #halt(): void {
    this.#token = {};
    this.#started = false;
    this.#pendingGap = null; // the next subscription's opening from the cursor says it again
    if (this.#sub !== null) this.#cursor = this.#sub.cursor() ?? this.#cursor;
    this.#sub?.close();
    this.#sub = null;
    this.#awaiting = false;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#flush();
    for (const waiter of [...this.#waiters]) waiter();
  }
}
