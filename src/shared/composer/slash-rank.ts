// Browser-safe palette ranking shared by the renderer and desk. Each caller supplies its origins and owns its recents.
import { fuzzyScore } from './fuzzy';
export type SlashRankItem<Origin extends string> = { name: string; description: string; origin: Origin };
function tier(query: string, item: SlashRankItem<string>): number | null {
  if (query === '') return 0;
  const name = item.name.toLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (fuzzyScore(query, name) !== null) return 3;
  if (item.description.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(query))) return 4;
  return null;
}

/** Pure tiers, then origin and name; a recent name moves up one tier. Returns the original items, with payloads intact. */
export function rankSlashItems<Origin extends string, Item extends SlashRankItem<Origin>>(query: string, items: readonly Item[], origins: readonly Origin[], recent: readonly string[] = []): Item[] {
  const q = query.toLowerCase();
  const boosted = new Set(recent);
  return items.flatMap((item) => {
    const t = tier(q, item);
    return t === null ? [] : [{ item, tier: boosted.has(item.name) ? t - 1 : t }];
  }).sort((a, b) => a.tier - b.tier || origins.indexOf(a.item.origin) - origins.indexOf(b.item.origin) || (a.item.name < b.item.name ? -1 : a.item.name > b.item.name ? 1 : 0))
    .map((s) => s.item);
}

/** One app run's twenty most recently chosen distinct names, independent of another consumer's choices. */
export function createSlashRanker<Origin extends string>(origins: readonly Origin[]) {
  let recent: string[] = [];
  return {
    rankItems<Item extends SlashRankItem<Origin>>(query: string, items: readonly Item[]): Item[] {
      return rankSlashItems(query, items, origins, recent);
    },
    rememberChosen(name: string): void { recent = [name, ...recent.filter((n) => n !== name)].slice(0, 20); },
    resetChosen(): void { recent = []; },
  };
}
