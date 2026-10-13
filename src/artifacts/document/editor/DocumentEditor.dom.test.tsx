// DocumentEditor over a replica of an in-memory host (happy-dom; M3 of
// docs/doperpowers/plans/2026-10-12-p3-b-documents.md): every block kind inserted from the toolbar, edited in place and
// round-tripped through the editor's JSON and the stored tab body; tabs added, renamed, reordered and switched; find
// stepping through matches.
import type { Editor, JSONContent } from '@tiptap/core';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ynodeToPmnode } from '../../yjs/prosemirror';
import { schemaFor } from '../schema';
import { listTabs, tabBody } from '../tabs';
import { DocumentEditor } from './DocumentEditor';
import type { DocumentHandle, EditorHost } from './host-types';
import { memoryEditorHost, openMemoryHandle, whenSynced } from './memory-host';
import { TAB, World, doc, endOf, para, until } from './test-world';

let world: World | null = null;
let handles: DocumentHandle[] = [];
afterEach(() => {
  cleanup();
  for (const handle of handles) handle.close();
  handles = [];
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
});

describe('tabs', () => {
  it('are added, renamed, reordered and switched, each with its own body', async () => {
    const { editor, handle } = await mount(doc(para('p1', 'First tab text')));
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Add tab' })));
    await until(() => listTabs(handle.doc).length === 2 && editor().getText() === '', 'the new tab');
    const added = listTabs(handle.doc)[1].id;
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('Tab 2');
    type(editor(), 'Second tab text');
    expect(ynodeToPmnode(tabBody(handle.doc, added)!, schemaFor()).textContent).toBe('Second tab text');

    act(() => fireEvent.doubleClick(screen.getByRole('tab', { selected: true })));
    act(() => fireEvent.change(screen.getByLabelText('Tab title'), { target: { value: 'Appendix' } }));
    act(() => fireEvent.keyDown(screen.getByLabelText('Tab title'), { key: 'Enter' }));
    expect(listTabs(handle.doc).map((t) => t.title)).toEqual(['Main', 'Appendix']);

    act(() => fireEvent.click(screen.getByRole('button', { name: 'Tab options' })));
    act(() => fireEvent.click(screen.getByRole('menuitem', { name: 'Move left' })));
    expect(listTabs(handle.doc).map((t) => t.title)).toEqual(['Appendix', 'Main']);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Appendix', 'Main']);

    act(() => fireEvent.click(screen.getByRole('tab', { name: 'Main' })));
    await until(() => editor().getText() === 'First tab text', 'the first tab’s body');
    expect(endOf(editor(), 'p1')).toBeGreaterThan(0);
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
    expect(screen.getByTestId('scope').contains(page)).toBe(true);
    expect(screen.getByTestId('scope').classList.contains('ds-doc')).toBe(false); // `.ds-doc` is the page's alone
    expect(document.querySelector('.ds-doc-page')!.parentElement).toBe(page);
    expect(pages.at(-1)).toBe(page);
    unmount();
    expect(pages.at(-1)).toBeNull();
  });
});
