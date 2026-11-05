// Every read surface of the hub against one private session's stream (P5 O18 M1, D6's one reader check): a stream with
// audience {A} is served to A's machines and browsers and to no one else, live, in a hello's `have` and backlog, on a
// browser's resume, in the audit record live and replayed, in each session-plane frame, and over HTTP (the history page,
// the inventory and the attestations). A reader outside it sees the plain writers go on with no hole, and A's own
// machine on an endpoint whose hello lacks `audience` gets none of it.
import { historyDigest, historyInventoryPath, historyLogPath, signRecord, SIGNING_DOMAINS, streamWriter, type HistoryAttestation, type HistoryInventory, type HistoryLogPage, type Signed } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { machineFetch } from '../fake-machine/org';
import { base64urlEncode } from '../src/protocol/base64url';
import { newNonce } from '../src/protocol/codes';
import type { ProjectDown } from '../src/protocol/browser';
import type { LogEvent } from '../src/protocol/log';
import { BrowserClient, waitFor } from './support/clients';
import { ADMIN, ORG, startLocalHub, type LocalHub } from './support/local';
import { AUDIENCE, joined, lastHave, newSession, reachOrg, say, upload, type ReachOrg } from './support/reach';
import type { Rl1Machine } from './support/rl1';

let hub: LocalHub;
let o: ReachOrg;
/** A's writing machine and A's second, B's, and A's on an endpoint whose hello advertises nothing. */
let mA: Rl1Machine;
let mA2: Rl1Machine;
let mB: Rl1Machine;
let mOld: Rl1Machine;

beforeAll(async () => {
  hub = await startLocalHub();
  o = await reachOrg(hub);
  mA = await o.org.machine('reads-a', { capabilities: AUDIENCE });
  mA2 = await o.org.machine('reads-a2', { capabilities: AUDIENCE });
  mB = await o.org.machine('reads-b', { capabilities: AUDIENCE, owners: [o.B] });
  mOld = await o.org.machine('reads-old');
});
afterAll(async () => {
  for (const m of [mA, mA2, mB, mOld]) m?.close();
  await hub?.close();
});

let projects = 0;
const newProject = () => `3b8c1f2a-6d4e-4b7a-9e50-${(++projects).toString(16).padStart(12, '0')}`;

/** A private session P of A's (audience {A}) and a listed one L, two events each, written on `mA`. */
async function written(project: string) {
  const P = newSession();
  const L = newSession();
  const events = [joined(mA, project, P, 1, [o.A], 1), say(mA, project, P, 2, [], [o.A]), joined(mA, project, L, 1), say(mA, project, L, 2, [])];
  expect(await upload(mA, project, events)).toEqual([]);
  return { P, L, stream: streamWriter(`${mA.name}/${P}`, [o.A]), plain: `${mA.name}/${L}` };
}

async function following(who: string, project: string): Promise<BrowserClient> {
  const browser = await BrowserClient.open(hub, who, project);
  browser.send({ t: 'resume', after: 0 });
  await browser.next((f) => f.t === 'caught-up', 'caught-up');
  return browser;
}

const writers = (machine: Rl1Machine, project: string) => [...(machine.log.get(project)?.keys() ?? [])];
const seqs = (machine: Rl1Machine, project: string, writer: string) => [...(machine.log.get(project)?.get(writer)?.keys() ?? [])].sort((a, b) => a - b);

describe('to machines', () => {
  it("live: the stream goes to A's machines that advertise audience, and to no one else", async () => {
    const project = newProject();
    for (const m of [mA, mA2, mB, mOld]) await m.sync(project);
    const { stream, plain } = await written(project);
    await mA2.reaches(project, { [stream]: 2, [plain]: 2 });
    for (const m of [mB, mOld]) {
      await waitFor(() => (seqs(m, project, plain).length === 2 ? true : undefined));
      expect(writers(m, project)).not.toContain(stream);
    }
  });

  it("in a hello's have and backlog: an outsider and an old endpoint are told nothing of the stream", async () => {
    const project = newProject();
    await mA.sync(project);
    const { stream, plain } = await written(project);
    for (const m of [mA2, mB, mOld]) await m.sync(project);
    await mA2.reaches(project, { [stream]: 2, [plain]: 2 });
    expect(lastHave(mA2, project).have).toMatchObject({ [stream]: 2, [plain]: 2 });
    for (const m of [mB, mOld]) {
      await m.reaches(project, { [plain]: 2 });
      expect(Object.keys(lastHave(m, project).have)).not.toContain(stream);
    }
    // The writing machine is told of its own stream, whatever its owners.
    expect(lastHave(mA, project).have[stream]).toBe(2);
  });

  it('an outside reader sees the plain writers go on with no hole, a withheld position as its tombstone', async () => {
    const project = newProject();
    for (const m of [mA, mB]) await m.sync(project);
    const { L, plain } = await written(project);
    expect((await upload(mA, project, [say(mA, project, L, 3, [newSession()]), say(mA, project, L, 4, [])])).map((r) => r.reason)).toEqual(['not-reachable']);
    await waitFor(() => (seqs(mB, project, plain).length === 4 ? true : undefined));
    expect(seqs(mB, project, plain)).toEqual([1, 2, 3, 4]);
    expect(mB.log.get(project)!.get(plain)!.get(3)).toEqual({ writer: plain, seq: 3, withheld: true });
  });
});

