// What RL10 tells sminos of the org, all of it read from the head (O10 M6; Interfaces §D): its identity under it, the
// org's directory in DX2's `org` shape, and the head's revocation set.
//
// The directory. RL1 carries no `org` frame, so the endpoint builds DX2's from the head: a hub project for each project the
// machines' projects records name (the project registry, Interfaces §D and design §8: the records' assembly, which the
// caller hands in, in place of the head's `projects`, which nothing writes), and for each machine name (enrolled machines, and certificates under a live delegation, by name)
// the machine's own project, as the hub's directory lists them; `machines` the same names. A machine's `online` is unknown
// on RL1 and goes as `false`, with `seen` the newest event time the endpoint has relayed from that machine's writers.
// A machine the head doesn't enroll and no certificate stands for any more (each retired, revoked or expired:
// `standingCertNames`) has retired, such as a deleted devcloud VM: its project goes `retired: true` and its `machines`
// entry carries `retired: true`, an optional field an older sminos passes by. Its name stays listed, so sminos can tell a
// retired machine from one it was never told of; one that is only offline is not retired. An enrolled machine goes by
// each name `machineNames` binds to its ref, its former names too: the ref still signs under them (`machineSigners`), so
// a certificate bearing one, forged or not, never retires it.
//
// The revocation set, whole each time, never a delta, so it survives a restart on either side: `keys`, every key id the
// head revokes and every certificate's under a revoked delegation; `devices`, the ids of devices whose revoked keys they
// held and that no member holds in the head now; `members`, the ids holding revoked keys whom the head no longer lists.
// sminos matches a stored signer by any of the three (`signer_revoked`), so a device id or member id still in the head is
// never named: one member's revoked device must not revoke their other device's words.
import { machineProjectId } from 'desk-hub/protocol';
import { isMachineCert, isSigned, keyId, directoryMachineNames, machineNameKey, standingCertNames, type Certificates, type OrgState } from 'org-protocol';

export type OrgDirectory = {
  t: 'org';
  projects: Array<{ id: string; name: string; kind: 'hub' | 'machine'; machine?: string; retired: boolean }>;
  machines: Array<{ name: string; online: boolean; seen: string | null; retired?: true }>;
};

export type RevocationSet = { version: number; devices: string[]; members: string[]; keys: string[] };

/**
 * DX2's `org` frame from the head; `seen` gives each machine name's newest relayed event time, `hub` the hub projects of
 * the registry (none named by a machine's own project, none of them `hub: false`).
 */
export async function orgDirectory(head: OrgState, certificates: Certificates, now: Date, seen: (name: string) => string | null, hub: ReadonlyArray<{ id: string; name: string }> = []): Promise<OrgDirectory> {
  const names = directoryMachineNames(head, certificates, now);
  const refs = new Set(head.machines.map((m) => m.ref));
  const enrolled = new Set([...head.machines, ...head.machineNames.filter((p) => refs.has(p.ref))].map((m) => machineNameKey(m.name)));
  const standing = await standingCertNames(head, certificates, now);
  const retired = (name: string) => !enrolled.has(machineNameKey(name)) && !standing.has(machineNameKey(name));
  return {
    t: 'org',
    projects: [
      ...hub.map((p) => ({ id: p.id, name: p.name, kind: 'hub' as const, retired: false })),
      ...names.map((name) => ({ id: machineProjectId(head.org, name), name, kind: 'machine' as const, machine: name, retired: retired(name) })),
    ],
    machines: names.map((name) => ({ name, online: false, seen: seen(name), ...(retired(name) ? { retired: true as const } : {}) })),
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
