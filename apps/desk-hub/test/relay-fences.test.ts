// What keeps RL1's relay from serving the wrong connection or the wrong member (O11 M6, fix wave 1): a ref routed only
// through a binding the hub stands behind; a claim in flight fenced by a revocation or a newer connection that came
// first; a revocation delivered until the ref's object takes it; a removed member's app sockets closed whether or not an
// endpoint ever connected; a frame's parts lost to an eviction answered, not dropped; one fence per ref across a rename;
// and a session-plane frame for an RL1 machine refused to its sender rather than left waiting.
import { base64urlEncode, generateSigningKey, keyId, type SignedOrgState, type SigningKey } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeEndpoint } from '../fake-machine/endpoint';
import { enrollDelegated, enrollV2, type DelegationKey, type V2Machine } from '../fake-machine/org';
import { RelayApp } from '../fake-machine/relay-app';
import type { ProjectDown } from '../src/protocol/browser';
import { newNonce } from '../src/protocol/codes';
import { delegationFor, encodeEnrollmentCodeV2 } from '../src/protocol/identity';
import type { LogEvent } from '../src/protocol/log';
import { BrowserClient, enroll, MachineClient, provisioningKey, refusal, waitFor } from './support/clients';
import { ADMIN, credentials, ORG, startLocalHub, type LocalHub } from './support/local';
import { genesis, memberId, newDevice, next, revokedDevice, signedBy, type TestDevice } from './support/org';

let hub: LocalHub;
let a1: TestDevice;
let recovery: SigningKey;
let head: SignedOrgState;
let A: string;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const endpoints: FakeEndpoint[] = [];
const apps: RelayApp[] = [];

async function accept(edit: Parameters<typeof next>[1]): Promise<void> {
  const s = await signedBy(await next(head, edit), a1);
  const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: s });
  if (response.status !== 201) throw new Error(`state: ${response.status} ${await response.text()}`);
  head = s;
}

async function v2(name: string, keep: { ref?: string; key?: SigningKey } = {}): Promise<V2Machine> {
  const { token } = (await (await hub.fetchAs(ADMIN, '/api/enrollments', { body: {} })).json()) as { token: string };
  const code = encodeEnrollmentCodeV2({ hub: hub.url, token, roots: [await keyId(a1.stepUp!.pub)], recoveryPub: recovery.pub, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) });
  return enrollV2(code, name, keep);
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

/** A v2 machine the org state lists. */
async function listed(name: string): Promise<V2Machine> {
  const machine = await v2(name);
  await accept((s) => {
    s.machines.push({ name, ref: machine.ref, pub: machine.key.pub, owners: [A] });
    s.machineNames.push({ name, ref: machine.ref });
  });
  return machine;
}

function endpointOf(machine: V2Machine): FakeEndpoint {
  const endpoint = new FakeEndpoint({ hub: hub.url, credentials: machine.credentials, ref: machine.ref });
  endpoints.push(endpoint);
  return endpoint;
}

async function appOf(machine: string, who = ADMIN): Promise<RelayApp> {
  const app = await RelayApp.open(hub.url, machine, credentials(who));
  apps.push(app);
  return app;
}

const relayObject = (machine: V2Machine) => `${ORG}:ref:${machine.ref}`;
const mac = () => ({ nonce: newNonce(), value: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url') });
const event = (writer: string, seq: number): LogEvent => ({ ts: new Date().toISOString(), writer, seq, kind: 'say', text: `say ${seq}`, mac: mac() }) as unknown as LogEvent;

beforeAll(async () => {
  hub = await startLocalHub();
  A = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
  a1 = await newDevice('a1');
  recovery = await generateSigningKey();
  head = await signedBy(await genesis(ORG, A, ADMIN, a1, recovery), a1);
  expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: head })).status).toBe(201);
  await hub.retryBase('registry', 200);
});
afterAll(async () => {
  for (const app of apps) app.close();
  for (const endpoint of endpoints) endpoint.close();
  await hub?.close();
});

