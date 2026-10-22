// The session plane (DC3.G3) on the local runtime: RPCs, subscriptions, the pending set, the audit record of decisions,
// delivery outcomes, presence and machine leases, and Web Push — machines speaking DX2 and browsers DX3 through the
// stand-in. Real hibernation is forced through Miniflare's `unsafeEvictDurableObject` (workerd's `workerd:unsafe`
// evict), which drops a `Project`'s memory and keeps its sockets open; a `Machine` holding a stream is an active
// reference workerd will not evict, so its termination is `ctx.abort()` through a suite seam.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeMachine, loadRecording, TWO_SUBAGENTS } from '../fake-machine';
import type { GridDown, ProjectDown, ProjectSummary, ProjectUp } from '../src/protocol/browser';
import { FRAME_LIMIT, toWire } from '../src/protocol/parts';
import { importOrgKey, newNonce, seal, sealRpc, verify } from '../src/protocol/codes';
import type { DownFrame, UpFrame } from '../src/protocol/machine';
import type { Rpc, RpcDraft } from '../src/protocol/rpc';
import type { Delivery, Raised, SessionMessage, Settled } from '../src/protocol/session';
import { BrowserClient, enroll, GridClient, MachineClient, waitFor, type Credentials } from './support/clients';
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

/** For a test that closes its machine's stream. workerd reports a client's graceful close as the request's abort only
 * when the next write to the stream fails; the stand-in resets the connection instead, so the close lands at once, as it
 * does deployed (test/stream-close.test.ts proves that with the deployed timing). The short heartbeat is a second
 * bound. The lease keeps the deployed length: it is the close that ends it. */
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

  it('take stop (DC10) as any session RPC: forwarded as sealed, its result and its refusal relayed as the machine sent them', async () => {
    const project = newProject();
    const m = await machine(project);
    const b = await browser(project);
    const call = await rpc(project, m.name, 'stop', { session: SESSION, taskId: 'bserve4q9' });
    b.send({ t: 'rpc', rpc: call });
    expect(((await m.next((f) => f.t === 'rpc', 'the stop')) as Extract<DownFrame, { t: 'rpc' }>).rpc).toEqual(call);
    await m.postOk([{ t: 'rpc-result', project, nonce: call.nonce, outcome: { state: 'done', result: { taskId: 'bserve4q9' } } }]);
    expect(await b.next((f) => f.t === 'rpc-state' && f.nonce === call.nonce && f.state === 'done', 'done')).toMatchObject({ outcome: { state: 'done', result: { taskId: 'bserve4q9' } } });

    const unknown = await rpc(project, m.name, 'stop', { session: SESSION, taskId: 'bgone0001' });
    b.send({ t: 'rpc', rpc: unknown });
    await m.next((f) => f.t === 'rpc' && f.rpc.nonce === unknown.nonce, 'the second stop');
    const refusal = { state: 'failed', error: { code: 'unknown-task', message: 'bgone0001 is not a running job of the session' } } as const;
    await m.postOk([{ t: 'rpc-result', project, nonce: unknown.nonce, outcome: refusal }]);
    expect(await b.next((f) => f.t === 'rpc-state' && f.nonce === unknown.nonce && f.state === 'failed', 'unknown-task')).toMatchObject({ outcome: refusal });
    b.close();
    await m.close();
  });

  it("carry a late decision's winner, by, and terminalOnly to the browser unchanged, live and from the record on a retry; a wrong type is refused", async () => {
    const project = newProject();
    const m = await machine(project);
    const b = await browser(project);
    const late = { state: 'failed', error: { code: 'not-pending', message: 'already answered in the terminal', winner: 'terminal', by: 'terminal', terminalOnly: true } } as const;
    const call = await rpc(project, m.name, 'decide', { session: SESSION, decision: 'allow', digest: { session: SESSION, request: 'toolu_1', tool: 'Bash', input_sha256: '0'.repeat(64) } });
    b.send({ t: 'rpc', rpc: call });
    await m.next((f) => f.t === 'rpc', 'the rpc');
    await m.postOk([{ t: 'rpc-result', project, nonce: call.nonce, outcome: late }]);
    expect(await b.next((f) => f.t === 'rpc-state' && f.state === 'failed', 'failed')).toEqual({ t: 'rpc-state', nonce: call.nonce, state: 'failed', outcome: late });
    const from = b.frames.length;
    b.send({ t: 'rpc', rpc: call });
    expect(await b.next((f) => f.t === 'rpc-state', 'the record', from)).toEqual({ t: 'rpc-state', nonce: call.nonce, state: 'failed', outcome: late });

    // Each of the three, of the wrong type, is refused: the record keeps nothing of it.
    for (const wrong of [{ winner: 'phone' }, { by: 7 }, { terminalOnly: 'yes' }]) {
      const next = await rpc(project, m.name, 'decide', { session: SESSION, decision: 'deny', digest: { session: SESSION, request: 'toolu_2', tool: 'Bash', input_sha256: '0'.repeat(64) } });
      b.send({ t: 'rpc', rpc: next });
      await m.next((f) => f.t === 'rpc' && f.rpc.nonce === next.nonce, 'the rpc');
      const at = m.frames.length;
      await m.postOk([{ t: 'rpc-result', project, nonce: next.nonce, outcome: { state: 'failed', error: { code: 'not-pending', message: 'late', ...wrong } } } as never]);
      expect(await m.next((f) => f.t === 'refused', 'refused', at)).toMatchObject({ refusal: { reason: 'bad-shape' } });
    }
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

  it('fail at once as bad-shape over 1 MiB, as an event is bounded, and are not forwarded; one within it is', async () => {
    const project = newProject();
    const m = await machine(project, CLOSES);
    const b = await browser(project);
    const send = (call: Rpc) => {
      for (const line of toWire({ t: 'rpc', rpc: call })) b.send(JSON.parse(line));
    };
    const large = await rpc(project, m.name, 'steer', { session: SESSION, text: 'x'.repeat(FRAME_LIMIT) });
    send(large);
    expect(await b.next((f) => f.t === 'rpc-state' && f.nonce === large.nonce, 'the large RPC failed')).toMatchObject({
      state: 'failed',
      outcome: { state: 'failed', error: { code: 'bad-shape', message: 'an RPC is at most 1 MiB' } },
    });
    const within = await rpc(project, m.name, 'steer', { session: SESSION, text: 'x'.repeat(FRAME_LIMIT - 1024) });
    send(within);
    expect(await b.next((f) => f.t === 'rpc-state' && f.nonce === within.nonce, 'the RPC within the bound')).toMatchObject({ state: 'forwarded' });
    await m.next((f) => f.t === 'rpc' && f.rpc.nonce === within.nonce, 'the RPC within the bound, forwarded');
    expect(m.frames.filter((f) => f.t === 'rpc' && f.rpc.nonce === large.nonce)).toEqual([]);
    b.close();
    await m.close();
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

  it('a retry that is the first to find its lease expired answers uncertain, never the record from before', async () => {
    const project = newProject();
    const m = await machine(project);
    const b = await browser(project);
    const call = await rpc(project, m.name, 'steer', { session: SESSION, text: 'once' });
    b.send({ t: 'rpc', rpc: call });
    await m.next((f) => f.t === 'rpc', 'the rpc');
    await b.next((f) => f.t === 'rpc-state' && f.nonce === call.nonce && f.state === 'forwarded', 'forwarded');
    // The lease runs out within a millisecond; its alarm comes 50 ms on at the soonest, and the retry before it.
    await hub.lease(project, { op: 'renew', machine: m.name, generation: m.generation, leaseMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const from = b.frames.length;
    b.send({ t: 'rpc', rpc: call });
    await b.next((f) => f.t === 'rpc-state' && f.nonce === call.nonce, 'the retry answered', from);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const states = ofType(b, 'rpc-state', from).filter((f) => f.nonce === call.nonce).map((f) => f.state);
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((state) => state === 'uncertain')).toBe(true);
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

  it("a retry of an uncertain RPC that cannot be delivered stays uncertain, and the result republished later resolves it (scalpel-4#1)", async () => {
    const project = newProject();
    const m = await machine(project, CLOSES);
    const b = await browser(project);
    const call = await rpc(project, m.name, 'spawn', { checkout: '/src/maws', brief: 'one session' });
    b.send({ t: 'rpc', rpc: call });
    await m.next((f) => f.t === 'rpc', 'the rpc');
    await m.close();
    await b.next((f) => f.t === 'rpc-state' && f.state === 'uncertain', 'uncertain');
    // Back, and gone again without a word: its lease is fresh, its stream is not.
    await m.connect();
    await m.sync(project);
    await hub.terminate(m.name);
    const from = b.frames.length;
    b.send({ t: 'rpc', rpc: call });
    // Forwarded again, and the send finds no stream: that says nothing of the spawn the first one may have run.
    expect(await b.next((f) => f.t === 'rpc-state' && f.nonce === call.nonce && f.state !== 'forwarded', 'the retry undelivered', from, 10_000)).toEqual({
      t: 'rpc-state',
      nonce: call.nonce,
      state: 'uncertain',
    });
    await m.connect();
    await m.sync(project);
    await m.postOk([{ t: 'rpc-result', project, nonce: call.nonce, outcome: { state: 'done', result: { session: SECOND, alias: 'maws-47' } } }]);
    expect(await b.next((f) => f.t === 'rpc-state' && f.nonce === call.nonce && f.state === 'done', 'resolved', from)).toMatchObject({ outcome: { result: { session: SECOND } } });
    b.close();
    await m.close();
  });

  it("a reply queued on a retired stream leaves the current stream's queue alone (scalpel-2#1)", async () => {
    const project = newProject();
    const m = await machine(project);
    await m.connect();
    await m.sync(project);
    const current = m.name + '#' + m.generation + '#replies';
    expect(await hub.projectQueues(project)).toContain(current);
    await hub.projectSend(project, m.name, m.generation - 1, { t: 'refused', project, refusal: { reason: 'not-open', message: 'late' } });
    expect(await hub.projectQueues(project)).toContain(current);
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

  it("carry output to the machine on a main and an agent sub, refuse one out of form, and relay the answer to the sub's socket as numbered", async () => {
    const project = newProject();
    const m = await machine(project);
    const b = await browser(project);
    const other = await browser(project);
    const sub = newNonce();
    const agentSub = newNonce();
    b.send({ t: 'subscribe', machine: m.name, session: SESSION, agentId: null, sub });
    await m.next((f) => f.t === 'subscribe' && f.sub === sub, 'subscribe');
    b.send({ t: 'subscribe', machine: m.name, session: SESSION, agentId: 'a1', sub: agentSub });
    await m.next((f) => f.t === 'subscribe' && f.sub === agentSub, 'the agent sub');

    // A job belongs to the loop whose rows started it: valid on either scope, carried with the sub's whole route.
    b.send({ t: 'output', sub, taskId: 'b7k2m9q4x', tail: 65536 });
    expect(await m.next((f) => f.t === 'output' && f.sub === sub, 'output')).toEqual({ t: 'output', project, session: SESSION, agentId: null, sub, taskId: 'b7k2m9q4x', tail: 65536 });
    b.send({ t: 'output', sub: agentSub, taskId: 'a_B-9', tail: 524288 });
    expect(await m.next((f) => f.t === 'output' && f.sub === agentSub, 'the agent output')).toEqual({ t: 'output', project, session: SESSION, agentId: 'a1', sub: agentSub, taskId: 'a_B-9', tail: 524288 });

    // Out of form — a task id the engine never spells, a tail outside 1 to 524288 bytes — refused, never carried.
    const fromM = m.frames.length;
    const fromB = b.frames.length;
    const malformed = [
      { taskId: '', tail: 1 },
      { taskId: 'x'.repeat(65), tail: 1 },
      { taskId: '../b7k2m9q4x', tail: 1 },
      { taskId: 'b7k2.output', tail: 1 },
      { taskId: 7, tail: 1 },
      { tail: 1 },
      { taskId: 'b7k2m9q4x', tail: 0 },
      { taskId: 'b7k2m9q4x', tail: 524289 },
      { taskId: 'b7k2m9q4x', tail: 1.5 },
      { taskId: 'b7k2m9q4x', tail: '1024' },
      { taskId: 'b7k2m9q4x' },
    ];
    for (const fields of malformed) b.send({ t: 'output', sub, ...fields } as unknown as ProjectUp);
    const refusals = await waitFor(() => {
      const got = ofType(b, 'refused', fromB);
      return got.length >= malformed.length ? got : undefined;
    });
    expect(refusals.map((f) => f.refusal.reason)).toEqual(malformed.map(() => 'bad-shape'));
    // Frames on one socket are taken in order: a well-formed one sent after them is the first the machine sees.
    b.send({ t: 'output', sub, taskId: 'after', tail: 10 });
    await m.next((f) => f.t === 'output' && f.taskId === 'after', 'the output after the refusals', fromM);
    expect(m.frames.slice(fromM).filter((f) => f.t === 'output')).toEqual([{ t: 'output', project, session: SESSION, agentId: null, sub, taskId: 'after', tail: 10 }]);

    // The machine's answers go to the one socket holding each sub, as the machine numbered them, bodies unread.
    const fromOther = other.frames.length;
    const snapshot = (s: string) => envelope(m, project, 'snapshot', { rows: [], more: false, subagents: [], presence: presence('busy'), streaming: [] }, SESSION, s, 0);
    const ok = envelope(m, project, 'output', { taskId: 'b7k2m9q4x', result: 'ok', path: '/private/tmp/claude-501/p/s/tasks/b7k2m9q4x.output', size: 70000, from: 4471, text: 'PASS\n', truncated: true }, SESSION, sub, 1);
    const missing = envelope(m, project, 'output', { taskId: 'a_B-9', result: 'missing', path: null }, SESSION, agentSub, 1);
    await m.postOk([{ t: 'session', message: snapshot(sub) }, { t: 'session', message: ok }, { t: 'session', message: snapshot(agentSub) }, { t: 'session', message: missing }]);
    await b.next((f) => f.t === 'session' && f.message.kind === 'output' && f.message.sub === agentSub, 'the agent answer');
    expect(sessionKinds(b).filter((x) => x.kind === 'output')).toEqual([ok, missing]);
    expect(sessionKinds(other, fromOther).filter((x) => x.sub !== null)).toEqual([]);
    b.close();
    other.close();
    await m.close();
  });

  it('carry no output to a machine whose lease is not fresh', async () => {
    const project = newProject();
    const m = await machine(project);
    const b = await browser(project);
    const sub = newNonce();
    b.send({ t: 'subscribe', machine: m.name, session: SESSION, agentId: null, sub });
    await m.next((f) => f.t === 'subscribe', 'subscribe');
    const fromM = m.frames.length;
    // The lease runs out within a millisecond; the request reaches the project before anything renews it.
    await hub.lease(project, { op: 'renew', machine: m.name, generation: m.generation, leaseMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const fromB = b.frames.length;
    b.send({ t: 'output', sub, taskId: 'b7k2m9q4x', tail: 1024 });
    // A refusal sent after it on the same socket marks that the project has taken it.
    b.send({ t: 'rows', sub, before: 'r1', limit: 0 });
    await b.next((f) => f.t === 'refused', 'the marker', fromB);
    // Renewed, the machine serves a fresh sub, and its output is the first the machine is carried.
    await hub.lease(project, { op: 'renew', machine: m.name, generation: m.generation, leaseMs: 45_000 });
    const fresh = newNonce();
    b.send({ t: 'subscribe', machine: m.name, session: SESSION, agentId: null, sub: fresh });
    await m.next((f) => f.t === 'subscribe' && f.sub === fresh, 'the fresh sub', fromM);
    b.send({ t: 'output', sub: fresh, taskId: 'c4d5e6', tail: 1024 });
    await m.next((f) => f.t === 'output' && f.sub === fresh, "the fresh sub's output", fromM);
    expect(m.frames.slice(fromM).filter((f) => f.t === 'output')).toEqual([{ t: 'output', project, session: SESSION, agentId: null, sub: fresh, taskId: 'c4d5e6', tail: 1024 }]);
    b.close();
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

  it("a subscribe whose send finds its stream replaced leaves the replacement sub's route, through a hibernation (scalpel-2#2)", async () => {
    const project = newProject();
    const m = await machine(project);
    const b = await browser(project);
    const sub = newNonce();
    await hub.holdSend(m.name, 'subscribe');
    b.send({ t: 'subscribe', machine: m.name, session: SESSION, agentId: null, sub });
    // The stream goes while the subscribe's send waits: the sub ends at the browser.
    await m.close();
    await b.next((f) => f.t === 'session' && f.message.sub === sub && f.message.kind === 'end', 'the end');
    // Back on a new stream, the browser subscribes again with the same sub, and the machine serves it.
    await m.connect();
    await m.sync(project);
    await m.postOk([{ t: 'session', message: envelope(m, project, 'machine', machinePresence, null) }]);
    const from = b.frames.length;
    b.send({ t: 'subscribe', machine: m.name, session: SESSION, agentId: null, sub });
    await m.next((f) => f.t === 'subscribe' && f.sub === sub, 'the replacement subscribe');
    // The first send now goes on, to a stream that is no longer the machine's: offline.
    await hub.releaseSend(m.name);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const life = await hub.projectLife(project);
    await hub.evict('Project', `${ORG}:${project}`, 'hibernate');
    expect(await hub.projectLife(project)).not.toBe(life);
    await m.postOk([{ t: 'session', message: envelope(m, project, 'snapshot', { rows: [], more: false, subagents: [], presence: presence('busy'), streaming: [] }, SESSION, sub, 0) }]);
    expect(await b.next((f) => f.t === 'session' && f.message.sub === sub && f.message.kind === 'snapshot', 'the snapshot, routed after the hibernation', from)).toMatchObject({
      message: { kind: 'snapshot', sub, n: 0 },
    });
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

describe('the desk control surface (M0): reads, ops, capabilities, command', () => {
  it("carries a read to the machine with the sub's route, refuses one out of form, and relays its answer to the sub's socket alone", async () => {
    const project = newProject();
    const m = await machine(project);
    const b = await browser(project);
    const other = await browser(project);
    const sub = newNonce();
    const agentSub = newNonce();
    b.send({ t: 'subscribe', machine: m.name, session: SESSION, agentId: null, sub });
    await m.next((f) => f.t === 'subscribe' && f.sub === sub, 'subscribe');
    b.send({ t: 'subscribe', machine: m.name, session: SESSION, agentId: 'a1', sub: agentSub });
    await m.next((f) => f.t === 'subscribe' && f.sub === agentSub, 'the agent sub');

    b.send({ t: 'read', sub, id: 'r1', what: 'status' });
    expect(await m.next((f) => f.t === 'read' && f.id === 'r1', 'read')).toEqual({ t: 'read', project, session: SESSION, agentId: null, sub, id: 'r1', what: 'status' });
    b.send({ t: 'read', sub, id: 'r2', what: 'usage', args: { breakdown: 'full' } });
    expect(await m.next((f) => f.t === 'read' && f.id === 'r2', 'read with args')).toEqual({ t: 'read', project, session: SESSION, agentId: null, sub, id: 'r2', what: 'usage', args: { breakdown: 'full' } });
    // Which kinds an agent's scope serves is the machine's to say: the hub carries the route whole.
    b.send({ t: 'read', sub: agentSub, id: 'r3', what: 'status' });
    expect(await m.next((f) => f.t === 'read' && f.id === 'r3', 'the agent read')).toMatchObject({ agentId: 'a1', sub: agentSub });

    // Out of form: refused, never carried.
    const fromM = m.frames.length;
    const fromB = b.frames.length;
    const malformed = [
      { id: '', what: 'status' },
      { id: 'x'.repeat(65), what: 'status' },
      { id: 7, what: 'status' },
      { what: 'status' },
      { id: 'a', what: 'Status' },
      { id: 'a', what: '' },
      { id: 'a', what: 'x'.repeat(33) },
      { id: 'a', what: 'status/../x' },
      { id: 'a', what: 'status', args: [] },
      { id: 'a', what: 'status', args: 'full' },
      { id: 'a', what: 'status', args: null },
      { id: 'a', what: 'status', args: { q: 'x'.repeat(4096) } },
    ];
    for (const fields of malformed) b.send({ t: 'read', sub, ...fields } as unknown as ProjectUp);
    const refusals = await waitFor(() => {
      const got = ofType(b, 'refused', fromB);
      return got.length >= malformed.length ? got : undefined;
    });
    expect(refusals.map((f) => f.refusal.reason)).toEqual(malformed.map(() => 'bad-shape'));
    // A sub the socket does not hold is passed over quietly, as diff is.
    other.send({ t: 'read', sub, id: 'theirs', what: 'status' });
    b.send({ t: 'read', sub, id: 'after', what: 'status' });
    await m.next((f) => f.t === 'read' && f.id === 'after', 'the read after the refusals', fromM);
    expect(m.frames.slice(fromM).filter((f) => f.t === 'read').map((f) => (f as { id: string }).id)).toEqual(['after']);
    // Every browser of the project sees the hub's refusals (the audit record), and none for the read passed over.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(ofType(other, 'refused')).toHaveLength(malformed.length);

    // The answers go to the socket holding the sub, numbered as the machine numbered them, bodies unread.
    const fromOther = other.frames.length;
    const snapshot = envelope(m, project, 'snapshot', { rows: [], more: false, subagents: [], presence: presence('idle'), streaming: [] }, SESSION, sub, 0);
    const answer = envelope(m, project, 'read', { id: 'r1', what: 'status', result: { version: { version: '2.1.307', base: '2.1.307' }, surfaces: ['cli'] } }, SESSION, sub, 1);
    const failed = envelope(m, project, 'read', { id: 'r2', what: 'usage', error: { code: 'unsupported', message: 'no read usage' } }, SESSION, sub, 2);
    await m.postOk([{ t: 'session', message: snapshot }, { t: 'session', message: answer }, { t: 'session', message: failed }]);
    await b.next((f) => f.t === 'session' && f.message.kind === 'read' && f.message.n === 2, 'the answers');
    expect(sessionKinds(b).filter((x) => x.kind === 'read')).toEqual([answer, failed]);
    expect(sessionKinds(other, fromOther).filter((x) => x.sub !== null)).toEqual([]);
    b.close();
    other.close();
    await m.close();
  });

  it("relays an op to every browser unread, as compact; keeps a presence's capabilities and the machine's desk; forwards command", async () => {
    const project = newProject();
    const m = await machine(project);
    const b = await browser(project);
    const other = await browser(project);

    // A presence carrying the bridge's capabilities (a sibling of `bridge`) is kept whole and shown to each browser,
    // and to a browser that connects later.
    const capabilities = { sminos: '1.7.0', protocol: 2, engine: '2.1.307', ops: ['ping', 'read', 'command'], reads: ['status'], routes: { measured: '2.1.307' } };
    const live = envelope(m, project, 'presence', { ...presence('idle'), capabilities });
    await m.postOk([{ t: 'session', message: live }]);
    expect((await other.next((f) => f.t === 'session' && f.message.kind === 'presence', 'presence')) as { message: SessionMessage }).toMatchObject({ message: { body: { capabilities } } });
    const later = await browser(project);
    expect((await later.next((f) => f.t === 'session' && f.message.kind === 'presence', 'kept presence')) as { message: SessionMessage }).toMatchObject({ message: live });

    // The machine's desk is admitted and kept with the body the hub rebuilds; a malformed one is refused whole.
    const desk = { sminos: '1.7.0', rpcs: ['steer', 'command'], reads: [] };
    const fromB = b.frames.length;
    await m.postOk([{ t: 'session', message: envelope(m, project, 'machine', { ...machinePresence, desk, extra: 'dropped' }, null) }]);
    const machines = await b.next((f) => f.t === 'machines' && f.machines.some((x) => x.desk !== undefined), 'machines', fromB);
    expect((machines as Extract<ProjectDown, { t: 'machines' }>).machines.find((x) => x.machine === m.name)).toEqual({ machine: m.name, ...machinePresence, desk });
    const fromRefused = ofType(b, 'machines').length;
    for (const bad of [{ sminos: 1, rpcs: [], reads: [] }, { sminos: '1.7.0', rpcs: 'command', reads: [] }, { sminos: '1.7.0', rpcs: [], reads: [''] }, { sminos: '1.7.0', rpcs: [] }]) {
      const answer = await m.post([{ t: 'session', message: envelope(m, project, 'machine', { ...machinePresence, desk: bad }, null) }]);
      expect((await answer.json()) as { refused: unknown[] }).toMatchObject({ refused: [{ index: 0, reason: 'bad-shape' }] });
    }
    expect(ofType(b, 'machines').length).toBe(fromRefused);
    const reconnected = await browser(project);
    expect((await reconnected.next((f) => f.t === 'machines', 'machines on connect')) as Extract<ProjectDown, { t: 'machines' }>).toMatchObject({ machines: [{ machine: m.name, desk }] });

    // An op goes to every browser of the project, its body unread; sub and n are null.
    const start = envelope(m, project, 'op', { rpc: null, op: 'command', phase: 'start', id: 'c1', name: 'rename', args: 'desk-m0' });
    const end = envelope(m, project, 'op', { rpc: null, op: 'command', phase: 'end', id: 'c1', name: 'rename', args: 'desk-m0', settled: { ok: true }, readback: { how: 'row', text: 'Session renamed to: desk-m0', uuid: 'u1' } });
    await m.postOk([{ t: 'session', message: start }, { t: 'session', message: end }]);
    for (const x of [b, other]) {
      await x.next((f) => f.t === 'session' && f.message.kind === 'op' && (f.message.body as { phase: string }).phase === 'end', 'op end');
      expect(sessionKinds(x).filter((s) => s.kind === 'op')).toEqual([start, end]);
    }
    const inSub = await m.post([{ t: 'session', message: envelope(m, project, 'op', { rpc: null, op: 'command', phase: 'end', id: 'c2' }, SESSION, 's', 1) }]);
    expect((await inSub.json()) as { refused: unknown[] }).toMatchObject({ refused: [{ index: 0, reason: 'bad-shape' }] });

    // command is an RPC the hub forwards as sealed, and its result relayed as the machine sent it.
    const call = await rpc(project, m.name, 'command', { session: SESSION, name: 'rename', args: 'desk-m0' });
    b.send({ t: 'rpc', rpc: call });
    expect(((await m.next((f) => f.t === 'rpc', 'the command')) as Extract<DownFrame, { t: 'rpc' }>).rpc).toEqual(call);
    await m.postOk([{ t: 'rpc-result', project, nonce: call.nonce, outcome: { state: 'done', result: { queued: true, route: 'run', id: 'c3' } } }]);
    expect(await b.next((f) => f.t === 'rpc-state' && f.state === 'done', 'queued')).toMatchObject({ outcome: { result: { queued: true, route: 'run', id: 'c3' } } });
    for (const x of [b, other, later, reconnected]) x.close();
    await m.close();
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

  it.each([
    ['in one life of the object', false],
    ['across an eviction of the object between the two', true],
  ])('a settlement sent again is accepted once: one broadcast, one decision in the record (%s)', async (_, evict) => {
    const project = newProject();
    const m = await machine(project);
    const b = await browser(project);
    const request = await raised(project, 'toolu_twice');
    await m.postOk([{ t: 'session', message: envelope(m, project, 'raised', request) }]);
    await waitFor(() => (lastPending(b)?.length === 1 ? true : undefined));
    const decided = await settled(project, 'toolu_twice', 'web', 'allow', memberId);
    await m.postOk([{ t: 'session', message: envelope(m, project, 'settled', decided) }]);
    await b.next((f) => f.t === 'decided', 'decided');
    if (evict) {
      const before = await hub.projectLife(project);
      await hub.evict('Project', `${ORG}:${project}`, 'hibernate');
      expect(await hub.projectLife(project)).not.toBe(before);
    }
    // The daemon restarted between sending its settlement and recording that it did: it sends it again.
    await m.postOk([{ t: 'session', message: envelope(m, project, 'settled', decided) }]);
    // A marker after it, so the browser has seen everything the second settlement could have caused.
    await m.postOk([{ t: 'session', message: envelope(m, project, 'presence', presence('busy')) }]);
    await b.next((f) => f.t === 'session' && f.message.kind === 'presence', 'the marker');
    expect(sessionKinds(b).filter((x) => x.kind === 'settled')).toHaveLength(1);
    expect(ofType(b, 'decided')).toHaveLength(1);
    const late = await browser(project);
    late.send({ t: 'resume', after: 0 });
    await late.next((f) => f.t === 'caught-up', 'caught-up');
    await waitFor(() => (ofType(late, 'decided').length > 0 ? true : undefined));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(ofType(late, 'decided')).toHaveLength(1);
    late.close();
    b.close();
    await m.close();
  });

  it("a subagent's raise, its input capped, is relayed and kept with agentId and truncated, and its code verifies", async () => {
    const project = newProject();
    const m = await machine(project);
    const b = await browser(project);
    const request = await raised(project, 'toolu_sub', { agentId: 'a7f3', truncated: true, input: { command: 'x'.repeat(64) } });
    expect(await verify(await KEY, 'raised', project, request)).toBe(true);
    await m.postOk([{ t: 'session', message: envelope(m, project, 'raised', request) }]);
    await waitFor(() => (lastPending(b)?.length === 1 ? true : undefined));
    expect(lastPending(b)).toEqual([{ machine: m.name, raised: request, terminal_only: false }]);
    expect(sessionKinds(b).find((x) => x.kind === 'raised')?.body).toEqual(request);
    // Either field in another form is refused.
    for (const bad of [{ agentId: 7 }, { agentId: '' }, { truncated: false }]) {
      const from = b.frames.length;
      await m.postOk([{ t: 'session', message: envelope(m, project, 'raised', { ...(await raised(project, `toolu_bad_${JSON.stringify(bad)}`)), ...bad }) }]);
      expect(await b.next((f) => f.t === 'refused', JSON.stringify(bad), from)).toMatchObject({ refusal: { reason: 'bad-shape' } });
    }
    b.close();
    await m.close();
  });

  it("a raise naming its transcript call's toolUseId is kept, relayed, and republished with it intact, its code verifying", async () => {
    const project = newProject();
    const m = await machine(project);
    const b = await browser(project);
    // The ask mod's blocking question: raised under the dialog's id, its transcript call another.
    const request = await raised(project, 'toolu_plugin_ask_1', { tool: 'AskUserQuestion', toolUseId: 'toolu_01YLTbS83Smb5RvQKJwQtK2S' });
    expect(await verify(await KEY, 'raised', project, request)).toBe(true);
    expect(await verify(await KEY, 'raised', project, { ...request, toolUseId: 'toolu_01other' })).toBe(false);
    await m.postOk([{ t: 'session', message: envelope(m, project, 'raised', request) }]);
    await waitFor(() => (lastPending(b)?.length === 1 ? true : undefined));
    expect(lastPending(b)).toEqual([{ machine: m.name, raised: request, terminal_only: false }]);
    expect(sessionKinds(b).find((x) => x.kind === 'raised')?.body).toEqual(request);
    // Republished after a reconnect, and handed to a browser that connects later, it still carries the id.
    await m.postOk([{ t: 'pending', project, raised: [request] }]);
    const later = await browser(project);
    expect(((await later.next((f) => f.t === 'pending', 'pending')) as Extract<ProjectDown, { t: 'pending' }>).requests).toEqual([{ machine: m.name, raised: request, terminal_only: false }]);
    // An id in another form is refused.
    for (const bad of [{ toolUseId: 7 }, { toolUseId: '' }]) {
      const from = b.frames.length;
      await m.postOk([{ t: 'session', message: envelope(m, project, 'raised', { ...(await raised(project, `toolu_bad_${JSON.stringify(bad)}`)), ...bad }) }]);
      expect(await b.next((f) => f.t === 'refused', JSON.stringify(bad), from)).toMatchObject({ refusal: { reason: 'bad-shape' } });
    }
    later.close();
    b.close();
    await m.close();
  });

  it('a delivery recorded for a closed terminal session turns delivered after Resume; uncertain is kept as an outcome', async () => {
    const project = newProject();
    const m = await machine(project);
    const event = { writer: `hub/${memberId}`, seq: 9 };
    const recorded: Delivery = await seal(await KEY, 'delivery', project, { event, session: SESSION, outcome: 'recorded', reason: 'the terminal session is closed' });
    const delivered: Delivery = await seal(await KEY, 'delivery', project, { event, session: SESSION, outcome: 'delivered', reason: '' });
    const uncertain: Delivery = await seal(await KEY, 'delivery', project, { event, session: SECOND, outcome: 'uncertain', reason: 'woken, never answered' });
    await m.postOk([{ t: 'session', message: envelope(m, project, 'delivery', recorded) }, { t: 'session', message: envelope(m, project, 'delivery', uncertain, SECOND) }]);
    const before = await browser(project);
    const first = ((await before.next((f) => f.t === 'deliveries', 'deliveries')) as Extract<ProjectDown, { t: 'deliveries' }>).deliveries;
    expect(first).toHaveLength(2);
    expect(first).toEqual(expect.arrayContaining([recorded, uncertain]));
    before.close();
    // Resume brought the session back and the owed event was delivered: the same key's latest outcome.
    await m.postOk([{ t: 'session', message: envelope(m, project, 'delivery', delivered) }]);
    const after = await browser(project);
    const latest = ((await after.next((f) => f.t === 'deliveries', 'deliveries')) as Extract<ProjectDown, { t: 'deliveries' }>).deliveries;
    expect(latest).toHaveLength(2);
    expect(latest).toEqual(expect.arrayContaining([delivered, uncertain]));
    after.close();
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

describe("a POST's answer names the frames it refused (MAWS #88)", () => {
  it('names a settlement for a project its stream has not opened, in the same answer; an applied one names none', async () => {
    const open = newProject();
    const closed = newProject();
    const m = await machine(open);
    const response = await m.post([{ t: 'session', message: envelope(m, closed, 'settled', await settled(closed, 'toolu_closed', 'web', 'allow', memberId)) }]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, frames: 1, refused: [{ index: 0, reason: 'not-open' }] });

    const applied = await m.post([{ t: 'session', message: envelope(m, open, 'presence', presence('idle')) }]);
    expect(await applied.json()).toEqual({ ok: true, frames: 1, refused: [] });
    await m.close();
  });

  it("applies an open project's frames and names only the others, across runs, a part set, and a frame naming no project", async () => {
    const open = newProject();
    const closed = newProject();
    const other = newProject();
    const m = await machine(open);
    const b = await browser(open);
    await b.next((f) => f.t === 'pending', 'pending on connect');
    const request = await raised(open, 'toolu_mixed');
    // A settlement of a project not open, sent as parts: named by its last part.
    const parts = toWire({ t: 'session', message: envelope(m, other, 'settled', await settled(other, 'toolu_parts', 'web', 'allow', memberId)) }, 200).map((line) => JSON.parse(line) as UpFrame);
    expect(parts.length).toBeGreaterThan(1);
    const frames: UpFrame[] = [
      { t: 'session', message: envelope(m, open, 'raised', request) },
      { t: 'session', message: envelope(m, closed, 'settled', await settled(closed, 'toolu_elsewhere', 'web', 'allow', memberId)) },
      // An empty upload, the uplink's probe: refused on the replies lane, which this POST waits for.
      { t: 'events', project: closed, events: [] },
      { t: 'session', message: envelope(m, open, 'presence', presence('busy')) },
      ...parts,
      { t: 'pending', project: 'not-a-project-id', raised: [] },
      { t: 'pending', project: open, raised: [request] },
    ];
    const last = 3 + parts.length;
    const response = await m.post(frames);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      frames: frames.length,
      refused: [
        { index: 1, reason: 'not-open' },
        { index: 2, reason: 'not-open' },
        { index: last, reason: 'not-open' },
        { index: last + 1, reason: 'bad-shape' },
      ],
    });

    await waitFor(() => (lastPending(b)?.length === 1 ? true : undefined));
    await waitFor(() => (sessionKinds(b).some((x) => x.kind === 'presence') ? true : undefined));
    expect(lastPending(b)).toEqual([{ machine: m.name, raised: request, terminal_only: false }]);
    expect(sessionKinds(b).filter((x) => x.kind === 'presence').map((x) => x.body)).toEqual([presence('busy')]);
    b.close();
    await m.close();
  });

  it('still refuses the frame down the stream, on the control lane, for a machine that reads only the stream', async () => {
    const open = newProject();
    const closed = newProject();
    const m = await machine(open);
    const from = m.frames.length;
    await m.postOk([{ t: 'session', message: envelope(m, closed, 'settled', await settled(closed, 'toolu_stream', 'web', 'allow', memberId)) }]);
    expect(await m.next((f) => f.t === 'refused' && f.project === closed, 'the refusal on the stream', from)).toEqual({
      t: 'refused',
      project: closed,
      refusal: { reason: 'not-open', message: 'send hello for this project on this stream first' },
    });
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
    // A lease of 15 heartbeats (the deployed one is 3 of 15 s). Each renewal goes from the hub's timer through the
    // suite's proxy and client and back through the Worker to the project, and on a loaded box one can land more than a
    // second late: under a lease of 1.2 s the machine flapped offline (MAWS's pool, run 39568222090). What this proves is
    // that renewals carry the machine past its lease, so the wait ends a second after the lease the hello started.
    const leaseMs = 3000;
    const m = await machine(project, { heartbeatMs: 200, leaseMs });
    const helloed = Date.now(); // machine()'s hello started the lease before this
    const b = await browser(project);
    await m.postOk([{ t: 'session', message: envelope(m, project, 'machine', machinePresence, null) }]);
    await new Promise((resolve) => setTimeout(resolve, helloed + leaseMs + 1000 - Date.now()));
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

  it('a visible socket that has not refreshed its visibility within the window no longer holds pushes back', async () => {
    const project = newProject();
    const m = await machine(project);
    // The window shortened to 400 ms for this project (90 s deployed), through a suite seam.
    await hub.visibleWindow(project, 400);
    const ua = await userAgent(`https://push.test/asleep-${project}`);
    await hub.fetchAs(ADMIN, '/api/push/subscriptions', { method: 'PUT', body: { endpoint: ua.endpoint, keys: ua.keys } });
    const mine = () => hub.pushes.filter((p) => p.endpoint === ua.endpoint);
    const b = await browser(project);
    b.send({ t: 'visibility', visible: true });
    // Within the window: held back.
    await m.postOk([{ t: 'session', message: envelope(m, project, 'raised', await raised(project, 'toolu_awake')) }]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(mine()).toEqual([]);
    // The phone slept: no refresh came, and the window passed.
    await new Promise((resolve) => setTimeout(resolve, 400));
    await m.postOk([{ t: 'session', message: envelope(m, project, 'raised', await raised(project, 'toolu_asleep')) }]);
    await waitFor(() => (mine().length === 1 ? true : undefined));
    // A refresh holds them back again.
    b.send({ t: 'visibility', visible: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await m.postOk([{ t: 'session', message: envelope(m, project, 'raised', await raised(project, 'toolu_refreshed')) }]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(mine()).toHaveLength(1);
    b.close();
    await m.close();
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
        name: 'demo',
        session: SESSION,
        alias: 'maws-45',
        kind: 'question',
        request: 'toolu_push',
        waiting: expect.any(Number),
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
      name: 'demo',
      session: SESSION,
      alias: 'maws-45',
      kind: 'message',
      event: { writer: message.writer, seq: 2 },
      waiting: expect.any(Number),
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

  // 2026-10-18: an async ask reaches the log as a `question` event. MAWS's own is never raised, so the event is its one
  // signal; a bridge's is reported twice, by its `raised` and by its event (`src` the request's id), in either order.
  it('a fresh question event pushes a question pointing at it; a stale one pushes nothing; a visible browser holds it back', async () => {
    const project = newProject();
    const m = await machine(project);
    const phone = await userAgent(`https://push.test/asked-${project}`);
    await hub.fetchAs(ADMIN, '/api/push/subscriptions', { method: 'PUT', body: { endpoint: phone.endpoint, keys: phone.keys } });
    const mine = () => hub.pushes.filter((p) => p.endpoint === phone.endpoint);

    // Older than ten minutes, as a machine's first sync of its backlog uploads it: nothing.
    await m.postOk([{ t: 'events', project, events: [question(m, project, 1, 'L7f2k9q3-4', new Date(Date.now() - 11 * 60 * 1000))] }]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(mine()).toEqual([]);

    const fresh = question(m, project, 2, 'L7f2k9q3-5');
    await m.postOk([{ t: 'events', project, events: [fresh] }]);
    await waitFor(() => (mine().length === 1 ? true : undefined));
    expect(JSON.parse(new TextDecoder().decode(await decrypt(phone, mine()[0].body)))).toEqual({
      v: 1,
      project,
      name: 'demo',
      session: SESSION,
      alias: 'maws-45',
      kind: 'question',
      event: { writer: fresh.writer, seq: 2 },
      waiting: expect.any(Number),
    });

    // A visible browser of the member: nothing, as for a message.
    const shown = await browser(project);
    shown.send({ t: 'visibility', visible: true });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await m.postOk([{ t: 'events', project, events: [question(m, project, 3, 'L7f2k9q3-6')] }]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(mine()).toHaveLength(1);
    shown.close();
    await m.close();
  });

  it("a bridge's async question and the log's question event for it push once, whichever arrives first", async () => {
    const project = newProject();
    const m = await machine(project);
    const phone = await userAgent(`https://push.test/once-${project}`);
    await hub.fetchAs(ADMIN, '/api/push/subscriptions', { method: 'PUT', body: { endpoint: phone.endpoint, keys: phone.keys } });
    const mine = () => hub.pushes.filter((p) => p.endpoint === phone.endpoint);
    const notice = async (i: number) => JSON.parse(new TextDecoder().decode(await decrypt(phone, mine()[i].body))) as Record<string, unknown>;
    const ask = async (request: string) =>
      envelope(m, project, 'raised', await raised(project, request, { tool: 'mcp__doperpowers__AskUserQuestion', input: { questions: [{ question: 'Ship it?' }] }, async: true }));
    const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

    // The raise first: it pushes, and its event after it does not.
    await m.postOk([{ t: 'session', message: await ask('toolu_first_raised') }]);
    await waitFor(() => (mine().length === 1 ? true : undefined));
    await m.postOk([{ t: 'events', project, events: [question(m, project, 1, 'toolu_first_raised')] }]);
    await settle();
    expect(mine()).toHaveLength(1);
    expect(await notice(0)).toMatchObject({ kind: 'question', request: 'toolu_first_raised' });

    // The event first: it pushes, and the raise after it does not.
    const logged = question(m, project, 2, 'toolu_first_logged');
    await m.postOk([{ t: 'events', project, events: [logged] }]);
    await waitFor(() => (mine().length === 2 ? true : undefined));
    await m.postOk([{ t: 'session', message: await ask('toolu_first_logged') }]);
    await settle();
    expect(mine()).toHaveLength(2);
    expect(await notice(1)).toMatchObject({ kind: 'question', event: { writer: logged.writer, seq: 2 } });

    // Another ask is a push of its own, and a permission request pushes as before.
    await m.postOk([{ t: 'session', message: await ask('toolu_another') }]);
    await m.postOk([{ t: 'session', message: envelope(m, project, 'raised', await raised(project, 'toolu_bash')) }]);
    await waitFor(() => (mine().length === 4 ? true : undefined));
    await settle();
    expect(mine()).toHaveLength(4);
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

  // 2026-10-18 (owner): an open async question counts its session as waiting, its presence busy all the while.
  it('counts a session holding an open async question as waiting and working, under the rule presence counts by: not once its machine is offline', async () => {
    const project = newProject();
    const m = await machine(project, CLOSES);
    const grid = await GridClient.open(hub, ADMIN);
    await m.postOk([
      { t: 'session', message: envelope(m, project, 'presence', presence('busy')) },
      { t: 'events', project, events: [question(m, project, 1, 'toolu_grid')] },
    ]);
    await gridReached(grid, project, 0, { machines_online: 1, working: 1, waiting: 1 }, 'the open question counted');
    const from = grid.frames.length;
    await m.close();
    await gridReached(grid, project, from, { machines_online: 0, working: 0, waiting: 0 }, 'nothing counted of an offline machine');
    grid.close();
  });

  it('stops counting a machine once it is revoked, and counts it again once the name is enrolled anew and opens the project', async () => {
    const project = newProject();
    const kept = await machine(project, CLOSES);
    const revoked = await machine(project, CLOSES);
    const grid = await GridClient.open(hub, ADMIN);
    const reached = (from: number, machines: number, online: number, what: string) => gridReached(grid, project, from, { machines, machines_online: online }, what);
    await reached(0, 2, 2, 'both machines');
    let from = grid.frames.length;
    expect((await hub.fetchAs(ADMIN, `/api/machines/${revoked.name}`, { method: 'DELETE' })).status).toBe(200);
    await reached(from, 1, 1, 'the revoked machine no longer counted');

    from = grid.frames.length;
    const again = new MachineClient(hub, revoked.name, await enroll(hub, ADMIN, revoked.name));
    await again.connect();
    await again.sync(project);
    await reached(from, 2, 2, 'the name enrolled anew counted again');
    grid.close();
    await again.close();
    await kept.close();
  });

  it('a revoked machine is offline in the project at once, though its Machine object restarted and sent no close', async () => {
    const project = newProject();
    const m = await machine(project);
    await m.postOk([{ t: 'session', message: envelope(m, project, 'presence', presence('waiting')) }]);
    const grid = await GridClient.open(hub, ADMIN);
    await gridReached(grid, project, 0, { machines_online: 1, waiting: 1 }, 'the machine online, its session waiting');
    // Its object terminated: the stream ends unannounced, and the project holds the lease for its 45 s.
    hub.expectRuntimeLog(/terminated by the suite/);
    await hub.terminate(m.name);
    await waitFor(() => (m.isEnded ? true : undefined));
    const b = await browser(project);
    await b.next((f) => f.t === 'machines', 'machines');
    expect(ofType(b, 'machines')[0].machines.find((x) => x.machine === m.name)).toMatchObject({ online: true });

    const from = b.frames.length;
    const gridFrom = grid.frames.length;
    expect((await hub.fetchAs(ADMIN, `/api/machines/${m.name}`, { method: 'DELETE' })).status).toBe(200);
    await b.next((f) => f.t === 'machines' && f.machines.some((x) => x.machine === m.name && !x.online), 'the machine offline', from);
    await gridReached(grid, project, gridFrom, { machines: 0, machines_online: 0, waiting: 0 }, 'the machine and its waiting session no longer counted');
    b.close();
    grid.close();
    await m.close();
  });

  it('a project that fails to take a revocation is told again until it does, and stops counting the machine then', async () => {
    const project = newProject();
    const m = await machine(project, CLOSES);
    const grid = await GridClient.open(hub, ADMIN);
    await gridReached(grid, project, 0, { machines: 1, machines_online: 1 }, 'the machine');
    await hub.failNextForget(project);
    const from = grid.frames.length;
    expect((await hub.fetchAs(ADMIN, `/api/machines/${m.name}`, { method: 'DELETE' })).status).toBe(200);
    // Its stream's close took it offline, and the revocation failed to reach the project: still counted.
    await gridReached(grid, project, from, { machines: 1, machines_online: 0 }, 'the machine offline and still counted');
    // The registry's next sweep tells the project again: its alarm's, or here the one a redemption runs first.
    await enroll(hub, ADMIN, `${m.name}-next`);
    await gridReached(grid, project, from, { machines: 0, machines_online: 0 }, 'the revoked machine no longer counted');
    grid.close();
    await m.close();
  });

  it("a removal whose answer from the machine's object was lost after it took it completes when asked again", async () => {
    const project = newProject();
    const m = await machine(project, CLOSES);
    const grid = await GridClient.open(hub, ADMIN);
    await gridReached(grid, project, 0, { machines: 1, machines_online: 1 }, 'the machine');
    const listed = async () => ((await (await hub.fetchAs(ADMIN, '/api/machines')).json()) as { machines: Array<{ name: string }> }).machines.some((x) => x.name === m.name);

    // The object refuses the credential and ends the stream, and its answer is lost: the removal fails, the record stays.
    hub.expectRuntimeLog(/a revocation answer the suite lost/);
    await hub.faultNextRevoke(m.name, 'lose');
    expect((await hub.fetchAs(ADMIN, `/api/machines/${m.name}`, { method: 'DELETE' })).status).not.toBe(200);
    await waitFor(() => (m.isEnded ? true : undefined));
    expect(await listed()).toBe(true);
    expect((await hub.fetchAs(m.creds, '/machine/stream')).status).toBe(403);

    // Asked again, the object answers as it did, and the removal completes: the record goes and the project is told.
    const from = grid.frames.length;
    expect((await hub.fetchAs(ADMIN, `/api/machines/${m.name}`, { method: 'DELETE' })).status).toBe(200);
    expect(await listed()).toBe(false);
    await gridReached(grid, project, from, { machines: 0, machines_online: 0 }, 'the removed machine no longer counted');
    grid.close();
    await m.close();
  });
});

// smns remote identity §5 (owner, 2026-10-19): the web shows a project with a live session or waiting on the owner.
describe("the grid's live count", () => {
  const ended = { record: null, bridge: false };

  it('counts each session whose presence names a process, never a null record, and keeps them while the lease lapses', async () => {
    const project = newProject();
    const m = await machine(project, CLOSES);
    const grid = await GridClient.open(hub, ADMIN);
    await m.postOk([
      { t: 'session', message: envelope(m, project, 'presence', presence('busy')) },
      { t: 'session', message: envelope(m, project, 'presence', ended, SECOND) },
    ]);
    await gridReached(grid, project, 0, { working: 1, live: 1 }, 'the one session with a process');
    let from = grid.frames.length;
    await m.postOk([{ t: 'session', message: envelope(m, project, 'presence', presence('idle'), SECOND) }]);
    await gridReached(grid, project, from, { working: 1, live: 2 }, 'the second session running');
    from = grid.frames.length;
    await m.postOk([{ t: 'session', message: envelope(m, project, 'presence', ended, SECOND) }]);
    await gridReached(grid, project, from, { working: 1, live: 1 }, 'the second session ended');
    // The stream closes and the lease lapses: nothing works on an offline machine, and its session is still live there.
    from = grid.frames.length;
    await m.close();
    await gridReached(grid, project, from, { machines: 1, machines_online: 0, working: 0, live: 1 }, 'the machine offline, its session kept');
    grid.close();
  });

  it('counts no session of a machine that only follows the project, its presence kept from when it held it', async () => {
    const project = newProject();
    const holder = await machine(project, CLOSES);
    const other = await machine(project, CLOSES);
    const grid = await GridClient.open(hub, ADMIN);
    await holder.postOk([{ t: 'session', message: envelope(holder, project, 'presence', presence('busy')) }]);
    await other.postOk([{ t: 'session', message: envelope(other, project, 'presence', presence('idle'), SECOND) }]);
    await gridReached(grid, project, 0, { machines: 2, live: 2 }, 'both sessions');
    const from = grid.frames.length;
    await other.postOk([{ t: 'hello', project, name: 'demo', have: other.vector(project), follow: true }]);
    await gridReached(grid, project, from, { machines: 1, machines_online: 1, live: 1 }, 'the follower out of the count');
    grid.close();
    await other.close();
    await holder.close();
  });

  it('is played by the fake machine: its only session ends, the machine still online, and the project counts none live', async () => {
    const project = newProject();
    const name = `sp-${++machines}`;
    const fake = new FakeMachine({ hub: hub.url, machine: name, credentials: await enroll(hub, ADMIN, name), orgKey: new Uint8Array(32).fill(9), project, recordings: [loadRecording(TWO_SUBAGENTS)] });
    const grid = await GridClient.open(hub, ADMIN);
    await fake.connect();
    await gridReached(grid, project, 0, { machines_online: 1, live: 1 }, 'its session live');
    const from = grid.frames.length;
    await fake.end();
    await gridReached(grid, project, from, { machines_online: 1, live: 0 }, 'its session ended');
    grid.close();
    await fake.close();
  });

  it("drops a revoked machine's sessions from the count", async () => {
    const project = newProject();
    const kept = await machine(project, CLOSES);
    const revoked = await machine(project, CLOSES);
    const grid = await GridClient.open(hub, ADMIN);
    await kept.postOk([{ t: 'session', message: envelope(kept, project, 'presence', presence('busy')) }]);
    await revoked.postOk([{ t: 'session', message: envelope(revoked, project, 'presence', presence('idle'), SECOND) }]);
    await gridReached(grid, project, 0, { live: 2 }, 'both sessions');
    const from = grid.frames.length;
    expect((await hub.fetchAs(ADMIN, `/api/machines/${revoked.name}`, { method: 'DELETE' })).status).toBe(200);
    await gridReached(grid, project, from, { machines: 1, live: 1 }, 'the revoked machine no longer counted');
    grid.close();
    await revoked.close();
    await kept.close();
  });

  it('is added to a registry stored before it, read as none until a report carries it; a report without it keeps the count', async () => {
    const prefix = `live-${projects}`;
    await hub.addProjects(2, prefix);
    const [project, fresh] = [0, 1].map((i) => `${prefix}-${String(i).padStart(12, '0')}`);
    const counts = { machines: 1, machines_online: 1, working: 0, waiting: 0 };
    await hub.report(project, { ...counts, live: 2, seq: 1 });
    let grid = await GridClient.open(hub, ADMIN);
    await gridReached(grid, project, 0, { live: 2 }, 'the stored count');
    grid.close();

    // The registry as it stood before the column, constructed again.
    await hub.summariesBeforeLive();
    await hub.evict('Registry', ORG);
    grid = await GridClient.open(hub, ADMIN);
    await gridReached(grid, project, 0, { machines: 1, live: 0 }, 'the column added, the older row read as none live');
    let from = grid.frames.length;
    await hub.report(project, { ...counts, live: 3, seq: 2 });
    await gridReached(grid, project, from, { live: 3 }, 'a report carrying the count');
    // A `Project` on the version before `live` sends neither it nor a sequence: its counts are taken, the live count kept;
    // for a project the registry holds no counts of yet, none live.
    from = grid.frames.length;
    await hub.report(project, { ...counts, working: 1 });
    await hub.report(fresh, { ...counts, working: 1 });
    await gridReached(grid, project, from, { working: 1, live: 3 }, 'the older report, the count kept');
    await gridReached(grid, fresh, from, { working: 1, live: 0 }, "the older report of a project with no counts yet");
    grid.close();
  });

  it('is sent again after a registry on the version before it took a report without it, though the counts are the same', async () => {
    const project = newProject();
    const m = await machine(project);
    const grid = await GridClient.open(hub, ADMIN);
    await gridReached(grid, project, 0, { machines_online: 1, live: 0 }, 'the machine online, no session yet');
    // During a deploy, the Registry still on the previous version takes the report's counts but not `live`, and answers nothing.
    await hub.nextSummaryAsPrevious();
    const running = { t: 'session', message: envelope(m, project, 'presence', presence('busy')) } as const;
    const from = grid.frames.length;
    await m.postOk([running]);
    await gridReached(grid, project, from, { working: 1, live: 0 }, 'the counts taken without live');
    // Unacknowledged, the report goes out again by itself, though no count changed.
    await gridReached(grid, project, from, { working: 1, live: 1 }, 'the counts sent again, live with them');
    grid.close();
    await m.close();
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

/** A `question` on `m`'s session feed, from the alias maws-45: an async ask the session exported, `src` its id. */
function question(m: MachineClient, project: string, seq: number, src: string, at = new Date()) {
  const event = {
    ts: at.toISOString(),
    writer: `${m.name}/${SESSION}`,
    seq,
    kind: 'question',
    from: 'maws-45',
    to: 'host',
    text: ['Ship it?'],
    choices: ['Yes', 'No'],
    src,
    mac: { nonce: newNonce(), value: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url') },
  };
  m.store(project, event);
  return event;
}

/** Waits for a grid frame after `from` (the grid on connect, a summary after) that carries `project` with `counts`. */
async function gridReached(grid: GridClient, project: string, from: number, counts: Partial<ProjectSummary>, what: string): Promise<void> {
  const carries = (f: GridDown) =>
    (f.t === 'grid' ? f.projects : f.t === 'summary' ? [f.project] : []).some((p) => p.id === project && Object.entries(counts).every(([key, value]) => p[key as keyof ProjectSummary] === value));
  await waitFor(() => (grid.frames.slice(from).some(carries) ? true : undefined)).catch(() => {
    throw new Error(`no ${what}; got ${JSON.stringify(grid.frames.slice(from))}`);
  });
}


describe('op reconnect replay', () => {
  it('expires idle receipts from SQLite on the alarm alone and schedules their earliest expiry after leases close', async () => {
    const project = newProject();
    const m = await machine(project);
    const body = { rpc: 'idle-receipt', op: 'command', phase: 'end', id: 'c', name: 'color', args: 'red', readback: { how: 'row', text: 'Session color set to: red' } };
    await m.postOk([{ t: 'session', message: envelope(m, project, 'op', body) }]);
    await hub.lease(project, { op: 'closed', machine: m.name, generation: m.generation });
    const idle = await hub.receiptAlarm(project);
    expect(idle.before).toBe(1);
    expect(idle.rows).toHaveLength(1);
    expect(idle.alarm).toBe(idle.rows[0].updated + 24 * 3600 * 1000);
    const elapsed = await hub.receiptAlarm(project, 24 * 3600 * 1000 + 1);
    expect(elapsed.before).toBe(1);
    expect(elapsed.rows).toEqual([]); // raw SQL, not ops(), proves the alarm purged it
    expect(elapsed.alarm).toBeNull();
    await m.close();
  });

  it('replays the end missed while a browser was away, once, despite duplicate ends and late starts; isolates sessions and machines', async () => {
    const project = newProject();
    const m = await machine(project);
    const other = await machine(project);
    const old = await browser(project);
    old.close();
    const body = { rpc: 'nonce-replay', op: 'command', phase: 'end', id: 'c1', name: 'color', args: 'red', settled: { ok: true }, readback: { how: 'row', text: 'Session color set to: red', uuid: 'r1' } };
    const end = envelope(m, project, 'op', body);
    await m.postOk([{ t: 'session', message: end }, { t: 'session', message: end }, { t: 'session', message: envelope(m, project, 'op', { ...body, phase: 'start' }) }, { t: 'session', message: envelope(m, project, 'op', { ...body, id: 'c2' }, SECOND) }, { t: 'session', message: envelope(m, project, 'op', { ...body, rpc: null }) }]);
    await other.postOk([{ t: 'session', message: envelope(other, project, 'op', { ...body, id: 'c3' }) }]);
    const b = await browser(project);
    await b.next((f) => f.t === 'session' && f.message.kind === 'op', 'replayed op');
    await b.next((f) => f.t === 'deliveries', 'join complete');
    const ops = sessionKinds(b).filter((s): s is SessionMessage<'op'> => s.kind === 'op');
    expect(ops).toHaveLength(3);
    expect(ops.find((s) => s.machine === m.name && s.session === SESSION)).toEqual(end);
    expect(ops.every((s) => s.body.phase === 'end')).toBe(true);
    b.close();
    await m.close();
    await other.close();
  });
});
