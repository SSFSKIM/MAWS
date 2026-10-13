// The agent's markdown (D1, D7 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; S4's DocMarkdown, S5's
// milestones): every block kind round-trips, ids are kept where the dialect shows them and minted elsewhere, the chips,
// math, the `:::` blocks and the table row ids have their syntax, overlapping comments read without nesting, text
// that looks like markup survives, and serialize → parse is a fixed point on the fixture and on S4's corpus.
import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { everyKindJSON } from './fixtures';
import { docMarkdown, stripMilestones } from './markdown';
import { schemaFor } from './schema';

const schema = schemaFor();
const md = docMarkdown();
const docOf = (blocks: PMNode[]) => schema.nodes.doc.create(null, blocks);
const counter = () => {
  let n = 0;
  return () => `new${++n}`;
};
/** serialize(parse(x)), the normal form; a fixed point once reached. */
const normal = (markdown: string) => md.serialize(docOf(md.parse(markdown, { generateID: counter() })));
const fixture = () => schema.nodeFromJSON(everyKindJSON());

/** Every id the dialect shows: top-level blocks, textblocks in the doc, quotes and callouts, list items, table rows. */
function visibleIds(json: JSONContent, parent = 'doc', top = true, out: string[] = []): string[] {
  const id = json.attrs?.id as string | undefined;
  const textblock = json.type === 'paragraph' || json.type === 'heading';
  if (id && (top || (textblock && ['doc', 'blockquote', 'callout'].includes(parent)) || ['listItem', 'taskItem', 'tableRow'].includes(json.type ?? ''))) out.push(id);
  for (const child of json.content ?? []) visibleIds(child, json.type ?? '', json.type === 'doc', out);
  return out;
}
/** The JSON with every id removed and comment marks dropped (what a parse cannot know), text runs merged. */
function shape(json: JSONContent): JSONContent {
  const attrs = json.attrs ? Object.fromEntries(Object.entries(json.attrs).filter(([key]) => key !== 'id')) : undefined;
  const marks = json.marks?.filter((mark) => mark.type !== 'comment');
  const content: JSONContent[] = [];
  for (const child of (json.content ?? []).map(shape)) {
    const last = content[content.length - 1];
    if (last?.type === 'text' && child.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(child.marks ?? [])) last.text = `${last.text}${child.text}`;
    else content.push(child);
  }
  const out: JSONContent = { type: json.type, ...(attrs ? { attrs } : {}), ...(json.text != null ? { text: json.text } : {}) };
  if (marks?.length) out.marks = marks;
  if (json.content) out.content = content;
  return out;
}

