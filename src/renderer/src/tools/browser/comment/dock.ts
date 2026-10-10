// P2-E2: which pane of this window docks a tab's comment card. A pick goes to the window whose pane holds the tab's view
// (E4d Design §8), and the card opens in that pane's strip; the pane registers its card host for its tab while it holds
// the view, and the browser comment connect reads it at the pick. A tab no pane of this window holds has no dock, and its
// comment opens the sheet. Every live registration is kept, the latest answering: a second pane that holds the view a
// moment and leaves gives the dock back to the first, whose own registration never lapsed (its mode can return to owner
// within one batched update, so it would not register again). A disposer removes only its own.
//
// P2-F L146: the registrations are observable (a new map per change), so the Side pane's thread header offers "Show in
// browser" exactly while a pane of this window holds a tab on the thread's page (`usePageDock`).
import { useSyncExternalStore } from 'react';
import { useBrowser } from '../store';

type Docks = ReadonlyMap<string, readonly { hostId: string }[]>; // tabId → the registrations of the panes holding its view, latest last
let docks: Docks = new Map();
const listeners = new Set<() => void>();
function put(next: Docks): void {
  docks = next;
  for (const listener of listeners) listener();
}

export function registerDock(tabId: string, hostId: string): () => void {
  const entry = { hostId };
  put(new Map(docks).set(tabId, [...(docks.get(tabId) ?? []), entry]));
  return () => {
    const rest = (docks.get(tabId) ?? []).filter((each) => each !== entry);
    const next = new Map(docks);
    if (rest.length > 0) next.set(tabId, rest);
    else next.delete(tabId);
    put(next);
  };
}

const hostOf = (registered: Docks, tabId: string): string | null => registered.get(tabId)?.at(-1)?.hostId ?? null;
export const dockOf = (tabId: string): string | null => hostOf(docks, tabId);

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const snapshot = () => docks;

// The dock of a pane of this window holding a tab on `pageUrl` (the URL the browser host's `accepts` matches), else null.
export function usePageDock(pageUrl: string | null): string | null {
  const registered = useSyncExternalStore(subscribe, snapshot);
  const sessions = useBrowser((s) => s.sessions);
  if (pageUrl === null) return null;
  for (const { tabs } of sessions.values())
    for (const tab of tabs) {
      const host = tab.url === pageUrl ? hostOf(registered, tab.tabId) : null;
      if (host !== null) return host;
    }
  return null;
}
