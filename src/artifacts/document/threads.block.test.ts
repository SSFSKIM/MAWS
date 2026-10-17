// P3-E (E2 M4 of docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md; E's Decision Log 28): a thread on a whole block,
// a dashboard's chart. Its anchor is `{kind: 'block'}`; the thread's own `tabId`, `blockId` and `quote` say where it is.
// It is live while some tab holds a block with its id (a move, between tabs too, keeps it live, and the refresh follows
// its tab), orphaned with its quote kept when the block goes, live again on an undo or a restore that brings the block
// back; it carries no mark, so the mark's model and B's text threads are untouched beside it.
import { describe, expect, it } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import { applyV2, newDoc, revertUpdate, stateV2, transact, type Doc, type Node } from '../yjs';
import { UndoManager, YNode } from '../yjs/document';
import { pmnodeToDelta } from '../yjs/prosemirror';
import { schemaFor } from './schema';
import { addTab, createDocument, tabBody } from './tabs';
import {
  addThread,
  anchorOfMark,
  getThread,
  isBlockAnchor,
  isTextAnchor,
  liveThreadIds,
  locate,
  refreshAnchors,
  reopen,
  reply,
  resolve,
  threadStates,
} from './threads';

const schema = schemaFor();
const owner: Actor = { kind: 'human' };
let clock = 1_760_000_000_000;
const now = () => (clock += 1000);

const chart = (id: string, source = 'sales') => ({ type: 'chart', attrs: { id, source, spec: { view: 'bar', x: 'region', y: 'total', title: 'Sales by region' } } });
const paragraph = (id: string, text: string, marks?: unknown[]) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text, ...(marks && { marks }) }] });

function seeded(): { doc: Doc; one: string; two: string } {
  const doc = newDoc();
  const one = createDocument(doc, { title: 'One', body: schema.nodeFromJSON({ type: 'doc', content: [paragraph('p1', 'Intro', [{ type: 'comment', attrs: { threadId: 'tx' } }]), chart('c1'), paragraph('p2', 'Notes')] }) });
  const two = addTab(doc, { title: 'Two', body: schema.nodeFromJSON({ type: 'doc', content: [paragraph('q1', 'Elsewhere')] }) });
  addThread(doc, { threadId: 'tx', tabId: one, blockId: 'p1', quote: 'Intro', anchor: anchorOfMark(tabBody(doc, one)!, 'tx')!, by: owner, at: now(), body: 'On the text.' });
  addThread(doc, { threadId: 'tb', tabId: one, blockId: 'c1', quote: 'chart: Sales by region', anchor: { kind: 'block' }, by: owner, at: now(), body: 'On the chart.' });
  return { doc, one, two };
}

const topIndex = (body: Node, id: string): number => body.toArray().findIndex((node) => node instanceof YNode && node.getAttr('id') === id);
/** Takes block `id` out of `from` and puts a copy of it at the end of `to` (a cut and a paste, or the agent's move). */
function moveBlock(doc: Doc, id: string, from: string, to: string): void {
  const source = tabBody(doc, from)!;
  const at = topIndex(source, id);
  const copy = pmnodeToDelta(schema.nodeFromJSON({ type: 'doc', content: [chart(id)] }).firstChild!);
  transact(doc, () => {
    source.delete(at, 1);
    const target = tabBody(doc, to)!;
    target.insert(target.length, [copy]);
  });
}
const states = (doc: Doc) =>
  threadStates(doc, liveThreadIds(doc))
    .map((t) => `${t.id}:${t.status}${t.live ? ':live' : ''}${t.orphan ? ':orphan' : ''}`)
    .join(' ');

