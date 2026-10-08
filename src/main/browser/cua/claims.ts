// Who holds which tab across every cua connection of the app (the in-app browser spec of 2026-10-08, "Socket and
// lifecycle" and "Debugger leases"): a tab created through a connection (or adopted from such a tab's `window.open`) is
// *reserved* to it until the connection closes; a tab under a connection's debugger lease is *leased* to it. Both are
// keyed by MAWS tab id, across app sessions, since a side thread's connection reaches its parent's tabs (P-24).

export class TabClaims<Holder> {
  private readonly reserved = new Map<string, Holder>();
  private readonly leased = new Map<string, Holder>();
  private readonly listeners = new Set<(tabId: string) => void>();

  reserve(tabId: string, holder: Holder): void {
    this.reserved.set(tabId, holder);
  }

  reservedTo(tabId: string): Holder | undefined {
    return this.reserved.get(tabId);
  }

  leasedTo(tabId: string): Holder | undefined {
    return this.leased.get(tabId);
  }

  // Another holder reserved or leased the tab.
  heldByOther(tabId: string, holder: Holder): boolean {
    const reserved = this.reserved.get(tabId);
    const leased = this.leased.get(tabId);
    return (reserved !== undefined && reserved !== holder) || (leased !== undefined && leased !== holder);
  }

  lease(tabId: string, holder: Holder): void {
    this.leased.set(tabId, holder);
    this.changed(tabId);
  }

  unlease(tabId: string, holder: Holder): void {
    if (this.leased.get(tabId) !== holder) return;
    this.leased.delete(tabId);
    this.changed(tabId);
  }

  // The tab is gone: neither reserved nor leased.
  forget(tabId: string): void {
    this.reserved.delete(tabId);
    if (this.leased.delete(tabId)) this.changed(tabId);
  }

  // The holder's connection closed: its reservations end (its tabs become the person's); its leases are released by it.
  dropReservations(holder: Holder): void {
    for (const [tabId, reservedTo] of [...this.reserved]) if (reservedTo === holder) this.reserved.delete(tabId);
  }

  onChange(listener: (tabId: string) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private changed(tabId: string): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(tabId);
      } catch (error) {
        console.error('[browser] a lease listener failed:', error);
      }
    }
  }
}
