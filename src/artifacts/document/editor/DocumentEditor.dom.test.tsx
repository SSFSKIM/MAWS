// DocumentEditor over a replica of an in-memory host (happy-dom; M3 of
// docs/doperpowers/plans/2026-10-12-p3-b-documents.md): every block kind inserted from the toolbar, edited in place and
// round-tripped through the editor's JSON and the stored tab body; tabs added, renamed, reordered and switched; find
// stepping through matches.
import type { Editor, JSONContent } from '@tiptap/core';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOCUMENT_LIMITS } from '@shared/maws/document-tools';
import { ynodeToPmnode } from '../../yjs/prosemirror';
import { importMarkdown } from '../import/markdown';
import { schemaFor } from '../schema';
import { addTab, createDocument, listTabs, tabBody } from '../tabs';
import { DocumentEditor, type DocumentReveal } from './DocumentEditor';
import type { DocumentHandle, EditorHost } from './host-types';
import { MemoryDocumentHost, memoryEditorHost, openMemoryHandle, whenSynced } from './memory-host';
import type { MentionSource, MentionTarget } from './MentionPicker';
import type { CommentOverlayProps, DocumentComments } from './comments/surface';
import { getThread, liveThreadIds } from '../threads';
import { MemoryHistory } from './history/memory-history';
import { TextSelection } from '@tiptap/pm/state'; // P4-B4 at the B1 merge
import { activeThread, commentSelection } from './comments/plugins'; // P4-B4 at the B1 merge
import { now, owner as ownerActor, select } from './comments/test-support'; // P4-B4 at the B1 merge
import { TAB, World, doc, endOf, para, readOnlySwitch, ticks, until } from './test-world';

let world: World | null = null;
let handles: DocumentHandle[] = [];
let history: MemoryHistory | null = null;
afterEach(() => {
  cleanup();
  for (const handle of handles) handle.close();
  handles = [];
  history?.destroy();
  history = null;
  world?.destroy();
  world = null;
});

const owner = memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-2' });

async function mount(content: JSONContent, host: EditorHost = owner): Promise<{ editor: () => Editor; handle: DocumentHandle }> {
  world = new World(content);
  const handle = openMemoryHandle(world.host, { log: () => {} });
  handles.push(handle);
  await whenSynced(handle);
  let current: Editor | null = null;
  render(<DocumentEditor artifactId="doc1" handle={handle} host={host} renderDiagram={async (source) => `<svg data-source="${source.length}"></svg>`} onEditor={(e) => (current = e)} />);
  await until(() => current !== null && current.getText().length > 0, 'the editor to bind');
  return { editor: () => current!, handle };
}

const toolbar = () => screen.getByRole('toolbar', { name: 'Formatting' });
const press = (name: string) => act(() => fireEvent.click(within(toolbar()).getByRole('button', { name })));
const insert = (item: string) => {
  press('Insert');
  act(() => fireEvent.click(screen.getByRole('menuitem', { name: item })));
};
const style = (value: string) => act(() => fireEvent.change(within(toolbar()).getByRole('combobox', { name: 'Block style' }), { target: { value } }));
// The caret at the end of a new empty paragraph after everything, as a person clicking below the last block.
function freshLine(editor: Editor): void {
  act(() => {
    editor.chain().focus().insertContentAt(editor.state.doc.content.size, { type: 'paragraph' }).run();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  });
}
const type = (editor: Editor, text: string) => act(() => void editor.commands.insertContent(text));
const enter = (editor: Editor) => act(() => void editor.commands.keyboardShortcut('Enter'));
const types = (editor: Editor) => {
  const out: string[] = [];
  editor.state.doc.forEach((node) => out.push(node.type.name));
  return out;
};
// A tab's own context menu opened by a right-click on it, and one of its items chosen.
async function fromTabMenu(tab: string, item: string): Promise<void> {
  act(() => void fireEvent.contextMenu(screen.getByRole('tab', { name: tab })));
  const entry = await screen.findByRole('menuitem', { name: item });
  act(() => void fireEvent.click(entry));
}
// A tab dragged onto another as a person drags one, a single DataTransfer from dragstart to dragend; answers whether the
// drop was accepted.
function drag(from: Element, to: Element): boolean {
  const carried = new Map<string, string>();
  const dataTransfer = { setData: (format: string, value: string) => void carried.set(format, value), getData: (format: string) => carried.get(format) ?? '', effectAllowed: 'uninitialized', dropEffect: 'none' };
  fireEvent.dragStart(from, { dataTransfer });
  fireEvent.dragOver(to, { dataTransfer });
  const accepted = !fireEvent.drop(to, { dataTransfer });
  fireEvent.dragEnd(from, { dataTransfer });
  return accepted;
}
// the field shown, the selected atom's (each atom of a kind has one, hidden until it is selected)
const field = (label: string) => screen.getAllByLabelText(label).find((el) => !el.closest('[hidden]')) as HTMLInputElement | HTMLTextAreaElement;
// through the native value setter, as typing sets it (React tracks a value assigned directly as its own)
const fill = (label: string, value: string) => act(() => void fireEvent.input(field(label), { target: { value } }));

