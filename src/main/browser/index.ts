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
import { attachKeys, canShowBookmarksBar } from './keys';
import { MemorySampler } from './memory';
import { Navigator } from './navigation';
import { Partitions, readProfiles, tabPartition, type BrowserProfile } from './partition';
import { guardPage, preparePermissions } from './permissions';
import { readTabsFile, TabsFileWriter, type TabsFile } from './persist';
import { registerBrowserHandlers } from './register';
import { browserSeam } from './seam';
import { TabStore, type BrowserEmit } from './tabs';
import { createTabView, registerBrowserPreload, tabWebPreferences, ViewManager } from './view';
import { attachFocusEmulation, focusEmulationMode, setFocusEmulation } from './visibility';
import { attachWindowOpen } from './window-open';
// E4d start
import { startCommentMode } from './comment';
// E4d end
// E4c start
import type { HostSupervisor } from '../hosts/supervisor';
import { e2eTabIds, reachableSessions, startAgentPresence } from './agent';
// E4c end
// E13 start: cua's primitive server (the in-app browser spec of 2026-10-08, M2; P1 A-51, A-52), and the control and
// cursor it drives (M3); the browser tools it replaced left on 2026-10-08 (M4, P1 A-54)
import { startCuaBackend, type CuaBackend } from './cua';
import { loadPeerAddon, peerAddonPath, rootOf, type ProcessRoot } from './cua/peer';
import { TabControls } from './agent/control';
import { AgentCursor } from './agent/cursor';
// E13 end
// cua #90 start: the bookmarks bar's commands and native menus
import { BookmarkBar, openAllConfirmation } from './bookmarks/bar';
import { NativeMenus } from './bookmarks/menu';
import { ProfileAvatars } from './profile-avatars';
import { startExtensionUi, type ExtensionUi } from './extensions';
// cua #90 end

export interface BrowserDeps {
  userData: string;
  // Settings 11's `browser` section, read when a tab opens (the profile: a change applies to tabs opened afterwards) and
  // when a page opens a window (`linkTarget`, at the moment of the open).
  settings(): BrowserSettings;
  index: Pick<Index, 'sessions' | 'unavailable' | 'browserHistory' | 'browserActivity' | 'browserBookmarks' /* cua #90 */>;
  register: typeof registerMainHandler;
  emit: BrowserEmit;
  env: NodeJS.ProcessEnv; // MAWS_BROWSER_FOCUS_EMULATION; MAWS_E2E with MAWS_E2E_OPEN_LOG (seam.ts) and MAWS_E2E_SAVE_PATH
  // The imported Chrome profiles, for a new tab's partition and `browser.profiles.list` alike: `profiles.json` read
  // from disk by default; E4b's block hands its in-memory owner here (Decision Log 40).
  profiles?(): BrowserProfile[];
  // E4c start: the engine host's events and commands, for the agent's presence (who drives each tab, the cursor, the
  // dialogs' and parking's agent rules) and an agent download's deliverable; without them (E4a's own tests) none starts
  hosts?: Pick<HostSupervisor, 'onEvent' | 'dispatch'>;
  // E4c end
}

export interface Browser {
  store: TabStore;
  views: ViewManager;
  cua: CuaBackend; // E13: the socket each session's engine is told (`socketPathFor`), for cua's host
  stop(): void; // at will-quit: tabs.json written, every view closed
  // E4b start: the partitions, for the Chrome import (E4b Decision Log 31): its partition opened and prepared once, as a
  // tab's is, and its per-boot extension loading registered as a preparer
  partitions: Partitions;
  // E4b end
  extensions: Pick<ExtensionUi, 'removing'>; // cua #90: the action bar's popups and options tabs, for a profile's removal
}

