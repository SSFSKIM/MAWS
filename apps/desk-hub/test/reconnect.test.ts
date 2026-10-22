// A machine's reconnect, as the hub makes it (MAWS #57): the instance holding a machine's stream ends it the moment
// Cloudflare routes the object's new requests to a successor, so the machine reconnects at once instead of at its next
// heartbeat's ack; a closed stream's lease holds the machine online for a grace (one heartbeat), so the reconnect does not
// flap its presence; a subscription or an RPC a browser sends in that grace waits for the machine's next stream and is
// carried to it at its `hello`; a POST of a replaced object's stream says so; and an object's exception reaches the machine as
// JSON, never as the runtime's bare 1101. Miniflare cannot keep an old instance streaming while it routes new requests
// to a successor, so the replacement is the suites' seam (`hub.replace`); the probe that finds it is checked for real
// against a live object (`hub.probe`), and runs under every other suite with a stream.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectDown } from '../src/protocol/browser';
import type { DownFrame } from '../src/protocol/machine';
import { importOrgKey, newNonce, sealRpc } from '../src/protocol/codes';
import type { Rpc, RpcDraft } from '../src/protocol/rpc';
import type { SessionMessage } from '../src/protocol/session';
import { BrowserClient, enroll, MachineClient, waitFor } from './support/clients';
import { ADMIN, startLocalHub, type LocalHub } from './support/local';

let hub: LocalHub;
let memberId: string;
beforeAll(async () => {
  hub = await startLocalHub();
  memberId = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
});

const KEY = importOrgKey(new Uint8Array(32).fill(4));
/** An interrupt of the session on `machine`, sealed as the web seals it. */
async function interrupt(project: string, machine: string): Promise<Rpc> {
  const draft = { rpc: 'interrupt', project, machine, member: memberId, created: new Date().toISOString(), nonce: newNonce(), args: { session: SESSION } } as unknown as RpcDraft;
  return sealRpc(await KEY, draft);
}
afterAll(() => hub?.close());

const SESSION = '5e1d0a8e-3b2d-4c5e-9f70-0000000000aa';
let projects = 0;
const newProject = () => `7e1c0a8e-3b2d-4c5e-9f70-${(++projects).toString(16).padStart(12, '0')}`;
let machines = 0;

/** What a closed stream's lease is held for here: long enough to see the hold, short enough to see it run out. */
const GRACE_MS = 1500;
/** The grace the no-flap case reconnects within. Its close, a forwarded RPC, the next stream and that stream's hello take
 * about 350 ms on an idle Mac and passed 1.5 s on a loaded pool box (run 39604097046), where the grace ran out first and
 * failed the RPC the hello was to carry. */
const RECONNECT_GRACE_MS = 5000;
const PROBE_MS = 200;
/** What a change may take past its bound before it counts as late, under the Mac's load rule. */
const MARGIN_MS = 1500;

const machinePresence = { online: true, policy: { read_only: false, ceiling: 'default' }, checkouts: [{ path: '/src/maws', branch: 'main' }] };
const envelope = (m: MachineClient, project: string, kind: SessionMessage['kind'], body: unknown, session: string | null = SESSION) =>
  ({ project, machine: m.name, session, kind, sub: null, n: null, body }) as unknown as SessionMessage;

/** An enrolled machine with a long lease, a grace (GRACE_MS unless given) and the probe above, connected and holding
 * `project`, its presence sent. */
async function machine(project: string, graceMs = GRACE_MS): Promise<MachineClient> {
  const name = `rc-${++machines}`;
  const m = new MachineClient(hub, name, await enroll(hub, ADMIN, name));
  await hub.timing(name, { heartbeatMs: 15_000, leaseMs: 45_000, graceMs, probeMs: PROBE_MS });
  await m.connect();
  await m.sync(project);
  await m.postOk([{ t: 'session', message: envelope(m, project, 'machine', machinePresence, null) }]);
  return m;
}

/** The machine's online state in each `machines` frame the browser was sent from `from` on. */
const onlineStates = (b: BrowserClient, name: string, from = 0) =>
  b.frames
    .slice(from)
    .flatMap((f) => (f.t === 'machines' ? f.machines.filter((x) => x.machine === name).map((x) => x.online) : []));
const isEnd = (sub: string) => (f: ProjectDown) => f.t === 'session' && f.message.kind === 'end' && f.message.sub === sub;

