// RL1 and the Machine object's relay (O11 M6; Interfaces §C): a v2 machine holds one WebSocket, `/machine/socket`, held
// by the Machine object its ref addresses, carrying DX2's log plane, `hb`/`hb-ack` with the lease, its listings and
// `notify`, and the channel multiplex; an app's socket, `/api/machines/<name or ref>/socket`, opens channels through it,
// and the object relays their bytes unread. One generation counter serves DX2's stream and RL1's socket, so either
// ends the other; both socket kinds hibernate, and what they carry survives an eviction.
import { generateSigningKey, keyId, base64urlEncode, type SignedOrgState, type SigningKey } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeEndpoint } from '../fake-machine/endpoint';
import { enrollDelegated, enrollV2, listing, type DelegationKey, type V2Machine } from '../fake-machine/org';
import { echoCheck, echoPayloads, RelayApp } from '../fake-machine/relay-app';
import { newNonce } from '../src/protocol/codes';
import { delegationFor, encodeEnrollmentCodeV2 } from '../src/protocol/identity';
import type { LogEvent } from '../src/protocol/log';
import { BrowserClient, enroll, GridClient, MachineClient, provisioningKey, refusal, waitFor } from './support/clients';
import { ADMIN, credentials, ORG, startLocalHub, type LocalHub } from './support/local';
import { genesis, memberId, newDevice, next, revokedDevice, signedBy, type TestDevice } from './support/org';
import { decrypt, userAgent, type UserAgent } from './support/push';

let hub: LocalHub;
let a1: TestDevice;
let recovery: SigningKey;
let head: SignedOrgState;
let A: string;
const B = memberId();
const MEMBER_B = 'b@example.com';
/** The suite's main machine, enrolled the v2 way and listed in the state. */
let mini: V2Machine;
let b1: TestDevice;
const PROJECT = '7c1d2c3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
const SESSION = '17646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const mac = () => ({ nonce: newNonce(), value: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url') });
const event = (writer: string, seq: number, kind = 'say', extra: Record<string, unknown> = {}): LogEvent =>
  ({ ts: new Date().toISOString(), writer, seq, kind, text: `${kind} ${seq}`, ...extra, mac: mac() }) as unknown as LogEvent;

async function accept(edit: Parameters<typeof next>[1]): Promise<void> {
  const s = await signedBy(await next(head, edit), a1);
  const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: s });
  if (response.status !== 201) throw new Error(`state: ${response.status} ${await response.text()}`);
  head = s;
}

/** A machine enrolled the v2 way under `name` (a code built here, as the admin's app builds one). */
async function v2(name: string): Promise<V2Machine> {
  const response = await hub.fetchAs(ADMIN, '/api/enrollments', { body: {} });
  const { token } = (await response.json()) as { token: string };
  const code = encodeEnrollmentCodeV2({ hub: hub.url, token, roots: [await keyId(a1.stepUp!.pub)], recoveryPub: recovery.pub, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) });
  return enrollV2(code, name);
}

let delegation: DelegationKey | undefined;
let provisioning = '';
/**
 * A VM under a delegation, its certificate posted and no machine key: since O14 M5a the one v2 machine whose credential
 * still opens DX2 (a posted key marks a credential v2's), so the cases of DX2 and RL1 under one name run on one.
 */
async function certified(name: string): Promise<V2Machine> {
  if (delegation === undefined) {
    const key = await provisioningKey(hub, ADMIN, { label: 'vms', prefix: 'vm-', max_uses: null, offline_revoke_s: null });
    const made = { id: key.id, key: await generateSigningKey() };
    await accept((s) => s.delegations.push(delegationFor(key.key, made.key.pub, 'org')));
    [delegation, provisioning] = [made, key.token];
  }
  return enrollDelegated(hub.url, provisioning, name, delegation);
}

