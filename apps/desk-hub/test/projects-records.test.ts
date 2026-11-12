// The project registry at the hub (Interfaces §C): a machine's endpoint sends its projects record up its RL1 socket, the
// Registry keeps the newest per machine (`projects_records`), and hands every record to every member's app on the
// Registry socket and to every machine's endpoint on its own: a snapshot in `projects-all` pages (after the listings on
// an app's socket, after the welcome on an endpoint's), then `projects` as each is stored. The Relay advertises
// `projects` only once the Registry has answered its probe; a deploy replaces the two objects at different moments, so
// each is run here against the other as the build before projects records left it. A push to a machine's object is owed
// in storage from its store until that object answers, so one lost with a reset of the Registry, or failing for longer
// than an in-memory retry would wait, reaches the endpoint by the alarm, on the connection it has.
import { base64urlEncode, generateSigningKey, keyId, LISTINGS_PAGE_BYTES, SIGNING_DOMAINS, signRecord, type ProjectLocation, type ProjectsRecord, type Signed, type SignedOrgState, type SigningKey } from 'org-protocol';
import { HubClient } from 'org-protocol/test-support';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeEndpoint } from '../fake-machine/endpoint';
import { enrollV2, projectsRecord, type V2Machine } from '../fake-machine/org';
import { RETRY_ATTEMPTS } from '../src/objects/retry';
import { encodeEnrollmentCodeV2 } from '../src/protocol/identity';
import { ADMIN, credentials, ORG, startLocalHub, type LocalHub } from './support/local';
import { genesis, newDevice, next, signedBy, type TestDevice } from './support/org';

let hub: LocalHub;
let client: HubClient;
let a1: TestDevice;
let recovery: SigningKey;
let head: SignedOrgState;
let A: string;
let mini: V2Machine;
let peer: V2Machine;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil(probe: () => Promise<boolean>, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await probe())) {
    if (Date.now() > deadline) throw new Error('timed out');
    await sleep(20);
  }
}

async function accept(edit: Parameters<typeof next>[1]): Promise<void> {
  const s = await signedBy(await next(head, edit), a1);
  const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: s });
  if (response.status !== 201) throw new Error(`state: ${response.status} ${await response.text()}`);
  head = s;
}

/** A v2 machine the org state lists, as RL1 needs. */
async function listed(name: string): Promise<V2Machine> {
  const response = await hub.fetchAs(ADMIN, '/api/enrollments', { body: {} });
  const { token } = (await response.json()) as { token: string };
  const code = encodeEnrollmentCodeV2({ hub: hub.url, token, roots: [await keyId(a1.stepUp!.pub)], recoveryPub: recovery.pub, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) });
  const machine = await enrollV2(code, name);
  await accept((s) => {
    s.machines.push({ name, ref: machine.ref, pub: machine.key.pub, owners: [A] });
    s.machineNames.push({ name, ref: machine.ref });
  });
  return machine;
}

const endpointOf = (machine: V2Machine) => new FakeEndpoint({ hub: hub.url, credentials: machine.credentials, ref: machine.ref });
const location = (i: number, pad = 0): ProjectLocation => ({
  pid: `row-${i}`,
  id: `p${i}`,
  key: `folder:${i}`,
  name: `project ${i}`,
  path: `/Users/someone/${'d'.repeat(pad)}${i}`,
  source: 'folder',
});
/** Locations whose record's JSON comes to about `bytes`: one page of the snapshot each. */
const bulky = (bytes: number) => Array.from({ length: Math.ceil(bytes / 700) }, (_, i) => location(i, 600));
const sent = (record: Signed<ProjectsRecord>) => ({ t: 'projects', record });
type Frame = { t: string } & Record<string, unknown>;
type Frames = { frames: Frame[] };
/** The `projects` frames a socket received from frame `from` on, as `ref@revision`. */
const live = (socket: Frames, from = 0) =>
  socket.frames.slice(from).flatMap((f) => (f.t === 'projects' ? [`${(f.record as Signed<ProjectsRecord>).body.machine}@${(f.record as Signed<ProjectsRecord>).body.revision}`] : []));
