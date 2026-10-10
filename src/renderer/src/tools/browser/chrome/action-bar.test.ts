import { describe, expect, it } from 'vitest';
import { ACTIONS_FOLD_ADDRESS_MIN_PX } from '@shared/browser/extensions';
import { foldsActions, inlineActionsWidth } from './action-bar';

describe('the action bar\'s fold (cua #90)', () => {
  it('measures the inline icons: 24 px each, 2 px apart', () => {
    expect([0, 1, 3].map(inlineActionsWidth)).toEqual([0, 24, 76]);
  });

  it('folds inline icons when the address field is under 160 px, and not at 160', () => {
    expect(ACTIONS_FOLD_ADDRESS_MIN_PX).toBe(160);
    expect(foldsActions(159, false, 3)).toBe(true);
    expect(foldsActions(160, false, 3)).toBe(false);
  });

  it('unfolds only when the field keeps 160 px with the icons inline, so one width never flips the bar', () => {
    // three icons inline take 52 px more than the puzzle button
    expect(foldsActions(211, true, 3)).toBe(true);
    expect(foldsActions(212, true, 3)).toBe(false);
    // folded at an inline width W, the field grows by those 52 px; at W + 52 it stays folded
    for (const inline of [100, 159]) expect([foldsActions(inline, false, 3), foldsActions(inline + 52, true, 3)]).toEqual([true, true]);
    // one icon is the puzzle button's own width: the rule is the field's minimum alone
    expect(foldsActions(159, true, 1)).toBe(true);
    expect(foldsActions(160, true, 1)).toBe(false);
  });
});
