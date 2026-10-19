// The dashboard kind's guide and format reference against what they document (P3-E2 M5; E's Decision Log 32): the data
// file parses with the host's own parser into the columns the text says; the content reads as the document dialect and
// every view spec in it is the grammar's without a warning, each drawing a figure or table over that file, never a
// state; the `artifact_dataset` call is a valid input, and the row key the text says would be refused is refused; the
// structure's one view form reads back as the block it shows; the limits and state wordings stated are the ones the
// code enforces and draws; and the guide names the tools it relies on.
import { describe, expect, it } from 'vitest';
import { ArtifactDatasetInputSchema } from '@shared/maws/dashboard-tools';
import { DATASET_LIMITS } from '../../dashboard/datasets';
import { DatasetError, parseDataset, rowKeyProblem } from '../../dashboard/parse';
import { renderView, TABLE_VIEW_MAX_ROWS, TABLE_VIEW_ROWS, themeFrom } from '../../dashboard/render';
import { parseSpec, SPEC_LIMITS, VIEW_KINDS, AGGREGATES, FILTER_OPS, VALUE_FORMATS } from '../../dashboard/spec';
import { DATASET_STATES, VIEW_STATES } from '../../dashboard/states';
import { importMarkdown } from '../../document/import/markdown';
import { docMarkdown } from '../../document/markdown';
import { schemaFor } from '../../document/schema';
import { KIND_GUIDES } from '../guides';

const { guide, format } = KIND_GUIDES.dashboard;
const fences = (language: string): string[] => [...format.matchAll(new RegExp(`\`\`\`${language}\\n([\\s\\S]*?)\\n\`\`\``, 'g'))].map((match) => match[1]);
const headings = (text: string) => text.split('\n').filter((line) => line.startsWith('## '));
const charts = (markdown: string) => {
  const out: { source: string; spec: unknown }[] = [];
  importMarkdown(markdown).descendants((node) => {
    if (node.type.name === 'chart') out.push({ source: String(node.attrs.source), spec: node.attrs.spec });
    return true;
  });
  return out;
};

describe('the dashboard format reference', () => {
  const [csv] = fences('csv');
  const [content] = fences('markdown');
  const [call] = fences('json');
  const [structure] = fences('text');
  const parsed = parseDataset(new TextEncoder().encode(`${csv}\n`), 'csv');

  it('has its sections, the guide its own, and neither is a placeholder', () => {
    expect(headings(format)).toEqual(['## Structure', '## Elements and attributes', '## Limits', '## Examples']);
    expect(headings(guide)).toEqual(['## When to use this kind', '## Creating one', '## Reading and editing', '## Comments', '## Working with a design system', '## Before you finish']);
    for (const text of [guide, format]) expect(text).not.toMatch(/Not yet written/);
    for (const name of ['artifact_create', 'artifact_dataset', 'baseRevision', 'artifact_read', 'viewWarnings', 'artifact_edit', 'replace_block', 'remove: true', 'conflict', 'artifact_export', 'artifact_reply']) expect(guide).toContain(name);
  });

  it('its data file parses into the columns and rows it says', () => {
    if (parsed instanceof DatasetError) throw new Error(parsed.reason);
    expect(parsed.columns).toEqual([
      { name: 'region', type: 'string' },
      { name: 'quarter', type: 'string' },
      { name: 'total', type: 'number' },
    ]);
    expect(parsed.rows).toHaveLength(4);
    expect(format).toContain('`region` string, `quarter` string, `total` number), `rows: 4`');
    expect(rowKeyProblem(parsed, 'quarter')).not.toBeNull(); // the row key it says would be refused is
  });

  it('its content is the dialect, each spec the grammar’s with no warning, each drawing over the file', () => {
    if (parsed instanceof DatasetError) throw new Error(parsed.reason);
    const views = charts(content);
    expect(views).toHaveLength(3);
    const md = docMarkdown();
    expect(md.serialize(schemaFor().node('doc', null, md.parse(content)), { ids: false })).toBe(content); // canonical: reads back as written
    for (const { source, spec } of views) {
      expect(source).toBe('sales');
      const read = parseSpec(spec);
      expect(read.ok && read.warnings).toEqual([]);
      const drawn = renderView(spec, parsed, themeFrom({}).theme, source);
      expect(drawn.svg ?? drawn.html).not.toContain('This view cannot be drawn');
      expect(drawn.warnings).toEqual([]);
    }
  });

  it('its structure example is one view block, and its binding a valid artifact_dataset call', () => {
    expect(charts(structure)).toEqual([{ source: 'sales', spec: { view: 'bar', x: 'region', y: 'total', title: 'Sales by region' } }]);
    const input = ArtifactDatasetInputSchema.parse(JSON.parse(call));
    expect(input).toMatchObject({ id: 'sales', path: 'sales.csv', baseRevision: 1 });
    expect(charts(content).every(({ source }) => source === input.id)).toBe(true);
  });

  it('names the grammar’s every view, aggregate, filter op and format', () => {
    const grammar = format.split('**View spec.**')[1].split('**States**')[0];
    for (const word of [...VIEW_KINDS, ...AGGREGATES, ...FILTER_OPS, ...VALUE_FORMATS]) expect(grammar).toContain(`\`${word}\``);
  });

  // P3-F: the one-measure pie the grammar enforces (a second measure is the view's error), said where `y` is
  it('says a pie takes exactly one measure in `y`, as the grammar refuses more', () => {
    expect(format.split('\n').find((line) => line.startsWith('| `y` |'))).toContain('a pie takes exactly one');
    expect(parseSpec({ view: 'pie', x: 'region', y: ['total', 'quarter'] }).ok).toBe(false);
  });

  it('states the limits the code enforces and the states as drawn', () => {
    const limits = format.split('## Limits')[1].split('## Examples')[0];
    const number = (value: number) => value.toLocaleString('en-US');
    for (const value of [DATASET_LIMITS.bytes, DATASET_LIMITS.rows, DATASET_LIMITS.columns, DATASET_LIMITS.columnName, DATASET_LIMITS.datasets, SPEC_LIMITS.title, SPEC_LIMITS.ys, SPEC_LIMITS.inValues, SPEC_LIMITS.limit, TABLE_VIEW_MAX_ROWS]) expect(limits).toContain(number(value));
    expect(format).toContain(`first ${TABLE_VIEW_ROWS} rows`);
    for (const state of [DATASET_STATES.noDataset('<id>'), DATASET_STATES.noColumn('<id>', '<name>'), DATASET_STATES.unreadable('<id>'), VIEW_STATES.needs('bar', 'a y column'), VIEW_STATES.tooManySeries(0).replace('0', '<n>'), VIEW_STATES.tablePreview(25, 140), DATASET_STATES.mismatches(2, 40, 'total', 'number'), VIEW_STATES.unsupportedDomain('<column>'), VIEW_STATES.slicesFolded(9).replace('9', '<n>')]) expect(format).toContain(state);
  });
});