describe('routing to a ref', () => {
  it('refuses a key posting another machine’s ref, and routes an unlisted machine nowhere', async () => {
    const victim = await listed('victim');
    const endpoint = endpointOf(victim);
    await endpoint.connect();
    await expect(v2('thief', { ref: victim.ref })).rejects.toThrow(/409 .*ref-taken/);
    const loner = await v2('loner');
    expect(await refusal(await hub.fetchAs(loner.credentials, '/machine/socket'))).toBe('409 not-listed');
    expect(await refusal(await hub.fetchAs(ADMIN, '/api/machines/loner/socket'))).toBe('404 unknown-machine');
    expect(await refusal(await hub.fetchAs(ADMIN, `/api/machines/${loner.ref}/socket`))).toBe('404 unknown-machine');
    expect(endpoint.isOpen).toBe(true);
    endpoint.close();
  });
});

describe('a claim in flight', () => {
  it('is not installed after a revocation that completed while it was answered', async () => {
    const machine = await listed('claim-revoked');
    const app = await appOf(machine.ref);
    await hub.holdClaim(machine.name);
    const endpoint = endpointOf(machine);
    const connecting = endpoint.connect();
    await waitFor(async () => ((await hub.claimHeld(machine.name)) ? true : undefined));
    expect((await hub.fetchAs(ADMIN, `/api/machines/${machine.name}`, { method: 'DELETE' })).status).toBe(200);
    await hub.releaseClaim(machine.name);
    await expect(connecting).rejects.toThrow();
    const channel = await app.openChannel();
    await app.until(() => app.closes.find((c) => c.channel === channel), 'the open refused');
    expect(app.closes.find((c) => c.channel === channel)?.reason).toBe('endpoint-gone');
  });

  it('is not installed after a newer DX2 stream took the generation', async () => {
    const machine = await certified('vm-claim-superseded');
    await hub.holdClaim(machine.name);
    const endpoint = endpointOf(machine);
    const connecting = endpoint.connect();
    await waitFor(async () => ((await hub.claimHeld(machine.name)) ? true : undefined));
    const dx = new MachineClient(hub, machine.name, machine.credentials);
    await dx.connect();
    await hub.releaseClaim(machine.name);
    await expect(connecting).rejects.toThrow();
    await sleep(200);
    expect(dx.isEnded).toBe(false);
    await dx.close();
  });
});

describe('a revocation', () => {
  for (const evicted of [false, true]) {
    it(`reaches the ref’s object though its first deliveries fail${evicted ? ', across an eviction' : ''}`, async () => {
      const machine = await listed(`revoke-retried-${evicted ? 'e' : 'n'}`);
      const endpoint = endpointOf(machine);
      await endpoint.connect();
      // No heartbeat finds the revocation (`rl1Check`): only the fence, delivered, ends the connection.
      endpoint.heartbeats = false;
      const app = await appOf(machine.ref);
      const channel = await app.openChannel();
      await waitFor(() => (endpoint.channels.has(channel) ? true : undefined));
      await hub.relayFault(machine.ref, 'relayRevoke', 2);
      expect((await hub.fetchAs(ADMIN, `/api/machines/${machine.name}`, { method: 'DELETE' })).status).toBe(200);
      if (evicted) await hub.evict('Machine', relayObject(machine), 'hibernate');
      await waitFor(() => (endpoint.ends.length > 0 ? true : undefined), 15_000);
      expect(endpoint.ends[0]).toMatchObject({ code: 4403, reason: 'revoked' });
      await app.until(() => app.closes.find((c) => c.channel === channel), 'the channel closed');
    });
  }
});

