// A view's data semantics (P3-E2 M3; the execution document's M3 "Data semantics"): filter before grouping; with `agg`,
// group by x (and series) in first-seen order and aggregate each y (`count` counts rows); a stable sort after
// aggregation; `limit` last. Without `agg` every row stays. A column the spec names that the table lacks is the shared
// error, never a silent omission. The one interpretation every consumer reads: the figure, the table view, the source
// sheet's view rows and (M5) the exporters.
//
// What each output column is for is carried by its index (`x`, `series`, `ys`), never by its name, so a measure and a
// grouping column of one name stay apart: `{x: region, y: region, agg: count}` groups by region and counts its rows. A
// measure is named by its y, or `<agg> of <y>` when that name is a grouping column's (the implicit count is `count`, or
// `count of rows`); `sort.by` and a table's `columns` name the output's columns. Series identity is the unfiltered
// snapshot's, in first-seen order, by a typed key (the number 1, the text "1" and an empty cell are three series), so a
// filter never renumbers a surviving series' form. A sum past the largest number is no value with a reason: its cell is
// held as null and marked (`overflow`), with a note naming the measure (parent Decision Log 27), which every consumer
// shows. Nothing here reads the locale, the clock or a DOM; nothing spreads a data-sized array into a call.
import type { Cell } from '../datasets';
import { isIsoDate } from '../parse';
import { DATASET_STATES, VIEW_STATES } from '../states';
import { SPEC_LIMITS, yColumns, type ValueFormat, type ViewFilter, type ViewSpec } from '../spec';

export interface ViewColumn {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'null';
}
/** What a view draws from: a snapshot's columns and rows as the host's reader answers them. */
export interface ViewTable {
  columns: readonly ViewColumn[];
  rows: readonly (readonly Cell[])[];
}

/** The transformed view: its table, and which of its columns are the x, the series and each y (by index). */
export interface ViewData {
  table: ViewTable;
  x?: number;
  series?: number;
  ys: number[];
  /** Each measure's source column, in `ys`' order (null for the implicit count): whose `format` it takes. */
  ySources: (string | null)[];
  /** The unfiltered snapshot's series, by typed key, in first-seen order. */
  seriesKeys: string[];
  /** The aggregated cells past the largest number, held as null, by `overflowKey(row, column)` of `table`. */
  overflow: ReadonlySet<string>;
  /** What the view could not compute as asked: one note per measure that overflowed in the rows it keeps. */
  notes: string[];
}

export const overflowKey = (row: number, column: number): string => `${row}:${column}`;

/** A column's format by its role: a measure's its source column's, else its own name's (a renamed measure keeps the
 * format its source asks for, parent Decision Log 27); a grouping or raw column its name's. */
export function columnFormat(spec: ViewSpec, data: ViewData, column: number): ValueFormat | undefined {
  const k = data.ys.indexOf(column);
  const source = k < 0 ? null : data.ySources[k];
  return (source !== null ? spec.format?.[source] : undefined) ?? spec.format?.[data.table.columns[column]?.name ?? ''];
}

export type Transformed = { ok: true; data: ViewData } | { ok: false; error: string };

/** A cell's identity as a key: its type and value (the number 1, the text "1" and null are three keys). */
export const typedKey = (value: Cell): string => JSON.stringify(value);

// The host's date grammar (parse.ts): an ISO calendar date, or a zoned ISO date-time with up to nine fraction digits.
const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):(\d{2})))?$/;

/**
 * A date cell's instant in UTC milliseconds (a calendar date at its UTC midnight), or null; never local time. Only a
 * value the host's own grammar admits (`isIsoDate`: a real calendar day and clock time) has one, so a retained mismatch
 * such as 2026-02-30 is never rolled into March; the year is set whole (`setUTCFullYear`), so 0000 to 0099 keep their
 * own years rather than `Date.UTC`'s 1900s (E2 panel).
 */
export function instantOf(value: Cell): number | null {
  if (typeof value !== 'string' || !isIsoDate(value)) return null;
  const m = DATE.exec(value);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0', fraction = '', zone, sign, zh = '0', zm = '0'] = m;
  const offset = zone === undefined || zone === 'Z' ? 0 : (sign === '-' ? -1 : 1) * (Number(zh) * 60 + Number(zm));
  const at = new Date(0);
  at.setUTCFullYear(Number(y), Number(mo) - 1, Number(d));
  at.setUTCHours(Number(h), Number(mi), Number(s), Number(fraction.padEnd(3, '0').slice(0, 3)));
  const ms = at.getTime() - offset * 60_000;
  return Number.isFinite(ms) ? ms : null;
}