describe('a block-anchored thread (P3-E)', () => {
  it('stores the block discriminant alone; the thread’s tab, block and quote stay its own fields, and no mark is written', () => {
    const { doc, one } = seeded();
    const thread = getThread(doc, 'tb')!;
    expect(thread.anchor).toEqual({ kind: 'block' });
    expect(isBlockAnchor(thread.anchor)).toBe(true);
    expect(isTextAnchor(thread.anchor)).toBe(false);
    expect(isTextAnchor(getThread(doc, 'tx')!.anchor)).toBe(true);
    expect(isBlockAnchor(getThread(doc, 'tx')!.anchor)).toBe(false);
    expect(isTextAnchor({ start: null, end: null, block: null })).toBe(true); // B's stored shape, whatever its positions
    expect(isBlockAnchor(null)).toBe(false);
    expect(isTextAnchor(null)).toBe(false);
    expect([thread.tabId, thread.blockId, thread.quote]).toEqual([one, 'c1', 'chart: Sales by region']);
    expect(JSON.stringify(tabBody(doc, one)!.toDelta().toJSON())).not.toContain('tb');
  });

  it('is live while its block is, and locates to the block', () => {
    const { doc } = seeded();
    expect(liveThreadIds(doc)).toEqual(new Set(['tx', 'tb']));
    expect(states(doc)).toBe('tx:open:live tb:open:live');
    expect(locate(doc, getThread(doc, 'tb')!)).toEqual({ how: 'block', blockId: 'c1', index: 1 });
  });

  it('a block moved to another tab stays live; the refresh follows its tab, and changes nothing more', () => {
    const { doc, one, two } = seeded();
    moveBlock(doc, 'c1', one, two);
    expect(states(doc)).toBe('tx:open:live tb:open:live');
    expect(locate(doc, getThread(doc, 'tb')!)).toEqual({ how: 'block', blockId: 'c1', index: 1 });
    expect(refreshAnchors(doc)).toEqual(['tb']);
    expect(getThread(doc, 'tb')).toMatchObject({ tabId: two, blockId: 'c1', quote: 'chart: Sales by region', anchor: { kind: 'block' } });
    expect(refreshAnchors(doc)).toEqual([]);
    // scoped as the host scopes an update: only the threads named
    moveBlock(doc, 'c1', two, one);
    expect(refreshAnchors(doc, undefined, { threads: new Set(['tx']), blocks: () => [] })).toEqual([]);
    expect(refreshAnchors(doc, undefined, { threads: new Set(['tb']), blocks: () => [] })).toEqual(['tb']);
    expect(getThread(doc, 'tb')!.tabId).toBe(one);
  });

  it('is orphaned when its block is deleted, its quote kept; an undo makes it live again', () => {
    const { doc, one } = seeded();
    const body = tabBody(doc, one)!;
    const undo = new UndoManager(body);
    transact(doc, () => body.delete(topIndex(body, 'c1'), 1));
    undo.stopCapturing();
    expect(states(doc)).toBe('tx:open:live tb:open:orphan');
    expect(locate(doc, getThread(doc, 'tb')!)).toEqual({ how: 'none', blockId: null });
    expect(getThread(doc, 'tb')!.quote).toBe('chart: Sales by region');
    expect(refreshAnchors(doc)).toEqual([]); // an orphan's record is not rewritten
    undo.undo();
    expect(states(doc)).toBe('tx:open:live tb:open:live');
  });

  it('resolves, reopens and takes replies as a text thread does; a resolved block thread is not an orphan', () => {
    const { doc, one } = seeded();
    resolve(doc, 'tb', owner, now());
    reply(doc, 'tb', { id: 'tb:m1', by: owner, at: now(), body: 'Later.' });
    const body = tabBody(doc, one)!;
    transact(doc, () => body.delete(topIndex(body, 'c1'), 1));
    expect(states(doc)).toBe('tx:open:live tb:resolved');
    reopen(doc, 'tb', owner, now());
    expect(states(doc)).toBe('tx:open:live tb:open:orphan');
    expect(getThread(doc, 'tb')!.messages.map((m) => m.body)).toEqual(['On the chart.', 'Later.']);
  });

  it('a revert that brings the block back makes it live again (the adapter test keeps its replies through a restore)', () => {
    const { doc, one } = seeded();
    const version = stateV2(doc);
    const body = tabBody(doc, one)!;
    transact(doc, () => body.delete(topIndex(body, 'c1'), 1));
    expect(states(doc)).toBe('tx:open:live tb:open:orphan');
    applyV2(doc, revertUpdate(version, stateV2(doc), null));
    expect(states(doc)).toBe('tx:open:live tb:open:live');
  });

  it('a document with no block thread reads exactly as before: text threads only', () => {
    const doc = newDoc();
    const tab = createDocument(doc, { title: 'Plain', body: schema.nodeFromJSON({ type: 'doc', content: [paragraph('p1', 'Intro', [{ type: 'comment', attrs: { threadId: 'tx' } }]), chart('c1')] }) });
    addThread(doc, { threadId: 'tx', tabId: tab, blockId: 'p1', quote: 'Intro', anchor: anchorOfMark(tabBody(doc, tab)!, 'tx')!, by: owner, at: now() });
    addThread(doc, { threadId: 'gone', tabId: tab, blockId: 'c1', quote: 'x', anchor: { start: null, end: null, block: null }, by: owner, at: now() });
    expect(liveThreadIds(doc)).toEqual(new Set(['tx']));
    expect(locate(doc, getThread(doc, 'gone')!)).toEqual({ how: 'none', blockId: null }); // a text anchor never locates by its block id alone
  });
});