describe('a revocation of a credential another credential’s claim followed', () => {
  it('ends that credential’s connection though the newer claim never installed', async () => {
    const machine = await listed('revoke-overlapped');
    const endpoint = endpointOf(machine);
    await endpoint.connect();
    endpoint.heartbeats = false;
    const app = await appOf(machine.ref);
    const channel = await app.openChannel();
    await waitFor(() => (endpoint.channels.has(channel) ? true : undefined));
    // Another credential of the name claims the next generation, and no socket of it follows.
    expect(await hub.claimAs(machine.name, machine.ref, 'a-newer-credential')).toEqual({ generation: endpoint.generation + 1 });
    expect((await hub.fetchAs(ADMIN, `/api/machines/${machine.name}`, { method: 'DELETE' })).status).toBe(200);
    await waitFor(() => (endpoint.ends.length > 0 ? true : undefined));
    expect(endpoint.ends[0]).toMatchObject({ code: 4403, reason: 'revoked' });
    await app.until(() => app.closes.find((c) => c.channel === channel), 'the channel closed');
  });
});

describe('a name enrolled again in another case, with the same ref and key', () => {
  it('connects under its own name’s generations, not the revoked name’s fence', async () => {
    const machine = await listed('case-name');
    const old = endpointOf(machine);
    await old.connect();
    expect((await hub.fetchAs(ADMIN, '/api/machines/case-name', { method: 'DELETE' })).status).toBe(200);
    await waitFor(() => (old.ends.length > 0 ? true : undefined));
    const again = await v2('CASE-NAME', { ref: machine.ref, key: machine.key });
    expect(again.name).toBe('CASE-NAME');
    const now = endpointOf(again);
    expect((await now.connect()).generation).toBe(1);
    now.close();
  });
});

describe('a member removed from the org state', () => {
  it('loses app sockets to a machine no endpoint ever connected to, across an eviction and a missed announcement, and is refused after', async () => {
    const B = memberId();
    const b1 = await newDevice('b1', 'web-cards');
    const email = 'removed-b@example.com';
    await accept((s) => s.members.push({ id: B, email, role: 'member', devices: [b1.device] }));
    const machine = await listed('never-connected');
    const appB = await appOf(machine.ref, email);
    const appA = await appOf(machine.ref);
    await hub.evict('Machine', relayObject(machine), 'hibernate');
    await hub.relayFault(machine.ref, 'relayState', 1);
    const revoked = await revokedDevice(B, b1.device);
    await accept((s) => {
      s.members = s.members.filter((m) => m.id !== B);
      s.revoked.push(...revoked);
    });
    await appB.until(() => appB.ended, 'the removed member’s socket closed', 15_000);
    expect(appB.ended).toMatchObject({ code: 4403, reason: 'removed' });
    expect(await hub.relayUpgrade(machine.ref, B)).toBe(403);
    expect(appA.ended).toBeUndefined();
  });
});

describe('a frame’s parts', () => {
  it('lost to an eviction close the connection with 4412, and the endpoint connects again', async () => {
    const machine = await listed('parted');
    const endpoint = endpointOf(machine);
    await endpoint.connect();
    const text = JSON.stringify({ t: 'hello', project: '9d2e3f40-5a61-4b7c-9d8e-0f1a2b3c4d5e', name: 'parts', have: {} });
    const half = Math.floor(text.length / 2);
    endpoint.sendText({ t: 'part', id: 'set-1', index: 0, count: 2, data: text.slice(0, half) });
    const from = endpoint.frames.length;
    endpoint.sendText({ t: 'hb', generation: endpoint.generation });
    await endpoint.next((f) => f.t === 'hb-ack', 'hb-ack', from);
    await hub.evict('Machine', relayObject(machine), 'hibernate');
    endpoint.sendText({ t: 'part', id: 'set-1', index: 1, count: 2, data: text.slice(half) });
    await waitFor(() => (endpoint.ends.length > 0 ? true : undefined));
    expect(endpoint.ends[0]).toMatchObject({ code: 4412, reason: 'parts-lost' });
    await endpointOf(machine).connect();
  });
});

