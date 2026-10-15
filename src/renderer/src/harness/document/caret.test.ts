// The harness's caret placement: the e2e cases send keyboard input as soon as it resolves, so it resolves only once
// the editor's DOM holds the focus and the collapsed DOM selection at the asked position (Tiptap's own `focus()` defers
// the DOM focus to an animation frame, and keys sent before it go to whatever had the focus).
import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { coreExtensionOptions } from '@artifacts/document/ids';
import { extensions } from '@artifacts/document/schema';
import { placeCaret } from './caret';

let editor: Editor;
let elsewhere: HTMLInputElement;
let frames: FrameRequestCallback[];

beforeEach(() => {
  frames = [];
  // Frames run only when the test says so, as under a busy renderer.
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  elsewhere = document.body.appendChild(document.createElement('input'));
  elsewhere.focus();
  const element = document.body.appendChild(document.createElement('div'));
  editor = new Editor({
    element,
    coreExtensionOptions,
    extensions: extensions(),
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { id: 'para0001' }, content: [{ type: 'text', text: 'The owner types here.' }] },
        { type: 'paragraph', attrs: { id: 'para0002' }, content: [{ type: 'text', text: 'The river runs north.' }] },
      ],
    },
  });
});
afterEach(() => {
  const element = editor.view.dom.parentElement;
  editor.destroy();
  element?.remove();
  elsewhere.remove();
  vi.unstubAllGlobals();
});

const caretPosition = () => {
  const selection = document.getSelection();
  if (!selection?.isCollapsed || !selection.focusNode || !editor.view.dom.contains(selection.focusNode)) return null;
  return editor.view.posAtDOM(selection.focusNode, selection.focusOffset);
};

it('resolves with the DOM focus and the collapsed DOM caret in the editor, though no frame has run', async () => {
  const end = 1 + 'The owner types here.'.length;
  await placeCaret(editor, end);
  expect(editor.view.dom.contains(document.activeElement)).toBe(true);
  expect(caretPosition()).toBe(end);
  expect(editor.state.selection.empty && editor.state.selection.head).toBe(end);
});

it('waits for a focus that arrives late', async () => {
  const focus = editor.view.focus.bind(editor.view);
  vi.spyOn(editor.view, 'focus').mockImplementation(() => void setTimeout(focus, 30));
  const placed = placeCaret(editor, 3);
  expect(document.activeElement).toBe(elsewhere);
  await placed;
  expect(editor.view.dom.contains(document.activeElement)).toBe(true);
  expect(caretPosition()).toBe(3);
});

it('fails within its bound when the editor never takes the focus', async () => {
  vi.spyOn(editor.view, 'focus').mockImplementation(() => {});
  await expect(placeCaret(editor, 3, { withinMs: 50 })).rejects.toThrow(/never took the focus/);
  expect(document.activeElement).toBe(elsewhere);
});
