// E3 M1 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1; E's Decision Log 48 (1) and (2)): the retention
// of query snapshots over a real store, its dashboard kind registered. The latest two distinct snapshots per query are
// kept (reuse counts, durable across a restart), plus every ref a current descriptor names, every ref a retained version
// pins and (holds.test.ts) every held ref; what falls out is retired in the publication's own frame, leaving later
// versions without it and earlier versions as they were, and collected after the commit: after a hold's release, the
// nightly thinning, the owner's prune and at the store's reopen. Restore, duplicate and adoption reset membership as R1
// says. The refresh below is the write M2's trusted refresh makes: one `writeWithAssets` whose snapshot asset is marked a
// query snapshot under a fresh UUID name, the descriptor moved, and `retainQuerySnapshots` in the same frame.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listDatasets, readDataset, removeDataset, setDataset, snapshotOf, type DatasetDescriptor } from '@artifacts/dashboard/datasets';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { registerDashboards, type Dashboards } from '../dashboards';
import { openDocuments, type Documents } from '.';
import { ArtifactFiles } from './bytes';
import { AUTO_EVERY_MS, AUTO_IDLE_MS } from './store';

const human: Actor = { kind: 'human' };
const agent: Actor = { kind: 'session', appSessionId: 'app-r' as AppSessionId };
const bytes = (text: string) => new TextEncoder().encode(text);
const CONTENT = { A: '[{"v":1}]', B: '[{"v":2}]', C: '[{"v":3}]', D: '[{"v":4}]', E: '[{"v":5}]' } as const;
type Content = keyof typeof CONTENT;

let userData: string;
let documents: Documents;
let dashboards: Dashboards;
const open = () => {
  documents = openDocuments(userData, () => {})!;
  dashboards = registerDashboards({ documents });
};
const close = () => {
  dashboards.close();
  documents.close();
};
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-retention-'));
  open();
});
afterEach(() => {
  vi.useRealTimers();
  close();
  rmSync(userData, { recursive: true, force: true });
});
const store = () => documents.store;
const db = () => documents.storage.db;

const queryDescriptor = (snapshot: { ref: string; at: number } | null, by: Actor = human): DatasetDescriptor =>
  snapshot
    ? { title: 'Live', source: { kind: 'query', server: 'fixture', tool: 'rows', args: {}, snapshot }, columns: [{ name: 'v', type: 'number' }], rows: 1, updated: { at: snapshot.at, by }, state: { status: 'ok', at: snapshot.at } }
    : { title: 'Live', source: { kind: 'query', server: 'fixture', tool: 'rows', args: {}, snapshot: null }, columns: [], rows: 0, state: { status: 'ok', at: Date.now() } };

/** M2's publication: the snapshot under a fresh UUID name, marked a query snapshot, the descriptor and the retention in one frame. */
async function refresh(artifactId: string, datasetId: string, content: Content, actor: Actor = human, after?: () => void): Promise<string> {
  let ref = '';
  const at = Date.now();
  await store().writeWithAssets(
    artifactId,
    actor,
    [{ bytes: bytes(CONTENT[content]), name: `query-${randomUUID()}.json`, mime: 'application/json', querySnapshot: true }],
    (doc, refs) => {
      ref = refs[0]!.ref;
      setDataset(doc, datasetId, queryDescriptor({ ref, at }, actor));
    },
    {
      inFrame: (revision) => {
        store().retainQuerySnapshots(artifactId, datasetId, ref, revision);
        after?.();
      },
    },
  );
  return ref;
}

const dashboard = async () => (await store().create({ kind: 'dashboard', title: 'Board' }, human)).id;
const rowOf = (artifactId: string, ref: string) =>
  db().prepare("SELECT assetId, sha256, querySnapshot, retiredAt FROM artifact_assets WHERE artifactId = ? AND 'assets/' || name = ?").get(artifactId, ref) as { assetId: string; sha256: string; querySnapshot: number; retiredAt: number | null } | undefined;