describe('a rename that keeps the ref and key', () => {
  it('lets the new name’s connection replace the old name’s, whatever each name’s generation', async () => {
    const machine = await listed('rn-old');
    const first = endpointOf(machine);
    await first.connect();
    first.close();
    await waitFor(() => (first.ends.length > 0 ? true : undefined));
    const old = endpointOf(machine);
    expect((await old.connect()).generation).toBe(2);
    await accept((s) => {
      s.machines.find((m) => m.ref === machine.ref)!.name = 'rn-new';
      s.machineNames.push({ name: 'rn-new', ref: machine.ref });
    });
    const renamed = await v2('rn-new', { ref: machine.ref, key: machine.key });
    const now = endpointOf(renamed);
    expect((await now.connect()).generation).toBe(1);
    await waitFor(() => (old.ends.length > 0 ? true : undefined));
    expect(old.ends[0]).toMatchObject({ code: 4409, reason: 'replaced' });
    expect(now.isOpen).toBe(true);
    expect(await refusal(await hub.fetchAs(machine.credentials, '/machine/socket'))).toBe('409 not-listed');
  });
});

describe('an old name’s claim in flight across a rename', () => {
  it('is not installed over the new name’s connection that installed while it was answered', async () => {
    const machine = await listed('rn-held-old');
    const first = endpointOf(machine);
    expect((await first.connect()).generation).toBe(1);
    // The old name's next claim is granted (generation 2) and its answer held: an upgrade admitted before the rename.
    await hub.holdClaim(machine.name);
    const late = endpointOf(machine);
    const connecting = late.connect();
    await waitFor(async () => ((await hub.claimHeld(machine.name)) ? true : undefined));
    await accept((s) => {
      s.machines.find((m) => m.ref === machine.ref)!.name = 'rn-held-new';
      s.machineNames.push({ name: 'rn-held-new', ref: machine.ref });
    });
    const renamed = await v2('rn-held-new', { ref: machine.ref, key: machine.key });
    const now = endpointOf(renamed);
    expect((await now.connect()).generation).toBe(1);
    await waitFor(() => (first.ends.length > 0 ? true : undefined));
    const app = await appOf(machine.ref);
    const channel = await app.openChannel();
    await waitFor(() => (now.channels.has(channel) ? true : undefined));
    await hub.releaseClaim(machine.name);
    await expect(connecting).rejects.toThrow();
    await sleep(200);
    expect(now.ends).toEqual([]);
    expect(app.closes.find((c) => c.channel === channel)).toBeUndefined();
  });
});

describe('an old name’s upgrade that reaches the ref’s object after a rename', () => {
  it('is not installed over the renamed endpoint’s connection, though the Worker admitted it before the rename', async () => {
    const machine = await listed('rn-late-old');
    const first = endpointOf(machine);
    expect((await first.connect()).generation).toBe(1);
    // The Worker resolves the old name's next upgrade to the ref and forwards it; the ref's object is handed it late.
    await hub.holdUpgrade(machine.ref);
    const late = endpointOf(machine);
    const connecting = late.connect();
    await waitFor(async () => ((await hub.upgradeHeld(machine.ref)) ? true : undefined));
    await accept((s) => {
      s.machines.find((m) => m.ref === machine.ref)!.name = 'rn-late-new';
      s.machineNames.push({ name: 'rn-late-new', ref: machine.ref });
    });
    const renamed = await v2('rn-late-new', { ref: machine.ref, key: machine.key });
    const now = endpointOf(renamed);
    expect((await now.connect()).generation).toBe(1);
    await waitFor(() => (first.ends.length > 0 ? true : undefined));
    const app = await appOf(machine.ref);
    const channel = await app.openChannel();
    await waitFor(() => (now.channels.has(channel) ? true : undefined));
    await hub.releaseUpgrade(machine.ref);
    await expect(connecting).rejects.toThrow();
    await sleep(200);
    expect(now.ends).toEqual([]);
    expect(app.closes.find((c) => c.channel === channel)).toBeUndefined();
  });
});

