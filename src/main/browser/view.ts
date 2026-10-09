// The browser's views (E4a execution document, Design §3; A-33's placement and cover protocol as E4-0 measured it): one
// `WebContentsView` per loaded tab, created in the tab's partition (whose session runs the browser preload; sandboxed,
// isolated, no Node), and laid over the pane that owns it.
//
// Placement has one owner. A pane reports `browser.view.place` with its own token; a report with `claim` makes that pane
// the owner, and a report from any other pane is ignored, `null` included, so a pane that lost the view can neither move
// it nor hide it. A rect (CSS px of the window's content area, which maps 1:1 onto `setBounds` under `hiddenInset`) is
// rounded and applied at once; the view moves into the reporting window's contentView first if it lives elsewhere (a view
// lives in one contentView at a time). The owner's `null` hides the view and releases it; the view stays attached to its
// last window, hidden, so a reselection is one `setVisible`.
//
// Cover is per window: the renderer says a layer opened over its window, and main hides every view placed there (moving
// the native focus to the window's own page first when a hidden page held it, so the sheet takes the typing and its Esc),
// then captures each hidden page as the placeholder the pane draws under the layer. cua board #90 reversed that order:
// a page on screen is captured first and hidden only once its still is in the pane, since hiding first left the pane
// empty until the still arrived (25 to 270 ms measured), and a page that became showable under the cover is captured
// too (`still`).
//
// A view shows only while its tab is placed, its window uncovered, and the tab has a committed page of its own (not
// suspended, no load error, not crashed, not failed): the renderer draws those states in the pane instead.
//
// cua #90: an extension's popup is a view of its own over the window's page views (extensions/popup.ts). The manager tells
// `onViewAdded` whenever it adds a page view to a window, which puts that view on top, so the popup is raised back over
// it, and `onCovered` the moment a cover goes on, before any still is taken: the popup closes then.
//
// The app window's own renderer reloading (⌘R) or crashing resets that window: its cover cleared, its owners released,
// their views hidden; the fresh renderer's panes claim again on mount. A closing window gives its views up; the tabs
// live on, unplaced.
import { join } from 'node:path';
import { BaseWindow, WebContentsView, type BrowserWindow, type NativeImage, type Session, type WebContents, type WebPreferences } from 'electron';
import { BROWSER_PLACEHOLDER_MAX_BYTES, type BrowserTab } from '@shared/browser/tab';
import type { CommandInput } from '@shared/ipc/schema';
import type { Partitions } from './partition';
import type { BrowserEmit, TabEntry, TabStore } from './tabs';
import type { FocusEmulationMode } from './visibility';

// out/preload/browser.js beside the app window's out/preload/index.js (main is bundled into out/main/index.js).
export const BROWSER_PRELOAD = join(__dirname, '../preload/browser.js');
export const BROWSER_PRELOAD_ID = 'maws-browser';
const PLACEHOLDER_JPEG_QUALITY = 80;

// The browser preload belongs to the partition, not to the page (Decision Log 56): registered once on each browser
// partition's session when the partition is prepared (index.ts), it runs in the main frame of every page there, a tab
// adopted from a page's `window.open` included, where a preload named in the page's own preferences (the open handler's
// override) never ran. No page names it as well, which would run it twice.
export function registerBrowserPreload(ses: Pick<Session, 'getPreloadScripts' | 'registerPreloadScript'>, filePath = BROWSER_PRELOAD): void {
  if (ses.getPreloadScripts().some((script) => script.id === BROWSER_PRELOAD_ID)) return; // Electron throws on a repeated id
  ses.registerPreloadScript({ type: 'frame', id: BROWSER_PRELOAD_ID, filePath });
}

// MAWS's own preferences for every page (pass two's construction, less the preload, which is the partition's): sandboxed
// and isolated, no Node, and `nodeIntegrationInSubFrames` left off, so no subframe runs the preload. A page's
// `window.open` child gets these over whatever the page asked for (window-open.ts); its partition is its opener's, which
// Chromium's child already shares.
export function tabWebPreferences(): WebPreferences {
  // safeDialogs: a page looping alert() is offered Chrome's "prevent additional dialogs" after the first
  return { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: true, safeDialogs: true };
}