export function transform(table: ViewTable, spec: ViewSpec, datasetId: string): Transformed {
  const index = new Map<string, number>();
  table.columns.forEach((column, i) => {
    if (!index.has(column.name)) index.set(column.name, i);
  });
  const ys = yColumns(spec);
  const named = [spec.x, ...ys, spec.series, ...(spec.filter ?? []).map((f) => f.column)].filter((name): name is string => name !== undefined);
  const absent = named.find((name) => !index.has(name));
  if (absent !== undefined) return { ok: false, error: DATASET_STATES.noColumn(datasetId, absent) };
  // only `count` measures without a y (the rows it counts); any other aggregate of nothing is the missing y, never a
  // count passed off as its answer (E2 panel)
  if (spec.agg !== undefined && spec.agg !== 'count' && ys.length === 0) return { ok: false, error: VIEW_STATES.needs(spec.view, spec.view === 'pie' ? 'a y column (the sizes)' : 'a y column') };

  const seriesKeys: string[] = [];
  if (spec.series !== undefined) {
    const at = index.get(spec.series)!;
    const seen = new Set<string>();
    for (const row of table.rows) {
      const key = typedKey(row[at] ?? null);
      if (seen.has(key)) continue;
      seen.add(key);
      seriesKeys.push(key);
    }
  }

  let rows: (readonly Cell[])[] = table.rows.filter((row) => (spec.filter ?? []).every((f) => matches(row[index.get(f.column)!] ?? null, f, table.columns[index.get(f.column)!])));
  let columns: ViewColumn[] = [...table.columns];
  let roles: Omit<ViewData, 'table' | 'seriesKeys' | 'overflow' | 'notes'>;
  const overflowing = new Map<readonly Cell[], number[]>(); // an aggregated row's overflowed columns, until the rows settle
  if (spec.agg !== undefined) {
    const keys = [...new Set([spec.x, spec.series].filter((name): name is string => name !== undefined))];
    const sources = ys.length > 0 ? ys : [null]; // null: the implicit count of rows (agg `count` alone, above)
    const taken = new Set(keys);
    const measures = sources.map((y) => {
      let name = y ?? 'count';
      const renamed = y === null ? 'count of rows' : `${spec.agg} of ${y}`;
      if (taken.has(name)) name = withinNameBound(renamed);
      for (let n = 2; taken.has(name); n += 1) name = withinNameBound(renamed, ` (${n})`);
      taken.add(name);
      return { name, from: y === null ? null : index.get(y)! };
    });
    const groups = new Map<string, { key: Cell[]; members: (readonly Cell[])[] }>();
    for (const row of rows) {
      const key = keys.map((name) => row[index.get(name)!] ?? null);
      const id = JSON.stringify(key);
      let group = groups.get(id);
      if (!group) groups.set(id, (group = { key, members: [] }));
      group.members.push(row);
    }
    columns = [...keys.map((name) => table.columns[index.get(name)!]), ...measures.map((m): ViewColumn => ({ name: m.name, type: 'number' }))];
    rows = [...groups.values()].map(({ key, members }) => {
      const row: Cell[] = [...key];
      measures.forEach((m, k) => {
        const value = aggregate(spec.agg!, m.from === null ? members.map(() => 1) : members.map((member) => member[m.from!] ?? null));
        if (value === OVERFLOW) overflowing.set(row, [...(overflowing.get(row) ?? []), keys.length + k]);
        row.push(value === OVERFLOW ? null : value);
      });
      return row;
    });
    roles = {
      ...(spec.x !== undefined && { x: keys.indexOf(spec.x) }),
      ...(spec.series !== undefined && { series: keys.indexOf(spec.series) }),
      ys: measures.map((_, k) => keys.length + k),
      ySources: sources,
    };
  } else {
    roles = {
      ...(spec.x !== undefined && { x: index.get(spec.x)! }),
      ...(spec.series !== undefined && { series: index.get(spec.series)! }),
      ys: ys.map((y) => index.get(y)!),
      ySources: [...ys],
    };
  }
  if (spec.sort !== undefined) {
    const at = columns.findIndex((column) => column.name === spec.sort!.by);
    if (at < 0) return { ok: false, error: DATASET_STATES.noColumn(datasetId, spec.sort.by) };
    const sign = spec.sort.dir === 'asc' ? 1 : -1;
    const column = columns[at];
    rows = rows
      .map((row, i) => ({ row, i }))
      .sort((a, b) => compareCells(a.row[at] ?? null, b.row[at] ?? null, column, sign) || a.i - b.i)
      .map(({ row }) => row);
  }
  if (spec.limit !== undefined) rows = rows.slice(0, spec.limit);
  const missing = (spec.columns ?? []).find((name) => !columns.some((column) => column.name === name));
  if (missing !== undefined) return { ok: false, error: DATASET_STATES.noColumn(datasetId, missing) };
  // the overflowed cells of the rows the view keeps, at their final places, and a note per measure that has any
  const overflow = new Set<string>();
  const counts = new Map<number, number>();
  rows.forEach((row, r) => {
    for (const column of overflowing.get(row) ?? []) {
      overflow.add(overflowKey(r, column));
      counts.set(column, (counts.get(column) ?? 0) + 1);
    }
  });
  const notes = roles.ys.flatMap((column, k) => (counts.has(column) ? [VIEW_STATES.overflow(counts.get(column)!, spec.agg!, roles.ySources[k] ?? 'rows')] : []));
  return { ok: true, data: { table: { columns, rows }, ...roles, seriesKeys, overflow, notes } };
}

