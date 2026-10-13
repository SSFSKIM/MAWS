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
/** The doc as stored, but for what a parse cannot know: ids, and comment marks (their threads are elsewhere). */
const stored = (node: PMNode): unknown => schema.nodeFromJSON(withoutIdsAndComments(node.toJSON())).toJSON();
function withoutIdsAndComments(json: unknown): unknown {
  if (Array.isArray(json)) return json.map(withoutIdsAndComments);
  if (json == null || typeof json !== 'object') return json;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(json)) {
    if (key === 'id') continue;
    if (key === 'marks') {
      const marks = (value as Array<{ type: string }>).filter((mark) => mark.type !== 'comment');
      if (marks.length) out.marks = withoutIdsAndComments(marks);
      continue;
    }
    out[key] = withoutIdsAndComments(value);
  }
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
    expect(text).toContain('```ts\nconst x = 1\n<c:t3>console.log(x)</c:t3>\n```\n^c1');
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

  it('writes milestones inside code too (D2 allows the mark there), and only the threads asked for', () => {
    expect(text).toContain('const x = 1\n<c:t3>console.log(x)</c:t3>\n```');
    const some = md.serialize(fixture(), { milestones: new Set(['t2']) });
    expect(some).toContain('The plan ships quarterly with <c:t2>design review notes</c:t2>.');
    expect(some).toContain('const x = 1\nconsole.log(x)\n```');
    const none = md.serialize(fixture());
    expect(stripMilestones(none)).toBe(none);
  });

  it('writes a literal milestone in code with one more backslash, so it never reads as one', () => {
    expect(text).toContain('`<\\c:literal>`');
    expect(md.serialize(schema.nodes.doc.create(null, [schema.nodes.codeBlock.create(null, schema.text('<c:t1>x</c:t1> <\\c:t2>'))]), { ids: false })).toBe(
      '```\n<\\c:t1>x<\\/c:t1> <\\\\c:t2>\n```',
    );
  });

  it('writes what GFM cannot say in the dialect’s own forms (Decision Log 15)', () => {
    expect(text).toContain('An <mark color="#fde68a">amber</mark> and a <mark color="#bfdbfe">blue</mark> highlight');
    expect(text).toContain('**bold with a space&#32;**<!---->then `` a`tick ``');
    expect(text).toContain('[a filed link](<https://example.com/a file (draft).pdf> "Say \\"draft\\"")');
    expect(text).toContain('<img src="maws-artifact://asset/as1" alt="" asset="as1"/>');
    expect(text).toContain('&#160;&#160;&#160; ^r2\n\n&#160; ^r3');
    expect(text).toContain('````md\n```\n<c:chart/>\n```\n````\n^c2');
    expect(text).toContain(':::table\n:::row <!-- ^tr20 -->\n:::header {colspan="2" colwidth="160,80" align="center"}\nQuarter\n:::\n:::\n');
    expect(text).toContain(':::cell {rowspan="2"}\nFirst\n\nSecond\n:::\n:::cell {align="right"}\n- Listed ^li6\n:::');
    expect(text).toContain(':::row <!-- ^tr30 -->\n:::cell\nNo header\n:::');
    expect(text).toContain(`:::chart {spec-json='{"mark":"line","encoding":{"x":"month","y":"total"}}'}\nrevenue.csv\n:::\n^ch2`);
    expect(text).toContain('::::diagram\ngraph LR\n:::\n  A --> B\n::::\n^dg2');
    expect(text).toContain('$$$\na\n$$\nb\n$$$\n^mb2');
    expect(text).toContain('Inline <math latex=""/> and <math latex="x^2&#10;+ 1"/>. ^r4');
  });

  it('writes no ids for an export', () => {
    const plain = md.serialize(fixture(), { ids: false });
    expect(plain).not.toMatch(/ \^[0-9a-z]+$|^\^[0-9a-z]+$|<!-- \^/m);
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

  it('gives back every stored state of the fixture exactly, comments and unshown ids aside (Decision Log 15)', () => {
    const original = fixture();
    for (const milestones of [null, new Set(['t1', 't2', 't3'])]) {
      const parsed = docOf(md.parse(md.serialize(original, { milestones }), { generateID: counter() }));
      expect(stored(parsed)).toEqual(stored(original));
    }
  });

  it('reads a code block’s comment milestones away and its literal ones back, the code as it was', () => {
    const code = schema.nodes.codeBlock.create({ id: 'k1', language: 'xml' }, [
      schema.text('<c:t1>kept</c:t1> <\\c:t2>\n'),
      schema.text('commented', [schema.marks.comment.create({ threadId: 't9' })]),
    ]);
    const read = md.serialize(docOf([code]), { milestones: new Set(['t9']) });
    expect(read).toBe('```xml\n<\\c:t1>kept<\\/c:t1> <\\\\c:t2>\n<c:t9>commented</c:t9>\n```\n^k1');
    const [back] = md.parse(read);
    expect(back.attrs).toEqual({ id: 'k1', language: 'xml' });
    expect(back.textContent).toBe(code.textContent);
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

// Decision Log 15: every state the schema admits reads back as stored, one at a time, ids and comments aside. Each
// state is a top-level block; the probe that found the dialect's gaps, kept as its regression.
describe('every stored state, one at a time', () => {
  const t = (text: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text, ...(marks ? { marks } : {}) });
  const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
  const cell = (type: string, attrs: Record<string, unknown>, ...content: JSONContent[]): JSONContent => ({ type, attrs, content });
  const states: Record<string, JSONContent> = {
    multiParaCell: { type: 'table', content: [{ type: 'tableRow', content: [cell('tableHeader', {}, p(t('H')))] }, { type: 'tableRow', content: [cell('tableCell', {}, p(t('First')), p(t('Second')))] }] },
    noHeader: { type: 'table', content: [{ type: 'tableRow', content: [cell('tableCell', {}, p(t('a'))), cell('tableCell', {}, p(t('b')))] }] },
    emptyCell: { type: 'table', content: [{ type: 'tableRow', content: [cell('tableHeader', {}, p(t('H'))), cell('tableHeader', {}, p())] }, { type: 'tableRow', content: [cell('tableCell', {}, p()), cell('tableCell', {}, p(t('x')))] }] },
    hardBreakCell: { type: 'table', content: [{ type: 'tableRow', content: [cell('tableHeader', {}, p(t('a'), { type: 'hardBreak' }, t('b')))] }] },
    imgAsset: p(t('x '), { type: 'image', attrs: { src: 'maws-artifact://a/b.png', alt: 'A', assetId: 'as1' } }),
    imgAltEmpty: p({ type: 'image', attrs: { src: 'https://e.com/a.png', alt: '', assetId: null } }),
    imgSrcSpace: p({ type: 'image', attrs: { src: 'https://e.com/a b(1).png', alt: 'x', assetId: null } }),
    hlColor: p(t('a '), t('hi', [{ type: 'highlight', attrs: { color: '#fde68a' } }])),
    hlEq: p(t('a=b', [{ type: 'highlight', attrs: { color: null } }])),
    hlAdj: p(t('one', [{ type: 'highlight', attrs: { color: '#fde68a' } }]), t('two', [{ type: 'highlight', attrs: { color: '#bfdbfe' } }])),
    linkAdj: p(t('one', [{ type: 'link', attrs: { href: 'https://a.com', title: null } }]), t('two', [{ type: 'link', attrs: { href: 'https://b.com', title: null } }])),
    linkTitleQuote: p(t('one', [{ type: 'link', attrs: { href: 'https://a.com/(x)', title: 'say "hi"' } }])),
    boldTrailSpace: p(t('a '), t('bold ', [{ type: 'bold' }]), t('x')),
    leadSpace: p(t('  lead and trail  ')),
    doubleSpace: p(t('a  b')),
    nbspOnly: p(t(' ')),
    codeNoLang: { type: 'codeBlock', attrs: { language: null }, content: [t('x')] },
    codeFence: { type: 'codeBlock', attrs: { language: 'md' }, content: [t('```\ninner\n```')] },
    codeEmpty: { type: 'codeBlock', attrs: { language: 'ts' } },
    diagramColon: { type: 'diagram', attrs: { source: 'a\n:::\nb' } },
    diagramEmpty: { type: 'diagram', attrs: { source: '' } },
    chartObj: { type: 'chart', attrs: { source: 's', spec: { mark: 'bar', n: 1 } } },
    chartNull: { type: 'chart', attrs: { source: '', spec: null } },
    mathDollar: { type: 'mathBlock', attrs: { latex: 'a\n$$\nb' } },
    mathInlineNl: p({ type: 'math', attrs: { latex: 'a\nb' } }),
    mathEmpty: p({ type: 'math', attrs: { latex: '' } }),
    mentionNullRef: p({ type: 'mention', attrs: { kind: 'artifact', ref: null, label: '' } }),
    dropdownNull: p({ type: 'dropdown', attrs: { options: [], value: null } }),
    emptyCallout: { type: 'callout', attrs: { tone: 'tip' }, content: [p()] },
    calloutList: { type: 'callout', attrs: { tone: 'danger' }, content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [p(t('x'))] }] }] },
    headingEmpty: { type: 'heading', attrs: { level: 2 } },
    taskNested: { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(t('a')), { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p(t('b'))] }] }] }] },
    listItemTwoParas: { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('a')), p(t('b'))] }] },
    orderedType: { type: 'orderedList', attrs: { start: 1, type: 'i' }, content: [{ type: 'listItem', content: [p(t('a'))] }] },
    quoteCode: { type: 'blockquote', content: [{ type: 'codeBlock', attrs: { language: null }, content: [t('x')] }] },
    codeTicks: p(t('run `x` now', [{ type: 'code' }])),
    codeEdge: p(t('a'), t(' x ', [{ type: 'code' }]), t('b')),
    codeLead: p(t(' x', [{ type: 'code' }]), t('b')),
    codeLiteralMs: p(t('<c:chart> and </c:x>', [{ type: 'code' }])),
    codeBlockLiteralMs: { type: 'codeBlock', attrs: { language: 'xml' }, content: [t('<c:chart>\n</c:chart>\n<\\c:x>')] },
    codeTrailingNl: { type: 'codeBlock', attrs: { language: null }, content: [t('a\n')] },
    codeLtAmp: p(t('a < b && c', [{ type: 'code' }])),
    linkTitleEmpty: p(t('one', [{ type: 'link', attrs: { href: 'https://a.com', title: '' } }])),
    linkSpace: p(t('one', [{ type: 'link', attrs: { href: 'file name.pdf', title: null } }])),
    boldPunct: p(t('end.', [{ type: 'bold' }]), t('x')),
    boldPunctOpen: p(t('x'), t('.start', [{ type: 'bold' }])),
    italicSpace: p(t('a'), t(' it ', [{ type: 'italic' }]), t('b')),
    boldItalic: p(t('bo', [{ type: 'bold' }, { type: 'italic' }]), t('ld ', [{ type: 'bold' }]), t('x')),
    strikeSpace: p(t('a'), t(' s ', [{ type: 'strike' }]), t('b')),
    underlineSpace: p(t('a'), t(' u ', [{ type: 'underline' }]), t('b')),
    hlSpace: p(t('a'), t(' h ', [{ type: 'highlight', attrs: { color: '#fde68a' } }]), t('b')),
    hlNested: p(t('x '), t('bold', [{ type: 'highlight', attrs: { color: '#fde68a' } }, { type: 'bold' }]), t(' y', [{ type: 'highlight', attrs: { color: '#fde68a' } }])),
    linkSpaceEdge: p(t('a'), t(' l ', [{ type: 'link', attrs: { href: 'https://a.com', title: null } }]), t('b')),
    imgKorean: p({ type: 'image', attrs: { src: 'https://e.com/a.png', alt: '그림 설명', assetId: null } }),
    imgNullSrc: p({ type: 'image', attrs: { src: null, alt: null, assetId: 'as2' } }),
    tableSpans: { type: 'table', content: [{ type: 'tableRow', content: [cell('tableHeader', { colspan: 2, colwidth: [120, 80], align: 'center' }, p(t('Wide')))] }, { type: 'tableRow', content: [cell('tableCell', { rowspan: 2 }, p(t('tall'))), cell('tableCell', {}, p(t('b')))] }, { type: 'tableRow', content: [cell('tableCell', {}, p(t('c')))] }] },
    tableAlignMix: { type: 'table', content: [{ type: 'tableRow', content: [cell('tableHeader', { align: 'right' }, p(t('A')))] }, { type: 'tableRow', content: [cell('tableCell', { align: 'left' }, p(t('b')))] }] },
    tableRich: { type: 'table', content: [{ type: 'tableRow', content: [cell('tableHeader', {}, p(t('H')))] }, { type: 'tableRow', content: [cell('tableCell', {}, { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('item'))] }] }, { type: 'callout', attrs: { tone: 'warn' }, content: [p(t('careful'))] }, { type: 'diagram', attrs: { source: 'x\n:::\ny' } }, { type: 'codeBlock', attrs: { language: null }, content: [t(':::\nraw')] })] }] },
    tableEmptyCellNoBlocks: { type: 'table', content: [{ type: 'tableRow', content: [cell('tableCell', {})] }] },
    tableNoRows: { type: 'table', content: [] },
    tableSpaceCell: { type: 'table', content: [{ type: 'tableRow', content: [cell('tableHeader', {}, p(t(' padded  text ')))] }] },
    tablePipe: { type: 'table', content: [{ type: 'tableRow', content: [cell('tableHeader', {}, p(t('a|b')))] }, { type: 'tableRow', content: [cell('tableCell', {}, p(t('c')))] }] },
    calloutNested: { type: 'callout', attrs: { tone: 'note' }, content: [{ type: 'callout', attrs: { tone: 'warn' }, content: [p(t('inner'))] }, p(t('after'))] },
    calloutCode: { type: 'callout', attrs: { tone: 'note' }, content: [{ type: 'codeBlock', attrs: { language: null }, content: [t(':::\n```')] }] },
    textColonLine: p(t(':::')),
    textEntity: p(t('&#32; and &#160; and &amp;')),
    textSep: p(t('<!----> literal')),
    textMarkTag: p(t('<mark color="x">no</mark> <img src="a"/> <math latex="x"/>')),
    pendingQuote: { type: 'pending', attrs: { intent: 'He said "go" & left' } },
  };

  it.each(Object.entries(states))('%s', (_name, json) => {
    const doc = docOf([schema.nodeFromJSON(json)]);
    for (const ids of [true, false]) expect(stored(docOf(md.parse(md.serialize(doc, { ids }))))).toEqual(stored(doc));
  });
});

