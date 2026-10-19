// The formatting toolbar's inserts (happy-dom, DocumentEditor over a replica of an in-memory host; P3-F, sitting
// candidates 14 and 16): an atom inserted from the Insert menu keeps the keyboard in its field, wherever the keyboard was
// when the menu was used, so the next keys write the atom's content and never the page's.
import type { Editor, JSONContent } from '@tiptap/core';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { DocumentEditor } from './DocumentEditor';
import type { DocumentHandle } from './host-types';
import { memoryEditorHost, openMemoryHandle, whenSynced } from './memory-host';
import { World, doc, para, until } from './test-world';

let world: World | null = null;
let handle: DocumentHandle | null = null;
afterEach(() => {
  cleanup();
  handle?.close();
  handle = null;
  world?.destroy();
  world = null;
});

async function mount(content: JSONContent): Promise<Editor> {
  world = new World(content);
  handle = openMemoryHandle(world.host, { log: () => {} });
  await whenSynced(handle);
  let editor: Editor | null = null;
  const host = memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-1' });
  render(<DocumentEditor artifactId="doc1" handle={handle} host={host} renderDiagram={async () => '<svg></svg>'} onEditor={(e) => (editor = e)} />);
  await until(() => editor !== null && editor.getText().length > 0, 'the editor to bind');
  return editor!;
}
const frames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const atomOf = (editor: Editor, type: string): { pos: number; attrs: Record<string, unknown> } | null => {
  let found: { pos: number; attrs: Record<string, unknown> } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (!found && node.type.name === type) found = { pos, attrs: node.attrs };
    return !found;
  });
  return found;
};

// Insert › item used from the keyboard, as a person tabbing to the toolbar does: the page has no focus as it runs.
async function insertFromKeyboard(item: string): Promise<void> {
  const insert = within(screen.getByRole('toolbar', { name: 'Formatting' })).getByRole('button', { name: 'Insert' });
  insert.focus();
  act(() => void fireEvent.click(insert));
  const entry = screen.getByRole('menuitem', { name: item });
  entry.focus();
  act(() => void fireEvent.click(entry));
  await act(frames); // past the frame a deferred focus of the page would take
}

describe('an atom inserted from the Insert menu', () => {
  it.each([
    ['Math', 'math', 'LaTeX'],
    ['Equation', 'mathBlock', 'LaTeX'],
    ['Diagram', 'diagram', 'Diagram source'],
    ['Pending section', 'pending', 'Intent'],
    ['Date', 'date', 'Date'],
    ['Mention', 'mention', 'Name'],
  ])('%s keeps the keyboard in its field when the page did not have it', async (item, type, label) => {
    const editor = await mount(doc(para('p1', 'Due ')));
    act(() => void editor.commands.setTextSelection(5));
    await insertFromKeyboard(item);
    const atom = atomOf(editor, type);
    expect(atom, `${item} inserted`).not.toBeNull();
    const field = (editor.view.nodeDOM(atom!.pos) as HTMLElement).querySelector<HTMLElement>(`[aria-label="${label}"]`);
    expect(document.activeElement, `${item}’s field has the keyboard`).toBe(field);
  });

  it('takes the keys typed next, the paragraph’s text untouched', async () => {
    const editor = await mount(doc(para('p1', 'Euler: ')));
    act(() => void editor.commands.setTextSelection(8));
    await insertFromKeyboard('Math');
    await userEvent.keyboard('E=mc^2');
    expect(atomOf(editor, 'math')!.attrs.latex).toBe('E=mc^2');
    expect(editor.state.doc.child(0).textContent).toBe('Euler: ');
  });
});
