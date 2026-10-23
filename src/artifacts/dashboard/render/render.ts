// The dashboard's renderer (P3-E2 M3; parent §2 "Views", its binding grade; the route M1 chose, parent Decision Log
// 14): `renderView(spec, table, theme, datasetId) → {svg, warnings}`, a pure function the editor, main's exporters and
// Node all call, so one input is one output everywhere. The output is one standalone SVG: no script, no event attribute,
// no href, no id or `url(...)` reference, no external resource; every text is escaped, every theme value validated
// (`themeFrom`). Equal inputs give byte-equal output: nothing reads a DOM, the locale, the clock or randomness.
//
// WR 68: bars and their legend keys use the governing figure role (house: accent); labels retain text ink. Other figures keep ink.
// There is no categorical palette: series part by dash, marker shape and
// fill treatment, always with a legend (two or more series) or a direct label, never by colour alone; status colours
// are never borrowed. There are six forms: a view whose unfiltered snapshot holds more series identities draws labelled
// small multiples instead (parent Decision Log 27), one panel per series in the first form, named above it, in up to
// four columns on one shared x and y scale, at most 24 panels (past them the named state "too many series"). Hover is
// the host's handler around the figure; the figure carries none. A discrete mark (a bar,
// a wedge) names its value in `data-tip` and is its own hit target (a bar's hatching is drawn `pointer-events="none"`,
// so its strokes never take the bar's pointer); the points of a line, an area or a scatter, every drawable one, sit in
// one empty layer, `<g data-hover="nearest" data-xy="x,y …" data-tips="…">` (tips one per line), which the host
// searches for the point nearest the pointer, so hover reaches every value without one element per point.
import type { ExportViewTable } from '../../document/export/source';
import type { Cell } from '../datasets';
import { parseSpec, type ValueFormat, type ViewSpec } from '../spec';
import { DATASET_STATES, VIEW_STATES } from '../states';
import * as geo from './geometry';
import { SHAPES, type Point, type Ticks } from './geometry';
import { decimalsFor, esc, formatClock, formatInstant, formatNumber, formatValue, px, unitOf, type Theme } from './svg';
import { textWidth, wrap } from './text';
import { columnFormat, instantOf, overflowKey, shownColumns, transform, typedKey, type ViewColumn, type ViewData, type ViewTable } from './transform';

/**
 * A view's one output (parent Decision Log 24): a chart is an SVG, a table an HTML `<table>` (text, not a picture), so
 * exactly one of `svg` and `html` is set. A state drawn in place (an error, an empty view) is an SVG frame for every
 * kind.
 */
