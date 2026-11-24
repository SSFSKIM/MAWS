// The word cut in the document editor (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 2; editors.md):
// the toolbar's comment, comments, history and find controls are named glyphs (G332, G333, G335, G336), the table's
// eight commands are one Table menu (G331), a menu from the keyboard, a button whose words show draws no tooltip repeating them (G337), and the
// page's opening wait is the quiet spinner (G345). Happy-dom over the in-memory host, as the toolbar's own suite.
import type { Editor, JSONContent } from '@tiptap/core';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { accessibleDescription, accessibleText } from '../../../renderer/src/test-support/accessible-text';
import { listThreads, reply } from '../threads';
import { DocumentEditor } from './DocumentEditor';
import type { DocumentHandle } from './host-types';
import { MemoryDocumentHost, memoryEditorHost, openMemoryHandle, whenSynced } from './memory-host';
import { MemoryHistory } from './history/memory-history';
import { tableJSON } from './nodes/table';
import { World, doc, para, until } from './test-world';

let world: World | null = null;
let handle: DocumentHandle | null = null;
let history: MemoryHistory | null = null;
let bare: MemoryDocumentHost | null = null;
afterEach(() => {
  cleanup();
  handle?.close();
  handle = null;
  history?.destroy();
  history = null;
  world?.destroy();
  world = null;
  bare?.destroy();
  bare = null;
});

async function mount(content: JSONContent, withHistory = false): Promise<Editor> {
  world = new World(content);
  handle = openMemoryHandle(world.host, { log: () => {} });
  await whenSynced(handle);
  if (withHistory) history = new MemoryHistory(world.host);
  let editor: Editor | null = null;
  const host = memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-1' });
  render(<DocumentEditor artifactId="doc1" handle={handle} host={host} history={history ?? undefined} comments={{ opened: () => {}, overlay: () => null }} onEditor={(e) => (editor = e)} />);
  await until(() => editor !== null && editor.getText().length > 0, 'the editor to bind');
  return editor!;
}
const toolbar = () => screen.getByRole('toolbar', { name: 'Formatting' });
const button = (name: string | RegExp) => within(toolbar()).getByRole('button', { name });

describe('the toolbar’s glyphs (G332, G333, G335, G336)', () => {
  it('draws comment, comments, history and find as glyphs named by their words, each with its shortcut', async () => {
    await mount(doc(para('p1', 'Some text to comment on.')), true);
    for (const [name, shortcut] of [
      ['Add comment', '⌘⌥M'],
      ['Comments (0 open)', null],
      ['Version history', '⌘⌥⇧H'],
      ['Find', '⌘F'],
    ] as const) {
      const glyph = button(name);
      expect(accessibleText(glyph).trim(), `${name} draws no word`).toBe('');
      expect(glyph.querySelector('svg'), `${name} is a glyph`).not.toBeNull();
      expect(glyph.getAttribute('title'), `${name}’s tooltip is the keyboard’s too`).toBeNull();
      if (shortcut) expect(accessibleDescription(glyph), `${name}’s shortcut`).toContain(shortcut);
    }
  });

  it('keeps the open count beside the comments glyph, and the count in its name', async () => {
    const editor = await mount(doc(para('p1', 'Some text to comment on.')));
    act(() => void editor.chain().focus().setTextSelection({ from: 1, to: 5 }).run());
    act(() => fireEvent.click(button('Add comment')));
    // a thread counts once it holds a message (UX wave U5a, M7)
    const [written] = listThreads(handle!.doc);
    act(() => reply(handle!.doc, written!.id, { id: `${written!.id}:m1`, by: { kind: 'human' }, at: Date.now(), body: 'Shorter?' }));
    await until(() => within(toolbar()).queryByRole('button', { name: 'Comments (1 open)' }) !== null, 'the open count');
    expect(accessibleText(button('Comments (1 open)')).trim()).toBe('1');
  });

  it('greys Add comment with its reason, still focusable, while nothing is selected', async () => {
    await mount(doc(para('p1', 'Some text.')));
    const add = button('Add comment');
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(add.hasAttribute('disabled')).toBe(false);
    expect(accessibleDescription(add)).toContain('Select text to comment on');
  });
});