/** The records of a socket's `projects-all` pages, in order, as `ref@revision`, once its last page came. */
async function snapshot(socket: Frames & { next(p: (f: Frame) => boolean, what: string, from?: number): Promise<unknown> }, from = 0): Promise<string[]> {
  await socket.next((f) => f.t === 'projects-all' && f.last === true, 'the last projects page', from);
  const pages = socket.frames.slice(from).filter((f) => f.t === 'projects-all');
  return pages.flatMap((p) => (p.records as Signed<ProjectsRecord>[]).map((r) => `${r.body.machine}@${r.body.revision}`));
}

beforeAll(async () => {
  hub = await startLocalHub();
  client = new HubClient(hub.url, credentials(ADMIN));
  A = (await client.me()).member.id;
  a1 = await newDevice('a1');
  recovery = await generateSigningKey();
  head = await signedBy(await genesis(ORG, A, ADMIN, a1, recovery), a1);
  expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: head })).status).toBe(201);
  mini = await listed('mini');
  peer = await listed('peer');
});
afterAll(() => hub?.close());

describe('a machine’s projects record', () => {
  it('is kept and handed to every app and every machine, its own included; the same bytes again store nothing', async () => {
    const [ownEnd, peerEnd] = [endpointOf(mini), endpointOf(peer)];
    expect((await ownEnd.connect()).capabilities).toEqual(['audience', 'projects']);
    await peerEnd.connect();
    // Nothing is held yet: one empty page after each welcome.
    expect(await snapshot(ownEnd)).toEqual([]);
    expect(await snapshot(peerEnd)).toEqual([]);
    const app = await client.registry();
    expect(await snapshot(app)).toEqual([]);

    const r1 = await projectsRecord(mini, 1, [location(1)], [{ id: 'p9', name: 'known' }]);
    ownEnd.sendText(sent(r1));
    await app.next((f) => f.t === 'projects', 'the record at the app');
    await peerEnd.next((f) => f.t === 'projects', 'the record at another machine');
    await ownEnd.next((f) => f.t === 'projects', 'the record at its own machine');
    expect([live(app), live(peerEnd), live(ownEnd)]).toEqual([[`${mini.ref}@1`], [`${mini.ref}@1`], [`${mini.ref}@1`]]);
    expect((app.frames.find((f) => f.t === 'projects') as unknown as { record: unknown }).record).toEqual(r1);

    // The same bytes again: taken, refused nothing, sent nowhere. A stale record after it is answered behind it, in
    // the connection's order of Registry calls.
    const [appFrom, peerFrom] = [app.frames.length, peerEnd.frames.length];
    const from = ownEnd.frames.length;
    ownEnd.sendText(sent(r1));
    ownEnd.sendText(sent(await projectsRecord(mini, 1, [location(2)])));
    const refused = await ownEnd.next((f) => f.t === 'refusal', 'the stale refusal', from);
    expect(refused).toMatchObject({ frame: 'projects', status: 409, error: 'stale-projects', revision: 1 });
    expect(refused.message).toMatch(/revision 1\b/);
    expect(ownEnd.frames.slice(from).filter((f) => f.t === 'refusal')).toHaveLength(1);
    await sleep(300);
    expect([live(app, appFrom), live(peerEnd, peerFrom), live(ownEnd, from)]).toEqual([[], [], []]);
    app.close();
    ownEnd.close();
    peerEnd.close();
  });

  it('refuses a revision below the held one, a malformed record, one that fails verification with its code, and another machine’s', async () => {
    const endpoint = endpointOf(mini);
    await endpoint.connect();
    await snapshot(endpoint);
    const refusal = async (record: unknown) => {
      const from = endpoint.frames.length;
      endpoint.sendText({ t: 'projects', record });
      return endpoint.next((f) => f.t === 'refusal', 'a refusal', from);
    };
    const from = endpoint.frames.length;
    endpoint.sendText(sent(await projectsRecord(mini, 2, [location(1)])));
    await endpoint.next((f) => f.t === 'projects', 'revision 2 kept', from);
    expect(await refusal(await projectsRecord(mini, 1, [location(3)]))).toMatchObject({ frame: 'projects', status: 409, error: 'stale-projects', revision: 1, message: 'the projects record held is at revision 2' });
    // Two locations at one path is no record (`isProjectsRecord`).
    expect(await refusal(await projectsRecord(mini, 5, [location(1), { ...location(2), path: location(1).path }]))).toMatchObject({ frame: 'projects', status: 400, error: 'malformed' });
    // Signed by the machine's key under another domain: the verdict's code.
    const body: ProjectsRecord = { org: mini.org, machine: mini.ref, revision: 6, issued: new Date().toISOString(), locations: [], known: [] };
    expect(await refusal(await signRecord(SIGNING_DOMAINS.endpoint, body, mini.key.privateKey, mini.key.pub))).toMatchObject({ frame: 'projects', status: 403, error: 'bad-signature', revision: 6 });
    // Another org's record verifies against no state of this one.
    expect(await refusal(await signRecord(SIGNING_DOMAINS.projects, { ...body, org: 'another-org' }, mini.key.privateKey, mini.key.pub))).toMatchObject({ frame: 'projects', status: 400, error: 'malformed' });
    expect(await refusal(await projectsRecord(peer, 7))).toMatchObject({ frame: 'projects', status: 403, error: 'not-yours', revision: 7 });
    endpoint.close();
  });
});