describe('the toolbar', () => {
  it('inserts every block kind, edits each in place, and round-trips them through the editor and the stored body', async () => {
    const { editor, handle } = await mount(doc(para('p1', 'Start')));

    freshLine(editor());
    style('h2');
    type(editor(), 'A heading');
    for (const [button, text] of [
      ['Bulleted list', 'bullet'],
      ['Numbered list', 'number'],
      ['Checklist', 'task'],
    ] as const) {
      freshLine(editor());
      press(button);
      type(editor(), `${text} one`);
      enter(editor()); // a list item added
      type(editor(), `${text} two`);
    }
    freshLine(editor());
    press('Quote');
    type(editor(), 'Quoted');
    freshLine(editor());
    press('Code block');
    type(editor(), 'const x = 1;');

    freshLine(editor());
    insert('Table');
    type(editor(), 'cell one'); // the first cell
    act(() => void editor().commands.goToNextCell());
    type(editor(), 'cell two');
    press('Add row below');

    freshLine(editor());
    insert('Divider');
    freshLine(editor());
    insert('Callout');
    type(editor(), 'Careful');
    act(() => fireEvent.change(screen.getByLabelText('Callout tone'), { target: { value: 'danger' } }));

    freshLine(editor());
    insert('Math');
    fill('LaTeX', 'x^2');
    freshLine(editor());
    insert('Equation');
    fill('LaTeX', 'a^2+b^2=c^2');
    freshLine(editor());
    insert('Diagram');
    fill('Diagram source', 'graph TD; A-->B');
    freshLine(editor());
    insert('Pending section');
    fill('Intent', 'Results');

    freshLine(editor());
    insert('Date');
    fill('Date', '2026-12-24');
    freshLine(editor());
    insert('Mention');
    fill('Name', 'Ada');
    freshLine(editor());
    insert('Status');
    act(() => fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'Done' } }));

    freshLine(editor());
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'chart.png', { type: 'image/png' });
    insert('Image…');
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Image file'), { target: { files: [file] } });
      await until(() => JSON.stringify(editor().getJSON()).includes('"image"'), 'the uploaded image');
    });

    const kinds = types(editor());
    for (const kind of ['heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock', 'table', 'horizontalRule', 'callout', 'mathBlock', 'diagram', 'pending']) expect(kinds).toContain(kind);
    const json: JSONContent = editor().getJSON();
    const text = JSON.stringify(json);
    expect(text).toContain('"level":2');
    for (const list of ['bullet', 'number', 'task']) expect(text).toMatch(new RegExp(`${list} one.*${list} two`));
    const rows = json.content!.find((n) => n.type === 'table')!.content!;
    expect(rows).toHaveLength(4); // a row added below the header row
    for (const cell of rows[1].content!) expect(cell.content).toEqual([{ type: 'paragraph', attrs: { id: expect.stringMatching(/^[0-9a-z]{8}$/) } }]); // typeable
    expect(text).toMatch(/cell one.*cell two/);
    expect(json.content!.find((n) => n.type === 'callout')!.attrs!.tone).toBe('danger');
    expect(text).toContain('"latex":"x^2"');
    expect(text).toContain('"latex":"a^2+b^2=c^2"');
    expect(text).toContain('"source":"graph TD; A-->B"');
    expect(text).toContain('"intent":"Results"');
    expect(text).toContain('"iso":"2026-12-24"');
    expect(text).toContain('"label":"Ada"');
    expect(text).toMatch(/"type":"dropdown","attrs":\{"options":\[[^\]]*\],"value":"Done"\}/);
    expect(text).toMatch(/"type":"image","attrs":\{"src":"maws-artifact:asset\d+\/chart.png","alt":"chart.png","assetId":"asset\d+"\}/);

    // every block carries an id, and the stored body is exactly what the editor shows
    editor().state.doc.forEach((node) => expect(node.attrs.id).toMatch(/^[0-9a-z]{8}$|^p1$/));
    expect(ynodeToPmnode(tabBody(handle.doc, TAB)!, schemaFor()).toJSON()).toEqual(json);
    await until(() => JSON.stringify(ynodeToPmnode(tabBody(world!.host.doc, TAB)!, schemaFor()).toJSON()) === JSON.stringify(json), 'the host to hold it');
  });

  it('shows a failed image upload in the toolbar and inserts nothing', async () => {
    // a rejection the toolbar left unhandled would fail this run as an unhandled error
    const failing: EditorHost = { ...owner, uploadAsset: () => Promise.reject(new Error('The disk is full')) };
    const { editor } = await mount(doc(para('p1', 'Start')), failing);
    const before = JSON.stringify(editor().getJSON());
    insert('Image…');
    act(() => void fireEvent.change(screen.getByLabelText('Image file'), { target: { files: [new File([new Uint8Array([137, 80, 78, 71])], 'chart.png', { type: 'image/png' })] } }));
    const alert = await within(toolbar()).findByRole('alert');
    expect(alert.textContent).toContain('chart.png');
    expect(alert.textContent).toContain('The disk is full');
    expect(JSON.stringify(editor().getJSON())).toBe(before);
    press('Dismiss upload error');
    expect(within(toolbar()).queryByRole('alert')).toBeNull();
  });

  it('applies the marks and a link', async () => {
    const { editor } = await mount(doc(para('p1', 'one two three')));
    act(() => void editor().commands.setTextSelection({ from: 1, to: 4 }));
    for (const mark of ['Bold', 'Italic', 'Underline', 'Strikethrough', 'Highlight']) press(mark);
    act(() => void editor().commands.setTextSelection({ from: 5, to: 8 }));
    press('Inline code');
    act(() => void editor().commands.setTextSelection({ from: 9, to: 14 }));
    press('Link');
    fill('Link address', 'https://example.com/a');
    act(() => fireEvent.submit(screen.getByLabelText('Link address').closest('form')!));
    const [one, , two, , three] = editor().getJSON().content![0].content!;
    expect(one.marks!.map((m) => m.type).sort()).toEqual(['bold', 'highlight', 'italic', 'strike', 'underline']);
    expect(two.marks).toEqual([{ type: 'code' }]);
    expect(three.marks).toEqual([{ type: 'link', attrs: { href: 'https://example.com/a', title: null } }]);
  });

  // P3-F panel scalpel-3#4: the Insert menu closes on Escape (the keyboard back on Insert when it was in the menu) and on
  // a press outside it, not only on an item or on Insert again
  it('closes the Insert menu on Escape and on a press outside it, inserting nothing', async () => {
    const { editor } = await mount(doc(para('p1', 'Start')));
    const before = JSON.stringify(editor().getJSON());
    const menu = () => screen.queryByRole('menu');
    const insertButton = () => within(toolbar()).getByRole('button', { name: 'Insert' });
    // opened by a click, the caret stays in the page (the toolbar keeps the selection): Escape there closes it
    press('Insert');
    expect(menu()).not.toBeNull();
    act(() => void fireEvent.keyDown(editor().view.dom, { key: 'Escape' }));
    expect(menu(), 'the menu after Escape in the page').toBeNull();
    // the keyboard inside the menu: Escape closes it and puts the keyboard back on Insert
    press('Insert');
    const item = screen.getByRole('menuitem', { name: 'Table' });
    act(() => item.focus());
    act(() => void fireEvent.keyDown(item, { key: 'Escape' }));
    expect(menu(), 'the menu after Escape in the menu').toBeNull();
    expect(document.activeElement).toBe(insertButton());
    // a press on Insert itself leaves the toggle to its click; a press in the page closes the menu
    press('Insert');
    act(() => void fireEvent.pointerDown(insertButton()));
    expect(menu()).not.toBeNull();
    act(() => void fireEvent.pointerDown(editor().view.dom));
    expect(menu(), 'the menu after a press in the page').toBeNull();
    expect(JSON.stringify(editor().getJSON())).toBe(before);
  });
});

// P3-F (sitting candidate 17): Tab from a table's last cell adds a row and takes the caret into its first cell, where the
// next typing lands. The new row's cells are empty (`block*`) until the cell fill's paragraph, so prosemirror-tables'
// text selection had nowhere to stand in them and fell back into the cell left, after its date chip. An empty cell
// already in the table (an agent's, an import's) is entered the same way.
describe('Tab in a table', () => {
  // every block with its id, as the writer stores an agent's table; Tab pressed as the page gets it (`keyboardShortcut`
  // replays the steps of what the key dispatched, not its selection)
  let n = 0;
  const cell = (content: JSONContent[]): JSONContent => ({ type: 'tableCell', attrs: { id: `cell000${++n}` }, content });
  const line = (id: string, ...content: JSONContent[]): JSONContent => ({ type: 'paragraph', attrs: { id }, content });
  const table = (...rows: JSONContent[][]): JSONContent => ({ type: 'table', attrs: { id: 'table001' }, content: rows.map((cells, i) => ({ type: 'tableRow', attrs: { id: `row0000${i}` }, content: cells })) });
  const rows = (editor: Editor): string[][] => {
    const out: string[][] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'tableRow') out.push(Array.from({ length: node.childCount }, (_, i) => node.child(i).textContent));
      return node.type.name !== 'tableRow';
    });
    return out;
  };

  it('from the last cell, ending in a date chip, adds a row and puts the caret in its first cell, where typing lands', async () => {
    const chip = line('c2', { type: 'text', text: 'Due ' }, { type: 'date', attrs: { iso: '2026-10-12' } });
    const { editor } = await mount(doc(para('p1', 'Before'), table([cell([line('c1', { type: 'text', text: 'Owner' })]), cell([chip])]), para('p2', 'After')));
    const [[, due]] = rows(editor());
    act(() => void editor().chain().focus().setTextSelection(endOf(editor(), 'c2')).run());
    act(() => void fireEvent.keyDown(editor().view.dom, { key: 'Tab' }));
    type(editor(), 'Reviewer');
    expect(rows(editor())).toEqual([
      ['Owner', due],
      ['Reviewer', ''],
    ]);
  });

  it('enters an empty cell already in the table, where typing lands', async () => {
    const { editor } = await mount(doc(para('p1', 'Before'), table([cell([line('c1', { type: 'text', text: 'Owner' })]), cell([])]), para('p2', 'After')));
    act(() => void editor().chain().focus().setTextSelection(endOf(editor(), 'c1')).run());
    act(() => void fireEvent.keyDown(editor().view.dom, { key: 'Tab' }));
    type(editor(), 'Reviewer');
    expect(rows(editor())).toEqual([['Owner', 'Reviewer']]);
  });

  // the review of c17: a ragged table (rows of unequal length, as an agent's `:::table` may store it until a local edit
  // repairs it) leaves empty slots in its table map, which read as position 0; Shift-Tab from its first cell has no cell
  // before it, and selected the whole first row
  it('does nothing on Shift-Tab from a ragged table’s first cell, where typing stays', async () => {
    const text = (value: string): JSONContent => ({ type: 'text', text: value });
    const ragged = table([cell([line('a1', text('A1'))]), cell([line('b1', text('B1'))])], [cell([line('a2', text('A2'))])]);
    const { editor } = await mount(doc(para('p1', 'Before'), ragged, para('p2', 'After')));
    const at = endOf(editor(), 'a1');
    act(() => void editor().chain().focus().setTextSelection(at).run());
    act(() => void fireEvent.keyDown(editor().view.dom, { key: 'Tab', shiftKey: true }));
    expect(editor().state.selection.toJSON()).toEqual({ type: 'text', anchor: at, head: at });
    type(editor(), 'x');
    expect(rows(editor())[0]).toEqual(['A1x', 'B1']);
  });
});