const refOfId = (artifactId: string, assetId: string) => `assets/${(db().prepare('SELECT name FROM artifact_assets WHERE artifactId = ? AND assetId = ?').get(artifactId, assetId) as { name: string }).name}`;
const members = (artifactId: string, datasetId: string) =>
  (db().prepare('SELECT assetId FROM artifact_query_snapshots WHERE artifactId = ? AND datasetId = ? ORDER BY lastUsedSeq').all(artifactId, datasetId) as { assetId: string }[]).map((row) => refOfId(artifactId, row.assetId));
const retired = (artifactId: string, ref: string) => rowOf(artifactId, ref)?.retiredAt != null;
const fileOf = (artifactId: string, sha256: string) => join(store().files.dirOf(artifactId), ArtifactFiles.assetPath(sha256));
const versionRefs = (artifactId: string, versionId: number) => store().versions.version(artifactId, versionId)!.assetRefs.map((id) => refOfId(artifactId, id));

describe('the latest two distinct snapshots per query', () => {
  it('A → B → A → C keeps A and C: a reuse counts as the latest use, and the one that falls out is retired then collected', async () => {
    const id = await dashboard();
    const a = await refresh(id, 'live', 'A');
    const b = await refresh(id, 'live', 'B');
    expect(await refresh(id, 'live', 'A')).toBe(a); // identical bytes answer the ref the artifact holds
    const c = await refresh(id, 'live', 'C');
    expect(members(id, 'live')).toEqual([a, c]);
    expect([retired(id, a), retired(id, b), retired(id, c)]).toEqual([false, true, false]);
    const { sha256 } = rowOf(id, b)!;
    expect(existsSync(fileOf(id, sha256))).toBe(true); // retired, not yet collected: no unlink inside the frame
    store().collectRetiredAssets(id);
    expect(rowOf(id, b)).toBeUndefined();
    expect(existsSync(fileOf(id, sha256))).toBe(false);
    expect(readDataset(store().service.live(id), 'live')?.source).toMatchObject({ snapshot: { ref: c } });
  });

  it('repeated identical content advances its use without consuming a second slot', async () => {
    const id = await dashboard();
    const a = await refresh(id, 'live', 'A');
    const b = await refresh(id, 'live', 'B');
    await refresh(id, 'live', 'B');
    await refresh(id, 'live', 'B');
    expect(members(id, 'live')).toEqual([a, b]);
    expect(retired(id, a)).toBe(false);
  });

  it('keeps the ordering durable across restarts, and collects what was retired at the reopen', async () => {
    const id = await dashboard();
    const a = await refresh(id, 'live', 'A');
    const b = await refresh(id, 'live', 'B');
    close();
    open();
    await refresh(id, 'live', 'A');
    close();
    open();
    const c = await refresh(id, 'live', 'C');
    expect(members(id, 'live')).toEqual([a, c]);
    expect(retired(id, b)).toBe(true);
    const { sha256 } = rowOf(id, b)!;
    close();
    open(); // the reopen collects
    expect(rowOf(id, b)).toBeUndefined();
    expect(existsSync(fileOf(id, sha256))).toBe(false);
    expect(members(id, 'live')).toEqual([a, c]);
  });

  it('protects a ref another query shares until no query and no current descriptor uses it', async () => {
    const id = await dashboard();
    const a = await refresh(id, 'one', 'A');
    expect(await refresh(id, 'two', 'A')).toBe(a); // deduplicated: one asset, two memberships
    await refresh(id, 'one', 'B');
    await refresh(id, 'one', 'C');
    expect(members(id, 'one')).not.toContain(a);
    expect(retired(id, a)).toBe(false); // still `two`'s current snapshot and member
    await refresh(id, 'two', 'D');
    await refresh(id, 'two', 'E');
    expect(retired(id, a)).toBe(true);
  });

  it('an ordinary asset a refresh deduplicates to takes its place in the recency, and is never retired or collected', async () => {
    const id = await dashboard();
    const upload = await store().uploadAsset(id, bytes(CONTENT.A), { name: 'mine.json', mime: 'application/json' }, human);
    expect(await refresh(id, 'live', 'A')).toBe(upload.ref);
    expect(rowOf(id, upload.ref)).toMatchObject({ querySnapshot: 0, retiredAt: null });
    expect(members(id, 'live')).toEqual([upload.ref]); // a member by recency, never by eligibility
    await refresh(id, 'live', 'B');
    await refresh(id, 'live', 'C');
    await refresh(id, 'live', 'D');
    expect(members(id, 'live')).toHaveLength(2);
    expect(rowOf(id, upload.ref)).toMatchObject({ querySnapshot: 0, retiredAt: null });
    store().collectRetiredAssets();
    expect(rowOf(id, upload.ref)).toBeDefined();
  });

  it('managed A → managed B → ordinary C trims A and keeps B and C, C never collectible; the order survives a restart and C’s reuse counts', async () => {
    const id = await dashboard();
    const a = await refresh(id, 'live', 'A');
    const b = await refresh(id, 'live', 'B');
    const ordinary = await store().uploadAsset(id, bytes(CONTENT.C), { name: 'mine.json', mime: 'application/json' }, human);
    expect(await refresh(id, 'live', 'C')).toBe(ordinary.ref);
    expect(members(id, 'live')).toEqual([b, ordinary.ref]);
    expect([retired(id, a), retired(id, b)]).toEqual([true, false]);
    store().collectRetiredAssets(id);
    expect(rowOf(id, a)).toBeUndefined();
    close();
    open();
    const d = await refresh(id, 'live', 'D');
    expect(members(id, 'live')).toEqual([ordinary.ref, d]); // B, the oldest, falls out
    expect(retired(id, b)).toBe(true);
    expect(await refresh(id, 'live', 'C')).toBe(ordinary.ref); // reused: the latest again
    const e = await refresh(id, 'live', 'E');
    expect(members(id, 'live')).toEqual([ordinary.ref, e]);
    expect(retired(id, d)).toBe(true);
    store().collectRetiredAssets();
    expect(rowOf(id, ordinary.ref)).toMatchObject({ querySnapshot: 0, retiredAt: null });
  });
});