/** A v2 machine the org state lists, as RL1 needs (a ref only its key posted routes nowhere). */
async function listed(name: string): Promise<V2Machine> {
  const machine = await v2(name);
  await accept((s) => {
    s.machines.push({ name, ref: machine.ref, pub: machine.key.pub, owners: [A] });
    s.machineNames.push({ name, ref: machine.ref });
  });
  return machine;
}

const endpointOf = (machine: V2Machine, options: Partial<ConstructorParameters<typeof FakeEndpoint>[0]> = {}) =>
  new FakeEndpoint({ hub: hub.url, credentials: machine.credentials, ref: machine.ref, ...options });
const appOf = (machine: string, who = ADMIN) => RelayApp.open(hub.url, machine, credentials(who));
/** The Machine object an RL1 machine's sockets are held by. */
const relayName = (machine: V2Machine) => `ref:${machine.ref}`;
const bytesOf = (seed: number, size: number) => {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = (seed * 31 + i * 7) & 0xff;
  return out;
};
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
/** How many machines hold a project online, as the grid last said; each summary from `from` on. */
const summaries = (grid: GridClient, project: string, from = 0) =>
  grid.frames.slice(from).flatMap((f) => (f.t === 'summary' && f.project.id === project ? [f.project] : f.t === 'grid' ? f.projects.filter((p) => p.id === project) : []));
const onlineIn = (grid: GridClient, project: string) => summaries(grid, project).at(-1)?.machines_online;
/** A browser on the project, caught up on its log. */
async function browserOn(project: string): Promise<BrowserClient> {
  const browser = await BrowserClient.open(hub, ADMIN, project);
  browser.send({ t: 'resume', after: 0 });
  return browser;
}

beforeAll(async () => {
  hub = await startLocalHub();
  A = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
  a1 = await newDevice('a1');
  recovery = await generateSigningKey();
  head = await signedBy(await genesis(ORG, A, ADMIN, a1, recovery), a1);
  expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: head })).status).toBe(201);
  mini = await v2('mini');
  b1 = await newDevice('b1', 'web-cards');
  await accept((s) => {
    s.members.push({ id: B, email: MEMBER_B, role: 'member', devices: [b1.device] });
    s.machines.push({ name: 'mini', ref: mini.ref, pub: mini.key.pub, owners: [A] });
    s.machineNames.push({ name: 'mini', ref: mini.ref });
  });
});
afterAll(() => hub?.close());

