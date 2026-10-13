// The document service (X24; parent §4.2; docs/doperpowers/plans/2026-10-12-p3-a-store.md, M2 and Decision Log 5, 6,
// 8, 9, 16, 18 and 21): one authoritative Y.Doc per open artifact in the engine host, served to replicas over ports.
// P3-0's S2 `DocumentService` on v14 (`spikes/p3-store/s2/v14/host/document-service.ts`), copied, with the store's rules.
//
// Writers. A replica is a renderer (one port per open editor, attached by main with the human as actor), an agent
// session's own in-process replica (replica.ts), or the host's replica of one actor: a synchronous mirror of the live doc
// through which host-originated writes (`writeAs`: restore, the test writer) and the kinds' hooks write, so every log
// row has a writer and an actor (X29 has no system actor). The live doc is never edited directly. A connection's actor
// is fixed by whoever attached it, never by the replica's bytes.
//
// Durability (Decision Log 26). An update's log row, its provenance row and its new clientID bindings join a batch that
// commits once per event-loop turn (group commit); every frame that reveals the row (the broadcast, a step 2, the ack,
// a `writeAs` answer, `onCommitted`) waits in the outbox until that commit returns. A lost batch (a commit failure, or
// SQLite rolling the whole transaction back under a frame) drops the open docs unsent and closes their connections; the
// replicas' next step 2 re-sends what the store lacks.
//
// Untrusted bytes. A frame that does not decode, a host-only frame, an update that fails the binding module's check, a
// new struct under a clientID bound to another actor (Decision Log 6), or anything that throws closes that connection;
// the doc and the other connections go on. Each content frame runs inside a savepoint of the batch: the kind's
// `beforeApply` with the raw bytes, the apply, the forwarding edit it returned, `afterUpdate` (Decision Log 18 and 21).
// If anything fails after the apply (a hook, or state the check let through left pending), the frame's rows are taken
// back, nothing of it is sent, and the doc is evicted: dropped with its connections, reloaded by the next attach. Every
// row the frame writes (its own update, the forwarding edit, `afterUpdate`'s write) gets its attribution row after
// `afterUpdate` returns, so authorship the hook carries (a move, a retype) lands in each of them; the thread rows the
// hooks return are written in the same savepoint (Decision Log 23c, 25j, 29a).
//
// Memory (Decision Log 29b; parent Decision Log 37). A document nobody holds (no renderer and no agent replica attached)
// stays loaded for `IDLE_UNLOAD_MS` after its last connection closes or its last committed write, so a window reopened
// within that time gets the same doc without a reload; then it is unloaded. Shutdown unloads at once.
//
// The artifact store (store.ts, M3) writes its own rows (entities, versions, ops) through `inBatch` and a write's
// `inFrame`, inside the same batch, so they too commit before anything reveals them.
import { MessageChannel } from 'node:worker_threads';
import * as awarenessProtocol from '@y/protocols/awareness';
import type { DocumentStorage, KindAdapter, ThreadChange } from '@artifacts/host';
import { decodeFrame, encodeFrame, type Frame } from '@artifacts/provider/frames';
import type { PortLike, Restored } from '@artifacts/provider/port';
import {
  adoptClientId,
  applyV1,
  applyV2,
  attributionMap,
  carryAttribution,
  checkUpdate,
  contentIdsOf,
  decodeMap,
  diffV1,
  encodeMap,
  hasPending,
  insertedClients,
  mergeMaps,
  newDoc,
  newSuggestionDoc,
  newStructClients,
  onUpdate,
  stateV2,
  stateVector,
  transact,
  wouldChange,
  clientAbove,
  planAccept,
  planReject,
  type Carry,
  type ContentMap,
  type SuggestionPlan,
  type SuggestionRange,
  type Doc,
} from '@artifacts/yjs';
import { actorKey, type Actor } from '@shared/artifacts/actor';
import type { ArtifactKind } from '@shared/artifacts/entity';
import type { AppSessionId } from '@shared/graph/ids';
import { StoreTooNewError } from './errors';
import { fromNodePort, type HostPort } from './ports';
import { AgentReplica } from './replica';

export const HEAD_TAIL_ROWS = 2_000; // the head is rewritten once the log tail behind it passes this many rows …
export const HEAD_TAIL_BYTES = 1024 * 1024; // … or this many bytes (Decision Log 8)
export const REPLICA_IDLE_MS = 10 * 60_000; // an agent replica closes after this long without a call (Decision Log 9)
export const IDLE_UNLOAD_MS = 60_000; // a document nobody holds is unloaded after this long (Decision Log 29b)
const REJECTIONS_KEPT = 100;

export interface Connection {
  readonly kind: 'connection';
  readonly id: number;
  readonly artifactId: string;
  readonly actor: Actor;
  readonly key: string; // actorKey(actor)
  received: number; // content frames received (what an ack counts)
  ackDue: boolean;
  closed: boolean;
  readonly awarenessClients: Set<number>;
  readonly port: HostPort;
}

// The host's replica of one actor on one doc (Decision Log 18): a mirror of the live doc whose own writes land in the
// live doc as that actor's update. Its clientID is bound to the actor and reused across reloads.
interface HostReplica {
  readonly kind: 'replica';
  readonly actor: Actor;
  readonly key: string;
  readonly doc: Doc;
  readonly off: () => void;
  reading: boolean; // inside `readAs`: an edit is refused, never relayed to the live doc
  editedWhileReading: boolean;
  copy?: true; // a one-off writer of an accepted suggestion's copy, under a clientID bound to the suggester
}

type Writer = Connection | HostReplica;

interface HostDoc {
  readonly id: string;
  kind: ArtifactKind | null; // read at open; a doc opened before its entity row takes it after `prepare` (writeAs)
  readonly doc: Doc;
  readonly awareness: awarenessProtocol.Awareness;
  readonly conns: Set<Connection>;
  readonly replicas: Map<string, HostReplica>; // by actor key
  readonly bindings: Map<number, string>; // clientID → actor key
  readonly hostClients: Map<string, number>; // actor key → the host replica's clientID
  revision: number;
  tailRows: number; // log rows behind the head
  tailBytes: number;
  restored: Restored | null; // the latest restore, re-announced after every step 2
  provenance: { merged: ContentMap | null; pending: ContentMap[] };
  lastApplied: Uint8Array | null; // the update the last apply integrated, if any
  // From a frame's own update until the kind's `afterUpdate` has returned, the attribution rows of every update the frame
  // writes wait here, in seq order, so the authorship the hook carries applies to each (Decision Log 25j, 29a); written
  // in the same savepoint. Null outside that span: a row is attributed as it is written.
  deferred: { seq: number; at: number; map: ContentMap }[] | null;
  // While an accepted suggestion's copy is written (Decision Log 45): the clientID it is written under and the suggester
  // that clientID is bound to, in place of the writer.
  credit: Map<number, Actor> | null;
  readonly loadMs: number;
  idleTimer: ReturnType<typeof setTimeout> | null; // set while nobody holds the doc: its unload
}