// P3-F (F1, the owner's N.3: "링크는 안열리고 cmd+click에도 컴포넌트가 선택됨"): ⌘-click (Ctrl-click off a Mac) on a link
// opens its href through the host's external opener (main's scheme-checked one in the app) and is consumed there, so the
// press neither moves the caret nor selects a node (ProseMirror's own modifier-click selected the whole paragraph). A
// plain click is the page's, the caret placed as anywhere else. In every editor of the document (the read-only one too).
describe('a link', () => {
  const linked = doc({
    type: 'paragraph',
    attrs: { id: 'p1' },
    content: [{ type: 'text', text: 'Read ' }, { type: 'text', text: 'the brief', marks: [{ type: 'link', attrs: { href: 'https://example.com/brief', title: null } }] }, { type: 'text', text: ' first.' }],
  });
  // a press on `target` as the page gets it, ProseMirror's handlers first (happy-dom has no layout to place a caret). The
  // click is read where it reaches the document and prevented there: an anchor's click left to the page navigates
  // happy-dom, a live request to the link's host.
  const clickWith = (target: Element, init: MouseEventInit, withPress = true) => {
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...init });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
    let clicked: boolean | null = null;
    const atDocument = (event: Event) => {
      clicked = event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener('click', atDocument);
    try {
      if (withPress) act(() => void target.dispatchEvent(down));
      act(() => void target.dispatchEvent(click));
    } finally {
      document.removeEventListener('click', atDocument);
    }
    return { press: down.defaultPrevented, click: clicked };
  };
  const anchor = (editor: Editor) => editor.view.dom.querySelector('a[href]')!;
  // the platform the page reports (happy-dom's reads its user agent): the modifier is ⌘ on a Mac, Ctrl elsewhere
  const onPlatform = (value: string) => Object.defineProperty(navigator, 'platform', { value, configurable: true });
  afterEach(() => void delete (navigator as { platform?: string }).platform);

  it('opens through the host on ⌘-click on a Mac and on Ctrl-click elsewhere, moving no caret and selecting nothing', async () => {
    const openExternal = vi.fn();
    const { editor } = await mount(linked, { ...owner, openExternal });
    act(() => void editor().commands.setTextSelection(2));
    for (const [platform, modifier] of [
      ['MacIntel', { metaKey: true }],
      ['Win32', { ctrlKey: true }],
    ] as const) {
      onPlatform(platform);
      expect(clickWith(anchor(editor()), modifier), platform).toEqual({ press: true, click: true });
      expect(editor().state.selection.toJSON()).toEqual({ type: 'text', anchor: 2, head: 2 });
    }
    expect(openExternal.mock.calls).toEqual([['https://example.com/brief'], ['https://example.com/brief']]);
  });

  // the review of F1: on a Mac Ctrl-click is the secondary click (Electron's Chromium sends mousedown, contextmenu and
  // mouseup, no click), so taking its press only swallowed a context-menu gesture; ⌘ elsewhere is no link gesture either
  it('takes no Ctrl-click on a Mac and no ⌘-click elsewhere', async () => {
    const openExternal = vi.fn();
    const { editor } = await mount(linked, { ...owner, openExternal });
    for (const [platform, modifier] of [
      ['MacIntel', { ctrlKey: true }],
      ['Win32', { metaKey: true }],
    ] as const) {
      onPlatform(platform);
      expect(clickWith(anchor(editor()), modifier), platform).toEqual({ press: false, click: false });
    }
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('leaves a plain click to the page, opening nothing', async () => {
    const openExternal = vi.fn();
    const { editor } = await mount(linked, { ...owner, openExternal });
    expect(clickWith(anchor(editor()), {}, false)).toEqual({ press: false, click: false });
    const pos = editor().state.doc.textContent.indexOf('brief') + 1;
    const handled = editor().view.someProp('handleClick', (handle) => handle(editor().view, pos, new MouseEvent('click', { button: 0 })));
    expect(handled ?? false, 'a plain click taken from the page').toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('opens on ⌘-click in a read-only document too', async () => {
    world = new World(linked);
    const opened = openMemoryHandle(world.host, { log: () => {} });
    handles.push(opened);
    await whenSynced(opened);
    const { handle, set } = readOnlySwitch(opened);
    set(true);
    const openExternal = vi.fn();
    let current: Editor | null = null;
    render(<DocumentEditor artifactId="doc1" handle={handle} host={{ ...owner, openExternal }} onEditor={(e) => (current = e)} />);
    await until(() => current !== null && current.getText().length > 0, 'the editor to bind');
    onPlatform('MacIntel');
    expect(clickWith(anchor(current!), { metaKey: true })).toEqual({ press: true, click: true });
    expect(openExternal.mock.calls).toEqual([['https://example.com/brief']]);
  });
});

describe('tabs', () => {
  it('earns a section strip only after Insert creates a second section, and removes it when one remains', async () => {
    const { editor, handle } = await mount(doc(para('p1', 'First section text')));
    expect(screen.queryByRole('tablist', { name: 'Tabs' })).toBeNull();
    insert('New section');
    await until(() => listTabs(handle.doc).length === 2 && editor().getText() === '', 'the new section to bind');
    expect(screen.getByRole('tablist', { name: 'Tabs' })).toBeTruthy();
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('Tab 2');
    const focusedText: string[] = [];
    const focused = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && event.target.matches('.ProseMirror[data-editor="live"]')) focusedText.push(event.target.textContent ?? '');
    };
    document.addEventListener('focusin', focused);
    try {
      act(() => fireEvent.click(screen.getByLabelText('Delete Tab 2')));
      await until(() => listTabs(handle.doc).length === 1 && editor().getText() === 'First section text' && editor().view.hasFocus(), 'the original section to bind and take focus');
      expect(screen.queryByRole('tablist', { name: 'Tabs' })).toBeNull();
      expect(focusedText, 'the remaining page is ready when it receives focus').toEqual(['First section text']);
      act(() => void editor().commands.setTextSelection(endOf(editor(), 'p1')));
      type(editor(), '!');
      expect(editor().getText()).toBe('First section text!');
      expect(ynodeToPmnode(tabBody(handle.doc, TAB)!, schemaFor()).textContent).toBe('First section text!');
    } finally {
      document.removeEventListener('focusin', focused);
    }
  });

  it('are added, renamed, reordered and switched, each with its own body', async () => {
    const { editor, handle } = await mount(doc(para('p1', 'First tab text')));
    insert('New section');
    await until(() => listTabs(handle.doc).length === 2 && editor().getText() === '', 'the new tab');
    const added = listTabs(handle.doc)[1].id;
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('Tab 2');
    type(editor(), 'Second tab text');
    expect(ynodeToPmnode(tabBody(handle.doc, added)!, schemaFor()).textContent).toBe('Second tab text');

    act(() => fireEvent.doubleClick(screen.getByRole('tab', { selected: true })));
    act(() => fireEvent.change(screen.getByLabelText('Tab title'), { target: { value: 'Appendix' } }));
    act(() => fireEvent.keyDown(screen.getByLabelText('Tab title'), { key: 'Enter' }));
    expect(listTabs(handle.doc).map((t) => t.title)).toEqual(['Main', 'Appendix']);

    await fromTabMenu('Appendix', 'Move left');
    expect(listTabs(handle.doc).map((t) => t.title)).toEqual(['Appendix', 'Main']);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Appendix', 'Main']);

    act(() => fireEvent.click(screen.getByRole('tab', { name: 'Main' })));
    await until(() => editor().getText() === 'First tab text', 'the first tab’s body');
    expect(endOf(editor(), 'p1')).toBeGreaterThan(0);
  });

  // P3-F W-DOC-B (tracker L155): the guide's 50-tab limit is refused in the editor too, the reason named on the control
  it('refuses Add tab at the document’s limit with the limit named, adds nothing on a click, and adds again below it', async () => {
    const { handle } = await mount(doc(para('p1', 'First tab text')));
    act(() => {
      for (let n = 2; n <= DOCUMENT_LIMITS.tabs; n++) addTab(handle.doc, { title: `Tab ${n}` });
    });
    await until(() => screen.getAllByRole('tab').length === 50, 'fifty tabs');
    const add = screen.getByRole('button', { name: 'Add tab' });
    expect(add).toHaveProperty('disabled', true);
    expect(add.getAttribute('title')).toBe('A document holds at most 50 tabs');
    act(() => fireEvent.click(add));
    expect(listTabs(handle.doc)).toHaveLength(50);

    act(() => fireEvent.click(screen.getByLabelText('Delete Tab 50') /* shown on hover */));
    await until(() => screen.getAllByRole('tab').length === 49, 'a tab deleted');
    expect(screen.getByRole('button', { name: 'Add tab' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Add tab' }).getAttribute('title')).toBeNull();
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Add tab' })));
    await until(() => listTabs(handle.doc).length === 50, 'the tab added below the limit');
  });

  // P3-F panel scalpel-2#2: a tab dragged from another document's strip (or deleted mid-drag) is no tab of this one; its
  // drop is not accepted and throws nothing, and a drop of one of this document's tabs still moves it
  it('ignore a dropped tab that is not one of this document’s, and move one that is', async () => {
    const { handle } = await mount(doc(para('p1', 'First tab text')));
    act(() => void addTab(handle.doc, { title: 'Second', id: 'tab00002' }));
    await until(() => screen.getAllByRole('tab').length === 2, 'two tabs');
    const carrying = (id: string) => ({ dataTransfer: { getData: (type: string) => (type === 'application/x-maws-document-tab' ? id : '') } });
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      event.preventDefault();
      errors.push(event.error);
    };
    window.addEventListener('error', onError);
    try {
      let accepted = false;
      act(() => void (accepted = !fireEvent.drop(screen.getByRole('tab', { name: 'Main' }), carrying('elsewhere'))));
      expect(accepted, 'a foreign tab’s drop accepted').toBe(false);
      expect(errors).toEqual([]);
      expect(listTabs(handle.doc).map((t) => t.title)).toEqual(['Main', 'Second']);
      drag(screen.getByRole('tab', { name: 'Second' }), screen.getByRole('tab', { name: 'Main' }));
      expect(listTabs(handle.doc).map((t) => t.title)).toEqual(['Second', 'Main']);
    } finally {
      window.removeEventListener('error', onError);
    }
  });

  // P3-F (tracker S-DOC-TAB-DRAG-SOURCE): a copy (Duplicate, Make a copy) holds every tab id of its source, so a drop
  // that only looked the dragged id up in its own tabs reordered the copy's same-id tab. The drag names its document.
  it('refuse a tab dragged from a copy of the document, whose tab ids are the same, and move one dragged within it', async () => {
    const { handle } = await mount(doc(para('p1', 'First tab text')));
    const copy = new World(doc(para('p1', 'First tab text')));
    const copied = openMemoryHandle(copy.host, { log: () => {} });
    try {
      await whenSynced(copied);
      for (const d of [handle.doc, copied.doc]) act(() => void addTab(d, { title: 'Second', id: 'tab00002' }));
      render(<DocumentEditor artifactId="doc2" handle={copied} host={owner} />);
      await until(() => screen.getAllByRole('tab').length === 4, 'both strips with two tabs');
      const [source, target] = screen.getAllByRole('tablist', { name: 'Tabs' }) as [HTMLElement, HTMLElement];
      let accepted = true;
      act(() => void (accepted = drag(within(source).getByRole('tab', { name: 'Second' }), within(target).getByRole('tab', { name: 'Main' }))));
      expect(accepted, 'the drop from the source document accepted').toBe(false);
      expect(listTabs(copied.doc).map((t) => t.title)).toEqual(['Main', 'Second']);
      expect(listTabs(handle.doc).map((t) => t.title)).toEqual(['Main', 'Second']);
      drag(within(target).getByRole('tab', { name: 'Second' }), within(target).getByRole('tab', { name: 'Main' }));
      expect(listTabs(copied.doc).map((t) => t.title)).toEqual(['Second', 'Main']);
      expect(listTabs(handle.doc).map((t) => t.title)).toEqual(['Main', 'Second']);
    } finally {
      cleanup();
      copied.close();
      copy.destroy();
    }
  });

  // P3-F (the owner's observation 3, the architect's ruling (a)): the browser's pattern. Each tab has its own context
  // menu, acting on the tab right-clicked (the menu's actions used to act on the active tab), and an inline ×, Delete;
  // the last tab has none and its menu's Delete is off; a tab with content is deleted only once the owner confirms.
  it('act on the right-clicked tab, not the active one: Move left, Rename and Delete from its menu', async () => {
    const { handle } = await mount(doc(para('p1', 'First tab text')));
    act(() => {
      addTab(handle.doc, { title: 'Bravo', id: 'tab00002' });
      addTab(handle.doc, { title: 'Charlie', id: 'tab00003' });
    });
    await until(() => screen.getAllByRole('tab').length === 3, 'three tabs');
    const selected = () => screen.getByRole('tab', { selected: true }).getAttribute('aria-label');
    expect(selected()).toBe('Main');

    await fromTabMenu('Charlie', 'Move left');
    expect(listTabs(handle.doc).map((t) => t.title)).toEqual(['Main', 'Charlie', 'Bravo']);
    expect(selected()).toBe('Main');

    await fromTabMenu('Bravo', 'Rename');
    await ticks(3); // the menu's focus return, which must not end the rename it started
    act(() => fireEvent.change(screen.getByLabelText('Tab title'), { target: { value: 'Beta' } }));
    act(() => fireEvent.keyDown(screen.getByLabelText('Tab title'), { key: 'Enter' }));
    expect(listTabs(handle.doc).map((t) => t.title)).toEqual(['Main', 'Charlie', 'Beta']);

    await fromTabMenu('Charlie', 'Delete');
    await until(() => listTabs(handle.doc).length === 2, 'Charlie deleted');
    expect(listTabs(handle.doc).map((t) => t.title)).toEqual(['Main', 'Beta']);
    expect(selected()).toBe('Main');
    expect(screen.queryByRole('alertdialog')).toBeNull(); // an empty tab goes without asking
  });

  it('delete with ×, which the last tab lacks, asking first when the tab has content', async () => {
    const { editor, handle } = await mount(doc(para('p1', 'First tab text')));
    expect(screen.queryByLabelText('Delete Main'), 'a × on the last tab').toBeNull();
    expect(screen.queryByRole('tablist', { name: 'Tabs' })).toBeNull();

    act(() => void addTab(handle.doc, { title: 'Empty', id: 'tab00002' }));
    await until(() => screen.getAllByRole('tab').length === 2, 'two tabs');
    act(() => fireEvent.click(screen.getByLabelText('Delete Empty') /* shown on hover */));
    await until(() => listTabs(handle.doc).length === 1, 'the empty tab deleted');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('tablist', { name: 'Tabs' })).toBeNull();

    act(() => void addTab(handle.doc, { title: 'Second', id: 'tab00003' }));
    await until(() => screen.getAllByRole('tab').length === 2, 'two tabs again');
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Delete Main' })));
    const ask = await screen.findByRole('alertdialog');
    expect(ask.textContent).toContain('Main');
    act(() => fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' })));
    await until(() => screen.queryByRole('alertdialog') === null, 'the question gone');
    expect(listTabs(handle.doc).map((t) => t.title)).toEqual(['Main', 'Second']);

    act(() => fireEvent.click(screen.getByRole('button', { name: 'Delete Main' })));
    act(() => fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete tab' })));
    await until(() => listTabs(handle.doc).length === 1, 'Main deleted once confirmed');
    expect(listTabs(handle.doc).map((t) => t.title)).toEqual(['Second']);
    expect(screen.queryByRole('tablist', { name: 'Tabs' })).toBeNull();
    await until(() => editor().getText() === '', 'the remaining tab’s body shown');
    expect(screen.queryByLabelText('Delete Second'), 'a × on the last tab').toBeNull();
  });

  // P4 W1-B (tracker L300): a Mac has no context-menu key and the × is outside the tab order, so a focused tab takes the
  // menu's actions from the keyboard: F2 renames, Delete or ⌫ deletes (the same question and last-tab guard), ⌥⇧← and
  // ⌥⇧→ move it, Shift+F10 opens its menu; the focus stays on the tab acted on, or after a deletion its neighbour's
  it('take rename, delete and move from the keyboard on the focused tab, and open its menu', async () => {
    const { handle, editor } = await mount(doc(para('p1', 'First tab text')));
    act(() => {
      addTab(handle.doc, { title: 'Bravo', id: 'tab00002' });
      addTab(handle.doc, { title: 'Charlie', id: 'tab00003' });
    });
    await until(() => screen.getAllByRole('tab').length === 3, 'three tabs');
    const tab = (name: string) => screen.getByRole('tab', { name });
    const key = (name: string, init: KeyboardEventInit) => {
      act(() => tab(name).focus());
      act(() => void fireEvent.keyDown(tab(name), init));
    };
    const titles = () => listTabs(handle.doc).map((t) => t.title);
    const focused = () => document.activeElement?.getAttribute('aria-label');

    key('Bravo', { key: 'F2' });
    act(() => fireEvent.change(screen.getByLabelText('Tab title'), { target: { value: 'Beta' } }));
    act(() => fireEvent.keyDown(screen.getByLabelText('Tab title'), { key: 'Enter' }));
    expect(titles()).toEqual(['Main', 'Beta', 'Charlie']);
    await until(() => focused() === 'Beta', 'the focus back on the renamed tab');

    key('Charlie', { key: 'ArrowLeft', altKey: true, shiftKey: true });
    expect(titles()).toEqual(['Main', 'Charlie', 'Beta']);
    await until(() => focused() === 'Charlie', 'the focus on the moved tab');
    key('Main', { key: 'ArrowLeft', altKey: true, shiftKey: true }); // already first
    key('Main', { key: 'ArrowRight', altKey: true, shiftKey: true });
    expect(titles()).toEqual(['Charlie', 'Main', 'Beta']);
    key('Charlie', { key: 'ArrowRight', shiftKey: true }); // not the chord
    expect(titles()).toEqual(['Charlie', 'Main', 'Beta']);

    key('Charlie', { key: 'F10', shiftKey: true });
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Rename', 'Move left', 'Move right', 'Delete']);
    act(() => void fireEvent.keyDown(menu, { key: 'Escape' }));
    await until(() => screen.queryByRole('menu') === null, 'the menu closed');

    key('Charlie', { key: 'Backspace' }); // empty: no question
    await until(() => titles().length === 2, 'Charlie deleted');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await until(() => focused() === 'Main', 'the focus on its neighbour');

    key('Main', { key: 'Delete' }); // the tab with content asks first
    const asked = await screen.findByRole('alertdialog');
    act(() => fireEvent.click(within(asked).getByRole('button', { name: 'Cancel' })));
    await until(() => screen.queryByRole('alertdialog') === null && focused() === 'Main', 'the focus back on the tab kept');
    expect(titles()).toEqual(['Main', 'Beta']);
    key('Main', { key: 'Delete' });
    const ask = await screen.findByRole('alertdialog');
    act(() => fireEvent.click(within(ask).getByRole('button', { name: 'Delete tab' })));
    await until(() => titles().length === 1, 'Main deleted once confirmed');
    expect(titles()).toEqual(['Beta']);
    await until(() => editor().view.hasFocus(), 'the focus in the remaining section after its strip disappears');
    expect(screen.queryByRole('tablist', { name: 'Tabs' })).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(titles()).toEqual(['Beta']);
  });

  // P4 W1-B review (tracker L300): the menu Shift+F10 opens leaves the focus as the keys do; its own focus return goes to
  // the tab it opened on, which Rename replaces with the title field and Delete takes away
  it('leave the focus as the keys do after Rename, Move and Delete from the menu the keyboard opened', async () => {
    const { handle, editor } = await mount(doc(para('p1', 'First tab text')));
    act(() => {
      addTab(handle.doc, { title: 'Bravo', id: 'tab00002' });
      addTab(handle.doc, { title: 'Charlie', id: 'tab00003' });
    });
    await until(() => screen.getAllByRole('tab').length === 3, 'three tabs');
    const titles = () => listTabs(handle.doc).map((t) => t.title);
    const focused = () => document.activeElement?.getAttribute('aria-label');
    const fromMenu = async (name: string, item: string) => {
      const tab = screen.getByRole('tab', { name });
      act(() => tab.focus());
      act(() => void fireEvent.keyDown(tab, { key: 'F10', shiftKey: true }));
      const entry = within(await screen.findByRole('menu')).getByRole('menuitem', { name: item });
      act(() => entry.focus());
      act(() => void fireEvent.keyDown(entry, { key: 'Enter' }));
      await until(() => screen.queryByRole('menu') === null, 'the menu closed');
      await ticks(3); // the menu's focus return
    };

    await fromMenu('Bravo', 'Rename');
    act(() => fireEvent.change(screen.getByLabelText('Tab title'), { target: { value: 'Beta' } }));
    act(() => fireEvent.keyDown(screen.getByLabelText('Tab title'), { key: 'Enter' }));
    expect(titles()).toEqual(['Main', 'Beta', 'Charlie']);
    await until(() => focused() === 'Beta', 'the focus back on the renamed tab');

    await fromMenu('Charlie', 'Move left');
    expect(titles()).toEqual(['Main', 'Charlie', 'Beta']);
    await until(() => focused() === 'Charlie', 'the focus on the tab moved left');
    await fromMenu('Charlie', 'Move right');
    expect(titles()).toEqual(['Main', 'Beta', 'Charlie']);
    await until(() => focused() === 'Charlie', 'the focus on the tab moved right');

    await fromMenu('Beta', 'Delete'); // empty: no question
    await until(() => titles().length === 2, 'Beta deleted');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await until(() => focused() === 'Charlie', 'the focus on its neighbour');

    await fromMenu('Main', 'Delete'); // the tab with content asks first
    const asked = await screen.findByRole('alertdialog');
    act(() => fireEvent.click(within(asked).getByRole('button', { name: 'Cancel' })));
    await until(() => screen.queryByRole('alertdialog') === null && focused() === 'Main', 'the focus back on the tab kept');
    await fromMenu('Main', 'Delete');
    const ask = await screen.findByRole('alertdialog');
    await until(() => document.activeElement === within(ask).getByRole('button', { name: 'Cancel' }), 'the focus in the question');
    act(() => fireEvent.click(within(ask).getByRole('button', { name: 'Delete tab' })));
    await until(() => titles().length === 1, 'Main deleted once confirmed');
    expect(titles()).toEqual(['Charlie']);
    await until(() => editor().view.hasFocus(), 'the focus in the remaining section after its strip disappears');
    expect(screen.queryByRole('tablist', { name: 'Tabs' })).toBeNull();
  });
});

describe('find', () => {
  it('opens on Mod-F, counts and steps to the second match, and closes on Escape', async () => {
    const { editor } = await mount(doc(para('p1', 'alpha beta'), para('p2', 'beta gamma')));
    act(() => void editor().commands.setTextSelection(1)); // matches count from the caret
    act(() => void fireEvent.keyDown(editor().view.dom, { key: 'f', metaKey: true }));
    const input = screen.getByRole('searchbox', { name: 'Find in document' });
    act(() => fireEvent.change(input, { target: { value: 'beta' } }));
    expect(screen.getByRole('status').textContent).toContain('1 of 2');
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Next match' })));
    expect(screen.getByRole('status').textContent).toContain('2 of 2');
    const { from } = editor().state.selection;
    expect(editor().state.doc.resolve(from).parent.attrs.id).toBe('p2');
    act(() => fireEvent.keyDown(input, { key: 'Escape' }));
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(editor().view.dom.querySelectorAll('.find-match')).toHaveLength(0);
  });

  const findCount = () => within(screen.getByRole('search')).getByRole('status').textContent;

  // P3-F panel scalpel-1#2 (X26): the keys of an IME composition are the IME's; its commit Enter does not step and its
  // Escape (a cancelled composition) does not close the bar
  it('neither steps nor closes on a key of an IME composition', async () => {
    const { editor } = await mount(doc(para('p1', '알파 베타'), para('p2', '베타 감마')));
    act(() => void editor().commands.setTextSelection(1));
    act(() => void fireEvent.keyDown(editor().view.dom, { key: 'f', metaKey: true }));
    const input = screen.getByRole('searchbox', { name: 'Find in document' });
    act(() => fireEvent.change(input, { target: { value: '베' } }));
    act(() => fireEvent.change(input, { target: { value: '베타' } }));
    expect(findCount()).toBe('1 of 2');
    act(() => void fireEvent.keyDown(input, { key: 'Enter', isComposing: true }));
    expect(findCount(), 'after the composition’s commit Enter').toBe('1 of 2');
    act(() => void fireEvent.keyDown(input, { key: 'Escape', isComposing: true }));
    expect(screen.queryByRole('searchbox'), 'the bar after the composition’s Escape').not.toBeNull();
    act(() => void fireEvent.keyDown(input, { key: 'Enter' }));
    expect(findCount()).toBe('2 of 2');
  });

  // P3-F panel scalpel-2#1: Mod-F with the bar already open puts the keyboard back in its field, the query selected
  it('takes the keyboard back to the open field on a second Mod-F, the query selected', async () => {
    const { editor } = await mount(doc(para('p1', 'alpha beta'), para('p2', 'beta gamma')));
    act(() => void fireEvent.keyDown(editor().view.dom, { key: 'f', metaKey: true }));
    const input = screen.getByRole('searchbox', { name: 'Find in document' }) as HTMLInputElement;
    act(() => fireEvent.change(input, { target: { value: 'beta' } }));
    act(() => input.blur()); // the keyboard went back to the page
    expect(document.activeElement).not.toBe(input);
    act(() => void fireEvent.keyDown(editor().view.dom, { key: 'f', metaKey: true }));
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);
  });

  // P3-F panel sweep#1: the bar's query goes with it to the editor shown, a version opened from History and the live
  // document again, matched there at once (the preview has its own editor, M9)
  it('keeps finding its query in the editor shown: a version from History, then the live document', async () => {
    world = new World(doc(para('p1', 'alpha beta'), para('p2', 'beta gamma')));
    history = new MemoryHistory(world.host);
    history.version('named', { kind: 'human' }, { label: 'Before' });
    const handle = openMemoryHandle(world.host, { log: () => {} });
    handles.push(handle);
    await whenSynced(handle);
    let current: Editor | null = null;
    render(<DocumentEditor artifactId="doc1" handle={handle} host={owner} history={history} onEditor={(e) => (current = e)} />);
    await until(() => current !== null && current.getText().length > 0, 'the editor to bind');
    const live = current!;
    act(() => void live.commands.setTextSelection(1));
    act(() => void fireEvent.keyDown(live.view.dom, { key: 'f', metaKey: true }));
    act(() => fireEvent.change(screen.getByRole('searchbox', { name: 'Find in document' }), { target: { value: 'beta' } }));
    expect(findCount()).toBe('1 of 2');

    act(() => void fireEvent.click(within(toolbar()).getByRole('button', { name: 'Version history' })));
    const rail = () => screen.getByRole('complementary', { name: 'Version history' });
    await until(() => screen.queryByRole('complementary', { name: 'Version history' }) !== null && within(rail()).queryAllByRole('button', { name: /^Version Before/ }).length > 0, 'the version list');
    act(() => void fireEvent.click(within(rail()).getByRole('button', { name: /^Version Before/ })));
    const preview = () => (document.querySelector('.ProseMirror[data-editor="preview"]') as unknown as { editor?: Editor } | null)?.editor ?? null;
    await until(() => screen.queryByRole('toolbar', { name: 'Version preview' }) !== null && preview() !== null && preview()!.getText().includes('gamma'), 'the version shown');
    expect(findCount(), 'the count in the version').toBe('1 of 2');
    expect(preview()!.view.dom.querySelectorAll('.find-match')).toHaveLength(2);

    act(() => void fireEvent.click(within(screen.getByRole('toolbar', { name: 'Version preview' })).getByRole('button', { name: 'Back to document' })));
    await until(() => screen.queryByRole('toolbar', { name: 'Formatting' }) !== null && preview() === null, 'the live document');
    expect(findCount(), 'the count in the live document again').toBe('1 of 2');
    expect(live.view.dom.querySelectorAll('.find-match')).toHaveLength(2);
  });
});

// M8: the shell wraps the page in the governing design system's scope (D's DesignSystemScope, `.ds-doc` on the page
// alone, Decision Log 22) and registers the page as a Mark-up surface (G's `useRegionMarkupSurface`).
describe('the page for the shell', () => {
  it('is drawn inside the scope the shell gives, and reported as it appears and goes', async () => {
    world = new World(doc(para('p1', 'one')));
    const handle = openMemoryHandle(world.host, { log: () => {} });
    handles.push(handle);
    await whenSynced(handle);
    const pages: Array<HTMLElement | null> = [];
    const Scope = ({ children }: { children: ReactNode }) => <div data-testid="scope">{children}</div>;
    const { unmount } = render(<DocumentEditor artifactId="doc1" handle={handle} host={owner} pageScope={Scope} onPage={(element) => pages.push(element)} />);
    await until(() => document.querySelector('.ds-doc .ProseMirror')?.textContent === 'one', 'the page');
    const page = document.querySelector<HTMLElement>('.ds-doc')!;
    const pageScope = page.closest('[data-testid="scope"]');
    expect(pageScope).not.toBeNull(); // the toolbar sample may have its own scope too
    expect(pageScope!.classList.contains('ds-doc')).toBe(false); // `.ds-doc` is the page's alone
    expect(document.querySelector('.ds-doc-page')!.parentElement).toBe(page);
    expect(pages.at(-1)).toBe(page);
    unmount();
    expect(pages.at(-1)).toBeNull();
  });
});

// M8 (Decision Log 25): with a source of people, sessions and artifacts (the shell's, over L's library reads), Insert ›
// Mention opens a picker; what is picked is the chip, its kind, its ref and its label.
describe('the mention picker', () => {
  const targets: MentionTarget[] = [
    { kind: 'person', ref: 'human', label: 'Owner' },
    { kind: 'session', ref: 'app-1', label: 'Fix the build', detail: 'Session' },
    { kind: 'artifact', ref: '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e', label: 'Launch plan', detail: 'Document' },
  ];
  const source = (): MentionSource & { queries: string[] } => {
    const queries: string[] = [];
    return { queries, search: async (query) => (queries.push(query), targets.filter((t) => t.label.toLowerCase().includes(query.toLowerCase()))) };
  };

  async function mountWith(mentions: MentionSource) {
    world = new World(doc(para('p1', 'See ')));
    const handle = openMemoryHandle(world.host, { log: () => {} });
    handles.push(handle);
    await whenSynced(handle);
    let current: Editor | null = null;
    render(<DocumentEditor artifactId="doc1" handle={handle} host={owner} mentions={mentions} onEditor={(e) => (current = e)} />);
    await until(() => current !== null && current.getText().length > 0, 'the editor to bind');
    act(() => void current!.commands.setTextSelection(endOf(current!, 'p1')));
    return () => current!;
  }
  const results = () => within(screen.getByRole('listbox', { name: 'Mention results' }));
  const mentionAttrs = (editor: Editor) => {
    let attrs: unknown = null;
    editor.state.doc.descendants((node) => void (node.type.name === 'mention' && (attrs = node.attrs)));
    return attrs;
  };

  it('searches as the owner types and inserts the artifact picked with Enter', async () => {
    const mentions = source();
    const editor = await mountWith(mentions);
    insert('Mention');
    const field = screen.getByRole('combobox', { name: 'Mention' });
    await until(() => results().queryAllByRole('option').length === 3, 'the first results');
    act(() => void fireEvent.change(field, { target: { value: 'laun' } }));
    await until(() => results().queryAllByRole('option').length === 1, 'the narrowed results');
    expect(mentions.queries.at(-1)).toBe('laun');
    expect(results().getByRole('option', { name: /Launch plan/ }).getAttribute('aria-selected')).toBe('true');
    act(() => void fireEvent.keyDown(field, { key: 'Enter' }));
    expect(screen.queryByRole('combobox', { name: 'Mention' })).toBeNull();
    expect(mentionAttrs(editor())).toMatchObject({ kind: 'artifact', ref: '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e', label: 'Launch plan' });
    expect(editor().view.dom.textContent).toContain('See @Launch plan');
  });

  it('moves with the arrows, picks a session by click, and leaves nothing on Escape', async () => {
    const editor = await mountWith(source());
    insert('Mention');
    const field = screen.getByRole('combobox', { name: 'Mention' });
    await until(() => results().queryAllByRole('option').length === 3, 'the results');
    act(() => void fireEvent.keyDown(field, { key: 'ArrowDown' }));
    expect(results().getByRole('option', { name: /Fix the build/ }).getAttribute('aria-selected')).toBe('true');
    act(() => void fireEvent.keyDown(field, { key: 'Escape' }));
    expect(screen.queryByRole('combobox', { name: 'Mention' })).toBeNull();
    expect(mentionAttrs(editor())).toBeNull();
    insert('Mention');
    await until(() => results().queryAllByRole('option').length === 3, 'the results again');
    act(() => void fireEvent.click(results().getByRole('option', { name: /Fix the build/ })));
    expect(mentionAttrs(editor())).toMatchObject({ kind: 'session', ref: 'app-1', label: 'Fix the build' });
  });

  // P3-F panel scalpel-1#1 (X26): the Hangul IME's commit Enter is the composition's, and an Enter picks only from the
  // results of the query in the field: composed on to 김민수 while 김민's results still show, nothing is inserted until
  // 김민수's arrive
  it('inserts nothing on a composing Enter, nor from results of an older query', async () => {
    const people: MentionTarget[] = [
      { kind: 'person', ref: 'p-minji', label: '김민지' },
      { kind: 'person', ref: 'p-minsu', label: '김민수' },
    ];
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const editor = await mountWith({
      search: async (query) => {
        if (query === '김민수') await held;
        return people.filter((p) => p.label.includes(query));
      },
    });
    insert('Mention');
    const field = screen.getByRole('combobox', { name: 'Mention' });
    act(() => void fireEvent.change(field, { target: { value: '김민' } }));
    await until(() => results().queryAllByRole('option').length === 2, 'the results for 김민');
    act(() => void fireEvent.change(field, { target: { value: '김민수' } })); // the composition goes on; its search is out
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150)); // past the search's quiet window
    });
    act(() => void fireEvent.keyDown(field, { key: 'Enter', isComposing: true })); // the IME's commit Enter
    expect(mentionAttrs(editor()), 'a mention on the composing Enter').toBeNull();
    act(() => void fireEvent.keyDown(field, { key: 'Enter' })); // the Enter after it, 김민's results still shown
    expect(mentionAttrs(editor()), 'a mention from the older query’s results').toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Mention' })).not.toBeNull();
    await act(async () => release());
    await until(() => results().queryAllByRole('option').length === 1, 'the results for 김민수');
    act(() => void fireEvent.keyDown(field, { key: 'Enter' }));
    expect(mentionAttrs(editor())).toMatchObject({ kind: 'person', ref: 'p-minsu', label: '김민수' });
  });
});