describe('the endpoint socket', () => {
  it('says hello with its ref and is welcomed with a generation; each hb is answered hb-ack, and the head is noticed', async () => {
    const endpoint = endpointOf(mini);
    const welcome = await endpoint.connect();
    expect(welcome.generation).toBeGreaterThanOrEqual(1);
    expect(welcome.heartbeat_ms).toBe(15_000);
    await endpoint.next((f) => f.t === 'state' && f.version === head.state.version, 'the head’s notice');
    endpoint.sendText({ t: 'hb', generation: welcome.generation });
    await endpoint.next((f) => f.t === 'hb-ack' && f.generation === welcome.generation, 'hb-ack');
    endpoint.close();
  });

  it('is refused 409 no-ref for a machine the hub holds no ref of, and a hello naming another ref is closed', async () => {
    const v1 = await enroll(hub, ADMIN, 'v1-only');
    expect(await refusal(await hub.fetchAs(v1, '/machine/socket'))).toBe('409 no-ref');
    const stranger = endpointOf({ ...mini, ref: 'AAAAAAAAAAAAAAAAAAAAAA' });
    await expect(stranger.connect()).rejects.toThrow();
    expect(stranger.ends.at(-1)).toMatchObject({ code: 4400, reason: 'wrong-machine' });
  });

  it('carries the log plane: a project opened, its events stored and fanned out both ways, the machine online', async () => {
    const endpoint = endpointOf(mini);
    await endpoint.connect();
    const have = await endpoint.project(PROJECT, 'relay-demo');
    expect(have.have).toEqual({});
    const grid = await GridClient.open(hub, ADMIN);
    await waitFor(() => (onlineIn(grid, PROJECT) === 1 ? true : undefined));
    grid.close();
    const browser = await browserOn(PROJECT);
    const writer = `mini/${SESSION}`;
    endpoint.upload(PROJECT, [event(writer, 1), event(writer, 2)]);
    await browser.next((f) => f.t === 'log' && f.events.some((e) => e.event.writer === writer && e.event.seq === 2), 'the upload at the browser');
    // A DX2 machine's event in the same project reaches the RL1 endpoint down its socket.
    const dx = new MachineClient(hub, 'dx-peer', await enroll(hub, ADMIN, 'dx-peer'));
    await dx.connect();
    await dx.sync(PROJECT, 'relay-demo');
    await dx.postOk([{ t: 'events', project: PROJECT, events: [event(`dx-peer/${SESSION}`, 1)] }]);
    await endpoint.next((f) => f.t === 'events' && (f.events as LogEvent[]).some((e) => e.writer === `dx-peer/${SESSION}`), 'the DX2 machine’s event');
    // A writer not its own is refused by the project, down the same socket.
    endpoint.upload(PROJECT, [event(`dx-peer/${SESSION}`, 2)]);
    await endpoint.next((f) => f.t === 'refused' && (f.refusal as { reason: string }).reason === 'writer-not-yours', 'writer-not-yours');
    await dx.close();
    browser.close();
    endpoint.close();
  });

  it('refuses a DX4/DX6 session-plane frame 422 not-on-rl1 and keeps the socket', async () => {
    const endpoint = endpointOf(mini);
    const { generation } = await endpoint.connect();
    for (const frame of [{ t: 'session', message: { kind: 'presence', project: PROJECT } }, { t: 'pending', project: PROJECT, raised: [] }, { t: 'rpc-result', project: PROJECT, nonce: 'n', outcome: {} }]) {
      const from = endpoint.frames.length;
      endpoint.sendText(frame);
      expect(await endpoint.next((f) => f.t === 'refusal', 'the refusal', from)).toMatchObject({ t: 'refusal', frame: frame.t, status: 422, error: 'not-on-rl1' });
    }
    endpoint.sendText({ t: 'hb', generation });
    await endpoint.next((f) => f.t === 'hb-ack', 'hb-ack after the refusals');
    expect(endpoint.isOpen).toBe(true);
    endpoint.close();
  });

  it('is sent the state notice when the org state advances', async () => {
    const endpoint = endpointOf(mini);
    await endpoint.connect();
    const from = endpoint.frames.length;
    await accept(() => {});
    await endpoint.next((f) => f.t === 'state' && f.version === head.state.version, 'the new version’s notice', from);
    endpoint.close();
  });
});

