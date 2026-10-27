// The grant ledger's intake (RL §6.3; O10 M5's rule, which M2's `mawsd endpoint grant` runs out of band): a grant's own
// signature is its authority. It is verified once, against the head at arrival (`verifyGrant`: signed by an owner's
// device, or an admin's for an org-owned machine, for the key that speaks for the machine now), its `machineKey` must be
// one the ledger holds, and it is kept only when its `version` is above the member's current one. A grant ends when a
// higher version replaces it or when its signer's key is revoked (`dropRevokedGrants`, at each new head).
import { isGrant, isSigned, verifyGrant, type Grant, type OrgState, type Signed } from 'org-protocol';
import type { EndpointOrg } from './org-sync';
import type { EndpointState } from './state/store';

export type GrantIntake = { ok: true; grant: Signed<Grant> } | { ok: false; reason: string };

export async function acceptGrant(state: EndpointState, org: EndpointOrg, ref: string, value: unknown, now: Date): Promise<GrantIntake> {
  const ledger = state.ledger;
  if (!state.enrolled || ledger === null || !org.ready) return { ok: false, reason: 'not-enrolled' };
  if (!isSigned(value, isGrant)) return { ok: false, reason: 'malformed' };
  if (value.body.machine !== ref) return { ok: false, reason: 'other-machine' };
  const verdict = await verifyGrant(org.head().state, value, org.certificates(), now);
  if (!verdict.ok) return { ok: false, reason: verdict.code };
  if (!ledger.heldKeys.includes(value.body.machineKey)) return { ok: false, reason: 'not-held' };
  const current = ledger.grants[value.body.member];
  if (current !== undefined && current.body.version >= value.body.version) return { ok: false, reason: 'not-newer' };
  state.setLedger({ ...ledger, grants: { ...ledger.grants, [value.body.member]: value } });
  return { ok: true, grant: value };
}

/** Ends every grant whose signer's key `head` revokes; answers the members left grantless. */
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