// A tab's view in its partition; or, for an adopted `window.open` child, the view over Chromium's child webContents.
export function createTabView(partitions: Pick<Partitions, 'session'>): (tab: BrowserTab, adopted?: WebContents) => WebContentsView {
  return (tab, adopted) => {
    partitions.session(tab.partition); // prepared (its preload registered) before its first page loads
    if (adopted) return new WebContentsView({ webContents: adopted });
    return new WebContentsView({ webPreferences: { partition: tab.partition, ...tabWebPreferences() } });
  };
}

// Whether the tab has a page of its own to show (Design §3 `shown`).
export function shown(entry: TabEntry): boolean {
  const { tab } = entry;
  return entry.view !== null && entry.committed && !tab.suspended && tab.loadError === null && tab.crashed === null && tab.failed === null;
}

export type PlaceInput = CommandInput<'browser.view.place'>;

export interface ViewManagerDeps {
  store: TabStore;
  emit: BrowserEmit;
  // The app window an invoke came from; null for anything else (a closed window's late message).
  windowOf(sender: WebContents): BrowserWindow | null;
  focusEmulation: FocusEmulationMode;
  // Under focus emulation, called when a view's wanted state changes (the TabDebugger sends the command).
  setFocusEmulation?(entry: TabEntry, enabled: boolean): void;
  now?(): number;
}

export class ViewManager {
  private readonly coveredWindows = new Set<number>();
  private readonly coverGeneration = new Map<number, number>();
  private readonly watched = new WeakSet<BrowserWindow>();
  private readonly focusEmulated = new WeakMap<TabEntry, boolean>();
  // cua #90: the cover generation each tab's still was taken for, and the pages kept on screen while theirs is taken
  private readonly stills = new WeakMap<TabEntry, number>();
  private readonly capturing = new WeakMap<TabEntry, number>(); // the cover generation keeping each page up
  private readonly staged = new WeakSet<TabEntry>(); // in the staging window for its still: left alone meanwhile
  private readonly added = new Set<(win: BrowserWindow) => void>(); // cua #90
  private readonly coverOn = new Set<(win: BrowserWindow) => void>(); // cua #90
  private readonly unhook: (() => void)[];
  private readonly now: () => number;

  constructor(private readonly deps: ViewManagerDeps) {
    this.now = deps.now ?? Date.now;
    const { store } = deps;
    this.unhook = [
      store.onViewCreated((entry) => {
        entry.view!.setVisible(false); // a new view is visible until told otherwise
        entry.visible = false;
        this.attach(entry);
        this.apply(entry);
      }),
      store.onViewDestroying((entry) => this.detach(entry)),
      store.onUpdated((entry) => this.apply(entry)),
    ];
  }

  // `browser.view.place` (Design §3, Decision Log 22).
  place({ tabId, paneId, surface, rect, claim }: PlaceInput, sender: WebContents): void {
    const win = this.deps.windowOf(sender);
    if (!win) return;
    const entry = this.deps.store.require(tabId);
    this.watch(win);
    const owns = entry.placement?.paneId === paneId;
    if (rect === null) {
      if (owns) this.release(entry);
      return;
    }
    if (!owns && !claim) return;
    entry.placement = {
      paneId,
      surface,
      window: win,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    };
    this.attach(entry);
    this.apply(entry, owns ? {} : { lastShownAt: this.stamp() });
  }

  // `browser.view.cover` (Design §3, Decision Log 4 and 20). Resolves once every placeholder is sent.
  async cover(covered: boolean, sender: WebContents): Promise<void> {
    const win = this.deps.windowOf(sender);
    if (!win) return;
    this.watch(win);
    const placed = this.placedIn(win);
    if (!covered) {
      this.nextGeneration(win); // a capture still in flight is not sent
      this.coveredWindows.delete(win.id);
      for (const entry of placed) this.capturing.delete(entry);
      for (const entry of placed) this.apply(entry);
      return;
    }
    if (this.coveredWindows.has(win.id)) return;
    const generation = this.nextGeneration(win);
    const showing = placed.filter((entry) => entry.visible);
    // any placed page holding the native focus gives it to the window's own page, so the layer takes the typing and Esc
    if (placed.some(holdsFocus)) win.webContents.focus();
    this.coveredWindows.add(win.id);
    for (const listener of [...this.coverOn]) listener(win); // cua #90: the window's popup closes at once
    // cua #90: a page on screen stays up until its still is in the pane (`still`), so the pane never shows a hole
    for (const entry of showing) this.capturing.set(entry, generation);
    for (const entry of placed) this.apply(entry);
    await Promise.all(showing.map((entry) => this.still(entry, win, generation)));
  }

