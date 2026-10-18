// E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1 and R1b; E's Decision Log 48 (1) to (3); the ledger's
// E3 store row): the retention of query snapshots in A's store, and the holds that protect a captured snapshot's bytes
// while a reader still needs them. The store's `ArtifactStore` methods of the same names delegate here.
//
// What is kept. An asset E3 registered for a query snapshot (`querySnapshot = 1`) is protected while any of these names
// it: a query's membership (the latest two distinct snapshots each query published, `artifact_query_snapshots`, ordered
// by `lastUsedSeq`, the revision that last published it, so a reuse counts and the order survives a restart), a current
// descriptor of the dashboard (any dataset, a shared or deduplicated ref included), a retained version's `assetRefs`, or
// a hold. Every other asset is never a candidate. Membership is recency, not eligibility (the M1 review): a snapshot a
// query published that deduplicated to an ordinary asset holds its place among the latest two, and an adopted one keeps
// its place, yet neither is ever retired or collected. What falls out of the first two is retired (`retiredAt`) in the very
// frame that dropped it: later versions leave it out (`ArtifactStore.assetIds`), earlier versions keep naming it. A
// retired asset is collected (its row, then its bytes) only after a commit, and only when no current descriptor, no
// version and no hold names it at that moment: after a hold's release, the nightly thinning, the owner's prune, the
// store's reopen and `removeAsset`. A failed unlink leaves an orphan file, never a committed ref without its bytes.
//
// Membership follows the dataset (`reconcile`, from the dashboard kind's hooks in every write's frame): a dataset
// removed, no longer a query, or configured anew (its snapshot null) loses its membership; a restore resets each query's
// membership to the one snapshot its restored descriptor names; a query with a snapshot and no membership (a copy's, a
// restore's) is enrolled with it. A file dataset naming a managed asset adopts it: ordinary, never collected, its place in
// any query's recency kept; an upload or a copy deduplicating to one adopts it too (store.ts).
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { listDatasets, snapshotOf } from '@artifacts/dashboard/datasets';
import { applyV2, newDoc, type Doc } from '@artifacts/yjs';
import { ArtifactFiles } from './bytes';
import { ArtifactStoreError } from './errors';
import type { ArtifactStore } from './store';

/** At most this many reads each artifact holds at once, distinct refs held, and refs in one hold (R1b); past them a
 * hold fails closed, never evicting another owner's. */
export const ASSET_HOLD_LIMITS = { groups: 64, refs: 256, groupRefs: 64 } as const;

/** The query keeps its latest this many distinct snapshots (R1). */
const KEPT_PER_QUERY = 2;

// E3 panel wave (Decision Log 16 (5); E's Decision Log 48: fresh UUID refs, no tombstones): the query-snapshot namespace.
// Collection deletes a snapshot's row and so frees its name; the refresh sink alone names a snapshot in the namespace,
// always afresh, and the store refuses an ordinary upload naming it (any case, as a case-folding disk would), so no
// collected ref is ever recreated with other bytes.
const QUERY_SNAPSHOT_NAME = /^query-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;
/** A fresh query snapshot's asset name: the refresh sink's alone. */
export const querySnapshotName = (): string => `query-${randomUUID()}.json`;
/** Whether an asset name lies in the query-snapshot namespace an ordinary upload may not take. */
export const isQuerySnapshotName = (name: string): boolean => QUERY_SNAPSHOT_NAME.test(name);

export interface AssetHold {
  /** Idempotent; what the hold protected becomes collectable once nothing else names it. */
  release(): void;
}

interface AssetRow {
  assetId: string;
  name: string;
  sha256: string;
  querySnapshot: number;
  retiredAt: number | null;
}

const refOf = (name: string) => `assets/${name}`;

