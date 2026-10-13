// The document kind on the engine host's artifact store (P3-B's M7; D8 and D14 of
// docs/doperpowers/plans/2026-10-12-p3-b-documents.md): the document adapter registered with A's store through A's
// `registerAdapter`, so A's document service runs its hooks (forwarding, the id repair, the anchor refresh, the threads
// mirror, provenance carries, the restore scope, the turn summary) on every update of a document artifact, keyed by the
// artifact id A passes. The adapter's carry registry is per artifact and is dropped when the artifact is deleted. The
// tools reach the adapter through the store (`documentAdapterOf`), so no other wiring carries it.
import { documentAdapter, type DocumentAdapter } from '@artifacts/document/adapter';
import type { ArtifactStore } from '../store';

export interface DocumentKind {
  readonly adapter: DocumentAdapter;
  close(): void;
}

export function registerDocumentKind(store: ArtifactStore): DocumentKind {
  const adapter = documentAdapter();
  store.registerAdapter(adapter);
  const off = store.onChange((change) => {
    if (change.change === 'deleted' && change.kind === 'document') adapter.forgetArtifact(change.artifactId);
  });
  return { adapter, close: off };
}

/** The document adapter registered with `store`, or null when the document kind is not registered. */
export function documentAdapterOf(store: ArtifactStore): DocumentAdapter | null {
  const adapter = store.service.adapterFor('document') as Partial<DocumentAdapter> | undefined;
  return adapter && typeof adapter.registerCarries === 'function' ? (adapter as DocumentAdapter) : null;
}
