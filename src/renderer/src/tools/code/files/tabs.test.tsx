// A file beside the chat (UX wave U6b-1, docs/doperpowers/plans/2026-11-14-ux-wave-U6b-1-file-beside-chat.md, M1): where an
// open goes (`placeOpen` as a table, then `openFile` over the panel host and the layout store), the preview tab, a file's
// tab in the strip, the ways of pinning, the opens made before the layout is read, the read of a stored layout, and the
// viewer's prune. Invented paths under `/r` and invented text throughout.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { storedMain, type PanelTabRef, type Strip } from '@shared/ipc/schema/layout';
import { addressOf, bareOf } from '@shared/machine/address';
import { record } from '../../../../../../test/support/builders';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../../../test/support/machine';
import { connectPanelHost, panelHost, registerPanelTool, togglePinned } from '../../../panel/host';
import { SurfaceRow } from '../../../panel/SurfaceRow';
import { surfaceTabs } from '../../../panel/surface-model';
import { useLayout } from '../../../stores/layout';
import { allTabs, openTab } from '../../../stores/layout-model';
import { useSessions } from '../../../stores/sessions';
import { deferred, fail, installFakeMain, ok } from '../../../test-support/code';
import { frameToken } from '../../../test-support/code-disk';
import { frameUrl } from '@shared/files/framed';
import { moveFileToMain } from '../../../shell/transfer';
import { FileViewer } from '../viewer/FileViewer';
import { A, B, heldBridge, hydrateHeld, mainShowing, panelOf, persisted, pinIds, resetPanelStores, TestHost } from '../../../test-support/panel';
import { sideFilesViewer } from '../editor/register';
import { codeTranscriptActions, openFile, resetKeptOpens } from '../open-file';
import { useViewer } from '../viewer/viewer-store';
import { filesTool } from './FilesTool';
import { useFiles } from './store';
import { connectSideFiles, fileKey, fileOfTab, keep, placeOpen, sideFileKeys, type OpenRequest, type Placement } from './tabs';

const KEY = (path: string, machine = TEST_MACHINE) => `file:${machine}:${path}`;
const R = addressOf(OTHER_MACHINE, 'app-remote') as AppSessionId; // a session of another machine
const filesOf = (id: AppSessionId) => (panelOf(id)?.tabs ?? []).filter((tab) => tab.toolId === 'files');
const paramsOf = (tabId: string) => useLayout.getState().panelParams[tabId];
const mainFiles = () => allTabs(useLayout.getState().main).filter((tab) => tab.kind === 'file').map((tab) => tab.id);
const inView = (id: AppSessionId) => surfaceTabs(useLayout.getState(), id).map((tab) => tab.id);
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

// Main as the files service answers for a session's folders: the roots, their listings and the files' bytes; a path
// named in `refused` is refused, and `held` holds the first read of a path until released. A relative path is refused as
// the service refuses it (its `path must be absolute`, which main's router answers with the error's message).
const REFUSAL = "path outside the session's directories";
function mainFor(files: Record<string, string>, opts: { refused?: string[]; held?: Map<string, Promise<void>> } = {}) {
  let frames = 0;
  return installFakeMain(async (name, input) => {
    if (name === 'files.watch' || name === 'files.unwatch' || name === 'layout.set' || name === 'git.unwatch') return ok();
    if (name === 'git.watch') return fail('not a git repository'); // the summary's reads, as the panel suites answer them
    if (name === 'fs.workflows') return ok({ runs: [] });
    if (name === 'layout.get') return ok({ value: null });
    if (name === 'files.list') {
      if (input.path === undefined) return ok({ root: null, path: null, entries: [{ name: 'r', path: '/r', kind: 'dir', size: 0, mtimeMs: 0, target: null }], truncated: false });
      return ok({ root: '/r', path: input.path, entries: [], truncated: false });
    }
    if (name === 'files.read') {
      const path = input.path as string;
      await opts.held?.get(path);
      if (!path.startsWith('/')) return fail('path must be absolute');
      if (opts.refused?.includes(path)) return fail(REFUSAL);
      const text = files[path];
      if (text === undefined) return fail(`not found: ${path}`);
      const mime = path.endsWith('.pdf') ? 'application/pdf' : 'text/plain'; // UX wave U6b-2: a PDF is a framed kind
      return ok({ encoding: 'utf8', content: text, bytes: text.length, offset: 0, length: text.length, truncated: false, mime, hash: null, utf8: null });
    }
    // UX wave U6b-2: main's file frames, one token per ask
    if (name === 'layout.frameFile') {
      const token = frameToken(++frames);
      return ok({ status: 'ready', token, url: frameUrl(token, (input.path as string).slice((input.path as string).lastIndexOf('/') + 1)), framed: 'pdf' });
    }
    if (name === 'layout.releaseFrame') return ok();
    return fail(`unexpected ${name}`);
  });
}

