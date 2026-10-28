// The sessions the org's cut-over machines list (P5 O13 M3; RL6, OX8, P5 Decision Log 38), as the app's registry
// socket (`/api/registry/socket?app=1`) relays them: every listing the hub holds in `listings` pages when the socket
// opens, then a `listing` frame as each is stored. The hub only relays them: each is kept only once it verifies against
// the device's org state (`verifyListing`: signed by the key that speaks for its machine now, an enrolled machine's or
// a live certificate's), one per machine ref and session at its newest revision, and a withdrawn one (`LISTING_GONE`)
// drops its session.
//
// Nothing the hub relays moves a session until it verifies: a withdrawal included, which its machine signs as it signs
// every revision. Each session's watermark is the newest revision verified (a withdrawal's included), so no older signed
// listing comes back, from a frame or from a reconnection's snapshot, and a record that fails verification moves
// nothing. A snapshot is the whole set the hub holds: a session it leaves out (withdrawn while the socket was down) is
// dropped, its watermark kept.
//
// A listing whose machine the head and the certificates held cannot resolve (`not-listed`: a VM certified since the
// last read, which moves no version) is held unverified, beside what the session already shows, while the org store
// re-reads the state for that machine, and dropped if the read does not resolve it. Every change of the head or the
// certificates judges the kept ones again, so a machine removed from the org takes its sessions with it.
import { canonicalize, isListingGone, verifyListing, type Certificates, type Listing, type Signed, type SignedOrgState } from 'org-protocol';

export type ListingKey = `${string}/${string}`;
export const listingKey = (listing: Listing): ListingKey => `${listing.machine}/${listing.session}`;

type Deps = {
  /** The org state the device holds now; null before a first sync. */
  org(): { head: SignedOrgState; certificates: Certificates } | null;
  /** Re-reads the org state for a machine ref none of what is held resolves (resolves when the read is done). */
  resolve(ref: string): Promise<void>;
  now?: () => Date;
};

/**
 * The most unverified candidates held for one session while its machine is re-read. A genuine machine sends one
 * revision per change of its session, and a re-read is one round trip to the hub, so a handful covers what can arrive
 * meanwhile; past it the oldest go, so a hub flooding a session can delay it to the next revision, never hold memory.
 */
export const MAX_HELD = 8;

export class ListingsStore {
  #verified = new Map<ListingKey, Signed<Listing>>();
  /** The newest revision verified per session, a withdrawal's included: nothing at or below it is taken again. */
  readonly #watermarks = new Map<ListingKey, number>();
  /** Listings above their session's watermark waiting on their machine's resolution, by session, in arrival order. */
  readonly #held = new Map<ListingKey, Signed<Listing>[]>();
  /** The sessions whose machine is being re-read. */
  readonly #resolving = new Set<ListingKey>();
  /** The `listings` pages of the connection now opening, until its last. */
  #snapshot: Signed<Listing>[] | null = null;
  readonly #listeners = new Set<() => void>();
  #judging: Promise<void> = Promise.resolve();

  constructor(private readonly deps: Deps) {}

  #now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }

