// `<userData>/browser/profiles.json`'s one owner in main (E4b Design §11 and §13; Decision Log 27, 35): read once at boot
// and held in memory, written whole and atomically, a broken file moved aside and reported as `fileBroken`.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportedProfile } from '@shared/browser/profiles';
import { profilePartition } from '@shared/browser/tab';
import { BOOKMARKS_REPORT, DONE_REPORT, FAILS_EXTENSION, PROBE_EXTENSION, V1_REPORT, WALLET_EXTENSION } from '../../../../test/support/import-reports';
import { tempDir } from '../../../../test/support/index-fixture';
import { BrowserProfileSchema, readProfiles } from '../partition';
import { ImportedProfiles, profilesFile } from './profiles';
import { sweepBrowserImports } from './sweep';

const RECORD: ImportedProfile = {
  profileDir: 'Default',
  name: 'Person 1',
  partition: 'persist:maws-chrome-Default',
  importedAt: '2026-10-06T10:00:05.000Z',
  storageDirName: 'maws-chrome-default',
  userDataDir: '/tmp/chrome-user-data',
  extensions: [PROBE_EXTENSION, FAILS_EXTENSION, WALLET_EXTENSION],
  report: DONE_REPORT,
  bookmarks: null, // cua #90: version 2's fields
  gaiaName: null,
  userName: null,
  avatar: { kind: 'initials' },
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
    writeRaw(JSON.stringify({ version: 2, profiles: [RECORD] }));
    const store = ImportedProfiles.open(dir.path);
    expect(store.list()).toEqual([RECORD]);
    writeRaw(JSON.stringify({ version: 2, profiles: [] }));
    expect(store.get('Default')).toEqual(RECORD);
  });

  it('puts a record, writing the whole file atomically with the record visible at once', async () => {
    const store = ImportedProfiles.open(dir.path);
    await store.put(RECORD);
    expect(store.list()).toEqual([RECORD]);
    expect(onDisk()).toEqual({ version: 2, profiles: [RECORD] });
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
    expect(onDisk()).toEqual({ version: 2, profiles: [toggled, WORK] });
  });

  it('removes a record and answers whether one was there', async () => {
    const store = ImportedProfiles.open(dir.path);
    await store.put(RECORD);
    await store.put(WORK);
    expect(await store.remove('Default')).toBe(true);
    expect(store.list()).toEqual([WORK]);
    expect(onDisk()).toEqual({ version: 2, profiles: [WORK] });
    expect(await store.remove('Default')).toBe(false);
  });

  it('withholds a profile under removal from the profiles new tabs may browse as, until released, keeping its record', async () => {
    const store = ImportedProfiles.open(dir.path);
    await store.put(RECORD);
    await store.put(WORK);
    expect(store.browsable()).toEqual([RECORD, WORK]);
    const release = store.withdraw('Default');
    expect(store.browsable()).toEqual([WORK]);
    expect(store.list()).toEqual([RECORD, WORK]); // the record itself stands until the removal drops it
    expect(store.get('Default')).toEqual(RECORD);
    release();
    expect(store.browsable()).toEqual([RECORD, WORK]); // a removal that could not drop the record leaves it browsable
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
    ['a version no build wrote', JSON.stringify({ version: 0, profiles: [] })], // E11: a newer one is read-only, below
    ['a record its schema refuses', JSON.stringify({ version: 2, profiles: [{ ...RECORD, partition: 'persist:maws-browser', note: 'e4b-sentinel-profiles' }] })],
    ['a version-1 file holding a version-2 record', JSON.stringify({ version: 1, profiles: [{ ...RECORD, note: 'e4b-sentinel-profiles' }] })], // cua #90
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

  // E11 (tracker row E4b "newer profiles.json treated as broken; sweep deletes imports"): as `openDb` opens a newer index
  it('opens a file a newer MAWS wrote read-only: nothing listed, nothing moved, nothing written', async () => {
    const newer = JSON.stringify({ version: 3, profiles: [{ ...RECORD, futureField: 'e4b-sentinel-profiles' }], more: true });
    writeRaw(newer);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const store = ImportedProfiles.open(dir.path, { now: () => 7 });
    expect(store).toMatchObject({ fileBroken: false, readOnly: true });
    expect([store.list(), store.browsable(), store.get('Default')]).toEqual([[], [], null]);
    await expect(store.put(RECORD)).rejects.toThrow('profiles.json was written by a newer MAWS (version 3); it is read-only in this one');
    await expect(store.remove('Default')).rejects.toThrow('read-only');
    expect(readFileSync(file(), 'utf8')).toBe(newer);
    expect(readdirSync(join(dir.path, 'browser'))).toEqual(['profiles.json']);
    const lines = [...error.mock.calls, ...warn.mock.calls].map((call) => String(call[0]));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('fileNewer');
    expect(lines[0]).not.toContain('sentinel');
  });

  it('writes a fresh file beside the moved one at the next put', async () => {
    writeRaw('not json');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = ImportedProfiles.open(dir.path, { now: () => 7 });
    await store.put(RECORD);
    expect(onDisk()).toEqual({ version: 2, profiles: [RECORD] });
    expect(existsSync(`${file()}.broken-7`)).toBe(true);
  });
});

