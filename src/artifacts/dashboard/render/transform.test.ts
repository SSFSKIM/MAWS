// A view's data semantics (P3-E2 M3): filter, then group and aggregate, then a stable sort, then limit; series identity
// from the unfiltered snapshot by typed keys; each column's role by index, so a measure and a grouping column of one
// name stay apart; actual values asserted.
import { describe, expect, it } from 'vitest';
import type { ViewSpec } from '../spec';
import { instantOf, transform, typedKey, type ViewData, type ViewTable } from './transform';

const SALES: ViewTable = {
  columns: [{ name: 'region', type: 'string' }, { name: 'month', type: 'date' }, { name: 'sales', type: 'number' }, { name: 'rep', type: 'string' }],
  rows: [
    ['north', '2026-01-01', 10, 'Ana'],
    ['south', '2026-01-01', 4, 'Ben'],
    ['north', '2026-02-01', null, 'Ana'],
    ['east', '2026-02-01', 7, 'Cy'],
    ['south', '2026-02-01', 6, 'Ben'],
    ['north', '2026-03-01', 5, 'Dee'],
  ],
};
const run = (spec: Omit<ViewSpec, 'view'> & { view?: ViewSpec['view'] }, table = SALES) => transform(table, { view: 'table', ...spec }, 'sales');
const data = (spec: Omit<ViewSpec, 'view'> & { view?: ViewSpec['view'] }, table = SALES): ViewData => {
  const shaped = run(spec, table);
  if (!shaped.ok) throw new Error(shaped.error);
  return shaped.data;
};
const rows = (spec: Omit<ViewSpec, 'view'>, table = SALES) => data(spec, table).table.rows;

