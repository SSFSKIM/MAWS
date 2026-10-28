// Signed org states for the device's suites (P5 O13 M3): an admin device's keys, a genesis it roots and successors it
// signs, through the protocol package's own signing, so what the phone verifies is what the owner's Mac signs.
import { endorseDevice, generateSigningKey, keyId, signOrgState, stateHash, type Device, type OrgState, type SignedOrgState, type SigningKey } from 'org-protocol';

export type AdminDevice = { device: Device; channel: SigningKey; stepUp: SigningKey };

export async function adminDevice(id = 'a1'): Promise<AdminDevice> {
  const channel = await generateSigningKey();
  const stepUp = await generateSigningKey();
  return { channel, stepUp, device: { id, class: 'native-mac', keyStorage: 'software', channelPub: channel.pub, stepUpPub: stepUp.pub } };
}

/** A fresh member id: 128 random bits as lowercase hex. */
export const memberId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

/** A genesis of one admin, `member`, whose one device roots it. */
export async function genesisOf(org: string, member: string, admin: AdminDevice, recovery: SigningKey, issued = new Date()): Promise<OrgState> {
  return {
    org,
    version: 1,
    prev: null,
    issued: issued.toISOString(),
    root: { keys: [await keyId(admin.stepUp.pub)], recoveryPub: recovery.pub },
    members: [{ id: member, email: 'owner@example.com', role: 'admin', devices: [admin.device] }],
    machines: [],
    machineNames: [],
    retired: [],
    revoked: [],
    delegations: [],
    projects: [],
  };
}

/** The state after `head`, changed by `edit`: the next version, linked to the head, issued now. */
export async function nextOf(head: SignedOrgState | OrgState, edit: (state: OrgState) => void | Promise<void> = () => {}): Promise<OrgState> {
  const before = 'state' in head ? head.state : head;
  const state = structuredClone(before);
  state.version += 1;
  state.prev = await stateHash(before);
  const now = new Date().toISOString();
  state.issued = now > before.issued ? now : before.issued;
  await edit(state);
  return state;
}

export const signedBy = (state: OrgState, admin: AdminDevice): Promise<SignedOrgState> => signOrgState(state, [admin.stepUp]);

/** `device` as the admin's Mac lists it: endorsed by the admin device. */
export async function endorsedBy(org: string, member: string, device: Device, admin: AdminDevice): Promise<Device> {
  return { ...device, endorsement: await endorseDevice(org, member, device, admin.stepUp.privateKey, admin.stepUp.pub) };
}

/** An org of one admin: its genesis signed, and a chain to extend. */
export async function rootedOrg(org: string, member = memberId()) {
  const admin = await adminDevice();
  const recovery = await generateSigningKey();
  const genesis = await signedBy(await genesisOf(org, member, admin, recovery), admin);
  const pins = { roots: genesis.state.root.keys, recoveryPub: recovery.pub };
  return { org, member, admin, recovery, genesis, pins, chain: [genesis] };
}