describe('push from RL1 (acceptance 5)', () => {
  let phoneA: UserAgent;
  let phoneB: UserAgent;
  const subscribe = (who: string, ua: UserAgent, device?: string) =>
    hub.fetchAs(who, '/api/push/subscriptions', { method: 'PUT', body: { endpoint: ua.endpoint, keys: ua.keys, ...(device === undefined ? {} : { device }) } });
  const pushedTo = async (from: number) => {
    const out = new Map<string, unknown>();
    for (const push of hub.pushes.slice(from)) {
      const ua = [phoneA, phoneB].find((u) => u.endpoint === push.endpoint)!;
      out.set(push.endpoint, JSON.parse(new TextDecoder().decode(await decrypt(ua, push.body))));
    }
    return out;
  };

  beforeAll(async () => {
    [phoneA, phoneB] = await Promise.all([userAgent('https://push.test/rl1-a'), userAgent('https://push.test/rl1-b')]);
    expect((await subscribe(ADMIN, phoneA, 'a1')).status).toBe(200);
    expect((await subscribe(MEMBER_B, phoneB, 'b1')).status).toBe(200);
  });

  it('a notify for a session its listing gives owner A reaches only A’s device, carrying only {project, machine, session, kind}', async () => {
    const endpoint = endpointOf(mini);
    await endpoint.connect();
    const app = await appOf('mini');
    endpoint.listing(await listing(mini, SESSION, 1, { owners: [A], project: PROJECT, lane: 'B', state: 'waiting', title: 'relay' }));
    const from = hub.pushes.length;
    endpoint.notify(SESSION, PROJECT, 'waiting', 2);
    await waitFor(() => (hub.pushes.length > from ? true : undefined));
    await sleep(300);
    const pushed = await pushedTo(from);
    expect([...pushed.keys()]).toEqual([phoneA.endpoint]);
    expect(pushed.get(phoneA.endpoint)).toEqual({ project: PROJECT, machine: mini.ref, session: SESSION, kind: 'waiting' });
    // The count is kept for badges and told to the machine's app sockets.
    await app.until(() => (app.presence.at(-1)?.pending[SESSION]?.pending === 2 ? true : undefined), 'the pending count');
    expect(app.presence.at(-1)).toMatchObject({ online: true, pending: { [SESSION]: { project: PROJECT, kind: 'waiting', pending: 2 } } });
    // Settled: no push, and the count is gone.
    const settledFrom = hub.pushes.length;
    endpoint.notify(SESSION, PROJECT, 'settled', 0);
    await app.until(() => (app.presence.at(-1)?.pending[SESSION] === undefined ? true : undefined), 'the count cleared');
    await sleep(200);
    expect(hub.pushes.length).toBe(settledFrom);
    app.close();
    endpoint.close();
  });

  it('refuses a stale listing and another machine’s, down the socket', async () => {
    const endpoint = endpointOf(mini);
    await endpoint.connect();
    let from = endpoint.frames.length;
    endpoint.listing(await listing(mini, SESSION, 1, { owners: [A], project: PROJECT, lane: 'B', state: 'idle', title: 'relay' }));
    expect(await endpoint.next((f) => f.t === 'refusal', 'the stale refusal', from)).toMatchObject({ frame: 'listing', status: 409, error: 'stale-listing', session: SESSION, revision: 1 });
    const other = { ...mini, ref: 'BBBBBBBBBBBBBBBBBBBBBB' };
    from = endpoint.frames.length;
    endpoint.listing(await listing(other, SESSION, 5, { owners: [A], project: PROJECT, lane: 'B', state: 'idle', title: 'x' }));
    expect(await endpoint.next((f) => f.t === 'refusal', 'not-yours', from)).toMatchObject({ frame: 'listing', status: 403, error: 'not-yours' });
    endpoint.close();
  });

  it('does not push again through the log plane: an RL1 upload of a fresh message pushes nothing', async () => {
    const endpoint = endpointOf(mini);
    await endpoint.connect();
    const have = await endpoint.project(PROJECT, 'relay-demo');
    const writer = `mini/${SESSION}`;
    const from = hub.pushes.length;
    const seq = (have.have[writer] ?? 0) + 1;
    endpoint.upload(PROJECT, [event(writer, seq, 'message', { from: 'maws-1', to: 'host' })]);
    const browser = await browserOn(PROJECT);
    await browser.next((f) => f.t === 'log' && f.events.some((e) => e.event.writer === writer && e.event.seq === seq), 'the message stored');
    await sleep(500);
    expect(hub.pushes.length).toBe(from);
    browser.close();
    endpoint.close();
  });
});

