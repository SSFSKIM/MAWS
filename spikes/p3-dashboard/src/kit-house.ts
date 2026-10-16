// P3-E2 M1 spike, candidate B: the Kit in in-house arithmetic, no dependency. A first naive version (1-2-5 steps,
// two `nice` passes, an approximate interval table) disagreed with d3 on 5 of 2,000 linear domains through float drift
// and on a quarter of the time spans; this one carries the same float-safe tick specification (an integer index over an
// inverse increment below 1) and the same calendar intervals, which is what parity costs.
import { px } from './svg';
import type { Kit, Point, Shape, Ticks } from './kit';

const linearMap = ([d0, d1]: [number, number], [r0, r1]: [number, number]) => (v: number) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));

/** The tick specification over [start, stop]: integer indexes and an increment, negative for an inverse below 1. */
function tickSpec(start: number, stop: number, count: number): [number, number, number] {
  const raw = (stop - start) / Math.max(0, count);
  const power = Math.floor(Math.log10(raw));
  const error = raw / 10 ** power;
  const factor = error >= Math.sqrt(50) ? 10 : error >= Math.sqrt(10) ? 5 : error >= Math.sqrt(2) ? 2 : 1;
  let i1: number, i2: number, inc: number;
  if (power < 0) {
    inc = 10 ** -power / factor;
    i1 = Math.round(start * inc);
    i2 = Math.round(stop * inc);
    if (i1 / inc < start) i1 += 1;
    if (i2 / inc > stop) i2 -= 1;
    inc = -inc;
  } else {
    inc = 10 ** power * factor;
    i1 = Math.round(start / inc);
    i2 = Math.round(stop / inc);
    if (i1 * inc < start) i1 += 1;
    if (i2 * inc > stop) i2 -= 1;
  }
  if (i2 < i1 && count >= 0.5 && count < 2) return tickSpec(start, stop, count * 2);
  return [i1, i2, inc];
}
const increment = (start: number, stop: number, count: number) => tickSpec(start, stop, count)[2];
const stepOf = (start: number, stop: number, count: number) => {
  const inc = increment(start, stop, count);
  return inc < 0 ? 1 / -inc : inc;
};

function linear(domain: [number, number], range: [number, number], count: number, nice: boolean): Ticks {
  let [lo, hi] = domain[0] <= domain[1] ? domain : [domain[1], domain[0]];
  if (lo === hi || !Number.isFinite(hi - lo)) return { domain: [lo, hi], ticks: [lo], map: linearMap([lo, hi], range) };
  // Nice: snap outward to the increment until it stops changing.
  for (let i = 0, previous = NaN; nice && i < 10; i += 1) {
    const inc = increment(lo, hi, count);
    if (inc === previous) break;
    if (inc > 0) (lo = Math.floor(lo / inc) * inc), (hi = Math.ceil(hi / inc) * inc);
    else if (inc < 0) (lo = Math.ceil(lo * inc) / inc), (hi = Math.floor(hi * inc) / inc);
    else break;
    previous = inc;
  }
  const [i1, i2, inc] = tickSpec(lo, hi, count);
  const ticks: number[] = [];
  for (let i = i1; i <= i2; i += 1) ticks.push(inc < 0 ? i / -inc : i * inc);
  return { domain: [lo, hi], ticks, map: linearMap([lo, hi], range) };
}

// ---- time: UTC calendar intervals, each `every(n)` keeping the instants whose field is a multiple of n ----

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;
type Unit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';
const INTERVALS: [Unit, number, number][] = [
  ['second', 1, SECOND], ['second', 5, 5 * SECOND], ['second', 15, 15 * SECOND], ['second', 30, 30 * SECOND],
  ['minute', 1, MINUTE], ['minute', 5, 5 * MINUTE], ['minute', 15, 15 * MINUTE], ['minute', 30, 30 * MINUTE],
  ['hour', 1, HOUR], ['hour', 3, 3 * HOUR], ['hour', 6, 6 * HOUR], ['hour', 12, 12 * HOUR],
  ['day', 1, DAY], ['day', 2, 2 * DAY], ['week', 1, WEEK], ['month', 1, MONTH], ['month', 3, 3 * MONTH], ['year', 1, YEAR],
];

