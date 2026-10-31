// One lane B session on another machine, as main follows it while a tab holds it (P5 O7 M2, docs/doperpowers/plans/
// 2026-10-28-p5-o7-remote-lane-b.md, "The record", "One subscription per session", "An idle session's stream", "The
// capability list"; Interfaces §J, §K). Its record, its stream and its capabilities, folded from the link and told to the
// renderer as the events it already consumes for a local session, emitted for the machine (`emitFrom`).
//
// - The record. `session.get` over the link (a `view` call), emitted as `session.changed {record, cause: 'live'}`, so the
//   sessions store holds a record under the address and the pane takes its started branch. A session the machine can't
//   place yet (null, or `grade`: a fresh session whose engine hasn't reported its id) is asked again at 0.5, 1, 2 and 4 s,
//   then the stream ends "can't place"; a later `start` (a click: the tab's interest read again) tries again. A read the
//   link could not carry (offline, a timeout, the machine's index unavailable) is asked again on the idle backoff without
//   counting. The subscription opens once the record is had.
// - The stream. One `full` subscription. Its parts become `session.status`, `session.queue`, `session.catalogChanged`
//   and, for the broker's items still waiting on a person, `attention.changed` for that session (the renderer never reads
//   `session.brokerItems`); its events `session.eventBatch`, coalesced per macrotask into batches of at most `batchMax`,
//   flushed before anything else is said. Every payload is read tolerantly first (the machine may be a newer build of the
//   wire's major: its unknown keys are dropped), and an event that still doesn't read is left out, logged.
// - Gaps. The first `subbed` of a subscription says nothing, nor does a later `replay`. A later `snapshot` (a relaunch, a
//   `/clear`) or `missing` (a range the journal lost), a fresh subscription's `missing` from a cursor this session held,
//   and an event too large to carry (`omitted`) each emit `remote.gap {appSessionId, launchId, at?}` before what follows.
//   A snapshot's is told at its `subbed`, before the launch's first event. A `missing` stream goes on from what the
//   machine still has of the launch (lane B's streams from the launch's start), so its hole ends at the first event it
//   delivers: its gap is told just before that event, with its place (`at`), or with none when the stream ends or answers
//   another `subbed` first; an omitted event's names its own place.
// - Idle. An `ended('unavailable')` is a placed session that isn't live (released as idle, or the host parked): the stream
//   is `idle`, its status forgotten, and it is subscribed again from its cursor on a backoff from 1 s doubling to 30 s
//   while the tab is open, so a session resumed by anyone streams within the backoff (`kick` subscribes at once, after a
//   resume this app asked for). `removed` and `closed` end it for good; any other end ends the stream with its reason.
// - `remote.session` at each change (the link's state and caps included), said once per change.
// - A replay (`replay`): the record, the last of each part and `remote.session` said again, for a page that has just
//   subscribed (a reload, a second window); what it said before was said to no one listening.
import { readTolerant } from '@shared/ipc/tolerant';
import { AttentionItemSchema, type AttentionItem } from '@shared/graph/attention';
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import type { SessionRecord } from '@shared/graph/session';
import { REGISTRY } from '@shared/ipc/registry';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import type { RemoteStreamState } from '@shared/ipc/schema/remote';
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
}

export interface RemoteSessionTiming {
  recordRetryMs: readonly number[];
  idleRetryMs: readonly [number, number];
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
  log(line: string): void;
}

