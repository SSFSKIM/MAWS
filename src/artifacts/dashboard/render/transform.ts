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
// filter never renumbers a surviving series' form. Nothing here reads the locale, the clock or a DOM; nothing spreads a
// data-sized array into a call.
import type { Cell } from '../datasets';
import { DATASET_STATES } from '../states';
import { yColumns, type ViewFilter, type ViewSpec } from '../spec';

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
  /** The measures' source y names, in `ys`' order (`count` for the implicit count): whose `format` each takes. */
  yNames: string[];
  /** The unfiltered snapshot's series, by typed key, in first-seen order. */
  seriesKeys: string[];
}

export type Transformed = { ok: true; data: ViewData } | { ok: false; error: string };

/** A cell's identity as a key: its type and value (the number 1, the text "1" and null are three keys). */
export const typedKey = (value: Cell): string => JSON.stringify(value);

// The host's date grammar (parse.ts): an ISO calendar date, or a zoned ISO date-time with up to nine fraction digits.
const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):(\d{2})))?$/;

/** A date cell's instant in UTC milliseconds (a calendar date at its UTC midnight), or null; never local time. */
export function instantOf(value: Cell): number | null {
  if (typeof value !== 'string') return null;
  const m = DATE.exec(value);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0', fraction = '', zone, sign, zh = '0', zm = '0'] = m;
  const offset = zone === undefined || zone === 'Z' ? 0 : (sign === '-' ? -1 : 1) * (Number(zh) * 60 + Number(zm));
  const ms = Number(fraction.padEnd(3, '0').slice(0, 3));
  const at = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms) - offset * 60_000;
  return Number.isFinite(at) ? at : null;
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
  let roles: Omit<ViewData, 'table' | 'seriesKeys'>;
  if (spec.agg !== undefined) {
    const keys = [...new Set([spec.x, spec.series].filter((name): name is string => name !== undefined))];
    const sources = ys.length > 0 ? ys : [null]; // null: the implicit count of rows
    const taken = new Set(keys);
    const measures = sources.map((y) => {
      let name = y ?? 'count';
      if (taken.has(name)) name = y === null ? 'count of rows' : `${spec.agg} of ${y}`;
      for (let n = 2; taken.has(name); n += 1) name = `${y === null ? 'count of rows' : `${spec.agg} of ${y}`} (${n})`;
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
    rows = [...groups.values()].map(({ key, members }) => [...key, ...measures.map((m) => aggregate(spec.agg!, m.from === null ? members.map(() => 1) : members.map((row) => row[m.from!] ?? null)))]);
    roles = {
      ...(spec.x !== undefined && { x: keys.indexOf(spec.x) }),
      ...(spec.series !== undefined && { series: keys.indexOf(spec.series) }),
      ys: measures.map((_, k) => keys.length + k),
      yNames: sources.map((y) => y ?? 'count'),
    };
  } else {
    roles = {
      ...(spec.x !== undefined && { x: index.get(spec.x)! }),
      ...(spec.series !== undefined && { series: index.get(spec.series)! }),
      ys: ys.map((y) => index.get(y)!),
      yNames: [...ys],
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
  return { ok: true, data: { table: { columns, rows }, ...roles, seriesKeys } };
}

/** The columns a table view shows of the transformed view: the spec's `columns` in their order, else every one. */
export function shownColumns(data: ViewData, spec: ViewSpec): number[] {
  const columns = data.table.columns;
  return spec.columns ? spec.columns.map((name) => columns.findIndex((column) => column.name === name)) : columns.map((_, i) => i);
}

function aggregate(agg: NonNullable<ViewSpec['agg']>, values: Cell[]): number | null {
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
  const answer = agg === 'sum' ? sum : agg === 'mean' ? sum / n : agg === 'min' ? lo : hi;
  return Number.isFinite(answer) ? answer : null; // a sum past the largest double is not a value
}

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
  const left = comparable(value, column);
  const right = column.type === 'date' ? instantOf(wanted as Cell) : (wanted as Cell);
  if (left === null || right === null || typeof left !== typeof right) return false;
  return filter.op === 'lt' ? left < right : left > right;
}
