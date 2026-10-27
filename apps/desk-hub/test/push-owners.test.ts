// Owner-only push (O11 M4; RL §7.4): a subscription may bind to one of its member's devices; a v2 notice for a session
// with a listing goes to its listed owners' devices alone and carries only {project, machine, session, kind}; a session
// with no listing on a v2 machine pushes nothing, while DX2's push keeps today's rule; and a device the head no longer
// lists is pushed nothing.
import { generateSigningKey, signEvent, type SignedOrgState } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listing, mintRef, type V2Machine } from '../fake-machine/org';
import type { PushNotice } from '../src/protocol/browser';
import type { OwnerNotice, PushSubscriptionRecord } from '../src/protocol/identity';
import { newNonce } from '../src/protocol/codes';
import type { LogEvent } from '../src/protocol/log';
import { enroll, MachineClient, refusal, waitFor } from './support/clients';
import { ADMIN, ORG, startLocalHub, type LocalHub } from './support/local';
import { endorsed, genesis, memberId, newDevice, next, revokedDevice, signedBy, type TestDevice } from './support/org';
import { decrypt, userAgent, type UserAgent } from './support/push';

let hub: LocalHub;
let head: SignedOrgState;
let a1: TestDevice;
let b1: TestDevice;
let b2: TestDevice;
let A: string;
const B = memberId();
const MEMBER_B = 'b@example.com';
const PROJECT = '5b1d2c3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
const SESSION = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
const UNLISTED = '0d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a59';
let machine: V2Machine;
/** Another machine of the state, listing a session of its own that `mini` never listed. */
let other: V2Machine;
/** A DX2 machine (`dx-listed`) the state also lists with a key of the suite's, so its listings verify. */
let dx: V2Machine;
const DX_SESSION = '3f2e1d0c-9b8a-4766-8554-433221100fed';
let phoneA: UserAgent;
let phoneB: UserAgent;
let laptopB: UserAgent;

async function accept(edit: Parameters<typeof next>[1]): Promise<void> {
  const s = await signedBy(await next(head, edit), a1);
  const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: s });
  if (response.status !== 201) throw new Error(`state: ${response.status} ${await response.text()}`);
  head = s;
}
const subscribe = (who: string, ua: UserAgent, device?: string) => hub.fetchAs(who, '/api/push/subscriptions', { method: 'PUT', body: { endpoint: ua.endpoint, keys: ua.keys, ...(device === undefined ? {} : { device }) } });
type Sent = { sent: number; gone: number; failed: number };
const notify = (notice: Omit<OwnerNotice, 'machine'>, ref = machine.ref) => hub.registryRpc<Sent>('notify', ref, notice);
/** The endpoints pushed to by what `act` does, with each one's payload. */
async function pushedBy(act: () => Promise<unknown>): Promise<Map<string, unknown>> {
  const from = hub.pushes.length;
  await act();
  const out = new Map<string, unknown>();
  for (const push of hub.pushes.slice(from)) {
    const ua = [phoneA, phoneB, laptopB].find((u) => u.endpoint === push.endpoint)!;
    out.set(push.endpoint, JSON.parse(new TextDecoder().decode(await decrypt(ua, push.body))));
  }
  return out;
}

beforeAll(async () => {
  hub = await startLocalHub();
  A = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
  [a1, b1, b2] = await Promise.all([newDevice('a1'), newDevice('b1', 'web-cards'), newDevice('b2', 'web-cards')]);
  head = await signedBy(await genesis(ORG, A, ADMIN, a1, await generateSigningKey()), a1);
  expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: head })).status).toBe(201);
  const stateOnly = async (name: string): Promise<V2Machine> => ({ hub: hub.url, org: ORG, name, ref: mintRef(), key: await generateSigningKey(), credentials: { clientId: '', clientSecret: '' }, enrollment: '' });
  [machine, other, dx] = await Promise.all([stateOnly('mini'), stateOnly('other'), stateOnly('dx-listed')]);
  await accept((s) => {
    s.members.push({ id: B, email: MEMBER_B, role: 'member', devices: [b1.device, b2.device] });
    s.machines.push({ name: 'mini', ref: machine.ref, pub: machine.key.pub, owners: [A] });
    s.machineNames.push({ name: 'mini', ref: machine.ref });
    s.machines.push({ name: 'other', ref: other.ref, pub: other.key.pub, owners: [A] });
    s.machineNames.push({ name: 'other', ref: other.ref });
    s.machines.push({ name: 'dx-listed', ref: dx.ref, pub: dx.key.pub, owners: [A] });
    s.machineNames.push({ name: 'dx-listed', ref: dx.ref });
  });
  [phoneA, phoneB, laptopB] = await Promise.all(['https://push.test/a-phone', 'https://push.test/b-phone', 'https://push.test/b-laptop'].map((e) => userAgent(e)));
});
afterAll(() => hub?.close());

