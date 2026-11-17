// Go to file's field above Files' tree (UX wave U6b-3b, docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md, M1;
// decisions 5, 9 and 10, sequence S2, "The look"): ⌘P puts the keyboard in the field of the tab it lands in, when that
// field draws or at once; a key or a press before it draws keeps the keyboard where that act put it; ⌘P again selects the
// field's text; Esc empties the field, then gives the keyboard back to where ⌘P found it. A tab whose tree is folded, or
// too narrow for both, shows the tree column for the search and stores no fold. With text in it the tree stays drawn: M2
// draws the list. Invented paths.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilesEntry } from '@shared/ipc/schema/files';
import { record } from '../../../../../../test/support/builders';
import { connectCodeEvents } from '../../../ipc/events';
import { runAction } from '../../../keymap/actions-runtime';
import { connectPanelHost, registerPanelTool } from '../../../panel/host';
import { useLayout } from '../../../stores/layout';
import { useSessions } from '../../../stores/sessions';
import { fail, installFakeMain, ok as answer } from '../../../test-support/code';
import { A, resetPanelStores, TestHost } from '../../../test-support/panel';
import { installResizeObserver } from '../../../test-support/resize';
import { CommandPalette, usePalette } from '../../../palette/CommandPalette';
import { FILES_COPY } from '../copy';
import { openFile, resetKeptOpens } from '../open-file';
import { useViewer } from '../viewer/viewer-store';
import { filesTool } from './FilesTool';
import { connectGoToFile } from './finder';
import { useFiles } from './store';
import { FILE_WIDTH_MIN, resetTreeState, treeOf, TREE_WIDTH_DEFAULT, useTreeState } from './tree-state';

const APP = '/r/src/app.ts';
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

function finderMain(stored: unknown = null) {
  return installFakeMain((name, input) => {
    if (name === 'layout.get') return answer({ value: input.key === 'files.tree' ? stored : null });
    if (name === 'layout.set' || name === 'files.watch' || name === 'files.unwatch' || name === 'git.unwatch') return answer();
    if (name === 'git.watch') return fail('not a git repository');
    if (name === 'fs.workflows') return answer({ runs: [] });
    if (name === 'files.list') {
      const path = (input.path as string | undefined) ?? '';
      const found = REPO[path];
      return found === undefined ? fail(`not found: ${path}`) : answer({ root: path === '' ? null : '/r', path, entries: found, truncated: false });
    }
    if (name === 'files.read') {
      const content = `// ${String(input.path)}\n`;
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
  it('stands above the tree, outside its menu, with its roles, its words and the app’s own text-field outline; with text the tree stays drawn', async () => {
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
    expect(screen.getByRole('tree', { name: FILES_COPY.title })).toBeTruthy();
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
  });

  // The file's column is hidden and inert while the tree stands in its place, so the keyboard can go back into it only
  // once the search has ended and the file is shown (happy-dom does not refuse a focus on a hidden or inert element:
  // the case reads whether the element could take it when the focus is asked; Chromium's own refusal is the Mac scenes')
  it('too narrow: ⌘P from the tab’s own file, then Esc in the empty field, shows the file again and only then puts the keyboard back in it', async () => {
    render(<Page />);
    await openBeside(NARROW);
    const origin = await waitFor(() => document.querySelector<HTMLElement>('[data-file-viewer] .cm-content')!);
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