describe('channels (acceptance 3)', () => {
  it('carries 1 000 frames of 1 B to 256 KiB byte-identical and in order, through the name or the ref', async () => {
    const endpoint = endpointOf(mini);
    await endpoint.connect();
    const app = await appOf('mini');
    // What the endpoint received on the channel, kept as it arrived (the endpoint forgets a closed channel's).
    const there: Uint8Array[] = [];
    endpoint.onData = (_channel, payload) => there.push(payload);
    const sent = echoPayloads(1000);
    expect([sent[0].length, sent[999].length]).toEqual([1, 256 * 1024]);
    const checked = await echoCheck(app, sent);
    expect(checked.frames).toBe(1000);
    expect(there.length).toBe(1000);
    expect(there.every((payload, i) => same(payload, sent[i]))).toBe(true);
    const channel = checked.channel;
    app.close();

    const byRef = await appOf(mini.ref);
    const second = await byRef.openChannel();
    expect(second).toBeGreaterThan(channel);
    byRef.send(second, bytesOf(7, 10));
    await byRef.until(() => (byRef.received.get(second)?.length === 1 ? true : undefined), 'the echo by ref');
    byRef.close();
    endpoint.close();
  });

  it('refuses a message over 1 MiB, closing the socket with 1009', async () => {
    const endpoint = endpointOf(mini);
    await endpoint.connect();
    const app = await appOf('mini');
    const channel = await app.openChannel();
    app.send(channel, new Uint8Array(1024 * 1024));
    await app.until(() => app.ended, 'the close');
    expect(app.ended).toMatchObject({ code: 1009, reason: 'too-large' });
    // The endpoint hears the app's channel closed.
    await waitFor(() => (endpoint.closes.some((c) => c.channel === channel && c.reason === 'app-gone') ? true : undefined));
    endpoint.close();
  });

  it('answers an open with no endpoint connected by its close, and data on a channel the socket does not hold likewise', async () => {
    const app = await appOf('mini');
    app.ping();
    await app.until(() => (app.pongs === 1 ? true : undefined), 'the pong');
    const channel = await app.openChannel();
    await app.until(() => app.closes.find((c) => c.channel === channel), 'the refusal');
    expect(app.closes.find((c) => c.channel === channel)?.reason).toBe('endpoint-gone');
    app.send(424242, bytesOf(1, 4));
    await app.until(() => app.closes.find((c) => c.channel === 424242), 'unknown-channel');
    expect(app.closes.find((c) => c.channel === 424242)?.reason).toBe('unknown-channel');
    app.close();
  });

  it('closes an app’s channels when the endpoint reconnects, under a higher generation, and the channel opens again', async () => {
    const endpoint = endpointOf(mini, { reconnect: true });
    const { generation } = await endpoint.connect();
    const app = await appOf('mini');
    const channel = await app.openChannel();
    await waitFor(() => (endpoint.channels.has(channel) ? true : undefined));
    endpoint.drop(4000, 'going away');
    await app.until(() => app.closes.find((c) => c.channel === channel), 'the channel’s close');
    expect(app.closes.find((c) => c.channel === channel)?.reason).toBe('endpoint-gone');
    await waitFor(() => (endpoint.isOpen && endpoint.generation > generation ? true : undefined), 10_000);
    await app.until(() => (app.presence.at(-1)?.online ? true : undefined), 'online again');
    const again = await app.openChannel();
    app.send(again, bytesOf(3, 64));
    await app.until(() => (app.received.get(again)?.length === 1 ? true : undefined), 'the echo on the new channel');
    app.close();
    endpoint.close();
  });

  it('answers either end’s close at once with a close carrying its code, an app with channels or without', async () => {
    const endpoint = endpointOf(mini);
    await endpoint.connect();
    const idle = await appOf('mini');
    const busy = await appOf('mini');
    const channel = await busy.openChannel();
    await waitFor(() => (endpoint.channels.has(channel) ? true : undefined));
    idle.close();
    busy.close();
    // Unanswered, Node's client gives up after its own timeout (10 to 15 s) and reports 1006.
    for (const app of [idle, busy]) await app.until(() => app.ended, 'the app’s close answered', 3000);
    expect(idle.ended).toEqual({ code: 1000, reason: 'done' });
    expect(busy.ended).toEqual({ code: 1000, reason: 'done' });
    await waitFor(() => (endpoint.channels.has(channel) ? undefined : true));
    endpoint.drop(4000, 'going away');
    await waitFor(() => (endpoint.ends.length > 0 ? true : undefined), 3000);
    expect(endpoint.ends[0]).toMatchObject({ code: 4000, reason: 'going away' });
  });

  it('after an eviction with both socket kinds open, delivers frames both ways on the right channels', async () => {
    const endpoint = endpointOf(mini);
    await endpoint.connect();
    const apps = [await appOf('mini'), await appOf('mini', MEMBER_B)];
    const channels = [await apps[0].openChannel(), await apps[0].openChannel(), await apps[1].openChannel(), await apps[1].openChannel()];
    const holder = (i: number) => apps[i < 2 ? 0 : 1];
    await waitFor(() => (channels.every((c) => endpoint.channels.has(c)) ? true : undefined));
    const before = (await hub.probe(relayName(mini))).life;
    await hub.evict('Machine', `${ORG}:${relayName(mini)}`, 'hibernate');
    // Up, echoed down: each payload comes back on its own channel only.
    channels.forEach((c, i) => holder(i).send(c, bytesOf(100 + i, 32 + i)));
    for (const [i, c] of channels.entries()) {
      await holder(i).until(() => (holder(i).received.get(c)?.length === 1 ? true : undefined), `the echo on channel ${c}`);
      expect(same(holder(i).received.get(c)![0], bytesOf(100 + i, 32 + i))).toBe(true);
    }
    expect((await hub.probe(relayName(mini))).life).not.toBe(before);
    // Down, unprompted: the endpoint's own data on each channel.
    await hub.evict('Machine', `${ORG}:${relayName(mini)}`, 'hibernate');
    channels.forEach((c, i) => endpoint.sendData(c, bytesOf(200 + i, 8)));
    for (const [i, c] of channels.entries()) {
      await holder(i).until(() => (holder(i).received.get(c)?.length === 2 ? true : undefined), `the endpoint's data on channel ${c}`);
      expect(same(holder(i).received.get(c)![1], bytesOf(200 + i, 8))).toBe(true);
    }
    for (const app of apps) app.close();
    endpoint.close();
  });
});

