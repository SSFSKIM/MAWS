// The grant ledger's intake (RL §6.3; O10 M5's rule, which M2's `mawsd endpoint grant` runs out of band): a grant's own
// signature is its authority. It is verified once, against the head at arrival (`verifyGrant`: signed by an owner's
// device, or an admin's for an org-owned machine, for the key that speaks for the machine now), its `machineKey` must be
// one the ledger holds, and it is kept only when its `version` is above every version the member has had kept
// (`highWater`, which outlives a grant that ended: never a lower version again). A grant ends when a higher version
// replaces it or when its signer's key is revoked (`dropRevokedGrants`, at each new head and at start).
//
// Intake runs in the org view's queue (`EndpointOrg.exclusive`), as adoptions do: the ledger and the head it is checked
// against are read and written with nothing else between, so two grants arriving together, or a grant and a revocation,
// land one after the other.
import { isGrant, isSigned, machineOwners, ownerMembers, verifyGrant, type Certificates, type Grant, type OrgState, type Right, type Signed } from 'org-protocol';
import type { EndpointOrg } from './org-sync';
import type { EndpointState } from './state/store';

/** A machine's grades, in the order RL7's `caps` lists them. */
export const MACHINE_RIGHTS: readonly Right[] = ['spawn', 'shell', 'machine-admin'];

/**
 * The member's grades on this machine (RL §6.3): every one for a machine owner (its member owners, or the admins of an
 * org-owned machine, or its delegation's owners), else the rights of the member's grant in force, else none. M4 tells a
 * device these in `caps`; M5's authorization reads the same.
 */
export async function machineRights(state: EndpointState, head: OrgState, certificates: Certificates, ref: string, member: string, now: Date): Promise<Right[]> {
  if ((await machineOwnerMembers(head, certificates, ref, now)).includes(member)) return [...MACHINE_RIGHTS];
  const rights = state.ledger?.grants[member]?.body.rights ?? [];
  return MACHINE_RIGHTS.filter((r) => rights.includes(r));
}

/**
 * The machine's owners as members (RL §6.3, §5.8's `@machine`): its entry's member owners, the admins of an org-owned
 * machine, or a certificate machine's delegation's owners; none for a ref the head doesn't place.
 */
export async function machineOwnerMembers(head: OrgState, certificates: Certificates, ref: string, now: Date): Promise<string[]> {
  const owners = await machineOwners(head, ref, certificates, now);
  return owners === null ? [] : ownerMembers(head, owners);
}

export type GrantIntake = { ok: true; grant: Signed<Grant> } | { ok: false; reason: string };

export function acceptGrant(state: EndpointState, org: EndpointOrg, ref: string, value: unknown, now: Date): Promise<GrantIntake> {
  return org.exclusive(async (): Promise<GrantIntake> => {
    if (!state.enrolled || state.ledger === null || !org.ready) return { ok: false, reason: 'not-enrolled' };
    if (!isSigned(value, isGrant)) return { ok: false, reason: 'malformed' };
    if (value.body.machine !== ref) return { ok: false, reason: 'other-machine' };
    const verdict = await verifyGrant(org.head().state, value, org.certificates(), now);
    if (!verdict.ok) return { ok: false, reason: verdict.code };
    const ledger = state.ledger;
    if (!ledger.heldKeys.includes(value.body.machineKey)) return { ok: false, reason: 'not-held' };
    const member = value.body.member;
    if ((ledger.highWater[member] ?? 0) >= value.body.version) return { ok: false, reason: 'not-newer' };
    state.setLedger({ ...ledger, grants: { ...ledger.grants, [member]: value }, highWater: { ...ledger.highWater, [member]: value.body.version } });
    return { ok: true, grant: value };
  });
}

/** Ends every grant whose signer's key `head` revokes, the members' versions kept; answers the members left grantless. */
export function dropRevokedGrants(state: EndpointState, head: OrgState): string[] {
  const ledger = state.ledger;
  if (ledger === null) return [];
  const revoked = new Set(head.revoked.map((r) => r.keyId));
  const ended = Object.entries(ledger.grants).filter(([, g]) => revoked.has(g.sig.kid));
  if (ended.length === 0) return [];
  const grants = Object.fromEntries(Object.entries(ledger.grants).filter(([, g]) => !revoked.has(g.sig.kid)));
  state.setLedger({ ...ledger, grants });
  return ended.map(([member]) => member);
}
