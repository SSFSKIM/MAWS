// A dashboard's block threads on B's kind adapter (P3-E2 M4 of docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md;
// E's Decision Log 28), driven as A's service drives it: the per-update hook follows a chart block moved to another tab
// (the mark-scoped refresh never sees a block thread, so the hook names them by the blocks the update inserted), and a
// restore reverts the datasets with the rest of the doc while keeping every conversation, a block thread's replies and
// one created after the version included, the block coming back making its thread live again.
import { describe, expect, it } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import { applyV2, newDoc, onUpdate, revertUpdate, stateV2, transact, type Doc, type Node } from '../yjs';
import { YNode } from '../yjs/document';
import { pmnodeToDelta } from '../yjs/prosemirror';
import { schemaFor } from '../document/schema';
import { addTab, createDocument, tabBody } from '../document/tabs';
import { addThread, getThread, liveThreadIds, reply, resolve, threadStates } from '../document/threads';
import { dashboardAdapter } from './adapter';
import { readDataset, setDataset, type DatasetDescriptor } from './datasets';

const schema = schemaFor();
const human: Actor = { kind: 'human' };
const agent = { kind: 'session', appSessionId: 'session-1' } as Actor;
const ARTIFACT = 'dash-1';
let clock = 1_760_000_000_000;
const now = () => (clock += 60_000);

const chart = (id: string) => ({ type: 'chart', attrs: { id, source: 'sales', spec: { view: 'bar', x: 'region', y: 'total', title: 'Sales by region' } } });
const descriptor = (ref: string, rows: number): DatasetDescriptor => ({
  title: 'Sales',
  source: { kind: 'file', ref, name: 'sales.csv', format: 'csv', sha256: ref.slice(-1).repeat(64), size: 10 },
  columns: [
    { name: 'region', type: 'string' },
    { name: 'total', type: 'number' },
  ],
  rows,
  updated: { at: clock, by: human },
  state: { status: 'ok', at: clock },
});

function seeded(): { doc: Doc; one: string; two: string } {
  const doc = newDoc();
  const one = createDocument(doc, { title: 'One', body: schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'Intro' }] }, chart('c1')] }) });
  const two = addTab(doc, { title: 'Two', body: schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'q1' }, content: [{ type: 'text', text: 'Elsewhere' }] }] }) });
  setDataset(doc, 'sales', descriptor('assets/a', 4));
  addThread(doc, { threadId: 'tb', tabId: one, blockId: 'c1', quote: 'chart: Sales by region', anchor: { kind: 'block' }, by: human, at: now(), body: 'Why the dip?' });
  return { doc, one, two };
}

const topIndex = (body: Node, id: string): number => body.toArray().findIndex((node) => node instanceof YNode && node.getAttr('id') === id);
/** `write` as one update, then the adapter's per-update hook in its own transaction, as A's service runs them. */
function frame(doc: Doc, write: () => void) {
  const adapter = dashboardAdapter();
  let update: Uint8Array | null = null;
  const off = onUpdate(doc, (u) => (update ??= u));
  transact(doc, write);
  off();
  const box: { outcome?: ReturnType<NonNullable<typeof adapter.afterUpdate>> } = {};
  transact(doc, () => (box.outcome = adapter.afterUpdate!(doc, { artifactId: ARTIFACT, update: update!, actor: agent })));
  return box.outcome;
}
const states = (doc: Doc) =>
  threadStates(doc, liveThreadIds(doc))
    .map((t) => `${t.id}:${t.status}${t.orphan ? ':orphan' : ''}`)
    .join(' ');

describe('a dashboard’s block threads on the kind adapter (P3-E2 M4)', () => {
  it('a chart moved to another tab takes its thread’s tab with it in the same frame', () => {
    const { doc, one, two } = seeded();
    frame(doc, () => {
      const from = tabBody(doc, one)!;
      const copy = pmnodeToDelta(schema.nodeFromJSON(chart('c1')));
      from.delete(topIndex(from, 'c1'), 1);
      tabBody(doc, two)!.insert(1, [copy]);
    });
    expect(getThread(doc, 'tb')).toMatchObject({ tabId: two, blockId: 'c1', anchor: { kind: 'block' }, quote: 'chart: Sales by region' });
    expect(states(doc)).toBe('tb:open');
  });

  it('typing in a block writes nothing to a block thread', () => {
    const { doc, one } = seeded();
    const before = stateV2(doc);
    frame(doc, () => (tabBody(doc, one)!.get(0) as Node).insert(5, ' more'));
    expect(getThread(doc, 'tb')!.tabId).toBe(one);
    const after = newDoc();
    applyV2(after, before);
    expect(getThread(after, 'tb')).toEqual(getThread(doc, 'tb'));
  });

  it('a restore reverts the dataset and the chart’s deletion, keeps the block thread’s replies and a thread made since, and its thread is live again', () => {
    const adapter = dashboardAdapter();
    const { doc, one } = seeded();
    const version = stateV2(doc);
    setDataset(doc, 'sales', descriptor('assets/b', 9));
    const body = tabBody(doc, one)!;
    transact(doc, () => body.delete(topIndex(body, 'c1'), 1));
    resolve(doc, 'tb', agent, now());
    reply(doc, 'tb', { id: 'tb:m1', by: agent, at: now(), body: 'Fixed in the new data.' });
    addThread(doc, { threadId: 'later', tabId: one, blockId: 'p1', quote: 'chart: Sales by region', anchor: { kind: 'block' }, by: human, at: now(), body: 'Made after.' });
    expect(states(doc)).toBe('tb:resolved later:open');

    const old = newDoc();
    applyV2(old, version);
    const scope = adapter.revertScope!(doc, old, { artifactId: ARTIFACT });
    applyV2(doc, revertUpdate(version, stateV2(doc), scope?.keep ?? null));
    transact(doc, () => adapter.afterRestore!(doc, { artifactId: ARTIFACT, versionId: 2 }));

    expect(readDataset(doc, 'sales')).toMatchObject({ source: { ref: 'assets/a' }, rows: 4 });
    expect(getThread(doc, 'tb')!.messages.map((m) => m.body)).toEqual(['Why the dip?', 'Fixed in the new data.']);
    expect(getThread(doc, 'later')!.messages.map((m) => m.body)).toEqual(['Made after.']);
    expect(states(doc)).toBe('tb:open later:open'); // the version's status, the chart back; p1 is a block too
  });
});
