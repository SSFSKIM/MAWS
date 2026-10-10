import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportedProfile } from '@shared/browser/profiles';
import { DEFAULT_PARTITION, profilePartition } from '@shared/browser/tab';
import type { CommandName } from '@shared/ipc/schema';
import type { ImportedProfiles as ImportedProfilesStore } from './profiles';

vi.mock('electron', () => ({ ipcMain: { handle: () => {} }, BrowserWindow: { fromWebContents: () => null }, dialog: {}, WebContentsView: class {} }));

const { startBrowserImport, ImportedProfiles } = await import('./index');

const AT = '2026-10-06T00:00:00.000Z';
const PARTITION = profilePartition('Default');
const record: ImportedProfile = {
  profileDir: 'Default',
  name: 'Person 1',
  partition: PARTITION,
  importedAt: AT,
  storageDirName: 'maws-chrome-default',
  userDataDir: '/chrome',
  extensions: [{ id: 'a'.repeat(32), chromeId: null, name: 'Probe', version: '1.0', enabled: true, wallet: false, unsupportedPermissions: [], status: 'loaded', error: null, background: 'running', backgroundError: null, checkedAt: AT }],
  report: { profileDir: 'Default', name: 'Person 1', partition: PARTITION, startedAt: AT, finishedAt: AT, outcome: 'done', failure: null, history: null, cookies: null, extensions: [], bookmarks: null },
  bookmarks: null, // cua #90: profiles.json version 2
  gaiaName: null,
  userName: null,
  avatar: { kind: 'initials' },
};

describe('startBrowserImport (E4b Interfaces "Main"; Decision Log 31, 32, 34)', () => {
  let userData: string;
  let profiles: ImportedProfilesStore;

  // E4a's handle as far as the import uses it: partitions that run the registered steps once per partition, and a store
  // whose view hook can be fired.
  function harness({ env = {}, profile = 'Default' as string | null } = {}) {
    const handlers = new Map<CommandName, unknown>();
    const steps: ((ses: Session, partition: string) => void)[] = [];
    const viewListeners: ((entry: unknown) => void)[] = [];
    const sessions = new Map<string, Session>();
    const loadExtension = vi.fn(() => new Promise<never>(() => {})); // a boot load still under way
    const partitions = {
      session: vi.fn((partition: string) => {
        let ses = sessions.get(partition);
        if (!ses) {
          ses = { extensions: { loadExtension, getExtension: () => null }, serviceWorkers: { on: vi.fn(), off: vi.fn(), getAllRunning: () => ({}) } } as unknown as Session;
          sessions.set(partition, ses);
          for (const step of steps) step(ses, partition);
        }
        return ses;
      }),
      registerPreparer: vi.fn((step: (ses: Session, partition: string) => void) => {
        steps.push(step);
        return vi.fn(() => void steps.splice(steps.indexOf(step), 1));
      }),
    };
    const unhookViews = vi.fn();
    const store = {
      all: () => [],
      close: vi.fn(),
      onViewCreated: vi.fn((listener: (entry: unknown) => void) => {
        viewListeners.push(listener);
        return unhookViews;
      }),
    };
    const started = startBrowserImport({
      userData,
      settings: () => ({ profile }),
      index: { browserHistory: {} as never, browserBookmarks: {} as never },
      register: (name, handler) => void handlers.set(name, handler),
      emit: vi.fn(),
      env,
      browser: { store, partitions },
      profiles,
      chooseDirectory: vi.fn(),
    });
    return { started, handlers, partitions, store, steps, viewListeners, unhookViews, loadExtension };
  }

  beforeEach(async () => {
    userData = mkdtempSync(join(tmpdir(), 'maws-e4b-index-'));
    profiles = ImportedProfiles.open(userData);
    await profiles.put(record);
  });
  afterEach(() => {
    delete globalThis.__maws_browser_import;
    rmSync(userData, { recursive: true, force: true });
  });

  it('registers browser.import.*, its partition step and its view hook', () => {
    const { handlers, partitions, store } = harness();
    expect([...handlers.keys()].filter((name) => name.startsWith('browser.import.'))).toHaveLength(9);
    expect(partitions.registerPreparer).toHaveBeenCalledTimes(2); // the extensions' boot load and (cua #90) the bookmarks sync
    expect([...handlers.keys()].filter((name) => name.startsWith('browser.bookmarks.'))).toEqual(['browser.bookmarks.tree', 'browser.bookmarks.sync']); // cua #90
    expect(store.onViewCreated).toHaveBeenCalledTimes(1);
  });

  it('prepares the active imported profile\'s partition at boot, which starts its extensions loading', () => {
    const { partitions, loadExtension } = harness();
    expect(partitions.session).toHaveBeenCalledExactlyOnceWith(PARTITION);
    return Promise.resolve().then(() => expect(loadExtension).toHaveBeenCalledTimes(1));
  });

  it('prepares nothing at boot for the default profile or one no record names', () => {
    expect(harness({ profile: null }).partitions.session).not.toHaveBeenCalled();
    expect(harness({ profile: 'Profile 1' }).partitions.session).not.toHaveBeenCalled();
  });

  it('holds the first page of a view created while its partition\'s extensions load, and no other', () => {
    const { viewListeners } = harness();
    const page = (partition: string) => {
      const webContents = { loadURL: vi.fn(async () => {}), isDestroyed: () => false };
      return { entry: { tab: { partition }, view: { webContents } }, original: webContents.loadURL };
    };
    const imported = page(PARTITION);
    const other = page(DEFAULT_PARTITION);
    for (const listener of viewListeners) {
      listener(imported.entry);
      listener(other.entry);
    }
    expect(imported.entry.view.webContents.loadURL).not.toBe(imported.original);
    expect(other.entry.view.webContents.loadURL).toBe(other.original);
  });

  it('under MAWS_E2E=1 exposes the run and the records, until stopped', () => {
    const { started, unhookViews, partitions } = harness({ env: { MAWS_E2E: '1' } });
    expect(globalThis.__maws_browser_import?.importing()).toBeNull();
    expect(globalThis.__maws_browser_import?.record('Default')).toEqual(record);
    expect(globalThis.__maws_browser_import?.record('Profile 1')).toBeNull();
    started.stop();
    expect(globalThis.__maws_browser_import).toBeUndefined();
    expect(unhookViews).toHaveBeenCalled();
    expect(partitions.registerPreparer.mock.results[0]!.value).toHaveBeenCalled();
  });

  // cua #90: the Chrome account's names are shown in the popover and the picker only
  it('answers a record through the seam without the Chrome account’s names', async () => {
    await profiles.put({ ...record, gaiaName: 'Probe Owner', userName: 'probe@example.test' });
    harness({ env: { MAWS_E2E: '1' } });
    expect(globalThis.__maws_browser_import?.record('Default')).toEqual({ ...record, gaiaName: null, userName: null });
    expect(profiles.get('Default')).toMatchObject({ gaiaName: 'Probe Owner', userName: 'probe@example.test' });
  });

  it('exposes nothing outside e2e', () => {
    harness();
    expect(globalThis.__maws_browser_import).toBeUndefined();
  });
});
