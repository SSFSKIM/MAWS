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
// a `writeAs` answer, `onCommitted`) waits in the outbox until that commit returns. A commit failure drops the open docs
// unsent and closes their connections; the replicas' next step 2 re-sends what the store lacks.
//
// Untrusted bytes. A frame that does not decode, a host-only frame, an update that fails the binding module's check, a
// new struct under a clientID bound to another actor (Decision Log 6), or anything that throws closes that connection;
// the doc and the other connections go on. Each content frame runs inside a savepoint of the batch: the kind's
// `beforeApply` with the raw bytes, the apply, the forwarding edit it returned, `afterUpdate` (Decision Log 18 and 21).
// If anything fails after the apply (a hook, or state the check let through left pending), the frame's rows are taken
// back, nothing of it is sent, and the doc is evicted: dropped with its connections, reloaded by the next attach.
import { MessageChannel } from 'node:worker_threads';
import * as awarenessProtocol from '@y/protocols/awareness';
import type { DocumentStorage, KindAdapter } from '@artifacts/host';
import { decodeFrame, encodeFrame, type Frame } from '@artifacts/provider/frames';
import type { PortLike, Restored } from '@artifacts/provider/port';
import {
  adoptClientId,
  applyV1,
  applyV2,
  attributionMap,
  checkUpdate,
  contentIdsOf,
  decodeMap,
  diffV1,
  encodeMap,
  hasPending,
  insertedClients,
  mergeMaps,
  newDoc,
  newStructClients,
  onUpdate,
  stateV2,
  stateVector,
  transact,
  wouldChange,
  type ContentMap,
  type Doc,
} from '@artifacts/yjs';
import { actorKey, type Actor } from '@shared/artifacts/actor';
import type { ArtifactKind } from '@shared/artifacts/entity';
import { StoreTooNewError } from './errors';
import { fromNodePort, type HostPort } from './ports';
import { AgentReplica } from './replica';

export const HEAD_TAIL_ROWS = 2_000; // the head is rewritten once the log tail behind it passes this many rows …
export const HEAD_TAIL_BYTES = 1024 * 1024; // … or this many bytes (Decision Log 8)
export const REPLICA_IDLE_MS = 10 * 60_000; // an agent replica closes after this long without a call (Decision Log 9)
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
}

type Writer = Connection | HostReplica;

interface HostDoc {
  readonly id: string;
  readonly kind: ArtifactKind | null;
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
  readonly loadMs: number;
}

export interface ServiceStats {
  framesIn: number;
  contentFramesIn: number;
  rowsAppended: number;
  commits: number;
  rejections: number;
  rejected: { reason: string; conn: number }[]; // the latest REJECTIONS_KEPT
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
}

const LOAD = Symbol('load'); // the origin of a load's applies, which are already in the log
const MIRROR = Symbol('mirror'); // the origin of the live doc's updates applied to a host replica

