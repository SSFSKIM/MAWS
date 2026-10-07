// The e2e seam's preload-less tab (E4d execution document, Decision Log 34): under MAWS_E2E=1 the seam can mark a tab
// whose arm acknowledgements main never hears, so the e2e proves the "armed means acknowledged" defence on an ordinary
// tab whatever E4a does about adopted `window.open` tabs (the one kind of page with no preload when it was found).
// Only the acknowledgement (`{type: 'armed'}`) is withheld; reports and refusals reach the gate as they would. Outside
// the e2e the set stays empty and the listener passes every message straight on.

export function withIgnoredAcks<S>(ignored: ReadonlySet<string>, tabOf: (sender: S) => string | undefined, receive: (sender: S, message: unknown) => void): (sender: S, message: unknown) => void {
  return (sender, message) => {
    if (ignored.size > 0 && typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'armed') {
      const tabId = tabOf(sender);
      if (tabId !== undefined && ignored.has(tabId)) return;
    }
    receive(sender, message);
  };
}
