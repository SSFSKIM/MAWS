import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { DeliverableRecord } from '@shared/maws/deliverable';
import { FileDeliverableStore, MemoryDeliverableStore } from './store';

let userData: string;
beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'maws-deliverables-'));
});
afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

const A = 'app-1' as AppSessionId;
const record = (id: string, createdAt: string): DeliverableRecord => ({ id, appSessionId: A, kind: 'file', path: '/r/hello.txt', title: 'hello.txt', versions: [{ path: '/r/hello.txt', at: createdAt }], createdAt });
const ID1 = '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
const ID2 = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';

describe('the deliverable store (X12, residue 7)', () => {
  it('writes one JSON file per record under deliverables/<appSessionId>/<id>.json, leaving no temp file', async () => {
    const store = new FileDeliverableStore(userData);
    await store.write(record(ID1, '2026-10-05T00:00:01.000Z'));
    const dir = join(userData, 'deliverables', A);
    expect(await readdir(dir)).toEqual([`${ID1}.json`]);
    expect(JSON.parse(await readFile(join(dir, `${ID1}.json`), 'utf8'))).toEqual(record(ID1, '2026-10-05T00:00:01.000Z'));
  });

  it('lists a session’s records oldest first, skipping a file that is not a record, and nothing for an unknown session', async () => {
    const store = new FileDeliverableStore(userData);
    await store.write(record(ID1, '2026-10-05T00:00:02.000Z'));
    await store.write(record(ID2, '2026-10-05T00:00:01.000Z'));
    await writeFile(join(userData, 'deliverables', A, 'stray.json'), '{"not":"a record"}');
    expect((await store.list(A)).map((r) => r.id)).toEqual([ID2, ID1]);
    expect(await store.list('app-2' as AppSessionId)).toEqual([]);
  });

  // fix wave: a malformed record, a schema miss and a record removed mid-listing are passed over; a record the store
  // cannot read is an error, never a silent gap in the list
  it('passes over an unparsable record and one removed mid-listing, and leaves the rest', async () => {
    const store = new FileDeliverableStore(userData);
    await store.write(record(ID1, '2026-10-05T00:00:01.000Z'));
    const dir = join(userData, 'deliverables', A);
    await writeFile(join(dir, 'torn.json'), '{"id": "6f1c');
    expect((await store.list(A)).map((r) => r.id)).toEqual([ID1]);
    // a record readdir named and a delete removed before it was read
    const racing = new FileDeliverableStore(userData, { readFile: async (path) => (path.endsWith(`${ID2}.json`) ? Promise.reject(Object.assign(new Error('ENOENT: gone'), { code: 'ENOENT' })) : readFile(path, 'utf8')) });
    await writeFile(join(dir, `${ID2}.json`), '{}');
    expect((await racing.list(A)).map((r) => r.id)).toEqual([ID1]);
  });

  it('propagates a record it cannot read (EACCES)', async () => {
    const store = new FileDeliverableStore(userData);
    await store.write(record(ID1, '2026-10-05T00:00:01.000Z'));
    const file = join(userData, 'deliverables', A, `${ID1}.json`);
    await chmod(file, 0o000);
    try {
      await expect(store.list(A)).rejects.toMatchObject({ code: 'EACCES' });
    } finally {
      await chmod(file, 0o644);
    }
  });

  it('refuses a record that is not X12 before touching the disk, and an unsafe session id', async () => {
    const store = new FileDeliverableStore(userData);
    await expect(store.write({ ...record(ID1, 'now'), id: 'not-a-uuid' })).rejects.toThrow();
    await expect(store.write({ ...record(ID1, 'now'), appSessionId: '../x' as AppSessionId })).rejects.toThrow();
    expect(await readdir(userData)).toEqual([]);
  });

  it('keeps records in memory for tests', async () => {
    const store = new MemoryDeliverableStore();
    await store.write(record(ID1, 'now'));
    expect(store.records).toEqual([record(ID1, 'now')]);
  });
});
