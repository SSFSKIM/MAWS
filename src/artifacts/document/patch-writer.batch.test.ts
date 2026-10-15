// M2's cases beyond S4's suite (D5, D6, D14 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): all-or-none
// settled before any Yjs write (no transaction opens for a refused batch), validation of the touched parents only, the
// sentence rule through the writer, `pending` and `answering`, the move rule's "retry", `removedByRestore`, the table's
// row checks, and the ids the writer mints.
import { NodeType } from '@tiptap/pm/model';
import type { JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import { idAt, stateV2, transact, type Node } from '../yjs';
import { DocIndex } from './block-index';
import { EditError, type EditRefusal } from './edit-ops';
import { applyEdit } from './patch-writer';
import { schemaFor } from './schema';
import { addTab } from './tabs';
import { getThread, reply } from './threads';
import { coveredIn, dupes, ids, marksOf, nodeOf, now, order, pmOf, replica, seedDoc, sequence, sync, textOf } from './writer.fixture';

const refusal = (run: () => unknown): EditRefusal => {
  try {
    run();
  } catch (error) {
    if (error instanceof EditError) return error.refusal;
    throw error;
  }
  throw new Error('the batch was not refused');
};
const slots = (node: Node) => [...Array(node.length).keys()].map((i) => idAt(node, i)!).map((id) => `${id.client}:${id.clock}`);
/** Counts the transactions `doc` opens while `run` runs. */
function transactions(doc: ReturnType<typeof seedDoc>, run: () => unknown): number {
  let n = 0;
  const count = () => void n++;
  doc.on('beforeTransaction', count);
  try {
    run();
  } catch {
    // the caller asserts the refusal separately
  } finally {
    doc.off('beforeTransaction', count);
  }
  return n;
}

afterEach(() => vi.restoreAllMocks());

describe('all or none, before any Yjs write (D6)', () => {
  it('an op failing after earlier ops validated opens no transaction and leaves the doc byte-identical', () => {
    const doc = seedDoc();
    const before = stateV2(doc);
    const ops = [
      { op: 'replace_text', block: 'p1', old: 'lazy', new: 'sleepy' },
      { op: 'insert', after: 'h1', markdown: 'A new paragraph.' },
      { op: 'move', id: 'p3', after: 'c1' },
      { op: 'replace_block', id: 'li1', markdown: '## not an item' },
    ] as const;
    expect(transactions(doc, () => applyEdit(doc, ops))).toBe(0);
    expect(refusal(() => applyEdit(doc, ops))).toMatchObject({ reason: 'invalid', opIndex: 3 });
    expect(stateV2(doc)).toEqual(before);
  });

  it('a batch that would empty a tab is refused as a whole', () => {
    const doc = seedDoc();
    const before = stateV2(doc);
    const ops = order(doc).map((id) => ({ op: 'delete' as const, id }));
    expect(refusal(() => applyEdit(doc, ops))).toMatchObject({ reason: 'invalid', opIndex: ops.length - 1 });
    expect(stateV2(doc)).toEqual(before);
  });

  it('a batch that validates is one transaction (one update)', () => {
    const doc = seedDoc();
    const ops = [
      { op: 'replace_text', block: 'p1', old: 'lazy', new: 'sleepy' },
      { op: 'insert', after: 'h1', markdown: 'A new paragraph.' },
      { op: 'set_cell', table: 'tb1', row: 1, col: 1, markdown: '7' },
    ] as const;
    expect(transactions(doc, () => applyEdit(doc, ops))).toBe(1);
  });

  it('validates only the parents the ops changed (createChecked never sees an untouched block)', () => {
    const doc = seedDoc();
    DocIndex.of(doc).tops('tab1'); // the index is built before the spy
    const checked = new Set<string>();
    const real = NodeType.prototype.createChecked;
    vi.spyOn(NodeType.prototype, 'createChecked').mockImplementation(function (this: NodeType, ...args: Parameters<NodeType['createChecked']>) {
      const id = (args[0] as { id?: unknown } | null)?.id;
      if (typeof id === 'string') checked.add(id);
      return real.apply(this, args);
    });
    applyEdit(doc, [
      { op: 'replace_text', block: 'p2', old: 'Friday', new: 'Monday' },
      { op: 'set_cell', table: 'tb1', row: 2, col: 0, markdown: 'gamma' },
    ]);
    const touched = new Set(['p2', 'tb1', 'tr2', 'td2a', 'td2ap']);
    expect([...checked].filter((id) => !touched.has(id))).toEqual([]);
    expect(checked.has('p2')).toBe(true);
    expect(checked.has('tb1')).toBe(true);
  });
});

describe('the sentence rule through the writer (D5)', () => {
  // Ten words, a comment on "delta" (a word both rewrites keep).
  const body = (): JSONContent => ({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { id: 's1' },
        content: [
          { type: 'text', text: 'Alpha beta gamma ' },
          { type: 'text', text: 'delta', marks: [{ type: 'comment', attrs: { threadId: 'k1' } }] },
          { type: 'text', text: ' epsilon zeta eta theta iota kappa.' },
        ],
      },
    ],
  });

  it('at half the words the sentence is rewritten whole, the comment kept on the retained word', () => {
    const doc = seedDoc(body(), { k1: 'delta' });
    const kept = slots(nodeOf(doc, 's1')).slice(17, 22); // "delta"
    applyEdit(doc, [{ op: 'replace_block', id: 's1', markdown: 'One beta two delta three zeta four theta five kappa.' }]);
    expect(coveredIn(doc, 's1')).toEqual({ k1: 'delta' });
    const now = slots(nodeOf(doc, 's1'));
    const at = textOf(doc, 's1').indexOf('delta');
    expect(now.slice(at, at + 5)).not.toEqual(kept); // re-inserted with the sentence
  });

  it('below half the word hunks stand, the retained word keeping its items', () => {
    const doc = seedDoc(body(), { k1: 'delta' });
    const kept = slots(nodeOf(doc, 's1')).slice(17, 22);
    applyEdit(doc, [{ op: 'replace_block', id: 's1', markdown: 'One beta two delta three zeta four theta iota kappa.' }]);
    expect(coveredIn(doc, 's1')).toEqual({ k1: 'delta' });
    const at = textOf(doc, 's1').indexOf('delta');
    expect(slots(nodeOf(doc, 's1')).slice(at, at + 5)).toEqual(kept);
  });
});