const offs: (() => void)[] = [];
let unregisterFiles: () => void;
beforeEach(() => {
  resetPanelStores();
  resetKeptOpens();
  useViewer.getState().reset();
  useFiles.getState().reset();
  mainFor({ '/r/a.ts': 'a\n', '/r/b.ts': 'b\n', '/r/c.ts': 'c\n' });
  unregisterFiles = registerPanelTool(filesTool);
  offs.push(connectSideFiles(sideFilesViewer));
  useSessions.setState((s) => ({ records: new Map(s.records).set(R, record(R, { directory: '/r' })) }));
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
  unregisterFiles();
  resetKeptOpens();
});

// ---- placeOpen ---------------------------------------------------------------------------------------------------------

describe('where an open goes (placeOpen)', () => {
  type Tab = { id: string; file?: string; preview?: boolean; pinned?: boolean };
  interface Row {
    name: string;
    mainFile?: string; // a main tab of this file
    own?: Tab[]; // A's own list, in order
    pins?: Tab[];
    twoGroups?: 'files below' | 'files above'; // the column in two groups, Review in the other
    request?: Partial<OpenRequest>;
    expected: Placement;
  }
  const tab = (id: string, file?: string, preview = false): Tab => ({ id: `files:${id}`, file, preview });
  const ROWS: Row[] = [
    { name: 'no session: the main area', request: { appSessionId: null }, expected: { to: 'main' } },
    { name: '⌘: the main area, a side tab of the file or not', own: [tab('a', '/r/a.ts')], request: { main: true }, expected: { to: 'main' } },
    { name: 'a main tab shows the file: the main area', mainFile: '/r/a.ts', own: [tab('t')], expected: { to: 'main' } },
    { name: 'a main tab of another file changes nothing', mainFile: '/r/b.ts', expected: { to: 'side', tabId: null, group: 'upper' } },
    { name: 'a tab of the file: selected, even beside a preview', own: [tab('p', '/r/b.ts', true), tab('a', '/r/a.ts')], expected: { to: 'side', tabId: 'files:a', how: 'select' } },
    { name: 'the preview tab, before the tree-only one: reused', own: [tab('t'), tab('k', '/r/k.ts'), tab('p', '/r/b.ts', true)], expected: { to: 'side', tabId: 'files:p', how: 'reuse' } },
    { name: 'the tree-only tab: reused (the first file takes it)', own: [tab('t'), tab('k', '/r/k.ts')], expected: { to: 'side', tabId: 'files:t', how: 'reuse' } },
    { name: 'a kept tab of another file only: a new tab', own: [tab('k', '/r/k.ts')], expected: { to: 'side', tabId: null, group: 'upper' } },
    { name: 'a pinned tree-only tab is never taken: a new tab', pins: [{ ...tab('t'), pinned: true }], expected: { to: 'side', tabId: null, group: 'upper' } },
    { name: 'keep does not move where it goes', own: [tab('p', '/r/b.ts', true)], request: { keep: true }, expected: { to: 'side', tabId: 'files:p', how: 'reuse' } },
    { name: 'two groups, Files below: a new tab below', own: [tab('k', '/r/k.ts')], twoGroups: 'files below', expected: { to: 'side', tabId: null, group: 'lower' } },
    { name: 'two groups, Files above: a new tab above', own: [tab('k', '/r/k.ts')], twoGroups: 'files above', expected: { to: 'side', tabId: null, group: 'upper' } },
    { name: 'another session’s tab of the file is not this one’s', expected: { to: 'side', tabId: null, group: 'upper' } },
  ];

  it.each(ROWS)('$name', ({ mainFile, own = [], pins = [], twoGroups, request, expected }) => {
    const ref = (t: Tab): PanelTabRef => ({ id: t.id, toolId: 'files', pinned: t.pinned ?? false });
    const review: PanelTabRef = { id: 'review:r', toolId: 'review', pinned: false };
    const ownRefs = [...own.map(ref), ...(twoGroups ? [review] : [])];
    const params = Object.fromEntries([...own, ...pins].flatMap((t) => (t.file ? [[t.id, { file: t.file, line: null, ...(t.preview ? { preview: true } : {}) }]] : [])));
    const filesTab = own.at(-1)?.id ?? '';
    const stacks = twoGroups === 'files below' ? { [A]: ['review:r', filesTab] } : twoGroups === 'files above' ? { [A]: [filesTab, 'review:r'] } : {};
    const main: Strip = mainFile ? openTab(mainShowing(A), { kind: 'file', path: mainFile, line: null, appSessionId: A, machine: TEST_MACHINE }) : mainShowing(A);
    useLayout.setState({
      main,
      panelPinned: pins.map(ref),
      panelBySession: new Map([[A, { tabs: ownRefs, activeTabId: null }], [B, { tabs: [ref(tab('b', '/r/a.ts'))], activeTabId: null }]]),
      panelParams: { ...params, 'files:b': { file: '/r/a.ts', line: null } },
      panelSurfaces: { version: 2, stacks, pinnedTools: [], contexts: {} },
    });
    expect(placeOpen(useLayout.getState(), { appSessionId: A, path: '/r/a.ts', main: false, keep: false, ...request })).toEqual(expected);
  });
});

