// Find in the active tab (M3 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): a decoration plugin over the
// editor's text with a count, next and previous.
import { Editor, type JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { coreExtensionOptions } from '../ids';
import { extensions } from '../schema';
import { Find, findState } from './find-plugin';
import { doc, para } from './test-world';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const make = (content: JSONContent) => {
  editor = new Editor({ element: document.createElement('div'), coreExtensionOptions, extensions: [...extensions(), Find], content });
  return editor;
};
const decorated = (e: Editor, className: string) => [...e.view.dom.querySelectorAll(`.${className}`)].map((el) => el.textContent);
const selected = (e: Editor) => e.state.doc.textBetween(e.state.selection.from, e.state.selection.to);

const corpus = doc(
  para('p1', 'An apple and a banana.'),
  { type: 'paragraph', attrs: { id: 'p2' }, content: [{ type: 'text', text: 'Ap' }, { type: 'text', text: 'ple', marks: [{ type: 'bold' }] }, { type: 'text', text: ' pie' }] },
  { type: 'codeBlock', attrs: { id: 'c1', language: 'js' }, content: [{ type: 'text', text: 'apple()' }] },
);

describe('find', () => {
  it('highlights every match case-insensitively, across marks, and counts them', () => {
    const e = make(corpus);
    e.commands.setFindQuery('apple');
    expect(findState(e.state)).toMatchObject({ query: 'apple', count: 3, current: 0 });
    expect(decorated(e, 'find-match')).toEqual(['apple', 'Ap', 'ple', 'apple']);
    expect(decorated(e, 'find-match-current')).toEqual(['apple']);
  });

  it('stays case-insensitive in a block whose lower-casing changes its length, at the original positions', () => {
    // 'İ' lower-cases to two code units ('i̇'), so a lower-cased copy of this block is longer than the block
    const e = make(doc(para('p1', 'İ Apple, then 𝐀 APPLE'), para('p2', 'Straße STRASSE')));
    e.commands.setFindQuery('apple');
    expect(findState(e.state).count).toBe(2);
    expect(decorated(e, 'find-match')).toEqual(['Apple', 'APPLE']);
    e.commands.findNext();
    expect(selected(e)).toBe('APPLE');
    e.commands.setFindQuery('straße');
    expect(decorated(e, 'find-match')).toEqual(['Straße']);
  });

  it('steps forward and back through the matches, wrapping, and selects the current one', () => {
    const e = make(corpus);
    e.commands.setFindQuery('apple');
    e.commands.findNext();
    expect(findState(e.state).current).toBe(1);
    expect(selected(e)).toBe('Apple');
    e.commands.findNext();
    e.commands.findNext();
    expect(findState(e.state).current).toBe(0);
    e.commands.findPrevious();
    expect(findState(e.state).current).toBe(2);
    expect(selected(e)).toBe('apple');
  });

  it('starts from the first match at or after the caret', () => {
    const e = make(corpus);
    e.commands.setTextSelection(e.state.doc.child(0).nodeSize + 1);
    e.commands.setFindQuery('apple');
    expect(findState(e.state).current).toBe(1);
  });

  it('follows the document as it changes, and clears', () => {
    const e = make(corpus);
    e.commands.setFindQuery('pie');
    expect(findState(e.state).count).toBe(1);
    e.commands.insertContentAt(1, 'pie, ');
    expect(findState(e.state).count).toBe(2);
    e.commands.clearFind();
    expect(findState(e.state)).toMatchObject({ query: '', count: 0 });
    expect(decorated(e, 'find-match')).toEqual([]);
  });

  it('never matches across a block boundary or an inline chip', () => {
    const e = make(
      doc(para('p1', 'ab'), { type: 'paragraph', attrs: { id: 'p2' }, content: [{ type: 'text', text: 'c' }, { type: 'date', attrs: { iso: '2026-10-13' } }, { type: 'text', text: 'd' }] }),
    );
    e.commands.setFindQuery('bc');
    expect(findState(e.state).count).toBe(0);
    e.commands.setFindQuery('cd');
    expect(findState(e.state).count).toBe(0);
  });
});
