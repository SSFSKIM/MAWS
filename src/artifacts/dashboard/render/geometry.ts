// Everything numerical or geometric a view needs (P3-E2 M3; the renderer M1 chose, parent Decision Log 14): nice
// domains, ticks, bands, path strings, pie angles and markers, through exact-pinned d3-array 3.2.4, d3-scale 4.0.2,
// d3-shape 3.2.0 and d3-path 3.1.0, all DOM-free: d3-shape's generators with a null context return the path string at
// `digits(2)` (https://d3js.org/d3-shape/line). Answers are in pixels. The layout around them is render.ts's.
// Note: d3's own types name a DOM `CanvasPath` for a context; nothing here touches a DOM at run time.
import { extent as d3Extent } from 'd3-array';
import { pathRound } from 'd3-path';
import { scaleBand, scaleLinear, scaleUtc } from 'd3-scale';
import { arc as d3Arc, area as d3Area, line as d3Line, pie as d3Pie, symbol, symbolCircle, symbolCross, symbolDiamond, symbolSquare, symbolTriangle, symbolWye, type SymbolType } from 'd3-shape';

export type Point = readonly [x: number, y: number | null];
export type Shape = 'circle' | 'square' | 'triangle' | 'diamond' | 'cross' | 'wye';
export const SHAPES: readonly Shape[] = ['circle', 'square', 'triangle', 'diamond', 'cross', 'wye'];

export interface Ticks {
  /** The domain the scale maps (extended when `nice`). */
  domain: [number, number];
  ticks: number[];
  map(value: number): number;
}

const TYPES: Record<Shape, SymbolType> = { circle: symbolCircle, square: symbolSquare, triangle: symbolTriangle, diamond: symbolDiamond, cross: symbolCross, wye: symbolWye };
const defined = (p: Point) => p[1] !== null;
const lineGen = d3Line<Point>((p) => p[0], (p) => p[1]!).defined(defined).digits(2);
const pieGen = d3Pie<number>().sort(null).value((v) => v);
const arcGen = d3Arc<{ start: number; end: number; radius: number }>()
  .innerRadius(0)
  .outerRadius((d) => d.radius)
  .startAngle((d) => d.start)
  .endAngle((d) => d.end)
  .digits(2);

export function extent(values: number[]): [number, number] | null {
  const [lo, hi] = d3Extent(values);
  return lo === undefined || hi === undefined ? null : [lo, hi];
}

/** The least extent a linear domain may span (E2 panel): below it (a subnormal span) d3's tick step is past what a
 * number can hold, and its tick list an invalid array length. */
export const MIN_EXTENT = 1e-300;
const spans = ([lo, hi]: readonly number[]): boolean => Number.isFinite(hi - lo) && hi - lo >= MIN_EXTENT;

/**
 * A linear scale over `domain` onto `range` with about `count` ticks; `nice` extends the domain to round values. Null
 * for a domain no scale can draw: its extent, as given or once made nice, not a finite number of at least
 * `MIN_EXTENT`, decided before d3 is asked for a tick. Depends on the domain alone, never the range.
 */
export function linear(domain: [number, number], range: [number, number], count: number, nice: boolean): Ticks | null {
  if (!spans(domain)) return null;
  const scale = scaleLinear().domain(domain).range(range);
  if (nice) scale.nice(count);
  const [lo, hi] = scale.domain();
  if (!spans([lo, hi])) return null;
  return { domain: [lo, hi], ticks: scale.ticks(count), map: (v) => scale(v) };
}

/** A UTC time scale over instants (ms), the domain as given; ticks fall on calendar boundaries inside it. */
export function time(domain: [number, number], range: [number, number], count: number): Ticks {
  const scale = scaleUtc().domain(domain).range(range);
  return { domain, ticks: scale.ticks(count).map((d) => d.getTime()), map: (v) => scale(v) };
}

/** Bands for `n` keys across `range` (the start of each band, and its width). */
export function band(n: number, range: [number, number], paddingInner: number, paddingOuter: number): { starts: number[]; bandwidth: number } {
  const keys = Array.from({ length: n }, (_, i) => i);
  const scale = scaleBand<number>().domain(keys).range(range).paddingInner(paddingInner).paddingOuter(paddingOuter);
  return { starts: keys.map((k) => scale(k)!), bandwidth: scale.bandwidth() };
}

/** A polyline through the points, broken where y is null. */
export const line = (points: readonly Point[]): string => lineGen(points) ?? '';

/** The region between the line and `baseline`, broken where y is null. */
export const area = (points: readonly Point[], baseline: number): string => d3Area<Point>((p) => p[0], baseline, (p) => p[1]!).defined(defined).digits(2)(points) ?? '';

/** Pie angles (radians, 0 at twelve o'clock, clockwise) for non-negative values in input order. */
export const pie = (values: number[]): { start: number; end: number }[] => pieGen(values).map((slice) => ({ start: slice.startAngle, end: slice.endAngle }));

/** A wedge around the origin. */
export const arc = (start: number, end: number, radius: number): string => arcGen({ start, end, radius }) ?? '';

/** One path holding a marker of `shape` (area `size` px²) at each centre. */
export function symbols(shape: Shape, size: number, centres: readonly (readonly [number, number])[]): string {
  const out = pathRound(2);
  const type = TYPES[shape];
  for (const [cx, cy] of centres) {
    // d3-shape draws a symbol at the origin into any CanvasPath; this one moves it to the centre
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
}
