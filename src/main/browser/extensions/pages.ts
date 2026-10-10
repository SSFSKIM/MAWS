// An extension's options page as a tab (cua board #90's spec, "The popup view", options; its S1 spike: Electron's
// `chrome.runtime.openOptionsPage()` creates nothing, while the page loaded directly works). The one place a
// `chrome-extension://` URL loads in a tab: main builds the URL from the loaded extension (`<extension.url><page>`) and
// opens it as a new selected tab of the originating tab's session and partition, marked `internal`, titled
// "<name> · Options", its favicon the action's icon; a session's open options tab of that extension is selected rather
// than opened twice. Every other path (`validateBrowserUrl`, `BrowserUrlSchema`, `window.open`) stays http(s) only.
//
// Internal tabs are transient (tabs.ts: never persisted, closed rather than suspended by a cap, never opened when the cap
// has no room), never leave their extension's pages (`extensionPagesRule`; navigation.ts `leaveInternal`), and close with
// their extension: an unload (turned Off in Settings) or the profile's removal closes them, each with a chrome notice naming
// the extension to the session it was open in.
import { optionsTabTitle } from '@shared/browser/extensions';
import type { WebContents } from 'electron';
import { BROWSER_LOADED_TABS_MAX, isExtensionPage, type BrowserTab } from '@shared/browser/tab';
import { validateBrowserUrl } from '@shared/browser/url';
import type { RequestRule } from '../partition';
import type { BrowserEmit, TabEntry, TabStore } from '../tabs';
import type { ExtensionActions } from './actions';

export class UnknownExtensionError extends Error {
  constructor(readonly extensionId: string) {
    super(`unknown extension ${extensionId}`);
  }
}

export interface ExtensionPagesDeps {
  store: Pick<TabStore, 'require' | 'entry' | 'all' | 'open' | 'close' | 'select' | 'update' | 'hasRoomForView'>;
  actions: Pick<ExtensionActions, 'find' | 'icon'>;
  emit: BrowserEmit;
}

export class ExtensionPages {
  private readonly names = new Map<string, string>(); // each open options tab's extension name, for its closing notice

  constructor(private readonly deps: ExtensionPagesDeps) {}

  // The options page of an extension loaded in the tab's partition; the tab it is shown in, or null when the loaded-tab
  // cap has no tab to unload for it (an options tab is never left suspended): the cap's notice says so, naming it.
  openOptions(tabId: string, extensionId: string): BrowserTab | null {
    const { store } = this.deps;
    const { appSessionId, partition } = store.require(tabId).tab;
    const action = this.deps.actions.find(partition, extensionId);
    if (!action?.optionsUrl) throw new UnknownExtensionError(extensionId);
    const open = store.all().find(({ tab }) => tab.appSessionId === appSessionId && tab.partition === partition && tab.internal?.extensionId === extensionId);
    if (open) {
      store.select(appSessionId, open.tab.tabId);
      return open.tab;
    }
    if (!store.hasRoomForView()) {
      this.deps.emit('browser.notice', { appSessionId, tabId, kind: 'tabsCap', count: BROWSER_LOADED_TABS_MAX, name: action.name });
      return null;
    }
    for (const id of [...this.names.keys()]) if (!store.entry(id)) this.names.delete(id); // tabs the person closed
    const title = optionsTabTitle(action.name);
    const { tab } = store.open({ appSessionId, url: action.optionsUrl, select: true, partition, internal: { kind: 'extension', extensionId, title } });
    this.names.set(tab.tabId, action.name);
    void this.deps.actions.icon(partition, extensionId).then((icon) => {
      if (icon !== null && store.entry(tab.tabId)?.tab.internal) store.update(tab.tabId, { favicon: icon });
    });
    return tab;
  }

  // An extension unloaded (`extensionId`), or a profile removed (null): its options tabs in the partition closed, each
  // told to its session.
  close(partition: string, extensionId: string | null): void {
    const { store, emit } = this.deps;
    for (const { tab } of store.all()) {
      if (tab.partition !== partition || !tab.internal || (extensionId !== null && tab.internal.extensionId !== extensionId)) continue;
      const name = this.names.get(tab.tabId) ?? tab.internal.title;
      this.names.delete(tab.tabId);
      store.close(tab.tabId);
      emit('browser.notice', { appSessionId: tab.appSessionId, tabId: null, kind: 'extensionPageClosed', name });
    }
  }
}

// The partition's request rule for extension pages in tabs (a `Partitions` request rule): every main-frame request a tab
// makes, from any source (a navigation command, a link, Back, an agent's `Page.navigate`, a restored or resumed URL), is
// checked here, before anything commits. An ordinary tab never loads a `chrome-extension://` page; an internal tab loads
// its own extension's pages only, and a request for a web page leaves it (`leave`: the page opens as a new ordinary tab
// and the internal tab closes). Popups, background pages and subframes are not tabs' main frames and pass.
export function extensionPagesRule({ entryOf, leave }: { entryOf(webContents: WebContents): TabEntry | undefined; leave(entry: TabEntry, url: string): void }): RequestRule {
  return (details) => {
    if (details.resourceType !== 'mainFrame' || !details.webContents) return undefined;
    const entry = entryOf(details.webContents);
    if (!entry) return undefined;
    const internal = entry.tab.internal;
    if (!internal) return /^chrome-extension:/i.test(details.url) ? { cancel: true } : undefined;
    if (isExtensionPage(details.url, internal.extensionId)) return undefined;
    const web = validateBrowserUrl(details.url);
    if (web.ok) setImmediate(() => leave(entry, web.url)); // after the cancel is answered
    return { cancel: true };
  };
}
