// The planner's pairing of a container's children, its parse of the agent's markdown and the orphans it reports (P3-F,
// the F-document-model wave's edit-plan half; X26 and X10/X21 of docs/doperpowers/plans/2026-10-12-p3-co-work.md), each
// through the one writer, from the panel's reproducers.
import { describe, expect, it } from 'vitest';
import { applyEdit } from './patch-writer';
import { addThread } from './threads';
import { TAB, coveredIn, ids, liveThreads, nodeOf, now, pmOf, seedDoc, textOf } from './writer.fixture';

// scalpel-1#2 and scalpel-3#1's copied-id case: a `^id` copied from the read keeps that block wherever the agent writes
// it and whatever type it gives it (format.md), so its comments and its authorship stay with it.
describe('a copied ^id keeps its block', () => {
  it('pairs a list item by its copied id, not by its position', () => {
    const doc = seedDoc();
    const [li2, lp2] = [nodeOf(doc, 'li2'), nodeOf(doc, 'lp2')];
    applyEdit(doc, [{ op: 'replace_block', id: 'l1', markdown: '- second item updated ^li2\n^l1' }]);
    expect(ids(doc).filter((id) => /^l[ip]?\d$/.test(id))).toEqual(['l1', 'li2', 'lp2']);
    expect(textOf(doc, 'li2')).toBe('second item updated');
    expect(nodeOf(doc, 'li2') === li2 && nodeOf(doc, 'lp2') === lp2, 'li2’s own nodes, patched in place').toBe(true);
  });

  it('re-maps the comment of a child retyped under its copied id', () => {
    const quote = { type: 'blockquote', attrs: { id: 'q1' }, content: [{ type: 'paragraph', attrs: { id: 'qp1' }, content: [{ type: 'text', text: 'Same words remain.', marks: [{ type: 'comment', attrs: { threadId: 't7' } }] }] }] };
    const doc = seedDoc({ type: 'doc', content: [quote] }, { t7: 'Same words remain.' });
    const res = applyEdit(doc, [{ op: 'replace_block', id: 'q1', markdown: '> ## Same words remain. ^qp1' }]);
    expect(pmOf(doc, 'qp1').type.name).toBe('heading');
    expect(coveredIn(doc, 'qp1')).toEqual({ t7: 'Same words remain.' });
    expect(res.orphaned).toEqual([]);
    expect(liveThreads(doc).has('t7')).toBe(true);
  });
});

// scalpel-1#3: milestones are the read's outside raw regions only; a raw source (a diagram's) is literal, so text in it
// shaped like a milestone survives an edit, as it survives the read.
describe('literal milestone text in a raw source', () => {
  it('survives a quoted edit and a rewrite of the diagram', () => {
    const doc = seedDoc({ type: 'doc', content: [{ type: 'diagram', attrs: { id: 'd1', source: 'graph TD\n  A["<c:label>"] --> B' } }] }, {});
    applyEdit(doc, [{ op: 'replace_text', block: 'd1', old: '--> B', new: '--> C' }]);
    expect(pmOf(doc, 'd1').attrs.source).toBe('graph TD\n  A["<c:label>"] --> C');
    applyEdit(doc, [{ op: 'replace_block', id: 'd1', markdown: ':::diagram\ngraph TD\n  A["<c:label>"] --> D\n:::\n^d1' }]);
    expect(pmOf(doc, 'd1').attrs.source).toBe('graph TD\n  A["<c:label>"] --> D');
  });
});

// scalpel-3#3: a block thread (a chart's; it carries no mark) whose block the batch deletes is reported orphaned too
describe('the orphans a batch reports', () => {
  it('names a block thread whose block the batch deleted, and not one whose block it kept', () => {
    const chart = { type: 'chart', attrs: { id: 'c1', source: 'sales', spec: { view: 'bar', x: 'region', y: 'total', title: 'Sales by region' } } };
    const doc = seedDoc({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'Intro' }] }, chart, { type: 'paragraph', attrs: { id: 'p2' }, content: [{ type: 'text', text: 'Notes' }] }] }, {});
    addThread(doc, { threadId: 'tb', tabId: TAB, blockId: 'c1', quote: 'chart: Sales by region', anchor: { kind: 'block' }, by: { kind: 'human' }, at: now(), body: 'On the chart.' });
    expect(applyEdit(doc, [{ op: 'delete', id: 'p1' }]).orphaned).toEqual([]);
    expect(applyEdit(doc, [{ op: 'delete', id: 'c1' }]).orphaned).toEqual(['tb']);
  });
});