describe('collection after the commit', () => {
  it('asked while a batch is open, never unlinks inside it: it runs once that batch has committed', async () => {
    const id = await dashboard();
    const a = await refresh(id, 'live', 'A');
    await refresh(id, 'live', 'B');
    await refresh(id, 'live', 'C');
    const { sha256 } = rowOf(id, a)!;
    const writing = store().service.writeAs(id, human, (doc) => doc.get('root').setAttr('note', 'x')); // a batch now open
    expect(documents.storage.batchOpen).toBe(true);
    store().collectRetiredAssets(id);
    expect(rowOf(id, a)).toBeDefined();
    expect(existsSync(fileOf(id, sha256))).toBe(true);
    await writing;
    await vi.waitFor(() => expect(rowOf(id, a)).toBeUndefined());
    expect(existsSync(fileOf(id, sha256))).toBe(false);
  });

  it('called right after a publication’s durable commit (M2’s refresh), it collects at once, in that call', async () => {
    const id = await dashboard();
    const a = await refresh(id, 'live', 'A');
    await refresh(id, 'live', 'B');
    await refresh(id, 'live', 'C'); // resolved: its commit is durable
    expect(documents.storage.batchOpen).toBe(false);
    const { sha256 } = rowOf(id, a)!;
    store().collectRetiredAssets(id);
    expect(rowOf(id, a)).toBeUndefined(); // no deferral, no unrelated trigger awaited
    expect(existsSync(fileOf(id, sha256))).toBe(false);
  });
});

