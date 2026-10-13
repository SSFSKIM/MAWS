// The document kind on the engine host's artifact store (P3-B's M7; D8 and D14 of
// docs/doperpowers/plans/2026-10-12-p3-b-documents.md): the document adapter registered with A's store through A's
// `registerAdapter`, so A's document service runs its hooks (forwarding, the id repair, the anchor refresh, the threads
// mirror, provenance carries, the restore scope, the turn summary) on every update of a document artifact, keyed by the
// artifact id A passes. The adapter's carry registry is per artifact and is dropped when the artifact is deleted. The
// tools reach the adapter through the store (`documentAdapterOf`), so no other wiring carries it. M8: while the kind is
// registered, a document in a linked Space is mirrored as `<slug>.md` (L's `registerMirrorWriter`).
//
// M8 fix wave 1: a document is created with its first tab (the spec's Terms). The agent's `artifact_create` writes it
// with the content, and a copy carries its source's; the owner's `artifacts.create` makes the document empty, so on
// its `created` the host writes the first tab, titled as the document, as the creator, unless the document already has
// a tab (the agent's write and a copy's state are queued before the store announces the creation). One writer, the
// host, before any editor binds: replicas never initialise a document themselves (two would each write a tab of their
// own under the same key, and one replica's body would lose). The write is its own commit after the creation's, so a
// host that stopped (or a write that failed) between the two leaves a document never written (revision 0) and no new
// `created`: the kind's registration at host start gives every such document its first tab (fix wave 2). The hole
// closes with A's `KindAdapter.initial` (parent Decision Log 48), which writes it in the creation's own commit. A
// failure is logged; the registration has no channel to the renderer, whose editor says, after a bound, that the
// document has no content yet.
import { documentAdapter, type DocumentAdapter } from '@artifacts/document/adapter';
import { documentMirrorWriter } from '@artifacts/document/mirror';
import { createDocument, listTabs } from '@artifacts/document/tabs';
import { registerMirrorWriter } from '@artifacts/library/mirror';
import type { ArtifactStore } from '../store';

export interface DocumentKind {
  readonly adapter: DocumentAdapter;
  close(): void;
}

export function registerDocumentKind(store: ArtifactStore, { log = (line: string) => console.warn(`[documents] ${line}`) }: { log?: (line: string) => void } = {}): DocumentKind {
  const adapter = documentAdapter();
  store.registerAdapter(adapter);
  const off = store.onChange((change) => {
    if (change.kind !== 'document') return;
    if (change.change === 'deleted') adapter.forgetArtifact(change.artifactId);
    if (change.change === 'created') void firstTab(store, change.artifactId, log);
  });
  const offMirror = registerMirrorWriter('document', documentMirrorWriter);
  // documents a stopped host left without their first tab (created, never written)
  for (const artifact of store.list({ kind: 'document' })) if (store.revision(artifact.id) === 0) void firstTab(store, artifact.id, log);
  return {
    adapter,
    close: () => {
      off();
      offMirror();
    },
  };
}

async function firstTab(store: ArtifactStore, artifactId: string, log: (line: string) => void): Promise<void> {
  const artifact = store.get(artifactId);
  if (!artifact) return;
  try {
    await store.service.writeAs(artifactId, artifact.createdBy, (doc) => {
      if (listTabs(doc).length === 0) createDocument(doc, { title: artifact.title });
    });
  } catch (error) {
    log(`document ${artifactId}: its first tab could not be written: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The document adapter registered with `store`, or null when the document kind is not registered. */
export function documentAdapterOf(store: ArtifactStore): DocumentAdapter | null {
  const adapter = store.service.adapterFor('document') as Partial<DocumentAdapter> | undefined;
  return adapter && typeof adapter.registerCarries === 'function' ? (adapter as DocumentAdapter) : null;
}