describe('what a tab of Files holds (fileOfTab)', () => {
  it('reads a file, its line and the preview mark; anything else is the tree alone', () => {
    expect(fileOfTab({ file: '/r/a.ts', line: 3, preview: true })).toEqual({ file: '/r/a.ts', line: 3, preview: true });
    expect(fileOfTab({ file: '/r/./src/../a.ts' })).toEqual({ file: '/r/a.ts', line: null });
    expect(fileOfTab({ file: '/r/a.ts', line: 0, preview: 'yes' })).toEqual({ file: '/r/a.ts', line: null });
    expect(fileOfTab({ file: '/r/a.ts', line: 2.5 })).toEqual({ file: '/r/a.ts', line: null });
    expect(fileOfTab({ file: 'src/./a.ts', line: 4 })).toEqual({ file: 'src/a.ts', line: 4 }); // a relative path chip's: the viewer answers for it
    for (const tree of [undefined, null, {}, { path: '/r/a.ts' }, { file: '' }, { file: 7 }, 'x', []]) expect(fileOfTab(tree), JSON.stringify(tree)).toBeNull();
    expect(fileKey(OTHER_MACHINE, '/r/a.ts')).toBe(KEY('/r/a.ts', OTHER_MACHINE));
  });
});

// ---- openFile ------------------------------------------------------------------------------------------------------------

