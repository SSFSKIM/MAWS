// The hub link against the hub itself (O10 M3's Proves): desk-hub's Worker in Miniflare (miniflare-hub.ts), an endpoint
// enrolled and listed in a throwaway org the way the member's app lists one. Its welcome and the state notice; the
// heartbeat keeping its lease; a forced cut (its object evicted with its sockets) and a redeploy each reconnected under a
// higher generation; `stale-generation` retried at once; `not-listed` after a rename stopping it (`re-enroll`); `503`
// retried; a second replacement within a minute stopping it (`replaced`); its endpoint record and a listing stored and
// served (`GET /api/listings` as a member), and withdrawn when its session goes private; a notify pushed to the
// listing's owner and to no other member.
import * as fs from 'node:fs';
import { join } from 'node:path';
import { base64urlEncode, generateSigningKey, keyId, RL1_PROTOCOL, verifyEndpointRecord, verifyListing, NO_CERTIFICATES, type SignedOrgState, type SigningKey, type OrgState } from 'org-protocol';
import { encodeEnrollmentCodeV2, type EnrollmentIssued, type EnrollmentKey, type Listings as HubListings } from 'desk-hub/protocol';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decrypt, userAgent } from '../../apps/desk-hub/test/support/push';
import { createEndpoint, type Endpoint } from '../../src/endpoint';
import { fakeServices, type FakeServices } from './fake-services';
import { ADMIN, ORG, startMiniflareHub, type LocalHub } from './miniflare-hub';
import { genesis, memberId, newDevice, successor, type TestDevice } from './org-fixtures';

let hub: LocalHub;
let stopHub: () => Promise<void>;
let a1: TestDevice;
let recovery: SigningKey;
let head: SignedOrgState;
let A: string;
const B = memberId();
const MEMBER_B = 'b@example.com';
const started: Array<{ endpoint: Endpoint; services: FakeServices }> = [];
const sockets: WebSocket[] = [];
const uuid = () => crypto.randomUUID();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls `check` every 25 ms until it answers truthy, or fails after `ms` naming `what`. */
async function until<T>(check: () => T | Promise<T>, what: string, ms = 15_000): Promise<NonNullable<T>> {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = await check();
    if (found) return found as NonNullable<T>;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await sleep(25);
  }
}

async function accept(edit: (s: OrgState) => void): Promise<void> {
  const next = await successor(head, [a1], edit);
  const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: next });
  if (response.status !== 201) throw new Error(`state: ${response.status} ${await response.text()}`);
  head = next;
}

beforeAll(async () => {
  ({ hub, stop: stopHub } = await startMiniflareHub());
  A = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
  a1 = await newDevice('a1');
  recovery = await generateSigningKey();
  head = await genesis(ORG, A, a1, recovery);
  expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: head })).status).toBe(201);
  const b1 = await newDevice('b1');
  await accept((s) => void s.members.push({ id: B, email: MEMBER_B, role: 'member', devices: [b1.device] }));
}, 120_000);

afterAll(async () => {
  for (const socket of sockets) socket.terminate();
  for (const { endpoint, services } of started) {
    await endpoint.stop();
    services.cleanup();
  }
  await stopHub?.();
});

type Listed = { endpoint: Endpoint; services: FakeServices; ref: string; name: string; credentials: { clientId: string; clientSecret: string } };