// M8 fix wave 1: a new document's first tab is the host's; two editors open on the empty document wait for it, both bind
// that one body, and what each types lands in it.
// P4 W1-B (tracker L286; sitting candidate 8): an agent's note, made from markdown, is shown and stored from its first
// sentence: an editor bound to it, before its create or after, writes no block before it. The trailing node (an empty
// paragraph after a closing table, the mirror's last `&#160;`) is the editor's and stays.
describe('a document made from markdown', () => {
  const NOTE = 'This note follows the P3 sitting.\n\n## Next steps\n\n- [ ] Book the room\n\n| Owner | Due date |\n| --- | --- |\n| Kim | Friday |';
  it.each(['made, then opened', 'opened, then made'])('starts with its content, %s', async (order) => {
    const host = new MemoryDocumentHost();
    const made = () => host.write((d) => void createDocument(d, { title: 'P3 sitting note', id: 'tab00001', body: importMarkdown(NOTE) }), { kind: 'session', appSessionId: '00000000-0000-4000-8000-0000000000a1' as never });
    try {
      if (order === 'made, then opened') made();
      const handle = openMemoryHandle(host, { log: () => {} });
      handles.push(handle);
      await whenSynced(handle);
      let editor: Editor | null = null;
      render(<DocumentEditor artifactId="doc1" handle={handle} host={owner} onEditor={(e) => (editor = e)} />);
      if (order === 'opened, then made') made();
      await until(() => editor !== null && editor.getText().length > 0, 'the editor bound');
      const stored = () => {
        const out: string[] = [];
        ynodeToPmnode(tabBody(host.doc, 'tab00001')!, schemaFor()).forEach((block) => out.push(`${block.type.name}:${block.textContent}`));
        return out;
      };
      await until(() => stored().length === 5, 'the trailing node at the host');
      expect(stored()).toEqual(['paragraph:This note follows the P3 sitting.', 'heading:Next steps', 'taskList:Book the room', 'table:OwnerDue dateKimFriday', 'paragraph:']);
      expect(editor!.state.doc.firstChild!.textContent).toBe('This note follows the P3 sitting.');
    } finally {
      cleanup();
      host.destroy();
    }
  });
});

