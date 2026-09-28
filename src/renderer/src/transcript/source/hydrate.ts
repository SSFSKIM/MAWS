// The hydration protocol (C6 execution document, Public surface), once, framework-free, for the store to wrap:
// subscribe first and buffer every batch while hydrating; apply the snapshot; drain the buffer in arrival order,
// dropping every event whose id was already applied; then go live, still dropping applied ids (a live batch can
// overlap the snapshot's tail, and disk-derived events carry `seq: null`, so `id` is the only key). Events reach
// `apply` as snapshot, then buffered batches, then live batches, none twice and none reordered within its batch.
import type { SessionEvent } from '@shared/graph/events';
import type { EventId } from '@shared/graph/ids';
import type { TranscriptSource } from './types';

export interface HydrationSink {
  apply(events: SessionEvent[]): void; // one call per batch, in order
  has(id: EventId): boolean; // an id already applied (the reducer's `seen`)
}

export interface Attachment {
  hydrated: Promise<void>;
  detach(): void;
}

export function attachSource(source: TranscriptSource, sink: HydrationSink): Attachment {
  let phase: 'hydrating' | 'draining' | 'live' | 'detached' = 'hydrating';
  const buffer: SessionEvent[][] = [];
  const applyNew = (events: SessionEvent[]) => {
    const fresh = events.filter((event) => !sink.has(event.id));
    if (fresh.length > 0) sink.apply(fresh);
  };
  const unsubscribe = source.subscribe((events) => {
    if (phase === 'live') applyNew(events);
    else if (phase !== 'detached') buffer.push(events);
  });
  const hydrated = source.snapshot().then((snapshot) => {
    if (phase === 'detached') return;
    applyNew(snapshot);
    phase = 'draining';
    while (buffer.length > 0) applyNew(buffer.shift()!); // a batch arriving during the drain joins the tail
    phase = 'live';
  });
  return {
    hydrated,
    detach() {
      phase = 'detached';
      buffer.length = 0;
      unsubscribe();
    },
  };
}
