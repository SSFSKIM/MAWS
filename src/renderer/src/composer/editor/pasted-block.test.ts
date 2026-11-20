// The composer's one maker of a text block (UX wave U6b-5a, decision 7, decision 30; Interfaces §C): today's node,
// attribute for attribute, with the id it is given; a lookup by id; and an append that changes nothing else of a draft.
import { describe, expect, it } from 'vitest';
import { docOf, emptyDoc, paragraph, pastedNode, textNode } from './doc';
import { appendPasted, holdsBlock, pastedBlock } from './pasted-block';

describe('pastedBlock', () => {
  it('makes the node a paste over the threshold made before it, attribute for attribute, with the id it is given', () => {
    const text = 'one\ntwo\nthree';
    expect(pastedBlock(text, 'attach-1')).toEqual(pastedNode({ id: 'attach-1', kind: 'text', name: 'Pasted text #1', lines: 3, text }));
    const minted = pastedBlock('x');
    expect(minted).toMatchObject({ type: 'pasted', attrs: { kind: 'text', name: 'Pasted text #1', lines: 1, text: 'x' } });
    expect(String(minted.attrs?.id)).toMatch(/^pasted-/); // a paste's own id, as `atomId('pasted')` gave it
    expect(pastedBlock('x', 'pasted-9', 'notes.txt').attrs).toMatchObject({ id: 'pasted-9', name: 'notes.txt' }); // a dropped text file keeps its name
  });
});

describe('holdsBlock', () => {
  it('finds a pasted node of that id anywhere in a document, and no other', () => {
    const doc = docOf([paragraph(textNode('before')), paragraph(textNode('a '), pastedBlock('x', 'attach-2'))]);
    expect(holdsBlock(doc, 'attach-2')).toBe(true); // the control: the same reader finds the form it should
    expect(holdsBlock(doc, 'attach-3')).toBe(false);
    expect(holdsBlock(docOf([paragraph(textNode('attach-2'))]), 'attach-2')).toBe(false); // text that reads like the id is not a block
    expect(holdsBlock(null, 'attach-2')).toBe(false);
    expect(holdsBlock(undefined, 'attach-2')).toBe(false);
  });
});

describe('appendPasted', () => {
  it('appends one block and changes nothing else of the draft', () => {
    const attachments = [{ id: 'a', kind: 'image' as const, name: 'shot.png', mediaType: 'image/png', bytes: 3, data: 'AAA', persisted: true }];
    const doc = docOf([paragraph(textNode('look at this'))], attachments);
    const next = appendPasted(doc, { id: 'attach-4', text: 'ls -la' });
    expect(next.attrs).toEqual(doc.attrs);
    expect(next.content).toEqual([paragraph(textNode('look at this')), paragraph(pastedBlock('ls -la', 'attach-4'))]);
    expect(doc.content).toEqual([paragraph(textNode('look at this'))]); // the document read is not changed in place
  });

  it('puts the block into an empty last paragraph, and starts an empty document where there is none', () => {
    expect(appendPasted(docOf([paragraph(textNode('a')), paragraph()]), { id: 'attach-5', text: 'b' }).content).toEqual([paragraph(textNode('a')), paragraph(pastedBlock('b', 'attach-5'))]);
    expect(appendPasted(null, { id: 'attach-6', text: 'c' })).toEqual({ ...emptyDoc(), content: [paragraph(pastedBlock('c', 'attach-6'))] });
  });
});