/** A started endpoint, enrolled through its command line and listed by the admin; resolves once its link is welcomed. */
async function listedEndpoint(name: string, before?: (ref: string) => Promise<void>, fetchVia?: typeof fetch): Promise<Listed> {
  const services = fakeServices();
  const endpoint = createEndpoint({ build: 'm3-suite', sleep: (ms) => sleep(Math.min(ms, 50)), fetch: fetchVia });
  await endpoint.start(services);
  started.push({ endpoint, services });
  const ref = services.machine.ref;
  await before?.(ref);
  const issued = (await (await hub.fetchAs(ADMIN, '/api/enrollments', { body: {} })).json()) as EnrollmentIssued;
  const code = encodeEnrollmentCodeV2({ hub: hub.url, token: issued.token, roots: [await keyId(a1.stepUp.pub)], recoveryPub: recovery.pub, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) });
  const enrolling = endpoint.cli('enroll', ['--name', name, '--wait', '30', '--json'], code);
  const key = await until(async () => {
    const response = await hub.fetchAs(ADMIN, `/api/enrollments/${issued.enrollment.id}/key`);
    return response.status === 200 ? ((await response.json()) as EnrollmentKey) : (await response.body?.cancel(), null);
  }, 'the posted key');
  await accept((s) => {
    s.machines.push({ name, ref, pub: key.pub, owners: [A] });
    s.machineNames.push({ name, ref });
  });
  expect((await enrolling).code).toBe(0);
  await until(() => endpoint.hub.connected, 'the hub link’s welcome');
  const enrollment = JSON.parse(fs.readFileSync(join(services.machine.stateDir, 'enrollment.json'), 'utf8')) as { credentials: Listed['credentials'] };
  return { endpoint, services, ref, name, credentials: enrollment.credentials };
}

/** Settles as `promise` does, or fails after `ms` naming `what`: a wait on the hub that can't hang the suite. */
function within<T>(promise: Promise<T>, what: string, ms = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`no ${what} within ${ms} ms`)), ms)));
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * Another RL1 connection under the same credentials (a second daemon holding the machine's key), once its hello is sent:
 * its generation once welcomed (a rejection should it close first), and its close code. The hub retires the connection
 * it replaces at the upgrade, so the endpoint, replaced, may connect again and replace this one before its welcome.
 */
async function rawEndpoint(listed: Listed): Promise<{ welcomed: Promise<number>; closed: Promise<number> }> {
  const socket = new WebSocket(`${hub.url.replace(/^http/, 'ws')}/machine/socket`, { headers: { 'CF-Access-Client-Id': listed.credentials.clientId, 'CF-Access-Client-Secret': listed.credentials.clientSecret } });
  sockets.push(socket);
  const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)));
  const welcomed = new Promise<number>((resolve, reject) => {
    socket.on('message', (data) => {
      const frame = JSON.parse(String(data)) as { t: string; generation?: number };
      if (frame.t === 'welcome') resolve(frame.generation as number);
    });
    socket.on('close', (code) => reject(new Error(`closed ${code} before its welcome`)));
  });
  welcomed.catch(() => {});
  await within(new Promise((resolve, reject) => socket.once('open', resolve).once('error', reject)), 'open socket');
  socket.send(JSON.stringify({ t: 'hello', protocol: RL1_PROTOCOL, build: 'twin', machine: listed.ref }));
  return { welcomed, closed };
}

const relayObject = (ref: string) => `${ORG}:ref:${ref}`;
const said = (listed: Listed, text: string) => listed.services.lines.some((line) => line.includes(text));

describe('the connection', () => {
  it('is welcomed under a generation, and reads the org state at once on the hub’s state notice', async () => {
    const listed = await listedEndpoint('m3-welcome');
    expect(listed.endpoint.status().hub).toEqual({ connected: true, generation: expect.any(Number) as number });
    await accept(() => {});
    // The 10-minute sync is far off: the notice brought it.
    await until(() => listed.endpoint.status().stateVersion === head.state.version, 'the new head read on the notice', 5000);
  });

  it('keeps its lease with its heartbeat: a project it opened stays online past the lease, and goes offline once the link stops', async () => {
    const project = uuid();
    const listed = await listedEndpoint('m3-lease', (ref) => hub.timing(`ref:${ref}`, { heartbeatMs: 300, leaseMs: 1200 }));
    const downs: string[] = [];
    listed.endpoint.hub.openProject(project, { hello: () => ({ name: 'lease-demo', have: {} }), down: (frame) => void downs.push(frame.t) });
    await until(() => downs.includes('have'), 'the project’s have');
    const grid = await gridOf(project);
    await until(() => grid.online() === 1, 'the project online');
    await sleep(3000);
    expect(grid.online()).toBe(1);
    expect(grid.seen.some((n) => n === 0)).toBe(false);
    await listed.endpoint.hub.stop();
    await until(() => grid.online() === 0, 'the project offline once no heartbeat renews it', 10_000);
  });

  it('survives a forced cut (its object evicted, its sockets closed) and a redeploy, each time under a higher generation', async () => {
    const listed = await listedEndpoint('m3-cut');
    const first = listed.endpoint.hub.generation as number;
    await hub.evict('Machine', relayObject(listed.ref), 'close');
    await until(() => (listed.endpoint.hub.generation ?? 0) > first, 'a reconnect after the eviction');
    const second = listed.endpoint.hub.generation as number;
    await hub.restart();
    await until(() => (listed.endpoint.hub.generation ?? 0) > second, 'a reconnect after the redeploy', 30_000);
    expect(listed.endpoint.status().refusing).toBeUndefined();
  });

  it('stays stopped when a read of the org state in flight at its stop ends after it (review finding 3)', async () => {
    let held: Promise<void> | null = null;
    const listed = await listedEndpoint('m3-stop', undefined, async (input, init) => {
      await held;
      return fetch(input, init);
    });
    await listed.endpoint.syncNow();
    let release!: () => void;
    held = new Promise<void>((resolve) => (release = resolve));
    const syncing = listed.endpoint.syncNow();
    await listed.endpoint.stop();
    expect(listed.endpoint.hub.running).toBe(false);
    release();
    await syncing;
    await sleep(300);
    expect(listed.endpoint.hub.running).toBe(false);
    expect(listed.endpoint.hub.connected).toBe(false);
  });
});

