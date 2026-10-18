// A dashboard as the export tests read it (P3-E2 M5): prose, a bar chart and a table over `sales`, a table view nested in
// a quote, a view of a dataset nobody bound, a view whose spec cannot be read, a block thread on the bar chart, and the
// snapshot's rows by ref (two snapshots: the bound one and the one a replacement binds). Shared by the dashboard's own
// export tests, B's view-hook tests beside its exporters and main's wrapper tests.
import type { Actor } from '@shared/artifacts/actor';
import { schemaFor } from '../../document/schema';
import { createDocument } from '../../document/tabs';
import { addThread, reply } from '../../document/threads';
import { newDoc, type Doc } from '../../yjs';
import { setDataset, type FileDatasetDescriptor } from '../datasets'; // E3: the file arm
import type { ViewTable } from '../render';

export const SESSION: Actor = { kind: 'session', appSessionId: 'session-a' } as Actor;
export const OWNER: Actor = { kind: 'human' };
export const BOUND_AT = Date.UTC(2026, 9, 1, 9, 0);
export const REPLACED_AT = Date.UTC(2026, 9, 2, 10, 30);
export const OLD_REF = 'assets/sales.csv';
export const NEW_REF = 'assets/sales-1.csv';

const columns = [
  { name: 'region', type: 'string' as const },
  { name: 'total', type: 'number' as const },
];
export const SNAPSHOTS: Record<string, ViewTable> = {
  [OLD_REF]: { columns, rows: [['North', 10], ['South', 20], ['West | *star*', 30]] },
  [NEW_REF]: { columns, rows: [['North', 70], ['South', 80], ['West | *star*', 90]] },
};

export const descriptor = (ref: string, at: number, by: Actor = SESSION): FileDatasetDescriptor => ({
  title: 'Sales',
  source: { kind: 'file', ref, name: 'sales.csv', format: 'csv', sha256: (ref === OLD_REF ? 'a' : 'b').repeat(64), size: 40 },
  columns,
  rows: 3,
  updated: { at, by },
  state: { status: 'ok', at },
});

export const BAR = { view: 'bar', x: 'region', y: 'total', title: 'Sales by region' };
export const TABLE = { view: 'table', columns: ['region', 'total'], title: 'Sales table' };
export const NESTED = { view: 'table', title: 'Quoted table' };
export const MISSING = { view: 'line', x: 'month', y: 'amount', title: 'Unbound view' };
export const UNREADABLE = { view: 'sankey', title: 'Flows' };

const chart = (id: string, source: string, spec: unknown) => ({ type: 'chart', attrs: { id, source, spec } });
const paragraph = (id: string, text: string) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] });

/** The dashboard: one tab, the views above, `sales` bound to the first snapshot, a thread on the bar chart's block. */
export function exportDashboard(): { doc: Doc; tabId: string } {
  const doc = newDoc();
  const body = schemaFor().nodeFromJSON({
    type: 'doc',
    content: [
      paragraph('p1', 'Sales by region, quarterly.'),
      chart('c1', 'sales', BAR),
      chart('c2', 'sales', TABLE),
      { type: 'blockquote', attrs: { id: 'q1' }, content: [chart('c3', 'sales', NESTED)] },
      chart('c4', 'refunds', MISSING),
      chart('c5', 'sales', UNREADABLE),
      paragraph('p2', 'Closing words.'),
    ],
  });
  const tabId = createDocument(doc, { title: 'Board', body });
  setDataset(doc, 'sales', descriptor(OLD_REF, BOUND_AT));
  addThread(doc, { threadId: 'tb1', tabId, blockId: 'c1', quote: 'chart: Sales by region', anchor: { kind: 'block' }, by: OWNER, at: BOUND_AT + 1_000, body: 'Why is West so high?' });
  reply(doc, 'tb1', { id: 'tb1:m1', by: SESSION, at: BOUND_AT + 2_000, body: 'A one-off order.' });
  return { doc, tabId };
}
