// The boot sweep (E4b Design §14; Decision Log 18, 24, 26): crash residue removed by four patterns, before any
// partition session exists, and nothing a listed record names, nor anything outside the patterns, touched.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ImportedProfile } from '@shared/browser/profiles';
import { profilePartition } from '@shared/browser/tab';
import { DONE_REPORT } from '../../../../test/support/import-reports';
import { tempDir } from '../../../../test/support/index-fixture';
import { Index } from '../../index/index';
import { sweepBrowserImports } from './sweep';

let dir: ReturnType<typeof tempDir>;
let index: Index;
beforeEach(() => {
  dir = tempDir('maws-e4b-sweep-');
  index = new Index(join(dir.path, 'index.sqlite'));
});
afterEach(() => {
  index.close();
  dir.dispose();
});

const record = (profileDir: string, storageDirName: string): ImportedProfile => {
  const partition = profilePartition(profileDir);
  return {
    profileDir,
    name: profileDir,
    partition,
    importedAt: DONE_REPORT.finishedAt,
    storageDirName,
    userDataDir: '/tmp/chrome',
    extensions: [],
    report: { ...DONE_REPORT, profileDir, partition },
  };
};
const make = (...parts: string[]) => {
  const path = join(dir.path, ...parts);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'marker'), 'x');
  return path;
};
const file = (...parts: string[]) => {
  mkdirSync(join(dir.path, ...parts.slice(0, -1)), { recursive: true });
  writeFileSync(join(dir.path, ...parts), 'x');
};
const names = (...parts: string[]) => readdirSync(join(dir.path, ...parts)).sort();

describe('sweepBrowserImports', () => {
  it('removes every staging directory left under import/', () => {
    make('browser', 'import', '0b6f5a5e-8a4c-4c1e-9d55-3b7e2f0a9c11', 'extensions', 'x');
    make('browser', 'import', '1c6f5a5e-8a4c-4c1e-9d55-3b7e2f0a9c11');
    file('browser', 'import', 'stray');
    const result = sweepBrowserImports({ userData: dir.path, profiles: { list: () => [] }, history: index.browserHistory });
    expect(names('browser', 'import')).toEqual([]);
    expect(result.staging).toBe(3);
  });

  it('keeps the partition folder of a listed profile and removes an unlisted one', () => {
    make('browser', 'maws-chrome-Profile 1', 'extensions', 'a'.repeat(32));
    make('browser', 'maws-chrome-Default', 'extensions', 'b'.repeat(32));
    file('browser', 'tabs.json');
    file('browser', 'profiles.json');
    make('browser', 'crops');
    const result = sweepBrowserImports({ userData: dir.path, profiles: { list: () => [record('Profile 1', 'maws-chrome-profile%201')] }, history: index.browserHistory });
    expect(names('browser')).toEqual(['crops', 'maws-chrome-Profile 1', 'profiles.json', 'tabs.json']);
    expect(result.partitionFolders).toBe(1);
  });

  it('compares storage directories with the recorded storageDirName, never a name derived from profileDir', () => {
    make('Partitions', 'maws-chrome-profile%201', 'Cookies');
    make('Partitions', 'maws-chrome-default', 'Cookies'); // Default's, unlisted
    make('Partitions', 'maws-browser', 'Cookies');
    make('Partitions', 'maws-capture');
    file('Partitions', 'maws-chrome-stray-file');
    const result = sweepBrowserImports({ userData: dir.path, profiles: { list: () => [record('Profile 1', 'maws-chrome-profile%201')] }, history: index.browserHistory });
    expect(names('Partitions')).toEqual(['maws-browser', 'maws-capture', 'maws-chrome-profile%201', 'maws-chrome-stray-file']);
    expect(result.storageDirs).toBe(1);
  });

  it('keeps a listed Default whose storage directory Chromium lower-cased', () => {
    make('Partitions', 'maws-chrome-default', 'Cookies');
    make('browser', 'maws-chrome-Default', 'extensions');
    sweepBrowserImports({ userData: dir.path, profiles: { list: () => [record('Default', 'maws-chrome-default')] }, history: index.browserHistory });
    expect(existsSync(join(dir.path, 'Partitions', 'maws-chrome-default', 'Cookies', 'marker'))).toBe(true);
    expect(existsSync(join(dir.path, 'browser', 'maws-chrome-Default', 'extensions', 'marker'))).toBe(true);
  });

  it('removes the history rows of unlisted imported partitions and keeps listed and default-browser rows', () => {
    const history = index.browserHistory;
    const at = { typed: false, at: 1 };
    history.visit('persist:maws-chrome-Default', 'https://orphan.example/', at);
    history.visit('persist:maws-chrome-Profile 1', 'https://listed.example/', at);
    history.visit('persist:maws-browser', 'https://mine.example/', at);
    const result = sweepBrowserImports({ userData: dir.path, profiles: { list: () => [record('Profile 1', 'maws-chrome-profile%201')] }, history });
    expect(result.historyRows).toBe(1);
    expect(history.suggest('persist:maws-chrome-Default', '')).toEqual([]);
    expect(history.suggest('persist:maws-chrome-Profile 1', '')).toHaveLength(1);
    expect(history.suggest('persist:maws-browser', '')).toHaveLength(1);
  });

  // E11 (tracker row E4b "newer profiles.json treated as broken; sweep deletes imports"): the records a newer MAWS wrote
  // are unknown here, so nothing of theirs is taken for residue
  it('is skipped for a boot whose profiles.json a newer MAWS wrote: nothing is removed', () => {
    make('browser', 'import', 'staging');
    make('browser', 'maws-chrome-Profile 9');
    make('Partitions', 'maws-chrome-profile%209');
    index.browserHistory.visit(profilePartition('Profile 9'), 'https://a.test/', { typed: false, at: Date.parse('2026-10-06T10:00:00.000Z') });
    const result = sweepBrowserImports({ userData: dir.path, profiles: { list: () => [], readOnly: true }, history: index.browserHistory });
    expect(result).toEqual({ staging: 0, partitionFolders: 0, storageDirs: 0, historyRows: 0 });
    expect([names('browser', 'import'), names('browser'), names('Partitions')]).toEqual([['staging'], ['import', 'maws-chrome-Profile 9'], ['maws-chrome-profile%209']]);
    expect(index.browserHistory.countPartition(profilePartition('Profile 9'))).toBe(1);
  });

  it('answers zeros on a fresh userData with nothing to sweep', () => {
    expect(sweepBrowserImports({ userData: dir.path, profiles: { list: () => [] }, history: index.browserHistory })).toEqual({ staging: 0, partitionFolders: 0, storageDirs: 0, historyRows: 0 });
  });
});
