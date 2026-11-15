// A file's moves between the side column and the main area (UX wave U6b-1, docs/doperpowers/plans/2026-11-14-ux-wave-U6b-1-
// file-beside-chat.md, M4; Decisions 12, 13, 18, 19 and 20b; sequences 1, 7, 9, 10 and 11), held on the editor's own state:
// the text typed immediately before the act is there once in the new place, and the undo history came with it
// (Constraint 9). The main area and the side column are drawn as the shell draws them, with the real file viewer.
import { isolateHistory, undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { TEST_MACHINE } from '../../../../test/support/machine';
import { registerShellActions } from '../app/shell-actions';
import { registerSlot, resetSlots } from '../app/slots';
import { queryClient } from '../ipc/query';
import { runAction } from '../keymap/actions-runtime';
import { MainArea } from '../main/MainArea';
import { panelHost, registerPanelTool, usePanelHost } from '../panel/host';
import { PanelHost } from '../panel/PanelHost';
import { PanelRegion } from '../panel/PanelRegion';
import { persistLayout, useLayout } from '../stores/layout';
import { activeTab, allTabs } from '../stores/layout-model';
import { useNotices } from '../stores/notices';
import { installDisk } from '../test-support/code-disk';
import { drag, transfer } from '../test-support/drag';
import { A, B, mainShowing, panelOf, probeTool, ref, resetPanelStores } from '../test-support/panel';
import { TRANSFER_COPY } from '../tools/artifacts/copy';
import { registerEditor, sideFilesViewer } from '../tools/code/editor/register';
import { filesTool } from '../tools/code/files/FilesTool';
import { useFiles } from '../tools/code/files/store';
import { connectSideFiles } from '../tools/code/files/tabs';
import { resetTreeState, useTreeState } from '../tools/code/files/tree-state';
import { openFile, resetKeptOpens } from '../tools/code/open-file';
import { FileViewer } from '../tools/code/viewer/FileViewer';
import { existingViewState, useViewer, VIEWER_ENTRIES_MAX } from '../tools/code/viewer/viewer-store';
import { moveFileToMain, moveFileToSide, transferRefusal } from './transfer';

vi.mock('../app/Diagnostics', () => ({ Diagnostics: () => <section aria-label="Diagnostics">diagnostics</section> }));

const APP = '/r/app.ts';
const LIB = '/r/lib.ts';
const OTHER = '/r/c.ts';
const ORIGINAL = 'const a = 1;\n';
const KEY = (path: string) => `file:${TEST_MACHINE}:${path}`;

const offs: (() => void)[] = [];
let disk: ReturnType<typeof installDisk>;
beforeAll(() => import('../tools/code/viewer/CodeView'));
beforeEach(async () => {
  resetPanelStores();
  // Review in view beside A's chat, so the column is drawn before a file is beside it (a target for a main tab's drag).
  const review = ref('review:aaaa0001');
  useLayout.setState({
    main: mainShowing(B, A),
    panelBySession: new Map([[A, { tabs: [review], activeTabId: review.id }]]),
    panelSurfaces: { version: 2, stacks: { [A]: [review.id] }, pinnedTools: [], contexts: {} },
  });
  resetKeptOpens();
  resetTreeState();
  useViewer.getState().reset();
  useFiles.getState().reset();
  useNotices.setState({ notices: [] });
  disk = installDisk({ [APP]: ORIGINAL, [LIB]: 'export const b = 2;\n', [OTHER]: 'c\n' });
  offs.push(
    registerPanelTool(filesTool),
    registerPanelTool(probeTool('review', { title: 'Review', multiInstance: false }).tool),
    registerEditor(),
    connectSideFiles(sideFilesViewer),
    registerShellActions(),
  );
  registerSlot('panelHost', PanelHost);
  registerSlot('fileTab', FileViewer);
  await act(() => useTreeState.getState().load()); // Files' tree state read before any tab draws it
});
afterEach(() => {
  cleanup();
  resetSlots();
  offs.splice(0).forEach((off) => off());
  resetKeptOpens();
  useViewer.getState().reset();
});

function renderBoth() {
  return render(
    <QueryClientProvider client={queryClient}>
      <div data-region="main" className="flex">
        <MainArea />
      </div>
      <PanelRegion />
    </QueryClientProvider>,
  );
}

const region = (name: 'main' | 'panel') => document.querySelector<HTMLElement>(`[data-region="${name}"]`)!;
const editorIn = (name: 'main' | 'panel') => {
  const element = region(name).querySelector<HTMLElement>('.cm-editor');
  return element ? EditorView.findFromDOM(element) : null;
};
const type = (view: EditorView, text: string) => act(() => view.dispatch({ changes: { from: 0, insert: text }, userEvent: 'input.type', annotations: isolateHistory.of('full') }));
const sideTabs = (id: AppSessionId) => (panelOf(id)?.tabs ?? []).filter((tab) => tab.toolId === 'files');
const sideTabOf = (path: string, id: AppSessionId = A) => sideTabs(id).find((tab) => (useLayout.getState().panelParams[tab.id] as { file?: string } | undefined)?.file === path)?.id;
const mainTabOf = (path: string) => allTabs(useLayout.getState().main).find((tab) => tab.id === KEY(path));
const front = () => activeTab(useLayout.getState().main)?.id;
const closedIds = () => useLayout.getState().main.closedTabs.map((tab) => tab.id);
const documentOf = (path: string) => existingViewState(KEY(path))?.docOf?.();
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

// The editor in `name` showing the text it is given, and editable.
async function editorShowing(name: 'main' | 'panel', text: string): Promise<EditorView> {
  await waitFor(() => {
    expect(editorIn(name)?.state.doc.toString()).toBe(text);
    expect(editorIn(name)?.state.facet(EditorView.editable)).toBe(true);
  });
  return editorIn(name)!;
}

async function openBeside(path: string, options: { keep?: boolean } = {}): Promise<EditorView> {
  act(() => void openFile(A, path, null, options));
  await waitFor(() => expect(region('panel').querySelector('[data-files-tab]')?.getAttribute('data-file')).toBe(path));
  return editorShowing('panel', disk.files[path] as string);
}

async function openInMain(path: string): Promise<EditorView> {
  act(() => void openFile(A, path, null, { main: true }));
  return editorShowing('main', disk.files[path] as string);
}

// Undoes the editor's history twice: back to the text before the first typing.
const undoTwice = (view: EditorView) => act(() => {
  undo(view);
  undo(view);
});

async function menuItem(target: HTMLElement, name: string): Promise<HTMLElement> {
  fireEvent.contextMenu(target);
  return within(await screen.findByRole('menu')).getByRole('menuitem', { name });
}

const panelTabElement = (id: string) => region('panel').querySelector<HTMLElement>(`[data-tab-id="${id}"]`)!;
const mainTabElement = (id: string) => region('main').querySelector<HTMLElement>(`[data-tab-id="${id}"]`)!;

// ---- to the main area ----------------------------------------------------------------------------------------------------

describe('a file beside the chat moves to the main area', () => {
  const ways: [string, (tabId: string) => Promise<void> | void][] = [
    ['its tab’s menu', async (tabId) => fireEvent.click(await menuItem(panelTabElement(tabId), TRANSFER_COPY.moveToMain))],
    ['the button in its bar', () => fireEvent.click(region('panel').querySelector<HTMLElement>('[data-move-to-main]')!)],
    ['View ▸ Move to tab', () => act(() => runAction('artifact.moveToTab'))],
    ['a drag onto the main strip', (tabId) => {
      const dt = transfer();
      drag('dragStart', panelTabElement(tabId), dt);
      const strip = within(region('main')).getByRole('tablist');
      expect(drag('dragOver', strip, dt)).toBe(true);
      drag('drop', strip, dt);
    }],
    ['a drag onto a pane’s body', (tabId) => {
      const dt = transfer();
      drag('dragStart', panelTabElement(tabId), dt);
      const target = document.querySelector<HTMLElement>('[data-pane-drop-target="0"]')!;
      expect(drag('dragOver', target, dt)).toBe(true);
      drag('drop', target, dt);
    }],
    ['a drag onto the right edge', (tabId) => {
      const dt = transfer();
      drag('dragStart', panelTabElement(tabId), dt);
      const edge = screen.getByTestId('drop-edge');
      expect(drag('dragOver', edge, dt)).toBe(true);
      drag('drop', edge, dt);
    }],
  ];

  it.each(ways)('by %s: the text typed just before is there once, in front, and two undos take back both typings', async (_, act_) => {
    renderBoth();
    const side = await openBeside(APP);
    const tabId = sideTabOf(APP)!;
    type(side, '// one\n');
    await act_(tabId);
    expect(sideTabs(A)).toEqual([]);
    expect(mainTabOf(APP)).toMatchObject({ kind: 'file', path: APP, appSessionId: A });
    expect(front()).toBe(KEY(APP));
    const main = await editorShowing('main', `// one\n${ORIGINAL}`);
    expect(editorIn('panel')).toBeNull();
    type(main, '// two\n');
    undoTwice(main);
    expect(main.state.doc.toString()).toBe(ORIGINAL);
    expect(closedIds()).not.toContain(KEY(APP)); // a move is not a close
    expect(useLayout.getState().dragging).toBeNull();
  });

  it('is one step: the main tab and the side list are both written before any microtask runs', async () => {
    renderBoth();
    await openBeside(APP);
    const tabId = sideTabOf(APP)!;
    act(() => {
      expect(moveFileToMain(tabId)).toBe(true);
      expect(mainTabOf(APP)).toBeDefined();
      expect(sideTabOf(APP)).toBeUndefined();
    });
  });

  it('drops the file’s side tabs from every session’s list in the same step (rule 3)', async () => {
    renderBoth();
    await openBeside(APP, { keep: true });
    act(() => void openFile(B, APP, null, { keep: true }));
    act(() => useLayout.getState().activateTab(`session:${A}`));
    expect(sideTabOf(APP, B)).toBeDefined();
    act(() => void moveFileToMain(sideTabOf(APP)!));
    expect([sideTabOf(APP), sideTabOf(APP, B)]).toEqual([undefined, undefined]);
    expect(allTabs(useLayout.getState().main).filter((tab) => tab.id === KEY(APP))).toHaveLength(1);
  });

  it('⌘-click on a path whose file is beside the chat makes it a main tab with its typed text and its undo', async () => {
    renderBoth();
    const side = await openBeside(APP);
    type(side, '// one\n');
    act(() => void openFile(A, APP, null, { main: true }));
    expect(sideTabs(A)).toEqual([]);
    const main = await editorShowing('main', `// one\n${ORIGINAL}`);
    act(() => void undo(main));
    expect(main.state.doc.toString()).toBe(ORIGINAL);
  });

  it('refuses a side tab whose close is being asked, with its sentence, and moves nothing', async () => {
    renderBoth();
    const side = await openBeside(APP, { keep: true });
    type(side, '// mine\n');
    await waitFor(() => expect(useViewer.getState().entries.get(KEY(APP))?.dirty).toBe(true));
    const tabId = sideTabOf(APP)!;
    act(() => void panelHost.closeTab(tabId)); // the question stays open
    await waitFor(() => expect(usePanelHost.getState().closing.has(tabId)).toBe(true));
    expect(transferRefusal({ to: 'tab', panelTabId: tabId })).toBe(TRANSFER_COPY.closing);
    expect(moveFileToMain(tabId)).toBe(false);
    expect(mainTabOf(APP)).toBeUndefined();
    expect(sideTabOf(APP)).toBe(tabId);
  });
});

// ---- beside the chat -----------------------------------------------------------------------------------------------------

describe('a main file tab moves beside the chat', () => {
  const ways: [string, (key: string) => Promise<void> | void][] = [
    ['its tab’s menu', async (key) => fireEvent.click(await menuItem(mainTabElement(key), TRANSFER_COPY.moveToPanel))],
    ['View ▸ Move to side surface', () => act(() => runAction('artifact.moveToPanel'))],
    ['a drag onto the side column', (key) => {
      const dt = transfer();
      drag('dragStart', mainTabElement(key), dt);
      const target = screen.getByTestId('panel-drop-target');
      expect(drag('dragOver', target, dt)).toBe(true);
      drag('drop', target, dt);
    }],
  ];

  it.each(ways)('by %s: kept, in view beside its session’s chat with that session in front, with the text typed just before and its undo', async (_, act_) => {
    renderBoth();
    const main = await openInMain(APP);
    type(main, '// one\n');
    await act_(KEY(APP));
    expect(mainTabOf(APP)).toBeUndefined();
    const tabId = sideTabOf(APP)!;
    expect(useLayout.getState().panelParams[tabId]).toEqual({ file: APP, line: null }); // kept, not the preview
    expect(front()).toBe(`session:${A}`);
    const side = await editorShowing('panel', `// one\n${ORIGINAL}`);
    expect(region('panel').querySelector('[data-files-tab]')?.getAttribute('data-file')).toBe(APP);
    type(side, '// two\n');
    undoTwice(side);
    expect(side.state.doc.toString()).toBe(ORIGINAL);
    expect(closedIds()).not.toContain(KEY(APP));
  });

  it('is one step: the side tab and the main strip are both written before any microtask runs', async () => {
    renderBoth();
    await openInMain(APP);
    act(() => {
      expect(moveFileToSide(KEY(APP))).toBe(true);
      expect(sideTabOf(APP)).toBeDefined();
      expect(mainTabOf(APP)).toBeUndefined();
    });
  });

  it('opens the session’s tab when the main area has none, and the file lands in its list', async () => {
    renderBoth();
    await openInMain(APP);
    act(() => useLayout.getState().closeTab(`session:${A}`, { remember: false }));
    act(() => void moveFileToSide(KEY(APP)));
    expect(front()).toBe(`session:${A}`);
    expect(sideTabOf(APP)).toBeDefined();
  });

  it('refuses a file with no session, or one the window does not know, with its sentence, in the menu and as a notice', async () => {
    useLayout.setState({ main: { ...mainShowing(A), panes: [{ tabs: [{ id: KEY(APP), kind: 'file', path: APP, line: null, appSessionId: null, machine: TEST_MACHINE, pinned: false }], activeTabId: KEY(APP) }] } });
    renderBoth();
    expect(transferRefusal({ to: 'panel', mainTabId: KEY(APP) })).toBe(TRANSFER_COPY.noSession);
    const item = await menuItem(mainTabElement(KEY(APP)), TRANSFER_COPY.moveToPanel);
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.getAttribute('title')).toBe(TRANSFER_COPY.noSession);
    fireEvent.keyDown(item, { key: 'Escape' });
    act(() => runAction('artifact.moveToPanel'));
    expect(useNotices.getState().notices.map((notice) => notice.text)).toEqual([TRANSFER_COPY.noSession]);
    expect(moveFileToSide(KEY(APP))).toBe(false);

    act(() => useLayout.setState({ knownSession: (id) => id !== B, main: { ...mainShowing(A), panes: [{ tabs: [{ id: KEY(APP), kind: 'file', path: APP, line: null, appSessionId: B, machine: TEST_MACHINE, pinned: false }], activeTabId: KEY(APP) }] } }));
    expect(transferRefusal({ to: 'panel', mainTabId: KEY(APP) })).toBe(TRANSFER_COPY.noSession);
    expect(moveFileToSide(KEY(APP))).toBe(false);
    expect(mainTabOf(APP)).toBeDefined();
  });

  it('a move leaves nothing for Reopen closed tab, either way', async () => {
    renderBoth();
    await openInMain(APP);
    act(() => void expect(moveFileToSide(KEY(APP))).toBe(true));
    act(() => void expect(moveFileToMain(sideTabOf(APP)!)).toBe(true));
    expect(closedIds()).toEqual([]);
    act(() => runAction('tab.reopen'));
    expect(allTabs(useLayout.getState().main).filter((tab) => tab.id === KEY(APP))).toHaveLength(1);
    expect(sideTabs(A)).toEqual([]);
  });
});