/** The refs `doc`'s current descriptors name, and its queries' snapshots by dataset id. */
function currentOf(doc: Doc): { refs: Set<string>; queries: Map<string, string>; files: Set<string> } {
  const refs = new Set<string>();
  const queries = new Map<string, string>();
  const files = new Set<string>();
  for (const { id, descriptor } of listDatasets(doc)) {
    const snapshot = snapshotOf(descriptor);
    if (!snapshot) continue;
    refs.add(snapshot.ref);
    if (descriptor.source.kind === 'query') queries.set(id, snapshot.ref);
    else files.add(snapshot.ref);
  }
  return { refs, queries, files };
}

/** The snapshot refs a document state's descriptors name (a query never fetched names none). */
export function datasetRefsOf(state: Uint8Array): string[] {
  const doc = newDoc();
  try {
    applyV2(doc, state);
    return [...currentOf(doc).refs];
  } finally {
    doc.destroy();
  }
}

export class SnapshotRetention {
  // per artifact: the hold groups open and how many of them hold each ref
  private readonly holds = new Map<string, { groups: Set<object>; refs: Map<string, number> }>();
  private deferred: Set<string> | 'all' | null = null; // collections asked while a batch was open

  constructor(
    private readonly store: ArtifactStore,
    private readonly options: { now: () => number; log: (line: string) => void; closed: () => boolean },
  ) {}

  private now(): number {
    return this.options.now();
  }

  private log(line: string): void {
    this.options.log(line);
  }

  private get db() {
    return this.store.storage.db;
  }

  private row(artifactId: string, ref: string): AssetRow | undefined {
    if (!ref.startsWith('assets/')) return undefined;
    return this.db.prepare('SELECT assetId, name, sha256, querySnapshot, retiredAt FROM artifact_assets WHERE artifactId = ? AND name = ?').get(artifactId, ref.slice('assets/'.length)) as AssetRow | undefined;
  }

  private managed(artifactId: string): AssetRow[] {
    return this.db.prepare('SELECT assetId, name, sha256, querySnapshot, retiredAt FROM artifact_assets WHERE artifactId = ? AND querySnapshot = 1').all(artifactId) as unknown as AssetRow[];
  }

  private requireFrame(what: string): void {
    if (!this.store.storage.frameOpen) throw new ArtifactStoreError('invalid', `${what} runs inside a write frame (a publication's inFrame or a kind's hook)`);
  }

  /** Whether the asset `assetId` of `artifactId` is a managed query snapshot. */
  isManaged(artifactId: string, assetId: string): boolean {
    return this.db.prepare('SELECT 1 FROM artifact_assets WHERE artifactId = ? AND assetId = ? AND querySnapshot = 1').get(artifactId, assetId) !== undefined;
  }

  /** Of `refs`, the managed query snapshots the artifact still holds: the only assets a collection could take. */
  collectible(artifactId: string, refs: readonly string[]): string[] {
    return refs.filter((ref) => this.row(artifactId, ref)?.querySnapshot === 1);
  }

  /** A duplicate's assets (the M1 review's ruling): of `assetIds`, every ordinary asset and only the query snapshots the
   * copied `state` names, so its first version pins its state alone and no irrelevant retired snapshot travels. */
  copiedAssets(artifactId: string, assetIds: string[], state: Uint8Array): string[] {
    const named = new Set(datasetRefsOf(state));
    const managed = new Map(this.managed(artifactId).map((row) => [row.assetId, refOf(row.name)]));
    return assetIds.filter((assetId) => !managed.has(assetId) || named.has(managed.get(assetId)!));
  }

  // ── inside a write's frame ──

  /** Adoption: the managed asset becomes ordinary (active, never collected); its place in any query's recency stays. */
  adoptInFrame(artifactId: string, assetId: string): void {
    this.db.prepare('UPDATE artifact_assets SET querySnapshot = 0, retiredAt = NULL WHERE artifactId = ? AND assetId = ?').run(artifactId, assetId);
  }

