// A session's stream from a cursor (P5 O3-D M4; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §C;
// lifted from O10 M8's lane B plane, src/endpoint/plane-b.ts, which owns its rules' history): one module for every reader
// of the engine host's session events that keeps its own cursor, the endpoint's lane B subscriptions (plane-b.ts, each
// stream `from: 'start'`) and the clients of `mawsd`'s services front (src/mawsd/front-streams.ts, `from: 'now'`).
//
// The cursor is the engine host's, and names an event, not a row (RL3). Its epoch is the launch (`launchId`), its `seq`
// the journal row and its `idx` the event's index within the row (its id's last component,
// `<appSessionId>:<launchId>:<seq>:<i>`). One row yields several events under one `seq`, and live batches are cut by
// time, count and bytes rather than at rows, so a reader can drop between two events of one row; the stream therefore
// goes event by event, each at its own `(epoch, seq, idx)`, strictly rising.
//
// An opening is answered from the engine host's journal (`session.events`, which returns whole rows after `afterSeq`,
// from its ring or, for a range the ring dropped, its journal; when the journal can't be read back, from the ring alone,
// marked `historyUnavailable`, which may begin inside a row, since the ring drops events, not rows). A cursor on the
// current launch reads from its own row (`afterSeq: seq - 1`); it is a `replay` only when what comes back goes on from
// the cursor without a gap (its first event in the cursor's row, no later than the one after the cursor), else
// `missing`; one at the launch's start (`seq` 0: a snapshot and no event since) replays from the launch's first event
// when it is all there. A cursor on another launch, or none, is a `snapshot`, or `missing` when what the stream needs is
// gone (`historyUnavailable`); a later read, a page after a whole row or a re-open's read from the start, is `missing` on
// the same mark unless the reader was already told so.
//
// Where a `snapshot` or a `missing` stream goes on is the stream's `from`: `start`, from the launch's first event (lane B
// has no other copy of the transcript a remote viewer could start from); `now`, from the launch's last journaled row
// (the status's `lastEventSeq`, that row's events included, since its live batch may still be on its way), for a reader
// that reads the journal itself on demand (the app). A launch that begins while the stream runs (a relaunch, or a
// session not live at the opening) always goes on from its first event, whatever `from` says: the reader holds nothing
// of it. Every opening carries the session's replace-whole state, which changes outside the journal's sequence: `status,
// queue, pendingItems, catalog`, the status first, read under a hold of the session's live events, and a live
// replace-whole event that came while those reads were in flight is read once more after them, so an older read never
// overwrites a newer change; when it keeps changing through every re-read, the last value it published stands. Later
// replace-whole events go on as parts of their own.
//
// The events reach the reader through one rule: what the journal holds is read in pages while the reader's unsent
// backlog stays under the bound ("catching up"), and once a read reaches the end the live events take over, each after
// the last one sent. A page ends on a whole row, so the next goes on after its last row (`afterSeq`: that row), as the
// engine host pages its journal; only a stream standing inside a row (a live batch cut it) reads that row again, and
// checks it goes on without a gap. Live events that come while a read is in flight are held, up to the backlog, and kept
// only if the read reached the end; past the backlog they are dropped and read from the journal. So a reader that stops
// taking just stops taking live events, and reads them from the journal when it has room again: nothing lost, nothing
// twice.
//
// Live events come from the owner's feed (`liveEvent`). Whether they are available at all is the owner's to say
// (`available`): while they are not (O2's recycle per app attachment, with no app), each stream is told `paused`, and
// once they are, each catches up from its cursor and its state is read again, then `resumed`. Under `mawsd`'s permanent
// link they stay available, but the link itself can drop and come back with both processes alive, and what the engine
// host wrote to the socket that closed counts as delivered on its side (D41): so at each streaming of the engine-host
// link (`relinked`) every open stream catches up from its cursor the same way, quietly. A read that fails ends the stream
// for its reader (`end('unavailable')`); a reader that keeps it (the front) has it catch up at the next relink, and a
// live status or event of a new launch opens that launch. A live event or status of another launch (the session
// launched again), during an opening too, moves the stream to a snapshot of the new launch, announced by a new `subbed`.
//
// A `cards` stream (lane B's phone view) carries only the session's pending requests: each broker item that stands for a
// pending request, hydrated with its originating request (`session.pendingRequest`: the tool and input, or the question
// and its choices) and what an answer needs, its context (`launchId`, `engineSessionId`, null until the engine said it)
// and its request digest (`requestDigestOf`, the one lane B rule), as `{pendingItems: [{item, request, context,
// requestDigest}]}`. It never carries an event, the queue, the catalog or the status; every opening of it is a snapshot.
import type { SessionEvent } from '../graph/events';
import { requestDigestOf } from './request-digest';