describe('opening a file beside the chat (openFile)', () => {
  it('opens a tab of Files beside the chat, the preview tab at the line, in view; the main strip gains nothing', () => {
    const before = useLayout.getState().main;
    let opened: ReturnType<typeof openFile> = null;
    act(() => void (opened = openFile(A, '/r/src/../a.ts', 3)));
    const [tab] = filesOf(A);
    expect(opened).toEqual({ surface: 'side', tabId: tab.id });
    expect(tab.pinned).toBe(false);
    expect(paramsOf(tab.id)).toEqual({ file: '/r/a.ts', line: 3, preview: true });
    expect(inView(A)).toEqual([tab.id]);
    expect(useLayout.getState().regions.panel.collapsed).toBe(false);
    expect(useLayout.getState().main).toEqual(before);
  });

  it('reuses the preview tab for the next open; a kept tab is never reused, so the open after it adds a tab', () => {
    act(() => void openFile(A, '/r/a.ts'));
    const [preview] = filesOf(A);
    act(() => void openFile(A, '/r/b.ts'));
    expect(filesOf(A).map((tab) => tab.id)).toEqual([preview.id]);
    expect(paramsOf(preview.id)).toEqual({ file: '/r/b.ts', line: null, preview: true });
    act(() => keep(preview.id));
    expect(paramsOf(preview.id)).toEqual({ file: '/r/b.ts', line: null });
    act(() => void openFile(A, '/r/c.ts'));
    expect(filesOf(A)).toHaveLength(2);
    expect(paramsOf(filesOf(A)[1].id)).toEqual({ file: '/r/c.ts', line: null, preview: true });
  });

  it('an opener that keeps opens a kept tab; a tab of the file is selected at the new line and stays what it was unless kept', () => {
    act(() => void openFile(A, '/r/a.ts', 1, { keep: true }));
    const [kept] = filesOf(A);
    expect(paramsOf(kept.id)).toEqual({ file: '/r/a.ts', line: 1 });
    act(() => void openFile(A, '/r/b.ts'));
    const preview = filesOf(A)[1];
    act(() => void openFile(A, '/r/a.ts', 9));
    expect(paramsOf(kept.id)).toEqual({ file: '/r/a.ts', line: 9 });
    expect(inView(A)).toEqual([kept.id]);
    act(() => void openFile(A, '/r/b.ts'));
    expect(paramsOf(preview.id)).toEqual({ file: '/r/b.ts', line: null, preview: true });
    act(() => void openFile(A, '/r/b.ts', null, { keep: true }));
    expect(paramsOf(preview.id)).toEqual({ file: '/r/b.ts', line: null });
    expect(filesOf(A)).toHaveLength(2);
  });

  it('the first file opened takes the session’s tree-only tab', () => {
    let tree = '';
    act(() => void (tree = panelHost.addTool('files', { appSessionId: A })));
    expect(paramsOf(tree)).toBeUndefined();
    act(() => void openFile(A, '/r/a.ts'));
    expect(filesOf(A).map((tab) => tab.id)).toEqual([tree]);
    expect(paramsOf(tree)).toEqual({ file: '/r/a.ts', line: null, preview: true });
  });

  it('adds beside a pinned tree-only tab, which stays pinned and holds no file; the open asks no pin', () => {
    let pinned = '';
    act(() => void (pinned = panelHost.addTool('files', { appSessionId: A, pin: true })));
    act(() => void openFile(A, '/r/a.ts'));
    expect(pinIds()).toEqual([pinned]);
    expect(paramsOf(pinned)).toBeUndefined();
    const [tab] = filesOf(A);
    expect(tab).toMatchObject({ pinned: false });
    expect(paramsOf(tab.id)).toMatchObject({ file: '/r/a.ts' });
  });

  it('with a main tab of the file, the open selects it and adds nothing beside the chat', () => {
    act(() => useLayout.getState().openTab({ kind: 'file', path: '/r/a.ts', line: null, appSessionId: A, machine: TEST_MACHINE }));
    act(() => useLayout.getState().openSession(A));
    let opened: ReturnType<typeof openFile> = null;
    act(() => void (opened = openFile(A, '/r/a.ts', 4)));
    expect(opened).toEqual({ surface: 'main', tabId: KEY('/r/a.ts') });
    expect(filesOf(A)).toEqual([]);
    expect(allTabs(useLayout.getState().main).find((tab) => tab.id === KEY('/r/a.ts'))).toMatchObject({ line: 4 });
    expect(useLayout.getState().main.panes[0].activeTabId).toBe(KEY('/r/a.ts'));
  });

  it('⌘ opens a main tab, and the file’s side tabs go from every session’s list', () => {
    act(() => void openFile(A, '/r/a.ts'));
    act(() => void openFile(B, '/r/a.ts', null, { keep: true }));
    act(() => void openFile(B, '/r/b.ts'));
    expect(filesOf(A)).toHaveLength(1);
    expect(filesOf(B)).toHaveLength(2);
    act(() => void openFile(A, '/r/a.ts', 2, { main: true }));
    expect(mainFiles()).toEqual([KEY('/r/a.ts')]);
    expect(filesOf(A)).toEqual([]);
    expect(filesOf(B).map((tab) => fileOfTab(paramsOf(tab.id))?.file)).toEqual(['/r/b.ts']);
  });

  it('the transcript’s path link opens beside the shown session’s chat, and its ⌘-click as a main tab, leaving no side tab', () => {
    act(() => codeTranscriptActions.openFile('/r/a.ts', 2));
    expect(filesOf(A).map((tab) => paramsOf(tab.id))).toEqual([{ file: '/r/a.ts', line: 2, preview: true }]);
    act(() => codeTranscriptActions.openFile('/r/a.ts', 2, A, { main: true }));
    expect(mainFiles()).toEqual([KEY('/r/a.ts')]);
    expect(filesOf(A)).toEqual([]);
  });

  it('with no session the file opens as a main tab, as today', () => {
    act(() => void openFile(null, '/r/a.ts', 3));
    expect(allTabs(useLayout.getState().main).filter((tab) => tab.kind === 'file')).toEqual([expect.objectContaining({ path: '/r/a.ts', line: 3, appSessionId: null })]);
  });

  it('a person’s open leaves an open page first; an agent’s leaves it open', () => {
    useLayout.setState({ destination: { kind: 'projects' } });
    act(() => void openFile(A, '/r/a.ts'));
    expect(useLayout.getState().destination).toBeNull();
    useLayout.setState({ destination: { kind: 'projects' } });
    act(() => void openFile(A, '/r/b.ts', null, { asked: 'agent' }));
    expect(useLayout.getState().destination).toEqual({ kind: 'projects' });
    expect(paramsOf(filesOf(A)[0].id)).toMatchObject({ file: '/r/b.ts' });
  });

  it('a session on another machine: its own list, the file keyed and read on that machine with no named key; this Mac’s with it', async () => {
    const main = mainFor({ '/r/a.ts': 'a\n' });
    render(<TestHost />);
    act(() => void openFile(R, '/r/a.ts'));
    expect(filesOf(R)).toHaveLength(1);
    expect(sideFileKeys(useLayout.getState())).toEqual(new Set([KEY('/r/a.ts', OTHER_MACHINE)]));
    await waitFor(() => expect(main.callsOf('files.read')).toHaveLength(1));
    expect(main.callsOf('files.read')[0]).toMatchObject({ appSessionId: bareOf(R), path: '/r/a.ts' });
    expect(main.callsOf('files.read')[0]).not.toHaveProperty('named');
    act(() => void openFile(A, '/r/b.ts'));
    await waitFor(() => expect(main.callsOf('files.read')).toHaveLength(2));
    expect(main.callsOf('files.read')[1]).toMatchObject({ appSessionId: bareOf(A), path: '/r/b.ts', named: true });
  });
});

