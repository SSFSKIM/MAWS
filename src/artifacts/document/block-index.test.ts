// The block index (D6): ids to nodes at any depth across tabs, each top-level block's ProseMirror node, markdown, plain
// text and comment threads cached until a transaction changes the block, and the change epochs the writer's staleness
// check reads. Kept current from the doc's transactions, never by walking the whole document per lookup.
import type { JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { applyV1, diffV1, newDoc, stateVector, transact, type Doc } from '../yjs';
import { YNode } from '../yjs/document';
import { pmnodeToDelta } from '../yjs/prosemirror';
import { DocIndex } from './block-index';
import { schemaFor } from './schema';
import { addTab, createDocument, deleteTab, tabBody } from './tabs';

const schema = schemaFor();
const t = (text: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (id: string, text: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'paragraph', attrs: { id }, content: [t(text, marks)] });
const cell = (id: string, text: string): JSONContent => ({ type: 'tableCell', attrs: { id }, content: [p(`${id}p`, text)] });

function world(): { doc: Doc; tab: string } {
  const doc = newDoc();
  const tab = createDocument(doc, {
    title: 'Main',
    id: 'tab1',
    body: schema.nodeFromJSON({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { id: 'h1', level: 1 }, content: [t('Plan')] },
        p('p1', 'The quick brown fox.'),
        p('p2', 'A commented passage.', [{ type: 'comment', attrs: { threadId: 't1' } }]),
        { type: 'bulletList', attrs: { id: 'l1' }, content: [{ type: 'listItem', attrs: { id: 'li1' }, content: [p('lp1', 'first')] }] },
        { type: 'table', attrs: { id: 'tb1' }, content: [{ type: 'tableRow', attrs: { id: 'r0' }, content: [cell('c00', 'alpha'), cell('c01', '1')] }] },
      ],
    }),
  });
  return { doc, tab };
}
const body = (doc: Doc, tab = 'tab1') => tabBody(doc, tab)!;
const node = (doc: Doc, path: number[]) => path.reduce((n, i) => n.get(i) as unknown as YNode, body(doc) as unknown as YNode) as unknown as ReturnType<typeof tabBody> & YNode;

