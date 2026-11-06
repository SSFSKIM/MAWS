// Who may read a session's events (P5 O18 D4, D7; docs/doperpowers/plans/2026-11-05-p5-o18-message-reach.md): the
// endpoint's audiences, which sminos chooses its writer streams by and the signer checks every stream writer against.
//
// A session's audience is null when the whole org may read it (`listed`, `org-view`, `org-converse`) and otherwise the
// sorted member ids whose rank on it is at least `list`: its owners (`@machine` resolved against the head) and every
// member it is shared with, at any grade. A local session's comes from its record (its `member` frame) as it stands
// now, or, once the record has gone, from the newest the policy cache remembered of it; a remote session's from the
// policy cache, fed by its verified snapshots. An event's audience is the meet of the audiences of the sessions it
// addresses and of its writing session: the whole org meets anything as that thing, and two lists meet as their
// intersection.
import { audienceDigest, type Certificates, type OrgState } from 'org-protocol';
import { resolveOwners } from '../listings';
import type { Members } from './members';
import type { Audience, PolicyCache } from './policy-cache';

export type AudienceContext = {
  org(): { head: OrgState; certificates: Certificates; ref: string } | null;
  members: Members;
  cache: PolicyCache;
  now(): number;
};

/** A local session's policy now, as the `audience` frame states it. */
export type LocalPolicy = { owners: string[]; members: Audience; policyRev: number };

/** What the endpoint knows of a session's audience: `local` from its record, `remote` from the cache, or nothing. */
export type Known = { kind: 'local' | 'remote'; audience: Audience } | { kind: 'unknown' };

/** The meet of two audiences: null with null is the whole org; a list with null is the list; two lists intersect. */
export function meet(a: Audience, b: Audience): Audience {
  if (a === null) return b === null ? null : [...b];
  if (b === null) return [...a];
  return a.filter((m) => b.includes(m));
}

/** Whether `outer` contains `inner`: the whole org contains everything, and a list only a list within it. */
export function contains(outer: Audience, inner: Audience): boolean {
  if (outer === null) return true;
  return inner !== null && inner.every((m) => outer.includes(m));
}

export const sameAudience = (a: Audience, b: Audience) => (a === null ? b === null : b !== null && a.length === b.length && a.every((m, i) => m === b[i]));

/** An audience's digest, null for the whole org. */
export const digestOf = (audience: Audience): string | null => (audience === null ? null : audienceDigest(audience));

/**
 * The members a local session's change withdrew: its audience before the change (`null`, listed or org-wide, is every
 * member of the head) less its audience after, sorted. An `unlisted` notice is written to exactly this set (D6), so the
 * signer checks a notice's digest against it, and the `audience` frame tells it to sminos, which holds no member list.
 */
export function withdrawnBy(previous: Audience, next: Audience, everyone: readonly string[]): string[] {
  const before = previous ?? everyone;
  const after = next ?? everyone;
  return [...new Set(before.filter((m) => !after.includes(m)))].sort();
}

const sorted = (members: Iterable<string>) => [...new Set(members)].sort();

/** A local session's policy now from its member frame, against the head; null with no member or no head. */
export async function localPolicy(ctx: AudienceContext, session: string): Promise<LocalPolicy | null> {
  const member = ctx.members.get(session);
  const org = ctx.org();
  if (member === null || org === null) return null;
  const owners = await resolveOwners(member.owners, org.head, org.ref, org.certificates, new Date(ctx.now()));
  const members = member.access === 'private' ? sorted([...owners, ...(member.shares ?? []).map((share) => share.member)]) : null;
  return { owners, members, policyRev: member.policyRev ?? 0 };
}

/** What the endpoint knows of `session`'s audience now (see the header). */
export async function knownAudience(ctx: AudienceContext, session: string): Promise<Known> {
  const local = await localPolicy(ctx, session);
  if (local !== null) return { kind: 'local', audience: local.members };
  const remembered = ctx.cache.before(session, Number.MAX_SAFE_INTEGER);
  if (remembered !== undefined) return { kind: 'local', audience: remembered.audience };
  const remote = ctx.cache.get(session);
  if (remote !== null) return { kind: 'remote', audience: remote.audience };
  return { kind: 'unknown' };
}
