// S4's writer suite (`spikes/p3-store/s4/test/writer.ts`, 41 checks) on the ported writer: the ops, type changes, the
// atomic batch with target-only validation, schema validation, and marks through rewrites, a type change, a move and
// a deletion. The host's tool-use idempotency is A's `withOp` (M7's tool), not the writer's, so its check moves there.
// Where the schema module differs from S4's, the expectation follows the schema: `comment` is allowed on a code block
// (D2, parent Decision Log 31), so retyping a commented passage to code keeps its comment.
import { describe, expect, it, vi } from 'vitest';
import { contentIdsOf, idAt, onUpdate, stateVector, transact, type Node } from '../yjs';
import { DocIndex } from './block-index';
import { EditError, type EditRefusal, type Op } from './edit-ops';
import { applyEdit, warmWriter } from './patch-writer';
import { getThread } from './threads';
import { converged, coveredIn, dupes, ids, liveThreads, marksOf, nodeOf, order, pmOf, replica, seedDoc, sequence, sync, textOf } from './writer.fixture';

const slotsOf = (node: Node) => [...Array(node.length).keys()].map((i) => idAt(node, i)!);
const refusal = (run: () => unknown): EditRefusal => {
  try {
    run();
  } catch (error) {
    if (error instanceof EditError) return error.refusal;
    throw error;
  }
  throw new Error('the batch was not refused');
};

