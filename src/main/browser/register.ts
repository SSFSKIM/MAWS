// Main's handlers for `browser.*` (E4a execution document, Interfaces "IPC `browser.*`"). Every input has passed its
// schema before a handler runs (every URL http or https, every tab id `b_` plus twelve hex characters), and only the app
// window's top frame can invoke these (the router's `isAppSender`), so a page in a view never reaches them. A tab id
// main does not know answers `invalid_input` ("unknown browser tab").
import { BOOKMARK_SUGGESTIONS_MAX } from '@shared/browser/bookmarks';
import { BROWSER_SUGGESTIONS_MAX, type BrowserTab } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { ipcError } from '@shared/ipc/errors';
import type { CommandName } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import type { BrowserWindow, NativeImage, WebContents } from 'electron';
import type { BrowserBookmarksStore } from './data/bookmarks';
import type { BrowserHistoryStore, BrowserSuggestion } from './data/history';
import { pageOf } from '../ipc/clients';
import { CommandFailure, type MainHandler, type registerMainHandler } from '../ipc/router';
import type { Navigator } from './navigation';
import type { Downloads } from './downloads';
import type { ForwardedTabs } from './forwarded';
import type { SessionMachines } from './machines';
import type { BrowserProfile } from './partition';
import { UnknownTabError, type TabStore } from './tabs';
import { shown, type ViewManager } from './view';
import { captureTabView, copyTabScreenshot } from './capture'; // P3-G; U12a: copyTabScreenshot
import { agentTabComesForward } from './agent/control'; // U12a
// cua #90 start
import { UnknownBookmarkError, type BookmarkBar } from './bookmarks/bar';
import type { Favicons } from './favicon';
import type { ProfileAvatars } from './profile-avatars';
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
  avatars: Pick<ProfileAvatars, 'list'>; // the profiles list's names and avatars
  // cua #90 end
  profiles(): BrowserProfile[];
  register: typeof registerMainHandler;
  // P5 O7 M3: a session of another machine's tabs (machines.ts), and a tab opened at a forward's listener (forwarded.ts)
  sessions?: Pick<SessionMachines, 'keyOf' | 'machineOf' | 'bareOf'>;
  forwarded?: Pick<ForwardedTabs, 'opened'>;
  now?(): number; // U12a: the clock `browser.agent.show` reads the person's input against
  writeImage(image: NativeImage): Promise<void>; // U12a: Copy screenshot's write, to this Mac's clipboard
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

