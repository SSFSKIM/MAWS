// E3 M3 fix (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R4 and Decision Log 11, 12): an export's labels
// take the one clock the export captured with its state. Every view's label over the captured descriptors is computed at
// that `now`, however long its snapshot's read takes and whatever the time when it ends; with no clock (a retained
// version's export) the labels are E2's saved ones.
import { describe, expect, it } from 'vitest';
import { schemaFor } from '../document/schema';
import { createDocument } from '../document/tabs';
import { newDoc } from '../yjs';
import { setDataset, type DatasetDescriptor } from './datasets';
import { exportTheme, prepareViews } from './export';
import type { ViewTable } from './render';
import { DATASET_STATES, utcTime } from './states';

const AT = Date.UTC(2026, 9, 17, 9, 0);
const table: ViewTable = { columns: [{ name: 'region', type: 'string' }, { name: 'total', type: 'number' }], rows: [['North', 1]] };
const query = (ref: string, staleAfter: number): DatasetDescriptor => ({
  title: `Live ${ref}`,
  source: { kind: 'query', server: 'fixture', tool: 'rows', args: {}, staleAfter, snapshot: { ref, at: AT } },
  columns: [...table.columns],
  rows: 1,
  updated: { at: AT, by: { kind: 'human' } },
  state: { status: 'ok', at: AT },
});
const chartJson = (id: string, source: string) => ({ type: 'chart', attrs: { id, source, spec: { view: 'table', title: `View ${id}` } } });

function board() {
  const doc = newDoc();
  createDocument(doc, { title: 'Board', body: schemaFor().nodeFromJSON({ type: 'doc', content: [chartJson('c1', 'a'), chartJson('c2', 'b'), chartJson('c3', 'a')] }) });
  setDataset(doc, 'a', query('assets/query-a.json', 60)); // stale from AT + 60 s
  setDataset(doc, 'b', query('assets/query-b.json', 120)); // stale from AT + 120 s
  return doc;
}
const node = (id: string, source: string) => schemaFor().nodeFromJSON(chartJson(id, source));

describe('an export’s captured clock (E3 M3 fix)', () => {
  it('labels every view at the captured now, a delayed read straddling a stale boundary changing nothing', async () => {
    const doc = board();
    const captured = AT + 90_000; // past a's boundary, before b's
    let releaseB!: () => void;
    const views = prepareViews(doc, {
      read: async ({ ref }) => {
        if (ref === 'assets/query-b.json') await new Promise<void>((resolve) => (releaseB = resolve)); // b's read ends long after b's boundary
        return table;
      },
      theme: exportTheme(),
      authorName: () => 'Owner',
      now: captured,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseB();
    const render = await views;
    const base = (ref: string) => `Live ${ref} · fixture · rows · updated ${utcTime(AT)} by Owner`;
    expect(render(node('c1', 'a'))?.sourceLabel).toBe(`${base('assets/query-a.json')} · ${DATASET_STATES.staleSince(AT + 60_000)}`);
    expect(render(node('c3', 'a'))?.sourceLabel).toBe(render(node('c1', 'a'))?.sourceLabel);
    expect(render(node('c2', 'b'))?.sourceLabel).toBe(base('assets/query-b.json'));
    expect(render(node('c2', 'b'))?.markdown).toContain(`*${base('assets/query-b.json').replace(/[\\`*_[\]<>|~&$#=+]/g, '\\$&')}*`);
  });

  it('without a clock (a retained version’s export) keeps the saved labels', async () => {
    const render = await prepareViews(board(), { read: async () => table, theme: exportTheme(), authorName: () => 'Owner' });
    expect(render(node('c1', 'a'))?.sourceLabel).toBe(`Live assets/query-a.json · fixture · rows · updated ${utcTime(AT)} by Owner`);
  });
});
