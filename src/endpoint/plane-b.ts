// Lane B's subscriptions (O10 M8; RL3): the cursor is the engine host's, and names an event, not a row. Its epoch is the
// launch (`launchId`), its `seq` the journal row and its `idx` the event's index within the row (its id's last
// component, `<appSessionId>:<launchId>:<seq>:<i>`). One row yields several events under one `seq`, and live batches
// are cut by time, count and bytes rather than at rows, so a channel can drop between two events of one row; the stream
// therefore goes event by event, each `ev` at its own `(epoch, seq, idx)`, strictly rising.
//
// A subscription is answered from the engine host's journal (`session.events`, which returns whole rows after
// `afterSeq`): a cursor on the current launch reads from its own row (`afterSeq: seq - 1`) and drops that row's events at
// or below `idx`; it is a `replay` when that row is still there, else `missing` (the rows are gone from the journal). A
// cursor on another launch, or none, is a `snapshot`. `replay` goes on after the cursor; `snapshot` and `missing` go on
// from the launch's first event (`seq` 0): lane B has no other copy of the transcript a remote viewer could start from,
// as DX4's lane A snapshot carries its rows. Every answer carries the session's replace-whole state, which changes
// outside the journal's sequence: `snap {status, queue, pendingItems, catalog}`, read under a hold of the session's live
// events, and a live replace-whole event that came while those reads were in flight is read once more after them, so
// an older read never overwrites a newer change. Later replace-whole events go on as `snap`s of their part.
//
// The events reach the device through one rule: what the journal holds is read in pages while the device's credit
// keeps the unsent stream under the backlog ("catching up"), and once a read reaches the end the live events take over,
// each after the last one sent. Live events that come while a read is in flight are held, and kept only if the read
// reached the end. So a stream whose device stops granting credit just stops taking live events, and reads them from the
// journal when credit comes back: nothing lost, nothing twice.
//
// Live events come from `onEvent`, which until O3 delivers lane B events only while an app is attached (O2's seam: none
// is when the endpoint starts, and `onAttachment` says each change). With no app, a subscription is `paused {reason:
// 'no-app'}`; when one attaches, each catches up from its cursor and its state is read again, as a resume does, then
// `resumed`. A live event or status of another launch (the session launched again) moves the subscription to a snapshot
// of the new launch, announced by a new `subbed`.
//
// A `cards` subscription carries only the session's pending requests: each broker item that stands for a pending request,
// hydrated with its originating request (`session.pendingRequest`: the tool and input, or the question and its choices)
// and what an answer needs, its context (`launchId`, `engineSessionId`, null until the engine said it) and its request
// digest (`requestDigestOf`, the one lane B rule), as `snap {pendingItems: [{item, request, context, requestDigest}]}`.
// It never carries an event, the queue, the catalog or the status; every subscription and resume of it is a snapshot.
import type { SessionEvent } from '@shared/graph/events';
import { requestDigestOf } from '@shared/host/request-digest';
import type { EndpointServices } from './services';
import type { Mode, Plane, Position, Subscription } from './subscriptions';

export const BACKLOG_BYTES = 2 * 1024 * 1024;
/** Events per journal read. */
export const PAGE_EVENTS = 500;
/** Rounds of reading again a replace-whole part that changed during the read before it. */
const SETTLE_ROUNDS = 5;

type Part = 'status' | 'queue' | 'pendingItems' | 'catalog';
const READS: Record<Part, string> = { status: 'session.status', queue: 'session.queue.list', pendingItems: 'session.pendingItems', catalog: 'session.catalog' };
const PARTS: readonly Part[] = ['status', 'queue', 'pendingItems', 'catalog'];

/** A position within a launch: a row, and an event's index within it (`idx` -1: before the row's first). */
type At = { seq: number; idx: number };
const after = (a: At, b: At): boolean => a.seq > b.seq || (a.seq === b.seq && a.idx > b.idx);
const START: At = { seq: 0, idx: -1 };

export type PlaneBContext = {
  dispatch: EndpointServices['dispatch'];
  log(line: string): void;
  backlogBytes?: number;
};

type Card = { item: unknown; request: SessionEvent; context: { launchId: string; engineSessionId: string | null }; requestDigest: unknown };

