// What a row says of its session's owners (P5 O8 M5, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, "The
// label"; Q2). `me` is the signed-in member the rows came with (`OrgRows.member`), `members` main's names for every owner
// the rows name (`OrgRows.members`). A session you own alone says nothing, so your own rows look as they did; otherwise
// "you" first when you are an owner, then the others in the listing's order, two shown in all and "+N" past them
// ("you, Ana", "Ana, Ben +3"). The hover card lists every owner with its email (`ownerEntries`). P5 O15 M2b: a peer
// message's sender is labelled by the same rule, from the names its sminos frame wrote (`ownerIdsOf`); a name main
// can't place is drawn as the caller says (`unknown`): a former member on a session's row, as written on a peer message.
import { FORMER_MEMBER, type OrgMember } from '@shared/ipc/schema/org';

export const OWNERS_SHOWN = 2;
export const YOU = 'you';

export type OwnerEntry = { id: string; name: string; email: string | null };

/** A frame's names as member ids: an email that `members` holds is its member's id; any other name stays as written. */
export function ownerIdsOf(names: readonly string[], members: ReadonlyMap<string, OrgMember>): string[] {
  const byEmail = new Map<string, string>();
  for (const member of members.values()) if (member.email !== null) byEmail.set(member.email.toLowerCase(), member.id);
  return names.map((name) => byEmail.get(name.toLowerCase()) ?? name);
}

const formerMember = (): string => FORMER_MEMBER;

/** Every owner once, you first, then the listing's order; an id main didn't name reads as `unknown` says, a former member by default. */
export function ownerEntries(owners: readonly string[], me: string | null, members: ReadonlyMap<string, OrgMember>, unknown: (id: string) => string = formerMember): OwnerEntry[] {
  const ids = [...new Set(owners)];
  const ordered = me !== null && ids.includes(me) ? [me, ...ids.filter((id) => id !== me)] : ids;
  return ordered.map((id) => {
    const member = members.get(id);
    return { id, name: id === me ? YOU : (member?.name ?? unknown(id)), email: member?.email ?? null };
  });
}

export function ownersLabel(owners: readonly string[], me: string | null, members: ReadonlyMap<string, OrgMember>, unknown: (id: string) => string = formerMember): string | null {
  const entries = ownerEntries(owners, me, members, unknown);
  if (entries.length === 0 || (entries.length === 1 && entries[0].id === me)) return null;
  const names = entries.slice(0, OWNERS_SHOWN).map((e) => e.name).join(', ');
  const rest = entries.length - OWNERS_SHOWN;
  return rest > 0 ? `${names} +${rest}` : names;
}
