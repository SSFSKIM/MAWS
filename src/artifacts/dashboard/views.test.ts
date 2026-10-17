// A dashboard's chart specs in its doc (P3-E2 M3; parent Decision Log 9): read and reported per block, and normalised
// by the grammar before a write commits, only where the write wrote them.
import { describe, expect, it } from 'vitest';
import { importMarkdown } from '../document/import/markdown';
import { createDocument } from '../document/tabs';
import { newDoc, transact, type Doc } from '../yjs';
import { chartSpecs, normalizeChartSpecs, viewWarnings } from './views';

const MD = [
  'Intro paragraph.',
  '',
  `:::chart {spec-json='{"view":"bar","x":"region","y":"sales","colour":"red"}'}`,
  'sales',
  ':::',
  '',
  `:::chart {spec-json='{"view":"sankey","title":"Flows"}'}`,
  'flows',
  ':::',
  '',
  `:::chart {spec-json='{"view":"table","title":"All rows"}'}`,
  'sales',
  ':::',
].join('\n');

function doc(markdown = MD): Doc {
  const d = newDoc();
  createDocument(d, { title: 'Board', body: importMarkdown(markdown) });
  return d;
}
const specs = (d: Doc) => chartSpecs(d).map(({ spec }) => spec);

describe('chartSpecs', () => {
  it('lists every chart block with its id, dataset and spec, in document order', () => {
    const d = doc();
    const listed = chartSpecs(d);
    expect(listed.map(({ source }) => source)).toEqual(['sales', 'flows', 'sales']);
    expect(listed.every(({ blockId }) => typeof blockId === 'string' && blockId.length > 0)).toBe(true);
    expect(specs(d)[0]).toEqual({ view: 'bar', x: 'region', y: 'sales', colour: 'red' });
  });
});

describe('viewWarnings', () => {
  it('reports what each block\'s spec drops or cannot draw, without writing', () => {
    const d = doc();
    const [bar, sankey] = chartSpecs(d);
    let writes = 0;
    d.on('update', () => (writes += 1));
    expect(viewWarnings(d)).toEqual([
      { blockId: bar.blockId, message: 'unknown key "colour" ignored' },
      { blockId: sankey.blockId, message: 'unknown view "sankey"; the view draws as an error' },
    ]);
    expect(writes).toBe(0);
  });
});

describe('normalizeChartSpecs', () => {
  it('stores the grammar\'s reading of every spec the write wrote, in one transaction, and answers its warnings', () => {
    const d = doc();
    const [bar, sankey] = chartSpecs(d);
    let updates = 0;
    d.on('update', () => (updates += 1));
    expect(normalizeChartSpecs(d, new Map())).toEqual([
      { blockId: bar.blockId, message: 'unknown key "colour" ignored' },
      { blockId: sankey.blockId, message: 'unknown view "sankey"; the view draws as an error' },
    ]);
    expect(updates).toBe(1);
    expect(specs(d)).toEqual([{ view: 'bar', x: 'region', y: 'sales' }, { view: 'sankey', title: 'Flows' }, { view: 'table', title: 'All rows' }]);
  });

  it('leaves a spec it did not write as it was: a retained one stays, reported by a read', () => {
    const d = doc();
    const before = new Map(chartSpecs(d).map(({ blockId, spec }) => [blockId, JSON.stringify(spec)]));
    const [bar] = chartSpecs(d);
    // the write sets one new spec on the table block only
    const table = chartSpecs(d)[2];
    transact(d, () => table.node.setAttr('spec', { view: 'table', title: 'All rows', wrap: true }));
    expect(normalizeChartSpecs(d, before)).toEqual([{ blockId: table.blockId, message: 'unknown key "wrap" ignored' }]);
    expect(specs(d)[0]).toEqual({ view: 'bar', x: 'region', y: 'sales', colour: 'red' });
    expect(specs(d)[2]).toEqual({ view: 'table', title: 'All rows' });
    expect(viewWarnings(d)[0]).toEqual({ blockId: bar.blockId, message: 'unknown key "colour" ignored' });
  });

  it('writes nothing when every spec is already the grammar\'s', () => {
    const d = doc(`:::chart {spec-json='{"view":"line","x":"at","y":"v"}'}\nseries\n:::`);
    let updates = 0;
    d.on('update', () => (updates += 1));
    expect(normalizeChartSpecs(d, new Map())).toEqual([]);
    expect(updates).toBe(0);
  });
});