describe('DocIndex', () => {
  it('finds ids at any depth and lists the top-level blocks in order', () => {
    const { doc } = world();
    const index = DocIndex.of(doc);
    expect(index.tops('tab1').map((top) => top.id)).toEqual(['h1', 'p1', 'p2', 'l1', 'tb1']);
    expect(index.find('lp1')?.top.id).toBe('l1');
    expect(index.find('c01p')?.top.id).toBe('tb1');
    expect(index.find('c01p')?.node.name).toBe('paragraph');
    expect(index.find('nope')).toBeNull();
    expect(DocIndex.of(doc)).toBe(index);
  });

  it('caches a block as ProseMirror, markdown, text and threads, and refreshes only what a transaction changed', () => {
    const { doc } = world();
    const index = DocIndex.of(doc);
    const [, p1, p2] = index.tops('tab1');
    expect(index.md(p1)).toBe('The quick brown fox. ^p1');
    expect(index.text(p1)).toBe('The quick brown fox.');
    expect([...index.threads(p2)]).toEqual(['t1']);
    const pm2 = index.pm(p2);
    transact(doc, () => node(doc, [1]).insert(4, 'very '));
    expect(index.md(index.find('p1')!.top)).toBe('The very quick brown fox. ^p1');
    expect(index.pm(index.find('p2')!.top)).toBe(pm2);
  });

  it('follows another replica’s update: inserted, deleted and moved blocks', () => {
    const { doc } = world();
    const index = DocIndex.of(doc);
    const peer = newDoc();
    applyV1(peer, diffV1(doc));
    transact(peer, () => {
      const root = body(peer);
      root.delete(1, 1); // p1
      root.insert(0, [pmnodeToDelta(schema.nodeFromJSON(p('n1', 'New first.')))]);
    });
    applyV1(doc, diffV1(peer, stateVector(doc)));
    expect(index.tops('tab1').map((top) => top.id)).toEqual(['n1', 'h1', 'p2', 'l1', 'tb1']);
    expect(index.find('p1')).toBeNull();
    expect(index.find('n1')?.top.id).toBe('n1');
  });

  it('drops a nested id when its node goes, and indexes ids a later write adds', () => {
    const { doc } = world();
    const index = DocIndex.of(doc);
    expect(index.find('li1')).not.toBeNull();
    transact(doc, () => node(doc, [3]).delete(0, 1));
    expect(index.find('li1')).toBeNull();
    expect(index.find('lp1')).toBeNull();
    transact(doc, () => node(doc, [3]).insert(0, [pmnodeToDelta(schema.nodeFromJSON({ type: 'listItem', attrs: { id: 'li9' }, content: [p('lp9', 'again')] }))]));
    expect(index.find('lp9')?.top.id).toBe('l1');
  });

  it('keeps change epochs: a block changed since a mark, and a container whose own children changed', () => {
    const { doc } = world();
    const index = DocIndex.of(doc);
    const mark = index.epoch;
    transact(doc, () => node(doc, [4, 0, 1, 0]).insert(0, '2')); // the text of cell (0, 1)
    expect(index.changedSince('c01', mark)).toBe(true);
    expect(index.changedSince('tb1', mark)).toBe(true);
    expect(index.changedSince('p1', mark)).toBe(false);
    expect(index.structureChangedSince('tb1', mark)).toBe(false);
    expect(index.structureChangedSince('r0', mark)).toBe(false);
    const second = index.epoch;
    transact(doc, () => node(doc, [4]).insert(1, [pmnodeToDelta(schema.nodeFromJSON({ type: 'tableRow', attrs: { id: 'r1' }, content: [cell('c10', 'beta'), cell('c11', '2')] }))]));
    expect(index.structureChangedSince('tb1', second)).toBe(true);
    expect(index.changedSince('c10', second)).toBe(true);
    transact(doc, () => node(doc, [1]).setAttr('id', 'p1'));
    expect(index.changedSince('p1', second)).toBe(true);
  });

  it('indexes every tab and forgets a deleted one', () => {
    const { doc } = world();
    const index = DocIndex.of(doc);
    addTab(doc, { title: 'Second', id: 'tab2', body: schema.nodeFromJSON({ type: 'doc', content: [p('q1', 'Other tab.')] }) });
    expect(index.find('q1')?.top.tabId).toBe('tab2');
    expect(index.tabIds()).toEqual(['tab1', 'tab2']);
    deleteTab(doc, 'tab2');
    expect(index.find('q1')).toBeNull();
    expect(index.tabIds()).toEqual(['tab1']);
  });

  it('tells a node’s top-level block', () => {
    const { doc } = world();
    const index = DocIndex.of(doc);
    expect(index.topOf(node(doc, [3, 0, 0]))?.id).toBe('l1');
    expect(index.topOf(body(doc))).toBeNull();
  });
});

