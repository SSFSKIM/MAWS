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
//   - A lane B session two members are joined to answers by the member its record acts would go to (members.ts'
//     `recordMember`), or `unavailable` when they can't be told apart.
import type { Member } from './rl10/members';
import type { Access, Share, SessionTarget } from './sources';

export type PolicyEntry = { session: string; access: Access; shares: Share[]; policyRev: number } | { session: string; unavailable: true };
export type PolicyAnswer = { supported: false } | { supported: true; policies: PolicyEntry[] };

/** A session as the machine holds it now: its member frame, the id it is listed under (null before), its target. */
export type HeldSession = { member: Member; listingId: string | null; target: SessionTarget };

/**
 * The policies of the sessions `owns` holds (each by its target) among `held`, or of the one named; `recordMember`, the
 * member a lane B listing's record acts go to (members.ts).
 */
export function policies(held: readonly HeldSession[], owns: (target: SessionTarget) => boolean, recordMember: (appSessionId: string) => string | null, named?: string): PolicyEntry[] {
  const out = new Map<string, PolicyEntry>();
  for (const { member, listingId, target } of held) {
    if (listingId === null || (named !== undefined && listingId !== named) || out.has(listingId)) continue;
    if (target.lane === 'B') {
      const keyed = recordMember(listingId);
      if (keyed === null) {
        if (owns(target)) out.set(listingId, { session: listingId, unavailable: true });
        continue;
      }
      if (keyed !== member.session) continue;
    }
    if (!owns(target)) continue;
    out.set(listingId, member.policyRev === undefined ? { session: listingId, unavailable: true } : { session: listingId, access: member.access ?? 'listed', shares: (member.shares ?? []).map((share) => ({ member: share.member, grade: share.grade })), policyRev: member.policyRev });
  }
  if (named !== undefined && !out.has(named)) out.set(named, { session: named, unavailable: true });
  return [...out.values()];
}
