// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D6; M8 fix wave 2, moved here at the final fix wave,
// B6): a deck's uploaded faces drawn under private family names. An @font-face rule is the whole window's, so two decks
// drawn in one window (a panel beside a main tab, a version beside the live deck) that each upload a family both call
// `Brand` would compete for one family; each declares its uploads under names of its own (editor/page-styles.ts) and
// its canvases draw the authored names as those. Display only: the model keeps the authored names.

/** Lower-cased authored family → the private name it is declared under. */
export type FaceAliases = ReadonlyMap<string, string>;

const quoted = (name: string) => JSON.stringify(name);

/** A CSS font-family list with each authored family the aliases name replaced by its private name (`var()` left). */
export function aliasFamilyList(value: string, aliases: FaceAliases): string {
  if (aliases.size === 0 || value.includes('var(')) return value;
  const names: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of value) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      names.push(current.trim());
      current = '';
    } else current += ch;
  }
  names.push(current.trim());
  return names
    .map((name) => {
      const bare = /^(["']).*\1$/.test(name) ? name.slice(1, -1) : name.replace(/\s+/g, ' ');
      const alias = aliases.get(bare.toLowerCase());
      return alias ? quoted(alias) : name;
    })
    .join(', ');
}