// ---- Reopen closed tab (Decision 18; sequence 9) ---------------------------------------------------------------------------

describe('Reopen closed tab on a file that is beside the chat', () => {
  it('brings the main tab back with the text typed beside the chat, one undo removing it, and leaves no side tab and no history entry', async () => {
    renderBoth();
    await openInMain(APP);
    act(() => runAction('tab.close')); // clean: closed at once, remembered
    await waitFor(() => expect(mainTabOf(APP)).toBeUndefined());
    expect(closedIds()).toContain(KEY(APP));
    act(() => useLayout.getState().activateTab(`session:${A}`));
    await openBeside(APP);
    act(() => void openFile(B, APP, null, { keep: true })); // another session's list holds it too
    act(() => useLayout.getState().activateTab(`session:${A}`));
    const side = await editorShowing('panel', ORIGINAL); // drawn again beside A's chat
    type(side, '// mine\n');
    act(() => runAction('tab.reopen'));
    expect(mainTabOf(APP)).toBeDefined();
    expect([sideTabOf(APP), sideTabOf(APP, B)]).toEqual([undefined, undefined]);
    expect(closedIds()).not.toContain(KEY(APP));
    const main = await editorShowing('main', `// mine\n${ORIGINAL}`);
    act(() => void undo(main));
    expect(main.state.doc.toString()).toBe(ORIGINAL);
  });
});

