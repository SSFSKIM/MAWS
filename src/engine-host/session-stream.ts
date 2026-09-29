// One live launch's outward stream (C3 execution document, M5 decisions; Residue "Reload survival"): its events leave
// in `session.eventBatch` batches, per session, every 16 ms or at 500 events, and every other per-session event
// (`session.status`, `session.queue`, `session.brokerItems`) flushes the pending batch first, so a consumer never sees
// a state ahead of the events that caused it. The last `ringSize` events stay in memory for `session.events`; a range
// the ring has evicted is rebuilt from the launch's journal through a fresh Normalizer, which reproduces the live
// events exactly (ids and seq included) because every event derives from a journal row. The originating `*.requested`
// event of each live broker item is kept aside for `session.pendingRequest`, whatever the ring has evicted since.
import { basename, dirname } from 'node:path';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, RequestId, SessionId } from '@shared/graph/ids';
import type { QueueState } from '@shared/engine/session-state-store';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { EventsSnapshot } from '@shared/ipc/schema/session';
import type { HostEmit } from '@shared/host/runtime';
import type { JournalRow } from '@shared/wire/journal';
import { JournalReader } from './journal';
import { Normalizer } from './normalizer';

export const RING_SIZE = 5_000;
export const BATCH_MS = 16;
export const BATCH_MAX = 500;

const REQUESTED_KINDS = new Set(['permission.requested', 'question.requested', 'plan.requested', 'dialog.requested', 'elicitation.requested']);

export interface SessionStreamOptions {
  appSessionId: AppSessionId;
  launchId: string;
  sessionId: SessionId | null; // what the live normaliser was constructed with (the plan's)
  journalPath: string; // the launch's first journal file (`EngineSessionStatus.journalPath`); rotations sit beside it
  emit: HostEmit;
  ringSize?: number;
  batchMs?: number;
}

export class SessionStream {
  private readonly ring: SessionEvent[] = [];
  private evictedThrough: number | null = null; // the seq of the last event the ring dropped
  private pending: SessionEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly requests = new Map<string, SessionEvent>();
  private liveItems = new Set<string>(); // request ids of pending or delivered broker items
  private readonly ringSize: number;
  private readonly batchMs: number;

  constructor(private readonly opts: SessionStreamOptions) {
    this.ringSize = opts.ringSize ?? RING_SIZE;
    this.batchMs = opts.batchMs ?? BATCH_MS;
  }

  events(batch: SessionEvent[]): void {
    for (const event of batch) if (REQUESTED_KINDS.has(event.kind)) this.requests.set((event as { requestId: string }).requestId, event);
    this.ring.push(...batch);
    if (this.ring.length > this.ringSize + Math.floor(this.ringSize / 5)) { // trims in chunks, never one shift per event
      const dropped = this.ring.splice(0, this.ring.length - this.ringSize);
      this.evictedThrough = dropped.at(-1)!.seq;
    }
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
    this.opts.emit('session.status', { appSessionId: this.opts.appSessionId, status });
  }

  queue(queue: QueueState): void {
    this.flush();
    this.opts.emit('session.queue', { appSessionId: this.opts.appSessionId, entries: queue.entries, paused: queue.paused });
  }

  brokerItems(items: AttentionItem[]): void {
    this.flush();
    this.liveItems = new Set(items.filter((i) => i.state === 'pending' || i.state === 'delivered').map((i) => i.request.requestId!));
    for (const requestId of this.requests.keys()) if (!items.some((i) => i.request.requestId === requestId)) this.requests.delete(requestId);
    this.opts.emit('session.brokerItems', { appSessionId: this.opts.appSessionId, items });
  }

  // `session.pendingRequest`: the originating *.requested event of a pending or delivered broker item, else null.
  pendingRequest(requestId: RequestId): SessionEvent | null {
    return this.liveItems.has(requestId) ? (this.requests.get(requestId) ?? null) : null;
  }

  // `session.events`: every event after `afterSeq` (null: from the start of this launch), whole rows at a time up to
  // about `limit`; `complete` is false when the answer stops short (the limit, or a journal that cannot be read back).
  async snapshot(afterSeq: number | null, limit: number | null): Promise<EventsSnapshot> {
    let source: SessionEvent[];
    let complete = true;
    if (this.evictedThrough === null || (afterSeq !== null && afterSeq >= this.evictedThrough)) {
      source = this.ring;
    } else {
      const rebuilt = await this.fromJournal();
      source = rebuilt ?? this.ring;
      complete = rebuilt !== null;
    }
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

  dispose(): void {
    this.flush();
  }

  private emitBatch(events: SessionEvent[]): void {
    this.opts.emit('session.eventBatch', { appSessionId: this.opts.appSessionId, events });
  }

  // The launch's journal files (the base file, then its rotations) through a fresh normaliser; null when they cannot
  // be read back whole (a rotated file pruned, a file removed by an archive).
  private async fromJournal(): Promise<SessionEvent[] | null> {
    const prefix = `${basename(this.opts.journalPath, '.jsonl')}.`; // `<file id>.jsonl`, then `<file id>.<n>.jsonl`
    const files = JournalReader.forSession(dirname(this.opts.journalPath)).filter((file) => basename(file).startsWith(prefix));
    if (files.length === 0) return null;
    const normalizer = new Normalizer({ appSessionId: this.opts.appSessionId, launchId: this.opts.launchId, sessionId: this.opts.sessionId });
    const events: SessionEvent[] = [];
    let expected = 1;
    try {
      for (const file of files) {
        for await (const row of JournalReader.rows(file)) {
          if (row.seq !== expected) return null; // a gap: part of the launch is gone
          expected += 1;
          events.push(...normalizer.push(row as JournalRow));
        }
      }
    } catch {
      return null;
    }
    return events;
  }
}
