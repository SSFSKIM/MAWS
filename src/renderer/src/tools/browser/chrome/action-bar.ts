// cua #90: the extensions action bar's fold (its spec's "The bar" of the extensions action bar; Decision Log: inline,
// folding into one puzzle button when the address field would drop under 160 px). Pure, so the rule is pinned apart
// from layout.
import { ACTIONS_FOLD_ADDRESS_MIN_PX } from '@shared/browser/extensions';

export const ACTION_BUTTON_PX = 24; // one action's button, and the puzzle button
export const ACTION_GAP_PX = 2; // the navigation row's gap between controls (`gap-0.5`)

// The width the actions take inline.
export const inlineActionsWidth = (count: number): number => (count === 0 ? 0 : count * ACTION_BUTTON_PX + (count - 1) * ACTION_GAP_PX);

// Whether the actions fold into the puzzle button, from the address field's width as laid out now: inline, they fold
// when it is under the minimum; folded, they unfold only when the field would keep the minimum once it gives up the
// room the inline icons take beyond the puzzle button's (so the bar never flips back and forth at one width).
export function foldsActions(addressWidth: number, folded: boolean, count: number): boolean {
  const withInline = folded ? addressWidth - (inlineActionsWidth(count) - ACTION_BUTTON_PX) : addressWidth;
  return withInline < ACTIONS_FOLD_ADDRESS_MIN_PX;
}
