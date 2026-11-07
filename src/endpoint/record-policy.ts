// `record.policy` (P5 O8 M6b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M6b and Interfaces §Q, agreed with
// the desk track): the general access, the shares and the policy revision of each session its caller owns on the machine,
// or of the one it names, read from sminos's member frames, the record the record acts change.
//   - `{supported: false}` while the connected sminos doesn't advertise `record`: its sessions' reach can't be changed
//     here, so there is nothing to show a Share sheet for. With no sminos connected the call is `unavailable`.
//   - A session is named by the id it is listed under (lane A's engine session id, lane B's appSessionId), and kept when
//     the caller owns it (`manage`). Its frame's `policyRev` is what says sminos read its policy: a frame without one
//     answers `{session, unavailable: true}`, never a default (the desk track's point d). Its `access` and `shares` are
//     the frame's, an absent `access` being RL §6.2's `listed` and absent shares none.
//   - A session named, and not held so (no member frame for it, as for a record sminos can't read, O18 D10; one the
//     caller doesn't own; one that doesn't exist), answers `{session, unavailable: true}` alike, so the answer says
//     nothing of whether a session exists that the caller doesn't own.
//   - A lane B listing answers by the record its acts change, placed the one way both take (targets.ts' `placeRecord`, the
//     desk track's review 632, P2): the owners are read on that record, its frame is the answer, and a listing it can't
//     place (the spine away; no engine session for it) is `unavailable` to a caller who owns a member under it. So the two
//     sessions a `/clear` leaves joined under one listing never show one record and change the other.
//   - Placing is the async step (`placeListings`); what is owned and what the frames say is read in the step the answer
//     goes in (`policies`), against the members then.
import type { Member } from './rl10/members';
import type { Access, Share, SessionTarget } from './sources';
import { RECORD_CAPABILITY } from './rl10/link';
import type { RecordPlacement } from './targets';

export type PolicyEntry = { session: string; access: Access; shares: Share[]; policyRev: number } | { session: string; unavailable: true };
export type PolicyAnswer = { supported: false } | { supported: true; policies: PolicyEntry[] };

/** A session as the machine holds it now: its member frame, the id it is listed under (null before), its target. */
export type HeldSession = { member: Member; listingId: string | null; target: SessionTarget };

/**
 * What `record.policy` answers, sminos as it stands (`advertised`, its hello's capabilities; null with none connected),
 * when that isn't the policies: `unavailable` with no sminos, `{supported: false}` with one that doesn't advertise
 * `record`; null when it does. Read when the call begins, and again in the step its answer goes in (the desk track's
 * review 632, P3), so an answer never says sminos keeps a reach it no longer does.
 */
export function unsupported(advertised: readonly string[] | null): { ok: false; code: 'unavailable' } | { ok: true; output: { supported: false } } | null {
  if (advertised === null) return { ok: false, code: 'unavailable' };
  return advertised.includes(RECORD_CAPABILITY) ? null : { ok: true, output: { supported: false } };
}

/** Each listing's record (by its listing id), as `placeListings` places it; null where it can't be placed. */
export type ListingRecords = ReadonlyMap<string, SessionTarget | null>;

/**
 * The record each listing among `held` (or the one named) answers by: a lane A session its own; a lane B listing the
 * record `place` (targets.ts' `placeRecord`) puts its acts on, null when it can't be placed.
 */
export async function placeListings(held: readonly HeldSession[], place: (appSessionId: string) => Promise<RecordPlacement>, named?: string): Promise<ListingRecords> {
  const out = new Map<string, SessionTarget | null>();
  for (const { listingId, target } of held) {
    if (listingId === null || (named !== undefined && listingId !== named) || out.has(listingId)) continue;
    if (target.lane === 'A') {
      out.set(listingId, target);
      continue;
    }
    const placed = await place(listingId);
    out.set(listingId, placed.kind === 'placed' ? placed.target : null);
  }
  return out;
}

/**
 * The policies of the listings `owns` holds, each read on the record `records` placed it on, from that record's member
 * frame among `held` (the members as they are now); or of the one named. A listing whose record couldn't be placed is
 * `unavailable` to a caller who owns a member under it.
 */
export function policies(held: readonly HeldSession[], records: ListingRecords, owns: (target: SessionTarget) => boolean, named?: string): PolicyEntry[] {
  const out = new Map<string, PolicyEntry>();
  const unavailable = (session: string): PolicyEntry => ({ session, unavailable: true });
  for (const [listingId, target] of records) {
    if (target === null) {
      if (held.some((h) => h.listingId === listingId && owns(h.target))) out.set(listingId, unavailable(listingId));
      continue;
    }
    if (!owns(target)) continue;
    const member = held.find((h) => h.listingId === listingId && h.member.session === target.session)?.member;
    out.set(listingId, member?.policyRev === undefined ? unavailable(listingId) : { session: listingId, access: member.access ?? 'listed', shares: (member.shares ?? []).map((share) => ({ member: share.member, grade: share.grade })), policyRev: member.policyRev });
  }
  if (named !== undefined && !out.has(named)) out.set(named, unavailable(named));
  return [...out.values()];
}
