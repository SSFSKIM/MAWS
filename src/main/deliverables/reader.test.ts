import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { DeliverableRecord } from '@shared/maws/deliverable';
import { recordPath, versionPath, writeRecord } from '@shared/maws/deliverable-files';
import { DeliverableReader } from './reader';

let root: string;
let userData: string;
let work: string;
let reader: DeliverableReader;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'maws-reader-')));
  userData = join(root, 'userData');
  work = join(root, 'work');
  await mkdir(work, { recursive: true });
  reader = new DeliverableReader(userData);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const A = 'App-A' as AppSessionId;
const B = 'app-b' as AppSessionId;
const ID = ['6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f', '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d', '1b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e', '2c3d4e5f-6a7b-4c8d-ae9f-0a1b2c3d4e5f'];

// E1's record: a delivered file referenced in place, one version, no E2 field.
const fileRecord = (appSessionId: AppSessionId, id: string, path: string, createdAt: string): DeliverableRecord => ({
  id, appSessionId, kind: 'file', path, title: 'hello.txt', versions: [{ path, at: createdAt }], createdAt,
});
// E2's record: an artifact with its versions copied under the store.
const artifactRecord = (appSessionId: AppSessionId, id: string, versions: number, createdAt: string, updatedAt: string): DeliverableRecord => {
  const list = Array.from({ length: versions }, (_, k) => ({ path: versionPath(userData, appSessionId, id, k + 1), at: k === 0 ? createdAt : updatedAt, sourcePath: join(work, 'dash.html') }));
  return { id, appSessionId, kind: 'artifact', artifactId: 'dash', title: 'Dashboard', path: list.at(-1)!.path, versions: list, createdAt, updatedAt };
};
const save = (record: DeliverableRecord) => writeRecord(recordPath(userData, record.appSessionId, record.id), record);

describe('DeliverableReader (E2 Design §2): main’s read-only view of the store, no cache', () => {
  it('lists a session’s records newest first (an artifact by its last version), E1- and E2-shaped alike', async () => {
    await save(fileRecord(A, ID[0], join(work, 'hello.txt'), '2026-10-06T01:00:00.000Z'));
    await save(artifactRecord(A, ID[1], 2, '2026-10-06T00:00:00.000Z', '2026-10-06T03:00:00.000Z'));
    await save(fileRecord(A, ID[2], join(work, 'b.txt'), '2026-10-06T02:00:00.000Z'));
    await save(fileRecord(B, ID[3], join(work, 'c.txt'), '2026-10-06T04:00:00.000Z'));
    expect((await reader.list(A)).map((r) => r.id)).toEqual([ID[1], ID[2], ID[0]]);
    expect(await reader.list('app-none' as AppSessionId)).toEqual([]);
  });

  it('lists every session’s records newest first, at most `limit`, passing over what is not a session directory', async () => {
    await save(fileRecord(A, ID[0], join(work, 'a.txt'), '2026-10-06T01:00:00.000Z'));
    await save(fileRecord(B, ID[1], join(work, 'b.txt'), '2026-10-06T03:00:00.000Z'));
    await save(fileRecord(A, ID[2], join(work, 'c.txt'), '2026-10-06T02:00:00.000Z'));
    await writeFile(join(userData, 'deliverables', 'stray.json'), '{}'); // a file at the top level, not a session directory
    expect((await reader.listAll()).map((r) => r.id)).toEqual([ID[1], ID[2], ID[0]]);
    expect((await reader.listAll(2)).map((r) => r.id)).toEqual([ID[1], ID[2]]);
  });

  it('answers an empty list everywhere before anything was delivered', async () => {
    expect(await reader.listAll()).toEqual([]);
    expect(await reader.get(A, ID[0])).toEqual({ record: null, present: [] });
  });

  it('gets one record with whether each version’s file is still on disk', async () => {
    const record = artifactRecord(A, ID[1], 2, '2026-10-06T00:00:00.000Z', '2026-10-06T03:00:00.000Z');
    await save(record);
    await mkdir(join(userData, 'deliverables', A, ID[1]), { recursive: true });
    await writeFile(record.versions[1].path, '<p>v2');
    expect(await reader.get(A, ID[1])).toEqual({ record, present: [false, true] });
    expect(await reader.get(B, ID[1])).toEqual({ record: null, present: [] }); // another session's directory holds none
  });

  it('answers null for a record that does not parse', async () => {
    await mkdir(join(userData, 'deliverables', A), { recursive: true });
    await writeFile(recordPath(userData, A, ID[0]), '{ not json');
    expect(await reader.get(A, ID[0])).toEqual({ record: null, present: [] });
  });

  it('refuses an id that is not a record uuid and an app session id that is not one path component', async () => {
    await expect(reader.get(A, '../../x')).rejects.toThrow('invalid deliverable id');
    await expect(reader.list('../x' as AppSessionId)).rejects.toThrow('invalid appSessionId');
  });

  it('finds a record written after its first read at the next read (no cache)', async () => {
    expect(await reader.list(A)).toEqual([]);
    await save(fileRecord(A, ID[0], join(work, 'hello.txt'), '2026-10-06T01:00:00.000Z'));
    expect((await reader.list(A)).map((r) => r.id)).toEqual([ID[0]]);
    expect((await reader.get(A, ID[0])).record?.id).toBe(ID[0]);
  });

  describe('admitted: whether the session’s records name a realpath', () => {
    it('admits a record’s path and a version’s path, by realpath, and nothing beside them', async () => {
      const hello = join(work, 'hello.txt');
      await writeFile(hello, 'hi');
      await writeFile(join(work, 'sibling.txt'), 'no');
      await save(fileRecord(A, ID[0], hello, '2026-10-06T01:00:00.000Z'));
      const artifact = artifactRecord(A, ID[1], 2, '2026-10-06T00:00:00.000Z', '2026-10-06T03:00:00.000Z');
      await save(artifact);
      await mkdir(join(userData, 'deliverables', A, ID[1]), { recursive: true });
      await writeFile(artifact.versions[0].path, '<p>v1');
      await writeFile(artifact.versions[1].path, '<p>v2');
      expect(await reader.admitted(A, hello)).toBe(true);
      expect(await reader.admitted(A, artifact.versions[0].path)).toBe(true); // an earlier version, not only `path`
      expect(await reader.admitted(A, artifact.versions[1].path)).toBe(true);
      expect(await reader.admitted(A, join(work, 'sibling.txt'))).toBe(false);
      expect(await reader.admitted(A, work)).toBe(false); // never the file's directory
      expect(await reader.admitted(B, hello)).toBe(false); // another session's records are not this one's
    });

    it('compares realpaths, so a record that names its file through a symlinked directory admits the real file', async () => {
      await mkdir(join(work, 'real'));
      await writeFile(join(work, 'real', 'a.txt'), 'a');
      await symlink(join(work, 'real'), join(work, 'link'));
      await save(fileRecord(A, ID[0], join(work, 'link', 'a.txt'), '2026-10-06T01:00:00.000Z'));
      expect(await reader.admitted(A, join(work, 'real', 'a.txt'))).toBe(true);
    });

    it('admits nothing for a gone file or an unsafe session id', async () => {
      await save(fileRecord(A, ID[0], join(work, 'gone.txt'), '2026-10-06T01:00:00.000Z'));
      expect(await reader.admitted(A, join(work, 'gone.txt'))).toBe(false);
      expect(await reader.admitted('../x' as AppSessionId, join(work, 'gone.txt'))).toBe(false);
    });
  });
});