describe('pending and answering', () => {
  it('a pending block is inserted as a placeholder and filled section by section, its id passing to the first block', () => {
    const doc = seedDoc();
    const ins = applyEdit(doc, [{ op: 'insert', after: 'h1', markdown: ':::pending {intent="Write the risks section"} :::' }], { generateID: sequence('pd') });
    const [pending] = ins.results[0].newIds;
    expect(pmOf(doc, pending).type.name).toBe('pending');
    expect(pmOf(doc, pending).attrs.intent).toBe('Write the risks section');
    const filled = applyEdit(doc, [{ op: 'replace_block', id: pending, markdown: '## Risks\n\nThe first risk is the schedule.' }], { generateID: sequence('f') });
    expect(filled.results[0].line).toBe(`replaced ^${pending} (+1 blocks)`);
    expect(pmOf(doc, pending).type.name).toBe('heading');
    const at = order(doc).indexOf(pending);
    expect(order(doc)[at + 1]).toBe(filled.results[0].newIds[0]);
    expect(textOf(doc, filled.results[0].newIds[0])).toBe('The first risk is the schedule.');
  });

  it('answering a thread (S5 read check 6): the pin stays on the reworded words and the answer is the result lines', () => {
    const doc = seedDoc(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { id: 'p1' },
            content: [
              { type: 'text', text: 'The plan ' },
              { type: 'text', text: 'ships ', marks: [{ type: 'comment', attrs: { threadId: 't1' } }] },
              { type: 'text', text: 'quarterly', marks: [{ type: 'bold' }, { type: 'comment', attrs: { threadId: 't1' } }] },
              { type: 'text', text: ' with ', marks: [{ type: 'comment', attrs: { threadId: 't1' } }] },
              { type: 'text', text: 'design review', marks: [{ type: 'comment', attrs: { threadId: 't1' } }, { type: 'comment', attrs: { threadId: 't2' } }] },
              { type: 'text', text: ' notes', marks: [{ type: 'comment', attrs: { threadId: 't2' } }] },
              { type: 'text', text: '. Owners track the budget.' },
            ],
          },
        ],
      },
      { t1: 'ships quarterly with design review', t2: 'design review notes' },
    );
    const agent: Actor = { kind: 'session', appSessionId: 'session-1' } as Actor;
    const updates: number[] = [];
    doc.on('update', () => updates.push(1));
    transact(doc, () => {
      // `old` as copied from the read, a milestone in it (ignored)
      const res = applyEdit(doc, [{ op: 'replace_text', block: 'p1', old: '<c:t1>ships **quarterly**', new: 'ships monthly' }], { answering: 't1' });
      expect(res.answer).toEqual({ threadId: 't1', body: 'replaced 1 occurrence(s) in ^p1' });
      reply(doc, 't1', { id: 't1:m1', by: agent, at: now(), body: res.answer!.body });
    });
    expect(updates).toHaveLength(1);
    expect(coveredIn(doc, 'p1').t1).toBe('ships monthly with design review');
    expect(getThread(doc, 't1')?.messages.map((message) => message.body)).toEqual(['About "ships quarterly with design review"', 'replaced 1 occurrence(s) in ^p1']);
  });

  it('answering a thread that does not exist refuses the batch', () => {
    const doc = seedDoc();
    const before = stateV2(doc);
    expect(refusal(() => applyEdit(doc, [{ op: 'delete', id: 'p4' }], { answering: 'nope' }))).toMatchObject({ reason: 'notFound', target: 'nope' });
    expect(stateV2(doc)).toEqual(before);
  });

  it('markdown emphasis in `old` does not match plain text (S5 read check 10)', () => {
    const doc = seedDoc();
    expect(refusal(() => applyEdit(doc, [{ op: 'replace_text', block: 'p2', old: 'review **is** scheduled', new: 'x' }])).reason).toBe('notFound');
  });
});

