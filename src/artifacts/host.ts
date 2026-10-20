// The two seams of the portable artifact layer (§4.10 of docs/doperpowers/plans/2026-10-12-p3-co-work.md, X24):
// `DocumentStorage`, behind which the engine host's document service keeps its documents (SQLite now, a network store in
// P4), and `ArtifactHost`, the one adapter through which an editor under `src/artifacts/` reaches its environment (the
// renderer's implementation over main's ports now, a web client's in P4). Shapes from the P3-A document's Interfaces.
import type { Awareness } from '@y/protocols/awareness';
import type { ArtifactProvisional } from '@shared/artifacts/provisional'; // P4-A2 (X35)
import type { Actor } from '@shared/artifacts/actor';
import type {
  ConnectorCallOptions, // E3
  ConnectorCallOutcome,
  ConnectorCallRequest,
  ConnectorDeclareOutcome,
  ConnectorGrant,
  ConnectorGrantGesture,
  ConnectorGrantOutcome,
  ConnectorToolRef,
  ConnectorWatchRequest,
  ConnectorWatchStart,
} from '@shared/artifacts/connectors';
import type { ArtifactKind } from '@shared/artifacts/entity';
import type { Restored, SaveState } from './provider/port';
import type { Carry, ContentIds, Doc, SuggestionRange } from './yjs';
import type { Cell, DatasetColumn, DatasetFormat } from './dashboard/datasets'; // P3-E

// P3-E: a page of `ArtifactHost.readDataset`
export interface DatasetPage {
  columns: DatasetColumn[];
  rows: Cell[][];
  total: number;
  truncated: boolean;
}

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
  // first carry authorship onto it, Decision Log 25j). `credit` binds named clientIDs among `bindClients` to another
  // actor than the row's: an accepted suggestion's copy, written by the acceptor under a clientID bound to the
  // suggester (Decision Log 45).
  appendInBatch(row: { artifactId: string; actor: Actor; at: number; update: Uint8Array; provenance?: Uint8Array; bindClients: number[]; hostClient?: number; credit?: Map<number, Actor> }): number;
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
  // A new document's first content (Decision Log 44c, parent 48), written by the host when the creator gives none, in
  // the create's commit and credited to the creator, so two replicas never each seed a first tab of their own.
  initial?(doc: Doc, info: { title: string }): void;
  // P4 (W1, L277): a duplicate's kind after-effects, written in the copy's own write over the source's state (live or a
  // version's) and credited to the duplicator; `title` is the source's title as the copy is made.
  copied?(doc: Doc, info: { title: string }): void;
  readFiles?(doc: Doc): Record<string, string>; // M6
  publish?(live: Doc, base: Record<string, string>, sent: Record<string, string | null>, force: boolean): { changed: string[]; conflicts: { path: string; detail?: string }[] }; // M6
  // P3-C (the parent's Decision Log 58): the paths `readFiles` would answer, in its order, without their text; a publish
  // builds its answer's `kept` and `removed` from them. Without it, the paths of `readFiles` (or the generic file model).
  paths?(doc: Doc): string[];
  // P3-E (docs/doperpowers/plans/2026-10-16-p3-e-design-dashboard.md Decision Log 11 (1)): brings a document an earlier
  // build stored in another shape into the kind's current model, in the caller's transaction, answering whether it
  // wrote; a document already in the model answers false and writes nothing. Input it cannot migrate throws before
  // anything is written. The store runs it through `ArtifactStore.ensureMigrated` (a scratch test, then one write
  // credited to the triggering actor) before a live open, read or write; retained versions are never migrated.
  migrate?(doc: Doc): boolean;
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
  // P4-A2 (X35): the host's provisional frames for this doc, an agent's edit as it streams (`src/shared/artifacts/
  // provisional.ts`), each delivered after the frames it arrived with are applied; `state().integrated` against a
  // `committed` frame's `commitSeq` says whether its write is on the page.
  onProvisional(listener: (frame: ArtifactProvisional) => void): () => void;
  // The composition hold (Decision Log 20, 25k): set at composition start, cleared when composing stops.
  holdRemote(on: boolean): void;
  close(): void;
}

