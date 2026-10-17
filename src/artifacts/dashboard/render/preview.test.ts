// The one preview formatter (P3-E2 M5; E's Decision Log 32): a table view's HTML is written from the same cells a Word
// table and a Markdown table take (`Rendered.table`), and a chart's data preview takes the same bound and notes over the
// figure's roles, so no exporter reads generated HTML back into data.
import { describe, expect, it } from 'vitest';
import { HOUSE_TOKENS } from '../../document/export/design-system';
import { DatasetError, parseDataset } from '../parse';
import { GDP_CSV } from '../fixtures/datasets';
import { renderView, svgSize, themeFrom, viewPreview, type ViewTable } from './index';

const theme = themeFrom(HOUSE_TOKENS.properties).theme;
const parsed = parseDataset(new TextEncoder().encode(GDP_CSV), 'csv');
if (parsed instanceof DatasetError) throw new Error(parsed.reason);
const gdp: ViewTable = parsed;
const numbers = (n: number): ViewTable => ({ columns: [{ name: 'k', type: 'string' }, { name: 'v', type: 'number' }], rows: Array.from({ length: n }, (_, i) => [`k${i}`, i * 1000.5]) });

const escaped = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

describe('a table view’s cells', () => {
  it('are the HTML table’s cells: every header, cell and note of the HTML is the table’s, in order', () => {
    const rendered = renderView({ view: 'table', columns: ['country_ko', 'growth_pct'], filter: [{ column: 'year', op: 'eq', value: 2020 }], sort: { by: 'growth_pct', dir: 'asc' } }, gdp, theme, 'gdp');
    expect(rendered.html).toBeDefined();
    const { table } = rendered;
    expect(table!.columns).toEqual([
      { name: 'country_ko', numeric: false },
      { name: 'growth_pct', numeric: true },
    ]);
    const cells = [...rendered.html!.matchAll(/<t[hd](?: class="dash-num")?>(.*?)<\/t[hd]>/g)].map((m) => m[1]);
    expect(cells).toEqual([...table!.columns.map((c) => c.name), ...table!.rows.flat()].map(escaped));
    expect(table!.rows[0][1]).toMatch(/^−/); // the lowest growth of 2020 is negative, written with a true minus
  });

  it('bound the rows as the view does: 25 by default, the limit up to 100, the truncation note truthful', () => {
    const many = numbers(140);
    const by = (spec: Record<string, unknown>) => renderView({ view: 'table', ...spec }, many, theme, 'n').table!;
    expect(by({}).rows).toHaveLength(25);
    expect(by({}).notes).toEqual(['first 25 of 140 rows']);
    expect(by({ limit: 60 }).rows).toHaveLength(60);
    expect(by({ limit: 60 }).notes).toEqual([]);
    expect(by({ limit: 120 }).rows).toHaveLength(100);
    expect(by({ limit: 120 }).notes).toEqual(['first 100 of 120 rows']);
    expect(renderView({ view: 'table' }, numbers(0), theme, 'n').table!.notes).toEqual(['no rows to draw']);
  });

  it('a chart has no table, and states its size as its root does', () => {
    const rendered = renderView({ view: 'bar', x: 'k', y: 'v' }, numbers(3), theme, 'n');
    expect(rendered.table).toBeUndefined();
    const { width, height } = svgSize(rendered.svg!);
    expect(rendered.svg!.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"`)).toBe(true);
    expect(width).toBe(theme.width);
  });
});

describe('a view’s data preview', () => {
  it('a chart’s is its figure’s roles: the x, the series, each measure, aggregated as drawn', () => {
    const preview = viewPreview({ view: 'bar', x: 'year', y: 'growth_pct', series: 'iso3', agg: 'mean', filter: [{ column: 'iso3', op: 'in', value: ['KOR', 'JPN'] }], format: { year: 'text' } }, gdp, 'gdp');
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.table.columns.map((c) => c.name)).toEqual(['year', 'iso3', 'growth_pct']);
    expect(preview.table.rows[0][0]).toBe('2019');
    expect(preview.table.rows.every((row) => row.length === 3)).toBe(true);
  });

  it('a table view’s is its rendered table', () => {
    const spec = { view: 'table', columns: ['country', 'year'], limit: 30 };
    const preview = viewPreview(spec, gdp, 'gdp');
    expect(preview).toEqual({ ok: true, table: renderView(spec, gdp, theme, 'gdp').table });
  });

  it('takes the same bound and notes as a table view', () => {
    const preview = viewPreview({ view: 'line', x: 'k', y: 'v' }, numbers(40), 'n');
    expect(preview.ok && preview.table.rows.length).toBe(25);
    expect(preview.ok && preview.table.notes).toEqual(['first 25 of 40 rows']);
  });

  it('says why there is none, as the figure does', () => {
    expect(viewPreview({ view: 'bar', x: 'country', y: 'inflation' }, gdp, 'gdp')).toEqual({ ok: false, error: 'dataset "gdp" has no column "inflation"' });
    expect(viewPreview({ view: 'sankey' }, gdp, 'gdp')).toEqual({ ok: false, error: 'unknown view "sankey"' });
  });
});