describe('the table’s commands (G331) and the worded buttons (G337)', () => {
  const inTable = async () => {
    const editor = await mount({ type: 'doc', content: [{ ...tableJSON(2, 2), attrs: { id: 'tb1' } }, { type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'After.' }] }] });
    act(() => void editor.chain().focus().setTextSelection(4).run());
    await until(() => within(toolbar()).queryByRole('button', { name: 'Table' }) !== null, 'the Table menu’s button');
    return editor;
  };
  const focused = () => document.activeElement;

  it('puts the table’s eight commands in one Table menu while the caret is in a table', async () => {
    const editor = await inTable();
    for (const name of ['Add row above', 'Add row below', 'Delete table']) expect(within(toolbar()).queryByRole('button', { name }), `${name} is not a toolbar button`).toBeNull();
    const table = button('Table');
    expect(table.getAttribute('title')).toBeNull();
    expect(table.getAttribute('aria-haspopup')).toBe('menu');
    await userEvent.click(table);
    const menu = screen.getByRole('menu', { name: 'Table' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Add row above', 'Add row below', 'Add column left', 'Add column right', 'Delete row', 'Delete column', 'Header row', 'Delete table']);
    const rows = () => editor.state.doc.firstChild!.childCount;
    expect(rows()).toBe(2);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Add row below' }));
    expect(rows()).toBe(3);
    expect(screen.queryByRole('menu', { name: 'Table' })).toBeNull();
    act(() => void editor.chain().focus().setTextSelection(editor.state.doc.content.size - 2).run());
    await until(() => within(toolbar()).queryByRole('button', { name: 'Table' }) === null, 'the Table menu gone outside the table');
  });

  it('is a menu from the keyboard: Enter opens it on its first command, ↓ moves, Enter runs one in the page, Escape gives the focus back', async () => {
    const editor = await inTable();
    const selection = editor.state.selection.from;
    // a key as the browser hands it to the focused element
    const press = (key: string) => act(() => void fireEvent.keyDown(focused()!, { key }));
    const menu = () => screen.queryByRole('menu', { name: 'Table' });
    const item = (name: string) => within(menu()!).getByRole('menuitem', { name });
    act(() => button('Table').focus());
    press('Enter');
    await until(() => menu() !== null && focused() === item('Add row above'), 'the menu open on its first command');
    press('ArrowDown');
    await until(() => focused() === item('Add row below'), 'the next command focused');
    press('Enter');
    await until(() => menu() === null, 'the menu closed by the command');
    expect(editor.state.doc.firstChild!.childCount).toBe(3);
    expect(editor.view.dom.contains(focused()), 'the command runs in the page, which keeps the focus').toBe(true);
    expect(editor.state.selection.from).toBe(selection); // the caret where it was: the row went below it

    act(() => button('Table').focus());
    press('ArrowDown');
    await until(() => menu() !== null && menu()!.contains(focused()), 'the menu open on a command');
    press('Escape');
    await until(() => menu() === null, 'the menu closed');
    expect(focused()).toBe(button('Table'));
    expect(editor.state.doc.firstChild!.childCount).toBe(3);
  });

  it('draws no tooltip on Insert, whose word shows', async () => {
    await mount(doc(para('p1', 'Text.')));
    expect(button('Insert').getAttribute('title')).toBeNull();
    expect(button('Bold').getAttribute('title')).toBe('Bold'); // a glyph keeps its word as its tooltip
  });
});

describe('the page while it opens (G345)', () => {
  it('shows the quiet spinner named by the wait, and no words', async () => {
    bare = new MemoryDocumentHost(); // a replica with no tab yet
    handle = openMemoryHandle(bare, { log: () => {} });
    await whenSynced(handle);
    const { container } = render(<DocumentEditor artifactId="doc1" handle={handle} host={memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-1' })} />);
    const wait = container.querySelector<HTMLElement>('.doc-editor-loading')!;
    expect(wait.textContent).toBe('');
    await until(() => screen.queryByRole('progressbar', { name: 'Loading…' }) !== null, 'the spinner after its quiet half second');
    expect(wait.textContent).toBe('');
  });
});
