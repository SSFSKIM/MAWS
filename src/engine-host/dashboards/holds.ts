// E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b; E's Decision Log 48 (3); the ledger's E3 hold-IPC
// row): the holds main's connection takes over snapshot bytes through the main-only `artifacts.captureDatasetState`,
// `artifacts.holdAssets` and `artifacts.releaseAssets` (src/engine-host/documents/register.ts serves them). Each hold is
// the connection's, named by an id minted here: a release names one, an id this connection did not mint releases
// nothing, and the client's going releases them all (a hold taken while it went is released at once), so no hold
// outlives the main process that owns it. Main binds a window's handle to one of these (src/main/dashboard/holds.ts).
import { randomUUID } from 'node:crypto';
import { isDocKind } from '@shared/artifacts/entity';
import { ArtifactStoreError } from '../documents/errors';
import { datasetRefsOf, type AssetHold } from '../documents/retention';
import type { ArtifactStore } from '../documents/store';

export class ConnectionHolds {
  private readonly held = new Map<string, AssetHold>();
  private generation = 0; // advanced when the client goes: a hold that lands after belongs to nobody

  /** Keeps `hold` under a new id; one taken under an earlier connection is released at once and refused. */
  add(hold: AssetHold, generation = this.generation): string {
    if (generation !== this.generation) {
      hold.release();
      throw new Error('the connection that asked for this hold has gone');
    }
    const id = randomUUID();
    this.held.set(id, hold);
    return id;
  }

  release(id: string): boolean {
    const hold = this.held.get(id);
    if (!hold) return false;
    this.held.delete(id);
    hold.release();
    return true;
  }

  releaseAll(): void {
    this.generation += 1;
    for (const [id, hold] of [...this.held]) {
      this.held.delete(id);
      hold.release();
    }
  }

  /** Main's hold over `refs` of `artifactId`, all or none. */
  async hold(store: ArtifactStore, artifactId: string, refs: readonly string[]): Promise<string> {
    const generation = this.generation;
    const { release } = await store.captureWithAssets(artifactId, () => {
      if (!store.get(artifactId)) throw new ArtifactStoreError('notFound', `no artifact ${artifactId}`, { artifactId });
      return { value: null, refs };
    });
    return this.add({ release }, generation);
  }

  /** `artifacts.captureDatasetState`: the live state (or a retained version's) and one hold over the snapshots its
   * descriptors name, read in one synchronous turn. */
  async capture(store: ArtifactStore, artifactId: string, versionId?: number): Promise<{ revision: number; bytes: Uint8Array; assetHoldId: string }> {
    const generation = this.generation;
    const { value, release } = await store.captureWithAssets(artifactId, () => {
      const artifact = store.get(artifactId);
      if (!artifact) throw new ArtifactStoreError('notFound', `no artifact ${artifactId}`, { artifactId });
      if (!isDocKind(artifact.kind)) throw new ArtifactStoreError('invalid', `a ${artifact.kind} artifact has no document state`, { kind: artifact.kind });
      let revision: number;
      let bytes: Uint8Array;
      if (versionId === undefined) ({ revision, state: bytes } = store.service.readState(artifactId));
      else {
        bytes = store.versionState(artifactId, versionId);
        revision = store.versions.get(artifactId, versionId)!.seq;
      }
      return { value: { revision, bytes }, refs: datasetRefsOf(bytes) };
    });
    return { ...value, assetHoldId: this.add({ release }, generation) };
  }
}
