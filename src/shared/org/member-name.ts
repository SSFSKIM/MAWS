// A member's first name (P5 O8 M5, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M5's "Names"; Interfaces
// §L). The signed org state's members carry `id`, `email`, `role` and `devices` and no name (RL5's member shape is
// closed), so a first name is derived from the email: its local part's first run of letters, the runs split at `.`,
// `_`, `-`, `+` and digits, capitalized ("ana.lopez@…" reads "Ana"). Members of one head whose names collide read their
// whole local part, and those whose local parts collide too their whole email, so no two of them read alike.

const LETTERS = /\p{L}+/u;

const localPart = (email: string): string => {
  const at = email.lastIndexOf('@');
  return at === -1 ? email : email.slice(0, at);
};

export function memberName(email: string): string {
  const local = localPart(email);
  const run = LETTERS.exec(local)?.[0];
  if (run === undefined) return local;
  return run.charAt(0).toLocaleUpperCase() + run.slice(1).toLocaleLowerCase();
}

/** Every member's name by id, collisions (compared case-insensitively) widened as above. */
export function memberNames(members: ReadonlyArray<{ id: string; email: string }>): Map<string, string> {
  type Member = { id: string; email: string };
  // whether a member's reading is shared by another of `list`
  const collision = (read: (member: Member) => string, list: readonly Member[]) => {
    const key = (member: Member) => read(member).toLocaleLowerCase();
    const count = new Map<string, number>();
    for (const member of list) count.set(key(member), (count.get(key(member)) ?? 0) + 1);
    return (member: Member) => (count.get(key(member)) ?? 0) > 1;
  };
  const firstCollides = collision((m) => memberName(m.email), members);
  const localCollides = collision((m) => localPart(m.email), members.filter(firstCollides));
  return new Map(members.map((m) => [m.id, !firstCollides(m) ? memberName(m.email) : !localCollides(m) ? localPart(m.email) : m.email]));
}