describe('to browsers', () => {
  it("live and on resume: A's browser is sent the stream, B's never", async () => {
    const project = newProject();
    await mA.sync(project);
    const liveA = await following(ADMIN, project);
    const liveB = await following(o.bEmail, project);
    const { stream, plain } = await written(project);
    await waitFor(() => (liveA.logged.filter((l) => l.event.writer === stream).length === 2 ? true : undefined));
    await waitFor(() => (liveB.logged.filter((l) => l.event.writer === plain).length === 2 ? true : undefined));
    expect(liveB.logged.some((l) => l.event.writer === stream)).toBe(false);
    const resumedA = await following(ADMIN, project);
    const resumedB = await following(o.bEmail, project);
    expect(resumedA.logged.filter((l) => l.event.writer === stream)).toHaveLength(2);
    expect(resumedB.logged.map((l) => l.event.writer)).toEqual([plain, plain]);
    for (const b of [liveA, liveB, resumedA, resumedB]) b.close();
  });

  it("the audit record, live and replayed: a stream's refusal is shown to its audience, and to the member whose send it refused", async () => {
    const project = newProject();
    for (const m of [mA, mB]) await m.sync(project);
    const liveA = await following(ADMIN, project);
    const liveB = await following(o.bEmail, project);
    const { stream } = await written(project);
    // A conflict at the stream's first position names it: A's to see.
    const conflict = { ...joined(mA, project, 'x', 1), writer: stream, seq: 1, audience: [o.A], session: undefined } as unknown as LogEvent;
    expect((await upload(mA, project, [conflict])).map((r) => r.reason)).toEqual(['conflict']);
    const refusedOf = (b: BrowserClient, writer: string) => b.frames.filter((f): f is Extract<ProjectDown, { t: 'refused' }> => f.t === 'refused' && f.refusal.writer === writer);
    await waitFor(() => (refusedOf(liveA, stream).length === 1 ? true : undefined));
    // B's own send into a stream of A's (sender outside its audience): withheld, and shown to B, without a message.
    const S = newSession();
    const theirs = say(mB, project, S, 1, [], [o.A]);
    expect((await upload(mB, project, [theirs])).map((r) => r.reason)).toEqual(['not-reachable']);
    await waitFor(() => (refusedOf(liveB, theirs.writer).length === 1 ? true : undefined));
    expect(refusedOf(liveB, theirs.writer)[0].refusal.message).toBeUndefined();
    expect(refusedOf(liveB, stream)).toEqual([]);
    const replayedA = await following(ADMIN, project);
    const replayedB = await following(o.bEmail, project);
    expect(refusedOf(replayedA, stream)).toHaveLength(1);
    expect(refusedOf(replayedB, stream)).toEqual([]);
    expect(refusedOf(replayedB, theirs.writer)).toHaveLength(1);
    for (const b of [liveA, liveB, replayedA, replayedB]) b.close();
  });

  it("the session plane: a private session's presence, pending request, delivery and op reach only its audience", async () => {
    const project = newProject();
    await mA.sync(project);
    const { P, stream } = await written(project);
    const liveA = await following(ADMIN, project);
    const liveB = await following(o.bEmail, project);
    const mac = () => ({ nonce: newNonce(), value: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) });
    const envelope = { project, machine: mA.name, session: P, sub: null, n: null };
    const ctx = { org: ORG, project, machine: mA.name, client: mA.creds.clientId, generation: mA.generation, leaseMs: 60_000, transport: 'rl1' };
    await hub.projectFrames(project, ctx, [
      { t: 'session', message: { ...envelope, kind: 'presence', body: { record: { status: 'busy' }, bridge: false } } },
      { t: 'session', message: { ...envelope, kind: 'raised', body: { request: 'r-1', session: P, tool: 'Bash', input: {}, mac: mac() } } },
      { t: 'session', message: { ...envelope, kind: 'delivery', body: { event: { writer: stream, seq: 2 }, session: P, outcome: 'delivered', reason: '', mac: mac() } } },
      { t: 'session', message: { ...envelope, kind: 'op', body: { op: 'command', rpc: 'rpc-1', phase: 'start' } } },
    ]);
    const ofP = (b: BrowserClient) => b.frames.filter((f) => f.t === 'session' && f.message.session === P).map((f) => (f as Extract<ProjectDown, { t: 'session' }>).message.kind);
    const pendingOfP = (b: BrowserClient) => b.frames.some((f) => f.t === 'pending' && f.requests.some((r) => r.raised.session === P));
    const deliveredOfP = (b: BrowserClient) => b.frames.some((f) => f.t === 'deliveries' && f.deliveries.some((d) => d.session === P));
    await waitFor(() => (ofP(liveA).length === 4 ? true : undefined));
    expect(pendingOfP(liveA)).toBe(true);
    expect(ofP(liveB)).toEqual([]);
    expect(pendingOfP(liveB)).toBe(false);
    // At connect.
    const laterA = await BrowserClient.open(hub, ADMIN, project);
    const laterB = await BrowserClient.open(hub, o.bEmail, project);
    await laterA.next((f) => f.t === 'deliveries', 'deliveries');
    await laterB.next((f) => f.t === 'deliveries', 'deliveries');
    expect(ofP(laterA)).toEqual(expect.arrayContaining(['presence', 'op']));
    expect(pendingOfP(laterA) && deliveredOfP(laterA)).toBe(true);
    expect(ofP(laterB)).toEqual([]);
    expect(pendingOfP(laterB) || deliveredOfP(laterB)).toBe(false);
    for (const b of [liveA, liveB, laterA, laterB]) b.close();
  });
});

