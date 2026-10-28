// The sessions the org's cut-over machines list (P5 O13 M3; RL6, OX8, P5 Decision Log 38), as the app's registry
// socket (`/api/registry/socket?app=1`) relays them: every listing the hub holds in `listings` pages when the socket
// opens, then a `listing` frame as each is stored. The hub only relays them: each is kept only once it verifies against
// the device's org state (`verifyListing`: signed by the key that speaks for its machine now, an enrolled machine's or
// a live certificate's), one per machine ref and session at its newest revision, and a withdrawn one (`LISTING_GONE`)
// drops its session.
//
// A listing whose machine the head and the certificates held cannot resolve (`not-listed`: a VM certified since the
// last read, which moves no version) is held unverified while the org store re-reads the state for that machine, and
// dropped if the read does not resolve it. Every change of the head or the certificates judges the kept ones again, so
// a machine removed from the org takes its sessions with it.
import { isListingGone, verifyListing, type Certificates, type Listing, type Signed, type SignedOrgState } from 'org-protocol';

export type ListingKey = `${string}/${string}`;
export const listingKey = (listing: Listing): ListingKey => `${listing.machine}/${listing.session}`;

type Deps = {
  /** The org state the device holds now; null before a first sync. */
  org(): { head: SignedOrgState; certificates: Certificates } | null;
  /** Re-reads the org state for a machine ref none of what is held resolves (resolves when the read is done). */
  resolve(ref: string): Promise<void>;
  now?: () => Date;
};

export class ListingsStore {
  #verified = new Map<ListingKey, Signed<Listing>>();
  /** Listings waiting on their machine's resolution, by key. */
  readonly #held = new Map<ListingKey, Signed<Listing>>();
  /** The newest revision seen per session, a withdrawn one's included, so an older one never comes back. */
  readonly #revisions = new Map<ListingKey, number>();
  /** The sessions whose machine is being re-read. */
  readonly #resolving = new Set<ListingKey>();
  /** The `listings` pages of the connection now opening, until its last. */
  #snapshot: Map<ListingKey, Signed<Listing>> | null = null;
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
    this.#snapshot = new Map();
  }

  /** One `listings` page; at the last, what the pages carried replaces what was held. */
  page(records: Signed<Listing>[], last: boolean): Promise<void> {
    const snapshot = (this.#snapshot ??= new Map());
    for (const record of records) {
      const key = listingKey(record.body);
      const held = snapshot.get(key);
      if (held === undefined || held.body.revision < record.body.revision) snapshot.set(key, record);
    }
    if (!last) return this.#judging;
    this.#snapshot = null;
    return this.#serial(async () => {
      this.#verified = new Map();
      this.#held.clear();
      for (const record of snapshot.values()) {
        const key = listingKey(record.body);
        const revision = this.#revisions.get(key);
        if (revision === undefined || revision < record.body.revision) this.#revisions.set(key, record.body.revision);
        await this.#place(record, false);
      }
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
      const kept = [...this.#verified.values()];
      const held = [...this.#held.values()];
      this.#verified = new Map();
      this.#held.clear();
      for (const record of kept) await this.#place(record, true);
      for (const record of held) await this.#place(record, false);
      this.#tell();
    });
  }

  /** Forgets everything (the device was forgotten). */
  clear(): void {
    this.#verified = new Map();
    this.#held.clear();
    this.#revisions.clear();
    this.#resolving.clear();
    this.#snapshot = null;
    this.#tell();
  }

  #serial(run: () => Promise<void>): Promise<void> {
    const next = this.#judging.then(run);
    this.#judging = next.catch((error: unknown) => console.error('desk: judging a listing', error));
    return this.#judging;
  }

  /** Takes a newer revision of a session: kept, held or dropped. Whether what is kept changed. */
  async #take(record: Signed<Listing>): Promise<boolean> {
    const key = listingKey(record.body);
    const revision = this.#revisions.get(key);
    if (revision !== undefined && revision >= record.body.revision) return false;
    this.#revisions.set(key, record.body.revision);
    this.#held.delete(key);
    if (isListingGone(record.body)) return this.#verified.delete(key);
    const had = this.#verified.delete(key);
    return (await this.#place(record, false)) || had;
  }

  /**
   * Verifies `record` against the org held: kept when it verifies; held while no state is held yet, or (unless `final`)
   * while its machine is re-read; dropped otherwise. Whether it was kept.
   */
  async #place(record: Signed<Listing>, final: boolean): Promise<boolean> {
    const key = listingKey(record.body);
    const org = this.deps.org();
    const verdict = org === null ? null : await verifyListing(org.head.state, record, org.certificates, this.#now());
    if (verdict?.ok) {
      this.#verified.set(key, record);
      return true;
    }
    if (verdict === null || (!final && verdict.code === 'not-listed')) {
      this.#held.set(key, record);
      if (verdict !== null && !this.#resolving.has(key)) {
        this.#resolving.add(key);
        void this.deps.resolve(record.body.machine).finally(() => this.#settle(key));
      }
    }
    return false;
  }

  /** Its machine was re-read: a listing still held is kept if it now verifies, and dropped otherwise. */
  #settle(key: ListingKey): Promise<void> {
    this.#resolving.delete(key);
    return this.#serial(async () => {
      const record = this.#held.get(key);
      if (record === undefined) return;
      this.#held.delete(key);
      if (await this.#place(record, true)) this.#tell();
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
