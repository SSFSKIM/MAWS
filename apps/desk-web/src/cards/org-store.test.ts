// The phone's org store (P5 O13 M3, §B) against a fake hub serving `GET /api/org/state?since=`: the first sync verified
// against the pairing code's pins and nothing else, every later one onto the head, the certificates kept as served
// whatever the version, the re-read held to once a minute per reason, and what was adopted surviving a reload.
import { NO_CERTIFICATES, type Certificates, type SignedOrgState } from 'org-protocol';
import { describe, expect, it } from 'vitest';
import type { OrgStateView } from 'desk-hub/protocol';
import { nextOf, rootedOrg, signedBy } from '../../test/org';
import { CHAIN_WINDOW_MS, memoryOrgPersistence, OrgStore, REFRESH_EVERY_MS, type OrgSource } from './org-store';

/** A hub serving `chain` as `GET /api/org/state?since=` does, in pages of `page` states; every read recorded. */
function fakeHub(chain: SignedOrgState[], options: { page?: number; certificates?: Certificates } = {}) {
  const reads: number[] = [];
  const hub = { chain, certificates: options.certificates ?? NO_CERTIFICATES, reads };
  const source: OrgSource = async (since) => {
    reads.push(since);
    const after = hub.chain.filter((s) => s.state.version > since);
    const page = after.slice(0, options.page ?? after.length);
    const view: OrgStateView = { head: hub.chain.at(-1) ?? null, transitions: [], certificates: hub.certificates, chain: page, more: page.length < after.length };
    return view;
  };
  return { hub, source };
}

describe('the first sync', () => {
  it("adopts the hub's chain from its genesis when it is the org the pins name, a page at a time", async () => {
    const org = await rootedOrg('org-store');
    const v2 = await signedBy(await nextOf(org.genesis), org.admin);
    const v3 = await signedBy(await nextOf(v2), org.admin);
    const { hub, source } = fakeHub([org.genesis, v2, v3], { page: 2 });
    const store = new OrgStore('org-store', { persistence: memoryOrgPersistence(), source });
    expect(await store.sync(org.pins)).toEqual({ adopted: 3 });
    expect(hub.reads).toEqual([0, 2]);
    expect(store.head().state.version).toBe(3);
    expect(store.held()!.hashes).toHaveLength(3);
  });

  it('refuses a chain whose genesis is not the pinned org: another recovery key, or no pinned root', async () => {
    const pinned = await rootedOrg('org-store');
    const throwaway = await rootedOrg('org-store', pinned.member); // the same org id and member, other keys
    const store = new OrgStore('org-store', { persistence: memoryOrgPersistence(), source: fakeHub(throwaway.chain).source });
    expect(await store.sync(pinned.pins)).toEqual({ adopted: 0, refused: 'bad-link' });
    expect(await store.sync({ ...pinned.pins, recoveryPub: throwaway.pins.recoveryPub })).toEqual({ adopted: 0, refused: 'not-root-signed' });
    expect(store.ready).toBe(false);
    expect(() => store.head()).toThrow();
  });

  it("refuses a pinned chain of another org id than the store's", async () => {
    const other = await rootedOrg('org-elsewhere');
    const store = new OrgStore('org-store', { persistence: memoryOrgPersistence(), source: fakeHub(other.chain).source });
    expect(await store.sync(other.pins)).toEqual({ adopted: 0, refused: 'bad-link' });
  });
});

describe('a later sync', () => {
  it('reads after the head and adopts the successors that follow it, telling each change once kept', async () => {
    const org = await rootedOrg('org-store');
    const { hub, source } = fakeHub([org.genesis]);
    const persistence = memoryOrgPersistence();
    const store = new OrgStore('org-store', { persistence, source });
    await store.sync(org.pins);
    const told: number[] = [];
    store.onChange((change) => told.push(change.head.state.version));
    hub.chain.push(await signedBy(await nextOf(org.genesis), org.admin));
    expect(await store.sync(org.pins)).toEqual({ adopted: 1 });
    expect(hub.reads.at(-1)).toBe(1);
    expect(told).toEqual([2]);
    expect((await persistence.load('org-store'))!.head.state.version).toBe(2);
  });

  it('keeps the head against a successor signed by no root, a fork at the next version, and an older head served', async () => {
    const org = await rootedOrg('org-store');
    const stranger = await rootedOrg('org-store', org.member);
    const v2 = await signedBy(await nextOf(org.genesis), org.admin);
    const { hub, source } = fakeHub([org.genesis, v2]);
    const store = new OrgStore('org-store', { persistence: memoryOrgPersistence(), source });
    await store.sync(org.pins);

    hub.chain = [org.genesis, v2, await signedBy(await nextOf(v2), stranger.admin)];
    expect(await store.sync(org.pins)).toMatchObject({ adopted: 0, refused: 'not-root-signed' });
    hub.chain = [org.genesis, await signedBy(await nextOf(org.genesis, (s) => void (s.projects = [{ id: 'p', name: 'p' }])), org.admin)];
    expect(await store.sync(org.pins)).toEqual({ adopted: 0, refused: 'fork' });
    hub.chain = [org.genesis];
    expect(await store.sync(org.pins)).toEqual({ adopted: 0, refused: 'rollback' });
    expect(store.head()).toEqual(v2);
  });

  it("takes the hub's certificates with every read, the version unchanged", async () => {
    const org = await rootedOrg('org-store');
    const { hub, source } = fakeHub([org.genesis]);
    const store = new OrgStore('org-store', { persistence: memoryOrgPersistence(), source });
    await store.sync(org.pins);
    const told: Certificates[] = [];
    store.onChange((change) => told.push(change.certificates));
    const certificates: Certificates = { certs: [], retirements: [{ body: { org: 'org-store', keyId: 'k', notAfter: new Date().toISOString() }, sig: { kid: 'x', value: 'y' } }] };
    hub.certificates = certificates;
    expect(await store.sync(org.pins)).toEqual({ adopted: 0 });
    expect(store.certificates()).toEqual(certificates);
    expect(told).toEqual([certificates]);
  });

  it("advances on a channel's catch-up page as on the hub's, and pages its window to a peer behind it", async () => {
    const org = await rootedOrg('org-store');
    const store = new OrgStore('org-store', { persistence: memoryOrgPersistence(), source: fakeHub([org.genesis]).source });
    await store.sync(org.pins);
    const v2 = await signedBy(await nextOf(org.genesis), org.admin);
    const v3 = await signedBy(await nextOf(v2), org.admin);
    await store.advance([v3, v2], []);
    expect(store.head()).toEqual(v3);
    expect(store.since(1).states).toEqual([v2, v3]);
    await store.advance([await signedBy(await nextOf(v3), (await rootedOrg('x')).admin)], []);
    expect(store.head()).toEqual(v3);
  });
});

