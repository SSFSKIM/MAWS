// The Org page's reading of the held head (P5 O8 M4a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4a's
// "The view"; Interfaces §M): members with their names, roles and devices (roots and this Mac marked, each device's
// fingerprint to compare by eye), machines with their owners and no up bit, the roots as `rootLines` reads them, and
// the recovery key's id. M4b: each machine's key id, and the certified machines (a delegation's, through a live
// certificate), their owners their delegation's. Over a state built with the package's own key and fingerprint functions.
import { describe, expect, it } from 'vitest';
import { generateSigningKey, keyId, NO_USE_CAP, pairingFingerprint, signRecord, SIGNING_DOMAINS, type Certificates, type Delegation, type Device, type OrgState } from '../../../apps/org-protocol/src/index.ts';
import { OrgViewSchema } from '@shared/ipc/schema/org';
import type { ProvisioningKey } from './hub-client';
import { orgView, type DelegationSources } from './view';

const ORG = 'org-view';
const OWNER = 'a'.repeat(32);
const ANA = 'b'.repeat(32);
const ANA_TOO = 'c'.repeat(32);

async function nativeMac(id: string): Promise<Device> {
  return { id, class: 'native-mac', keyStorage: 'software', channelPub: (await generateSigningKey()).pub, stepUpPub: (await generateSigningKey()).pub };
}

async function fixture() {
  const mac = await nativeMac('mac-this');
  const mini = await nativeMac('mac-mini');
  const phone: Device = {
    id: 'phone-1',
    class: 'web-cards',
    keyStorage: 'webcrypto',
    channelPub: (await generateSigningKey()).pub,
    passkey: { credentialId: 'cred', publicKey: (await generateSigningKey()).pub, rpId: 'desk.example' },
  };
  const recovery = await generateSigningKey();
  const stray = await keyId((await generateSigningKey()).pub);
  const vmOne = await generateSigningKey();
  const ci = await generateSigningKey();
  // M4b: the delegation `dc-` (ANA's), whose certificates name `dc-live` (live) and `dc-old` (its key revoked)
  const delegation = await generateSigningKey();
  const DELEGATION = 'd'.repeat(32);
  const certKey = await generateSigningKey();
  const oldKey = await generateSigningKey();
  const cert = (name: string, ref: string, pub: string) =>
    signRecord(SIGNING_DOMAINS.machineCert, { org: ORG, machine: ref, name, pub, delegation: DELEGATION, use: 1, issued: '2026-10-28T08:00:00.000Z' }, delegation.privateKey, delegation.pub);
  const certificates: Certificates = { certs: [await cert('dc-live', `${DELEGATION}_${'l'.repeat(22)}`, certKey.pub), await cert('dc-old', `${DELEGATION}_${'o'.repeat(22)}`, oldKey.pub)], retirements: [] };
  const state: OrgState = {
    org: ORG,
    version: 7,
    prev: 'p'.repeat(43),
    issued: '2026-10-29T08:00:00.000Z',
    root: { keys: [await keyId(mini.stepUpPub!), stray], recoveryPub: recovery.pub },
    members: [
      { id: OWNER, email: 'owner@example.com', role: 'admin', devices: [mini, mac] },
      { id: ANA, email: 'ana@example.com', role: 'member', devices: [phone] },
      { id: ANA_TOO, email: 'ana@other.example', role: 'member', devices: [] },
    ],
    machines: [
      { name: 'vm-one', ref: 'r'.repeat(32), pub: vmOne.pub, owners: [OWNER, ANA] },
      { name: 'ci', ref: 's'.repeat(32), pub: ci.pub, owners: 'org' },
    ],
    machineNames: [],
    retired: [],
    revoked: [{ keyId: await keyId(oldKey.pub), holder: { machine: `${DELEGATION}_${'o'.repeat(22)}` } }],
    delegations: [{ id: DELEGATION, pub: delegation.pub, prefix: 'dc-', expires: '2026-12-01T00:00:00.000Z', maxUses: 10, offlineRevokeS: 0, owners: [ANA] }],
    projects: [],
  };
  return { state, mac, mini, phone, recovery, stray, certificates, keys: { vmOne: await keyId(vmOne.pub), ci: await keyId(ci.pub), live: await keyId(certKey.pub) }, DELEGATION };
}

