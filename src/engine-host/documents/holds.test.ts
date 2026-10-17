// E3 M1 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b; E's Decision Log 48 (3)): a reader's hold over the
// snapshot bytes it captured, over a real store. `captureWithAssets` reads and holds in one synchronous turn, so a
// refresh that retires the captured snapshot and a collection between the capture and the read never take its bytes;
// a read that captured without a hold and asks later finds the snapshot unavailable, by name. A hold is all or none,
// bounded per artifact (64 holds, 256 distinct refs, 64 refs in one), and its release lets collection proceed.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listDatasets, setDataset, snapshotOf } from '@artifacts/dashboard/datasets';
import { applyV2, newDoc } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import { registerDashboards, type Dashboards } from '../dashboards';
import { openDocuments, type Documents } from '.';
import { ArtifactFiles } from './bytes';
import { ArtifactStoreError } from './errors';
import { ASSET_HOLD_LIMITS } from './retention';

const human: Actor = { kind: 'human' };
const bytes = (text: string) => new TextEncoder().encode(text);

let userData: string;
let documents: Documents;
let dashboards: Dashboards;
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-holds-'));
  documents = openDocuments(userData, () => {})!;
  dashboards = registerDashboards({ documents });
});
afterEach(() => {
  dashboards.close();
  documents.close();
  rmSync(userData, { recursive: true, force: true });
});
const store = () => documents.store;

