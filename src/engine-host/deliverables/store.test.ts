import { chmod, mkdir, mkdtemp, open, readdir, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { DeliverableRecord } from '@shared/maws/deliverable';
import { ARTIFACT_MAX_BYTES } from '@shared/maws/tools';
import { FileDeliverableStore, MemoryDeliverableStore, readAtMost } from './store';

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

// E2 start (E2 execution document, Design §2): artifacts' version copies, rewrites, the per-session chain, onWritten
describe('the deliverable store as E2 extends it', () => {
  let source: string;
  beforeEach(async () => {
    source = join(userData, 'dashboard.html');
    await writeFile(source, '<h1 style="color:red">Dashboard</h1>');
  });

  const artifact = (id: string, copy: string, over: Partial<DeliverableRecord> = {}): DeliverableRecord => ({
    id, appSessionId: A, kind: 'artifact', artifactId: 'dash', title: 'Dashboard', path: copy, versions: [{ path: copy, at: 't1', sourcePath: source }], createdAt: 't1', updatedAt: 't1', ...over,
  });

  // the tools' read, copy, rewrite step for one more version, inside the session's chain
  const addVersion = (store: FileDeliverableStore | MemoryDeliverableStore) =>
    store.exclusive(A, async () => {
      const found = (await store.findArtifact(A, 'dash'))!;
      const n = found.versions.length + 1;
      const copy = await store.copyVersion(A, found.id, n, source);
      await new Promise((r) => setTimeout(r, 5)); // a slow write: an unserialised second update would read the same count
      await store.update({ ...found, path: copy.path, versions: [...found.versions, { path: copy.path, at: `t${n}` }], updatedAt: `t${n}` });
      return n;
    });

  it("copies a version to <id>/v<n>.html, answers the copy's path and bytes, and the record names it", async () => {
    const store = new FileDeliverableStore(userData);
    const copy = await store.copyVersion(A, ID1, 1, source);
    expect(copy.path).toBe(join(userData, 'deliverables', A, ID1, 'v1.html'));
    expect(copy.content.toString('utf8')).toBe('<h1 style="color:red">Dashboard</h1>');
    expect(await readFile(copy.path, 'utf8')).toBe('<h1 style="color:red">Dashboard</h1>');
    await store.write(artifact(ID1, copy.path));
    expect(await store.get(A, ID1)).toEqual(artifact(ID1, copy.path));
    expect(await store.findArtifact(A, 'dash')).toEqual(artifact(ID1, copy.path));
    expect(await store.findArtifact(A, 'other')).toBeNull();
    expect(await store.get(A, ID2)).toBeNull();
    // the version directory is not a record
    expect((await store.list(A)).map((r) => r.id)).toEqual([ID1]);
    expect((await readdir(join(userData, 'deliverables', A))).sort()).toEqual([ID1, `${ID1}.json`].sort());
  });

  // P2-F L117 (G3's pattern): a later build's key in a record or a version is stripped on read, the file left as it was;
  // the next version written carries only this build's shape, and a write naming an unknown key is still refused
  it("reads a record carrying a later build's keys, leaves its bytes on read and writes back only the current shape", async () => {
    const store = new FileDeliverableStore(userData);
    const v1 = await store.copyVersion(A, ID1, 1, source);
    const plain = artifact(ID1, v1.path);
    const path = join(userData, 'deliverables', A, `${ID1}.json`);
    const text = JSON.stringify({ ...plain, futureKey: 1, versions: plain.versions.map((version) => ({ ...version, futureKey: 2 })) });
    await writeFile(path, text);
    expect(await store.get(A, ID1)).toEqual(plain);
    expect(await store.list(A)).toEqual([plain]);
    expect(await store.findArtifact(A, 'dash')).toEqual(plain);
    expect(await readFile(path, 'utf8')).toBe(text);
    const v2 = await store.copyVersion(A, ID1, 2, source);
    const next = { ...plain, path: v2.path, versions: [...plain.versions, { path: v2.path, at: 't2' }], updatedAt: 't2' };
    await store.update(next);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(next);
    await expect(store.update({ ...next, futureKey: 1 } as typeof next)).rejects.toThrow();
  });

  it('rewrites a record whole through a temp file, leaving none', async () => {
    const store = new FileDeliverableStore(userData);
    const v1 = await store.copyVersion(A, ID1, 1, source);
    await store.write(artifact(ID1, v1.path));
    const v2 = await store.copyVersion(A, ID1, 2, source);
    const updated = artifact(ID1, v2.path, { title: 'Sales', versions: [{ path: v1.path, at: 't1' }, { path: v2.path, at: 't2' }], updatedAt: 't2' });
    await store.update(updated);
    expect(await store.get(A, ID1)).toEqual(updated);
    expect((await readdir(join(userData, 'deliverables', A))).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    expect((await readdir(join(userData, 'deliverables', A, ID1))).sort()).toEqual(['v1.html', 'v2.html']);
  });

  it('serialises one session: two overlapping updates number 2 then 3', async () => {
    const store = new FileDeliverableStore(userData);
    await store.write(artifact(ID1, (await store.copyVersion(A, ID1, 1, source)).path));
    expect(await Promise.all([addVersion(store), addVersion(store)])).toEqual([2, 3]);
    expect((await store.get(A, ID1))!.versions.map((v) => v.at)).toEqual(['t1', 't2', 't3']);
    // a task that fails releases the chain for the next one
    await expect(store.exclusive(A, async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await addVersion(store)).toBe(4);
  });

  it('refuses a source past the 16 MiB cap, and one that is not a regular file', async () => {
    const store = new FileDeliverableStore(userData);
    const big = join(userData, 'big.html');
    await writeFile(big, '');
    await truncate(big, ARTIFACT_MAX_BYTES + 1);
    await expect(store.copyVersion(A, ID1, 1, big)).rejects.toThrow(`too large (${ARTIFACT_MAX_BYTES + 1} bytes; the limit is 16 MiB)`);
    await expect(store.copyVersion(A, ID1, 1, userData)).rejects.toThrow();
    expect(await readdir(userData)).not.toContain('deliverables');
  });

  it('reads a source no further than the limit, so the cap bounds memory whatever the file grew to since its stat', async () => {
    const path = join(userData, 'grown.html');
    const bytes = Buffer.alloc(2_500_000, 0x61);
    await writeFile(path, bytes);
    const read = async (limit: number) => {
      const handle = await open(path, 'r');
      try {
        return await readAtMost(handle, limit);
      } finally {
        await handle.close();
      }
    };
    expect((await read(10)).length).toBe(10);
    expect((await read(1_500_001)).length).toBe(1_500_001); // across more than one read
    expect((await read(5_000_000)).equals(bytes)).toBe(true); // a file shorter than the limit, whole
  });

  it('announces every settled write as created and every rewrite as updated, and nothing for a write that failed', async () => {
    const written: [string, string][] = [];
    const store = new FileDeliverableStore(userData, { onWritten: (r, change) => written.push([r.id, change]) });
    await store.write(record(ID1, 't1'));
    await store.update({ ...record(ID1, 't1'), title: 'renamed' });
    await expect(store.write({ ...record(ID2, 't1'), id: 'not-a-uuid' })).rejects.toThrow();
    await mkdir(join(userData, 'deliverables', A, `${ID2}.json`)); // the rename onto a directory fails
    await expect(store.write(record(ID2, 't1'))).rejects.toThrow();
    expect(written).toEqual([[ID1, 'created'], [ID1, 'updated']]);
  });

  it('keeps the same surface in memory: copies, rewrites, the chain and onWritten', async () => {
    const written: [string, string][] = [];
    const store = new MemoryDeliverableStore({ onWritten: (r, change) => written.push([r.id, change]) });
    const copy = await store.copyVersion(A, ID1, 1, source);
    expect(copy.content.toString('utf8')).toBe('<h1 style="color:red">Dashboard</h1>');
    await store.write(artifact(ID1, copy.path));
    expect(await Promise.all([addVersion(store), addVersion(store)])).toEqual([2, 3]);
    expect((await store.get(A, ID1))!.versions).toHaveLength(3);
    expect(store.records).toHaveLength(1);
    expect(await store.list(A)).toEqual(store.records);
    expect(written).toEqual([[ID1, 'created'], [ID1, 'updated'], [ID1, 'updated']]);
    const big = join(userData, 'big.html');
    await writeFile(big, '');
    await truncate(big, ARTIFACT_MAX_BYTES + 1);
    await expect(store.copyVersion(A, ID1, 4, big)).rejects.toThrow('too large');
  });
});
// E2 end
