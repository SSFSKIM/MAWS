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
//
// P5 O8 M4b (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4b "Touches" and Interfaces §R): `endpoint.grants`
// reads the ledger back, so an issuing device signs its next version above the member's high-water mark and finds the
// grants a machine lost. Its members are the head's, not the ledger's: each member the head lists, their grant in force
// or null, and their mark (0: never granted), the mark answered when no grant survives. A member reads their own entry;
// an owner of the machine (an admin, for an org-owned one) every member's; the machine's owners as one (the local door)
// every member's while the head names any owner. It is judged as the answer goes, as `record.policy` is: the owners are
// read under the head held then, and the answer is made in the step it goes from that head, while it still stands.
import { isGrant, isSigned, machineOwners, ownerMembers, verifyGrant, type Certificates, type Grant, type OrgState, type Right, type Signed } from 'org-protocol';
import type { EndpointOrg } from './org-sync';
import type { EndpointState, LedgerFile } from './state/store';

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

/** How many times `endpoint.grants` reads the machine's owners again when the head or certificates moved under the read. */
export const GRANTS_READS = 3;

/** A member's entry in `endpoint.grants`' answer: their grant in force (null: none) and their high-water mark (0: none). */
export type GrantsEntry = { member: string; grant: Signed<Grant> | null; highWater: number };
/** Who reads `endpoint.grants`: a member, over a channel, or the machine's owners as one (the local door's reader). */
export type GrantsReader = { member: string } | 'owners';
/** The machine's owners as read under `head` (null: none held); `stands`, whether that head and its certificates still are. */
export type GrantsRead = { head: OrgState | null; owners: Promise<readonly string[]>; stands(): boolean };
/** The answer, as RL3's `result` carries a call's. */
export type GrantsResult = { ok: true; output: { members: GrantsEntry[] } } | { ok: false; code: string };

/** The entries `reader` reads of `ledger` under `head`, whose machine's owners are `owners`, in the head's member order. */
export function grantsView(ledger: Pick<LedgerFile, 'grants' | 'highWater'>, head: OrgState, owners: readonly string[], reader: GrantsReader): GrantsEntry[] {
  const every = reader === 'owners' ? owners.length > 0 : owners.includes(reader.member);
  return head.members
    .filter((m) => every || (reader !== 'owners' && m.id === reader.member))
    .map((m) => ({ member: m.id, grant: ledger.grants[m.id] ?? null, highWater: ledger.highWater[m.id] ?? 0 }));
}

/**
 * `endpoint.grants` for `reader`: the machine's owners read (`read`, again while the head or certificates moved under
 * it, up to GRANTS_READS times), then the step that makes the answer as it goes, from the head they were read under
 * while it still stands and the ledger as it is then; `unavailable` otherwise, and while nothing is enrolled.
 */
export async function grantsAnswer(read: () => GrantsRead, ledger: () => LedgerFile | null, reader: GrantsReader, log: (line: string) => void): Promise<() => GrantsResult> {
  for (let reads = 0; reads < GRANTS_READS; reads++) {
    const at = read();
    const owners = await at.owners;
    if (!at.stands()) continue;
    return () => {
      const held = ledger();
      if (!at.stands() || at.head === null || held === null) return { ok: false, code: 'unavailable' };
      return { ok: true, output: { members: grantsView(held, at.head, owners, reader) } };
    };
  }
  log(`endpoint: an endpoint.grants read found the machine's owners moved under each of ${GRANTS_READS} reads; answered unavailable`);
  return () => ({ ok: false, code: 'unavailable' });
}
