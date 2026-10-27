// A test device's side of RL5 (O11 M3): fresh P-256 keys, devices built from them, and org states signed with them,
// through the protocol package's own signing functions, so the suites post to the hub exactly what an admin's app would.
import { endorseDevice, generateSigningKey, keyId, signOrgState, signTransition, stateHash } from 'org-protocol';
import type { Device, DeviceClass, OrgState, RevokedKey, RootTransition, Signed, SignedOrgState, SigningKey } from 'org-protocol';

/** A device and the keys it holds: a channel key, and a step-up key unless it is `web-cards`. */
export type TestDevice = { device: Device; channel: SigningKey; stepUp?: SigningKey };

export async function newDevice(id: string, cls: DeviceClass = 'native-mac'): Promise<TestDevice> {
  const channel = await generateSigningKey();
  if (cls === 'web-cards') return { channel, device: { id, class: cls, keyStorage: 'webcrypto', channelPub: channel.pub } };
  const stepUp = await generateSigningKey();
  return { channel, stepUp, device: { id, class: cls, keyStorage: 'software', channelPub: channel.pub, stepUpPub: stepUp.pub } };
}

/** `device` endorsed by `by`, an existing device of the same member (its step-up key signs). */
export async function endorsed(org: string, member: string, device: TestDevice, by: TestDevice): Promise<TestDevice> {
  const endorsement = await endorseDevice(org, member, device.device, by.stepUp!.privateKey, by.stepUp!.pub);
  return { ...device, device: { ...device.device, endorsement } };
}

export const rootKid = (device: TestDevice) => keyId(device.stepUp!.pub);

/** A genesis of one admin, `member` with `email`, whose one device is the root. */
export async function genesis(org: string, member: string, email: string, device: TestDevice, recovery: SigningKey): Promise<OrgState> {
  return {
    org,
    version: 1,
    prev: null,
    issued: new Date().toISOString(),
    root: { keys: [await rootKid(device)], recoveryPub: recovery.pub },
    members: [{ id: member, email, role: 'admin', devices: [device.device] }],
    machines: [],
    machineNames: [],
    retired: [],
    revoked: [],
    delegations: [],
    projects: [],
  };
}

/**
 * The entries a device's keys take in `revoked` when it leaves `member` in a step (RL DL 24: a device key leaving the
 * state enters `retired` or `revoked` in that step); the suites revoke, as for a lost device.
 */
export async function revokedDevice(member: string, device: Device): Promise<RevokedKey[]> {
  const keys: Array<['channel' | 'step-up', string]> = [['channel', device.channelPub], ...(device.stepUpPub === undefined ? [] : [['step-up', device.stepUpPub] as ['step-up', string]])];
  return Promise.all(keys.map(async ([key, pub]) => ({ keyId: await keyId(pub), holder: { member, device: device.id, class: device.class, key } })));
}

/** The state after `head`, changed by `edit`: the next version, linked to the head, issued now. */
export async function next(head: SignedOrgState | OrgState, edit: (state: OrgState) => void = () => {}): Promise<OrgState> {
  const before = 'state' in head ? head.state : head;
  const state = structuredClone(before);
  state.version += 1;
  state.prev = await stateHash(before);
  const now = new Date().toISOString();
  state.issued = now > before.issued ? now : before.issued;
  edit(state);
  return state;
}

/** `state` signed by the step-up keys of `devices`. */
export const signedBy = (state: OrgState, ...devices: TestDevice[]): Promise<SignedOrgState> => signOrgState(state, devices.map((d) => d.stepUp!));

/** A root transition from the head's version to `devices`' step-up keys, signed by `recovery`. */
export function transition(head: SignedOrgState, devices: TestDevice[], recovery: SigningKey): Promise<Signed<RootTransition>> {
  return signTransition({ org: head.state.org, fromVersion: head.state.version, newRootKeys: devices.map((d) => d.stepUp!.pub), issued: new Date().toISOString() }, recovery.privateKey, recovery.pub);
}

/** A fresh member id: 128 random bits as lowercase hex. */
export const memberId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

/** 32 random bytes, base64url: a pairing MAC's shape (the hub never checks its value). */
export const fakeMac = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
