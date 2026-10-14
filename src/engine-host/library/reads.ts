// The engine host's library reads (the P3-L document, Decision Log 2 and 3; parent Decision Log 46's ruling 18(a)):
// what main rebuilds its derived library from, read from P3-A's store and document service through their public
// methods only, and every answer released behind the store's commit barrier (`readCommitted`, A's Decision Log 33), so
// none reveals a row its batch may yet take back. Nothing here is durable and no document stays loaded: a document's
// state is read, extracted and released (`DocumentService.readState` loads and destroys one that is not open).
import { readFileSync, statSync } from 'node:fs';
import { extractText, FILE_TEXT_MAX_BYTES } from '@artifacts/library/text';
import { applyV2, newDoc } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import { isDocKind, type Artifact, type DocKind } from '@shared/artifacts/entity';
import type { LibraryEntry, LibraryEntryAnswer, LibrarySnapshot } from '@shared/ipc/schema/library';
import { ArtifactStoreError } from '../documents/errors';
import type { DocumentService } from '../documents/service';
import type { ArtifactStore } from '../documents/store';

// The two of A's objects the library reads (`Documents` as `openDocuments` returns it fits).
export interface LibraryDocuments {
  readonly store: ArtifactStore;
  readonly service: DocumentService;
}

// Who last edited an artifact, and when: the actor and time of its last log row (A's `lastWrite`, which survives log
// pruning), so a rename or a move, which stamp `updatedAt`, do not read as an edit; its creator at `createdAt` before
// any write.
export function lastEdit(store: ArtifactStore, artifact: Artifact): { lastEditor: Actor; lastEditedAt: number } {
  const write = store.lastWrite(artifact.id);
  return write ? { lastEditor: write.actor, lastEditedAt: write.at } : { lastEditor: artifact.createdBy, lastEditedAt: artifact.createdAt };
}

// Inside a read: one live artifact as the library sees it.
function entryOf(store: ArtifactStore, artifact: Artifact): LibraryEntry {
  return { ...artifact, revision: store.revision(artifact.id), ...lastEdit(store, artifact) };
}

// Every live artifact, their session links and the Spaces: §4.1's one host read at every connection.
export function readSnapshot(store: ArtifactStore): Promise<LibrarySnapshot> {
  return store.readCommitted(() => {
    const artifacts = store.list().map((artifact) => entryOf(store, artifact));
    return { artifacts, links: artifacts.flatMap((artifact) => store.links(artifact.id)), spaces: store.listSpaces() };
  });
}

// One artifact and its links; null with no links when it is deleted or never was.
export function readEntry(store: ArtifactStore, artifactId: string): Promise<LibraryEntryAnswer> {
  return store.readCommitted(() => {
    const artifact = store.get(artifactId);
    return artifact ? { artifact: entryOf(store, artifact), links: store.links(artifactId) } : { artifact: null, links: [] };
  });
}

// Inside a read: a byte kind's latest content, an html page's bytes or the path of a File artifact's file in place
// (read outside the barrier: it is not store state and may be large).
export function byteContentOf(store: ArtifactStore, artifactId: string): { name: string; bytes: Uint8Array } | { name: string; path: string } {
  const { ref, path } = store.contentRef(artifactId);
  const content = store.readBytes(store.entity(artifactId)!, ref);
  return 'bytes' in content ? { name: ref.name, bytes: content.bytes } : { name: ref.name, path };
}

// A file's bytes, or null when it is larger than `maxBytes` or cannot be read (a File artifact's file lives where the
// owner keeps it, and may have moved).
export function fileBytes(path: string, maxBytes: number): Uint8Array | null {
  try {
    return statSync(path).size > maxBytes ? null : readFileSync(path);
  } catch {
    return null;
  }
}

// What a text read takes from the store inside the barrier; the extraction runs after it.
type TextRead = { kind: DocKind; state: Uint8Array } | { kind: 'html'; bytes: Uint8Array } | { kind: 'file'; name: string; path: string };

// An artifact's searchable text at its revision (the revision the row carries, so main can tell when it is current).
// A deleted or unknown artifact is the store's `notFound`.
export async function readText({ store, service }: LibraryDocuments, artifactId: string): Promise<{ revision: number; text: string }> {
  const { revision, read } = await store.readCommitted((): { revision: number; read: TextRead } => {
    const artifact = store.get(artifactId);
    if (!artifact) throw new ArtifactStoreError('notFound', `no artifact ${artifactId}`, { artifactId });
    if (isDocKind(artifact.kind)) {
      const { revision, state } = service.readState(artifactId);
      return { revision, read: { kind: artifact.kind, state } };
    }
    const content = byteContentOf(store, artifactId);
    return { revision: store.revision(artifactId), read: 'bytes' in content ? { kind: 'html', bytes: content.bytes } : { kind: 'file', ...content } };
  });
  return { revision, text: textOf(read) };
}

function textOf(read: TextRead): string {
  if (read.kind === 'html') return extractText(read);
  if (read.kind === 'file') return extractText({ kind: 'file', name: read.name, bytes: fileBytes(read.path, FILE_TEXT_MAX_BYTES) });
  const doc = newDoc();
  try {
    applyV2(doc, read.state);
    return extractText({ kind: read.kind, doc });
  } finally {
    doc.destroy();
  }
}
