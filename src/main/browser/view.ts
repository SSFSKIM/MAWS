// The browser's views (E4a execution document, Design §3; A-33's placement and cover protocol as E4-0 measured it): one
// `WebContentsView` per loaded tab, created in the tab's partition with the browser preload (sandboxed, isolated, no
// Node), and laid over the pane that owns it.
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
// then captures each hidden page as the placeholder the pane draws under the layer: hidden first, so the layer never
// paints over a still-visible page during the 5 ms capture, which works while hidden.
//
// A view shows only while its tab is placed, its window uncovered, and the tab has a committed page of its own (not
// suspended, no load error, not crashed, not failed): the renderer draws those states in the pane instead.
//
// The app window's own renderer reloading (⌘R) or crashing resets that window: its cover cleared, its owners released,
// their views hidden; the fresh renderer's panes claim again on mount. A closing window gives its views up; the tabs
// live on, unplaced.
import { join } from 'node:path';
import { WebContentsView, type BrowserWindow, type NativeImage, type WebContents } from 'electron';
import { BROWSER_PLACEHOLDER_MAX_BYTES, type BrowserTab } from '@shared/browser/tab';
import type { CommandInput } from '@shared/ipc/schema';
import type { Partitions } from './partition';
import type { BrowserEmit, TabEntry, TabStore } from './tabs';
import type { FocusEmulationMode } from './visibility';

// out/preload/browser.js beside the app window's out/preload/index.js (main is bundled into out/main/index.js).
export const BROWSER_PRELOAD = join(__dirname, '../preload/browser.js');
const PLACEHOLDER_JPEG_QUALITY = 80;

export function createTabView(partitions: Pick<Partitions, 'session'>, preload = BROWSER_PRELOAD): (tab: BrowserTab) => WebContentsView {
  return (tab) => {
    partitions.session(tab.partition); // prepared before its first page loads
    return new WebContentsView({
      webPreferences: {
        partition: tab.partition,
        preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: true,
      },
    });
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
      if (owns) {
        entry.placement = null;
        this.apply(entry);
      }
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
    this.apply(entry, owns ? {} : { lastShownAt: new Date(this.now()).toISOString() });
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
      for (const entry of placed) this.apply(entry);
      return;
    }
    if (this.coveredWindows.has(win.id)) return;
    const generation = this.nextGeneration(win);
    const hiding = placed.filter((entry) => entry.visible);
    if (hiding.some((entry) => entry.view!.webContents.isFocused())) win.webContents.focus();
    this.coveredWindows.add(win.id);
    for (const entry of placed) this.apply(entry);
    await Promise.all(
      hiding.map(async (entry) => {
        const view = entry.view!;
        const placeholder = await placeholderOf(view);
        const current = this.coverGeneration.get(win.id) === generation && this.deps.store.entry(entry.tab.tabId) === entry && entry.view === view;
        if (current) this.deps.emit('browser.view.covered', { tabId: entry.tab.tabId, placeholder });
      }),
    );
  }

  dispose(): void {
    for (const unhook of this.unhook) unhook();
  }

  // ---- internals ------------------------------------------------------------------------------------------------------

  // Puts the view in its owner's window at its owner's rect (no-op without a view or an owner).
  private attach(entry: TabEntry): void {
    const { view, placement } = entry;
    if (!view || !placement) return;
    if (entry.host !== placement.window) {
      this.detach(entry);
      placement.window.contentView.addChildView(view);
      entry.host = placement.window;
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

  // Applies the view's visibility and reports `placedIn` and `covered` when they moved.
  private apply(entry: TabEntry, extra: Partial<BrowserTab> = {}): void {
    const { view, placement } = entry;
    const covered = placement !== null && this.coveredWindows.has(placement.window.id);
    const visible = view !== null && placement !== null && entry.host === placement.window && !covered && shown(entry);
    if (view && entry.visible !== visible) view.setVisible(visible);
    entry.visible = view !== null && visible;
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
    for (const entry of this.placedIn(win)) {
      entry.placement = null;
      this.apply(entry);
    }
  }

  // The window closes: its views removed from it, their placements released (the tabs and pages live on).
  private closing(win: BrowserWindow): void {
    this.reset(win);
    for (const entry of this.deps.store.all()) if (entry.host === win) this.detach(entry);
  }
}

const withoutHash = (url: string) => url.split('#', 1)[0];

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
