import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportedExtension } from '@shared/browser/import';
import { partitionDirName, type ImportedProfile } from '@shared/browser/profiles';
import { DEFAULT_PARTITION, profilePartition } from '@shared/browser/tab';
import { partitionFor } from '../partition';
import { removeImportedProfile, type RemoveDeps } from './remove';
import { ImportRefused } from './service';

const PARTITION = profilePartition('Default');
const AT = '2026-10-06T00:00:00.000Z';
const EXTENSION: Omit<ImportedExtension, 'id'> = { chromeId: null, name: 'Probe', version: '1.0', enabled: true, wallet: false, unsupportedPermissions: [], status: 'loaded', error: null, background: 'running', backgroundError: null, checkedAt: AT };

const record = (profileDir = 'Default'): ImportedProfile => ({
  profileDir,
  name: 'Person 1',
  partition: profilePartition(profileDir),
  importedAt: AT,
  storageDirName: `maws-chrome-${profileDir.toLowerCase()}`,
  userDataDir: '/chrome',
  extensions: [{ ...EXTENSION, id: 'a'.repeat(32) }, { ...EXTENSION, id: 'b'.repeat(32) }],
  report: { profileDir, name: 'Person 1', partition: profilePartition(profileDir), startedAt: AT, finishedAt: AT, outcome: 'done', failure: null, history: null, cookies: null, extensions: [] },
});

