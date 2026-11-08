// The Org page's reading of the held head (P5 O8 M4a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4a's
// "The view"; Interfaces §M's `OrgView`, carried by `org.view`): the members with their names (`memberNames`, M5),
// roles and devices, each device marked a root (its step-up kid in `root.keys`) or this Mac, with its fingerprint for
// compare-by-eye; the machines with their owners; each root kid as `deployment admin show`'s `rootLines` reads it; and
// the recovery key's id. The signed facts only: whether a machine is up is the renderer's (`useMachines`), since a link
// can drop with no new head. The renderer reads it again at each `org.changed`, which the session fires at every
// adopted head. M4b: each machine's key id, and the certified machines (devcloud VMs): each live certificate the held
// certificates carry, judged against the head (`certificateViews`), with its delegation and that delegation's owners,
// which are its own. M4b (the architect's Fork B): `mayGrant`, whether this device's step-up key may sign a grant on each
// machine, by `grantProblems`' own eligibility (an owner's device, an admin's for `'org'`), never by `maySign`, so the page
// shows Grant… there without judging it again. Electron-free.
import { certificateViews, grantProblems, keyId, pairingFingerprint, type Certificates, type Device, type OrgState } from '../../../apps/org-protocol/src/index.ts';
import type { OrgView } from '@shared/ipc/schema/org';
import { memberNames } from '@shared/org/member-name';

/** This Mac in the org: its registration's member and device. */
export type ViewSelf = { member: string; device: string };

const NO_CERTIFICATES: Certificates = { certs: [], retirements: [] };

/**
 * Whether `grantProblems` admits `kid` as the signer of a grant to `self` on `ref`, for its key `machineKey`: the
 * machine's eligibility alone, since the member and rights are the sheet's to choose.
 */
async function grants(state: OrgState, certificates: Certificates, ref: string, machineKey: string, self: ViewSelf, kid: string | null, now: Date): Promise<boolean> {
  if (kid === null) return false;
  const probe = { org: state.org, machine: ref, machineKey, member: self.member, rights: [], version: 1, issued: now.toISOString() };
  return (await grantProblems(state, certificates, probe, kid, now)).length === 0;
}

/**
 * `state` as the Org page reads it; `maySign` is the signer's (a root, signed in, its keys marked, signing.json
 * readable); `certificates`, the ones held with it, judged at `now`; `grantKid`, this device's step-up key id while it may
 * sign a record (null: signed out, or no record signer), which `mayGrant` judges.
 */
export async function orgView(state: OrgState, self: ViewSelf, maySign: boolean, certificates: Certificates = NO_CERTIFICATES, now = new Date(), grantKid: string | null = null): Promise<OrgView> {
  const names = memberNames(state.members);
  const stepUpKid = async (d: Device) => (d.stepUpPub === undefined ? null : keyId(d.stepUpPub));
  const holders = new Map<string, { member: string; device: string }>();
  const members: OrgView['members'] = [];
  for (const m of state.members) {
    const devices: OrgView['members'][number]['devices'] = [];
    for (const d of m.devices) {
      const kid = await stepUpKid(d);
      if (kid !== null) holders.set(kid, { member: m.id, device: d.id });
      devices.push({
        id: d.id,
        class: d.class,
        keyStorage: d.keyStorage,
        root: kid !== null && state.root.keys.includes(kid),
        thisMac: m.id === self.member && d.id === self.device,
        fingerprint: await pairingFingerprint(state.org, m.id, d),
      });
    }
    members.push({ id: m.id, email: m.email, name: names.get(m.id) ?? m.email, role: m.role, you: m.id === self.member, devices });
  }
  const machines: OrgView['machines'] = [];
  for (const m of state.machines) {
    const kid = await keyId(m.pub);
    const mayGrant = await grants(state, certificates, m.ref, kid, self, grantKid, now);
    machines.push({ name: m.name, ref: m.ref, owners: m.owners === 'org' ? 'org' : [...m.owners], keyId: kid, certified: false, delegation: null, mayGrant });
  }
  for (const c of await certificateViews(state, certificates, now)) {
    const owners = state.delegations.find((d) => d.id === c.delegation)?.owners;
    if (c.state !== 'live' || owners === undefined || machines.some((m) => m.ref === c.ref)) continue;
    const mayGrant = await grants(state, certificates, c.ref, c.kid, self, grantKid, now);
    machines.push({ name: c.name, ref: c.ref, owners: owners === 'org' ? 'org' : [...owners], keyId: c.kid, certified: true, delegation: c.delegation, mayGrant });
  }
  return {
    version: state.version,
    issued: state.issued,
    maySign,
    recoveryKid: await keyId(state.root.recoveryPub),
    members,
    machines,
    roots: state.root.keys.map((kid) => {
      const holder = holders.get(kid);
      return holder === undefined ? { kid, unlisted: true as const } : { kid, ...holder };
    }),
  };
}