describe('the invariants under reuse, failure and concurrency', () => {
  it('a refresh deduplicating to a retired snapshot keeps its original ref; once collected, the same bytes get a new ref', async () => {
    const id = await dashboard();
    const a = await refresh(id, 'live', 'A');
    const b = await refresh(id, 'live', 'B');
    await refresh(id, 'live', 'C');
    expect(retired(id, a)).toBe(true);
    expect(await refresh(id, 'live', 'A')).toBe(a); // reactivated under its own immutable ref
    expect(retired(id, a)).toBe(false);
    store().collectRetiredAssets(id);
    expect(rowOf(id, b)).toBeUndefined();
    const again = await refresh(id, 'live', 'B');
    expect(again).not.toBe(b); // a collected ref is never reused
  });

  it('a failed unlink leaves an orphan file, never a committed row without its bytes', async () => {
    const id = await dashboard();
    const a = await refresh(id, 'live', 'A');
    await refresh(id, 'live', 'B');
    await refresh(id, 'live', 'C');
    const path = fileOf(id, rowOf(id, a)!.sha256);
    rmSync(path);
    mkdirSync(path); // the unlink of a file now fails
    writeFileSync(join(path, 'x'), '');
    store().collectRetiredAssets(id);
    expect(rowOf(id, a)).toBeUndefined();
    expect(existsSync(path)).toBe(true);
    for (const asset of store().listAssets(id)) expect(existsSync(fileOf(id, asset.sha256)), asset.ref).toBe(true);
  });

  it('a restore and a refresh committing together leave every named snapshot active, its bytes present, each query at most two', async () => {
    const id = await dashboard();
    await refresh(id, 'live', 'A');
    const v1 = (await store().createVersion(id, { kind: 'named', actor: human, label: 'v1' }))!;
    await refresh(id, 'live', 'B');
    await refresh(id, 'live', 'C');
    await Promise.all([store().restore(id, v1, human), refresh(id, 'live', 'D'), refresh(id, 'other', 'E')]);
    await refresh(id, 'live', 'B');
    store().collectRetiredAssets();
    const live = store().service.live(id);
    for (const datasetId of ['live', 'other']) {
      const descriptor = readDataset(live, datasetId);
      if (!descriptor) {
        expect(members(id, datasetId), datasetId).toEqual([]); // the restore took it back: so went its membership
        continue;
      }
      const { snapshot } = descriptor.source as { snapshot: { ref: string } };
      expect(rowOf(id, snapshot.ref), datasetId).toMatchObject({ retiredAt: null });
      expect(members(id, datasetId).length).toBeLessThanOrEqual(2);
    }
    const named = new Set(listDatasets(live).map(({ descriptor }) => snapshotOf(descriptor)!.ref));
    for (const asset of store().listAssets(id)) expect(existsSync(fileOf(id, asset.sha256)), asset.ref).toBe(true);
    for (const ref of named) expect(rowOf(id, ref)).toBeDefined();
    for (const version of store().listVersions(id)) for (const ref of versionRefs(id, version.id)) expect(existsSync(fileOf(id, rowOf(id, ref)!.sha256)), ref).toBe(true);
  });
});

