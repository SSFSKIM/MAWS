import { describe, expect, it } from 'vitest';
import { DONE_REPORT, FAILS_EXTENSION, PROBE_EXTENSION, WALLET_EXTENSION } from '../../../test/support/import-reports';
import { ImportedProfileSchema, ImportedProfilesFileSchema, partitionDirName } from './profiles';
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

  it('holds a version 1 file of records, one per profile directory', () => {
    expect(ImportedProfilesFileSchema.parse({ version: 1, profiles: [] })).toEqual({ version: 1, profiles: [] });
    expect(ImportedProfilesFileSchema.safeParse({ version: 1, profiles: [RECORD] }).success).toBe(true);
    expect(ImportedProfilesFileSchema.safeParse({ version: 2, profiles: [] }).success).toBe(false);
    expect(ImportedProfilesFileSchema.safeParse({ version: 1, profiles: [], extra: true }).success).toBe(false);
    expect(ImportedProfilesFileSchema.safeParse({ version: 1, profiles: [RECORD, RECORD] }).success).toBe(false);
  });
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