describe('the snapshot', () => {
  let held: string[];

  beforeAll(async () => {
    // Two records of about two hundred KiB each: a page apiece under the listings' budget.
    for (const [machine, revision] of [
      [mini, 10],
      [peer, 10],
    ] as const) {
      const endpoint = endpointOf(machine);
      await endpoint.connect();
      await snapshot(endpoint);
      const from = endpoint.frames.length;
      endpoint.sendText(sent(await projectsRecord(machine, revision, bulky(200 * 1024))));
      await endpoint.next((f) => f.t === 'projects' && live({ frames: [f] }).includes(`${machine.ref}@${revision}`), 'its own record back', from);
      endpoint.close();
    }
    held = [mini.ref, peer.ref].sort().map((ref) => `${ref}@10`);
  });

  it('comes on the app socket after the listings pages, a page per record here, and a later record arrives live', async () => {
    const app = await client.registry();
    expect(await snapshot(app)).toEqual(held);
    const kinds = app.frames.map((f) => f.t);
    expect(kinds.lastIndexOf('listings')).toBeLessThan(kinds.indexOf('projects-all'));
    const pages = app.frames.filter((f) => f.t === 'projects-all') as unknown as Array<{ records: Signed<ProjectsRecord>[]; last: boolean }>;
    expect(pages.map((p) => [p.records.length, p.last])).toEqual([
      [1, false],
      [1, true],
    ]);
    for (const page of pages) expect(JSON.stringify(page.records).length).toBeLessThanOrEqual(LISTINGS_PAGE_BYTES);

    // An endpoint's snapshot comes the same way, read from the Registry a page per call.
    await hub.projectPageFault(0);
    const reader = endpointOf(mini);
    await reader.connect();
    expect(await snapshot(reader)).toEqual(held);
    const read = reader.frames.filter((f) => f.t === 'projects-all') as unknown as Array<{ records: Signed<ProjectsRecord>[]; last: boolean }>;
    expect(read.map((p) => [p.records.length, p.last])).toEqual([
      [1, false],
      [1, true],
    ]);
    expect((await hub.projectPageFault()).calls).toBe(2);
    reader.close();

    const endpoint = endpointOf(peer);
    await endpoint.connect();
    const from = app.frames.length;
    endpoint.sendText(sent(await projectsRecord(peer, 11, [location(1)])));
    await app.next((f) => f.t === 'projects', 'the later record', from);
    expect(live(app, from)).toEqual([`${peer.ref}@11`]);
    endpoint.close();
    app.close();
  });

  it('comes on an endpoint socket after its welcome; another machine’s change, and its own, arrive live', async () => {
    const endpoint = endpointOf(mini);
    await endpoint.connect();
    const records = await snapshot(endpoint);
    expect(records).toEqual([mini.ref, peer.ref].sort().map((ref) => (ref === peer.ref ? `${ref}@11` : `${ref}@10`)));
    const kinds = endpoint.frames.map((f) => f.t);
    expect(kinds.indexOf('welcome')).toBeLessThan(kinds.indexOf('projects-all'));

    const other = endpointOf(peer);
    await other.connect();
    await snapshot(other);
    let from = endpoint.frames.length;
    other.sendText(sent(await projectsRecord(peer, 12, [location(4)])));
    await endpoint.next((f) => f.t === 'projects', 'another machine’s change', from);
    expect(live(endpoint, from)).toEqual([`${peer.ref}@12`]);
    from = endpoint.frames.length;
    endpoint.sendText(sent(await projectsRecord(mini, 12, [location(5)])));
    await endpoint.next((f) => f.t === 'projects', 'its own change', from);
    expect(live(endpoint, from)).toEqual([`${mini.ref}@12`]);
    other.close();
    endpoint.close();
  });
});

