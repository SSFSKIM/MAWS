// The session plane (DC3.G3) on the local runtime: RPCs, subscriptions, the pending set, the audit record of decisions,
// delivery outcomes, presence and machine leases, and Web Push — machines speaking DX2 and browsers DX3 through the
// stand-in. Real hibernation is forced through Miniflare's `unsafeEvictDurableObject` (workerd's `workerd:unsafe`
// evict), which drops a `Project`'s memory and keeps its sockets open; a `Machine` holding a stream is an active
// reference workerd will not evict, so its termination is `ctx.abort()` through a suite seam.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GridDown, ProjectDown } from '../src/protocol/browser';
import { FRAME_LIMIT, PartAssembler } from '../src/protocol/parts';
import { importOrgKey, newNonce, seal, sealRpc } from '../src/protocol/codes';
import type { DownFrame } from '../src/protocol/machine';
import type { Rpc, RpcDraft } from '../src/protocol/rpc';
import type { Delivery, Raised, SessionMessage, Settled } from '../src/protocol/session';
import { BrowserClient, enroll, MachineClient, type Credentials } from './support/clients';
import { ADMIN, ORG, startLocalHub, type LocalHub } from './support/local';
import { decrypt, userAgent, vapidClaims } from './support/push';

let hub: LocalHub;
let memberId: string;
beforeAll(async () => {
  hub = await startLocalHub();
  memberId = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
});
afterAll(() => hub?.close());

const KEY = importOrgKey(new Uint8Array(32).fill(9));
const SESSION = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
const SECOND = '0d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a59';

let projects = 0;
const newProject = () => `7a1c0a8e-3b2d-4c5e-9f70-${(++projects).toString(16).padStart(12, '0')}`;

/** For a test that closes its machine's stream: Miniflare reports a client's disconnect as the request's abort only
 * when the next write to the stream fails (deployed, it arrives at once: M1's probe), so the stream beats often enough
 * for the close to land within a test's wait. The lease keeps the deployed length: it is the close that ends it. */
const CLOSES = { heartbeatMs: 250, leaseMs: 45_000 };

let machines = 0;
/** An enrolled, connected machine that has opened `project`; `timing` shortens its heartbeat and lease first. */
async function machine(project: string, timing?: { heartbeatMs: number; leaseMs: number }): Promise<MachineClient> {
  const name = `sp-${++machines}`;
  const creds: Credentials = await enroll(hub, ADMIN, name);
  const client = new MachineClient(hub, name, creds);
  if (timing) await hub.timing(name, timing);
  await client.connect();
  await client.sync(project);
  // As the daemon does after every (re)connect: its own presence.
  await client.postOk([{ t: 'session', message: envelope(client, project, 'machine', machinePresence, null) }]);
  return client;
}

async function browser(project: string, who = ADMIN): Promise<BrowserClient> {
  return BrowserClient.open(hub, who, project);
}

const envelope = <K extends SessionMessage['kind']>(m: MachineClient, project: string, kind: K, body: unknown, session: string | null = SESSION, sub: string | null = null, n: number | null = null) =>
  ({ project, machine: m.name, session, kind, sub, n, body }) as unknown as SessionMessage;

async function rpc(project: string, machineName: string, name: Rpc['rpc'], args: Record<string, unknown>, created = new Date().toISOString(), member = memberId): Promise<Rpc> {
  const draft = { rpc: name, project, machine: machineName, member, created, nonce: newNonce(), args } as unknown as RpcDraft;
  return sealRpc(await KEY, draft);
}

async function raised(project: string, request: string, extra: Partial<Raised> = {}, session = SESSION): Promise<Raised> {
  return seal(await KEY, 'raised', project, { request, session, tool: 'Bash', input: { command: 'pnpm e2e' }, ...extra });
}

async function settled(project: string, request: string, winner: Settled['winner'], outcome: Settled['outcome'], by: string): Promise<Settled> {
  return seal(await KEY, 'settled', project, { request, winner, outcome, by });
}

const presence = (status: string) => ({ record: { status, waitingFor: null, needs: null }, bridge: true });
const machinePresence = { online: true, policy: { read_only: false, ceiling: 'default' }, checkouts: [{ path: '/src/maws', branch: 'main' }] };

const ofType = <T extends ProjectDown['t']>(b: BrowserClient, t: T, from = 0) => b.frames.slice(from).filter((f) => f.t === t) as Array<Extract<ProjectDown, { t: T }>>;
const lastPending = (b: BrowserClient) => ofType(b, 'pending').at(-1)?.requests ?? null;
const sessionKinds = (b: BrowserClient, from = 0) => ofType(b, 'session', from).map((f) => f.message);

