// Who holds which tab across every cua connection of the app (the in-app browser spec of 2026-10-08, "Socket and
// lifecycle" and "Debugger leases"): a tab created through a connection (or adopted from such a tab's `window.open`) is
// *reserved* to it until the connection closes; a tab under a connection's debugger lease is *leased* to it; work under
// way on a tab that its next lease must not overtake (a let-go lease's undo, an adopted popup's sizing) is waited for by
// that lease. All are keyed by MAWS tab id,
// across app sessions, since a side thread's connection reaches its parent's tabs (P-24).
//
// P5 O17 M4 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M4's Decisions; D1): the orphan policy says whose a tab
// is that no live connection reserves. The app's `'person'`: the person's, in the panel, never closed by a primitive (a
// closed connection's tabs become so). The render host's `'session'`: no person is there to take it, so it is an
// *orphan* until a connection of its own session adopts it at its first lease or close (connection.ts), which is how a
// tab whose cua connection died can still be closed; a popup no connection's lease adopted is one too.

export type OrphanPolicy = 'person' | 'session';

export class TabClaims<Holder> {
  private readonly reserved = new Map<string, Holder>();
  private readonly leased = new Map<string, Holder>();
  private readonly awaited = new Map<string, Promise<void>>(); // what each tab's next lease waits for
  private readonly listeners = new Set<(tabId: string) => void>();

  constructor(private readonly orphans: OrphanPolicy = 'person') {}

  reserve(tabId: string, holder: Holder): void {
    this.reserved.set(tabId, holder);
  }

  // P5 O17 M4: under 'session', no live connection reserves the tab (never under 'person')
  isOrphan(tabId: string): boolean {
    return this.orphans === 'session' && !this.reserved.has(tabId);
  }

  // P5 O17 M4: the orphan reserved to `holder`, which the caller checked is of the tab's own session; false when the tab
  // is no orphan
  adoptOrphan(tabId: string, holder: Holder): boolean {
    if (!this.isOrphan(tabId)) return false;
    this.reserve(tabId, holder);
    return true;
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

  // Work under way on the tab that a new lease, any holder's, must not overtake: the undo of a let-go lease's agent state
  // (connection.ts `release`), or P5 O17 M8's sizing of an adopted popup's page (the render host's offscreen-views.ts).
  // `done` settles by itself and never rejects; a new lease starts once everything given for the tab has settled.
  beforeNextLease(tabId: string, done: Promise<void>): void {
    const prior = this.awaited.get(tabId);
    const all = prior ? Promise.all([prior, done]).then(() => undefined) : done;
    this.awaited.set(tabId, all);
    void all.then(() => {
      if (this.awaited.get(tabId) === all) this.awaited.delete(tabId);
    });
  }

  awaitedByNextLease(tabId: string): Promise<void> | undefined {
    return this.awaited.get(tabId);
  }

  // The tab is gone: neither reserved nor leased, nor anything to wait for.
  forget(tabId: string): void {
    this.reserved.delete(tabId);
    this.awaited.delete(tabId);
    if (this.leased.delete(tabId)) this.changed(tabId);
  }

  // The holder's connection closed: its reservations end (its tabs become the person's, or under 'session' orphans); its
  // leases are released by it.
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