describe('over HTTP', () => {
  it('serves no stream to another machine by name, lists none in the inventory, and shows its attestation to its audience alone', async () => {
    const project = newProject();
    await mA.sync(project);
    const { stream, plain } = await written(project);
    const page = async (m: Rl1Machine, writer: string) => (await (await machineFetch(hub.url, m.creds, historyLogPath(project, writer, 0))).json()) as HistoryLogPage;
    expect((await page(mB, stream)).events).toEqual([]);
    expect((await page(mA2, stream)).events).toEqual([]);
    expect((await page(mOld, stream)).events).toEqual([]);
    expect((await page(mB, plain)).events).toHaveLength(2);
    const own = await page(mA, stream);
    expect(own.events).toHaveLength(2);
    const inventory = (await (await machineFetch(hub.url, mB.creds, historyInventoryPath([mA.name]))).json()) as HistoryInventory;
    const listed = inventory.projects.find((p) => p.id === project)?.writers.map((w) => w.writer) ?? [];
    expect(listed).toContain(plain);
    expect(listed).not.toContain(stream);
    const body: HistoryAttestation = { org: ORG, project, writer: stream, names: [mA.name], upTo: 2, digest: await historyDigest(own.events), created: new Date().toISOString() };
    const record = await signRecord(SIGNING_DOMAINS.historyAttest, body, mA.machine.key.privateKey, mA.machine.key.pub);
    expect((await machineFetch(hub.url, mA.creds, `/machine/projects/${project}/attestations`, { record })).status).toBeLessThan(300);
    const machineRecords = async (m: Rl1Machine) => ((await (await machineFetch(hub.url, m.creds, `/machine/projects/${project}/attestations`)).json()) as { records: Signed<HistoryAttestation>[] }).records;
    const memberRecords = async (who: string) => ((await (await hub.fetchAs(who, `/api/projects/${project}/attestations`)).json()) as { records: Signed<HistoryAttestation>[] }).records;
    expect(await machineRecords(mA)).toHaveLength(1);
    expect(await machineRecords(mB)).toEqual([]);
    expect(await memberRecords(ADMIN)).toHaveLength(1);
    expect(await memberRecords(o.bEmail)).toEqual([]);
  });
});
