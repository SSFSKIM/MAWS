// Owner-only push (O11 M4; RL §7.4): a subscription may bind to one of its member's devices; a v2 notice for a session
// with a listing goes to its listed owners' devices alone and carries only {project, machine, session, kind}; a session
// with no listing on a v2 machine pushes nothing, while DX2's push keeps today's rule; and a device the head no longer
// lists is pushed nothing.
import { generateSigningKey, type SignedOrgState } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listing, mintRef, type V2Machine } from '../fake-machine/org';
import type { PushNotice } from '../src/protocol/browser';
import type { OwnerNotice, PushSubscriptionRecord } from '../src/protocol/identity';
import { refusal } from './support/clients';
import { ADMIN, ORG, startLocalHub, type LocalHub } from './support/local';
import { genesis, memberId, newDevice, next, revokedDevice, signedBy, type TestDevice } from './support/org';
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
  machine = { hub: hub.url, org: ORG, name: 'mini', ref: mintRef(), key: await generateSigningKey(), credentials: { clientId: '', clientSecret: '' }, enrollment: '' };
  await accept((s) => {
    s.members.push({ id: B, email: MEMBER_B, role: 'member', devices: [b1.device, b2.device] });
    s.machines.push({ name: 'mini', ref: machine.ref, pub: machine.key.pub, owners: [A] });
    s.machineNames.push({ name: 'mini', ref: machine.ref });
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
});

describe("DX2's push", () => {
  const notice = (session: string): Omit<PushNotice, 'name' | 'waiting'> => ({ v: 1, project: PROJECT, session, alias: 'x', kind: 'message', event: { writer: 'mini/x', seq: 1 } });

  it('keeps today’s rule for a session with no listing: every member not looking', async () => {
    const pushed = await pushedBy(() => hub.registryRpc('push', notice(UNLISTED), [], 0));
    expect([...pushed.keys()].sort()).toEqual([phoneA.endpoint, phoneB.endpoint].sort());
  });

  it('goes to the listed owners alone for a session with a listing', async () => {
    const pushed = await pushedBy(() => hub.registryRpc('push', notice(SESSION), [], 0));
    expect([...pushed.keys()]).toEqual([phoneB.endpoint]);
    expect(await pushedBy(() => hub.registryRpc('push', notice(SESSION), [B], 0))).toEqual(new Map());
  });
});
