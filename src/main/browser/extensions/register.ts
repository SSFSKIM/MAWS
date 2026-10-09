// Main's handlers for `browser.extensions.*` (cua board #90's spec, Interfaces "Extensions"). Only the app window's top
// frame reaches them (the router's `isAppSender`), every input past its strict schema. A tab-scoped command acts on the
// tab it names: the extension is looked up in that tab's partition only, the popup opens in that tab's window, the
// options tab in its session, and a menu pops on the sender's window. A tab main does not know, or an extension not
// loaded in the tab's partition, answers `invalid_input`; an action with no popup is inert and answers nothing.
import type { BrowserWindow, WebContents } from 'electron';
import { ipcError } from '@shared/ipc/errors';
import type { CommandName } from '@shared/ipc/schema';
import type { MenuPresenter } from '../bookmarks/menu';
import { CommandFailure, type MainHandler, type registerMainHandler } from '../../ipc/router';
import { UnknownTabError, type BrowserEmit, type TabEntry, type TabStore } from '../tabs';
import type { ExtensionActions } from './actions';
import { actionMenu, puzzleMenu, type ExtensionMenuActions } from './menu';
import { UnknownExtensionError, type ExtensionPages } from './pages';
import type { ExtensionPopups, Rect } from './popup';

export interface ExtensionHandlerDeps {
  store: Pick<TabStore, 'require'>;
  actions: Pick<ExtensionActions, 'list' | 'find' | 'entries'>;
  popups: Pick<ExtensionPopups, 'open'>;
  pages: Pick<ExtensionPages, 'openOptions'>;
  menus: MenuPresenter;
  windowOf(sender: WebContents): BrowserWindow | null;
  emit: BrowserEmit;
  register: typeof registerMainHandler;
}

// A handler whose unknown tab or extension is the caller's mistake, not main's fault.
function known<N extends CommandName>(handler: MainHandler<N>): MainHandler<N> {
  return (input, context) => {
    try {
      return handler(input, context);
    } catch (error) {
      if (error instanceof UnknownTabError || error instanceof UnknownExtensionError) throw new CommandFailure(ipcError('invalid_input', error.message));
      throw error;
    }
  };
}

export function registerExtensionHandlers({ store, actions, popups, pages, menus, windowOf, emit, register }: ExtensionHandlerDeps): void {
  const loaded = (entry: TabEntry, extensionId: string) => {
    const action = actions.find(entry.tab.partition, extensionId);
    if (!action) throw new UnknownExtensionError(extensionId);
    return action;
  };
  // What a menu's items do for the tab it was popped for (a choice made after the tab closed does nothing).
  const menuActions = (tabId: string, anchor: Rect): ExtensionMenuActions => ({
    open: (extensionId) => {
      try {
        popups.open(store.require(tabId), extensionId, anchor);
      } catch (error) {
        if (!(error instanceof UnknownTabError)) throw error;
      }
    },
    options: (extensionId) => {
      try {
        const tab = pages.openOptions(tabId, extensionId);
        if (tab) emit('browser.extensions.reveal', { tabId, show: { kind: 'tab', tab } });
      } catch (error) {
        if (!(error instanceof UnknownTabError || error instanceof UnknownExtensionError)) throw error;
      }
    },
    manage: () => void emit('browser.extensions.reveal', { tabId, show: { kind: 'settings' } }),
  });

  register('browser.extensions.actions', async ({ partition }) => ({ actions: await actions.list(partition) }));
  register(
    'browser.extensions.action.click',
    known(({ tabId, extensionId, anchor }) => {
      const entry = store.require(tabId);
      if (loaded(entry, extensionId).hasPopup) popups.open(entry, extensionId, anchor);
    }),
  );
  register(
    'browser.extensions.action.options',
    known(({ tabId, extensionId }) => {
      const tab = pages.openOptions(tabId, extensionId);
      if (tab) emit('browser.extensions.reveal', { tabId, show: { kind: 'tab', tab } });
    }),
  );
  register(
    'browser.extensions.action.menu',
    known(({ tabId, extensionId, anchor }, { sender }) => {
      const action = loaded(store.require(tabId), extensionId);
      const window = windowOf(sender);
      if (window) menus.present(actionMenu(action, menuActions(tabId, { ...anchor, width: 0, height: 0 })), { window, x: anchor.x, y: anchor.y });
    }),
  );
  register(
    'browser.extensions.puzzle',
    known(({ tabId, anchor }, { sender }) => {
      const entry = store.require(tabId);
      const window = windowOf(sender);
      if (window) menus.present(puzzleMenu(actions.entries(entry.tab.partition), menuActions(tabId, anchor)), { window, x: anchor.x, y: anchor.y + anchor.height });
    }),
  );
}