// ---- the viewer's hold (Decision 20b; sequence 11) -------------------------------------------------------------------------

describe('the editor’s state across a move, at the viewer’s cap', () => {
  // Twenty other files with unsaved edits, each in a main tab not in front: none is the cap's to take.
  function twentyUnsaved() {
    for (let i = 0; i < VIEWER_ENTRIES_MAX; i++) {
      const path = `/r/x${i}.ts`;
      act(() => useLayout.getState().openTab({ kind: 'file', path, line: null, appSessionId: A, machine: TEST_MACHINE }, { activate: false }));
      const off = useViewer.getState().mount(KEY(path), { appSessionId: A, path, line: null });
      act(() => useViewer.getState().setDirty(KEY(path), true));
      act(off);
    }
    expect(useViewer.getState().entries.size).toBeGreaterThan(VIEWER_ENTRIES_MAX);
  }

  it.each([['to the main area'], ['beside the chat']])('a clean file with an undo history moved %s keeps its history and its scroll', async (direction) => {
    renderBoth();
    const toMain = direction === 'to the main area';
    const view = toMain ? await openBeside(APP, { keep: true }) : await openInMain(APP);
    type(view, '// mine\n');
    await waitFor(() => expect(useViewer.getState().entries.get(KEY(APP))?.dirty).toBe(true));
    expect(await act(() => useViewer.getState().save(KEY(APP)))).toBe('ok');
    expect(useViewer.getState().entries.get(KEY(APP))?.dirty).toBe(false);
    view.scrollDOM.scrollTop = 120;
    expect(view.scrollDOM.scrollTop).toBe(120);
    twentyUnsaved();
    act(() => void (toMain ? moveFileToMain(sideTabOf(APP)!) : moveFileToSide(KEY(APP))));
    const moved = await editorShowing(toMain ? 'main' : 'panel', `// mine\n${ORIGINAL}`);
    expect(existingViewState(KEY(APP))?.codeScroll).toBe(120);
    act(() => void undo(moved));
    expect(moved.state.doc.toString()).toBe(ORIGINAL);
  });

  it('a save that settles in the turn before the move, with the store over its cap, leaves the entry and its history', async () => {
    renderBoth();
    const view = await openBeside(APP, { keep: true });
    type(view, '// mine\n');
    await waitFor(() => expect(useViewer.getState().entries.get(KEY(APP))?.dirty).toBe(true));
    twentyUnsaved();
    const write = disk.hold('files.write');
    const saving = useViewer.getState().save(KEY(APP));
    await waitFor(() => expect(useViewer.getState().entries.get(KEY(APP))?.saving).toBe(true));
    await act(async () => {
      write.release();
      expect(await saving).toBe('ok');
      expect(useViewer.getState().entries.get(KEY(APP))).toMatchObject({ dirty: false, saving: false }); // evictable now
      expect(moveFileToMain(sideTabOf(APP)!)).toBe(true);
    });
    const moved = await editorShowing('main', `// mine\n${ORIGINAL}`);
    act(() => void undo(moved));
    expect(moved.state.doc.toString()).toBe(ORIGINAL);
  });

  it('a side file with unsaved edits whose tab is not in view keeps its entry and text while another file opens beside the chat', async () => {
    renderBoth();
    const view = await openBeside(APP, { keep: true });
    type(view, '// mine\n');
    await openBeside(LIB);
    await openBeside(OTHER); // the preview reused, and mounted
    await settle();
    expect(useViewer.getState().entries.get(KEY(APP))?.dirty).toBe(true);
    expect(documentOf(APP)).toBe(`// mine\n${ORIGINAL}`);
  });
});

