// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Canvas"): the fit pass. A sized text box (a text
// element with a `height`) fits its text by `data-fit`: `shrink` (the default) scales its font down until the text fits,
// to 60 % of its size or 8 px, then clips; `grow` lets the box grow past its height; `none` leaves the text to overflow.
// Display only: the model and the file keep the element's own size; the scale is undone before every measure.
import { TEXT_TAGS, type Tag } from '../ir';

const MIN_SCALE = 0.6;
const MIN_PX = 8;
const STEPS = 7; // the binary search's halvings: within 1 % of the fitting size

/** Whether an element takes the fit pass: a text element with a height of its own. */
export const isSizedText = (tag: Tag, style: Readonly<Record<string, string>>): boolean => TEXT_TAGS.has(tag) && style.height !== undefined && style.height !== 'auto';

const overflows = (n: HTMLElement) => n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1;

/** Fits one sized text element (forces layout). Returns the scale applied (1 when its text fits as it is). */
export function fitText(n: HTMLElement, style: Readonly<Record<string, string>>, mode: string | undefined): number {
  // back to the model's own size and box before measuring
  if (n.dataset.fit) {
    if (style['font-size'] === undefined) n.style.removeProperty('font-size');
    else n.style.setProperty('font-size', style['font-size']);
    n.style.setProperty('height', style.height ?? '');
    n.style.removeProperty('min-height');
    if (style.overflow === undefined) n.style.removeProperty('overflow');
    else n.style.setProperty('overflow', style.overflow);
    delete n.dataset.fit;
  }
  if (mode === 'none') return 1;
  if (mode === 'grow') {
    n.style.setProperty('min-height', style.height!);
    n.style.setProperty('height', 'auto');
    n.dataset.fit = 'grow';
    return 1;
  }
  if (!overflows(n)) return 1;
  const view = n.ownerDocument.defaultView;
  const base = Number.parseFloat(view?.getComputedStyle(n).fontSize ?? '') || 0;
  if (base <= 0) return 1;
  const floor = Math.min(1, Math.max(MIN_SCALE, MIN_PX / base));
  let lo = floor;
  let hi = 1;
  for (let k = 0; k < STEPS; k++) {
    const mid = (lo + hi) / 2;
    n.style.setProperty('font-size', `${base * mid}px`);
    if (overflows(n)) hi = mid;
    else lo = mid;
  }
  n.style.setProperty('font-size', `${base * lo}px`);
  n.dataset.fit = 'shrink';
  if (overflows(n)) n.style.setProperty('overflow', 'hidden'); // at the floor and still over: clipped
  return lo;
}
