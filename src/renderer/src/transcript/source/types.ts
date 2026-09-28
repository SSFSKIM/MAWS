// The transcript's input (C6 execution document, Public surface): a source of X1 event batches under the hydration
// protocol, and the player the harness and tests drive a replay with.
import type { SessionEvent } from '@shared/graph/events';

export interface TranscriptSource {
  subscribe(listener: (events: SessionEvent[]) => void): () => void; // batches, in order; the store calls it first
  snapshot(): Promise<SessionEvent[]>; // everything so far; called once, after subscribe
}

export interface Player {
  play(): void;
  pause(): void;
  step(): void;
  seek(seq: number): void;
  readonly done: boolean;
}