// ---- a drag whose source changes (sequence 7) ------------------------------------------------------------------------------

describe('a file tab’s drag whose source changes', () => {
  it('a tab closed mid-drag ends the drag, and a drop that arrives then moves nothing', async () => {
    renderBoth();
    await openBeside(APP);
    const tabId = sideTabOf(APP)!;
    const dt = transfer();
    drag('dragStart', panelTabElement(tabId), dt);
    expect(useLayout.getState().dragging).toMatchObject({ source: 'panel', tabId, toolId: 'files' });
    await act(() => panelHost.closeTab(tabId));
    expect(useLayout.getState().dragging).toBeNull();
    const strip = within(region('main')).getByRole('tablist');
    expect(drag('dragOver', strip, dt)).toBe(false);
    drag('drop', strip, dt);
    expect(mainTabOf(APP)).toBeUndefined();
  });

  it('a preview tab given another file mid-drag ends the drag', async () => {
    renderBoth();
    await openBeside(APP);
    const tabId = sideTabOf(APP)!;
    drag('dragStart', panelTabElement(tabId), transfer());
    expect(useLayout.getState().dragging).not.toBeNull();
    act(() => void openFile(A, LIB));
    expect(sideTabOf(LIB)).toBe(tabId); // the same tab, replaced
    expect(useLayout.getState().dragging).toBeNull();
  });
});