// M9 addendum (wave 2's re-review): an unscoped quote's raw-text prefilter may rule out only a block whose markdown is
// its text plus syntax that spells no word; every other block is checked on its markdown.
describe('plain prose', () => {
  const li = (id: string, text: string): JSONContent => ({ type: 'listItem', attrs: { id }, content: [p(`${id}p`, text)] });
  const plain: Record<string, JSONContent> = {
    paragraph: { type: 'paragraph', attrs: { id: 'a' }, content: [t('Words, (parens) #hash *star* _under_ ~tilde~ [brackets] |pipe| `tick` \\slash ^caret 1. x')] },
    marks: { type: 'paragraph', attrs: { id: 'b' }, content: [t('bold', [{ type: 'bold' }]), t(' italic ', [{ type: 'italic' }]), t('under', [{ type: 'underline' }]), t(' strike', [{ type: 'strike' }]), t('code ', [{ type: 'code' }]), t('marked', [{ type: 'highlight', attrs: { color: null } }])] },
    breaks: { type: 'paragraph', attrs: { id: 'c' }, content: [t('one'), { type: 'hardBreak' }, t('two')] },
    empty: { type: 'paragraph', attrs: { id: 'd' } },
    heading: { type: 'heading', attrs: { id: 'e', level: 3 }, content: [t('A heading')] },
    quote: { type: 'blockquote', attrs: { id: 'f' }, content: [p('fp', 'Quoted words')] },
    bullets: { type: 'bulletList', attrs: { id: 'g' }, content: [li('g1', 'first item'), li('g2', 'second item')] },
    numbers: { type: 'orderedList', attrs: { id: 'h', start: 7, type: null }, content: [li('h1', 'seventh step'), li('h2', 'eighth step')] },
    tasks: { type: 'taskList', attrs: { id: 'i' }, content: [{ type: 'taskItem', attrs: { id: 'i1', checked: true }, content: [p('i1p', 'done task')] }] },
    rule: { type: 'horizontalRule', attrs: { id: 'j' } },
    code: { type: 'codeBlock', attrs: { id: 'k', language: null }, content: [t('const value = compute(input);')] },
  };
  const generated: Record<string, JSONContent> = {
    link: { type: 'paragraph', attrs: { id: 'n1' }, content: [t('Read more', [{ type: 'link', attrs: { href: 'https://example.com', title: null } }])] },
    comment: p('n2', 'commented', [{ type: 'comment', attrs: { threadId: 't9' } }]),
    colour: { type: 'paragraph', attrs: { id: 'n3' }, content: [t('tinted', [{ type: 'highlight', attrs: { color: '#fde68a' } }])] },
    entity: p('n4', 'Fish & chips'),
    angle: p('n5', 'a <b> tag'),
    image: { type: 'paragraph', attrs: { id: 'n6' }, content: [{ type: 'image', attrs: { src: 'https://x.org/a.png', alt: 'An image', assetId: null } }] },
    chip: { type: 'paragraph', attrs: { id: 'n7' }, content: [t('Due '), { type: 'date', attrs: { iso: '2026-10-12' } }] },
    math: { type: 'paragraph', attrs: { id: 'n8' }, content: [{ type: 'math', attrs: { latex: 'E = mc^2' } }] },
    lettered: { type: 'orderedList', attrs: { id: 'n9', start: 4, type: 'i' }, content: [li('n91', 'roman item')] },
    language: { type: 'codeBlock', attrs: { id: 'n10', language: 'typescript' }, content: [t('let a = 1;')] },
    callout: { type: 'callout', attrs: { id: 'n11', tone: 'warn' }, content: [p('n11p', 'Careful')] },
    table: { type: 'table', attrs: { id: 'n12' }, content: [{ type: 'tableRow', attrs: { id: 'n12r' }, content: [cell('n12c', 'cell')] }] },
    pending: { type: 'pending', attrs: { id: 'n13', intent: 'a summary' } },
    chart: { type: 'chart', attrs: { id: 'n14', source: 'x,y', spec: { mark: 'bar' } } },
  };
  const indexed = (blocks: Record<string, JSONContent>) => {
    const doc = newDoc();
    createDocument(doc, { title: 'Main', id: 'tab1', body: schema.nodeFromJSON({ type: 'doc', content: Object.values(blocks) }) });
    const index = DocIndex.of(doc);
    return Object.keys(blocks).map((name, k) => ({ name, index, top: index.tops('tab1')[k] }));
  };

  it('tells plain prose from a block whose markdown generates text', () => {
    expect(indexed(plain).filter(({ index, top }) => !index.plainProse(top)).map(({ name }) => name)).toEqual([]);
    expect(indexed(generated).filter(({ index, top }) => index.plainProse(top)).map(({ name }) => name)).toEqual([]);
  });

  it('holds in a plain-prose block’s raw text every word its markdown spells', () => {
    for (const { name, index, top } of indexed(plain)) {
      const words = index.md(top).replace(/\^[0-9a-z]{2,32}/g, ' ').match(/[\p{L}\p{N}]+/gu) ?? [];
      const missing = words.filter((word) => word.length > 1 && !/^\p{N}+$/u.test(word) && !index.rawText(top).includes(word));
      expect(missing, `${name}: ${index.md(top)}`).toEqual([]);
    }
  });
});
