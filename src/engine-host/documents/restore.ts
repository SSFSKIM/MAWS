// Artifact-wide restore (parent §4.2 and Decision Log 29, 32 and 36; the P3-A document's Decision Log 16 and 18): one
// kind-agnostic host operation. For a Y kind, in one frame: an `auto` version of the current state first (when it
// moved), then the binding module's `revertUpdate` (P3-0's S7a `revertUpdateFixed`) from the version's state and that
// same live state, scoped by the kind's `revertScope` when it has one, applied to the live doc as one update through the
// restorer's host replica (one log row credited to the restorer; concurrent edits merge by the CRDT rule), the kind's
// `afterRestore` and the `restore` version, all in one commit, then `restored` (frame 101) to every connection. A byte
// kind restores by writing the version's bytes as a new write with a `restore` version.
import { applyV2, newDoc, revertUpdate, stateV2 } from '@artifacts/yjs';
import { formatDayTime } from '@shared/app/date-format';
import { actorKey, type Actor } from '@shared/artifacts/actor';
import { isDocKind } from '@shared/artifacts/entity';
import type { ContentRef } from './bytes';
import type { ArtifactStore, EntityRow, InFrame } from './store';
import type { VersionStore } from './versions';

type VersionRow = NonNullable<ReturnType<VersionStore['get']>>;

// "Restored from <the version's label, else its time>", the time in the display locale (`@shared/app/date-format`).
export const restoreLabel = (version: Pick<VersionRow, 'label' | 'at'>): string => `Restored from ${version.label ?? formatDayTime(version.at)}`;

// `inFrame` (the store's recording seam) runs in the savepoint of the restore's own write, after its `restore` version.
export async function restoreArtifact(store: ArtifactStore, row: EntityRow, version: VersionRow, actor: Actor, inFrame?: InFrame<{ revision: number; versionId: number }>): Promise<{ revision: number; versionId: number }> {
  const label = restoreLabel(version);
  if (!isDocKind(row.kind)) {
    // F (L139): a file hashed before the batch; the artifact and the version are read again where the restore writes, so
    // one gone meanwhile is refused and the write sees the artifact's placement as it is then
    const content = await store.withDigest(store.readBytes(row, JSON.parse(version.content!) as ContentRef));
    const written = await store.writeCommitted(() => {
      store.requireVersion(row.id, version.id);
      return store.writeBytes(store.requireLive(row.id), actor, content, { kind: 'restore', label }, inFrame);
    });
    return { revision: written.revision, versionId: written.versionId };
  }
  // One frame (P3-F store-versions scalpel-3#1, #2). Its `prepare` reads the artifact and the version again, as the byte
  // path does, so one deleted or dropped since the restore was asked is refused with nothing written (the doc stays
  // loaded; the refusal is released once the batch it read has committed). It then computes the revert from the live
  // state and writes the `auto` of that same state: an update that reached the doc before the frame is in the bracketing
  // version, and none lands between the two (Decision Log 16).
  const { service } = store;
  const adapter = service.adapterFor(row.kind);
  let current = row;
  let update: Uint8Array | null = null;
  let refused: { error: unknown } | null = null;
  let restoreId = 0;
  const revision = await service.writeAs(
    row.id,
    actor,
    (doc) => {
      if (update) applyV2(doc, update);
    },
    {
      prepare: () => {
        try {
          current = store.requireLive(row.id);
          update = revertOf(store, current, store.requireVersion(row.id, version.id));
        } catch (error) {
          refused = { error };
          return;
        }
        store.versionInFrame(current, { kind: 'auto', actor: store.lastWriter(row.id) });
      },
      afterWrite: adapter?.afterRestore ? (doc) => (refused ? undefined : adapter.afterRestore!(doc, { artifactId: row.id, versionId: version.id })) : undefined,
      inFrame: (reached) => {
        if (refused) return;
        restoreId = store.versionInFrame(current, { kind: 'restore', actor: actorKey(actor), label }) ?? 0;
        inFrame?.({ revision: reached, versionId: restoreId });
      },
    },
  );
  if (refused) throw (refused as { error: unknown }).error;
  service.announceRestored(row.id, { revision, versionId: restoreId });
  return { revision, versionId: restoreId };
}

// The update taking the live doc back to the version's state, scoped by the kind's `revertScope` when it has one.
function revertOf(store: ArtifactStore, row: EntityRow, version: VersionRow): Uint8Array {
  const old = store.versions.state(row.id, version.id);
  const live = store.service.live(row.id);
  const adapter = store.service.adapterFor(row.kind);
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
  return revertUpdate(old, stateV2(live), keep);
}