describe('an empty document', () => {
  it('shows Loading… in every editor until the host’s first tab, then both bind it and both typings land', async () => {
    const host = new MemoryDocumentHost();
    try {
      const editors: Array<Editor | null> = [null, null];
      for (const i of [0, 1]) {
        const handle = openMemoryHandle(host, { log: () => {} });
        handles.push(handle);
        await whenSynced(handle);
        render(<DocumentEditor artifactId="doc1" handle={handle} host={owner} onEditor={(e) => (editors[i] = e)} />);
      }
      expect(screen.getAllByRole('status').filter((s) => s.textContent === 'Loading…')).toHaveLength(2);
      host.write((d) => createDocument(d, { title: 'Draft', id: 'tab00001' }));
      await until(() => editors.every((e) => e !== null && !e.isDestroyed), 'both editors bound');
      await act(async () => {
        editors[0]!.commands.insertContentAt(1, 'Alpha ');
        editors[1]!.commands.insertContentAt(1, 'Beta ');
      });
      const live = () => ynodeToPmnode(tabBody(host.doc, 'tab00001')!, schemaFor()).textContent;
      await until(() => live().includes('Alpha') && live().includes('Beta'), 'both typings at the host');
      await until(() => editors.every((e) => e!.getText().includes('Alpha') && e!.getText().includes('Beta')), 'both typings in both editors');
      expect(listTabs(host.doc)).toHaveLength(1);
    } finally {
      cleanup();
      host.destroy();
    }
  });
});