// Which of an artifact's documents (Decision Log 45): `suggestions`, its suggestion doc (the artifact with its pending
// proposals on it, a suggestion doc on the replica's side too); omitted, the artifact's own.
export interface ArtifactDocOption {
  doc?: 'suggestions';
}

// P3-H H4: an artifact page's connector calls (the X9 amendment's bridge; docs/doperpowers/plans/2026-10-12-p3-co-work.md,
// P3-H and Decision Log 24, 80 and 84; P3-E's XE8). One surface per page load: main holds its lease, which starts hidden
// and ends with `close`, the page's window going, or the app quitting. A declaration grants nothing; only the owner's
// grant (below) admits a call, and only a visible surface calls anything, its watches included. No answer carries an
// error's words: a refusal is a state and a reason from `ConnectorRefusal`'s closed lists. A surface whose lease could
// not be opened, or one already closed, answers `invalid: lease` (false for `unwatchTool` and `refreshWatch`) without
// asking main; nothing answered after `close` is published (a call in flight reads `paused: closed`, a declaration or
// a watch's start `invalid: lease`, and no listener hears anything more); a command main cannot be reached for rejects,
// as the other methods do.
export interface ConnectorSurface {
  // Adds `server · tool` pairs the page may call; answers everything the surface has declared.
  declareTools(tools: readonly ConnectorToolRef[]): Promise<ConnectorDeclareOutcome>;
  // Runs a declared tool once, answering when it has (a tool may take minutes). E3
  // (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): `options`, the trusted owner's alone (an artifact
  // page's relay never passes it): the result becomes the dataset's snapshot in the host, and the outcome's `result` is
  // the publication's metadata, never the rows.
  callTool(request: ConnectorCallRequest, options?: ConnectorCallOptions): Promise<ConnectorCallOutcome>;
  // Refreshes a declared read-only tool every `intervalMs` (clamped to 30 s .. 24 h, at most 64 watches in the app) while
  // the surface is visible, each refresh's outcome to `listener`; one due while hidden runs once when shown. The listener
  // may hear a first refresh before the start's promise settles.
  // E3: `options`, the owner's dataset sink as for `callTool`, naming no `baseRevision` (each refresh takes the host's).
  watchTool(request: ConnectorWatchRequest, listener: (update: ConnectorCallOutcome) => void, options?: ConnectorCallOptions): Promise<ConnectorWatchStart>;
  unwatchTool(watchId: string): Promise<boolean>;
  // A refresh now, when the watch is visible, granted and idle (after the owner started a session, say).
  // E3 panel (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md, Decision Log 17): `options.probe`, the trusted
  // owner's alone (an artifact page's relay never passes it): whether its dataset watch still lives, nothing more (no
  // wake, grant check, call or schedule change); false for a handle gone, another's, or not a dataset watch.
  refreshWatch(watchId: string, options?: { probe?: boolean }): Promise<boolean>;
  // The trusted owner's alone (an artifact page never sets it): whether the page is on screen.
  setVisible(visible: boolean): void;
  close(): void;
}