it("keeps a window of the chain's last 30 days and the head", async () => {
  const org = await rootedOrg('org-store');
  const v2 = await signedBy(await nextOf(org.genesis), org.admin);
  let now = Date.now();
  const store = new OrgStore('org-store', { persistence: memoryOrgPersistence(), source: fakeHub([org.genesis, v2]).source, now: () => now });
  await store.sync(org.pins);
  expect(store.held()!.chain).toHaveLength(2);
  now += CHAIN_WINDOW_MS + 1000;
  await store.advance([await signedBy(await nextOf(v2), org.admin)], []);
  // Issued "now" by the real clock: older than the window by the store's.
  expect(store.held()!.chain.map((s) => s.state.version)).toEqual([3]);
  expect(store.held()!.hashes).toHaveLength(3);
});

it('re-reads for one reason at most once a minute, and for another reason at once', async () => {
  const org = await rootedOrg('org-store');
  const { hub, source } = fakeHub([org.genesis]);
  let now = 1_000_000;
  const store = new OrgStore('org-store', { persistence: memoryOrgPersistence(), source, now: () => now });
  await store.sync(org.pins);
  expect(await store.refresh('vm-ref', org.pins)).toEqual({ adopted: 0 });
  expect(await store.refresh('vm-ref', org.pins)).toBeNull();
  expect(await store.refresh('cards', org.pins)).toEqual({ adopted: 0 });
  now += REFRESH_EVERY_MS;
  expect(await store.refresh('vm-ref', org.pins)).toEqual({ adopted: 0 });
  expect(hub.reads).toEqual([0, 1, 1, 1]);
});

it('loads what it adopted after a reload, and forgets it', async () => {
  const org = await rootedOrg('org-store');
  const persistence = memoryOrgPersistence();
  const first = new OrgStore('org-store', { persistence, source: fakeHub([org.genesis]).source });
  await first.sync(org.pins);
  const again = new OrgStore('org-store', { persistence, source: fakeHub([org.genesis]).source });
  await again.load();
  expect(again.head()).toEqual(org.genesis);
  await again.forget();
  expect(again.ready).toBe(false);
  expect(await persistence.load('org-store')).toBeNull();
});

it('shares a read still in flight with a second ask for the same reason, and holds off only once it finished', async () => {
  const org = await rootedOrg('org-store');
  const { hub, source } = fakeHub([org.genesis]);
  let release!: () => void;
  let gate: Promise<void> | null = null;
  const gated: OrgSource = async (since) => {
    if (gate) await gate;
    return source(since);
  };
  let now = 1_000_000;
  const store = new OrgStore('org-store', { persistence: memoryOrgPersistence(), source: gated, now: () => now });
  await store.sync(org.pins);
  gate = new Promise((resolve) => (release = resolve));
  const first = store.refresh('vm-ref', org.pins);
  const second = store.refresh('vm-ref', org.pins);
  let secondDone = false;
  void second.then(() => (secondDone = true));
  await new Promise((r) => setTimeout(r, 10));
  expect(secondDone).toBe(false); // not answered as if the read were done
  now += REFRESH_EVERY_MS + 1; // the read takes long: its minute counts from when it finishes
  release();
  expect(await first).toEqual({ adopted: 0 });
  expect(await second).toEqual({ adopted: 0 });
  expect(hub.reads).toEqual([0, 1]);
  expect(await store.refresh('vm-ref', org.pins)).toBeNull();
});