const events = codecOf(REGISTRY);
const link = codecOf(LINK_REGISTRY);
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Broker items still waiting on a person, as main's local attention service keeps them. */
const WAITING = new Set(['pending', 'delivered']);
/** Call errors that say nothing about the session: the link or the machine's index couldn't answer now. */
const TRANSIENT = new Set(['offline', 'timeout', 'unavailable']);

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
  #backoffMs: number;
  #batch: SessionEvent[] = [];
  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  #waiters = new Set<() => void>();
  #offs: Array<() => void> = [];
  #said = '';
  /** The last queue, catalog (with its launch) and waiting items the stream gave, said again by a replay. */
  #lastParts: { queue?: Record<string, unknown>; catalog?: { launchId: string; catalog: Record<string, unknown> }; items?: AttentionItem[] } = {};

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
  }

  /** Closes the stream; with `ended`, says so as its last state (the link closed), else quietly (the tab let it go). */
  stop(ended?: string): void {
    this.#running = false;
    this.#halt();
    for (const off of this.#offs.splice(0)) off();
    if (ended === undefined) return;
    this.state.stream = 'ended';
    this.state.ended = ended;
    this.state.status = null;
    this.publish(true);
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
    if (items !== undefined) this.#emit('attention.changed', { appSessionId: app, items });
    this.publish(true);
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
    if (answer.ok) {
      const read = link.readCommandOutput('session.get', answer.output);
      if (read.ok && read.value !== null) {
        this.state.record = read.value as SessionRecord;
        this.#deps.emit(this.state.machine, 'session.changed', { record: this.state.record, cause: 'live', revision: this.#deps.revision() });
        this.#subscribe();
        this.publish();
        return;
      }
      if (!read.ok) this.#deps.log(`lane B: ${this.link.name}/${this.state.app}: session.get answered a record that doesn't read: ${read.error.message}`);
    } else if (answer.error.code === 'removed' || answer.error.code === 'closed') {
      return this.stop(answer.error.code);
    } else if (TRANSIENT.has(answer.error.code)) {
      return this.#later(() => void this.#readRecord(attempt, token));
    }
    if (attempt >= timing.recordRetryMs.length) {
      this.state.stream = 'ended';
      this.state.ended = 'unplaced';
      this.publish();
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
    const mine = () => this.#token === token && this.#running;
    let first = true; // this subscription's first `subbed`
    const carried = this.#cursor !== null;
    const sink: SubscriptionSink = {
      subbed: (mode, at) => {
        if (!mine()) return;
        this.#flush();
        const gap = first ? mode === 'missing' && carried : mode !== 'replay';
        first = false;
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
        this.publish();
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
        if (!read.ok) return this.#deps.log(`lane B: ${this.link.name}/${this.state.app}: an event at ${at.epoch}:${at.seq}:${at.idx ?? ''} doesn't read; left out`);
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
        if (reason === 'removed' || reason === 'closed') return this.stop(reason);
        this.state.status = null;
        if (reason !== 'unavailable') {
          this.state.stream = 'ended';
          this.state.ended = reason;
          this.publish();
          return;
        }
        this.state.stream = 'idle';
        this.publish();
        this.#later(() => this.#subscribe());
      },
    };
    this.#sub = this.link.subscribe({ session: { lane: 'B', id: this.state.app }, view: 'full', cursor: this.#cursor }, sink);
  }

  /** The replace-whole parts of a snapshot, the status first. */
  #parts(launchId: string, value: unknown): void {
    if (!isObject(value)) return;
    const app = this.state.app;
    if (isObject(value.status)) {
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
        if (read.ok && WAITING.has(read.value.state)) items.push(read.value);
      }
      this.#lastParts.items = items;
      this.#emit('attention.changed', { appSessionId: app, items });
    }
  }

  /** A payload read as this build reads it, then emitted for the machine; one that doesn't read is left out, logged. */
  #emit(name: EventName, payload: unknown): void {
    const read = events.readEventPayload(name, payload);
    if (!read.ok) return this.#deps.log(`lane B: ${this.link.name}/${this.state.app}: ${name} doesn't read; left out`);
    this.#deps.emit(this.state.machine, name, read.value as never);
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

  /** Runs `again` on the idle backoff, doubling up to its cap. */
  #later(again: () => void): void {
    const delay = this.#backoffMs;
    this.#backoffMs = Math.min(this.#backoffMs * 2, this.#deps.timing.idleRetryMs[1]);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (this.#running) again();
    }, delay);
  }

  /** Every timer, subscription and wait of the run before. */
  #halt(): void {
    this.#token = {};
    this.#pendingGap = null; // the next subscription's opening from the cursor says it again
    if (this.#sub !== null) this.#cursor = this.#sub.cursor() ?? this.#cursor;
    this.#sub?.close();
    this.#sub = null;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#flush();
    for (const waiter of [...this.#waiters]) waiter();
  }
}
