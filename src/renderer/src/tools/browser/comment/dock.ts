// P2-E2: which pane of this window docks a tab's comment card. A pick goes to the window whose pane holds the tab's view
// (E4d Design §8), and the card opens in that pane's strip; the pane registers its card host for its tab while it holds
// the view, and the browser comment connect reads it at the pick. A tab no pane of this window holds has no dock, and its
// comment opens the sheet. Every live registration is kept, the latest answering: a second pane that holds the view a
// moment and leaves gives the dock back to the first, whose own registration never lapsed (its mode can return to owner
// within one batched update, so it would not register again). A disposer removes only its own.
const docks = new Map<string, { hostId: string }[]>(); // tabId → the registrations of the panes holding its view, latest last

export function registerDock(tabId: string, hostId: string): () => void {
  const entry = { hostId };
  docks.set(tabId, [...(docks.get(tabId) ?? []), entry]);
  return () => {
    const rest = (docks.get(tabId) ?? []).filter((each) => each !== entry);
    if (rest.length > 0) docks.set(tabId, rest);
    else docks.delete(tabId);
  };
}

export const dockOf = (tabId: string): string | null => docks.get(tabId)?.at(-1)?.hostId ?? null;
