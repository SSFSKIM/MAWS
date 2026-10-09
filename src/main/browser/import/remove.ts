// "Remove imported profile" (E4b Design §12; Decision Log 18): everything an import brought, gone from MAWS, in order.
// First the profile is withdrawn from the profiles new tabs may browse as, so a tab opened while the steps run browses
// with the default profile instead of landing in the partition being emptied; then (1) the profile's tabs closed
// through E4a's store, each page's destruction awaited (cua board #90: its extensions' popups and options tabs first,
// each options tab told to its session); (2) its extensions unloaded; (3) the partition's storage, cache
// and auth cache cleared and the cookie store flushed; (4) the partition folder (the extensions' files) deleted; (5) its
// history rows counted and deleted, and (cua board #90) its bookmark rows deleted; (6) the record dropped. A step that fails is logged and the next one runs: the
// record is dropped whatever else failed, and the boot sweep removes anything an unlisted profile left (its storage
// directory, which Electron cannot delete while the session lives, among them). Refused while any import runs; Chrome
// is never touched.
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { WebContents } from 'electron';
import { partitionDirName } from '@shared/browser/profiles';
import type { BrowserBookmarksStore } from '../../index/browser-bookmarks';
import type { BrowserHistoryStore } from '../../index/browser-history';
import type { Partitions } from '../partition';
import type { TabStore } from '../tabs';
import type { ExtensionsLoader } from './extensions-loader';
import { errorCode, importLog } from './log';
import type { ImportedProfiles } from './profiles';
import { ImportRefused, type BrowserImportService } from './service';

const PAGE_CLOSE_MS = 5_000; // a page that never reports its destruction holds the removal no longer than this

export interface RemoveDeps {
  userData: string;
  env: NodeJS.ProcessEnv;
  importing: BrowserImportService['running'];
  store: Pick<TabStore, 'all' | 'close'>;
  partitions: Pick<Partitions, 'session'>;
  extensions: Pick<ExtensionsLoader, 'unloadForRemoval' | 'removalDone'>;
  history: Pick<BrowserHistoryStore, 'countPartition' | 'removePartition'>;
  bookmarks: Pick<BrowserBookmarksStore, 'removePartition'>; // cua #90
  closingExtensionPages?(partition: string): void; // cua #90: the extension popups and options tabs of the partition
  profiles: Pick<ImportedProfiles, 'get' | 'withdraw' | 'remove'>;
}

export interface Removed {
  tabs: number;
  historyRows: number;
  extensions: number;
}

export async function removeImportedProfile(deps: RemoveDeps, profileDir: string): Promise<Removed> {
  if (deps.importing() !== null) throw new ImportRefused('running');
  const record = deps.profiles.get(profileDir);
  if (!record) throw new ImportRefused('notImported');
  const { partition } = record; // the record's schema holds it to profilePartition(profileDir)
  const step = async (where: string, run: () => unknown) => {
    try {
      await run();
    } catch (error) {
      importLog({ kind: 'error', where: `remove_${where}`, code: errorCode(error) }, deps.env);
    }
  };

  let tabs = 0;
  let historyRows = 0;
  const release = deps.profiles.withdraw(profileDir);
  try {
    await step('tabs', async () => {
      deps.closingExtensionPages?.(partition); // cua #90: closed with a notice before the rest go silently
      const closing = deps.store.all().filter((entry) => entry.tab.partition === partition);
      tabs = closing.length;
      const destroyed = closing.map((entry) => (entry.view ? pageDestroyed(entry.view.webContents) : Promise.resolve()));
      for (const entry of closing) {
        try {
          deps.store.close(entry.tab.tabId);
        } catch (error) {
          importLog({ kind: 'error', where: 'remove_tab', code: errorCode(error) }, deps.env);
        }
      }
      await Promise.all(destroyed);
    });
    await step('extensions', () => deps.extensions.unloadForRemoval(record));
    await step('storage', async () => {
      const ses = deps.partitions.session(partition);
      await ses.clearStorageData();
      await ses.clearCache();
      await ses.clearAuthCache();
      await ses.cookies.flushStore();
    });
    await step('folder', () => rm(join(deps.userData, 'browser', partitionDirName(partition)), { recursive: true, force: true }));
    await step('history', () => {
      historyRows = deps.history.countPartition(partition);
      deps.history.removePartition(partition);
    });
    await step('bookmarks', () => deps.bookmarks.removePartition(partition)); // cua #90
    await deps.profiles.remove(profileDir);
  } finally {
    release();
    deps.extensions.removalDone(partition);
  }
  return { tabs, historyRows, extensions: record.extensions.length };
}

// Resolves once the page is destroyed (at once when it already is), or after PAGE_CLOSE_MS.
function pageDestroyed(webContents: Pick<WebContents, 'isDestroyed' | 'once' | 'removeListener'>): Promise<void> {
  if (webContents.isDestroyed()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      webContents.removeListener('destroyed', done);
      resolve();
    };
    const timer = setTimeout(done, PAGE_CLOSE_MS);
    webContents.once('destroyed', done);
  });
}

