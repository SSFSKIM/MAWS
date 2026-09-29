// The palette's ranking (C7 execution document, "Mentions, palette and the "+" menu"): pure and deterministic, by tier
// (exact name, name prefix, name substring, a subsequence of the name, a description word starting with the query),
// ties by origin (Engine, Skills, Plugins, Custom, Widget, MAWS) and then by name; the twenty names chosen most
// recently in this app run move up one tier. Items that match nowhere are left out; an empty query keeps them all.
import { fuzzyScore } from '@shared/composer/fuzzy';
import { ORIGIN_ORDER, type SlashItem } from './items';

const RECENT_LIMIT = 20;
let recent: string[] = [];

export function rememberChosen(name: string): void {
  recent = [name, ...recent.filter((n) => n !== name)].slice(0, RECENT_LIMIT);
}
export function resetChosen(): void {
  recent = [];
}

function tier(query: string, item: SlashItem): number | null {
  if (query === '') return 0;
  const name = item.name.toLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (fuzzyScore(query, name) !== null) return 3;
  if (item.description.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(query))) return 4;
  return null;
}

export function rankItems(query: string, items: readonly SlashItem[]): SlashItem[] {
  const q = query.toLowerCase();
  const boosted = new Set(recent);
  return items
    .flatMap((item) => {
      const t = tier(q, item);
      return t === null ? [] : [{ item, tier: boosted.has(item.name) ? t - 1 : t }];
    })
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        ORIGIN_ORDER.indexOf(a.item.origin) - ORIGIN_ORDER.indexOf(b.item.origin) ||
        (a.item.name < b.item.name ? -1 : a.item.name > b.item.name ? 1 : 0),
    )
    .map((s) => s.item);
}