describe('the move rule (S4; parent Decision Log 34)', () => {
  it('a block holding a caret is not re-inserted: the span it passes moves instead', () => {
    const doc = seedDoc();
    const item = nodeOf(doc, 'p3')._item!.id;
    const res = applyEdit(doc, [{ op: 'move', id: 'p3', after: 'tb1' }], { carets: [{ blockId: 'p3', pos: 4 }] });
    expect(order(doc)).toEqual(['h1', 'p1', 'p2', 'l1', 'tb1', 'p3', 'c1', 'p4']);
    expect(nodeOf(doc, 'p3')._item!.id).toEqual(item);
    expect(res.carries.map((carry) => carry.blockId)).toEqual(['l1', 'tb1']);
    expect(res.results[0].line).toMatch(/by moving \^l1 \^tb1/);
  });

  it('carets in the block and in the span it passes: refused with "retry", nothing written', () => {
    const doc = seedDoc();
    const before = stateV2(doc);
    const r = refusal(() => applyEdit(doc, [{ op: 'move', id: 'p3', after: 'tb1' }], { carets: [{ blockId: 'p3' }, { blockId: 'td1ap' }] }));
    expect(r).toMatchObject({ reason: 'retry', opIndex: 0, blocks: ['p3', 'tb1'] });
    expect(stateV2(doc)).toEqual(before);
  });

  it('a move upward past a caret block re-inserts the moving block', () => {
    const doc = seedDoc();
    applyEdit(doc, [{ op: 'move', id: 'p4', after: 'h1' }], { carets: [{ blockId: 'p2' }] });
    expect(order(doc)).toEqual(['h1', 'p4', 'p1', 'p2', 'p3', 'l1', 'tb1', 'c1']);
  });

  it('refuses a move into another tab, or of a nested block', () => {
    const doc = seedDoc();
    addTab(doc, { title: 'Other', id: 'tab2', body: schemaFor().nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'q1' } }] }) });
    expect(refusal(() => applyEdit(doc, [{ op: 'move', id: 'p1', after: 'q1' }]))).toMatchObject({ reason: 'invalid' });
    expect(refusal(() => applyEdit(doc, [{ op: 'move', id: 'li1', after: 'p4' }]))).toMatchObject({ reason: 'invalid' });
  });
});