// One artifact's rows in a commit: the revision they reached and who wrote them (the store's change feed, its version
// scheduler and the turn versions read these).
export interface Committed {
  artifactId: string;
  revision: number;
  actors: Actor[];
}

// A host-originated write's companions inside its savepoint (Decision Log 11, 16): `prepare` writes rows the edit
// stands on before it (a copy's entity row, Decision Log 37c: the doc's kind, and so its adapter, is read after it);
// `afterWrite` writes through the same host replica after the edit and its `afterUpdate` (a restore's `afterRestore`),
// its thread rows landing in the batch; `inFrame` writes rows that must commit with the write or not at all (a version,
// an op), given the revision reached.
export interface WriteOptions {
  prepare?: () => void;
  afterWrite?: (doc: Doc) => void | { threads?: ThreadChange };
  inFrame?: (revision: number) => void;
}

export interface ServiceStats {
  framesIn: number;
  contentFramesIn: number;
  rowsAppended: number;
  commits: number;
  rejections: number;
  rejected: { reason: string; conn: number }[]; // the latest REJECTIONS_KEPT
  lostBatches: number; // batches taken back whole (a failed commit, a savepoint that could not be undone)
}

export interface ServiceOptions {
  now?: () => number;
  log?: (line: string) => void;
  defer?: (run: () => void) => void; // when the batch commits; the next event-loop turn by default
  adapters?: KindAdapter[];
  kindOf?: (artifactId: string) => ArtifactKind | null; // the artifact's kind from its entity row (M3)
  headTailRows?: number;
  headTailBytes?: number;
  replicaIdleMs?: number;
  idleUnloadMs?: number;
}

const LOAD = Symbol('load'); // the origin of a load's applies, which are already in the log
const MIRROR = Symbol('mirror'); // the origin of the live doc's updates applied to a host replica
const BASE = Symbol('base'); // the origin of a main doc's update flowing into its suggestion doc, logged in the main doc's log

// An artifact's suggestion doc (M8; Decision Log 23e, S1's topology) is the document stored under this key: a gc-off
// doc that holds the main doc and, on top of it, the proposals written to it. It is loaded as the main doc's state plus
// its own head and rows, and while it is loaded every update the main doc integrates flows into it unlogged (the main
// doc's own row already holds it), so its log holds only what was written to it.
export const SUGGESTION_SUFFIX = ':suggest';
export const suggestionKey = (artifactId: string): string => `${artifactId}${SUGGESTION_SUFFIX}`;
// The main doc a key is the suggestion doc of, or null for a main doc's key.
export const mainOf = (key: string): string | null => (key.endsWith(SUGGESTION_SUFFIX) ? key.slice(0, -SUGGESTION_SUFFIX.length) : null);

export class DocumentService {
  readonly stats: ServiceStats = { framesIn: 0, contentFramesIn: 0, rowsAppended: 0, commits: 0, rejections: 0, rejected: [], lostBatches: 0 };
  private readonly docs = new Map<string, HostDoc>();
  private readonly adapters = new Map<ArtifactKind, KindAdapter>();
  private readonly outbox: { conn: Connection; frame: Uint8Array }[] = [];
  private readonly dirty = new Map<string, number>(); // artifact → its revision, for the rows in the open batch
  private readonly dirtyActors = new Map<string, Map<string, Actor>>(); // artifact → who wrote its rows in the batch
  private readonly waiters: { resolve: () => void; reject: (error: Error) => void }[] = [];
  private readonly headDue = new Set<string>(); // heads to rewrite after the next commit (a version was written)
  private readonly committedListeners = new Set<(change: Committed) => void>();
  private readonly beforeCommitListeners = new Set<(artifactIds: string[]) => void>();
  private readonly agentReplicas = new Map<string, AgentReplica>(); // by `${appSessionId}\0${artifactId}`
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private flushScheduled = false;
  private nextConnId = 1;
  private closed = false;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly defer: (run: () => void) => void;
  private readonly kindOf: (artifactId: string) => ArtifactKind | null;
  private readonly headTailRows: number;
  private readonly headTailBytes: number;
  private readonly replicaIdleMs: number;
  private readonly idleUnloadMs: number;