describe('the dialect', () => {
  const text = md.serialize(fixture(), { milestones: new Set(['t1', 't2', 't3']) });

  it('marks one-line blocks at the line’s end and longer top-level blocks on a line after them', () => {
    expect(text).toContain('# Every kind ^h1');
    expect(text).toContain('- First item ^li1\n- Second item with **bold** ^li2\n  - Nested item ^li3\n^ul1');
    expect(text).toContain('3. Third ^li4\n4. Fourth ^li5\n^ol1');
    expect(text).toContain('- [ ] Open task ^ti1\n- [x] Done task ^ti2\n^tl1');
    expect(text).toContain('> A quoted line. ^qp1\n>\n> A second quoted line. ^qp2\n^q1');
    expect(text).toContain('```ts\nconst x = 1\nconsole.log(x)\n```\n^c1');
    expect(text).toContain('---\n^hr1');
    expect(text.endsWith('The end. ^p9')).toBe(true);
  });

  it('gives each table row a trailing comment, cells positional, the columns aligned', () => {
    expect(text).toContain('| Name  | Value | <!-- ^tr0 -->\n| ----- | ----- |\n| alpha | 1     | <!-- ^tr1 -->\n^tb1');
  });

  it('writes chips, math and the ::: blocks', () => {
    expect(text).toContain('Due <chip kind="date" iso="2026-10-12"/>, owned by <chip kind="mention" type="person" ref="owner" label="Owner"/>');
    expect(text).toContain(`status <chip kind="dropdown" value="Doing" options='["Todo","Doing","Done"]'/>.`);
    expect(text).toContain('Energy $$E = mc^2$$ and a figure ![A figure](https://example.com/figure.png). ^p3');
    expect(text).toContain('$$\n\\int_0^1 x\\,dx = \\tfrac12\n$$\n^mb1');
    expect(text).toContain(':::callout {tone="warn"}\nMind the gap. ^cop1\n:::\n^co1');
    expect(text).toContain(':::diagram\ngraph TD\n  A --> B\n:::\n^dg1');
    expect(text).toContain(`:::chart {spec='{"mark":"bar"}'}\nsales.csv\n:::\n^ch1`);
    expect(text).toContain(':::pending {intent="Write the risks section"} :::\n^pd1');
  });

  it('writes overlapping comments as milestones that name their thread, with no nesting (S5)', () => {
    expect(text).toContain('The plan <c:t1>ships quarterly with <c:t2>design review</c:t1> notes</c:t2>. Owners track the budget. ^p2');
    expect(stripMilestones(text)).toContain('The plan ships quarterly with design review notes. Owners track the budget. ^p2');
  });

  it('keeps milestones out of code blocks and writes only the threads asked for', () => {
    expect(text).toContain('console.log(x)\n```');
    const some = md.serialize(fixture(), { milestones: new Set(['t2']) });
    expect(some).toContain('The plan ships quarterly with <c:t2>design review notes</c:t2>.');
    expect(md.serialize(fixture())).not.toMatch(/<\/?c:/);
  });

  it('writes no ids for an export', () => {
    const plain = md.serialize(fixture(), { ids: false });
    expect(plain).not.toMatch(/ \^[0-9a-z]+$|^\^[0-9a-z]+$|<!--/m);
    expect(plain).toContain('| Name  | Value |\n| ----- | ----- |\n| alpha | 1     |');
  });
});

describe('a parse', () => {
  it('returns every block kind with the ids the markdown names and fresh ones elsewhere', () => {
    const original = fixture();
    const blocks = md.parse(md.serialize(original, { milestones: new Set(['t1']) }), { generateID: counter() });
    const parsed = docOf(blocks).toJSON() as JSONContent;
    expect(shape(parsed)).toEqual(shape(original.toJSON() as JSONContent));
    expect(visibleIds(parsed)).toEqual(visibleIds(original.toJSON() as JSONContent));
    const all = JSON.stringify(parsed);
    expect(all).toContain('"id":"new1"'); // a nested list's id is not shown, so it is minted
    expect(all).not.toContain('"id":null');
  });

  it('mints 8-character ids when no generator is given, and parses an empty string to nothing', () => {
    const [block] = md.parse('Just text.');
    expect(block.attrs.id).toMatch(/^[0-9a-z]{8}$/);
    expect(md.parse('')).toEqual([]);
  });

  it('ignores comment milestones in the agent’s markdown (S5’s Q4)', () => {
    const [block] = md.parse('The plan <c:t1>ships monthly</c:t1> now. ^p2');
    expect(block.toJSON()).toEqual({ type: 'paragraph', attrs: { id: 'p2' }, content: [{ type: 'text', text: 'The plan ships monthly now.' }] });
  });

  it('takes a marker line only after a block, never inside code', () => {
    const blocks = md.parse('```\nline ^aa\n^bb\n```\n^cc', { generateID: counter() });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs.id).toBe('cc');
    expect(blocks[0].textContent).toBe('line ^aa\n^bb');
  });

  it('keeps an empty paragraph and its id', () => {
    const doc = docOf([schema.nodes.paragraph.create({ id: 'e1' }), schema.nodes.paragraph.create({ id: 'e2' }, schema.text('after'))]);
    const text = md.serialize(doc);
    expect(md.parse(text).map((block) => block.toJSON())).toEqual(doc.toJSON().content);
  });
});

