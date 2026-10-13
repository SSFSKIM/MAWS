// S2 on Yjs v14 → P3-A's `src/engine-host/documents/` (X24; the v13 variant is s2/src/host/document-service.ts): the authoritative Y.Doc per artifact in the engine host, served to
// replicas over ports. A replica is a renderer (one port per open editor, relayed by main) or an agent session's own
// in-process replica (agent-replica.ts); the host never edits its own doc, so every integrated update has a
// connection, and the connection's actor (fixed by whoever attached it: main for a renderer, the host for a session,
// never the replica's own bytes) is the row's author.
//
// The durability rule (§4.2): an update's log row commits before anything that reveals it leaves the host: the
// broadcast to other replicas, a step 2 that includes it, the ack to its sender. Rows are appended in a batch that
// commits once per event-loop turn (group commit), and every outgoing frame waits in the outbox until that commit
// returns. A commit failure drops the doc from memory and closes its connections, so no replica learns of content
// the store does not hold; the replicas' next step 2 re-sends it.
//
// Untrusted bytes: a frame that does not decode, an update that would leave anything pending (a gap), an `ack` from
// a replica, or anything that throws closes that connection; the doc and the other connections go on.
import * as awarenessProtocol from '@y/protocols/awareness';
import { decodeFrame, encodeFrame, isContent, type Frame } from '../../src/frames';
import { applyV1, applyV2, attributionOf, checkV1, diffV1, encodeAttribution, hasPending, newDoc, onIntegrated, stateV2, stateVector, type Doc } from '../yjs';
import { actorKey, type Actor, type DocumentStorage } from './storage';

// One end of a document port as the host sees it (an Electron MessagePortMain, a Node MessagePort, a socket channel).
export interface HostPort {
  send(frame: Uint8Array): void;
  close(): void;
  onMessage(listener: (data: unknown) => void): void;
  onClose(listener: () => void): void;
}

export interface Connection {
  readonly id: number;
  readonly docId: string;
  readonly actor: Actor;
  received: number; // content frames received (what an ack counts)
  ackDue: boolean;
  closed: boolean;
  readonly awarenessClients: Set<number>;
  readonly port: HostPort;
}

interface HostDoc {
  id: string;
  doc: Doc;
  awareness: awarenessProtocol.Awareness;
  conns: Set<Connection>;
  revision: number;
  loadMs: number;
}

export interface ServiceStats {
  framesIn: number;
  contentFramesIn: number;
  rowsAppended: number;
  commits: number;
  rejected: { reason: string; conn: number }[];
}

const LOAD = Symbol('load');

export class DocumentService {
  private readonly docs = new Map<string, HostDoc>();
  private readonly outbox: { conn: Connection; frame: Uint8Array }[] = [];
  private flushScheduled = false;
  private nextConnId = 1;
  readonly stats: ServiceStats = { framesIn: 0, contentFramesIn: 0, rowsAppended: 0, commits: 0, rejected: [] };
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly defer: (run: () => void) => void;

