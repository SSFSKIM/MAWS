// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Canvas"): the fit pass. A sized text box (a text
// element with a `height`) fits its text by `data-fit`: `shrink` (the default) scales its font down until the text fits,
// to 60 % of its size or 8 px, then clips; `grow` lets the box grow past its height; `none` leaves the text to overflow.
// Display only: the model and the file keep the element's own size; the scale is undone before every measure.
import { TEXT_TAGS, type Tag } from '../ir';
import { shrinkScale } from '../render-rules'; // the search, shared with the export window (M9 fix wave 1)

/** Whether an element takes the fit pass: a text element with a height of its own. */
export const isSizedText = (tag: Tag, style: Readonly<Record<string, string>>): boolean => TEXT_TAGS.has(tag) && style.height !== undefined && style.height !== 'auto';

const overflows = (n: HTMLElement) => n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1;

const restore = (n: HTMLElement, prop: string, value: string | undefined) => (value === undefined ? n.style.removeProperty(prop) : n.style.setProperty(prop, value));

/**
 * Undoes what a fit wrote (marked `data-fitted`, never the dialect's own `data-fit`): the element's font size, height,
 * min-height and overflow back to the model's. For an element that stopped being a sized text box, and before every fit.
 */
export function clearFit(n: HTMLElement, style: Readonly<Record<string, string>>): void {
  if (!n.dataset.fitted) return;
  restore(n, 'font-size', style['font-size']);
  restore(n, 'height', style.height);
  restore(n, 'min-height', style['min-height']);
  restore(n, 'overflow', style.overflow);
  delete n.dataset.fitted;
}

/** Fits one sized text element (forces layout). Returns the scale applied (1 when its text fits as it is). */
export function fitText(n: HTMLElement, style: Readonly<Record<string, string>>, mode: string | undefined): number {
  clearFit(n, style); // back to the model's own size and box before measuring
  if (mode === 'none') return 1;
  if (mode === 'grow') {
    n.style.setProperty('min-height', style.height!);
    n.style.setProperty('height', 'auto');
    n.dataset.fitted = 'grow';
    return 1;
  }
  if (!overflows(n)) return 1;
  const view = n.ownerDocument.defaultView;
  const base = Number.parseFloat(view?.getComputedStyle(n).fontSize ?? '') || 0;
  if (base <= 0) return 1;
  const lo = shrinkScale(base, (px) => {
    n.style.setProperty('font-size', `${px}px`);
    return overflows(n);
  });
  n.style.setProperty('font-size', `${base * lo}px`);
  n.dataset.fitted = 'shrink';
  if (overflows(n)) n.style.setProperty('overflow', 'hidden'); // at the floor and still over: clipped
  return lo;
}