describe('a Registry on the code before the binding check', () => {
  it('refuses the endpoint’s upgrade after its claim, and it connects once the Registry answers', async () => {
    const machine = await listed('binds-lacking');
    await hub.registryLacks('machineBinds');
    await expect(endpointOf(machine).connect()).rejects.toThrow(/refused/);
    await hub.registryLacks(null);
    // The refused upgrade drew generation 1 before the check failed closed (the client's upgrade sees only a refusal).
    expect((await endpointOf(machine).connect()).generation).toBe(2);
  });
});

describe('a session-plane frame for an RL1 machine', () => {
  it('is refused to its sender, and the log plane keeps flowing', async () => {
    const machine = await listed('rl1-only');
    const endpoint = endpointOf(machine);
    await endpoint.connect();
    const project = '6d2e3f40-5a61-4b7c-9d8e-0f1a2b3c4d5e';
    await endpoint.project(project, 'rpc-demo');
    const browser = await BrowserClient.open(hub, ADMIN, project);
    const nonce = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
    const rpc = { rpc: 'interrupt', project, machine: machine.name, member: A, created: new Date().toISOString(), nonce, args: { session: 'a-session' }, mac: base64urlEncode(new Uint8Array(32)) };
    browser.send({ t: 'rpc', rpc } as never);
    const failed = (await browser.next((f) => f.t === 'rpc-state' && f.nonce === nonce && f.state === 'failed', 'the RPC failed')) as Extract<ProjectDown, { t: 'rpc-state' }>;
    expect(failed.outcome).toMatchObject({ state: 'failed', error: { code: 'unsupported' } });
    const sub = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
    browser.send({ t: 'subscribe', machine: machine.name, session: 'a-session', agentId: null, sub });
    const end = await browser.next((f) => f.t === 'session' && f.message.kind === 'end' && f.message.sub === sub, 'the subscription ended');
    expect((end as Extract<ProjectDown, { t: 'session' }>).message.body).toMatchObject({ reason: 'error' });
    expect(endpoint.frames.some((f) => f.t === 'rpc' || f.t === 'subscribe')).toBe(false);
    const dx = new MachineClient(hub, 'rl1-peer', await enroll(hub, ADMIN, 'rl1-peer'));
    await dx.connect();
    await dx.sync(project, 'rpc-demo');
    await dx.postOk([{ t: 'events', project, events: [event('rl1-peer/s', 1)] }]);
    await endpoint.next((f) => f.t === 'events' && (f.events as LogEvent[]).some((e) => e.writer === 'rl1-peer/s'), 'the log plane after the refusals');
    await dx.close();
    browser.close();
  });

  it('leaves a retry of an RPC a DX2 stream took uncertain, the machine since on RL1', async () => {
    const machine = await certified('vm-uncertain-switch');
    const project = '5d2e3f40-5a61-4b7c-9d8e-0f1a2b3c4d5e';
    const dx = new MachineClient(hub, machine.name, machine.credentials);
    await dx.connect();
    await dx.sync(project, 'switch');
    const browser = await BrowserClient.open(hub, ADMIN, project);
    const nonce = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
    const rpc = { rpc: 'interrupt', project, machine: machine.name, member: A, created: new Date().toISOString(), nonce, args: { session: 'a-session' }, mac: base64urlEncode(new Uint8Array(32)) };
    browser.send({ t: 'rpc', rpc } as never);
    await dx.next((f) => f.t === 'rpc', 'the RPC delivered over DX2');
    // The machine moves to RL1: its stream ends with the RPC unanswered, which may have run.
    const endpoint = endpointOf(machine);
    await endpoint.connect();
    await endpoint.project(project, 'switch');
    await browser.next((f) => f.t === 'rpc-state' && f.nonce === nonce && f.state === 'uncertain', 'the RPC uncertain');
    const from = browser.frames.length;
    browser.send({ t: 'rpc', rpc } as never);
    const answer = await browser.next((f) => f.t === 'rpc-state' && f.nonce === nonce && f.state !== 'forwarded', 'the retry’s answer', from);
    expect(answer).toEqual({ t: 'rpc-state', nonce, state: 'uncertain' });
    browser.close();
    endpoint.close();
    await dx.close();
  });
});
