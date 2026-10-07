// The browser's tab store (E4a execution document, Design §2): main's record of every browser tab, keyed by tab id,
// each belonging to one session (P-21), with each session's selected tab (what the panel tool shows; what E4c's
// `browser_tabs select` moves). Every change goes through `update`, which marks the tab's session dirty and sends
// `browser.tabs.changed` with that session's whole list on the next macrotask, so a page load's dozen changes in a frame
// reach the renderer once.
//
// A tab is *loaded* when it has a view; the view is created when a URL is first loaded into the tab (opened with one,
// navigated, or resumed), never for an empty or suspended tab alone. At most BROWSER_LOADED_TABS_MAX tabs are loaded
// across the app: loading one more suspends the least recently shown eligible tab (unplaced, not loading, not
// downloading, idle), and with none eligible the tab being loaded is itself left suspended with its URL kept as the
// suggestion; nothing is ever force-closed (Decision Log 6).
//
// Later pieces attach through the entry hooks rather than through this file: `onViewCreated` is where a view's listeners
// are wired (navigation, keys, permissions, the debugger, the input seams), `onViewDestroying` where they are torn down
// before the webContents closes, and `onUpdated` where the view manager re-applies the view's visibility. The load-error
// lifecycle (Design §5, Decision Log 23) is held here as transitions the navigation listeners call, so every source of a
// navigation (the chrome, E4c's tools) shares one rule.
import { randomBytes } from 'node:crypto';
import type { BrowserWindow, WebContents, WebContentsView } from 'electron';
import type { AppSessionId } from '@shared/graph/ids';
import { classifyLoadError } from '@shared/browser/errors';
import { BROWSER_LOADED_TABS_MAX, UNKNOWN_BROWSER_TAB, type BrowserControl, type BrowserTab } from '@shared/browser/tab';
import { hostOf, validateBrowserUrl } from '@shared/browser/url';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { TabDebugger } from './debugger';
import { TabInputSeam } from './input';
import type { PersistedTab, TabsFile } from './persist';

const REQUEST_ID_MS = 10_000; // a repeated requestId within this answers the first call's tab (Design §2)

// The pane that owns a tab's placement (Design §3): its token, its surface, the window it reported from and its rect.
export interface TabPlacement {
  paneId: string;
  surface: 'panel' | 'main';
  window: BrowserWindow;
  rect: { x: number; y: number; width: number; height: number };
}

// What the input seam (input.ts `TabInputSeam`, Design §11) is read for, each in epoch ms and null until the first:
// the human's last input of any kind (wheels included; E4c's hand-back timer), the human's last activation (a key or a
// mouse press; the clipboard carve-out, permissions.ts), and anyone's last activation, the human's or the agent's (the
// `window.open` gate, window-open.ts). A wheel is never an activation, as in Chrome (Decision Log 45).
export interface TabInput {
  lastHumanAt: number | null;
  lastHumanActivationAt: number | null;
  lastActivationAt: number | null;
}

export interface TabEntry {
  tab: BrowserTab;
  view: WebContentsView | null;
  // The view manager's state (view.ts): the owning pane, the window whose contentView holds the view (it stays there,
  // hidden, after the owner lets go), and the visibility last applied.
  placement: TabPlacement | null;
  host: BrowserWindow | null;
  visible: boolean;
  // The view shows a document of the tab's own: false from creation, after a load error or a crash, until the next
  // committed navigation, so neither a blank view nor Chromium's own error page is ever shown in the pane. An adopted
  // `about:blank` child starts true: its opener may write into that document without ever navigating it.
  committed: boolean;
  // The URL of the document the view last committed (cross-document or in-page); null before the first commit. What a
  // navigation that never lands returns the address field to, and the URL a page's title belongs to.
  committedUrl: string | null;
  // What a navigation command cleared (the URL it replaced, the error or crash page), kept until that navigation commits
  // or fails; restored when loading stops with neither (Stop, Esc, a URL that became a download, an abort).
  pending: PendingNavigation | null;
  // The tab's one CDP attachment (debugger.ts), made with its view and gone with it; attached only when someone asks.
  debugger: TabDebugger | null;
  input: TabInputSeam;
  // The chrome's find bar is open for this tab (main opened it on ⌘F in the page, or a find request arrived), so Esc in
  // the page closes it rather than reaching the page (keys.ts).
  findOpen: boolean;
}

