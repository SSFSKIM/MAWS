// P3-E2 M4 (E's Decision Log 28 (2), (5)): the quote a dashboard's chart block is commented under, which is also the
// comment's locator: `<view>: <caption or dataset id>`, `table` for a table view and `chart` for every drawn one (a spec
// the grammar refuses included); any other block gives none, so prose is commented as B's passage.
import { describe, expect, it } from 'vitest';
import { schemaFor } from '../document/schema';
import { blockCommentQuote } from './comments';

const schema = schemaFor();
const chart = (source: string, spec: unknown) => schema.nodeFromJSON({ type: 'chart', attrs: { id: 'c1', source, spec } });

describe('a dashboard block’s comment quote (P3-E2 M4)', () => {
  it('is the view and its caption', () => {
    expect(blockCommentQuote(chart('sales', { view: 'bar', x: 'region', y: 'total', title: 'Sales by region' }))).toBe('chart: Sales by region');
    expect(blockCommentQuote(chart('sales', { view: 'line', x: 'month', y: 'total', title: '월별 매출' }))).toBe('chart: 월별 매출');
    expect(blockCommentQuote(chart('sales', { view: 'table', columns: ['region'], title: 'Top regions' }))).toBe('table: Top regions');
  });

  it('names the dataset when there is no caption, and a spec the grammar refuses as a chart', () => {
    expect(blockCommentQuote(chart('sales', { view: 'scatter', x: 'a', y: 'b' }))).toBe('chart: sales');
    expect(blockCommentQuote(chart('sales', { view: 'table', title: '   ' }))).toBe('table: sales');
    expect(blockCommentQuote(chart('sales', { view: 'radar', title: 'Old view' }))).toBe('chart: Old view');
    expect(blockCommentQuote(chart('sales', 'not a spec'))).toBe('chart: sales');
    expect(blockCommentQuote(chart('', null))).toBe('chart: (no dataset)');
  });

  it('gives none for any other block', () => {
    expect(blockCommentQuote(schema.nodeFromJSON({ type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'Prose' }] }))).toBeUndefined();
    expect(blockCommentQuote(schema.nodeFromJSON({ type: 'diagram', attrs: { id: 'd1', source: 'graph TD; A-->B' } }))).toBeUndefined();
  });
});
