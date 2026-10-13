// The two seams of the portable artifact layer (§4.10 of docs/doperpowers/plans/2026-10-12-p3-co-work.md, X24):
// `DocumentStorage`, behind which the engine host's document service keeps its documents (SQLite now, a network store in
// P4), and `ArtifactHost`, the one adapter through which an editor under `src/artifacts/` reaches its environment (the
// renderer's implementation over main's ports now, a web client's in P4). Shapes from the P3-A document's Interfaces.
import type { Awareness } from '@y/protocols/awareness';
import type { Actor } from '@shared/artifacts/actor';
import type { ArtifactKind } from '@shared/artifacts/entity';
import type { Restored, SaveState } from './provider/port';
import type { Doc } from './yjs';

// What a document loads from (the P3-A document's Decision Log 8): the head checkpoint (a V2 state at `seq`) and the
// log rows (V1) after it, the clientIDs bound to actors (Decision Log 6; `host` marks the clientID the host's own
// replica of that actor writes under) and the latest restore, which every attach re-announces (Decision Log 16).
export interface StoredDoc {
  head: { seq: number; state: Uint8Array } | null;
  updates: { seq: number; bytes: Uint8Array }[];
  clients: { clientId: number; actor: Actor; host: boolean }[];
  restored: Restored | null;
}

export interface DocumentStorage {
  // A store a newer app wrote (Decision Log 12): readable, and every write throws `storeTooNew`.
  readonly readOnly: boolean;
  load(artifactId: string): StoredDoc;
  // Appends one log row, its provenance map and the bindings of clientIDs first seen in it to the open batch (opening
  // one if none is), and returns the row's seq: the live revision it makes. `hostClient` names the clientID of the
  // host's replica that wrote the row, if one did, so its binding is marked as the host's for that actor.
  appendInBatch(row: { artifactId: string; actor: Actor; at: number; update: Uint8Array; provenance: Uint8Array; bindClients: number[]; hostClient?: number }): number;
  // One incoming frame's rows inside the batch (a savepoint): `abortFrame` takes back exactly that frame's rows, so a
  // hook that throws after the apply leaves nothing half-applied in the batch (Decision Log 21).
  beginFrame(): void;
  endFrame(): void;
  abortFrame(): void;
  commit(): void; // ends the open batch durably (one fsync); a no-op when none is open
  rollback(): void;
  revision(artifactId: string): number;
  // Rewrites the head checkpoint (Decision Log 8). Outside a batch: the state must be exactly what is committed at `seq`.
  writeHead(artifactId: string, seq: number, state: Uint8Array): void;
  provenance(artifactId: string): Uint8Array[]; // encoded ContentMaps, oldest first
  clientActor(artifactId: string, clientId: number): Actor | null;
  close(): void;
}

// A kind's host-side behaviour (Decision Log 18 and 21): B, C, D and E register theirs; a kind without one is the
// generic model, which needs none. The service calls the content hooks inside the one commit batch of the incoming
// frame: `beforeApply` with the raw bytes before they are applied (an edit landing in a tombstoned block is collected
// on arrival), then the apply, then the forwarding edit it returned, then `afterUpdate`. The doc the forwarding edit and
// `afterUpdate` are given is the host's replica of the incoming actor, a synchronous mirror of the live doc: what they
// write lands as that actor's own update and log row (X29 has no system actor). A hook that throws before the apply
// rejects the frame; after it, the frame's rows are taken back and the document is evicted.
export interface KindAdapter {
  kind: ArtifactKind;
  beforeApply?(live: Doc, incoming: Uint8Array, info: { actor: Actor; step2: boolean }): ((live: Doc) => void) | null;
  afterUpdate?(live: Doc, info: { update: Uint8Array; actor: Actor }): void;
  revertScope?(live: Doc, old: Doc): unknown; // names what a restore reverts; posted conversations are always kept (M3)
  afterRestore?(live: Doc, restoredFrom: { versionId: number }): void; // kind after-effects of a restore (M3)
  readFiles?(doc: Doc): Record<string, string>; // M6
  publish?(live: Doc, base: Record<string, string>, sent: Record<string, string | null>, force: boolean): { changed: string[]; conflicts: { path: string; detail?: string }[] }; // M6
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