// ---- a path the opener gives as it is ------------------------------------------------------------------------------------

describe('a relative path chip opens beside the chat as it opens in a main tab', () => {
  // The transcript leaves a relative path relative (`src/shared/files/named.ts`); a main tab of it shows the viewer's
  // refusal of it, and so does its side tab, in the preview's place, never the tree.
  it('the preview tab draws the viewer with the service’s refusal, keyed as the main tab would be; ⌘ opens that main tab', async () => {
    render(<TestHost />);
    act(() => void openFile(A, '/r/a.ts'));
    const [preview] = filesOf(A);
    await waitFor(() => expect(document.querySelector('[data-files-tab]')?.getAttribute('data-file')).toBe('/r/a.ts'));
    act(() => codeTranscriptActions.openFile('src/./a.ts', 4, A));
    expect(filesOf(A).map((tab) => tab.id)).toEqual([preview.id]);
    expect(paramsOf(preview.id)).toEqual({ file: 'src/a.ts', line: 4, preview: true });
    await waitFor(() => expect(document.querySelector('[data-refusal]')?.textContent).toBe('Refused: path must be absolutesrc/a.ts'));
    expect(document.querySelector('[data-files-tab]')!.getAttribute('data-file')).toBe('src/a.ts');
    expect(screen.queryByRole('tree')).toBeNull();
    expect(sideFileKeys(useLayout.getState())).toEqual(new Set([KEY('src/a.ts')]));
    act(() => codeTranscriptActions.openFile('src/a.ts', 9, A)); // rule 3: the tab of the file, selected at the line
    expect(filesOf(A).map((tab) => [tab.id, paramsOf(tab.id)])).toEqual([[preview.id, { file: 'src/a.ts', line: 9, preview: true }]]);
    act(() => codeTranscriptActions.openFile('src/a.ts', 9, A, { main: true }));
    expect(mainFiles()).toEqual([KEY('src/a.ts')]);
    expect(filesOf(A)).toEqual([]);
  });
});

// ---- the strip -----------------------------------------------------------------------------------------------------------