describe('a push subscription', () => {
  it('binds to one of its member’s devices, and only to one the head lists for that member', async () => {
    const response = await subscribe(MEMBER_B, phoneB, 'b1');
    expect(response.status).toBe(200);
    expect(((await response.json()) as { subscription: PushSubscriptionRecord }).subscription).toMatchObject({ member: B, endpoint: phoneB.endpoint, device: 'b1' });
    expect(await refusal(await subscribe(MEMBER_B, laptopB, 'a1'))).toBe('409 unknown-device');
    expect(await refusal(await subscribe(MEMBER_B, laptopB, ''))).toBe('400 bad-shape');
    expect((await subscribe(MEMBER_B, laptopB, 'b2')).status).toBe(200);
    // Unbound, as today's phones subscribe.
    const unbound = await subscribe(ADMIN, phoneA);
    expect(((await unbound.json()) as { subscription: PushSubscriptionRecord }).subscription.device).toBeUndefined();
  });
});

describe('a v2 notice', () => {
  it('reaches only the devices of the session’s listed owners, carrying only its project, machine, session and kind', async () => {
    expect((await hub.registryRpc<{ ok: boolean }>('storeListing', await listing(machine, SESSION, 1, { owners: [A], project: PROJECT, lane: 'B', state: 'waiting', title: 't' }))).ok).toBe(true);
    expect(await hub.registryRpc('ownersOf', machine.ref, SESSION)).toEqual([A]);
    const pushed = await pushedBy(() => notify({ project: PROJECT, session: SESSION, kind: 'waiting' }));
    expect([...pushed.keys()]).toEqual([phoneA.endpoint]);
    expect(pushed.get(phoneA.endpoint)).toEqual({ project: PROJECT, machine: machine.ref, session: SESSION, kind: 'waiting' });

    expect((await hub.registryRpc<{ ok: boolean }>('storeListing', await listing(machine, SESSION, 2, { owners: [B], project: PROJECT, lane: 'B', state: 'waiting', title: 't' }))).ok).toBe(true);
    const toB = await pushedBy(() => notify({ project: PROJECT, session: SESSION, kind: 'wrote' }));
    expect([...toB.keys()].sort()).toEqual([laptopB.endpoint, phoneB.endpoint].sort());
  });

  it('for a session with no listing pushes nothing, and a kind other than waiting or wrote is refused', async () => {
    expect(await hub.registryRpc('ownersOf', machine.ref, UNLISTED)).toBeNull();
    expect(await pushedBy(() => notify({ project: PROJECT, session: UNLISTED, kind: 'waiting' }))).toEqual(new Map());
    await expect(notify({ project: PROJECT, session: SESSION, kind: 'settled' as 'waiting' })).rejects.toThrow();
  });

  it('is not pushed to a bound device the head no longer lists', async () => {
    const revoked = await revokedDevice(B, b2.device);
    await accept((s) => {
      const member = s.members.find((m) => m.id === B)!;
      member.devices = member.devices.filter((d) => d.id !== 'b2');
      s.revoked.push(...revoked);
    });
    const pushed = await pushedBy(() => notify({ project: PROJECT, session: SESSION, kind: 'waiting' }));
    expect([...pushed.keys()]).toEqual([phoneB.endpoint]);
  });

  it('is not pushed to a device id the head lists again with other keys, until that device subscribes', async () => {
    const waiting = () => pushedBy(() => notify({ project: PROJECT, session: SESSION, kind: 'waiting' }));
    const devicesOfB = (devices: TestDevice['device'][], revoked: Awaited<ReturnType<typeof revokedDevice>>) =>
      accept((s) => {
        s.members.find((m) => m.id === B)!.devices = devices;
        s.revoked.push(...revoked);
      });
    // Removed, then its id listed again for a new device: phoneB's subscription was the old device's.
    await devicesOfB([], await revokedDevice(B, b1.device));
    expect([...(await waiting()).keys()]).toEqual([]);
    const reused = await newDevice('b1');
    await devicesOfB([reused.device], []);
    expect([...(await waiting()).keys()]).toEqual([]);
    // The new device subscribes; then, in one step, its id is given to a replacement it endorsed, its own keys revoked.
    expect((await subscribe(MEMBER_B, phoneB, 'b1')).status).toBe(200);
    expect([...(await waiting()).keys()]).toEqual([phoneB.endpoint]);
    const replacement = await endorsed(ORG, B, await newDevice('b1'), reused);
    await devicesOfB([replacement.device], await revokedDevice(B, reused.device));
    expect([...(await waiting()).keys()]).toEqual([]);
    // Bound again for the suites after this one.
    expect((await subscribe(MEMBER_B, phoneB, 'b1')).status).toBe(200);
    expect([...(await waiting()).keys()]).toEqual([phoneB.endpoint]);
  });
});

