// Go to file's field above Files' tree (UX wave U6b-3b, docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md, M1;
// decisions 5, 9 and 10, sequence S2, "The look"): ⌘P puts the keyboard in the field of the tab it lands in, when that
// field draws or at once; a key or a press before it draws keeps the keyboard where that act put it; ⌘P again selects the
// field's text; Esc empties the field, then gives the keyboard back to where ⌘P found it. A tab whose tree is folded, or
// too narrow for both, shows the tree column for the search and stores no fold.
// M2 (decisions 4 to 7 and 9, M2 decisions 2 and 3; B1, B3's second half, B8's window half): with text the list stands in
// the tree's place, a `listbox` of the files the search answered with the field naming its highlighted row, or one line
// that says why there is none; Enter opens and the file has the tab, the search ended and nothing stored. Invented paths.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import type { FilesEntry } from '@shared/ipc/schema/files';
import type { GitStatus } from '@shared/ipc/schema/git';
import { record } from '../../../../../../test/support/builders';
import { TEST_MACHINE } from '../../../../../../test/support/machine';
import { connectCodeEvents } from '../../../ipc/events';
import { runAction } from '../../../keymap/actions-runtime';
import { connectPanelHost, registerPanelTool } from '../../../panel/host';
import { useLayout } from '../../../stores/layout';
import { useSessions } from '../../../stores/sessions';
import { deferred, fail, installFakeMain, ok as answer } from '../../../test-support/code';
import { A, resetPanelStores, TestHost } from '../../../test-support/panel';
import { installResizeObserver } from '../../../test-support/resize';
import { CommandPalette, usePalette } from '../../../palette/CommandPalette';
import { FILES_COPY } from '../copy';
import { openFile, resetKeptOpens } from '../open-file';
import { useViewer } from '../viewer/viewer-store';
import { filesTool, FILES_ROW_HEIGHT } from './FilesTool';
import { connectGoToFile } from './finder';
import { RESULT_ROW_FIXED, resultsId } from './FinderView';
import { measureWith } from './path-cut';
import { useFiles } from './store';
import { FILE_WIDTH_MIN, resetTreeState, treeOf, TREE_WIDTH_DEFAULT, useTreeState } from './tree-state';

const APP = '/r/src/app.ts';
const KEY = (path: string) => `file:${TEST_MACHINE}:${path}`;
const WIDE = 700;
const NARROW = TREE_WIDTH_DEFAULT + FILE_WIDTH_MIN - 1;
const dir = (path: string): FilesEntry => ({ name: path.slice(path.lastIndexOf('/') + 1), path, kind: 'dir', size: 0, mtimeMs: 0, target: null });
const file = (path: string): FilesEntry => ({ ...dir(path), kind: 'file', size: 10 });
const REPO: Record<string, FilesEntry[]> = {
  '': [dir('/r')],
  '/r': [dir('/r/src'), file('/r/notes.md')],
  '/r/src': [file(APP)],
};
const FOLDED = { version: 1, sessions: { [A]: { width: null, folded: true, expanded: ['/r'] } } };

// What git.lsFiles answers for a query (the paths from the working folder, folders with their slash), and the files' text
// a case gives.
type Answer = ReturnType<typeof answer>;
const listed = (...paths: string[]): Answer => answer({ paths, truncated: false, source: 'git' });
const LISTING = ['src/app.ts', 'notes.md', 'src/', 'vendor/', 'vendor/harbor-lib/'];
let search: (query: string) => Answer | Promise<Answer>;
let searches: { query: string; reply: ReturnType<typeof deferred<Answer>> }[];
let contents: Record<string, string>;
let watched: GitStatus | null; // what git.watch answers for the working folder; none, not a repository
const holdSearches = () => {
  search = (query) => {
    const reply = deferred<Answer>();
    searches.push({ query, reply });
    return reply.promise;
  };
};

// The virtual list draws rows only in a scroller with a height (happy-dom lays nothing out).
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-files-scroller') ? 600 : 0;
    },
  });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));
beforeAll(() => import('../viewer/CodeView')); // the editor's chunk, loaded once before the cases that draw a file