describe('the ops (S4 1)', () => {
  it('replace_text: an exact quote in a block, unchanged words keep their marks', () => {
    const doc = seedDoc();
    const res = applyEdit(doc, [{ op: 'replace_text', block: 'p1', old: 'two sentences', new: 'three short sentences' }]);
    expect(res.results[0].target).toBe('p1');
    expect(textOf(doc, 'p1')).toBe('The quick brown fox jumps over the lazy dog. It has three short sentences.');
    expect(marksOf(doc, 'p1')).toBe('The |quick [c:t1]|brown[c:t1,c:t2]| fox[c:t2]| jumps over the |lazy[bold]| |dog[link]|. It has three short sentences.');
  });

  // M9 (the scale gate's Korean case): the person's text is theirs whatever the markdown round trip makes of it. A
  // paragraph the person is typing in ends in a space between two words; an agent's quoted edit elsewhere in the
  // paragraph must not take it (the markdown drops a block's trailing and doubled whitespace).
  it('replace_text keeps whitespace the markdown does not carry: a trailing space, a doubled one, a leading one', () => {
    const doc = seedDoc({ type: 'doc', content: [
      { type: 'paragraph', attrs: { id: 'a1' }, content: [{ type: 'text', text: 'Anchor alpha0 here. 안녕하세요 입력 ' }] },
      { type: 'paragraph', attrs: { id: 'a2' }, content: [{ type: 'text', text: ' Lead  and double alpha0.' }] },
      { type: 'bulletList', attrs: { id: 'l1' }, content: [{ type: 'listItem', attrs: { id: 'li1' }, content: [{ type: 'paragraph', attrs: { id: 'lp1' }, content: [{ type: 'text', text: 'An item alpha0 typed ' }] }] }] },
    ] }, {});
    applyEdit(doc, [{ op: 'replace_text', block: 'a1', old: 'alpha0', new: 'alpha1' }]);
    expect(textOf(doc, 'a1')).toBe('Anchor alpha1 here. 안녕하세요 입력 ');
    applyEdit(doc, [{ op: 'replace_text', block: 'a2', old: 'alpha0', new: 'alpha1' }]);
    expect(textOf(doc, 'a2')).toBe(' Lead  and double alpha1.');
    applyEdit(doc, [{ op: 'replace_text', block: 'lp1', old: 'alpha0', new: 'alpha1' }]);
    expect(textOf(doc, 'lp1')).toBe('An item alpha1 typed ');
  });

  // M9's review: the whitespace is kept whatever the scope (unscoped, a list, a list item, a cell) and when the replaced
  // word is the last one before it.
  it('replace_text keeps the person’s whitespace in every scope and next to a replaced word', () => {
    const list = (id: string) => ({ type: 'bulletList', attrs: { id }, content: [{ type: 'listItem', attrs: { id: `${id}i` }, content: [{ type: 'paragraph', attrs: { id: `${id}p` }, content: [{ type: 'text', text: `An item ${id}zero typed ` }] }] }] });
    const cell = (id: string, text: string) => ({ type: 'tableCell', attrs: { id }, content: [{ type: 'paragraph', attrs: { id: `${id}p` }, content: [{ type: 'text', text }] }] });
    const doc = seedDoc({ type: 'doc', content: [
      list('la'), list('lb'), list('lc'),
      { type: 'table', attrs: { id: 'tb' }, content: [{ type: 'tableRow', attrs: { id: 'tr0' }, content: [cell('c0', 'Head'), cell('c1', 'Head two')] }, { type: 'tableRow', attrs: { id: 'tr1' }, content: [cell('c2', 'cell tdzero typed '), cell('c3', 'x')] }] },
      { type: 'paragraph', attrs: { id: 'w1' }, content: [{ type: 'text', text: 'The word is wzero ' }] },
    ] }, {});
    applyEdit(doc, [{ op: 'replace_text', old: 'lazero', new: 'laone' }]); // unscoped
    expect(textOf(doc, 'lap')).toBe('An item laone typed ');
    applyEdit(doc, [{ op: 'replace_text', block: 'lb', old: 'lbzero', new: 'lbone' }]); // scoped to the list
    expect(textOf(doc, 'lbp')).toBe('An item lbone typed ');
    applyEdit(doc, [{ op: 'replace_text', block: 'lci', old: 'lczero', new: 'lcone' }]); // scoped to the list item
    expect(textOf(doc, 'lcp')).toBe('An item lcone typed ');
    applyEdit(doc, [{ op: 'replace_text', block: 'c2', old: 'tdzero', new: 'tdone' }]); // scoped to the cell
    expect(textOf(doc, 'c2p')).toBe('cell tdone typed ');
    applyEdit(doc, [{ op: 'replace_text', block: 'w1', old: 'wzero', new: 'wone' }]); // the last word, before the space
    expect(textOf(doc, 'w1')).toBe('The word is wone ');
  });

  // M9's review (the first batch after a read): an unscoped quote converts to ProseMirror only the blocks whose text holds
  // it, never every block of the tab (a cold replica paid tens of milliseconds for that at 200 pages).
  it('replace_text unscoped converts only the blocks whose text holds the quote', () => {
    const doc = seedDoc();
    DocIndex.of(doc).warm(); // every block's text known, none converted by it
    const pm = vi.spyOn(DocIndex.prototype, 'pm');
    applyEdit(doc, [{ op: 'replace_text', old: 'scheduled for Friday', new: 'moved to Monday' }]);
    const converted = new Set(pm.mock.calls.map(([top]) => top));
    pm.mockRestore();
    expect(textOf(doc, 'p2')).toContain('moved to Monday');
    expect(converted.size, 'top-level blocks converted').toBeLessThanOrEqual(1);
  });

  it('insert checks the tab’s shape without converting its untouched blocks', () => {
    const doc = seedDoc();
    DocIndex.of(doc).warm();
    const pm = vi.spyOn(DocIndex.prototype, 'pm');
    applyEdit(doc, [{ op: 'insert', after: 'h1', markdown: 'A new paragraph.' }]);
    const converted = new Set(pm.mock.calls.map(([top]) => top));
    pm.mockRestore();
    expect(converted.size, 'top-level blocks converted').toBeLessThanOrEqual(1);
  });

  // M9 (the scale gate): a host process's first batch paid the parser's and the diff's first runs (tens of ms); the
  // kind's registration runs one small batch of each op on a throwaway document instead.
  it('warms the writer on a throwaway document: every op kind runs once and nothing escapes', () => {
    const ran = warmWriter();
    expect(ran.sort()).toEqual(['delete', 'insert', 'replace_block', 'replace_text', 'set_cell']);
  });

  it('replace_text not unique: refused, listing the candidate blocks and their match counts', () => {
    const doc = seedDoc();
    const r = refusal(() => applyEdit(doc, [{ op: 'replace_text', old: 'The ', new: 'A ' }]));
    expect(r.reason).toBe('notUnique');
    if (r.reason !== 'notUnique') return;
    expect(r.candidates.length).toBeGreaterThanOrEqual(2);
    expect(r.candidates.map((candidate) => `${candidate.id}×${candidate.matches}`)).toEqual(expect.arrayContaining(['p1×1', 'p2×1']));
  });

  it('replace_text not found: refused, listing blocks that share its words', () => {
    const doc = seedDoc();
    const r = refusal(() => applyEdit(doc, [{ op: 'replace_text', old: 'review is planned', new: 'x' }]));
    expect(r.reason).toBe('notFound');
    if (r.reason === 'notFound') expect(r.candidates.map((candidate) => candidate.id)).toContain('p2');
  });

  it('replace_text all: every occurrence, list item ids kept', () => {
    const doc = seedDoc();
    applyEdit(doc, [{ op: 'replace_text', old: 'item', new: 'entry', all: true }]);
    expect(textOf(doc, 'li1')).toBe('first entry');
    expect(marksOf(doc, 'li2')).toBe('second entry with |bold[bold]');
    expect(ids(doc)).toEqual(expect.arrayContaining(['li1', 'lp1', 'li2', 'lp2']));
  });

  it('insert after: ids minted for every block written, nested ones included', () => {
    const doc = seedDoc();
    const res = applyEdit(doc, [{ op: 'insert', after: 'h1', markdown: 'An inserted **intro** paragraph.\n\n- with a list' }], { generateID: sequence() });
    expect(res.results[0].newIds).toHaveLength(4);
    expect(ids(doc)).toEqual(expect.arrayContaining(res.results[0].newIds));
    expect(order(doc).slice(0, 3)).toEqual(['h1', res.results[0].newIds[0], res.results[0].newIds[1]]);
  });

  it('insert before', () => {
    const doc = seedDoc();
    const res = applyEdit(doc, [{ op: 'insert', before: 'p4', markdown: '## Before closing' }]);
    const [id] = res.results[0].newIds;
    expect(order(doc).slice(-2)).toEqual([id, 'p4']);
    expect(pmOf(doc, id).type.name).toBe('heading');
  });

  it('set_cell: the cell takes the markdown, its ids kept', () => {
    const doc = seedDoc();
    applyEdit(doc, [{ op: 'set_cell', table: 'tb1', row: 2, col: 1, markdown: '**42**' }]);
    expect(marksOf(doc, 'td2b')).toBe('42[bold]');
    expect(ids(doc)).toEqual(expect.arrayContaining(['td2b', 'td2bp']));
  });

  it('move: the order changes, the id and the marks are kept, a carry reports the re-insert', () => {
    const doc = seedDoc();
    const res = applyEdit(doc, [{ op: 'move', id: 'p3', after: 'c1' }]);
    expect(order(doc).indexOf('p3')).toBe(order(doc).indexOf('c1') + 1);
    expect(marksOf(doc, 'p3')).toBe('A plain paragraph the human types into. |Words[c:t4]| to keep.');
    expect(res.carries).toHaveLength(1);
    expect(res.carries[0]).toMatchObject({ kind: 'move', blockId: 'p3' });
    expect(res.carries[0].from).toHaveLength(res.carries[0].to.length);
  });

  it('delete: the block goes, its comment is reported orphaned (derived), the thread and its stored quote untouched', () => {
    const doc = seedDoc();
    const res = applyEdit(doc, [{ op: 'delete', id: 'p2' }]);
    expect(ids(doc)).not.toContain('p2');
    expect(res.orphaned).toEqual(['t3']);
    expect(liveThreads(doc).has('t3')).toBe(false);
    expect(getThread(doc, 't3')?.quote).toBe('scheduled for Friday');
  });

  it('a sequence of batches converges with the host and leaves no duplicate ids', () => {
    const host = seedDoc();
    const agent = replica(host);
    const batches: Op[][] = [
      [{ op: 'replace_text', block: 'p1', old: 'two sentences', new: 'three' }],
      [{ op: 'insert', after: 'h1', markdown: 'Intro.' }],
      [{ op: 'set_cell', table: 'tb1', row: 1, col: 1, markdown: '7' }],
      [{ op: 'move', id: 'p3', after: 'c1' }],
      [{ op: 'delete', id: 'p2' }],
    ];
    for (const ops of batches) {
      applyEdit(agent, ops);
      sync(host, agent);
    }
    expect(converged(host, agent)).toBe(true);
    expect(dupes(ids(host))).toEqual([]);
  });
});

