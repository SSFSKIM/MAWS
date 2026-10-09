// An extension's popup (cua board #90's spec, "The popup view"; its S1 spike found it hosts, reaches its background and
// sizes itself): a click on an action with a `default_popup` opens the page in a `WebContentsView` of the tab's own
// partition session (sandboxed, isolated, sized by `preferred-size-changed`), placed under the action's button in window
// coordinates (flipped above when it would not fit below), on top of the window's views. Like the native menus it is
// drawn by macOS above the page, so the page stays live under it and it takes no part in the cover protocol; instead it
// closes the moment the window's cover goes on (a sheet or palette freezes the page to its still, and a live popup must
// not float over that), and is raised again whenever a page view is added to its window after it (a place, a view
// created for a placed tab, a page back from the cover's staging window), which would otherwise rise above it.
//
// One popup per window, owned by the tab it was opened from. A popup holding the native focus hands it on as it closes
// (`handFocus`). It closes on its blur (a click anywhere else, the window
// losing the focus), Esc in its page or its page's own `window.close()` (an extension's usual way to dismiss its popup,
// which destroys the view's webContents), a second click on the same action, its tab leaving the pane it was opened in (the
// pane showing another tab, the tab moving to another surface, the tab closing), the cover, its extension unloading, its
// page failing to load or crashing (the chrome's notice names the extension), or its window closing. It is destroyed,
// never hidden: its page runs again at every open, as in Chrome. A click on the same action that arrives right after the
// popup closed on its blur is that blur's own click (the mouse down took the focus first) and leaves it closed.
//
// The popup's page may move between its own extension's pages. Its `window.open` and its navigations to the web are
// links: after an activation in the popup within WINDOW_OPEN_INPUT_MS (the page's own rule) an http(s) URL opens as a new
// unselected tab of the tab's session and partition, or in the system browser under `linkTarget: 'external'`; anything
// else is refused and only logged, by scheme (the popup has no chrome to tell it in).
import { WebContentsView, type BrowserWindow, type Input, type MouseInputEvent, type WebContents } from 'electron';
import { EXTENSION_POPUP_MAX, EXTENSION_POPUP_MIN } from '@shared/browser/extensions';
import { validateBrowserUrl } from '@shared/browser/url';
import type { ImportLogEvent } from '../import/log';
import type { BrowserSeam } from '../seam';
import type { BrowserEmit, TabEntry, TabStore } from '../tabs';
import { activationAllows, WINDOW_OPEN_INPUT_MS, type LinkTarget } from '../window-open';
import type { ExtensionActions } from './actions';

export type PopupCloseReason = 'blur' | 'escape' | 'toggle' | 'tab' | 'cover' | 'unload' | 'load-failed' | 'window';
export type Rect = { x: number; y: number; width: number; height: number };
export type PopupState = { tabId: string; extensionId: string } | null;

// How soon after its blur closed a popup a click on the same action is that blur's own click.
export const POPUP_REOPEN_GUARD_MS = 400;

// The popup's box: its preferred size within Chrome's bounds and the window, under the anchor with its right edge on the
// anchor's (the action buttons sit at the row's right), moved into the window, above the anchor when it would not fit
// below, and when it fits neither, as low as the window allows.
export function popupBounds(anchor: Rect, preferred: { width: number; height: number }, content: { width: number; height: number }): Rect {
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const width = Math.min(clamp(Math.round(preferred.width), EXTENSION_POPUP_MIN.width, EXTENSION_POPUP_MAX.width), content.width);
  const height = Math.min(clamp(Math.round(preferred.height), EXTENSION_POPUP_MIN.height, EXTENSION_POPUP_MAX.height), content.height);
  const x = clamp(anchor.x + anchor.width - width, 0, content.width - width);
  const below = anchor.y + anchor.height;
  const y = below + height <= content.height ? below : anchor.y - height >= 0 ? anchor.y - height : Math.max(0, content.height - height);
  return { x, y, width, height };
}

// The popup's view in the partition's session: MAWS's tab preferences (sandboxed, isolated, no Node) and the preferred
// size the page lays out at.
export function createPopupView(partition: string): WebContentsView {
  return new WebContentsView({
    webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, enablePreferredSizeMode: true },
  });
}

type View = Pick<WebContentsView, 'setBounds'> & { webContents: WebContents };
type Window = Pick<BrowserWindow, 'id' | 'isDestroyed' | 'getContentSize' | 'on' | 'off'> & {
  contentView: Pick<BrowserWindow['contentView'], 'addChildView' | 'removeChildView'>;
  webContents: Pick<WebContents, 'focus' | 'isDestroyed'>;
};

interface Popup {
  entry: TabEntry;
  tabId: string;
  paneId: string;
  partition: string;
  extensionId: string;
  name: string;
  origin: string; // the extension's own pages: `chrome-extension://<id>`
  view: View;
  contents: WebContents; // the view's, kept: Electron drops `view.webContents` once the page closed itself
  window: Window;
  anchor: Rect;
  focused: boolean;
  lastActivationAt: number | null;
  opens: number[];
  unhook(): void;
}

