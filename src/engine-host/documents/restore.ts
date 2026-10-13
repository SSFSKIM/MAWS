// Artifact-wide restore (parent §4.2 and Decision Log 29, 32 and 36; the P3-A document's Decision Log 16 and 18): one
// kind-agnostic host operation. For a Y kind: an `auto` version of the current state first (when it moved), then the
// binding module's `revertUpdate` (P3-0's S7a `revertUpdateFixed`) from the version's state and the live state, scoped
// by the kind's `revertScope` when it has one, applied to the live doc as one update through the restorer's host
// replica (one log row credited to the restorer; concurrent edits merge by the CRDT rule), the kind's `afterRestore`
// and the `restore` version in the same commit, then `restored` (frame 101) to every connection. A byte kind restores
// by writing the version's bytes as a new write with a `restore` version.
import { applyV2, newDoc, revertUpdate, stateV2 } from '@artifacts/yjs';
import { actorKey, type Actor } from '@shared/artifacts/actor';
import { isDocKind } from '@shared/artifacts/entity';
import type { ContentRef } from './bytes';
import type { ArtifactStore, EntityRow, InFrame } from './store';
import type { VersionStore } from './versions';

const WHEN = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

type VersionRow = NonNullable<ReturnType<VersionStore['get']>>;

// "Restored from <the version's label, else its time>".
export const restoreLabel = (version: Pick<VersionRow, 'label' | 'at'>): string => `Restored from ${version.label ?? WHEN.format(version.at)}`;

// `inFrame` (the store's recording seam) runs in the savepoint of the restore's own write, after its `restore` version.
export async function restoreArtifact(store: ArtifactStore, row: EntityRow, version: VersionRow, actor: Actor, inFrame?: InFrame<{ revision: number; versionId: number }>): Promise<{ revision: number; versionId: number }> {
  const label = restoreLabel(version);
  if (!isDocKind(row.kind)) {
    const written = await store.writeBytes(row, actor, store.readBytes(row, JSON.parse(version.content!) as ContentRef), { kind: 'restore', label }, inFrame);
    return { revision: written.revision, versionId: written.versionId };
  }
  const { service } = store;
  const old = store.versions.state(row.id, version.id);
  await store.autoVersion(row.id);
  // From here to the write, synchronously: the revert is computed against exactly the live state it is applied to.
  const live = service.live(row.id);
  const adapter = service.adapterFor(row.kind);
  let keep = null;
  if (adapter?.revertScope) {
    const before = newDoc();
    try {
      applyV2(before, old);
      keep = adapter.revertScope(live, before, { artifactId: row.id })?.keep ?? null;
    } finally {
      before.destroy();
    }
  }
  const update = revertUpdate(old, stateV2(live), keep);
  let restoreId = 0;
  const revision = await service.writeAs(row.id, actor, (doc) => applyV2(doc, update), {
    afterWrite: adapter?.afterRestore ? (doc) => adapter.afterRestore!(doc, { artifactId: row.id, versionId: version.id }) : undefined,
    inFrame: (reached) => {
      restoreId = store.versionInFrame(row, { kind: 'restore', actor: actorKey(actor), label }) ?? 0;
      inFrame?.({ revision: reached, versionId: restoreId });
    },
  });
  service.announceRestored(row.id, { revision, versionId: restoreId });
  return { revision, versionId: restoreId };
}
