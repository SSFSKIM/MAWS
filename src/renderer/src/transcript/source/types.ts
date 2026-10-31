// The transcript's input (C6 execution document, Public surface): a source of X1 event batches under the hydration
// protocol, and the player the harness and tests drive a replay with.
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, MessageUuid } from '@shared/graph/ids';
import type { StoreApi } from 'zustand';

export interface TranscriptSource {
  subscribe(listener: (events: SessionEvent[]) => void): () => void; // batches, in order; the store calls it first
  snapshot(): Promise<SessionEvent[]>; // everything so far; called once, after subscribe
  readonly key?: string; // additive: the store key (`appSessionId`, or `appSessionId:agentId`); absent, the transcript keys the source object
  readonly agentId?: AgentId; // additive: set on a child's source
  // Additive (child source provenance): the source's history changed form (a live child switched to its disk
  // transcript), so the store clears the key's state and runs the hydration protocol again.
  onReset?(listener: () => void): () => void;
  // Additive (the long-transcript window, docs/doperpowers/plans/2026-10-30-long-transcript-window.md): an older page
  // joined the source's history, so the store hydrates the key again from `snapshot()`, staged, keeping what the reader
  // opened; and the older pages themselves, asked as the reader reaches the top (lane A's rule, `useOlderPages`).
  onRebuild?(listener: () => void): () => void;
  readonly older?: OlderPages;
}

// A history the host answers one window at a time: whether older history remains, a page on its way, the last page
// that failed and why, and `revision`, which changes with each page the history took in.
export interface OlderPagesState {
  more: boolean;
  loadingOlder: boolean;
  olderFailed: string | null;
  revision: number;
}

export interface OlderPages {
  readonly state: StoreApi<OlderPagesState>;
  loadOlder(): void;
  // Additive: a jump to a message older than what is loaded walks back to the page holding it (older.ts `seek`), and
  // the reader may give up on the way.
  seek?(target: MessageUuid, progress?: (share: number) => void): Promise<SeekResult>;
  stopSeek?(): void;
}

// How a seek ended: the message's page is in (`found`, the key rebuilding); the message is not older than what is loaded
// (`held`: in it, on its way, or in no page the source can ask); in none of the history (`absent`); given up or
// superseded (`stopped`); or a page did not load (`failed`).
export type SeekResult = { outcome: 'found' | 'held' | 'absent' | 'stopped' } | { outcome: 'failed'; error: string };

export interface Player {
  play(): void;
  pause(): void;
  step(): void;
  seek(seq: number): void;
  readonly done: boolean;
}
