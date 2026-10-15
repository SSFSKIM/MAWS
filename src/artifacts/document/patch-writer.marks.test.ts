// S5's agent-rewrite cases through the one writer (`spikes/p3-store/s4/test/s5-cases.ts` and the agent scenarios of
// `s5/s5-pins.mjs`; parent Decision Log 31 A5 and 33): the expected covers are S5's. With the whitespace merge off the
// contrasts show what the merge prevents (comments left on stray words).
import { describe, expect, it } from 'vitest';
import { applyEdit } from './patch-writer';
import { coveredIn, liveThreads, nodeOf, seedDoc } from './writer.fixture';

const P1 = 'The plan ships quarterly with design review notes. Owners track the budget.';
const seed = () =>
  seedDoc(
    {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'p1' },
          content: [
            { type: 'text', text: 'The plan ' },
            { type: 'text', text: 'ships quarterly with ', marks: [{ type: 'comment', attrs: { threadId: 't1' } }] },
            { type: 'text', text: 'design review', marks: [{ type: 'comment', attrs: { threadId: 't1' } }, { type: 'comment', attrs: { threadId: 't2' } }] },
            { type: 'text', text: ' notes', marks: [{ type: 'comment', attrs: { threadId: 't2' } }] },
            { type: 'text', text: '. Owners track the budget.' },
          ],
        },
        { type: 'paragraph', attrs: { id: 'p2' }, content: [{ type: 'text', text: 'This one ' }, { type: 'text', text: 'keeps going', marks: [{ type: 'comment', attrs: { threadId: 't3' } }] }, { type: 'text', text: '.' }] },
      ],
    },
    { t1: 'ships quarterly with design review', t2: 'design review notes', t3: 'keeps going' },
  );

const BASE = { t1: 'ships quarterly with design review', t2: 'design review notes' };

describe('S5’s agent rewrites through the writer', () => {
  it('the seed covers as S5’s base', () => {
    const doc = seed();
    expect(nodeOf(doc, 'p1').length).toBe(P1.length);
    expect(coveredIn(doc, 'p1')).toEqual(BASE);
  });

  const cases: Array<[string, string, boolean, Record<string, string>, string[]]> = [
    ['one word inside (quarterly → monthly)', 'The plan ships monthly with design review notes. Owners track the budget.', true, { ...BASE, t1: 'ships monthly with design review' }, []],
    ['rewords t2 in place', 'The plan ships quarterly with a short summary. Owners track the budget.', true, { t1: 'ships quarterly with ', t2: 'a short summary' }, []],
    ['…without the whitespace merge (contrast)', 'The plan ships quarterly with a short summary. Owners track the budget.', false, { t1: 'ships quarterly with a short', t2: 'a short summary' }, []],
    ['deletes t2’s words', 'The plan ships quarterly. Owners track the budget.', true, { t1: 'ships quarterly' }, ['t2']],
    ['rewrites the whole sentence', 'Shipping is monthly now. Owners track the budget.', true, {}, ['t1', 't2']],
    ['…without the whitespace merge (contrast)', 'Shipping is monthly now. Owners track the budget.', false, { t1: ' is monthly', t2: 'is monthly now' }, []],
  ];
  for (const [name, text, merge, want, orphans] of cases) {
    it(`${name}${merge ? '' : ' [merge off]'}`, () => {
      const doc = seed();
      const res = applyEdit(doc, [{ op: 'replace_block', id: 'p1', markdown: text }], { mergeWhitespace: merge });
      expect(coveredIn(doc, 'p1')).toEqual(want);
      expect([...res.orphaned].sort()).toEqual(orphans);
      for (const thread of orphans) expect(liveThreads(doc).has(thread)).toBe(false);
      expect(liveThreads(doc).has('t3')).toBe(true);
    });
  }

  it('a type change (paragraph → heading) carries every mark', () => {
    const doc = seed();
    applyEdit(doc, [{ op: 'replace_block', id: 'p1', markdown: `## ${P1}` }]);
    expect(nodeOf(doc, 'p1').name).toBe('heading');
    expect(coveredIn(doc, 'p1')).toEqual(BASE);
  });

  it('wrapping a commented word in code drops the comment there (code excludes every other mark) and reports it when nothing else carries it', () => {
    const doc = seed();
    const res = applyEdit(doc, [{ op: 'replace_block', id: 'p2', markdown: 'This one `keeps going`.' }]);
    expect(coveredIn(doc, 'p2')).toEqual({});
    expect(res.orphaned).toEqual(['t3']);
  });
});
