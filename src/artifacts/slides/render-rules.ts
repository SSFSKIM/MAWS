// P3-C M9 fix wave 1 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Canvas", D12; finding 7): the
// drawing rules the DOM canvas (canvas/) and the exporters' page (export/) share, written once so the two cannot drift.
// - An x-embed's page: sandboxed with inline script and style only, no network (Claude's "no network"; Decision Log 18).
// - The owner's crop, `data-crop="ZOOM X% Y%"`: the picture's view box, 1/ZOOM of it on each axis with the focus point
//   placed as object-position places it, and that focus as the object-position too (M5 fix wave 1), the element's own
//   object-fit then filling its box with the region.
// - The fit's search for a sized text box set to shrink: the largest scale, down to 60 % or 8 px, at which the text no
//   longer overflows, to within 1 %. Self-contained: the export window receives it as its source text (measure.ts).
// Portable and DOM-free.
import { escAttr } from './serialize';

/** An x-embed's sandbox policy: its own inline script and style, `data:` pictures and faces, nothing from anywhere. */
export const EMBED_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:";

/** An x-embed's markup as the page its sandboxed frame shows (`srcdoc`). */
export const embedDocument = (raw: string): string => `<!doctype html><meta http-equiv="Content-Security-Policy" content="${escAttr(EMBED_CSP)}"><style>html,body{margin:0;height:100%;overflow:hidden}</style>${raw}`;

const CROP = /^(\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)% (-?\d+(?:\.\d+)?)%$/;

/** A crop's drawing: the picture's view box and its object-position; null without a crop. */
export function cropStyle(crop: string | undefined): { 'object-view-box': string; 'object-position': string } | null {
  const m = crop === undefined ? null : CROP.exec(crop);
  if (!m) return null;
  const rest = 1 - 1 / Math.max(1, Number(m[1]));
  const [fx, fy] = [Number(m[2]), Number(m[3])];
  const pct = (v: number) => `${Math.round(v * 1000) / 1000}%`;
  return { 'object-view-box': `inset(${pct(rest * fy)} ${pct(rest * (100 - fx))} ${pct(rest * (100 - fy))} ${pct(rest * fx)})`, 'object-position': `${pct(fx)} ${pct(fy)}` };
}

/**
 * The fit's scale for text of `base` px that overflows its box: a binary search of seven halvings between the floor (60 %
 * of the size, or 8 px if that is more) and 1, `overflowsAt(px)` setting the size and telling whether the text still
 * overflows. Self-contained (it names nothing outside its body), so its source runs alone in the export window.
 */
export function shrinkScale(base: number, overflowsAt: (px: number) => boolean): number {
  let lo = Math.min(1, Math.max(0.6, 8 / base));
  let hi = 1;
  for (let k = 0; k < 7; k++) {
    const mid = (lo + hi) / 2;
    if (overflowsAt(base * mid)) hi = mid;
    else lo = mid;
  }
  return lo;
}
