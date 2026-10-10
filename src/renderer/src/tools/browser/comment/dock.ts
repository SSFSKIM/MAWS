// P2-E2: which pane of this window docks a tab's comment card. A pick goes to the window whose pane holds the tab's view
// (E4d Design §8), and the card opens in that pane's strip; the pane registers its card host for its tab while it holds
// the view, and the browser comment connect reads it at the pick. A tab no pane of this window holds has no dock, and its
// comment opens the sheet. The latest registration wins; a disposer removes only its own.
const docks = new Map<string, string>(); // tabId → the host id of the pane holding its view

export function registerDock(tabId: string, hostId: string): () => void {
  docks.set(tabId, hostId);
  return () => {
    if (docks.get(tabId) === hostId) docks.delete(tabId);
  };
}

export const dockOf = (tabId: string): string | null => docks.get(tabId) ?? null;