let serial = 0;
async function refresh(artifactId: string, datasetId: string): Promise<string> {
  let ref = '';
  const at = Date.now();
  serial += 1;
  await store().writeWithAssets(
    artifactId,
    human,
    [{ bytes: bytes(`[{"v":${serial}}]`), name: `query-${randomUUID()}.json`, mime: 'application/json', querySnapshot: true }],
    (doc, refs) => {
      ref = refs[0]!.ref;
      setDataset(doc, datasetId, { title: datasetId, source: { kind: 'query', server: 'fixture', tool: 'rows', args: {}, snapshot: { ref, at } }, columns: [{ name: 'v', type: 'number' }], rows: 1, updated: { at, by: human }, state: { status: 'ok', at } });
    },
    { inFrame: (revision) => store().retainQuerySnapshots(artifactId, datasetId, ref, revision) },
  );
  return ref;
}
const dashboard = async () => (await store().create({ kind: 'dashboard', title: 'Board' }, human)).id;
const exists = (artifactId: string, ref: string) => store().listAssets(artifactId).some((asset) => asset.ref === ref);
const bytesOf = (artifactId: string, ref: string) => {
  const asset = store().listAssets(artifactId).find((candidate) => candidate.ref === ref)!;
  return join(store().files.dirOf(artifactId), ArtifactFiles.assetPath(asset.sha256));
};
/** What an export captures: the live state and every snapshot its descriptors name. */
const captureLive = (artifactId: string) => () => {
  const { revision, state } = store().service.readState(artifactId);
  const doc = newDoc();
  applyV2(doc, state);
  const refs = listDatasets(doc).flatMap(({ descriptor }) => snapshotOf(descriptor)?.ref ?? []);
  doc.destroy();
  return { value: { revision, state }, refs };
};
const refusal = (run: () => unknown): ArtifactStoreError => {
  try {
    run();
  } catch (error) {
    if (error instanceof ArtifactStoreError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
};

describe('captureWithAssets and holdAsset', () => {
  it('a capture holds every snapshot it names: refreshes and collections meanwhile never take its bytes', async () => {
    const id = await dashboard();
    const one = await refresh(id, 'one');
    const two = await refresh(id, 'two');
    const captured = await store().captureWithAssets(id, captureLive(id));
    expect(captured.value.revision).toBe(store().revision(id));
    for (let round = 0; round < 3; round++) {
      await refresh(id, 'one');
      await refresh(id, 'two');
    }
    store().collectRetiredAssets(id);
    expect([exists(id, one), exists(id, two)]).toEqual([true, true]); // retired, held by the capture
    expect(existsSync(bytesOf(id, one))).toBe(true);
    const file = bytesOf(id, one);
    captured.release();
    expect([exists(id, one), exists(id, two)]).toEqual([false, false]); // the release collects
    expect(existsSync(file)).toBe(false);
    captured.release(); // idempotent
  });

  it('a read that captured without a hold and asks for one later finds the snapshot unavailable, by name', async () => {
    const id = await dashboard();
    const old = await refresh(id, 'live');
    const late = await store().readCommitted(() => old); // a descriptor captured, its hold not yet asked
    await refresh(id, 'live');
    await refresh(id, 'live');
    store().collectRetiredAssets(id);
    const error = refusal(() => store().holdAsset(id, late));
    expect(error.code).toBe('notFound');
    expect(error.data).toMatchObject({ ref: old, snapshotUnavailable: true });
    expect(error.message).toMatch(/unavailable/);
  });

  it('is all or none: a hold naming one unavailable ref holds nothing', async () => {
    const id = await dashboard();
    const kept = await refresh(id, 'live');
    await expect(store().captureWithAssets(id, () => ({ value: 1, refs: [kept, 'assets/gone.json'] }))).rejects.toMatchObject({ code: 'notFound' });
    await refresh(id, 'live');
    await refresh(id, 'live');
    store().collectRetiredAssets(id);
    expect(exists(id, kept)).toBe(false); // the failed hold kept nothing held
  });

  it('a capture that throws holds nothing', async () => {
    const id = await dashboard();
    const kept = await refresh(id, 'live');
    await expect(
      store().captureWithAssets(id, () => {
        throw new Error('the state could not be read');
      }),
    ).rejects.toThrow('the state could not be read');
    await refresh(id, 'live');
    await refresh(id, 'live');
    store().collectRetiredAssets(id);
    expect(exists(id, kept)).toBe(false);
  });

  it('bounds an artifact’s holds: 64 open, 256 distinct refs, 64 refs in one; past a bound it fails closed, evicting nobody', async () => {
    const id = await dashboard();
    const other = await dashboard();
    const insert = documents.storage.db.prepare("INSERT INTO artifact_assets (artifactId, assetId, name, mime, size, sha256, createdAt, createdBy) VALUES (?, ?, ?, 'application/json', 1, ?, 1, 'human')");
    const refs = Array.from({ length: 300 }, (_, i) => {
      insert.run(id, randomUUID(), `r${i}.json`, `${i}`.padStart(64, '0'));
      return `assets/r${i}.json`;
    });
    expect(ASSET_HOLD_LIMITS).toEqual({ groups: 64, refs: 256, groupRefs: 64 });
    await expect(store().captureWithAssets(id, () => ({ value: 0, refs: refs.slice(0, 65) }))).rejects.toMatchObject({ code: 'tooLarge', data: { hold: 'groupRefs', limit: 64 } });
    const groups = [0, 1, 2, 3].map((k) => store().captureWithAssets(id, () => ({ value: k, refs: refs.slice(k * 64, k * 64 + 64) })));
    const held = await Promise.all(groups); // 256 distinct refs
    await expect(store().captureWithAssets(id, () => ({ value: 5, refs: [refs[256]!] }))).rejects.toMatchObject({ code: 'tooLarge', data: { hold: 'refs', limit: 256 } });
    const again = store().holdAsset(id, refs[0]!); // a ref already held adds no distinct ref
    const singles = Array.from({ length: 59 }, () => store().holdAsset(id, refs[1]!));
    expect(refusal(() => store().holdAsset(id, refs[2]!))).toMatchObject({ code: 'tooLarge', data: { hold: 'groups', limit: 64 } });
    expect(() => store().holdAsset(other, 'assets/none.json')).toThrow(/unavailable/); // another artifact's bound is its own
    for (const hold of [...held, again, ...singles]) hold.release();
    expect(() => store().holdAsset(id, refs[2]!).release()).not.toThrow();
  });
});