describe('transform', () => {
  it('keeps every row in order without agg, the roles by index', () => {
    expect(data({ x: 'region', y: 'sales' })).toEqual({ table: SALES, x: 0, ys: [2], yNames: ['sales'], seriesKeys: [] });
  });

  it('filters before grouping and aggregates each y per group in first-seen order; count counts rows, nulls included', () => {
    expect(rows({ x: 'region', y: 'sales', agg: 'sum', filter: [{ column: 'month', op: 'gt', value: '2026-01-15' }] })).toEqual([['north', 5], ['east', 7], ['south', 6]]);
    expect(rows({ x: 'region', y: 'sales', agg: 'count' })).toEqual([['north', 3], ['south', 2], ['east', 1]]);
    expect(data({ x: 'region', agg: 'count' }).table.columns.map((c) => c.name)).toEqual(['region', 'count']);
    expect(rows({ x: 'region', y: 'sales', agg: 'mean' })).toEqual([['north', 7.5], ['south', 5], ['east', 7]]);
    expect(rows({ x: 'region', y: 'sales', agg: 'min' })).toEqual([['north', 5], ['south', 4], ['east', 7]]);
    expect(rows({ x: 'region', y: 'sales', agg: 'max', series: 'rep' })).toEqual([['north', 'Ana', 10], ['south', 'Ben', 6], ['east', 'Cy', 7], ['north', 'Dee', 5]]);
  });

  it('keeps a measure apart from a grouping column of the same name: counting the rows of each region', () => {
    const counted = data({ x: 'region', y: 'region', agg: 'count' });
    expect(counted.table.columns.map((c) => c.name)).toEqual(['region', 'count of region']);
    expect(counted.table.rows).toEqual([['north', 3], ['south', 2], ['east', 1]]);
    expect([counted.x, counted.ys, counted.yNames]).toEqual([0, [1], ['region']]);
    // the implicit count beside a grouping column named `count`
    const table: ViewTable = { columns: [{ name: 'count', type: 'string' }], rows: [['a'], ['a'], ['b']] };
    const implicit = data({ x: 'count', agg: 'count' }, table);
    expect(implicit.table.columns.map((c) => c.name)).toEqual(['count', 'count of rows']);
    expect(implicit.table.rows).toEqual([['a', 2], ['b', 1]]);
    // x and series one column: grouped once, both roles on it
    const same = data({ x: 'region', series: 'region', y: 'sales', agg: 'sum' });
    expect([same.x, same.series, same.ys]).toEqual([0, 0, [1]]);
    expect(same.table.rows).toEqual([['north', 15], ['south', 10], ['east', 7]]);
    // sort and a table's columns name the output's columns
    expect(rows({ x: 'region', y: 'region', agg: 'count', sort: { by: 'count of region', dir: 'asc' } })).toEqual([['east', 1], ['south', 2], ['north', 3]]);
    expect(run({ x: 'region', agg: 'count', columns: ['count', 'region'] }).ok).toBe(true);
    expect(run({ x: 'region', agg: 'count', columns: ['sales'] })).toEqual({ ok: false, error: 'dataset "sales" has no column "sales"' });
  });

  it('aggregates 200,000 values of one group without spreading them into a call; a sum past the largest double is no value', () => {
    const big: ViewTable = { columns: [{ name: 'g', type: 'string' }, { name: 'v', type: 'number' }], rows: Array.from({ length: 200_000 }, (_, i) => ['A', i]) };
    expect(rows({ x: 'g', y: 'v', agg: 'min' }, big)).toEqual([['A', 0]]);
    expect(rows({ x: 'g', y: 'v', agg: 'max' }, big)).toEqual([['A', 199_999]]);
    const huge: ViewTable = { columns: big.columns, rows: [['A', 1.7e308], ['A', 1.7e308]] };
    expect(rows({ x: 'g', y: 'v', agg: 'sum' }, huge)).toEqual([['A', null]]);
    expect(rows({ x: 'g', y: 'v', agg: 'max' }, huge)).toEqual([['A', 1.7e308]]);
  });

  it('sorts stably after aggregating, nulls last either way, then limits', () => {
    expect(rows({ sort: { by: 'sales', dir: 'asc' } }).map((r) => r[2])).toEqual([4, 5, 6, 7, 10, null]);
    expect(rows({ sort: { by: 'sales', dir: 'desc' }, limit: 3 }).map((r) => r[2])).toEqual([10, 7, 6]);
    expect(rows({ sort: { by: 'region', dir: 'asc' } }).map((r) => `${r[0]}${r[1]}`)).toEqual(['east2026-02-01', 'north2026-01-01', 'north2026-02-01', 'north2026-03-01', 'south2026-01-01', 'south2026-02-01']);
    expect(rows({ x: 'region', y: 'sales', agg: 'sum', sort: { by: 'sales', dir: 'desc' }, limit: 2 })).toEqual([['north', 15], ['south', 10]]);
  });

  it('compares dates as instants and filters with in, eq and ne by exact value', () => {
    expect(rows({ filter: [{ column: 'month', op: 'lt', value: '2026-01-31T21:00:00-02:00' }] })).toHaveLength(2);
    expect(rows({ filter: [{ column: 'rep', op: 'in', value: ['Ana', 'Cy'] }] })).toHaveLength(3);
    expect(rows({ filter: [{ column: 'sales', op: 'ne', value: null }] })).toHaveLength(5);
    expect(rows({ filter: [{ column: 'sales', op: 'gt', value: '5' }] })).toHaveLength(0);
  });

  it('takes series identity from the whole snapshot, before the filter, by typed keys', () => {
    expect(data({ series: 'rep', filter: [{ column: 'rep', op: 'eq', value: 'Cy' }] }).seriesKeys).toEqual(['Ana', 'Ben', 'Cy', 'Dee'].map(typedKey));
    const mixed: ViewTable = { columns: [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }, { name: 's', type: 'string' }], rows: [[1, 2, 1], [2, 3, '1'], [3, 4, null], [4, 5, '(none)']] };
    expect(data({ x: 'x', y: 'y', series: 's' }, mixed).seriesKeys).toEqual(['1', '"1"', 'null', '"(none)"']);
  });

  it('names a column the table lacks, whichever key names it', () => {
    expect(run({ x: 'country' })).toEqual({ ok: false, error: 'dataset "sales" has no column "country"' });
    expect(run({ filter: [{ column: 'tax', op: 'eq', value: 1 }] })).toEqual({ ok: false, error: 'dataset "sales" has no column "tax"' });
    expect(run({ x: 'region', agg: 'count', sort: { by: 'sales', dir: 'asc' } })).toEqual({ ok: false, error: 'dataset "sales" has no column "sales"' });
  });
});

describe('instantOf', () => {
  it('reads the host\'s date grammar in UTC, offsets and nine fraction digits included', () => {
    expect(instantOf('2026-10-16')).toBe(Date.UTC(2026, 9, 16));
    expect(instantOf('2026-10-16T09:00+09:00')).toBe(Date.UTC(2026, 9, 16));
    expect(instantOf('2026-10-16T00:00:00.123456789Z')).toBe(Date.UTC(2026, 9, 16, 0, 0, 0, 123));
    expect(instantOf('2026-10-16T00:00:00')).toBeNull(); // the host refuses a date-time without a zone
    expect(instantOf('16/10/2026')).toBeNull();
    expect(instantOf(20261016)).toBeNull();
  });
});
