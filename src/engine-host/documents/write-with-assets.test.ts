// P3-E2 M2 (ledger X23, parent Decision Log 6): `ArtifactStore.writeWithAssets`, a document write and the asset
// registrations it names in one frame: the bytes staged first, then inside the write's savepoint the caller's `prepare`
// (its final check), the asset rows (deduplicated by content, names unique), the edit given their refs, the kind's
// hooks, the session's `edited` link and `inFrame`. Nothing of it is written when any part refuses or fails.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { ArtifactStoreError } from './errors';
import { DocumentService } from './service';
import { SqliteDocumentStorage } from './storage';
import { ArtifactStore } from './store';

const human: Actor = { kind: 'human' };
const agent: Actor = { kind: 'session', appSessionId: 'app-w' as AppSessionId };
const bytes = (text: string) => new TextEncoder().encode(text);

let dir: string;
let storage: SqliteDocumentStorage;
let service: DocumentService;
let store: ArtifactStore;
const logs: string[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-write-assets-'));
  storage = SqliteDocumentStorage.open(join(dir, 'store.sqlite'), { log: () => {} });
  service = new DocumentService(storage, { log: (line) => logs.push(line), kindOf: (id) => storage.kindOf(id), adapters: [] });
  store = new ArtifactStore(service, storage, { root: dir, log: (line) => logs.push(line) });
  logs.length = 0;
});
afterEach(() => {
  store.close();
  service.close();
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const assetFiles = (artifactId: string): string[] => {
  try {
    return readdirSync(join(store.files.dirOf(artifactId), 'assets'));
  } catch {
    return [];
  }
};

describe('writeWithAssets', () => {
  it('registers the assets and writes the edit given their refs in one commit, linking the writing session', async () => {
    const doc = await store.create({ kind: 'dashboard', title: 'Board' }, human);
    const seen: { refs?: { assetId: string; ref: string }[]; inFrame?: number } = {};
    const revision = await store.writeWithAssets(
      doc.id,
      agent,
      [{ bytes: bytes('a,b\n1,2\n'), name: 'sales.csv', mime: 'text/csv' }],
      (live, refs) => {
        seen.refs = refs;
        live.get('datasets').setAttr('sales', { ref: refs[0]!.ref });
      },
      { inFrame: (at) => (seen.inFrame = at) },
    );
    expect(seen.refs).toEqual([{ assetId: expect.any(String), ref: 'assets/sales.csv' }]);
    expect(seen.inFrame).toBe(revision);
    expect(store.revision(doc.id)).toBe(revision);
    expect(service.live(doc.id).get('datasets').getAttr('sales')).toEqual({ ref: 'assets/sales.csv' });
    expect(store.listAssets(doc.id)).toEqual([expect.objectContaining({ ref: 'assets/sales.csv', mime: 'text/csv', size: 8, createdBy: agent })]);
    expect(store.links(doc.id)).toEqual(expect.arrayContaining([expect.objectContaining({ appSessionId: 'app-w', role: 'edited' })]));
  });

  it('answers the existing ref for identical bytes and makes a new name unique, within one call too', async () => {
    const doc = await store.create({ kind: 'dashboard', title: 'Board' }, human);
    const first = await store.uploadAsset(doc.id, bytes('x\n1\n'), { name: 'data.csv', mime: 'text/csv' }, human);
    let refs: { assetId: string; ref: string }[] = [];
    await store.writeWithAssets(
      doc.id,
      human,
      [
        { bytes: bytes('x\n1\n'), name: 'other.tsv', mime: 'text/tab-separated-values' },
        { bytes: bytes('x\n2\n'), name: 'data.csv', mime: 'text/csv' },
        { bytes: bytes('x\n3\n'), name: 'data.csv', mime: 'text/csv' },
      ],
      (live, given) => {
        refs = given;
        live.get('datasets').setAttr('n', 1);
      },
    );
    expect(refs.map((r) => r.ref)).toEqual([first.ref, 'assets/data-2.csv', 'assets/data-3.csv']);
    expect(refs[0]!.assetId).toBe(first.assetId);
    expect(store.listAssets(doc.id).map((a) => a.ref)).toEqual(['assets/data.csv', 'assets/data-2.csv', 'assets/data-3.csv']);
  });

  it('writes nothing when prepare refuses: no asset, no row, the document still loaded, the refusal after the commit', async () => {
    const doc = await store.create({ kind: 'dashboard', title: 'Board' }, human);
    const live = service.live(doc.id);
    const before = store.revision(doc.id);
    const refusal = new ArtifactStoreError('invalid', 'stale');
    let edited = false;
    let recorded = false;
    await expect(
      store.writeWithAssets(doc.id, agent, [{ bytes: bytes('a\n1\n'), name: 'a.csv', mime: 'text/csv' }], () => void (edited = true), {
        prepare: () => {
          throw refusal;
        },
        inFrame: () => void (recorded = true),
      }),
    ).rejects.toBe(refusal);
    expect({ edited, recorded }).toEqual({ edited: false, recorded: false });
    expect(store.listAssets(doc.id)).toEqual([]);
    expect(assetFiles(doc.id)).toEqual([]);
    expect(store.revision(doc.id)).toBe(before);
    expect(store.links(doc.id).some((link) => link.role === 'edited')).toBe(false);
    expect(service.loaded(doc.id)).toBe(live); // a refusal is not a failure: the doc is not evicted
  });

  it('takes back the asset rows when the edit or inFrame throws, the staged bytes reused by a retry', async () => {
    const doc = await store.create({ kind: 'dashboard', title: 'Board' }, human);
    const asset = [{ bytes: bytes('a\n1\n'), name: 'a.csv', mime: 'text/csv' }];
    await expect(
      store.writeWithAssets(doc.id, agent, asset, () => {
        throw new Error('boom in the edit');
      }),
    ).rejects.toThrow(/boom in the edit/);
    expect(store.listAssets(doc.id)).toEqual([]);
    await expect(
      store.writeWithAssets(doc.id, agent, asset, (live) => live.get('datasets').setAttr('a', 1), {
        inFrame: () => {
          throw new Error('boom in the frame');
        },
      }),
    ).rejects.toThrow(/boom in the frame/);
    expect(store.listAssets(doc.id)).toEqual([]);
    expect(service.live(doc.id).get('datasets').getAttr('a')).toBeUndefined();
    expect(store.links(doc.id).some((link) => link.role === 'edited')).toBe(false);
    // a placed file nobody's row names is not live state: the next write reuses it
    let registered: { assetId: string; ref: string }[] = [];
    await store.writeWithAssets(doc.id, agent, asset, (live, refs) => {
      live.get('datasets').setAttr('a', 1);
      registered = refs;
    });
    expect(registered.map((r) => r.ref)).toEqual(['assets/a.csv']);
    expect(store.listAssets(doc.id)).toHaveLength(1);
  });

  it('refuses before staging: a deleted artifact, a byte kind, an asset over the cap and an unusable name', async () => {
    const page = await store.create({ kind: 'html', title: 'Page', content: { bytes: bytes('<p/>') } }, human);
    const doc = await store.create({ kind: 'dashboard', title: 'Board' }, human);
    await expect(store.writeWithAssets(page.id, human, [], () => {})).rejects.toMatchObject({ code: 'invalid' });
    await expect(store.writeWithAssets(doc.id, human, [{ bytes: new Uint8Array(16 * 1024 * 1024 + 1), name: 'big.csv', mime: 'text/csv' }], () => {})).rejects.toMatchObject({ code: 'tooLarge' });
    await expect(store.writeWithAssets(doc.id, human, [{ bytes: bytes('a'), name: '../', mime: 'text/csv' }], () => {})).rejects.toMatchObject({ code: 'invalid' });
    await store.delete(doc.id);
    await expect(store.writeWithAssets(doc.id, human, [], () => {})).rejects.toMatchObject({ code: 'notFound' });
    expect(assetFiles(doc.id)).toEqual([]);
  });
});