describe('a snapshot the Registry cannot give', () => {
  beforeAll(() => hub.retryBase({ relay: mini.ref }, 5));

  it('is asked again on the same connection and arrives whole, the socket kept', async () => {
    await hub.projectPageFault(3);
    const endpoint = endpointOf(mini);
    const { generation } = await endpoint.connect();
    expect(await snapshot(endpoint)).toHaveLength(2);
    expect(await hub.projectPageFault()).toMatchObject({ remaining: 0, calls: 3 + 1 });
    const from = endpoint.frames.length;
    endpoint.sendText({ t: 'hb', generation });
    await endpoint.next((f) => f.t === 'hb-ack', 'hb-ack', from);
    expect([endpoint.isOpen, endpoint.ends]).toEqual([true, []]);
    endpoint.close();
  });

  it('is given up after retry.ts’s attempts with the connection kept: no last page, and live records still come', async () => {
    await hub.projectPageFault(RETRY_ATTEMPTS);
    const endpoint = endpointOf(mini);
    const { generation } = await endpoint.connect();
    await waitUntil(async () => (await hub.projectPageFault()).calls === RETRY_ATTEMPTS);
    await sleep(100);
    expect(endpoint.frames.some((f) => f.t === 'projects-all')).toBe(false);
    let from = endpoint.frames.length;
    endpoint.sendText({ t: 'hb', generation });
    await endpoint.next((f) => f.t === 'hb-ack', 'hb-ack', from);
    expect([endpoint.isOpen, endpoint.ends]).toEqual([true, []]);
    const other = endpointOf(peer);
    await other.connect();
    from = endpoint.frames.length;
    other.sendText(sent(await projectsRecord(peer, 13, [location(6)])));
    await endpoint.next((f) => f.t === 'projects', 'a live record after the snapshot was given up', from);
    expect(live(endpoint, from)).toEqual([`${peer.ref}@13`]);
    other.close();
    endpoint.close();
  });
});

