// P3-E2 M1 spike: `renderView(spec, table, theme) → {svg, warnings}`, one pure function per candidate Kit. The layout
// (frame, legend, axes, labels, tables, the error state) is shared, so the two candidates differ only in the numbers
// and paths the Kit answers. The output is one standalone SVG: no script, no event attribute, no href, no id or
// `url(...)` reference, no external resource; every text is escaped, every theme value validated (`themeFrom`).
//
// The house law has no categorical palette, so a figure is drawn in text ink: series part by dash, marker shape and
// fill tint, always with a legend (two or more series) or a direct label, never by colour alone; status colours are
// never borrowed. Hover is the host's handler around the figure; the figure carries none. A discrete mark (a bar, a
// wedge) names its value in `data-tip`; the points of a line, an area or a scatter, every drawable one, sit in one
// empty layer, `<g data-hover="nearest" data-xy="x,y …" data-tips="…">` (tips one per line), which the host searches
// for the point nearest the pointer, so hover reaches every value without one element per point.
import { instantOf, type Cell, type Column, type Table } from './model';
import { SHAPES, type Kit, type Point, type Ticks } from './kit';
import { parseSpec, type Format, type ViewSpec } from './spec';
import { states } from './states';
import { decimalsFor, esc, formatInstant, formatNumber, px, unitOf, type Theme } from './svg';
import { textWidth, wrap } from './text';
import { seriesKey, transform, yColumns } from './transform';

export interface Rendered {
  svg: string;
  warnings: string[];
}
export type RenderView = (spec: unknown, table: Table | null, theme: Theme, datasetId: string) => Rendered;

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
const TABLE_ROWS = 25;

export function makeRenderer(kit: Kit): RenderView {
  return (rawSpec, table, theme, datasetId) => {
    const parsed = parseSpec(rawSpec);
    if (!parsed.ok) return failure(theme, parsed.error, parsed.title ?? 'Chart');
    const spec = parsed.spec;
    const caption = spec.title ?? `${spec.view} of ${datasetId}`;
    if (table === null) return failure(theme, states.noDataset(datasetId), caption);
    const shaped = transform(table, spec, datasetId);
    if (!shaped.ok) return failure(theme, shaped.error, caption);
    const warnings = [...parsed.warnings, ...shaped.warnings];
    const view = { spec, table: shaped.table, series: shaped.series, theme, kit, caption, warnings, datasetId };
    if (spec.view === 'table') return tableView(view);
    if (shaped.table.rows.length === 0) return notice(theme, states.empty, caption, warnings);
    if (spec.view === 'pie') return pieView(view);
    return cartesian(view);
  };
}

interface View {
  spec: ViewSpec;
  table: Table;
  series: string[];
  theme: Theme;
  kit: Kit;
  caption: string;
  warnings: string[];
  datasetId: string;
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
    text(16, 30, message, { size: theme.body }) +
    text(16, 52, 'The caption, comments and edits on this block are kept.', { fill: theme.muted });
  return { svg: frame(theme, h, caption, `This view cannot be drawn: ${message}.`, body), warnings: [message] };
}

function notice(theme: Theme, message: string, caption: string, warnings: string[]): Rendered {
  const h = 72;
  const body = `<rect x="0.5" y="0.5" width="${theme.width - 1}" height="${h - 1}" rx="6" fill="${theme.ground}" stroke="${theme.rule}"/>` + text(16, 41, message, { fill: theme.muted });
  return { svg: frame(theme, h, caption, message, body), warnings: [...warnings, message] };
}

// ---- values ----