describe('RPCs', () => {
  it("reach the named machine's stream and return done; the result is acknowledged and a retry is answered from the record", async () => {
    const project = newProject();
    const m = await machine(project);
    const b = await browser(project);
    const call = await rpc(project, m.name, 'steer', { session: SESSION, text: 'keep user_id' });
    b.send({ t: 'rpc', rpc: call });
    const down = (await m.next((f) => f.t === 'rpc', 'the rpc')) as Extract<DownFrame, { t: 'rpc' }>;
    expect(down.rpc).toEqual(call);
    expect(await b.next((f) => f.t === 'rpc-state', 'forwarded')).toEqual({ t: 'rpc-state', nonce: call.nonce, state: 'forwarded' });

    const from = m.frames.length;
    await m.postOk([{ t: 'rpc-result', project, nonce: call.nonce, outcome: { state: 'done', result: { row: 'u-1' } } }]);
    expect(await m.next((f) => f.t === 'rpc-ack', 'rpc-ack', from)).toEqual({ t: 'rpc-ack', project, nonce: call.nonce });
    expect(await b.next((f) => f.t === 'rpc-state' && f.state === 'done', 'done')).toEqual({
      t: 'rpc-state',
      nonce: call.nonce,
      state: 'done',
      outcome: { state: 'done', result: { row: 'u-1' } },
    });

    // The browser lost the answer and sends the same RPC again: answered from the record, never forwarded twice.
    const fromB = b.frames.length;
    b.send({ t: 'rpc', rpc: call });
    expect(await b.next((f) => f.t === 'rpc-state', 'the record', fromB)).toMatchObject({ nonce: call.nonce, state: 'done' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(m.frames.filter((f) => f.t === 'rpc')).toHaveLength(1);
    b.close();
    await m.close();
  });

  it('return failed with the daemon’s reason', async () => {
    const project = newProject();
    const m = await machine(project);
    const b = await browser(project);
    const call = await rpc(project, m.name, 'steer', { session: SESSION, text: 'x' });
    b.send({ t: 'rpc', rpc: call });
    await m.next((f) => f.t === 'rpc', 'the rpc');
    await m.postOk([{ t: 'rpc-result', project, nonce: call.nonce, outcome: { state: 'failed', error: { code: 'idle', message: 'no turn is running' } } }]);
    expect(await b.next((f) => f.t === 'rpc-state' && f.state === 'failed', 'failed')).toMatchObject({ outcome: { error: { code: 'idle' } } });
    b.close();
    await m.close();
  });

  it('fail at once, and are not forwarded, to a machine without a connection, when stale, or when another member signs them', async () => {
    const project = newProject();
    const m = await machine(project, CLOSES);
    const b = await browser(project);
    const offline = await rpc(project, 'nowhere', 'interrupt', { session: SESSION });
    b.send({ t: 'rpc', rpc: offline });
    expect(await b.next((f) => f.t === 'rpc-state' && f.nonce === offline.nonce, 'machine-offline')).toMatchObject({
      state: 'failed',
      outcome: { state: 'failed', error: { code: 'machine-offline' } },
    });
    const stale = await rpc(project, m.name, 'interrupt', { session: SESSION }, new Date(Date.now() - 61_000).toISOString());
    b.send({ t: 'rpc', rpc: stale });
    expect(await b.next((f) => f.t === 'rpc-state' && f.nonce === stale.nonce, 'stale')).toMatchObject({ outcome: { error: { code: 'stale' } } });
    const forged = await rpc(project, m.name, 'interrupt', { session: SESSION }, undefined, '0123456789abcdef0123456789abcdef');
    b.send({ t: 'rpc', rpc: forged });
    expect(await b.next((f) => f.t === 'rpc-state' && f.nonce === forged.nonce, 'not-member')).toMatchObject({ outcome: { error: { code: 'not-member' } } });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(m.frames.filter((f) => f.t === 'rpc')).toEqual([]);

    // A stopped daemon: its stream's close reaches the hub at once, and the next RPC fails at once.
    await m.close();
    await b.next((f) => f.t === 'machines' && f.machines.some((x) => x.machine === m.name && !x.online), 'offline');
    const late = await rpc(project, m.name, 'interrupt', { session: SESSION });
    b.send({ t: 'rpc', rpc: late });
    expect(await b.next((f) => f.t === 'rpc-state' && f.nonce === late.nonce, 'machine-offline')).toMatchObject({ outcome: { error: { code: 'machine-offline' } } });
    b.close();
  });

  it('become uncertain when the machine drops after forwarding, and resolve from the result republished after it reconnects', async () => {
    const project = newProject();
    const m = await machine(project, CLOSES);
    const b = await browser(project);
    const call = await rpc(project, m.name, 'spawn', { checkout: '/src/maws', brief: 'one session' });
    b.send({ t: 'rpc', rpc: call });
    await m.next((f) => f.t === 'rpc', 'the rpc');
    await m.close();
    expect(await b.next((f) => f.t === 'rpc-state' && f.state === 'uncertain', 'uncertain')).toEqual({ t: 'rpc-state', nonce: call.nonce, state: 'uncertain' });

    await m.connect();
    const from = m.frames.length;
    await m.sync(project);
    await m.postOk([{ t: 'rpc-result', project, nonce: call.nonce, outcome: { state: 'done', result: { session: SECOND, alias: 'maws-46' } } }]);
    await m.next((f) => f.t === 'rpc-ack', 'rpc-ack', from);
    expect(await b.next((f) => f.t === 'rpc-state' && f.state === 'done', 'resolved')).toMatchObject({ outcome: { result: { session: SECOND } } });
    b.close();
    await m.close();
  });

  it('a retry of an uncertain RPC is forwarded again once its machine is back (the daemon’s ledger answers it)', async () => {
    const project = newProject();
    const m = await machine(project, CLOSES);
    const b = await browser(project);
    const call = await rpc(project, m.name, 'steer', { session: SESSION, text: 'once' });
    b.send({ t: 'rpc', rpc: call });
    await m.next((f) => f.t === 'rpc', 'the rpc');
    await m.close();
    await b.next((f) => f.t === 'rpc-state' && f.state === 'uncertain', 'uncertain');
    // While the machine is away, a retry is answered from the record.
    const fromB = b.frames.length;
    b.send({ t: 'rpc', rpc: call });
    expect(await b.next((f) => f.t === 'rpc-state', 'still uncertain', fromB)).toMatchObject({ state: 'uncertain' });
    await m.connect();
    const from = m.frames.length;
    await m.sync(project);
    b.send({ t: 'rpc', rpc: call });
    expect(((await m.next((f) => f.t === 'rpc', 'forwarded again', from)) as Extract<DownFrame, { t: 'rpc' }>).rpc.nonce).toBe(call.nonce);
    b.close();
    await m.close();
  });
});

describe('subscriptions', () => {
  it('relay the machine’s messages to the subscribing browser verbatim; rows and diff are carried to the machine', async () => {
    const project = newProject();
    const m = await machine(project);
    const b = await browser(project);
    const other = await browser(project);
    const sub = newNonce();
    b.send({ t: 'subscribe', machine: m.name, session: SESSION, agentId: null, sub });
    expect(await m.next((f) => f.t === 'subscribe', 'subscribe')).toEqual({ t: 'subscribe', project, session: SESSION, agentId: null, sub });

    const snapshot = envelope(m, project, 'snapshot', { rows: [], more: false, subagents: [], presence: presence('busy'), streaming: [], usage: null }, SESSION, sub, 0);
    const row = envelope(m, project, 'row', { row: { uuid: 'r1', type: 'assistant' }, agentId: null }, SESSION, sub, 1);
    const blockRow = envelope(m, project, 'block-row', { uuid: 'r2', turnId: 't', agentId: null, step: 0, index: 0 }, SESSION, sub, 2);
    const stepEnd = envelope(m, project, 'step-end', { turnId: 't', agentId: null, step: 0 }, SESSION, sub, 3);
    await m.postOk([{ t: 'session', message: snapshot }, { t: 'session', message: row }, { t: 'session', message: blockRow }, { t: 'session', message: stepEnd }]);
    await b.next((f) => f.t === 'session' && f.message.kind === 'step-end', 'step-end');
    expect(sessionKinds(b).filter((x) => x.sub === sub)).toEqual([snapshot, row, blockRow, stepEnd]);
    expect(sessionKinds(other).filter((x) => x.sub === sub)).toEqual([]);

    b.send({ t: 'rows', sub, before: 'r1', limit: 20 });
    expect(await m.next((f) => f.t === 'rows', 'rows')).toEqual({ t: 'rows', project, session: SESSION, agentId: null, sub, before: 'r1', limit: 20 });
    b.send({ t: 'diff', sub });
    expect(await m.next((f) => f.t === 'diff', 'diff')).toEqual({ t: 'diff', project, session: SESSION, sub });

    // A diff is a main-transcript subscription's only.
    const agentSub = newNonce();
    b.send({ t: 'subscribe', machine: m.name, session: SESSION, agentId: 'a1', sub: agentSub });
    await m.next((f) => f.t === 'subscribe' && f.sub === agentSub, 'the agent sub');
    const fromM = m.frames.length;
    b.send({ t: 'diff', sub: agentSub });
    expect(await b.next((f) => f.t === 'refused', 'refused')).toMatchObject({ refusal: { reason: 'bad-shape' } });
    expect(m.frames.slice(fromM).filter((f) => f.t === 'diff')).toEqual([]);

    // The browser goes: its subs end at the machine.
    b.close();
    const gone = await waitFor(() => {
      const subs = m.frames.filter((f) => f.t === 'unsubscribe').map((f) => (f as { sub: string }).sub);
      return subs.length >= 2 ? subs : undefined;
    });
    expect(new Set(gone)).toEqual(new Set([sub, agentSub]));
    other.close();
    await m.close();
  });

  it('a message for a sub no browser holds is answered with unsubscribe; unsubscribe is carried to the machine', async () => {
    const project = newProject();
    const m = await machine(project);
    const stray = newNonce();
    await m.postOk([{ t: 'session', message: envelope(m, project, 'row', { row: { uuid: 'x' }, agentId: null }, SESSION, stray, 4) }]);
    expect(await m.next((f) => f.t === 'unsubscribe', 'unsubscribe')).toEqual({ t: 'unsubscribe', project, sub: stray });

    const b = await browser(project);
    const sub = newNonce();
    b.send({ t: 'subscribe', machine: m.name, session: SESSION, agentId: null, sub });
    await m.next((f) => f.t === 'subscribe', 'subscribe');
    b.send({ t: 'unsubscribe', sub });
    await m.next((f) => f.t === 'unsubscribe' && f.sub === sub, 'unsubscribe');

    // An end may come first, at n 0 (an unknown session, say): relayed, and the sub is over at the hub too.
    const early = newNonce();
    b.send({ t: 'subscribe', machine: m.name, session: SECOND, agentId: null, sub: early });
    await m.next((f) => f.t === 'subscribe' && f.sub === early, 'subscribe');
    const ended = envelope(m, project, 'end', { reason: 'session-ended', message: 'no such session' }, SECOND, early, 0);
    await m.postOk([{ t: 'session', message: ended }]);
    expect(((await b.next((f) => f.t === 'session' && f.message.sub === early, 'the early end')) as Extract<ProjectDown, { t: 'session' }>).message).toEqual(ended);
    const from = m.frames.length;
    await m.postOk([{ t: 'session', message: envelope(m, project, 'row', { row: { uuid: 'late' }, agentId: null }, SECOND, early, 1) }]);
    await m.next((f) => f.t === 'unsubscribe' && f.sub === early, 'unsubscribe after the end', from);
    b.close();
    await m.close();
  });

  it("end at the browser with the next n when the machine's stream closes, and a subscribe to an offline machine ends at once", async () => {
    const project = newProject();
    const m = await machine(project, CLOSES);
    const b = await browser(project);
    const sub = newNonce();
    b.send({ t: 'subscribe', machine: m.name, session: SESSION, agentId: null, sub });
    await m.next((f) => f.t === 'subscribe', 'subscribe');
    await m.postOk([
      { t: 'session', message: envelope(m, project, 'snapshot', { rows: [], more: false, subagents: [], presence: presence('busy'), streaming: [] }, SESSION, sub, 0) },
      { t: 'session', message: envelope(m, project, 'chunk', { turnId: 't', agentId: null, step: 0, chunkIndex: 0, chunk: { text: 'hi' } }, SESSION, sub, 1) },
    ]);
    await b.next((f) => f.t === 'session' && f.message.kind === 'chunk', 'chunk');
    await m.close();
    expect((await b.next((f) => f.t === 'session' && f.message.kind === 'end', 'end')) as Extract<ProjectDown, { t: 'session' }>).toMatchObject({
      message: { project, machine: m.name, session: SESSION, kind: 'end', sub, n: 2, body: { reason: 'machine-offline' } },
    });
    const again = newNonce();
    b.send({ t: 'subscribe', machine: m.name, session: SESSION, agentId: null, sub: again });
    expect(await b.next((f) => f.t === 'session' && f.message.sub === again, 'end')).toMatchObject({ message: { kind: 'end', n: 0, body: { reason: 'machine-offline' } } });
    b.close();
  });
});

describe('the pending set, decisions, and deliveries', () => {
  it('a raise reaches every browser, a settlement removes it and the audit record holds the side that won', async () => {
    const project = newProject();
    const m = await machine(project);
    const b = await browser(project);
    expect(await b.next((f) => f.t === 'pending', 'pending on connect')).toEqual({ t: 'pending', requests: [] });
    const request = await raised(project, 'toolu_01A');
    await m.postOk([{ t: 'session', message: envelope(m, project, 'raised', request) }]);
    await waitFor(() => (lastPending(b)?.length === 1 ? true : undefined));
    expect(lastPending(b)).toEqual([{ machine: m.name, raised: request, terminal_only: false }]);
    expect(sessionKinds(b).some((x) => x.kind === 'raised')).toBe(true);

    // The web tried to allow, the terminal won with a deny: the record says terminal, deny.
    const decided = await settled(project, 'toolu_01A', 'terminal', 'deny', 'terminal');
    await m.postOk([{ t: 'session', message: envelope(m, project, 'settled', decided) }]);
    const entry = (await b.next((f) => f.t === 'decided', 'decided')) as Extract<ProjectDown, { t: 'decided' }>;
    expect(entry.decision).toMatchObject({ machine: m.name, session: SESSION, settled: decided, raised: request, id: expect.any(Number), at: expect.any(String) });
    await waitFor(() => (lastPending(b)?.length === 0 ? true : undefined));

    // A browser that resumes later sees the decision in the record's replay.
    const late = await browser(project);
    late.send({ t: 'resume', after: 0 });
    await late.next((f) => f.t === 'caught-up', 'caught-up');
    expect(await late.next((f) => f.t === 'decided', 'replayed')).toMatchObject({ decision: { id: entry.decision.id, settled: decided } });
    late.close();
    b.close();
    await m.close();
  });

  it("after a reconnect, a request the daemon no longer republishes is dropped; a background request turns terminal_only at its deadline", async () => {
    const project = newProject();
    const m = await machine(project);
    const b = await browser(project);
    const kept = await raised(project, 'toolu_keep');
    const lost = await raised(project, 'request-lost');
    await m.postOk([{ t: 'pending', project, raised: [kept, lost] }]);
    await waitFor(() => (lastPending(b)?.length === 2 ? true : undefined));
    await m.close();
    await m.connect();
    await m.sync(project);
    await m.postOk([{ t: 'pending', project, raised: [kept] }]);
    await waitFor(() => (lastPending(b)?.length === 1 ? true : undefined));
    expect(lastPending(b)!.map((r) => r.raised.request)).toEqual(['toolu_keep']);

    const background = await raised(project, 'toolu_bg', { deadline: new Date(Date.now() + 700).toISOString() });
    await m.postOk([{ t: 'session', message: envelope(m, project, 'raised', background) }]);
    await waitFor(() => (lastPending(b)?.some((r) => r.raised.request === 'toolu_bg' && !r.terminal_only) ? true : undefined));
    await waitFor(() => (lastPending(b)?.some((r) => r.raised.request === 'toolu_bg' && r.terminal_only) ? true : undefined), 5000);
    b.close();
    await m.close();
  });

  it('keeps the latest delivery outcome per event and recipient and returns it to a browser that connects', async () => {
    const project = newProject();
    const m = await machine(project);
    const event = { writer: `hub/${memberId}`, seq: 3 };
    const first: Delivery = await seal(await KEY, 'delivery', project, { event, session: SESSION, outcome: 'recorded', reason: 'a terminal session the human closed' });
    const second: Delivery = await seal(await KEY, 'delivery', project, { event, session: SESSION, outcome: 'delivered', reason: '' });
    const elsewhere: Delivery = await seal(await KEY, 'delivery', project, { event, session: SECOND, outcome: 'refused-read-only', reason: 'read-only' });
    const live = await browser(project);
    await m.postOk([{ t: 'session', message: envelope(m, project, 'delivery', first) }, { t: 'session', message: envelope(m, project, 'delivery', second) }, { t: 'session', message: envelope(m, project, 'delivery', elsewhere, SECOND) }]);
    await waitFor(() => (sessionKinds(live).filter((x) => x.kind === 'delivery').length === 3 ? true : undefined));
    const b = await browser(project);
    const deliveries = (await b.next((f) => f.t === 'deliveries', 'deliveries')) as Extract<ProjectDown, { t: 'deliveries' }>;
    expect(deliveries.deliveries).toEqual([second, elsewhere]);
    live.close();
    b.close();
    await m.close();
  });
});

describe('presence and machine leases', () => {
  it('machines go offline when the lease lapses with no hb-ack, and an hb-ack of an older generation renews nothing', async () => {
    const project = newProject();
    const m = await machine(project, { heartbeatMs: 200, leaseMs: 1200 });
    m.autoAck = false;
    const b = await browser(project);
    await m.postOk([{ t: 'session', message: envelope(m, project, 'machine', machinePresence, null) }]);
    await b.next((f) => f.t === 'machines' && f.machines.some((x) => x.machine === m.name && x.online), 'online');
    // Acks that name another generation (a stream's that no longer is) keep nothing alive.
    const ack = setInterval(() => void m.post([{ t: 'hb-ack', generation: m.generation - 1, at: new Date().toISOString() }]), 200);
    try {
      await b.next((f) => f.t === 'machines' && f.machines.some((x) => x.machine === m.name && !x.online), 'offline', 0, 6000);
    } finally {
      clearInterval(ack);
    }
    b.close();
    await m.close();
  });

  it('hb-acks of the current generation keep the machine online past its lease', async () => {
    const project = newProject();
    const m = await machine(project, { heartbeatMs: 200, leaseMs: 1200 });
    const b = await browser(project);
    await m.postOk([{ t: 'session', message: envelope(m, project, 'machine', machinePresence, null) }]);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(ofType(b, 'machines').flatMap((f) => f.machines).filter((x) => x.machine === m.name && !x.online)).toEqual([]);
    b.close();
    await m.close();
  });

  it('a renewal that reaches the project after its lease ran out, before the alarm, ends the old work first', async () => {
    const project = newProject();
    const m = await machine(project);
    const b = await browser(project);
    const sub = newNonce();
    b.send({ t: 'subscribe', machine: m.name, session: SESSION, agentId: null, sub });
    await m.next((f) => f.t === 'subscribe', 'subscribe');
    const call = await rpc(project, m.name, 'interrupt', { session: SESSION });
    b.send({ t: 'rpc', rpc: call });
    await m.next((f) => f.t === 'rpc', 'the rpc');
    // The lease runs out within a millisecond; its alarm comes 50 ms on at the soonest, and the renewal before it.
    await hub.lease(project, { op: 'renew', machine: m.name, generation: m.generation, leaseMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await hub.lease(project, { op: 'renew', machine: m.name, generation: m.generation, leaseMs: 45_000 });
    await b.next((f) => f.t === 'session' && f.message.kind === 'end' && f.message.sub === sub, 'the sub ended');
    expect(await b.next((f) => f.t === 'rpc-state' && f.nonce === call.nonce && f.state !== 'forwarded', 'uncertain')).toMatchObject({ state: 'uncertain' });
    // And the renewal puts the machine online again, on the same stream.
    await waitFor(() => (ofType(b, 'machines').at(-1)?.machines.find((x) => x.machine === m.name)?.online ? true : undefined));
    b.close();
    await m.close();
  });

  it('presence posted while the lease is lapsed is kept, not shown, until the lease is renewed', async () => {
    const project = newProject();
    const m = await machine(project, { heartbeatMs: 60_000, leaseMs: 800 });
    const b = await browser(project);
    await b.next((f) => f.t === 'machines' && f.machines.some((x) => x.machine === m.name && !x.online), 'offline', 0, 6000);
    const from = b.frames.length;
    await m.postOk([{ t: 'session', message: envelope(m, project, 'presence', presence('waiting')) }]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sessionKinds(b, from).filter((x) => x.kind === 'presence')).toEqual([]);
    const late = await browser(project);
    expect(sessionKinds(late).filter((x) => x.kind === 'presence')).toEqual([]);
    late.close();
    await hub.lease(project, { op: 'renew', machine: m.name, generation: m.generation, leaseMs: 45_000 });
    expect(((await b.next((f) => f.t === 'session' && f.message.kind === 'presence', 'presence once renewed', from)) as Extract<ProjectDown, { t: 'session' }>).message).toMatchObject({
      machine: m.name,
      body: presence('waiting'),
    });
    b.close();
    await m.close();
  });

  it("a close that arrives while the stream's first hello waits on the registry leaves the machine offline", async () => {
    const project = newProject();
    const name = `sp-${++machines}`;
    const m = new MachineClient(hub, name, await enroll(hub, ADMIN, name));
    await m.connect();
    await hub.holdHellos(project, true);
    const hello = m.post([{ t: 'hello', project, name: 'demo', have: {} }]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await hub.lease(project, { op: 'closed', machine: m.name, generation: m.generation });
    await hub.holdHellos(project, false);
    expect((await hello).status).toBe(200);
    const b = await browser(project);
    const call = await rpc(project, m.name, 'interrupt', { session: SESSION });
    b.send({ t: 'rpc', rpc: call });
    expect(await b.next((f) => f.t === 'rpc-state' && f.nonce === call.nonce, 'machine-offline')).toMatchObject({ outcome: { error: { code: 'machine-offline' } } });
    b.close();
    await m.close();
  });

  it("the Machine object terminated after forwarding, the daemon kept away: offline, subscriptions ended, the RPC uncertain within the lease; its presence withheld", async () => {
    const project = newProject();
    const m = await machine(project, { heartbeatMs: 200, leaseMs: 1500 });
    const b = await browser(project);
    await m.postOk([
      { t: 'session', message: envelope(m, project, 'machine', machinePresence, null) },
      { t: 'session', message: envelope(m, project, 'presence', presence('busy')) },
    ]);
    const sub = newNonce();
    b.send({ t: 'subscribe', machine: m.name, session: SESSION, agentId: null, sub });
    await m.next((f) => f.t === 'subscribe', 'subscribe');
    const call = await rpc(project, m.name, 'interrupt', { session: SESSION });
    b.send({ t: 'rpc', rpc: call });
    await m.next((f) => f.t === 'rpc', 'the rpc');

    // The daemon is kept from reconnecting (this client never does on its own) and answers no heartbeat.
    m.autoAck = false;
    hub.expectRuntimeLog(/terminated by the suite/);
    const at = Date.now();
    await hub.terminate(m.name);
    // The termination is real: the object's stream ended under the daemon.
    await waitFor(() => (m.isEnded ? true : undefined));
    // workerd on Linux logs the abort as an uncaught exception, which the suite takes out of the output here and nowhere
    // else; workerd on macOS logs nothing for it (checked with a capture of every line).
    if (process.platform === 'linux') await waitFor(() => (hub.runtimeLogs.some((l) => /terminated by the suite/.test(l.message)) ? true : undefined));
    await b.next((f) => f.t === 'rpc-state' && f.state === 'uncertain', 'uncertain', 0, 6000);
    await b.next((f) => f.t === 'session' && f.message.kind === 'end' && f.message.sub === sub, 'the sub ended', 0, 6000);
    await b.next((f) => f.t === 'machines' && f.machines.some((x) => x.machine === m.name && !x.online), 'offline', 0, 6000);
    expect(Date.now() - at).toBeLessThan(4000);

    // A browser connecting now is not handed the stored presence as current: the machine is offline.
    const late = await browser(project);
    await late.next((f) => f.t === 'machines', 'machines');
    expect(ofType(late, 'machines')[0].machines.find((x) => x.machine === m.name)).toMatchObject({ online: false });
    expect(sessionKinds(late).filter((x) => x.kind === 'presence' && x.machine === m.name)).toEqual([]);
    late.close();
    b.close();
    await m.close();
  });

  it('a renewal or close from an older generation is ignored', async () => {
    const project = newProject();
    const m = await machine(project);
    const b = await browser(project);
    const old = m.generation;
    await m.connect();
    await m.sync(project);
    // The old stream's close and the new stream's hello have both reached the project by now.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(ofType(b, 'machines').at(-1)!.machines.find((x) => x.machine === m.name)).toMatchObject({ online: true });
    const from = b.frames.length;
    await hub.lease(project, { op: 'closed', machine: m.name, generation: old });
    await hub.lease(project, { op: 'renew', machine: m.name, generation: old, leaseMs: 1 });
    // Still online on the new generation: an RPC is forwarded.
    const call = await rpc(project, m.name, 'interrupt', { session: SESSION });
    b.send({ t: 'rpc', rpc: call });
    await m.next((f) => f.t === 'rpc' && f.rpc.nonce === call.nonce, 'forwarded');
    expect(ofType(b, 'machines', from).flatMap((f) => f.machines).filter((x) => x.machine === m.name && !x.online)).toEqual([]);
    b.close();
    await m.close();
  });
});

describe('real hibernation and eviction while sockets stay open', () => {
  it('presence, the pending set, and an established subscription survive; frames keep their n; a visible browser still suppresses the push', async () => {
    const project = newProject();
    const m = await machine(project, CLOSES);
    const ua = await userAgent(`https://push.test/hibernation-${project}`);
    expect((await hub.fetchAs(ADMIN, '/api/push/subscriptions', { method: 'PUT', body: { endpoint: ua.endpoint, keys: ua.keys } })).status).toBe(200);
    const b = await browser(project);
    b.send({ t: 'visibility', visible: true });
    await m.postOk([{ t: 'session', message: envelope(m, project, 'presence', presence('waiting')) }]);
    const request = await raised(project, 'toolu_hib');
    await m.postOk([{ t: 'session', message: envelope(m, project, 'raised', request) }]);
    const sub = newNonce();
    b.send({ t: 'subscribe', machine: m.name, session: SESSION, agentId: null, sub });
    await m.next((f) => f.t === 'subscribe', 'subscribe');
    await m.postOk([{ t: 'session', message: envelope(m, project, 'snapshot', { rows: [], more: false, subagents: [], presence: presence('busy'), streaming: [] }, SESSION, sub, 0) }]);
    await b.next((f) => f.t === 'session' && f.message.sub === sub, 'snapshot');

    const before = await hub.projectLife(project);
    await hub.evict('Project', `${ORG}:${project}`, 'hibernate');
    expect(await hub.projectLife(project)).not.toBe(before);

    // A fresh object: the established subscription still routes, with the machine's numbering.
    await m.postOk([{ t: 'session', message: envelope(m, project, 'row', { row: { uuid: 'r1' }, agentId: null }, SESSION, sub, 1) }]);
    expect(await b.next((f) => f.t === 'session' && f.message.sub === sub && f.message.n === 1, 'row 1')).toBeTruthy();
    // Stored state: a browser connecting now gets the presence and the pending set.
    const late = await browser(project);
    await late.next((f) => f.t === 'pending', 'pending');
    expect(lastPending(late)).toEqual([{ machine: m.name, raised: request, terminal_only: false }]);
    expect(sessionKinds(late).filter((x) => x.kind === 'presence')).toHaveLength(1);
    late.close();

    // After another hibernation, the visible tab (its attachment) still holds the push back.
    await hub.evict('Project', `${ORG}:${project}`, 'hibernate');
    const pushed = hub.pushes.length;
    await m.postOk([{ t: 'session', message: envelope(m, project, 'raised', await raised(project, 'toolu_hib2')) }]);
    await waitFor(() => (lastPending(b)?.length === 2 ? true : undefined));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(hub.pushes.slice(pushed).filter((p) => p.endpoint === ua.endpoint)).toEqual([]);

    // And when the machine goes, the hub's own end carries the next n after the last relayed.
    await m.close();
    expect(await b.next((f) => f.t === 'session' && f.message.sub === sub && f.message.kind === 'end', 'end')).toMatchObject({ message: { n: 2 } });
    b.close();
  });
});

describe('Web Push', () => {
  it('serves the VAPID public key, and keeps a member’s subscriptions', async () => {
    const key = (await (await hub.fetchAs(ADMIN, '/api/push/key')).json()) as { key: string };
    expect(Buffer.from(key.key, 'base64url')).toHaveLength(65);
    const ua = await userAgent('https://push.test/keep-1');
    const put = await hub.fetchAs(ADMIN, '/api/push/subscriptions', { method: 'PUT', body: { endpoint: ua.endpoint, keys: ua.keys } });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { subscription: { member: string; endpoint: string } }).subscription).toMatchObject({ member: memberId, endpoint: ua.endpoint });
    const listed = (await (await hub.fetchAs(ADMIN, '/api/push/subscriptions')).json()) as { subscriptions: Array<{ endpoint: string }> };
    expect(listed.subscriptions.map((s) => s.endpoint)).toContain(ua.endpoint);
    expect((await hub.fetchAs(ADMIN, '/api/push/subscriptions', { method: 'PUT', body: { endpoint: 'http://push.test/x', keys: ua.keys } })).status).toBe(400);
    const deleted = await hub.fetchAs(ADMIN, '/api/push/subscriptions', { method: 'DELETE', body: { endpoint: ua.endpoint } });
    expect(await deleted.json()).toEqual({ deleted: true });
  });

  it('a raise and a <message> push once to each device of a member with no visible browser, and none when one is visible', async () => {
    const project = newProject();
    const m = await machine(project);
    const phone = await userAgent(`https://push.test/phone-${project}`);
    const laptop = await userAgent(`https://push.test/laptop-${project}`);
    for (const ua of [phone, laptop]) await hub.fetchAs(ADMIN, '/api/push/subscriptions', { method: 'PUT', body: { endpoint: ua.endpoint, keys: ua.keys } });
    const mine = () => hub.pushes.filter((p) => p.endpoint === phone.endpoint || p.endpoint === laptop.endpoint);

    // The session's alias, from its writer's events.
    const joined = say(m, project, 1, 'joined');
    await m.postOk([{ t: 'events', project, events: [joined] }]);
    // A browser open but hidden holds nothing back.
    const hidden = await browser(project);
    hidden.send({ t: 'visibility', visible: false });
    await m.postOk([{ t: 'session', message: envelope(m, project, 'raised', await raised(project, 'toolu_push', { tool: 'AskUserQuestion' })) }]);
    await waitFor(() => (mine().length === 2 ? true : undefined));
    for (const push of mine()) {
      const ua = push.endpoint === phone.endpoint ? phone : laptop;
      expect(JSON.parse(new TextDecoder().decode(await decrypt(ua, push.body)))).toEqual({
        v: 1,
        project,
        session: SESSION,
        alias: 'maws-45',
        kind: 'question',
        request: 'toolu_push',
      });
      expect((await vapidClaims(push.headers.authorization)).claims).toMatchObject({ aud: 'https://push.test', sub: `mailto:${ADMIN}` });
    }
    // Republished as part of the pending set, it does not push again.
    await m.postOk([{ t: 'pending', project, raised: [await raised(project, 'toolu_push', { tool: 'AskUserQuestion' })] }]);

    const message = { ...say(m, project, 2, 'merged the migration'), kind: 'message', to: 'host' };
    m.store(project, message);
    await m.postOk([{ t: 'events', project, events: [message] }]);
    await waitFor(() => (mine().length === 4 ? true : undefined));
    expect(JSON.parse(new TextDecoder().decode(await decrypt(phone, mine().filter((p) => p.endpoint === phone.endpoint)[1].body)))).toEqual({
      v: 1,
      project,
      session: SESSION,
      alias: 'maws-45',
      kind: 'message',
      event: { writer: message.writer, seq: 2 },
    });

    // A visible browser of the member: nothing.
    const shown = await browser(project);
    shown.send({ t: 'visibility', visible: true });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await m.postOk([{ t: 'session', message: envelope(m, project, 'raised', await raised(project, 'toolu_quiet')) }]);
    await waitFor(() => (lastPending(shown)?.some((r) => r.raised.request === 'toolu_quiet') ? true : undefined));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(mine()).toHaveLength(4);
    hidden.close();
    shown.close();
    await m.close();
  });

  it("a push service's 404 or 410 deletes the subscription", async () => {
    const project = newProject();
    const m = await machine(project);
    const gone = await userAgent(`https://push.test/gone-${project}`);
    await hub.fetchAs(ADMIN, '/api/push/subscriptions', { method: 'PUT', body: { endpoint: gone.endpoint, keys: gone.keys } });
    hub.pushAnswers.set(gone.endpoint, 410);
    await m.postOk([{ t: 'session', message: envelope(m, project, 'raised', await raised(project, 'toolu_gone')) }]);
    await waitFor(async () => {
      const listed = (await (await hub.fetchAs(ADMIN, '/api/push/subscriptions')).json()) as { subscriptions: Array<{ endpoint: string }> };
      return listed.subscriptions.some((s) => s.endpoint === gone.endpoint) ? undefined : true;
    });
    expect(hub.pushes.filter((p) => p.endpoint === gone.endpoint)).toHaveLength(1);
    await m.close();
  });
});

describe('the grid', () => {
  it("streams each project's summary: machines online, sessions working and waiting", async () => {
    const project = newProject();
    const m = await machine(project, CLOSES);
    const grid = await GridClient.open(hub, ADMIN);
    const first = grid.frames[0];
    expect(first.t === 'grid' && first.projects.map((p) => p.id)).toContain(project);
    await m.postOk([
      { t: 'session', message: envelope(m, project, 'machine', machinePresence, null) },
      { t: 'session', message: envelope(m, project, 'presence', presence('busy')) },
      { t: 'session', message: envelope(m, project, 'presence', presence('waiting'), SECOND) },
    ]);
    await grid.next((f) => f.t === 'summary' && f.project.id === project && f.project.working === 1 && f.project.waiting === 1, 'the counts');
    await m.close();
    expect(await grid.next((f) => f.t === 'summary' && f.project.id === project && f.project.machines_online === 0, 'offline')).toMatchObject({
      project: { machines: 1, working: 0, waiting: 0 },
    });
    grid.close();
  });
});

describe('the grid, past the frame bound', () => {
  it('sends a grid larger than one frame in numbered parts, none above the bound', async () => {
    await hub.addProjects(6000, 'bulk');
    const grid = await GridClient.open(hub, ADMIN);
    await waitFor(() => (grid.frames.some((f) => f.t === 'grid') ? true : undefined), 10_000);
    const whole = grid.frames.find((f) => f.t === 'grid') as Extract<GridDown, { t: 'grid' }>;
    expect(whole.projects.filter((p) => p.id.startsWith('bulk-'))).toHaveLength(6000);
    expect(grid.wire.length).toBeGreaterThan(1);
    expect(Math.max(...grid.wire)).toBeLessThanOrEqual(FRAME_LIMIT);
    grid.close();
  });
});

/** A `say` on `m`'s session feed, from the alias maws-45. */
function say(m: MachineClient, project: string, seq: number, text: string) {
  const event = {
    ts: new Date().toISOString(),
    writer: `${m.name}/${SESSION}`,
    seq,
    kind: 'say',
    from: 'maws-45',
    to: '*',
    text,
    mac: { nonce: newNonce(), value: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url') },
  };
  m.store(project, event);
  return event;
}

async function waitFor<T>(probe: () => T | undefined | Promise<T | undefined>, ms = 5000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

class GridClient {
  readonly frames: GridDown[] = [];
  /** The size in bytes of every message the socket carried, parts included. */
  readonly wire: number[] = [];
  private readonly parts = new PartAssembler();
  private socket!: WebSocket;
  static async open(hub: LocalHub, who: string): Promise<GridClient> {
    const client = new GridClient();
    client.socket = new WebSocket(`${hub.url.replace('http', 'ws')}/api/registry/socket`, { headers: { 'x-desk-standin-user': who } } as unknown as string[]);
    client.socket.addEventListener('message', (event) => {
      const text = String(event.data);
      client.wire.push(Buffer.byteLength(text));
      const frame = JSON.parse(text) as GridDown;
      if (frame.t !== 'part') return void client.frames.push(frame);
      const whole = client.parts.add(frame);
      if (whole !== undefined) client.frames.push(whole as GridDown);
    });
    await new Promise<void>((resolve, reject) => {
      client.socket.addEventListener('open', () => resolve());
      client.socket.addEventListener('error', () => reject(new Error('grid socket refused')));
    });
    await waitFor(() => (client.frames.length > 0 ? true : undefined), 15_000);
    return client;
  }
  next(predicate: (frame: GridClient['frames'][number]) => boolean, what: string) {
    return waitFor(() => this.frames.find(predicate), 5000).catch(() => {
      throw new Error(`no ${what}; got ${JSON.stringify(this.frames.slice(-5))}`);
    });
  }
  close() {
    this.socket.close(1000, 'done');
  }
}
