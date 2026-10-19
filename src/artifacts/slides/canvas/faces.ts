// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D6; M8 fix wave 2, moved here at the final fix wave,
// B6): a deck's uploaded faces drawn under private family names. An @font-face rule is the whole window's, so two decks
// drawn in one window (a panel beside a main tab, a version beside the live deck) that each upload a family both call
// `Brand` would compete for one family; each declares its uploads under names of its own (editor/page-styles.ts) and
// its canvases draw the authored names as those. Display only: the model keeps the authored names.

/** Lower-cased authored family → the private name it is declared under. */
export type FaceAliases = ReadonlyMap<string, string>;

const quoted = (name: string) => JSON.stringify(name);
/** A `var()`: its custom property, and its fallback (what follows the first comma) when it has one. */
const VAR = /^var\(\s*(--[^\s,)]+)\s*(?:,([\s\S]*))?\)$/i;

/**
 * A CSS font-family list with each authored family the aliases name replaced by its private name. A `var()` keeps its
 * token, and the families of its fallback are aliased the same way, a nested `var()`'s too (L180): an upload a value
 * names only as an unresolved token's fallback draws as the upload.
 */
export function aliasFamilyList(value: string, aliases: FaceAliases): string {
  if (aliases.size === 0) return value;
  return listItems(value)
    .map((item) => {
      const token = VAR.exec(item);
      if (token) return token[2] === undefined ? item : `var(${token[1]}, ${aliasFamilyList(token[2], aliases)})`;
      const bare = /^(["']).*\1$/.test(item) ? item.slice(1, -1) : item.replace(/\s+/g, ' ');
      const alias = aliases.get(bare.toLowerCase());
      return alias ? quoted(alias) : item;
    })
    .join(', ');
}

/** A list's items, trimmed: the value split at its commas outside quotes and parentheses. */
function listItems(value: string): string[] {
  const items: string[] = [];
  let current = '';
  let quote: string | null = null;
  let depth = 0;
  for (const ch of value) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      items.push(current.trim());
      current = '';
    } else {
      if (ch === '(') depth++;
      else if (ch === ')' && depth > 0) depth--;
      current += ch;
    }
  }
  items.push(current.trim());
  return items;
}