describe('a file’s tab in the strip', () => {
  const strip = () => document.querySelector('[data-side-strip]') as HTMLElement;
  const tabEl = (id: string) => strip().querySelector(`[data-tab-id="${id}"]`) as HTMLElement;

  it('is titled by the file’s name, in italics while it is the preview; a double-click keeps it', () => {
    render(<TestHost />);
    act(() => void openFile(A, '/r/a.ts'));
    const [tab] = filesOf(A);
    const button = within(tabEl(tab.id)).getByRole('tab');
    expect(button.textContent).toBe('a.ts');
    expect(tabEl(tab.id).getAttribute('data-preview')).toBe('true');
    expect(button.querySelector('span')!.className).toContain('italic');
    fireEvent.doubleClick(button);
    expect(paramsOf(tab.id)).toEqual({ file: '/r/a.ts', line: null });
    expect(tabEl(tab.id).hasAttribute('data-preview')).toBe(false);
    expect(button.querySelector('span')!.className).not.toContain('italic');
  });

  it('has no pin glyph, and togglePinned on it changes nothing; the tree-only tab keeps its glyph', () => {
    render(<TestHost />);
    let tree = '';
    act(() => void (tree = panelHost.addTool('files', { appSessionId: A })));
    act(() => void openFile(A, '/r/a.ts', null, { keep: true }));
    expect(filesOf(A)).toHaveLength(1); // the tree-only tab took the file
    act(() => void (tree = panelHost.addTool('files', { appSessionId: A })));
    const file = filesOf(A).find((tab) => tab.id !== tree)!;
    expect(within(tabEl(file.id)).queryByRole('button', { name: /^Pin / })).toBeNull();
    act(() => togglePinned(file.id));
    expect(pinIds()).toEqual([]);
    expect(within(tabEl(tree)).getByRole('button', { name: 'Pin Files' })).toBeTruthy();
  });

  it('"+ ▸ Files" shows the tree-only tab there is, before the files’ tabs, and adds one only when there is none', async () => {
    const user = userEvent.setup();
    render(<TestHost />);
    act(() => void openFile(A, '/r/a.ts', null, { keep: true }));
    act(() => void openFile(A, '/r/b.ts'));
    const files = filesOf(A).map((tab) => tab.id);
    const add = async () => {
      await user.click(within(strip()).getByRole('button', { name: 'Add a tool' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Files' }));
    };
    await add();
    const tree = filesOf(A).find((tab) => !files.includes(tab.id))!.id;
    expect(filesOf(A).map((tab) => tab.id)).toEqual([tree, ...files]);
    expect(inView(A)).toEqual([tree]);
    act(() => void panelHost.selectTab(files[0]));
    await add();
    expect(filesOf(A).map((tab) => tab.id)).toEqual([tree, ...files]);
    expect(inView(A)).toEqual([tree]);
  });

  it('a tree-only tab unpinned joins the list before the files’ tabs', () => {
    let tree = '';
    act(() => void (tree = panelHost.addTool('files', { appSessionId: A, pin: true })));
    act(() => void openFile(A, '/r/a.ts'));
    act(() => useLayout.getState().setPanelTabPinned(A, tree, false));
    expect(filesOf(A).map((tab) => tab.id)[0]).toBe(tree);
    expect(filesOf(A)).toHaveLength(2);
  });
});

// ---- the pin (L10, Decision 16) ------------------------------------------------------------------------------------------

describe('no way of pinning pins a file’s tab', () => {
  const surfaceRow = () => screen.getByRole('toolbar', { name: 'Session surfaces' });

  it('the store refuses to pin a tab that holds a file, pins the tree-only tab, and never refuses an unpin', () => {
    let tree = '';
    act(() => void openFile(A, '/r/a.ts'));
    act(() => void (tree = panelHost.addTool('files', { appSessionId: A })));
    const file = filesOf(A).find((tab) => tab.id !== tree)!.id;
    act(() => useLayout.getState().setPanelTabPinned(A, file, true));
    expect(pinIds()).toEqual([]);
    act(() => useLayout.getState().setPanelTabPinned(A, tree, true));
    expect(pinIds()).toEqual([tree]);
    act(() => useLayout.getState().setPanelTabPinned(A, tree, false));
    expect(pinIds()).toEqual([]);
  });

  it('the Files icon’s menu keeps the tree-only tab for every session, not the file’s before it, and offers nothing without one', async () => {
    const user = userEvent.setup();
    (window as unknown as { happyDOM: { setWindowSize(size: { width: number }): void } }).happyDOM.setWindowSize({ width: 1440 });
    render(<><SurfaceRow /><TestHost /></>);
    act(() => void openFile(A, '/r/a.ts', null, { keep: true }));
    const file = filesOf(A)[0].id;
    fireEvent.contextMenu(within(surfaceRow()).getByRole('button', { name: 'Files' }));
    expect(await screen.findByRole('menuitem', { name: /^(?:Open|Hide) surface$/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Keep open for every session' })).toBeNull(); // the only Files tab holds a file
    await user.keyboard('{Escape}');
    let tree = '';
    act(() => void (tree = panelHost.addTool('files', { appSessionId: A })));
    fireEvent.contextMenu(within(surfaceRow()).getByRole('button', { name: 'Files' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Keep open for every session' }));
    expect(pinIds()).toEqual([tree]);
    expect(filesOf(A).map((tab) => tab.id)).toEqual([file]);
  });

  it('the overflow’s item on a saved Files tab of a build that has no Files reaches the gate', async () => {
    const user = userEvent.setup();
    unregisterFiles();
    const saved: PanelTabRef = { id: 'files:saved', toolId: 'files', pinned: false };
    useLayout.setState({ panelBySession: new Map([[A, { tabs: [saved], activeTabId: null }]]), panelParams: { [saved.id]: { file: '/r/a.ts', line: null } } });
    render(<><SurfaceRow /><TestHost /></>);
    await user.click(within(surfaceRow()).getByRole('button', { name: 'More surfaces' }));
    const trigger = await screen.findByRole('menuitem', { name: 'files (unavailable)' });
    act(() => trigger.focus());
    await user.keyboard('{ArrowRight}');
    const action = await screen.findByRole('menuitem', { name: 'Keep open for every session' });
    act(() => action.focus());
    await user.keyboard('{Enter}');
    expect(pinIds()).toEqual([]);
    expect(panelOf(A)!.tabs).toEqual([saved]);
    unregisterFiles = registerPanelTool(filesTool);
  });
});

// ---- before the layout is read (sequence 4; Decisions 10, 16, 21) ---------------------------------------------------------

describe('before the layout is read', () => {
  const FILES_T = { id: 'files:tree', toolId: 'files', pinned: true };
  async function launch(values: Record<string, unknown>, before: () => void) {
    resetPanelStores({ hydrated: false });
    unregisterFiles = registerPanelTool(filesTool); // the reset forgot every registration
    mainFor({ '/r/a.ts': 'a\n' });
    const bridge = heldBridge(persisted(values));
    offs.push(connectPanelHost());
    await hydrateHeld(bridge, before);
    await settle();
    return bridge;
  }

  it('the barrier: a file’s add reserved beside a restored pinned tree-only tab gets its own unpinned tab; the pin stays the tree', async () => {
    let id = '';
    await launch({ 'panel.pinned': [FILES_T] }, () => void (id = panelHost.addTool('files', { appSessionId: A, params: { file: '/r/a.ts', line: null } })));
    expect(pinIds()).toEqual([FILES_T.id]);
    expect(paramsOf(FILES_T.id)).toBeUndefined();
    expect(filesOf(A)).toEqual([{ id, toolId: 'files', pinned: false }]);
    expect(paramsOf(id)).toEqual({ file: '/r/a.ts', line: null });
  });

  it.each([1, 2])('a tree-only add reserved %i time(s) before the read leaves the one restored tree-only tab, brought into view', async (times) => {
    const own = { ...FILES_T, id: 'files:own', pinned: false };
    await launch({ [`panel.${A}`]: { tabs: [own], activeTabId: null } }, () => {
      for (let i = 0; i < times; i++) panelHost.addTool('files', { appSessionId: A });
    });
    expect(filesOf(A)).toEqual([own]);
    expect(inView(A)).toEqual([own.id]);
  });

  it('an open made before the read selects the stored tab of its file; opens are made once each, in call order', async () => {
    const kept = { id: 'files:kept', toolId: 'files', pinned: false };
    const preview = { id: 'files:preview', toolId: 'files', pinned: false };
    const answers: unknown[] = [];
    await launch({
      [`panel.${A}`]: { tabs: [kept, preview], activeTabId: kept.id },
      'panelTools.params': { version: 1, params: { [kept.id]: { file: '/r/a.ts', line: null }, [preview.id]: { file: '/r/b.ts', line: null, preview: true } } },
    }, () => {
      answers.push(openFile(A, '/r/c.ts'), openFile(A, '/r/d.ts'), openFile(A, '/r/a.ts', 7));
    });
    expect(answers).toEqual([null, null, null]);
    expect(filesOf(A).map((tab) => tab.id)).toEqual([kept.id, preview.id]);
    expect(paramsOf(preview.id)).toEqual({ file: '/r/d.ts', line: null, preview: true }); // c, then d, in the preview tab
    expect(paramsOf(kept.id)).toEqual({ file: '/r/a.ts', line: 7 });
    expect(inView(A)).toEqual([kept.id]);
  });
});

// ---- the read of a layout (sequences 5 and 8) ----------------------------------------------------------------------------

describe('the read of a stored layout', () => {
  async function launch(values: Record<string, unknown>) {
    resetPanelStores({ hydrated: false });
    unregisterFiles = registerPanelTool(filesTool); // the reset forgot every registration
    const bridge = heldBridge(persisted(values));
    offs.push(connectPanelHost());
    await hydrateHeld(bridge);
    await settle();
    return bridge;
  }

  it('a pinned tab that holds a file (the older build’s pin) is the pinned tree-only tab, and what the read changed is written back', async () => {
    const pinned = { id: 'files:pinned', toolId: 'files', pinned: true };
    const bridge = await launch({ 'panel.pinned': [pinned], 'panelTools.params': { version: 1, params: { [pinned.id]: { file: '/r/a.ts', line: 2 } } } });
    expect(pinIds()).toEqual([pinned.id]);
    expect(paramsOf(pinned.id)).toBeUndefined();
    expect(bridge.written('panelTools.params')).toEqual({ version: 1, params: {} });
  });

  it('a side tab whose file a main tab holds is dropped and the main tab kept; the list is written back', async () => {
    const side = { id: 'files:side', toolId: 'files', pinned: false };
    const strip = openTab(mainShowing(A), { kind: 'file', path: '/r/a.ts', line: null, appSessionId: A, machine: TEST_MACHINE });
    const bridge = await launch({ 'main.tabs': storedMain(strip), [`panel.${A}`]: { tabs: [side], activeTabId: side.id }, 'panelTools.params': { version: 1, params: { [side.id]: { file: '/r/a.ts', line: null } } } });
    expect(mainFiles()).toEqual([KEY('/r/a.ts')]);
    expect(filesOf(A)).toEqual([]);
    expect(bridge.written(`panel.${A}`)).toMatchObject({ tabs: [] });
  });

  it('a restored tab whose params this build cannot read is the tree; one whose file is refused shows the refusal and stays', async () => {
    const odd = { id: 'files:odd', toolId: 'files', pinned: false };
    const refused = { id: 'files:refused', toolId: 'files', pinned: false };
    await launch({ [`panel.${A}`]: { tabs: [odd, refused], activeTabId: odd.id }, 'panelTools.params': { version: 1, params: { [odd.id]: { path: '/r/a.ts', other: true }, [refused.id]: { file: '/r/x.ts', line: null } } } });
    mainFor({}, { refused: ['/r/x.ts'] });
    render(<TestHost />);
    await waitFor(() => expect(document.querySelector('[data-files-tab]')?.getAttribute('data-file')).toBe(''));
    expect(screen.getByRole('tree')).toBeTruthy();
    act(() => panelHost.selectTab(refused.id));
    await waitFor(() => expect(document.querySelector('[data-refusal]')).not.toBeNull());
    expect(document.querySelector('[data-files-tab]')!.getAttribute('data-file')).toBe('/r/x.ts');
    expect(filesOf(A).map((tab) => tab.id)).toEqual([odd.id, refused.id]);
  });
});

// ---- the viewer's prune (Decision 20a; sequence 3) -----------------------------------------------------------------------

describe('the viewer’s prune counts the files beside the chat', () => {
  it('keeps the entry of a file a side tab holds while another tab is in view, and drops it when the tab goes', async () => {
    render(<TestHost />);
    act(() => void openFile(A, '/r/a.ts', null, { keep: true }));
    await waitFor(() => expect(useViewer.getState().entries.get(KEY('/r/a.ts'))?.status).toBe('ready'));
    const [first] = filesOf(A);
    act(() => void openFile(A, '/r/b.ts'));
    await waitFor(() => expect(useViewer.getState().entries.get(KEY('/r/b.ts'))?.status).toBe('ready'));
    expect(inView(A)).not.toContain(first.id);
    expect(useViewer.getState().entries.has(KEY('/r/a.ts'))).toBe(true);
    act(() => useLayout.getState().updatePanelTabs(A, (refs) => refs.filter((ref) => ref.id !== first.id)));
    expect(useViewer.getState().entries.has(KEY('/r/a.ts'))).toBe(false);
    expect(useViewer.getState().entries.has(KEY('/r/b.ts'))).toBe(true);
  });

  it('a preview tab replaced while its first file loads: the late answer lands nowhere and no entry of it stays', async () => {
    const gate = deferred<void>();
    mainFor({ '/r/a.ts': 'a\n', '/r/b.ts': 'b\n' }, { held: new Map([['/r/a.ts', gate.promise]]) });
    render(<TestHost />);
    act(() => void openFile(A, '/r/a.ts'));
    await waitFor(() => expect(useViewer.getState().entries.get(KEY('/r/a.ts'))?.status).toBe('loading'));
    act(() => void openFile(A, '/r/b.ts'));
    await waitFor(() => expect(useViewer.getState().entries.get(KEY('/r/b.ts'))?.status).toBe('ready'));
    gate.resolve();
    await settle();
    expect(document.querySelector('[data-file-viewer]')!.getAttribute('data-path')).toBe('/r/b.ts');
    expect(useViewer.getState().entries.has(KEY('/r/a.ts'))).toBe(false);
  });
});

// ---- a framed file's move (UX wave U6b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, sequence 8) ---

describe('a framed file moved to the main area', () => {
  it('a move keeps the token', async () => {
    const main = mainFor({ '/r/ledger.pdf': '%PDF-1.4 invented\n' });
    render(<TestHost />);
    act(() => void openFile(A, '/r/ledger.pdf'));
    await waitFor(() => expect(useViewer.getState().entries.get(KEY('/r/ledger.pdf'))?.frame?.status).toBe('ready'));
    const url = frameUrl(frameToken(1), 'ledger.pdf');
    const beside = document.querySelector('[data-artifact-frame="pdf"]')!;
    expect(beside.getAttribute('src')).toBe(`${url}#toolbar=0&navpanes=0`); // beside the chat: the side tab's fragment
    const [side] = filesOf(A);
    act(() => void moveFileToMain(side!.id));
    const moved = allTabs(useLayout.getState().main).find((tab) => tab.id === KEY('/r/ledger.pdf')) as Extract<ReturnType<typeof allTabs>[number], { kind: 'file' }>;
    expect(moved).toBeDefined();
    render(<FileViewer tab={moved} />); // the main area draws the moved tab
    await waitFor(() => expect(document.querySelector('[data-artifact-frame="pdf"]')?.getAttribute('src')).toBe(`${url}#navpanes=0`));
    await settle();
    expect(main.callsOf('layout.frameFile')).toHaveLength(1);
    expect(main.callsOf('layout.releaseFrame')).toEqual([]);
    expect(main.callsOf('files.read')).toHaveLength(1);
  });
});
