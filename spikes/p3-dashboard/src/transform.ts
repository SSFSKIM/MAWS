// P3-E2 M1 spike: the view's data semantics (execution document M3 "Data semantics"), shared by both candidates
// because neither rendering route changes them: filter before grouping; with `agg`, group by x (and series) in
// first-seen order and aggregate each y (`count` counts rows); a stable sort after aggregation; `limit` last. Without
// `agg` every row stays. A column the spec names that the table lacks is an error, never a silent omission.
import { instantOf, type Cell, type Column, type Table } from './model';
import type { Scalar, ViewSpec } from './spec';
import { states } from './states';

export type Transformed = { ok: true; table: Table; series: string[]; warnings: string[] } | { ok: false; error: string };

export const yColumns = (spec: ViewSpec): string[] => (spec.y === undefined ? [] : Array.isArray(spec.y) ? spec.y : [spec.y]);
export const seriesKey = (value: Cell): string => (value === null ? '(none)' : String(value));

export function transform(table: Table, spec: ViewSpec, datasetId: string): Transformed {
  const index = new Map(table.columns.map((column, i) => [column.name, i]));
  const named = [spec.x, ...yColumns(spec), spec.series, ...(spec.filter ?? []).map((f) => f.column), ...(spec.columns ?? [])].filter((name): name is string => name !== undefined);
  const absent = named.find((name) => !index.has(name));
  if (absent !== undefined) return { ok: false, error: states.noColumn(datasetId, absent) };

  // Series identity comes from the whole snapshot, before any filter, so a filter never renumbers a survivor.
  const series: string[] = [];
  if (spec.series !== undefined) {
    const at = index.get(spec.series)!;
    const seen = new Set<string>();
    for (const row of table.rows) {
      const key = seriesKey(row[at]);
      if (!seen.has(key)) seen.add(key), series.push(key);
    }
  }

  let rows = table.rows.filter((row) => (spec.filter ?? []).every((f) => matches(row[index.get(f.column)!], f.op, f.value, table.columns[index.get(f.column)!])));
  let columns = table.columns;
  if (spec.agg !== undefined) {
    const keys = [spec.x, spec.series].filter((name): name is string => name !== undefined);
    const ys = yColumns(spec);
    const outY = ys.length > 0 ? ys : ['count'];
    const groups = new Map<string, { key: Cell[]; members: Cell[][] }>();
    for (const row of rows) {
      const key = keys.map((name) => row[index.get(name)!]);
      const id = JSON.stringify(key);
      const group = groups.get(id) ?? groups.set(id, { key, members: [] }).get(id)!;
      group.members.push(row);
    }
    columns = [...keys.map((name) => table.columns[index.get(name)!]), ...outY.map((name): Column => ({ name, type: 'number' }))];
    rows = [...groups.values()].map(({ key, members }) => [...key, ...outY.map((name) => aggregate(spec.agg!, ys.length > 0 ? members.map((row) => row[index.get(name)!]) : members.map(() => 1)))]);
  }
  if (spec.sort !== undefined) {
    const at = columns.findIndex((column) => column.name === spec.sort!.by);
    if (at < 0) return { ok: false, error: states.noColumn(datasetId, spec.sort.by) };
    const sign = spec.sort.dir === 'asc' ? 1 : -1;
    const type = columns[at];
    rows = rows
      .map((row, i) => ({ row, i }))
      .sort((a, b) => compareCells(a.row[at], b.row[at], type, sign) || a.i - b.i)
      .map(({ row }) => row);
  }
  if (spec.limit !== undefined) rows = rows.slice(0, spec.limit);
  return { ok: true, table: { columns, rows }, series, warnings: [] };
}

function aggregate(agg: NonNullable<ViewSpec['agg']>, values: Cell[]): number | null {
  if (agg === 'count') return values.length;
  const numbers = values.filter((value): value is number => typeof value === 'number');
  if (numbers.length === 0) return null;
  if (agg === 'sum') return numbers.reduce((a, b) => a + b, 0);
  if (agg === 'mean') return numbers.reduce((a, b) => a + b, 0) / numbers.length;
  return agg === 'min' ? Math.min(...numbers) : Math.max(...numbers);
}

const comparable = (value: Cell, column: Column): number | string | null => {
  if (value === null) return null;
  if (column.type === 'date') return instantOf(value);
  return typeof value === 'boolean' ? Number(value) : value;
};

// Nulls sort last in either direction; numbers and instants numerically; text by code unit (never the machine locale).
function compareCells(a: Cell, b: Cell, column: Column, sign: number): number {
  const left = comparable(a, column);
  const right = comparable(b, column);
  if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
  return (left < right ? -1 : left > right ? 1 : 0) * sign;
}

function matches(value: Cell, op: string, wanted: Scalar | Scalar[], column: Column): boolean {
  if (op === 'in') return (wanted as Scalar[]).some((item) => item === value);
  if (op === 'eq') return value === wanted;
  if (op === 'ne') return value !== wanted;
  const left = comparable(value, column);
  const right = column.type === 'date' ? instantOf(wanted as Cell) : (wanted as Scalar);
  if (left === null || right === null || typeof left !== typeof right) return false;
  return op === 'lt' ? left < right! : left > right!;
}
