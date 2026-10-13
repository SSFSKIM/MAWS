// The two seams of the portable artifact layer (§4.10 of docs/doperpowers/plans/2026-10-12-p3-co-work.md, X24):
// `DocumentStorage`, behind which the engine host's document service keeps its documents (SQLite now, a network store in
// P4), and `ArtifactHost`, the one adapter through which an editor under `src/artifacts/` reaches its environment (the
// renderer's implementation over main's ports now, a web client's in P4). Shapes from the P3-A document's Interfaces.
import type { Awareness } from '@y/protocols/awareness';
import type { Actor } from '@shared/artifacts/actor';
import type { Restored, SaveState } from './provider/port';
import type { Doc } from './yjs';

// What a document loads from: the latest retained version state (V2) and the log rows (V1) after it.
export interface StoredDoc {
  version: { seq: number; state: Uint8Array } | null;
  updates: { seq: number; bytes: Uint8Array }[];
}

export interface DocumentStorage {
  load(artifactId: string): StoredDoc;
  // Appends one log row, its provenance map and the bindings of clientIDs first seen in it to the open batch (opening
  // one if none is), and returns the row's seq: the live revision it makes.
  appendInBatch(row: { artifactId: string; actor: Actor; at: number; update: Uint8Array; provenance: Uint8Array; bindClients: number[] }): number;
  commit(): void; // ends the open batch durably (one fsync); a no-op when none is open
  rollback(): void;
  revision(artifactId: string): number;
  compact(artifactId: string, upToSeq: number): void;
  provenance(artifactId: string): Uint8Array[]; // encoded ContentMaps
  clientActor(artifactId: string, clientId: number): Actor | null;
  close(): void;
}

// An open document as an editor holds it: a replica kept in sync with the host over a port, reconnecting by itself.
export interface DocumentHandle {
  readonly doc: Doc;
  readonly awareness: Awareness;
  state(): SaveState;
  subscribe(listener: (state: SaveState) => void): () => void;
  // A restore this replica did not witness landed (Decision Log 16): drop undo history across it, say "Restored from …".
  onRestored(listener: (restored: Restored) => void): () => void;
  close(): void;
}

export interface ArtifactHost {
  open(artifactId: string): Promise<DocumentHandle>;
  assetUrl(artifactId: string, ref: string): string;
  export(artifactId: string, format: string, version?: number): Promise<{ path: string }>;
  identity(): { actor: Actor; name: string; color: string };
}