describe('the hub’s verdicts', () => {
  it('reconnects at once after 409 stale-generation (a newer connection installed while its claim was answered)', async () => {
    const listed = await listedEndpoint('m3-stale');
    await hub.holdClaim(listed.name);
    await hub.evict('Machine', relayObject(listed.ref), 'close');
    await until(() => hub.claimHeld(listed.name), 'the endpoint’s claim held');
    const twin = await rawEndpoint(listed);
    const generation = await within(twin.welcomed, 'twin’s welcome');
    await hub.releaseClaim(listed.name);
    await until(() => said(listed, '409 stale-generation; connecting again at once'), 'the stale-generation verdict');
    expect(await within(twin.closed, 'twin’s close')).toBe(4409);
    await until(() => (listed.endpoint.hub.generation ?? 0) > generation, 'the endpoint installed again');
  });

  it('tries a 503 again with its backoff', async () => {
    const listed = await listedEndpoint('m3-busy');
    await hub.registryLacks('machineBinds');
    try {
      await hub.evict('Machine', relayObject(listed.ref), 'close');
      await until(() => said(listed, '503 hub-updating'), 'the 503');
    } finally {
      await hub.registryLacks(null);
    }
    await until(() => listed.endpoint.hub.connected, 'the reconnect once the Registry answers');
  });

  it('stops with `re-enroll` when a rename leaves its name unlisted (409 not-listed)', async () => {
    const listed = await listedEndpoint('m3-rename');
    await accept((s) => {
      s.machines.find((m) => m.ref === listed.ref)!.name = 'm3-renamed';
      s.machineNames.push({ name: 'm3-renamed', ref: listed.ref });
    });
    await hub.evict('Machine', relayObject(listed.ref), 'close');
    await until(() => listed.endpoint.status().refusing === 're-enroll', 'the stop');
    expect(said(listed, '409 not-listed')).toBe(true);
    expect(listed.endpoint.status().hub).toEqual({ connected: false });
    const lines = listed.services.lines.length;
    await sleep(1500);
    expect(listed.services.lines.slice(lines).some((line) => line.includes('connected to the hub'))).toBe(false);
  });

  it('reconnects once after a replacement, and stops with `replaced` when replaced again within a minute', async () => {
    const listed = await listedEndpoint('m3-twin');
    // Replaced, the endpoint connects again at once and replaces the twin, which may be before the twin's welcome
    // (tracker e7801606b: waiting for that welcome hung the test): only the twin's close is awaited.
    const first = await rawEndpoint(listed);
    expect(await within(first.closed, 'the first twin’s close')).toBe(4409);
    await until(() => listed.endpoint.hub.connected, 'the endpoint back');
    const lines = listed.services.lines.length;
    const second = await rawEndpoint(listed);
    await until(() => listed.endpoint.status().refusing === 'replaced', 'the stop');
    expect(listed.endpoint.hub.connected).toBe(false);
    // Stopped, the link schedules nothing more: the other daemon is welcomed and keeps the machine, and nothing fights it.
    let open = true;
    void second.closed.then(() => (open = false));
    await within(second.welcomed, 'the second twin’s welcome');
    expect(open).toBe(true);
    const after = listed.services.lines.slice(lines).filter((line) => line.includes('the hub connection'));
    expect(after).toHaveLength(1);
    expect(after[0]).toContain('stopped (replaced)');
  });
});