export interface ExtensionPopupsDeps {
  store: Pick<TabStore, 'entry' | 'open' | 'onUpdated' | 'onViewDestroying'>;
  actions: Pick<ExtensionActions, 'find' | 'onUnloaded'>;
  createView(partition: string): WebContentsView;
  emit: BrowserEmit;
  covered(windowId: number): boolean; // a layer covers the window now
  linkTarget(): LinkTarget;
  seam: Pick<BrowserSeam, 'openExternal'>;
  log(event: ImportLogEvent): void;
  now?(): number;
}

export class ExtensionPopups {
  private readonly popups = new Map<number, Popup>();
  private readonly blurred = new Map<number, { tabId: string; extensionId: string; at: number }>();
  private readonly listeners = new Set<(windowId: number, state: PopupState) => void>();
  private readonly unhook: (() => void)[];
  private readonly now: () => number;

  constructor(private readonly deps: ExtensionPopupsDeps) {
    this.now = deps.now ?? Date.now;
    const { store, actions } = deps;
    this.unhook = [
      store.onUpdated((entry) => {
        for (const [windowId, popup] of this.popups) {
          if (popup.entry !== entry) continue;
          const { placement } = entry;
          if (placement === null || placement.window !== (popup.window as unknown) || placement.paneId !== popup.paneId) this.close(windowId, 'tab');
        }
      }),
      store.onViewDestroying((entry) => {
        for (const [windowId, popup] of this.popups) if (popup.entry === entry) this.close(windowId, 'tab');
      }),
      actions.onUnloaded((partition, extensionId) => {
        for (const [windowId, popup] of this.popups) if (popup.partition === partition && popup.extensionId === extensionId) this.close(windowId, 'unload');
      }),
    ];
  }

  // The action's popup for the tab, in the tab's window under `anchor`; that window's popup closed first. A second click
  // on the same action closes it instead.
  open(entry: TabEntry, extensionId: string, anchor: Rect): void {
    const window = entry.placement?.window as Window | undefined;
    if (!window || window.isDestroyed() || this.deps.covered(window.id)) return;
    const { tabId, partition } = entry.tab;
    const open = this.popups.get(window.id);
    if (open && open.tabId === tabId && open.extensionId === extensionId) return this.close(window.id, 'toggle');
    const blurred = this.blurred.get(window.id);
    this.blurred.delete(window.id);
    if (!open && blurred && blurred.tabId === tabId && blurred.extensionId === extensionId && this.now() - blurred.at < POPUP_REOPEN_GUARD_MS) return;
    const action = this.deps.actions.find(partition, extensionId);
    if (!action?.popupUrl) return;
    if (open) this.close(window.id, 'toggle');

    // shown at once at Chrome's minimum under the button, as Chrome opens one: a hidden view never lays its page out, so
    // it would never report the size it wants
    const view = this.deps.createView(partition) as unknown as View;
    const popup: Popup = {
      entry,
      tabId,
      paneId: entry.placement!.paneId,
      partition,
      extensionId,
      name: action.name,
      origin: new URL(action.popupUrl).host,
      view,
      contents: view.webContents,
      window,
      anchor,
      focused: false,
      lastActivationAt: null,
      opens: [],
      unhook: () => {},
    };
    this.popups.set(window.id, popup);
    window.contentView.addChildView(view as unknown as WebContentsView);
    view.setBounds(popupBounds(anchor, EXTENSION_POPUP_MIN, contentSize(window)));
    this.wire(popup);
    this.tell(window.id, { tabId, extensionId });
    view.webContents.loadURL(action.popupUrl).catch(() => {}); // a failure arrives as did-fail-load
  }

  close(windowId: number, reason: PopupCloseReason): void {
    const popup = this.popups.get(windowId);
    if (!popup) return;
    this.popups.delete(windowId);
    popup.unhook();
    // a popup that held the native focus hands it on before it goes, or the keys reach nothing until a click
    if (popup.focused && (popup.contents.isDestroyed() || popup.contents.isFocused())) this.handFocus(popup, reason);
    if (reason === 'blur') this.blurred.set(windowId, { tabId: popup.tabId, extensionId: popup.extensionId, at: this.now() });
    if (!popup.window.isDestroyed()) popup.window.contentView.removeChildView(popup.view as unknown as WebContentsView);
    if (!popup.contents.isDestroyed()) popup.contents.close();
    if (reason === 'load-failed') this.deps.emit('browser.notice', { appSessionId: popup.entry.tab.appSessionId, tabId: popup.tabId, kind: 'extensionPopupFailed', name: popup.name });
    this.tell(windowId, null);
  }

  // Where the focus goes from a closing popup that held it: the app's own page when a layer covers the window (the palette
  // or sheet takes the keys) or anything else closed it from outside; the originating tab's page when the person
  // dismissed it (Esc, its own window.close(), a second click), as in Chrome; nowhere when the window itself closes.
  private handFocus(popup: Popup, reason: PopupCloseReason): void {
    if (reason === 'window' || popup.window.isDestroyed()) return;
    const page = popup.entry.view?.webContents;
    const toPage = (reason === 'escape' || reason === 'toggle') && this.deps.store.entry(popup.tabId) === popup.entry && page && !page.isDestroyed();
    if (toPage) page.focus();
    else if (!popup.window.webContents.isDestroyed()) popup.window.webContents.focus();
  }

