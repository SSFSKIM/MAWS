// An in-memory document host for the editor's tests and the harness page (M3 of
// docs/doperpowers/plans/2026-10-12-p3-b-documents.md; S5's "world"): one host Y.Doc and any number of replicas, each a
// real `PortProvider` on a real `MessageChannel`, speaking A's frames (X24) as the engine host's document service does
// as far as a replica can observe: step 1 on attach, step 2 answered, every content frame applied, acked and
// broadcast to the other connections, awareness relayed, `restored` announced. It persists nothing and checks no gaps
// (the service's checks are A's and are tested there). Portable: a web page has `MessageChannel` too. Each connection
// and each host write is credited to an actor, and `onLanded` reports every applied update with its actor, which is
// what the in-memory history (history/memory-history.ts) keeps as provenance.
import type { Actor } from '@shared/artifacts/actor';
import { decodeFrame, encodeFrame, type Frame } from '../../provider/frames';
import { PortProvider, type Restored } from '../../provider/port';
import { applyV1, diffV1, newDoc, onUpdate, stateVector, transact, type Doc } from '../../yjs';
import type { DocumentState } from '../../host';
import type { DocumentHandle, EditorHost } from './host-types';

interface Connection {
  port: MessagePort;
  received: number; // content frames received, all acked at once
  actor: Actor;
}

/** An update the host applied: its bytes (V1), whom it is credited to, and the revision it made. */
export interface Landed {
  update: Uint8Array;
  actor: Actor;
  revision: number;
}

const HUMAN: Actor = { kind: 'human' };

export class MemoryDocumentHost {
  readonly doc: Doc = newDoc();
  revision = 0;
  private readonly connections = new Set<Connection>();
  private latestRestore: Restored | null = null;
  private readonly offUpdate: () => void;
  private readonly landed = new Set<(row: Landed) => void>();
  private writer: Actor = HUMAN;

  constructor() {
    // Whatever lands in the host doc goes to every connection but the one it came from (a host-side write, origin
    // `null`, goes to all).
    this.offUpdate = onUpdate(this.doc, (update, origin) => {
      this.revision += 1;
      const actor = this.connections.has(origin as Connection) ? (origin as Connection).actor : this.writer;
      for (const listener of this.landed) listener({ update, actor, revision: this.revision });
      for (const connection of this.connections) {
        if (connection !== origin) connection.port.postMessage(encodeFrame({ type: 'update', update }));
      }
    });
  }

  /** A new connection, its updates credited to `actor`: the replica's end of the channel. */
  connect(actor: Actor = HUMAN): MessagePort {
    const channel = new MessageChannel();
    const connection: Connection = { port: channel.port1, received: 0, actor };
    this.connections.add(connection);
    connection.port.onmessage = (event: MessageEvent) => this.receive(connection, decodeFrame(event.data));
    connection.port.postMessage(encodeFrame({ type: 'step1', sv: stateVector(this.doc) }));
    return channel.port2;
  }

  /** A write made on the host itself as `actor` (the agent's replica stands behind this in the product). */
  write(edit: (doc: Doc) => void, actor: Actor = HUMAN): void {
    this.writer = actor;
    try {
      transact(this.doc, () => edit(this.doc));
    } finally {
      this.writer = HUMAN;
    }
  }

  /** Every update the host applies from now on, with its actor and revision; returns the unsubscribe. */
  onLanded(listener: (row: Landed) => void): () => void {
    this.landed.add(listener);
    return () => this.landed.delete(listener);
  }

  /** A restore landed: every connection is told, and each later attach is told again after its step 2. */
  announceRestored(versionId: number): void {
    this.latestRestore = { revision: this.revision, versionId };
    for (const connection of this.connections) connection.port.postMessage(encodeFrame({ type: 'restored', ...this.latestRestore }));
  }

  /** Drops every connection, as a host restart does; each provider moves its unacked updates into its next step 2. */
  dropConnections(): void {
    for (const connection of this.connections) connection.port.close();
    this.connections.clear();
  }

  destroy(): void {
    this.dropConnections();
    this.offUpdate();
  }

  private receive(connection: Connection, frame: Frame): void {
    switch (frame.type) {
      case 'step1':
        connection.port.postMessage(encodeFrame({ type: 'step2', update: diffV1(this.doc, frame.sv) }));
        if (this.latestRestore) connection.port.postMessage(encodeFrame({ type: 'restored', ...this.latestRestore }));
        return;
      case 'step2':
      case 'update':
        applyV1(this.doc, frame.update, connection);
        connection.received += 1;
        connection.port.postMessage(encodeFrame({ type: 'ack', frames: connection.received, revision: this.revision }));
        return;
      case 'awareness':
        for (const other of this.connections) if (other !== connection) other.port.postMessage(encodeFrame(frame));
        return;
      default:
        return; // ack and restored are the host's own
    }
  }
}

/** A replica of the host's document as an editor holds it, over a fresh connection. */
export function openMemoryHandle(host: MemoryDocumentHost, options: { log?: (line: string) => void; actor?: Actor } = {}): DocumentHandle & { provider: PortProvider } {
  const doc = newDoc();
  const provider = new PortProvider(doc, { log: options.log });
  const port = host.connect(options.actor);
  provider.connect(port);
  return {
    provider,
    doc,
    awareness: provider.awareness,
    // The in-memory host never refuses a write, so the store is never read-only (A's DocumentState, its M4).
    state: (): DocumentState => ({ ...provider.state, readOnly: false }),
    subscribe: (listener) => provider.subscribe((state) => listener({ ...state, readOnly: false })),
    onRestored: (listener) => provider.onRestored(listener),
    holdRemote: (on) => provider.holdRemote(on),
    close: () => provider.destroy(),
  };
}

/** Resolves once the handle has applied the host's step 2 (the document as the host holds it). */
export function whenSynced(handle: DocumentHandle): Promise<void> {
  if (handle.state().synced) return Promise.resolve();
  return new Promise((resolve) => {
    const off = handle.subscribe((state) => {
      if (!state.synced) return;
      off();
      resolve();
    });
  });
}

/**
 * The editor's slice of `ArtifactHost` over memory: uploads are kept as object URLs keyed by their ref, so an image
 * inserted from a file shows at once.
 */
export function memoryEditorHost(identity: { actor: Actor; name: string; color: string }): EditorHost & { assets: Map<string, string> } {
  const assets = new Map<string, string>();
  let n = 0;
  return {
    assets,
    identity: () => identity,
    assetUrl: (_artifactId, ref) => assets.get(ref) ?? ref,
    uploadAsset: async (_artifactId, bytes, meta) => {
      n += 1;
      const assetId = `asset${n}`;
      const ref = `maws-artifact:${assetId}/${meta.name}`;
      assets.set(ref, URL.createObjectURL(new Blob([bytes.slice()], { type: meta.mime })));
      return { assetId, ref };
    },
  };
}
