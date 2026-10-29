// The Org page's reading of the held head (P5 O8 M4a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4a's
// "The view"; Interfaces §M): members with their names, roles and devices (roots and this Mac marked, each device's
// fingerprint to compare by eye), machines with their owners and no up bit, the roots as `rootLines` reads them, and
// the recovery key's id. Over a state built with the package's own key and fingerprint functions.
import { describe, expect, it } from 'vitest';
import { generateSigningKey, keyId, pairingFingerprint, type Device, type OrgState } from '../../../apps/org-protocol/src/index.ts';
import { OrgViewSchema } from '@shared/ipc/schema/org';
import { orgView } from './view';

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
      { name: 'vm-one', ref: 'r'.repeat(32), pub: (await generateSigningKey()).pub, owners: [OWNER, ANA] },
      { name: 'ci', ref: 's'.repeat(32), pub: (await generateSigningKey()).pub, owners: 'org' },
    ],
    machineNames: [],
    retired: [],
    revoked: [],
    delegations: [],
    projects: [],
  };
  return { state, mac, mini, phone, recovery, stray };
}

describe('the Org page\'s view of the held head', () => {
  it('reads members, devices, machines, roots and the recovery key\'s id from the signed state alone', async () => {
    const { state, mac, mini, phone, recovery, stray } = await fixture();
    const view = await orgView(state, { member: OWNER, device: mac.id }, true);
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
      machines: [
        { name: 'vm-one', ref: 'r'.repeat(32), owners: [OWNER, ANA] },
        { name: 'ci', ref: 's'.repeat(32), owners: 'org' },
      ],
      roots: [
        { kid: await keyId(mini.stepUpPub!), member: OWNER, device: mini.id },
        { kid: stray, unlisted: true },
      ],
    });
    expect(OrgViewSchema.parse(view)).toEqual(view);
  });

  it('carries no machine up bit: whether a machine is up is the renderer\'s, from `useMachines`', async () => {
    const { state, mac } = await fixture();
    const view = await orgView(state, { member: OWNER, device: mac.id }, false);
    for (const machine of view.machines) expect(Object.keys(machine).sort()).toEqual(['name', 'owners', 'ref']);
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
});