describe('type changes (S4 1b)', () => {
  it('paragraph → heading keeps the id and re-maps the comments onto the unchanged words', () => {
    const doc = seedDoc();
    applyEdit(doc, [{ op: 'replace_block', id: 'p1', markdown: '## The quick brown fox jumps over the lazy [dog](https://example.com).' }]);
    expect(nodeOf(doc, 'p1').name).toBe('heading');
    expect(nodeOf(doc, 'p1').getAttr('level')).toBe(2);
    expect(marksOf(doc, 'p1')).toBe('The |quick [c:t1]|brown[c:t1,c:t2]| fox[c:t2]| jumps over the lazy |dog[link]|.');
  });

  it('paragraph → list item: the list takes the id, the comment moves into the item’s paragraph, nothing orphaned', () => {
    const doc = seedDoc();
    const res = applyEdit(doc, [{ op: 'replace_block', id: 'p2', markdown: '- The review is scheduled for Friday.' }]);
    expect(nodeOf(doc, 'p2').name).toBe('bulletList');
    expect(marksOf(doc, 'p2')).toBe('The review is |scheduled for Friday[c:t3]|.');
    expect(res.orphaned).toEqual([]);
    expect(liveThreads(doc).has('t3')).toBe(true);
  });

  it('into a code block: the comment is kept, `comment` being allowed on code (D2)', () => {
    const doc = seedDoc();
    const res = applyEdit(doc, [{ op: 'replace_block', id: 'p3', markdown: '```\nA plain paragraph the human types into. Words to keep.\n```' }]);
    expect(nodeOf(doc, 'p3').name).toBe('codeBlock');
    expect(coveredIn(doc, 'p3')).toEqual({ t4: 'Words' });
    expect(res.orphaned).toEqual([]);
  });

  it('a heading level change is an attribute write: the text keeps its items', () => {
    const doc = seedDoc();
    const textItems = slotsOf(nodeOf(doc, 'h1'));
    const updates: Uint8Array[] = [];
    const off = onUpdate(doc, (update) => updates.push(update));
    applyEdit(doc, [{ op: 'replace_block', id: 'h1', markdown: '### Section 1 plan' }]);
    off();
    expect(nodeOf(doc, 'h1').getAttr('level')).toBe(3);
    expect(slotsOf(nodeOf(doc, 'h1'))).toEqual(textItems);
    expect(updates).toHaveLength(1);
    let inserted = 0;
    contentIdsOf(updates[0]).inserts.forEach((range) => (inserted += range.len));
    expect(inserted).toBe(1);
  });
});