// Decision Log 18: raw content (code, display math, a diagram's source) inside a quote or a list item stays literal; the
// id and milestone preprocessing reads each line past its containers' prefixes (`> `, an item's indentation, nested).
describe('raw content inside containers', () => {
  const t = (text: string): JSONContent => ({ type: 'text', text });
  const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
  // id-looking, marker-looking, milestone-like and fence-like lines
  const literal = 'one ^bb\n^cc\n<c:literal>\n</c:x>\n:::\n```';
  const code: JSONContent = { type: 'codeBlock', attrs: { language: 'md' }, content: [t(literal)] };
  const quote = (...content: JSONContent[]): JSONContent => ({ type: 'blockquote', content });
  const item = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content });
  const states: Record<string, JSONContent> = {
    codeInQuote: quote(code),
    codeInItem: { type: 'bulletList', content: [item(p(t('a')), code)] },
    codeInQuoteInQuote: quote(quote(code)),
    // Tiptap's ordered-list tokenizer cut continuation lines a column short: the code gained a leading space
    codeInOrderedItems: { type: 'orderedList', attrs: { start: 9 }, content: [item(p(t('a')), code), item(p(t('b')), code)] },
    codeInLetteredItems: { type: 'orderedList', attrs: { start: 1, type: 'i' }, content: [item(p(t('a')), code), item(p(t('b')), { type: 'orderedList', attrs: { start: 1, type: 'a' }, content: [item(p(t('c')), code)] })] },
    codeInNumberedUnderLettered: { type: 'orderedList', attrs: { start: 1, type: 'A' }, content: [item(p(t('a')), { type: 'orderedList', attrs: { start: 1 }, content: [item(p(t('c')), code)] })] },
    codeWithNumberedLines: { type: 'orderedList', attrs: { start: 1 }, content: [item(p(t('steps')), { type: 'codeBlock', attrs: { language: null }, content: [t('1. first\n  - second\n> third')] })] },
    codeInTaskItem: { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p(t('a')), code] }] },
    codeInQuoteInItem: { type: 'bulletList', content: [item(p(t('a')), quote(p(t('q')), code))] },
    codeInItemInQuote: quote({ type: 'bulletList', content: [item(p(t('a')), code)] }),
    codeInNestedItem: { type: 'bulletList', content: [item(p(t('a')), { type: 'bulletList', content: [item(p(t('b')), code)] })] },
    rawInQuote: quote({ type: 'diagram', attrs: { source: 'x ^bb\n^cc\n:::' } }, { type: 'mathBlock', attrs: { latex: 'y ^dd\n^ee' } }, { type: 'chart', attrs: { source: 'z ^ff\n^gg', spec: null } }),
  };

  it.each(Object.entries(states))('%s', (_name, json) => {
    const doc = docOf([schema.nodeFromJSON(json)]);
    for (const ids of [true, false]) expect(stored(docOf(md.parse(md.serialize(doc, { ids }))))).toEqual(stored(doc));
  });

  it('reads quoted code as written (the review’s case)', () => {
    const [back] = md.parse('> ```md\n> one ^bb\n> ^cc\n> <\\c:literal>\n> ```\n^q1');
    expect(back.attrs.id).toBe('q1');
    expect(back.child(0).textContent).toBe('one ^bb\n^cc\n<c:literal>');
  });

  it('reads comment milestones away inside quoted and listed code, the code as it was', () => {
    const commented = (): JSONContent => ({ type: 'codeBlock', attrs: { language: null }, content: [t('kept <c:x> '), { type: 'text', text: 'noted', marks: [{ type: 'comment', attrs: { threadId: 't1' } }] }] });
    const doc = docOf([schema.nodeFromJSON(quote(quote(commented()))), schema.nodeFromJSON({ type: 'bulletList', content: [item(p(t('a')), commented())] })]);
    const read = md.serialize(doc, { milestones: new Set(['t1']) });
    expect(read).toContain('> > kept <\\c:x> <c:t1>noted</c:t1>');
    expect(read).toContain('  kept <\\c:x> <c:t1>noted</c:t1>');
    expect(stored(docOf(md.parse(read)))).toEqual(stored(doc));
  });

  it('keeps a structure-block table row’s id inside a quote', () => {
    const table = { type: 'table', content: [{ type: 'tableRow', attrs: { id: 'rw1' }, content: [{ type: 'tableCell', content: [p(t('a')), p(t('b'))] }] }] };
    const read = md.serialize(docOf([schema.nodeFromJSON(quote(table))]));
    expect(read).toContain('> :::row <!-- ^rw1 -->');
    const [back] = md.parse(read);
    expect(back.child(0).child(0).attrs.id).toBe('rw1');
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
    'Dr. Smith signed it',
    'A. Lincoln and iv) the fourth',
    'I. Introduction',
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