describe("DX2's push", () => {
  const notice = (session: string, kind: 'message' | 'permission' = 'message'): Omit<PushNotice, 'name' | 'waiting'> =>
    kind === 'message' ? { v: 1, project: PROJECT, session, alias: 'x', kind, event: { writer: `mini/${session}`, seq: 1 } } : { v: 1, project: PROJECT, session, alias: 'x', kind, request: 'toolu_1' };
  const legacy = (payload: unknown) => expect(payload).toMatchObject({ v: 1, project: PROJECT, alias: 'x', name: expect.any(String) as string, waiting: 0 });

  it('keeps today’s rule and payload for a session its machine never listed: every member not looking', async () => {
    const pushed = await pushedBy(() => hub.registryRpc('push', notice(UNLISTED), [], 0, 'mini'));
    expect([...pushed.keys()].sort()).toEqual([phoneA.endpoint, phoneB.endpoint].sort());
    for (const payload of pushed.values()) legacy(payload);
  });

  it('is not redirected by another machine’s listing of the same session id', async () => {
    const OTHERS = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    expect((await hub.registryRpc<{ ok: boolean }>('storeListing', await listing(other, OTHERS, 1, { owners: [A], project: PROJECT, lane: 'B', state: 'waiting', title: 't' }))).ok).toBe(true);
    const pushed = await pushedBy(() => hub.registryRpc('push', notice(OTHERS), [], 0, 'mini'));
    expect([...pushed.keys()].sort()).toEqual([phoneA.endpoint, phoneB.endpoint].sort());
    for (const payload of pushed.values()) legacy(payload);
  });

  it('goes to its machine’s listed owners alone for a session it listed, carrying only the v2 notice', async () => {
    const pushed = await pushedBy(() => hub.registryRpc('push', notice(SESSION), [], 0, 'mini'));
    expect([...pushed.keys()]).toEqual([phoneB.endpoint]);
    expect(pushed.get(phoneB.endpoint)).toEqual({ project: PROJECT, machine: machine.ref, session: SESSION, kind: 'wrote' });
    const asked = await pushedBy(() => hub.registryRpc('push', notice(SESSION, 'permission'), [], 0, 'MINI'));
    expect(asked.get(phoneB.endpoint)).toEqual({ project: PROJECT, machine: machine.ref, session: SESSION, kind: 'waiting' });
    expect(await pushedBy(() => hub.registryRpc('push', notice(SESSION), [B], 0, 'mini'))).toEqual(new Map());
  });

  it('from a Project on the code before the machine was passed, keeps today’s rule and payload', async () => {
    const pushed = await pushedBy(() => hub.registryRpc('push', notice(SESSION), [], 0));
    expect([...pushed.keys()].sort()).toEqual([phoneA.endpoint, phoneB.endpoint].sort());
    for (const payload of pushed.values()) legacy(payload);
  });

  it('from an upload, names the uploading machine: a listed session’s message reaches its owners as a v2 notice', async () => {
    expect((await hub.registryRpc<{ ok: boolean }>('storeListing', await listing(dx, DX_SESSION, 1, { owners: [B], project: PROJECT, lane: 'A', state: 'busy', title: 't' }))).ok).toBe(true);
    const client = new MachineClient(hub, 'dx-listed', await enroll(hub, ADMIN, 'dx-listed'));
    await client.connect();
    await client.sync(PROJECT, 'demo');
    const event = { ts: new Date().toISOString(), writer: `dx-listed/${DX_SESSION}`, seq: 1, kind: 'message', from: 'maws-1', to: 'host', text: 'done', mac: { nonce: newNonce(), value: Buffer.from(new Uint8Array(32)).toString('base64url') } };
    client.store(PROJECT, event as unknown as LogEvent);
    const from = hub.pushes.length;
    await client.postOk([{ t: 'events', project: PROJECT, events: [event as unknown as LogEvent] }]);
    const push = await waitFor(() => hub.pushes.slice(from).find((p) => p.endpoint === phoneB.endpoint));
    expect(JSON.parse(new TextDecoder().decode(await decrypt(phoneB, push.body)))).toEqual({ project: PROJECT, machine: dx.ref, session: DX_SESSION, kind: 'wrote' });
    expect(hub.pushes.slice(from).map((p) => p.endpoint)).toEqual([phoneB.endpoint]);
    // The same through M5's signed path: a v2-only event, checked against the head before it is stored, pushes alike.
    const ts = new Date().toISOString();
    const signed = await signEvent({ org: ORG, project: PROJECT }, { ts, created: ts, writer: `dx-listed/${DX_SESSION}`, seq: 2, kind: 'message', from: 'maws-1', to: 'host', text: 'signed' }, dx.key.privateKey, dx.key.pub);
    client.store(PROJECT, signed as unknown as LogEvent);
    const fromSigned = hub.pushes.length;
    await client.postOk([{ t: 'events', project: PROJECT, events: [signed as unknown as LogEvent] }]);
    const pushedSigned = await waitFor(() => hub.pushes.slice(fromSigned).find((p) => p.endpoint === phoneB.endpoint));
    expect(JSON.parse(new TextDecoder().decode(await decrypt(phoneB, pushedSigned.body)))).toEqual({ project: PROJECT, machine: dx.ref, session: DX_SESSION, kind: 'wrote' });
    expect(hub.pushes.slice(fromSigned).map((p) => p.endpoint)).toEqual([phoneB.endpoint]);
    await client.close();
  });
});