class Stream {
  epoch: string | null = null;
  engine: string | null = null;
  /** The last event put in the stream. */
  queued: At = START;
  /** Reading the journal from `queued` (no live event is taken meanwhile). */
  catching = false;
  reading = false;
  /** The next read starts after `queued`'s row (it was a whole page, all of it sent). */
  pastRow = false;
  /** Live events held while a read is in flight, and live replace-whole parts that changed meanwhile. */
  holdEvents = false;
  holdState = false;
  held: SessionEvent[] = [];
  readonly dirty = new Set<Part>();
  /** `subbed` went: a later open is quiet unless it starts the stream over. */
  answered = false;
  /** Bumped by each (re)open: a flow that finds it moved stops. */
  gen = 0;
  opening = false;
  hydration = 0;
  constructor(
    readonly sub: Subscription,
    readonly app: string,
  ) {}
}

export class PlaneB implements Plane {
  readonly #ctx: PlaneBContext;
  readonly #streams = new Map<Subscription, Stream>();
  #attached = false;

  constructor(ctx: PlaneBContext) {
    this.#ctx = ctx;
  }

  get #backlog(): number {
    return this.#ctx.backlogBytes ?? BACKLOG_BYTES;
  }

  open(sub: Subscription): void {
    const stream = new Stream(sub, sub.session.id);
    this.#streams.set(sub, stream);
    sub.onCredit = () => void this.#pump(stream);
    void this.#open(stream, 'sub');
  }

  close(sub: Subscription): void {
    const stream = this.#streams.get(sub);
    if (stream === undefined) return;
    stream.gen++;
    sub.onCredit = null;
    this.#streams.delete(sub);
  }

  stop(): void {
    for (const sub of [...this.#streams.keys()]) this.close(sub);
  }

  /** An app attached to the engine host, or left (`onAttachment`). */
  attachment(attached: boolean): void {
    if (attached === this.#attached) return;
    this.#attached = attached;
    for (const stream of this.#streams.values()) {
      if (attached) void this.#open(stream, 'resume');
      else stream.sub.control({ t: 'paused', sub: stream.sub.id, reason: 'no-app' });
    }
  }

  /** A live engine-host event (`onEvent`). */
  event(owner: string, message: { name: string; payload: unknown }): void {
    if (owner !== 'engine-host' || typeof message.payload !== 'object' || message.payload === null) return;
    const payload = message.payload as Record<string, unknown>;
    if (typeof payload.appSessionId !== 'string') return;
    for (const stream of this.#streams.values()) if (stream.app === payload.appSessionId) this.#live(stream, message.name, payload);
  }

  // ---- Opening ------------------------------------------------------------------------------------------------------

  /**
   * Answers the subscription (`sub`: its cursor), catches up after an app attached (`resume`), or starts over on the
   * launch the session runs now (`relaunch`; `missing` when the journal lost rows the stream needed).
   */
  async #open(stream: Stream, how: 'sub' | 'resume' | 'relaunch' | 'missing'): Promise<void> {
    // An app that attached before the subscription was answered: it is answered as asked.
    if (how === 'resume' && !stream.answered) how = 'sub';
    const gen = ++stream.gen;
    const { sub } = stream;
    stream.opening = true;
    stream.holdEvents = true;
    stream.holdState = true;
    stream.held = [];
    stream.dirty.clear();
    stream.catching = false;
    stream.reading = false;
    stream.pastRow = false;
    const read = await this.#read(stream, 'status');
    if (gen !== stream.gen) return;
    if (read === undefined || Array.isArray(read)) return sub.end('unavailable');
    const status = read;
    const launch = String(status.launchId);
    const relaunched = stream.epoch !== null && stream.epoch !== launch;
    stream.epoch = launch;
    stream.engine = typeof status.engineSessionId === 'string' ? status.engineSessionId : null;
    if (sub.view === 'cards') return this.#openCards(stream, gen, how === 'resume' && !relaunched);

    let mode: Mode = how === 'missing' ? 'missing' : 'snapshot';
    let first: { events: SessionEvent[]; complete: boolean } | null = null;
    let from: At = START;
    if (how === 'resume' && !relaunched) {
      mode = 'replay';
      from = stream.queued;
    } else if (how === 'sub' && sub.cursor !== null && sub.cursor.epoch === launch) {
      const cursor: At = { seq: sub.cursor.seq, idx: sub.cursor.idx ?? -1 };
      if (cursor.seq === 0) mode = 'replay';
      else {
        const page = await this.#events(stream, cursor.seq - 1);
        if (gen !== stream.gen) return;
        if (page === undefined) return sub.end('unavailable');
        // The cursor's own row is still in the journal: what follows it is whole.
        if (page.events[0]?.seq === cursor.seq) {
          mode = 'replay';
          from = cursor;
          first = page;
        } else mode = 'missing';
      }
    }
    stream.queued = from;
    const state = await this.#readParts(stream, ['queue', 'pendingItems', 'catalog']);
    if (gen !== stream.gen) return;
    if (how !== 'resume' || relaunched) {
      sub.subbed(mode, this.#at(stream));
      stream.answered = true;
    }
    sub.snap(this.#at(stream), { status, ...state });
    stream.catching = true;
    if (first !== null) {
      for (const event of first.events) this.#send(stream, event);
      stream.catching = !first.complete;
    }
    if (!(await this.#settle(stream, gen))) return;
    this.#release(stream);
    if (how === 'resume') sub.control({ t: 'resumed', sub: sub.id });
    else if (!this.#attached) sub.control({ t: 'paused', sub: sub.id, reason: 'no-app' });
    void this.#pump(stream);
  }

  /** A `cards` subscription's snapshot: the pending requests, hydrated. */
  async #openCards(stream: Stream, gen: number, resumed: boolean): Promise<void> {
    const { sub } = stream;
    const items = await this.#read(stream, 'pendingItems');
    if (gen !== stream.gen) return;
    const cards = await this.#hydrate(stream, Array.isArray(items) ? items : []);
    if (gen !== stream.gen) return;
    if (!resumed) {
      sub.subbed('snapshot', this.#at(stream));
      stream.answered = true;
    }
    sub.snap(this.#at(stream), { pendingItems: cards });
    if (!(await this.#settle(stream, gen))) return;
    this.#release(stream);
    if (resumed) sub.control({ t: 'resumed', sub: sub.id });
    else if (!this.#attached) sub.control({ t: 'paused', sub: sub.id, reason: 'no-app' });
  }

  /**
   * Reads again what changed while the state was read (a live replace-whole event came), until a round sees no change;
   * false when the flow was taken over or the session launched again (which starts over).
   */
  async #settle(stream: Stream, gen: number): Promise<boolean> {
    for (let round = 0; round < SETTLE_ROUNDS && stream.dirty.size > 0; round++) {
      const parts = PARTS.filter((p) => stream.dirty.has(p));
      stream.dirty.clear();
      const values = await this.#readParts(stream, parts);
      if (gen !== stream.gen) return false;
      const status = values.status as { launchId?: unknown; engineSessionId?: unknown } | undefined;
      if (status !== undefined && status.launchId !== stream.epoch) {
        void this.#open(stream, 'relaunch');
        return false;
      }
      this.#state(stream, values);
    }
    if (stream.dirty.size > 0) this.#ctx.log(`endpoint: a lane B subscription's state kept changing while it was read; it goes on with the live changes`);
    return true;
  }

  /** The hold ends: what came live meanwhile goes on (events only if no catch-up is due), the launch checked. */
  #release(stream: Stream): void {
    const held = stream.held;
    stream.held = [];
    stream.holdEvents = false;
    stream.holdState = false;
    stream.opening = false;
    for (const event of held) {
      if (this.#otherLaunch(stream, event)) return void this.#open(stream, 'relaunch');
      if (!stream.catching) this.#take(stream, event);
    }
  }

  // ---- Live ---------------------------------------------------------------------------------------------------------

  #live(stream: Stream, name: string, payload: Record<string, unknown>): void {
    if (stream.sub.ended) return;
    if (name === 'session.eventBatch') {
      if (stream.sub.view === 'cards' || !Array.isArray(payload.events)) return;
      for (const event of payload.events as SessionEvent[]) {
        if (stream.holdEvents) stream.held.push(event);
        else if (this.#otherLaunch(stream, event)) return void this.#open(stream, 'relaunch');
        else if (!stream.catching) this.#take(stream, event);
      }
      return;
    }
    const part = partOf(name, payload);
    if (part === null) return;
    if (part.part === 'status') {
      const status = part.value as { launchId?: unknown; engineSessionId?: unknown };
      if (!stream.opening && status.launchId !== stream.epoch) return void this.#open(stream, 'relaunch');
      if (stream.sub.view === 'cards') {
        // The context an answer needs moved (the engine said its id, a `/clear`): the cards are hydrated again.
        const engine = typeof status.engineSessionId === 'string' ? status.engineSessionId : null;
        if (engine === stream.engine) return;
        stream.engine = engine;
        if (stream.holdState) return void stream.dirty.add('pendingItems');
        return void this.#rehydrate(stream);
      }
    }
    if (stream.sub.view === 'cards' && part.part !== 'pendingItems') return;
    if (stream.holdState) return void stream.dirty.add(part.part);
    if (stream.sub.view === 'cards') return void this.#rehydrate(stream, part.value);
    this.#state(stream, { [part.part]: part.value });
  }

  /** Replace-whole parts at the stream's position (`cards`: its pending items, hydrated). */
  #state(stream: Stream, values: Partial<Record<Part, unknown>>): void {
    if (stream.sub.view === 'cards') {
      if (values.pendingItems !== undefined) void this.#rehydrate(stream, values.pendingItems);
      return;
    }
    if (Object.keys(values).length > 0) stream.sub.snap(this.#at(stream), values);
  }

  async #rehydrate(stream: Stream, items?: unknown): Promise<void> {
    const n = ++stream.hydration;
    const gen = stream.gen;
    const list = items ?? (await this.#read(stream, 'pendingItems'));
    if (n !== stream.hydration || gen !== stream.gen) return;
    const cards = await this.#hydrate(stream, Array.isArray(list) ? list : []);
    if (n !== stream.hydration || gen !== stream.gen || stream.sub.ended) return;
    stream.sub.snap(this.#at(stream), { pendingItems: cards });
  }

  /** Each broker item that stands for a pending request, with the request, its context and its digest. */
  async #hydrate(stream: Stream, items: readonly unknown[]): Promise<Card[]> {
    const cards: Card[] = [];
    for (const item of items) {
      const requestId = (item as { request?: { requestId?: unknown } } | null)?.request?.requestId;
      if (typeof requestId !== 'string') continue;
      let response;
      try {
        response = await this.#ctx.dispatch('engine-host', 'session.pendingRequest', { appSessionId: stream.app, requestId });
      } catch {
        continue;
      }
      const event = response.ok ? (response.value as { event?: SessionEvent | null }).event : null;
      if (event === null || event === undefined) continue;
      cards.push({ item, request: event, context: { launchId: stream.epoch ?? '', engineSessionId: stream.engine }, requestDigest: requestDigestOf(stream.app, event) });
    }
    return cards;
  }

  // ---- Events -------------------------------------------------------------------------------------------------------

  /** A live event after the last one sent: sent, unless the unsent stream is full, which starts a catch-up. */
  #take(stream: Stream, event: SessionEvent): void {
    const at = this.#cursor(stream, event);
    if (at === null || !after(at, stream.queued)) return;
    if (stream.sub.backlog > this.#backlog) {
      stream.catching = true;
      return;
    }
    this.#send(stream, event);
  }

  #send(stream: Stream, event: SessionEvent): void {
    const at = this.#cursor(stream, event);
    if (at === null || !after(at, stream.queued)) return;
    stream.sub.ev({ epoch: stream.epoch!, seq: at.seq, idx: at.idx }, event);
    stream.queued = at;
  }

  /** Reads the journal on from the last event sent, a page at a time while the unsent stream is under half the backlog. */
  async #pump(stream: Stream): Promise<void> {
    if (!stream.catching || stream.reading || stream.holdEvents || stream.sub.ended || stream.sub.backlog > this.#backlog / 2) return;
    const gen = stream.gen;
    stream.reading = true;
    stream.holdEvents = true;
    stream.held = [];
    const from = stream.queued;
    const pastRow = stream.pastRow;
    const page = await this.#events(stream, from.seq === 0 ? null : pastRow ? from.seq : from.seq - 1);
    if (gen !== stream.gen) return;
    stream.reading = false;
    if (page === undefined) {
      stream.holdEvents = false;
      return stream.sub.end('unavailable');
    }
    // The row the stream stands in must still be there, or rows it needs are gone from the journal.
    if (from.seq > 0 && !pastRow && page.events[0]?.seq !== from.seq) {
      stream.holdEvents = false;
      return void this.#open(stream, 'missing');
    }
    for (const event of page.events) {
      if (this.#otherLaunch(stream, event)) {
        stream.holdEvents = false;
        return void this.#open(stream, 'relaunch');
      }
      this.#send(stream, event);
    }
    const moved = after(stream.queued, from);
    stream.pastRow = !page.complete && !moved;
    if (page.complete || page.events.length === 0) stream.catching = false;
    this.#release(stream);
    void this.#pump(stream);
  }

  // ---- Reads --------------------------------------------------------------------------------------------------------

  async #read(stream: Stream, part: Part): Promise<Record<string, unknown> | unknown[] | undefined> {
    let response;
    try {
      response = await this.#ctx.dispatch('engine-host', READS[part], { appSessionId: stream.app });
    } catch (error) {
      this.#ctx.log(`endpoint: a lane B subscription's ${READS[part]} could not be read: ${(error as Error).message}`);
      return undefined;
    }
    if (!response.ok) return undefined;
    const value = response.value as Record<string, unknown>;
    return part === 'pendingItems' ? (Array.isArray(value?.items) ? value.items : []) : value;
  }

  async #readParts(stream: Stream, parts: readonly Part[]): Promise<Partial<Record<Part, unknown>>> {
    const values = await Promise.all(parts.map((part) => this.#read(stream, part)));
    const out: Partial<Record<Part, unknown>> = {};
    parts.forEach((part, i) => {
      if (values[i] !== undefined) out[part] = values[i];
    });
    return out;
  }

  async #events(stream: Stream, afterSeq: number | null): Promise<{ events: SessionEvent[]; complete: boolean } | undefined> {
    let response;
    try {
      response = await this.#ctx.dispatch('engine-host', 'session.events', { appSessionId: stream.app, afterSeq, limit: PAGE_EVENTS });
    } catch {
      return undefined;
    }
    if (!response.ok) return undefined;
    const value = response.value as { events?: unknown; complete?: unknown };
    // Events with no `seq` are the transcript's from disk (no launch here): none of them is the stream's.
    const events = Array.isArray(value.events) ? (value.events as SessionEvent[]).filter((e) => typeof e?.seq === 'number') : [];
    return { events, complete: value.complete === true };
  }

  // ---- Cursors ------------------------------------------------------------------------------------------------------

  #at(stream: Stream): Position {
    return { epoch: stream.epoch ?? '', seq: stream.queued.seq, ...(stream.queued.idx >= 0 ? { idx: stream.queued.idx } : {}) };
  }

  /** An event's place in its launch, from its id (`<appSessionId>:<launchId>:<seq>:<i>`); null for one not of a launch. */
  #cursor(stream: Stream, event: SessionEvent): At | null {
    const parsed = parse(stream.app, event);
    return parsed === null || parsed.launch !== stream.epoch ? null : { seq: parsed.seq, idx: parsed.idx };
  }

  /** An event of a launch other than the stream's: the session was launched again. */
  #otherLaunch(stream: Stream, event: SessionEvent): boolean {
    const launch = parse(stream.app, event)?.launch;
    return launch !== undefined && launch !== stream.epoch;
  }
}

/** An event's launch, row and index within the row, read from its id; null for an event of no launch. */
function parse(app: string, event: SessionEvent): { launch: string; seq: number; idx: number } | null {
  const prefix = `${app}:`;
  if (typeof event?.id !== 'string' || typeof event.seq !== 'number' || !event.id.startsWith(prefix)) return null;
  const rest = event.id.slice(prefix.length);
  const i = rest.lastIndexOf(':');
  const s = i > 0 ? rest.lastIndexOf(':', i - 1) : -1;
  if (s <= 0) return null;
  const seq = Number(rest.slice(s + 1, i));
  const idx = Number(rest.slice(i + 1));
  if (seq !== event.seq || !Number.isSafeInteger(idx) || idx < 0) return null;
  return { launch: rest.slice(0, s), seq, idx };
}

/** A live replace-whole event as the part it replaces. */
function partOf(name: string, payload: Record<string, unknown>): { part: Part; value: unknown } | null {
  switch (name) {
    case 'session.status':
      return { part: 'status', value: payload.status };
    case 'session.queue': {
      const queue = { ...payload };
      delete queue.appSessionId;
      return { part: 'queue', value: queue };
    }
    case 'session.brokerItems':
      return Array.isArray(payload.items) ? { part: 'pendingItems', value: payload.items } : null;
    case 'session.catalogChanged':
      return { part: 'catalog', value: payload.catalog };
    default:
      return null;
  }
}
