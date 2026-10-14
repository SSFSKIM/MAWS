// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Canvas"; M4): the geometry of the dialect's own
// elements, as plain numbers and path strings the DOM canvas (canvas/) draws and the exporters can reuse. Portable and
// DOM-free.
//
// - x-shape: each kind fills its box (Claude, format.md: "an arrow is a block glyph whose head is the last 40% of its
//   length"); a stroke is drawn inside the box, half its width in from each edge, so a stroked shape keeps its box.
// - x-icon: MAWS's own drawings of the thirty names, line glyphs on a 24-unit square, stroked in the element's colour.
// - x-connector: Claude's routes (`hv` across then down, `vh` down then across, `elbow` three legs bending at the
//   midpoint of the longer run) and constant-size heads, about four stroke widths (diagrams.md).

import { borderParts } from './css';

export type Point = [number, number];

const n = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r);
};

/** The outline of an x-shape of `kind` in a `w`×`h` box, inset by half the stroke width `stroke`. */
export function shapePath(kind: string, w: number, h: number, stroke: number): string {
  const i = Math.max(0, Math.min(stroke / 2, w / 2, h / 2));
  const [x0, y0, x1, y1] = [i, i, w - i, h - i];
  const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const [bw, bh] = [x1 - x0, y1 - y0];
  const path = (pts: Point[]) => `M ${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join(' L ')} Z`;
  switch (kind) {
    case 'ellipse': {
      const [rx, ry] = [bw / 2, bh / 2];
      return `M ${n(x0)} ${n(cy)} A ${n(rx)} ${n(ry)} 0 1 0 ${n(x1)} ${n(cy)} A ${n(rx)} ${n(ry)} 0 1 0 ${n(x0)} ${n(cy)} Z`;
    }
    case 'rounded': {
      const r = Math.min(bw, bh) * 0.2;
      return (
        `M ${n(x0 + r)} ${n(y0)} L ${n(x1 - r)} ${n(y0)} A ${n(r)} ${n(r)} 0 0 1 ${n(x1)} ${n(y0 + r)} L ${n(x1)} ${n(y1 - r)} ` +
        `A ${n(r)} ${n(r)} 0 0 1 ${n(x1 - r)} ${n(y1)} L ${n(x0 + r)} ${n(y1)} A ${n(r)} ${n(r)} 0 0 1 ${n(x0)} ${n(y1 - r)} ` +
        `L ${n(x0)} ${n(y0 + r)} A ${n(r)} ${n(r)} 0 0 1 ${n(x0 + r)} ${n(y0)} Z`
      );
    }
    case 'diamond':
      return path([[cx, y0], [x1, cy], [cx, y1], [x0, cy]]);
    case 'arrow-right': {
      const hx = x0 + bw * 0.6;
      const [s0, s1] = [y0 + bh * 0.3, y0 + bh * 0.7];
      return path([[x0, s0], [hx, s0], [hx, y0], [x1, cy], [hx, y1], [hx, s1], [x0, s1]]);
    }
    case 'arrow-left': {
      const hx = x1 - bw * 0.6;
      const [s0, s1] = [y0 + bh * 0.3, y0 + bh * 0.7];
      return path([[x1, s0], [hx, s0], [hx, y0], [x0, cy], [hx, y1], [hx, s1], [x1, s1]]);
    }
    case 'arrow-down': {
      const hy = y0 + bh * 0.6;
      const [s0, s1] = [x0 + bw * 0.3, x0 + bw * 0.7];
      return path([[s0, y0], [s0, hy], [x0, hy], [cx, y1], [x1, hy], [s1, hy], [s1, y0]]);
    }
    case 'arrow-up': {
      const hy = y1 - bh * 0.6;
      const [s0, s1] = [x0 + bw * 0.3, x0 + bw * 0.7];
      return path([[s0, y1], [s0, hy], [x0, hy], [cx, y0], [x1, hy], [s1, hy], [s1, y1]]);
    }
    case 'line':
      return `M ${n(x0)} ${n(cy)} L ${n(x1)} ${n(cy)}`;
    default: // rect
      return path([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
  }
}

/** Whether a shape kind is an outline only (no fill). */
export const isStrokeOnly = (kind: string): boolean => kind === 'line';

const CIRCLE = 'M 3 12 A 9 9 0 1 0 21 12 A 9 9 0 1 0 3 12 Z';

/** The x-icon glyphs: one path each on a 24×24 square, stroked (round caps and joins), never filled. */
export const ICON_GLYPHS: Readonly<Record<string, string>> = {
  Activity: 'M 3 12 L 7 12 L 10 4 L 14 20 L 17 12 L 21 12',
  Book: 'M 4 4 L 10 4 Q 12 4 12 6 L 12 20 Q 12 18 10 18 L 4 18 Z M 20 4 L 14 4 Q 12 4 12 6 L 12 20 Q 12 18 14 18 L 20 18 Z',
  Chart: 'M 4 20 L 20 20 M 7 16 L 7 11 M 12 16 L 12 6 M 17 16 L 17 9',
  Chat: 'M 4 5 L 20 5 L 20 16 L 10 16 L 6 20 L 6 16 L 4 16 Z',
  Check: 'M 5 12 L 10 17 L 19 7',
  CheckCircle: `${CIRCLE} M 8 12 L 11 15 L 16 9`,
  Clock: `${CIRCLE} M 12 7 L 12 12 L 15 14`,
  Cloud: 'M 7 18 L 17 18 A 4 4 0 0 0 17.5 10 A 6 6 0 0 0 6.2 11 A 3.5 3.5 0 0 0 7 18 Z',
  Code: 'M 8 7 L 3 12 L 8 17 M 16 7 L 21 12 L 16 17 M 14 5 L 10 19',
  Database: 'M 4 6 A 8 3 0 1 0 20 6 A 8 3 0 1 0 4 6 Z M 4 6 L 4 18 A 8 3 0 0 0 20 18 L 20 6 M 4 12 A 8 3 0 0 0 20 12',
  Globe: `${CIRCLE} M 3 12 L 21 12 M 12 3 Q 17 12 12 21 Q 7 12 12 3 Z`,
  GraduationCap: 'M 2 9 L 12 4 L 22 9 L 12 14 Z M 6 11 L 6 16 Q 12 20 18 16 L 18 11 M 22 9 L 22 15',
  Home: 'M 3 11 L 12 3 L 21 11 M 5 9 L 5 21 L 10 21 L 10 15 L 14 15 L 14 21 L 19 21 L 19 9',
  Key: 'M 4 11 A 4 4 0 1 0 12 11 A 4 4 0 1 0 4 11 Z M 12 11 L 21 11 L 21 14 M 17 11 L 17 14',
  Lightbulb: 'M 9 18 L 15 18 M 10 21 L 14 21 M 9 15 Q 5 12 6 8 A 6 6 0 0 1 18 8 Q 19 12 15 15 Z',
  Lightning: 'M 13 2 L 4 14 L 11 14 L 10 22 L 20 9 L 13 9 Z',
  Link: 'M 10 14 L 14 10 M 9 7 L 11 5 A 4 4 0 0 1 19 13 L 17 15 M 15 17 L 13 19 A 4 4 0 0 1 5 11 L 7 9',
  Lock: 'M 5 11 L 19 11 L 19 21 L 5 21 Z M 8 11 L 8 7 A 4 4 0 0 1 16 7 L 16 11',
  PaperPlane: 'M 21 3 L 3 10 L 10 13 L 13 21 Z M 21 3 L 10 13',
  Play: 'M 7 4 L 19 12 L 7 20 Z',
  Search: 'M 4 10 A 6 6 0 1 0 16 10 A 6 6 0 1 0 4 10 Z M 15 15 L 20 20',
  Settings:
    'M 9 12 A 3 3 0 1 0 15 12 A 3 3 0 1 0 9 12 Z M 12 2 L 12 5 M 12 19 L 12 22 M 2 12 L 5 12 M 19 12 L 22 12 M 4.9 4.9 L 7 7 M 17 17 L 19.1 19.1 M 4.9 19.1 L 7 17 M 17 7 L 19.1 4.9',
  Star: 'M 12 3 L 14.6 8.6 L 20.6 9.2 L 16 13.3 L 17.3 19.3 L 12 16.2 L 6.7 19.3 L 8 13.3 L 3.4 9.2 L 9.4 8.6 Z',
  ThumbsUp: 'M 7 10 L 7 21 L 3 21 L 3 10 Z M 7 10 L 11 3 Q 14 3 13 7 L 13 9 L 19 9 Q 21 9 20.5 11 L 19 19 Q 18.5 21 16.5 21 L 7 21',
  Tool: 'M 14 6 A 4 4 0 0 1 19 4 L 16 7 L 17 9 L 19 9.5 L 21 6 A 4 4 0 0 1 17 11 L 8 20 A 2 2 0 0 1 5 17 L 14 8 Z',
  Trust: 'M 12 3 L 20 6 L 20 12 Q 20 18 12 21 Q 4 18 4 12 L 4 6 Z M 9 12 L 11 14 L 15 10',
  Users: 'M 6 8 A 3 3 0 1 0 12 8 A 3 3 0 1 0 6 8 Z M 3 20 Q 3 14 9 14 Q 15 14 15 20 M 15 5 A 3 3 0 0 1 15 11 M 17 14 Q 21 15 21 20',
  Verified:
    'M 12 2 L 15 4.5 L 19 4.5 L 19.5 8.5 L 22 12 L 19.5 15.5 L 19 19.5 L 15 19.5 L 12 22 L 9 19.5 L 5 19.5 L 4.5 15.5 L 2 12 L 4.5 8.5 L 5 4.5 L 9 4.5 Z M 8 12 L 11 15 L 16 9',
  Warning: 'M 12 3 L 22 20 L 2 20 Z M 12 9 L 12 14 M 12 17 L 12 17.5',
  Wrench: 'M 15 3 A 5 5 0 0 0 10.5 9.5 L 3 17 L 7 21 L 14.5 13.5 A 5 5 0 0 0 21 9 L 18 12 L 15 11 L 14 8 L 17 5 Z',
};

/**
 * A connector's polyline from (x1, y1) to (x2, y2) along its route, with no repeated point: an `hv` or `vh` route between
 * aligned points, or an elbow between them, has a zero-length leg, which would give a head no direction.
 */
export function connectorRoute(route: string | undefined, x1: number, y1: number, x2: number, y2: number): Point[] {
  const points = routePoints(route, x1, y1, x2, y2);
  return points.filter((p, i) => i === 0 || p[0] !== points[i - 1]![0] || p[1] !== points[i - 1]![1]);
}
function routePoints(route: string | undefined, x1: number, y1: number, x2: number, y2: number): Point[] {
  switch (route) {
    case 'hv':
      return [[x1, y1], [x2, y1], [x2, y2]];
    case 'vh':
      return [[x1, y1], [x1, y2], [x2, y2]];
    case 'elbow': {
      if (Math.abs(x2 - x1) >= Math.abs(y2 - y1)) {
        const mx = (x1 + x2) / 2;
        return [[x1, y1], [mx, y1], [mx, y2], [x2, y2]];
      }
      const my = (y1 + y2) / 2;
      return [[x1, y1], [x1, my], [x2, my], [x2, y2]];
    }
    default:
      return [[x1, y1], [x2, y2]];
  }
}

/** A head at `tip` coming from `from`: the tip, then the two corners of its base, four stroke widths back. */
export function headPolygon(from: Point, tip: Point, strokeWidth: number): Point[] {
  const [dx, dy] = [tip[0] - from[0], tip[1] - from[1]];
  const len = Math.hypot(dx, dy) || 1;
  const [ux, uy] = [dx / len, dy / len];
  const back = 4 * strokeWidth;
  const half = 2 * strokeWidth;
  const [bx, by] = [tip[0] - ux * back, tip[1] - uy * back];
  return [tip, [bx - uy * half, by + ux * half], [bx + uy * half, by - ux * half]];
}

/** Which heads a connector draws, from `head` and the per-end overrides. */
export function connectorHeads(attrs: Readonly<Record<string, string>>): { start: 'none' | 'open' | 'filled'; end: 'none' | 'open' | 'filled' } {
  const head = attrs.head ?? 'end';
  const pick = (own: string | undefined, on: boolean) => (own === 'none' || own === 'open' || own === 'filled' ? own : on ? 'filled' : 'none');
  return { start: pick(attrs['head-start'], head === 'both'), end: pick(attrs['head-end'], head === 'end' || head === 'both') };
}

/**
 * A `border` value's width, style and colour, each null when it does not say (the style when the value is not a border).
 * Tokens take their slots as the loader places them (css.ts `borderParts`): by their fallback, else by position.
 */
export function splitBorder(value: string): { width: string | null; style: string | null; color: string | null } {
  return borderParts(value) ?? { width: null, style: null, color: null };
}