describe('the atomic batch (S4 1c)', () => {
  it('a quote not found in the block it names is refused with that block’s current text, whatever words the quote shares with it', () => {
    const doc = seedDoc();
    expect(refusal(() => applyEdit(doc, [{ op: 'replace_text', block: 'p2', old: 'gone entirely', new: 'x' }]))).toMatchObject({ reason: 'notFound', candidates: [{ id: 'p2', text: textOf(doc, 'p2') }] });
    expect(refusal(() => applyEdit(doc, [{ op: 'replace_text', block: 'lp1', old: 'gone entirely', new: 'x' }]))).toMatchObject({ reason: 'notFound', candidates: [{ id: 'lp1', text: 'first item' }] });
  });

  it('a batch that would leave a tab with more top-level blocks than `blocksPerTab` is refused before any write; one that does not grow it lands', () => {
    const doc = seedDoc(); // 8 top-level blocks
    const sv = stateVector(doc);
    expect(refusal(() => applyEdit(doc, [{ op: 'insert', after: 'h1', markdown: 'One.' }, { op: 'replace_block', id: 'p4', markdown: 'A.\n\nB.' }], { blocksPerTab: 9 }))).toMatchObject({ reason: 'invalid', opIndex: 1 });
    expect(stateVector(doc)).toEqual(sv);
    applyEdit(doc, [{ op: 'insert', after: 'h1', markdown: 'One.' }], { blocksPerTab: 9 });
    expect(order(doc)).toHaveLength(9);
    applyEdit(doc, [{ op: 'replace_text', block: 'p1', old: 'two sentences', new: 'two clauses' }, { op: 'delete', id: 'p2' }, { op: 'insert', after: 'h1', markdown: 'Two.' }], { blocksPerTab: 8 }); // over the limit already, not growing
    expect(order(doc)).toHaveLength(9);
  });

  it('a target the human changed after the read refuses the whole batch, naming the block with its current text', () => {
    const host = seedDoc();
    const agent = replica(host);
    const human = replica(host);
    const since = DocIndex.of(agent).epoch;
    transact(human, () => nodeOf(human, 'p3').insert(2, 'NEW '));
    transact(human, () => nodeOf(human, 'p1').insert(0, 'Well, '));
    sync(host, agent, human);
    const sv = stateVector(agent);
    const r = refusal(() =>
      applyEdit(
        agent,
        [
          { op: 'replace_text', block: 'p2', old: 'Friday', new: 'Monday' },
          { op: 'replace_block', id: 'p3', markdown: 'Rewritten.' },
        ],
        { since },
      ),
    );
    expect(r).toMatchObject({ reason: 'staleTargets', blocks: [{ id: 'p3' }] });
    if (r.reason === 'staleTargets') expect(r.blocks[0].text).toMatch(/^A NEW plain/);
    expect(stateVector(agent)).toEqual(sv);
    expect(textOf(agent, 'p2')).toContain('Friday');
  });

  it('the human’s typing elsewhere never conflicts, and a quote validated by its text applies in a block the human typed in', () => {
    const host = seedDoc();
    const agent = replica(host);
    const human = replica(host);
    const since = DocIndex.of(agent).epoch;
    transact(human, () => nodeOf(human, 'p3').insert(2, 'NEW '));
    transact(human, () => nodeOf(human, 'p1').insert(0, 'Well, '));
    sync(host, agent, human);
    applyEdit(
      agent,
      [
        { op: 'replace_text', block: 'p2', old: 'Friday', new: 'Monday' },
        { op: 'replace_block', id: 'p4', markdown: 'Closing words.' },
      ],
      { since },
    );
    applyEdit(agent, [{ op: 'replace_text', block: 'p1', old: 'lazy', new: 'sleepy' }], { since });
    expect(textOf(agent, 'p1')).toMatch(/^Well, The quick/);
    expect(marksOf(agent, 'p1')).toContain('sleepy[bold]');
    sync(host, agent, human);
    expect(converged(host, agent, human)).toBe(true);
  });

  it('a failing op refuses the batch with its index, and nothing of the ops before it is written', () => {
    const doc = seedDoc();
    const sv = stateVector(doc);
    const r = refusal(() =>
      applyEdit(doc, [
        { op: 'replace_text', block: 'p4', old: 'Closing', new: 'Final' },
        { op: 'delete', id: 'nope' },
      ]),
    );
    expect(r).toMatchObject({ reason: 'notFound', opIndex: 1, target: 'nope' });
    expect(stateVector(doc)).toEqual(sv);
  });

  it('schema validation: a list item replaced by a heading is refused, nothing applied', () => {
    const doc = seedDoc();
    const sv = stateVector(doc);
    const r = refusal(() => applyEdit(doc, [{ op: 'replace_block', id: 'li1', markdown: '## not an item' }]));
    expect(r).toMatchObject({ reason: 'invalid', opIndex: 0 });
    expect(stateVector(doc)).toEqual(sv);
  });

  it('set_cell after another writer added a row: stale on the table’s shape', () => {
    const host = seedDoc();
    const agent = replica(host);
    const other = replica(host);
    const since = DocIndex.of(agent).epoch;
    applyEdit(other, [{ op: 'replace_block', id: 'tb1', markdown: '| Name | Value |\n| --- | --- |\n| zero | 0 |\n| alpha | 1 |\n| beta | 2 |' }]);
    sync(host, other, agent);
    const r = refusal(() => applyEdit(agent, [{ op: 'set_cell', table: 'tb1', row: 1, col: 1, markdown: '100' }], { since }));
    expect(r.reason).toBe('staleTargets');
    if (r.reason === 'staleTargets') expect(r.blocks.map((block) => block.id)).toContain('tb1');
    expect(converged(host, other, agent)).toBe(true);
  });
});