describe('text that reads as markup', () => {
  const tricky = [
    '2*3*4 and _under_ but snake_case',
    '[not a link](x) and `not code` and ~~not struck~~',
    '# not a heading',
    '- not a list',
    '1. not a list either',
    '> not a quote',
    ':::callout not a callout',
    'cost $$5 and <chip kind="date"/> and <b>tags</b>',
    '==not highlighted== and ++not underlined++',
    'an entity &amp; a backslash \\ here',
    'ends like a marker ^ab12',
    '회의는 분기마다 열리고 **디자인 리뷰**를 포함한다',
  ];
  it.each(tricky)('survives a round trip: %s', (value) => {
    const doc = docOf([schema.nodes.paragraph.create({ id: 'x1' }, schema.text(value))]);
    expect(md.parse(md.serialize(doc)).map((block) => block.toJSON())).toEqual(doc.toJSON().content);
  });

  it('survives in a table cell, a pipe included', () => {
    const cell = (type: string, id: string, value: string) => schema.nodes[type].create({ id }, schema.nodes.paragraph.create({ id: `${id}p` }, schema.text(value)));
    const table = schema.nodes.table.create({ id: 't1' }, [
      schema.nodes.tableRow.create({ id: 'r0' }, [cell('tableHeader', 'a', 'A|B'), cell('tableHeader', 'b', 'C')]),
      schema.nodes.tableRow.create({ id: 'r1' }, [cell('tableCell', 'c', '*x*'), cell('tableCell', 'd', 'y')]),
    ]);
    const [back] = md.parse(md.serialize(docOf([table])));
    expect(shape(back.toJSON() as JSONContent)).toEqual(shape(table.toJSON() as JSONContent));
    expect(back.attrs.id).toBe('t1');
    expect([back.child(0).attrs.id, back.child(1).attrs.id]).toEqual(['r0', 'r1']);
  });
});

