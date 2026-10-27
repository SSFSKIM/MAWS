// Forward adoption's replay barrier (O10 M2's review): once a verifier holds the transitions it accepted, `advanceHead`
// takes a root transition forward only when it is issued later than every one of them and is none of them, the rule
// `verifyRewind` holds a recovery to. After a recovery rewinds the head back to an older transition's `fromVersion`, that
// transition is authentic and from the head again; the barrier is what keeps it from handing the displaced root back.
import { describe, expect, it } from 'vitest';
import { keyId, generateSigningKey, type SigningKey } from '../src/keys.ts';
import { signOrgState, signTransition, stateHash } from '../src/org-state.ts';
import { advanceHead } from '../src/org-view.ts';
import type { Device, OrgState, RootTransition, SignedOrgState } from '../src/types.ts';

const ORG = 'org-barrier';
const MEMBER = 'b'.repeat(32);
type Admin = { device: Device; stepUp: SigningKey };

async function admin(id: string): Promise<Admin> {
  const channel = await generateSigningKey();
  const stepUp = await generateSigningKey();
  return { stepUp, device: { id, class: 'native-mac', keyStorage: 'software', channelPub: channel.pub, stepUpPub: stepUp.pub } };
}

async function genesis(root: Admin, recovery: SigningKey): Promise<SignedOrgState> {
  const state: OrgState = {
    org: ORG,
    version: 1,
    prev: null,
    issued: '2026-10-27T10:00:00.000Z',
    root: { keys: [await keyId(root.stepUp.pub)], recoveryPub: recovery.pub },
    members: [{ id: MEMBER, email: 'owner@example.com', role: 'admin', devices: [root.device] }],
    machines: [],
    machineNames: [],
    retired: [],
    revoked: [],
    delegations: [],
    projects: [],
  };
  return signOrgState(state, [root.stepUp]);
}

/** The successor of `head` under the root `to` (a transition's new root, its device joining the admin's others). */
async function underRoot(head: SignedOrgState, to: Admin): Promise<SignedOrgState> {
  const s = structuredClone(head.state);
  s.version += 1;
  s.prev = await stateHash(head.state);
  s.root.keys = [await keyId(to.stepUp.pub)];
  s.members[0].devices = [...s.members[0].devices, to.device];
  return signOrgState(s, [to.stepUp]);
}

const transitionTo = (recovery: SigningKey, fromVersion: number, to: Admin, issued: string) =>
  signTransition({ org: ORG, fromVersion, newRootKeys: [to.stepUp.pub], issued }, recovery.privateKey, recovery.pub);

describe('advanceHead’s replay barrier', () => {
  it('takes a transition issued after every accepted one, and refuses one issued before or already accepted', async () => {
    const a1 = await admin('a1');
    const a2 = await admin('a2');
    const recovery = await generateSigningKey();
    const s1 = await genesis(a1, recovery);
    const t = await transitionTo(recovery, 1, a2, '2026-10-27T11:00:00.000Z');
    const s2 = await underRoot(s1, a2);
    const later: RootTransition = { org: ORG, fromVersion: 0, newRootKeys: [a1.stepUp.pub], issued: '2026-10-27T12:00:00.000Z' };
    const earlier: RootTransition = { ...later, issued: '2026-10-27T09:00:00.000Z' };

    // Without the accepted set the transition authorizes its successor, as on a first sync.
    expect((await advanceHead(s1, [s2], [t])).adopted).toEqual([s2]);
    expect((await advanceHead(s1, [s2], [t], [earlier])).adopted).toEqual([s2]);
    expect((await advanceHead(s1, [s2], [t], [earlier])).transitions).toEqual([t]);
    // Issued before an accepted transition, or one of them: it authorizes nothing, and the old root didn't sign s2.
    expect((await advanceHead(s1, [s2], [t], [later])).adopted).toEqual([]);
    expect((await advanceHead(s1, [s2], [t], [t.body])).adopted).toEqual([]);
  });

  it('holds within one run: a transition issued before the one the run just took authorizes nothing', async () => {
    const a1 = await admin('a1');
    const a2 = await admin('a2');
    const a3 = await admin('a3');
    const recovery = await generateSigningKey();
    const s1 = await genesis(a1, recovery);
    const first = await transitionTo(recovery, 1, a2, '2026-10-27T12:00:00.000Z');
    const s2 = await underRoot(s1, a2);
    const older = await transitionTo(recovery, 2, a3, '2026-10-27T11:00:00.000Z');
    const s3 = await underRoot(s2, a3);
    const run = await advanceHead(s1, [s2, s3], [first, older], []);
    expect(run.adopted).toEqual([s2]);
    expect(run.transitions).toEqual([first]);
  });
});