  /** `ArtifactStore.retainQuerySnapshots`: `ref` published by `datasetId` at `revision`, the query trimmed to its latest
   * two, and whatever no longer protected retired, in the caller's frame. An ordinary asset takes its place in the
   * recency and is never retired. */
  retain(artifactId: string, datasetId: string, ref: string, revision: number): void {
    this.requireFrame('retainQuerySnapshots');
    const row = this.row(artifactId, ref);
    if (!row) throw new ArtifactStoreError('notFound', `no asset ${ref} in ${artifactId}`, { artifactId, ref });
    this.db
      .prepare('INSERT INTO artifact_query_snapshots (artifactId, datasetId, assetId, lastUsedSeq) VALUES (?, ?, ?, ?) ON CONFLICT (artifactId, datasetId, assetId) DO UPDATE SET lastUsedSeq = MAX(lastUsedSeq, excluded.lastUsedSeq)')
      .run(artifactId, datasetId, row.assetId, revision);
    const kept = this.db.prepare('SELECT assetId FROM artifact_query_snapshots WHERE artifactId = ? AND datasetId = ? ORDER BY lastUsedSeq DESC').all(artifactId, datasetId) as { assetId: string }[];
    const drop = this.db.prepare('DELETE FROM artifact_query_snapshots WHERE artifactId = ? AND datasetId = ? AND assetId = ?');
    for (const { assetId } of kept.slice(KEPT_PER_QUERY)) drop.run(artifactId, datasetId, assetId);
    this.sweep(artifactId, currentOf(this.store.service.live(artifactId)).refs);
  }

  /** The dashboard kind's hook after each write (`restored`: a restore's, which resets each query to its one snapshot). */
  reconcile(artifactId: string, doc: Doc, options: { restored?: boolean } = {}): void {
    this.requireFrame('reconcileQuerySnapshots');
    const managed = this.db.prepare('SELECT 1 FROM artifact_assets WHERE artifactId = ? AND querySnapshot = 1 LIMIT 1').get(artifactId) !== undefined;
    if (!managed && this.db.prepare('SELECT 1 FROM artifact_query_snapshots WHERE artifactId = ? LIMIT 1').get(artifactId) === undefined) return;
    const current = currentOf(doc);
    for (const ref of current.files) {
      const row = this.row(artifactId, ref);
      if (row?.querySnapshot === 1) this.adoptInFrame(artifactId, row.assetId);
    }
    const memberships = this.db.prepare('SELECT datasetId, assetId FROM artifact_query_snapshots WHERE artifactId = ?').all(artifactId) as { datasetId: string; assetId: string }[];
    const drop = this.db.prepare('DELETE FROM artifact_query_snapshots WHERE artifactId = ? AND datasetId = ? AND assetId = ?');
    const enrolled = new Set<string>();
    for (const { datasetId, assetId } of memberships) {
      if (options.restored || !current.queries.has(datasetId)) drop.run(artifactId, datasetId, assetId);
      else enrolled.add(datasetId);
    }
    const revision = this.store.revision(artifactId);
    const enroll = this.db.prepare('INSERT INTO artifact_query_snapshots (artifactId, datasetId, assetId, lastUsedSeq) VALUES (?, ?, ?, ?)');
    for (const [datasetId, ref] of current.queries) {
      const row = enrolled.has(datasetId) ? undefined : this.row(artifactId, ref);
      if (row) enroll.run(artifactId, datasetId, row.assetId, revision);
    }
    this.sweep(artifactId, current.refs);
  }

  // Each managed asset active exactly while a membership or a current descriptor names it.
  private sweep(artifactId: string, current: Set<string>): void {
    const members = new Set((this.db.prepare('SELECT DISTINCT assetId FROM artifact_query_snapshots WHERE artifactId = ?').all(artifactId) as { assetId: string }[]).map((row) => row.assetId));
    const set = this.db.prepare('UPDATE artifact_assets SET retiredAt = ? WHERE artifactId = ? AND assetId = ?');
    const at = this.now();
    for (const row of this.managed(artifactId)) {
      const kept = members.has(row.assetId) || current.has(refOf(row.name));
      if (kept && row.retiredAt !== null) set.run(null, artifactId, row.assetId);
      else if (!kept && row.retiredAt === null) set.run(at, artifactId, row.assetId);
    }
  }