export function startBrowser({ userData, settings, index, register, emit, env, profiles: listProfiles, /* E4c */ hosts }: BrowserDeps): Browser {
  const dir = join(userData, 'browser');
  mkdirSync(dir, { recursive: true });
  const tabsFile = join(dir, 'tabs.json');
  const profilesFile = join(dir, 'profiles.json');
  const profiles = listProfiles ?? (() => readProfiles(profilesFile));

  const { file, broken } = readTabsFile(tabsFile);
  const restored = knownSessionsOnly(file, index);
  // Each partition's browser preload (Decision Log 56), permission and download handlers. The last two close over `store`
  // and `downloads`, declared below: a partition is first opened by a tab's open or load (resolvePartition,
  // createTabView), never while startBrowser runs, so both exist by then (startBrowser opens no tab, and a restored tab is
  // suspended until asked).
  const partitions = new Partitions(
    (partition) => session.fromPartition(partition),
    [(ses) => registerBrowserPreload(ses), (ses, partition) => preparePermissions(store)(ses, partition), (ses, partition) => downloads.prepare()(ses, partition)],
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
    // E4c start: deterministic tab ids under MAWS_E2E=1 (E4c Design §13 (b); Decision Log 36)
    newTabId: e2eTabIds(env, restored.tabs),
    // E4c end
    driven: (tabId) => cua.holds(tabId), // E13: the cap never suspends a tab an agent drives through cua
  });
  if (restored.tabs.length !== file.tabs.length) writer.markDirty();
  const focusEmulation = focusEmulationMode(env);
  const windowOf = (sender: Electron.WebContents) => {
    const win = BrowserWindow.fromWebContents(sender);
    return win && isAppWindow(win) && !win.isDestroyed() ? win : null;
  };
  const views = new ViewManager({
    store,
    emit,
    windowOf,
    focusEmulation,
    setFocusEmulation,
  });
  const memory = new MemorySampler({ store, emit, metrics: () => app.getAppMetrics() });

  const seam = browserSeam(env);
  const downloads = new Downloads({
    store, emit, downloadsDir: () => app.getPath('downloads'), saveDir: e2eSaveDir(env), reveal: seam.reveal,
    // E13: a leased tab's download is the agent's (cua/downloads.ts); asked only once a page downloads, after start
    agent: { owns: (entry) => cua.downloads.owns(entry), started: (entry, download) => cua.downloads.started(entry, download) },
  });
  const favicons = new Favicons((partition, url, init) => partitions.session(partition).fetch(url, init));
  const navigator = new Navigator({ store, history: index.browserHistory, favicons, emit, seam });
  const childPreferences = tabWebPreferences();
  store.onViewCreated((entry) => {
    navigator.attach(entry);
    guardPage(entry);
    attachWindowOpen(entry, { store, linkTarget: () => settings().linkTarget, seam, childPreferences });
    attachContextMenu(entry, { store, navigator, openExternal: seam.openExternal });
    attachKeys(entry, { store, navigator, emit, bookmarksBar: (partition) => canShowBookmarksBar(profiles(), partition) /* cua #90 */ });
    attachInputSeams(entry);
    if (focusEmulation === 'on') attachFocusEmulation(entry, (tab) => views.focusEmulationWanted(tab));
  });

  // cua #90 start: the bookmarks bar's menus (recorded for the e2e's seam under MAWS_E2E=1) and its commands
  const menus = new NativeMenus({ e2e: env.MAWS_E2E === '1' });
  const confirmOpenAll = openAllConfirmation(env);
  const bar = new BookmarkBar({ tabs: store, navigator, bookmarks: index.browserBookmarks, menus, confirmOpenAll });
  // cua #90 end
  registerBrowserHandlers({
    store, views, navigator, downloads, history: index.browserHistory, profiles, register,
    bookmarks: index.browserBookmarks, bar, windowOf, favicons, avatars: new ProfileAvatars(userData), // cua #90
  });
  // cua #90: the extensions action bar (its list, popups, options tabs and menus)
  const extensionUi = startExtensionUi({ store, views, partitions, leaveInternal: (entry, url) => void navigator.leaveInternal(entry, url), records: profiles, menus, windowOf, emit, register, linkTarget: () => settings().linkTarget, seam, env });
  // E13 start: cua's primitive server over the store (its socket directory swept now); a session's socket listens from
  // its first launch (the launch mapping asks `socketPathFor`) or, for an engine that outlived a relaunch (D-16), from its
  // first status, and closes with the session's record
  // M3: who drives each tab and the agent's cursor, with the engine host's events; without them (E4a's own tests) control
  // never moves
  const controls = hosts ? new TabControls({ store }) : null;
  const cursor = controls ? new AgentCursor({ store, controls }) : null;
  // the socket peer check's addon, loaded now so its state shows before the first peer (the socket peer authentication
  // spec of 2026-10-09, M2): the packaged app's Resources/peer-auth, else the committed prebuild under the development
  // app root (the working directory, as the sessions and voice read it); under MAWS_E2E alone, the seam's trusted roots
  const peerAddon = loadPeerAddon(peerAddonPath({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appRoot: process.cwd() }));
  const trustedRoots = env.MAWS_E2E === '1' ? new Set<ProcessRoot>() : undefined;
  const cua = startCuaBackend({
    store,
    peer: { addon: peerAddon, trustedRoots },
    ...(controls && cursor && { presence: { controls, cursor } }),
    emit,
    activityStore: index.browserActivity, // cua board #93
    recordDownload: async (download) => {
      if (!hosts) return;
      const result = await hosts.dispatch('engine-host', 'maws.download.recorded', download);
      if (!result.ok) throw new Error(result.error.message);
      if ((result.value as { outcome?: string } | null)?.outcome === 'not_held') console.warn(`[browser] tab ${download.tabId}'s download was not recorded: no engine host holds ${download.appSessionId}`);
    },
    windows: () =>
      BrowserWindow.getAllWindows()
        .filter((win) => !win.isDestroyed() && isAppWindow(win))
        .map((win) => ({ id: win.id, focused: win.isFocused() })),
    reaches: (appSessionId, tabSessionId) => reachableSessions(index.sessions, appSessionId).includes(tabSessionId),
    userData,
    version: app.getVersion(),
  });
  // the session's agent activity, which a transcript lists when it mounts (M3 fix wave), kept across restarts in the
  // index since cua board #93
  register('browser.agent.activities.list', ({ appSessionId }) => ({ activities: cua.activities(appSessionId as AppSessionId) }));
  // every status of a known session names its engine to the socket's peer check (the pid while it runs, none once exited)
  const stopCuaStatus = hosts?.onEvent('session.status', ({ appSessionId, status }) => {
    if (!knownSession(index, appSessionId)) return; // never a trust bootstrap's id
    if (status.process !== 'exited') cua.socketPathFor(appSessionId);
    cua.engineProcess(appSessionId, status.process === 'exited' ? null : status.pid);
  });
  // E13 end
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
    if (cause !== 'removed') return;
    store.removeSession(record.appId);
    cua.closeSession(record.appId); // E13
  });
  const inspector = env.MAWS_E2E === '1' ? browserInspector({ store, emit }) : null;
  if (inspector) globalThis.__maws_browser = inspector;
  // E13: the e2e's fake host reads the socket and the leases; `trustRoot` makes a process (the test's own) a root beside
  // every session's engine, so a host the test runs is let in (the socket peer authentication spec, M2)
  if (inspector && trustedRoots) {
    inspector.cua = {
      socketPathFor: (appSessionId) => cua.socketPathFor(appSessionId),
      inspect: () => cua.inspect(),
      holds: (tabId) => cua.holds(tabId),
      trustRoot: (pid) => {
        const root = peerAddon ? rootOf(pid, peerAddon) : null;
        if (root) trustedRoots.add(root);
        return root !== null;
      },
    };
  }
  if (inspector) inspector.menu = { ...menus.seam, openAllAsked: () => confirmOpenAll.asked() }; // cua #90: the native menus
  if (inspector) inspector.extensions = extensionUi.seam; // cua #90: the open extension popup
  // E4d start: comment mode (E4d execution document, Interfaces "Main"; Decision Log 26(b)): the toggle's command, the
  // preload's report gate, the crop, the context menu's Comment and the e2e seam, over this store
  const commentMode = startCommentMode({ store, emit, register, userData, env });
  // E4d end
  // E4c start: the agent's presence (the dialogs' wrap, parking, the e2e seam's `agent`), re-homed from E4c's browser
  // tools when they left (the in-app browser spec of 2026-10-08, M4)
  const presence = controls && cursor ? startAgentPresence({ store, emit, views, controls, cursor, cua }) : null;
  if (inspector && presence) inspector.agent = presence.seam;
  // E4c end

  return {
    store,
    views,
    cua, // E13
    partitions, // E4b
    extensions: extensionUi, // cua #90
    // At will-quit, before the hosts stop: nothing more is sampled or placed, tabs.json is written, every page closed.
    stop: () => {
      commentMode.stop(); // E4d
      extensionUi.stop(); // cua #90: every popup closed
      if (inspector && globalThis.__maws_browser === inspector) delete globalThis.__maws_browser;
      presence?.dispose(); // E4c
      stopCuaStatus?.(); // E13
      cua.dispose(); // E13: every socket closed and unlinked; each connection's leases let go
      cursor?.dispose(); // E13
      controls?.dispose(); // E13
      app.removeListener('select-client-certificate', refuseUnownedCertificate);
      stopSessions();
      memory.stop();
      views.dispose();
      writer.close(); // the pages closed next destroy their webContents, which drops tabs nobody closed
      for (const { view } of store.all()) if (view && !view.webContents.isDestroyed()) view.webContents.close();
    },
  };
}

// E13: whether the index has a record under the id (a trust bootstrap's id never has one); false when it cannot be read.
function knownSession(index: BrowserDeps['index'], appSessionId: AppSessionId): boolean {
  try {
    return index.sessions.get(appSessionId) !== null;
  } catch {
    return false;
  }
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
