// The app's hub connection (OX8; O11 M7), through the Node reference client in apps/org-protocol/test-support: the
// Registry socket opened as an app's (`?app=1`) gains the org state's head version (`state`, on connect and at each
// accepted state) and the listings (`listings` pages on connect, `listing` as each is stored) after DX3's grid, while
// desk-web's grid socket, without the query, keeps the grid alone; and one
// member's client holds the Registry, Project and Machine sockets at once (acceptance 6), signing its words into the
// log with its device key and binding a push subscription to that device.
import { base64urlEncode, generateSigningKey, keyId, LISTING_GONE, LISTINGS_PAGE_BYTES, type Listing, type ListingsFrame, type Signed, type SignedOrgState, type SigningKey } from 'org-protocol';
import { deviceHuman, HubClient, HubRefusal, listingKey, referenceCheck, type RegistrySocket } from 'org-protocol/test-support';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeEndpoint } from '../fake-machine/endpoint';
import { enrollV2, listing, type V2Machine } from '../fake-machine/org';
import { encodeEnrollmentCodeV2 } from '../src/protocol/identity';
import { FRAME_LIMIT } from '../src/protocol/parts';
import { GridClient, waitFor } from './support/clients';
import { ADMIN, credentials, ORG, startLocalHub, type LocalHub } from './support/local';
import { genesis, memberId, newDevice, next, signedBy, type TestDevice } from './support/org';

let hub: LocalHub;
let client: HubClient;
let A: string;
let a1: TestDevice;
let recovery: SigningKey;
let head: SignedOrgState;
let mini: V2Machine;
let endpoint: FakeEndpoint;
const PROJECT = '3b8e2f4a-6c1d-4e5f-8a9b-0c1d2e3f4a5b';
const SESSION = 'a6b5c4d3-e2f1-4a0b-9c8d-7e6f5a4b3c2d';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fields = (state: string): Listing['fields'] => ({ owners: [A], project: PROJECT, lane: 'B', state, title: 'the app connection' });

async function accept(state: Promise<SignedOrgState['state']>): Promise<void> {
  const signed = await signedBy(await state, a1);
  const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: signed });
  if (response.status !== 201) throw new Error(`state: ${response.status} ${await response.text()}`);
  head = signed;
}

/** The listings a socket received after frame `from`, one per `listing` frame. */
const relayed = (socket: RegistrySocket, from: number) => socket.frames.slice(from).flatMap((f) => (f.t === 'listing' ? [(f as unknown as { record: Signed<Listing> }).record] : []));

beforeAll(async () => {
  hub = await startLocalHub();
  client = new HubClient(hub.url, credentials(ADMIN));
  A = (await client.me()).member.id;
  a1 = await newDevice('a1');
  recovery = await generateSigningKey();
});
afterAll(async () => {
  endpoint?.close();
  await hub?.close();
});

describe('the Registry socket', () => {
  it('sends the grid first, then every listing and no state before one exists; the genesis is noticed on it', async () => {
    const before = await client.registry();
    expect(before.frames.map((f) => f.t)).toEqual(['grid', 'listings']);
    expect(before.version).toBeNull();
    expect(before.listings.size).toBe(0);

    await accept(genesis(ORG, A, ADMIN, a1, recovery));
    expect(await before.next((f) => f.t === 'state', 'the genesis notice')).toEqual({ t: 'state', version: 1 });

    const after = await client.registry();
    expect(after.frames.map((f) => f.t)).toEqual(['grid', 'state', 'listings']);
    expect(after.version).toBe(1);
    before.close();
    after.close();
  });

  it('notices each accepted successor on every open socket, and a refused one on none', async () => {
    const one = await client.registry();
    const two = await client.registry();
    const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: await signedBy(await next(head), await newDevice('stranger')) });
    expect(response.status).toBe(409);
    const code = await hub.fetchAs(ADMIN, '/api/enrollments', { body: {} });
    const { token } = (await code.json()) as { token: string };
    mini = await enrollV2(encodeEnrollmentCodeV2({ hub: hub.url, token, roots: [await keyId(a1.stepUp!.pub)], recoveryPub: recovery.pub, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) }), 'mini');
    await accept(
      next(head, (s) => {
        s.machines.push({ name: 'mini', ref: mini.ref, pub: mini.key.pub, owners: [A] });
        s.machineNames.push({ name: 'mini', ref: mini.ref });
      }),
    );
    for (const socket of [one, two]) {
      await socket.next((f) => f.t === 'state' && f.version === 2, 'version 2');
      expect(socket.frames.filter((f) => f.t === 'state').map((f) => f.version)).toEqual([1, 2]);
    }
    one.close();
    two.close();
  });

  it('relays each listing as it is stored, and a new socket gets every listing at its newest; a repeat or a stale one is not relayed', async () => {
    const socket = await client.registry();
    endpoint = new FakeEndpoint({ hub: hub.url, credentials: mini.credentials, ref: mini.ref });
    await endpoint.connect();
    await endpoint.project(PROJECT, 'app-connection');

    let from = socket.frames.length;
    const first = await listing(mini, SESSION, 2, fields('working'));
    endpoint.listing(first);
    await socket.next((f) => f.t === 'listing', 'the first listing', from);
    expect(relayed(socket, from)).toEqual([first]);

    // The same record again (kept already) and an older revision (refused stale): nothing relayed.
    from = socket.frames.length;
    const endpointFrom = endpoint.frames.length;
    endpoint.listing(first);
    endpoint.listing(await listing(mini, SESSION, 1, fields('idle')));
    await endpoint.next((f) => f.t === 'refusal' && f.error === 'stale-listing', 'the stale refusal', endpointFrom);
    const second = await listing(mini, SESSION, 3, fields('waiting'));
    endpoint.listing(second);
    await socket.next((f) => f.t === 'listing', 'the second listing', from);
    await sleep(100);
    expect(relayed(socket, from)).toEqual([second]);
    expect(socket.listings.get(listingKey(second))).toEqual(second);

    const fresh = await client.registry();
    expect([...fresh.listings.values()]).toEqual([second]);
    expect((await client.listings()).listings).toEqual([second]);
    socket.close();
    fresh.close();
  });

  it('keeps a grid socket without the app query (desk-web’s) to the grid alone, as states are accepted and listings stored', async () => {
    const grid = await GridClient.open(hub, ADMIN);
    await accept(next(head));
    endpoint.listing(await listing(mini, SESSION, 4, fields('idle')));
    const app = await client.registry();
    await app.next((f) => f.t === 'state' && f.version === head.state.version, 'the state at the app');
    await waitFor(() => (app.listings.get(`${mini.ref}/${SESSION}`)?.body.revision === 4 ? true : undefined));
    // The grid socket is behind the app's in nothing: both were sent everything in the same steps.
    await sleep(200);
    expect(new Set(grid.frames.map((f) => f.t))).toEqual(new Set(['grid']));
    grid.close();
    app.close();
  });
});

