// The two seams of the portable artifact layer (§4.10 of docs/doperpowers/plans/2026-10-12-p3-co-work.md, X24):
// `DocumentStorage`, behind which the engine host's document service keeps its documents (SQLite now, a network store in
// P4), and `ArtifactHost`, the one adapter through which an editor under `src/artifacts/` reaches its environment (the
// renderer's implementation over main's ports now, a web client's in P4). Shapes from the P3-A document's Interfaces.
import type { Awareness } from '@y/protocols/awareness';
import type { Actor } from '@shared/artifacts/actor';
import type { ArtifactKind } from '@shared/artifacts/entity';
import type { Restored, SaveState } from './provider/port';
import type { Carry, ContentIds, Doc } from './yjs';

// One row of the threads mirror (`artifact_threads`), which P3-B's adapter keeps from the doc's comment threads so the
// library and the session panel can list them without opening the doc (Decision Log 23c).
export interface ThreadRow {
  threadId: string;
  status: 'open' | 'resolved';
  quote: string;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  appSessionId?: string;
}
export interface ThreadChange {
  upsert?: ThreadRow[];
  remove?: string[]; // thread ids
}

// A kind's restore scope (`revertScope`): the changes since the version that the restore leaves in place.
export interface RevertScope {
  keep: ContentIds;
}

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
  // host's replica that wrote the row, if one did, so its binding is marked as the host's for that actor. Without
  // `provenance` the row's map is written later in the same frame by `attributeInBatch` (a kind's `afterUpdate` may
  // first carry authorship onto it, Decision Log 25j).
  appendInBatch(row: { artifactId: string; actor: Actor; at: number; update: Uint8Array; provenance?: Uint8Array; bindClients: number[]; hostClient?: number }): number;
  attributeInBatch(row: { artifactId: string; seq: number; at: number; provenance: Uint8Array }): void;
  // The threads mirror a kind's hooks feed (Decision Log 23c), written in the open batch with the update.
  writeThreads(artifactId: string, change: ThreadChange): void;
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
//
// What `afterUpdate` and `afterRestore` return lands in the same commit batch: thread rows for the threads mirror
// (Decision Log 23c), and from `afterUpdate` the moves and retypes whose authorship the update's attribution row carries
// over (Decision Log 25j; that row is written after the hook returns).
//
// Every hook given a Doc is also given `info.artifactId`, the host document's key (the artifact's id, or a suggestion
// doc's `<artifactId>:suggest`), so a kind can keep per-artifact state (Decision Log 27).
export interface KindAdapter {
  kind: ArtifactKind;
  beforeApply?(live: Doc, incoming: Uint8Array, info: { artifactId: string; actor: Actor; step2: boolean }): ((live: Doc) => void) | null;
  afterUpdate?(live: Doc, info: { artifactId: string; update: Uint8Array; actor: Actor }): void | { threads?: ThreadChange; provenance?: Carry[] };
  // The turn version's summary over the results of the session's tool calls on the artifact that turn (Decision Log
  // 23f); without it, "N edits".
  summarizeTurn?(results: unknown[]): string;
  // What a restore leaves in place among the changes made since the version (`keep`: e.g. the messages posted to a
  // thread; parent Decision Log 32): `live` is the live doc, `old` a doc of the version's state, both read-only. Without
  // the hook, or answering null, a restore reverts everything since the version.
  revertScope?(live: Doc, old: Doc, info: { artifactId: string }): RevertScope | null;
  // A restore's kind after-effects (orphaned threads, id repair), written in the restore's commit (Decision Log 16);
  // `versionId` is the version restored from.
  afterRestore?(live: Doc, info: { artifactId: string; versionId: number }): void | { threads?: ThreadChange };
  readFiles?(doc: Doc): Record<string, string>; // M6
  publish?(live: Doc, base: Record<string, string>, sent: Record<string, string | null>, force: boolean): { changed: string[]; conflicts: { path: string; detail?: string }[] }; // M6
}

// What an editor shows of an open document (P3-G's header maps it: `unsaved > 0` while live is saving, phase `off` is
// reconnecting, `readOnly` is read-only): the provider's SaveState, and whether the store is read-only (a newer app
// wrote it, Decision Log 12), in which case the host refuses every write.
export interface DocumentState extends SaveState {
  readOnly: boolean;
}

// An open document as an editor holds it: a replica kept in sync with the host over a port, reconnecting by itself.
export interface DocumentHandle {
  readonly doc: Doc;
  readonly awareness: Awareness;
  state(): DocumentState;
  subscribe(listener: (state: DocumentState) => void): () => void;
  // A restore this replica did not witness landed (Decision Log 16): drop undo history across it, say "Restored from …".
  onRestored(listener: (restored: Restored) => void): () => void;
  // The composition hold (Decision Log 20, 25k): set at composition start, cleared when composing stops.
  holdRemote(on: boolean): void;
  close(): void;
}

export interface ArtifactHost {
  open(artifactId: string): Promise<DocumentHandle>; // resolves once the replica has synced; rejects if the store refuses it
  assetUrl(artifactId: string, ref: string): string;
  export(artifactId: string, format: string, version?: number): Promise<{ path: string }>;
  versionState(artifactId: string, version: number | { seq: number }): Promise<Uint8Array>; // V2 bytes (Decision Log 22c)
  attributions(artifactId: string, fromSeq: number, toSeq: number): Promise<Uint8Array>; // a merged ContentMap (23a)
  uploadAsset(artifactId: string, bytes: Uint8Array, meta: { name: string; mime: string }): Promise<{ assetId: string; ref: string }>; // 25l
  identity(): { actor: Actor; name: string; color: string };
}
