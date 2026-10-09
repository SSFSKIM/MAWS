import { describe, expect, it } from 'vitest';
import { BOOKMARKS_REPORT, DONE_REPORT, FAILS_EXTENSION, PROBE_EXTENSION, V1_REPORT, WALLET_EXTENSION } from '../../../test/support/import-reports';
import { ImportedProfileSchema, ImportedProfilesFileSchema, ImportedProfilesFileV1Schema, ImportedProfileV1Schema, partitionDirName, upgradeProfileV1 } from './profiles';
import { DEFAULT_PARTITION, profilePartition } from './tab';

const RECORD = {
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

describe('the imported profile record (profiles.json, E4b Interfaces)', () => {
  it('accepts a record with E4a’s four fields first and E4b’s after, and refuses an extra key', () => {
    expect(ImportedProfileSchema.parse(RECORD)).toEqual(RECORD);
    expect(Object.keys(ImportedProfileSchema.shape).slice(0, 4)).toEqual(['profileDir', 'name', 'partition', 'importedAt']);
    expect(ImportedProfileSchema.safeParse({ ...RECORD, cookies: [] }).success).toBe(false);
  });

  it('refuses a record whose partition is not its profile’s own', () => {
    for (const partition of [DEFAULT_PARTITION, 'persist:maws-chrome-Profile 1', 'persist:maws-chrome-', 'maws-chrome-Default'])
      expect(ImportedProfileSchema.safeParse({ ...RECORD, partition }).success, partition).toBe(false);
    expect(ImportedProfileSchema.safeParse({ ...RECORD, profileDir: 'Profile 1', partition: profilePartition('Profile 1'), report: { ...DONE_REPORT, profileDir: 'Profile 1', partition: profilePartition('Profile 1') } }).success).toBe(true);
  });

  it('refuses a record carrying another profile’s report', () => {
    const work = { profileDir: 'Profile 1', partition: profilePartition('Profile 1') };
    expect(ImportedProfileSchema.safeParse({ ...RECORD, report: { ...DONE_REPORT, ...work } }).success).toBe(false);
    expect(ImportedProfileSchema.safeParse({ ...RECORD, ...work }).success).toBe(false);
  });

  it('takes the storage directory as one Chromium partition directory name, never a path', () => {
    expect(ImportedProfileSchema.safeParse({ ...RECORD, storageDirName: 'maws-chrome-profile%201' }).success).toBe(true);
    for (const storageDirName of ['', 'maws-browser', '../maws-chrome-default', 'maws-chrome-a/b', 'maws-chrome-'])
      expect(ImportedProfileSchema.safeParse({ ...RECORD, storageDirName }).success, storageDirName).toBe(false);
  });

  it('takes the Chrome folder as an absolute path and the profile directory by Chrome’s rule', () => {
    expect(ImportedProfileSchema.safeParse({ ...RECORD, userDataDir: 'Library/Chrome' }).success).toBe(false);
    expect(ImportedProfileSchema.safeParse({ ...RECORD, profileDir: '../Default', partition: profilePartition('../Default') }).success).toBe(false);
  });

  it('holds a version 2 file of records, one per profile directory (cua #90)', () => {
    expect(ImportedProfilesFileSchema.parse({ version: 2, profiles: [] })).toEqual({ version: 2, profiles: [] });
    expect(ImportedProfilesFileSchema.safeParse({ version: 2, profiles: [RECORD] }).success).toBe(true);
    expect(ImportedProfilesFileSchema.safeParse({ version: 1, profiles: [] }).success).toBe(false);
    expect(ImportedProfilesFileSchema.safeParse({ version: 2, profiles: [], extra: true }).success).toBe(false);
    expect(ImportedProfilesFileSchema.safeParse({ version: 2, profiles: [RECORD, RECORD] }).success).toBe(false);
  });

  // cua #90 start
  const V1_RECORD = { ...Object.fromEntries(Object.entries(RECORD).filter(([key]) => !['bookmarks', 'gaiaName', 'userName', 'avatar'].includes(key))), report: V1_REPORT };

  it('keeps version 1 whole: its record and file parse as E4b wrote them, and a version-2 field or report block is refused there', () => {
    expect(ImportedProfilesFileV1Schema.safeParse({ version: 1, profiles: [V1_RECORD] }).success).toBe(true);
    expect(ImportedProfileV1Schema.safeParse({ ...V1_RECORD, bookmarks: null }).success).toBe(false);
    expect(ImportedProfileV1Schema.safeParse({ ...V1_RECORD, report: DONE_REPORT }).success).toBe(false);
    expect(ImportedProfilesFileV1Schema.safeParse({ version: 2, profiles: [] }).success).toBe(false);
  });

  it('upgrades a version-1 record to version 2: no bookmarks, no account names, the initial, report.bookmarks null', () => {
    const upgraded = upgradeProfileV1(ImportedProfileV1Schema.parse(V1_RECORD));
    expect(upgraded).toEqual(RECORD);
    expect(ImportedProfileSchema.parse(upgraded)).toEqual(RECORD);
  });

  it('takes version 2’s fields: the mirror’s state, the account names and the avatar, each closed', () => {
    const bookmarks = { consentedAt: '2026-10-08T09:00:00.000Z', syncedAt: null, count: 0, error: 'missing', errorAt: '2026-10-08T09:00:00.000Z' };
    const full = { ...RECORD, report: BOOKMARKS_REPORT, bookmarks, gaiaName: 'Probe Owner', userName: 'probe@example.test', avatar: { kind: 'picture' } };
    expect(ImportedProfileSchema.safeParse(full).success).toBe(true);
    expect(ImportedProfileSchema.safeParse({ ...full, bookmarks: { ...bookmarks, error: 'gone' } }).success).toBe(false);
    expect(ImportedProfileSchema.safeParse({ ...full, bookmarks: { ...bookmarks, path: '/x' } }).success).toBe(false);
    expect(ImportedProfileSchema.safeParse({ ...full, avatar: { kind: 'picture', dataUrl: 'data:' } }).success).toBe(false);
    expect(ImportedProfileSchema.safeParse({ ...full, avatar: { kind: 'stock' } }).success).toBe(false);
    expect(ImportedProfileSchema.safeParse({ ...full, avatar: undefined }).success).toBe(false);
  });
  // cua #90 end
});

describe('partitionDirName (Decision Log 15)', () => {
  it('drops persist: and keeps the profile directory’s case', () => {
    expect(partitionDirName('persist:maws-chrome-Default')).toBe('maws-chrome-Default');
    expect(partitionDirName(profilePartition('Profile 1'))).toBe('maws-chrome-Profile 1');
  });

  it('refuses anything but an imported profile’s partition', () => {
    for (const partition of [DEFAULT_PARTITION, 'maws-chrome-Default', 'persist:maws-chrome-', 'persist:maws-chrome-../x', 'persist:maws-capture'])
      expect(() => partitionDirName(partition), partition).toThrow();
  });
});
