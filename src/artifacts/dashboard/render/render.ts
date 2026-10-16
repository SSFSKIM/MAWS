// The dashboard's renderer (P3-E2 M3; parent §2 "Views", its binding grade; the route M1 chose, parent Decision Log
// 14): `renderView(spec, table, theme, datasetId) → {svg, warnings}`, a pure function the editor, main's exporters and
// Node all call, so one input is one output everywhere. The output is one standalone SVG: no script, no event attribute,
// no href, no id or `url(...)` reference, no external resource; every text is escaped, every theme value validated
// (`themeFrom`). Equal inputs give byte-equal output: nothing reads a DOM, the locale, the clock or randomness.
//
// The house law has no categorical palette, so a figure is drawn in text ink: series part by dash, marker shape and
// fill treatment, always with a legend (two or more series) or a direct label, never by colour alone; status colours
// are never borrowed. Hover is the host's handler around the figure; the figure carries none. A discrete mark (a bar,
// a wedge) names its value in `data-tip` and is its own hit target (a bar's hatching is drawn `pointer-events="none"`,
// so its strokes never take the bar's pointer); the points of a line, an area or a scatter, every drawable one, sit in
// one empty layer, `<g data-hover="nearest" data-xy="x,y …" data-tips="…">` (tips one per line), which the host
// searches for the point nearest the pointer, so hover reaches every value without one element per point.
import type { Cell } from '../datasets';
import { parseSpec, type ValueFormat, type ViewSpec } from '../spec';
import { DATASET_STATES, VIEW_STATES } from '../states';
import * as geo from './geometry';
import { SHAPES, type Point, type Ticks } from './geometry';
import { decimalsFor, esc, formatInstant, formatNumber, px, unitOf, type Theme } from './svg';
import { textWidth, wrap } from './text';
import { instantOf, shownColumns, transform, typedKey, type ViewColumn, type ViewData, type ViewTable } from './transform';

/**
 * A view's one output (parent Decision Log 24): a chart is an SVG, a table an HTML `<table>` (text, not a picture), so
 * exactly one of `svg` and `html` is set. A state drawn in place (an error, an empty view) is an SVG frame for every
 * kind.
 */
export type Rendered = ({ svg: string; html?: never } | { html: string; svg?: never }) & {
  /** What the view could not show as asked (dropped spec keys, undrawn rows, shortened labels): noted under it. */
  warnings: string[];
};

const DASHES = ['', '6 4', '2 3', '10 3 2 3', '1 3', '14 4'];
const TINTS = [0.88, 0.5, 0.24, 0.7, 0.36, 0.12];
// A bar series' identity without colour: solid, hollow, hatched at 45° or 135°, cross-hatched, a dashed hollow.
const BAR_FILLS: { solid: boolean; hatch: (45 | 135)[]; dash?: string }[] = [
  { solid: true, hatch: [] },
  { solid: false, hatch: [] },
  { solid: false, hatch: [45] },
  { solid: false, hatch: [135] },
  { solid: false, hatch: [45, 135] },
  { solid: false, hatch: [], dash: '3 2' },
];
const MAX_SERIES = 6;
const PLOT_H = 260;
// A magnitude past this cannot take part in a scale's span (the span of ±1.7e308 is not a number): counted, not drawn.
const DRAWABLE = 1e306;
/** A table view's rows without a `limit` (parent Decision Log 24). */
export const TABLE_VIEW_ROWS = 25;
/** The most rows a table view shows, whatever its `limit`; past it the view notes how many there are. */
export const TABLE_VIEW_MAX_ROWS = 100;

/**
 * Draws `spec` (a chart atom's spec, untrusted) over `table`, the snapshot of the dataset `datasetId` names (null: no
 * dataset is bound under that id). Every state that cannot be drawn as asked is drawn in place, keeping the caption.
 */
export function renderView(spec: unknown, table: ViewTable | null, theme: Theme, datasetId: string): Rendered {
  const parsed = parseSpec(spec);
  if (!parsed.ok) return failure(theme, parsed.error, parsed.title ?? 'Chart');
  const caption = captionOf(parsed.spec, datasetId);
  if (table === null) return failure(theme, DATASET_STATES.noDataset(datasetId), caption);
  const shaped = transform(table, parsed.spec, datasetId);
  if (!shaped.ok) return failure(theme, shaped.error, caption);
  const view: View = { spec: parsed.spec, data: shaped.data, theme, caption, warnings: [...parsed.warnings] };
  if (parsed.spec.view === 'table') return tableView(view);
  if (shaped.data.table.rows.length === 0) return notice(theme, VIEW_STATES.empty, caption, view.warnings);
  if (parsed.spec.view === 'pie') return pieView(view);
  return cartesian(view);
}

/** The transformed view as the source sheet inspects it, complete (before a table view's preview bound): the same
 * interpretation the figure and the table draw, or why there is none. */
