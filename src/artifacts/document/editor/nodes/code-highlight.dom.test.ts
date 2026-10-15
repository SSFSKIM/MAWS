// The code highlighter's decorations across edits (happy-dom; M9 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md:
// the scale gate's keystroke → frame bound found the plugin rebuilding every code block's decorations on every
// keystroke of a 200-page document). A transaction re-highlights only the code blocks it touched; every other block's
// decorations are mapped, the same decorations as before; an edit in a block, a language change and a block's removal
// still show.
import { Editor } from '@tiptap/core';
import type { Decoration, DecorationSet } from '@tiptap/pm/view';
import { afterEach, describe, expect, it } from 'vitest';
import { coreExtensionOptions } from '../../ids';
import { editorExtensions } from '../extensions';
import { memoryEditorHost } from '../memory-host';
import { doc, para, until } from '../test-world';
import { codeHighlightKey } from './code-highlight';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const host = memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-1' });
const code = (id: string, text: string, language = 'js') => ({ type: 'codeBlock', attrs: { id, language }, content: [{ type: 'text', text }] });
const make = () => {
  editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    coreExtensionOptions,
    extensions: editorExtensions({ collaboration: null, env: { artifactId: 'doc1', host, renderDiagram: async () => '<svg></svg>' } }),
    content: doc(para('p1', 'Before.'), code('c1', 'const x = 1;'), para('p2', 'Between.'), code('c2', 'let y = 2;'), para('p3', 'After.')),
  });
  return editor;
};
const highlight = (e: Editor): DecorationSet => codeHighlightKey.getState(e.state)!;
const posOf = (e: Editor, id: string): { from: number; to: number } => {
  let found = { from: -1, to: -1 };
  e.state.doc.descendants((node, pos) => {
    if (node.attrs.id === id) found = { from: pos, to: pos + node.nodeSize };
    return found.from < 0;
  });
  return found;
};
const within = (e: Editor, id: string): Decoration[] => {
  const { from, to } = posOf(e, id);
  return highlight(e).find(from, to);
};
const tokensOf = (e: Editor, id: string): string[] => within(e, id).map((d) => e.state.doc.textBetween(d.from, d.to)).filter(Boolean);

describe('the code highlighter across edits', () => {
  it('keeps the decorations of the code blocks a keystroke elsewhere does not touch', async () => {
    const e = make();
    await until(() => within(e, 'c1').length > 1 && within(e, 'c2').length > 1, 'both blocks highlighted');
    const before = within(e, 'c2').map((d) => (d as unknown as { type: unknown }).type);
    e.commands.insertContentAt(posOf(e, 'p1').from + 1, 'X');
    const after = within(e, 'c2').map((d) => (d as unknown as { type: unknown }).type);
    expect(after).toHaveLength(before.length);
    after.forEach((type, k) => expect(type, `decoration ${k} of c2 is the one before, mapped`).toBe(before[k]));
    expect(tokensOf(e, 'c2')).toContain('let');
  });

  it('re-highlights a block typed into, at its new text', async () => {
    const e = make();
    await until(() => within(e, 'c1').length > 1, 'c1 highlighted');
    e.commands.insertContentAt(posOf(e, 'c1').from + 1, 'return ');
    await until(() => tokensOf(e, 'c1').includes('return'), 'the typed keyword highlighted');
    expect(tokensOf(e, 'c1').join('')).toContain('const x');
  });

  it('re-highlights a block whose language changed, and drops a removed block’s decorations', async () => {
    const e = make();
    await until(() => within(e, 'c2').length > 1, 'c2 highlighted');
    const { from } = posOf(e, 'c2');
    e.view.dispatch(e.state.tr.setNodeAttribute(from, 'language', 'plaintext-none'));
    expect(within(e, 'c2')).toEqual([]); // an unknown language is left plain
    const { from: c1, to } = posOf(e, 'c1');
    e.view.dispatch(e.state.tr.delete(c1, to));
    expect(highlight(e).find()).toEqual([]);
  });

  // M9's review: a code block turned into a paragraph keeps none of its token decorations.
  it('drops a block’s decorations when it stops being a code block', async () => {
    const e = make();
    await until(() => within(e, 'c1').length > 1, 'c1 highlighted');
    const { from, to } = posOf(e, 'c1');
    e.view.dispatch(e.state.tr.setBlockType(from + 1, to - 1, e.schema.nodes.paragraph, { id: 'c1' }));
    expect(e.state.doc.nodeAt(posOf(e, 'c1').from)?.type.name).toBe('paragraph');
    expect(within(e, 'c1')).toEqual([]);
  });
});