export interface ArtifactHost {
  open(artifactId: string, options?: ArtifactDocOption): Promise<DocumentHandle>; // resolves once the replica has synced; rejects if the store refuses it
  // P3-D (the P3 spec's Decision Log 59): `revision` names a retained revision (a design-system pin's `versionSeq`), at
  // which the store serves a deleted system's assets while a version pins it (Decision Log 46); omitted, the live one.
  assetUrl(artifactId: string, ref: string, revision?: number): string;
  export(artifactId: string, format: string, version?: number, options?: { pageSize?: 'letter' | 'a4'; fonts?: 'named' | 'basic' | 'pictures' | 'embedded' /* P3-C (H2-4) */; board?: string; boards?: string[]; scale?: number /* P3-E (E1 M5; X23): a design's */ }): Promise<{ path: string }>; // M7; `pageSize`: Decision Log 42
  versionState(artifactId: string, version: number | { seq: number }): Promise<Uint8Array>; // V2 bytes (Decision Log 22c)
  attributions(artifactId: string, fromSeq: number, toSeq: number, options?: ArtifactDocOption): Promise<Uint8Array>; // a merged ContentMap (23a)
  // The owner settles proposals of the suggestion doc (Decision Log 45): ranges are the item ids the editor's selection
  // resolves to; the answer is the artifact's revision after the accept's copy (or the reject's restored content).
  acceptSuggestion(artifactId: string, ranges: SuggestionRange[]): Promise<{ revision: number }>;
  rejectSuggestion(artifactId: string, ranges: SuggestionRange[]): Promise<{ revision: number }>;
  uploadAsset(artifactId: string, bytes: Uint8Array, meta: { name: string; mime: string }): Promise<{ assetId: string; ref: string }>; // 25l
  // P3-C (Decision Log 25; the parent's 65): one artifact's asset copied into another by the store, bytes and mime
  // unchanged; answers the target's ref (an existing one for identical bytes).
  copyAsset(from: string, ref: string, to: string): Promise<{ assetId: string; ref: string }>;
  // P3-E (docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md M2; ledger X23, E's Decision Log 6 and 8): one page of a
  // dataset snapshot, the asset `ref` read in the `format` the displayed descriptor names, parsed by the host; at most
  // `limit` rows (DATASET_READ_MAX_ROWS) and DATASET_READ_MAX_BYTES of JSON, so a caller continues at `offset` plus the
  // rows answered, never assuming `limit`. The only route to a dataset's rows (the renderer never fetches bytes).
  readDataset(artifactId: string, ref: string, options: { format: DatasetFormat; offset?: number; limit?: number }): Promise<DatasetPage>;
  // P3-E (E2 M3; ledger X23, E's Decision Log 18): the owner saves one of the artifact's own assets (a dataset snapshot,
  // by the displayed descriptor's ref) where they choose, `name` the suggestion; `path` null when they cancel. Main reads
  // and copies the bytes; the editor never fetches them.
  downloadAsset(artifactId: string, ref: string, options?: { name?: string }): Promise<{ path: string | null }>;
  // E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b; the ledger's E3 hold-IPC row): one hold over the
  // snapshots `refs` names (1 to 64 of the artifact's assets), all or none, so their bytes outlast a refresh retiring
  // them while this window still reads them (the source sheet's captured snapshots, the painted cache's). It is main's,
  // bound to this window: released by `release` (once, however often called) or when the window closes or navigates.
  // Rejects with nothing held when a ref is no longer available or the artifact's hold bounds are reached.
  // `invalidated` resolves once the host's hold behind it is gone (the engine host restarted: holds live as long as its
  // process), including a restart while the hold was being asked for; it never resolves after `release`.
  holdDatasets(artifactId: string, refs: readonly string[]): Promise<{ release(): void; readonly invalidated: Promise<void> }>;
  identity(): { actor: Actor; name: string; color: string };
  // P3-F (F1): a link an editor's owner opens (a modifier-click on it), handed to the environment's external opener: the
  // renderer's is main's one scheme-checked `layout.openExternal` (http, https and mailto leave the app; the rest is
  // refused there and only logged). Optional: a host with no outside to open into omits it, and the click opens nothing.
  openExternal?(url: string): void;
  // P3-H H4 (the X9 amendment, Decision Log 80): a page's connector surface, and the owner's grants of one artifact's
  // tools (the editor header's, never a page's). A grant is taken under the fingerprint of the route that has the tool
  // now, so with no live route it answers `paused: noRoute`; a `read` grant needs a tool the route marks read-only
  // (`invalid: notReadOnly` otherwise; an Allow once serves the one call it admits). A revoke stops the tool's calls and
  // watches for the artifact at once; it answers whether there was a grant.
  openConnectors(artifactId: string): ConnectorSurface;
  connectorGrants(artifactId: string): Promise<ConnectorGrant[]>;
  grantConnectorTool(artifactId: string, tool: ConnectorGrantGesture): Promise<ConnectorGrantOutcome>;
  revokeConnectorTool(artifactId: string, tool: ConnectorToolRef): Promise<boolean>;
}