describe('membership across the dataset lifecycle', () => {
  it('removing the dataset, or configuring another source, clears its membership and retires what nobody uses', async () => {
    const id = await dashboard();
    const a = await refresh(id, 'live', 'A');
    const b = await refresh(id, 'live', 'B');
    await store().service.writeAs(id, human, (doc) => removeDataset(doc, 'live'));
    expect(members(id, 'live')).toEqual([]);
    expect([retired(id, a), retired(id, b)]).toEqual([true, true]);
    const c = await refresh(id, 'other', 'C');
    await store().service.writeAs(id, human, (doc) => setDataset(doc, 'other', queryDescriptor(null))); // a new source, never fetched
    expect(members(id, 'other')).toEqual([]);
    expect(retired(id, c)).toBe(true);
  });

  it('a file dataset bound to a managed snapshot adopts it: ordinary and never collected, its place in the recency kept', async () => {
    const id = await dashboard();
    const a = await refresh(id, 'live', 'A');
    const b = await refresh(id, 'live', 'B');
    const at = Date.now();
    await store().writeWithAssets(id, agent, [], (doc) => setDataset(doc, 'file', { title: 'Kept', source: { kind: 'file', ref: a, name: 'kept.json', format: 'json', sha256: rowOf(id, a)!.sha256, size: 9 }, columns: [{ name: 'v', type: 'number' }], rows: 1, updated: { at, by: agent }, state: { status: 'ok', at } }));
    expect(rowOf(id, a)).toMatchObject({ querySnapshot: 0, retiredAt: null });
    expect(members(id, 'live')).toEqual([a, b]); // eligibility changed, recency kept
    const c = await refresh(id, 'live', 'C');
    expect(members(id, 'live')).toEqual([b, c]);
    await refresh(id, 'live', 'D');
    await store().service.writeAs(id, human, (doc) => removeDataset(doc, 'file'));
    store().collectRetiredAssets(id);
    expect(rowOf(id, a)).toMatchObject({ querySnapshot: 0, retiredAt: null }); // ordinary now, whoever uses it
  });

  it('an upload or a copy deduplicating to a managed snapshot adopts it', async () => {
    const id = await dashboard();
    const other = await dashboard();
    const a = await refresh(id, 'live', 'A');
    const b = await refresh(id, 'live', 'B');
    expect((await store().uploadAsset(id, bytes(CONTENT.A), { name: 'again.json', mime: 'application/json' }, human)).ref).toBe(a);
    expect(rowOf(id, a)).toMatchObject({ querySnapshot: 0, retiredAt: null });
    expect(members(id, 'live')).toEqual([a, b]); // adopted, its recency kept
    const c = await refresh(other, 'live', 'C');
    expect((await store().copyAsset(id, b, other, human)).ref).not.toBe(c);
    expect((await store().copyAsset(id, b, id, human)).ref).toBe(b); // the copy deduplicates to the managed row: adopted
    expect(rowOf(id, b)).toMatchObject({ querySnapshot: 0 });
  });

  it('retainQuerySnapshots refuses outside a write frame; a frame taken back takes its membership and retirement with it', async () => {
    const id = await dashboard();
    const a = await refresh(id, 'live', 'A');
    const b = await refresh(id, 'live', 'B');
    expect(() => store().retainQuerySnapshots(id, 'live', a, 1)).toThrow(/write frame/);
    await expect(
      refresh(id, 'live', 'C', human, () => {
        throw new Error('the publication failed after its retention');
      }),
    ).rejects.toThrow();
    expect(members(id, 'live')).toEqual([a, b]);
    expect([retired(id, a), retired(id, b)]).toEqual([false, false]);
    expect((db().prepare("SELECT COUNT(*) AS n FROM artifact_assets WHERE artifactId = ? AND querySnapshot = 1").get(id) as { n: number }).n).toBe(2);
    expect(readDataset(store().service.live(id), 'live')?.source).toMatchObject({ snapshot: { ref: b } });
  });
});

