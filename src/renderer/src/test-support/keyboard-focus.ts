// Focus as the keyboard moves it: a tip opens on keyboard focus alone (ui/tip.tsx, board ticket 815: the focused element
// matches :focus-visible, which happy-dom matches on any focus), so a case that focuses an owner in code to stand for Tab
// or an arrow names it so here; the focus itself is all it does.
import { act } from '@testing-library/react';

export function keyboardFocus(element: HTMLElement): void {
  act(() => element.focus());
}
