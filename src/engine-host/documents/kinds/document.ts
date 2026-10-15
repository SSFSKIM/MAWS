// The document kind on the engine host's artifact store (P3-B's M7; D8 and D14 of
// docs/doperpowers/plans/2026-10-12-p3-b-documents.md): the document adapter registered with A's store through A's
// `registerAdapter`, so A's document service runs its hooks (forwarding, the id repair, the anchor refresh, the threads
// mirror, provenance carries, the restore scope, the turn summary) on every update of a document artifact, keyed by the
// artifact id A passes. The adapter's carry registry is per artifact and is dropped when the artifact is deleted. The
// tools reach the adapter through the store (`documentAdapterOf`), so no other wiring carries it. M8: while the kind is
// registered, a document in a linked Space is mirrored as `<slug>.md` (L's `registerMirrorWriter`).
//
// A document is created with its first tab (the spec's Terms): the adapter's `initial` (A's seed hook, parent Decision
// Log 48) writes it in the create's own commit, titled as the document and credited to the creator, whenever the
// creator gives no content (the owner's `artifacts.create`); the agent's `artifact_create` and A's duplicate give
// theirs. One writer, the host, before any editor binds, and one `created` announced. (M8's interim, a `created`
// listener writing the tab after the create and a pass at host start for documents it left without one, went with the
// hook in M9's fix wave.)
import { documentAdapter, type DocumentAdapter } from '@artifacts/document/adapter';
import { documentMirrorWriter } from '@artifacts/document/mirror';
import { warmWriter } from '@artifacts/document/patch-writer';
import { registerMirrorWriter } from '@artifacts/library/mirror';
import type { ArtifactStore } from '../store';

export interface DocumentKind {
  readonly adapter: DocumentAdapter;
  close(): void;
}

export function registerDocumentKind(store: ArtifactStore): DocumentKind {
  const adapter = documentAdapter();
  store.registerAdapter(adapter);
  const off = store.onChange((change) => {
    if (change.kind === 'document' && change.change === 'deleted') adapter.forgetArtifact(change.artifactId);
  });
  const offMirror = registerMirrorWriter('document', documentMirrorWriter);
  // the writer's first runs (the parser, the diff) paid here, once, off any agent's batch (M9, the scale gate)
  const warming = setImmediate(() => {
    try {
      warmWriter();
    } catch (error) {
      console.warn(`[documents] the writer's warm-up failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return {
    adapter,
    close: () => {
      off();
      offMirror();
      clearImmediate(warming);
    },
  };
}

/** The document adapter registered with `store`, or null when the document kind is not registered. */
export function documentAdapterOf(store: ArtifactStore): DocumentAdapter | null {
  const adapter = store.service.adapterFor('document') as Partial<DocumentAdapter> | undefined;
  return adapter && typeof adapter.registerCarries === 'function' ? (adapter as DocumentAdapter) : null;
}