describe('targets', () => {
  it('a target a restore removed is refused as removedByRestore, naming every such block', () => {
    const doc = seedDoc();
    const r = refusal(() =>
      applyEdit(
        doc,
        [
          { op: 'replace_block', id: 'gone1', markdown: 'x' },
          { op: 'insert', after: 'gone2', markdown: 'y' },
          { op: 'delete', id: 'p4' },
        ],
        { restoredAway: new Set(['gone1', 'gone2', 'p4']) },
      ),
    );
    expect(r).toEqual({ reason: 'removedByRestore', blocks: ['gone1', 'gone2'] });
  });

  it('set_cell refuses a cell the table does not have and a target that is not a table', () => {
    const doc = seedDoc();
    expect(refusal(() => applyEdit(doc, [{ op: 'set_cell', table: 'tb1', row: 3, col: 0, markdown: 'x' }]))).toMatchObject({ reason: 'invalid' });
    expect(refusal(() => applyEdit(doc, [{ op: 'set_cell', table: 'tb1', row: 0, col: 2, markdown: 'x' }]))).toMatchObject({ reason: 'invalid' });
    expect(refusal(() => applyEdit(doc, [{ op: 'set_cell', table: 'p1', row: 0, col: 0, markdown: 'x' }]))).toMatchObject({ reason: 'invalid' });
  });

  it('set_cell is stale when the row’s cells or the cell itself changed since the read, not when another cell did', () => {
    const host = seedDoc();
    const agent = replica(host);
    const human = replica(host);
    const since = DocIndex.of(agent).epoch;
    transact(human, () => nodeOf(human, 'td1ap').insert(0, 'x'));
    sync(host, human, agent);
    expect(refusal(() => applyEdit(agent, [{ op: 'set_cell', table: 'tb1', row: 1, col: 0, markdown: 'a' }], { since }))).toMatchObject({ reason: 'staleTargets', blocks: [{ id: 'td1a' }] });
    applyEdit(agent, [{ op: 'set_cell', table: 'tb1', row: 1, col: 1, markdown: '9' }], { since });
    expect(textOf(agent, 'td1b')).toBe('9');
  });

  it('an empty cell markdown leaves the cell one empty paragraph', () => {
    const doc = seedDoc();
    applyEdit(doc, [{ op: 'set_cell', table: 'tb1', row: 1, col: 0, markdown: '' }]);
    expect(pmOf(doc, 'td1a').toJSON().content).toEqual([{ type: 'paragraph', attrs: { id: 'td1ap' } }]);
  });

  it('a list written next to a list item joins the item’s list', () => {
    const doc = seedDoc();
    const res = applyEdit(doc, [{ op: 'insert', after: 'li1', markdown: '- a new item' }], { generateID: sequence('li') });
    expect(pmOf(doc, 'l1').childCount).toBe(3);
    expect(textOf(doc, res.results[0].newIds[0])).toBe('a new item');
  });

  it('an id the markdown repeats from elsewhere in the document is replaced by a fresh one', () => {
    const doc = seedDoc();
    const res = applyEdit(doc, [{ op: 'insert', after: 'p4', markdown: 'A copy of p1. ^p1' }]);
    expect(res.results[0].newIds).not.toContain('p1');
    expect(dupes(ids(doc))).toEqual([]);
  });

  it('finds a quote in a second tab', () => {
    const doc = seedDoc();
    addTab(doc, { title: 'Notes', id: 'tab2', body: schemaFor().nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'q1' }, content: [{ type: 'text', text: 'A unique sentence here.' }] }] }) });
    applyEdit(doc, [{ op: 'replace_text', old: 'unique sentence', new: 'distinct line' }]);
    expect(textOf(doc, 'q1')).toBe('A distinct line here.');
  });
});