describe('the machine’s records', () => {
  it('stores and serves its endpoint record and the listings of the sessions it relays, re-issued when the machine’s owners change', async () => {
    const listed = await listedEndpoint('m3-lists');
    const project = uuid();
    listed.endpoint.hub.openProject(project, { hello: () => ({ name: 'lists', have: {} }), down: () => {} });
    const [shown, hidden, elsewhere] = [uuid(), uuid(), uuid()];
    await listed.endpoint.listings.report({ session: shown, project, lane: 'A', state: 'working', title: 'Fix the build', owners: ['@machine'] });
    await listed.endpoint.listings.report({ session: hidden, project, lane: 'B', state: 'idle', title: 'Private', owners: ['@machine'], access: 'private' });
    await listed.endpoint.listings.report({ session: elsewhere, project: uuid(), lane: 'A', state: 'idle', title: 'Not relayed', owners: ['@machine'] });
    const served = await until(async () => {
      const body = (await (await hub.fetchAs(ADMIN, '/api/listings')).json()) as HubListings;
      return body.listings.some((l) => l.body.session === shown) && body.endpoints.some((e) => e.body.machine === listed.ref) ? body : null;
    }, 'the listing and the endpoint record served');
    const listing = served.listings.find((l) => l.body.session === shown)!;
    expect(listing.body).toMatchObject({ org: ORG, machine: listed.ref, fields: { owners: [A], project, lane: 'A', state: 'working', title: 'Fix the build' } });
    expect(await verifyListing(head.state, listing, NO_CERTIFICATES, new Date())).toEqual({ ok: true });
    const record = served.endpoints.find((e) => e.body.machine === listed.ref)!;
    expect(record.body).toMatchObject({ org: ORG, machine: listed.ref, addresses: [] });
    expect(await verifyEndpointRecord(head.state, record, NO_CERTIFICATES, new Date())).toEqual({ ok: true });
    expect(served.listings.some((l) => l.body.session === hidden || l.body.session === elsewhere)).toBe(false);
    const file = join(listed.services.machine.stateDir, 'listings.json');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')) as object)).toEqual([shown]);

    // `@machine` follows the machine's owners: a new head that adds B re-issues the listing with a higher revision.
    await accept((s) => void (s.machines.find((m) => m.ref === listed.ref)!.owners = [A, B]));
    const reissued = await until(async () => {
      const body = (await (await hub.fetchAs(ADMIN, '/api/listings')).json()) as HubListings;
      const now = body.listings.find((l) => l.body.session === shown);
      return now !== undefined && now.body.revision > listing.body.revision ? now : null;
    }, 'the re-issued listing');
    expect(reissued.body.fields.owners).toEqual([A, B]);

    // Made private, it is withdrawn (RL6's `gone`): the hub keeps the tombstone and serves the session no more; listed
    // again, it is served at a higher revision.
    await listed.endpoint.listings.report({ session: shown, project, lane: 'A', state: 'working', title: 'Fix the build', owners: ['@machine'], access: 'private' });
    await until(async () => {
      const body = (await (await hub.fetchAs(ADMIN, '/api/listings')).json()) as HubListings;
      return body.listings.some((l) => l.body.session === shown) ? null : true;
    }, 'the withdrawn listing left out');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))[shown].record.body.fields.state).toBe('gone');
    await listed.endpoint.listings.report({ session: shown, project, lane: 'A', state: 'idle', title: 'Fix the build', owners: ['@machine'] });
    const back = await until(async () => {
      const body = (await (await hub.fetchAs(ADMIN, '/api/listings')).json()) as HubListings;
      return body.listings.find((l) => l.body.session === shown) ?? null;
    }, 'the session listed again');
    expect(back.body.fields.state).toBe('idle');
    expect(back.body.revision).toBeGreaterThan(reissued.body.revision);
  });

  it('pushes a notify to the devices of the listing’s owner, and to no other member’s', async () => {
    const listed = await listedEndpoint('m3-push');
    const project = uuid();
    listed.endpoint.hub.openProject(project, { hello: () => ({ name: 'push', have: {} }), down: () => {} });
    const [phoneA, phoneB] = await Promise.all([userAgent(`https://push.test/m3-a-${uuid()}`), userAgent(`https://push.test/m3-b-${uuid()}`)]);
    for (const [who, ua] of [[ADMIN, phoneA], [MEMBER_B, phoneB]] as const) {
      expect((await hub.fetchAs(who, '/api/push/subscriptions', { method: 'PUT', body: { endpoint: ua.endpoint, keys: ua.keys } })).status).toBe(200);
    }
    const session = uuid();
    const secret = uuid();
    await listed.endpoint.listings.report({ session, project, lane: 'A', state: 'waiting', title: 'Asks', owners: ['@machine'] });
    await listed.endpoint.listings.report({ session: secret, project, lane: 'A', state: 'waiting', title: 'Private', owners: ['@machine'], access: 'private' });
    await until(async () => ((await (await hub.fetchAs(ADMIN, '/api/listings')).json()) as HubListings).listings.some((l) => l.body.session === session), 'the listing stored');
    const pushedTo = async (from: number) => {
      const out: Array<{ to: string; notice: unknown }> = [];
      for (const push of hub.pushes.slice(from)) {
        const ua = [phoneA, phoneB].find((u) => u.endpoint === push.endpoint);
        if (ua !== undefined) out.push({ to: ua === phoneA ? 'A' : 'B', notice: JSON.parse(new TextDecoder().decode(await decrypt(ua, push.body))) });
      }
      return out;
    };

    let from = hub.pushes.length;
    listed.endpoint.notifier.pendingSet(project, [{ session }, { session: secret }]);
    await until(() => hub.pushes.length > from, 'the push');
    await sleep(300);
    expect(await pushedTo(from)).toEqual([{ to: 'A', notice: { project, machine: listed.ref, session, kind: 'waiting' } }]);

    // Settled pushes nothing.
    from = hub.pushes.length;
    listed.endpoint.notifier.pendingSet(project, []);
    await sleep(500);
    expect(hub.pushes.length).toBe(from);

    // A to-human message, sent outside any subscription, is `wrote`, once however often sminos sends it again.
    const host = { kind: 'host', session, project, sub: null, body: { event: { kind: 'message', writer: 'm3-push/host', seq: 1, text: 'done' } } };
    listed.endpoint.notifier.hostMessage(host);
    await until(() => hub.pushes.length > from, 'the wrote push');
    listed.endpoint.notifier.hostMessage(host);
    await sleep(500);
    expect(await pushedTo(from)).toEqual([{ to: 'A', notice: { project, machine: listed.ref, session, kind: 'wrote' } }]);
  });
});

/** The grid as a member's app reads it: each summary's `machines_online` for `project`, in order. */
async function gridOf(project: string): Promise<{ seen: number[]; online(): number | undefined }> {
  const socket = new WebSocket(`${hub.url.replace(/^http/, 'ws')}/api/registry/socket`, { headers: { 'x-desk-standin-user': ADMIN } });
  sockets.push(socket);
  const seen: number[] = [];
  socket.on('message', (data) => {
    const frame = JSON.parse(String(data)) as { t: string; project?: { id: string; machines_online: number }; projects?: Array<{ id: string; machines_online: number }> };
    const rows = frame.t === 'summary' && frame.project ? [frame.project] : frame.t === 'grid' ? (frame.projects ?? []) : [];
    for (const row of rows) if (row.id === project) seen.push(row.machines_online);
  });
  await new Promise((resolve, reject) => socket.once('open', resolve).once('error', reject));
  return { seen, online: () => seen.at(-1) };
}