const FIXED: Record<'second' | 'minute' | 'hour' | 'day' | 'week', number> = { second: SECOND, minute: MINUTE, hour: HOUR, day: DAY, week: WEEK };

/** The first instant of `unit` at or after `ms`. */
function ceilTo(ms: number, unit: Unit): number {
  const d = new Date(ms);
  let floor: number;
  if (unit === 'year') floor = Date.UTC(d.getUTCFullYear(), 0, 1);
  else if (unit === 'month') floor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  else if (unit === 'week') floor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay());
  else floor = Math.floor(ms / FIXED[unit]) * FIXED[unit];
  return floor < ms ? next(floor, unit) : floor;
}
function next(ms: number, unit: Unit): number {
  const d = new Date(ms);
  if (unit === 'year') return Date.UTC(d.getUTCFullYear() + 1, 0, 1);
  if (unit === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return ms + FIXED[unit];
}
function field(ms: number, unit: Unit): number {
  const d = new Date(ms);
  return { second: d.getUTCSeconds(), minute: d.getUTCMinutes(), hour: d.getUTCHours(), day: d.getUTCDate() - 1, week: 0, month: d.getUTCMonth(), year: d.getUTCFullYear() }[unit];
}

function time(domain: [number, number], range: [number, number], count: number): Ticks {
  const [d0, d1] = domain[0] <= domain[1] ? domain : [domain[1], domain[0]];
  if (d0 === d1) return { domain: [d0, d1], ticks: [d0], map: linearMap([d0, d1], range) };
  const target = (d1 - d0) / count;
  const i = INTERVALS.findIndex(([, , ms]) => ms > target);
  let unit: Unit, n: number;
  if (i === -1) [unit, n] = ['year', Math.floor(stepOf(d0 / YEAR, d1 / YEAR, count))];
  else if (i === 0) [unit, n] = ['second', 1];
  else [unit, n] = target / INTERVALS[i - 1][2] < INTERVALS[i][2] / target ? INTERVALS[i - 1] : INTERVALS[i];
  const ticks: number[] = [];
  if (n >= 1) for (let t = ceilTo(d0, unit); t <= d1; t = next(t, unit)) if (field(t, unit) % n === 0) ticks.push(t);
  return { domain: [d0, d1], ticks, map: linearMap([d0, d1], range) };
}

/** Writes the defined runs of `points`, each run handed to `run` (which returns its subpath). */
function runs(points: readonly Point[], run: (seq: [number, number][]) => string): string {
  let out = '';
  let seq: [number, number][] = [];
  const flush = () => {
    if (seq.length > 0) out += run(seq);
    seq = [];
  };
  for (const [x, y] of points) {
    if (y === null) flush();
    else seq.push([x, y]);
  }
  flush();
  return out;
}
const xy = ([x, y]: [number, number]) => `${px(x)},${px(y)}`;

const polar = (angle: number, r: number) => [r * Math.sin(angle), -r * Math.cos(angle)] as const;

function marker(shape: Shape, size: number, cx: number, cy: number): string {
  const at = (dx: number, dy: number) => `${px(cx + dx)},${px(cy + dy)}`;
  const poly = (pts: [number, number][]) => `M${pts.map(([dx, dy]) => at(dx, dy)).join('L')}Z`;
  if (shape === 'circle') {
    const r = Math.sqrt(size / Math.PI);
    return `M${at(r, 0)}A${px(r)},${px(r)},0,1,1,${at(-r, 0)}A${px(r)},${px(r)},0,1,1,${at(r, 0)}`;
  }
  if (shape === 'square') {
    const w = Math.sqrt(size);
    return `M${at(-w / 2, -w / 2)}h${px(w)}v${px(w)}h${px(-w)}Z`;
  }
  if (shape === 'triangle') {
    const y = -Math.sqrt(size / (Math.sqrt(3) * 3));
    return poly([[0, 2 * y], [-Math.sqrt(3) * y, -y], [Math.sqrt(3) * y, -y]]);
  }
  if (shape === 'diamond') {
    const y = Math.sqrt(size / (2 * Math.tan(Math.PI / 6)));
    const x = y * Math.tan(Math.PI / 6);
    return poly([[0, -y], [x, 0], [0, y], [-x, 0]]);
  }
  if (shape === 'cross') {
    const r = Math.sqrt(size / 5) / 2;
    return poly([[-3 * r, -r], [-r, -r], [-r, -3 * r], [r, -3 * r], [r, -r], [3 * r, -r], [3 * r, r], [r, r], [r, 3 * r], [-r, 3 * r], [-r, r], [-3 * r, r]]);
  }
  // wye: three arms at 120°, as d3's symbolWye
  const c = -0.5, s = Math.sqrt(3) / 2, k = 1 / Math.sqrt(12), a = (k / 2 + 1) * 3;
  const r = Math.sqrt(size / a);
  const [x0, y0, x1, y1, x2, y2] = [r / 2, r * k, r / 2, r * k + r, -r / 2, r * k + r];
  const arm = (cs: number, sn: number) => [[cs * x0 - sn * y0, sn * x0 + cs * y0], [cs * x1 - sn * y1, sn * x1 + cs * y1], [cs * x2 - sn * y2, sn * x2 + cs * y2]] as [number, number][];
  return poly([...arm(1, 0), ...arm(c, s), ...arm(c, -s)]);
}

export const houseKit: Kit = {
  name: 'house',
  extent(values) {
    let lo = Infinity, hi = -Infinity;
    for (const v of values) if (Number.isFinite(v)) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
    return lo === Infinity ? null : [lo, hi];
  },
  linear,
  time,
  band(n, [r0, r1], paddingInner, paddingOuter) {
    const size = (r1 - r0) / Math.max(1, n - paddingInner + paddingOuter * 2);
    const start = r0 + (r1 - r0 - size * (n - paddingInner)) / 2;
    return { starts: Array.from({ length: n }, (_, i) => start + size * i), bandwidth: size * (1 - paddingInner) };
  },
  line: (points) => runs(points, (seq) => (seq.length === 1 ? `M${xy(seq[0])}Z` : `M${seq.map(xy).join('L')}`)),
  area: (points, baseline) => runs(points, (seq) => `M${seq.map(xy).join('L')}L${px(seq[seq.length - 1][0])},${px(baseline)}L${px(seq[0][0])},${px(baseline)}Z`),
  pie(values) {
    const total = values.reduce((a, v) => a + Math.max(0, v), 0);
    let angle = 0;
    return values.map((v) => {
      const start = angle;
      angle += total > 0 ? (Math.max(0, v) / total) * 2 * Math.PI : 0;
      return { start, end: angle };
    });
  },
  arc(start, end, radius) {
    if (end - start >= 2 * Math.PI - 1e-9) {
      const r = px(radius);
      return `M0,${px(-radius)}A${r},${r},0,1,1,0,${px(radius)}A${r},${r},0,1,1,0,${px(-radius)}Z`;
    }
    const [x0, y0] = polar(start, radius);
    const [x1, y1] = polar(end, radius);
    return `M0,0L${px(x0)},${px(y0)}A${px(radius)},${px(radius)},0,${end - start > Math.PI ? 1 : 0},1,${px(x1)},${px(y1)}Z`;
  },
  symbols: (shape, size, centres) => centres.map(([cx, cy]) => marker(shape, size, cx, cy)).join(''),
};
