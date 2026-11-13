// Browser-safe palette ranking shared by the renderer and desk. Each caller supplies its origins and owns its recents.
import { fuzzyScore } from './fuzzy';
export type SlashRankItem<Origin extends string> = { name: string; description: string; origin: Origin };
/** The tier of a name's own match for a lowercased query (exact, prefix, substring, subsequence), or null when the name does not match. */
export function nameTier(query: string, itemName: string): number | null {
  if (query === '') return 0;
  const name = itemName.toLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (fuzzyScore(query, name) !== null) return 3;
  return null;
}
function tier(query: string, item: SlashRankItem<string>): number | null {
  const byName = nameTier(query, item.name);
  if (byName !== null) return byName;
  if (item.description.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(query))) return 4;
  return null;
}

// How items of one tier are ordered: by origin, then name (the default, which desk web keeps), or as they came in (UX wave
// U4a, decision 17 e: the composer's palette, whose list is already in the order a person reads it).
export interface SlashRankOptions {
  ties?: 'origin' | 'list';
}

/** Pure tiers, then the ties' order; a recent name moves up one tier. Returns the original items, with payloads intact. */
export function rankSlashItems<Origin extends string, Item extends SlashRankItem<Origin>>(query: string, items: readonly Item[], origins: readonly Origin[], recent: readonly string[] = [], options: SlashRankOptions = {}): Item[] {
  const q = query.toLowerCase();
  const boosted = new Set(recent);
  const byOrigin = (a: Item, b: Item) => origins.indexOf(a.origin) - origins.indexOf(b.origin) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return items.flatMap((item, index) => {
    const t = tier(q, item);
    return t === null ? [] : [{ item, index, tier: boosted.has(item.name) ? t - 1 : t }];
  }).sort((a, b) => a.tier - b.tier || (options.ties === 'list' ? a.index - b.index : byOrigin(a.item, b.item)))
    .map((s) => s.item);
}

/** One app run's twenty most recently chosen distinct names, independent of another consumer's choices. */
export function createSlashRanker<Origin extends string>(origins: readonly Origin[], options: SlashRankOptions = {}) {
  let recent: string[] = [];
  return {
    rankItems<Item extends SlashRankItem<Origin>>(query: string, items: readonly Item[]): Item[] {
      return rankSlashItems(query, items, origins, recent, options);
    },
    rememberChosen(name: string): void { recent = [name, ...recent.filter((n) => n !== name)].slice(0, 20); },
    resetChosen(): void { recent = []; },
  };
}