export const BACKLOG_BYTES = 2 * 1024 * 1024;
/** Events per journal read. */
export const PAGE_EVENTS = 500;
/** Rounds of reading again a replace-whole part that changed during the read before it. */
const SETTLE_ROUNDS = 5;

/** The replace-whole parts of a session, in the order an opening sends them (the status first). */
export type StreamPart = 'status' | 'queue' | 'pendingItems' | 'catalog';
export const STREAM_PARTS: readonly StreamPart[] = ['status', 'queue', 'pendingItems', 'catalog'];
const READS: Record<StreamPart, string> = { status: 'session.status', queue: 'session.queue.list', pendingItems: 'session.pendingItems', catalog: 'session.catalog' };

export type StreamMode = 'replay' | 'snapshot' | 'missing';
/** Where a stream stands: `(launchId, seq, idx)`, `idx` absent before the row's first event. */
export type StreamPosition = { epoch: string; seq: number; idx?: number };
export type StreamFrom = 'start' | 'now';

/** What a stream sends to its reader, in order. */
export interface StreamSink {
  /** Over for its reader: nothing more is sent, and no read is made for it. */
  readonly ended: boolean;
  /** The bytes sent and not yet taken by the reader; past the bound the stream reads the journal instead. */
  readonly backlog: number;
  /** An opening answered: the mode, and the position the stream goes on after. */
  subbed(mode: StreamMode, at: StreamPosition): void;
  /** Replace-whole state at `at`: the opening's parts together (`state`), a live part alone, or a cards set (`cards`). */
  snap(at: StreamPosition, values: Partial<Record<StreamPart, unknown>>, kind: StreamPart | 'state' | 'cards'): void;
  /** One event, at its own position. */
  ev(at: StreamPosition, event: SessionEvent): void;
  /** Live events stopped being available; `resumed` once they are again and the stream caught up. */
  paused(): void;
  resumed(): void;
  /** A read the stream needs failed. */
  end(reason: 'unavailable'): void;
}

/** A read of the engine host: its answer, or a refusal; a throw is a read that could not be made. */
export type StreamRead = (name: string, input: Record<string, unknown>) => Promise<{ ok: true; value: unknown } | { ok: false }>;

export interface SessionStreamsOptions {
  read: StreamRead;
  log(line: string): void;
  backlogBytes?: number;
  /** Whether live events are available when the streams start (`available` says each change). */
  available: boolean;
}

export interface OpenStream {
  /** The session's appSessionId. */
  app: string;
  /** The reader's cursor, null for none. */
  cursor: StreamPosition | null;
  view: 'full' | 'cards';
  from: StreamFrom;
}

/** An open stream, as its owner holds it. */
export interface StreamHandle {
  readonly app: string;
}

/** A position within a launch: a row, and an event's index within it (`idx` -1: before the row's first). */
type At = { seq: number; idx: number };
const after = (a: At, b: At): boolean => a.seq > b.seq || (a.seq === b.seq && a.idx > b.idx);
const START: At = { seq: 0, idx: -1 };

/** A `session.events` answer: whole rows; `historyUnavailable` when part of the range asked for is gone. */
type Page = { events: SessionEvent[]; complete: boolean; historyUnavailable?: true };

type Card = { item: unknown; request: SessionEvent; context: { launchId: string; engineSessionId: string | null }; requestDigest: unknown };

/** Why an opening runs: the reader's opening, availability back, the link back, a new launch, or a gap found. */
type How = 'open' | 'resume' | 'relink' | 'relaunch' | 'missing';

