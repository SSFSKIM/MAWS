// A session's listing read from the hub at a landing, before the listings store's snapshot is in (P5 O13 M5): the
// session's records the hub serves (the project's when the presence names it), taken into the listings store as its
// frames are, so what the view shows is only ever the store's: verified against the org state the phone holds when the
// answer comes, never below the session's newest revision, and gone when the store drops or supersedes it.
import { base64urlEncode, generateSigningKey, LISTING_GONE, NO_CERTIFICATES, signRecord, SIGNING_DOMAINS, type Listing, type Signed, type SignedOrgState, type SigningKey } from 'org-protocol';
import type { Listings } from 'desk-hub/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextOf, rootedOrg, signedBy } from '../../test/org';
import { ListingsStore } from './listings-store';
import { fetchListings, followSessionListing, type Looked } from './session-listing';

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

describe('a landing’s read', () => {
  it('is the session’s records the hub serves, read for the project when the presence names it', async () => {
    const forged = await listingOf('app-1', 9, await generateSigningKey());
    const served: Listings = { listings: [await listingOf('app-1', 1), forged, await listingOf('app-1', 3), await listingOf('app-2', 5)], endpoints: [] };
    const paths: string[] = [];
    const get = async (path: string) => (paths.push(path), served);
    expect((await fetchListings(MINI, 'app-1', 'p 1', get)).map((l) => l.body.revision)).toEqual([1, 9, 3]);
    expect(paths).toEqual(['/api/listings?project=p%201']);
    await fetchListings(MINI, 'app-1', null, get);
    expect(paths.at(-1)).toBe('/api/listings');
    expect(await fetchListings(MINI, 'app-3', null, get)).toEqual([]);
  });
});

describe('following a session’s listing for its cards view', () => {
  /** The listings store over the org state `trust()` holds, its snapshot not in, and a hub read answering `read`. */
  function follow(read: () => Promise<Signed<Listing>[]>) {
    const trust = { head };
    const store = new ListingsStore({ org: () => ({ head: trust.head, certificates: NO_CERTIFICATES }), resolve: async () => {} });
    const told: Looked[] = [];
    let reads = 0;
    const counted = () => {
      reads += 1;
      return read();
    };
    const stop = followSessionListing(`${MINI}/app-1`, store, counted, (looked) => told.push(looked));
    return { store, trust, told, reads: () => reads, stop };
  }
  /** A read answered when `answer` is called. */
  function later() {
    let answer: (records: Signed<Listing>[]) => void = () => {};
    const reading = new Promise<Signed<Listing>[]>((resolve) => (answer = resolve));
    return { read: () => reading, answer };
  }
  /** Until `test` holds (the store verifies on WebCrypto's own time), within 2 s. */
  async function until(test: () => boolean) {
    for (const end = Date.now() + 2000; !test(); await new Promise((resolve) => setTimeout(resolve, 5))) if (Date.now() > end) throw new Error('never settled');
  }
  /** Until `f` was told something more than the `n` things it had been. */
  const toldMore = (f: { told: Looked[] }, n: number) => until(() => f.told.length > n);
  const revision = (looked: Looked | undefined) => (looked?.state === 'found' ? looked.listing.body.revision : looked?.state);

  it('shows the newest the machine signed, and none when the hub serves none, or withdrawn, or the read fails', async () => {
    const found = follow(async () => [await listingOf('app-1', 1), await listingOf('app-1', 9, await generateSigningKey()), await listingOf('app-1', 3)]);
    await until(() => found.told.at(-1)?.state === 'none' || revision(found.told.at(-1)) === 3);
    expect(revision(found.told.at(-1))).toBe(3);
    const empty = follow(async () => []);
    await toldMore(empty, 0);
    expect(empty.told.map((l) => l.state)).toEqual(['none']);
    const withdrawn = follow(async () => [await listingOf('app-1', 2), await listingOf('app-1', 4, key, LISTING_GONE)]);
    await until(() => withdrawn.told.at(-1)?.state === 'none');
    expect(withdrawn.told.at(-1)).toEqual({ state: 'none' });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = follow(async () => {
      throw new Error('unreachable');
    });
    await toldMore(failed, 0);
    expect(failed.told.map((l) => l.state)).toEqual(['none']);
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });

  it('drops a shown listing the store removes, and never shows an older revision a late read answers', async () => {
    const read = later();
    const f = follow(read.read);
    await f.store.listing(await listingOf('app-1', 10));
    expect(revision(f.told.at(-1))).toBe(10);
    await f.store.listing(await listingOf('app-1', 11, key, LISTING_GONE));
    expect(f.told.at(-1)).toEqual({ state: 'none' });
    const n = f.told.length;
    read.answer([await listingOf('app-1', 9)]);
    await toldMore(f, n);
    expect(f.told.slice(n)).toEqual([{ state: 'none' }]);
    expect(f.reads()).toBe(1);
  });

  it('drops a fallback once its machine’s key no longer speaks for it, and verifies a late answer against the trust held then', async () => {
    const f = follow(async () => [await listingOf('app-1', 3)]);
    await until(() => revision(f.told.at(-1)) === 3);
    const replaced = await generateSigningKey();
    f.trust.head = await signedBy(await nextOf(head, (s) => void (s.machines[0].pub = replaced.pub)), org.admin);
    await f.store.orgChanged();
    expect(f.told.at(-1)).toEqual({ state: 'none' });

    const read = later();
    const g = follow(read.read);
    g.trust.head = f.trust.head; // the key replaced while the read was out
    read.answer([await listingOf('app-1', 5)]);
    await toldMore(g, 0);
    expect(g.told).toEqual([{ state: 'none' }]);
  });

  it('adds nothing once a snapshot already being judged leaves the session out, though the read answers first', async () => {
    const read = later();
    const f = follow(read.read);
    const other = await listingOf('app-2', 1);
    const departed = await listingOf('app-1', 4);
    f.store.opened();
    const snapshot = f.store.page([other], true); // being verified while the read answers
    const n = f.told.length;
    read.answer([departed]);
    await snapshot;
    await toldMore(f, n);
    await until(() => f.told.length >= n + 2);
    expect(f.store.loaded).toBe(true);
    expect([...f.store.listings().keys()]).toEqual([`${MINI}/app-2`]);
    expect(f.told.slice(n).every((l) => l.state === 'none')).toBe(true);
  });

  it('takes the store’s listing without waiting on the read, and none once its snapshot is in without one', async () => {
    const read = later();
    const f = follow(read.read);
    await f.store.listing(await listingOf('app-1', 1));
    expect(revision(f.told.at(-1))).toBe(1);
    f.store.opened();
    await f.store.page([], true);
    expect(f.told.at(-1)).toEqual({ state: 'none' });
    const n = f.told.length;
    read.answer([await listingOf('app-1', 2)]); // the snapshot is the whole set: a read answered after it moves nothing
    await toldMore(f, n);
    expect(f.told.slice(n)).toEqual([{ state: 'none' }]);
    f.stop();
  });
});
