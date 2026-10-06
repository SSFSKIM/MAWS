import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '../graph/ids';
import type { DeliverableRecord } from './deliverable';
import { deliverablesDir, readRecords, recordPath, versionPath, writeAtomic, writeRecord } from './deliverable-files';

let userData: string;
beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'maws-deliverable-files-'));
});
afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

const A = 'App-1' as AppSessionId;
const ID1 = '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
const ID2 = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const record = (id: string, createdAt: string): DeliverableRecord => ({ id, appSessionId: A, kind: 'file', path: '/r/hello.txt', title: 'hello.txt', versions: [{ path: '/r/hello.txt', at: createdAt }], createdAt });

describe('the store layout both processes share (E2 Design §2)', () => {
  it('places a record and its version copies under deliverables/<appSessionId>/', () => {
    expect(deliverablesDir(userData, A)).toBe(join(userData, 'deliverables', A));
    expect(recordPath(userData, A, ID1)).toBe(join(userData, 'deliverables', A, `${ID1}.json`));
    expect(versionPath(userData, A, ID1, 2)).toBe(join(userData, 'deliverables', A, ID1, 'v2.html'));
  });

  it('refuses an app session id that is not one plain path component', () => {
    expect(() => deliverablesDir(userData, '../x' as AppSessionId)).toThrow();
    expect(() => recordPath(userData, 'a/b' as AppSessionId, ID1)).toThrow();
    expect(() => versionPath(userData, '..' as AppSessionId, ID1, 1)).toThrow();
  });

  it('writes a record through a temp file and a rename, creating the directory and leaving no temp file', async () => {
    const path = recordPath(userData, A, ID1);
    await writeRecord(path, record(ID1, '2026-10-06T00:00:00.000Z'));
    expect(await readdir(deliverablesDir(userData, A))).toEqual([`${ID1}.json`]);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(record(ID1, '2026-10-06T00:00:00.000Z'));
    await expect(writeRecord(path, { ...record(ID1, 'now'), id: 'not-a-uuid' })).rejects.toThrow(); // X12 checked before the disk
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(record(ID1, '2026-10-06T00:00:00.000Z'));
  });

  it('writes bytes atomically, and two overlapping writes of one path each land whole', async () => {
    const path = join(userData, 'x', 'v1.html');
    await Promise.all([writeAtomic(path, 'A'.repeat(100_000)), writeAtomic(path, 'B'.repeat(100_000))]);
    const text = await readFile(path, 'utf8');
    expect(text === 'A'.repeat(100_000) || text === 'B'.repeat(100_000)).toBe(true);
    expect(await readdir(join(userData, 'x'))).toEqual(['v1.html']);
  });

  it("reads a session's records oldest first, passing over a non-record, a torn file, a version directory and a removed file", async () => {
    const dir = deliverablesDir(userData, A);
    expect(await readRecords(dir)).toEqual([]); // no directory yet
    await writeRecord(recordPath(userData, A, ID1), record(ID1, '2026-10-06T00:00:02.000Z'));
    await writeRecord(recordPath(userData, A, ID2), record(ID2, '2026-10-06T00:00:01.000Z'));
    await writeFile(join(dir, 'stray.json'), '{"not":"a record"}');
    await writeFile(join(dir, 'torn.json'), '{"id": "6f1c');
    await mkdir(join(dir, ID1));
    await writeFile(join(dir, ID1, 'v1.html'), '<p>v1</p>');
    expect((await readRecords(dir)).map((r) => r.id)).toEqual([ID2, ID1]);
    const racing = (path: string) => (path.endsWith(`${ID2}.json`) ? Promise.reject(Object.assign(new Error('ENOENT: gone'), { code: 'ENOENT' })) : readFile(path, 'utf8'));
    expect((await readRecords(dir, racing)).map((r) => r.id)).toEqual([ID1]);
    const denied = (path: string) => (path.endsWith(`${ID2}.json`) ? Promise.reject(Object.assign(new Error('EACCES: denied'), { code: 'EACCES' })) : readFile(path, 'utf8'));
    await expect(readRecords(dir, denied)).rejects.toMatchObject({ code: 'EACCES' });
  });
});