describe('marks through rewrites (S4 3)', () => {
  it('a rewrite keeps overlapping comments, bold and link on unchanged words', () => {
    const doc = seedDoc();
    applyEdit(doc, [{ op: 'replace_block', id: 'p1', markdown: 'The quick brown fox leaps over the **lazy** [dog](https://example.com) twice. It has two sentences.' }]);
    expect(marksOf(doc, 'p1')).toBe('The |quick [c:t1]|brown[c:t1,c:t2]| fox[c:t2]| leaps over the |lazy[bold]| |dog[link]| twice. It has two sentences.');
  });

  it('a word replaced inside overlapping comments stays covered by both; neither is orphaned', () => {
    const doc = seedDoc();
    const res = applyEdit(doc, [{ op: 'replace_text', block: 'p1', old: 'quick brown', new: 'quick red' }]);
    expect(marksOf(doc, 'p1').startsWith('The |quick [c:t1]|red[c:t1,c:t2]| fox[c:t2]')).toBe(true);
    expect(res.orphaned).toEqual([]);
  });

  it('rewording a comment’s words in place keeps it on the new words (A5)', () => {
    const doc = seedDoc();
    applyEdit(doc, [{ op: 'replace_text', block: 'p2', old: 'scheduled for Friday', new: 'planned for Monday' }]);
    expect(marksOf(doc, 'p2')).toBe('The review is |planned for Monday[c:t3]| and the owner signs off after it.');
  });

  it('a comment whose words are all deleted is orphaned (derived), its thread keeps its stored quote', () => {
    const doc = seedDoc();
    const res = applyEdit(doc, [{ op: 'replace_text', block: 'p2', old: 'review is scheduled for Friday and', new: 'review and' }]);
    expect(res.orphaned).toEqual(['t3']);
    expect(getThread(doc, 't3')?.quote).toBe('scheduled for Friday');
  });

  it('the agent removing ** and [] removes bold and link (its marks); comments stay', () => {
    const doc = seedDoc();
    applyEdit(doc, [{ op: 'replace_block', id: 'p1', markdown: 'The quick brown fox jumps over the lazy dog. It has two sentences.' }]);
    expect(marksOf(doc, 'p1')).toBe('The |quick [c:t1]|brown[c:t1,c:t2]| fox[c:t2]| jumps over the lazy dog. It has two sentences.');
  });

  it('marks survive a type change and a move in one batch; the carry names the characters as they were before it', () => {
    const doc = seedDoc();
    const clocks = new Map([...doc.store.clients.keys()].map((client) => [client, doc.store.getClock(client)]));
    const res = applyEdit(doc, [
      { op: 'replace_block', id: 'p1', markdown: '### The quick brown fox jumps over the lazy dog.' },
      { op: 'move', id: 'p1', after: 'p4' },
    ]);
    expect(nodeOf(doc, 'p1').name).toBe('heading');
    expect(marksOf(doc, 'p1')).toBe('The |quick [c:t1]|brown[c:t1,c:t2]| fox[c:t2]| jumps over the lazy dog.');
    expect(order(doc).at(-1)).toBe('p1');
    expect(res.carries.length).toBeGreaterThan(0);
    for (const carry of res.carries) {
      expect(carry.from.length).toBe(carry.to.length);
      for (const [client, clock] of carry.from) expect(clock).toBeLessThan(clocks.get(client) ?? 0);
    }
    const p1 = slotsOf(nodeOf(doc, 'p1'));
    const carried = new Set(res.carries.flatMap((carry) => carry.to.map(([client, clock]) => `${client}:${clock}`)));
    expect(p1.filter((slot) => carried.has(`${slot.client}:${slot.clock}`)).length).toBe('The quick brown fox jumps over the lazy dog.'.length);
  });
});