// The whole-branch review's P2: a store a newer MAWS wrote is read-only (the handle's state says so, and says it again
// after a reconnect), and the editor follows it: the page and every control that writes the document are off, and
// back on when the store is writable again.
describe('a read-only document', () => {
  it('follows the handle’s read-only state: the page, the toolbar, the tabs and the comments rail', async () => {
    world = new World(doc(para('p1', 'Original text')));
    const opened = openMemoryHandle(world.host, { log: () => {} });
    handles.push(opened);
    await whenSynced(opened);
    const { handle, set } = readOnlySwitch(opened);
    const comments: DocumentComments = { opened: () => {}, overlay: () => null };
    let current: Editor | null = null;
    render(<DocumentEditor artifactId="doc1" handle={handle} host={owner} comments={comments} onEditor={(e) => (current = e)} />);
    await until(() => current !== null && current.getText().length > 0, 'the editor to bind');
    const editor = () => current!;
    act(() => void addTab(handle.doc, { title: 'Appendix', id: 'tab00002' }));
    await until(() => screen.queryAllByRole('tab').length === 2, 'two sections for the read-only strip checks');
    // a thread to resolve, and the rail open on it
    act(() => void editor().chain().focus().setTextSelection({ from: 1, to: 9 }).run());
    press('Add comment');
    // The thread is written before its passage mark; the live-target count follows after the document settles.
    await until(() => within(toolbar()).queryByRole('button', { name: 'Comments (1 open)' }) !== null, 'the live-target comment count');
    press('Comments (1 open)');

    act(() => set(true));
    expect(editor().isEditable).toBe(false);
    expect(editor().view.dom.getAttribute('contenteditable')).toBe('false');
    for (const name of ['Bold', 'Insert', 'Add comment']) expect(within(toolbar()).getByRole('button', { name })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Add tab' })).toHaveProperty('disabled', true);
    act(() => fireEvent.doubleClick(screen.getByRole('tab', { selected: true })));
    expect(screen.queryByLabelText('Tab title')).toBeNull();
    act(() => void fireEvent.contextMenu(screen.getByRole('tab', { selected: true })));
    const items = within(await screen.findByRole('menu')).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Rename', 'Move left', 'Move right', 'Delete']);
    for (const item of items) expect(item.hasAttribute('data-disabled'), item.textContent ?? '').toBe(true);
    act(() => void fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' }));
    await until(() => screen.queryByRole('menu') === null, 'the menu closed');
    const rail = screen.getByRole('complementary', { name: 'Comments' });
    expect(within(rail).getByRole('button', { name: 'Resolve' })).toHaveProperty('disabled', true);
    expect(within(rail).queryByLabelText('Reply')).toBeNull();

    act(() => set(false));
    expect(editor().isEditable).toBe(true);
    expect(within(toolbar()).getByRole('button', { name: 'Bold' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Add tab' })).toHaveProperty('disabled', false);
    expect(within(rail).getByRole('button', { name: 'Resolve' })).toHaveProperty('disabled', false);
    expect(within(rail).getByLabelText('Reply')).toBeTruthy();
  });

  it('opens read-only on a handle that already is', async () => {
    world = new World(doc(para('p1', 'Original text')));
    const opened = openMemoryHandle(world.host, { log: () => {} });
    handles.push(opened);
    await whenSynced(opened);
    const { handle, set } = readOnlySwitch(opened);
    set(true);
    let current: Editor | null = null;
    render(<DocumentEditor artifactId="doc1" handle={handle} host={owner} onEditor={(e) => (current = e)} />);
    await until(() => current !== null && current.getText().length > 0, 'the editor to bind');
    expect(current!.isEditable).toBe(false);
    expect(within(toolbar()).getByRole('button', { name: 'Bold' })).toHaveProperty('disabled', true);
  });
});

// The re-review's P2: a control drawn before the store turned read-only writes nothing after it did. Each case holds the
// control it opened while writable and uses it after the flip: the popover is gone, and the retained element writes
// nothing (an upload in flight inserts nothing either).
describe('a control drawn before the store turned read-only', () => {
  async function mountSwitchable(host: EditorHost = owner, comments?: DocumentComments) {
    world = new World(doc(para('p1', 'Original text')));
    const opened = openMemoryHandle(world.host, { log: () => {} });
    handles.push(opened);
    await whenSynced(opened);
    const switched = readOnlySwitch(opened);
    let current: Editor | null = null;
    render(<DocumentEditor artifactId="doc1" handle={switched.handle} host={host} comments={comments} onEditor={(e) => (current = e)} />);
    await until(() => current !== null && current.getText().length > 0, 'the editor to bind');
    return { editor: () => current!, set: switched.set, handle: switched.handle };
  }

  it('the open link form closes, and submitting it writes no link', async () => {
    const { editor, set } = await mountSwitchable();
    act(() => void editor().chain().focus().setTextSelection({ from: 1, to: 9 }).run());
    press('Link');
    const field = screen.getByRole('textbox', { name: 'Link address' });
    act(() => void fireEvent.change(field, { target: { value: 'https://example.com' } }));
    const before = JSON.stringify(editor().getJSON());
    act(() => set(true));
    act(() => void fireEvent.submit(field.closest('form')!));
    expect(JSON.stringify(editor().getJSON())).toBe(before);
    expect(screen.queryByRole('textbox', { name: 'Link address' })).toBeNull();
  });

  it('the open Insert menu closes, and its item inserts nothing', async () => {
    const { editor, set } = await mountSwitchable();
    press('Insert');
    const item = screen.getByRole('menuitem', { name: 'Pending section' });
    const before = JSON.stringify(editor().getJSON());
    act(() => set(true));
    act(() => void fireEvent.click(item));
    expect(JSON.stringify(editor().getJSON())).toBe(before);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('an image upload that finishes after the flip inserts nothing', async () => {
    let finish!: (asset: { assetId: string; ref: string }) => void;
    const slow: EditorHost = { ...owner, uploadAsset: () => new Promise((resolve) => (finish = resolve)) };
    const { editor, set } = await mountSwitchable(slow);
    const before = JSON.stringify(editor().getJSON());
    insert('Image…');
    act(() => void fireEvent.change(screen.getByLabelText('Image file'), { target: { files: [new File([new Uint8Array([137, 80, 78, 71])], 'chart.png', { type: 'image/png' })] } }));
    await until(() => finish !== undefined, 'the upload to start');
    act(() => set(true));
    await act(async () => finish({ assetId: 'as1', ref: 'maws-artifact://doc1/as1' }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(JSON.stringify(editor().getJSON())).toBe(before);
  });

  it('the comment overlay drawn while writable writes nothing to a thread after the flip', async () => {
    let drawn: CommentOverlayProps | null = null;
    const comments: DocumentComments = { opened: () => {}, overlay: (props) => {
      drawn = props;
      return null;
    } };
    const { editor, set, handle } = await mountSwitchable(owner, comments);
    act(() => void editor().chain().focus().setTextSelection({ from: 1, to: 9 }).run());
    press('Add comment');
    const [threadId] = liveThreadIds(handle.doc);
    const kept = drawn!;
    act(() => set(true));
    act(() => {
      kept.record(threadId, 'Sent after the flip.');
      kept.resolve(threadId);
      kept.discard(threadId);
    });
    expect(getThread(handle.doc, threadId)).toMatchObject({ status: 'open', messages: [] });
  });
});

// P4-B4 (the link grammar; "Opening at a place"): a reveal asked from outside the editor (a link's fragment, show_pane's
// at) selects the block's tab, puts the caret at the block's start and scrolls it into view once that tab's editor has
// bound; a tab alone is selected; a version opens the history rail previewing it; a place the document does not have
// opens it as a plain open does. Each reveal is taken once (`onRevealed`).
describe('a reveal asked from outside', () => {
  const restores: Array<() => void> = [];
  afterEach(() => restores.splice(0).forEach((restore) => restore()));
  async function mountRevealing(first: DocumentReveal | null) {
    world = new World(doc(para('a1', 'First tab text')));
    world.host.write((d) => addTab(d, { title: 'Appendix', id: 't2', body: schemaFor().nodeFromJSON(doc(para('b1', 'Appendix opening'), para('b2', 'The answer is here'))) }));
    history = new MemoryHistory(world.host);
    history.version('named', { kind: 'human' }, { label: 'Before' });
    const handle = openMemoryHandle(world.host, { log: () => {} });
    handles.push(handle);
    await whenSynced(handle);
    let current: Editor | null = null;
    const revealed = vi.fn();
    // the elements scrolled into view, with what held the keyboard then (the owner's field: a reveal never takes it)
    const scrolled: Array<{ text: string; focus: Element | null }> = [];
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      scrolled.push({ text: this.textContent ?? '', focus: document.activeElement });
    });
    restores.push(() => scroll.mockRestore());
    const field = document.body.appendChild(document.createElement('textarea'));
    restores.push(() => field.remove());
    field.focus();
    const onEditor = (editor: Editor | null) => {
      current = editor;
    };
    const view = (reveal: DocumentReveal | null) => <DocumentEditor artifactId="doc1" handle={handle} host={owner} history={history!} reveal={reveal} onRevealed={revealed} onEditor={onEditor} />;
    const rendered = render(view(first));
    return { editor: () => current, handle, revealed, scrolled, rerender: (reveal: DocumentReveal | null) => rendered.rerender(view(reveal)) };
  }
  const selectedTab = () => screen.getByRole('tab', { selected: true }).textContent;
  const startOf = (editor: Editor, id: string) => {
    let at = -1;
    editor.state.doc.forEach((node, offset) => {
      if (node.attrs.id === id) at = offset + 1; // inside the paragraph, before its first character
    });
    return at;
  };

  it('selects a block’s tab from the block alone, the caret at its start, scrolled into view', async () => {
    const { editor, revealed, scrolled } = await mountRevealing({ serial: 1, location: { block: 'b2' } });
    await until(() => editor()?.getText().includes('The answer is here') === true && editor()!.state.selection.head === startOf(editor()!, 'b2'), 'the block revealed');
    expect(selectedTab()).toContain('Appendix');
    const field = document.querySelector('textarea');
    expect(scrolled, 'the block’s own element, the owner’s field keeping the keyboard').toContainEqual({ text: 'The answer is here', focus: field });
    expect(document.activeElement).toBe(field);
    expect(revealed).toHaveBeenCalledWith(1);
  });

  it('reveals in an editor already showing the document, and a tab alone selects that tab', async () => {
    const { editor, revealed, rerender } = await mountRevealing(null);
    await until(() => editor()?.getText() === 'First tab text', 'the first tab');
    rerender({ serial: 2, location: { tab: 't2' } });
    await until(() => editor()?.getText().startsWith('Appendix opening') === true, 'the second tab');
    expect(selectedTab()).toContain('Appendix');
    rerender({ serial: 3, location: { tab: 't2', block: 'a1' } }); // the block names its own tab
    await until(() => editor()?.getText() === 'First tab text' && editor()!.state.selection.head === startOf(editor()!, 'a1'), 'the first tab’s block');
    expect(revealed.mock.calls).toEqual([[2], [3]]);
  });

  // At the merge with P4-B1: a reveal leaves B1's active thread alone even when its block starts inside an open passage
  // (the caret lands at the block's start, where the comment mark, not inclusive, is not yet the caret's), so a link or
  // show_pane never opens a margin card by itself.
  it('puts the caret in a commented passage without activating its thread', async () => {
    const { editor, handle, rerender } = await mountRevealing(null);
    await until(() => editor()?.getText() === 'First tab text', 'the first tab');
    act(() => {
      select(editor()!, 'First tab text');
      commentSelection(editor()!, handle.doc, { threadId: 'r1', tabId: TAB, by: ownerActor, at: now(), body: 'About the first tab' });
    });
    act(() => void editor()!.commands.setActiveThread(null));
    act(() => editor()!.view.dispatch(editor()!.state.tr.setSelection(TextSelection.atEnd(editor()!.state.doc))));
    expect(activeThread(editor()!.state)).toBeNull();
    rerender({ serial: 6, location: { block: 'a1' } });
    await until(() => editor()!.state.selection.head === startOf(editor()!, 'a1'), 'the caret at the block');
    await ticks(5);
    expect(activeThread(editor()!.state)).toBeNull();
  });

  it('opens the history rail previewing a version named by its id', async () => {
    await mountRevealing({ serial: 4, location: { version: 1 } });
    await until(() => screen.queryByRole('toolbar', { name: 'Version preview' }) !== null, 'the version previewed');
    expect(screen.getByRole('complementary', { name: 'Version history' })).toBeTruthy();
  });

  it('opens a place the document does not have as a plain open: the first tab, no rail', async () => {
    const { editor, revealed } = await mountRevealing({ serial: 5, location: { block: 'gone', tab: 'nope', version: 9 } });
    await until(() => editor()?.getText() === 'First tab text', 'the first tab');
    await ticks(20);
    expect(selectedTab()).toContain('Main');
    expect(screen.queryByRole('complementary', { name: 'Version history' })).toBeNull();
    expect(revealed).toHaveBeenCalledWith(5);
  });
});
