// DocumentEditor over a replica of an in-memory host (happy-dom; M3 of
// docs/doperpowers/plans/2026-10-12-p3-b-documents.md): every block kind inserted from the toolbar, edited in place and
// round-tripped through the editor's JSON and the stored tab body; tabs added, renamed, reordered and switched; find
// stepping through matches.
import type { Editor, JSONContent } from '@tiptap/core';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { DOCUMENT_LIMITS } from '@shared/maws/document-tools';
import { ynodeToPmnode } from '../../yjs/prosemirror';
import { schemaFor } from '../schema';
import { addTab, createDocument, listTabs, tabBody } from '../tabs';
import { DocumentEditor } from './DocumentEditor';
import type { DocumentHandle, EditorHost } from './host-types';
import { MemoryDocumentHost, memoryEditorHost, openMemoryHandle, whenSynced } from './memory-host';
import type { MentionSource, MentionTarget } from './MentionPicker';
import type { CommentOverlayProps, DocumentComments } from './comments/surface';
import { getThread, liveThreadIds } from '../threads';
import { MemoryHistory } from './history/memory-history';
import { TAB, World, doc, endOf, para, readOnlySwitch, until } from './test-world';

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

    act(() => fireEvent.click(screen.getByRole('button', { name: 'Tab options' })));
    act(() => fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' })));
    await until(() => screen.getAllByRole('tab').length === 49, 'a tab deleted');
    expect(screen.getByRole('button', { name: 'Add tab' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Add tab' }).getAttribute('title')).toBeNull();
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Add tab' })));
    await until(() => listTabs(handle.doc).length === 50, 'the tab added below the limit');
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
    expect(screen.getByTestId('scope').contains(page)).toBe(true);
    expect(screen.getByTestId('scope').classList.contains('ds-doc')).toBe(false); // `.ds-doc` is the page's alone
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
    // a thread to resolve, and the rail open on it
    act(() => void editor().chain().focus().setTextSelection({ from: 1, to: 9 }).run());
    press('Comment');
    press('Comments (1 open)');

    act(() => set(true));
    expect(editor().isEditable).toBe(false);
    expect(editor().view.dom.getAttribute('contenteditable')).toBe('false');
    for (const name of ['Bold', 'Insert', 'Comment']) expect(within(toolbar()).getByRole('button', { name })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Add tab' })).toHaveProperty('disabled', true);
    act(() => fireEvent.doubleClick(screen.getByRole('tab', { selected: true })));
    expect(screen.queryByLabelText('Tab title')).toBeNull();
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Tab options' })));
    for (const item of screen.getAllByRole('menuitem')) expect(item).toHaveProperty('disabled', true);
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Tab options' })));
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
    press('Comment');
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
