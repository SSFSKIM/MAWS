// A test world for the document kind on A's real store (imported by tests only): the SQLite storage, the document
// service and the artifact store over a fresh file, as `openDocuments` makes them, with the document kind registered;
// a document artifact seeded with the patch writer's seed (S4's section: comments, a list, a table, code); replica ends
// driven frame by frame (A's service tests' `raw`), and the authors the store has persisted for a block's characters.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFrame, encodeFrame, type Frame } from '@artifacts/provider/frames';
import { applyV1, decodeMap, diffV1, idAt, insertedBy, mergeMaps, mergeUpdates, newDoc, onUpdate, type Doc } from '@artifacts/yjs';
import { DocIndex } from '@artifacts/document/block-index';
import { seedDoc, textOf } from '@artifacts/document/writer.fixture';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import type { HostPort } from '../ports';
import { DocumentService } from '../service';
import { SqliteDocumentStorage } from '../storage';
import { ArtifactStore } from '../store';
import { registerDocumentKind, type DocumentKind } from './document';

export const HUMAN: Actor = { kind: 'human' };
const PULL = Symbol('pull');
export const sessionActor = (appSessionId: string): Actor => ({ kind: 'session', appSessionId: appSessionId as AppSessionId });

export interface DocumentWorld {
  dir: string;
  storage: SqliteDocumentStorage;
  service: DocumentService;
  store: ArtifactStore;
  kind: DocumentKind;
  logs: string[];
  /** A document artifact holding the writer's seed (tab `tab1`), created by `by`. */
  seeded(by?: Actor): Promise<string>;
  /** A replica end of `artifactId` under `actor`, synced to the host's state, driven frame by frame. */
  connect(artifactId: string, actor: Actor): RawEnd;
  /** The distinct authors the store's committed attribution rows credit for a block's characters. */
  persistedAuthors(artifactId: string, blockId: string): string[];
  close(): void;
}

export interface RawEnd {
  doc: Doc;
  received: Frame[];
  closed: boolean;
  /** One local change, sent as one update frame (or held to send later). */
  edit(change: (doc: Doc) => void, options?: { hold?: boolean }): Uint8Array;
  send(update: Uint8Array): void;
  sendAwareness(update: Uint8Array): void;
  /** Applies what the host sent since the last pull. */
  pull(): void;
}

export function openDocumentWorld(): DocumentWorld {
  const dir = mkdtempSync(join(tmpdir(), 'maws-doc-kind-'));
  const logs: string[] = [];
  const storage = SqliteDocumentStorage.open(join(dir, 'artifacts', 'store.sqlite'), { log: (line) => logs.push(line) });
  const service = new DocumentService(storage, { kindOf: (id) => storage.kindOf(id), log: (line) => logs.push(line) });
  const store = new ArtifactStore(service, storage, { root: join(dir, 'artifacts'), log: (line) => logs.push(line) });
  const kind = registerDocumentKind(store);
  const world: DocumentWorld = {
    dir, storage, service, store, kind, logs,
    async seeded(by = HUMAN) {
      const artifact = await store.create({ kind: 'document', title: 'Plan' }, by);
      const seed = diffV1(seedDoc());
      await service.writeAs(artifact.id, by, (doc) => applyV1(doc, seed));
      return artifact.id;
    },
    connect(artifactId, actor) {
      let onMessage: ((data: unknown) => void) | null = null;
      const end: RawEnd = {
        doc: newDoc(),
        received: [],
        closed: false,
        // the change's own incremental updates as one (a diff against the state vector would restate the whole
        // delete set, which the host must read as a sync step 2, not as new deletions)
        edit(change, { hold = false } = {}) {
          const updates: Uint8Array[] = [];
          const off = onUpdate(end.doc, (update, origin) => origin !== PULL && updates.push(update));
          try {
            change(end.doc);
          } finally {
            off();
          }
          const update = mergeUpdates(updates);
          if (!hold) end.send(update);
          return update;
        },
        send: (update) => onMessage!(encodeFrame({ type: 'update', update })),
        sendAwareness: (update) => onMessage!(encodeFrame({ type: 'awareness', update })),
        pull() {
          for (const frame of end.received.splice(0)) if (frame.type === 'update' || frame.type === 'step2') applyV1(end.doc, frame.update, PULL);
        },
      };
      const port: HostPort = {
        send: (frame) => end.received.push(decodeFrame(frame)),
        close: () => void (end.closed = true),
        onMessage: (listener) => void (onMessage = listener),
        onClose: () => {},
      };
      service.attach(artifactId, port, actor);
      applyV1(end.doc, diffV1(service.live(artifactId)), PULL);
      end.received.length = 0;
      return end;
    },
    persistedAuthors(artifactId, blockId) {
      const map = mergeMaps(storage.attributions(artifactId, 1, Number.MAX_SAFE_INTEGER).map(decodeMap));
      const node = DocIndex.of(service.live(artifactId)).find(blockId)!.node;
      return [...new Set([...Array(node.length).keys()].map((k) => insertedBy(map, idAt(node, k)!)?.actor ?? '?'))];
    },
    close() {
      kind.close();
      store.close();
      service.close();
      storage.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return world;
}

/** A block's text in the live doc. */
export const liveText = (world: DocumentWorld, artifactId: string, blockId: string): string => textOf(world.service.live(artifactId), blockId);