  /** The verified listings, by `<machine ref>/<session>`. */
  listings(): Map<ListingKey, Signed<Listing>> {
    return new Map(this.#verified);
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** A connection opened: its `listings` pages are the whole set the hub holds. */
  opened(): void {
    this.#snapshot = [];
  }

  /** One `listings` page; at the last, the sessions the pages left out are dropped and the rest taken as frames are. */
  page(records: Signed<Listing>[], last: boolean): Promise<void> {
    const snapshot = (this.#snapshot ??= []);
    snapshot.push(...records);
    if (!last) return this.#judging;
    this.#snapshot = null;
    return this.#serial(async () => {
      const carried = new Set(snapshot.map((r) => listingKey(r.body)));
      for (const key of [...this.#verified.keys(), ...this.#held.keys()]) {
        if (carried.has(key)) continue;
        this.#verified.delete(key);
        this.#held.delete(key);
      }
      for (const record of [...snapshot].sort((a, b) => a.body.revision - b.body.revision)) await this.#take(record);
      this.#tell();
    });
  }

  /** One `listing` frame: a session listed anew, changed, or withdrawn. */
  listing(record: Signed<Listing>): Promise<void> {
    return this.#serial(async () => {
      if (await this.#take(record)) this.#tell();
    });
  }

  /** The head or the certificates moved: every listing kept is judged again, and every one held. */
  orgChanged(): Promise<void> {
    return this.#serial(async () => {
      const org = this.deps.org();
      for (const [key, record] of [...this.#verified]) {
        if (!(await this.#verifies(org, record))?.ok) this.#verified.delete(key);
      }
      for (const key of [...this.#held.keys()]) await this.#tryHeld(key, false);
      this.#tell();
    });
  }

  /** Forgets everything (the device was forgotten). */
  clear(): void {
    this.#verified = new Map();
    this.#held.clear();
    this.#watermarks.clear();
    this.#resolving.clear();
    this.#snapshot = null;
    this.#tell();
  }

  #serial(run: () => Promise<void>): Promise<void> {
    const next = this.#judging.then(run);
    this.#judging = next.catch((error: unknown) => console.error('desk: judging a listing', error));
    return this.#judging;
  }

  #verifies(org: ReturnType<Deps['org']>, record: Signed<Listing>) {
    return org === null ? Promise.resolve(null) : verifyListing(org.head.state, record, org.certificates, this.#now());
  }

  /**
   * A record above its session's watermark: taken when it verifies (its session listed, changed or withdrawn, the
   * watermark moved to it); held while no state is held yet, or while its machine is re-read; else ignored. Whether what
   * is kept changed.
   */
  async #take(record: Signed<Listing>): Promise<boolean> {
    const key = listingKey(record.body);
    if (record.body.revision <= (this.#watermarks.get(key) ?? -Infinity)) return false;
    const verdict = await this.#verifies(this.deps.org(), record);
    if (verdict?.ok) return this.#accept(key, record);
    if (verdict === null || verdict.code === 'not-listed') this.#hold(key, record, verdict !== null);
    return false;
  }

  /** A verified record moves its session: the watermark to it, the session withdrawn or shown at it. */
  #accept(key: ListingKey, record: Signed<Listing>): boolean {
    this.#watermarks.set(key, record.body.revision);
    const held = this.#held.get(key)?.filter((r) => r.body.revision > record.body.revision) ?? [];
    if (held.length === 0) this.#held.delete(key);
    else this.#held.set(key, held);
    if (isListingGone(record.body)) return this.#verified.delete(key);
    this.#verified.set(key, record);
    return true;
  }

  #hold(key: ListingKey, record: Signed<Listing>, resolve: boolean): void {
    // Two records of one revision are both kept until verification tells the genuine from a forgery; only the same
    // record again is one candidate. Past the bound the oldest arrivals go.
    const same = canonicalize(record);
    const held = [...(this.#held.get(key) ?? []).filter((r) => canonicalize(r) !== same), record];
    this.#held.set(key, held.slice(-MAX_HELD));
    if (!resolve || this.#resolving.has(key)) return;
    this.#resolving.add(key);
    void this.deps.resolve(record.body.machine).finally(() => this.#settle(key));
  }

  /**
   * Judges the records held for `key` again, lowest revision first: each that verifies is taken; the rest stay held in
   * their arrival order, or with `final` go.
   */
  async #tryHeld(key: ListingKey, final: boolean): Promise<boolean> {
    const held = this.#held.get(key) ?? [];
    this.#held.delete(key);
    const org = this.deps.org();
    const waiting = new Set<Signed<Listing>>();
    let changed = false;
    for (const record of [...held].sort((a, b) => a.body.revision - b.body.revision)) {
      if (record.body.revision <= (this.#watermarks.get(key) ?? -Infinity)) continue;
      const verdict = await this.#verifies(org, record);
      if (verdict?.ok) changed = this.#accept(key, record) || changed;
      else if (!final && (verdict === null || verdict.code === 'not-listed')) waiting.add(record);
    }
    const watermark = this.#watermarks.get(key) ?? -Infinity;
    for (const record of held) if (waiting.has(record) && record.body.revision > watermark) this.#hold(key, record, org !== null);
    return changed;
  }

  /** Its machine was re-read: what is still held for the session is taken if it now verifies, and dropped otherwise. */
  #settle(key: ListingKey): Promise<void> {
    this.#resolving.delete(key);
    return this.#serial(async () => {
      if (await this.#tryHeld(key, true)) this.#tell();
    });
  }

  #tell(): void {
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch (error) {
        console.error('desk: a listener of the listings failed', error);
      }
    }
  }
}