describe('versions, restore and duplicate', () => {
  it('a retained version keeps its pinned snapshot; later versions leave a retired one out; the owner’s prune lets it go', async () => {
    const id = await dashboard();
    const a = await refresh(id, 'live', 'A');
    const v1 = (await store().createVersion(id, { kind: 'named', actor: human, label: 'With A' }))!;
    expect(versionRefs(id, v1)).toEqual([a]);
    const b = await refresh(id, 'live', 'B');
    const c = await refresh(id, 'live', 'C');
    expect(retired(id, a)).toBe(true);
    store().collectRetiredAssets(id);
    expect(rowOf(id, a)).toBeDefined(); // pinned by v1
    expect(versionRefs(id, v1)).toEqual([a]); // retirement never rewrites a version
    const v2 = (await store().createVersion(id, { kind: 'named', actor: human, label: 'Later' }))!;
    expect(versionRefs(id, v2).sort()).toEqual([b, c].sort());
    const { sha256 } = rowOf(id, a)!;
    await store().pruneVersions(id, store().versions.version(id, v1)!.at + 1);
    expect(store().versions.version(id, v1)).toBeUndefined();
    expect(rowOf(id, a)).toBeUndefined();
    expect(existsSync(fileOf(id, sha256))).toBe(false);
    expect(rowOf(id, b)).toBeDefined();
  });

  it('the nightly thinning drops an unnamed auto version and then collects the snapshot only it pinned', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.UTC(2026, 9, 10, 9, 0);
    vi.setSystemTime(t0);
    close();
    open(); // the store's clock is the faked one from here
    const id = await dashboard();
    const a = await refresh(id, 'live', 'A');
    await store().autoVersion(id); // pins A
    vi.setSystemTime(t0 + 60_000);
    await refresh(id, 'live', 'B');
    const c = await refresh(id, 'live', 'C');
    await refresh(id, 'live', 'D');
    await store().autoVersion(id); // pins C and D, in A's hour: the hour keeps this one
    vi.setSystemTime(t0 + 120_000);
    await refresh(id, 'live', 'E');
    await store().autoVersion(id); // the newest, never thinned
    expect(retired(id, a)).toBe(true);
    store().collectRetiredAssets(id);
    expect(rowOf(id, a)).toBeDefined(); // the first auto version pins it
    vi.setSystemTime(t0 + 2 * 24 * 3_600_000);
    const report = await store().maintenance.run();
    expect(report.versionsThinned).toBe(1);
    expect(rowOf(id, a)).toBeUndefined();
    expect(rowOf(id, c)).toBeDefined(); // still pinned by the version the hour kept
  });

  it('restore reactivates the snapshot the version names before its restore version pins it, and resets membership to it', async () => {
    const id = await dashboard();
    const a = await refresh(id, 'live', 'A');
    const v1 = (await store().createVersion(id, { kind: 'named', actor: human, label: 'With A' }))!;
    const b = await refresh(id, 'live', 'B');
    const c = await refresh(id, 'live', 'C');
    expect(retired(id, a)).toBe(true);
    const { versionId } = await store().restore(id, v1, human);
    expect(readDataset(store().service.live(id), 'live')?.source).toMatchObject({ snapshot: { ref: a } });
    expect(retired(id, a)).toBe(false);
    expect(members(id, 'live')).toEqual([a]);
    expect([retired(id, b), retired(id, c)]).toEqual([true, true]);
    expect(versionRefs(id, versionId)).toContain(a);
    expect(versionRefs(id, versionId)).not.toContain(b);
    const d = await refresh(id, 'live', 'D');
    expect(members(id, 'live')).toEqual([a, d]);
  });

  it('a restore holds the snapshots its version names from its first step: a prune dropping that version while the restore waits never takes them', async () => {
    const id = await dashboard();
    const a = await refresh(id, 'live', 'A');
    const v1 = (await store().createVersion(id, { kind: 'named', actor: human, label: 'With A' }))!;
    await refresh(id, 'live', 'B');
    await refresh(id, 'live', 'C');
    expect(retired(id, a)).toBe(true); // pinned by v1 alone
    const { sha256 } = rowOf(id, a)!;
    // the restore's first await (its pre-restore auto version) is held open while the owner prunes every version
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const autoVersion = store().autoVersion.bind(store());
    vi.spyOn(store(), 'autoVersion').mockImplementationOnce(async (artifactId) => {
      await gate;
      return autoVersion(artifactId);
    });
    const restoring = store().restore(id, v1, human);
    await store().pruneVersions(id, Date.now() + 1);
    expect(store().versions.version(id, v1)).toBeUndefined();
    expect(rowOf(id, a)).toBeDefined(); // the restore's hold kept it through the prune's collection
    open();
    await restoring;
    expect(readDataset(store().service.live(id), 'live')?.source).toMatchObject({ snapshot: { ref: a } });
    expect(rowOf(id, a)).toMatchObject({ retiredAt: null });
    expect(existsSync(fileOf(id, sha256))).toBe(true);
    store().collectRetiredAssets(id);
    expect(rowOf(id, a)).toBeDefined(); // current now
  });

  it('a restore holds query snapshots alone: a file dataset naming an asset the store does not hold restores as before', async () => {
    const id = await dashboard();
    const at = Date.now();
    await store().service.writeAs(id, human, (doc) => setDataset(doc, 'sales', { title: 'Sales', source: { kind: 'file', ref: 'assets/sales.csv', name: 'sales.csv', format: 'csv', sha256: 'c'.repeat(64), size: 9 }, columns: [{ name: 'v', type: 'number' }], rows: 1, updated: { at, by: human }, state: { status: 'ok', at } }));
    const a = await refresh(id, 'live', 'A');
    const v1 = (await store().createVersion(id, { kind: 'named', actor: human, label: 'v1' }))!;
    await store().service.writeAs(id, human, (doc) => removeDataset(doc, 'sales'));
    await refresh(id, 'live', 'B');
    await refresh(id, 'live', 'C');
    await store().restore(id, v1, human); // no hold asked for the file's placeholder ref
    const live = store().service.live(id);
    expect(readDataset(live, 'sales')?.source).toMatchObject({ kind: 'file', ref: 'assets/sales.csv' });
    expect(readDataset(live, 'live')?.source).toMatchObject({ snapshot: { ref: a } });
    expect(rowOf(id, a)).toMatchObject({ retiredAt: null });
  });

  it('a restore refused after its hold lets the hold go', async () => {
    const id = await dashboard();
    const a = await refresh(id, 'live', 'A');
    const v1 = (await store().createVersion(id, { kind: 'named', actor: human, label: 'With A' }))!;
    await refresh(id, 'live', 'B');
    await refresh(id, 'live', 'C');
    vi.spyOn(store(), 'versionInFrame').mockImplementationOnce(() => {
      throw new Error('the pre-restore version failed');
    });
    await expect(store().restore(id, v1, human)).rejects.toThrow('the pre-restore version failed');
    await store().pruneVersions(id, Date.now() + 1);
    expect(rowOf(id, a)).toBeUndefined(); // nothing held it any more
  });

  it('a live duplicate copies the snapshots its state names and the ordinary assets, never the query snapshots it cannot name; its import version pins its state alone', async () => {
    const id = await dashboard();
    const a = await refresh(id, 'live', 'A');
    const b = await refresh(id, 'live', 'B');
    const picture = await store().uploadAsset(id, bytes('a picture'), { name: 'p.png', mime: 'image/png' }, human);
    const sourceHold = store().holdAsset(id, a); // a hold of the source is never copied
    const copy = await store().duplicate(id, {}, human);
    expect(rowOf(copy.id, a)).toBeUndefined(); // the source's previous snapshot: its copy's state cannot name it
    expect(rowOf(copy.id, b)).toMatchObject({ querySnapshot: 1, retiredAt: null });
    expect(rowOf(copy.id, picture.ref)).toMatchObject({ querySnapshot: 0 });
    expect(members(copy.id, 'live')).toEqual([b]);
    const imported = store().listVersions(copy.id).find((version) => version.kind === 'import')!;
    expect(versionRefs(copy.id, imported.id).sort()).toEqual([b, picture.ref].sort());
    expect(existsSync(fileOf(copy.id, rowOf(id, a)!.sha256))).toBe(false);
    expect(members(id, 'live')).toEqual([a, b]); // the source unchanged
    expect(rowOf(id, a)).toMatchObject({ retiredAt: null });
    sourceHold.release();
    await refresh(copy.id, 'live', 'C');
    await refresh(copy.id, 'live', 'D');
    expect(retired(copy.id, b)).toBe(true);
    store().collectRetiredAssets(copy.id);
    expect(rowOf(copy.id, b)).toBeDefined(); // the copy's import version pins the snapshot it started with
  });

  it('a version duplicate copies the version’s pinned rows, a retired one active again in the copy', async () => {
    const id = await dashboard();
    const a = await refresh(id, 'live', 'A');
    const v1 = (await store().createVersion(id, { kind: 'named', actor: human, label: 'With A' }))!;
    await refresh(id, 'live', 'B');
    await refresh(id, 'live', 'C');
    expect(retired(id, a)).toBe(true);
    const copy = await store().duplicate(id, { versionId: v1 }, human);
    expect(rowOf(copy.id, a)).toMatchObject({ querySnapshot: 1, retiredAt: null });
    expect(members(copy.id, 'live')).toEqual([a]);
    const imported = store().listVersions(copy.id).find((version) => version.kind === 'import')!;
    expect(versionRefs(copy.id, imported.id)).toEqual([a]);
  });

  it('a version duplicate leaves out the version’s pinned snapshots its state cannot name', async () => {
    const id = await dashboard();
    const a = await refresh(id, 'live', 'A');
    const b = await refresh(id, 'live', 'B');
    const v2 = (await store().createVersion(id, { kind: 'named', actor: human, label: 'With B' }))!;
    expect(versionRefs(id, v2).sort()).toEqual([a, b].sort()); // A was still a member when v2 was taken
    const copy = await store().duplicate(id, { versionId: v2 }, human);
    expect(rowOf(copy.id, a)).toBeUndefined();
    expect(members(copy.id, 'live')).toEqual([b]);
    const imported = store().listVersions(copy.id).find((version) => version.kind === 'import')!;
    expect(versionRefs(copy.id, imported.id)).toEqual([b]);
  });
});

