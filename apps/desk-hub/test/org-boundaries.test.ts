// A member the Worker resolved is checked again where the Registry changes anything for them (O11 M3's review): the
// Worker resolves a request's identity before it reads the body, and a successor accepted in between may have removed
// or demoted the member. Each of the Registry's methods that takes a member is called here with a record resolved
// before such a state, as the Worker would hand it over late.
import { generateSigningKey, type OrgState, type SignedOrgState } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MemberRecord } from '../src/protocol/identity';
import { ADMIN, ORG, startLocalHub, type LocalHub } from './support/local';
import { fakeMac, genesis, memberId, newDevice, next, signedBy, transition, type TestDevice } from './support/org';

let hub: LocalHub;
let a1: TestDevice;
let head: SignedOrgState;
let recovery: Awaited<ReturnType<typeof generateSigningKey>>;
const B = memberId();
/** B as the Worker resolved them while they were an admin. */
let staleB: MemberRecord;
let fresh: MemberRecord;

async function accept(state: OrgState) {
  const s = await signedBy(state, a1);
  const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: s });
  expect(response.status, await response.text()).toBe(201);
  head = s;
}
const me = async (email: string) => ((await (await hub.fetchAs(email, '/api/me')).json()) as { member: MemberRecord }).member;

beforeAll(async () => {
  hub = await startLocalHub();
  a1 = await newDevice('a1');
  recovery = await generateSigningKey();
  fresh = await me(ADMIN);
  head = await signedBy(await genesis(ORG, fresh.id, ADMIN, a1, recovery), a1);
  expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: head })).status).toBe(201);
  await accept(await next(head, (s) => s.members.push({ id: B, email: 'b@example.com', role: 'admin', devices: [] })));
  staleB = await me('b@example.com');
  expect(staleB.role).toBe('admin');
});
afterAll(() => hub?.close());

/** Every admin-only change the Registry makes, with arguments that would pass for an admin. */
const adminCalls: Array<[string, ...unknown[]]> = [
  ['createEnrollment', {}],
  ['createProvisioningKey', { label: 'vms', prefix: 'vm-' }],
  ['revokeProvisioningKey', 'no-such-key'],
  ['revoke', 'no-such-machine'],
  ['designateArchive', '0a1b2c3d-0000-4000-8000-000000000000', { machine: null }],
  ['addOrgKey', {}],
  ['removeOrgKey', 'no-such-key', {}],
  ['purgeOrgKeys'],
];
const refusal = (error: string) => expect.objectContaining({ ok: false, status: 403, error });

describe('the push subscription list', () => {
  it('keeps its RPC contract for a Worker on older code, and the Worker falls back to it from a Registry on older code', async () => {
    expect(await hub.asMember('pushSubscriptions', fresh)).toEqual({ subscriptions: [] });
    await hub.registryLacks('memberPushSubscriptions');
    const response = await hub.fetchAs(ADMIN, '/api/push/subscriptions');
    await hub.registryLacks(null);
    expect([response.status, await response.json()]).toEqual([200, { subscriptions: [] }]);
    expect(await (await hub.fetchAs(ADMIN, '/api/push/subscriptions')).json()).toEqual({ subscriptions: [] });
  });
});

describe('a route this code added', () => {
  it('answers 503 hub-updating from a Registry still on the code before it', async () => {
    await hub.registryLacks('orgState');
    const response = await hub.fetchAs(ADMIN, '/api/org/state');
    await hub.registryLacks(null);
    expect([response.status, ((await response.json()) as { error: string }).error]).toEqual([503, 'hub-updating']);
  });
});

describe('a member resolved before a state', () => {
  it('that demoted them is refused every admin-only change', async () => {
    await accept(await next(head, (s) => (s.members.find((m) => m.id === B)!.role = 'member')));
    for (const [call, ...args] of adminCalls) expect(await hub.asMember(call, staleB, ...args), call).toEqual(refusal('not-admin'));
    // The admin as they stand is not refused by the check.
    expect(await hub.asMember('createEnrollment', fresh, {})).toMatchObject({ ok: true });
  });

  it('that removed them is refused every change, and their own lists', async () => {
    await accept(await next(head, (s) => (s.members = s.members.filter((m) => m.id !== B))));
    const d = await newDevice('b-new');
    const pending = { deviceId: 'b-new', class: 'native-mac', keyStorage: 'software', channelPub: d.device.channelPub, stepUpPub: d.device.stepUpPub, mac: fakeMac() };
    const subscription = { endpoint: 'https://push.test/b', keys: { p256dh: d.device.channelPub, auth: Buffer.alloc(16).toString('base64url') } };
    const memberCalls: Array<[string, ...unknown[]]> = [
      ...adminCalls,
      ['keepPushSubscription', subscription],
      ['deletePushSubscription', { endpoint: subscription.endpoint }],
      ['memberPushSubscriptions'],
      ['keepPendingDevice', pending],
      ['pendingDevices'],
      ['submitState', await signedBy(await next(head, (s) => s.projects.push({ id: 'by-b', name: 'B' })), a1)],
      ['submitTransition', await transition(head, [a1], recovery)],
      // Hub v2's (O11 M4): a machine's key for its enrolling member, a certificate's retirement, the listings.
      ['enrollmentKey', '0'.repeat(32)],
      ['memberRetiresCert', {}],
      ['listings', null],
      ['machineEndpoint', 'mini'],
    ];
    for (const [call, ...args] of memberCalls) expect(await hub.asMember(call, staleB, ...args), call).toEqual(refusal('not-a-member'));
  });
});
