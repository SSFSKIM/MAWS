// P4-B4 M2 (docs/doperpowers/plans/2026-10-20-p4-b4-tool-surface.md, "Sections"): the search mirror's body, built in
// sections that each name the place `artifact_read` opens at: a document's tabs in display order (the title, then one
// line per top-level block), then the rest of its text with no place; a file model's files in the order they are read,
// manifests skipped and html without markup; every other kind as the library's extractor reads it. NFC, capped.
import type { JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { schemaFor } from '@artifacts/document/schema';
import { addTab, createDocument, moveTab, tabBody } from '@artifacts/document/tabs';
import { addThread, anchorOfMark } from '@artifacts/document/threads';
import { newDoc, type Doc } from '@artifacts/yjs';
import { MIRROR_TEXT_MAX_BYTES, placeAt, sectionText, type SectionedText } from './sections';
import { TEXT_MAX_BYTES } from './text';

const schema = schemaFor();
type J = JSONContent;
const t = (text: string, marks?: J['marks']): J => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const para = (id: string, ...content: J[]): J => ({ type: 'paragraph', attrs: { id }, content });
const doc = (...content: J[]) => schema.nodeFromJSON({ type: 'doc', content });

function twoTabs(): Doc {
  const ydoc = newDoc();
  createDocument(ydoc, {
    title: 'Overview',
    id: 'tabA',
    body: doc(
      { type: 'heading', attrs: { id: 'h1', level: 1 }, content: [t('Quarterly roadmap')] },
      para('p1', t('We ship '), t('the editor', [{ type: 'comment', attrs: { threadId: 'c1' } }]), t(' first.')),
      {
        type: 'bulletList',
        attrs: { id: 'l1' },
        content: [
          { type: 'listItem', attrs: { id: 'li1' }, content: [para('lp1', t('search'))] },
          { type: 'listItem', attrs: { id: 'li2' }, content: [para('lp2', t('links'))] },
        ],
      },
    ),
  });
  addTab(ydoc, { title: '로드맵 메모', id: 'tabB', body: doc(para('k1', t('우리는 로드맵을 지난주에 논의했다'))) });
  return ydoc;
}

const lines = (text: SectionedText) => text.body.split('\n');

describe('sectionText: a document', () => {
  it('reads each tab in display order, its title then one line per top-level block with the nested text, each with its place', () => {
    const ydoc = twoTabs();
    const anchor = anchorOfMark(tabBody(ydoc, 'tabA')!, 'c1');
    addThread(ydoc, { threadId: 'c1', tabId: 'tabA', blockId: 'p1', quote: 'the editor', anchor: anchor!, by: { kind: 'human' }, at: 1, body: 'Should this wait for the review?' });
    const text = sectionText({ kind: 'document', doc: ydoc });
    expect(lines(text)).toEqual(['Overview', 'Quarterly roadmap', 'We ship the editor first.', 'search links', '로드맵 메모', '우리는 로드맵을 지난주에 논의했다', 'Should this wait for the review?']);
    const at = (needle: string) => placeAt(text, text.body.indexOf(needle));
    expect(at('Overview')).toEqual({ tab: 'tabA' });
    expect(at('Quarterly')).toEqual({ tab: 'tabA', from: 'h1' });
    expect(at('editor')).toEqual({ tab: 'tabA', from: 'p1' });
    expect(at('links')).toEqual({ tab: 'tabA', from: 'l1' }); // a nested block opens at its top-level block
    expect(at('메모')).toEqual({ tab: 'tabB' });
    expect(at('지난주')).toEqual({ tab: 'tabB', from: 'k1' });
    expect(at('review')).toBeNull(); // the rest of the document (a comment's message) has no place
  });

  it('follows the tabs’ display order, not their creation order', () => {
    const ydoc = twoTabs();
    moveTab(ydoc, 'tabB', { before: 'tabA' });
    expect(lines(sectionText({ kind: 'document', doc: ydoc }))[0]).toBe('로드맵 메모');
  });

  it('stores its text NFC', () => {
    const ydoc = newDoc();
    const nfd = '로드맵'.normalize('NFD');
    createDocument(ydoc, { title: nfd, id: 'tab1', body: doc(para('p1', t(`Café ${nfd}`.normalize('NFD')))) });
    const { body } = sectionText({ kind: 'document', doc: ydoc });
    expect(body).toBe(body.normalize('NFC'));
    expect(body).toBe('로드맵\nCafé 로드맵');
  });

  it('caps the body at 2 MiB of UTF-8 (not the library’s 256 KiB) and keeps only the sections that start inside it', () => {
    expect(MIRROR_TEXT_MAX_BYTES).toBe(2 * 1024 * 1024);
    const ydoc = newDoc();
    const big = '가'.repeat(300_000); // 900,000 bytes a block
    createDocument(ydoc, { title: 'Big', id: 'tab1', body: doc(...[0, 1, 2, 3, 4].map((n) => para(`p${n}`, t(big)))) });
    const text = sectionText({ kind: 'document', doc: ydoc });
    const bytes = new TextEncoder().encode(text.body).length;
    expect(bytes).toBeLessThanOrEqual(MIRROR_TEXT_MAX_BYTES);
    expect(bytes).toBeGreaterThan(MIRROR_TEXT_MAX_BYTES - 3);
    expect(text.sections.map(([, place]) => place)).toEqual([{ tab: 'tab1' }, { tab: 'tab1', from: 'p0' }, { tab: 'tab1', from: 'p1' }, { tab: 'tab1', from: 'p2' }]);
    expect(text.sections.every(([offset]) => offset < text.body.length)).toBe(true);
  });

  it('reads an empty document as no text and no sections', () => {
    expect(sectionText({ kind: 'document', doc: newDoc() })).toEqual({ body: '', sections: [] });
  });
});

describe('sectionText: a file model (a deck, a design, a design system)', () => {
  it('reads the files in the order given, html without markup (a slide’s notes kept), manifests skipped, other files as they are', () => {
    const files = {
      'project/deck.json': '{"title":"Q3 review","order":["s2","s1"]}',
      'project/slides/s2.html': '<section id="s2"><h2>Numbers</h2><p>Revenue &amp; growth</p><aside>Mention the 매출 dip</aside></section>',
      'project/slides/s1.html': '<section id="s1"><h2>Plan</h2><style>.x{color:red}</style></section>',
      'tokens.css': ':root { --brand: #123456; }',
    };
    const text = sectionText({ kind: 'presentation', files });
    expect(lines(text)).toEqual(['Numbers Revenue & growth Mention the 매출 dip', 'Plan', ':root { --brand: #123456; }']);
    expect(placeAt(text, text.body.indexOf('매출'))).toEqual({ paths: ['project/slides/s2.html'] });
    expect(placeAt(text, text.body.indexOf('Plan'))).toEqual({ paths: ['project/slides/s1.html'] });
    expect(placeAt(text, text.body.indexOf('brand'))).toEqual({ paths: ['tokens.css'] });
  });
});

describe('sectionText: the other kinds, as the library extractor reads them, with no place', () => {
  it('keeps an html page’s text past the library’s 256 KiB', () => {
    const long = `${'word '.repeat(TEXT_MAX_BYTES / 4)}the end`;
    expect(sectionText({ kind: 'html', bytes: new TextEncoder().encode(`<p>${long}</p>`) }).body.endsWith('the end')).toBe(true);
  });

  it('reads an html page without its markup', () => {
    const text = sectionText({ kind: 'html', bytes: new TextEncoder().encode('<h1>Launch</h1><script>x()</script><p>plan</p>') });
    expect(text).toEqual({ body: 'Launch plan', sections: [[0, null]] });
    expect(placeAt(text, 3)).toBeNull();
  });

  it('reads a file’s text, and a binary one as its name', () => {
    expect(sectionText({ kind: 'file', name: 'notes.md', bytes: new TextEncoder().encode('# Notes\nbody') }).body).toBe('# Notes\nbody');
    expect(sectionText({ kind: 'file', name: 'photo.png', bytes: new Uint8Array([0, 1, 2]) }).body).toBe('photo.png');
  });

  it('reads a dashboard’s doc through the extractor', () => {
    const ydoc = newDoc();
    ydoc.get('charts').insert(0, 'Weekly active users');
    expect(sectionText({ kind: 'dashboard', doc: ydoc })).toEqual({ body: 'Weekly active users', sections: [[0, null]] });
  });
});
