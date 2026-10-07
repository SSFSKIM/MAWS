// The browser's side of main (E4a execution document, Design §1, §2, §9; Interfaces "Main"), started from
// `src/main/index.ts` once the index is open: the tab store over `<userData>/browser/tabs.json`, the partitions, the
// views, each view's navigation (history and favicons included) and `browser.*`. Tabs belong to sessions (P-21): a session whose record is deleted closes its tabs, and at boot a
// tab whose session the index does not know is dropped from the file. Main never waits on the renderer.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, session } from 'electron';
import type { AppSessionId } from '@shared/graph/ids';
import type { BROWSER_SETTINGS_DEFAULTS } from '@shared/browser/tab';
import type { Index } from '../index/index';
import type { registerMainHandler } from '../ipc/router';
import { isAppWindow } from '../windows';
import { Favicons } from './favicon';
import { Navigator } from './navigation';
import { Partitions, readProfiles, tabPartition, type BrowserProfile } from './partition';
import { readTabsFile, TabsFileWriter, type TabsFile } from './persist';
import { registerBrowserHandlers } from './register';
import { browserSeam } from './seam';
import { TabStore, type BrowserEmit } from './tabs';
import { createTabView, ViewManager } from './view';
import { focusEmulationMode } from './visibility';

export type BrowserSettings = typeof BROWSER_SETTINGS_DEFAULTS;

export interface BrowserDeps {
  userData: string;
  settings(): BrowserSettings; // read when a tab opens; settings 11's `browser` section once it lands (Task 3.5)
  index: Pick<Index, 'sessions' | 'unavailable' | 'browserHistory'>;
  register: typeof registerMainHandler;
  emit: BrowserEmit;
  env: NodeJS.ProcessEnv; // MAWS_BROWSER_FOCUS_EMULATION; MAWS_E2E and MAWS_E2E_OPEN_LOG (the seam, seam.ts)
  // The imported Chrome profiles, for a new tab's partition and `browser.profiles.list` alike: `profiles.json` read
  // from disk by default; E4b's block hands its in-memory owner here (Decision Log 40).
  profiles?(): BrowserProfile[];
}

export interface Browser {
  store: TabStore;
  views: ViewManager;
  stop(): void; // at will-quit: tabs.json written, every view closed
}

export function startBrowser({ userData, settings, index, register, emit, env, profiles: listProfiles }: BrowserDeps): Browser {
  const dir = join(userData, 'browser');
  mkdirSync(dir, { recursive: true });
  const tabsFile = join(dir, 'tabs.json');
  const profilesFile = join(dir, 'profiles.json');
  const profiles = listProfiles ?? (() => readProfiles(profilesFile));

  const { file, broken } = readTabsFile(tabsFile);
  const restored = knownSessionsOnly(file, index);
  const partitions = new Partitions((partition) => session.fromPartition(partition));
  const writer = new TabsFileWriter(tabsFile, () => store.snapshot());
  const store: TabStore = new TabStore({
    emit,
    createView: createTabView(partitions),
    resolvePartition: (appSessionId, tabId) => {
      const { partition, notice } = tabPartition(settings().profile, profiles(), partitions);
      if (notice) emit('browser.notice', { appSessionId, tabId, kind: notice.kind, name: notice.name });
      return partition;
    },
    restored,
    fileBroken: broken,
    onDirty: () => writer.markDirty(),
  });
  if (restored.tabs.length !== file.tabs.length) writer.markDirty();
  const views = new ViewManager({
    store,
    emit,
    windowOf: (sender) => {
      const win = BrowserWindow.fromWebContents(sender);
      return win && isAppWindow(win) && !win.isDestroyed() ? win : null;
    },
    focusEmulation: focusEmulationMode(env),
  });

  const seam = browserSeam(env);
  const favicons = new Favicons((partition, url, init) => partitions.session(partition).fetch(url, init));
  const navigator = new Navigator({ store, history: index.browserHistory, favicons, emit, seam });
  store.onViewCreated((entry) => {
    navigator.attach(entry);
  });

  registerBrowserHandlers({ store, views, navigator, history: index.browserHistory, profiles, register });
  const stopSessions = index.sessions.onChange((record, cause) => {
    if (cause === 'removed') store.removeSession(record.appId);
  });

  return {
    store,
    views,
    stop: () => {
      stopSessions();
      views.dispose();
      writer.flushSync();
      for (const { view } of store.all()) if (view && !view.webContents.isDestroyed()) view.webContents.close();
    },
  };
}

// The restored tabs whose session the index knows; all of them when the index cannot be read (nothing is known then).
function knownSessionsOnly(file: TabsFile, index: BrowserDeps['index']): TabsFile {
  if (index.unavailable !== null) return file;
  const known = new Map<string, boolean>();
  const knows = (appSessionId: string) => {
    let answer = known.get(appSessionId);
    if (answer === undefined) {
      try {
        answer = index.sessions.get(appSessionId as AppSessionId) !== null;
      } catch {
        answer = true;
      }
      known.set(appSessionId, answer);
    }
    return answer;
  };
  const tabs = file.tabs.filter((tab) => knows(tab.appSessionId));
  const selected = Object.fromEntries(Object.entries(file.selected).filter(([appSessionId]) => knows(appSessionId)));
  return { ...file, tabs, selected };
}
