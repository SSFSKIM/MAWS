// The paste dedupe beyond S5's table (happy-dom; M4 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D9): a
// drag inside the editor keeps exactly one comment whether it moves the passage or copies it (the P3-0 open item: a
// move's slice is transformed while its source is still there), and the dedupe reads the document's other tabs, so a
// copy pasted into another tab does not duplicate a comment and a cut pasted there moves it. The real-coordinate drag
// and the OS pasteboard are M9's.
import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { schemaFor } from '../../schema';
import { addTab } from '../../tabs';
import { Comments } from './plugins';
import { baseWorld, BASE_COVER, clip, covered, findPos, pasteHTML, select, states, type CommentWorld } from './test-support';

let open: CommentWorld[] = [];
afterEach(() => {
  for (const w of open) w.world.destroy();
  open = [];
});

// happy-dom's DragEvent is a plain Event: the drag's fields are set on it as a browser's would carry them.
function dragEvent(kind: 'dragstart' | 'drop', dataTransfer: DataTransfer, copy: boolean): Event {
  const event = new Event(kind, { bubbles: true, cancelable: true });
  const fields = { dataTransfer, altKey: copy, ctrlKey: copy, metaKey: false, shiftKey: false, clientX: 1, clientY: 1 }; // the copy modifier: Alt on macOS, Ctrl elsewhere
  for (const [name, value] of Object.entries(fields)) Object.defineProperty(event, name, { value });
  return event;
}

// A drag of `needle` dropped at `target`, through ProseMirror's own dragstart and drop handlers (happy-dom lays nothing
// out, so the view's coordinate lookup answers the drag's source and the drop's target).
function drag(editor: Editor, needle: string, target: () => number, { copy = false } = {}): void {
  const { view } = editor;
  const { from } = select(editor, needle);
  const data = new DataTransfer();
  const lookup = view.posAtCoords;
  try {
    view.posAtCoords = () => ({ pos: from + 1, inside: -1 });
    view.dom.dispatchEvent(dragEvent('dragstart', data, copy));
    expect(view.dragging?.move).toBe(!copy);
    const at = target();
    view.posAtCoords = () => ({ pos: at, inside: -1 });
    view.dom.dispatchEvent(dragEvent('drop', data, copy));
  } finally {
    view.posAtCoords = lookup;
  }
}

describe('a drag inside the editor', () => {
  it('moving a commented passage keeps its one comment, now on the moved text', async () => {
    const w = await baseWorld();
    open.push(w);
    drag(w.A.editor, 'keeps going', () => findPos(w.A.editor, 'Third paragraph.') + 'Third paragraph.'.length);
    await w.settle();
    expect(w.A.editor.state.doc.child(3).textContent).toBe('Third paragraph.keeps going');
    expect(covered(w.A.editor)).toEqual(BASE_COVER);
    expect(covered(w.B.editor)).toEqual(BASE_COVER);
    expect(states(w.world.host.doc)).toBe('t1:open t2:open t3:open');
  });

  it('copying it keeps the comment on the original only', async () => {
    const w = await baseWorld();
    open.push(w);
    drag(w.A.editor, 'keeps going', () => findPos(w.A.editor, 'Third paragraph.') + 'Third paragraph.'.length, { copy: true });
    await w.settle();
    expect(w.A.editor.state.doc.child(3).textContent).toBe('Third paragraph.keeps going');
    expect(w.A.editor.state.doc.child(2).textContent).toBe('Second paragraph keeps going here.');
    expect(covered(w.B.editor)).toEqual(BASE_COVER);
  });
});

describe('the dedupe across tabs', () => {
  it('strips a pasted comment whose passage lives in another tab, and moves one whose passage was cut there', async () => {
    const w = await baseWorld();
    open.push(w);
    w.world.host.write((doc) => addTab(doc, { title: 'Notes', id: 'tab2', body: schemaFor().nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'n1' }, content: [{ type: 'text', text: 'Notes here.' }] }] }) }));
    const other = await w.world.replica('c', (handle) => [Comments.configure({ doc: handle.doc, tabId: 'tab2' })], 'tab2');
    await w.settle();
    const end = () => findPos(other.editor, 'Notes here.') + 'Notes here.'.length;

    select(w.A.editor, 'keeps going');
    const copied = clip(w.A.editor, 'copy');
    other.editor.commands.setTextSelection(end());
    pasteHTML(other.editor, copied.html, copied.text);
    await w.settle();
    expect(other.editor.state.doc.textContent).toBe('Notes here.keeps going');
    expect(covered(other.editor)).toEqual({});

    select(w.A.editor, 'keeps going');
    const cut = clip(w.A.editor, 'cut');
    await w.settle();
    other.editor.commands.setTextSelection(end());
    pasteHTML(other.editor, cut.html, cut.text);
    await w.settle();
    expect(covered(other.editor)).toEqual({ t3: 'keeps going' });
    expect(covered(w.A.editor).t3).toBeUndefined();
    expect(states(w.world.host.doc)).toBe('t1:open t2:open t3:open');
  });
});
