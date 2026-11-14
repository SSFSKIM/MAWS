// Each application's origin order and recents; ranking itself is shared and browser-safe. UX wave U4a (decision 17):
// this palette breaks ties in the order its items come in (`slashItems`' order), which desk web's does not.
import { createSlashRanker, nameTier } from '@shared/composer/slash-rank';
import { ORIGIN_ORDER, type SlashItem } from './items';

export const { rankItems, rememberChosen, resetChosen } = createSlashRanker(ORIGIN_ORDER, { ties: 'list' });

export const ROW_LIMIT = 40;

// The rows the palette draws for `query`: ranked, and cut to 40 after the order (decision 17 d). A row that cannot run from
// here is drawn only once the typed text matches its name (f): never while nothing is typed, nor for a word of its
// description alone.
export function paletteRows(query: string, items: readonly SlashItem[]): SlashItem[] {
  const q = query.toLowerCase();
  const shown = items.filter((item) => item.action.kind !== 'unavailable' || (q !== '' && nameTier(q, item.name) !== null));
  return rankItems(query, shown).slice(0, ROW_LIMIT);
}