describe('Remove imported profile (E4b Design §12)', () => {
  let userData: string;
  let steps: string[];
  let deps: RemoveDeps & { records: ImportedProfile[]; browsable(): ImportedProfile[] };
  let entries: ReturnType<typeof tab>[];

  // A tab of `partition`; closing it destroys its page on a later turn, as Electron does.
  const tab = (tabId: string, partition: string) => {
    const webContents = Object.assign(new EventEmitter(), { destroyed: false, isDestroyed: () => webContents.destroyed });
    return { tab: { tabId, partition }, view: { webContents } };
  };

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'maws-e4b-remove-'));
    mkdirSync(join(userData, 'browser', partitionDirName(PARTITION), 'extensions', 'a'.repeat(32)), { recursive: true });
    writeFileSync(join(userData, 'browser', partitionDirName(PARTITION), 'extensions', 'a'.repeat(32), 'manifest.json'), '{}');
    steps = [];
    entries = [tab('b_000000000001', PARTITION), tab('b_000000000002', DEFAULT_PARTITION), tab('b_000000000003', PARTITION)];
    const withdrawn = new Set<string>(); // ImportedProfiles' withdraw and browsable, over the same records
    const ses = {
      clearStorageData: vi.fn(async () => void steps.push('clearStorageData')),
      clearCache: vi.fn(async () => void steps.push('clearCache')),
      clearAuthCache: vi.fn(async () => void steps.push('clearAuthCache')),
      cookies: { flushStore: vi.fn(async () => void steps.push('flushStore')) },
    };
    const state = {
      records: [record(), record('Profile 1')],
      userData,
      env: {},
      importing: () => null,
      store: {
        all: () => entries.filter((entry) => !entry.view.webContents.destroyed) as never,
        close: vi.fn((tabId: string) => {
          steps.push(`close ${tabId}`);
          const entry = entries.find((candidate) => candidate.tab.tabId === tabId)!;
          setImmediate(() => {
            entry.view.webContents.destroyed = true;
            steps.push(`destroyed ${tabId}`);
            entry.view.webContents.emit('destroyed');
          });
        }),
      },
      partitions: { session: vi.fn((partition: string) => (steps.push(`session ${partition}`), ses as unknown as Session)) },
      extensions: {
        unloadForRemoval: vi.fn(async () => (steps.push('unload'), 2)),
        removalDone: vi.fn(() => void steps.push('removalDone')),
      },
      history: {
        countPartition: vi.fn(() => (steps.push('count'), 4)),
        removePartition: vi.fn(() => void steps.push('removePartition')),
      },
      browsable: () => state.records.filter((candidate) => !withdrawn.has(candidate.profileDir)),
      profiles: {
        get: (profileDir: string) => state.records.find((candidate) => candidate.profileDir === profileDir) ?? null,
        withdraw: (profileDir: string) => (withdrawn.add(profileDir), () => void withdrawn.delete(profileDir)),
        remove: vi.fn(async (profileDir: string) => {
          steps.push('drop record');
          state.records = state.records.filter((candidate) => candidate.profileDir !== profileDir);
          return true;
        }),
      },
    };
    deps = state as unknown as typeof deps;
  });
  afterEach(() => rmSync(userData, { recursive: true, force: true }));

  it('closes the profile\'s tabs first, then unloads, clears, deletes, forgets the history and drops the record, in that order', async () => {
    const removed = await removeImportedProfile(deps, 'Default');
    expect(removed).toEqual({ tabs: 2, historyRows: 4, extensions: 2 });
    expect(steps).toEqual([
      'close b_000000000001',
      'close b_000000000003',
      'destroyed b_000000000001',
      'destroyed b_000000000003',
      'unload',
      `session ${PARTITION}`,
      'clearStorageData',
      'clearCache',
      'clearAuthCache',
      'flushStore',
      'count',
      'removePartition',
      'drop record',
      'removalDone',
    ]);
    expect(existsSync(join(userData, 'browser', partitionDirName(PARTITION)))).toBe(false);
    expect(deps.records.map((candidate) => candidate.profileDir)).toEqual(['Profile 1']);
    expect(deps.store.close).not.toHaveBeenCalledWith('b_000000000002'); // another partition's tab is untouched
  });

  it('a tab opened while the removal runs browses with the default profile, so nothing reopens the partition', async () => {
    // E4a's new tab, opened while the extensions unload (steps 2 to 5 await): its partition from the Browser setting,
    // which still names the profile, through the profiles main lists for new tabs.
    vi.mocked(deps.extensions.unloadForRemoval).mockImplementation(async () => {
      entries.push(tab('b_000000000004', partitionFor('Default', deps.browsable()).partition));
      return 2;
    });
    await removeImportedProfile(deps, 'Default');
    expect(entries.filter((entry) => !entry.view.webContents.destroyed && entry.tab.partition === PARTITION)).toEqual([]);
    expect(entries.at(-1)!.tab.partition).toBe(DEFAULT_PARTITION);
  });

  it('carries on past a step that fails, so the record is still dropped (the boot sweep removes what is left)', async () => {
    vi.mocked(deps.partitions.session).mockImplementation(() => {
      throw new Error('cannot open');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(removeImportedProfile(deps, 'Default')).resolves.toMatchObject({ historyRows: 4 });
      expect(deps.records.map((candidate) => candidate.profileDir)).toEqual(['Profile 1']);
      expect(existsSync(join(userData, 'browser', partitionDirName(PARTITION)))).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('fails when the record cannot be dropped, and ends the removal either way', async () => {
    vi.mocked(deps.profiles.remove).mockRejectedValue(Object.assign(new Error('disk full'), { code: 'ENOSPC' }));
    await expect(removeImportedProfile(deps, 'Default')).rejects.toThrow('disk full');
    expect(deps.extensions.removalDone).toHaveBeenCalledWith(PARTITION);
    expect(deps.browsable().map((candidate) => candidate.profileDir)).toEqual(['Default', 'Profile 1']); // its record stands, so new tabs may use it again
  });

  it('refuses a profile that is not imported, and any removal while an import runs, touching nothing', async () => {
    await expect(removeImportedProfile(deps, 'Profile 2')).rejects.toThrow(new ImportRefused('notImported'));
    deps.importing = () => ({ importId: 'x', profileDir: 'Profile 2', phase: 'extensions' });
    await expect(removeImportedProfile(deps, 'Default')).rejects.toThrow(new ImportRefused('running'));
    expect(steps).toEqual([]);
  });
});