export interface PendingNavigation {
  url: string;
  loadError: BrowserTab['loadError'];
  crashed: BrowserTab['crashed'];
}

// Who drives the page is not patchable: `setControl` is its one transition, so `browser.control.changed` always follows.
export type TabPatch = Partial<Omit<BrowserTab, 'tabId' | 'appSessionId' | 'control' | 'controlSince'>>;
export type BrowserEmit = <N extends EventName>(name: N, payload: EventPayload<N>) => unknown;

export class UnknownTabError extends Error {
  constructor(readonly tabId: string) {
    super(UNKNOWN_BROWSER_TAB);
  }
}

export interface TabStoreDeps {
  emit: BrowserEmit;
  // A view for the tab, in the tab's partition, with no listeners yet (view.ts `createTabView`); may throw. With
  // `adopted`, the view takes that webContents (a page's `window.open` child Chromium already created) instead.
  createView(tab: BrowserTab, adopted?: WebContents): WebContentsView;
  // The partition a new tab of this session opens in (the Browser setting's profile, its fallbacks and their notices).
  resolvePartition(appSessionId: AppSessionId, tabId: string): string;
  restored?: Pick<TabsFile, 'tabs' | 'selected'>;
  fileBroken?: boolean; // tabs.json was moved aside at boot: told once, to the first session that lists or opens
  onDirty?(): void; // something tabs.json keeps may have changed
  now?(): number;
  newTabId?(): string;
  schedule?(fn: () => void): void; // the next macrotask
}

// A page's `window.open` child, adopted as a tab of its opener's session in its opener's partition (window-open.ts).
export interface AdoptRequest {
  url: string; // the child's first URL as the page gave it: http(s), or about:blank
  select: boolean;
  webContents: WebContents; // Chromium's child webContents (the `createWindow` options' own)
}

export interface OpenRequest {
  appSessionId: AppSessionId;
  url: string | null;
  select: boolean;
  reuse?: 'url';
  requestId?: string;
  partition?: string; // a tab opened from a page (its context menu) opens in that page's partition, not the setting's
}

const normalised = (url: string) => {
  const checked = validateBrowserUrl(url);
  return checked.ok ? checked.url : url;
};

export class TabStore {
  private readonly entries = new Map<string, TabEntry>();
  private readonly selected = new Map<AppSessionId, string | null>();
  private readonly requests = new Map<string, { tabId: string; at: number }>();
  private readonly dirtySessions = new Set<AppSessionId>();
  private emitScheduled = false;
  private fileBroken: boolean;
  private readonly created = new Set<(entry: TabEntry) => void>();
  private readonly destroying = new Set<(entry: TabEntry) => void>();
  private readonly updated = new Set<(entry: TabEntry) => void>();
  private readonly now: () => number;
  private readonly schedule: (fn: () => void) => void;

  constructor(private readonly deps: TabStoreDeps) {
    this.now = deps.now ?? Date.now;
    this.schedule = deps.schedule ?? ((fn) => void setTimeout(fn, 0));
    this.fileBroken = deps.fileBroken ?? false;
    for (const persisted of deps.restored?.tabs ?? []) this.entries.set(persisted.tabId, this.blankEntry(this.restoredTab(persisted)));
    for (const [appSessionId, tabId] of Object.entries(deps.restored?.selected ?? {})) {
      const owned = tabId !== null && this.entries.get(tabId)?.tab.appSessionId === appSessionId;
      this.selected.set(appSessionId as AppSessionId, owned ? tabId : null);
    }
  }