/** The columns a table view shows of the transformed view: the spec's `columns` in their order, else every one. */
export function shownColumns(data: ViewData, spec: ViewSpec): number[] {
  const columns = data.table.columns;
  return spec.columns ? spec.columns.map((name) => columns.findIndex((column) => column.name === name)) : columns.map((_, i) => i);
}

/**
 * A generated output name within the grammar's name bound (SPEC_LIMITS.name, in code units as the parser counts), so a
 * spec's `sort.by` or `columns` can always name it (E2 M6): past the bound, the name is cut at a whole character and
 * marked with "…" before its `suffix`, which is always kept whole.
 */
function withinNameBound(name: string, suffix = ''): string {
  if (name.length + suffix.length <= SPEC_LIMITS.name) return `${name}${suffix}`;
  const room = SPEC_LIMITS.name - suffix.length - 1;
  let cut = '';
  for (const char of name) {
    if (cut.length + char.length > room) break;
    cut += char;
  }
  return `${cut}…${suffix}`;
}

const OVERFLOW = Symbol('overflow');

/** A group's aggregate: null with no number to aggregate; OVERFLOW for a sum past the largest number (never Infinity). */
function aggregate(agg: NonNullable<ViewSpec['agg']>, values: Cell[]): number | null | typeof OVERFLOW {
  if (agg === 'count') return values.length;
  let n = 0;
  let sum = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    n += 1;
    sum += value;
    if (value < lo) lo = value;
    if (value > hi) hi = value;
  }
  if (n === 0) return null;
  if (agg === 'min') return lo;
  if (agg === 'max') return hi;
  if (Number.isFinite(sum)) return agg === 'sum' ? sum : sum / n;
  // A running sum past the largest number: summed again at a power-of-two scale (exact for every value of a size that
  // matters beside these), so only an answer that is itself too large overflows; a mean, between the extremes, never.
  let scaled = 0;
  for (const value of values) if (typeof value === 'number' && Number.isFinite(value)) scaled += value / SUM_SCALE;
  const answer = (agg === 'sum' ? scaled : scaled / n) * SUM_SCALE;
  return Number.isFinite(answer) ? answer : OVERFLOW;
}
const SUM_SCALE = 2 ** 970;

/** A value as sorting and an ordered filter compare it: a date column's instant (else its text), a boolean as 0 or 1. */
const comparable = (value: Cell, column: ViewColumn): number | string | null => {
  if (value === null) return null;
  if (column.type === 'date') return instantOf(value) ?? (typeof value === 'string' ? value : null);
  return typeof value === 'boolean' ? Number(value) : value;
};

/** Nulls last in either direction; numbers and instants numerically; text by code unit (never the machine's locale);
 * a number before a text in a mixed column. */
export function compareCells(a: Cell, b: Cell, column: ViewColumn, sign: number): number {
  const left = comparable(a, column);
  const right = comparable(b, column);
  if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
  if (typeof left !== typeof right) return (typeof left === 'number' ? -1 : 1) * sign;
  return (left < right ? -1 : left > right ? 1 : 0) * sign;
}

function matches(value: Cell, filter: ViewFilter, column: ViewColumn): boolean {
  const wanted = filter.value;
  if (filter.op === 'in') return (wanted as Cell[]).some((item) => item === value);
  if (filter.op === 'eq') return value === wanted;
  if (filter.op === 'ne') return value !== wanted;
  // the operand through the cells' own normalization (a boolean as 0 or 1, E2 panel); a date column's only as an instant
  const left = comparable(value, column);
  const right = column.type === 'date' ? instantOf(wanted as Cell) : comparable(wanted as Cell, column);
  if (left === null || right === null || typeof left !== typeof right) return false;
  return filter.op === 'lt' ? left < right : left > right;
}