function finderMain(stored: unknown = null) {
  return installFakeMain((name, input) => {
    if (name === 'layout.get') return answer({ value: input.key === 'files.tree' ? stored : null });
    if (name === 'layout.set' || name === 'files.watch' || name === 'files.unwatch' || name === 'git.unwatch') return answer();
    if (name === 'git.watch') return watched === null ? fail('not a git repository') : answer(watched);
    if (name === 'fs.workflows') return answer({ runs: [] });
    if (name === 'files.list') {
      const path = (input.path as string | undefined) ?? '';
      const found = REPO[path];
      return found === undefined ? fail(`not found: ${path}`) : answer({ root: path === '' ? null : '/r', path, entries: found, truncated: false });
    }
    if (name === 'git.lsFiles') return search(input.query as string);
    if (name === 'files.read') {
      const path = String(input.path);
      const content = contents[path] ?? `// ${path}\n`;
      return answer({ encoding: 'utf8', content, bytes: content.length, offset: 0, length: content.length, truncated: false, mime: 'text/plain', hash: null, utf8: null });
    }
    return fail(`unexpected ${name}`);
  });
}

// The page: a stand-in for the composer, and the side column's host (left out to stage a field that draws later).
function Page({ host = true, composer = true }: { host?: boolean; composer?: boolean }) {
  return (
    <>
      {composer ? <textarea aria-label="Composer" /> : null}
      {host ? <TestHost /> : null}
    </>
  );
}

const SET_FOLDED = useTreeState.getState().setFolded; // a case spies on it, and puts it back after
const offs: (() => void)[] = [];
let main: ReturnType<typeof finderMain>;
let observer: ReturnType<typeof installResizeObserver>;
const field = () => document.querySelector<HTMLInputElement>('[data-files-filter]');
const composer = () => screen.getByRole('textbox', { name: 'Composer' });
const filesTab = () => document.querySelector<HTMLElement>('[data-files-tab]');
const filesTabs = () => (useLayout.getState().panelBySession.get(A)?.tabs ?? []).filter((tab) => tab.toolId === 'files');
const treeColumn = () => document.querySelector<HTMLElement>('[data-files-tree]');
const toggle = () => document.querySelector<HTMLElement>('[data-files-tree-toggle]');
const finding = () => treeOf(useTreeState.getState(), A).finding;
const treeWrites = () => main.callsOf('layout.set').filter((input) => input.key === 'files.tree');
const goToFile = () => act(() => runAction('files.goToFile'));
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const type = (text: string) => fireEvent.change(field()!, { target: { value: text } });
const esc = (init: KeyboardEventInit & { keyCode?: number } = {}) => fireEvent.keyDown(field()!, { key: 'Escape', ...init });
const inField = () => waitFor(() => expect(document.activeElement).toBe(field()));
const openBeside = async (width: number) => {
  act(() => void openFile(A, APP, null, { keep: true }));
  await waitFor(() => expect(filesTab()?.getAttribute('data-file')).toBe(APP));
  observer.resize(filesTab()!, { width, height: 600 });
};

beforeEach(() => {
  search = (query) => listed(...LISTING.filter((path) => path.includes(query)));
  searches = [];
  contents = {};
  watched = null;
  resetPanelStores();
  resetKeptOpens();
  resetTreeState();
  useFiles.getState().reset();
  useViewer.getState().reset();
  observer = installResizeObserver();
  main = finderMain();
  offs.push(connectCodeEvents(), connectPanelHost(), registerPanelTool(filesTool), connectGoToFile()); // the host notes the tab last in view, which ⌘P brings back
  useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { directory: '/r' })) }));
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
  vi.unstubAllGlobals();
  resetKeptOpens();
  useTreeState.setState({ setFolded: SET_FOLDED });
  measureWith(null);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })); // no request held over into the next case
});

describe('⌘P and the field (S2)', () => {
  it('with the side column closed and the keyboard in the composer, Files opens and its field, drawn after the request, takes the keyboard', async () => {
    act(() => useLayout.getState().setPanel({ collapsed: true }));
    render(<Page />);
    composer().focus();
    expect(filesTab()).toBeNull();
    goToFile();
    expect(useLayout.getState().regions.panel.collapsed).toBe(false);
    await inField();
    expect(field()!.closest('[data-files-tree]')?.getAttribute('data-place')).toBe('alone');
  });

  it.each([
    ['a key', () => fireEvent.keyDown(composer(), { key: 'a' })],
    ['a pointer press', () => fireEvent.pointerDown(composer())],
  ])('%s between the request and the field’s drawing drops it, and the keyboard stays; with nothing between, the field takes it', async (_name, press) => {
    const view = render(<Page host={false} />);
    composer().focus();
    goToFile(); // the tab is added; no host draws it yet
    press();
    view.rerender(<Page />);
    await waitFor(() => expect(field()).not.toBeNull());
    await settle();
    expect(document.activeElement).toBe(composer());
    goToFile(); // the control: the same request, nothing pressed between
    await inField();
  });

  it('⌘P again selects the field’s text, from the field and from elsewhere', async () => {
    render(<Page />);
    composer().focus();
    goToFile();
    await inField();
    type('tide');
    field()!.setSelectionRange(4, 4);
    goToFile();
    await waitFor(() => expect([field()!.selectionStart, field()!.selectionEnd]).toEqual([0, 4]));
    expect(document.activeElement).toBe(field());
    composer().focus();
    goToFile();
    await inField();
    expect([field()!.selectionStart, field()!.selectionEnd]).toEqual([0, 4]);
  });
});