export function viewRows(spec: unknown, table: ViewTable, datasetId: string): { ok: true; table: ViewTable } | { ok: false; error: string } {
  const parsed = parseSpec(spec);
  if (!parsed.ok) return parsed;
  const shaped = transform(table, parsed.spec, datasetId);
  if (!shaped.ok) return shaped;
  const { data } = shaped;
  if (parsed.spec.view !== 'table' || !parsed.spec.columns) return { ok: true, table: data.table };
  const at = shownColumns(data, parsed.spec);
  return { ok: true, table: { columns: at.map((i) => data.table.columns[i]), rows: data.table.rows.map((row) => at.map((i) => row[i] ?? null)) } };
}

/** A view that cannot be drawn for a reason outside its spec and rows (its snapshot unreadable), in the same frame. */
export function renderFailure(spec: unknown, theme: Theme, datasetId: string, message: string): Rendered {
  const parsed = parseSpec(spec);
  return failure(theme, message, parsed.ok ? captionOf(parsed.spec, datasetId) : (parsed.title ?? 'Chart'));
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** The caption a view is named by: its spec's title, else what it shows. */
export const captionOf = (spec: ViewSpec, datasetId: string): string => spec.title ?? `${spec.view === 'table' ? 'Table' : `${cap(spec.view)} chart`} of ${datasetId}`;

interface View {
  spec: ViewSpec;
  data: ViewData;
  theme: Theme;
  caption: string;
  warnings: string[];
}

/** The largest of `values` without spreading them into a call (a view may hold 200,000). */
function largest(values: Iterable<number>, floor = -Infinity): number {
  let out = floor;
  for (const value of values) if (value > out) out = value;
  return out;
}

// ---- writing ----

function frame(theme: Theme, height: number, caption: string, desc: string, body: string): string {
  const w = theme.width;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${px(height)}" width="${w}" height="${px(height)}" role="img" aria-label="${esc(caption)}"` +
    ` font-family="${esc(theme.fontBody)}" font-size="${theme.caption}" fill="${theme.ink}" style="font-variant-numeric:tabular-nums">` +
    `<title>${esc(caption)}</title><desc>${esc(desc)}</desc>${body}</svg>`
  );
}

interface TextOptions {
  anchor?: 'start' | 'middle' | 'end';
  fill?: string;
  size?: number;
  weight?: number;
  mono?: string;
  line?: number;
}
/** Text whose first line's baseline is at `y`; further lines step by `line`. */
function text(x: number, y: number, lines: string | string[], o: TextOptions = {}): string {
  const list = Array.isArray(lines) ? lines : [lines];
  const attrs = [`x="${px(x)}"`, `y="${px(y)}"`];
  if (o.anchor && o.anchor !== 'start') attrs.push(`text-anchor="${o.anchor}"`);
  if (o.fill) attrs.push(`fill="${o.fill}"`);
  if (o.size) attrs.push(`font-size="${o.size}"`);
  if (o.weight) attrs.push(`font-weight="${o.weight}"`);
  if (o.mono) attrs.push(`font-family="${esc(o.mono)}"`);
  const body = list.length === 1 ? esc(list[0]) : list.map((l, i) => `<tspan x="${px(x)}"${i === 0 ? '' : ` dy="${px(o.line ?? 16)}"`}>${esc(l)}</tspan>`).join('');
  return `<text ${attrs.join(' ')}>${body}</text>`;
}

const hline = (x0: number, x1: number, y: number, stroke: string) => `<path d="M${px(x0)},${px(y)}H${px(x1)}" stroke="${stroke}" stroke-width="1" fill="none"/>`;

function failure(theme: Theme, message: string, caption: string): Rendered {
  const h = 72;
  const body =
    `<rect x="0.5" y="0.5" width="${theme.width - 1}" height="${h - 1}" rx="6" fill="${theme.ground}" stroke="${theme.rule}"/>` +
    text(16, 30, wrap(message, theme.body, theme.width - 32, 1).lines, { size: theme.body }) +
    text(16, 52, VIEW_STATES.kept, { fill: theme.muted });
  return { svg: frame(theme, h, caption, `This view cannot be drawn: ${message}.`, body), warnings: [message] };
}

function notice(theme: Theme, message: string, caption: string, warnings: string[]): Rendered {
  const h = 72;
  const body = `<rect x="0.5" y="0.5" width="${theme.width - 1}" height="${h - 1}" rx="6" fill="${theme.ground}" stroke="${theme.rule}"/>` + text(16, 41, message, { fill: theme.muted });
  return { svg: frame(theme, h, caption, message, body), warnings: [...warnings, message] };
}

// ---- values ----

