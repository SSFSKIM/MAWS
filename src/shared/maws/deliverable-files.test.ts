import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '../graph/ids';
import type { DeliverableRecord } from './deliverable';
import { deliverablesDir, readRecords, recordPath, screenshotPath, screenshotsDir, versionPath, writeAtomic, writeRecord } from './deliverable-files';

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

  it('refuses a deliverable id that is not a uuid, so an id from outside cannot leave the session directory', () => {
    for (const bad of ['../../x', '..', 'a/b', '', ID1.toUpperCase().replace(/-/g, '/')]) {
      expect(() => recordPath(userData, A, bad)).toThrow('invalid deliverable id');
      expect(() => versionPath(userData, A, bad, 1)).toThrow('invalid deliverable id');
    }
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

  it('removes the temp file when the temp write itself fails, and rejects', async () => {
    const path = join(userData, 'x', 'v1.html');
    // writeFile opens the temp file and starts writing, then the data source fails mid-write
    const failing = (function* () {
      yield Buffer.from('<p>half');
      throw new Error('source failed');
    })();
    await expect(writeAtomic(path, failing as unknown as Uint8Array)).rejects.toThrow('source failed');
    expect(await readdir(join(userData, 'x'))).toEqual([]);
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
// E4c start (E4c execution document, Design §7): a browser screenshot's file, named by the host, written by main
describe('the screenshots directory', () => {
  it('places a screenshot under deliverables/<appSessionId>/screenshots/<id>.<png|jpg>, beside the records a reader lists', async () => {
    expect(screenshotsDir(userData, A)).toBe(join(userData, 'deliverables', A, 'screenshots'));
    expect(screenshotPath(userData, A, ID1, 'png')).toBe(join(userData, 'deliverables', A, 'screenshots', `${ID1}.png`));
    expect(screenshotPath(userData, A, ID1, 'jpg')).toBe(join(userData, 'deliverables', A, 'screenshots', `${ID1}.jpg`));
    await writeAtomic(screenshotPath(userData, A, ID1, 'png'), new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    await writeRecord(recordPath(userData, A, ID2), record(ID2, '2026-10-07T00:00:00.000Z'));
    expect((await readRecords(deliverablesDir(userData, A))).map((r) => r.id)).toEqual([ID2]); // the directory is passed over
  });

  it('refuses an id that is not a uuid and an app session id that is not one path component', () => {
    for (const bad of ['../../x', 'a/b', '']) expect(() => screenshotPath(userData, A, bad, 'png')).toThrow('invalid deliverable id');
    expect(() => screenshotsDir(userData, '../x' as AppSessionId)).toThrow();
    expect(() => screenshotPath(userData, 'a/b' as AppSessionId, ID1, 'jpg')).toThrow();
  });
});
// E4c end
