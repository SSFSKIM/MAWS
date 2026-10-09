// Main's handlers for `browser.*` (E4a execution document, Interfaces "IPC `browser.*`"). Every input has passed its
// schema before a handler runs (every URL http or https, every tab id `b_` plus twelve hex characters), and only the app
// window's top frame can invoke these (the router's `isAppSender`), so a page in a view never reaches them. A tab id
// main does not know answers `invalid_input` ("unknown browser tab").
import { BOOKMARK_SUGGESTIONS_MAX } from '@shared/browser/bookmarks';
import { BROWSER_SUGGESTIONS_MAX } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { ipcError } from '@shared/ipc/errors';
import type { CommandName } from '@shared/ipc/schema';
import type { BrowserWindow, WebContents } from 'electron';
import type { BrowserBookmarksStore } from '../index/browser-bookmarks';
import type { BrowserHistoryStore, BrowserSuggestion } from '../index/browser-history';
import { CommandFailure, type MainHandler, type registerMainHandler } from '../ipc/router';
import type { Navigator } from './navigation';
import type { Downloads } from './downloads';
import type { BrowserProfile } from './partition';
import { UnknownTabError, type TabStore } from './tabs';
import type { ViewManager } from './view';
// cua #90 start
import { UnknownBookmarkError, type BookmarkBar } from './bookmarks/bar';
import type { Favicons } from './favicon';
// cua #90 end

export interface BrowserHandlerDeps {
  store: TabStore;
  views: Pick<ViewManager, 'place' | 'cover'>;
  navigator: Pick<Navigator, 'navigate' | 'zoom' | 'find' | 'dismiss' | 'devtools'>;
  downloads: Pick<Downloads, 'reveal'>;
  history: Pick<BrowserHistoryStore, 'suggest'>;
  bookmarks: Pick<BrowserBookmarksStore, 'suggest'>; // cua #90: an imported profile's bookmarks, suggested first
  // cua #90 start: the bookmarks bar's chips and menus, the sender's app window (where a menu pops), the bar's icons
  bar: Pick<BookmarkBar, 'open' | 'menu'>;
  windowOf(sender: WebContents): BrowserWindow | null;
  favicons: Pick<Favicons, 'forOrigins'>;
  // cua #90 end
  profiles(): BrowserProfile[];
  register: typeof registerMainHandler;
}

// A handler whose unknown tab is the caller's mistake, not main's fault.
function knownTabs<N extends CommandName>(handler: MainHandler<N>): MainHandler<N> {
  return (input, context) => {
    try {
      return handler(input, context);
    } catch (error) {
      if (error instanceof UnknownTabError || error instanceof UnknownBookmarkError /* cua #90 */) throw new CommandFailure(ipcError('invalid_input', error.message));
      throw error;
    }
  };
}

const session = (id: string) => id as AppSessionId; // the schema checked it; the wire carries no brand

// cua #90: the address field's rows, the partition's matching bookmarks first (at most BOOKMARK_SUGGESTIONS_MAX), then
// its history rows to BROWSER_SUGGESTIONS_MAX in all; a URL that is both is shown once, as the bookmark.
export function mergeSuggestions(
  bookmarks: readonly BrowserSuggestion[],
  history: readonly BrowserSuggestion[],
  max = BROWSER_SUGGESTIONS_MAX,
): (BrowserSuggestion & { kind: 'history' | 'bookmark' })[] {
  const marked = bookmarks.slice(0, BOOKMARK_SUGGESTIONS_MAX).map((row) => ({ url: row.url, title: row.title, kind: 'bookmark' as const }));
  const shown = new Set(marked.map((row) => row.url));
  const rest = history.filter((row) => !shown.has(row.url)).slice(0, max - marked.length).map((row) => ({ url: row.url, title: row.title, kind: 'history' as const }));
  return [...marked, ...rest];
}

// A store's suggestions, or none when it fails: the field still navigates (E4a Design §15).
function suggestionsOr(read: () => BrowserSuggestion[], what: string): BrowserSuggestion[] {
  try {
    return read();
  } catch (error) {
    console.warn(`[browser] ${what} suggestions failed:`, error instanceof Error ? error.message : error);
    return [];
  }
}

export function registerBrowserHandlers({ store, views, navigator, downloads, history, bookmarks, bar, windowOf, favicons, profiles, register }: BrowserHandlerDeps): void {
  register('browser.tabs.list', ({ appSessionId }) => store.list(appSessionId === undefined ? undefined : session(appSessionId)));
  register('browser.tabs.open', (request) => store.open({ ...request, appSessionId: session(request.appSessionId) }));
  register('browser.tabs.close', knownTabs(({ tabId }) => store.close(tabId)));
  register('browser.tabs.select', knownTabs(({ appSessionId, tabId }) => store.select(session(appSessionId), tabId)));
  register('browser.tabs.navigate', knownTabs(({ tabId, to }) => ({ accepted: navigator.navigate(tabId, to) })));
  register('browser.tabs.zoom', knownTabs(({ tabId, action }) => ({ zoom: navigator.zoom(tabId, action) })));
  register('browser.tabs.find', knownTabs(({ tabId, ...request }) => navigator.find(tabId, request)));
  register('browser.tabs.dismiss', knownTabs(({ tabId, notice }) => navigator.dismiss(tabId, notice)));
  register('browser.tabs.devtools', knownTabs(({ tabId }) => navigator.devtools(tabId)));
  register('browser.tabs.revealDownload', knownTabs(({ tabId }) => downloads.reveal(tabId)));
  // The address field's suggestions; a failing index suggests nothing and the field still navigates (Design §15). cua #90:
  // the partition's bookmarks first, each store failing alone.
  register('browser.history.suggest', ({ partition, query }) => ({
    suggestions: mergeSuggestions(
      suggestionsOr(() => bookmarks.suggest(partition, query, BOOKMARK_SUGGESTIONS_MAX), 'bookmark'),
      suggestionsOr(() => history.suggest(partition, query), 'history'),
    ),
  }));
  register('browser.profiles.list', () => ({ profiles: profiles().map(({ profileDir, name }) => ({ profileDir, name })) }));
  // The sender's window places and covers; the cover answers at once, its placeholders follow as browser.view.covered.
  register('browser.view.place', knownTabs((input, { sender }) => views.place(input, sender)));
  register('browser.view.cover', ({ covered }, { sender }) => {
    views.cover(covered, sender).catch((error: unknown) => console.error('[browser] the cover failed:', error));
  });
  // The chrome's Hand back: the page returns to idle from any state (E4c moves it everywhere else).
  register('browser.control.handBack', knownTabs(({ tabId }) => store.setControl(tabId, 'idle')));
  // cua #90 start: the bookmarks bar (bookmarks/bar.ts): a chip's click, a native menu on the sender's window, the icons
  register('browser.bookmarks.open', knownTabs(({ tabId, nodeId, how }) => bar.open(tabId, nodeId, how)));
  register(
    'browser.bookmarks.menu',
    knownTabs(({ tabId, request, anchor }, { sender }) => {
      const window = windowOf(sender);
      if (window) bar.menu(tabId, request, anchor, window);
    }),
  );
  register('browser.bookmarks.favicons', ({ partition, origins }) => ({ icons: favicons.forOrigins(partition, origins) }));
  // cua #90 end
}
