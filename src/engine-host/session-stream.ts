// One live launch's outward stream (C3 execution document, M5 decisions; Residue "Reload survival"): its events leave
// in `session.eventBatch` batches, per session, every 16 ms or at 500 events, and every other per-session event
// (`session.status`, `session.queue`, `session.brokerItems`) flushes the pending batch first, so a consumer never sees
// a state ahead of the events that caused it. The last `ringSize` events stay in memory for `session.events`; a range
// the ring has evicted is rebuilt from the launch's journal through a fresh Normalizer, which reproduces the live
// events exactly (ids and seq included) because every event derives from a journal row; a rebuilt page stops at its
// limit and the next page resumes where it stopped. The originating `*.requested` event of each live broker item is
// kept aside for `session.pendingRequest`, whatever the ring has evicted since. C12: once the launch has exited, its
// ring keeps only the last EXITED_RING events (the budget's exited-history cap); older ranges rebuild from the journal.
import { createReadStream } from 'node:fs';
import { basename, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, EventId, RequestId, SessionId } from '@shared/graph/ids';
import type { QueueState } from '@shared/engine/session-state-store';
import type { Catalog } from './session-status'; // C7
import type { EngineSessionStatus } from '@shared/engine/status';
import type { EventsSnapshot } from '@shared/ipc/schema/session';
import type { HostEmit } from '@shared/host/runtime';
import { parseJournalRow } from '@shared/wire/journal';
import { EXITED_RING } from './budget'; // C12
import { JournalReader } from './journal';
import { Normalizer } from './normalizer';

export const RING_SIZE = 5_000;
export const BATCH_MS = 16;
export const BATCH_MAX = 500;

const REQUESTED_KINDS = new Set(['permission.requested', 'question.requested', 'plan.requested', 'dialog.requested', 'elicitation.requested']);
// E1 M4b: a blocking ask's attention item originates in its `maws.ask.opened` (an async ask is no item)
const isRequested = (event: SessionEvent): boolean => REQUESTED_KINDS.has(event.kind) || (event.kind === 'maws.ask.opened' && event.blocking);

