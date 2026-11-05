// Reach is decided at delivery (P5 O18 D1–D3, docs/doperpowers/plans/2026-11-05-p5-o18-message-reach.md). Before
// sminos pushes any peer message to a session it asks `reach? {id, project, session, event}`, the event as it stored
// it, and pushes only on `reach {verdict: 'deliver'}`; no answer leaves the delivery owed. The receiving endpoint decides
// from its own org state and the recipient's record, and reads none of sminos's verdicts (`verified`): it judges the
// event's sender again here.
//
// The sender, as member ids:
//   - an event under one of this machine's own writers: its session's owners (`@machine` resolved), from its record, or
//     from the attestation the signature ledger kept for its position; with no session (`<machine>/human`, its stream)
//     or no attestation, the machine's owners. A ledger entry holding another body there is tampering: unverified;
//   - a device's `hub/<member>` words, verified: that member;
//   - another machine's v2 event, verified: its attestation's owners, the event refused (unverified) when that fails;
//     with none, the signing machine's owners (as the hub reads an event with no attest);
//   - anything else (unsigned, v1, a signature that fails now): unverified.
// Members the head no longer holds are no one's sender.
//
// The verdict, by D1 and D2: `deliver` when a sender shares an owner with the recipient (a person's own sessions are
// never restricted among themselves), or when every sender holds at least `list` on it; an unverified sender reaches
// only a session the whole org may message. Otherwise `refuse`, `unverified` or `not-reachable`. A recipient the
// endpoint holds no record of is not decided (null): sminos's restatement may not have reached it yet, and the
// delivery stays owed.
import { isHubWriter, isLogSeq, isSig, machineNameKey, machineOwners, ownerMembers, verifyAttestation, verifyEvent, writerMachine, writerSession, type LogEventV2 } from 'org-protocol';
import { rankAtLeast, sessionRank } from '../grades';
import { resolveOwners } from '../listings';
import { signerOf } from './log-relay';
import { bodyHash, uploadForm } from './signature-ledger';
import type { WordsContext } from './words';

export type ReachVerdict = 'deliver' | { refuse: 'not-reachable' | 'unverified' };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `reach?` decided (see the header); null when the recipient's record isn't held, which leaves the ask unanswered. */
export async function decideReach(ctx: WordsContext, frame: Record<string, unknown>): Promise<ReachVerdict | null> {
  const project = frame.project;
  const member = typeof frame.session === 'string' ? ctx.members.get(frame.session) : null;
  if (member === null) return null;
  const record = ctx.members.recordOf(member.session);
  const org = ctx.org();
  if (org === null || record === null) return null;
  const owners = await ctx.machineOwners();
  const now = new Date(ctx.now());
  const recipient = await resolveOwners(member.owners, org.head, org.ref, org.certificates, now);
  const event = isObject(frame.event) ? frame.event : null;
  const sender = event === null || typeof project !== 'string' || project === '' ? null : await senderOf(ctx, project, event, owners);
  const held = (sender ?? []).filter((id) => org.head.members.some((m) => m.id === id));
  if (held.some((id) => recipient.includes(id))) return 'deliver';
  if (held.length === 0) return (record.access ?? 'listed') === 'private' ? { refuse: 'unverified' } : 'deliver';
  return held.every((id) => rankAtLeast(sessionRank(record, id, owners), 'list')) ? 'deliver' : { refuse: 'not-reachable' };
}

/** The event's sender as member ids, or null when it can't be verified (see the header). */
async function senderOf(ctx: WordsContext, project: string, stored: Record<string, unknown>, machineOwnerIds: string[]): Promise<string[] | null> {
  const event: Record<string, unknown> = { ...stored };
  delete event.verified;
  if (typeof event.writer !== 'string' || !isLogSeq(event.seq)) return null;
  const org = ctx.org();
  if (org === null) return null;
  const now = new Date(ctx.now());
  const name = writerMachine(event.writer);
  if (name !== null && org.head.machineNames.some((p) => p.ref === org.ref && machineNameKey(p.name) === machineNameKey(name))) {
    const form = uploadForm(event);
    const held = ctx.ledger.get(project, event.writer, event.seq);
    if (form === null || (held !== null && held.hash !== bodyHash(form))) return null;
    const session = writerSession(event.writer);
    if (session === null) return machineOwnerIds;
    const member = ctx.members.get(session);
    if (member !== null) return resolveOwners(member.owners, org.head, org.ref, org.certificates, now);
    return held?.attest?.owners ?? machineOwnerIds;
  }
  if (!isSig(event.sig)) return null;
  const signed = event as unknown as LogEventV2;
  const verdict = await verifyEvent({ org: org.head.org, project }, org.head, signed, org.certificates, now);
  if (!verdict.ok) return null;
  if (isHubWriter(event.writer)) {
    const signer = await signerOf(org.head, org.certificates, signed);
    return signer?.kind === 'device' ? [signer.member] : null;
  }
  if ('attest' in event) {
    const attested = await verifyAttestation(org.head, org.certificates, signed);
    return attested.ok ? (attested.owners ?? []) : null;
  }
  const signer = await signerOf(org.head, org.certificates, signed);
  if (signer?.kind !== 'machine') return null;
  const machine = await machineOwners(org.head, signer.ref, org.certificates, now);
  return machine === null ? null : ownerMembers(org.head, machine);
}
