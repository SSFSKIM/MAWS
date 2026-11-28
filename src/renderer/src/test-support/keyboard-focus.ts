// Focus as the keyboard moves it: a tip opens on keyboard focus alone (ui/tip.tsx, board ticket 815), so a case that
// focuses an owner in code to stand for Tab or an arrow says the keyboard was the last input first. A Shift press binds
// nothing.
import { act, fireEvent } from '@testing-library/react';

export function keyboardFocus(element: HTMLElement): void {
  fireEvent.keyDown(element.ownerDocument.body, { key: 'Shift', code: 'ShiftLeft' });
  act(() => element.focus());
}
