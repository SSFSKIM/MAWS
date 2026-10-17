// A view's data semantics (P3-E2 M3): filter, then group and aggregate, then a stable sort, then limit; series identity
// from the unfiltered snapshot by typed keys; each column's role by index, so a measure and a grouping column of one
// name stay apart; actual values asserted.
import { describe, expect, it } from 'vitest';
import { SPEC_LIMITS, type ViewSpec } from '../spec';
import { columnFormat, instantOf, overflowKey, transform, typedKey, type ViewData, type ViewTable } from './transform';

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
    expect(data({ x: 'region', y: 'sales' })).toEqual({ table: SALES, x: 0, ys: [2], ySources: ['sales'], seriesKeys: [], overflow: new Set(), notes: [] });
  });

  it('filters before grouping and aggregates each y per group in first-seen order; count counts rows, nulls included', () => {
    expect(rows({ x: 'region', y: 'sales', agg: 'sum', filter: [{ column: 'month', op: 'gt', value: '2026-01-15' }] })).toEqual([['north', 5], ['east', 7], ['south', 6]]);
    expect(rows({ x: 'region', y: 'sales', agg: 'count' })).toEqual([['north', 3], ['south', 2], ['east', 1]]);
    expect(data({ x: 'region', agg: 'count' }).table.columns.map((c) => c.name)).toEqual(['region', 'count']);
    expect(rows({ x: 'region', y: 'sales', agg: 'mean' })).toEqual([['north', 7.5], ['south', 5], ['east', 7]]);
    expect(rows({ x: 'region', y: 'sales', agg: 'min' })).toEqual([['north', 5], ['south', 4], ['east', 7]]);
    expect(rows({ x: 'region', y: 'sales', agg: 'max', series: 'rep' })).toEqual([['north', 'Ana', 10], ['south', 'Ben', 6], ['east', 'Cy', 7], ['north', 'Dee', 5]]);
  });

  it('bounds a generated measure name by the grammar’s name bound, apart from its twins (E2 M6, the tracker’s alias row)', () => {
    const long = `${'긴'.repeat(SPEC_LIMITS.name - 2)}𝑥`; // 256 code units, a surrogate pair at its end
    expect(long.length).toBe(SPEC_LIMITS.name);
    const table: ViewTable = { columns: [{ name: long, type: 'number' }, { name: `sum of ${long}`.slice(0, SPEC_LIMITS.name), type: 'number' }], rows: [[1, 2], [1, 3], [2, 4]] };
    const named = data({ x: long, y: long, agg: 'sum' }, table).table.columns.map((c) => c.name);
    for (const name of named) expect(name.length, name).toBeLessThanOrEqual(SPEC_LIMITS.name);
    expect(new Set(named).size).toBe(named.length);
    expect(named[1]).toMatch(/^sum of 긴+…$/);
    // a twin's suffix survives its bound
    const twins = data({ x: long, series: table.columns[1]!.name, y: [long, long], agg: 'sum' }, table).table.columns.map((c) => c.name);
    expect(twins).toHaveLength(4);
    expect(new Set(twins).size).toBe(4);
    for (const name of twins) expect(name.length, name).toBeLessThanOrEqual(SPEC_LIMITS.name);
    expect(twins[3]).toMatch(/^sum of 긴+… \(2\)$/);
    // a sort within the grammar's bound names the measure
    expect(rows({ x: long, y: long, agg: 'sum', sort: { by: named[1]!, dir: 'desc' } }, table)).toEqual([[1, 2], [2, 2]]);
  });

  it('keeps a measure apart from a grouping column of the same name: counting the rows of each region', () => {
    const counted = data({ x: 'region', y: 'region', agg: 'count' });
    expect(counted.table.columns.map((c) => c.name)).toEqual(['region', 'count of region']);
    expect(counted.table.rows).toEqual([['north', 3], ['south', 2], ['east', 1]]);
    expect([counted.x, counted.ys, counted.ySources]).toEqual([0, [1], ['region']]);
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

  it('names an aggregate that overflows: the cell held as null, marked, and a note naming the measure and its groups', () => {
    const huge: ViewTable = { columns: [{ name: 'g', type: 'string' }, { name: 'v', type: 'number' }], rows: [['A', 1.7e308], ['A', 1.7e308], ['B', 1], ['C', -1.7e308], ['C', -1.7e308]] };
    const summed = data({ x: 'g', y: 'v', agg: 'sum' }, huge);
    expect(summed.table.rows).toEqual([['A', null], ['B', 1], ['C', null]]);
    expect(summed.notes).toEqual(['sum of v overflows in 2 groups: too large to represent']);
    expect([...summed.overflow]).toEqual([overflowKey(0, 1), overflowKey(2, 1)]);
    // the note counts the groups the view keeps, after its sort and limit (nulls sort last)
    const kept = data({ x: 'g', y: 'v', agg: 'sum', sort: { by: 'v', dir: 'desc' }, limit: 1 }, huge);
    expect([kept.table.rows, kept.notes, kept.overflow.size]).toEqual([[['B', 1]], [], 0]);
    // a mean never overflows: it is the mean of the values, however large their sum
    expect(rows({ x: 'g', y: 'v', agg: 'mean' }, huge)).toEqual([['A', 1.7e308], ['B', 1], ['C', -1.7e308]]);
    expect(data({ x: 'g', y: 'v', agg: 'mean' }, huge).notes).toEqual([]);
    // a running sum that passes the largest number on its way to a representable answer is that answer
    expect(rows({ x: 'g', y: 'v', agg: 'sum' }, { columns: huge.columns, rows: [['A', 1.7e308], ['A', 1.7e308], ['A', -1.7e308]] })).toEqual([['A', 1.7e308]]);
    // an empty group's sum is no value without a reason to give: no note
    const empty = data({ x: 'g', y: 'v', agg: 'sum' }, { columns: huge.columns, rows: [['A', null]] });
    expect([empty.table.rows, empty.notes, empty.overflow.size]).toEqual([[['A', null]], [], 0]);
  });

  it('formats each column by its role: a renamed measure by its source column, then by its own name; a grouping column by its name', () => {
    const t: ViewTable = { columns: [{ name: 'rate', type: 'number' }, { name: 'count', type: 'string' }], rows: [[0.1, 'a'], [0.2, 'b']] };
    const spec = { view: 'table' as const, x: 'rate', y: 'rate', agg: 'mean' as const, format: { rate: 'percent' as const } };
    const renamed = data(spec, t);
    expect(renamed.table.columns.map((c) => c.name)).toEqual(['rate', 'mean of rate']);
    expect([columnFormat(spec, renamed, 0), columnFormat(spec, renamed, 1)]).toEqual(['percent', 'percent']);
    const byOutput = { ...spec, format: { 'mean of rate': 'text' as const } };
    expect([columnFormat(byOutput, renamed, 0), columnFormat(byOutput, renamed, 1)]).toEqual([undefined, 'text']);
    // the implicit count has no source column: a grouping column named `count` keeps its format to itself
    const counting = { view: 'table' as const, x: 'count', agg: 'count' as const, format: { count: 'text' as const } };
    const counted = data(counting, t);
    expect(counted.table.columns.map((c) => c.name)).toEqual(['count', 'count of rows']);
    expect([columnFormat(counting, counted, 0), columnFormat(counting, counted, 1)]).toEqual(['text', undefined]);
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

  it('orders booleans in a filter as it sorts them: the operand normalized like the cells, false before true (E2 panel)', () => {
    const flags: ViewTable = { columns: [{ name: 'name', type: 'string' }, { name: 'active', type: 'boolean' }], rows: [['a', false], ['b', true], ['c', null]] };
    expect(rows({ filter: [{ column: 'active', op: 'gt', value: false }] }, flags)).toEqual([['b', true]]);
    expect(rows({ filter: [{ column: 'active', op: 'lt', value: true }] }, flags)).toEqual([['a', false]]);
    expect(rows({ filter: [{ column: 'active', op: 'gt', value: true }] }, flags)).toEqual([]);
    // a text operand stays text: never coerced into a boolean's order
    expect(rows({ filter: [{ column: 'active', op: 'gt', value: 'false' }] }, flags)).toEqual([]);
  });

  it('keeps an invalid calendar value out of an ordered date filter, never as the instant Date.UTC would roll it to (E2 panel)', () => {
    const days: ViewTable = { columns: [{ name: 'day', type: 'date' }], rows: [['2026-02-27'], ['2026-02-28'], ['2026-02-30']] };
    expect(rows({ filter: [{ column: 'day', op: 'gt', value: '2026-03-01' }] }, days)).toEqual([]);
    expect(rows({ filter: [{ column: 'day', op: 'lt', value: '2026-03-01' }] }, days)).toEqual([['2026-02-27'], ['2026-02-28']]);
  });

  it('makes the implicit measure for count alone: another aggregate without y is the missing-y state (E2 panel)', () => {
    expect(run({ view: 'bar', x: 'region', agg: 'mean' })).toEqual({ ok: false, error: 'a bar view needs a y column' });
    expect(run({ view: 'pie', x: 'region', agg: 'sum' })).toEqual({ ok: false, error: 'a pie view needs a y column (the sizes)' });
    expect(run({ view: 'table', x: 'region', agg: 'max' })).toEqual({ ok: false, error: 'a table view needs a y column' });
    expect(rows({ x: 'region', agg: 'count' })).toEqual([['north', 3], ['south', 2], ['east', 1]]);
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

  it('validates the calendar as the host does: an impossible day or time is no instant (E2 panel)', () => {
    expect(instantOf('2026-02-30')).toBeNull();
    expect(instantOf('2026-02-29')).toBeNull();
    expect(instantOf('2024-02-29')).toBe(Date.UTC(2024, 1, 29));
    expect(instantOf('2026-13-01')).toBeNull();
    expect(instantOf('2026-04-31T10:00Z')).toBeNull();
    expect(instantOf('2026-10-16T24:00Z')).toBeNull();
    expect(instantOf('2026-10-16T10:60Z')).toBeNull();
    expect(instantOf('2026-10-16T10:00:60Z')).toBeNull();
    expect(instantOf('2026-10-16T10:00+24:00')).toBeNull();
  });

  it('keeps a year from 0000 to 0099 its own, never Date.UTC’s 1900s (E2 panel)', () => {
    const at = (year: number, month: number, day: number, ms = 0) => {
      const d = new Date(0);
      d.setUTCFullYear(year, month, day);
      return d.getTime() + ms;
    };
    expect(instantOf('0099-01-01')).toBe(at(99, 0, 1));
    expect(new Date(instantOf('0099-01-01')!).getUTCFullYear()).toBe(99);
    expect(instantOf('0000-02-29')).toBe(at(0, 1, 29)); // year 0 is a leap year in the proleptic calendar
    expect(new Date(instantOf('0000-02-29')!).toISOString()).toBe('0000-02-29T00:00:00.000Z');
    expect(instantOf('0050-06-15T12:30:15.250+02:00')).toBe(at(50, 5, 15, (10 * 3600 + 30 * 60 + 15) * 1000 + 250));
    expect(instantOf('0100-01-01')).toBe(at(100, 0, 1));
  });
});
