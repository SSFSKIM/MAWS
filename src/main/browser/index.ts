// The browser's side of main (E4a execution document, Design §1, §2, §9; Interfaces "Main"), started from
// `src/main/index.ts` once the index is open: the tab store over `<userData>/browser/tabs.json`, the partitions, the
// views, each view's navigation (history and favicons included), the page's guards (permissions, downloads,
// `window.open`, the context menu, the keyboard), the input attribution over each tab's TabDebugger (with focus
// emulation when it is on), the memory sample and its soft cap, `browser.*`, and under MAWS_E2E=1 the e2e's seam
// (inspect.ts). Tabs belong to sessions (P-21): a session whose record is deleted closes its tabs, and at boot a tab
// whose session the spine does not know is dropped from the file. Main never waits on the renderer. The history,
// bookmarks and agent activity are the browser's own database since P5 O3-A (data/), opened by main before the browser
// starts and told here the sessions the spine knows. P5 O3-C (readers R6, R7): the spine is read through its view.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import type { AppSessionId } from '@shared/graph/ids';
import type { SpineView } from '@shared/spine/view';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { BrowserSettings } from '@shared/ipc/schema/settings';
import type { MachineRef } from '@shared/machine/ref';
import type { BrowserData } from './data';
import type { registerMainHandler } from '../ipc/router';
import { isAppWindow } from '../windows';
import { attachContextMenu } from './context-menu';
import { Downloads, e2eSaveDir } from './downloads';
import { Favicons } from './favicon';
import { forwardedTabs, type BrowserForwards } from './forwarded';
import { browserInspector } from './inspect';
import { attachInputSeams } from './input';
import { attachKeys, canShowBookmarksBar } from './keys';
import { SessionMachines, type EmitFrom } from './machines';
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
  view: Pick<SpineView, 'record' | 'records' | 'unavailable' | 'on' | 'engineStatuses'>; // the spine's view (P5 O3-C)
  // P5 O3-A: the history, bookmarks and agent activity (data/index.ts), and the snapshot and changes of the spine's
  // sessions it keeps the activity by
  data: Pick<BrowserData, 'history' | 'bookmarks' | 'activity' | 'reattach' | 'sessionChanged'>;
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
  // P5 O7 M3: a session of another machine's tabs (machines.ts: this machine, and its events said from theirs) and the
  // forwarded ports their loopback links load from (forwarded.ts); without them (E4a's own tests) every session is local
  remote?: { local: MachineRef; emitFrom: EmitFrom; forwards: BrowserForwards };
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