  // A profile's removal: its popups closed in every window.
  closeAll(partition: string): void {
    for (const [windowId, popup] of [...this.popups]) if (popup.partition === partition) this.close(windowId, 'unload');
  }

  // A page view was added to the window after the popup: the popup goes back on top (Electron's `addChildView` of a
  // child it already holds moves it to the top).
  raise(windowId: number): void {
    const popup = this.popups.get(windowId);
    if (popup && !popup.window.isDestroyed()) popup.window.contentView.addChildView(popup.view as unknown as WebContentsView);
  }

  current(windowId: number): { tabId: string; extensionId: string; view: View; contents: WebContents } | null {
    const popup = this.popups.get(windowId);
    return popup ? { tabId: popup.tabId, extensionId: popup.extensionId, view: popup.view, contents: popup.contents } : null;
  }

  state$(listener: (windowId: number, state: PopupState) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  dispose(): void {
    for (const windowId of [...this.popups.keys()]) this.close(windowId, 'window');
    for (const unhook of this.unhook) unhook();
  }

  // ---- internals ------------------------------------------------------------------------------------------------------

  private tell(windowId: number, state: PopupState): void {
    for (const listener of [...this.listeners]) listener(windowId, state);
  }

  private wire(popup: Popup): void {
    const { view, window, contents: wc } = popup;
    const live = () => this.popups.get(window.id) === popup;
    const closing = (reason: PopupCloseReason) => () => {
      if (live()) this.close(window.id, reason);
    };
    // every layout's size, not only the first (S1: the first event is the page's first layout, later ones its growth)
    wc.on('preferred-size-changed', (_event, size) => {
      if (live() && !window.isDestroyed()) view.setBounds(popupBounds(popup.anchor, size, contentSize(window)));
    });
    wc.once('did-finish-load', () => {
      if (live()) wc.focus(); // the popup takes the keyboard (its Esc, its fields), and its blur closes it
    });
    wc.on('focus', () => void (popup.focused = true));
    wc.on('blur', () => {
      if (live() && popup.focused) this.close(window.id, 'blur');
    });
    wc.on('before-input-event', (event: Electron.Event, input: Input) => {
      if (!live() || input.type !== 'keyDown') return;
      if (input.key === 'Escape') {
        event.preventDefault();
        return this.close(window.id, 'escape');
      }
      popup.lastActivationAt = this.now();
    });
    wc.on('before-mouse-event', (_event: Electron.Event, mouse: MouseInputEvent) => {
      if (live() && mouse.type === 'mouseDown') popup.lastActivationAt = this.now();
    });
    wc.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) closing('load-failed')();
    });
    wc.on('render-process-gone', closing('load-failed'));
    wc.once('destroyed', closing('escape')); // the page's own window.close(): dismissed from inside, as Esc does
    wc.setWindowOpenHandler(({ url }) => {
      if (live()) this.link(popup, url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (event) => {
      if (ownPage(event.url, popup.origin)) return;
      event.preventDefault();
      if (live()) this.link(popup, event.url);
    });
    const windowClosed = closing('window');
    const windowBlurred = closing('blur');
    window.on('closed', windowClosed);
    window.on('blur', windowBlurred);
    popup.unhook = () => {
      if (window.isDestroyed()) return;
      window.off('closed', windowClosed);
      window.off('blur', windowBlurred);
    };
  }

  // A link out of the popup: a new unselected tab of the tab's session and partition (or the system browser), after an
  // activation in the popup; anything else refused, by scheme.
  private link(popup: Popup, url: string): void {
    const checked = validateBrowserUrl(url);
    const scheme = schemeOf(url);
    if (!checked.ok) return this.deps.log({ kind: 'popupRefused', id: popup.extensionId, reason: 'scheme', scheme });
    const at = this.now();
    popup.opens = popup.opens.filter((when) => at - when < WINDOW_OPEN_INPUT_MS);
    if (!activationAllows(at, popup.lastActivationAt, popup.opens)) return this.deps.log({ kind: 'popupRefused', id: popup.extensionId, reason: 'activation', scheme });
    popup.opens.push(at);
    if (this.deps.linkTarget() === 'external') return this.deps.seam.openExternal(checked.url);
    const { appSessionId, partition } = popup.entry.tab;
    if (this.deps.store.entry(popup.tabId) !== popup.entry) return;
    this.deps.store.open({ appSessionId, url: checked.url, select: false, partition });
  }
}

const contentSize = (window: Window) => {
  const [width = 0, height = 0] = window.getContentSize();
  return { width, height };
};

// Whether a URL is one of the popup's own extension's pages.
function ownPage(url: string, host: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'chrome-extension:' && parsed.host === host;
  } catch {
    return false;
  }
}

function schemeOf(url: string): string {
  return /^([a-z][a-z0-9+.-]*:)/i.exec(url)?.[1]?.toLowerCase() ?? '';
}
