// Each application's origin order and recents; ranking itself is shared and browser-safe. UX wave U4a (decision 17):
// this palette breaks ties in the order its items come in (`slashItems`' order), which desk web's does not.
import { createSlashRanker } from '@shared/composer/slash-rank';
import { ORIGIN_ORDER, type SlashItem } from './items';

export const { rankItems, rememberChosen, resetChosen } = createSlashRanker(ORIGIN_ORDER, { ties: 'list' });

export const ROW_LIMIT = 40;

// The rows the palette draws for `query`: ranked, a row that cannot run from here left out while nothing is typed
// (decision 17 f), and cut to 40 after the order (d).
export function paletteRows(query: string, items: readonly SlashItem[]): SlashItem[] {
  return rankItems(query, query === '' ? items.filter((item) => item.action.kind !== 'unavailable') : items).slice(0, ROW_LIMIT);
}