export function startBrowser({ userData, settings, view, data, register, emit: emitHere, env, profiles: listProfiles, /* E4c */ hosts, remote }: BrowserDeps): Browser {
  const dir = join(userData, 'browser');
  mkdirSync(dir, { recursive: true });
  const tabsFile = join(dir, 'tabs.json');
  const profilesFile = join(dir, 'profiles.json');
  const profiles = listProfiles ?? (() => readProfiles(profilesFile));

  const { file, broken } = readTabsFile(tabsFile);
  // P5 O7 M3: every browser event naming a session of another machine is said from it (machines.ts)
  const machines = remote ? new SessionMachines(remote.local, file.machines, () => writer.markDirty()) : null;
  const emit: BrowserEmit = machines && remote ? machines.stamped(emitHere, remote.emitFrom) : emitHere;
  const restored = knownSessionsOnly(file, view);
  // Each partition's browser preload (Decision Log 56), permission and download handlers. The last two close over `store`
  // and `downloads`, declared below: a partition is first opened by a tab's open or load (resolvePartition,
  // createTabView), never while startBrowser runs, so both exist by then (startBrowser opens no tab, and a restored tab is
  // suspended until asked).
  const partitions = new Partitions(
    (partition) => session.fromPartition(partition),
    [(ses) => registerBrowserPreload(ses), (ses, partition) => preparePermissions(store)(ses, partition), (ses, partition) => downloads.prepare()(ses, partition)],
  );
  const writer = new TabsFileWriter(tabsFile, () => {
    const snapshot = store.snapshot();
    return { ...snapshot, ...machines?.kept(snapshot.tabs.map((tab) => tab.appSessionId)) };
  });
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
    routeLoad: (tab, url) => (forwarded ? forwarded.route(tab, url) : url), // P5 O7 M3: a forwarded port's tab past a relaunch
  });
  const forwarded = remote ? forwardedTabs({ store, forwards: remote.forwards, log: (line) => console.warn(line) }) : null;
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
  const navigator = new Navigator({ store, history: data.history, favicons, emit, seam });
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
  const bar = new BookmarkBar({ tabs: store, navigator, bookmarks: data.bookmarks, menus, confirmOpenAll });
  // cua #90 end
  registerBrowserHandlers({
    store, views, navigator, downloads, history: data.history, profiles, register,
    bookmarks: data.bookmarks, bar, windowOf, favicons, avatars: new ProfileAvatars(userData), // cua #90
    ...(machines && { sessions: machines }), // P5 O7 M3
    ...(forwarded && { forwarded }),
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
    activityStore: data.activity, // cua board #93
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
    reaches: (appSessionId, tabSessionId) => reachableSessions(view, appSessionId).includes(tabSessionId),
    userData,
    version: app.getVersion(),
  });
  // the session's agent activity, which a transcript lists when it mounts (M3 fix wave), kept across restarts since cua
  // board #93 (in the browser's own database since P5 O3-A)
  register('browser.agent.activities.list', ({ appSessionId }) => ({ activities: cua.activities(appSessionId as AppSessionId) }));
  // every status of a known session names its engine to the socket's peer check (the pid while it runs, none once exited)
  const engineSeen = (appSessionId: AppSessionId, status: Pick<EngineSessionStatus, 'process' | 'pid'>) => {
    if (view.record(appSessionId) === null) return; // never a trust bootstrap's id
    if (status.process !== 'exited') cua.socketPathFor(appSessionId);
    cua.engineProcess(appSessionId, status.process === 'exited' ? null : status.pid);
  };
  const stopCuaStatus = hosts?.onEvent('session.status', ({ appSessionId, status }) => engineSeen(appSessionId as AppSessionId, status));
  // P5 O3-D M5b fix round 1: on the daemon shape a kept session's status can arrive before the snapshot holds its record
  // (the mirror's snapshot and follow run independently, and the snapshot fires no record event), so the records'
  // arrival sets each known session up from the statuses the view kept
  const engineStatusesSeen = () => {
    if (hosts && view.unavailable() === null) for (const status of view.engineStatuses()) engineSeen(status.appSessionId as AppSessionId, status);
  };
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
  // P5 O3-A: every change tells the browser's data which sessions the spine knows (a removal takes the session's activity
  // rows), and the snapshot taken once that listener is in place reconciles the rows against the spine's records. P5 O3-C:
  // reconciled again whenever the view's availability changes (null while it is unavailable, which reconciles nothing;
  // in process it never changes after start, so the start is the only reconciliation)
  const stopSessions = view.on('record', (appSessionId, record) => {
    data.sessionChanged(appSessionId, record === null);
    if (record !== null) return;
    store.removeSession(appSessionId);
    cua.closeSession(appSessionId); // E13
  });
  const stopAvailability = view.on('availability', () => {
    data.reattach(sessionSnapshot(view));
    engineStatusesSeen();
  });
  data.reattach(sessionSnapshot(view));
  engineStatusesSeen();
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
    // At will-quit, once the hosts' drain has settled (P4 W2-B): nothing more is sampled or placed, tabs.json is written,
    // every page closed.
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
      stopAvailability();
      memory.stop();
      views.dispose();
      writer.close(); // the pages closed next destroy their webContents, which drops tabs nobody closed
      for (const { view } of store.all()) if (view && !view.webContents.isDestroyed()) view.webContents.close();
    },
  };
}

// P5 O3-A: every record's id, the spine's sessions as the browser's data reconciles against them; null while the view is
// unavailable (P5 O3-C: a refused run, or launch mode scenario, D10), which reconciles nothing.
function sessionSnapshot(view: BrowserDeps['view']): string[] | null {
  return view.unavailable() === null ? view.records().map((record) => record.appId) : null;
}

// The restored tabs whose session the spine knows; all of them while the view is unavailable (nothing is known then).
// P5 O7 M3: a session of another machine (`machines`) is never the spine's: its tabs are kept.
function knownSessionsOnly(file: TabsFile, view: BrowserDeps['view']): TabsFile {
  if (view.unavailable() !== null) return file;
  const knows = (appSessionId: string) => file.machines?.[appSessionId as AppSessionId] !== undefined || view.record(appSessionId as AppSessionId) !== null;
  const tabs = file.tabs.filter((tab) => knows(tab.appSessionId));
  const selected = Object.fromEntries(Object.entries(file.selected).filter(([appSessionId]) => knows(appSessionId)));
  return { ...file, tabs, selected };
}