  // Under focus emulation, whether the tab's page should have it now (what was last sent through `setFocusEmulation`).
  focusEmulationWanted(entry: TabEntry): boolean {
    return this.focusEmulated.get(entry) ?? false;
  }

  // cua #90 start: what the window's extension popup follows
  onViewAdded(listener: (win: BrowserWindow) => void): () => void {
    this.added.add(listener);
    return () => void this.added.delete(listener);
  }

  onCovered(listener: (win: BrowserWindow) => void): () => void {
    this.coverOn.add(listener);
    return () => void this.coverOn.delete(listener);
  }

  isCovered(windowId: number): boolean {
    return this.coveredWindows.has(windowId);
  }
  // cua #90 end

  dispose(): void {
    for (const unhook of this.unhook) unhook();
  }

  // ---- internals ------------------------------------------------------------------------------------------------------

  // A showing ends: the owner let go, or its window reloaded or closed. `lastShownAt` is when the tab was last on screen,
  // so it is stamped when a showing ends as well as when one starts (the cap evicts the least recently shown).
  private release(entry: TabEntry): void {
    entry.placement = null;
    this.apply(entry, { lastShownAt: this.stamp() });
  }

  // cua #90: a page view joined the window, on top of it
  private viewAdded(win: BrowserWindow): void {
    for (const listener of [...this.added]) listener(win);
  }

  private stamp(): string {
    return new Date(this.now()).toISOString();
  }

  // Puts the view in its owner's window at its owner's rect (no-op without a view or an owner).
  private attach(entry: TabEntry): void {
    const { view, placement } = entry;
    if (!view || !placement) return;
    if (entry.host !== placement.window) {
      this.detach(entry);
      placement.window.contentView.addChildView(view);
      entry.host = placement.window;
      this.viewAdded(placement.window); // cua #90
    }
    view.setBounds(placement.rect);
  }

  // Takes the view out of its window, hidden (`visible` always says what the view shows).
  private detach(entry: TabEntry): void {
    const { view, host } = entry;
    if (view && entry.visible) view.setVisible(false);
    if (view && host && !host.isDestroyed()) host.contentView.removeChildView(view);
    entry.host = null;
    entry.visible = false;
    this.focusEmulated.delete(entry);
  }

  // cua #90: the page's still for this cover, sent to the pane; only then is a page on screen hidden. A page on screen
  // is captured as it shows (the view stays up meanwhile, `capturing`) and hidden STILL_SETTLE_MS after its still went
  // out, the frames the pane needs to draw it, so the pane never shows a hole between the hide and the still. A page that
  // became showable under the cover (it committed, was placed here or came back from suspension while the layer stood)
  // is captured hidden once its load stopped; one that never painted gives Chromium nothing to capture, so it is moved
  // for the capture into a hidden staging window, where a page counts as visible and paints (`stagedCapture`).
  private async still(entry: TabEntry, win: BrowserWindow, generation: number): Promise<void> {
    const view = entry.view!;
    this.stills.set(entry, generation);
    const current = () =>
      this.coverGeneration.get(win.id) === generation &&
      this.deps.store.entry(entry.tab.tabId) === entry &&
      entry.view === view &&
      entry.placement?.window === win; // not moved to another window meanwhile
    const keptUp = () => this.capturing.get(entry) === generation; // a later cover's mark is that cover's own
    let placeholder = await placeholderOf(view);
    if (placeholder === null && !keptUp() && current()) placeholder = await this.stagedCapture(entry, view);
    if (current()) this.deps.emit('browser.view.covered', { tabId: entry.tab.tabId, placeholder });
    if (!keptUp()) return;
    if (current() && placeholder !== null) await delay(STILL_SETTLE_MS);
    if (!keptUp()) return;
    this.capturing.delete(entry);
    // the page stayed on top meanwhile, so a click may have given it the native focus, which a hidden view keeps: the
    // window's own page takes it back, so the layer gets the typing and Esc
    if (current() && holdsFocus(entry) && !win.isDestroyed()) win.webContents.focus();
    this.apply(entry);
  }

