// Main's handlers for `browser.*` (E4a execution document, Interfaces "IPC `browser.*`"). Every input has passed its
// schema before a handler runs (every URL http or https, every tab id `b_` plus twelve hex characters), and only the app
// window's top frame can invoke these (the router's `isAppSender`), so a page in a view never reaches them. A tab id
// main does not know answers `invalid_input` ("unknown browser tab").
import type { AppSessionId } from '@shared/graph/ids';
import { ipcError } from '@shared/ipc/errors';
import type { CommandName } from '@shared/ipc/schema';
import { CommandFailure, type MainHandler, type registerMainHandler } from '../ipc/router';
import type { BrowserProfile } from './partition';
import { UnknownTabError, type TabStore } from './tabs';
import type { ViewManager } from './view';

export interface BrowserHandlerDeps {
  store: TabStore;
  views: Pick<ViewManager, 'place' | 'cover'>;
  profiles(): BrowserProfile[];
  register: typeof registerMainHandler;
}

// A handler whose unknown tab is the caller's mistake, not main's fault.
function knownTabs<N extends CommandName>(handler: MainHandler<N>): MainHandler<N> {
  return (input, context) => {
    try {
      return handler(input, context);
    } catch (error) {
      if (error instanceof UnknownTabError) throw new CommandFailure(ipcError('invalid_input', error.message));
      throw error;
    }
  };
}

const session = (id: string) => id as AppSessionId; // the schema checked it; the wire carries no brand

export function registerBrowserHandlers({ store, views, profiles, register }: BrowserHandlerDeps): void {
  register('browser.tabs.list', ({ appSessionId }) => store.list(appSessionId === undefined ? undefined : session(appSessionId)));
  register('browser.tabs.open', (request) => store.open({ ...request, appSessionId: session(request.appSessionId) }));
  register('browser.tabs.close', knownTabs(({ tabId }) => store.close(tabId)));
  register('browser.tabs.select', knownTabs(({ appSessionId, tabId }) => store.select(session(appSessionId), tabId)));
  register('browser.profiles.list', () => ({ profiles: profiles().map(({ profileDir, name }) => ({ profileDir, name })) }));
  // The sender's window places and covers; the cover answers at once, its placeholders follow as browser.view.covered.
  register('browser.view.place', knownTabs((input, { sender }) => views.place(input, sender)));
  register('browser.view.cover', ({ covered }, { sender }) => void views.cover(covered, sender));
}