describe('Esc in the field', () => {
  it('empties the field and keeps the keyboard; again, gives it back to the element ⌘P found it in; a repeating Esc does nothing more', async () => {
    render(<Page />);
    composer().focus();
    goToFile();
    await inField();
    type('tide');
    esc();
    expect(field()!.value).toBe('');
    expect(treeOf(useTreeState.getState(), A).filter).toBe('');
    expect(document.activeElement).toBe(field());
    esc({ repeat: true }); // the key held down
    expect(document.activeElement).toBe(field());
    esc();
    expect(document.activeElement).toBe(composer());
  });

  it('gives the keyboard back to the element the first ⌘P found it in, since the field is never recorded', async () => {
    render(<Page />);
    composer().focus();
    goToFile();
    await inField();
    goToFile(); // pressed again with the keyboard in the field
    await settle();
    esc();
    expect(document.activeElement).toBe(composer());
  });

  it('chosen from the palette: Esc twice gives the keyboard back to the element the palette was opened from', async () => {
    const user = userEvent.setup();
    usePalette.setState({ open: false });
    render(<><Page /><CommandPalette /></>);
    act(() => composer().focus());
    act(() => usePalette.setState({ open: true }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy());
    await user.keyboard('Go to file');
    await user.keyboard('{Enter}');
    await inField();
    esc();
    expect(document.activeElement).toBe(composer());
  });

  it('leaves the keyboard in the field when that element has left the page; while it is in the page it gets the keyboard back', async () => {
    const view = render(<Page />);
    composer().focus();
    goToFile();
    await inField();
    esc(); // the control: the element is in the page
    expect(document.activeElement).toBe(composer());
    goToFile();
    await inField();
    view.rerender(<Page composer={false} />);
    await inField();
    esc();
    expect(document.activeElement).toBe(field());
  });

  it('does nothing while the input method composes; a plain Esc empties the field', async () => {
    render(<Page />);
    goToFile();
    await inField();
    type('tide');
    esc({ keyCode: 229 });
    esc({ isComposing: true });
    expect(field()!.value).toBe('tide');
    esc(); // the control
    expect(field()!.value).toBe('');
  });
});

describe('the field', () => {
  it('stands above the tree, outside its menu, with its roles, its words and the app’s own text-field outline; with text the list stands in the tree’s place', async () => {
    render(<Page />);
    goToFile();
    await inField();
    const input = field()!;
    expect(input.tagName).toBe('INPUT');
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-controls')).toMatch(/\S/);
    expect([input.placeholder, input.getAttribute('aria-label')]).toEqual([FILES_COPY.goToFile, FILES_COPY.goToFile]);
    expect(input.className.split(/\s+/)).toEqual(expect.arrayContaining(['h-[33px]', 'border-b', 'border-border', 'px-2', 'text-ui', 'placeholder:text-fg-muted', 'outline-accent', 'focus-visible:outline-2', '-outline-offset-2']));
    const scroller = await waitFor(() => document.querySelector('[data-files-scroller]')!);
    expect(input.compareDocumentPosition(scroller) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(scroller.contains(input)).toBe(false);
    type('src');
    const list = await waitFor(() => screen.getByRole('listbox'));
    expect(input.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('tree', { name: FILES_COPY.title })).toBeNull(); // M2: the list stands in the tree's place
  });

  it('a right-click in it opens no “Open File…”; in the tree it does', async () => {
    render(<Page />);
    goToFile();
    await inField();
    fireEvent.contextMenu(field()!);
    await settle();
    expect(screen.queryByRole('menu')).toBeNull();
    const row = await waitFor(() => document.querySelector<HTMLElement>('[role="treeitem"][data-path="/r/src"]')!);
    fireEvent.contextMenu(row); // the control
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Open File…']);
  });
});

describe('a tree folded away, or without room (decision 9; B3, M1’s half)', () => {
  it('folded by the person: ⌘P shows the column beside the file, Esc folds it again, and the fold is never written', async () => {
    main = finderMain(FOLDED);
    render(<Page />);
    await openBeside(WIDE);
    await waitFor(() => expect(useTreeState.getState().loaded).toBe(true));
    expect(treeColumn()).toBeNull();
    const setFolded = vi.fn(useTreeState.getState().setFolded);
    useTreeState.setState({ setFolded });
    composer().focus();
    goToFile();
    expect(treeColumn()?.getAttribute('data-place')).toBe('beside');
    await inField();
    esc();
    expect(document.activeElement).toBe(composer());
    expect(finding()).toBeNull();
    expect(treeColumn()).toBeNull();
    expect(treeOf(useTreeState.getState(), A).folded).toBe(true);
    expect(setFolded).not.toHaveBeenCalled();
    expect(treeWrites()).toEqual([]);
    fireEvent.click(toggle()!); // the control: the person's press outside finding is the stored fold, and it is written
    expect(setFolded).toHaveBeenCalledWith(A, false);
    await waitFor(() => expect(treeWrites()).toEqual([{ key: 'files.tree', value: { version: 1, sessions: { [A]: { width: null, folded: false, expanded: ['/r'] } } } }]));
  });

  it('folded: the tree’s button pressed while finding ends finding and hides the column, writing nothing; pressed again it writes', async () => {
    main = finderMain(FOLDED);
    render(<Page />);
    await openBeside(WIDE);
    await waitFor(() => expect(useTreeState.getState().loaded).toBe(true));
    const setFolded = vi.fn(useTreeState.getState().setFolded);
    useTreeState.setState({ setFolded });
    const user = userEvent.setup();
    goToFile();
    expect(treeColumn()?.getAttribute('data-place')).toBe('beside');
    await inField(); // the field empty, with the keyboard: a press elsewhere would end the search on its blur
    expect(toggle()!.getAttribute('aria-label')).toBe(FILES_COPY.hideTree);
    await user.click(toggle()!); // a whole click: pointerdown, mousedown and the keyboard's move, then click
    expect(finding()).toBeNull();
    expect(treeColumn()).toBeNull();
    expect(setFolded).not.toHaveBeenCalled();
    await user.click(toggle()!); // the control: the person's press, not finding, is the stored fold
    expect(setFolded).toHaveBeenCalledWith(A, false);
    expect(treeColumn()?.getAttribute('data-place')).toBe('beside');
  });

  it('not folded, with room: the button pressed while finding ends finding and folds the tree as it did', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await openBeside(WIDE);
    await waitFor(() => expect(useTreeState.getState().loaded).toBe(true));
    goToFile();
    expect(treeColumn()?.getAttribute('data-place')).toBe('beside');
    await inField();
    await user.click(toggle()!);
    expect(finding()).toBeNull();
    expect(treeColumn()).toBeNull();
    expect(treeOf(useTreeState.getState(), A).folded).toBe(true);
  });

  it('too narrow for both: ⌘P puts the column in the file’s place, the “Files” bar before the field; Esc gives the file back', async () => {
    render(<Page />);
    await openBeside(NARROW);
    expect(treeColumn()).toBeNull();
    const setFolded = vi.fn(useTreeState.getState().setFolded);
    useTreeState.setState({ setFolded });
    composer().focus();
    goToFile();
    const column = treeColumn()!;
    expect(column.getAttribute('data-place')).toBe('instead');
    await inField();
    const bar = within(column).getByText(FILES_COPY.title);
    expect(bar.compareDocumentPosition(field()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector('[data-file-viewer]')!.closest('[hidden]')).not.toBeNull();
    esc();
    expect(document.activeElement).toBe(composer());
    expect(treeColumn()).toBeNull();
    expect(document.querySelector('[data-file-viewer]')!.closest('[hidden]')).toBeNull();
    goToFile();
    expect(treeColumn()?.getAttribute('data-place')).toBe('instead');
    fireEvent.click(toggle()!); // the bar's button while finding: the file again
    expect(finding()).toBeNull();
    expect(treeColumn()).toBeNull();
    expect(setFolded).not.toHaveBeenCalled();
    expect(treeWrites()).toEqual([]);
    observer.resize(filesTab()!, { width: WIDE, height: 600 }); // the control: with room, the button outside finding folds, and it is written
    expect(treeColumn()?.getAttribute('data-place')).toBe('beside');
    fireEvent.click(toggle()!);
    expect(setFolded).toHaveBeenCalledWith(A, true);
    expect(treeColumn()).toBeNull();
    await waitFor(() => expect(treeWrites()).toHaveLength(1));
    expect(treeWrites()[0]).toMatchObject({ key: 'files.tree', value: { version: 1, sessions: { [A]: { width: null, folded: true } } } });
  });

  // The file's column is hidden and inert while the tree stands in its place, so the keyboard can go back into it only
  // once the search has ended and the file is shown (happy-dom does not refuse a focus on a hidden or inert element:
  // the case reads whether the element could take it when the focus is asked; Chromium's own refusal is the Mac scenes')
  it('too narrow: ⌘P from the tab’s own file, then Esc in the empty field, shows the file again and only then puts the keyboard back in it', async () => {
    render(<Page />);
    await openBeside(NARROW);
    const origin = await waitFor(() => {
      const text = document.querySelector<HTMLElement>('[data-file-viewer] .cm-content');
      expect(text).not.toBeNull();
      return text!;
    }, { timeout: 5000 }); // the editor's first drawing, which a loaded worker can take past the default second
    act(() => origin.focus());
    expect(document.activeElement).toBe(origin);
    const asked: boolean[] = []; // for each focus asked of the file's text: could it take the keyboard then
    const focus = HTMLElement.prototype.focus;
    vi.spyOn(origin, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      asked.push(origin.closest('[hidden], [inert]') === null);
      focus.call(this, options);
    });
    goToFile();
    expect(treeColumn()?.getAttribute('data-place')).toBe('instead');
    expect(origin.closest('[hidden]')).not.toBeNull(); // the file is out of view while the search lasts
    await inField();
    esc();
    expect(finding()).toBeNull();
    expect(treeColumn()).toBeNull();
    expect(asked).toEqual([true]);
    expect(document.activeElement).toBe(origin);
  });

  it('finding ends when the field loses the keyboard while empty; not while it holds text, nor when only the window loses it', async () => {
    render(<Page />);
    await openBeside(NARROW);
    goToFile();
    await inField();
    fireEvent.blur(field()!); // the window lost the keyboard: the field still has the page's
    expect(treeColumn()?.getAttribute('data-place')).toBe('instead');
    type('tide');
    act(() => composer().focus());
    expect(treeColumn()?.getAttribute('data-place')).toBe('instead');
    expect(finding()).not.toBeNull();
    act(() => field()!.focus());
    type('');
    act(() => composer().focus());
    expect(finding()).toBeNull();
    expect(treeColumn()).toBeNull();
  });
});

// ---- M2: the list in the tree's place -------------------------------------------------------------------------------------

const results = () => document.querySelector<HTMLElement>('[data-files-results]');
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
const shownPaths = () => options().map((option) => option.getAttribute('data-path'));
const lineOf = () => document.querySelector<HTMLElement>('[data-files-line]');
const press = (key: string, init: KeyboardEventInit & { keyCode?: number } = {}) => fireEvent.keyDown(field()!, { key, ...init });
const searched = () => main.callsOf('git.lsFiles');
const reply = (index: number, value: Answer) => act(() => searches[index].reply.resolve(value));
const listedFor = (text: string) => async (paths: string[]) => {
  type(text);
  await waitFor(() => expect(shownPaths()).toEqual(paths));
};

describe('the list (decision 4; M2 decisions 2 and 3)', () => {
  it('lists the files the search answered, no folder and no submodule among them, as the listbox the field names; ↓ and ↑ move the highlight the field names', async () => {
    render(<Page />);
    composer().focus();
    goToFile();
    await inField();
    await waitFor(() => expect(document.querySelector('[data-files-scroller]')).not.toBeNull()); // the tree's list, before the text
    await listedFor('s')(['/r/src/app.ts', '/r/notes.md']);
    expect(searched()).toEqual([{ directory: '/r', query: 's', limit: 200 }]);
    const list = results()!;
    expect(list.getAttribute('role')).toBe('listbox');
    expect(list.id).toBe(resultsId(finding()!));
    expect(field()!.getAttribute('aria-controls')).toBe(list.id);
    expect(field()!.getAttribute('aria-expanded')).toBe('true');
    expect(list.hasAttribute('aria-busy')).toBe(false);
    const ids = options().map((option) => option.id);
    expect(new Set(ids).size).toBe(2);
    const selected = () => options().map((option) => option.getAttribute('aria-selected'));
    expect(selected()).toEqual(['true', 'false']);
    expect(field()!.getAttribute('aria-activedescendant')).toBe(ids[0]);
    press('ArrowDown');
    expect(selected()).toEqual(['false', 'true']);
    expect(field()!.getAttribute('aria-activedescendant')).toBe(ids[1]);
    press('ArrowDown'); // stops at the end
    expect(field()!.getAttribute('aria-activedescendant')).toBe(ids[1]);
    press('ArrowUp');
    expect(field()!.getAttribute('aria-activedescendant')).toBe(ids[0]);
    expect(document.querySelector('[data-files-scroller]')).toBeNull(); // the tree's list is gone with the Changed group's rows
    expect(document.activeElement).toBe(field()); // the keyboard stays in the field
  });

  // The word cut (N1): the wait is the quiet spinner named "Searching files", nothing for its first half second
  it('while the text’s answer is awaited: the quiet spinner with nothing drawn; the earlier rows, none highlighted and the list busy, once something is', async () => {
    holdSearches();
    render(<Page />);
    goToFile();
    await inField();
    type('s');
    await waitFor(() => expect(searches).toHaveLength(1));
    expect([lineOf()?.getAttribute('data-line'), lineOf()?.textContent]).toEqual(['searching', '']);
    expect(await within(lineOf()!).findByRole('progressbar', { name: 'Searching files' }, { timeout: 2000 })).toBeTruthy();
    expect(field()!.getAttribute('aria-expanded')).toBe('false');
    reply(0, listed('src/app.ts', 'notes.md'));
    await waitFor(() => expect(shownPaths()).toEqual(['/r/src/app.ts', '/r/notes.md']));
    expect(lineOf()).toBeNull();
    type('sr');
    await waitFor(() => expect(results()?.getAttribute('aria-busy')).toBe('true'));
    expect(shownPaths()).toEqual(['/r/src/app.ts', '/r/notes.md']);
    expect(options().map((option) => option.getAttribute('aria-selected'))).toEqual(['false', 'false']);
    expect(field()!.hasAttribute('aria-activedescendant')).toBe(false);
    expect(field()!.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expect(searches).toHaveLength(2));
    reply(1, listed('src/app.ts'));
    await waitFor(() => expect(results()?.hasAttribute('aria-busy')).toBe(false));
    expect(shownPaths()).toEqual(['/r/src/app.ts']);
    expect(field()!.getAttribute('aria-activedescendant')).toBe(options()[0].id);
  });

  it('says “No matching files”, says “Files could not be searched.” for a failed read, and shows a walk’s files with no line', async () => {
    render(<Page />);
    goToFile();
    await inField();
    type('zzz');
    await waitFor(() => expect(lineOf()?.getAttribute('data-line')).toBe('none'));
    expect(lineOf()!.textContent).toBe('No matching files');
    expect(results()).toBeNull();
    search = () => fail('fatal: bad config line 1 in file .git/config'); // a repository git refuses (decision 4; B8)
    type('zz');
    await waitFor(() => expect(lineOf()?.getAttribute('data-line')).toBe('failed'));
    expect(lineOf()!.textContent).toBe('Files could not be searched.');
    expect(lineOf()!.className.split(/\s+/)).toEqual(expect.arrayContaining(['text-ui-sm', 'text-danger']));
    search = () => answer({ paths: ['loose.txt', 'drafts/'], truncated: false, source: 'walk' }); // a folder that is no repository
    type('z');
    await waitFor(() => expect(shownPaths()).toEqual(['/r/loose.txt']));
    expect(lineOf()).toBeNull();
  });

  it('a line wraps to as many lines as it needs and is never cut (its classes; the 160 px box is scene G7’s)', async () => {
    render(<Page />);
    goToFile();
    await inField();
    type('zzz');
    const line = await waitFor(() => lineOf()!);
    const classes = line.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['text-ui-sm', 'text-fg-muted', 'break-words', 'whitespace-normal']));
    expect(classes.filter((name) => ['truncate', 'whitespace-nowrap', 'overflow-hidden'].includes(name))).toEqual([]);
  });

  it('a row: its name, then its folder from the working folder in the muted colour, cut at its start when it does not fit and gone below two characters; its title the path from the working folder; no status letter', async () => {
    search = () => listed('src/deep/harbor/app.ts');
    watched = {
      repoRoot: '/r', gitDir: '/r/.git', commonDir: '/r/.git', isWorktree: false, branch: 'main', head: 'c0ffee', upstream: null, remoteUrl: null, ahead: 0, behind: 0, dirty: true,
      files: ['notes.md', 'src/deep/harbor/app.ts'].map((path) => ({ path, oldPath: null, index: '.', worktree: 'M', untracked: false })), stashCount: 0, checkedAt: '2026-11-17T10:00:00.000Z',
    };
    render(<Page />);
    goToFile();
    await inField();
    // the control: the same status draws the tree's row its letter
    await waitFor(() => expect(document.querySelector('[role="treeitem"][data-kind][data-path="/r/notes.md"] [data-mark]')).not.toBeNull());
    await listedFor('app')(['/r/src/deep/harbor/app.ts']);
    const row = () => options()[0];
    const folder = () => row().querySelector('[data-folder]');
    expect(row().getAttribute('title')).toBe('src/deep/harbor/app.ts');
    expect(row().querySelector('[data-name]')!.textContent).toBe('app.ts');
    expect(folder()!.textContent).toBe('src/deep/harbor/'); // the list has no width yet: drawn whole
    expect(folder()!.className.split(/\s+/)).toEqual(expect.arrayContaining(['text-ui-sm', 'text-fg-muted']));
    expect(row().querySelector('[data-mark]')).toBeNull();
    expect(row().className.split(/\s+/)).toContain('bg-bg-active'); // the highlighted row, the first
    expect([row().style.height, row().style.paddingLeft]).toEqual([`${FILES_ROW_HEIGHT}px`, '20px']); // the tree's row, one level in
    measureWith((_font, text) => text.length * 6);
    observer.resize(results()!, { width: RESULT_ROW_FIXED + 'app.ts'.length * 6 + 60, height: 600 });
    expect(folder()!.textContent).toBe('…harbor/');
    observer.resize(results()!, { width: RESULT_ROW_FIXED + 'app.ts'.length * 6 + 11, height: 600 });
    expect(folder()).toBeNull();
  });

  it('Esc with text empties the field and the tree is back at the scroll offset it had', async () => {
    const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');
    const scrollTop = own ?? Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
    const offsets = new WeakMap<Element, number>();
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute('data-files-scroller') ? (offsets.get(this) ?? 0) : scrollTop.get!.call(this);
      },
      set(this: HTMLElement, value: number) {
        if (this.hasAttribute('data-files-scroller')) offsets.set(this, value);
        else scrollTop.set!.call(this, value);
      },
    });
    try {
      render(<Page />);
      goToFile();
      await inField();
      const scroller = () => document.querySelector<HTMLElement>('[data-files-scroller]');
      await waitFor(() => expect(scroller()).not.toBeNull());
      act(() => void (scroller()!.scrollTop = 48));
      await listedFor('s')(['/r/src/app.ts', '/r/notes.md']);
      expect(scroller()).toBeNull();
      esc();
      expect(field()!.value).toBe('');
      expect(document.activeElement).toBe(field());
      await waitFor(() => expect(scroller()?.scrollTop).toBe(48));
      expect(results()).toBeNull();
    } finally {
      if (own) Object.defineProperty(HTMLElement.prototype, 'scrollTop', own);
      else delete (HTMLElement.prototype as { scrollTop?: number }).scrollTop;
    }
  });

  it('⌘P again with the text unchanged asks again, and so does the field taking the keyboard again; with no act nothing is asked', async () => {
    render(<Page />);
    composer().focus();
    goToFile();
    await inField();
    await listedFor('s')(['/r/src/app.ts', '/r/notes.md']);
    await settle();
    expect(searched()).toHaveLength(1);
    goToFile(); // with the keyboard in the field
    await waitFor(() => expect(searched()).toHaveLength(2));
    act(() => composer().focus());
    await settle();
    expect(searched()).toHaveLength(2); // the absence: losing the keyboard asks nothing
    act(() => field()!.focus());
    await waitFor(() => expect(searched()).toHaveLength(3));
    expect(searched().every((input) => input.query === 's')).toBe(true);
  });

  it('a click on a result opens it in the preview tab and moves no keyboard into it', async () => {
    render(<Page />);
    goToFile();
    await inField();
    await listedFor('notes')(['/r/notes.md']);
    fireEvent.click(options()[0]);
    await waitFor(() => expect(document.querySelector('[data-files-tab][data-file="/r/notes.md"]')).not.toBeNull());
    const tab = filesTabs().find((ref) => (useLayout.getState().panelParams[ref.id] as { file?: string } | undefined)?.file === '/r/notes.md')!;
    expect(useLayout.getState().panelParams[tab.id]).toEqual({ file: '/r/notes.md', line: null, preview: true });
    expect(finding()).toBeNull();
    await settle();
    expect(document.activeElement?.closest('[data-file-keyboard]') ?? null).toBeNull();
    goToFile(); // the control: Enter on the same result moves the keyboard into it
    await inField();
    await listedFor('notes')(['/r/notes.md']);
    press('Enter');
    await waitFor(() => expect(document.activeElement?.closest('[data-file-viewer][data-path="/r/notes.md"][data-file-keyboard]')).not.toBeNull(), { timeout: 5000 });
  });

  it('an Enter that commits an input method’s composition opens nothing; a plain Enter opens the highlighted file as a kept tab', async () => {
    render(<Page />);
    goToFile();
    await inField();
    await listedFor('notes')(['/r/notes.md']);
    press('Enter', { isComposing: true });
    press('Enter', { keyCode: 229 });
    await settle();
    expect(document.querySelector('[data-files-tab][data-file="/r/notes.md"]')).toBeNull();
    press('Enter'); // the control
    await waitFor(() => expect(document.querySelector('[data-files-tab][data-file="/r/notes.md"]')).not.toBeNull());
    const tab = filesTabs().find((ref) => (useLayout.getState().panelParams[ref.id] as { file?: string } | undefined)?.file === '/r/notes.md')!;
    expect(useLayout.getState().panelParams[tab.id]).toEqual({ file: '/r/notes.md', line: null });
  });

  it('name:42 then Enter lands on line 42, with the keyboard in the file’s text', async () => {
    contents[APP] = Array.from({ length: 60 }, (_, i) => `const line${i + 1} = ${i + 1};`).join('\n');
    render(<Page />);
    goToFile();
    await inField();
    await listedFor('app.ts:42')(['/r/src/app.ts']);
    expect(searched().at(-1)).toEqual({ directory: '/r', query: 'app.ts', limit: 200 });
    press('Enter');
    const text = await waitFor(() => {
      const content = document.querySelector<HTMLElement>(`[data-file-keyboard][data-key="${KEY(APP)}"] .cm-content`);
      expect(document.activeElement).toBe(content);
      return content!;
    }, { timeout: 5000 });
    const view = EditorView.findFromDOM(text.closest<HTMLElement>('.cm-editor')!)!;
    await waitFor(() => expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(42));
  });
});