  // cua #90: whether the tab is in the staging window for its still, where nobody can see it (its page's dialogs are
  // answered as an unplaced tab's are, agent/dialogs.ts)
  staging(entry: TabEntry): boolean {
    return this.staged.has(entry);
  }

  private async stagedCapture(entry: TabEntry, view: WebContentsView): Promise<string | null> {
    const { width, height } = view.getBounds();
    if (width < 1 || height < 1) return null;
    const stage = new BaseWindow({ show: false, width, height });
    this.staged.add(entry);
    let placeholder: string | null = null;
    try {
      if (entry.host && !entry.host.isDestroyed()) entry.host.contentView.removeChildView(view); // it rejoins it below
      stage.contentView.addChildView(view);
      view.setBounds({ x: 0, y: 0, width, height });
      view.setVisible(true);
      for (let attempt = 0; placeholder === null && attempt < STAGED_ATTEMPTS && !view.webContents.isDestroyed(); attempt++) {
        await delay(STAGED_PAINT_MS);
        placeholder = await placeholderOf(view);
      }
    } finally {
      this.staged.delete(entry);
      if (!view.webContents.isDestroyed()) {
        if (!stage.isDestroyed()) stage.contentView.removeChildView(view); // closed already when the app quits
        view.setVisible(false);
        entry.visible = false;
        if (entry.view === view && entry.host && !entry.host.isDestroyed()) {
          entry.host.contentView.addChildView(view);
          if (entry.placement) view.setBounds(entry.placement.rect);
          this.viewAdded(entry.host); // cua #90: back on top of its window's views
        }
      }
      if (!stage.isDestroyed()) stage.destroy();
      if (entry.view === view) this.apply(entry);
    }
    return placeholder;
  }

  // Applies the view's visibility and reports `placedIn` and `covered` when they moved.
  private apply(entry: TabEntry, extra: Partial<BrowserTab> = {}): void {
    const { view, placement } = entry;
    const covered = placement !== null && this.coveredWindows.has(placement.window.id);
    const here = view !== null && placement !== null && entry.host === placement.window && shown(entry);
    const visible = here && (!covered || this.capturing.get(entry) === this.coverGeneration.get(placement.window.id));
    if (here && covered && !visible && !entry.tab.loading) {
      // cua #90: shown under a cover with no still taken for it yet
      const generation = this.coverGeneration.get(placement.window.id) ?? 0;
      if (this.stills.get(entry) !== generation) this.still(entry, placement.window, generation).catch((error: unknown) => console.warn('[browser] a covered page’s still failed:', error instanceof Error ? error.message : error));
    }
    if (!this.staged.has(entry)) {
      // cua #90: a view in the staging window keeps showing there; it is applied again once back in its window
      if (view && entry.visible !== visible) view.setVisible(visible);
      entry.visible = view !== null && visible;
    }
    this.applyFocusEmulation(entry);

    const placedIn = placement && { paneId: placement.paneId, surface: placement.surface };
    const patch: Partial<BrowserTab> = { ...extra };
    const was = entry.tab.placedIn;
    if (was?.paneId !== placedIn?.paneId || was?.surface !== placedIn?.surface) patch.placedIn = placedIn;
    if (entry.tab.covered !== covered) patch.covered = covered;
    if (Object.keys(patch).length > 0) this.deps.store.update(entry.tab.tabId, patch);
  }

  private applyFocusEmulation(entry: TabEntry): void {
    if (this.deps.focusEmulation !== 'on' || !entry.view) return;
    const win = entry.host;
    const wanted = entry.visible && win !== null && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
    if ((this.focusEmulated.get(entry) ?? false) === wanted) return;
    this.focusEmulated.set(entry, wanted);
    this.deps.setFocusEmulation?.(entry, wanted);
  }