  constructor(
    readonly storage: DocumentStorage,
    options: ServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.warn(`[documents] ${line}`));
    this.defer = options.defer ?? ((run) => setImmediate(run));
    this.kindOf = options.kindOf ?? (() => null);
    this.headTailRows = options.headTailRows ?? HEAD_TAIL_ROWS;
    this.headTailBytes = options.headTailBytes ?? HEAD_TAIL_BYTES;
    this.replicaIdleMs = options.replicaIdleMs ?? REPLICA_IDLE_MS;
    this.idleUnloadMs = options.idleUnloadMs ?? IDLE_UNLOAD_MS;
    for (const adapter of options.adapters ?? []) this.registerAdapter(adapter);
  }

  registerAdapter(adapter: KindAdapter): void {
    this.adapters.set(adapter.kind, adapter);
  }

  onCommitted(listener: (change: Committed) => void): () => void {
    this.committedListeners.add(listener);
    return () => this.committedListeners.delete(listener);
  }

  // Runs inside the open batch just before it commits, with the docs that have rows in it (the store stamps their
  // entity rows' `updatedAt` in the same commit). A throw is logged and the batch still commits.
  onBeforeCommit(listener: (artifactIds: string[]) => void): () => void {
    this.beforeCommitListeners.add(listener);
    return () => this.beforeCommitListeners.delete(listener);
  }

  adapterFor(kind: ArtifactKind): KindAdapter | undefined {
    return this.adapters.get(kind);
  }

  // A replica's port to the doc, under `actor` (main's human for a renderer, the session for an agent replica).
  attach(artifactId: string, port: HostPort, actor: Actor): Connection {
    if (this.closed) throw new Error('the document service is closed');
    const hostDoc = this.open(artifactId);
    this.cancelIdle(hostDoc);
    const conn: Connection = { kind: 'connection', id: this.nextConnId++, artifactId, actor, key: actorKey(actor), received: 0, ackDue: false, closed: false, awarenessClients: new Set(), port };
    hostDoc.conns.add(conn);
    port.onMessage((data) => this.receive(conn, data));
    port.onClose(() => this.detach(conn));
    this.queue(conn, encodeFrame({ type: 'step1', sv: stateVector(hostDoc.doc) }));
    const states = [...hostDoc.awareness.getStates().keys()];
    if (states.length > 0) this.queue(conn, encodeFrame({ type: 'awareness', update: awarenessProtocol.encodeAwarenessUpdate(hostDoc.awareness, states) }));
    return conn;
  }

  revision(artifactId: string): number {
    return this.docs.get(artifactId)?.revision ?? this.storage.revision(artifactId);
  }

  // The live doc, if loaded (tests, M3's reads); never written directly.
  loaded(artifactId: string): Doc | null {
    return this.docs.get(artifactId)?.doc ?? null;
  }

  // Every attribution of the artifact merged: who inserted and deleted what, when (Decision Log 5). For an open doc the
  // merge is cached and extended with each row since; the rows in the open batch are included.
  provenance(artifactId: string): ContentMap {
    const hostDoc = this.docs.get(artifactId);
    if (!hostDoc) return mergeMaps(this.storage.provenance(artifactId).map(decodeMap));
    const cache = hostDoc.provenance;
    if (!cache.merged) cache.merged = mergeMaps(this.storage.provenance(artifactId).map(decodeMap));
    else if (cache.pending.length > 0) cache.merged = mergeMaps([cache.merged, ...cache.pending]);
    cache.pending = [];
    return cache.merged;
  }

  // A host-originated write (restore, the test writer, the store's copies) through the host replica of `actor`: one
  // transaction, so one log row credited to `actor`, then the kind's `afterUpdate`, then `options` (WriteOptions), all in
  // one savepoint. Resolves with the revision after the commit.
  writeAs(artifactId: string, actor: Actor, edit: (doc: Doc) => void, options: WriteOptions = {}): Promise<number> {
    if (this.closed) return Promise.reject(new Error('the document service is closed'));
    if (this.storage.readOnly) return Promise.reject(new StoreTooNewError('a newer app wrote this store'));
    const hostDoc = this.open(artifactId);
    const failed = this.inFrame(hostDoc, () => {
      if (options.prepare) {
        options.prepare();
        hostDoc.kind ??= this.kindOf(artifactId); // a doc opened before its entity row was written (a frame that fails evicts it)
      }
      const adapter = this.adapterOf(hostDoc);
      const applied = this.applyOwn(hostDoc, () => this.writeThrough(hostDoc, actor, edit));
      this.afterUpdate(hostDoc, adapter, actor, applied);
      if (options.afterWrite) {
        const after: { outcome?: void | { threads?: ThreadChange } } = {};
        this.writeThrough(hostDoc, actor, (doc) => (after.outcome = options.afterWrite!(doc)));
        if (after.outcome?.threads) this.storage.writeThreads(hostDoc.id, after.outcome.threads);
      }
      options.inFrame?.(hostDoc.revision);
    });
    if (failed) return Promise.reject(new Error(`the write to ${artifactId} failed and the document was reset: ${failed}`));
    const revision = hostDoc.revision;
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve: () => resolve(revision), reject });
      this.scheduleFlush();
    });
  }

  // Rows that are not a document's (entities, versions, ops, byte-kind writes) written inside a savepoint of the open
  // batch, so they commit with the documents' rows of this turn and are revealed only after (Decision Log 11, 26). A
  // throw takes back what `run` wrote. Resolves with `run`'s answer after the commit.
  inBatch<T>(run: () => T): Promise<T> {
    if (this.closed) return Promise.reject(new Error('the document service is closed'));
    if (this.storage.readOnly) return Promise.reject(new StoreTooNewError('a newer app wrote this store'));
    let result: T;
    try {
      this.storage.beginFrame();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    try {
      result = run();
      this.storage.endFrame();
    } catch (error) {
      try {
        this.storage.abortFrame();
      } catch (abortError) {
        this.batchFailed(`the batch's rows could not be taken back (${abortError instanceof Error ? abortError.message : String(abortError)})`);
      }
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve: () => resolve(result), reject });
      this.scheduleFlush();
    });
  }

  // Settles once the open batch commits, rejecting when it is lost (the idempotency ledger waits for its op row's
  // commit with it); with nothing open, after the next flush.
  whenCommitted(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('the document service is closed'));
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.scheduleFlush();
    });
  }

  // The doc's state (V2) and the revision it is at: the live doc's when open, else read from the store without
  // opening it.
  readState(artifactId: string): { revision: number; state: Uint8Array } {
    const hostDoc = this.docs.get(artifactId);
    if (hostDoc) return { revision: hostDoc.revision, state: stateV2(hostDoc.doc) };
    const doc = this.loadDoc(artifactId).doc;
    try {
      return { revision: this.storage.revision(artifactId), state: stateV2(doc) };
    } finally {
      doc.destroy();
    }
  }

  // A read on the host replica of `actor` (Decision Log 41b, P3-B's request): the replica `writeAs` writes through for
  // that actor, so a read that pins a base or warms an index does so on the doc that will take the write. No frame, no
  // row. The replica holds every row the live doc holds, committed or not, so a caller revealing what `fn` read wraps
  // it in the store's `readCommitted` (Decision Log 33). `fn` must not edit: an edit is refused (a throw) and never
  // reaches the live doc, and the replica it touched is dropped so the actor's next use starts from the live state.
  readAs<T>(artifactId: string, actor: Actor, fn: (doc: Doc) => T): T {
    if (this.closed) throw new Error('the document service is closed');
    const hostDoc = this.open(artifactId);
    this.scheduleFlush(); // the idle unload's clock, as `live` does
    const replica = this.hostReplica(hostDoc, actor);
    replica.reading = true;
    replica.editedWhileReading = false;
    try {
      const result = fn(replica.doc);
      if (replica.editedWhileReading) throw new Error(`readAs on ${artifactId} is read-only; write through writeAs`);
      return result;
    } finally {
      replica.reading = false;
      if (replica.editedWhileReading) {
        replica.off();
        replica.doc.destroy();
        if (hostDoc.replicas.get(replica.key) === replica) hostDoc.replicas.delete(replica.key);
      }
    }
  }

  // The artifact's suggestion doc (X24; Decision Log 23e), opened if it is not, and its key: the key every other method
  // takes (`attach`, `writeAs`, `readAs`, `replica`, `live`), so a proposal is written and shown like any document's
  // edit, through a replica whose actor is its author.
  suggestionDoc(artifactId: string): string {
    if (this.closed) throw new Error('the document service is closed');
    if (mainOf(artifactId) !== null) throw new Error(`${artifactId} is a suggestion doc`);
    const key = suggestionKey(artifactId);
    this.open(key);
    this.scheduleFlush(); // the idle unload's clock, as `live` does
    return key;
  }

  // Accepts the proposals in `ranges` of the artifact's suggestion doc (X24; Decision Log 45): the accepted result is
  // written into the main doc as a copy, one transaction by `actor` (the log row's actor) under a fresh clientID bound to
  // the suggester, each copied unit's provenance carried from its proposal (author and time, `carry = 'accept'`); the
  // proposals taken are deleted in the suggestion doc in the same savepoint. A range the plan refuses (no such content,
  // or part of an inserted block without the block) rejects with a `SuggestionError` before anything is written.
  // Resolves with the main doc's revision after the commit.
  acceptSuggestion(artifactId: string, ranges: SuggestionRange[], actor: Actor): Promise<number> {
    return this.settle(artifactId, ranges, actor, 'accept');
  }

  // Rejects the proposals in `ranges`: proposed content is deleted in the suggestion doc, and content a proposal deleted
  // comes back in the main doc as a content-identical copy written by `actor`, its provenance carried from the original
  // (`carry = 'reject'`), since a deletion cannot be undone in place (Decision Log 45). The main doc's content is
  // unchanged. Resolves with the main doc's revision after the commit.
  rejectSuggestion(artifactId: string, ranges: SuggestionRange[], actor: Actor = { kind: 'human' }): Promise<number> {
    return this.settle(artifactId, ranges, actor, 'reject');
  }

  // The live doc, opened if it is not (unloaded after the idle grace period if no connection holds it). Read-only: a
  // write goes through `writeAs`.
  live(artifactId: string): Doc {
    if (this.closed) throw new Error('the document service is closed');
    const doc = this.open(artifactId).doc;
    this.scheduleFlush();
    return doc;
  }

  // The head is rewritten after the next commit (a version was written, Decision Log 8).
  requestHead(artifactId: string): void {
    this.headDue.add(artifactId);
    this.scheduleFlush();
  }

  // Commits the open batch now (what it reveals is sent), so maintenance can run outside a batch.
  commitNow(): void {
    this.flush();
  }

  // Clears the presence of every replica the session holds (its turn ended, Decision Log 23d).
  clearPresence(appSessionId: AppSessionId): void {
    for (const [key, replica] of this.agentReplicas) if (key.startsWith(`${appSessionId}\u0000`)) replica.setPresence(null);
  }

  // A restore's announcement (Decision Log 16; M3 calls it once the restore's rows committed): `restored` goes to every
  // connection after the restore's update frame, and is re-sent after the step 2 of every later attach.
  announceRestored(artifactId: string, restored: Restored): void {
    const hostDoc = this.docs.get(artifactId);
    if (!hostDoc) return;
    hostDoc.restored = restored;
    const frame = encodeFrame({ type: 'restored', ...restored });
    for (const conn of hostDoc.conns) this.queue(conn, frame);
  }

  // The agent session's replica of the artifact (Decision Log 9), made on first use, reconnected if the host closed it.
  replica(appSessionId: AppSessionId, artifactId: string): AgentReplica {
    if (this.closed) throw new Error('the document service is closed');
    const key = `${appSessionId}\u0000${artifactId}`;
    let replica = this.agentReplicas.get(key);
    if (replica && !replica.closed) {
      replica.reconnectIfClosed();
    } else {
      const actor: Actor = { kind: 'session', appSessionId };
      const connect = (): PortLike => {
        const { port1, port2 } = new MessageChannel();
        this.attach(artifactId, fromNodePort(port1), actor);
        return port2 as unknown as PortLike;
      };
      replica = new AgentReplica(connect, this.now(), (line) => this.log(`agent replica ${appSessionId} on ${artifactId}: ${line}`), mainOf(artifactId) === null ? newDoc : newSuggestionDoc);
      this.agentReplicas.set(key, replica);
      this.sweepTimer ??= setInterval(() => this.closeIdleReplicas(), 60_000);
      this.sweepTimer.unref?.();
    }
    replica.lastUsed = this.now();
    return replica;
  }

  // At the session's end (Decision Log 9): nothing is lost, every write already waited for its durable ack.
  closeSession(appSessionId: AppSessionId): void {
    for (const [key, replica] of this.agentReplicas) {
      if (!key.startsWith(`${appSessionId}\u0000`)) continue;
      replica.close();
      this.agentReplicas.delete(key);
    }
  }

  closeIdleReplicas(): void {
    const cutoff = this.now() - this.replicaIdleMs;
    for (const [key, replica] of this.agentReplicas) {
      if (replica.lastUsed > cutoff) continue;
      replica.close();
      this.agentReplicas.delete(key);
    }
  }

  // The host's shutdown: the open batch commits and what it reveals is sent, then every replica and connection closes.
  close(): void {
    if (this.closed) return;
    this.flush();
    this.closed = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    for (const replica of this.agentReplicas.values()) replica.close();
    this.agentReplicas.clear();
    for (const hostDoc of [...this.docs.values()]) this.unload(hostDoc);
  }

  private open(artifactId: string): HostDoc {
    const existing = this.docs.get(artifactId);
    if (existing) return existing;
    const started = performance.now();
    const { doc, stored } = this.loadDoc(artifactId);
    const bindings = new Map<number, string>();
    const hostClients = new Map<string, number>();
    for (const { clientId, actor, host } of stored.clients) {
      bindings.set(clientId, actorKey(actor));
      if (host) hostClients.set(actorKey(actor), clientId);
    }
    const hostDoc: HostDoc = {
      id: artifactId,
      kind: this.kindOf(artifactId),
      doc,
      awareness: new awarenessProtocol.Awareness(doc),
      conns: new Set(),
      replicas: new Map(),
      bindings,
      hostClients,
      revision: this.storage.revision(artifactId),
      tailRows: stored.updates.length,
      tailBytes: stored.updates.reduce((sum, row) => sum + row.bytes.length, 0),
      restored: stored.restored,
      provenance: { merged: null, pending: [] },
      lastApplied: null,
      deferred: null,
      credit: null,
      loadMs: performance.now() - started,
      idleTimer: null,
    };
    hostDoc.awareness.setLocalState(null); // the host has no presence of its own
    onUpdate(doc, (update, origin) => this.integrated(hostDoc, update, origin));
    hostDoc.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changed = [...added, ...updated, ...removed];
      if (changed.length === 0) return;
      const from = (origin as Writer | null)?.kind === 'connection' ? (origin as Connection) : null;
      if (from) for (const id of [...added, ...updated]) from.awarenessClients.add(id);
      const frame = encodeFrame({ type: 'awareness', update: awarenessProtocol.encodeAwarenessUpdate(hostDoc.awareness, changed) });
      for (const conn of hostDoc.conns) if (conn !== from) this.queue(conn, frame);
    });
    this.docs.set(artifactId, hostDoc);
    return hostDoc;
  }

  // A doc built from the store: the head, then the log rows after it. A suggestion doc starts from its main doc's state
  // (the live doc's when it is loaded: rows of the open batch included), so it holds every main update since its own
  // rows were written whether or not it was loaded when they landed.
  private loadDoc(artifactId: string): { doc: Doc; stored: ReturnType<DocumentStorage['load']> } {
    const main = mainOf(artifactId);
    const doc = main === null ? newDoc() : newSuggestionDoc();
    if (main !== null) {
      const live = this.docs.get(main)?.doc;
      applyV2(doc, live ? stateV2(live) : this.readState(main).state, LOAD);
    }
    const stored = this.storage.load(artifactId);
    if (stored.head) applyV2(doc, stored.head.state, LOAD);
    for (const row of stored.updates) applyV1(doc, row.bytes, LOAD);
    if (hasPending(doc)) this.log(`${artifactId} loads with pending state: its stored log has a hole`);
    return { doc, stored };
  }

  private adapterOf(hostDoc: HostDoc): KindAdapter | undefined {
    return hostDoc.kind ? this.adapters.get(hostDoc.kind) : undefined;
  }

  private receive(conn: Connection, data: unknown): void {
    if (conn.closed) return;
    const hostDoc = this.docs.get(conn.artifactId);
    if (!hostDoc) return;
    this.stats.framesIn += 1;
    let frame: Frame;
    try {
      frame = decodeFrame(data);
    } catch (error) {
      return this.reject(conn, error instanceof Error ? error.message : String(error));
    }
    try {
      switch (frame.type) {
        case 'step1':
          this.queue(conn, encodeFrame({ type: 'step2', update: diffV1(hostDoc.doc, frame.sv) }));
          // The catch-up for a replica that was away across a restore (Decision Log 16): directly after the step 2, on
          // the same connection, with no frame between them; the provider recognises it by that position.
          if (hostDoc.restored) this.queue(conn, encodeFrame({ type: 'restored', ...hostDoc.restored }));
          return;
        case 'step2':
        case 'update':
          if (!this.content(hostDoc, conn, frame.update, frame.type === 'step2')) return;
          this.stats.contentFramesIn += 1;
          conn.received += 1;
          conn.ackDue = true;
          this.scheduleFlush();
          return;
        case 'awareness':
          awarenessProtocol.applyAwarenessUpdate(hostDoc.awareness, frame.update, conn);
          return;
        case 'ack':
        case 'restored':
          return this.reject(conn, `a host-only frame (${frame.type}) from a replica`);
      }
    } catch (error) {
      return this.reject(conn, `threw: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // One content frame; false when it was refused (the connection is closed) or the doc was evicted.
  private content(hostDoc: HostDoc, conn: Connection, update: Uint8Array, step2: boolean): boolean {
    const reason = checkUpdate(hostDoc.doc, update);
    if (reason) return this.refuse(conn, reason);
    const ids = contentIdsOf(update);
    if (this.storage.readOnly) {
      if (wouldChange(hostDoc.doc, ids)) return this.refuse(conn, 'storeTooNew: the store is read-only (a newer app wrote it)');
      return true; // a restatement: nothing to apply or log
    }
    for (const client of newStructClients(hostDoc.doc, ids)) {
      const bound = hostDoc.bindings.get(client) ?? this.inheritedBinding(hostDoc, client);
      if (bound !== undefined && bound !== conn.key) return this.refuse(conn, `new structs under clientID ${client}, bound to another actor (${bound})`);
    }
    const adapter = this.adapterOf(hostDoc);
    let forward: ((live: Doc) => void) | null = null;
    if (adapter?.beforeApply) {
      try {
        forward = adapter.beforeApply(hostDoc.doc, update, { artifactId: hostDoc.id, actor: conn.actor, step2 });
      } catch (error) {
        return this.refuse(conn, `the ${adapter.kind} adapter's beforeApply threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const failed = this.inFrame(hostDoc, () => {
      const applied = this.applyOwn(hostDoc, () => applyV1(hostDoc.doc, update, conn));
      if (hasPending(hostDoc.doc)) throw new Error(`an update the check let through left state pending (connection ${conn.id})`);
      if (forward) this.writeThrough(hostDoc, conn.actor, forward);
      this.afterUpdate(hostDoc, adapter, conn.actor, applied);
    });
    return failed === null;
  }

  // For a clientID a doc has not bound: the actor the artifact's other doc binds it to, if any. A main doc and its
  // suggestion doc share clientIDs (the suggestion doc holds the main doc's structs, flowed in unlogged, and an accepted
  // copy is bound in the main doc), so neither may let a replica extend a clientID the other binds to someone else.
  // A replica of the main doc sending a proposal's structs as its own (an editor accepting on its side), or a replica
  // of the suggestion doc extending a clientID the main doc binds to another actor, forges authorship and is refused
  // like any other (Decision Log 6). Only bindings are read: neither doc adopts the other's host-replica clientIDs.
  private inheritedBinding(hostDoc: HostDoc, client: number): string | undefined {
    const main = mainOf(hostDoc.id);
    const other = main ?? suggestionKey(hostDoc.id);
    const loaded = this.docs.get(other);
    if (loaded) return loaded.bindings.get(client);
    const actor = this.storage.clientActor(other, client);
    return actor ? actorKey(actor) : undefined;
  }

  // Applies a frame's own update (an incoming one, or a host-originated edit) and starts holding back the attribution rows
  // of the frame's writes until `afterUpdate` returns; answers what the update integrated, if anything.
  private applyOwn(hostDoc: HostDoc, apply: () => void): Uint8Array | null {
    hostDoc.lastApplied = null;
    hostDoc.deferred = [];
    apply();
    return hostDoc.lastApplied as Uint8Array | null;
  }

  // The kind's `afterUpdate` on what the frame's own update integrated (through the actor's host replica), then the
  // attribution rows of the frame's writes with any authorship the hook carried, and the hook's thread rows.
  // `carried` is authorship the host itself carries onto the frame's rows (a suggestion's copy), looked up in `prior`.
  private afterUpdate(hostDoc: HostDoc, adapter: KindAdapter | undefined, actor: Actor, applied: Uint8Array | null, carried?: { carries: Carry[]; prior: ContentMap }): void {
    const after: { outcome?: ReturnType<NonNullable<KindAdapter['afterUpdate']>> } = {};
    if (applied && adapter?.afterUpdate) this.writeThrough(hostDoc, actor, (doc) => (after.outcome = adapter.afterUpdate!(doc, { artifactId: hostDoc.id, update: applied, actor })));
    this.attribute(hostDoc, after.outcome?.provenance, carried);
    if (after.outcome?.threads) this.storage.writeThreads(hostDoc.id, after.outcome.threads);
  }

  // The held-back rows in seq order, each carried against the provenance before it (an earlier row of the same frame
  // included, so a repair copying forwarded text credits that text's author).
  private attribute(hostDoc: HostDoc, carries?: Carry[], carried?: { carries: Carry[]; prior: ContentMap }): void {
    const rows = hostDoc.deferred;
    hostDoc.deferred = null;
    for (const row of rows ?? []) {
      let map = carried && carried.carries.length > 0 ? carryAttribution(row.map, carried.prior, carried.carries) : row.map;
      if (carries && carries.length > 0) map = carryAttribution(map, this.provenance(hostDoc.id), carries);
      this.storage.attributeInBatch({ artifactId: hostDoc.id, seq: row.seq, at: row.at, provenance: encodeMap(map) });
      hostDoc.provenance.pending.push(map);
    }
  }

  // Runs one frame's work inside a savepoint of the batch. On a throw the frame's rows are taken back and the doc is
  // evicted; answers why, or null when the frame stands.
  private inFrame(hostDoc: HostDoc, run: () => void): string | null {
    // What the batch says of this doc before the frame (its revision and its writers), put back if the frame is.
    const dirtyBefore = this.dirty.get(hostDoc.id);
    const actorsBefore = this.dirtyActors.has(hostDoc.id) ? new Map(this.dirtyActors.get(hostDoc.id)) : undefined;
    try {
      this.storage.beginFrame();
    } catch (error) {
      const reason = `the batch could not open a frame: ${error instanceof Error ? error.message : String(error)}`;
      this.evict(hostDoc, reason);
      return reason;
    }
    try {
      run();
      this.storage.endFrame();
      return null;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      try {
        this.storage.abortFrame();
      } catch (abortError) {
        // The savepoint is gone: SQLite rolled back the whole batch (SQLITE_FULL, I/O), every earlier frame's rows with
        // it. The batch failed as a commit fails.
        const why = `the frame's rows could not be taken back (${abortError instanceof Error ? abortError.message : String(abortError)}) after ${reason}`;
        this.batchFailed(why);
        return why;
      }
      if (dirtyBefore === undefined) this.dirty.delete(hostDoc.id);
      else this.dirty.set(hostDoc.id, dirtyBefore);
      if (actorsBefore === undefined) this.dirtyActors.delete(hostDoc.id);
      else this.dirtyActors.set(hostDoc.id, actorsBefore);
      this.evict(hostDoc, reason);
      return reason;
    }
  }

  private settle(artifactId: string, ranges: SuggestionRange[], actor: Actor, what: 'accept' | 'reject'): Promise<number> {
    if (this.closed) return Promise.reject(new Error('the document service is closed'));
    if (this.storage.readOnly) return Promise.reject(new StoreTooNewError('a newer app wrote this store'));
    if (mainOf(artifactId) !== null) return Promise.reject(new Error(`${artifactId} is a suggestion doc`));
    const main = this.open(artifactId);
    const suggestion = this.open(suggestionKey(artifactId));
    let plan: SuggestionPlan;
    try {
      plan = (what === 'accept' ? planAccept : planReject)(main.doc, suggestion.doc, this.provenance(suggestion.id), ranges);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    const suggestionDirty = this.dirty.get(suggestion.id);
    const failed = this.inFrame(main, () => {
      if (plan.edit) {
        const adapter = this.adapterOf(main);
        let pairs: ReturnType<SuggestionPlan['pairs']> = null;
        const applied = this.applyOwn(main, () => {
          if (what === 'accept') pairs = this.writeCopy(main, suggestion, actor, plan);
          else
            this.writeThrough(main, actor, (doc) => {
              plan.edit!(doc);
              pairs = plan.pairs(doc);
            });
        });
        const carried = pairs as ReturnType<SuggestionPlan['pairs']>;
        if (!carried) this.log(`${what} on ${artifactId}: the copy could not be paired with its originals; its provenance is the ${what === 'accept' ? 'suggester’s at the accept time' : 'rejector’s'}`);
        const prior = what === 'accept' ? this.provenance(suggestion.id) : this.provenance(main.id);
        this.afterUpdate(main, adapter, actor, applied, carried && carried.from.length > 0 ? { carries: [{ kind: what, from: carried.from, to: carried.to }], prior } : undefined);
      }
      if (plan.remove) this.writeThrough(suggestion, actor, (doc) => applyV1(doc, plan.remove!));
    });
    if (failed) {
      if (suggestionDirty === undefined) this.dirty.delete(suggestion.id);
      else this.dirty.set(suggestion.id, suggestionDirty);
      return Promise.reject(new Error(`the ${what} on ${artifactId} failed and the document was reset: ${failed}`));
    }
    const revision = main.revision;
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve: () => resolve(revision), reject });
      this.scheduleFlush();
    });
  }

  // An accepted suggestion's copy (Decision Log 45): written by a one-off replica of the main doc whose clientID is
  // above every clientID either doc holds (so a copied attribute stays its key's value in the suggestion doc once its
  // original is deleted) and is bound to the suggester; the row is `actor`'s. Answers the copy's pairs with the
  // originals. A range holding several suggesters' proposals binds the clientID to the first; the carry credits each.
  private writeCopy(main: HostDoc, suggestion: HostDoc, actor: Actor, plan: SuggestionPlan): ReturnType<SuggestionPlan['pairs']> {
    const suggesters = [...new Map(plan.suggesters.flatMap((client) => {
      const bound = this.storage.clientActor(suggestion.id, client);
      return bound ? [[actorKey(bound), bound] as const] : [];
    })).values()];
    const doc = newDoc();
    applyV1(doc, diffV1(main.doc), MIRROR);
    adoptClientId(doc, clientAbove([main.doc, suggestion.doc]));
    const writer: HostReplica = {
      kind: 'replica',
      actor,
      key: actorKey(actor),
      doc,
      reading: false,
      editedWhileReading: false,
      copy: true,
      off: onUpdate(doc, (update, origin) => {
        if (origin !== MIRROR) applyV1(main.doc, update, writer);
      }),
    };
    main.credit = new Map([[doc.clientID, suggesters[0] ?? actor]]);
    try {
      transact(doc, () => plan.edit!(doc), writer);
      if (hasPending(main.doc)) throw new Error('an accepted suggestion’s copy left state pending');
      return plan.pairs(doc);
    } finally {
      main.credit = null;
      writer.off();
      doc.destroy();
    }
  }

  // Runs `edit` on the host replica of `actor`, whose update lands in the live doc as that actor's.
  private writeThrough(hostDoc: HostDoc, actor: Actor, edit: (doc: Doc) => void): void {
    const replica = this.hostReplica(hostDoc, actor);
    transact(replica.doc, () => edit(replica.doc), replica);
    if (hasPending(hostDoc.doc)) throw new Error(`a write through the host replica of ${replica.key} left state pending`);
  }

  private hostReplica(hostDoc: HostDoc, actor: Actor): HostReplica {
    const key = actorKey(actor);
    const existing = hostDoc.replicas.get(key);
    if (existing) return existing;
    const doc = mainOf(hostDoc.id) === null ? newDoc() : newSuggestionDoc();
    applyV1(doc, diffV1(hostDoc.doc), MIRROR);
    const bound = hostDoc.hostClients.get(key);
    if (bound !== undefined) adoptClientId(doc, bound); // after the load, which carries that clientID's own structs
    const replica: HostReplica = {
      kind: 'replica',
      actor,
      key,
      doc,
      reading: false,
      editedWhileReading: false,
      off: onUpdate(doc, (update, origin) => {
        if (origin === MIRROR) return;
        if (replica.reading) replica.editedWhileReading = true;
        else applyV1(hostDoc.doc, update, replica);
      }),
    };
    hostDoc.replicas.set(key, replica);
    return replica;
  }

  // Inside the live doc's transaction cleanup: the row joins the open batch; what reveals it waits for the commit.
  private integrated(hostDoc: HostDoc, update: Uint8Array, origin: unknown): void {
    if (origin === LOAD) return;
    if (origin === BASE) return this.relay(hostDoc, update, null); // its main doc's row holds it, committed in this batch
    const writer = origin as Writer | null;
    if (writer?.kind !== 'connection' && writer?.kind !== 'replica') throw new Error(`the live doc of ${hostDoc.id} was edited outside a replica`);
    const at = this.now();
    const ids = contentIdsOf(update);
    const fresh: number[] = [];
    for (const client of insertedClients(ids)) {
      if (hostDoc.bindings.has(client)) continue;
      const credited = hostDoc.credit?.get(client);
      hostDoc.bindings.set(client, credited ? actorKey(credited) : writer.key);
      fresh.push(client);
    }
    const hostClient = writer.kind === 'replica' && !writer.copy ? writer.doc.clientID : undefined;
    if (hostClient !== undefined && fresh.includes(hostClient)) hostDoc.hostClients.set(writer.key, hostClient);
    const map = attributionMap(ids, { insertActor: (client) => hostDoc.bindings.get(client) ?? writer.key, deleteActor: writer.key, at });
    const deferred = hostDoc.deferred;
    const seq = this.storage.appendInBatch({ artifactId: hostDoc.id, actor: writer.actor, at, update, provenance: deferred ? undefined : encodeMap(map), bindClients: fresh, hostClient, credit: hostDoc.credit ?? undefined });
    if (deferred) deferred.push({ seq, at, map });
    else hostDoc.provenance.pending.push(map);
    hostDoc.revision = seq;
    hostDoc.tailRows += 1;
    hostDoc.tailBytes += update.length;
    hostDoc.lastApplied = update;
    this.dirty.set(hostDoc.id, seq);
    const actors = this.dirtyActors.get(hostDoc.id) ?? new Map<string, Actor>();
    actors.set(writer.key, writer.actor);
    this.dirtyActors.set(hostDoc.id, actors);
    this.stats.rowsAppended += 1;
    this.relay(hostDoc, update, writer);
    const suggestion = this.docs.get(suggestionKey(hostDoc.id));
    if (suggestion) this.inStep(suggestion, update);
  }

  // An integrated update goes to every connection (after the commit) and every host replica but its writer's.
  private relay(hostDoc: HostDoc, update: Uint8Array, writer: Writer | null): void {
    const frame = encodeFrame({ type: 'update', update });
    for (const conn of hostDoc.conns) if (conn !== writer) this.queue(conn, frame);
    for (const replica of hostDoc.replicas.values()) if (replica !== writer) applyV1(replica.doc, update, MIRROR);
  }

  // A main doc's update into its loaded suggestion doc, which holds everything the main doc holds, so nothing can be
  // missing; were anything left pending, the suggestion doc is dropped and rebuilt from the store at its next use.
  private inStep(suggestion: HostDoc, update: Uint8Array): void {
    applyV1(suggestion.doc, update, BASE);
    if (hasPending(suggestion.doc)) this.evict(suggestion, 'a main doc update left it pending');
  }

  private queue(conn: Connection, frame: Uint8Array): void {
    this.outbox.push({ conn, frame });
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushScheduled || this.closed) return;
    this.flushScheduled = true;
    this.defer(() => this.flush());
  }

  private flush(): void {
    this.flushScheduled = false;
    if (this.closed) return;
    if (this.dirty.size > 0) {
      for (const listener of this.beforeCommitListeners) {
        try {
          listener([...this.dirty.keys()]);
        } catch (error) {
          this.log(`an onBeforeCommit listener threw: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    try {
      this.storage.commit();
    } catch (error) {
      return this.batchFailed(`commit failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (this.dirty.size > 0) this.stats.commits += 1;
    const committed: Committed[] = [...this.dirty].map(([artifactId, revision]) => ({ artifactId, revision, actors: [...(this.dirtyActors.get(artifactId)?.values() ?? [])] }));
    this.dirty.clear();
    this.dirtyActors.clear();
    for (const { conn, frame } of this.outbox.splice(0)) this.send(conn, frame);
    for (const hostDoc of this.docs.values()) {
      for (const conn of hostDoc.conns) {
        if (!conn.ackDue) continue;
        conn.ackDue = false;
        this.send(conn, encodeFrame({ type: 'ack', frames: conn.received, revision: hostDoc.revision }));
      }
    }
    // Off the commit path: what this commit revealed is already sent; no batch is open until the listeners run.
    for (const hostDoc of this.docs.values()) {
      if (hostDoc.tailRows >= this.headTailRows || hostDoc.tailBytes >= this.headTailBytes || this.headDue.has(hostDoc.id)) this.rewriteHead(hostDoc);
      this.headDue.delete(hostDoc.id);
    }
    for (const artifactId of this.headDue) this.rewriteHead(artifactId);
    this.headDue.clear();
    for (const waiter of this.waiters.splice(0)) waiter.resolve();
    for (const change of committed) {
      for (const listener of this.committedListeners) {
        try {
          listener(change);
        } catch (error) {
          this.log(`an onCommitted listener threw: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    // A doc nobody holds starts its grace period, restarted by a write it just committed.
    const written = new Set(committed.map((change) => change.artifactId));
    for (const hostDoc of this.docs.values()) {
      if (hostDoc.conns.size > 0 || (hostDoc.idleTimer && !written.has(hostDoc.id))) continue;
      this.cancelIdle(hostDoc);
      hostDoc.idleTimer = setTimeout(() => this.unloadIdle(hostDoc), this.idleUnloadMs);
      hostDoc.idleTimer.unref?.();
    }
  }

  // The grace period ended. A doc with rows in the open batch stays: the commit starts a new period.
  private unloadIdle(hostDoc: HostDoc): void {
    hostDoc.idleTimer = null;
    if (this.closed || this.docs.get(hostDoc.id) !== hostDoc || hostDoc.conns.size > 0 || this.dirty.has(hostDoc.id)) return;
    this.unload(hostDoc);
  }

  private cancelIdle(hostDoc: HostDoc): void {
    if (hostDoc.idleTimer) clearTimeout(hostDoc.idleTimer);
    hostDoc.idleTimer = null;
  }

  // The head checkpoint at the doc's committed revision (an open doc's live state, else read from the store).
  private rewriteHead(target: HostDoc | string): void {
    const artifactId = typeof target === 'string' ? target : target.id;
    try {
      const { revision, state } = typeof target === 'string' ? this.readState(target) : { revision: target.revision, state: stateV2(target.doc) };
      this.storage.writeHead(artifactId, revision, state);
      if (typeof target !== 'string') {
        target.tailRows = 0;
        target.tailBytes = 0;
      }
    } catch (error) {
      this.log(`the head of ${artifactId} was not rewritten: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private send(conn: Connection, frame: Uint8Array): void {
    if (conn.closed) return;
    try {
      conn.port.send(frame);
    } catch (error) {
      this.reject(conn, `its port failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // The open batch is lost (its commit failed, or SQLite rolled it back under a frame): the live docs may hold content
  // the store does not, so drop them all, unsent, and close their connections; the storage forgets the batch.
  private batchFailed(reason: string): void {
    this.stats.lostBatches += 1;
    this.log(`${reason}; dropping the open docs`);
    try {
      this.storage.rollback();
    } catch {
      // the connection is gone
    }
    this.outbox.length = 0;
    this.dirty.clear();
    this.dirtyActors.clear();
    this.headDue.clear();
    for (const waiter of this.waiters.splice(0)) waiter.reject(new Error('the artifact store failed to commit'));
    for (const hostDoc of [...this.docs.values()]) this.unload(hostDoc);
  }

  // The doc holds state outside the log, or a frame's work failed after its apply: drop it unsent, with its
  // connections; the next attach reloads it from the store and the replicas re-sync. Its rows from earlier frames of
  // the batch stand and commit with it. A main doc's loaded suggestion doc goes with it: what the frame took back had
  // already flowed into it.
  private evict(hostDoc: HostDoc, reason: string): void {
    this.stats.rejections += 1;
    this.recordRejection(reason, 0);
    this.log(`evicted ${hostDoc.id}: ${reason}`);
    for (let i = this.outbox.length - 1; i >= 0; i--) if (this.outbox[i].conn.artifactId === hostDoc.id) this.outbox.splice(i, 1);
    this.unload(hostDoc);
    const suggestion = this.docs.get(suggestionKey(hostDoc.id));
    if (suggestion) this.evict(suggestion, `its main doc was evicted (${reason})`);
    this.scheduleFlush();
  }

  private unload(hostDoc: HostDoc): void {
    this.cancelIdle(hostDoc);
    for (const conn of [...hostDoc.conns]) this.closeConn(conn);
    for (const replica of hostDoc.replicas.values()) {
      replica.off();
      replica.doc.destroy();
    }
    hostDoc.awareness.destroy();
    hostDoc.doc.destroy();
    if (this.docs.get(hostDoc.id) === hostDoc) this.docs.delete(hostDoc.id);
  }

  private reject(conn: Connection, reason: string): void {
    this.stats.rejections += 1;
    this.recordRejection(reason, conn.id);
    this.log(`closed connection ${conn.id} (${conn.artifactId}): ${reason}`);
    this.closeConn(conn);
  }

  private refuse(conn: Connection, reason: string): false {
    this.reject(conn, reason);
    return false;
  }

  private recordRejection(reason: string, conn: number): void {
    this.stats.rejected.push({ reason, conn });
    if (this.stats.rejected.length > REJECTIONS_KEPT) this.stats.rejected.shift();
  }

  private closeConn(conn: Connection): void {
    if (conn.closed) return;
    try {
      conn.port.close();
    } catch {
      // already closed
    }
    this.detach(conn);
  }

  private detach(conn: Connection): void {
    conn.closed = true;
    const hostDoc = this.docs.get(conn.artifactId);
    if (!hostDoc || !hostDoc.conns.delete(conn)) return;
    if (conn.awarenessClients.size > 0) awarenessProtocol.removeAwarenessStates(hostDoc.awareness, [...conn.awarenessClients], null);
    if (hostDoc.conns.size === 0) this.scheduleFlush(); // the flush starts the grace period of a doc nobody holds
  }
}
