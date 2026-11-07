// Each machine's sessions' reach (P5 O8 M6b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M6b's "Policies"
// and "A row's mark"): a machine read when its link comes up (each new generation; this Mac's at the sign-in), the reads
// replaced by `org.policies.changed`, an answer older than an event applying nothing, everything forgotten at a sign-out
// or another member's sign-in; and the mark a session's read or listing gives it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MachineState } from '@shared/ipc/schema/machines';
import type { OrgPolicy } from '@shared/ipc/schema/org';
import { addressOf } from '@shared/machine/address';
import { remoteRow } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { useHubAccess } from './hub-access';
import { useMachines } from './machines';
import { connectPolicies, policyAt, reachOf, usePolicies } from './policies';

const machine = (ref: typeof TEST_MACHINE, state: MachineState['state'], generation = 0): MachineState => ({ ref, name: ref, local: ref === TEST_MACHINE, state, since: '2026-11-07T10:00:00Z', generation });
const read = (ref: typeof TEST_MACHINE, session: string, access: 'private' | 'listed' | 'org-view' = 'private'): OrgPolicy => ({ ok: true, machine: ref, supported: true, policies: [{ session, access, shares: [], policyRev: 1 }] });
const roster = (...machines: MachineState[]) => useMachines.getState().applyRoster(machines);
const at = (ref: typeof TEST_MACHINE, session: string) => addressOf(ref, session) as AppSessionId;

let fake: FakeClient;
let off: () => void;
beforeEach(() => {
  fake = fakeClient();
  usePolicies.setState({ reads: new Map() });
  useHubAccess.setState({ access: 'connected', member: 'member-me' });
});
afterEach(() => {
  off?.();
  useHubAccess.setState({ access: null, member: null });
  useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
});

describe('connectPolicies', () => {
  it('reads each machine that is up, again at each new generation, and none that is down', async () => {
    roster(machine(TEST_MACHINE, 'up'), machine(OTHER_MACHINE, 'down'));
    off = connectPolicies(fake.client);
    expect(fake.invoked('org.policy.get')).toEqual([{ machine: TEST_MACHINE }]);
    await fake.reply('org.policy.get', read(TEST_MACHINE, 'here'));
    expect(policyAt(usePolicies.getState().reads, at(TEST_MACHINE, 'here'))).toMatchObject({ access: 'private' });
    roster(machine(TEST_MACHINE, 'up'), machine(OTHER_MACHINE, 'up', 1));
    roster(machine(TEST_MACHINE, 'up'), machine(OTHER_MACHINE, 'up', 1)); // the same generation again reads nothing
    roster(machine(TEST_MACHINE, 'up'), machine(OTHER_MACHINE, 'down', 1));
    roster(machine(TEST_MACHINE, 'up'), machine(OTHER_MACHINE, 'up', 2));
    expect(fake.invoked('org.policy.get')).toEqual([{ machine: TEST_MACHINE }, { machine: OTHER_MACHINE }, { machine: OTHER_MACHINE }]);
  });

  it('takes every org.policies.changed, and an answer asked for before an event of its machine applies nothing', async () => {
    roster(machine(TEST_MACHINE, 'up'));
    off = connectPolicies(fake.client);
    fake.event('org.policies.changed', read(TEST_MACHINE, 'newer', 'org-view'));
    await fake.reply('org.policy.get', read(TEST_MACHINE, 'older'));
    const reads = usePolicies.getState().reads;
    expect(policyAt(reads, at(TEST_MACHINE, 'newer'))).toMatchObject({ access: 'org-view' });
    expect(policyAt(reads, at(TEST_MACHINE, 'older'))).toBeUndefined();
  });

  it('keeps a refused read (it says why), and reads nothing while signed out', async () => {
    useHubAccess.setState({ access: null, member: null });
    roster(machine(TEST_MACHINE, 'up'));
    off = connectPolicies(fake.client);
    expect(fake.invoked('org.policy.get')).toEqual([]);
    useHubAccess.setState({ access: 'connected', member: 'member-me' }); // signed in: this Mac is read
    await fake.reply('org.policy.get', { ok: false, machine: TEST_MACHINE, reason: 'unavailable' } satisfies OrgPolicy);
    expect(usePolicies.getState().reads.get(TEST_MACHINE)).toEqual({ ok: false, machine: TEST_MACHINE, reason: 'unavailable' });
  });

  it("forgets every read at a sign-out and another member's sign-in, reading again for them, and drops an answer asked for the last", async () => {
    roster(machine(TEST_MACHINE, 'up'));
    off = connectPolicies(fake.client);
    await fake.reply('org.policy.get', read(TEST_MACHINE, 'mine'));
    useHubAccess.setState({ access: null, member: null });
    expect(usePolicies.getState().reads.size).toBe(0);
    useHubAccess.setState({ access: 'connected', member: 'member-b' });
    useHubAccess.setState({ access: 'connected', member: 'member-c' });
    await fake.reply('org.policy.get', read(TEST_MACHINE, 'asked-for-b'));
    expect(usePolicies.getState().reads.size).toBe(0);
    await fake.reply('org.policy.get', read(TEST_MACHINE, 'for-c'));
    expect(policyAt(usePolicies.getState().reads, at(TEST_MACHINE, 'for-c'))).toBeDefined();
  });
});

describe('reachOf', () => {
  const listing = (over: Parameters<typeof remoteRow>[2] = {}) => ({ ...remoteRow(OTHER_MACHINE, 's'), appId: at(OTHER_MACHINE, 's'), ...over });
  const own = (access: 'private' | 'listed' | 'org-view' | 'org-converse', shares = 0) => ({ session: 's', access, shares: Array.from({ length: shares }, (_, i) => ({ member: `m${i}`, grade: 'view' as const })), policyRev: 1 });

  it('marks a session you own by its read: a lock for Private, people for wider access or shares, none for Listed alone', () => {
    expect(reachOf(own('listed'), undefined)).toBeNull();
    expect(reachOf(own('private'), undefined)).toEqual({ mark: 'private', access: 'private', shares: 0 });
    expect(reachOf(own('listed', 2), undefined)).toEqual({ mark: 'shared', access: 'listed', shares: 2 });
    expect(reachOf(own('org-converse'), undefined)).toEqual({ mark: 'shared', access: 'org-converse', shares: 0 });
  });

  it("marks another's private session shared with you by its listing's audience, and nothing the reads don't name", () => {
    expect(reachOf(undefined, listing({ mine: false, audience: ['member-me', 'member-ana'] }))).toEqual({ mark: 'private', sharedWithYou: true });
    expect(reachOf(undefined, listing({ mine: false }))).toBeNull();
    expect(reachOf(undefined, listing({ mine: true, audience: ['member-me'] }))).toBeNull(); // yours: its read says
    expect(reachOf({ session: 's', unavailable: true }, listing())).toBeNull();
  });
});