// ---- the stored writes of a real move (Decision 19; sequence 10) --------------------------------------------------------------

describe('a move’s stored writes', () => {
  // A main process recording each layout write, answering main.tabs only when released.
  function recordingMain() {
    const sets: string[] = [];
    let release: (() => void) | null = null;
    const client = {
      localMachine: TEST_MACHINE,
      invoke(name: string, input: { key: string }) {
        if (name !== 'layout.set') return window.maws.invoke(name as never, input as never);
        sets.push(input.key);
        if (input.key !== 'main.tabs' || release !== null) return Promise.resolve({ ok: true, value: undefined });
        return new Promise((resolve) => (release = () => resolve({ ok: true, value: undefined })));
      },
      on: () => () => {},
    } as unknown as MawsBridge;
    return { client, sets, release: () => release?.() };
  }

  it('a move to the main area writes main.tabs at once, and the session’s list only once main.tabs is answered', async () => {
    renderBoth();
    await openBeside(APP, { keep: true });
    const main = recordingMain();
    offs.push(persistLayout(main.client));
    const panelKey = `panel.${A}`;
    act(() => void moveFileToMain(sideTabOf(APP)!));
    expect(main.sets).toEqual(['main.tabs']);
    await act(() => new Promise((resolve) => setTimeout(resolve, 400))); // past the write delay
    expect(main.sets).not.toContain(panelKey);
    await act(async () => main.release());
    await settle();
    expect(main.sets.indexOf(panelKey)).toBeGreaterThan(main.sets.indexOf('main.tabs'));
  });
});
