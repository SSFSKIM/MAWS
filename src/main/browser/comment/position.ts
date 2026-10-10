// P2-E2: the comment card's pin, `browser.comment.picked`'s `position` (P2 spec §4.7, X21; P2 interface ledger §1). The
// preload reports the picked element's rect in the page's CSS px of its viewport; the view's box in the window is the
// pane's page element (DOM-measured, E4a), so a CSS px of the viewport times the page's zoom is a pane pixel from that
// box's top-left. The point is the centre of the element's span across the viewport and its bottom edge, each clamped
// to the viewport (an element wider than the page, or running off its bottom, still pins where it shows), whole pixels.
import type { PickRect } from '@shared/browser/comment-protocol';
import type { PickPosition } from '@shared/ipc/schema/browser';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function pickPosition(rect: PickRect, viewport: { width: number; height: number }, zoom: number): PickPosition | undefined {
  if (![rect.x, rect.y, rect.width, rect.height, viewport.width, viewport.height, zoom].every(Number.isFinite) || zoom <= 0) return undefined;
  const left = clamp(rect.x, 0, viewport.width);
  const right = clamp(rect.x + rect.width, 0, viewport.width);
  const bottom = clamp(rect.y + rect.height, 0, viewport.height);
  return { x: Math.round(((left + right) / 2) * zoom), y: Math.round(bottom * zoom) };
}
