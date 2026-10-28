// The listings store (P5 O13 M3; RL6, OX8): what the app socket relays is kept only once it verifies against the
// device's org state, at its newest revision, a withdrawn session dropped; a listing whose machine nothing held resolves
// waits on a re-read of the state and is dropped if the read does not resolve it; the org moving judges them again.
import {
  base64urlEncode,
  generateSigningKey,
  LISTING_GONE,
  NO_CERTIFICATES,
  signRecord,
  SIGNING_DOMAINS,
  type Certificates,
  type Listing,
  type MachineCert,
  type Signed,
  type SignedOrgState,
  type SigningKey,
} from 'org-protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { memberId, nextOf, rootedOrg, signedBy } from '../../test/org';
import { ListingsStore, MAX_HELD } from './listings-store';

const ref = (prefix = '') => `${prefix}${base64urlEncode(crypto.getRandomValues(new Uint8Array(16)))}`;

type Machine = { ref: string; key: SigningKey };

async function listingOf(org: string, machine: Machine, session: string, revision: number, state = 'waiting'): Promise<Signed<Listing>> {
  const fields: Listing['fields'] = state === LISTING_GONE ? { owners: [], project: null, lane: 'A', state, title: '' } : { owners: [], project: 'p', lane: 'A', state, title: `session ${session}` };
  return signRecord(SIGNING_DOMAINS.listing, { org, machine: machine.ref, session, revision, issued: new Date().toISOString(), fields }, machine.key.privateKey, machine.key.pub);
}

let org: Awaited<ReturnType<typeof rootedOrg>>;
let head: SignedOrgState;
let certificates: Certificates;
let mini: Machine;
let resolves: string[];
let onResolve: (ref: string) => Promise<void>;
let store: ListingsStore;

beforeEach(async () => {
  org = await rootedOrg('org-listings');
  mini = { ref: ref(), key: await generateSigningKey() };
  head = await signedBy(
    await nextOf(org.genesis, (s) => {
      s.machines.push({ name: 'mini', ref: mini.ref, pub: mini.key.pub, owners: [org.member] });
      s.machineNames.push({ name: 'mini', ref: mini.ref });
    }),
    org.admin,
  );
  certificates = NO_CERTIFICATES;
  resolves = [];
  onResolve = async () => {};
  store = new ListingsStore({
    org: () => ({ head, certificates }),
    resolve: (r) => (resolves.push(r), onResolve(r)),
  });
});

const keys = () => [...store.listings().keys()];

describe('a listing', () => {
  it('is kept when its machine signed it, at its newest revision, and dropped when withdrawn', async () => {
    store.opened();
    await store.page([await listingOf(org.org, mini, 's1', 1)], false);
    expect(keys()).toEqual([]); // nothing until the last page
    await store.page([await listingOf(org.org, mini, 's2', 4)], true);
    expect(keys().sort()).toEqual([`${mini.ref}/s1`, `${mini.ref}/s2`].sort());
    await store.listing(await listingOf(org.org, mini, 's1', 3, 'working'));
    expect(store.listings().get(`${mini.ref}/s1`)?.body.fields.state).toBe('working');
    await store.listing(await listingOf(org.org, mini, 's1', 2, 'idle')); // older: never taken
    expect(store.listings().get(`${mini.ref}/s1`)?.body.revision).toBe(3);
    await store.listing(await listingOf(org.org, mini, 's1', 5, LISTING_GONE));
    expect(keys()).toEqual([`${mini.ref}/s2`]);
    await store.listing(await listingOf(org.org, mini, 's1', 4)); // below the withdrawal: stays gone
    expect(keys()).toEqual([`${mini.ref}/s2`]);
  });

  it('is dropped when another key signed it, or another org', async () => {
    const forger = { ref: mini.ref, key: await generateSigningKey() };
    await store.listing(await listingOf(org.org, forger, 's1', 1));
    await store.listing(await listingOf('org-elsewhere', mini, 's2', 1));
    expect(keys()).toEqual([]);
    expect(resolves).toEqual([]);
  });

  it("goes with its machine when a head drops it, and a connection's snapshot replaces what was held", async () => {
    await store.listing(await listingOf(org.org, mini, 's1', 1));
    store.opened();
    await store.page([await listingOf(org.org, mini, 's2', 1)], true);
    expect(keys()).toEqual([`${mini.ref}/s2`]);
    head = await signedBy(
      await nextOf(head, (s) => {
        s.machines = [];
        s.retired.push({ keyId: 'kid', pub: mini.key.pub, notAfter: new Date().toISOString(), holder: { machine: mini.ref } });
      }),
      org.admin,
    );
    await store.orgChanged();
    expect(keys()).toEqual([]);
  });
});

