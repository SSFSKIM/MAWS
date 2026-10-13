// The library's text extractor (the P3-L document, Decision Log 3): a Y.Doc's text by a schema-free walk, an HTML
// page's text without its scripts, styles and tags, a file's text when it is small UTF-8, every text capped.
import { describe, expect, it } from 'vitest';
import { applyV2, newDoc, stateV2, type Doc, type Node } from '@artifacts/yjs';
import { extractText, FILE_TEXT_MAX_BYTES, TEXT_MAX_BYTES } from './text';

const bytes = (text: string) => new TextEncoder().encode(text);
// A nested node, as A's restore tests make one (the binding module exports `Node` as a type only).
const node = (doc: Doc, name?: string): Node => new (doc.get('root').constructor as new (name?: string) => Node)(name);
// The doc as the host hands it to the extractor: a fresh replica from the stored state.
const reloaded = (doc: Doc): Doc => {
  const copy = newDoc();
  applyV2(copy, stateV2(doc));
  return copy;
};

describe('extractText: a Y.Doc', () => {
  it('collects every text reached through root types, child nodes and node-valued attributes, and nothing else', () => {
    const doc = newDoc();
    doc.transact(() => {
      const body = doc.get('body');
      body.insert(0, 'Opening line');
      const paragraph = node(doc, 'paragraph');
      paragraph.insert(0, 'bold');
      paragraph.insert(4, ' and plain'); // two runs of one text
      body.insert(body.length, [paragraph]);
      body.insert(body.length, [42, { embed: 'not text' }]); // embedded values are not text
      const slide = node(doc);
      slide.setAttr('id', 'e1-plain-attribute'); // a plain attribute is a property, not text
      const notes = node(doc);
      notes.insert(0, 'speaker notes');
      slide.setAttr('notes', notes);
      const elements = node(doc);
      const box = node(doc);
      box.insert(0, '서울 발표 자료');
      elements.setAttr('b', box);
      slide.setAttr('elements', elements);
      doc.get('slides').setAttr('s1', slide);
      doc.get('meta').setAttr('title', { nested: 'json is not text' });
    });
    doc.get('body').format(0, 7, { bold: true });

    // children in order; roots and attributes, which have no order of their own, by name
    const text = extractText({ kind: 'presentation', doc: reloaded(doc) });
    expect(text.split('\n')).toEqual(['Opening line', 'bold and plain', '서울 발표 자료', 'speaker notes']);
  });

  it('reads an empty document as no text', () => {
    expect(extractText({ kind: 'document', doc: newDoc() })).toBe('');
  });

  it('is capped at 256 KiB of UTF-8 without splitting a character', () => {
    const doc = newDoc();
    doc.get('root').insert(0, 'a' + '한'.repeat(TEXT_MAX_BYTES)); // 3 bytes each
    const text = extractText({ kind: 'document', doc });
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(TEXT_MAX_BYTES);
    expect(new TextEncoder().encode(text).length).toBeGreaterThan(TEXT_MAX_BYTES - 3);
    expect(text.endsWith('한')).toBe(true);
  });
});

describe('extractText: an html page', () => {
  it('drops scripts, styles, comments and tags, decodes entities and collapses whitespace', () => {
    const page = `<!doctype html>
      <html><head><title>Q3 &amp; Q4</title>
        <style>body { color: red } .needle { }</style>
        <script type="module">const secret = "<p>not text</p>";</script>
      </head>
      <body>
        <!-- a comment -->
        <h1 class="x" data-note="a > b">Plan</h1>
        <p>Price&nbsp;&lt;10&gt; &quot;quoted&quot; &#39;single&#39; &#x1F600; &#8212; caf&eacute; &unknown;</p>
        <script>alert('unclosed')
    `;
    expect(extractText({ kind: 'html', bytes: bytes(page) })).toBe(`Q3 & Q4 Plan Price <10> "quoted" 'single' 😀 — café &unknown;`);
  });

  it('reads a script or style tag inside a comment as part of the comment, and a comment opener inside a script as script', () => {
    expect(extractText({ kind: 'html', bytes: bytes('<!-- <script> --> <p>Visible needle</p>') })).toBe('Visible needle');
    expect(extractText({ kind: 'html', bytes: bytes('<!-- <style> --> <p>Styled needle</p><!-- </style> -->') })).toBe('Styled needle');
    expect(extractText({ kind: 'html', bytes: bytes('<script>const a = "<!--";</script><p>After the script</p><!-- -->') })).toBe('After the script');
  });

  it('reads a page that is not valid UTF-8 with replacement characters rather than failing', () => {
    expect(extractText({ kind: 'html', bytes: new Uint8Array([0x3c, 0x70, 0x3e, 0x68, 0x69, 0xff, 0x3c, 0x2f, 0x70, 0x3e]) })).toBe('hi�');
  });
});

describe('extractText: a file', () => {
  it('is its content when it is UTF-8 text', () => {
    expect(extractText({ kind: 'file', name: 'notes.md', bytes: bytes('# Notes\n\n회의록 needle') })).toBe('# Notes\n\n회의록 needle');
  });

  it('is its name when it is binary, not UTF-8, too large or unread', () => {
    expect(extractText({ kind: 'file', name: 'image.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]) })).toBe('image.png');
    expect(extractText({ kind: 'file', name: 'latin1.txt', bytes: new Uint8Array([0x63, 0x61, 0x66, 0xe9]) })).toBe('latin1.txt');
    expect(extractText({ kind: 'file', name: 'big.txt', bytes: new Uint8Array(FILE_TEXT_MAX_BYTES + 1).fill(0x61) })).toBe('big.txt');
    expect(extractText({ kind: 'file', name: 'gone.txt', bytes: null })).toBe('gone.txt');
  });

  it('is capped at 256 KiB like every text', () => {
    const text = extractText({ kind: 'file', name: 'long.txt', bytes: new Uint8Array(FILE_TEXT_MAX_BYTES).fill(0x61) });
    expect(text.length).toBe(TEXT_MAX_BYTES);
  });
});
