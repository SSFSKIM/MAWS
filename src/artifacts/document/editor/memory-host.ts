// An in-memory document host for the editor's tests and the harness page (M3 of
// docs/doperpowers/plans/2026-10-12-p3-b-documents.md; S5's "world"): one host Y.Doc and any number of replicas, each a
// real `PortProvider` on a real `MessageChannel`, speaking A's frames (X24) as the engine host's document service does
// as far as a replica can observe: step 1 on attach, step 2 answered, every content frame applied, acked and
// broadcast to the other connections, awareness relayed, `restored` announced. It persists nothing and checks no gaps
// (the service's checks are A's and are tested there). Portable: a web page has `MessageChannel` too.
import type { Actor } from '@shared/artifacts/actor';
import { decodeFrame, encodeFrame, type Frame } from '../../provider/frames';
import { PortProvider, type Restored, type SaveState } from '../../provider/port';
import { applyV1, diffV1, newDoc, onUpdate, stateVector, transact, type Doc } from '../../yjs';
import type { DocumentHandleWithHold, EditorHost } from './host-types';

interface Connection {
  port: MessagePort;
  received: number; // content frames received, all acked at once
}

export class MemoryDocumentHost {
  readonly doc: Doc = newDoc();
  revision = 0;
  private readonly connections = new Set<Connection>();
  private latestRestore: Restored | null = null;
  private readonly offUpdate: () => void;

  constructor() {
    // Whatever lands in the host doc goes to every connection but the one it came from (a host-side write, origin
    // `null`, goes to all).
    this.offUpdate = onUpdate(this.doc, (update, origin) => {
      this.revision += 1;
      for (const connection of this.connections) {
        if (connection !== origin) connection.port.postMessage(encodeFrame({ type: 'update', update }));
      }
    });
  }

  /** A new connection: the replica's end of the channel. */
  connect(): MessagePort {
    const channel = new MessageChannel();
    const connection: Connection = { port: channel.port1, received: 0 };
    this.connections.add(connection);
    connection.port.onmessage = (event: MessageEvent) => this.receive(connection, decodeFrame(event.data));
    connection.port.postMessage(encodeFrame({ type: 'step1', sv: stateVector(this.doc) }));
    return channel.port2;
  }

  /** A write made on the host itself (the agent's replica stands behind this in the product). */
  write(edit: (doc: Doc) => void): void {
    transact(this.doc, () => edit(this.doc));
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
export function openMemoryHandle(host: MemoryDocumentHost, options: { log?: (line: string) => void } = {}): DocumentHandleWithHold & { provider: PortProvider } {
  const doc = newDoc();
  const provider = new PortProvider(doc, { log: options.log });
  const port = host.connect();
  provider.connect(port);
  return {
    provider,
    doc,
    awareness: provider.awareness,
    state: (): SaveState => provider.state,
    subscribe: (listener) => provider.subscribe(listener),
    onRestored: (listener) => provider.onRestored(listener),
    holdRemote: (on) => provider.holdRemote(on),
    close: () => provider.destroy(),
  };
}

/** Resolves once the handle has applied the host's step 2 (the document as the host holds it). */
export function whenSynced(handle: DocumentHandleWithHold): Promise<void> {
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
