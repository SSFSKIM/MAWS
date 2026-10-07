// Staging (E4b Design §4 and §15): MAWS's private copy of a Chrome store and its companions under
// `<userData>/browser/import/<uuid>/`, regular files only, destinations fresh, opened read-write on the copy, deleted.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildChromeUserData, type ChromeUserData } from '../../../../test/support/chrome-profile';
import { createStaging, deleteStaging, deleteStagingSync, openStagedStore, stageStore } from './staging';

let root: string;
let fixture: ChromeUserData;
let userData: string;
beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-e4b-staging-')));
  fixture = buildChromeUserData(join(root, 'Chrome'));
  userData = join(root, 'userData');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

let counter = 0;
const scratchProfile = () => {
  const dir = join(root, `profile-${++counter}`);
  mkdirSync(dir);
  return dir;
};

describe('createStaging and deleteStaging', () => {
  it('creates a fresh private directory per import under browser/import/ and deletes it whole', async () => {
    const one = await createStaging(userData);
    const two = await createStaging(userData);
    expect(one.dir).toBe(join(userData, 'browser', 'import', one.id));
    expect(one.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(two.id).not.toBe(one.id);
    expect(statSync(one.dir).mode & 0o777).toBe(0o700);
    writeFileSync(join(one.dir, 'History'), 'x');
    await deleteStaging(one);
    expect(existsSync(one.dir)).toBe(false);
    deleteStagingSync(two);
    expect(existsSync(two.dir)).toBe(false);
    await expect(deleteStaging(one)).resolves.toBeUndefined(); // already gone
  });
});

describe('stageStore', () => {
  it('copies History byte for byte and leaves Chrome’s file as it was', async () => {
    const staging = await createStaging(userData);
    const source = fixture.profiles.Default.history.file;
    const before = readFileSync(source);
    const staged = await stageStore(fixture.profiles.Default.dir, staging, 'History');
    expect(staged).toEqual({ ok: true, file: join(staging.dir, 'History') });
    expect(readFileSync(join(staging.dir, 'History'))).toEqual(before);
    expect(readFileSync(source)).toEqual(before);
  });

  it('copies the companions present beside the store', async () => {
    const profile = scratchProfile();
    copyFileSync(fixture.profiles.Default.history.file, join(profile, 'History'));
    writeFileSync(join(profile, 'History-journal'), 'journal');
    writeFileSync(join(profile, 'History-wal'), 'wal');
    const staging = await createStaging(userData);
    expect((await stageStore(profile, staging, 'History')).ok).toBe(true);
    expect(readFileSync(join(staging.dir, 'History-journal'), 'utf8')).toBe('journal');
    expect(readFileSync(join(staging.dir, 'History-wal'), 'utf8')).toBe('wal');
    expect(existsSync(join(staging.dir, 'History-shm'))).toBe(false);
  });

  it('takes Network/Cookies first and Cookies otherwise, staged under one name', async () => {
    const work = await createStaging(userData);
    expect(await stageStore(fixture.profiles['Profile 1'].dir, work, 'Cookies')).toEqual({ ok: true, file: join(work.dir, 'Cookies') });
    expect(readFileSync(join(work.dir, 'Cookies'))).toEqual(readFileSync(fixture.profiles['Profile 1'].cookies.file));
    const person = await createStaging(userData);
    expect(await stageStore(fixture.profiles.Default.dir, person, 'Cookies')).toEqual({ ok: true, file: join(person.dir, 'Cookies') });
  });

  it('answers a missing store as missing', async () => {
    expect(await stageStore(scratchProfile(), await createStaging(userData), 'Cookies')).toEqual({ ok: false, error: 'missing', code: 'ENOENT' });
  });

  it('refuses a symlinked store, a symlinked companion and a symlinked Network folder, copying nothing', async () => {
    const linkedStore = scratchProfile();
    symlinkSync(fixture.profiles.Default.history.file, join(linkedStore, 'History'));
    const linkedCompanion = scratchProfile();
    copyFileSync(fixture.profiles.Default.history.file, join(linkedCompanion, 'History'));
    symlinkSync('/etc/hosts', join(linkedCompanion, 'History-journal'));
    const linkedNetwork = scratchProfile();
    symlinkSync(join(fixture.profiles['Profile 1'].dir, 'Network'), join(linkedNetwork, 'Network'));
    for (const [profile, store] of [[linkedStore, 'History'], [linkedCompanion, 'History'], [linkedNetwork, 'Cookies']] as const) {
      const staging = await createStaging(userData);
      expect(await stageStore(profile, staging, store), profile).toEqual({ ok: false, error: 'unreadable', code: 'symlink' });
      expect(existsSync(join(staging.dir, store)), profile).toBe(false);
    }
  });

  it('never overwrites a destination', async () => {
    const staging = await createStaging(userData);
    expect((await stageStore(fixture.profiles.Default.dir, staging, 'History')).ok).toBe(true);
    expect(await stageStore(fixture.profiles.Default.dir, staging, 'History')).toEqual({ ok: false, error: 'unreadable', code: 'EEXIST' });
  });
});

describe('openStagedStore', () => {
  it('opens the copy and reads its version', async () => {
    const staging = await createStaging(userData);
    const staged = await stageStore(fixture.profiles.Default.dir, staging, 'History');
    const opened = openStagedStore(staged.ok ? staged.file : '');
    expect(opened.ok && opened.storeVersion).toBe(70);
    if (opened.ok) opened.db.close();
  });

  it('answers a file that is not a database, and a database without meta, with a code', () => {
    const notDb = join(scratchProfile(), 'Cookies');
    writeFileSync(notDb, 'e4b-sentinel-not-a-database '.repeat(200));
    expect(openStagedStore(notDb)).toEqual({ ok: false, code: 'SQLITE_NOTADB' });
    const noMeta = join(scratchProfile(), 'History');
    const db = new DatabaseSync(noMeta);
    db.exec('CREATE TABLE urls (id INTEGER)');
    db.close();
    expect(openStagedStore(noMeta)).toEqual({ ok: false, code: 'NO_META_VERSION' });
  });
});
