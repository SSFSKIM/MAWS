// A session's listing at a landing on its cards before the listings store's snapshot is in (P5 O13 M5; the app
// socket's first `listings` pages): the session's records read from the hub's `GET /api/listings` (the project's
// alone when the machine's presence names it) are taken into the listings store as its frames are, so the view shows
// only what the store holds. Each record is verified when the store takes it, against the org state the phone holds
// then (`verifyListing`: signed by the key that speaks for its machine now), never at or below the session's newest
// revision, and not at all once a snapshot is in by the records' turn in the store; a withdrawal, a later frame, a
// snapshot or a change of trust moves the session as it moves any other. The hub only carries listings: what it serves
// moves nothing until it verifies.
import type { Listing, Signed } from 'org-protocol';
import { LISTINGS_PATH, type Listings } from 'desk-hub/protocol';
import { hubJson } from '../hub/http';

/** The records the hub serves for `machine`'s `session`, unverified. */
export async function fetchListings(machine: string, session: string, project: string | null, get: (path: string) => Promise<Listings> = (path) => hubJson<Listings>(path)): Promise<Signed<Listing>[]> {
  const { listings } = await get(project === null ? LISTINGS_PATH : `${LISTINGS_PATH}?project=${encodeURIComponent(project)}`);
  return (Array.isArray(listings) ? listings : []).filter((l) => l?.body?.machine === machine && l.body.session === session);
}

/** What a cards view knows of its session's listing: still looking, the verified listing, or none (ended, or not the member's). */
export type Looked = { state: 'looking' } | { state: 'found'; listing: Signed<Listing> } | { state: 'none' };

type Store = { readonly loaded: boolean; listings(): Map<string, Signed<Listing>>; landing(records: Signed<Listing>[]): Promise<void>; onChange(listener: () => void): () => void };

/**
 * `key`'s listing (`<machine ref>/<session>`) for a cards view, told to `tell` as it is known: the listings store's when
 * it holds one; none once its snapshot is in without one, or once it drops one it held. Before then the session's
 * records are read from the hub once (`read`, null while it cannot read yet) and given to the store (`landing`: taken
 * as frames are, unless a snapshot came in first); once they are, none until the store holds one. Stopped by the function it returns.
 */
export function followSessionListing(key: string, store: Store, read: () => Promise<Signed<Listing>[]> | null, tell: (looked: Looked) => void): () => void {
  let live = true;
  let asked = false;
  let answered = false;
  let held = false; // the store has held the session's listing: its absence since is the store's word
  const look = () => {
    const listing = store.listings().get(key);
    if (listing !== undefined) {
      held = true;
      return tell({ state: 'found', listing });
    }
    if (store.loaded || answered || held) return tell({ state: 'none' });
    if (asked) return;
    const reading = read();
    if (reading === null) return;
    asked = true;
    reading
      .then((records) => (live ? store.landing(records) : undefined))
      .catch((error: unknown) => console.error('desk: reading the session’s listing', error))
      .then(() => {
        if (!live) return;
        answered = true;
        look();
      });
  };
  look();
  const off = store.onChange(look);
  return () => {
    live = false;
    off();
  };
}