describe('after Enter the file has the tab (decision 9; B3, M2’s half)', () => {
  it.each([
    ['folded by the person, with room', WIDE, FOLDED],
    ['too narrow for both', NARROW, null],
  ])('%s: Enter on a result ends the search, the file has the whole tab with the keyboard in its text, and the fold is never written; the person’s press after is', async (_name, width, stored) => {
    main = finderMain(stored);
    render(<Page />);
    await openBeside(width);
    await waitFor(() => expect(useTreeState.getState().loaded).toBe(true));
    await waitFor(() => expect(document.querySelector('[data-file-viewer] .cm-content')).not.toBeNull(), { timeout: 5000 });
    const setFolded = vi.fn(useTreeState.getState().setFolded);
    useTreeState.setState({ setFolded });
    composer().focus();
    goToFile();
    expect(treeColumn()?.getAttribute('data-place')).toBe(width === WIDE ? 'beside' : 'instead');
    await inField();
    await listedFor('app')(['/r/src/app.ts']);
    press('Enter');
    expect(finding()).toBeNull();
    expect(treeColumn()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector(`[data-file-keyboard][data-key="${KEY(APP)}"] .cm-content`)));
    expect(document.activeElement!.closest('[hidden], [inert]')).toBeNull();
    expect(setFolded).not.toHaveBeenCalled();
    expect(treeWrites()).toEqual([]);
    expect(treeOf(useTreeState.getState(), A).folded).toBe(stored !== null);
    if (width === NARROW) observer.resize(filesTab()!, { width: WIDE, height: 600 }); // room for both: the button is the fold's
    fireEvent.click(toggle()!); // the control: the person's press, not the search, is the stored fold, and it is written
    expect(setFolded).toHaveBeenCalledWith(A, stored === null);
    await waitFor(() => expect(treeWrites()).toHaveLength(1));
  });

  it('too narrow, its tree shown in the file’s place by the button before ⌘P: after Enter the file has the tab, with the keyboard in its text', async () => {
    render(<Page />);
    await openBeside(NARROW);
    await waitFor(() => expect(document.querySelector('[data-file-viewer] .cm-content')).not.toBeNull(), { timeout: 5000 });
    fireEvent.click(toggle()!); // the person's press: the tree in the file's place
    expect(treeColumn()?.getAttribute('data-place')).toBe('instead');
    composer().focus();
    goToFile();
    await inField();
    await listedFor('app')(['/r/src/app.ts']);
    press('Enter');
    expect(treeColumn()).toBeNull(); // where the stored fold and the width put it (decision 9), not the press before the search
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector(`[data-file-keyboard][data-key="${KEY(APP)}"] .cm-content`)));
  });
});