export class DocumentService {
  readonly stats: ServiceStats = { framesIn: 0, contentFramesIn: 0, rowsAppended: 0, commits: 0, rejections: 0, rejected: [] };
  private readonly docs = new Map<string, HostDoc>();
  private readonly adapters = new Map<ArtifactKind, KindAdapter>();
  private readonly outbox: { conn: Connection; frame: Uint8Array }[] = [];
  private readonly dirty = new Map<string, number>(); // artifact → its revision, for the rows in the open batch
  private readonly waiters: { revision: number; resolve: (revision: number) => void; reject: (error: Error) => void }[] = [];
  private readonly committedListeners = new Set<(change: { artifactId: string; revision: number }) => void>();
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
    for (const adapter of options.adapters ?? []) this.registerAdapter(adapter);
  }

  registerAdapter(adapter: KindAdapter): void {
    this.adapters.set(adapter.kind, adapter);
  }

  onCommitted(listener: (change: { artifactId: string; revision: number }) => void): () => void {
    this.committedListeners.add(listener);
    return () => this.committedListeners.delete(listener);
  }

  // A replica's port to the doc, under `actor` (main's human for a renderer, the session for an agent replica).
  attach(artifactId: string, port: HostPort, actor: Actor): Connection {
    if (this.closed) throw new Error('the document service is closed');
    const hostDoc = this.open(artifactId);
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

  // A host-originated write (restore, the test writer; M3) through the host replica of `actor`: one transaction, so one
  // log row credited to `actor`, then the kind's `afterUpdate`. Resolves with the revision after the commit.
  writeAs(artifactId: string, actor: Actor, edit: (doc: Doc) => void): Promise<number> {
    if (this.closed) return Promise.reject(new Error('the document service is closed'));
    if (this.storage.readOnly) return Promise.reject(new StoreTooNewError('a newer app wrote this store'));
    const hostDoc = this.open(artifactId);
    const adapter = this.adapterOf(hostDoc);
    const failed = this.inFrame(hostDoc, () => {
      hostDoc.lastApplied = null;
      this.writeThrough(hostDoc, actor, edit);
      const applied = hostDoc.lastApplied as Uint8Array | null;
      if (applied && adapter?.afterUpdate) this.writeThrough(hostDoc, actor, (doc) => adapter.afterUpdate!(doc, { update: applied, actor }));
    });
    if (failed) return Promise.reject(new Error(`the write to ${artifactId} failed and the document was reset: ${failed}`));
    return new Promise((resolve, reject) => {
      this.waiters.push({ revision: hostDoc.revision, resolve, reject });
      this.scheduleFlush();
    });
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
  replica(appSessionId: string, artifactId: string): AgentReplica {
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
      replica = new AgentReplica(connect, this.now(), (line) => this.log(`agent replica ${appSessionId} on ${artifactId}: ${line}`));
      this.agentReplicas.set(key, replica);
      this.sweepTimer ??= setInterval(() => this.closeIdleReplicas(), 60_000);
      this.sweepTimer.unref?.();
    }
    replica.lastUsed = this.now();
    return replica;
  }

  // At the session's end (Decision Log 9): nothing is lost, every write already waited for its durable ack.
  closeSession(appSessionId: string): void {
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
    const doc = newDoc();
    const stored = this.storage.load(artifactId);
    if (stored.head) applyV2(doc, stored.head.state, LOAD);
    for (const row of stored.updates) applyV1(doc, row.bytes, LOAD);
    if (hasPending(doc)) this.log(`${artifactId} loads with pending state: its stored log has a hole`);
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
      loadMs: performance.now() - started,
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
      const bound = hostDoc.bindings.get(client);
      if (bound !== undefined && bound !== conn.key) return this.refuse(conn, `new structs under clientID ${client}, bound to another actor (${bound})`);
    }
    const adapter = this.adapterOf(hostDoc);
    let forward: ((live: Doc) => void) | null = null;
    if (adapter?.beforeApply) {
      try {
        forward = adapter.beforeApply(hostDoc.doc, update, { actor: conn.actor, step2 });
      } catch (error) {
        return this.refuse(conn, `the ${adapter.kind} adapter's beforeApply threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const failed = this.inFrame(hostDoc, () => {
      hostDoc.lastApplied = null;
      applyV1(hostDoc.doc, update, conn);
      const applied = hostDoc.lastApplied as Uint8Array | null;
      if (hasPending(hostDoc.doc)) throw new Error(`an update the check let through left state pending (connection ${conn.id})`);
      if (forward) this.writeThrough(hostDoc, conn.actor, forward);
      if (applied && adapter?.afterUpdate) this.writeThrough(hostDoc, conn.actor, (doc) => adapter.afterUpdate!(doc, { update: applied, actor: conn.actor }));
    });
    return failed === null;
  }

  // Runs one frame's work inside a savepoint of the batch. On a throw the frame's rows are taken back and the doc is
  // evicted; answers why, or null when the frame stands.
  private inFrame(hostDoc: HostDoc, run: () => void): string | null {
    const dirtyBefore = this.dirty.get(hostDoc.id);
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
      this.storage.abortFrame();
      if (dirtyBefore === undefined) this.dirty.delete(hostDoc.id);
      else this.dirty.set(hostDoc.id, dirtyBefore);
      this.evict(hostDoc, reason);
      return reason;
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
    const doc = newDoc();
    applyV1(doc, diffV1(hostDoc.doc), MIRROR);
    const bound = hostDoc.hostClients.get(key);
    if (bound !== undefined) adoptClientId(doc, bound); // after the load, which carries that clientID's own structs
    const replica: HostReplica = {
      kind: 'replica',
      actor,
      key,
      doc,
      off: onUpdate(doc, (update, origin) => {
        if (origin !== MIRROR) applyV1(hostDoc.doc, update, replica);
      }),
    };
    hostDoc.replicas.set(key, replica);
    return replica;
  }

  // Inside the live doc's transaction cleanup: the row joins the open batch; what reveals it waits for the commit.
  private integrated(hostDoc: HostDoc, update: Uint8Array, origin: unknown): void {
    if (origin === LOAD) return;
    const writer = origin as Writer | null;
    if (writer?.kind !== 'connection' && writer?.kind !== 'replica') throw new Error(`the live doc of ${hostDoc.id} was edited outside a replica`);
    const at = this.now();
    const ids = contentIdsOf(update);
    const fresh: number[] = [];
    for (const client of insertedClients(ids)) {
      if (hostDoc.bindings.has(client)) continue;
      hostDoc.bindings.set(client, writer.key);
      fresh.push(client);
    }
    const hostClient = writer.kind === 'replica' ? writer.doc.clientID : undefined;
    if (hostClient !== undefined && fresh.includes(hostClient)) hostDoc.hostClients.set(writer.key, hostClient);
    const map = attributionMap(ids, { insertActor: (client) => hostDoc.bindings.get(client) ?? writer.key, deleteActor: writer.key, at });
    const seq = this.storage.appendInBatch({ artifactId: hostDoc.id, actor: writer.actor, at, update, provenance: encodeMap(map), bindClients: fresh, hostClient });
    hostDoc.revision = seq;
    hostDoc.tailRows += 1;
    hostDoc.tailBytes += update.length;
    hostDoc.provenance.pending.push(map);
    hostDoc.lastApplied = update;
    this.dirty.set(hostDoc.id, seq);
    this.stats.rowsAppended += 1;
    const frame = encodeFrame({ type: 'update', update });
    for (const conn of hostDoc.conns) if (conn !== writer) this.queue(conn, frame);
    for (const replica of hostDoc.replicas.values()) if (replica !== writer) applyV1(replica.doc, update, MIRROR);
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
    try {
      this.storage.commit();
    } catch (error) {
      return this.commitFailed(error);
    }
    if (this.dirty.size > 0) this.stats.commits += 1;
    const committed = [...this.dirty];
    this.dirty.clear();
    for (const { conn, frame } of this.outbox.splice(0)) this.send(conn, frame);
    for (const hostDoc of this.docs.values()) {
      for (const conn of hostDoc.conns) {
        if (!conn.ackDue) continue;
        conn.ackDue = false;
        this.send(conn, encodeFrame({ type: 'ack', frames: conn.received, revision: hostDoc.revision }));
      }
    }
    for (const waiter of this.waiters.splice(0)) waiter.resolve(waiter.revision);
    for (const [artifactId, revision] of committed) {
      for (const listener of this.committedListeners) {
        try {
          listener({ artifactId, revision });
        } catch (error) {
          this.log(`an onCommitted listener threw: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    // Off the commit path: what this commit revealed is already sent.
    for (const hostDoc of [...this.docs.values()]) {
      if (hostDoc.tailRows >= this.headTailRows || hostDoc.tailBytes >= this.headTailBytes) this.rewriteHead(hostDoc);
      if (hostDoc.conns.size === 0) this.unload(hostDoc);
    }
  }

  private rewriteHead(hostDoc: HostDoc): void {
    try {
      this.storage.writeHead(hostDoc.id, hostDoc.revision, stateV2(hostDoc.doc));
      hostDoc.tailRows = 0;
      hostDoc.tailBytes = 0;
    } catch (error) {
      this.log(`the head of ${hostDoc.id} was not rewritten: ${error instanceof Error ? error.message : String(error)}`);
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

  // The live docs may hold content the store does not: drop them, unsent, and close their connections.
  private commitFailed(error: unknown): void {
    this.log(`commit failed, dropping the open docs: ${error instanceof Error ? error.message : String(error)}`);
    try {
      this.storage.rollback();
    } catch {
      // the connection is gone
    }
    this.outbox.length = 0;
    this.dirty.clear();
    for (const waiter of this.waiters.splice(0)) waiter.reject(new Error('the artifact store failed to commit'));
    for (const hostDoc of [...this.docs.values()]) this.unload(hostDoc);
  }

  // The doc holds state outside the log, or a frame's work failed after its apply: drop it unsent, with its
  // connections; the next attach reloads it from the store and the replicas re-sync. Its rows from earlier frames of
  // the batch stand and commit with it.
  private evict(hostDoc: HostDoc, reason: string): void {
    this.stats.rejections += 1;
    this.recordRejection(reason, 0);
    this.log(`evicted ${hostDoc.id}: ${reason}`);
    for (let i = this.outbox.length - 1; i >= 0; i--) if (this.outbox[i].conn.artifactId === hostDoc.id) this.outbox.splice(i, 1);
    this.unload(hostDoc);
    this.scheduleFlush();
  }

  private unload(hostDoc: HostDoc): void {
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
    if (hostDoc.conns.size === 0) this.scheduleFlush(); // the flush unloads a doc nobody holds
  }
}