// cua #90 start: profiles.json version 2 (ledger §4). A version-1 file (E4b's) is read through its own schema and
// upgraded in memory, the next write is version 2, and an older build opens that read-only (the E11 case above).
describe('profiles.json version 2 (cua board #90)', () => {
  const V2_FIELDS = ['bookmarks', 'gaiaName', 'userName', 'avatar'];
  const V1_RECORD = { ...Object.fromEntries(Object.entries(RECORD).filter(([key]) => !V2_FIELDS.includes(key))), report: V1_REPORT };
  const SYNCED = { consentedAt: '2026-10-08T09:00:00.000Z', syncedAt: '2026-10-08T09:00:01.000Z', count: 46, error: null, errorAt: null };

  it('upgrades a real version-1 record in memory: no bookmarks, no account names, the initial, and a report without a bookmarks block', () => {
    writeRaw(JSON.stringify({ version: 1, profiles: [V1_RECORD] }));
    const store = ImportedProfiles.open(dir.path);
    expect(store.fileBroken).toBe(false);
    expect(store.get('Default')).toEqual({ ...RECORD, report: { ...V1_REPORT, bookmarks: null } });
    expect((onDisk() as { version: number }).version).toBe(1); // nothing written until something changes
  });

  it('writes the upgraded file as version 2 on the next write, which reopens as it was and keeps the sweep off the partition', async () => {
    writeRaw(JSON.stringify({ version: 1, profiles: [V1_RECORD] }));
    const store = ImportedProfiles.open(dir.path);
    await store.put(WORK);
    expect(onDisk()).toEqual({ version: 2, profiles: [RECORD, WORK] });
    const reopened = ImportedProfiles.open(dir.path);
    expect(reopened.list()).toEqual([RECORD, WORK]);
    const folder = join(dir.path, 'browser', 'maws-chrome-Default');
    mkdirSync(folder, { recursive: true });
    const removeImportedExcept = vi.fn(() => 0);
    const removeExcept = vi.fn(() => 0);
    sweepBrowserImports({ userData: dir.path, profiles: reopened, history: { removeImportedExcept }, bookmarks: { removeExcept } });
    expect(existsSync(folder)).toBe(true);
    expect(removeExcept).toHaveBeenCalledWith(['persist:maws-chrome-Default', 'persist:maws-chrome-Profile 1']);
  });

  it('round-trips version 2’s fields', async () => {
    const store = ImportedProfiles.open(dir.path);
    const full: ImportedProfile = { ...RECORD, report: BOOKMARKS_REPORT, bookmarks: SYNCED, gaiaName: 'Probe Owner', userName: 'probe@example.test', avatar: { kind: 'picture' } };
    await store.put(full);
    expect(ImportedProfiles.open(dir.path).get('Default')).toEqual(full);
  });

  it('update changes one record from its latest state inside the write queue, so two writers never lose each other’s field', async () => {
    const store = ImportedProfiles.open(dir.path);
    await store.put(RECORD);
    const stale = store.get('Default')!; // what a boot load read before its settle
    const bookmarks = store.update('Default', (record) => ({ ...record, bookmarks: SYNCED }));
    const statuses = store.update('Default', (record) => ({ ...record, extensions: stale.extensions.map((e) => ({ ...e, enabled: false })) }));
    await Promise.all([bookmarks, statuses]);
    expect(store.get('Default')!.bookmarks).toEqual(SYNCED);
    expect(store.get('Default')!.extensions.every((e) => !e.enabled)).toBe(true);
    expect(onDisk()).toEqual({ version: 2, profiles: [store.get('Default')] });
  });

  it('update writes nothing when the change answers null or the record is gone, and refuses another profile directory', async () => {
    const store = ImportedProfiles.open(dir.path);
    await store.put(RECORD);
    const before = readFileSync(file(), 'utf8');
    expect(await store.update('Default', () => null)).toBeNull();
    expect(await store.update('Profile 1', (record) => ({ ...record, bookmarks: SYNCED }))).toBeNull();
    expect(readFileSync(file(), 'utf8')).toBe(before);
    await expect(store.update('Default', () => WORK)).rejects.toThrow('profile directory');
    expect(store.list()).toEqual([RECORD]);
  });

  it('E4a’s loose reader accepts version 2', async () => {
    const store = ImportedProfiles.open(dir.path);
    await store.put(RECORD);
    expect(readProfiles(file()).map((profile) => profile.profileDir)).toEqual(['Default']);
  });
});
// cua #90 end
