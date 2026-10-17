// P3-E2 M6 (acceptance 7): the scale bench is the shape the scale rows name: 50,000 rows the host's parser reads with the
// declared column types, the same bytes for one variant and other values for another, twelve views of every kind that
// all draw (none an error state) under the closed grammar with no dropped key, and the scatter exactly 10,000 points.
import { describe, expect, it } from 'vitest';
import { HOUSE_TOKENS } from '../../document/export/design-system';
import { DatasetError, parseDataset } from '../parse';
import { renderView, themeFrom } from '../render';
import { parseSpec, VIEW_KINDS } from '../spec';
import { BENCH_DATASET, BENCH_ROWS, BENCH_SCATTER_POINTS, BENCH_VIEWS, benchCsv, benchMarkdown } from './bench';

const theme = themeFrom(HOUSE_TOKENS.properties).theme;

describe('the scale bench', () => {
  const csv = benchCsv();
  const parsed = parseDataset(new TextEncoder().encode(csv), 'csv');
  if (parsed instanceof DatasetError) throw new Error(parsed.reason);

  it('is 50,000 rows of the declared columns, the same bytes for one variant and other values for another', () => {
    expect(parsed.rows).toHaveLength(BENCH_ROWS);
    expect(parsed.columns).toEqual([
      { name: 'order_id', type: 'string' },
      { name: 'day', type: 'date' },
      { name: 'region', type: 'string' },
      { name: 'channel', type: 'string' },
      { name: 'units', type: 'number' },
      { name: 'revenue', type: 'number' },
      { name: 'margin', type: 'number' },
      { name: 'returned', type: 'boolean' },
    ]);
    expect(benchCsv() === csv).toBe(true);
    const other = benchCsv(BENCH_ROWS, 1);
    expect(other === csv).toBe(false);
    expect(other.split('\n')[0]).toBe(csv.split('\n')[0]);
    expect(new TextEncoder().encode(csv).length).toBeLessThan(16 * 1024 * 1024);
  });

  it('draws twelve views of every kind, none an error and no key dropped; the scatter is 10,000 points', () => {
    expect(BENCH_VIEWS).toHaveLength(12);
    expect(new Set(BENCH_VIEWS.map((spec) => spec.view))).toEqual(new Set(VIEW_KINDS));
    for (const spec of BENCH_VIEWS) {
      const checked = parseSpec(spec);
      expect(checked.ok && checked.warnings, String(spec.title)).toEqual([]);
      const rendered = renderView(spec, parsed, theme, BENCH_DATASET);
      const out = rendered.svg ?? rendered.html ?? '';
      expect(out, String(spec.title)).not.toContain('This view cannot be drawn');
      expect(out.length, String(spec.title)).toBeGreaterThan(0);
    }
    const scatter = renderView(BENCH_VIEWS.find((spec) => spec.view === 'scatter')!, parsed, theme, BENCH_DATASET).svg!;
    expect(/data-xy="([^"]*)"/.exec(scatter)![1]!.split(' ')).toHaveLength(BENCH_SCATTER_POINTS);
  });

  it('writes the dashboard’s markdown with the twelve views over the dataset', () => {
    const markdown = benchMarkdown();
    expect(markdown.match(/^:::chart /gm)).toHaveLength(12);
    expect(markdown.match(new RegExp(`^${BENCH_DATASET}$`, 'gm'))).toHaveLength(12);
  });
});