describe('removeAsset', () => {
  it('answers notFound, retained (ordinary, current or pinned) or removed (retired and collected)', async () => {
    const id = await dashboard();
    expect(await store().removeAsset(id, 'assets/none.json')).toEqual({ status: 'notFound' });
    const upload = await store().uploadAsset(id, bytes('x'), { name: 'x.txt', mime: 'text/plain' }, human);
    expect(await store().removeAsset(id, upload.ref)).toEqual({ status: 'retained' });
    const a = await refresh(id, 'live', 'A');
    const v1 = (await store().createVersion(id, { kind: 'named', actor: human, label: 'With A' }))!;
    const b = await refresh(id, 'live', 'B');
    expect(await store().removeAsset(id, b)).toEqual({ status: 'retained' }); // the current snapshot
    expect(await store().removeAsset(id, a)).toEqual({ status: 'retained' }); // pinned by v1: retired, bytes kept
    expect(retired(id, a)).toBe(true);
    expect(members(id, 'live')).toEqual([b]);
    await store().pruneVersions(id, store().versions.version(id, v1)!.at + 1);
    expect(rowOf(id, a)).toBeUndefined();
    const c = await refresh(id, 'live', 'C');
    expect(members(id, 'live')).toEqual([b, c]);
    expect(await store().removeAsset(id, b)).toEqual({ status: 'removed' });
    expect(rowOf(id, b)).toBeUndefined();
    expect(members(id, 'live')).toEqual([c]);
  });
});

