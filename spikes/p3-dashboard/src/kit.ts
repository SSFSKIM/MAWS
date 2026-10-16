// P3-E2 M1 spike: the one seam the comparison varies. Everything numerical or geometric a view needs (nice domains,
// ticks, bands, path strings, pie angles and marker shapes) comes through a Kit; the layout, text, data semantics and
// SVG writing around it are shared. `kit-d3.ts` answers through exact-pinned d3-scale, d3-shape, d3-array and d3-path
// (all DOM-free, d3-shape's null context returning path strings at `digits(2)`); `kit-house.ts` through small
// arithmetic. Both answer in pixels, coordinates already at 2 decimals.

export type Point = readonly [x: number, y: number | null];
export type Shape = 'circle' | 'square' | 'triangle' | 'diamond' | 'cross' | 'wye';
export const SHAPES: readonly Shape[] = ['circle', 'square', 'triangle', 'diamond', 'cross', 'wye'];

export interface Ticks {
  /** The domain the scale maps (extended when `nice`). */
  domain: [number, number];
  ticks: number[];
  map(value: number): number;
}

export interface Kit {
  name: 'd3' | 'house';
  extent(values: number[]): [number, number] | null;
  /** A linear scale over `domain` onto `range` with about `count` ticks; `nice` extends the domain to round values. */
  linear(domain: [number, number], range: [number, number], count: number, nice: boolean): Ticks;
  /** A UTC time scale over instants (ms), the domain as given; ticks fall on calendar boundaries inside it. */
  time(domain: [number, number], range: [number, number], count: number): Ticks;
  /** Bands for `n` keys across `range` (start of each band, and its width). */
  band(n: number, range: [number, number], paddingInner: number, paddingOuter: number): { starts: number[]; bandwidth: number };
  /** A polyline through the points, broken where y is null; an isolated point is a zero-length closed subpath. */
  line(points: readonly Point[]): string;
  /** The region between the line and `baseline`, broken where y is null. */
  area(points: readonly Point[], baseline: number): string;
  /** Pie angles (radians, 0 at twelve o'clock, clockwise) for non-negative values in input order. */
  pie(values: number[]): { start: number; end: number }[];
  /** A wedge around the origin. */
  arc(start: number, end: number, radius: number): string;
  /** One path holding a marker of `shape` (area `size` px²) at each centre. */
  symbols(shape: Shape, size: number, centres: readonly (readonly [number, number])[]): string;
}