describe('the Org page\'s view of the held head', () => {
  it('reads members, devices, machines, roots and the recovery key\'s id from the signed state alone', async () => {
    const { state, mac, mini, phone, recovery, stray, certificates, keys, DELEGATION } = await fixture();
    const view = await orgView(state, { member: OWNER, device: mac.id }, true, certificates, new Date('2026-10-29T09:00:00.000Z'));
    expect(view).toEqual({
      version: 7,
      issued: '2026-10-29T08:00:00.000Z',
      maySign: true,
      recoveryKid: await keyId(recovery.pub),
      members: [
        {
          id: OWNER,
          email: 'owner@example.com',
          name: 'Owner',
          role: 'admin',
          you: true,
          devices: [
            { id: mini.id, class: 'native-mac', keyStorage: 'software', root: true, thisMac: false, fingerprint: await pairingFingerprint(ORG, OWNER, mini) },
            { id: mac.id, class: 'native-mac', keyStorage: 'software', root: false, thisMac: true, fingerprint: await pairingFingerprint(ORG, OWNER, mac) },
          ],
        },
        // Two members whose first names collide read their whole local part, then their whole email (`memberNames`).
        {
          id: ANA,
          email: 'ana@example.com',
          name: 'ana@example.com',
          role: 'member',
          you: false,
          devices: [{ id: phone.id, class: 'web-cards', keyStorage: 'webcrypto', root: false, thisMac: false, fingerprint: await pairingFingerprint(ORG, ANA, phone) }],
        },
        { id: ANA_TOO, email: 'ana@other.example', name: 'ana@other.example', role: 'member', you: false, devices: [] },
      ],
      // a certified machine whose key the head revoked is not shown; a live one's owners are its delegation's
      machines: [
        { name: 'vm-one', ref: 'r'.repeat(32), owners: [OWNER, ANA], keyId: keys.vmOne, certified: false, delegation: null, mayGrant: false },
        { name: 'ci', ref: 's'.repeat(32), owners: 'org', keyId: keys.ci, certified: false, delegation: null, mayGrant: false },
        { name: 'dc-live', ref: `${DELEGATION}_${'l'.repeat(22)}`, owners: [ANA], keyId: keys.live, certified: true, delegation: DELEGATION, mayGrant: false },
      ],
      roots: [
        { kid: await keyId(mini.stepUpPub!), member: OWNER, device: mini.id },
        { kid: stray, unlisted: true },
      ],
      // M4c: with no key list read, the delegation's hub column is empty and nothing is a stray
      delegations: [
        {
          id: DELEGATION,
          prefix: 'dc-',
          owners: [ANA],
          expires: '2026-12-01T00:00:00.000Z',
          maxUses: 10,
          machines: [{ ref: `${DELEGATION}_${'l'.repeat(22)}`, name: 'dc-live', live: true }],
          hub: null,
          state: 'in-effect',
          unsent: null,
          hubBehind: null,
          hubProblem: null,
        },
      ],
      strayKeys: [],
      hubKeys: { at: null, failed: false },
    });
    expect(OrgViewSchema.parse(view)).toEqual(view);
  });

  it('carries no machine up bit: whether a machine is up is the renderer\'s, from `useMachines`', async () => {
    const { state, mac } = await fixture();
    const view = await orgView(state, { member: OWNER, device: mac.id }, false);
    for (const machine of view.machines) expect(Object.keys(machine).sort()).toEqual(['certified', 'delegation', 'keyId', 'mayGrant', 'name', 'owners', 'ref']);
    expect(view.maySign).toBe(false);
  });

  it('a fingerprint is over the entry without its endorsement, as `pair` showed it when the device was approved', async () => {
    const { state, mac } = await fixture();
    const endorsed = structuredClone(state);
    endorsed.members[0].devices[1] = { ...mac, endorsement: { kid: 'k'.repeat(22), value: 's'.repeat(86) } };
    const plain = await orgView(state, { member: OWNER, device: mac.id }, true);
    const withEndorsement = await orgView(endorsed, { member: OWNER, device: mac.id }, true);
    expect(withEndorsement.members[0].devices[1].fingerprint).toBe(plain.members[0].devices[1].fingerprint);
  });

  it('M4b (Fork B): marks the machines where `grantProblems` admits this device\'s step-up key as a grant\'s signer, not by maySign', async () => {
    const { state, mac, mini, certificates } = await fixture();
    const at = new Date('2026-10-29T09:00:00.000Z');
    const mayGrant = async (kid: string | null, maySign: boolean) => (await orgView(state, { member: OWNER, device: mac.id }, maySign, certificates, at, kid)).machines.map((m) => [m.name, m.mayGrant]);
    // This Mac's key, not a root's: an owner of vm-one, an admin for the org-owned ci; dc-live is its delegation's owners'.
    const expected = [
      ['vm-one', true],
      ['ci', true],
      ['dc-live', false],
    ];
    expect(await mayGrant(await keyId(mac.stepUpPub!), false)).toEqual(expected);
    expect(await mayGrant(await keyId(mini.stepUpPub!), true)).toEqual(expected);
    // No key (signed out, or no record signer): none.
    expect((await mayGrant(null, true)).every(([, may]) => may === false)).toBe(true);
    // A key no device of an owner holds: none.
    expect((await mayGrant(await keyId((await generateSigningKey()).pub), true)).every(([, may]) => may === false)).toBe(true);
    // A member of ci's admins no more: ci leaves; vm-one stays (an owner).
    const demoted = structuredClone(state);
    demoted.members[0].role = 'member';
    expect((await orgView(demoted, { member: OWNER, device: mac.id }, false, certificates, at, await keyId(mac.stepUpPub!))).machines.map((m) => m.mayGrant)).toEqual([true, false, false]);
  });
});

