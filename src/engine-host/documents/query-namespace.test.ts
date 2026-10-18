// E3 panel wave (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md, Decision Log 16 (5); E's Decision Log 48:
// fresh UUID refs, no tombstones): the query-snapshot namespace, `query-<uuid>.json`, is minted by the refresh sink alone.
// Collection deletes a snapshot's row and so frees its name; an ordinary upload, or an ordinary asset of a write, naming
// it is refused, so no upload can recreate a collected snapshot's exact ref with other bytes (a reader paging that ref
// across a host restart would otherwise hold it again and append the replacement's pages to rows it read under the
// original). Names that only resemble it stay ordinary, and the sink's own fresh names keep working. Over a real store.
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDataset, setDataset, type DatasetDescriptor } from '@artifacts/dashboard/datasets';
import type { Actor } from '@shared/artifacts/actor';
import { registerDashboards, type Dashboards } from '../dashboards';
import { openDocuments, type Documents } from '.';

const human: Actor = { kind: 'human' };
const bytes = (text: string) => new TextEncoder().encode(text);
const JSON_MIME = 'application/json';

let userData: string;
let documents: Documents;
let dashboards: Dashboards;
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-query-namespace-'));
  documents = openDocuments(userData, () => {})!;
  dashboards = registerDashboards({ documents });
});
afterEach(() => {
  dashboards.close();
  documents.close();
  rmSync(userData, { recursive: true, force: true });
});
const store = () => documents.store;

const descriptor = (ref: string, at: number): DatasetDescriptor => ({
  title: 'Live',
  source: { kind: 'query', server: 'fixture', tool: 'rows', args: {}, snapshot: { ref, at } },
  columns: [{ name: 'v', type: 'number' }],
  rows: 1,
  updated: { at, by: human },
  state: { status: 'ok', at },
});

/** The refresh sink's publication (dashboards/refresh.ts): a fresh namespace name, marked a query snapshot, retained. */
async function refresh(artifactId: string, content: string): Promise<string> {
  let ref = '';
  const at = Date.now();
  await store().writeWithAssets(
    artifactId,
    human,
    [{ bytes: bytes(content), name: `query-${randomUUID()}.json`, mime: JSON_MIME, querySnapshot: true }],
    (doc, refs) => {
      ref = refs[0]!.ref;
      setDataset(doc, 'live', descriptor(ref, at));
    },
    { inFrame: (revision) => store().retainQuerySnapshots(artifactId, 'live', ref, revision) },
  );
  return ref;
}
const nameOf = (ref: string) => ref.slice('assets/'.length);
const refs = (artifactId: string) => store().listAssets(artifactId).map((asset) => asset.ref);

describe('the query-snapshot namespace is the refresh sink’s alone (E3 panel)', () => {
  it('an upload under a collected snapshot’s former name is refused: its ref stays gone, never recreated with other bytes', async () => {
    const id = (await store().create({ kind: 'dashboard', title: 'Board' }, human)).id;
    const first = await refresh(id, '[{"v":1}]');
    await refresh(id, '[{"v":2}]');
    await refresh(id, '[{"v":3}]'); // the latest two are kept: the first retired
    store().collectRetiredAssets(id);
    expect(refs(id)).not.toContain(first); // collected: its row, and so its name, gone

    await expect(store().uploadAsset(id, bytes('[{"v":99}]'), { name: nameOf(first), mime: JSON_MIME }, human)).rejects.toMatchObject({ code: 'invalid' });
    const revision = store().revision(id);
    await expect(store().writeWithAssets(id, human, [{ bytes: bytes('[{"v":98}]'), name: nameOf(first), mime: JSON_MIME }], (doc, placed) => setDataset(doc, 'other', descriptor(placed[0]!.ref, Date.now())))).rejects.toMatchObject({ code: 'invalid' });
    expect(refs(id)).not.toContain(first);
    expect(store().revision(id)).toBe(revision); // the refused write wrote nothing
    expect(readDataset(store().service.live(id), 'other')).toBeNull();
  });

  it('refuses any caller-supplied name in the namespace, a path’s base name included; resembling names stay ordinary', async () => {
    const id = (await store().create({ kind: 'dashboard', title: 'Board' }, human)).id;
    const fresh = `query-${randomUUID()}.json`;
    for (const name of [fresh, `nested/dir/${fresh}`, fresh.toUpperCase()]) {
      await expect(store().uploadAsset(id, bytes(`[{"n":"${name}"}]`), { name, mime: JSON_MIME }, human), name).rejects.toMatchObject({ code: 'invalid' });
    }
    for (const name of ['query-results.json', `query-${randomUUID()}.csv`, `query-${randomUUID()}-2.json`, `my-query-${randomUUID()}.json`]) {
      expect((await store().uploadAsset(id, bytes(`[{"n":"${name}"}]`), { name, mime: JSON_MIME }, human)).ref, name).toBe(`assets/${name}`);
    }
  });

  it('the sink’s own fresh names are still placed; a copy carries its source asset’s own name and bytes', async () => {
    const id = (await store().create({ kind: 'dashboard', title: 'Board' }, human)).id;
    const other = (await store().create({ kind: 'dashboard', title: 'Other' }, human)).id;
    const ref = await refresh(id, '[{"v":1}]');
    expect(ref).toMatch(/^assets\/query-[0-9a-f-]{36}\.json$/);
    expect(refs(id)).toContain(ref);
    const copied = await store().copyAsset(id, ref, other, human);
    expect(copied.ref).toBe(ref);
    expect(store().listAssets(other).find((asset) => asset.ref === ref)?.sha256).toBe(store().listAssets(id).find((asset) => asset.ref === ref)?.sha256);
  });
});
