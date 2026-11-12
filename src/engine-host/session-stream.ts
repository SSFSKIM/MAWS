// One live launch's outward stream (C3 execution document, M5 decisions; Residue "Reload survival"): its events leave
// in `session.eventBatch` batches, per session, every 16 ms or at 500 events, and every other per-session event
// (`session.status`, `session.queue`, `session.brokerItems`) flushes the pending batch first, so a consumer never sees
// a state ahead of the events that caused it. The last `ringSize` events stay in memory for `session.events`; a range
// the ring has evicted is rebuilt from the launch's journal through a fresh Normalizer, which reproduces the live
// events exactly (ids and seq included) because every event derives from a journal row; a rebuilt page stops at its
// limit and the next page resumes where it stopped. The originating `*.requested` event of each live broker item is
// kept aside for `session.pendingRequest`, whatever the ring has evicted since, and dropped once its item has left the
// list, or without a listing when the broker retired the request unlisted (a re-delivered retired id; the exit). C12:
// once the launch has exited, its ring keeps only the last EXITED_RING events (the budget's exited-history cap); older
// ranges rebuild from the journal. P5 O15 M2b (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, §L): such a
// rebuild starts at the newest checkpoint before its cursor, not at the launch's first row.
import { createReadStream } from 'node:fs';
import { basename, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { deserialize, serialize } from 'node:v8'; // P5 O15 M2b (§L)
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import { eventUtf8Bytes } from '@shared/graph/history-window'; // P5 O7 M4
import type { AppSessionId, EventId, RequestId, SessionId } from '@shared/graph/ids';
import type { QueueState } from '@shared/engine/session-state-store';
import type { Catalog } from './session-status'; // C7
import type { EngineSessionStatus } from '@shared/engine/status';
import type { EventsSnapshot } from '@shared/ipc/schema/session';
import type { HostEmit } from '@shared/host/runtime';
import { parseJournalRow } from '@shared/wire/journal';
import { EXITED_RING } from './budget'; // C12
import { JournalReader } from './journal';
import { Normalizer, type NormalizerState } from './normalizer';

export const RING_SIZE = 5_000;
export const BATCH_MS = 16;
export const BATCH_MAX = 500;
// E11 (scale review A sweep#1): a connect burst's batch also stops before its events' JSON passes this many bytes, a
// quarter of the socket's line cap (LINE_CAP), since inline screenshots ride the events as base64 and 500 of them can
// pass the cap, which closes the connection with the batch counted delivered. A single event over it goes alone.
export const BATCH_BYTES = 16 * 1024 * 1024;

// P5 O15 M2b start (§L): checkpoints. A checkpoint is the journal's position between two rows with the normaliser's state
// at that point, so a rebuild for an evicted cursor reads at most one interval of rows before it, whatever the launch's
// length. They are taken by the live path (the session, which owns the writer and the live normaliser) and by every
// journal scan, and are kept in memory only: nothing is written to disk, and a hand-over carries none.
export const CHECKPOINT_ROWS = 10_000; // a checkpoint after each row whose seq is a multiple of this
export const CHECKPOINTS_DENSE = 24; // the newest boundaries, every one kept
export const CHECKPOINT_SPARSE_EVERY = 8; // of the older boundaries, one in this many is kept
export const CHECKPOINTS_MAX = 40; // for one stream
export const CHECKPOINT_BYTES = 2 * 1024 * 1024; // the states' buffers for one stream, in all

export interface Checkpoint {
  through: number; // the seq of the last row the state has seen
  file: string; // the journal file that holds that row, by name
  index: number; // its place among the launch's files when the checkpoint was taken
  offset: number; // bytes into it, just past that row
  // v8.serialize(normalizer.state) of the normaliser that has seen every row through `through`: the structured clone
  // format, a deep copy that keeps Maps, Sets, NaN, -0 and undefined, restored with v8.deserialize into a new Normalizer
  state: Buffer;
}
// P5 O15 M2b end

const REQUESTED_KINDS = new Set(['permission.requested', 'question.requested', 'plan.requested', 'dialog.requested', 'elicitation.requested']);
// E1 M4b: an ask's attention item originates in its `maws.ask.opened` (P2-C2: an async ask's `async_input` item too)
export const isRequested = (event: SessionEvent): boolean => REQUESTED_KINDS.has(event.kind) || event.kind === 'maws.ask.opened';

export interface SessionStreamOptions {
  appSessionId: AppSessionId;
  launchId: string;
  sessionId: SessionId | null; // what the live normaliser was constructed with (the plan's)
  journalPath: string; // the launch's first journal file (`EngineSessionStatus.journalPath`); rotations sit beside it
  emit: HostEmit;
  ringSize?: number;
  batchMs?: number;
  exitedRingSize?: number; // C12: the ring once the launch has exited (EXITED_RING)
  log?: (line: string) => void; // E10: the burst's tail_gap line, a refused batch; P5 O15 M2b: the ring's first eviction, a journal read
  // E10: whether a client is still connected after an emit answered false: the runtime answers false for an invalid
  // payload too, and a batch refused while the client is there can never be delivered, so it is skipped (absent: false
  // means the client is gone)
  hasClient?: () => boolean;
  // E11: whether the broker has retired this request id; a re-delivered request it ignores keeps no event (absent: none)
  retired?: (requestId: string) => boolean;
  // P5 O16 M3c: an adopted launch's last journaled seq before this stream began (the successor's fold tells nothing):
  // that range is answered from the journal, as an evicted one is (absent: the stream began with the launch)
  historyThrough?: number;
  // P5 O16 M3c fix wave 1: an adopted launch's originating request events its fold read (the successor told none), for a
  // live broker item whose event this stream never saw (absent: none)
  restored?: (requestId: string) => SessionEvent | null;
  checkpointRows?: number; // P5 O15 M2b (§L): CHECKPOINT_ROWS (tests)
}

// E10: what a connect burst republishes for the row, read from its EngineSession (the stream keeps no copy): the queue
// only once recovered (before that the store's is the queue, which `session.queue.list` answers), the catalogue only
// once one was published (revision above 0).
export interface RowState {
  status: EngineSessionStatus;
  queue: QueueState | null;
  brokerItems: AttentionItem[];
  catalog: Catalog | null;
}

// E10: the last event written to a connected client, as its ring position and id (a seq is not enough: one row yields
// several events, and a live batch may split a row at BATCH_MAX).
export interface DeliveredCursor {
  index: number;
  id: EventId;
}

// Where the last rebuilt page stopped: the next page (afterSeq = `through`) goes on from here.
interface JournalCursor {
  normalizer: Normalizer; // has seen every row before `offset`
  file: number; // index into the launch's files
  offset: number; // bytes into that file
  expected: number; // the next row's seq
  carried: SessionEvent[]; // the events of the row read past the last full page
  through: number; // the last page's lastSeq
}

export class SessionStream {
  private readonly ring: SessionEvent[] = [];
  private cursor: JournalCursor | null = null;
  private evictedThrough: number | null = null; // the seq of the last event the ring dropped
  private evictionLogged = false; // P5 O15 M2b: the launch's first eviction is in host.log
  private checkpoints: Checkpoint[] = []; // P5 O15 M2b (§L): oldest first, as the rule keeps them
  private readonly checkpointRows: number; // P5 O15 M2b (§L)
  private pending: SessionEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly requests = new Map<string, SessionEvent>();
  private liveItems = new Set<string>(); // request ids of pending or delivered broker items
  private listed = new Set<string>(); // E1 M5: the request ids of the last published list
  private readonly ringSize: number;
  private readonly batchMs: number;
  private readonly exitedRingSize: number; // C12
  // E10 start
  private deliveredTo: DeliveredCursor | null = null;
  private lost: { first: EventId; last: EventId; count: number } | null = null; // undelivered events the ring dropped since the last burst
  // E10 end

  constructor(private readonly opts: SessionStreamOptions) {
    this.ringSize = opts.ringSize ?? RING_SIZE;
    this.batchMs = opts.batchMs ?? BATCH_MS;
    this.exitedRingSize = opts.exitedRingSize ?? EXITED_RING; // C12
    this.checkpointRows = opts.checkpointRows ?? CHECKPOINT_ROWS; // P5 O15 M2b (§L)
    if (opts.historyThrough !== undefined && opts.historyThrough > 0) this.evictedThrough = opts.historyThrough; // P5 O16 M3c
  }

  events(batch: SessionEvent[]): void {
    for (const event of batch) {
      if (!isRequested(event)) continue;
      const { requestId } = event as { requestId: string };
      if (!this.opts.retired?.(requestId)) this.requests.set(requestId, event);
    }
    this.ring.push(...batch);
    if (this.ring.length > this.ringSize + Math.floor(this.ringSize / 5)) this.trim(this.ringSize); // trims in chunks, never one shift per event
    this.pending.push(...batch);
    while (this.pending.length >= BATCH_MAX) this.emitBatch(this.pending.splice(0, BATCH_MAX));
    if (this.pending.length > 0 && this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.batchMs);
      (this.timer as { unref?: () => void }).unref?.();
    }
  }

  flush(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    while (this.pending.length > 0) this.emitBatch(this.pending.splice(0, BATCH_MAX));
  }

  status(status: EngineSessionStatus): void {
    this.flush();
    if (status.process === 'exited' && this.ring.length > this.exitedRingSize) this.trim(this.exitedRingSize); // C12: an exited launch's events are all in
    if (status.process === 'exited') this.requests.clear(); // E11: nothing of the launch can be pending, listed or not (a request accepted while exiting never is)
    this.opts.emit('session.status', { appSessionId: this.opts.appSessionId, status });
  }

  // Keeps the last `size` events; the ones dropped are the journal's to rebuild.
  private trim(size: number): void {
    const dropped = this.ring.splice(0, this.ring.length - size);
    if (dropped.length === 0) return;
    this.evictedThrough = dropped.at(-1)!.seq;
    // P5 O15 M2b (§H): where a replay comes from, ring or journal, is read off host.log from here
    if (!this.evictionLogged) this.opts.log?.(`ring evicted ${this.opts.appSessionId} launch ${this.opts.launchId}: events through seq ${this.evictedThrough} are the journal's now`);
    this.evictionLogged = true;
    // E10: the delivered cursor moves with the ring, and is gone once the ring rolled past it; the undelivered events
    // dropped are lost to the client's listeners (the burst logs them as a tail_gap)
    const firstUndelivered = this.deliveredTo === null ? 0 : this.deliveredTo.index + 1;
    if (this.deliveredTo !== null) this.deliveredTo = this.deliveredTo.index >= dropped.length ? { index: this.deliveredTo.index - dropped.length, id: this.deliveredTo.id } : null;
    if (firstUndelivered < dropped.length) {
      this.lost = { first: this.lost?.first ?? dropped[firstUndelivered]!.id, last: dropped.at(-1)!.id, count: (this.lost?.count ?? 0) + dropped.length - firstUndelivered };
    }
  }

  queue(queue: QueueState): void {
    this.flush();
    this.opts.emit('session.queue', { appSessionId: this.opts.appSessionId, entries: queue.entries, paused: queue.paused, pauseReason: queue.pauseReason ?? null, ...(queue.steers && { steers: queue.steers }), ...(queue.withdrawn && { withdrawn: queue.withdrawn }) }); // C7: pauseReason; W1: steers, withdrawn when there are any
  }

  // C7 start: the launch's catalogue, whole, as `session.catalogChanged` (after the events that caused it, like every other
  // per-session event); `launchId` keys the revision, which restarts with every launch.
  catalog(catalog: Catalog): void {
    this.flush();
    this.opts.emit('session.catalogChanged', { appSessionId: this.opts.appSessionId, launchId: this.opts.launchId, catalog });
  }
  // C7 end

  brokerItems(items: AttentionItem[]): void {
    this.flush();
    this.liveItems = new Set(items.filter((i) => i.state === 'pending' || i.state === 'delivered').map((i) => i.request.requestId!));
    // E1 M5: a request's event is forgotten once its item has left the list, never before its item was first listed: a
    // blocking ask's item is listed after a list the same frame caused (the broker confirming the call's permission)
    const listed = new Set<string>(items.map((i) => i.request.requestId!));
    for (const requestId of this.listed) if (!listed.has(requestId)) this.requests.delete(requestId);
    this.listed = listed;
    this.opts.emit('session.brokerItems', { appSessionId: this.opts.appSessionId, items });
  }

  // `session.pendingRequest`: the originating *.requested event (a blocking ask's `maws.ask.opened`, E1 M4b) of a pending
  // or delivered broker item, else null; P5 O16 M3c fix wave 1: an adopted launch's item restored by its fold, from the
  // fold's own read of the journal (`restored`).
  pendingRequest(requestId: RequestId): SessionEvent | null {
    return this.liveItems.has(requestId) ? (this.requests.get(requestId) ?? this.opts.restored?.(requestId) ?? null) : null;
  }

  // `session.events`: every event after `afterSeq` (null: from the start of this launch), whole rows at a time up to
  // about `limit`; `complete` is false when the answer stops short (the limit, or a journal that cannot be read back).
  // O10 M8: a range the ring dropped and the journal can't give back is answered from the ring alone and marked
  // `historyUnavailable`, so a reader paging on (the endpoint's remote subscriptions) knows events are missing.
  // P5 O7 M4 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, acceptance 12): `maxBytes` bounds the answer's
  // UTF-8 JSON: whole rows while they fit, the answer then incomplete with `lastSeq` its cursor, and a row alone past the
  // bound left out (`omitted`, its seq the answer's `lastSeq`), so the next page goes on after it.
  async snapshot(afterSeq: number | null, limit: number | null, maxBytes: number | null = null): Promise<EventsSnapshot> {
    const bound = maxBytes === null ? null : maxBytes - LIVE_ENVELOPE_BYTES;
    if (this.evictedThrough === null || (afterSeq !== null && afterSeq >= this.evictedThrough)) return page(this.ring, afterSeq, limit, true, bound);
    return (await this.fromJournal(afterSeq, limit, bound)) ?? { ...page(this.ring, afterSeq, limit, false, bound), historyUnavailable: true };
  }

  dispose(): void {
    this.flush();
    this.cursor = null;
    this.checkpoints = []; // P5 O15 M2b (§L)
  }

  // P5 O15 M2b start (§L): a checkpoint of the launch's journal, the live path's or a scan's; one already held for its
  // row is kept as it was. With `head` the newest boundary held, the one at boundary `b` stays while `head - b` is under
  // CHECKPOINTS_DENSE or `b` is a multiple of CHECKPOINT_SPARSE_EVERY; then the oldest go while more than
  // CHECKPOINTS_MAX are held or their states pass CHECKPOINT_BYTES. Each one taken is a host.log line.
  checkpoint(c: Checkpoint): void {
    if (this.checkpoints.some((held) => held.through === c.through)) return;
    const held = [...this.checkpoints, c].sort((x, y) => x.through - y.through);
    const head = held.at(-1)!.through / this.checkpointRows;
    const kept = held.filter((k) => this.boundaryKept(k.through, head));
    let bytes = kept.reduce((n, k) => n + k.state.length, 0);
    while (kept.length > CHECKPOINTS_MAX || bytes > CHECKPOINT_BYTES) bytes -= kept.shift()!.state.length;
    this.checkpoints = kept;
    this.opts.log?.(`checkpoint ${this.opts.appSessionId} launch ${this.opts.launchId} at seq ${c.through}: ${c.state.length} bytes; ${kept.length} held, ${bytes} bytes`);
  }

  private boundaryKept(through: number, head: number): boolean {
    const boundary = through / this.checkpointRows;
    return head - boundary < CHECKPOINTS_DENSE || boundary % CHECKPOINT_SPARSE_EVERY === 0;
  }

  // Whether a scan that has just normalised row `through`, a boundary, takes a checkpoint there: none is held for it,
  // and the rule would keep it (so a scan behind the newest held serialises nothing the rule drops at once; only the
  // byte cap is not known before the copy).
  private wantsCheckpoint(through: number): boolean {
    if (through % this.checkpointRows !== 0 || this.checkpoints.some((held) => held.through === through)) return false;
    if (this.checkpoints.length >= CHECKPOINTS_MAX && through < this.checkpoints[0]!.through) return false;
    return this.boundaryKept(through, Math.max(through, this.checkpoints.at(-1)?.through ?? 0) / this.checkpointRows);
  }

  // The newest checkpoint at or before `afterSeq`, when the launch's files still hold its file at its place, every
  // earlier file with it, which is what a scan from the first row needs of them; else null.
  private usableCheckpoint(afterSeq: number, files: readonly string[]): Checkpoint | null {
    const c = this.checkpoints.findLast((held) => held.through <= afterSeq);
    return c !== undefined && files[c.index] !== undefined && basename(files[c.index]!) === c.file ? c : null;
  }

  // A page cursor that goes on from a checkpoint: a fresh normaliser on its state restored, its file and offset, the
  // next seq. Null for a state that cannot be read back.
  private cursorAt(c: Checkpoint): JournalCursor | null {
    try {
      const state = deserialize(c.state) as NormalizerState;
      return { normalizer: new Normalizer({ appSessionId: this.opts.appSessionId, launchId: this.opts.launchId, sessionId: this.opts.sessionId, state }), file: c.index, offset: c.offset, expected: c.through + 1, carried: [], through: c.through };
    } catch {
      return null;
    }
  }
  // P5 O15 M2b end

  // E10 start: the delivered cursor and the connect burst (E10 execution document, §Design 3 "The delivered cursor").
  // The last event written to a connected client; null before the first one, or once the ring rolled past it.
  get delivered(): DeliveredCursor | null {
    return this.deliveredTo;
  }

  // The client's `ready`: the row's state as ordinary events, then every event of the ring no client has received yet,
  // in batches of at most BATCH_MAX events and BATCH_BYTES of JSON. The pending batch is part of that tail (its events
  // are in the ring and undelivered), so it is dropped rather than flushed after the burst a second time. A batch the client did not take ends the burst: the cursor
  // stays at the last one written, and the next ready sends the rest.
  republish(state: RowState): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = [];
    this.status(state.status);
    if (state.queue) this.queue(state.queue);
    this.brokerItems(state.brokerItems);
    if (state.catalog) this.catalog(state.catalog);
    const cursor = this.deliveredTo;
    const intact = cursor !== null && this.ring[cursor.index]?.id === cursor.id;
    const gap = this.lost
      ? `${this.lost.count} undelivered events left the ring (${this.lost.first} .. ${this.lost.last})`
      : cursor !== null && !intact
        ? `the delivered event ${cursor.id} is not at its ring position` // read as rolled
        : null;
    if (gap !== null) {
      this.opts.log?.(`tail_gap ${this.opts.appSessionId} launch ${this.opts.launchId}: ${gap}; the burst sends the ${this.ring.length} the ring holds (${this.ring[0]?.id ?? 'none'} .. ${this.ring.at(-1)?.id ?? 'none'})`);
      this.lost = null;
    }
    let start = intact ? cursor.index + 1 : 0;
    while (start < this.ring.length) {
      const end = burstBatchEnd(this.ring, start);
      const batch = this.ring.slice(start, end);
      if (!this.send(batch)) return;
      this.deliveredTo = { index: end - 1, id: batch.at(-1)!.id };
      start = end;
    }
  }

  // True when the batch is done with: written, or refused while the client stays connected (logged; it can never be
  // delivered, so the cursor moves past it). False when the client is gone, so the batch stays undelivered.
  private send(events: SessionEvent[]): boolean {
    if (this.opts.emit('session.eventBatch', { appSessionId: this.opts.appSessionId, events })) return true;
    if (!this.opts.hasClient?.()) return false;
    this.opts.log?.(`refused a batch of ${events.length} (${events[0]!.id} .. ${events.at(-1)!.id}) of ${this.opts.appSessionId}: an invalid event; the stream goes on after it`);
    return true;
  }

  // A live batch: written (or refused with the client there), its last event becomes the cursor. The batch was the front
  // of `pending`, which is the ring's tail, so the event sits just before what is still pending (unless one `events`
  // call outgrew the ring).
  private emitBatch(events: SessionEvent[]): void {
    if (!this.send(events)) return;
    const last = events.at(-1)!;
    const expected = this.ring.length - 1 - this.pending.length;
    const index = this.ring[expected] === last ? expected : this.ring.lastIndexOf(last);
    this.deliveredTo = index === -1 ? null : { index, id: last.id };
  }
  // E10 end

  // A page of the launch's journal files (the base file, then its rotations) through a normaliser that has seen every
  // row before it. The cursor a page leaves behind (the normaliser, the file and byte offset reached, and the events of
  // the row read past a full page) lets the next page, whose `afterSeq` is this one's `lastSeq`, go on from there, so
  // paging reads each row once (whole-branch review); the journal is append-only, so rows written meanwhile are simply
  // read next. Any other `afterSeq` starts over from the first row. Null when the files cannot be read back whole (a
  // rotated file pruned, a file removed by an archive). P5 O15 M2b (§H): a read that starts over and is served writes
  // one line at its end with the rows it read and its time, which is most of the endpoint's `J` for an evicted cursor.
  // P5 O15 M2b (§L): a read that starts over starts at the newest checkpoint at or before `afterSeq` where there is a
  // usable one, and so does a read whose kept cursor stands before that checkpoint; a read from a checkpoint that fails
  // is read again from the first row, so the answer is always the one a scan from the first row gives.
  private async fromJournal(afterSeq: number | null, limit: number | null, bound: number | null = null): Promise<EventsSnapshot | null> {
    const prefix = `${basename(this.opts.journalPath, '.jsonl')}.`; // `<file id>.jsonl`, then `<file id>.<n>.jsonl`
    const files = JournalReader.forSession(dirname(this.opts.journalPath)).filter((file) => basename(file).startsWith(prefix));
    const started = performance.now();
    const kept = this.cursor;
    this.cursor = null; // re-armed only by a page that read cleanly
    if (files.length === 0) return null;
    const checkpoint = afterSeq === null ? null : this.usableCheckpoint(afterSeq, files);
    // the kept cursor goes on unless a checkpoint stands past the rows it has read (never so for the page after it)
    if (kept !== null && afterSeq !== null && afterSeq >= kept.through && (checkpoint === null || checkpoint.through < kept.expected)) return (await this.readJournal(files, kept, afterSeq, limit, bound)).answer;
    let rows = 0;
    const restored = checkpoint === null ? null : this.cursorAt(checkpoint);
    if (restored !== null) {
      const read = await this.readJournal(files, restored, afterSeq, limit, bound);
      rows += read.rows;
      if (read.answer !== null) {
        this.opts.log?.(`session.events ${this.opts.appSessionId} after ${afterSeq}: from the journal, ${rows} rows read in ${Math.round(performance.now() - started)} ms, from the checkpoint at seq ${checkpoint!.through}`);
        return read.answer;
      }
    }
    const fresh: JournalCursor = { normalizer: new Normalizer({ appSessionId: this.opts.appSessionId, launchId: this.opts.launchId, sessionId: this.opts.sessionId }), file: 0, offset: 0, expected: 1, carried: [], through: 0 };
    const read = await this.readJournal(files, fresh, afterSeq, limit, bound);
    rows += read.rows;
    if (read.answer !== null) this.opts.log?.(`session.events ${this.opts.appSessionId} after ${afterSeq ?? 'start'}: from the journal, ${rows} rows read in ${Math.round(performance.now() - started)} ms`);
    return read.answer;
  }

  // One page read from `cursor` on, and the rows it parsed; the cursor is kept for the next page when the page read
  // cleanly. P5 O15 M2b (§L): at each boundary row it passes, the scan takes the stream's checkpoint where none is held.
  private async readJournal(files: readonly string[], cursor: JournalCursor, afterSeq: number | null, limit: number | null, bound: number | null): Promise<{ answer: EventsSnapshot | null; rows: number }> {
    let rows = 0;
    const wanted = (e: SessionEvent) => afterSeq === null || (e.seq !== null && e.seq > afterSeq);
    const events: SessionEvent[] = [];
    let bytes = 0;
    let omitted: EventsSnapshot['omitted'] | null = null;
    // A row's place on this page: taken; or the page is full and the row opens the next one (carried); or, alone past the
    // byte bound, left out and the page ends after it (P5 O7 M4).
    const admit = (row: SessionEvent[]): boolean => {
      if (limit !== null && events.length >= limit) return (cursor.carried = row), false;
      if (bound !== null) {
        const size = rowBytes(row);
        if (bytes + size > bound) {
          if (events.length > 0) return (cursor.carried = row), false;
          omitted = { events: row.length, bytes: size - row.length, seq: row[0]!.seq };
          return false;
        }
        bytes += size;
      }
      events.push(...row);
      return true;
    };
    const carried = cursor.carried.filter(wanted);
    cursor.carried = [];
    let complete = true;
    try {
      if (carried.length > 0 && !admit(carried)) complete = false;
      else reading: for (;;) {
        const input = createReadStream(files[cursor.file]!, { encoding: 'utf8', start: cursor.offset });
        const lines = createInterface({ input, crlfDelay: Infinity });
        try {
          for await (const line of lines) {
            cursor.offset += Buffer.byteLength(line, 'utf8') + 1;
            if (line.length === 0) continue;
            const row = parseJournalRow(JSON.parse(line));
            rows += 1;
            if (row.seq !== cursor.expected) return { answer: null, rows }; // a gap: part of the launch is gone
            cursor.expected += 1;
            const out = cursor.normalizer.push(row).filter(wanted);
            if (this.wantsCheckpoint(row.seq)) this.checkpoint({ through: row.seq, file: basename(files[cursor.file]!), index: cursor.file, offset: cursor.offset, state: serialize(cursor.normalizer.state) }); // P5 O15 M2b (§L)
            if (out.length === 0) continue;
            if (!admit(out)) {
              complete = false; // the page is full and more follows (the row carried opens the next page), or a row was left out
              break reading;
            }
          }
        } finally {
          lines.close();
          input.destroy();
        }
        if (cursor.file + 1 >= files.length) break; // the file being written: the next page resumes at its end
        cursor.file += 1;
        cursor.offset = 0;
      }
    } catch {
      return { answer: null, rows };
    }
    const left = omitted as EventsSnapshot['omitted'] | null;
    const lastSeq = left?.seq ?? events.at(-1)?.seq ?? afterSeq ?? 0;
    cursor.through = lastSeq;
    this.cursor = cursor;
    return { answer: { events, lastSeq, complete, ...(left && { omitted: left }) }, rows }; // `lastSeq` is the cursor for the next call
  }
}