class Stream implements StreamHandle {
  epoch: string | null = null;
  engine: string | null = null;
  /** The last event put in the stream. */
  queued: At = START;
  /** Reading the journal from `queued` (no live event is taken meanwhile). */
  catching = false;
  reading = false;
  /** The next read starts after `queued`'s row (it was a whole page, all of it sent). */
  pastRow = false;
  /** Live events held while a read is in flight (past the backlog: none, `overflow`), and replace-whole parts that changed meanwhile, with the last value each published. */
  holdEvents = false;
  holdState = false;
  held: SessionEvent[] = [];
  heldBytes = 0;
  overflow = false;
  readonly dirty = new Set<StreamPart>();
  readonly latest = new Map<StreamPart, unknown>();
  /** `subbed` went: a later opening is quiet unless it starts the stream over. */
  answered = false;
  /** The reader was told `missing` for this stream: what the launch's start lacks is announced, so a read of it stands. */
  lost = false;
  /** `paused` went and no `resumed` since. */
  paused = false;
  /** Bumped by each (re)open: a flow that finds it moved stops. */
  gen = 0;
  hydration = 0;
  closed = false;
  constructor(
    readonly sink: StreamSink,
    readonly app: string,
    readonly view: 'full' | 'cards',
    readonly cursor: StreamPosition | null,
    readonly from: StreamFrom,
  ) {}
}

export class SessionStreams {
  readonly #options: SessionStreamsOptions;
  readonly #streams = new Set<Stream>();
  #available: boolean;

  constructor(options: SessionStreamsOptions) {
    this.#options = options;
    this.#available = options.available;
  }