export function registerBrowserHandlers({ store, views, navigator, downloads, history, bookmarks, bar, windowOf, favicons, avatars, profiles, register, sessions, forwarded, now = Date.now, writeImage }: BrowserHandlerDeps): void {
  // P5 O7 M3: the three that name a session are answered for a session of any machine (the router's
  // BROWSER_TOOL_HERE_FOR_ANY_MACHINE): the store keys it by its session key (machines.ts: the bare id here, the address
  // for another machine's), and the answer says the bare id again for the invoke's machine; a list of every session is
  // that machine's sessions only, since the answer is lifted with it
  const keyOf = (bare: string, target: MachineRef) => (sessions ? sessions.keyOf(session(bare), target) : session(bare));
  const said = (tab: BrowserTab): BrowserTab => (sessions ? { ...tab, appSessionId: sessions.bareOf(tab.appSessionId) } : tab);
  register('browser.tabs.list', ({ appSessionId }, { target }) => {
    const listed = store.list(appSessionId === undefined ? undefined : keyOf(appSessionId, target));
    if (sessions === undefined) return listed;
    const mine = (key: string) => sessions.machineOf(key) === target;
    return {
      tabs: listed.tabs.filter((tab) => mine(tab.appSessionId)).map(said),
      selected: Object.fromEntries(Object.entries(listed.selected).flatMap(([key, tabId]) => (mine(key) ? [[sessions.bareOf(key), tabId]] : []))),
    };
  });
  register('browser.tabs.open', (request, { target }) => {
    const opened = store.open({ ...request, appSessionId: keyOf(request.appSessionId, target) });
    forwarded?.opened(opened.tab);
    return { ...opened, tab: said(store.entry(opened.tab.tabId)?.tab ?? opened.tab) };
  });
  register('browser.tabs.close', knownTabs(({ tabId }) => store.close(tabId)));
  // the tab must be the session's, on the invoke's machine (the store refuses another key's tab as unknown)
  register('browser.tabs.select', knownTabs(({ appSessionId, tabId }, { target }) => store.select(keyOf(appSessionId, target), tabId)));
  register('browser.tabs.navigate', knownTabs(({ tabId, to }) => ({ accepted: navigator.navigate(tabId, to) })));
  register('browser.tabs.zoom', knownTabs(({ tabId, action }) => ({ zoom: navigator.zoom(tabId, action) })));
  // U12a (Interfaces §D, §K): the tab's device size, from any window by tab id, as zoom; an extension's options tab has none
  register('browser.tabs.setViewport', knownTabs(({ tabId, viewport }) => {
    if (!store.setViewport(tabId, viewport)) throw new CommandFailure(ipcError('invalid_input', `browser tab ${tabId} is an extension's page, which has no device size`));
  }));
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
  register('browser.profiles.list', () => ({ profiles: avatars.list(profiles()) })); // cua #90: with the names and the avatar
  // The sender's window places and covers; the placeholders go out as browser.view.covered. The cover answers once the
  // view manager settles it, every shown page's still sent and the page hidden (P3-F L128), so the renderer's
  // `coverAcknowledged` is a full barrier: Mark up never draws its overlay while the live page can still draw over it.
  // A failed cover is logged and still answered.
  register('browser.view.place', knownTabs((input, { client }) => {
    const page = pageOf(client);
    if (page) views.place(input, page);
  }));
  register('browser.view.cover', async ({ covered }, { client }) => {
    const page = pageOf(client);
    if (page) await views.cover(covered, page).catch((error: unknown) => console.error('[browser] the cover failed:', error));
  });
  // P3-G (§D4.1): Mark-up's still of the page, for the window the tab is placed in only (capture.ts)
  register(
    'browser.view.capture',
    knownTabs(({ tabId }, { client }) => {
      const entry = store.require(tabId);
      const contents = entry.view?.webContents ?? null;
      const page = pageOf(client);
      return captureTabView({ tabId, window: entry.placement?.window ?? null, shown: shown(entry), contents }, page && windowOf(page));
    }),
  );
  // U12a (Interfaces §D, §K): Copy screenshot, under the same rule, written whole to the clipboard here (capture.ts)
  register(
    'browser.view.copyScreenshot',
    knownTabs(({ tabId }, { client }) => {
      const entry = store.require(tabId);
      const contents = entry.view?.webContents ?? null;
      const page = pageOf(client);
      return copyTabScreenshot({ tabId, window: entry.placement?.window ?? null, shown: shown(entry), contents }, page && windowOf(page), writeImage);
    }),
  );
  // The chrome's Hand back: the page returns to idle from any state (E4c moves it everywhere else).
  register('browser.control.handBack', knownTabs(({ tabId }) => store.setControl(tabId, 'idle')));
  // U12a (Interfaces §C; ruling R2, and the branch review's rulings 5 and 7): the window about to open the Browser by
  // itself asks for the acting tab. The session is the tab's own (a side thread's acting tab is its parent's), and the tab
  // is selected there when `agentTabComesForward` says so; the answer is the session's selected tab then, whole, so the
  // window lists that selection before its panel mounts (main's own notice follows on a later task). The only selection
  // made for the agent: cua's acting command selects nothing (cua/connection.ts).
  register('browser.agent.show', knownTabs(({ tabId }) => {
    const acting = store.require(tabId);
    const { appSessionId } = acting.tab;
    const selectedOf = () => {
      const id = store.list(appSessionId).selected[appSessionId] ?? null;
      return id === null ? null : (store.entry(id) ?? null);
    };
    const sessionTabs = store.all().filter((entry) => entry.tab.appSessionId === appSessionId);
    if (agentTabComesForward(selectedOf(), acting, now(), sessionTabs)) store.select(appSessionId, tabId);
    return { selected: selectedOf()?.tab ?? null };
  }));
  // cua #90 start: the bookmarks bar (bookmarks/bar.ts): a chip's click, a native menu on the sender's window, the icons
  register('browser.bookmarks.open', knownTabs(({ tabId, nodeId, how }) => bar.open(tabId, nodeId, how)));
  register(
    'browser.bookmarks.menu',
    knownTabs(({ tabId, request, anchor }, { client }) => {
      const page = pageOf(client);
      const window = page && windowOf(page);
      if (window) bar.menu(tabId, request, anchor, window);
    }),
  );
  register('browser.bookmarks.favicons', ({ partition, origins }) => ({ icons: favicons.forOrigins(partition, origins) }));
  // cua #90 end
}
