// A session's listing read from the hub (P5 O13 M5), for a landing on a session's cards before the listings store's
// snapshot is in (the app socket's first `listings` pages): `GET /api/listings`, the project's alone when the machine's
// presence names it, and of what it serves for the session the newest that verifies against the org state this phone
// holds (`verifyListing`: signed by the key that speaks for its machine now). The hub only carries listings; one that
// does not verify, or a withdrawal, names nothing.
import { isListingGone, verifyListing, type Certificates, type Listing, type Signed, type SignedOrgState } from 'org-protocol';
import { LISTINGS_PATH, type Listings } from 'desk-hub/protocol';
import { hubJson } from '../hub/http';

export async function fetchListing(
  machine: string,
  session: string,
  project: string | null,
  org: { head: SignedOrgState; certificates: Certificates },
  get: (path: string) => Promise<Listings> = (path) => hubJson<Listings>(path),
): Promise<Signed<Listing> | null> {
  const { listings } = await get(project === null ? LISTINGS_PATH : `${LISTINGS_PATH}?project=${encodeURIComponent(project)}`);
  const candidates = (Array.isArray(listings) ? listings : []).filter((l) => l?.body?.machine === machine && l.body.session === session).sort((a, b) => b.body.revision - a.body.revision);
  const now = new Date();
  for (const candidate of candidates) {
    if (!(await verifyListing(org.head.state, candidate, org.certificates, now)).ok) continue;
    return isListingGone(candidate.body) ? null : candidate;
  }
  return null;
}

/** What a cards view knows of its session's listing: still looking, the verified listing, or none (ended, or not the member's). */
export type Looked = { state: 'looking' } | { state: 'found'; listing: Signed<Listing> } | { state: 'none' };

type Store = { readonly loaded: boolean; listings(): Map<string, Signed<Listing>>; onChange(listener: () => void): () => void };

/**
 * `key`'s listing (`<machine ref>/<session>`) for a cards view, told to `tell` as it is known: the listings store's when
 * it holds one; none once its snapshot is in without one; before then, one read from the hub (`read`, null while it
 * cannot read yet), whose answer — a listing, or none when it serves none or cannot be read — stands until the store
 * says otherwise. Stopped by the function it returns.
 */
export function followSessionListing(key: string, store: Store, read: () => Promise<Signed<Listing> | null> | null, tell: (looked: Looked) => void): () => void {
  let live = true;
  let asked = false;
  const look = () => {
    const held = store.listings().get(key);
    if (held !== undefined) return tell({ state: 'found', listing: held });
    if (store.loaded) return tell({ state: 'none' });
    if (asked) return;
    const reading = read();
    if (reading === null) return;
    asked = true;
    reading
      .catch((error: unknown) => (console.error('desk: reading the session’s listing', error), null))
      .then((listing) => {
        if (!live || store.listings().has(key) || store.loaded) return;
        tell(listing === null ? { state: 'none' } : { state: 'found', listing });
      });
  };
  look();
  const off = store.onChange(look);
  return () => {
    live = false;
    off();
  };
}
