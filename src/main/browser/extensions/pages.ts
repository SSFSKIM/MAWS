// An extension's options page as a tab (cua board #90's spec, "The popup view", options; its S1 spike: Electron's
// `chrome.runtime.openOptionsPage()` creates nothing, while the page loaded directly works). The one place a
// `chrome-extension://` URL loads in a tab: main builds the URL from the loaded extension (`<extension.url><page>`) and
// opens it as a new selected tab of the originating tab's session and partition, marked `internal`, titled
// "<name> · Options", its favicon the action's icon; a session's open options tab of that extension is selected rather
// than opened twice. Every other path (`validateBrowserUrl`, `BrowserUrlSchema`, `window.open`) stays http(s) only.
//
// Internal tabs are transient (tabs.ts: never persisted, closed rather than suspended by a cap), and close with their
// extension: an unload (turned Off in Settings) or the profile's removal closes them, each with a chrome notice naming
// the extension to the session it was open in.
import { optionsTabTitle } from '@shared/browser/extensions';
import type { BrowserTab } from '@shared/browser/tab';
import type { BrowserEmit, TabStore } from '../tabs';
import type { ExtensionActions } from './actions';

export class UnknownExtensionError extends Error {
  constructor(readonly extensionId: string) {
    super(`unknown extension ${extensionId}`);
  }
}

export interface ExtensionPagesDeps {
  store: Pick<TabStore, 'require' | 'entry' | 'all' | 'open' | 'close' | 'select' | 'update'>;
  actions: Pick<ExtensionActions, 'find' | 'icon'>;
  emit: BrowserEmit;
}

export class ExtensionPages {
  private readonly names = new Map<string, string>(); // each open options tab's extension name, for its closing notice

  constructor(private readonly deps: ExtensionPagesDeps) {}

  // The options page of an extension loaded in the tab's partition; the tab it is shown in.
  openOptions(tabId: string, extensionId: string): BrowserTab {
    const { store } = this.deps;
    const { appSessionId, partition } = store.require(tabId).tab;
    const action = this.deps.actions.find(partition, extensionId);
    if (!action?.optionsUrl) throw new UnknownExtensionError(extensionId);
    const open = store.all().find(({ tab }) => tab.appSessionId === appSessionId && tab.partition === partition && tab.internal?.extensionId === extensionId);
    if (open) {
      store.select(appSessionId, open.tab.tabId);
      return open.tab;
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