  // ── after a commit ──

  /** `ArtifactStore.removeAsset`: a managed snapshot no current descriptor names leaves its memberships and is retired,
   * then collected unless a version or a hold still protects it. */
  async remove(artifactId: string, ref: string): Promise<{ status: 'removed' | 'retained' | 'notFound' }> {
    const found = this.row(artifactId, ref);
    if (!found) return { status: 'notFound' };
    if (found.querySnapshot !== 1 || this.currentRefs(artifactId).has(ref)) return { status: 'retained' };
    await this.store.service.inBatch(() => {
      const row = this.row(artifactId, ref);
      if (!row || row.querySnapshot !== 1) return;
      this.db.prepare('DELETE FROM artifact_query_snapshots WHERE artifactId = ? AND assetId = ?').run(artifactId, row.assetId);
      if (row.retiredAt === null) this.db.prepare('UPDATE artifact_assets SET retiredAt = ? WHERE artifactId = ? AND assetId = ?').run(this.now(), artifactId, row.assetId);
    });
    while (this.store.storage.batchOpen) await this.store.service.whenCommitted();
    this.collect(artifactId);
    return { status: this.row(artifactId, ref) ? 'retained' : 'removed' };
  }

  /** `ArtifactStore.collectRetiredAssets`: post-commit only; asked while a batch is open, it runs once that batch has. */
  collect(artifactId?: string): void {
    const { storage } = this.store;
    if (storage.readOnly || this.options.closed()) return;
    if (storage.batchOpen) return this.defer(artifactId);
    const candidates = (
      artifactId === undefined
        ? this.db.prepare('SELECT artifactId, assetId, name, sha256 FROM artifact_assets WHERE querySnapshot = 1 AND retiredAt IS NOT NULL ORDER BY artifactId').all()
        : this.db.prepare('SELECT artifactId, assetId, name, sha256 FROM artifact_assets WHERE artifactId = ? AND querySnapshot = 1 AND retiredAt IS NOT NULL').all(artifactId)
    ) as { artifactId: string; assetId: string; name: string; sha256: string }[];
    if (candidates.length === 0) return;
    const pinned = this.db.prepare('SELECT 1 FROM artifact_versions v, json_each(v.assetRefs) j WHERE v.artifactId = ? AND j.value = ? LIMIT 1');
    const member = this.db.prepare('SELECT 1 FROM artifact_query_snapshots WHERE artifactId = ? AND assetId = ? LIMIT 1');
    const remove = this.db.prepare('DELETE FROM artifact_assets WHERE artifactId = ? AND assetId = ? AND querySnapshot = 1 AND retiredAt IS NOT NULL');
    const sameBytes = this.db.prepare('SELECT 1 FROM artifact_assets WHERE artifactId = ? AND sha256 = ? LIMIT 1');
    const current = new Map<string, Set<string>>();
    const unlink: { artifactId: string; sha256: string }[] = [];
    for (const row of candidates) {
      if (!current.has(row.artifactId)) current.set(row.artifactId, this.currentRefs(row.artifactId));
      const ref = refOf(row.name);
      if (current.get(row.artifactId)!.has(ref) || this.held(row.artifactId, ref)) continue;
      if (pinned.get(row.artifactId, row.assetId) !== undefined || member.get(row.artifactId, row.assetId) !== undefined) continue;
      if (Number(remove.run(row.artifactId, row.assetId).changes) > 0) unlink.push(row); // its own statement, committed now
    }
    for (const { artifactId: id, sha256 } of unlink) {
      if (sameBytes.get(id, sha256) !== undefined) continue; // another row still names these bytes
      try {
        rmSync(join(this.store.files.dirOf(id), ArtifactFiles.assetPath(sha256)), { force: true });
      } catch (error) {
        this.log(`a collected snapshot's bytes stay as an orphan: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private defer(artifactId: string | undefined): void {
    const first = this.deferred === null;
    if (artifactId === undefined || this.deferred === 'all') this.deferred = 'all';
    else {
      const ids: Set<string> = this.deferred ?? new Set();
      ids.add(artifactId);
      this.deferred = ids;
    }
    if (!first) return;
    const run = () => {
      const asked = this.deferred;
      this.deferred = null;
      if (asked === 'all') this.collect();
      else for (const id of asked ?? []) this.collect(id);
    };
    this.store.service.whenCommitted().then(run, run);
  }

  // The refs the artifact's live descriptors name now (its document read without opening it when not loaded).
  private currentRefs(artifactId: string): Set<string> {
    const { service } = this.store;
    const loaded = service.loaded(artifactId);
    if (loaded) return currentOf(loaded).refs;
    const doc = newDoc();
    try {
      applyV2(doc, service.readState(artifactId).state);
      return currentOf(doc).refs;
    } finally {
      doc.destroy();
    }
  }

  // ── holds ──

  /** One hold over `refs` of `artifactId`, all or none: past a bound it fails `tooLarge`, a ref the artifact no longer
   * holds `notFound` (the snapshot is unavailable), with nothing held. Synchronous, so a capture and its hold share a turn. */
  hold(artifactId: string, refs: readonly string[]): AssetHold {
    const wanted = [...new Set(refs)];
    if (wanted.length === 0) return { release: () => {} }; // nothing to protect: no hold counted
    const entry = this.holds.get(artifactId) ?? { groups: new Set<object>(), refs: new Map<string, number>() };
    const limit = (which: keyof typeof ASSET_HOLD_LIMITS, what: string) => new ArtifactStoreError('tooLarge', `${what} (at most ${ASSET_HOLD_LIMITS[which]}); nothing was held`, { hold: which, limit: ASSET_HOLD_LIMITS[which] });
    if (wanted.length > ASSET_HOLD_LIMITS.groupRefs) throw limit('groupRefs', `one hold names ${wanted.length} snapshots`);
    if (entry.groups.size >= ASSET_HOLD_LIMITS.groups) throw limit('groups', `${artifactId} has ${entry.groups.size} holds open`);
    const added = wanted.filter((ref) => !entry.refs.has(ref)).length;
    if (entry.refs.size + added > ASSET_HOLD_LIMITS.refs) throw limit('refs', `${artifactId} would hold ${entry.refs.size + added} snapshots`);
    for (const ref of wanted) {
      if (!this.row(artifactId, ref)) throw new ArtifactStoreError('notFound', `the snapshot ${ref} of ${artifactId} is unavailable; read the dataset again`, { artifactId, ref, snapshotUnavailable: true });
    }
    const group = {};
    entry.groups.add(group);
    for (const ref of wanted) entry.refs.set(ref, (entry.refs.get(ref) ?? 0) + 1);
    this.holds.set(artifactId, entry);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        entry.groups.delete(group);
        for (const ref of wanted) {
          const count = (entry.refs.get(ref) ?? 1) - 1;
          if (count > 0) entry.refs.set(ref, count);
          else entry.refs.delete(ref);
        }
        if (entry.groups.size === 0 && this.holds.get(artifactId) === entry) this.holds.delete(artifactId);
        try {
          this.collect(artifactId);
        } catch (error) {
          this.log(`collecting after a hold's release failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    };
  }

  private held(artifactId: string, ref: string): boolean {
    return this.holds.get(artifactId)?.refs.has(ref) ?? false;
  }
}