describe('M4c: the Delegations section', () => {
  const AT = new Date('2026-10-29T09:00:00.000Z');
  const key = (id: string, over: Partial<ProvisioningKey> = {}): ProvisioningKey => ({ id, label: `key ${id.slice(0, 4)}`, prefix: 'p-', created: '2026-10-01T00:00:00.000Z', expires: '2026-11-15T00:00:00.000Z', max_uses: null, uses: 3, revoked: null, ...over });
  const sources = (over: Partial<DelegationSources>): DelegationSources => ({ slot: null, keys: null, keysFailed: false, unsent: null, hubProblems: new Map(), reserved: null, history: () => undefined, ...over });

  it('joins the head, the unsent slot and the dropped delegations whose hub key is live; hubBehind from the comparison alone', async () => {
    const { state, mac, certificates, DELEGATION } = await fixture();
    const UNSENT = 'e'.repeat(32);
    const DROPPED = 'f'.repeat(32);
    const DROPPED_DEAD = '1'.repeat(32);
    const STRAY = '2'.repeat(32);
    const dropped: Delegation = { id: DROPPED, pub: (await generateSigningKey()).pub, prefix: 'ci-', expires: '2026-11-20T00:00:00.000Z', maxUses: NO_USE_CAP, offlineRevokeS: 0, owners: 'org' };
    const head = structuredClone(state);
    head.revoked.push({ keyId: 'k1', holder: { delegation: DROPPED, prefix: 'ci-' } }, { keyId: 'k2', holder: { delegation: DROPPED_DEAD, prefix: 'old-' } });
    const slotState = structuredClone(head);
    slotState.version += 1;
    slotState.delegations.push({ id: UNSENT, pub: (await generateSigningKey()).pub, prefix: 'gpu-', expires: '2026-12-24T00:00:00.000Z', maxUses: NO_USE_CAP, offlineRevokeS: 0, owners: [OWNER] });
    const list = [
      key(DELEGATION, { prefix: 'dc-' }), // the head's expires (Dec 1) is later than the hub's (Nov 15): behind
      key(UNSENT, { prefix: 'gpu-' }),
      key(DROPPED, { prefix: 'ci-' }), // live: the dropped row, behind
      key(DROPPED_DEAD, { prefix: 'old-', revoked: '2026-10-20T00:00:00.000Z' }), // revoked: no row
      key(STRAY, { prefix: 'x-', created: '2026-10-29T08:55:00.000Z' }), // named by nothing: a young stray
      key('3'.repeat(32), { prefix: 'y-', expires: '2026-10-29T08:00:00.000Z' }), // expired: none
    ];
    const view = await orgView(
      head,
      { member: OWNER, device: mac.id },
      true,
      certificates,
      AT,
      null,
      sources({
        slot: { state: slotState, unsent: { kind: 'delegation', id: UNSENT } },
        keys: { list, at: '2026-10-29T08:59:00.000Z' },
        unsent: { id: UNSENT, rewrite: true, writing: false, problem: 'no secret', generation: 3 },
        hubProblems: new Map([[DROPPED, { reason: 'updating' as const, detail: 'the hub is updating' }]]),
        history: (id) => (id === DROPPED ? dropped : undefined),
      }),
    );
    expect(OrgViewSchema.parse(view)).toEqual(view);
    expect(view.delegations.map((d) => [d.id, d.state, d.hubBehind, d.unsent, d.hubProblem?.reason ?? null])).toEqual([
      [DELEGATION, 'in-effect', 'renew', null, null],
      [UNSENT, 'unsent', null, { rewrite: true, writing: false, problem: 'no secret', generation: 3 }, null],
      [DROPPED, 'dropped', 'revoke', null, 'updating'],
    ]);
    expect(view.delegations[2]).toMatchObject({ prefix: 'ci-', owners: 'org', maxUses: null, expires: '2026-11-20T00:00:00.000Z', hub: { expires: '2026-11-15T00:00:00.000Z', uses: 3, revoked: false } });
    expect(view.strayKeys).toEqual([{ id: STRAY, prefix: 'x-', label: list[4].label, created: '2026-10-29T08:55:00.000Z', expires: '2026-11-15T00:00:00.000Z', young: true }]);
    expect(view.hubKeys).toEqual({ at: '2026-10-29T08:59:00.000Z', failed: false });
  });

  it('an unsent row after a relaunch offers no rewrite; a key no longer behind, or expired, asks nothing of the hub', async () => {
    const { state, mac, DELEGATION } = await fixture();
    const UNSENT = 'e'.repeat(32);
    const slotState = structuredClone(state);
    slotState.delegations.push({ id: UNSENT, pub: (await generateSigningKey()).pub, prefix: 'gpu-', expires: '2026-12-24T00:00:00.000Z', maxUses: 5, offlineRevokeS: 0, owners: [OWNER] });
    const list = [key(DELEGATION, { prefix: 'dc-', expires: '2026-12-01T00:00:00.000Z' }), key(UNSENT, { prefix: 'gpu-' })];
    const view = await orgView(state, { member: OWNER, device: mac.id }, true, undefined, AT, null, sources({ slot: { state: slotState, unsent: { kind: 'delegation', id: UNSENT } }, keys: { list, at: AT.toISOString() } }));
    expect(view.delegations.map((d) => [d.state, d.hubBehind, d.unsent])).toEqual([
      ['in-effect', null, null],
      ['unsent', null, { rewrite: false, writing: false, problem: null, generation: null }], // no run: nothing for a rewrite to name
    ]);
    expect(view.delegations[1].maxUses).toBe(5);
    const expired = await orgView(state, { member: OWNER, device: mac.id }, true, undefined, AT, null, sources({ keys: { list: [key(DELEGATION, { expires: '2026-10-29T08:00:00.000Z' })], at: AT.toISOString() } }));
    expect(expired.delegations[0].hubBehind).toBeNull();
  });

  it('a delegation the slot carries published (no unsent marker) is no stray: it is about to be in effect', async () => {
    const { state, mac } = await fixture();
    const PUBLISHED = 'e'.repeat(32);
    const slotState = structuredClone(state);
    slotState.version += 1;
    slotState.delegations.push({ id: PUBLISHED, pub: (await generateSigningKey()).pub, prefix: 'gpu-', expires: '2026-12-24T00:00:00.000Z', maxUses: NO_USE_CAP, offlineRevokeS: 0, owners: [OWNER] });
    const view = await orgView(state, { member: OWNER, device: mac.id }, true, undefined, AT, null, sources({ slot: { state: slotState, unsent: null }, keys: { list: [key(PUBLISHED, { prefix: 'gpu-' })], at: AT.toISOString() } }));
    expect(view.strayKeys).toEqual([]);
  });

  it("the key a create under way holds is no stray: by id once minted, by prefix and start while the mint is out (the fix wave, I2)", async () => {
    const { state, mac } = await fixture();
    const MINTED = '4'.repeat(32);
    const OTHER = '5'.repeat(32);
    const EARLIER = '6'.repeat(32);
    const list = [
      key(MINTED, { prefix: 'gpu-', created: '2026-10-29T08:58:00.000Z' }),
      key(OTHER, { prefix: 'x-', created: '2026-10-29T08:58:00.000Z' }), // another prefix: a stray
      key(EARLIER, { prefix: 'gpu-', created: '2026-10-29T08:00:00.000Z' }), // before the run began: a stray
    ];
    const strays = async (reserved: DelegationSources['reserved']) =>
      (await orgView(state, { member: OWNER, device: mac.id }, true, undefined, AT, null, sources({ keys: { list, at: AT.toISOString() }, reserved }))).strayKeys.map((k) => k.id);
    expect(await strays(null)).toEqual([MINTED, OTHER, EARLIER]);
    expect(await strays({ id: null, prefix: 'gpu-', since: '2026-10-29T08:57:00.000Z' })).toEqual([OTHER, EARLIER]);
    expect(await strays({ id: MINTED, prefix: 'gpu-', since: '2026-10-29T08:57:00.000Z' })).toEqual([OTHER, EARLIER]);
    expect(await strays({ id: EARLIER, prefix: 'gpu-', since: '2026-10-29T08:57:00.000Z' })).toEqual([MINTED, OTHER]);
  });

  it('lists a retired certified machine as not live, one row per ref, and leaves a revoked one out', async () => {
    const { state, mac, certificates, DELEGATION } = await fixture();
    const retired = structuredClone(state);
    const liveRef = `${DELEGATION}_${'l'.repeat(22)}`;
    const liveCert = certificates.certs[0];
    retired.retired.push({ keyId: await keyId(liveCert.body.pub), pub: liveCert.body.pub, notAfter: '2026-10-29T00:00:00.000Z', holder: { machine: liveRef } });
    const view = await orgView(retired, { member: OWNER, device: mac.id }, true, certificates, AT);
    expect(view.delegations[0].machines).toEqual([{ ref: liveRef, name: 'dc-live', live: false }]);
  });
});