describe('a snapshot whose connection ends while it is read', () => {
  /** The relay's log lines of failed page reads for a connection of `generation`. */
  const failedReads = (generation: number) => hub.runtimeLogs.filter((l) => l.message.includes('"event":"projects-page-failed"') && l.message.includes(`"generation":${generation},`)).length;

  it('cancels a retry’s wait and lets go of what it held: no timer pending, nothing held, no read after', async () => {
    await hub.retryBase({ relay: mini.ref }, 2000);
    try {
      const other = endpointOf(peer);
      await other.connect();
      await snapshot(other);
      await hub.projectPageFault(1);
      const endpoint = endpointOf(mini);
      const { generation } = await endpoint.connect();
      await waitUntil(async () => (await hub.relaySnapshot(mini.ref))?.waiting === true);
      expect(failedReads(generation)).toBe(1);
      // A record stored meanwhile is held for the snapshot's end.
      other.sendText(sent(await projectsRecord(peer, 14, [location(7)])));
      await waitUntil(async () => (await hub.relaySnapshot(mini.ref))?.held === 1);
      endpoint.close();
      // Ended with the connection, well before the wait (a second at least) would have run out.
      await waitUntil(async () => (await hub.relaySnapshot(mini.ref)) === null, 500);
      // Past the longest the wait could have been: nothing was read again.
      await sleep(2200);
      expect(await hub.projectPageFault()).toMatchObject({ remaining: 0, calls: 1 });
      expect(await hub.relaySnapshot(mini.ref)).toBeNull();
      other.close();
    } finally {
      await hub.retryBase({ relay: mini.ref }, 5);
    }
  });

  it('schedules no wait for a read that fails after its connection ended', async () => {
    await hub.projectPageFault(1, { hold: true });
    const endpoint = endpointOf(mini);
    const { generation } = await endpoint.connect();
    await waitUntil(async () => (await hub.projectPageFault()).held);
    endpoint.close();
    await waitUntil(async () => (await hub.relaySnapshot(mini.ref)) === null);
    await hub.projectPageFault(undefined, { release: true });
    await sleep(300);
    expect(failedReads(generation)).toBe(0);
    expect(await hub.projectPageFault()).toMatchObject({ remaining: 0, calls: 1, held: false });
    expect(await hub.relaySnapshot(mini.ref)).toBeNull();
  });
});

describe('the Relay and the Registry deployed at different moments', () => {
  it('a Relay of this build against a Registry of the build before: no `projects` in the welcome, a record refused hub-updating', async () => {
    await hub.registryLacks('projects');
    try {
      const endpoint = endpointOf(mini);
      const welcome = await endpoint.connect();
      expect(welcome.capabilities).toEqual(['audience']);
      const from = endpoint.frames.length;
      endpoint.sendText(sent(await projectsRecord(mini, 20, [location(1)])));
      expect(await endpoint.next((f) => f.t === 'refusal', 'the refusal', from)).toMatchObject({ frame: 'projects', status: 503, error: 'hub-updating', revision: 20 });
      // The connection is whole, and is sent no record.
      endpoint.sendText({ t: 'hb', generation: welcome.generation });
      await endpoint.next((f) => f.t === 'hb-ack', 'hb-ack', from);
      await sleep(200);
      expect(endpoint.frames.some((f) => f.t === 'projects-all' || f.t === 'projects')).toBe(false);
      endpoint.close();
    } finally {
      await hub.registryLacks(null);
    }
    // The Registry updated, the next connection is welcomed with `projects` and its snapshot, and the record is kept.
    const endpoint = endpointOf(mini);
    expect((await endpoint.connect()).capabilities).toEqual(['audience', 'projects']);
    await snapshot(endpoint);
    const from = endpoint.frames.length;
    endpoint.sendText(sent(await projectsRecord(mini, 20, [location(1)])));
    await endpoint.next((f) => f.t === 'projects', 'the record kept', from);
    expect(live(endpoint, from)).toEqual([`${mini.ref}@20`]);
    endpoint.close();
  });

  it('a Registry of this build against a Relay of the build before: the record is kept and sent on, and that Relay is passed by', async () => {
    await hub.retryBase('registry', 20);
    const own = endpointOf(mini);
    const old = endpointOf(peer);
    await own.connect();
    await snapshot(own);
    const { generation } = await old.connect();
    await snapshot(old);
    const app = await client.registry();
    await snapshot(app);
    await hub.relayLacks(peer.ref, 'projects');
    try {
      const calls = await hub.relayProjectsCalls(peer.ref);
      const [appFrom, oldFrom, ownFrom] = [app.frames.length, old.frames.length, own.frames.length];
      own.sendText(sent(await projectsRecord(mini, 21, [location(1)])));
      await app.next((f) => f.t === 'projects', 'the record at the app', appFrom);
      await own.next((f) => f.t === 'projects', 'the record at its own machine', ownFrom);
      await sleep(400);
      // Called once and not again: a ref object without the method is the build before, not a failure.
      expect(await hub.relayProjectsCalls(peer.ref)).toBe(calls + 1);
      expect(live(old, oldFrom)).toEqual([]);
      old.sendText({ t: 'hb', generation });
      await old.next((f) => f.t === 'hb-ack', 'hb-ack', oldFrom);
    } finally {
      await hub.relayLacks(peer.ref, null);
    }
    // A failure that is not the build before is tried again, and the record arrives.
    await hub.relayFault(peer.ref, 'relayProjects', 1);
    const calls = await hub.relayProjectsCalls(peer.ref);
    const oldFrom = old.frames.length;
    own.sendText(sent(await projectsRecord(mini, 22, [location(1)])));
    await old.next((f) => f.t === 'projects', 'the record after a retry', oldFrom);
    expect(live(old, oldFrom)).toEqual([`${mini.ref}@22`]);
    expect(await hub.relayProjectsCalls(peer.ref)).toBe(calls + 2);
    app.close();
    own.close();
    old.close();
  });
});

