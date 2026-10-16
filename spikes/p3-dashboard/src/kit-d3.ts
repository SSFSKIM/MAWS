// P3-E2 M1 spike, candidate A: the Kit through d3's DOM-free modules, exact-pinned (d3-array 3.2.4, d3-scale 4.0.2,
// d3-shape 3.2.0, d3-path 3.1.0). Scales come from d3-scale (`nice`, `ticks`), shapes from d3-shape with a null
// context, which returns the path string, at `digits(2)` (https://d3js.org/d3-shape/line).
// Note: d3's own types name a DOM `CanvasPath` for a context; nothing here touches a DOM at run time.
import { extent } from 'd3-array';
import { pathRound } from 'd3-path';
import { scaleBand, scaleLinear, scaleUtc } from 'd3-scale';
import { arc, area, line, pie, symbol, symbolCircle, symbolCross, symbolDiamond, symbolSquare, symbolTriangle, symbolWye, type SymbolType } from 'd3-shape';
import type { Kit, Point, Shape } from './kit';

const TYPES: Record<Shape, SymbolType> = { circle: symbolCircle, square: symbolSquare, triangle: symbolTriangle, diamond: symbolDiamond, cross: symbolCross, wye: symbolWye };
const defined = (p: Point) => p[1] !== null;
const lineGen = line<Point>((p) => p[0], (p) => p[1]!).defined(defined).digits(2);
const pieGen = pie<number>().sort(null).value((v) => v);
const arcGen = arc<{ start: number; end: number; radius: number }>()
  .innerRadius(0)
  .outerRadius((d) => d.radius)
  .startAngle((d) => d.start)
  .endAngle((d) => d.end)
  .digits(2);

export const d3Kit: Kit = {
  name: 'd3',
  extent(values) {
    const [lo, hi] = extent(values);
    return lo === undefined || hi === undefined ? null : [lo, hi];
  },
  linear(domain, range, count, nice) {
    const scale = scaleLinear().domain(domain).range(range);
    if (nice) scale.nice(count);
    const [lo, hi] = scale.domain();
    return { domain: [lo, hi], ticks: scale.ticks(count), map: (v) => scale(v) };
  },
  time(domain, range, count) {
    const scale = scaleUtc().domain(domain).range(range);
    return { domain, ticks: scale.ticks(count).map((d) => d.getTime()), map: (v) => scale(v) };
  },
  band(n, range, paddingInner, paddingOuter) {
    const keys = Array.from({ length: n }, (_, i) => i);
    const scale = scaleBand<number>().domain(keys).range(range).paddingInner(paddingInner).paddingOuter(paddingOuter);
    return { starts: keys.map((k) => scale(k)!), bandwidth: scale.bandwidth() };
  },
  line: (points) => lineGen(points) ?? '',
  area: (points, baseline) => area<Point>((p) => p[0], baseline, (p) => p[1]!).defined(defined).digits(2)(points) ?? '',
  pie: (values) => pieGen(values).map((slice) => ({ start: slice.startAngle, end: slice.endAngle })),
  arc: (start, end, radius) => arcGen({ start, end, radius }) ?? '',
  symbols(shape, size, centres) {
    const out = pathRound(2);
    const type = TYPES[shape];
    for (const [cx, cy] of centres) {
      // d3-shape draws a symbol at the origin into any CanvasPath; this one moves it to the centre.
      const moved = {
        moveTo: (x: number, y: number) => out.moveTo(x + cx, y + cy),
        lineTo: (x: number, y: number) => out.lineTo(x + cx, y + cy),
        arc: (x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean) => out.arc(x + cx, y + cy, r, a0, a1, ccw),
        rect: (x: number, y: number, w: number, h: number) => out.rect(x + cx, y + cy, w, h),
        closePath: () => out.closePath(),
      };
      symbol(type, size).context(moved as unknown as CanvasRenderingContext2D)();
    }
    return out.toString();
  },
};
