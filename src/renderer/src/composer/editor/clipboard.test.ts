import { generateHTML, generateJSON, getSchema } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { docOf, mentionNode, paragraph, pastedNode, textNode } from './doc';
import { handlesPlainText, plainTextSlice } from './clipboard';
import { schemaExtensions } from './schema';
import { serializeDraft } from './serialize';

const schema = getSchema(schemaExtensions());
const ctx = { sessionId: 's', cwd: '/' };

function pasteInto(text: string, before: string, after: string): string {
  const doc = schema.nodeFromJSON(docOf([paragraph(...(before + after ? [textNode(before + after)] : []))]));
  let state = EditorState.create({ schema, doc });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1 + before.length)));
  state = state.apply(state.tr.replaceSelection(plainTextSlice(schema, text)));
  return serializeDraft(state.doc.toJSON(), ctx).display;
}

describe('a short plain-text paste goes in line for line', () => {
  it('keeps blank lines, one paragraph per line', () => {
    expect(pasteInto('a\n\nb', '', '')).toBe('a\n\nb');
    expect(pasteInto('a\r\n\r\n\r\nb\n', '', '')).toBe('a\n\n\nb');
  });

  it('joins the first and last lines to the text around the caret', () => {
    expect(pasteInto('a\n\nb', 'x', 'y')).toBe('xa\n\nby');
    expect(pasteInto('one line', 'x', 'y')).toBe('xone liney');
  });

  it('leaves ProseMirror its own copied slices', () => {
    expect(handlesPlainText({ html: '' })).toBe(true);
    expect(handlesPlainText({ html: '<p>from a web page</p>' })).toBe(true);
    expect(handlesPlainText({ html: '<p data-pm-slice="1 1 []">copied in the editor</p>' })).toBe(false);
  });
});

describe('a copied chip pastes back whole', () => {
  it('carries every atom and mention attribute through the HTML ProseMirror copies', () => {
    const doc = docOf([
      paragraph(
        textNode('see '),
        pastedNode({ id: 'p1', kind: 'text', name: 'Pasted text #1', lines: 3, text: 'a\n<b>\n"c"' }),
        pastedNode({ id: 'p2', kind: 'image', name: 'Image #2', lines: 0, text: null }),
        mentionNode({ id: 'docs/a b.md', label: 'docs/a b.md', kind: 'file' }),
        mentionNode({ id: 'Explore', label: 'Explore', kind: 'agent' }),
      ),
    ]);
    const back = generateJSON(generateHTML(doc, schemaExtensions()), schemaExtensions());
    expect(back.content).toEqual(doc.content);
    expect(serializeDraft(back, ctx)).toEqual(serializeDraft(doc, ctx));
  });
});
