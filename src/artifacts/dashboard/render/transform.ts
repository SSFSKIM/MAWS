// A view's data semantics (P3-E2 M3; the execution document's M3 "Data semantics"): filter before grouping; with `agg`,
// group by x (and series) in first-seen order and aggregate each y (`count` counts rows); a stable sort after
// aggregation; `limit` last. Without `agg` every row stays. A column the spec names that the table lacks is the shared
// error, never a silent omission. Series identity is the unfiltered snapshot's (first-seen order), so a filter never
// renumbers a surviving series' form. Nothing here reads the locale, the clock or a DOM.
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

export type Transformed = { ok: true; table: ViewTable; series: string[] } | { ok: false; error: string };

export const seriesKey = (value: Cell): string => (value === null ? '(none)' : String(value));

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
  const index = new Map(table.columns.map((column, i) => [column.name, i]));
  const named = [spec.x, ...yColumns(spec), spec.series, ...(spec.filter ?? []).map((f) => f.column), ...(spec.columns ?? [])].filter((name): name is string => name !== undefined);
  const absent = named.find((name) => !index.has(name));
  if (absent !== undefined) return { ok: false, error: DATASET_STATES.noColumn(datasetId, absent) };

  const series: string[] = [];
  if (spec.series !== undefined) {
    const at = index.get(spec.series)!;
    const seen = new Set<string>();
    for (const row of table.rows) {
      const key = seriesKey(row[at] ?? null);
      if (seen.has(key)) continue;
      seen.add(key);
      series.push(key);
    }
  }

  let rows: (readonly Cell[])[] = table.rows.filter((row) => (spec.filter ?? []).every((f) => matches(row[index.get(f.column)!] ?? null, f, table.columns[index.get(f.column)!])));
  let columns: readonly ViewColumn[] = table.columns;
  if (spec.agg !== undefined) {
    const keys = [spec.x, spec.series].filter((name): name is string => name !== undefined);
    const ys = yColumns(spec);
    const outY = ys.length > 0 ? ys : ['count'];
    const groups = new Map<string, { key: Cell[]; members: (readonly Cell[])[] }>();
    for (const row of rows) {
      const key = keys.map((name) => row[index.get(name)!] ?? null);
      const id = JSON.stringify(key);
      let group = groups.get(id);
      if (!group) groups.set(id, (group = { key, members: [] }));
      group.members.push(row);
    }
    columns = [...keys.map((name) => table.columns[index.get(name)!]), ...outY.map((name): ViewColumn => ({ name, type: 'number' }))];
    rows = [...groups.values()].map(({ key, members }) => [...key, ...outY.map((name) => aggregate(spec.agg!, ys.length > 0 ? members.map((row) => row[index.get(name)!] ?? null) : members.map(() => 1)))]);
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
  return { ok: true, table: { columns, rows }, series };
}

function aggregate(agg: NonNullable<ViewSpec['agg']>, values: Cell[]): number | null {
  if (agg === 'count') return values.length;
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (numbers.length === 0) return null;
  if (agg === 'sum') return numbers.reduce((a, b) => a + b, 0);
  if (agg === 'mean') return numbers.reduce((a, b) => a + b, 0) / numbers.length;
  return agg === 'min' ? Math.min(...numbers) : Math.max(...numbers);
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