export type Rendered = ({ svg: string; html?: never; table?: never } | { html: string; table: ExportViewTable; svg?: never }) & {
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
/** The stable forms (DASHES, SHAPES, BAR_FILLS): a view whose unfiltered identities number more draws small multiples. */
const MAX_FORMS = 6;
// Small multiples (parent Decision Log 27): one labelled panel per series, up to four columns, at most 24 panels.
const MAX_PANELS = 24;
const PANEL_COLUMNS = 4;
const PANEL_H = 120;
const PANEL_GAP = 24;
const PANEL_ROW_GAP = 16;
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
 * interpretation the figure and the table draw, with what it could not compute (its notes, and which cells overflowed),
 * or why there is none. */
export function viewRows(
  spec: unknown,
  table: ViewTable,
  datasetId: string,
): { ok: true; table: ViewTable; notes: string[]; overflowed(row: number, column: number): boolean } | { ok: false; error: string } {
  const parsed = parseSpec(spec);
  if (!parsed.ok) return parsed;
  const shaped = transform(table, parsed.spec, datasetId);
  if (!shaped.ok) return shaped;
  const { data } = shaped;
  // a table view's `columns` project the view; every other view inspects all of its columns
  const at = parsed.spec.view === 'table' && parsed.spec.columns ? shownColumns(data, parsed.spec) : null;
  return {
    ok: true,
    table: at ? { columns: at.map((i) => data.table.columns[i]), rows: data.table.rows.map((row) => at.map((i) => row[i] ?? null)) } : data.table,
    notes: data.notes,
    overflowed: (row, column) => data.overflow.has(overflowKey(row, at ? at[column] : column)),
  };
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
    if (format === 'percent') return `${formatValue(value * 100, 1)}%`;
    if (format === 'text') return String(value);
    return formatValue(value, 2);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (column?.type === 'date' && format !== 'text') {
    const ms = instantOf(value);
    if (ms === null) return value;
    if (value.length === 10) return formatInstant(ms, 'day');
    // a date-time to the minute, finer when the value is (E2 panel): seconds, then milliseconds
    const grain = unitOf([ms]);
    return `${formatInstant(ms, 'day')} ${formatClock(ms, grain === 'second' || grain === 'millisecond' ? grain : 'minute')} UTC`;
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
  /** Its value is an aggregate past the largest number (the transform's note says so), not a missing one. */
  overflow: boolean;
}
interface Series extends Entry {
  marks: Mark[];
  /** The form it is drawn in: its identity's (`style`) in one figure, the first in its own panel. */
  form: number;
  /** The format of the measure it draws (each y its own). */
  format?: ValueFormat;
  /** Its series value's name ('' without a series column) and its measure's name, as its tips say them. */
  seriesName: string;
  measure: string;
}

/** Where a plot sits in the figure: its box, where its x labels go (null: a panel below carries them) and the room
 * those labels may take at its edges. */
interface Plot {
  series: Series[];
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  axisY: number | null;
  lo: number;
  hi: number;
}

/** The x axis in a plot's own units (0 at its left edge), alike for every panel: a value's place, the labels, their
 * height, and a bar view's bands. */
interface XAxis {
  at(x: Cell): number | null;
  labels: { x: number; lines: string[]; anchor?: 'middle' }[];
  height: number;
  band?: { starts: number[]; bandwidth: number; keys: string[] };
}

const TYPE_NAMES = { number: 'number', string: 'text', boolean: 'true or false' } as const;
/** A value's type as a qualifier, for two values that read alike (the number 1 and the text "1"). */
const typeName = (value: Cell): string => (value === null ? 'empty' : TYPE_NAMES[typeof value as keyof typeof TYPE_NAMES]);

/**
 * The series values' names over the unfiltered snapshot's identities (`seriesKeys`), so a filter never renames one:
 * each value's name, qualified by its type where values of two types read alike ("1 (number)", "1 (text)").
 */
function seriesNames(seriesKeys: string[], column: ViewColumn, format: ValueFormat | undefined): Map<string, string> {
  const names = new Map(seriesKeys.map((key) => [key, nameOf(JSON.parse(key) as Cell, column, format)]));
  const readers = new Map<string, string[]>();
  for (const [key, name] of names) readers.set(name, [...(readers.get(name) ?? []), key]);
  for (const [name, keys] of readers) if (keys.length > 1) for (const key of keys) names.set(key, `${name} (${typeName(JSON.parse(key) as Cell)})`);
  const distinct = distinctNames([...names.values()]);
  return new Map([...names.keys()].map((key, i) => [key, distinct[i]]));
}

/**
 * Names told apart over their whole domain, in its order (E2 M6): the first of a name keeps it; a later one gains " (n)",
 * n the least that no name of the domain reads as and none given yet, so a generated suffix never takes a source
 * label ("y (2)" beside a measure named so) and a name never depends on which others a filter kept.
 */
function distinctNames(names: readonly string[]): string[] {
  const domain = new Set(names);
  const given = new Set<string>();
  return names.map((name) => {
    let shown = name;
    for (let n = 2; given.has(shown) || (shown !== name && domain.has(shown)); n += 1) shown = `${name} (${n})`;
    given.add(shown);
    return shown;
  });
}

/**
 * A panel's name in at most two lines of `width`. A name too long for them keeps its first line and its end ("…" and
 * as much of the end as fits), since names that share a long beginning ("… 1번 관측소", "… 2번 관측소") differ at it.
 */
function panelTitle(label: string, size: number, width: number): { lines: string[]; shortened: boolean } {
  const whole = wrap(label, size, width, 2);
  if (!whole.shortened) return whole;
  const chars = [...label];
  let from = chars.length;
  while (from > 0 && textWidth(`…${chars.slice(from - 1).join('')}`, size) <= width) from -= 1;
  return { lines: [wrap(label, size, width, Infinity).lines[0], `…${chars.slice(from).join('').trimStart()}`], shortened: true };
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
  const formats = ys.map((y) => columnFormat(spec, data, y));
  const xFormat = columnFormat(spec, data, xi);
  warnings.push(...data.notes);

  // Series: by the series column's typed values (identity, name and form from the unfiltered snapshot), or one per y.
  const si = data.series;
  const names = si === undefined ? null : seriesNames(data.seriesKeys, table.columns[si], columnFormat(spec, data, si));
  const rank = new Map(data.seriesKeys.map((key, i) => [key, i]));
  // Every entry's label over the unfiltered domain (each series by each measure, in form order), told apart there: two
  // that still read alike (a series name holding " · ", a y named twice) are numbered the same under any filter (E2 M6).
  const domain = si === undefined ? ys.map((_, k) => ({ key: `y${k}`, label: yName(k) })) : data.seriesKeys.flatMap((sk) => ys.map((_, k) => ({ key: `${sk}\u0000${k}`, label: ys.length > 1 ? `${names!.get(sk)} · ${yName(k)}` : names!.get(sk)! })));
  const shownLabels = distinctNames(domain.map((entry) => entry.label));
  const labelOf = new Map(domain.map((entry, i) => [entry.key, shownLabels[i]]));
  const all: Series[] = [];
  const byKey = new Map<string, Series>();
  table.rows.forEach((row, r) =>
    ys.forEach((yi, k) => {
      const value = si === undefined ? null : (row[si] ?? null);
      const key = si === undefined ? `y${k}` : `${typedKey(value)}\u0000${k}`;
      let s = byKey.get(key);
      if (!s) {
        const seriesName = names?.get(typedKey(value)) ?? '';
        const label = labelOf.get(key)!;
        const style = si === undefined ? k : (rank.get(typedKey(value)) ?? 0) * ys.length + k;
        s = { key, label, style, form: style, marks: [], format: formats[k], seriesName, measure: yName(k) };
        byKey.set(key, s);
        all.push(s);
      }
      const y = row[yi];
      s.marks.push({ x: row[xi] ?? null, y: typeof y === 'number' && Number.isFinite(y) ? y : null, tip: '', overflow: data.overflow.has(overflowKey(r, yi)) });
    }),
  );
  all.sort((a, b) => a.style - b.style);
  // More identities than forms: one labelled panel each, each in the first form (parent Decision Log 27). The domain is
  // the unfiltered snapshot's, so a filter to S0 and S6 of seven stays two named panels and never cycles a form.
  const faceted = (si === undefined ? ys.length : data.seriesKeys.length * ys.length) > MAX_FORMS;
  if (faceted && all.length > MAX_PANELS) return notice(theme, VIEW_STATES.tooManySeries(all.length), v.caption, warnings);
  if (faceted) for (const s of all) s.form = 0;

  // A magnitude past ±1e306 would overflow a scale's span; it is counted and not drawn, never clamped.
  const xKind: 'band' | 'time' | 'linear' = spec.view === 'bar' || xCol.type === 'string' || xCol.type === 'boolean' ? 'band' : xCol.type === 'date' ? 'time' : 'linear';
  const xValue = (x: Cell) => (xKind === 'time' ? instantOf(x) : typeof x === 'number' && Number.isFinite(x) ? x : null);
  let huge = 0;
  for (const s of all)
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
  for (const s of all) for (const m of s.marks) if (m.y === null && !m.overflow) nullY += 1;
  nullY -= huge;
  if (nullY > 0) warnings.push(VIEW_STATES.missing(nullY, ys.map((_, k) => yName(k)).join(', ')));
  if (xKind !== 'band') {
    let nullX = 0;
    for (const s of all) for (const m of s.marks) if (m.y !== null && xValue(m.x) === null) nullX += 1;
    if (nullX > 0) warnings.push(VIEW_STATES.missing(nullX, xCol.name));
    for (const s of all) {
      s.marks = s.marks.filter((m) => xValue(m.x) !== null);
      // A line is drawn along x; the data's order is kept for everything else (the table, the tips).
      if (spec.view !== 'scatter') s.marks = s.marks.map((m, i) => ({ m, i })).sort((a, b) => xValue(a.m.x)! - xValue(b.m.x)! || a.i - b.i).map(({ m }) => m);
    }
  } else for (const s of all) s.marks = s.marks.filter((m) => !(m.x === null && m.y === null));
  const named = si !== undefined && (faceted || all.length > 1);
  for (const s of all) for (const m of s.marks) m.tip = `${formatCell(m.x, xCol, xFormat)}${named ? ` · ${s.seriesName}` : ''} · ${s.measure}: ${formatCell(m.y, undefined, s.format)}`;

  const yValues: number[] = [];
  for (const s of all) for (const m of s.marks) if (m.y !== null) yValues.push(m.y);
  if (yValues.length === 0) {
    const why = nullY > 0 ? VIEW_STATES.missing(nullY, ys.map((_, k) => yName(k)).join(', ')) : huge > 0 ? VIEW_STATES.tooLarge(huge) : (data.notes[0] ?? VIEW_STATES.empty);
    return notice(theme, why, v.caption, warnings.filter((w) => w !== why));
  }
  // One y domain for every panel (a scale's ticks depend on its domain alone), its labels in the measures' common
  // format, else raw numbers. A range no scale can span (geo.linear's floor, E2 panel) is the named state in place,
  // decided before any tick is asked for; so is an x range of numbers.
  const yDomain = domainOf(yValues, spec.view === 'bar' || spec.view === 'area');
  const yScale0 = geo.linear(yDomain, [1, 0], 5, true);
  if (yScale0 === null) return notice(theme, VIEW_STATES.unsupportedDomain(ys.map((_, k) => yName(k)).join(', ')), v.caption, warnings);
  const xs: number[] = [];
  if (xKind !== 'band') for (const s of all) for (const m of s.marks) xs.push(xValue(m.x)!);
  const xDomain = domainOf(xs, false);
  if (xKind === 'linear' && geo.linear(xDomain, [0, 1], 6, spec.view === 'scatter') === null) return notice(theme, VIEW_STATES.unsupportedDomain(xCol.name), v.caption, warnings);
  // admitted above by its domain alone, so a scale over any range exists
  const yScaleOver = (bottom: number, top: number) => geo.linear(yDomain, [bottom, top], 5, true)!;
  const yLabels = tickLabels(yScale0.ticks, 'linear', commonFormat(all.map((s) => s.format)));
  const left = Math.ceil(largest(yLabels.map((l) => textWidth(l, theme.caption)), 0)) + 10;
  const lineH = theme.caption * 1.4;

  // The x axis over a plot `width` wide, shared by every panel: every category of every series, or the whole x domain.
  const xAxisOf = (width: number): XAxis => {
    if (xKind === 'band') {
      const keys: string[] = [];
      const labelFor = new Map<string, string>();
      for (const s of all)
        for (const m of s.marks) {
          const key = typedKey(m.x);
          if (labelFor.has(key)) continue;
          labelFor.set(key, nameOf(m.x, xCol, xFormat));
          keys.push(key);
        }
      const band = geo.band(keys.length, [0, width], 0.2, 0.1);
      let shortened = false;
      // Every category keeps its label (a bar without one has no identity): each is wrapped to its band's step less
      // 4 px, so neighbours never touch and nothing is thinned.
      const wrapped = keys.map((k) => {
        const w = wrap(labelFor.get(k)!, theme.caption, band.bandwidth / 0.8 - 4, 2);
        shortened ||= w.shortened;
        return w.lines;
      });
      if (shortened) warnings.push(VIEW_STATES.labelsShortened);
      const centre = new Map(keys.map((k, i) => [k, band.starts[i] + band.bandwidth / 2]));
      return {
        at: (x) => centre.get(typedKey(x)) ?? null,
        labels: wrapped.map((lines, i) => ({ x: band.starts[i] + band.bandwidth / 2, lines, anchor: 'middle' })),
        height: theme.caption + 8 + (largest(wrapped.map((l) => l.length), 1) - 1) * lineH + 8,
        band: { ...band, keys },
      };
    }
    const scale = xKind === 'time' ? geo.time(xDomain, [0, width], 6) : geo.linear(xDomain, [0, width], 6, spec.view === 'scatter')!;
    const labels = tickLabels(scale.ticks, xKind, xFormat);
    const every = thinning(
      labels.map((l) => textWidth(l, theme.caption)),
      scale.ticks.length > 1 ? Math.abs(scale.map(scale.ticks[1]) - scale.map(scale.ticks[0])) : theme.width,
    );
    return {
      at: (x) => (xValue(x) === null ? null : scale.map(xValue(x)!)),
      labels: scale.ticks.flatMap((t, i) => (i % every === 0 ? [{ x: scale.map(t), lines: [labels[i]] }] : [])),
      height: theme.caption + 16,
    };
  };

  // The layout: one figure (legend on top, the plot, the x axis), or the panels in rows of up to four, each named above
  // its plot, the y labels beside each row's first panel, the x labels under the last panel of each column.
  let head = '';
  let ends: { m: Mark; label: string; y: number }[] = [];
  let valueLabels = false;
  let xAxis: XAxis;
  const plots: Plot[] = [];
  const titles: string[][] = [];
  let height: number;
  if (!faceted) {
    const top = 8;
    const lg = legend(all, theme, 0, top, (entry, x, y) => keyMark(spec.view, entry.style, x, y, theme));
    head = lg.svg;
    let barCount = 0;
    if (spec.view === 'bar') for (const s of all) barCount += s.marks.length;
    valueLabels = spec.view === 'bar' && barCount <= 16;
    const plotTop = top + lg.height + (valueLabels ? theme.caption + 10 : 6);
    // A negative bar's value sits below its tip, so the scale stops short of the axis labels by one label's room.
    const room = valueLabels && yValues.some((y) => y < 0) ? theme.caption + 10 : 0;
    const plotBottom = plotTop + PLOT_H - room;
    // Direct labels at a line's end (four series or fewer, separated), else the legend carries identity.
    ends = spec.view === 'line' || spec.view === 'area' ? endLabels(all, yScaleOver(plotBottom, plotTop), theme) : [];
    const right = theme.width - (ends.length > 0 ? Math.min(160, largest(ends.map((e) => textWidth(e.label, theme.caption)), 0) + 14) : 8);
    xAxis = xAxisOf(right - left);
    plots.push({ series: all, x0: left, x1: right, top: plotTop, bottom: plotBottom, axisY: plotBottom + room, lo: 0, hi: theme.width });
    height = plotBottom + room + xAxis.height;
  } else {
    const n = all.length;
    const cols = Math.min(PANEL_COLUMNS, n);
    const width = (theme.width - 8 - left - (cols - 1) * PANEL_GAP) / cols;
    xAxis = xAxisOf(width);
    let shortened = false;
    for (const s of all) {
      const w = panelTitle(s.label, theme.caption, width);
      shortened ||= w.shortened;
      titles.push(w.lines);
    }
    if (shortened) warnings.push(VIEW_STATES.seriesNamesShortened);
    const titleH = largest(titles.map((t) => t.length), 1) * lineH + 6;
    let rowTop = 8;
    for (let first = 0; first < n; first += cols) {
      const top = rowTop + titleH;
      const bottom = top + PANEL_H;
      let labelled = false;
      for (let i = first; i < Math.min(n, first + cols); i += 1) {
        const col = i - first;
        const x0 = left + col * (width + PANEL_GAP);
        const below = i + cols < n; // a panel under it carries the column's x labels
        labelled ||= !below;
        plots.push({ series: [all[i]], x0, x1: x0 + width, top, bottom, axisY: below ? null : bottom, lo: col === 0 ? 0 : x0 - PANEL_GAP / 2, hi: col === cols - 1 ? theme.width : x0 + width + PANEL_GAP / 2 });
      }
      rowTop = bottom + (labelled ? xAxis.height : 0) + PANEL_ROW_GAP;
    }
    height = rowTop - PANEL_ROW_GAP;
  }

  // Each plot: hairline rules at the y ticks (the zero line, inside the domain, a step darker), its x labels, its marks;
  // every drawable point of a line, an area or a scatter into the one nearest-point layer, in figure units.
  const hover: { x: number; y: number; tip: string }[] = [];
  const drawPlot = (p: Plot): string => {
    const yScale = yScaleOver(p.bottom, p.top);
    const mapX = (x: Cell) => p.x0 + xAxis.at(x)!;
    let out = yScale.ticks.map((t) => hline(p.x0, p.x1, yScale.map(t), theme.rule)).join('');
    if (yScale.domain[0] < 0 && yScale.domain[1] > 0) out += hline(p.x0, p.x1, yScale.map(0), theme.muted);
    if (p.axisY !== null) {
      const y = p.axisY + theme.caption + 8;
      out += xAxis.labels.map((l) => text(p.x0 + l.x, y, l.lines, { anchor: l.anchor ?? edgeAnchor(p.x0 + l.x, l.lines[0], p.lo, p.hi, theme), fill: theme.muted, line: lineH })).join('');
    }
    const pointsOf = (s: Series): Point[] => s.marks.map((m) => [mapX(m.x), m.y === null ? null : yScale.map(m.y)] as const);
    const hoverAll = () => {
      for (const s of p.series) for (const m of s.marks) if (m.y !== null) hover.push({ x: mapX(m.x), y: yScale.map(m.y), tip: m.tip });
    };
    if (spec.view === 'bar') out += bars(p.series, { ...xAxis.band!, starts: xAxis.band!.starts.map((s) => p.x0 + s) }, yScale, theme, valueLabels);
    else if (spec.view === 'scatter') {
      for (const s of p.series) {
        const centres = pointsOf(s).filter((pt): pt is [number, number] => pt[1] !== null);
        out += `<path d="${geo.symbols(SHAPES[s.form % SHAPES.length], 64, centres)}" fill="${theme.ink}" fill-opacity="0.72" stroke="${theme.ground}" stroke-width="1"/>`;
      }
      hoverAll();
    } else {
      const base = yScale.map(Math.max(yScale.domain[0], Math.min(0, yScale.domain[1])));
      for (const s of p.series) {
        const pts = pointsOf(s);
        if (spec.view === 'area') out += `<path d="${geo.area(pts, base)}" fill="${theme.ink}" fill-opacity="0.1"/>`;
        const dash = DASHES[s.form % DASHES.length];
        out += `<path d="${geo.line(pts)}" fill="none" stroke="${theme.ink}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
        if (p.series.length > 1 && s.marks.length <= 24) {
          const centres = pts.filter((pt): pt is [number, number] => pt[1] !== null);
          out += `<path d="${geo.symbols(SHAPES[s.form % SHAPES.length], 48, centres)}" fill="${theme.ink}" stroke="${theme.ground}" stroke-width="2" paint-order="stroke"/>`;
        }
      }
      out += ends.map((e) => text(mapX(e.m.x) + 8, e.y + theme.caption * 0.35, e.label)).join('');
      hoverAll();
    }
    return out;
  };

  let body = head;
  // the y labels, once per row of plots, beside its first
  for (const p of plots) {
    if (p.x0 !== left) continue;
    const yScale = yScaleOver(p.bottom, p.top);
    body += yScale.ticks.map((t, i) => text(left - 8, yScale.map(t) + theme.caption * 0.35, yLabels[i], { anchor: 'end', fill: theme.muted })).join('');
  }
  if (!faceted) body += drawPlot(plots[0]);
  else plots.forEach((p, i) => (body += `<g role="group" aria-label="${esc(all[i].label)}">${text(p.x0, p.top - (titles[i].length - 1) * lineH - 6 - theme.caption * 0.3, titles[i], { line: lineH })}${drawPlot(p)}</g>`));
  if (hover.length > 0)
    body += `<g data-hover="nearest" data-xy="${hover.map((h) => `${px(h.x)},${px(h.y)}`).join(' ')}" data-tips="${hover.map((h) => esc(h.tip.replace(/[\r\n]+/g, ' '))).join('&#10;')}"/>`;

  let points = 0;
  for (const s of all) points += s.marks.length;
  const measured = ys.map((_, k) => yName(k)).join(', ');
  const among = faceted ? ` in ${all.length} ${all.length === 1 ? 'panel' : 'panels'} sharing one scale (${all.map((s) => s.label).join(', ')})` : all.length > 1 ? ` in ${all.length} series (${all.map((s) => s.label).join(', ')})` : '';
  const desc = `${cap(spec.view)} chart of ${measured} by ${xCol.name}${spec.series ? ` and ${spec.series}` : ''}, ${points} ${points === 1 ? 'value' : 'values'}${among}. The values are in the source table under the figure.`;
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

/** A label at the edge of its room (the frame, or a panel's share of it) anchors inward, so it never leaves it. */
function edgeAnchor(x: number, label: string, lo: number, hi: number, theme: Theme): 'start' | 'middle' | 'end' {
  const half = textWidth(label, theme.caption) / 2;
  if (x - half < lo) return 'start';
  if (x + half > hi) return 'end';
  return 'middle';
}

function keyMark(view: string, style: number, x: number, y: number, theme: Theme): string {
  if (view === 'bar') return treated(`M${px(x)},${px(y - 6)}h14v12h-14Z`, { x0: x, y0: y - 6, x1: x + 14, y1: y + 6 }, style, theme);
  if (view === 'scatter') return `<path d="${geo.symbols(SHAPES[style % SHAPES.length], 64, [[x + 7, y]])}" fill="${theme.ink}" fill-opacity="0.72"/>`;
  const dash = DASHES[style % DASHES.length];
  return `<path d="M${px(x)},${px(y)}H${px(x + 16)}" stroke="${theme.ink}" stroke-width="2" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>` + `<path d="${geo.symbols(SHAPES[style % SHAPES.length], 36, [[x + 8, y]])}" fill="${theme.ink}"/>`;
}

/** Columns from the zero line, at most 24 px thick, the data end rounded 4 px, a 2 px ground gap between neighbours; each
 * in its series' own form (a series alone after a filter keeps the form it has in the whole snapshot; a panel's, the first).
 * Without `agg` every row is drawn, so the drawable rows a series repeats at one category share its slot side by side, in
 * the rows' order, each its own bar, value label and tip (the owner's S-REPEATED-BARS); a lone row has the whole slot. */
function bars(series: Series[], band: { starts: number[]; bandwidth: number; keys: string[] }, y: Ticks, theme: Theme, labels: boolean): string {
  const n = series.length;
  const slot = band.bandwidth / n;
  const zero = y.map(Math.max(y.domain[0], Math.min(0, y.domain[1])));
  const at = new Map(band.keys.map((key, i) => [key, band.starts[i]]));
  let out = '';
  series.forEach((s, k) => {
    const rows = new Map<string, number>();
    for (const m of s.marks) if (m.y !== null) rows.set(typedKey(m.x), (rows.get(typedKey(m.x)) ?? 0) + 1);
    const placed = new Map<string, number>();
    for (const m of s.marks) {
      if (m.y === null) continue;
      const key = typedKey(m.x);
      const i = placed.get(key) ?? 0;
      placed.set(key, i + 1);
      const sub = slot / rows.get(key)!;
      const thick = Math.max(1, Math.min(24, sub - 2));
      const x = at.get(key)! + slot * k + sub * i + (sub - thick) / 2;
      const tip = y.map(m.y);
      out += treated(roundedBar(x, thick, zero, tip), { x0: x, y0: Math.min(zero, tip), x1: x + thick, y1: Math.max(zero, tip) }, s.form, theme, ` data-tip="${esc(m.tip)}"`);
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
  if (fill.solid) return `<path d="${d}" fill="${theme.barInk}" fill-opacity="${TINTS[0]}"${extra}/>`;
  let out = `<path d="${d}" fill="${theme.ground}" stroke="${theme.barInk}" stroke-width="1.5"${fill.dash ? ` stroke-dasharray="${fill.dash}"` : ''}${extra}/>`;
  const lines = fill.hatch.map((angle) => hatch(box.x0 + 2, box.y0 + 2, box.x1 - 2, box.y1 - 2, angle)).join('');
  // the hatching decorates the bar beneath it and never takes the bar's pointer (its tip), its strokes included
  if (lines !== '') out += `<path d="${lines}" fill="none" stroke="${theme.barInk}" stroke-width="1" pointer-events="none"/>`;
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
  const format = columnFormat(spec, data, yi);
  const xFormat = columnFormat(spec, data, xi);
  warnings.push(...data.notes);
  const slices = table.rows.map((row, r) => ({ label: nameOf(row[xi] ?? null, table.columns[xi], xFormat), value: row[yi] ?? null, overflow: data.overflow.has(overflowKey(r, yi)) }));
  const positive = (value: Cell): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
  const huge = slices.filter((s) => positive(s.value) && s.value > DRAWABLE).length;
  if (huge > 0) warnings.push(VIEW_STATES.tooLarge(huge));
  const dropped = slices.filter((s) => !positive(s.value) && !s.overflow).length; // an overflow is the transform's note
  if (dropped > 0) warnings.push(VIEW_STATES.slicesDropped(dropped, yName));
  let kept = slices.flatMap((s) => (positive(s.value) && s.value <= DRAWABLE ? [{ label: s.label, value: s.value }] : []));
  if (kept.length > 6) {
    // the five largest keep their names, in the view's order (equal sizes by it too); the smaller rest fold into one (E2 panel)
    const largestFive = new Set(
      kept
        .map((s, i) => ({ value: s.value, i }))
        .sort((a, b) => b.value - a.value || a.i - b.i)
        .slice(0, 5)
        .map(({ i }) => i),
    );
    const rest = kept.filter((_, i) => !largestFive.has(i));
    let other = 0;
    for (const s of rest) other += s.value;
    kept = [...kept.filter((_, i) => largestFive.has(i)), { label: `other (${rest.length})`, value: other }];
    warnings.push(VIEW_STATES.slicesFolded(rest.length + 5));
  }
  let total = 0;
  for (const s of kept) total += s.value;
  if (kept.length === 0 || !Number.isFinite(total)) {
    const why = kept.length > 0 ? VIEW_STATES.tooLarge(kept.length) : dropped === 0 && huge === 0 && data.notes.length > 0 ? data.notes[0] : VIEW_STATES.noPositive(yName);
    return notice(theme, why, v.caption, warnings.filter((w) => w !== why));
  }
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
 * limit), "no rows to draw" when it holds none, and the transform's notes (an aggregate that overflowed, its cell
 * saying "overflow"). Only table elements and `class` attributes: numbers right-aligned by class, the notes a bottom
 * caption. The page's and the exporters' stylesheets draw it. Each column takes its role's format (`columnFormat`).
 */
function tableView(v: View): Rendered {
  const table = preview(v.spec, v.data, shownColumns(v.data, v.spec));
  const cell = (tag: 'th' | 'td', k: number, content: string) => `<${tag}${table.columns[k].numeric ? ' class="dash-num"' : ''}>${html(content)}</${tag}>`;
  const head = `<thead><tr>${table.columns.map((c, k) => cell('th', k, c.name)).join('')}</tr></thead>`;
  const rows = table.rows.map((row) => `<tr>${row.map((value, k) => cell('td', k, value)).join('')}</tr>`).join('');
  const { notes } = table;
  return { html: `<table class="dash-table">${notes.length > 0 ? `<caption class="dash-table-note">${html(notes.join(' · '))}</caption>` : ''}${head}<tbody>${rows}</tbody></table>`, table, warnings: v.warnings };
}

/**
 * P3-E2 M5 (E's Decision Log 32): the one preview formatter. The transformed view's columns `at`, each in its role's
 * format, its first rows in spec order (`TABLE_VIEW_ROWS` without a `limit`, the `limit` up to `TABLE_VIEW_MAX_ROWS`
 * with one), and its notes: "first <n> of <N> rows" when it shows fewer than the view holds, "no rows to draw" when it
 * holds none, then the transform's (an overflowed aggregate, its cell "overflow"). The table view's HTML, Word's native
 * cells and a Markdown export's GFM are all written from this, never from one another.
 */
function preview(spec: ViewSpec, data: ViewData, at: number[]): ExportViewTable {
  const { table } = data;
  const cols = at.map((i) => table.columns[i]);
  const formats = at.map((i) => columnFormat(spec, data, i));
  const bound = spec.limit === undefined ? TABLE_VIEW_ROWS : Math.min(spec.limit, TABLE_VIEW_MAX_ROWS);
  const shown = table.rows.slice(0, bound);
  const value = (row: readonly Cell[], r: number, i: number, k: number) => (data.overflow.has(overflowKey(r, i)) ? VIEW_STATES.overflowCell : formatCell(row[i] ?? null, cols[k], formats[k]));
  const notes = [table.rows.length === 0 ? VIEW_STATES.empty : table.rows.length > shown.length ? VIEW_STATES.tablePreview(shown.length, table.rows.length) : null, ...data.notes].filter((n): n is string => n !== null);
  return { columns: cols.map((c) => ({ name: c.name, numeric: c.type === 'number' })), rows: shown.map((row, r) => at.map((i, k) => value(row, r, i, k))), notes };
}

/**
 * P3-E2 M5: a view's data as `preview` bounds and notes it: a table view's shown columns, a chart's the figure's roles
 * (its x, its series, each measure, as the transform aggregated them), or why there is none (the state its figure draws).
 */
export function viewPreview(spec: unknown, table: ViewTable, datasetId: string): { ok: true; table: ExportViewTable } | { ok: false; error: string } {
  const parsed = parseSpec(spec);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const shaped = transform(table, parsed.spec, datasetId);
  if (!shaped.ok) return shaped;
  const { data } = shaped;
  const roles = [...new Set([data.x, data.series, ...data.ys].filter((i): i is number => i !== undefined))];
  const at = parsed.spec.view === 'table' || roles.length === 0 ? shownColumns(data, parsed.spec) : roles;
  return { ok: true, table: preview(parsed.spec, data, at) };
}

/** P3-E2 M5: a figure's size in CSS px, as its root element states it (`frame` writes both). */
export function svgSize(svg: string): { width: number; height: number } {
  const root = /^<svg [^>]*?width="([\d.]+)" height="([\d.]+)"/.exec(svg);
  if (!root) throw new Error('not a figure of this renderer');
  return { width: Number(root[1]), height: Number(root[2]) };
}
