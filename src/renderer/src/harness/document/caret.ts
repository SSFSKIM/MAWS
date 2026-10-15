// Placing the caret for the document harness's e2e cases (P3-B M3 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md).
// The cases send keys as soon as this resolves, so it resolves only once the browser would deliver them to the caret:
// Tiptap's `focus()` defers the DOM focus to an animation frame, and a key sent before it reaches whatever had the focus.
import type { Editor } from '@tiptap/core';

/** True when the editor's DOM holds the focus and the DOM selection is a caret at document position `pos`. */
function caretAt(editor: Editor, pos: number): boolean {
  const { dom } = editor.view;
  const selection = dom.ownerDocument.getSelection();
  return (
    dom.contains(dom.ownerDocument.activeElement) &&
    !!selection?.isCollapsed &&
    !!selection.focusNode &&
    dom.contains(selection.focusNode) &&
    editor.view.posAtDOM(selection.focusNode, selection.focusOffset) === pos
  );
}

/** Focuses `editor` with a collapsed caret at `pos`; rejects if the DOM does not show it within `withinMs`. */
export async function placeCaret(editor: Editor, pos: number, { withinMs = 2000 } = {}): Promise<void> {
  editor.commands.setTextSelection(pos);
  editor.view.focus(); // now, not on Tiptap's next frame; it writes the selection to the DOM too
  const deadline = Date.now() + withinMs;
  while (!caretAt(editor, pos)) {
    if (Date.now() >= deadline) throw new Error(`the editor never took the focus with its caret at ${pos}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
