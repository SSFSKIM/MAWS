// Each application's origin order and recents; ranking itself is shared and browser-safe.
import { createSlashRanker } from '@shared/composer/slash-rank';
import { ORIGIN_ORDER } from '../../conversation/catalog';

export const { rankItems, rememberChosen, resetChosen } = createSlashRanker(ORIGIN_ORDER);
