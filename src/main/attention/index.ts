// Wires main's notifier to the app's windows (C5): focus is read from the windows themselves when an item arrives (no
// window, or none focused, is unfocused); the banners, the badge and a click's focus go through the client port, whose
// Electron form brings the window forward, re-creating it when none is open. The navigation goes through the relay
// (`navigation.ts`), which emits it to a page that is listening or keeps it for `attention.pendingNavigate`; any page
// load or window close makes the page un-announced again.
import { app, type App, type BrowserWindow, type WebContentsDidStartNavigationEventParams } from 'electron';
import type { ClientPort } from '@shared/client/port';
import type { AppSessionId, AttentionId } from '@shared/graph/ids';
import type { ClientId } from '@shared/ipc/client';
import type { Settings } from '@shared/ipc/schema';
import { clientOf } from '../ipc/clients';
import { emit } from '../ipc/events';
import { registerMainHandler } from '../ipc/router';
import type { SessionReadModel } from '../sessions/read-model';
import { appWindows, isAppWindow } from '../windows'; // E2
import { createNavigationRelay } from './navigation';
import type { NotificationActions } from './actions';
import { startNotifier } from './notifier';

export function startAttention(model: SessionReadModel, deps: { actions?: NotificationActions; restoredIds: ReadonlySet<AttentionId>; settings(): Settings; port: Pick<ClientPort, 'notify' | 'badge' | 'focus'> }): () => void {
  const viewing = new Map<ClientId, { appSessionId: AppSessionId | null; release(): void }>();
  registerMainHandler('attention.viewing', ({ appSessionId }, { client }) => {
    let page = viewing.get(client.id);
    if (!page) {
      const entry = {
        appSessionId: null as AppSessionId | null,
        unfollow: () => {},
        release() {
          if (viewing.get(client.id) !== entry) return;
          viewing.delete(client.id);
          entry.unfollow();
        },
      };
      viewing.set(client.id, entry);
      entry.unfollow = client.onGone(entry.release); // at once for a client already gone, which then views nothing
      if (!viewing.has(client.id)) return;
      page = entry;
    }
    page.appSessionId = appSessionId as AppSessionId | null;
  });
  // A window's page views what its live client last reported; a page that has not reported since it loaded views nothing.
  const isViewing = (id: AppSessionId) => appWindows().some((win) => win.isFocused() && viewing.get(clientOf(win.webContents).id)?.appSessionId === id);
  const relay = createNavigationRelay(emit);
  registerMainHandler('attention.pendingNavigate', () => ({ navigate: relay.take() }));
  followAppPages(app, relay.pageGone);

  const isFocused = () => appWindows().some((win) => win.isFocused()); // E2: app windows only
  // Listen immediately, including during store retries; only restored arrivals are silent.
  const stop = startNotifier(model, { port: deps.port, actions: deps.actions, restoredIds: deps.restoredIds, isFocused, isViewing, navigate: relay.deliver, failure: relay.failure, settings: deps.settings, emit });
  return () => { stop(); for (const page of viewing.values()) page.release(); };
}

// E2 start (E2 execution document, Design §7, Decision Log 21): only an app window's page load or close makes the page
// un-announced. Every window is hooked as it is created, before `createWindow` can register it, so the check is made
// when the event fires: a capture window's load (`deliverables/capture.ts`) leaves a pending navigation deliverable.
export function followAppPages(source: Pick<App, 'on'>, pageGone: () => void): void {
  const watch = (win: BrowserWindow) => {
    win.webContents.on('did-start-navigation', (details: WebContentsDidStartNavigationEventParams) => {
      if (isAppWindow(win) && details.isMainFrame && !details.isSameDocument) pageGone();
    });
    win.on('closed', () => {
      if (isAppWindow(win)) pageGone();
    });
  };
  appWindows().forEach(watch);
  source.on('browser-window-created', (_event, win) => watch(win));
}
// E2 end