  // ---- hooks ----------------------------------------------------------------------------------------------------------

  onViewCreated(listener: (entry: TabEntry) => void): () => void {
    return this.hook(this.created, listener);
  }

  onViewDestroying(listener: (entry: TabEntry) => void): () => void {
    return this.hook(this.destroying, listener);
  }

  onUpdated(listener: (entry: TabEntry) => void): () => void {
    return this.hook(this.updated, listener);
  }

  // ---- reads ----------------------------------------------------------------------------------------------------------

  entry(tabId: string): TabEntry | undefined {
    return this.entries.get(tabId);
  }

  require(tabId: string): TabEntry {
    const entry = this.entries.get(tabId);
    if (!entry) throw new UnknownTabError(tabId);
    return entry;
  }

  all(): TabEntry[] {
    return [...this.entries.values()];
  }

  // The tab whose view holds this webContents.
  entryOf(webContents: WebContents): TabEntry | undefined {
    for (const entry of this.entries.values()) if (entry.view?.webContents === webContents) return entry;
    return undefined;
  }

  // The least recently shown loaded tab that may be unloaded: not placed in a pane, not loading, not downloading, and
  // not the agent's or the human's (Design §2). The count cap here and the memory cap (memory.ts) share it.
  capVictim(except: TabEntry | null = null): TabEntry | undefined {
    const eligible = this.all().filter(
      (entry) =>
        entry !== except &&
        entry.view !== null &&
        entry.tab.placedIn === null &&
        !entry.tab.loading &&
        entry.tab.download?.state !== 'progressing' &&
        entry.tab.control === 'idle',
    );
    eligible.sort((a, b) => a.tab.lastShownAt.localeCompare(b.tab.lastShownAt) || a.tab.createdAt.localeCompare(b.tab.createdAt));
    return eligible[0];
  }

  // Whether one more tab could be loaded now: under the cap, or with an eligible tab to suspend for it.
  hasRoomForView(): boolean {
    return this.loadedCount() < BROWSER_LOADED_TABS_MAX || this.capVictim(null) !== undefined;
  }

  loadedCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) if (entry.view) count++;
    return count;
  }

  // `browser.tabs.list`: every tab, or one session's, with the selected tab of each session listed.
  list(appSessionId?: AppSessionId): { tabs: BrowserTab[]; selected: Record<AppSessionId, string | null> } {
    if (appSessionId !== undefined) this.announceBrokenFile(appSessionId);
    const tabs = this.all()
      .map((entry) => entry.tab)
      .filter((tab) => appSessionId === undefined || tab.appSessionId === appSessionId);
    const sessions = appSessionId !== undefined ? [appSessionId] : [...new Set([...this.selected.keys(), ...tabs.map((tab) => tab.appSessionId)])];
    const selected: Record<AppSessionId, string | null> = {};
    for (const id of sessions) if (this.selected.has(id) || tabs.some((tab) => tab.appSessionId === id)) selected[id] = this.selected.get(id) ?? null;
    return { tabs, selected };
  }

  // What tabs.json keeps (Design §2).
  snapshot(): TabsFile {
    const tabs = this.all().map(({ tab }): PersistedTab => ({
      tabId: tab.tabId,
      appSessionId: tab.appSessionId,
      partition: tab.partition,
      url: tab.url,
      title: tab.title,
      favicon: tab.favicon,
      zoom: tab.zoom,
      createdAt: tab.createdAt,
      lastShownAt: tab.lastShownAt,
    }));
    return { version: 1, tabs, selected: Object.fromEntries(this.selected) };
  }

  // ---- commands -------------------------------------------------------------------------------------------------------

  // `browser.tabs.open` (Design §2; Decision Log 7).
  open(request: OpenRequest): { tab: BrowserTab; reused: boolean } {
    const { appSessionId, select, reuse, requestId } = request;
    this.announceBrokenFile(appSessionId);
    const at = this.now();
    for (const [id, seen] of this.requests) if (at - seen.at > REQUEST_ID_MS) this.requests.delete(id);
    const earlier = requestId === undefined ? undefined : this.requests.get(requestId);
    if (earlier && this.entries.has(earlier.tabId)) return { tab: this.require(earlier.tabId).tab, reused: true };

    const url = request.url === null ? null : normalised(request.url);
    const same = url !== null && reuse === 'url' ? this.all().find(({ tab }) => tab.appSessionId === appSessionId && tab.url !== '' && normalised(tab.url) === url) : undefined;
    if (same) {
      if (select) this.setSelected(appSessionId, same.tab.tabId);
      if (!same.view) this.load(same.tab.tabId, url!);
      this.remember(requestId, same.tab.tabId, at);
      return { tab: same.tab, reused: true };
    }

    const tabId = this.mintTabId();
    const entry = this.blankEntry(this.newTab(tabId, appSessionId, request.partition ?? this.deps.resolvePartition(appSessionId, tabId)));
    this.entries.set(tabId, entry);
    this.changed(entry);
    if (select || !this.selected.get(appSessionId)) this.setSelected(appSessionId, tabId);
    if (url !== null) this.load(tabId, url);
    this.remember(requestId, tabId, at);
    return { tab: entry.tab, reused: false };
  }

  // A page's `window.open` child (Design §14; Decision Log 24): a new tab of the opener's session and partition whose
  // view adopts Chromium's child webContents, so `window.opener` works. The cap applies as for any load (the gate asked
  // `hasRoomForView` first; should the room have gone meanwhile, the child is adopted over the cap rather than refused,
  // since Chromium has already created it). Its listeners are wired before this returns, ahead of the child's first
  // navigation, which Chromium starts itself. An `about:blank` child counts as committed (see `TabEntry.committed`).
  // When the view cannot be made or wired, the tab is marked failed with no view and the child is left open for the
  // caller to close once Electron has it back (closing it inside `createWindow` would pull it from under Electron).
  adoptChild(opener: TabEntry, { url, select, webContents }: AdoptRequest): TabEntry {
    const { appSessionId, partition } = opener.tab;
    const blank = url === 'about:blank';
    const tabId = this.mintTabId();
    const entry = this.blankEntry({ ...this.newTab(tabId, appSessionId, partition), url: blank ? '' : url, loading: !blank });
    this.entries.set(tabId, entry);
    this.changed(entry);
    if (select || !this.selected.get(appSessionId)) this.setSelected(appSessionId, tabId);
    this.makeRoom(entry); // no room: adopted over the cap all the same
    this.createViewFor(entry, webContents, blank);
    return entry;
  }

  // `browser.tabs.close`: the view destroyed, the entry dropped, and the session's selection moved to the neighbour (the
  // next tab, else the previous) when it was this tab.
  close(tabId: string): void {
    const entry = this.require(tabId);
    const { appSessionId } = entry.tab;
    const siblings = this.all().filter(({ tab }) => tab.appSessionId === appSessionId);
    const index = siblings.indexOf(entry);
    this.destroyView(entry);
    this.entries.delete(tabId);
    if (this.selected.get(appSessionId) === tabId) {
      const neighbour = siblings[index + 1] ?? siblings[index - 1] ?? null;
      this.selected.set(appSessionId, neighbour?.tab.tabId ?? null);
    }
    this.markSession(appSessionId);
  }

  // `browser.tabs.select`: the tab must be the session's.
  select(appSessionId: AppSessionId, tabId: string): void {
    const entry = this.require(tabId);
    if (entry.tab.appSessionId !== appSessionId) throw new UnknownTabError(tabId);
    this.setSelected(appSessionId, tabId);
  }

  // A session whose record was deleted: its tabs closed, its selection forgotten.
  removeSession(appSessionId: AppSessionId): void {
    for (const entry of this.all()) {
      if (entry.tab.appSessionId !== appSessionId) continue;
      this.destroyView(entry);
      this.entries.delete(entry.tab.tabId);
    }
    this.selected.delete(appSessionId);
    this.markSession(appSessionId);
  }

  // Loads a URL (already validated) into the tab: the view created first when there is none (the cap applies), then
  // the navigation commanded and `loadURL` voided, since tab state comes from the view's events alone (Decision Log 23).
  // False when the tab could not be loaded: left suspended by the cap, or its view could not be created.
  load(tabId: string, url: string): boolean {
    const entry = this.require(tabId);
    if (!this.ensureView(entry, url)) return false;
    return this.navigateView(entry, url);
  }

  // Unloads the tab: its view closed, {url, title, favicon, zoom} kept, the page's transient state dropped.
  suspend(tabId: string): void {
    const entry = this.require(tabId);
    this.destroyView(entry);
    this.update(tabId, {
      suspended: true,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      loadError: null,
      crashed: null,
      unresponsive: false,
      blockedPopups: 0,
      find: null,
      denied: [],
      memoryKiB: null,
    });
  }

  // Who drives the page (Design §11): stamped and told at once through `browser.control.changed` (E4c's waits read it),
  // and in the next tab list. E4a moves it only to `idle` (`browser.control.handBack`, from any state); E4c supplies
  // every other transition through here.
  setControl(tabId: string, control: BrowserControl): void {
    const controlSince = new Date(this.now()).toISOString();
    this.patch(this.require(tabId), { control, controlSince });
    this.deps.emit('browser.control.changed', { tabId, control, controlSince });
  }

  // The one way a tab changes (Design §2).
  update(tabId: string, patch: TabPatch): BrowserTab {
    return this.patch(this.require(tabId), patch);
  }

  // ---- the load-error lifecycle (Design §5, Decision Log 23) -----------------------------------------------------------

  // Any navigation command (an address, Back, Forward, Reload, E4c's navigate): the error and crash pages give way at
  // once, and the view stays hidden until the new document commits when what it shows now is not the tab's own. What
  // the command cleared is kept until its navigation lands (`loadStopped`); a second command keeps the first's.
  beginNavigation(tabId: string, patch: TabPatch = {}): void {
    const entry = this.require(tabId);
    const { url, loadError, crashed } = entry.tab;
    entry.pending ??= { url, loadError, crashed };
    this.update(tabId, { ...patch, loading: true, loadError: null, crashed: null, failed: null });
  }

  // A main-frame `did-navigate`: a committed, non-error document.
  navigationCommitted(tabId: string, { url, canGoBack, canGoForward }: { url: string; canGoBack: boolean; canGoForward: boolean }): void {
    const entry = this.require(tabId);
    entry.committed = true;
    entry.committedUrl = url;
    entry.pending = null;
    this.update(tabId, { url, canGoBack, canGoForward, loadError: null, crashed: null, denied: [], blockedPopups: 0 });
  }

  // A main-frame `did-navigate-in-page` (a fragment, `history.pushState`, Back or Forward within the document): the same
  // document at another URL. `loading` is read from the view: a same-document move may come with no loading events.
  navigatedInPage(tabId: string, { url, canGoBack, canGoForward, loading }: { url: string; canGoBack: boolean; canGoForward: boolean; loading: boolean }): void {
    const entry = this.require(tabId);
    entry.committedUrl = url;
    entry.pending = null;
    this.update(tabId, { url, canGoBack, canGoForward, loading });
  }

  // `did-stop-loading`. A navigation that ended with neither a commit nor a failure (Stop, Esc, a URL that became a
  // download, an abort) returns the tab to what it showed: the committed page's URL, else the error or crash page the
  // command cleared, with the URL it had.
  loadStopped(tabId: string, { canGoBack, canGoForward }: { canGoBack: boolean; canGoForward: boolean }): void {
    const entry = this.require(tabId);
    const { pending } = entry;
    entry.pending = null;
    const restored: TabPatch = !pending ? {} : entry.committed && entry.committedUrl !== null ? { url: entry.committedUrl } : { ...pending };
    this.update(tabId, { loading: false, canGoBack, canGoForward, ...restored });
  }

  // A main-frame `did-fail-load`: the failed URL stays in the address field and the view is hidden; -3 is never an error.
  // The error page replaces the document as a commit does, so that document's denied permissions go with it.
  loadFailed(tabId: string, failure: { url: string; code: number; description: string; canGoBack: boolean; canGoForward: boolean }): void {
    const kind = classifyLoadError(failure.code, failure.description);
    if (kind === null) return;
    const entry = this.require(tabId);
    entry.committed = false;
    entry.pending = null;
    const { url, code, description, canGoBack, canGoForward } = failure;
    this.update(tabId, { url, canGoBack, canGoForward, loading: false, loadError: { url, host: hostOf(url), kind, code, description }, denied: [] });
  }

  // `render-process-gone`: the crash page until the next committed navigation. The debugger's attachment ends with the
  // renderer (Design §15); whoever needs it next attaches again.
  rendererGone(tabId: string, reason: string): void {
    const entry = this.require(tabId);
    entry.committed = false;
    entry.pending = null; // the crash page stands; a stop that follows restores nothing over it
    entry.debugger?.detach();
    this.update(tabId, { crashed: { reason }, loading: false, unresponsive: false });
  }

  // ---- internals ------------------------------------------------------------------------------------------------------

  private navigateView(entry: TabEntry, url: string): boolean {
    const view = entry.view!;
    this.beginNavigation(entry.tab.tabId, { url });
    try {
      view.webContents.loadURL(url).catch(() => {}); // a failure arrives as did-fail-load; the promise says nothing more
    } catch (error) {
      this.failView(entry, error);
      return false;
    }
    return true;
  }

  private ensureView(entry: TabEntry, url: string): boolean {
    if (entry.view) return true;
    if (!this.makeRoom(entry)) {
      this.update(entry.tab.tabId, { suspended: true, url, loading: false });
      this.capNotice(entry);
      return false;
    }
    return this.createViewFor(entry);
  }

  // Room for one more loaded tab: true under the cap, or once the least recently shown eligible tab is suspended for it
  // (with the notice on `entry`); false when no tab is eligible.
  private makeRoom(entry: TabEntry): boolean {
    if (this.loadedCount() < BROWSER_LOADED_TABS_MAX) return true;
    const victim = this.capVictim(entry);
    if (!victim) return false;
    this.suspend(victim.tab.tabId);
    this.capNotice(entry);
    return true;
  }

  // The view made (or Chromium's child adopted) and its listeners wired; false, with the tab failed and no view, when
  // either throws. An adopted child is never closed here (adoptChild).
  private createViewFor(entry: TabEntry, adopted?: WebContents, committed = false): boolean {
    try {
      entry.view = adopted ? this.deps.createView(entry.tab, adopted) : this.deps.createView(entry.tab);
    } catch (error) {
      this.failView(entry, error);
      return false;
    }
    entry.debugger = new TabDebugger(entry.view.webContents); // attaches only when someone first asks
    entry.committed = committed;
    this.update(entry.tab.tabId, { suspended: false, failed: null });
    try {
      for (const listener of [...this.created]) listener(entry);
    } catch (error) {
      console.error('[browser] a new view could not be wired:', error);
      this.failView(entry, error, { close: !adopted });
      return false;
    }
    return true;
  }

  // Told in the chrome of the session whose open or resume met the cap, on the tab it opened or resumed (whether another
  // tab, perhaps another session's, was unloaded for it, or it was itself left unloaded) (Design §2).
  private capNotice(opened: TabEntry): void {
    const { appSessionId, tabId } = opened.tab;
    this.deps.emit('browser.notice', { appSessionId, tabId, kind: 'tabsCap', count: BROWSER_LOADED_TABS_MAX });
  }

  private failView(entry: TabEntry, error: unknown, options: { close?: boolean } = {}): void {
    this.destroyView(entry, options);
    this.update(entry.tab.tabId, { failed: { message: error instanceof Error ? error.message : String(error) }, loading: false });
  }

  private destroyView(entry: TabEntry, { close = true }: { close?: boolean } = {}): void {
    const view = entry.view;
    if (!view) return;
    for (const listener of [...this.destroying]) listener(entry);
    entry.debugger?.detach();
    entry.view = null;
    entry.debugger = null;
    entry.committed = false;
    entry.committedUrl = null;
    entry.pending = null;
    if (close && !view.webContents.isDestroyed()) view.webContents.close();
  }

  private setSelected(appSessionId: AppSessionId, tabId: string): void {
    this.selected.set(appSessionId, tabId);
    this.markSession(appSessionId);
  }

  private remember(requestId: string | undefined, tabId: string, at: number): void {
    if (requestId !== undefined) this.requests.set(requestId, { tabId, at });
  }

  private announceBrokenFile(appSessionId: AppSessionId): void {
    if (!this.fileBroken) return;
    this.fileBroken = false;
    this.deps.emit('browser.notice', { appSessionId, tabId: null, kind: 'tabsFileBroken' });
  }

  private patch(entry: TabEntry, patch: Partial<BrowserTab>): BrowserTab {
    entry.tab = { ...entry.tab, ...patch };
    this.changed(entry);
    return entry.tab;
  }

  private changed(entry: TabEntry): void {
    this.markSession(entry.tab.appSessionId);
    for (const listener of [...this.updated]) listener(entry);
  }

  private markSession(appSessionId: AppSessionId): void {
    this.dirtySessions.add(appSessionId);
    this.deps.onDirty?.();
    if (this.emitScheduled) return;
    this.emitScheduled = true;
    this.schedule(() => this.emitChanged());
  }

  private emitChanged(): void {
    this.emitScheduled = false;
    const sessions = [...this.dirtySessions];
    this.dirtySessions.clear();
    for (const appSessionId of sessions) {
      const tabs = this.all()
        .filter(({ tab }) => tab.appSessionId === appSessionId)
        .map(({ tab }) => tab);
      this.deps.emit('browser.tabs.changed', { appSessionId, tabs, selected: this.selected.get(appSessionId) ?? null });
    }
  }

  private hook(set: Set<(entry: TabEntry) => void>, listener: (entry: TabEntry) => void): () => void {
    set.add(listener);
    return () => void set.delete(listener);
  }

  private mintTabId(): string {
    for (;;) {
      const tabId = this.deps.newTabId?.() ?? `b_${randomBytes(6).toString('hex')}`;
      if (!this.entries.has(tabId)) return tabId;
    }
  }

  private blankEntry(tab: BrowserTab): TabEntry {
    return { tab, view: null, placement: null, host: null, visible: false, committed: false, committedUrl: null, pending: null, debugger: null, input: new TabInputSeam(), findOpen: false };
  }

  private newTab(tabId: string, appSessionId: AppSessionId, partition: string): BrowserTab {
    const at = new Date(this.now()).toISOString();
    return {
      tabId,
      appSessionId,
      partition,
      url: '',
      title: '',
      favicon: null,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      zoom: 1,
      control: 'idle',
      controlSince: at,
      suspended: false,
      loadError: null,
      crashed: null,
      failed: null,
      unresponsive: false,
      blockedPopups: 0,
      find: null,
      denied: [],
      download: null,
      memoryKiB: null,
      placedIn: null,
      covered: false,
      createdAt: at,
      lastShownAt: at,
    };
  }

  // Every tab restores suspended: no view, idle, nothing in flight (G4).
  private restoredTab(persisted: PersistedTab): BrowserTab {
    return {
      ...this.newTab(persisted.tabId, persisted.appSessionId as AppSessionId, persisted.partition),
      ...persisted,
      appSessionId: persisted.appSessionId as AppSessionId,
      suspended: true,
    };
  }
}
