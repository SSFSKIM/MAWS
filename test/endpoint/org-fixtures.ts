// An org's signed states for the endpoint's suites, made with the protocol package's own signing as an admin's app makes
// them: devices with fresh keys, a genesis, successors, root transitions and revocations.
import { endorseDevice, generateSigningKey, keyId, signOrgState, signTransition, stateHash, type Device, type DeviceClass, type OrgState, type RevokedKey, type RootTransition, type Signed, type SignedOrgState, type SigningKey } from 'org-protocol';

export type TestDevice = { device: Device; channel: SigningKey; stepUp: SigningKey };

export async function newDevice(id: string, cls: DeviceClass = 'native-mac'): Promise<TestDevice> {
  const channel = await generateSigningKey();
  const stepUp = await generateSigningKey();
  return { channel, stepUp, device: { id, class: cls, keyStorage: 'software', channelPub: channel.pub, stepUpPub: stepUp.pub } };
}

/** `device` endorsed by `by`, an existing device of the same member (its step-up key signs), as a member's second device must be. */
export async function endorsed(org: string, member: string, device: TestDevice, by: TestDevice): Promise<TestDevice> {
  return { ...device, device: { ...device.device, endorsement: await endorseDevice(org, member, device.device, by.stepUp.privateKey, by.stepUp.pub) } };
}

/** A fresh member id: 128 random bits as lowercase hex. */
export const memberId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

export const iso = (ms: number) => new Date(ms).toISOString();

/** A genesis of one admin, whose one device is the root. */
export async function genesis(org: string, admin: string, device: TestDevice, recovery: SigningKey, issued = iso(Date.now())): Promise<SignedOrgState> {
  const state: OrgState = {
    org,
    version: 1,
    prev: null,
    issued,
    root: { keys: [await keyId(device.stepUp.pub)], recoveryPub: recovery.pub },
    members: [{ id: admin, email: 'owner@example.com', role: 'admin', devices: [device.device] }],
    machines: [],
    machineNames: [],
    retired: [],
    revoked: [],
    delegations: [],
    projects: [],
  };
  return signOrgState(state, [device.stepUp]);
}

/** The state after `head`, changed by `edit`, signed by `signers`' step-up keys; issued `issued` or the head's, whichever is later. */
export async function successor(head: SignedOrgState, signers: TestDevice[], edit: (s: OrgState) => void | Promise<void> = () => {}, issued?: string): Promise<SignedOrgState> {
  const state = structuredClone(head.state);
  state.version += 1;
  state.prev = await stateHash(head.state);
  const at = issued ?? iso(Date.now());
  state.issued = at > head.state.issued ? at : head.state.issued;
  await edit(state);
  return signOrgState(state, signers.map((d) => d.stepUp));
}

/** A root transition from `fromVersion` to `devices`' step-up keys, signed by `recovery`. */
export function transition(org: string, fromVersion: number, devices: TestDevice[], recovery: SigningKey, issued = iso(Date.now())): Promise<Signed<RootTransition>> {
  return signTransition({ org, fromVersion, newRootKeys: devices.map((d) => d.stepUp.pub), issued }, recovery.privateKey, recovery.pub);
}

/** The `revoked` entries a device's keys take when it leaves `member` revoked, as for a lost device (RL DL 24). */
export async function revokedDevice(member: string, device: Device): Promise<RevokedKey[]> {
  const keys: Array<['channel' | 'step-up', string]> = [['channel', device.channelPub], ...(device.stepUpPub === undefined ? [] : [['step-up', device.stepUpPub] as ['step-up', string]])];
  return Promise.all(keys.map(async ([key, pub]) => ({ keyId: await keyId(pub), holder: { member, device: device.id, class: device.class, key } })));
}

/** The `retired` entries of a device's keys leaving honestly, as of `notAfter`. */
export async function retiredDevice(member: string, device: Device, notAfter: string) {
  const keys: Array<['channel' | 'step-up', string]> = [['channel', device.channelPub], ...(device.stepUpPub === undefined ? [] : [['step-up', device.stepUpPub] as ['step-up', string]])];
  return Promise.all(keys.map(async ([key, pub]) => ({ keyId: await keyId(pub), pub, notAfter, holder: { member, device: device.id, class: device.class, key } })));
}
