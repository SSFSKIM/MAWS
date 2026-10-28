// The owner attestation an own event carries (O10 M6; RL9; O12's item 3, "built by the endpoint"), and an arriving
// event's, verified, as it goes down to sminos.
//
// Up: an event a session writer (`<name>/<session>`) uploads gains `attest {owners, ownersProof, origin, stateVersion}`
// from that session's record (its `member` frame), `@machine` resolved against the head whose version it names, inside
// the event's v2 signature. A session the endpoint holds no record of gets none: a claim the endpoint can't stand behind
// is worse than no claim, and a receiver reads a missing attestation as owners unverified.
//
// Down: an arriving event's attestation is checked with `verifyAttestation` and goes down as its verified `owners`, each
// `{id, email}`, the email read from this endpoint's head at that moment (`null` for an id it no longer holds), never
// from the event: the signed attestation carries member ids alone (P5 Decision Log 51's label). One that fails goes
// down with `owners: []` and a log line, so sminos labels the sender's owners unverified.
import { isAction, verifyAttestation, type Action, type Attest, type Certificates, type LogEventV2, type OrgState } from 'org-protocol';
import { resolveOwners } from '../listings';
import type { Member } from './members';

const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The session a writer is a session writer of (`<name>/<session uuid>`), or null (`<name>/human` and other feeds). */
export function sessionOfWriter(writer: string): string | null {
  const at = writer.indexOf('/');
  const rest = at < 0 ? '' : writer.slice(at + 1);
  return SESSION.test(rest) ? rest : null;
}

/** The attestation an own session writer's event carries, from its member's record against `head`. */
export async function attestFor(member: Member, head: OrgState, ref: string, certificates: Certificates, now: Date): Promise<Attest> {
  const origin: Attest['origin'] = { kind: member.origin.kind };
  if (typeof member.origin.requester === 'string') origin.requester = member.origin.requester;
  if (typeof member.origin.spawnerSession === 'string') origin.spawnerSession = member.origin.spawnerSession;
  return {
    owners: await resolveOwners(member.owners, head, ref, certificates, now),
    ownersProof: member.ownersProof.filter((proof): proof is Action => isAction(proof)),
    origin,
    stateVersion: head.version,
  };
}

/** An arriving event's verified owners as `{id, email}`, `[]` when its attestation fails; undefined when it has none. */
export async function verifiedOwners(event: LogEventV2, head: OrgState, certificates: Certificates, log: (line: string) => void): Promise<Array<{ id: string; email: string | null }> | undefined> {
  if (!('attest' in event)) return undefined;
  const verdict = await verifyAttestation(head, certificates, event);
  if (!verdict.ok) {
    log(`endpoint: the owner attestation of ${event.writer}:${String(event.seq)} did not verify (${verdict.code}): its owners go down unverified`);
    return [];
  }
  return (verdict.owners ?? []).map((id) => ({ id, email: head.members.find((m) => m.id === id)?.email ?? null }));
}
