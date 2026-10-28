// A session's listing read from the hub at a landing, before the listings store's snapshot is in (P5 O13 M5): the
// project's listings the hub serves, the session's newest that verifies against the org state the phone holds, never
// a withdrawal and never one its machine's key did not sign.
import { base64urlEncode, generateSigningKey, LISTING_GONE, NO_CERTIFICATES, signRecord, SIGNING_DOMAINS, type Listing, type Signed, type SignedOrgState, type SigningKey } from 'org-protocol';
import type { Listings } from 'desk-hub/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextOf, rootedOrg, signedBy } from '../../test/org';
import { fetchListing, followSessionListing, type Looked } from './session-listing';

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

describe('following a session’s listing for its cards view', () => {
  /** A listings store whose snapshot is not in, and a hub read that answers `read`. */
  function follow(read: () => Promise<Signed<Listing> | null>) {
    const listeners = new Set<() => void>();
    const held = new Map<string, Signed<Listing>>();
    const store = { loaded: false, listings: () => held, onChange: (l: () => void) => (listeners.add(l), () => listeners.delete(l)) };
    const told: Looked[] = [];
    let reads = 0;
    const counted = () => {
      reads += 1;
      return read();
    };
    const stop = followSessionListing(`${MINI}/app-1`, store, counted, (looked) => told.push(looked));
    const changed = () => listeners.forEach((l) => l());
    return { store, held, told, reads: () => reads, changed, stop };
  }
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('settles as none when the hub serves no listing for it, rather than looking for ever', async () => {
    const f = follow(async () => null);
    await settled();
    expect(f.told.map((l) => l.state)).toEqual(['none']);
    // The store's snapshot then carrying it names it after all.
    f.held.set(`${MINI}/app-1`, await listingOf('app-1', 2));
    f.changed();
    expect(f.told.at(-1)).toMatchObject({ state: 'found', listing: { body: { revision: 2 } } });
    expect(f.reads()).toBe(1);
    f.stop();
  });

  it('settles as none when the read fails, and as found when it answers', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = follow(async () => {
      throw new Error('unreachable');
    });
    await settled();
    expect(failed.told.map((l) => l.state)).toEqual(['none']);
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
    const listing = await listingOf('app-1', 3);
    const found = follow(async () => listing);
    await settled();
    expect(found.told.at(-1)).toMatchObject({ state: 'found', listing: { body: { revision: 3 } } });
  });

  it('takes the store’s listing without a read, and none once its snapshot is in without one', async () => {
    const f = follow(async () => null);
    f.stop();
    const g = follow(async () => null);
    g.store.loaded = true;
    g.changed();
    expect(g.told.at(-1)).toEqual({ state: 'none' });
    g.held.set(`${MINI}/app-1`, await listingOf('app-1', 1));
    g.changed();
    expect(g.told.at(-1)?.state).toBe('found');
    g.stop();
  });
});
