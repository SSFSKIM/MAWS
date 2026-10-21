// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, Decision Log 25; the parent's 65): an asset copied from
// one artifact to another through the store (`artifacts.copyAsset`). The source's bytes are written through the upload
// path on the target, so the bytes and the mime arrive unchanged, the name is made unique within the target, identical
// bytes answer the ref the target already holds, the human is the actor, and a deleted or missing artifact on either side
// is refused by name.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import { DocumentService } from './service';
import { SqliteDocumentStorage } from './storage';
import { ArtifactStore } from './store';

const human: Actor = { kind: 'human' };
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4" fill="#c9663f"/></svg>');

let dir: string;
let storage: SqliteDocumentStorage;
let service: DocumentService;
let store: ArtifactStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-copy-asset-'));
  storage = SqliteDocumentStorage.open(join(dir, 'store.sqlite'), { log: () => {} });
  service = new DocumentService(storage, { now: () => Date.UTC(2026, 9, 15), log: () => {}, kindOf: (id) => storage.kindOf(id), adapters: [] });
  store = new ArtifactStore(service, storage, { root: dir, now: () => Date.UTC(2026, 9, 15), log: () => {} });
});
afterEach(() => {
  store.close();
  service.close();
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('copying an asset between artifacts', () => {
  it('carries an SVG’s bytes and mime unchanged, under a name unique in the target, by the human', async () => {
    const from = await store.create({ kind: 'document', title: 'From' }, human);
    const to = await store.create({ kind: 'document', title: 'To' }, human);
    const source = await store.uploadAsset(from.id, SVG, { name: 'mark.svg', mime: 'image/svg+xml' }, human);
    await store.uploadAsset(to.id, new Uint8Array([1, 2, 3]), { name: 'mark.svg', mime: 'image/svg+xml' }, human); // the name is taken
    const copied = await store.copyAsset(from.id, source.ref, to.id, human);
    expect(copied.ref).toBe('assets/mark-2.svg');
    const asset = store.listAssets(to.id).find((a) => a.ref === copied.ref)!;
    expect(asset).toMatchObject({ mime: 'image/svg+xml', size: SVG.length, sha256: store.listAssets(from.id)[0]!.sha256, createdBy: human });
    expect(Buffer.from(store.files.readAsset(to.id, asset.sha256)).equals(Buffer.from(SVG))).toBe(true);
    // the same bytes again answer the ref the target holds
    expect(await store.copyAsset(from.id, source.ref, to.id, human)).toEqual(copied);
  });

  // P4 (the tracker's 2026-10-19 "P4 document paste" row): an image pasted from one document into another stores the
  // copy's ref (src/artifacts/document/editor/asset-paste.ts), so the picture is the target's own row and bytes
  it('leaves the copy whole once the source is deleted', async () => {
    const from = await store.create({ kind: 'document', title: 'From' }, human);
    const to = await store.create({ kind: 'document', title: 'To' }, human);
    const source = await store.uploadAsset(from.id, SVG, { name: 'mark.svg', mime: 'image/svg+xml' }, human);
    const copied = await store.copyAsset(from.id, source.ref, to.id, human);
    await store.delete(from.id);
    const asset = store.listAssets(to.id).find((a) => a.ref === copied.ref)!;
    expect(asset).toMatchObject({ assetId: copied.assetId, mime: 'image/svg+xml', size: SVG.length });
    expect(Buffer.from(store.files.readAsset(to.id, asset.sha256)).equals(Buffer.from(SVG))).toBe(true);
  });

  it('refuses a missing ref, and a deleted or missing artifact on either side, by name', async () => {
    const from = await store.create({ kind: 'document', title: 'From' }, human);
    const to = await store.create({ kind: 'document', title: 'To' }, human);
    const source = await store.uploadAsset(from.id, SVG, { name: 'mark.svg', mime: 'image/svg+xml' }, human);
    await expect(store.copyAsset(from.id, 'assets/none.svg', to.id, human)).rejects.toMatchObject({ code: 'notFound', message: expect.stringContaining('assets/none.svg') });
    await store.delete(to.id);
    await expect(store.copyAsset(from.id, source.ref, to.id, human)).rejects.toMatchObject({ code: 'notFound', message: expect.stringContaining(to.id) });
    const other = await store.create({ kind: 'document', title: 'Other' }, human);
    await store.delete(from.id);
    await expect(store.copyAsset(from.id, source.ref, other.id, human)).rejects.toMatchObject({ code: 'notFound', message: expect.stringContaining(from.id) });
    expect(store.listAssets(other.id)).toEqual([]);
  });
});