function formatCell(value: Cell, column: Column | undefined, format?: Format): string {
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

function tickLabels(ticks: number[], kind: 'linear' | 'time', format?: Format): string[] {
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

const domainOf = (kit: Kit, values: number[], zero: boolean): [number, number] => {
  const ext = kit.extent(values) ?? [0, 1];
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
    if (x > x0 && x + w > theme.width) (x = x0), (y += lineH);
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
}

function cartesian(v: View): Rendered {
  const { spec, table, theme, kit, warnings } = v;
  const col = (name: string) => table.columns.find((c) => c.name === name);
  if (spec.x === undefined) return failure(theme, states.needs(spec.view, 'an x column'), v.caption);
  const ys = yColumns(spec).length > 0 ? yColumns(spec) : spec.agg === 'count' ? ['count'] : [];
  if (ys.length === 0) return failure(theme, states.needs(spec.view, 'a y column'), v.caption);
  const xCol = col(spec.x)!;
  const xi = table.columns.indexOf(xCol);
  const yis = ys.map((y) => table.columns.findIndex((c) => c.name === y));
  const si = spec.series === undefined ? -1 : table.columns.findIndex((c) => c.name === spec.series);
  const nonNumber = ys.filter((_, k) => table.columns[yis[k]].type !== 'number' && table.columns[yis[k]].type !== 'null');
  if (nonNumber.length > 0) return failure(theme, `${nonNumber[0]} is not a number column`, v.caption);

  // Series: by the series column's values (identity from the unfiltered snapshot), or one per y column.
  const all: Series[] = [];
  const byKey = new Map<string, Series>();
  const keyOf = (row: Cell[], k: number) => (si >= 0 ? (ys.length > 1 ? `${seriesKey(row[si])} · ${ys[k]}` : seriesKey(row[si])) : ys[k]);
  const styleOf = (row: Cell[], k: number) => (si >= 0 ? v.series.indexOf(seriesKey(row[si])) * ys.length + k : k);
  for (const row of table.rows)
    ys.forEach((_, k) => {
      const key = keyOf(row, k);
      let s = byKey.get(key);
      if (!s) byKey.set(key, (s = { key, label: key, style: styleOf(row, k), marks: [] })), all.push(s);
      const y = row[yis[k]];
      s.marks.push({ x: row[xi], y: typeof y === 'number' && Number.isFinite(y) ? y : null, tip: '' });
    });
  all.sort((a, b) => a.style - b.style);
  if (all.length > MAX_SERIES) warnings.push(states.seriesCap(MAX_SERIES, all.length));
  const series = all.slice(0, MAX_SERIES);

  // A magnitude past ±1e306 would overflow the scale's span; it is counted and not drawn, never clamped.
  const huge = series.reduce((n, s) => n + s.marks.filter((m) => m.y !== null && Math.abs(m.y) > 1e306).length, 0);
  if (huge > 0) warnings.push(`${huge} ${huge === 1 ? 'value is' : 'values are'} too large to draw`);
  for (const s of series) for (const m of s.marks) if (m.y !== null && Math.abs(m.y) > 1e306) m.y = null;
  const nullY = series.reduce((n, s) => n + s.marks.filter((m) => m.y === null).length, 0) - huge;
  if (nullY > 0) warnings.push(states.missing(nullY, ys.join(', ')));
  const xKind: 'band' | 'time' | 'linear' = spec.view === 'bar' || xCol.type === 'string' || xCol.type === 'boolean' ? 'band' : xCol.type === 'date' ? 'time' : 'linear';
  const xValue = (x: Cell) => (xKind === 'time' ? instantOf(x) : typeof x === 'number' ? x : null);
  if (xKind !== 'band') {
    const nullX = series.reduce((n, s) => n + s.marks.filter((m) => xValue(m.x) === null).length, 0);
    if (nullX > 0) warnings.push(states.missing(nullX, spec.x));
    for (const s of series) {
      s.marks = s.marks.filter((m) => xValue(m.x) !== null);
      // A line is drawn along x; the data's order is kept for everything else (the table, the tips).
      if (spec.view !== 'scatter') s.marks = s.marks.map((m, i) => ({ m, i })).sort((a, b) => xValue(a.m.x)! - xValue(b.m.x)! || a.i - b.i).map(({ m }) => m);
    }
  }
  const yFormat = spec.format?.[ys[0]];
  for (const s of series)
    for (const m of s.marks) m.tip = `${formatCell(m.x, xCol, spec.format?.[spec.x])}${series.length > 1 ? ` · ${s.label}` : ''} · ${ys.length === 1 ? ys[0] : s.label}: ${formatCell(m.y, undefined, yFormat)}`;

  // Frame: legend on top, then the plot, then the x axis.
  const top = 8;
  const lg = legend(series, theme, 0, top, (entry, x, y) => keyMark(spec.view, entry.style, x, y, theme, kit));
  const yValues = series.flatMap((s) => s.marks.map((m) => m.y).filter((y): y is number => y !== null));
  if (yValues.length === 0) return notice(theme, states.missing(nullY, ys.join(', ')), v.caption, warnings);
  const barCount = spec.view === 'bar' ? series.reduce((n, s) => n + s.marks.length, 0) : 0;
  const valueLabels = spec.view === 'bar' && barCount <= 16;
  const plotTop = top + lg.height + (valueLabels ? theme.caption + 10 : 6);
  const negative = yValues.some((y) => y < 0);
  // A negative bar's value sits below its tip, so the scale stops short of the axis labels by one label's room.
  const room = valueLabels && negative ? theme.caption + 10 : 0;
  const plotBottom = plotTop + PLOT_H - room;
  const axisY = plotBottom + room;
  const yScale = kit.linear(domainOf(kit, yValues, spec.view === 'bar' || spec.view === 'area'), [plotBottom, plotTop], 5, true);
  const yLabels = tickLabels(yScale.ticks, 'linear', yFormat);
  const left = Math.ceil(Math.max(...yLabels.map((l) => textWidth(l, theme.caption)))) + 10;

  // Direct labels at a line's end (four series or fewer, separated), else the legend carries identity.
  const ends = spec.view === 'line' || spec.view === 'area' ? endLabels(series, yScale, theme, yFormat) : [];
  const right = theme.width - (ends.length > 0 ? Math.min(160, Math.max(...ends.map((e) => textWidth(e.label, theme.caption))) + 14) : 8);

  let xAxis: { svg: string; height: number; map: (x: Cell) => number | null; band?: { starts: number[]; bandwidth: number; keys: string[] } };
  if (xKind === 'band') {
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const s of series) for (const m of s.marks) if (!seen.has(seriesKey(m.x))) seen.add(seriesKey(m.x)), keys.push(seriesKey(m.x));
    const band = kit.band(keys.length, [left, right], 0.2, 0.1);
    const labelFor = new Map(keys.map((k) => [k, k]));
    for (const s of series) for (const m of s.marks) labelFor.set(seriesKey(m.x), formatCell(m.x, xCol, spec.format?.[spec.x]));
    const lineH = theme.caption * 1.4;
    let shortened = false;
    const wrapped = keys.map((k) => {
      const w = wrap(labelFor.get(k)!, theme.caption, band.bandwidth / 0.8 - 4, 2);
      shortened ||= w.shortened;
      return w.lines;
    });
    if (shortened) warnings.push('some category labels are shortened; the source table has them whole');
    // Every category keeps its label (a bar without one has no identity): each is wrapped to its band's step less 4 px,
    // so neighbours never touch and nothing is thinned.
    const svg = wrapped.map((lines, i) => text(band.starts[i] + band.bandwidth / 2, axisY + theme.caption + 8, lines, { anchor: 'middle', fill: theme.muted, line: lineH })).join('');
    xAxis = { svg, height: theme.caption + 8 + (Math.max(...wrapped.map((l) => l.length)) - 1) * lineH + 8, map: (x) => (keys.includes(seriesKey(x)) ? band.starts[keys.indexOf(seriesKey(x))] + band.bandwidth / 2 : null), band: { ...band, keys } };
  } else {
    const xs = series.flatMap((s) => s.marks.map((m) => xValue(m.x)!));
    const scale = xKind === 'time' ? kit.time(domainOf(kit, xs, false), [left, right], 6) : kit.linear(domainOf(kit, xs, false), [left, right], 6, spec.view === 'scatter');
    const labels = tickLabels(scale.ticks, xKind, spec.format?.[spec.x]);
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

  if (spec.view === 'bar') body += bars(series, xAxis.band!, yScale, theme, valueLabels, yFormat);
  else if (spec.view === 'scatter') {
    for (const s of series) {
      const centres = pointsOf(s).filter((p): p is [number, number] => p[1] !== null);
      body += `<path d="${kit.symbols(SHAPES[s.style % SHAPES.length], 64, centres)}" fill="${theme.ink}" fill-opacity="0.72" stroke="${theme.ground}" stroke-width="1"/>`;
    }
    hoverAll();
  } else {
    const base = yScale.map(Math.max(yScale.domain[0], Math.min(0, yScale.domain[1])));
    for (const s of series) {
      const pts = pointsOf(s);
      if (spec.view === 'area') body += `<path d="${kit.area(pts, base)}" fill="${theme.ink}" fill-opacity="0.1"/>`;
      const dash = DASHES[s.style % DASHES.length];
      body += `<path d="${kit.line(pts)}" fill="none" stroke="${theme.ink}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
      if (series.length > 1 && s.marks.length <= 24) {
        const centres = pts.filter((p): p is [number, number] => p[1] !== null);
        body += `<path d="${kit.symbols(SHAPES[s.style % SHAPES.length], 48, centres)}" fill="${theme.ink}" stroke="${theme.ground}" stroke-width="2" paint-order="stroke"/>`;
      }
    }
    body += ends.map((e) => text(xAxis.map(e.m.x)! + 8, e.y + theme.caption * 0.35, e.label)).join('');
    hoverAll();
  }
  if (hover.length > 0)
    body += `<g data-hover="nearest" data-xy="${hover.map((h) => `${px(h.x)},${px(h.y)}`).join(' ')}" data-tips="${hover.map((h) => esc(h.tip.replace(/[\r\n]+/g, ' '))).join('&#10;')}"/>`;

  const height = axisY + xAxis.height;
  const points = series.reduce((n, s) => n + s.marks.length, 0);
  const desc = `${cap(spec.view)} chart of ${ys.join(', ')} by ${spec.x}${spec.series ? ` and ${spec.series}` : ''}, ${points} ${points === 1 ? 'value' : 'values'}${series.length > 1 ? ` in ${series.length} series (${series.map((s) => s.label).join(', ')})` : ''}. The values are in the source table under the figure.`;
  return { svg: frame(theme, height, v.caption, desc, body), warnings };

}

/** A line's end labels (four series or fewer), or none when two would sit closer than a line apart. */
function endLabels(list: Series[], scale: Ticks, theme: Theme, format?: Format): { m: Mark; label: string; y: number }[] {
  if (list.length > 4) return [];
  const out = list.flatMap((s) => {
    const last = [...s.marks].reverse().find((m) => m.y !== null);
    if (!last) return [];
    const value = formatCell(last.y, undefined, format);
    return [{ m: last, label: list.length === 1 ? value : `${s.label} ${value}`, y: scale.map(last.y!) }];
  });
  const sorted = [...out].sort((a, b) => a.y - b.y);
  return sorted.some((e, i) => i > 0 && e.y - sorted[i - 1].y < theme.caption * 1.3) ? [] : out;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

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

function keyMark(view: string, style: number, x: number, y: number, theme: Theme, kit: Kit): string {
  if (view === 'bar') return treated(`M${px(x)},${px(y - 6)}h14v12h-14Z`, { x0: x, y0: y - 6, x1: x + 14, y1: y + 6 }, style, theme);
  if (view === 'scatter') return `<path d="${kit.symbols(SHAPES[style % SHAPES.length], 64, [[x + 7, y]])}" fill="${theme.ink}" fill-opacity="0.72"/>`;
  const dash = DASHES[style % DASHES.length];
  return `<path d="M${px(x)},${px(y)}H${px(x + 16)}" stroke="${theme.ink}" stroke-width="2" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>` + `<path d="${kit.symbols(SHAPES[style % SHAPES.length], 36, [[x + 8, y]])}" fill="${theme.ink}"/>`;
}

/** Columns from the zero line, at most 24 px thick, the data end rounded 4 px, a 2 px ground gap between neighbours. */
function bars(series: Series[], band: { starts: number[]; bandwidth: number; keys: string[] }, y: Ticks, theme: Theme, labels: boolean, format?: Format): string {
  const n = series.length;
  const slot = band.bandwidth / n;
  const thick = Math.max(1, Math.min(24, slot - 2));
  const zero = y.map(Math.max(y.domain[0], Math.min(0, y.domain[1])));
  let out = '';
  series.forEach((s, k) => {
    for (const m of s.marks) {
      if (m.y === null) continue;
      const i = band.keys.indexOf(seriesKey(m.x));
      const x = band.starts[i] + slot * k + (slot - thick) / 2;
      const tip = y.map(m.y);
      out += treated(roundedBar(x, thick, zero, tip), { x0: x, y0: Math.min(zero, tip), x1: x + thick, y1: Math.max(zero, tip) }, n === 1 ? 0 : s.style, theme, ` data-tip="${esc(m.tip)}"`);
      if (labels) {
        const below = m.y < 0;
        out += text(x + thick / 2, below ? tip + theme.caption + 4 : tip - 6, formatCell(m.y, undefined, format), { anchor: 'middle', fill: theme.ink });
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
  if (lines !== '') out += `<path d="${lines}" fill="none" stroke="${theme.ink}" stroke-width="1"/>`;
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
  const { spec, table, theme, kit, warnings } = v;
  if (spec.x === undefined) return failure(theme, states.needs('pie', 'an x column (the slices)'), v.caption);
  const yName = yColumns(spec)[0] ?? (spec.agg === 'count' ? 'count' : undefined);
  if (yName === undefined) return failure(theme, states.needs('pie', 'a y column (the sizes)'), v.caption);
  const xi = table.columns.findIndex((c) => c.name === spec.x);
  const yi = table.columns.findIndex((c) => c.name === yName);
  let slices = table.rows.map((row) => ({ label: formatCell(row[xi], table.columns[xi], spec.format?.[spec.x!]), value: row[yi] }));
  const dropped = slices.filter((s) => !(typeof s.value === 'number' && s.value > 0)).length;
  if (dropped > 0) warnings.push(`${dropped} ${dropped === 1 ? 'slice has' : 'slices have'} no positive ${yName}; not drawn`);
  let kept = slices.filter((s): s is { label: string; value: number } => typeof s.value === 'number' && s.value > 0);
  if (kept.length === 0) return notice(theme, `no positive ${yName} to draw`, v.caption, warnings);
  if (kept.length > 6) {
    const rest = kept.slice(5);
    kept = [...kept.slice(0, 5), { label: `other (${rest.length})`, value: rest.reduce((a, s) => a + s.value, 0) }];
    warnings.push(`${rest.length + 5} slices; the smallest after the first five are drawn as one`);
  }
  slices = kept;
  const total = kept.reduce((a, s) => a + s.value, 0);
  const r = 110;
  const cx = r + 8;
  const cy = r + 12;
  const angles = kit.pie(kept.map((s) => s.value));
  let body = `<g transform="translate(${px(cx)},${px(cy)})">`;
  kept.forEach((s, i) => {
    const tip = `${s.label}: ${formatNumber(s.value, 2)} (${formatNumber((s.value / total) * 100, 1)}%)`;
    body += `<path d="${kit.arc(angles[i].start, angles[i].end, r)}" fill="${theme.ink}" fill-opacity="${TINTS[i % TINTS.length]}" stroke="${theme.ground}" stroke-width="2" stroke-linejoin="round" data-tip="${esc(tip)}"/>`;
  });
  body += '</g>';
  // Each wedge carries its number, the list's key, so a wedge is told from its neighbour by more than its tint: inside
  // a wide wedge (ground on a dark tint, ink on a light one), just outside the rim of a thin one.
  kept.forEach((_, i) => {
    const mid = (angles[i].start + angles[i].end) / 2;
    const wide = angles[i].end - angles[i].start >= 0.45;
    const at = wide ? r * 0.62 : r + 10;
    const dark = TINTS[i % TINTS.length] >= 0.7;
    body += text(cx + Math.sin(mid) * at, cy - Math.cos(mid) * at + theme.caption * 0.35, String(i + 1), { anchor: 'middle', fill: wide && dark ? theme.ground : theme.ink });
  });
  // The labels: a numbered list beside the pie (key tint, number, name, value, share), so no label crowds a thin slice.
  const lx = cx + r + 32;
  const lineH = theme.caption * 2;
  const listTop = cy - (kept.length * lineH) / 2 + theme.caption;
  kept.forEach((s, i) => {
    const y = listTop + i * lineH;
    const share = `${formatNumber((s.value / total) * 100, 1)}%`;
    const room = theme.width - lx - 40 - textWidth(`  ${formatNumber(s.value, 2)}  ${share}`, theme.caption);
    body += `<rect x="${px(lx)}" y="${px(y - theme.caption * 0.85)}" width="14" height="12" rx="2" fill="${theme.ink}" fill-opacity="${TINTS[i % TINTS.length]}"/>`;
    const label = wrap(s.label, theme.caption, Math.max(40, room), 1).lines[0];
    body += text(lx + 22, y, String(i + 1)) + text(lx + 40, y, label) + text(theme.width - 8, y, `${formatNumber(s.value, 2)}  ${share}`, { anchor: 'end', fill: theme.muted });
  });
  const desc = `Pie chart of ${yName} by ${spec.x}, ${kept.length} slices: ${kept.map((s) => `${s.label} ${formatNumber((s.value / total) * 100, 1)}%`).join(', ')}. The values are in the source table under the figure.`;
  return { svg: frame(theme, cy * 2, v.caption, desc, body), warnings };
}

// ---- table ----

function tableView(v: View): Rendered {
  const { spec, table, theme, warnings } = v;
  const names = spec.columns ?? table.columns.map((c) => c.name);
  const cols = names.map((name) => table.columns.find((c) => c.name === name)!);
  const shown = table.rows.slice(0, spec.limit ?? TABLE_ROWS);
  const at = cols.map((c) => table.columns.indexOf(c));
  const cells = shown.map((row) => at.map((i, k) => formatCell(row[i], cols[k], spec.format?.[cols[k].name])));
  const numeric = cols.map((c) => c.type === 'number');
  const size = theme.body;
  // Column widths from the widest cell (head or value), scaled to the width when they overflow; cells then wrap.
  const pad = 12;
  const natural = cols.map((c, k) => Math.max(textWidth(c.name, theme.caption), ...cells.map((r) => textWidth(r[k], size, numeric[k]))) + pad * 2);
  const sum = natural.reduce((a, b) => a + b, 0);
  const widths = sum <= theme.width ? natural : natural.map((w) => Math.max(56, (w / sum) * theme.width));
  const scale = widths.reduce((a, b) => a + b, 0) > theme.width ? theme.width / widths.reduce((a, b) => a + b, 0) : 1;
  const ws = widths.map((w) => w * scale);
  const xs = ws.map((_, k) => ws.slice(0, k).reduce((a, b) => a + b, 0));
  let shortened = false;
  const lineH = size * 1.5;
  const headLines = cols.map((c, k) => wrap(c.name, theme.caption, ws[k] - pad * 2, 2));
  const headH = Math.max(...headLines.map((h) => h.lines.length)) * theme.caption * 1.4 + 16;
  let body = hline(0, theme.width, 0.5, theme.ink);
  headLines.forEach((h, k) => {
    shortened ||= h.shortened;
    body += text(numeric[k] ? xs[k] + ws[k] - pad : xs[k] + pad, 8 + theme.caption, h.lines, { anchor: numeric[k] ? 'end' : 'start', fill: theme.muted, line: theme.caption * 1.4 });
  });
  let y = headH;
  body += hline(0, theme.width, y, theme.rule);
  for (const row of cells) {
    const wrapped = row.map((cell, k) => (numeric[k] ? { lines: [cell], shortened: false } : wrap(cell, size, ws[k] - pad * 2, 3)));
    const h = Math.max(...wrapped.map((w) => w.lines.length)) * lineH + 10;
    wrapped.forEach((w, k) => {
      shortened ||= w.shortened;
      body += text(numeric[k] ? xs[k] + ws[k] - pad : xs[k] + pad, y + 5 + size, w.lines, { anchor: numeric[k] ? 'end' : 'start', size, line: lineH, mono: numeric[k] ? theme.fontMono : undefined });
    });
    y += h;
    body += hline(0, theme.width, y, theme.rule);
  }
  if (shortened) warnings.push('some cells are shortened; the source table has them whole');
  if (table.rows.length > shown.length) {
    body += text(0, y + theme.caption + 10, `${shown.length} of ${table.rows.length} rows; the source table has every row.`, { fill: theme.muted });
    y += theme.caption + 18;
  } else if (table.rows.length === 0) {
    body += text(0, y + theme.caption + 10, states.empty, { fill: theme.muted });
    y += theme.caption + 18;
  }
  const desc = `Table of ${names.join(', ')}, ${table.rows.length} ${table.rows.length === 1 ? 'row' : 'rows'}${table.rows.length > shown.length ? `, the first ${shown.length} shown` : ''}. The source table has every row.`;
  return { svg: frame(theme, y + 4, v.caption, desc, body), warnings };
}