describe('the lease, the generation and the fence', () => {
  it('heartbeats after an eviction keep the lease past a full LEASE_MS', async () => {
    const machine = await listed('leased');
    const leaseMs = 1200;
    const project = '8d2e3f40-5a61-4b7c-9d8e-0f1a2b3c4d5e';
    await hub.timing(relayName(machine), { heartbeatMs: 200, leaseMs, graceMs: 200 });
    const endpoint = endpointOf(machine);
    const welcome = await endpoint.connect();
    expect(welcome.heartbeat_ms).toBe(200);
    await endpoint.project(project, 'leased-demo');
    const grid = await GridClient.open(hub, ADMIN);
    await waitFor(() => (onlineIn(grid, project) === 1 ? true : undefined));
    const from = grid.frames.length;
    await hub.evict('Machine', `${ORG}:${relayName(machine)}`, 'hibernate');
    await sleep(2.5 * leaseMs);
    expect(summaries(grid, project, from).some((p) => p.machines_online === 0)).toBe(false);
    expect(onlineIn(grid, project)).toBe(1);
    // The lease was short: without heartbeats it lapses.
    endpoint.heartbeats = false;
    await waitFor(() => (onlineIn(grid, project) === 0 ? true : undefined), leaseMs + 5000);
    grid.close();
    endpoint.close();
  });

  it('replaces a DX2 stream by an RL1 socket and back, by one generation counter', async () => {
    const machine = await certified('vm-both-ways');
    const dx = new MachineClient(hub, machine.name, machine.credentials);
    await dx.connect();
    const endpoint = endpointOf(machine);
    const { generation } = await endpoint.connect();
    expect(generation).toBeGreaterThan(dx.generation);
    await waitFor(() => (dx.isEnded ? true : undefined));
    const again = new MachineClient(hub, machine.name, machine.credentials);
    await again.connect();
    expect(again.generation).toBeGreaterThan(generation);
    await waitFor(() => (endpoint.ends.length > 0 ? true : undefined));
    expect(endpoint.ends[0]).toMatchObject({ code: 4409, reason: 'replaced' });
    await again.close();
  });

  for (const evicted of [false, true]) {
    const when = evicted ? 'after an eviction' : 'before one';
    it(`closes the old sockets on a newer generation ${when}`, async () => {
      const machine = await listed(`newer-${evicted ? 'e' : 'n'}`);
      const first = endpointOf(machine);
      await first.connect();
      const app = await appOf(machine.ref);
      const channel = await app.openChannel();
      await waitFor(() => (first.channels.has(channel) ? true : undefined));
      if (evicted) await hub.evict('Machine', `${ORG}:${relayName(machine)}`, 'hibernate');
      const second = endpointOf(machine);
      const { generation } = await second.connect();
      expect(generation).toBeGreaterThan(first.generation);
      await waitFor(() => (first.ends.length > 0 ? true : undefined));
      expect(first.ends[0]).toMatchObject({ code: 4409, reason: 'replaced' });
      await app.until(() => app.closes.find((c) => c.channel === channel), 'the channel closed');
      expect(app.closes.find((c) => c.channel === channel)?.reason).toBe('endpoint-gone');
      // The new connection carries channels.
      const fresh = await app.openChannel();
      app.send(fresh, bytesOf(9, 9));
      await app.until(() => (app.received.get(fresh)?.length === 1 ? true : undefined), 'the echo on the new connection');
      app.close();
      second.close();
    });

    it(`closes the socket on a revocation ${when}, and refuses its credential after`, async () => {
      const name = `revoked-${evicted ? 'e' : 'n'}`;
      const machine = await listed(name);
      const endpoint = endpointOf(machine);
      await endpoint.connect();
      const app = await appOf(machine.ref);
      const channel = await app.openChannel();
      await waitFor(() => (endpoint.channels.has(channel) ? true : undefined));
      if (evicted) await hub.evict('Machine', `${ORG}:${relayName(machine)}`, 'hibernate');
      expect((await hub.fetchAs(ADMIN, `/api/machines/${name}`, { method: 'DELETE' })).status).toBe(200);
      await waitFor(() => (endpoint.ends.length > 0 ? true : undefined));
      expect(endpoint.ends[0]).toMatchObject({ code: 4403, reason: 'revoked' });
      await app.until(() => app.closes.find((c) => c.channel === channel), 'the channel closed');
      await expect(endpointOf(machine).connect()).rejects.toThrow();
      app.close();
    });
  }

  it('answers an app socket to a machine it does not know 404', async () => {
    expect(await refusal(await hub.fetchAs(ADMIN, '/api/machines/nobody/socket'))).toBe('404 unknown-machine');
  });
});

// Last: it removes member B from the org.
describe('a member removed from the org state', () => {
  it('loses the app sockets it holds to a machine, closed 4403 removed, with their channels', async () => {
    const endpoint = endpointOf(mini);
    await endpoint.connect();
    const appB = await appOf('mini', MEMBER_B);
    const appA = await appOf('mini');
    const channel = await appB.openChannel();
    await waitFor(() => (endpoint.channels.has(channel) ? true : undefined));
    const revoked = await revokedDevice(B, b1.device);
    await accept((s) => {
      s.members = s.members.filter((m) => m.id !== B);
      s.revoked.push(...revoked);
    });
    await appB.until(() => appB.ended, 'the removed member’s socket closed');
    expect(appB.ended).toMatchObject({ code: 4403, reason: 'removed' });
    await waitFor(() => (endpoint.closes.some((c) => c.channel === channel && c.reason === 'app-gone') ? true : undefined));
    // A member the state still holds keeps theirs.
    await sleep(200);
    expect(appA.ended).toBeUndefined();
    appA.close();
    endpoint.close();
  });
});
