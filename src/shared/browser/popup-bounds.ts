// An extension popup's box in the window (cua board #90's spec, "The popup view"), in window points: its preferred size
// within Chrome's bounds and the window's content, under the anchor with its right edge on the anchor's (the action
// buttons sit at the row's right), moved into the window, above the anchor when it would not fit below, and when it fits
// neither, as low as the window allows. Main places the popup by it (src/main/browser/extensions/popup.ts), with the
// anchor in window points; UX wave U6b-5b moved it here from there (its Decision Log 12), so the e2e predicts a popup's
// place by the same clamp rather than a mirror of it.
import { EXTENSION_POPUP_MAX, EXTENSION_POPUP_MIN } from './extensions';

export type PopupRect = { x: number; y: number; width: number; height: number };

export function popupBounds(anchor: PopupRect, preferred: { width: number; height: number }, content: { width: number; height: number }): PopupRect {
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const width = Math.min(clamp(Math.round(preferred.width), EXTENSION_POPUP_MIN.width, EXTENSION_POPUP_MAX.width), content.width);
  const height = Math.min(clamp(Math.round(preferred.height), EXTENSION_POPUP_MIN.height, EXTENSION_POPUP_MAX.height), content.height);
  const x = clamp(anchor.x + anchor.width - width, 0, content.width - width);
  const below = anchor.y + anchor.height;
  const y = below + height <= content.height ? below : anchor.y - height >= 0 ? anchor.y - height : Math.max(0, content.height - height);
  return { x, y, width, height };
}
