// P3-E2 M2 (the execution document's concurrency rule; parent Decision Log 6): the dashboard kind on A's real store and
// its derived per-dataset change index. Every committed write records, in its own frame, the revision at which each
// descriptor last changed (a removal as a tombstone), so `artifact_dataset`'s baseRevision compares one descriptor:
// across restart, duplicate and restore, and against an equal descriptor written back (ABA). A missing index starts
// conservatively at the live revision; the index is never the data's authority.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeDataset, setDataset, type DatasetDescriptor } from '@artifacts/dashboard/datasets';
import { listTabs } from '@artifacts/document/tabs';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { DocumentService } from '../documents/service';
import { SqliteDocumentStorage } from '../documents/storage';
import { ArtifactStore } from '../documents/store';
import { dashboardAdapterOf, registerDashboards, type Dashboards } from '.';
import { changeIndexKey } from './changes';

const human: Actor = { kind: 'human' };
const agent: Actor = { kind: 'session', appSessionId: 'app-d' as AppSessionId };
const descriptor = (title: string): DatasetDescriptor => ({
  title,
  source: { kind: 'file', ref: 'assets/sales.csv', name: 'sales.csv', format: 'csv', sha256: 'b'.repeat(64), size: 9 },
  columns: [{ name: 'n', type: 'number' }],
  rows: 1,
  updated: { at: 1, by: agent },
  state: { status: 'ok', at: 1 },
});

let dir: string;
let world: { storage: SqliteDocumentStorage; service: DocumentService; store: ArtifactStore; dashboards: Dashboards };
const open = () => {
  const storage = SqliteDocumentStorage.open(join(dir, 'store.sqlite'), { log: () => {} });
  const service = new DocumentService(storage, { log: () => {}, kindOf: (id) => storage.kindOf(id) });
  const store = new ArtifactStore(service, storage, { root: dir, log: () => {} });
  return { storage, service, store, dashboards: registerDashboards({ documents: { store, service } }) };
};
const close = () => {
  world.dashboards.close();
  world.store.close();
  world.service.close();
  world.storage.close();
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-dashboards-'));
  world = open();
});
afterEach(() => {
  close();
  rmSync(dir, { recursive: true, force: true });
});

const lastChange = (artifactId: string, id: string) => dashboardAdapterOf(world.store)!.lastChange(artifactId, id);
const write = (artifactId: string, edit: Parameters<ArtifactStore['service']['writeAs']>[2]) => world.service.writeAs(artifactId, agent, edit);

describe('the dashboard kind', () => {
  it('is B’s document under the dashboard kind: a first tab on create, B’s reader and hooks', async () => {
    const board = await world.store.create({ kind: 'dashboard', title: 'Sales board' }, human);
    expect(listTabs(world.service.live(board.id))).toEqual([expect.objectContaining({ title: 'Sales board' })]);
    expect(dashboardAdapterOf(world.store)).toMatchObject({ kind: 'dashboard', registerCarries: expect.any(Function) });
  });
});

describe('the change index', () => {
  it('records the revision each descriptor last changed at; prose and other datasets leave it', async () => {
    const board = await world.store.create({ kind: 'dashboard', title: 'Board' }, human);
    const created = world.store.revision(board.id);
    expect(lastChange(board.id, 'sales')).toBe(created);
    const bound = await write(board.id, (doc) => setDataset(doc, 'sales', descriptor('Sales')));
    expect(lastChange(board.id, 'sales')).toBe(bound);
    await write(board.id, (doc) => doc.get('scratch').setAttr('prose', 1)); // any write outside the datasets root
    await write(board.id, (doc) => setDataset(doc, 'costs', descriptor('Costs')));
    expect(lastChange(board.id, 'sales')).toBe(bound);
    const removed = await write(board.id, (doc) => removeDataset(doc, 'sales'));
    expect(lastChange(board.id, 'sales')).toBe(removed);
  });

  it('advances on an equal descriptor written back in a later commit (no ABA)', async () => {
    const board = await world.store.create({ kind: 'dashboard', title: 'Board' }, human);
    await write(board.id, (doc) => setDataset(doc, 'sales', descriptor('A')));
    const replaced = await write(board.id, (doc) => setDataset(doc, 'sales', descriptor('B')));
    const back = await write(board.id, (doc) => setDataset(doc, 'sales', descriptor('A')));
    expect(back).toBeGreaterThan(replaced);
    expect(lastChange(board.id, 'sales')).toBe(back);
  });

  it('survives a restart, follows a restore and starts a duplicate’s at its copy', async () => {
    const board = await world.store.create({ kind: 'dashboard', title: 'Board' }, human);
    await write(board.id, (doc) => setDataset(doc, 'sales', descriptor('A')));
    const version = await world.store.createVersion(board.id, { kind: 'named', actor: human, label: 'A' });
    const replaced = await write(board.id, (doc) => setDataset(doc, 'sales', descriptor('B')));
    close();
    world = open();
    expect(lastChange(board.id, 'sales')).toBe(replaced);
    const restored = await world.store.restore(board.id, version!, human);
    expect(lastChange(board.id, 'sales')).toBe(restored.revision);
    const copy = await world.store.duplicate(board.id, {}, human);
    expect(lastChange(copy.id, 'sales')).toBe(world.store.revision(copy.id));
  });

  it('starts at the live revision when its metadata is missing (an older base must read again)', async () => {
    const board = await world.store.create({ kind: 'dashboard', title: 'Board' }, human);
    const bound = await write(board.id, (doc) => setDataset(doc, 'sales', descriptor('A')));
    await write(board.id, (doc) => doc.get('scratch').setAttr('prose', 2));
    world.storage.db.prepare('DELETE FROM meta WHERE key = ?').run(changeIndexKey(board.id));
    const live = world.store.revision(board.id);
    expect(live).toBeGreaterThan(bound);
    expect(lastChange(board.id, 'sales')).toBe(live);
    expect(lastChange(board.id, 'never-bound')).toBe(live);
  });

  it('is written in the frame of the write: a frame taken back leaves it as it was', async () => {
    const board = await world.store.create({ kind: 'dashboard', title: 'Board' }, human);
    const bound = await write(board.id, (doc) => setDataset(doc, 'sales', descriptor('A')));
    await expect(
      world.service.writeAs(board.id, agent, (doc) => setDataset(doc, 'sales', descriptor('B')), {
        inFrame: () => {
          throw new Error('the op row could not be written');
        },
      }),
    ).rejects.toThrow();
    expect(lastChange(board.id, 'sales')).toBe(bound);
  });

  it('keeps no index for a document', async () => {
    const doc = await world.store.create({ kind: 'document', title: 'Doc' }, human);
    expect(world.storage.getMeta(changeIndexKey(doc.id))).toBeNull();
  });
});