function formatCell(value: Cell, column: ViewColumn | undefined, format?: ValueFormat): string {
  if (value === null) return '—';
  if (typeof value === 'number') {
    if (format === 'percent') return `${formatNumber(value * 100, 1)}%`;
    if (format === 'text') return String(value);
    return formatNumber(value, 2);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (column?.type === 'date' && format !== 'text') {
    const ms = instantOf(value);
    if (ms !== null) return value.length === 10 ? formatInstant(ms, 'day') : `${formatInstant(ms, 'day')} ${formatInstant(ms, 'minute').slice(6)} UTC`;
  }
  return value;
}

/** A category's or a series' name: its value as the view formats it, "(none)" for an empty cell. */
const nameOf = (value: Cell, column: ViewColumn | undefined, format?: ValueFormat): string => (value === null ? '(none)' : formatCell(value, column, format));

/** The one format a shared axis may take: the measures' common one, else none (raw numbers, whatever each tip says). */
const commonFormat = (formats: (ValueFormat | undefined)[]): ValueFormat | undefined => (formats.every((f) => f === formats[0]) ? formats[0] : undefined);

function tickLabels(ticks: number[], kind: 'linear' | 'time', format?: ValueFormat): string[] {
  if (kind === 'time') {
    const unit = unitOf(ticks);
    return ticks.map((t) => formatInstant(t, unit));
  }
  if (format === 'percent') {
    const d = decimalsFor(ticks.map((t) => t * 100));
    return ticks.map((t) => `${formatNumber(t * 100, d)}%`);
  }
  if (format === 'text') return ticks.map((t) => String(t));
  const d = decimalsFor(ticks);
  return ticks.map((t) => formatNumber(t, d));
}

const domainOf = (values: number[], zero: boolean): [number, number] => {
  const ext = geo.extent(values) ?? [0, 1];
  let [lo, hi] = zero ? [Math.min(0, ext[0]), Math.max(0, ext[1])] : ext;
  if (lo === hi) [lo, hi] = lo === 0 ? [0, 1] : [Math.min(0, lo), Math.max(0, hi)];
  if (lo === hi) [lo, hi] = [lo - 1, hi + 1];
  return [lo, hi];
};

// ---- legend ----

interface Entry {
  key: string;
  label: string;
  style: number;
}

/** The legend rows: each entry a key mark beside its label in ink, wrapped to the width. */
function legend(entries: Entry[], theme: Theme, x0: number, y0: number, key: (entry: Entry, x: number, y: number) => string): { svg: string; height: number } {
  if (entries.length < 2) return { svg: '', height: 0 };
  const lineH = theme.caption * 1.7;
  let x = x0;
  let y = y0 + theme.caption;
  let out = '';
  for (const entry of entries) {
    const label = wrap(entry.label, theme.caption, 200, 1).lines[0];
    const w = 22 + textWidth(label, theme.caption);
    if (x > x0 && x + w > theme.width) {
      x = x0;
      y += lineH;
    }
    out += key(entry, x, y - theme.caption * 0.35) + text(x + 22, y, label);
    x += w + 18;
  }
  return { svg: `<g>${out}</g>`, height: y - y0 + lineH * 0.6 };
}

// ---- cartesian views: bar, line, area, scatter ----

interface Mark {
  x: Cell;
  y: number | null;
  tip: string;
}
interface Series extends Entry {
  marks: Mark[];
  /** The format of the measure it draws (each y its own). */
  format?: ValueFormat;
  /** Its series value's name ('' without a series column) and its measure's name, as its tips say them. */
  seriesName: string;
  measure: string;
}

function cartesian(v: View): Rendered {
  const { spec, data, theme, warnings } = v;
  const { table } = data;
  if (spec.x === undefined || data.x === undefined) return failure(theme, VIEW_STATES.needs(spec.view, 'an x column'), v.caption);
  if (data.ys.length === 0) return failure(theme, VIEW_STATES.needs(spec.view, 'a y column'), v.caption);
  const xi = data.x;
  const xCol = table.columns[xi];
  const ys = data.ys;
  const yName = (k: number) => table.columns[ys[k]].name;
  const nonNumber = ys.filter((y) => table.columns[y].type !== 'number' && table.columns[y].type !== 'null');
  if (nonNumber.length > 0) return failure(theme, VIEW_STATES.notNumbers(table.columns[nonNumber[0]].name), v.caption);
  const formats = data.yNames.map((name) => spec.format?.[name]);
  const xFormat = spec.format?.[spec.x];

  // Series: by the series column's typed values (identity and form from the unfiltered snapshot), or one per y.
  const si = data.series;
  const all: Series[] = [];
  const byKey = new Map<string, Series>();
  for (const row of table.rows)
    ys.forEach((yi, k) => {
      const value = si === undefined ? null : (row[si] ?? null);
      const key = si === undefined ? `y${k}` : `${typedKey(value)}\u0000${k}`;
      let s = byKey.get(key);
      if (!s) {
        const seriesName = si === undefined ? '' : nameOf(value, table.columns[si], spec.series ? spec.format?.[spec.series] : undefined);
        const label = si === undefined ? yName(k) : ys.length > 1 ? `${seriesName} · ${yName(k)}` : seriesName;
        const style = si === undefined ? k : Math.max(0, data.seriesKeys.indexOf(typedKey(value))) * ys.length + k;
        s = { key, label, style, marks: [], format: formats[k], seriesName, measure: yName(k) };
        byKey.set(key, s);
        all.push(s);
      }
      const y = row[yi];
      s.marks.push({ x: row[xi] ?? null, y: typeof y === 'number' && Number.isFinite(y) ? y : null, tip: '' });
    });
  all.sort((a, b) => a.style - b.style);
  if (all.length > MAX_SERIES) warnings.push(VIEW_STATES.seriesCap(MAX_SERIES, all.length));
  const series = all.slice(0, MAX_SERIES);

  // A magnitude past ±1e306 would overflow a scale's span; it is counted and not drawn, never clamped.
  const xKind: 'band' | 'time' | 'linear' = spec.view === 'bar' || xCol.type === 'string' || xCol.type === 'boolean' ? 'band' : xCol.type === 'date' ? 'time' : 'linear';
  const xValue = (x: Cell) => (xKind === 'time' ? instantOf(x) : typeof x === 'number' && Number.isFinite(x) ? x : null);
  let huge = 0;
  for (const s of series)
    for (const m of s.marks) {
      const x = xKind === 'linear' ? xValue(m.x) : null;
      if ((m.y !== null && Math.abs(m.y) > DRAWABLE) || (x !== null && Math.abs(x) > DRAWABLE)) {
        huge += 1;
        m.y = null;
        m.x = null;
      }
    }
  if (huge > 0) warnings.push(VIEW_STATES.tooLarge(huge));
  let nullY = 0;
  for (const s of series) for (const m of s.marks) if (m.y === null) nullY += 1;
  nullY -= huge;
  if (nullY > 0) warnings.push(VIEW_STATES.missing(nullY, ys.map((_, k) => yName(k)).join(', ')));
  if (xKind !== 'band') {
    let nullX = 0;
    for (const s of series) for (const m of s.marks) if (m.y !== null && xValue(m.x) === null) nullX += 1;
    if (nullX > 0) warnings.push(VIEW_STATES.missing(nullX, xCol.name));
    for (const s of series) {
      s.marks = s.marks.filter((m) => xValue(m.x) !== null);
      // A line is drawn along x; the data's order is kept for everything else (the table, the tips).
      if (spec.view !== 'scatter') s.marks = s.marks.map((m, i) => ({ m, i })).sort((a, b) => xValue(a.m.x)! - xValue(b.m.x)! || a.i - b.i).map(({ m }) => m);
    }
  } else for (const s of series) s.marks = s.marks.filter((m) => !(m.x === null && m.y === null));
  for (const s of series)
    for (const m of s.marks) m.tip = `${formatCell(m.x, xCol, xFormat)}${si !== undefined && series.length > 1 ? ` · ${s.seriesName}` : ''} · ${s.measure}: ${formatCell(m.y, undefined, s.format)}`;

  // Frame: legend on top, then the plot, then the x axis. The y axis takes the measures' common format, else raw numbers.
  const top = 8;
  const lg = legend(series, theme, 0, top, (entry, x, y) => keyMark(spec.view, entry.style, x, y, theme));
  const yValues: number[] = [];
  for (const s of series) for (const m of s.marks) if (m.y !== null) yValues.push(m.y);
  if (yValues.length === 0) return notice(theme, VIEW_STATES.missing(nullY, ys.map((_, k) => yName(k)).join(', ')), v.caption, warnings);
  const axisFormat = commonFormat(series.map((s) => s.format));
  let barCount = 0;
  if (spec.view === 'bar') for (const s of series) barCount += s.marks.length;
  const valueLabels = spec.view === 'bar' && barCount <= 16;
  const plotTop = top + lg.height + (valueLabels ? theme.caption + 10 : 6);
  const negative = yValues.some((y) => y < 0);
  // A negative bar's value sits below its tip, so the scale stops short of the axis labels by one label's room.
  const room = valueLabels && negative ? theme.caption + 10 : 0;
  const plotBottom = plotTop + PLOT_H - room;
  const axisY = plotBottom + room;
  const yScale = geo.linear(domainOf(yValues, spec.view === 'bar' || spec.view === 'area'), [plotBottom, plotTop], 5, true);
  const yLabels = tickLabels(yScale.ticks, 'linear', axisFormat);
  const left = Math.ceil(largest(yLabels.map((l) => textWidth(l, theme.caption)), 0)) + 10;

  // Direct labels at a line's end (four series or fewer, separated), else the legend carries identity.
  const ends = spec.view === 'line' || spec.view === 'area' ? endLabels(series, yScale, theme) : [];
  const right = theme.width - (ends.length > 0 ? Math.min(160, largest(ends.map((e) => textWidth(e.label, theme.caption)), 0) + 14) : 8);

  let xAxis: { svg: string; height: number; map: (x: Cell) => number | null; band?: { starts: number[]; bandwidth: number; keys: string[] } };
  if (xKind === 'band') {
    const keys: string[] = [];
    const labelFor = new Map<string, string>();
    for (const s of series)
      for (const m of s.marks) {
        const key = typedKey(m.x);
        if (labelFor.has(key)) continue;
        labelFor.set(key, nameOf(m.x, xCol, xFormat));
        keys.push(key);
      }
    const band = geo.band(keys.length, [left, right], 0.2, 0.1);
    const lineH = theme.caption * 1.4;
    let shortened = false;
    const wrapped = keys.map((k) => {
      const w = wrap(labelFor.get(k)!, theme.caption, band.bandwidth / 0.8 - 4, 2);
      shortened ||= w.shortened;
      return w.lines;
    });
    if (shortened) warnings.push(VIEW_STATES.labelsShortened);
    // Every category keeps its label (a bar without one has no identity): each is wrapped to its band's step less 4 px,
    // so neighbours never touch and nothing is thinned.
    const svg = wrapped.map((lines, i) => text(band.starts[i] + band.bandwidth / 2, axisY + theme.caption + 8, lines, { anchor: 'middle', fill: theme.muted, line: lineH })).join('');
    const at = new Map(keys.map((k, i) => [k, band.starts[i] + band.bandwidth / 2]));
    xAxis = { svg, height: theme.caption + 8 + (largest(wrapped.map((l) => l.length), 1) - 1) * lineH + 8, map: (x) => at.get(typedKey(x)) ?? null, band: { ...band, keys } };
  } else {
    const xs: number[] = [];
    for (const s of series) for (const m of s.marks) xs.push(xValue(m.x)!);
    const scale = xKind === 'time' ? geo.time(domainOf(xs, false), [left, right], 6) : geo.linear(domainOf(xs, false), [left, right], 6, spec.view === 'scatter');
    const labels = tickLabels(scale.ticks, xKind, xFormat);
    const every = thinning(
      labels.map((l) => textWidth(l, theme.caption)),
      scale.ticks.length > 1 ? Math.abs(scale.map(scale.ticks[1]) - scale.map(scale.ticks[0])) : theme.width,
    );
    const svg = scale.ticks.map((t, i) => (i % every === 0 ? text(scale.map(t), axisY + theme.caption + 8, labels[i], { anchor: edgeAnchor(scale.map(t), labels[i], theme), fill: theme.muted }) : '')).join('');
    xAxis = { svg, height: theme.caption + 16, map: (x) => (xValue(x) === null ? null : scale.map(xValue(x)!)) };
  }

  // Axes and grid: hairline rules at the y ticks; the zero line, when inside the domain, a step darker.
  let body = lg.svg;
  body += yScale.ticks.map((t, i) => hline(left, right, yScale.map(t), theme.rule) + text(left - 8, yScale.map(t) + theme.caption * 0.35, yLabels[i], { anchor: 'end', fill: theme.muted })).join('');
  if (yScale.domain[0] < 0 && yScale.domain[1] > 0) body += hline(left, right, yScale.map(0), theme.muted);
  body += xAxis.svg;

  const hover: { x: number; y: number; tip: string }[] = [];
  const hoverAll = () => {
    for (const s of series) for (const m of s.marks) if (m.y !== null) hover.push({ x: xAxis.map(m.x)!, y: yScale.map(m.y), tip: m.tip });
  };
  const pointsOf = (s: Series): Point[] => s.marks.map((m) => [xAxis.map(m.x)!, m.y === null ? null : yScale.map(m.y)] as const);

  if (spec.view === 'bar') body += bars(series, xAxis.band!, yScale, theme, valueLabels);
  else if (spec.view === 'scatter') {
    for (const s of series) {
      const centres = pointsOf(s).filter((p): p is [number, number] => p[1] !== null);
      body += `<path d="${geo.symbols(SHAPES[s.style % SHAPES.length], 64, centres)}" fill="${theme.ink}" fill-opacity="0.72" stroke="${theme.ground}" stroke-width="1"/>`;
    }
    hoverAll();
  } else {
    const base = yScale.map(Math.max(yScale.domain[0], Math.min(0, yScale.domain[1])));
    for (const s of series) {
      const pts = pointsOf(s);
      if (spec.view === 'area') body += `<path d="${geo.area(pts, base)}" fill="${theme.ink}" fill-opacity="0.1"/>`;
      const dash = DASHES[s.style % DASHES.length];
      body += `<path d="${geo.line(pts)}" fill="none" stroke="${theme.ink}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
      if (series.length > 1 && s.marks.length <= 24) {
        const centres = pts.filter((p): p is [number, number] => p[1] !== null);
        body += `<path d="${geo.symbols(SHAPES[s.style % SHAPES.length], 48, centres)}" fill="${theme.ink}" stroke="${theme.ground}" stroke-width="2" paint-order="stroke"/>`;
      }
    }
    body += ends.map((e) => text(xAxis.map(e.m.x)! + 8, e.y + theme.caption * 0.35, e.label)).join('');
    hoverAll();
  }
  if (hover.length > 0)
    body += `<g data-hover="nearest" data-xy="${hover.map((h) => `${px(h.x)},${px(h.y)}`).join(' ')}" data-tips="${hover.map((h) => esc(h.tip.replace(/[\r\n]+/g, ' '))).join('&#10;')}"/>`;

  const height = axisY + xAxis.height;
  let points = 0;
  for (const s of series) points += s.marks.length;
  const measured = ys.map((_, k) => yName(k)).join(', ');
  const desc = `${cap(spec.view)} chart of ${measured} by ${xCol.name}${spec.series ? ` and ${spec.series}` : ''}, ${points} ${points === 1 ? 'value' : 'values'}${series.length > 1 ? ` in ${series.length} series (${series.map((s) => s.label).join(', ')})` : ''}. The values are in the source table under the figure.`;
  return { svg: frame(theme, height, v.caption, desc, body), warnings };
}

/** A line's end labels (four series or fewer), each in its measure's format, or none when two would sit closer than a line apart. */
function endLabels(list: Series[], scale: Ticks, theme: Theme): { m: Mark; label: string; y: number }[] {
  if (list.length > 4) return [];
  const out = list.flatMap((s) => {
    let last: Mark | undefined;
    for (const m of s.marks) if (m.y !== null) last = m;
    if (!last) return [];
    const value = formatCell(last.y, undefined, s.format);
    return [{ m: last, label: list.length === 1 ? value : `${s.label} ${value}`, y: scale.map(last.y!) }];
  });
  const sorted = [...out].sort((a, b) => a.y - b.y);
  return sorted.some((e, i) => i > 0 && e.y - sorted[i - 1].y < theme.caption * 1.3) ? [] : out;
}

/** Every n-th label so that labels of these widths do not touch at this pitch. */
function thinning(widths: number[], pitch: number): number {
  const widest = Math.max(0, ...widths) + 8;
  return Math.max(1, Math.ceil(widest / Math.max(1, pitch)));
}

/** A label at the plot's edge anchors inward, so it never leaves the frame. */
function edgeAnchor(x: number, label: string, theme: Theme): 'start' | 'middle' | 'end' {
  const half = textWidth(label, theme.caption) / 2;
  if (x - half < 0) return 'start';
  if (x + half > theme.width) return 'end';
  return 'middle';
}

function keyMark(view: string, style: number, x: number, y: number, theme: Theme): string {
  if (view === 'bar') return treated(`M${px(x)},${px(y - 6)}h14v12h-14Z`, { x0: x, y0: y - 6, x1: x + 14, y1: y + 6 }, style, theme);
  if (view === 'scatter') return `<path d="${geo.symbols(SHAPES[style % SHAPES.length], 64, [[x + 7, y]])}" fill="${theme.ink}" fill-opacity="0.72"/>`;
  const dash = DASHES[style % DASHES.length];
  return `<path d="M${px(x)},${px(y)}H${px(x + 16)}" stroke="${theme.ink}" stroke-width="2" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>` + `<path d="${geo.symbols(SHAPES[style % SHAPES.length], 36, [[x + 8, y]])}" fill="${theme.ink}"/>`;
}

/** Columns from the zero line, at most 24 px thick, the data end rounded 4 px, a 2 px ground gap between neighbours; each
 * in its series' own form (a series alone after a filter keeps the form it has in the whole snapshot). */
function bars(series: Series[], band: { starts: number[]; bandwidth: number; keys: string[] }, y: Ticks, theme: Theme, labels: boolean): string {
  const n = series.length;
  const slot = band.bandwidth / n;
  const thick = Math.max(1, Math.min(24, slot - 2));
  const zero = y.map(Math.max(y.domain[0], Math.min(0, y.domain[1])));
  const at = new Map(band.keys.map((key, i) => [key, band.starts[i]]));
  let out = '';
  series.forEach((s, k) => {
    for (const m of s.marks) {
      if (m.y === null) continue;
      const x = at.get(typedKey(m.x))! + slot * k + (slot - thick) / 2;
      const tip = y.map(m.y);
      out += treated(roundedBar(x, thick, zero, tip), { x0: x, y0: Math.min(zero, tip), x1: x + thick, y1: Math.max(zero, tip) }, s.style, theme, ` data-tip="${esc(m.tip)}"`);
      if (labels) {
        const below = m.y < 0;
        out += text(x + thick / 2, below ? tip + theme.caption + 4 : tip - 6, formatCell(m.y, undefined, s.format), { anchor: 'middle', fill: theme.ink });
      }
    }
  });
  return out;
}

/** A bar or legend key in its series' treatment (BAR_FILLS): the shape, then any hatching inside its box. */
function treated(d: string, box: { x0: number; y0: number; x1: number; y1: number }, style: number, theme: Theme, extra = ''): string {
  const fill = BAR_FILLS[style % BAR_FILLS.length];
  if (fill.solid) return `<path d="${d}" fill="${theme.ink}" fill-opacity="${TINTS[0]}"${extra}/>`;
  let out = `<path d="${d}" fill="${theme.ground}" stroke="${theme.ink}" stroke-width="1.5"${fill.dash ? ` stroke-dasharray="${fill.dash}"` : ''}${extra}/>`;
  const lines = fill.hatch.map((angle) => hatch(box.x0 + 2, box.y0 + 2, box.x1 - 2, box.y1 - 2, angle)).join('');
  // the hatching decorates the bar beneath it and never takes the bar's pointer (its tip), its strokes included
  if (lines !== '') out += `<path d="${lines}" fill="none" stroke="${theme.ink}" stroke-width="1" pointer-events="none"/>`;
  return out;
}

/** Parallel lines 4 px apart across a box, rising at 45° or falling at 135°, each clipped to the box. */
function hatch(x0: number, y0: number, x1: number, y1: number, angle: 45 | 135): string {
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return '';
  let d = '';
  for (let c = 2 - h; c < w; c += 4) {
    const t0 = Math.max(0, -c);
    const t1 = Math.min(h, w - c);
    if (t1 <= t0) continue;
    let [ax, bx] = [x0 + c + t0, x0 + c + t1];
    if (angle === 135) [ax, bx] = [x0 + x1 - ax, x0 + x1 - bx];
    d += `M${px(ax)},${px(y1 - t0)}L${px(bx)},${px(y1 - t1)}`;
  }
  return d;
}

function roundedBar(x: number, w: number, base: number, tip: number): string {
  const h = Math.abs(base - tip);
  const r = Math.min(4, w / 2, h);
  const dir = tip < base ? 1 : -1; // up for positive values
  if (h === 0) return `M${px(x)},${px(base)}h${px(w)}`;
  const t = tip + dir * r;
  return `M${px(x)},${px(base)}V${px(t)}A${px(r)},${px(r)},0,0,${dir > 0 ? 1 : 0},${px(x + r)},${px(tip)}H${px(x + w - r)}A${px(r)},${px(r)},0,0,${dir > 0 ? 1 : 0},${px(x + w)},${px(t)}V${px(base)}Z`;
}

// ---- pie ----

function pieView(v: View): Rendered {
  const { spec, data, theme, warnings } = v;
  const { table } = data;
  if (spec.x === undefined || data.x === undefined) return failure(theme, VIEW_STATES.needs('pie', 'an x column (the slices)'), v.caption);
  if (data.ys.length === 0) return failure(theme, VIEW_STATES.needs('pie', 'a y column (the sizes)'), v.caption);
  const xi = data.x;
  const yi = data.ys[0];
  const yName = table.columns[yi].name;
  const format = spec.format?.[data.yNames[0]];
  const slices = table.rows.map((row) => ({ label: nameOf(row[xi] ?? null, table.columns[xi], spec.format?.[spec.x!]), value: row[yi] ?? null }));
  const positive = (value: Cell): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
  const huge = slices.filter((s) => positive(s.value) && s.value > DRAWABLE).length;
  if (huge > 0) warnings.push(VIEW_STATES.tooLarge(huge));
  const dropped = slices.filter((s) => !positive(s.value)).length;
  if (dropped > 0) warnings.push(VIEW_STATES.slicesDropped(dropped, yName));
  let kept = slices.filter((s): s is { label: string; value: number } => positive(s.value) && s.value <= DRAWABLE);
  if (kept.length > 6) {
    const rest = kept.slice(5);
    let other = 0;
    for (const s of rest) other += s.value;
    kept = [...kept.slice(0, 5), { label: `other (${rest.length})`, value: other }];
    warnings.push(VIEW_STATES.slicesFolded(rest.length + 5));
  }
  let total = 0;
  for (const s of kept) total += s.value;
  if (kept.length === 0 || !Number.isFinite(total)) return notice(theme, kept.length === 0 ? VIEW_STATES.noPositive(yName) : VIEW_STATES.tooLarge(kept.length), v.caption, warnings);
  const r = 110;
  const cx = r + 8;
  const cy = r + 12;
  const angles = geo.pie(kept.map((s) => s.value));
  const shareOf = (value: number) => `${formatNumber((value / total) * 100, 1)}%`;
  let body = `<g transform="translate(${px(cx)},${px(cy)})">`;
  kept.forEach((s, i) => {
    const tip = `${s.label}: ${formatCell(s.value, undefined, format)} (${shareOf(s.value)})`;
    body += `<path d="${geo.arc(angles[i].start, angles[i].end, r)}" fill="${theme.ink}" fill-opacity="${TINTS[i % TINTS.length]}" stroke="${theme.ground}" stroke-width="2" stroke-linejoin="round" data-tip="${esc(tip)}"/>`;
  });
  body += '</g>';
  // Each wedge carries its number, the list's key, so a wedge is told from its neighbour by more than its tint: inside
  // a wide wedge (ground on a dark tint, ink on a light one), just outside the rim of a thin one. The numbers are drawn
  // over the wedges and never take a wedge's pointer.
  kept.forEach((_, i) => {
    const mid = (angles[i].start + angles[i].end) / 2;
    const wide = angles[i].end - angles[i].start >= 0.45;
    const at = wide ? r * 0.62 : r + 10;
    const dark = TINTS[i % TINTS.length] >= 0.7;
    body += text(cx + Math.sin(mid) * at, cy - Math.cos(mid) * at + theme.caption * 0.35, String(i + 1), { anchor: 'middle', fill: wide && dark ? theme.ground : theme.ink }).replace('<text ', '<text pointer-events="none" ');
  });
  // The labels: a numbered list beside the pie (key tint, number, name, value, share), so no label crowds a thin slice.
  const lx = cx + r + 32;
  const lineH = theme.caption * 2;
  const listTop = cy - (kept.length * lineH) / 2 + theme.caption;
  kept.forEach((s, i) => {
    const y = listTop + i * lineH;
    const figures = `${formatCell(s.value, undefined, format)}  ${shareOf(s.value)}`;
    const room = theme.width - lx - 40 - textWidth(`  ${figures}`, theme.caption);
    body += `<rect x="${px(lx)}" y="${px(y - theme.caption * 0.85)}" width="14" height="12" rx="2" fill="${theme.ink}" fill-opacity="${TINTS[i % TINTS.length]}"/>`;
    const label = wrap(s.label, theme.caption, Math.max(40, room), 1).lines[0];
    body += text(lx + 22, y, String(i + 1)) + text(lx + 40, y, label) + text(theme.width - 8, y, figures, { anchor: 'end', fill: theme.muted });
  });
  const desc = `Pie chart of ${yName} by ${table.columns[xi].name}, ${kept.length} slices: ${kept.map((s) => `${s.label} ${shareOf(s.value)}`).join(', ')}. The values are in the source table under the figure.`;
  return { svg: frame(theme, cy * 2, v.caption, desc, body), warnings };
}

// ---- table ----

/** Text for HTML content, escaped; control characters other than tab and newline dropped. */
const html = (value: string): string => esc(value);

/**
 * A table view as an HTML `<table>` (parent Decision Log 24: text, not a picture): the transformed view's rows in its
 * order, at most `TABLE_VIEW_ROWS` without a `limit` and the `limit` up to `TABLE_VIEW_MAX_ROWS` with one, the note
 * "first <n> of <N> rows" when it shows fewer than the view holds (N after the spec's filter, aggregation, sort and
 * limit), "no rows to draw" when it holds none. Only table elements and `class` attributes: numbers right-aligned by
 * class, the note a bottom caption. The page's and the exporters' stylesheets draw it.
 */
function tableView(v: View): Rendered {
  const { spec, data, warnings } = v;
  const { table } = data;
  const at = shownColumns(data, spec);
  const cols = at.map((i) => table.columns[i]);
  const bound = spec.limit === undefined ? TABLE_VIEW_ROWS : Math.min(spec.limit, TABLE_VIEW_MAX_ROWS);
  const shown = table.rows.slice(0, bound);
  const numeric = cols.map((c) => c.type === 'number');
  const cell = (tag: 'th' | 'td', k: number, content: string) => `<${tag}${numeric[k] ? ' class="dash-num"' : ''}>${html(content)}</${tag}>`;
  const head = `<thead><tr>${cols.map((c, k) => cell('th', k, c.name)).join('')}</tr></thead>`;
  const rows = shown.map((row) => `<tr>${at.map((i, k) => cell('td', k, formatCell(row[i] ?? null, cols[k], spec.format?.[cols[k].name]))).join('')}</tr>`).join('');
  const note = table.rows.length === 0 ? VIEW_STATES.empty : table.rows.length > shown.length ? VIEW_STATES.tablePreview(shown.length, table.rows.length) : null;
  return { html: `<table class="dash-table">${note !== null ? `<caption class="dash-table-note">${html(note)}</caption>` : ''}${head}<tbody>${rows}</tbody></table>`, warnings };
}