export interface SessionStreamOptions {
  appSessionId: AppSessionId;
  launchId: string;
  sessionId: SessionId | null; // what the live normaliser was constructed with (the plan's)
  journalPath: string; // the launch's first journal file (`EngineSessionStatus.journalPath`); rotations sit beside it
  emit: HostEmit;
  ringSize?: number;
  batchMs?: number;
  exitedRingSize?: number; // C12: the ring once the launch has exited (EXITED_RING)
  log?: (line: string) => void; // E10: the burst's tail_gap line, a refused batch
  // E10: whether a client is still connected after an emit answered false: the runtime answers false for an invalid
  // payload too, and a batch refused while the client is there can never be delivered, so it is skipped (absent: false
  // means the client is gone)
  hasClient?: () => boolean;
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
  }

  events(batch: SessionEvent[]): void {
    for (const event of batch) if (isRequested(event)) this.requests.set((event as { requestId: string }).requestId, event);
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
    this.opts.emit('session.status', { appSessionId: this.opts.appSessionId, status });
  }

  // Keeps the last `size` events; the ones dropped are the journal's to rebuild.
  private trim(size: number): void {
    const dropped = this.ring.splice(0, this.ring.length - size);
    if (dropped.length === 0) return;
    this.evictedThrough = dropped.at(-1)!.seq;
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
  // or delivered broker item, else null.
  pendingRequest(requestId: RequestId): SessionEvent | null {
    return this.liveItems.has(requestId) ? (this.requests.get(requestId) ?? null) : null;
  }

  // `session.events`: every event after `afterSeq` (null: from the start of this launch), whole rows at a time up to
  // about `limit`; `complete` is false when the answer stops short (the limit, or a journal that cannot be read back).
  async snapshot(afterSeq: number | null, limit: number | null): Promise<EventsSnapshot> {
    if (this.evictedThrough === null || (afterSeq !== null && afterSeq >= this.evictedThrough)) return page(this.ring, afterSeq, limit, true);
    return (await this.fromJournal(afterSeq, limit)) ?? page(this.ring, afterSeq, limit, false);
  }

  dispose(): void {
    this.flush();
    this.cursor = null;
  }

  // E10 start: the delivered cursor and the connect burst (E10 execution document, §Design 3 "The delivered cursor").
  // The last event written to a connected client; null before the first one, or once the ring rolled past it.
  get delivered(): DeliveredCursor | null {
    return this.deliveredTo;
  }

  // The client's `ready`: the row's state as ordinary events, then every event of the ring no client has received yet,
  // in batches of BATCH_MAX. The pending batch is part of that tail (its events are in the ring and undelivered), so it is
  // dropped rather than flushed after the burst a second time. A batch the client did not take ends the burst: the cursor
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
    const start = intact ? cursor.index + 1 : 0;
    for (let i = start; i < this.ring.length; i += BATCH_MAX) {
      const batch = this.ring.slice(i, i + BATCH_MAX);
      if (!this.send(batch)) return;
      this.deliveredTo = { index: i + batch.length - 1, id: batch.at(-1)!.id };
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
  // rotated file pruned, a file removed by an archive).
  private async fromJournal(afterSeq: number | null, limit: number | null): Promise<EventsSnapshot | null> {
    const prefix = `${basename(this.opts.journalPath, '.jsonl')}.`; // `<file id>.jsonl`, then `<file id>.<n>.jsonl`
    const files = JournalReader.forSession(dirname(this.opts.journalPath)).filter((file) => basename(file).startsWith(prefix));
    const resumable = this.cursor !== null && afterSeq !== null && afterSeq >= this.cursor.through;
    const cursor = resumable ? this.cursor! : { normalizer: new Normalizer({ appSessionId: this.opts.appSessionId, launchId: this.opts.launchId, sessionId: this.opts.sessionId }), file: 0, offset: 0, expected: 1, carried: [], through: 0 };
    this.cursor = null; // re-armed only by a page that read cleanly
    if (files.length === 0) return null;
    const wanted = (e: SessionEvent) => afterSeq === null || (e.seq !== null && e.seq > afterSeq);
    const events = cursor.carried.filter(wanted);
    cursor.carried = [];
    let complete = true;
    try {
      reading: for (;;) {
        const input = createReadStream(files[cursor.file]!, { encoding: 'utf8', start: cursor.offset });
        const lines = createInterface({ input, crlfDelay: Infinity });
        try {
          for await (const line of lines) {
            cursor.offset += Buffer.byteLength(line, 'utf8') + 1;
            if (line.length === 0) continue;
            const row = parseJournalRow(JSON.parse(line));
            if (row.seq !== cursor.expected) return null; // a gap: part of the launch is gone
            cursor.expected += 1;
            const out = cursor.normalizer.push(row).filter(wanted);
            if (out.length === 0) continue;
            if (limit !== null && events.length >= limit) {
              cursor.carried = out; // the page is full and more follows: this row opens the next page
              complete = false;
              break reading;
            }
            events.push(...out);
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
      return null;
    }
    const lastSeq = events.at(-1)?.seq ?? afterSeq ?? 0;
    cursor.through = lastSeq;
    this.cursor = cursor;
    return { events, lastSeq, complete }; // `lastSeq` is the cursor for the next call
  }
}

// `session.events` from the ring: every event after `afterSeq`, whole rows at a time up to about `limit`.
function page(source: SessionEvent[], afterSeq: number | null, limit: number | null, complete: boolean): EventsSnapshot {
  let events = afterSeq === null ? [...source] : source.filter((e) => e.seq !== null && e.seq > afterSeq);
  if (limit !== null && events.length > limit) {
    let end = limit;
    while (end < events.length && events[end]!.seq === events[end - 1]!.seq) end += 1; // never split a row: the next page starts after it
    if (end < events.length) {
      events = events.slice(0, end);
      complete = false;
    }
  }
  return { events, lastSeq: events.at(-1)?.seq ?? afterSeq ?? 0, complete }; // the cursor for the next call
}