describe('several ops on one block in one batch', () => {
  it('apply in order, as one write of the block', () => {
    const doc = seedDoc();
    applyEdit(doc, [
      { op: 'replace_text', block: 'p4', old: 'Closing paragraph', new: 'Final paragraph' },
      { op: 'replace_text', block: 'p4', old: 'a person wrote', new: 'someone wrote' },
    ]);
    expect(textOf(doc, 'p4')).toBe('Final paragraph of this section, with enough words to look like prose that someone wrote.');
  });

  it('a block the batch inserts can be edited by a later op of the same batch', () => {
    const doc = seedDoc();
    const res = applyEdit(doc, [{ op: 'insert', after: 'h1', markdown: 'Draft line one.' }], { generateID: sequence('d') });
    const [id] = res.results[0].newIds;
    applyEdit(doc, [
      { op: 'insert', after: id, markdown: 'Another draft line.' },
      { op: 'replace_text', old: 'Another draft', new: 'Second' },
    ]);
    expect(order(doc).slice(1, 3).map((key) => textOf(doc, key))).toEqual(['Draft line one.', 'Second line.']);
  });

  it('keeps text outside the BMP and Korean intact through a rewrite', () => {
    const doc = seedDoc({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'k1' }, content: [{ type: 'text', text: '회의는 금요일에 열린다 🍕 다같이.' }] }] }, {});
    applyEdit(doc, [{ op: 'replace_text', block: 'k1', old: '금요일에', new: '월요일에' }]);
    expect(textOf(doc, 'k1')).toBe('회의는 월요일에 열린다 🍕 다같이.');
    expect(marksOf(doc, 'k1')).toBe('회의는 월요일에 열린다 🍕 다같이.');
  });
});

describe('replace_text scoped to a nested block', () => {
  it('searches only the named list item and rewrites only it', () => {
    const doc = seedDoc();
    const sibling = slots(nodeOf(doc, 'lp2'));
    const res = applyEdit(doc, [{ op: 'replace_text', block: 'li1', old: 'item', new: 'entry' }]);
    expect(textOf(doc, 'li1')).toBe('first entry');
    expect(marksOf(doc, 'li2')).toBe('second item with |bold[bold]');
    expect(slots(nodeOf(doc, 'lp2'))).toEqual(sibling);
    expect(res.results[0].target).toBe('li1');
  });

  it('refuses a quote found only in a sibling of the named block', () => {
    const doc = seedDoc();
    const before = stateV2(doc);
    expect(refusal(() => applyEdit(doc, [{ op: 'replace_text', block: 'li1', old: 'second item', new: 'changed sibling' }]))).toMatchObject({ reason: 'notFound' });
    expect(stateV2(doc)).toEqual(before);
  });

  it('a table cell and a nested paragraph are scopes of their own', () => {
    const doc = seedDoc();
    applyEdit(doc, [
      { op: 'replace_text', block: 'td2a', old: 'beta', new: 'gamma' },
      { op: 'replace_text', block: 'lp2', old: 'item', new: 'line' },
    ]);
    expect(textOf(doc, 'td2a')).toBe('gamma');
    expect(textOf(doc, 'td1a')).toBe('alpha');
    expect(marksOf(doc, 'li2')).toBe('second line with |bold[bold]');
    expect(refusal(() => applyEdit(doc, [{ op: 'replace_text', block: 'td1a', old: 'gamma', new: 'x' }]))).toMatchObject({ reason: 'notFound' });
  });

  it('counts uniqueness inside the named block only', () => {
    const doc = seedDoc();
    expect(refusal(() => applyEdit(doc, [{ op: 'replace_text', block: 'l1', old: 'item', new: 'entry' }]))).toMatchObject({ reason: 'notUnique' });
    applyEdit(doc, [{ op: 'replace_text', block: 'li2', old: 'item', new: 'entry' }]);
    expect(textOf(doc, 'li1')).toBe('first item');
    expect(marksOf(doc, 'li2')).toBe('second entry with |bold[bold]');
  });
});