  private placedIn(win: BrowserWindow): TabEntry[] {
    return this.deps.store.all().filter((entry) => entry.placement?.window === win);
  }

  private nextGeneration(win: BrowserWindow): number {
    const next = (this.coverGeneration.get(win.id) ?? 0) + 1;
    this.coverGeneration.set(win.id, next);
    return next;
  }

  private watch(win: BrowserWindow): void {
    if (this.watched.has(win)) return;
    this.watched.add(win);
    const id = win.id;
    // A reload is a main-frame, cross-document navigation to the page's own URL. Any other navigation of the app window
    // is one `will-navigate` refuses (window.ts), which Chromium starts before refusing: it must not lift a cover.
    win.webContents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument && withoutHash(details.url) === withoutHash(win.webContents.getURL())) this.reset(win);
    });
    win.webContents.on('render-process-gone', () => this.reset(win));
    win.on('close', () => this.closing(win));
    win.on('closed', () => {
      this.coveredWindows.delete(id);
      this.coverGeneration.delete(id);
    });
    for (const event of ['minimize', 'restore', 'hide', 'show'] as const) {
      win.on(event as 'minimize', () => {
        for (const entry of this.deps.store.all()) if (entry.host === win) this.applyFocusEmulation(entry);
      });
    }
  }

  // The window's renderer is gone or reloading: its cover and owners cleared, its views hidden where they are.
  private reset(win: BrowserWindow): void {
    this.coveredWindows.delete(win.id);
    this.nextGeneration(win);
    for (const entry of this.placedIn(win)) this.release(entry);
  }

  // The window closes: its views removed from it, their placements released (the tabs and pages live on).
  private closing(win: BrowserWindow): void {
    this.reset(win);
    for (const entry of this.deps.store.all()) if (entry.host === win) this.detach(entry);
  }

  // E4c start: parking (E4c execution document, Design §9; Decision Log 36, 43; spikes/browser-probe/findings-e4c-released.txt).
  // An unplaced tab the agent acts on needs a viewport: its view leaves the window a release left it hidden in (as
  // `detach` does, so `host` and `visible` stay true) and takes `bounds`. Only a size: its native visibility stays what
  // `apply` decides (hidden; Playwright's focus emulation is what the page reads as visible, measured), and parking is no
  // placement, so the owner table, `placedIn` and focus emulation are untouched. A pane's claim later attaches and sizes
  // it as for any unplaced view.
  park(entry: TabEntry, bounds: { x: number; y: number; width: number; height: number }): void {
    if (!entry.view || entry.placement) return;
    if (entry.host) this.detach(entry);
    entry.view.setBounds(bounds);
  }
  // E4c end
}

const withoutHash = (url: string) => url.split('#', 1)[0];

// Whether a tab's page holds the native focus (a page that closed itself has a destroyed webContents until its tab is
// dropped, and holds nothing).
const holdsFocus = (entry: TabEntry) => entry.view !== null && !entry.view.webContents.isDestroyed() && entry.view.webContents.isFocused();

// cua #90: how long a page on screen stays up after its still went to the pane: two frames for the pane to draw it.
const STILL_SETTLE_MS = 34;
// cua #90: a page that never painted paints in the staging window within a frame or two (measured: the first capture
// after 50 ms); a capture is tried every STAGED_PAINT_MS, STAGED_ATTEMPTS times.
const STAGED_PAINT_MS = 50;
const STAGED_ATTEMPTS = 6;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// The covered page's picture at the view's CSS size, as JPEG; null when the capture fails, is empty, or is too large.
async function placeholderOf(view: WebContentsView): Promise<string | null> {
  try {
    const image: NativeImage = await view.webContents.capturePage();
    if (image.isEmpty()) return null;
    const { width, height } = view.getBounds();
    const jpeg = image.resize({ width, height }).toJPEG(PLACEHOLDER_JPEG_QUALITY);
    if (jpeg.length > BROWSER_PLACEHOLDER_MAX_BYTES) return null;
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } catch {
    return null;
  }
}