// E11: where the burst's batch from `start` ends: before the event that would take it past BATCH_MAX events or
// BATCH_BYTES of JSON, but never empty.
function burstBatchEnd(ring: SessionEvent[], start: number): number {
  let bytes = 0;
  let end = start;
  while (end < ring.length && end - start < BATCH_MAX) {
    bytes += Buffer.byteLength(JSON.stringify(ring[end])) + 1; // and its comma
    if (bytes > BATCH_BYTES && end > start) break;
    end += 1;
  }
  return end;
}

// P5 O7 M4: what a bounded live answer's envelope may take beside its events (`lastSeq`, `complete`, `historyUnavailable`
// and an `omitted` of three numbers: under 200 bytes whatever their values).
const LIVE_ENVELOPE_BYTES = 256;
// A row's share of a bounded answer: its events' UTF-8 JSON and their commas.
const rowBytes = (row: readonly SessionEvent[]): number => row.reduce((bytes, event) => bytes + eventUtf8Bytes(event), 0);

// `session.events` from the ring: every event after `afterSeq`, whole rows at a time up to about `limit`, and within
// `bound` bytes of UTF-8 when one is given (P5 O7 M4).
function page(source: SessionEvent[], afterSeq: number | null, limit: number | null, complete: boolean, bound: number | null = null): EventsSnapshot {
  let events = afterSeq === null ? [...source] : source.filter((e) => e.seq !== null && e.seq > afterSeq);
  if (limit !== null && events.length > limit) {
    let end = limit;
    while (end < events.length && events[end]!.seq === events[end - 1]!.seq) end += 1; // never split a row: the next page starts after it
    if (end < events.length) {
      events = events.slice(0, end);
      complete = false;
    }
  }
  if (bound !== null) return withinBytes(events, afterSeq, complete, bound);
  return { events, lastSeq: events.at(-1)?.seq ?? afterSeq ?? 0, complete }; // the cursor for the next call
}

// A page's whole rows within `bound`: the rest left for the next page; a first row alone past it left out.
function withinBytes(events: SessionEvent[], afterSeq: number | null, complete: boolean, bound: number): EventsSnapshot {
  let bytes = 0;
  let end = 0;
  while (end < events.length) {
    let rowEnd = end + 1;
    while (rowEnd < events.length && events[rowEnd]!.seq === events[end]!.seq) rowEnd += 1;
    const size = rowBytes(events.slice(end, rowEnd));
    if (bytes + size > bound) {
      if (end > 0) return { events: events.slice(0, end), lastSeq: events[end - 1]!.seq ?? afterSeq ?? 0, complete: false };
      const seq = events[0]!.seq;
      return { events: [], lastSeq: seq ?? afterSeq ?? 0, complete: false, omitted: { events: rowEnd, bytes: size - rowEnd, seq } };
    }
    bytes += size;
    end = rowEnd;
  }
  return { events, lastSeq: events.at(-1)?.seq ?? afterSeq ?? 0, complete };
}
