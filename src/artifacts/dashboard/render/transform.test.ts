// A view's data semantics (P3-E2 M3): filter, then group and aggregate, then a stable sort, then limit; series identity
// from the unfiltered snapshot; actual values asserted.
import { describe, expect, it } from 'vitest';
import type { ViewSpec } from '../spec';
import { instantOf, transform, type ViewTable } from './transform';

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
const run = (spec: Omit<ViewSpec, 'view'> & { view?: ViewSpec['view'] }) => transform(SALES, { view: 'table', ...spec }, 'sales');

describe('transform', () => {
  it('keeps every row in order without agg', () => {
    expect(run({})).toEqual({ ok: true, table: SALES, series: [] });
  });

  it('filters before grouping and aggregates each y per group in first-seen order; count counts rows, nulls included', () => {
    const summed = run({ x: 'region', y: 'sales', agg: 'sum', filter: [{ column: 'month', op: 'gt', value: '2026-01-15' }] });
    expect(summed.ok && summed.table.rows).toEqual([['north', 5], ['east', 7], ['south', 6]]);
    expect(run({ x: 'region', y: 'sales', agg: 'count' }).ok && (run({ x: 'region', y: 'sales', agg: 'count' }) as { table: ViewTable }).table.rows).toEqual([['north', 3], ['south', 2], ['east', 1]]);
    expect((run({ x: 'region', agg: 'count' }) as { table: ViewTable }).table.columns.map((c) => c.name)).toEqual(['region', 'count']);
    expect((run({ x: 'region', y: 'sales', agg: 'mean' }) as { table: ViewTable }).table.rows).toEqual([['north', 7.5], ['south', 5], ['east', 7]]);
    expect((run({ x: 'region', y: 'sales', agg: 'min' }) as { table: ViewTable }).table.rows).toEqual([['north', 5], ['south', 4], ['east', 7]]);
    expect((run({ x: 'region', y: 'sales', agg: 'max', series: 'rep' }) as { table: ViewTable }).table.rows).toEqual([['north', 'Ana', 10], ['south', 'Ben', 6], ['east', 'Cy', 7], ['north', 'Dee', 5]]);
  });

  it('sorts stably after aggregating, nulls last either way, then limits', () => {
    const asc = run({ sort: { by: 'sales', dir: 'asc' } }) as { table: ViewTable };
    expect(asc.table.rows.map((r) => r[2])).toEqual([4, 5, 6, 7, 10, null]);
    const desc = run({ sort: { by: 'sales', dir: 'desc' }, limit: 3 }) as { table: ViewTable };
    expect(desc.table.rows.map((r) => r[2])).toEqual([10, 7, 6]);
    const byRegion = run({ sort: { by: 'region', dir: 'asc' } }) as { table: ViewTable };
    expect(byRegion.table.rows.map((r) => `${r[0]}${r[1]}`)).toEqual(['east2026-02-01', 'north2026-01-01', 'north2026-02-01', 'north2026-03-01', 'south2026-01-01', 'south2026-02-01']);
    const total = run({ x: 'region', y: 'sales', agg: 'sum', sort: { by: 'sales', dir: 'desc' }, limit: 2 }) as { table: ViewTable };
    expect(total.table.rows).toEqual([['north', 15], ['south', 10]]);
  });

  it('compares dates as instants and filters with in, eq and ne by exact value', () => {
    expect((run({ filter: [{ column: 'month', op: 'lt', value: '2026-01-31T21:00:00-02:00' }] }) as { table: ViewTable }).table.rows).toHaveLength(2);
    expect((run({ filter: [{ column: 'rep', op: 'in', value: ['Ana', 'Cy'] }] }) as { table: ViewTable }).table.rows).toHaveLength(3);
    expect((run({ filter: [{ column: 'sales', op: 'ne', value: null }] }) as { table: ViewTable }).table.rows).toHaveLength(5);
    expect((run({ filter: [{ column: 'sales', op: 'gt', value: '5' }] }) as { table: ViewTable }).table.rows).toHaveLength(0);
  });

  it('takes series identity from the whole snapshot, before the filter', () => {
    const shaped = run({ series: 'rep', filter: [{ column: 'rep', op: 'eq', value: 'Cy' }] });
    expect(shaped.ok && shaped.series).toEqual(['Ana', 'Ben', 'Cy', 'Dee']);
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