describe('the reference client', () => {
  it('holds the Registry, Project and Machine sockets at once as the device’s member (acceptance 6, locally)', async () => {
    const lines: string[] = [];
    const result = await referenceCheck(
      { hub: hub.url, headers: credentials(ADMIN), project: PROJECT, machine: 'mini', device: { id: 'a1', key: a1.channel }, pushEndpoint: 'https://push.test/reference', frames: 32 },
      (l) => lines.push(`${l.status} ${l.step}: ${l.detail}`),
    );
    expect(result.lines.map((l) => [l.step, l.status])).toEqual([
      ['admitted', 'pass'],
      ['sockets', 'pass'],
      ['registry', 'pass'],
      ['project', 'pass'],
      ['machine', 'pass'],
      ['push', 'pass'],
      ['held', 'pass'],
    ]);
    expect(result).toMatchObject({ ok: true, member: A });
    // The device's words reached the machine syncing the project, signed and stored as the member's.
    const words = await endpoint.next((f) => f.t === 'events' && (f.events as Array<{ writer: string }>).some((e) => e.writer === `hub/${A}`), 'the human at the machine');
    const human = (words.events as Array<Record<string, unknown>>).find((e) => e.writer === `hub/${A}`)!;
    expect(human).toMatchObject({ kind: 'human', member: A, sig: { kid: await keyId(a1.channel.pub) } });
    expect(human.mac).toBeUndefined();
    // The subscription was removed after it was read back.
    expect((await client.pushSubscriptions()).subscriptions).toEqual([]);
  });

  it('is refused bad-signature for words signed by a key the state does not list, and unknown-device for another’s device', async () => {
    const project = await client.project(PROJECT);
    await project.catchUp();
    const forged = await deviceHuman({ org: ORG, project: PROJECT }, A, await generateSigningKey(), 'not mine');
    const answer = await project.say(forged);
    expect(answer).toMatchObject({ t: 'refused', refusal: { reason: 'bad-signature', nonce: forged.nonce } });
    project.close();
    const keys = { p256dh: base64urlEncode(new Uint8Array(65).fill(4)), auth: base64urlEncode(new Uint8Array(16)) };
    const refused = await client.registerPush({ endpoint: 'https://push.test/other', keys, device: memberId() }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(HubRefusal);
    expect(refused).toMatchObject({ status: 409, error: 'unknown-device' });
  });
});

describe('a withdrawn listing (RL6’s `gone`; the remote layer’s Decision Log 27)', () => {
  const WITHDRAWN = 'c7d6e5f4-a3b2-4c1d-8e9f-0a1b2c3d4e5f';
  const NEVER_LISTED = 'd8e7f6a5-b4c3-4d2e-9f0a-1b2c3d4e5f6a';
  const gone = (): Listing['fields'] => ({ owners: [], project: null, lane: 'B', state: LISTING_GONE, title: '' });
  const key = () => `${mini.ref}/${WITHDRAWN}`;
  const isListingOf = (session: string, revision: number) => (f: { t: string }) =>
    f.t === 'listing' && (f as unknown as { record: Signed<Listing> }).record.body.session === session && (f as unknown as { record: Signed<Listing> }).record.body.revision === revision;

  it('is kept for its high-water mark and relayed to a connected app, which drops the session; snapshots leave it out; listing it again is a new revision', async () => {
    const cached = await client.registry();
    const live = await listing(mini, WITHDRAWN, 5, fields('working'));
    endpoint.listing(live);
    await cached.next(isListingOf(WITHDRAWN, 5), 'the live listing');
    expect(cached.listings.get(key())).toEqual(live);

    // The tombstone reaches the app that cached the session, which drops it.
    const withdrawn = await listing(mini, WITHDRAWN, 6, gone());
    endpoint.listing(withdrawn);
    await cached.next(isListingOf(WITHDRAWN, 6), 'the tombstone');
    expect(cached.listings.has(key())).toBe(false);
    // Its owners went with it: nothing pushes for the session now.
    expect(await hub.registryRpc<string[] | null>('ownersOf', mini.ref, WITHDRAWN)).toEqual([]);

    // A replay of the older signed revision is refused: the gone revision holds the high-water mark.
    const endpointFrom = endpoint.frames.length;
    endpoint.listing(live);
    await endpoint.next((f) => f.t === 'refusal' && f.error === 'stale-listing' && f.session === WITHDRAWN, 'the replay refused', endpointFrom);

    // Every snapshot leaves it out: a reconnecting app's opening pages and GET /api/listings.
    const reconnected = await client.registry();
    expect(reconnected.listings.has(key())).toBe(false);
    expect(reconnected.frames.flatMap((f) => (f.t === 'listings' ? (f as unknown as ListingsFrame).records : [])).some((r) => r.body.session === WITHDRAWN)).toBe(false);
    expect((await client.listings()).listings.some((l) => l.body.session === WITHDRAWN)).toBe(false);

    // Listed again: a new, higher revision, served as any listing.
    const back = await listing(mini, WITHDRAWN, 7, fields('idle'));
    endpoint.listing(back);
    await reconnected.next(isListingOf(WITHDRAWN, 7), 'the listing again');
    expect(reconnected.listings.get(key())).toEqual(back);
    expect((await client.listings()).listings).toContainEqual(back);
    cached.close();
    reconnected.close();
  });

  it('is relayed to no app when no app could have held the session (the hub never served a live revision of it)', async () => {
    const app = await client.registry();
    const from = app.frames.length;
    const stored = await hub.registryRpc<{ ok: boolean; value: { stored: boolean } }>('storeListing', await listing(mini, NEVER_LISTED, 1, gone()));
    expect(stored).toEqual({ ok: true, value: { stored: true } });
    // A later live revision is relayed as any (an app's first sight of the session).
    endpoint.listing(await listing(mini, NEVER_LISTED, 2, fields('working')));
    await app.next(isListingOf(NEVER_LISTED, 2), 'the live listing');
    expect(relayed(app, from).map((r) => r.body.revision)).toEqual([2]);
    app.close();
  });
});

describe('a listing set past what one frame holds', () => {
  it('comes to an app as bounded pages, the last marked, and a grid socket never meets it', async () => {
    // 20 listings of about 900 KB each: past desk-web's 16 MiB bound on a frame's unfinished parts (PARTS_HELD_LIMIT).
    const title = 'x'.repeat(900 * 1024);
    const sessions = Array.from({ length: 20 }, (_, i) => `b1c2d3e4-f5a6-4b7c-8d9e-${i.toString(16).padStart(12, '0')}`);
    for (const session of sessions) {
      const stored = await hub.registryRpc<{ ok: boolean }>('storeListing', await listing(mini, session, 1, { ...fields('working'), title }));
      expect(stored.ok).toBe(true);
    }
    const grid = await GridClient.open(hub, ADMIN);
    const app = await client.registry();
    const pages = app.frames.filter((f) => f.t === 'listings') as unknown as ListingsFrame[];
    expect(pages.map((p) => p.last)).toEqual([...pages.slice(1).map(() => false), true]);
    for (const page of pages) {
      const bytes = page.records.reduce((sum, r) => sum + new TextEncoder().encode(JSON.stringify(r)).length, 0);
      expect(page.records.length === 1 || bytes <= LISTINGS_PAGE_BYTES).toBe(true);
    }
    expect(Math.max(...app.wire)).toBeLessThanOrEqual(FRAME_LIMIT);
    expect(app.listings.size).toBe((await client.listings()).listings.length);
    for (const session of sessions) expect(app.listings.has(`${mini.ref}/${session}`)).toBe(true);
    await sleep(300);
    expect(new Set(grid.frames.map((f) => f.t))).toEqual(new Set(['grid']));
    expect(Math.max(...grid.wire)).toBeLessThan(64 * 1024);
    grid.close();
    app.close();
  });
});