describe('a push the Registry lost', () => {
  beforeAll(() => hub.retryBase('registry', 20));

  /** Two endpoints connected, each past its snapshot; `other`'s generation for its heartbeats. */
  async function connected() {
    const own = endpointOf(mini);
    const other = endpointOf(peer);
    await own.connect();
    await snapshot(own);
    const { generation } = await other.connect();
    await snapshot(other);
    return { own, other, generation };
  }

  /** The connection kept, with no welcome or snapshot since `from`: what reached it came live. */
  async function sameConnection(endpoint: FakeEndpoint, generation: number, from: number): Promise<void> {
    expect(endpoint.frames.slice(from).filter((f) => f.t === 'welcome' || f.t === 'projects-all')).toEqual([]);
    const at = endpoint.frames.length;
    endpoint.sendText({ t: 'hb', generation });
    await endpoint.next((f) => f.t === 'hb-ack', 'hb-ack', at);
    expect([endpoint.isOpen, endpoint.ends]).toEqual([true, []]);
  }

  it('with a reset between the store and the push reaches every endpoint by the alarm, on the same connections', async () => {
    hub.expectRuntimeLog(/terminated by the suite/);
    const { own, other, generation } = await connected();
    await hub.projectsPushReset(true);
    const [ownFrom, otherFrom] = [own.frames.length, other.frames.length];
    own.sendText(sent(await projectsRecord(mini, 30, [location(8)])));
    await other.next((f) => f.t === 'projects', 'the record at another machine', otherFrom);
    await own.next((f) => f.t === 'projects', 'the record at its own machine', ownFrom);
    // The Registry was reset once, after the store and before any push left it: what came, the alarm sent.
    expect(await hub.projectsPushReset()).toEqual({ armed: false, resets: 1 });
    expect([live(other, otherFrom), live(own, ownFrom)]).toEqual([[`${mini.ref}@30`], [`${mini.ref}@30`]]);
    await sameConnection(other, generation, otherFrom);
    own.close();
    other.close();
  });

  it('failing past retry.ts’s attempts is sent again by the alarm until it arrives, on the same connection', async () => {
    const { own, other, generation } = await connected();
    // Every attempt the in-memory retry made fails; the next one is the alarm's.
    await hub.relayFault(peer.ref, 'relayProjects', RETRY_ATTEMPTS);
    const calls = await hub.relayProjectsCalls(peer.ref);
    const from = other.frames.length;
    own.sendText(sent(await projectsRecord(mini, 31, [location(9)])));
    await other.next((f) => f.t === 'projects', 'the record after every attempt failed', from, 20_000);
    expect(live(other, from)).toEqual([`${mini.ref}@31`]);
    expect(await hub.relayProjectsCalls(peer.ref)).toBe(calls + RETRY_ATTEMPTS + 1);
    await sameConnection(other, generation, from);
    own.close();
    other.close();
  });
});