/**
 * Closes the machine's stream and returns once the close has reached the project, which ends what the stream carried at
 * once: a subscription made on it, ended at the browser. A subscribe or an RPC sent before then would still be carried
 * to the closed stream, and end there.
 */
async function closeStream(m: MachineClient, b: BrowserClient): Promise<void> {
  const carried = newNonce();
  b.send({ t: 'subscribe', machine: m.name, session: SESSION, agentId: null, sub: carried });
  await m.next((f) => f.t === 'subscribe' && f.sub === carried, 'the carried subscribe');
  const from = b.frames.length;
  await m.close();
  await b.next(isEnd(carried), 'the carried subscription ended with its stream', from);
}

describe('a machine whose object was replaced under its stream', () => {
  it("the probe of a live object reaches that object itself, so no stream is ended for nothing", async () => {
    const project = newProject();
    const m = await machine(project);
    const probed = await hub.probe(m.name);
    expect(probed.current).toBe(probed.life);
    // Many probes later, the stream is still the one it was.
    await new Promise((resolve) => setTimeout(resolve, 6 * PROBE_MS));
    expect(m.isEnded).toBe(false);
    await m.postOk([{ t: 'hb-ack', generation: m.generation, at: new Date().toISOString() }]);
    await m.close();
  });

  it('ends its stream within the probe; the machine stays online, its subscription waits for the next stream, which takes it at its hello', async () => {
    const project = newProject();
    const m = await machine(project);
    const b = await BrowserClient.open(hub, ADMIN, project);
    await b.next((f) => f.t === 'machines' && f.machines.some((x) => x.machine === m.name && x.online), 'online');
    const old = m.generation;
    const first = newNonce();
    b.send({ t: 'subscribe', machine: m.name, session: SESSION, agentId: null, sub: first });
    await m.next((f) => f.t === 'subscribe' && f.sub === first, 'the first subscribe');

    const from = b.frames.length;
    const at = Date.now();
    await hub.replace(m.name);
    await waitFor(() => (m.isEnded ? true : undefined), PROBE_MS + MARGIN_MS);
    expect(Date.now() - at).toBeLessThan(PROBE_MS + MARGIN_MS);
    // What the stream carried ends with it: the subscription, at the browser, as the machine's.
    const ended = (await b.next(isEnd(first), 'the first subscription ended', from)) as Extract<ProjectDown, { t: 'session' }>;
    expect(ended.message.body).toMatchObject({ reason: 'machine-offline' });
    // The hub's own record says why.
    expect(hub.runtimeLogs.some((l) => /"event":"end"/.test(l.message) && /"cause":"replaced"/.test(l.message) && l.message.includes(`"machine":"${m.name}"`))).toBe(true);

    // The browser subscribes again before the machine is back: the subscription waits, and nothing ends it.
    const second = newNonce();
    b.send({ t: 'subscribe', machine: m.name, session: SESSION, agentId: null, sub: second });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(b.frames.slice(from).some(isEnd(second))).toBe(false);

    // The machine reconnects: its hello takes the lease over, and the waiting subscription reaches the new stream.
    const reconnected = m.frames.length;
    await m.connect();
    expect(m.generation).toBe(old + 1);
    await m.sync(project);
    await m.next((f) => f.t === 'subscribe' && f.sub === second, 'the waiting subscribe on the new stream', reconnected);
    // The machine never read as offline.
    expect(onlineStates(b, m.name, from)).not.toContain(false);
    b.close();
    await m.close();
  });

  it("answers a POST of the stream it lost 409 replaced, which the machine's log keeps", async () => {
    const project = newProject();
    const m = await machine(project);
    m.autoAck = false;
    hub.expectRuntimeLog(/terminated by the suite/);
    // A terminated object loses its memory, its stream with it, and the next request reaches a fresh instance: as a
    // replaced one's POSTs reach its successor.
    await hub.terminate(m.name);
    const response = await m.post([{ t: 'hb-ack', generation: m.generation, at: new Date().toISOString() }]);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'stale-generation', replaced: true });
    // A POST of a stream that a newer one replaced is plainly stale.
    await m.connect();
    const stale = await m.post([{ t: 'hb-ack', generation: m.generation - 1, at: new Date().toISOString() }], m.generation - 1);
    expect(stale.status).toBe(409);
    expect(await stale.json()).not.toHaveProperty('replaced');
    await m.close();
  });
});