describe('the version cadence under refreshes (E Decision Log 48 (2))', () => {
  it('a page’s 30 s refreshes make the cadence’s auto versions, never one per refresh, each pinning the active snapshots', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 17, 9, 0));
    close();
    open();
    const id = await dashboard();
    let refreshes = 0;
    for (let t = 0; t < 25 * 60_000; t += 30_000) {
      await refresh(id, 'live', (['A', 'B', 'C', 'D', 'E'] as const)[refreshes % 5]!);
      refreshes += 1;
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(refreshes).toBe(50);
    const versions = store().listVersions(id);
    expect(versions.map((version) => version.kind)).toEqual(['auto', 'auto']); // at 10 and 20 minutes of continuous activity
    for (const version of versions) expect(version.assetRefs.length).toBeLessThanOrEqual(2);
    await vi.advanceTimersByTimeAsync(AUTO_IDLE_MS);
    expect(store().listVersions(id).map((version) => version.kind)).toEqual(['auto', 'auto', 'auto']); // the idle version after the last
    await vi.advanceTimersByTimeAsync(AUTO_EVERY_MS);
    expect(store().listVersions(id)).toHaveLength(3); // nothing moved since
  });

  it('an agent’s refreshes in one turn make one turn version at its end', async () => {
    const id = await dashboard();
    for (const content of ['A', 'B', 'C'] as const) await refresh(id, 'live', content, agent);
    expect(store().listVersions(id)).toEqual([]);
    await store().endTurn(agent.appSessionId);
    expect(store().listVersions(id).map((version) => version.kind)).toEqual(['turn']);
  });
});
