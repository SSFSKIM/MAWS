// The browser's side of main (E4a execution document, Design §1, §2, §9; Interfaces "Main"), started from
// `src/main/index.ts` once the index is open: the tab store over `<userData>/browser/tabs.json`, the partitions, the
// views, each view's navigation (history and favicons included), the page's guards (permissions, downloads,
// `window.open`, the context menu, the keyboard), the input attribution over each tab's TabDebugger (with focus
// emulation when it is on), the memory sample and its soft cap, `browser.*`, and under MAWS_E2E=1 the e2e's seam
// (inspect.ts). Tabs belong to sessions (P-21): a session whose record is deleted closes its tabs, and at boot a tab
// whose session the index does not know is dropped from the file. Main never waits on the renderer.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import type { AppSessionId } from '@shared/graph/ids';
import type { BrowserSettings } from '@shared/ipc/schema/settings';
import type { Index } from '../index/index';
import type { registerMainHandler } from '../ipc/router';
import { isAppWindow } from '../windows';
import { attachContextMenu } from './context-menu';
import { Downloads, e2eSaveDir } from './downloads';
import { Favicons } from './favicon';
import { browserInspector } from './inspect';
import { attachInputSeams } from './input';
import { attachKeys } from './keys';
import { MemorySampler } from './memory';
import { Navigator } from './navigation';
import { Partitions, readProfiles, tabPartition, type BrowserProfile } from './partition';
import { guardPage, preparePermissions } from './permissions';
import { readTabsFile, TabsFileWriter, type TabsFile } from './persist';
import { registerBrowserHandlers } from './register';
import { browserSeam } from './seam';
import { TabStore, type BrowserEmit } from './tabs';
import { createTabView, tabWebPreferences, ViewManager } from './view';
import { attachFocusEmulation, focusEmulationMode, setFocusEmulation } from './visibility';
import { attachWindowOpen } from './window-open';
// E4d start
import { startCommentMode } from './comment';
// E4d end

export interface BrowserDeps {
  userData: string;
  // Settings 11's `browser` section, read when a tab opens (the profile: a change applies to tabs opened afterwards) and
  // when a page opens a window (`linkTarget`, at the moment of the open).
  settings(): BrowserSettings;
  index: Pick<Index, 'sessions' | 'unavailable' | 'browserHistory'>;
  register: typeof registerMainHandler;
  emit: BrowserEmit;
  env: NodeJS.ProcessEnv; // MAWS_BROWSER_FOCUS_EMULATION; MAWS_E2E with MAWS_E2E_OPEN_LOG (seam.ts) and MAWS_E2E_SAVE_PATH
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
  // Each partition's permission and download handlers. The preparers close over `store` and `downloads`, declared below:
  // a partition is first opened by a tab's open or load (resolvePartition, createTabView), never while startBrowser runs,
  // so both exist by then (startBrowser opens no tab, and a restored tab is suspended until asked).
  const partitions = new Partitions(
    (partition) => session.fromPartition(partition),
    [(ses, partition) => preparePermissions(store)(ses, partition), (ses, partition) => downloads.prepare()(ses, partition)],
  );
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
  const focusEmulation = focusEmulationMode(env);
  const views = new ViewManager({
    store,
    emit,
    windowOf: (sender) => {
      const win = BrowserWindow.fromWebContents(sender);
      return win && isAppWindow(win) && !win.isDestroyed() ? win : null;
    },
    focusEmulation,
    setFocusEmulation,
  });
  const memory = new MemorySampler({ store, emit, metrics: () => app.getAppMetrics() });

  const seam = browserSeam(env);
  const downloads = new Downloads({ store, emit, downloadsDir: () => app.getPath('downloads'), saveDir: e2eSaveDir(env), reveal: seam.reveal });
  const favicons = new Favicons((partition, url, init) => partitions.session(partition).fetch(url, init));
  const navigator = new Navigator({ store, history: index.browserHistory, favicons, emit, seam });
  const childPreferences = tabWebPreferences();
  store.onViewCreated((entry) => {
    navigator.attach(entry);
    guardPage(entry);
    attachWindowOpen(entry, { store, linkTarget: () => settings().linkTarget, seam, childPreferences });
    attachContextMenu(entry, { store, navigator, openExternal: seam.openExternal });
    attachKeys(entry, { store, navigator, emit });
    attachInputSeams(entry);
    if (focusEmulation === 'on') attachFocusEmulation(entry, (tab) => views.focusEmulationWanted(tab));
  });

  registerBrowserHandlers({ store, views, navigator, downloads, history: index.browserHistory, profiles, register });
  // A request with no page behind it, a favicon fetched on a tab's partition (`ses.fetch`) among them, asks the app for a
  // client certificate, and Electron's default hands over the keychain's first identity: no certificate is chosen, as
  // for a page (navigation.ts). A request a page made is left to that page's handler.
  const refuseUnownedCertificate = (event: Electron.Event, webContents: Electron.WebContents | null, _url: string, _list: Electron.Certificate[], callback: (certificate?: Electron.Certificate) => void) => {
    if (webContents !== null) return;
    event.preventDefault();
    callback();
  };
  app.on('select-client-certificate', refuseUnownedCertificate);
  const stopSessions = index.sessions.onChange((record, cause) => {
    if (cause === 'removed') store.removeSession(record.appId);
  });
  const inspector = env.MAWS_E2E === '1' ? browserInspector({ store, emit }) : null;
  if (inspector) globalThis.__maws_browser = inspector;
  // E4d start: comment mode (E4d execution document, Interfaces "Main"; Decision Log 26(b)): the toggle's command, the
  // preload's report gate, the crop, the context menu's Comment and the e2e seam, over this store
  const commentMode = startCommentMode({ store, emit, register, userData, env });
  // E4d end

  return {
    store,
    views,
    // At will-quit, before the hosts stop: nothing more is sampled or placed, tabs.json is written, every page closed.
    stop: () => {
      commentMode.stop(); // E4d
      if (inspector && globalThis.__maws_browser === inspector) delete globalThis.__maws_browser;
      app.removeListener('select-client-certificate', refuseUnownedCertificate);
      stopSessions();
      memory.stop();
      views.dispose();
      writer.close(); // the pages closed next destroy their webContents, which drops tabs nobody closed
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
