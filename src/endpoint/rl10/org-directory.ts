// What RL10 tells sminos of the org, all of it read from the head (O10 M6; Interfaces §D): its identity under it, the
// org's directory in DX2's `org` shape, and the head's revocation set.
//
// The directory. RL1 carries no `org` frame, so the endpoint builds DX2's from the head: a hub project for each of the
// state's `projects`, and for each machine name (enrolled machines, and live certificates, by name) the machine's own
// project, as the hub's directory lists them; `machines` the same names. A machine's `online` is unknown on RL1 and goes
// as `false`, with `seen` the newest event time the endpoint has relayed from that machine's writers.
//
// The revocation set, whole each time, never a delta, so it survives a restart on either side: `keys`, every key id the
// head revokes and every certificate's under a revoked delegation; `devices`, the ids of devices whose revoked keys they
// held and that no member holds in the head now; `members`, the ids holding revoked keys whom the head no longer lists.
// sminos matches a stored signer by any of the three (`signer_revoked`), so a device id or member id still in the head is
// never named: one member's revoked device must not revoke their other device's words.
import { machineProjectId } from 'desk-hub/protocol';
import { isMachineCert, isSigned, keyId, machineNameKey, type Certificates, type OrgState } from 'org-protocol';

export type OrgDirectory = {
  t: 'org';
  projects: Array<{ id: string; name: string; kind: 'hub' | 'machine'; machine?: string; retired: boolean }>;
  machines: Array<{ name: string; online: boolean; seen: string | null }>;
};

export type RevocationSet = { version: number; devices: string[]; members: string[]; keys: string[] };

/** The names the machines of the head go by: enrolled machines', and live certificates' (as `machineSigners` reads them). */
function machineNames(head: OrgState, certificates: Certificates, now: Date): string[] {
  const names = new Map<string, string>();
  for (const m of head.machines) names.set(machineNameKey(m.name), m.name);
  const live = new Set(head.delegations.filter((d) => Date.parse(d.expires) > now.getTime()).map((d) => d.id));
  const revoked = new Set(head.revoked.flatMap((r) => ('delegation' in r.holder ? [r.holder.delegation] : [])));
  for (const c of certificates.certs) {
    if (isSigned(c, isMachineCert) && live.has(c.body.delegation) && !revoked.has(c.body.delegation)) names.set(machineNameKey(c.body.name), c.body.name);
  }
  return [...names.values()].sort();
}

/** DX2's `org` frame from the head; `seen` gives each machine name's newest relayed event time. */
export function orgDirectory(head: OrgState, certificates: Certificates, now: Date, seen: (name: string) => string | null): OrgDirectory {
  const names = machineNames(head, certificates, now);
  return {
    t: 'org',
    projects: [
      ...head.projects.map((p) => ({ id: p.id, name: p.name, kind: 'hub' as const, retired: false })),
      ...names.map((name) => ({ id: machineProjectId(head.org, name), name, kind: 'machine' as const, machine: name, retired: false })),
    ],
    machines: names.map((name) => ({ name, online: false, seen: seen(name) })),
  };
}

/** The head's whole revocation set (see the header). */
export async function revocationSet(head: OrgState, certificates: Certificates): Promise<RevocationSet> {
  const keys = new Set(head.revoked.map((r) => r.keyId));
  const delegations = new Set(head.revoked.flatMap((r) => ('delegation' in r.holder ? [r.holder.delegation] : [])));
  for (const c of certificates.certs) if (isSigned(c, isMachineCert) && delegations.has(c.body.delegation)) keys.add(await keyId(c.body.pub));
  const members = new Set(head.members.map((m) => m.id));
  const devices = new Set(head.members.flatMap((m) => m.devices.map((d) => d.id)));
  const revokedDevices = new Set<string>();
  const revokedMembers = new Set<string>();
  for (const r of head.revoked) {
    if (!('member' in r.holder)) continue;
    if (!devices.has(r.holder.device)) revokedDevices.add(r.holder.device);
    if (!members.has(r.holder.member)) revokedMembers.add(r.holder.member);
  }
  return { version: head.version, devices: [...revokedDevices].sort(), members: [...revokedMembers].sort(), keys: [...keys].sort() };
}

/** The other names `machineNames` binds to `ref`, besides `name` (the welcome's `former`: names only). */
export function formerNames(head: OrgState, ref: string, name: string): string[] {
  return head.machineNames.filter((p) => p.ref === ref && machineNameKey(p.name) !== machineNameKey(name)).map((p) => p.name);
}