describe("a listing whose machine isn't resolved", () => {
  let delegation: { id: string; key: SigningKey };
  let vm: Machine;
  let cert: Signed<MachineCert>;

  beforeEach(async () => {
    delegation = { id: memberId(), key: await generateSigningKey() }; // a delegation's id is 32 hex
    head = await signedBy(
      await nextOf(head, (s) => {
        s.delegations.push({ id: delegation.id, pub: delegation.key.pub, prefix: 'vm-', expires: new Date(Date.now() + 86_400_000).toISOString(), maxUses: 10, offlineRevokeS: 0, owners: 'org' });
      }),
      org.admin,
    );
    vm = { ref: ref(`${delegation.id}_`), key: await generateSigningKey() };
    cert = await signRecord(SIGNING_DOMAINS.machineCert, { org: org.org, machine: vm.ref, name: 'vm-one', pub: vm.key.pub, delegation: delegation.id, use: 1, issued: new Date().toISOString() }, delegation.key.privateKey, delegation.key.pub);
  });

  it('is held while the state is re-read for its machine, and kept once the certificate the read brought resolves it', async () => {
    let read!: () => void;
    onResolve = () =>
      new Promise<void>((resolve) => {
        read = () => {
          certificates = { certs: [cert], retirements: [] };
          void store.orgChanged().then(resolve);
        };
      });
    const arriving = store.listing(await listingOf(org.org, vm, 's1', 1));
    await arriving;
    expect(resolves).toEqual([vm.ref]);
    expect(keys()).toEqual([]);
    read();
    await expect.poll(() => keys()).toEqual([`${vm.ref}/s1`]);
  });

  it('keeps its genuine record through a forgery of the same revision arriving while the machine is re-read', async () => {
    let read!: () => void;
    onResolve = () =>
      new Promise<void>((resolve) => {
        read = () => {
          certificates = { certs: [cert], retirements: [] };
          void store.orgChanged().then(resolve);
        };
      });
    const genuine = await listingOf(org.org, vm, 's1', 1);
    await store.listing(genuine);
    await store.listing(genuine); // the same record again: one candidate
    await store.listing(await listingOf(org.org, { ref: vm.ref, key: await generateSigningKey() }, 's1', 1));
    read();
    await expect.poll(() => store.listings().get(`${vm.ref}/s1`)).toEqual(genuine);
  });

  it(`holds at most ${MAX_HELD} candidates for a session, the oldest unverified going first`, async () => {
    let read!: () => void;
    onResolve = () =>
      new Promise<void>((resolve) => {
        read = () => {
          certificates = { certs: [cert], retirements: [] };
          void store.orgChanged().then(resolve);
        };
      });
    const forger = { ref: vm.ref, key: await generateSigningKey() };
    await store.listing(await listingOf(org.org, vm, 's1', 1)); // the oldest candidate: the flood below evicts it
    for (let i = 0; i < MAX_HELD; i++) await store.listing(await listingOf(org.org, forger, 's1', 50 + i));
    read();
    await new Promise((r) => setTimeout(r, 50));
    expect(keys()).toEqual([]);
    // The machine's next revision verifies at once, and no forgery displaces what verified.
    const genuine = await listingOf(org.org, vm, 's1', 2);
    await store.listing(genuine);
    await store.listing(await listingOf(org.org, forger, 's1', 900));
    expect(store.listings().get(`${vm.ref}/s1`)).toEqual(genuine);
  });

  it('is dropped when the re-read does not resolve it', async () => {
    await store.listing(await listingOf(org.org, vm, 's1', 1));
    expect(resolves).toEqual([vm.ref]);
    await new Promise((r) => setTimeout(r, 20));
    expect(keys()).toEqual([]);
    certificates = { certs: [cert], retirements: [] };
    await store.orgChanged(); // nothing held is left to resolve
    expect(keys()).toEqual([]);
  });

  it('waits for a first sync when the device holds no state yet, asking no re-read', async () => {
    let held: { head: SignedOrgState; certificates: Certificates } | null = null;
    store = new ListingsStore({ org: () => held, resolve: (r) => (resolves.push(r), Promise.resolve()) });
    await store.listing(await listingOf(org.org, mini, 's1', 1));
    expect(resolves).toEqual([]);
    held = { head, certificates };
    await store.orgChanged();
    expect(keys()).toEqual([`${mini.ref}/s1`]);
  });
});

describe('what a hostile hub can relay', () => {
  it('cannot erase a session with a withdrawal its machine did not sign, nor hold its later updates back', async () => {
    await store.listing(await listingOf(org.org, mini, 's1', 1));
    const forger = { ref: mini.ref, key: await generateSigningKey() };
    await store.listing(await listingOf(org.org, forger, 's1', 999, LISTING_GONE));
    expect(keys()).toEqual([`${mini.ref}/s1`]);
    await store.listing(await listingOf(org.org, forger, 's1', 998, 'working'));
    expect(store.listings().get(`${mini.ref}/s1`)?.body.revision).toBe(1);
    await store.listing(await listingOf(org.org, mini, 's1', 2, 'working'));
    expect(store.listings().get(`${mini.ref}/s1`)?.body.fields.state).toBe('working');
  });

  it('withdraws a session only on its machine-signed withdrawal, and keeps it withdrawn through a snapshot', async () => {
    await store.listing(await listingOf(org.org, mini, 's1', 1));
    await store.listing(await listingOf(org.org, mini, 's1', 6, LISTING_GONE));
    expect(keys()).toEqual([]);
    store.opened();
    await store.page([await listingOf(org.org, mini, 's1', 1)], true); // an old signed listing, served again
    expect(keys()).toEqual([]);
  });

  it('cannot roll a session back to an older signed listing in a snapshot', async () => {
    const old = await listingOf(org.org, mini, 's1', 1, 'idle');
    await store.listing(old);
    await store.listing(await listingOf(org.org, mini, 's1', 3, 'waiting'));
    store.opened();
    await store.page([old], true);
    expect(store.listings().get(`${mini.ref}/s1`)?.body.revision).toBe(3);
  });

  it("drops from a snapshot what it no longer carries (a withdrawal while the socket was down), and an unverified one's revision doesn't count", async () => {
    await store.listing(await listingOf(org.org, mini, 's1', 1));
    await store.listing(await listingOf(org.org, mini, 's2', 1));
    const forger = { ref: mini.ref, key: await generateSigningKey() };
    store.opened();
    await store.page([await listingOf(org.org, mini, 's2', 1), await listingOf(org.org, forger, 's3', 50)], true);
    expect(keys()).toEqual([`${mini.ref}/s2`]);
    await store.listing(await listingOf(org.org, mini, 's3', 1));
    expect(keys().sort()).toEqual([`${mini.ref}/s2`, `${mini.ref}/s3`].sort());
  });
});
