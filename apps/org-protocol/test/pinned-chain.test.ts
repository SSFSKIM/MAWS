// A machine's first sync (O10 M2, RL §5.2): the org's chain from its genesis, anchored to the pins its enrollment code
// named (the root key ids and the recovery key), so a hub can't hand a new machine an org it made up.
import { describe, expect, it } from 'vitest';
import { keyId, generateSigningKey, type SigningKey } from '../src/keys.ts';
import { signOrgState, signTransition, stateHash } from '../src/org-state.ts';
import { verifyPinnedChain } from '../src/org-view.ts';
import type { Device, OrgState, SignedOrgState } from '../src/types.ts';

const ORG = 'org-pins';
const MEMBER = 'a'.repeat(32);
type Admin = { device: Device; stepUp: SigningKey };

async function admin(id: string): Promise<Admin> {
  const channel = await generateSigningKey();
  const stepUp = await generateSigningKey();
  return { stepUp, device: { id, class: 'native-mac', keyStorage: 'software', channelPub: channel.pub, stepUpPub: stepUp.pub } };
}

async function genesis(root: Admin, recovery: SigningKey): Promise<OrgState> {
  return {
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
}

async function next(head: OrgState, edit: (s: OrgState) => void | Promise<void> = () => {}): Promise<OrgState> {
  const s = structuredClone(head);
  s.version += 1;
  s.prev = await stateHash(head);
  await edit(s);
  return s;
}

const pinsOf = async (root: Admin, recovery: SigningKey) => ({ roots: [await keyId(root.stepUp.pub)], recoveryPub: recovery.pub });

describe('a machine’s first sync', () => {
  it('adopts the chain from its genesis when a pinned root key signed it', async () => {
    const a1 = await admin('a1');
    const recovery = await generateSigningKey();
    const s1 = await signOrgState(await genesis(a1, recovery), [a1.stepUp]);
    const s2 = await signOrgState(await next(s1.state, (s) => void s.projects.push({ id: 'p1', name: 'one' })), [a1.stepUp]);
    const result = await verifyPinnedChain([s1, s2], [], await pinsOf(a1, recovery));
    expect(result).toMatchObject({ ok: true, head: s2, adopted: [s1, s2], transitions: [] });
  });

  it('keeps every transition that authorized a state of the run, and anchors on a root the run reached through one', async () => {
    const a1 = await admin('a1');
    const a2 = await admin('a2');
    const recovery = await generateSigningKey();
    const s1 = await signOrgState(await genesis(a1, recovery), [a1.stepUp]);
    const t = await signTransition({ org: ORG, fromVersion: 1, newRootKeys: [a2.stepUp.pub], issued: '2026-10-27T11:00:00.000Z' }, recovery.privateKey, recovery.pub);
    // The successor under the new root: a2 replaces a1, whose keys leave the state retired.
    const s2 = await next(s1.state, async (s) => {
      s.members[0].devices = [a2.device];
      s.root.keys = [await keyId(a2.stepUp.pub)];
      const holder = (key: 'channel' | 'step-up') => ({ member: MEMBER, device: 'a1', class: 'native-mac' as const, key });
      s.retired = [
        { keyId: await keyId(a1.device.channelPub), pub: a1.device.channelPub, notAfter: s.issued, holder: holder('channel') },
        { keyId: await keyId(a1.stepUp.pub), pub: a1.stepUp.pub, notAfter: s.issued, holder: holder('step-up') },
      ];
    });
    const signed2 = await signOrgState(s2, [a2.stepUp]);
    const s3 = await signOrgState(await next(signed2.state), [a2.stepUp]);
    const result = await verifyPinnedChain([s1, signed2, s3], [t], await pinsOf(a2, recovery));
    expect(result).toMatchObject({ ok: true, head: s3, transitions: [t] });
  });

  it('refuses a chain whose genesis names another recovery key', async () => {
    const a1 = await admin('a1');
    const recovery = await generateSigningKey();
    const s1 = await signOrgState(await genesis(a1, await generateSigningKey()), [a1.stepUp]);
    expect(await verifyPinnedChain([s1], [], await pinsOf(a1, recovery))).toEqual({ ok: false, code: 'bad-link' });
  });

  it('refuses an org the hub made up: the pinned recovery key and the owner’s public keys, but no pinned root’s signature', async () => {
    const a1 = await admin('a1');
    const recovery = await generateSigningKey();
    const forger = await admin('f1');
    // A genesis rooted in the forger's key, then a successor naming the owner's device as the root, signed by the forger.
    const g = await genesis(forger, recovery);
    const s1 = await signOrgState(g, [forger.stepUp]);
    const s2 = await next(g, async (s) => {
      s.members[0].devices = [forger.device, a1.device];
      s.root.keys = [await keyId(forger.stepUp.pub), await keyId(a1.stepUp.pub)];
    });
    const signed2 = await signOrgState(s2, [forger.stepUp]);
    expect(await verifyPinnedChain([s1, signed2], [], await pinsOf(a1, recovery))).toEqual({ ok: false, code: 'not-root-signed' });
  });

  it('adopts an anchored run up to a tail that fails to verify', async () => {
    const a1 = await admin('a1');
    const recovery = await generateSigningKey();
    const s1 = await signOrgState(await genesis(a1, recovery), [a1.stepUp]);
    const s2 = await signOrgState(await next(s1.state), [a1.stepUp]);
    const forged = await signOrgState(await next(s2.state), [(await admin('x')).stepUp]);
    expect(await verifyPinnedChain([s1, s2, forged], [], await pinsOf(a1, recovery))).toMatchObject({ ok: true, head: s2, adopted: [s1, s2] });
  });

  it('refuses a run that starts anywhere but a genesis, and an empty one', async () => {
    const a1 = await admin('a1');
    const recovery = await generateSigningKey();
    const s1 = await signOrgState(await genesis(a1, recovery), [a1.stepUp]);
    const s2: SignedOrgState = await signOrgState(await next(s1.state), [a1.stepUp]);
    const pins = await pinsOf(a1, recovery);
    expect(await verifyPinnedChain([s2], [], pins)).toEqual({ ok: false, code: 'malformed' });
    expect(await verifyPinnedChain([], [], pins)).toEqual({ ok: false, code: 'malformed' });
    expect(await verifyPinnedChain('nope', [], pins)).toEqual({ ok: false, code: 'malformed' });
  });
});