describe('the fixed point (serialize → parse)', () => {
  it('holds on the fixture', () => {
    const once = md.serialize(fixture());
    expect(normal(once)).toBe(once);
  });

  // S4's corpus: every markdown its writer, move and S5-case tests insert and replace with (spikes/p3-store/s4/test/),
  // and its seed document's read.
  const S4_CORPUS = [
    'An inserted **intro** paragraph.\n\n- with a list',
    'A new paragraph with **bold** and a [link](https://example.com).',
    '### Closing paragraph of this section, with enough words to look like prose that a person wrote.',
    '```\nA plain paragraph the human types into. Words to keep.\n```',
    'The review is scheduled for Monday and the owner signs off before it.',
    'Inserted.',
    'gamma',
    '42',
    '## Before closing',
    '**42**',
    '## The quick brown fox jumps over the lazy [dog](https://example.com).',
    '- The review is scheduled for Friday.',
    '### Section 1 plan',
    'Rewritten.',
    'Closing words.',
    '## not an item',
    '| Name | Value |\n| --- | --- |\n| zero | 0 |\n| alpha | 1 |\n| beta | 2 |',
    '100',
    'The quick brown fox leaps over the **lazy** [dog](https://example.com) twice. It has two sentences.',
    'The quick red fox leaps over the lazy dog twice.',
    '### The quick red fox leaps over the lazy dog twice.',
    [
      '## Section 1 plan ^h1',
      'The quick brown fox jumps over the **lazy** [dog](https://example.com). It has two sentences. ^p1',
      'The review is scheduled for Friday and the owner signs off after it. ^p2',
      '- first item ^li1\n- second item with **bold** ^li2\n^l1',
      '| Name | Value | <!-- ^tr0 -->\n| --- | --- |\n| alpha | 1 | <!-- ^tr1 -->\n| beta | 2 | <!-- ^tr2 -->\n^tb1',
      '```ts\nconst x = 1\n```\n^c1',
    ].join('\n\n'),
  ];
  it.each(S4_CORPUS)('holds on S4’s corpus: %s', (markdown) => {
    const once = normal(markdown);
    expect(normal(once)).toBe(once);
  });

  // S4's seed document (spikes/p3-store/s4/src/fixture.ts), built here: overlapping comments, bold and a link, a list,
  // a table with a header row, code and a closing paragraph.
  const s4Seed = (): PMNode => {
    const t = (value: string, marks: JSONContent['marks'] = []): JSONContent => ({ type: 'text', text: value, ...(marks.length ? { marks } : {}) });
    const c = (id: string) => ({ type: 'comment', attrs: { threadId: id } });
    const para = (id: string, content: JSONContent[]): JSONContent => ({ type: 'paragraph', attrs: { id }, content });
    const cell = (type: string, id: string, value: string): JSONContent => ({ type, attrs: { id }, content: [para(`${id}p`, [t(value)])] });
    return schema.nodeFromJSON({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { id: 'h1', level: 2 }, content: [t('Section 1 plan')] },
        para('p1', [t('The '), t('quick ', [c('t1')]), t('brown', [c('t1'), c('t2')]), t(' fox', [c('t2')]), t(' jumps over the '), t('lazy', [{ type: 'bold' }]), t(' '), t('dog', [{ type: 'link', attrs: { href: 'https://example.com' } }]), t('. It has two sentences.')]),
        para('p2', [t('The review is '), t('scheduled for Friday', [c('t3')]), t(' and the owner signs off after it.')]),
        para('p3', [t('A plain paragraph the human types into. '), t('Words', [c('t4')]), t(' to keep.')]),
        { type: 'bulletList', attrs: { id: 'l1' }, content: [{ type: 'listItem', attrs: { id: 'li1' }, content: [para('lp1', [t('first item')])] }, { type: 'listItem', attrs: { id: 'li2' }, content: [para('lp2', [t('second item with '), t('bold', [{ type: 'bold' }])])] }] },
        {
          type: 'table',
          attrs: { id: 'tb1' },
          content: [
            { type: 'tableRow', attrs: { id: 'tr0' }, content: [cell('tableHeader', 'tha', 'Name'), cell('tableHeader', 'thb', 'Value')] },
            { type: 'tableRow', attrs: { id: 'tr1' }, content: [cell('tableCell', 'td1a', 'alpha'), cell('tableCell', 'td1b', '1')] },
            { type: 'tableRow', attrs: { id: 'tr2' }, content: [cell('tableCell', 'td2a', 'beta'), cell('tableCell', 'td2b', '2')] },
          ],
        },
        { type: 'codeBlock', attrs: { id: 'c1', language: 'ts' }, content: [t('const x = 1')] },
        para('p4', [t('Closing paragraph of this section, with enough words to look like prose that a person wrote.')]),
      ],
    });
  };

  it('holds on S4’s seed document read with its comments, and the parse gives the seed back', () => {
    const seed = s4Seed();
    const read = md.serialize(seed, { milestones: new Set(['t1', 't2', 't3', 't4']) });
    expect(read).toContain('The <c:t1>quick <c:t2>brown</c:t1> fox</c:t2> jumps over the **lazy** [dog](https://example.com). It has two sentences. ^p1');
    expect(normal(read)).toBe(md.serialize(seed));
    const parsed = docOf(md.parse(read)).toJSON() as JSONContent;
    expect(shape(parsed)).toEqual(shape(seed.toJSON() as JSONContent));
    expect(visibleIds(parsed)).toEqual(visibleIds(seed.toJSON() as JSONContent));
  });

  it('keeps every id S4’s seed read names', () => {
    const blocks = md.parse(S4_CORPUS[S4_CORPUS.length - 1]);
    expect(blocks.map((block) => block.attrs.id)).toEqual(['h1', 'p1', 'p2', 'l1', 'tb1', 'c1']);
    expect(blocks[3].content.toJSON().map((item: JSONContent) => item.attrs?.id)).toEqual(['li1', 'li2']);
    expect(blocks[4].content.toJSON().map((row: JSONContent) => row.attrs?.id)).toEqual(['tr0', 'tr1', 'tr2']);
  });
});
