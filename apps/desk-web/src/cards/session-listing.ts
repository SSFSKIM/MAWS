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