  constructor(
    readonly storage: DocumentStorage,
    options: { now?: () => number; log?: (line: string) => void; defer?: (run: () => void) => void } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.warn(`[documents] ${line}`));
    this.defer = options.defer ?? ((run) => setImmediate(run));
  }

  open(docId: string): HostDoc {
    const existing = this.docs.get(docId);
    if (existing) return existing;
    const started = performance.now();
    const doc = newDoc();
    const stored = this.storage.load(docId);
    if (stored.version) applyV2(doc, stored.version.state, LOAD);
    for (const row of stored.updates) applyV1(doc, row.bytes, LOAD);
    const hostDoc: HostDoc = {
      id: docId,
      doc,
      awareness: new awarenessProtocol.Awareness(doc),
      conns: new Set(),
      revision: this.storage.revision(docId),
      loadMs: performance.now() - started,
    };
    hostDoc.awareness.setLocalState(null); // the host has no presence of its own
    onIntegrated(doc, (update, origin) => this.integrated(hostDoc, update, origin));
    hostDoc.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changed = [...added, ...updated, ...removed];
      if (changed.length === 0) return;
      const from = origin as Connection | null;
      if (from && typeof from === 'object' && 'awarenessClients' in from) for (const id of [...added, ...updated]) from.awarenessClients.add(id);
      const frame = encodeFrame({ type: 'awareness', update: awarenessProtocol.encodeAwarenessUpdate(hostDoc.awareness, changed) });
      for (const conn of hostDoc.conns) if (conn !== from) this.queue(conn, frame);
    });
    this.docs.set(docId, hostDoc);
    return hostDoc;
  }

  attach(docId: string, port: HostPort, actor: Actor): Connection {
    const hostDoc = this.open(docId);
    const conn: Connection = { id: this.nextConnId++, docId, actor, received: 0, ackDue: false, closed: false, awarenessClients: new Set(), port };
    hostDoc.conns.add(conn);
    port.onMessage((data) => this.receive(hostDoc, conn, data));
    port.onClose(() => this.detach(hostDoc, conn));
    this.queue(conn, encodeFrame({ type: 'step1', sv: stateVector(hostDoc.doc) }));
    const states = [...hostDoc.awareness.getStates().keys()];
    if (states.length > 0) this.queue(conn, encodeFrame({ type: 'awareness', update: awarenessProtocol.encodeAwarenessUpdate(hostDoc.awareness, states) }));
    return conn;
  }

  revision(docId: string): number {
    return this.docs.get(docId)?.revision ?? this.storage.revision(docId);
  }

  loaded(docId: string): { doc: Doc; loadMs: number } | null {
    const hostDoc = this.docs.get(docId);
    return hostDoc ? { doc: hostDoc.doc, loadMs: hostDoc.loadMs } : null;
  }

  // Folds the log into one version state. The live doc holds exactly the committed rows once the batch is flushed.
  compact(docId: string, actor: Actor): { seq: number; stateBytes: number } {
    const hostDoc = this.open(docId);
    this.flush();
    const state = stateV2(hostDoc.doc);
    this.storage.compact(docId, hostDoc.revision, state, this.now(), actor);
    return { seq: hostDoc.revision, stateBytes: state.length };
  }

  // Ends every connection and the open batch (the host's shutdown).
  close(): void {
    this.flush();
    for (const hostDoc of this.docs.values()) for (const conn of [...hostDoc.conns]) this.closeConn(hostDoc, conn);
  }

  private receive(hostDoc: HostDoc, conn: Connection, data: unknown): void {
    if (conn.closed) return;
    this.stats.framesIn += 1;
    let frame: Frame;
    try {
      frame = decodeFrame(data);
    } catch (error) {
      return this.reject(hostDoc, conn, error instanceof Error ? error.message : String(error));
    }
    try {
      switch (frame.type) {
        case 'step1':
          this.queue(conn, encodeFrame({ type: 'step2', update: diffV1(hostDoc.doc, frame.sv) }));
          break;
        case 'step2':
        case 'update': {
          const reason = checkV1(hostDoc.doc, frame.update);
          if (reason) return this.reject(hostDoc, conn, reason);
          applyV1(hostDoc.doc, frame.update, conn);
          if (hasPending(hostDoc.doc)) return this.evict(hostDoc, `an update the check let through left state pending (connection ${conn.id})`);
          break;
        }
        case 'awareness':
          awarenessProtocol.applyAwarenessUpdate(hostDoc.awareness, frame.update, conn);
          break;
        case 'ack':
          return this.reject(hostDoc, conn, 'an ack from a replica');
      }
    } catch (error) {
      return this.reject(hostDoc, conn, `threw: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (isContent(frame)) {
      this.stats.contentFramesIn += 1;
      conn.received += 1;
      conn.ackDue = true;
      this.scheduleFlush();
    }
  }

  // Inside the transaction's cleanup: the row joins the open batch; the broadcast waits for its commit.
  private integrated(hostDoc: HostDoc, update: Uint8Array, origin: unknown): void {
    if (origin === LOAD) return;
    const conn = origin as Connection;
    const at = this.now();
    hostDoc.revision = this.storage.appendInBatch(hostDoc.id, conn.actor, at, update, encodeAttribution(attributionOf(update, actorKey(conn.actor), at)));
    this.stats.rowsAppended += 1;
    const frame = encodeFrame({ type: 'update', update });
    for (const other of hostDoc.conns) if (other !== conn) this.queue(other, frame);
  }

  private queue(conn: Connection, frame: Uint8Array): void {
    this.outbox.push({ conn, frame });
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    this.defer(() => this.flush());
  }

  private flush(): void {
    this.flushScheduled = false;
    try {
      this.storage.commit();
      this.stats.commits += 1;
    } catch (error) {
      return this.commitFailed(error);
    }
    const outbox = this.outbox.splice(0);
    const acks = new Set<Connection>();
    for (const { conn, frame } of outbox) if (!conn.closed) conn.port.send(frame);
    for (const hostDoc of this.docs.values()) for (const conn of hostDoc.conns) if (conn.ackDue) acks.add(conn);
    for (const conn of acks) {
      conn.ackDue = false;
      conn.port.send(encodeFrame({ type: 'ack', frames: conn.received, revision: this.docs.get(conn.docId)?.revision ?? 0 }));
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
    for (const hostDoc of [...this.docs.values()]) {
      for (const conn of [...hostDoc.conns]) this.closeConn(hostDoc, conn);
      this.docs.delete(hostDoc.id);
    }
  }

  // The live doc holds state outside the log (pending structs): commit what integrated, then drop the doc and its
  // connections; the next attach reloads it from the store and the replicas re-sync.
  private evict(hostDoc: HostDoc, reason: string): void {
    this.stats.rejected.push({ reason, conn: 0 });
    this.log(`evicted ${hostDoc.id}: ${reason}`);
    this.flush();
    for (const conn of [...hostDoc.conns]) this.closeConn(hostDoc, conn);
    this.docs.delete(hostDoc.id);
  }

  private reject(hostDoc: HostDoc, conn: Connection, reason: string): void {
    this.stats.rejected.push({ reason, conn: conn.id });
    this.log(`closed connection ${conn.id} (${hostDoc.id}): ${reason}`);
    this.closeConn(hostDoc, conn);
  }

  private closeConn(hostDoc: HostDoc, conn: Connection): void {
    if (conn.closed) return;
    try {
      conn.port.close();
    } catch {
      // already closed
    }
    this.detach(hostDoc, conn);
  }

  private detach(hostDoc: HostDoc, conn: Connection): void {
    conn.closed = true;
    if (!hostDoc.conns.delete(conn)) return;
    if (conn.awarenessClients.size > 0) awarenessProtocol.removeAwarenessStates(hostDoc.awareness, [...conn.awarenessClients], null);
  }
}
