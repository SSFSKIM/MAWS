// A session's listing read from the hub at a landing, before the listings store's snapshot is in (P5 O13 M5): the
// project's listings the hub serves, the session's newest that verifies against the org state the phone holds, never
// a withdrawal and never one its machine's key did not sign.
import { base64urlEncode, generateSigningKey, LISTING_GONE, NO_CERTIFICATES, signRecord, SIGNING_DOMAINS, type Listing, type Signed, type SignedOrgState, type SigningKey } from 'org-protocol';
import type { Listings } from 'desk-hub/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { nextOf, rootedOrg, signedBy } from '../../test/org';
import { fetchListing } from './session-listing';

let org: Awaited<ReturnType<typeof rootedOrg>>;
let head: SignedOrgState;
let key: SigningKey;
const MINI = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));

const listingOf = (session: string, revision: number, signer: SigningKey = key, state = 'waiting'): Promise<Signed<Listing>> =>
  signRecord(SIGNING_DOMAINS.listing, { org: org.org, machine: MINI, session, revision, issued: new Date().toISOString(), fields: state === LISTING_GONE ? { owners: [], project: null, lane: 'B', state, title: '' } : { owners: [org.member], project: 'p', lane: 'B', state, title: `rev ${revision}` } }, signer.privateKey, signer.pub);

beforeEach(async () => {
  org = await rootedOrg('org-landing');
  key = await generateSigningKey();
  head = await signedBy(
    await nextOf(org.genesis, (s) => {
      s.machines.push({ name: 'mini', ref: MINI, pub: key.pub, owners: [org.member] });
      s.machineNames.push({ name: 'mini', ref: MINI });
    }),
    org.admin,
  );
});

describe('a landing’s listing', () => {
  it('is the session’s newest the machine signed, read for the project when the presence names it', async () => {
    const forged = await listingOf('app-1', 9, await generateSigningKey());
    const served: Listings = { listings: [await listingOf('app-1', 1), forged, await listingOf('app-1', 3), await listingOf('app-2', 5)], endpoints: [] };
    const paths: string[] = [];
    const get = async (path: string) => (paths.push(path), served);
    const found = await fetchListing(MINI, 'app-1', 'p 1', { head, certificates: NO_CERTIFICATES }, get);
    expect(found?.body).toMatchObject({ session: 'app-1', revision: 3, fields: { title: 'rev 3' } });
    expect(paths).toEqual(['/api/listings?project=p%201']);
    await fetchListing(MINI, 'app-1', null, { head, certificates: NO_CERTIFICATES }, get);
    expect(paths.at(-1)).toBe('/api/listings');
  });

  it('is none for a session the hub serves withdrawn, or not at all', async () => {
    const get = async () => ({ listings: [await listingOf('app-1', 4, key, LISTING_GONE)], endpoints: [] });
    expect(await fetchListing(MINI, 'app-1', null, { head, certificates: NO_CERTIFICATES }, get)).toBeNull();
    expect(await fetchListing(MINI, 'app-3', null, { head, certificates: NO_CERTIFICATES }, get)).toBeNull();
  });
});
