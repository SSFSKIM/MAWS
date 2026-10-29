// The Org page's reading of the held head (P5 O8 M4a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4a's
// "The view"; Interfaces §M's `OrgView`, carried by `org.view`): the members with their names (`memberNames`, M5),
// roles and devices, each device marked a root (its step-up kid in `root.keys`) or this Mac, with its fingerprint for
// compare-by-eye; the machines with their owners; each root kid as `deployment admin show`'s `rootLines` reads it; and
// the recovery key's id. The signed facts only: whether a machine is up is the renderer's (`useMachines`), since a link
// can drop with no new head. The renderer reads it again at each `org.changed`, which the session fires at every
// adopted head. Electron-free.
import { keyId, pairingFingerprint, type Device, type OrgState } from '../../../apps/org-protocol/src/index.ts';
import type { OrgView } from '@shared/ipc/schema/org';
import { memberNames } from '@shared/org/member-name';

/** This Mac in the org: its registration's member and device. */
export type ViewSelf = { member: string; device: string };

/** `state` as the Org page reads it; `maySign` is the signer's (a root, signed in, its keys marked, signing.json readable). */
export async function orgView(state: OrgState, self: ViewSelf, maySign: boolean): Promise<OrgView> {
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
  return {
    version: state.version,
    issued: state.issued,
    maySign,
    recoveryKid: await keyId(state.root.recoveryPub),
    members,
    machines: state.machines.map((machine) => ({ name: machine.name, ref: machine.ref, owners: machine.owners === 'org' ? 'org' : [...machine.owners] })),
    roots: state.root.keys.map((kid) => {
      const holder = holders.get(kid);
      return holder === undefined ? { kid, unlisted: true as const } : { kid, ...holder };
    }),
  };
}