describe("a closed stream's grace", () => {
  it('holds the machine online for the grace, keeps a subscription and an RPC sent in it waiting, and ends all three once it runs out', async () => {
    const project = newProject();
    const m = await machine(project);
    const b = await BrowserClient.open(hub, ADMIN, project);
    await b.next((f) => f.t === 'machines' && f.machines.some((x) => x.machine === m.name && x.online), 'online');
    const from = b.frames.length;
    m.autoAck = false;
    const closedAt = Date.now();
    await closeStream(m, b);
    const waiting = newNonce();
    b.send({ t: 'subscribe', machine: m.name, session: SESSION, agentId: null, sub: waiting });
    const call = await interrupt(project, m.name);
    b.send({ t: 'rpc', rpc: call });
    // The RPC, sent after the subscribe, is answered after anything the hub answered the subscribe with at once; a while
    // longer leaves room for an end that would come later.
    await b.next((f) => f.t === 'rpc-state' && f.nonce === call.nonce, 'the RPC recorded', from);
    await new Promise((resolve) => setTimeout(resolve, GRACE_MS / 4));
    expect(onlineStates(b, m.name, from)).not.toContain(false);
    expect(b.frames.slice(from).some(isEnd(waiting))).toBe(false);
    // The RPC is recorded as forwarded, and waits: nothing has failed it.
    expect(b.frames.slice(from).filter((f) => f.t === 'rpc-state' && f.nonce === call.nonce).map((f) => (f as { state: string }).state)).toEqual(['forwarded']);

    await b.next((f) => f.t === 'machines' && f.machines.some((x) => x.machine === m.name && !x.online), 'offline once the grace ran out', from, GRACE_MS + 2 * MARGIN_MS);
    expect(Date.now() - closedAt).toBeGreaterThanOrEqual(GRACE_MS - 100);
    const ended = (await b.next(isEnd(waiting), 'the waiting subscription ended', from)) as Extract<ProjectDown, { t: 'session' }>;
    expect(ended.message).toMatchObject({ n: 0, body: { reason: 'machine-offline' } });
    // It never reached the machine: it fails, rather than reading as possibly done.
    expect(await b.next((f) => f.t === 'rpc-state' && f.nonce === call.nonce && f.state !== 'forwarded', 'the waiting RPC settled', from)).toMatchObject({
      state: 'failed',
      outcome: { error: { code: 'machine-offline' } },
    });
    b.close();
  });

  it('a reconnect within the grace is no flap: the browser sees no offline, an RPC sent between streams reaches the next one, and a new subscription is served', async () => {
    const project = newProject();
    const m = await machine(project, RECONNECT_GRACE_MS);
    const b = await BrowserClient.open(hub, ADMIN, project);
    await b.next((f) => f.t === 'machines' && f.machines.some((x) => x.machine === m.name && x.online), 'online');
    const from = b.frames.length;
    await closeStream(m, b);
    const call = await interrupt(project, m.name);
    b.send({ t: 'rpc', rpc: call });
    await b.next((f) => f.t === 'rpc-state' && f.nonce === call.nonce && f.state === 'forwarded', 'the RPC forwarded', from);
    const reconnected = m.frames.length;
    await m.connect();
    await m.sync(project);
    expect(((await m.next((f) => f.t === 'rpc', 'the waiting RPC on the new stream', reconnected)) as Extract<DownFrame, { t: 'rpc' }>).rpc.nonce).toBe(call.nonce);
    const sub = newNonce();
    b.send({ t: 'subscribe', machine: m.name, session: SESSION, agentId: null, sub });
    await m.next((f) => f.t === 'subscribe' && f.sub === sub, 'the subscribe', reconnected);
    // Past the grace too: the new stream's lease holds.
    await new Promise((resolve) => setTimeout(resolve, RECONNECT_GRACE_MS + 300));
    expect(onlineStates(b, m.name, from)).not.toContain(false);
    b.close();
    await m.close();
  });
});

describe("an object's exception at the Worker", () => {
  it("reaches the machine as JSON with the error's message, not the runtime's 1101", async () => {
    const project = newProject();
    const m = await machine(project);
    hub.expectRuntimeLog(/a failure the suite injected|worker-exception/);
    await hub.failFetch(m.name, '/frames');
    const response = await m.post([{ t: 'hb-ack', generation: m.generation, at: new Date().toISOString() }]);
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe('hub-error');
    expect(body.message).toContain('a failure the suite injected');
    await m.close();
  });
});
