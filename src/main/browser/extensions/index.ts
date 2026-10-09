// The extensions action bar's side of main (cua board #90's spec, "The extensions action bar"), started from
// `startBrowser`: the actions list over each prepared partition's session (actions.ts), the popup view per window
// (popup.ts), the options tabs (pages.ts), the puzzle and context menus through the bookmarks bar's presenter, and
// `browser.extensions.*`. It follows the view manager (a page view added to a window raises its popup; the window's
// cover closes it) and the profile's removal (`removing`: its popups and options tabs closed before its tabs are). Under
// MAWS_E2E=1 the e2e reads the open popup through `seam`.
import type { BrowserWindow, WebContents } from 'electron';
import type { registerMainHandler } from '../../ipc/router';
import { importLog } from '../import/log';
import type { MenuPresenter } from '../bookmarks/menu';
import type { Partitions } from '../partition';
import type { BrowserSeam } from '../seam';
import type { BrowserEmit, TabEntry, TabStore } from '../tabs';
import type { ViewManager } from '../view';
import type { LinkTarget } from '../window-open';
import { ExtensionActions, type ActionRecord } from './actions';
import { ExtensionPages, extensionPagesRule } from './pages';
import { createPopupView, ExtensionPopups, type Rect } from './popup';
import { registerExtensionHandlers } from './register';

// The e2e's view of the open popup (globalThis.__maws_browser.extensions under MAWS_E2E=1); its page is the e2e's own
// Playwright page.
export interface ExtensionsInspector {
  popup(): { windowId: number; tabId: string; extensionId: string; url: string; bounds: Rect; visible: boolean } | null;
}

export interface ExtensionUiDeps {
  store: TabStore;
  views: Pick<ViewManager, 'onViewAdded' | 'onCovered' | 'isCovered'>;
  partitions: Pick<Partitions, 'registerPreparer' | 'registerRequestRule'>;
  leaveInternal(entry: TabEntry, url: string): void; // navigation.ts: an internal tab leaves for a web page
  records(): readonly ActionRecord[];
  menus: MenuPresenter;
  windowOf(sender: WebContents): BrowserWindow | null;
  emit: BrowserEmit;
  register: typeof registerMainHandler;
  linkTarget(): LinkTarget;
  seam: Pick<BrowserSeam, 'openExternal'>;
  env: NodeJS.ProcessEnv;
}

export interface ExtensionUi {
  removing(partition: string): void; // a profile's removal begins: its popups and options tabs close
  seam: ExtensionsInspector;
  stop(): void;
}

export function startExtensionUi({ store, views, partitions, leaveInternal, records, menus, windowOf, emit, register, linkTarget, seam, env }: ExtensionUiDeps): ExtensionUi {
  const actions = new ExtensionActions({ records, emit });
  const popups = new ExtensionPopups({
    store,
    actions,
    createView: createPopupView,
    emit,
    covered: (windowId) => views.isCovered(windowId),
    linkTarget,
    seam,
    log: (event) => importLog(event, env),
  });
  const pages = new ExtensionPages({ store, actions, emit });
  // the tab whose action shows pressed, per window: on while its popup is open, off when it closes
  const pressed = new Map<number, string>();
  const unhook = [
    partitions.registerPreparer((ses, partition) => actions.attach(ses, partition)),
    partitions.registerRequestRule(extensionPagesRule({ entryOf: (webContents) => store.entryOf(webContents), leave: leaveInternal })),
    views.onViewAdded((win) => popups.raise(win.id)),
    views.onCovered((win) => popups.close(win.id, 'cover')),
    actions.onUnloaded((partition, extensionId) => pages.close(partition, extensionId)),
    popups.state$((windowId, state) => {
      const was = pressed.get(windowId);
      if (was !== undefined) emit('browser.extensions.popup', { tabId: was, extensionId: null });
      if (state) emit('browser.extensions.popup', state);
      if (state) pressed.set(windowId, state.tabId);
      else pressed.delete(windowId);
    }),
  ];
  registerExtensionHandlers({ store, actions, popups, pages, menus, windowOf, emit, register });

  const open = () => {
    for (const { id: windowId } of openWindows()) {
      const popup = popups.current(windowId);
      if (popup) return { windowId, ...popup };
    }
    return null;
  };
  const openWindows = () => [...new Set(store.all().flatMap((entry) => (entry.placement ? [entry.placement.window] : [])))];
  return {
    removing: (partition) => {
      popups.closeAll(partition);
      pages.close(partition, null);
    },
    seam: {
      popup: () => {
        const found = open();
        if (!found || found.contents.isDestroyed()) return null;
        const { windowId, tabId, extensionId, view, contents } = found;
        const bounds = (view as unknown as Electron.WebContentsView).getBounds();
        return { windowId, tabId, extensionId, url: contents.getURL(), bounds, visible: (view as unknown as Electron.WebContentsView).getVisible() };
      },
    },
    stop: () => {
      for (const off of unhook) off();
      popups.dispose();
      actions.dispose();
    },
  };
}
