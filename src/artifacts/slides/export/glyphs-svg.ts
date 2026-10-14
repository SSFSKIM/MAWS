// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D12): the dialect's size-dependent drawings as SVG text,
// for the exporters' standalone page, which draws them from the export window's measured boxes: an x-shape's outline,
// an x-connector's polyline and heads, an x-icon's glyph. The same geometry (glyphs.ts) and the same defaults as the DOM
// canvas's layout pass (canvas/elements.ts `drawShape`, `drawConnector`, `renderIcon`), written as markup rather than
// as DOM nodes; a value here is a literal, every token resolved before the page is written. Portable.
import { connectorHeads, connectorRoute, headPolygon, ICON_GLYPHS, isStrokeOnly, shapePath, splitBorder, type Point } from '../glyphs';
import { escAttr } from '../serialize';

const px = (value: string | null | undefined, fallback: number): number => {
  const n = value === null || value === undefined ? Number.NaN : Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
};
const dashOf = (style: string | null | undefined, w: number): string | null => (style === 'dashed' ? `${3 * w} ${2 * w}` : style === 'dotted' ? `${w} ${1.5 * w}` : null);
const svgOpen = (w: number, h: number) => {
  const [W, H] = [Math.max(0, w), Math.max(0, h)];
  return `<svg data-glyph="" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
};
const decl = (props: Record<string, string>) => escAttr(Object.entries(props).map(([k, v]) => `${k}:${v}`).join(';'));

/** An x-shape's outline in a `w`×`h` box: fill from its flat background, stroke from its border (style literal). */
export function shapeSvg(style: Readonly<Record<string, string>>, kind: string, w: number, h: number): string {
  const border = style.border ? splitBorder(style.border) : null;
  const stroke = border && border.style !== 'none' ? px(border.width ?? '1px', 1) : 0;
  const d = shapePath(kind, w, h, stroke || (isStrokeOnly(kind) ? 2 : 0));
  const fill = style.background && !style.background.includes('gradient') ? style.background : null;
  const paint: Record<string, string> = {};
  if (isStrokeOnly(kind)) {
    Object.assign(paint, { fill: 'none', stroke: border?.color ?? fill ?? 'currentColor', 'stroke-width': `${stroke || 2}px` });
  } else {
    paint.fill = fill ?? '#d9dedb';
    if (stroke > 0) {
      Object.assign(paint, { stroke: border?.color ?? '#000000', 'stroke-width': `${stroke}px` });
      const dash = dashOf(border?.style, stroke);
      if (dash) paint['stroke-dasharray'] = dash;
    }
  }
  return `${svgOpen(w, h)}<path d="${escAttr(d)}" style="${decl(paint)}"></path></svg>`;
}

const coord = (v: string | undefined, size: number): number => (v === undefined ? 0 : v.trim().endsWith('%') ? (Number.parseFloat(v) / 100) * size : Number.parseFloat(v) || 0);

/** An x-connector's points in its own box (a pinned one's box is its host's), as the canvas routes them. */
export function connectorPoints(attrs: Readonly<Record<string, string>>, w: number, h: number, strokeWidth: number): Point[] {
  if (attrs.x1 !== undefined) return connectorRoute(attrs.route, coord(attrs.x1, w), coord(attrs.y1, h), coord(attrs.x2, w), coord(attrs.y2, h));
  const from = attrs.from ?? 'tl';
  const [y0, y1] = h < strokeWidth ? [h / 2, h / 2] : [0, h];
  const ends: Record<string, [Point, Point]> = { tl: [[0, y0], [w, y1]], tr: [[w, y0], [0, y1]], bl: [[0, y1], [w, y0]], br: [[w, y1], [0, y0]] };
  const [a, b] = ends[from] ?? ends.tl!;
  return a[0] === b[0] && a[1] === b[1] ? [a] : [a, b];
}

/** A connector's stroke width in px (its `border-width`, else 2). */
export const connectorWidth = (style: Readonly<Record<string, string>>): number => px(style['border-width'], 2);

/** An x-connector's polyline and heads in a `w`×`h` box, stroked in the element's colour. */
export function connectorSvg(style: Readonly<Record<string, string>>, attrs: Readonly<Record<string, string>>, w: number, h: number): string {
  const sw = connectorWidth(style);
  const points = connectorPoints(attrs, w, h, sw);
  const pts = (list: Point[]) => list.map(([x, y]) => `${x},${y}`).join(' ');
  const line: Record<string, string> = { fill: 'none', stroke: 'currentColor', 'stroke-width': `${sw}px`, 'stroke-linejoin': 'round' };
  const dash = dashOf(style['border-style'], sw);
  if (dash) line['stroke-dasharray'] = dash;
  let out = `${svgOpen(w, h)}<polyline points="${pts(points)}" style="${decl(line)}"></polyline>`;
  if (points.length >= 2) {
    const heads = connectorHeads(attrs);
    const head = (from: Point, tip: Point, kind: 'none' | 'open' | 'filled') => {
      if (kind === 'none') return '';
      const [t, a, b] = headPolygon(from, tip, sw);
      const filled = kind === 'filled';
      const paint = decl({ fill: filled ? 'currentColor' : 'none', stroke: 'currentColor', 'stroke-width': `${filled ? 0 : sw}px`, 'stroke-linejoin': 'round' });
      return filled ? `<polygon points="${pts([t!, a!, b!])}" style="${paint}"></polygon>` : `<polyline points="${pts([a!, t!, b!])}" style="${paint}"></polyline>`;
    };
    out += head(points[points.length - 2]!, points[points.length - 1]!, heads.end);
    out += head(points[1]!, points[0]!, heads.start);
  }
  return `${out}</svg>`;
}

/** An x-icon's line glyph on its 24-unit square, stroked in the element's colour. */
export function iconSvg(name: string | undefined): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${escAttr(ICON_GLYPHS[name ?? ''] ?? '')}"></path></svg>`;
}