  get #backlog(): number {
    return this.#options.backlogBytes ?? BACKLOG_BYTES;
  }

  /** A stream of `request.app` for `sink`: answered (`subbed`, or `end`), then streamed. */
  openStream(request: OpenStream, sink: StreamSink): StreamHandle {
    const stream = new Stream(sink, request.app, request.view, request.cursor, request.from);
    this.#streams.add(stream);
    void this.#open(stream, 'open');
    return stream;
  }

  /** The stream is over: nothing more is read or sent for it. */
  closeStream(handle: StreamHandle): void {
    const stream = handle as Stream;
    if (!this.#streams.delete(stream)) return;
    stream.gen++;
    stream.closed = true;
  }

  /** Room to send more (the reader took some of its backlog): the journal reads on. */
  room(handle: StreamHandle): void {
    const stream = handle as Stream;
    if (!stream.closed) void this.#pump(stream);
  }

  stop(): void {
    for (const stream of [...this.#streams]) this.closeStream(stream);
  }

  /** Whether live events are available: while not, every stream is paused; once they are, each catches up and resumes. */
  available(available: boolean): void {
    if (available === this.#available) return;
    this.#available = available;
    for (const stream of this.#streams) {
      if (available) void this.#open(stream, 'resume');
      else {
        stream.paused = true;
        stream.sink.paused();
      }
    }
  }

  /** The engine-host link streams again (D41): every open stream catches up from its cursor, quietly. */
  relinked(): void {
    if (!this.#available) return; // availability's own return catches them up
    for (const stream of this.#streams) void this.#open(stream, 'relink');
  }

  /** A live engine-host event: to every stream of the session it names. */
  liveEvent(name: string, payload: unknown): void {
    if (typeof payload !== 'object' || payload === null) return;
    const record = payload as Record<string, unknown>;
    if (typeof record.appSessionId !== 'string') return;
    for (const stream of this.#streams) if (stream.app === record.appSessionId) this.#live(stream, name, record);
  }

  // ---- Opening ------------------------------------------------------------------------------------------------------

  /**
   * Answers the reader's opening (its cursor), catches up after events came back or the link did (`resume`, `relink`),
   * or starts over on the launch the session runs now (`relaunch`; `missing` when the journal lost rows the stream
   * needed).
   */
  async #open(stream: Stream, how: How): Promise<void> {
    // A catch-up before the opening was answered: it is answered as asked.
    if ((how === 'resume' || how === 'relink') && !stream.answered) how = 'open';
    const gen = ++stream.gen;
    const { sink } = stream;
    const pastRow = stream.pastRow;
    stream.holdEvents = true;
    stream.holdState = true;
    this.#unhold(stream);
    stream.dirty.clear();
    stream.latest.clear();
    stream.catching = false;
    stream.reading = false;
    stream.pastRow = false;
    const read = await this.#read(stream, 'status');
    if (gen !== stream.gen) return;
    if (read === undefined || Array.isArray(read)) return this.#fail(stream);
    const status = read;
    const launch = String(status.launchId);
    const relaunched = stream.epoch !== null && stream.epoch !== launch;
    const catchUp = (how === 'resume' || how === 'relink') && !relaunched;
    // A launch begun while the stream ran goes on from its first event, whatever `from` says.
    const from: StreamFrom = how === 'relaunch' || relaunched ? 'start' : stream.from;
    stream.epoch = launch;
    stream.engine = engineOf(status);
    if (stream.view === 'cards') return this.#openCards(stream, gen, catchUp);

    let mode: StreamMode = how === 'missing' ? 'missing' : 'snapshot';
    let first: Page | null = null;
    let at: At = START;
    let fromStart = false;
    let now = false;
    if (catchUp) {
      mode = 'replay';
      at = stream.queued;
      stream.pastRow = pastRow;
    } else if (how === 'open' && stream.cursor !== null && stream.cursor.epoch === launch) {
      const cursor: At = { seq: stream.cursor.seq, idx: stream.cursor.idx ?? -1 };
      // A cursor at the launch's start (a snapshot with no event since) replays from it if the start is all there.
      if (cursor.seq === 0) fromStart = true;
      else {
        const page = await this.#events(stream, cursor.seq - 1);
        if (gen !== stream.gen) return;
        if (page === undefined) return this.#fail(stream);
        if (this.#continues(stream, page, cursor)) {
          mode = 'replay';
          at = cursor;
          first = page;
        } else mode = 'missing';
      }
    }
    if (mode !== 'replay') {
      if (from === 'now' && !fromStart) {
        // From the launch's last journaled row, with no read: the reader reads what is before it on demand.
        const last = typeof status.lastEventSeq === 'number' && Number.isSafeInteger(status.lastEventSeq) ? status.lastEventSeq : 0;
        at = { seq: Math.max(0, last), idx: -1 };
        now = true;
      } else {
        // From the launch's first event; one whose start is gone from the journal is `missing`, not a snapshot.
        const page = await this.#events(stream, null);
        if (gen !== stream.gen) return;
        if (page === undefined) return this.#fail(stream);
        if (!this.#gapless(page)) mode = 'missing';
        else if (fromStart) mode = 'replay';
        first = page;
      }
    }
    stream.queued = at;
    const state = await this.#readParts(stream, ['queue', 'pendingItems', 'catalog']);
    if (gen !== stream.gen) return;
    if (!catchUp) {
      sink.subbed(mode, this.#at(stream));
      stream.answered = true;
      stream.lost = mode === 'missing';
    }
    sink.snap(this.#at(stream), { status, ...state }, 'state');
    stream.catching = true;
    if (first !== null) {
      for (const event of first.events) this.#send(stream, event);
      if (first.events.length > 0) stream.pastRow = true;
      stream.catching = !first.complete;
    } else if (now) stream.catching = false; // live from here; a later catch-up reads on from `queued`
    if (!(await this.#settle(stream, gen))) return;
    this.#release(stream);
    this.#announce(stream);
    void this.#pump(stream);
  }

  /** A `cards` stream's snapshot: the pending requests, hydrated. */
  async #openCards(stream: Stream, gen: number, catchUp: boolean): Promise<void> {
    const { sink } = stream;
    const items = await this.#read(stream, 'pendingItems');
    if (gen !== stream.gen) return;
    const cards = await this.#hydrate(stream, Array.isArray(items) ? items : []);
    if (gen !== stream.gen) return;
    if (!catchUp) {
      sink.subbed('snapshot', this.#at(stream));
      stream.answered = true;
    }
    sink.snap(this.#at(stream), { pendingItems: cards }, 'cards');
    if (!(await this.#settle(stream, gen))) return;
    this.#release(stream);
    this.#announce(stream);
  }

  /** After an opening: `resumed` once events are back after a `paused`, or `paused` for an opening while they are not. */
  #announce(stream: Stream): void {
    if (this.#available) {
      if (!stream.paused) return;
      stream.paused = false;
      stream.sink.resumed();
    } else if (!stream.paused) {
      stream.paused = true;
      stream.sink.paused();
    }
  }

  /**
   * Reads again what changed while the state was read (a live replace-whole event came), until a round sees no change;
   * a part still changing after SETTLE_ROUNDS stands at the last value it published. False when the flow was taken over
   * or the session launched again (which starts over).
   */
  async #settle(stream: Stream, gen: number): Promise<boolean> {
    for (let round = 0; round < SETTLE_ROUNDS && stream.dirty.size > 0; round++) {
      const parts = STREAM_PARTS.filter((p) => stream.dirty.has(p));
      stream.dirty.clear();
      stream.latest.clear();
      const values = await this.#readParts(stream, parts);
      if (gen !== stream.gen) return false;
      if (!this.#apply(stream, values)) return false;
    }
    if (stream.dirty.size === 0) return true;
    this.#options.log(`a session stream's state kept changing while it was read; it stands at the last change published`);
    const values: Partial<Record<StreamPart, unknown>> = {};
    for (const part of STREAM_PARTS) if (stream.dirty.has(part) && stream.latest.has(part)) values[part] = stream.latest.get(part);
    // A part marked with no value (the cards' context moved) is read again, once the hold is over.
    const reread = stream.dirty.has('pendingItems') && !stream.latest.has('pendingItems') && stream.view === 'cards';
    stream.dirty.clear();
    stream.latest.clear();
    if (!this.#apply(stream, values)) return false;
    if (reread) void this.#rehydrate(stream);
    return true;
  }

  /** Parts read or published during an opening, applied: false when the status says the session launched again. */
  #apply(stream: Stream, values: Partial<Record<StreamPart, unknown>>): boolean {
    const status = values.status as { launchId?: unknown; engineSessionId?: unknown } | undefined;
    if (status !== undefined) {
      if (status.launchId !== stream.epoch) {
        void this.#open(stream, 'relaunch');
        return false;
      }
      stream.engine = engineOf(status);
    }
    this.#state(stream, values);
    return true;
  }

  /** The hold ends: what came live meanwhile goes on (events only if no catch-up is due), the launch checked. */
  #release(stream: Stream): void {
    const held = stream.held;
    const overflow = stream.overflow;
    this.#unhold(stream);
    stream.holdEvents = false;
    stream.holdState = false;
    // What it dropped past the backlog is the journal's to give: it catches up from the last event sent.
    if (overflow) stream.catching = true;
    for (const event of held) {
      if (this.#otherLaunch(stream, event)) return void this.#open(stream, 'relaunch');
      if (!stream.catching) this.#take(stream, event);
    }
  }

  /** A live event held while a read is in flight; past the backlog, none is held and the journal gives them after. */
  #hold(stream: Stream, event: SessionEvent): void {
    if (stream.overflow) return;
    stream.held.push(event);
    stream.heldBytes += Buffer.byteLength(JSON.stringify(event));
    if (stream.heldBytes <= this.#backlog) return;
    stream.overflow = true;
    stream.held = [];
    stream.heldBytes = 0;
  }

  #unhold(stream: Stream): void {
    stream.held = [];
    stream.heldBytes = 0;
    stream.overflow = false;
  }

  /**
   * A read failed: the reader is told, and a stream it keeps takes no live event until it caught up from its cursor (a
   * relink), and opens a new launch as soon as one shows.
   */
  #fail(stream: Stream): void {
    stream.gen++;
    this.#unhold(stream);
    stream.holdEvents = false;
    stream.holdState = false;
    stream.dirty.clear();
    stream.latest.clear();
    stream.reading = false;
    stream.catching = true;
    stream.sink.end('unavailable');
  }

  // ---- Live ---------------------------------------------------------------------------------------------------------

  #live(stream: Stream, name: string, payload: Record<string, unknown>): void {
    if (stream.sink.ended) return;
    if (name === 'session.eventBatch') {
      if (stream.view === 'cards' || !Array.isArray(payload.events)) return;
      for (const event of payload.events as SessionEvent[]) {
        if (stream.holdEvents) this.#hold(stream, event);
        else if (this.#otherLaunch(stream, event)) return void this.#open(stream, 'relaunch');
        else if (!stream.catching) this.#take(stream, event);
      }
      return;
    }
    const part = partOf(name, payload);
    if (part === null) return;
    // A cards view carries none of the queue or the catalog.
    if (stream.view === 'cards' && (part.part === 'queue' || part.part === 'catalog')) return;
    if (stream.holdState) {
      // An opening: it is read again after (a launch moved included, which starts it over), or stands as published.
      stream.dirty.add(part.part);
      stream.latest.set(part.part, part.value);
      // The cards' context may have moved with a status (the engine said its id, a `/clear`): hydrated again too.
      if (part.part === 'status' && stream.view === 'cards') stream.dirty.add('pendingItems');
      return;
    }
    if (part.part === 'status') {
      const status = part.value as { launchId?: unknown; engineSessionId?: unknown };
      if (status.launchId !== stream.epoch) return void this.#open(stream, 'relaunch');
      if (stream.view === 'cards') {
        // The context an answer needs moved: the cards are hydrated again.
        const engine = engineOf(status);
        if (engine === stream.engine) return;
        stream.engine = engine;
        return void this.#rehydrate(stream);
      }
    }
    this.#state(stream, { [part.part]: part.value });
  }

  /** Replace-whole parts at the stream's position (`cards`: its pending items, hydrated). */
  #state(stream: Stream, values: Partial<Record<StreamPart, unknown>>): void {
    if (stream.view === 'cards') {
      if (values.pendingItems !== undefined) void this.#rehydrate(stream, values.pendingItems);
      return;
    }
    // Each part its own snapshot, replacing one of its part not yet sent.
    for (const part of STREAM_PARTS) if (values[part] !== undefined) stream.sink.snap(this.#at(stream), { [part]: values[part] }, part);
  }

  async #rehydrate(stream: Stream, items?: unknown): Promise<void> {
    const n = ++stream.hydration;
    const gen = stream.gen;
    const list = items ?? (await this.#read(stream, 'pendingItems'));
    if (n !== stream.hydration || gen !== stream.gen) return;
    const cards = await this.#hydrate(stream, Array.isArray(list) ? list : []);
    if (n !== stream.hydration || gen !== stream.gen || stream.sink.ended) return;
    stream.sink.snap(this.#at(stream), { pendingItems: cards }, 'cards');
  }

  /** Each broker item that stands for a pending request, with the request, its context and its digest. */
  async #hydrate(stream: Stream, items: readonly unknown[]): Promise<Card[]> {
    const cards: Card[] = [];
    for (const item of items) {
      const requestId = (item as { request?: { requestId?: unknown } } | null)?.request?.requestId;
      if (typeof requestId !== 'string') continue;
      let response;
      try {
        response = await this.#options.read('session.pendingRequest', { appSessionId: stream.app, requestId });
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
    if (stream.sink.backlog > this.#backlog) {
      stream.catching = true;
      return;
    }
    this.#send(stream, event);
    // A live batch may have cut its row: a catch-up reads this row again.
    stream.pastRow = false;
  }

  #send(stream: Stream, event: SessionEvent): void {
    const at = this.#cursor(stream, event);
    if (at === null || !after(at, stream.queued)) return;
    stream.sink.ev({ epoch: stream.epoch!, seq: at.seq, idx: at.idx }, event);
    stream.queued = at;
  }

  /**
   * Reads the journal on from the last event sent, a page at a time while the unsent stream is under half the backlog:
   * after the last row read when it stands at a row's end (`pastRow`), else from its own row, which must come back
   * first and go on without a gap.
   */
  async #pump(stream: Stream): Promise<void> {
    if (!stream.catching || stream.reading || stream.holdEvents || stream.sink.ended || stream.closed || stream.sink.backlog > this.#backlog / 2) return;
    const gen = stream.gen;
    stream.reading = true;
    stream.holdEvents = true;
    this.#unhold(stream);
    const from = stream.queued;
    const pastRow = stream.pastRow;
    const start = from.seq === 0 && from.idx < 0;
    const page = await this.#events(stream, start ? null : pastRow ? from.seq : from.seq - 1);
    if (gen !== stream.gen) return;
    stream.reading = false;
    if (page === undefined) return this.#fail(stream);
    if (page.events.length > 0 && this.#otherLaunch(stream, page.events[0])) {
      stream.holdEvents = false;
      return void this.#open(stream, 'relaunch');
    }
    // The read must go on from where the stream stands, or what it needs is gone: from the launch's start, unless the
    // reader was already told `missing` (a re-open included, which reads from the start too).
    if (!(start ? stream.lost || this.#gapless(page) : pastRow ? this.#gapless(page) : this.#continues(stream, page, from))) {
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
    // A page ends on a whole row: the next goes on after it.
    if (page.events.length > 0) stream.pastRow = true;
    if (page.complete || page.events.length === 0) stream.catching = false;
    this.#release(stream);
    void this.#pump(stream);
  }

  /**
   * A page read from a cursor's own row goes on from it: its first event in that row, no later than the one after it.
   * What a lost journal took is before the page's first event, so this holds whatever `historyUnavailable` says.
   */
  #continues(stream: Stream, page: Page, from: At): boolean {
    const first = page.events.length > 0 ? this.#cursor(stream, page.events[0]) : null;
    return first !== null && first.seq === from.seq && first.idx <= from.idx + 1;
  }

  /**
   * A page read after a whole row (or from the launch's start) holds every event after it unless the engine host says
   * part of the range is gone (`historyUnavailable`: the ring dropped it and the journal can't give it back). Rows may
   * skip seqs, so the events alone can't prove it; nor can `complete`, which a page's limit sets false too.
   */
  #gapless(page: Page): boolean {
    return page.historyUnavailable !== true;
  }

  // ---- Reads --------------------------------------------------------------------------------------------------------

  async #read(stream: Stream, part: StreamPart): Promise<Record<string, unknown> | unknown[] | undefined> {
    let response;
    try {
      response = await this.#options.read(READS[part], { appSessionId: stream.app });
    } catch (error) {
      this.#options.log(`a session stream's ${READS[part]} could not be read: ${(error as Error).message}`);
      return undefined;
    }
    if (!response.ok) return undefined;
    const value = response.value as Record<string, unknown>;
    return part === 'pendingItems' ? (Array.isArray(value?.items) ? value.items : []) : value;
  }

  async #readParts(stream: Stream, parts: readonly StreamPart[]): Promise<Partial<Record<StreamPart, unknown>>> {
    const values = await Promise.all(parts.map((part) => this.#read(stream, part)));
    const out: Partial<Record<StreamPart, unknown>> = {};
    parts.forEach((part, i) => {
      if (values[i] !== undefined) out[part] = values[i];
    });
    return out;
  }

  async #events(stream: Stream, afterSeq: number | null): Promise<Page | undefined> {
    let response;
    try {
      response = await this.#options.read('session.events', { appSessionId: stream.app, afterSeq, limit: PAGE_EVENTS });
    } catch {
      return undefined;
    }
    if (!response.ok) return undefined;
    const value = response.value as { events?: unknown; complete?: unknown; historyUnavailable?: unknown };
    // Events with no `seq` are the transcript's from disk (no launch here): none of them is the stream's.
    const events = Array.isArray(value.events) ? (value.events as SessionEvent[]).filter((e) => typeof e?.seq === 'number') : [];
    return { events, complete: value.complete === true, ...(value.historyUnavailable === true ? { historyUnavailable: true } : {}) };
  }

  // ---- Cursors ------------------------------------------------------------------------------------------------------

  #at(stream: Stream): StreamPosition {
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

const engineOf = (status: { engineSessionId?: unknown }): string | null => (typeof status.engineSessionId === 'string' ? status.engineSessionId : null);

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
function partOf(name: string, payload: Record<string, unknown>): { part: StreamPart; value: unknown } | null {
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
