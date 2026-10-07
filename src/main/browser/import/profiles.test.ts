// `<userData>/browser/profiles.json`'s one owner in main (E4b Design §11 and §13; Decision Log 27, 35): read once at boot
// and held in memory, written whole and atomically, a broken file moved aside and reported as `fileBroken`.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportedProfile } from '@shared/browser/profiles';
import { profilePartition } from '@shared/browser/tab';
import { DONE_REPORT, FAILS_EXTENSION, PROBE_EXTENSION, WALLET_EXTENSION } from '../../../../test/support/import-reports';
import { tempDir } from '../../../../test/support/index-fixture';
import { BrowserProfileSchema, readProfiles } from '../partition';
import { ImportedProfiles, profilesFile } from './profiles';

const RECORD: ImportedProfile = {
  profileDir: 'Default',
  name: 'Person 1',
  partition: 'persist:maws-chrome-Default',
  importedAt: '2026-10-06T10:00:05.000Z',
  storageDirName: 'maws-chrome-default',
  userDataDir: '/tmp/chrome-user-data',
  extensions: [PROBE_EXTENSION, FAILS_EXTENSION, WALLET_EXTENSION],
  report: DONE_REPORT,
};
const WORK: ImportedProfile = {
  ...RECORD,
  profileDir: 'Profile 1',
  name: 'Work',
  partition: profilePartition('Profile 1'),
  storageDirName: 'maws-chrome-profile%201',
  extensions: [],
  report: { ...DONE_REPORT, profileDir: 'Profile 1', name: 'Work', partition: profilePartition('Profile 1') },
};

let dir: ReturnType<typeof tempDir>;
beforeEach(() => {
  dir = tempDir('maws-e4b-profiles-');
});
afterEach(() => {
  vi.restoreAllMocks();
  dir.dispose();
});
const file = () => profilesFile(dir.path);
const writeRaw = (text: string) => {
  mkdirSync(join(dir.path, 'browser'), { recursive: true });
  writeFileSync(file(), text);
};
const onDisk = () => JSON.parse(readFileSync(file(), 'utf8')) as unknown;

describe('ImportedProfiles', () => {
  it('starts empty without a file, not broken, and writes nothing until asked', () => {
    const store = ImportedProfiles.open(dir.path);
    expect(store.list()).toEqual([]);
    expect(store.get('Default')).toBeNull();
    expect(store.fileBroken).toBe(false);
    expect(existsSync(file())).toBe(false);
  });

  it('reads the file once at open and then answers from memory', () => {
    writeRaw(JSON.stringify({ version: 1, profiles: [RECORD] }));
    const store = ImportedProfiles.open(dir.path);
    expect(store.list()).toEqual([RECORD]);
    writeRaw(JSON.stringify({ version: 1, profiles: [] }));
    expect(store.get('Default')).toEqual(RECORD);
  });

  it('puts a record, writing the whole file atomically with the record visible at once', async () => {
    const store = ImportedProfiles.open(dir.path);
    await store.put(RECORD);
    expect(store.list()).toEqual([RECORD]);
    expect(onDisk()).toEqual({ version: 1, profiles: [RECORD] });
    expect(statSync(file()).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(dir.path, 'browser')).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('replaces the record of the same profile directory in place and appends another', async () => {
    const store = ImportedProfiles.open(dir.path);
    await store.put(RECORD);
    await store.put(WORK);
    const toggled = { ...RECORD, extensions: [{ ...WALLET_EXTENSION, enabled: true }] };
    await store.put(toggled);
    expect(store.list().map((record) => record.profileDir)).toEqual(['Default', 'Profile 1']);
    expect(store.get('Default')).toEqual(toggled);
    expect(onDisk()).toEqual({ version: 1, profiles: [toggled, WORK] });
  });

  it('removes a record and answers whether one was there', async () => {
    const store = ImportedProfiles.open(dir.path);
    await store.put(RECORD);
    await store.put(WORK);
    expect(await store.remove('Default')).toBe(true);
    expect(store.list()).toEqual([WORK]);
    expect(onDisk()).toEqual({ version: 1, profiles: [WORK] });
    expect(await store.remove('Default')).toBe(false);
  });

  it('keeps every write when two land together', async () => {
    const store = ImportedProfiles.open(dir.path);
    await Promise.all([store.put(RECORD), store.put(WORK)]);
    expect(store.list().map((record) => record.profileDir).sort()).toEqual(['Default', 'Profile 1']);
    expect((onDisk() as { profiles: unknown[] }).profiles).toHaveLength(2);
  });

  it('refuses a record its schema refuses, writing nothing', async () => {
    const store = ImportedProfiles.open(dir.path);
    await expect(store.put({ ...RECORD, partition: 'persist:maws-browser' })).rejects.toThrow();
    expect(store.list()).toEqual([]);
    expect(existsSync(file())).toBe(false);
  });

  it('writes records E4a’s reader accepts, so the pill and the profile select read them', async () => {
    const store = ImportedProfiles.open(dir.path);
    await store.put(RECORD);
    expect(BrowserProfileSchema.safeParse(store.get('Default')).success).toBe(true);
    expect(readProfiles(file()).map((profile) => [profile.profileDir, profile.name, profile.partition])).toEqual([['Default', 'Person 1', 'persist:maws-chrome-Default']]);
  });
});

describe('a broken profiles.json (Design §13; Decision Log 35)', () => {
  for (const [label, text] of [
    ['not JSON', '{"version": 1, "profiles": [ e4b-sentinel-profiles'],
    ['another version', JSON.stringify({ version: 2, profiles: [] })],
    ['a record its schema refuses', JSON.stringify({ version: 1, profiles: [{ ...RECORD, partition: 'persist:maws-browser', note: 'e4b-sentinel-profiles' }] })],
  ] as const) {
    it(`moves ${label} aside, starts empty, says so once without the content, and reports fileBroken`, () => {
      writeRaw(text);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'info').mockImplementation(() => {});
      const store = ImportedProfiles.open(dir.path, { now: () => 1_759_744_805_000 });
      expect(store.list()).toEqual([]);
      expect(store.fileBroken).toBe(true);
      expect(existsSync(file())).toBe(false);
      expect(readFileSync(`${file()}.broken-1759744805000`, 'utf8')).toBe(text);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).not.toContain('sentinel');
    });
  }

  it('writes a fresh file beside the moved one at the next put', async () => {
    writeRaw('not json');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = ImportedProfiles.open(dir.path, { now: () => 7 });
    await store.put(RECORD);
    expect(onDisk()).toEqual({ version: 1, profiles: [RECORD] });
    expect(existsSync(`${file()}.broken-7`)).toBe(true);
  });
});
