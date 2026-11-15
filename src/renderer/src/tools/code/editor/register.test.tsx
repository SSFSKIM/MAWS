// The editor's registrations (E5 execution document, M2): the close sheet's three answers (`editor dialogs`), the
// `file` close guard and `file.save` over C5's runtime, and the strip's dirty mark (`tab mark`). UX wave U6b-1 (M2): the
// same question, ⌘S and Comment on this line for a file beside the chat.
import { isolateHistory } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS, type TabRef } from '@shared/ipc/schema/layout';
import { at, TEST_MACHINE } from '../../../../../../test/support/machine';
import { connectCodeEvents } from '../../../ipc/events';
import { replaceVerdict, requestCloseTab, runAction } from '../../../keymap/actions-runtime';
import { Tab } from '../../../main/Tab';
import { panelHost, registerPanelTool } from '../../../panel/host';
import { surfaceTabs } from '../../../panel/surface-model';
import { useLayout } from '../../../stores/layout';
import { activeTab, allTabs } from '../../../stores/layout-model';
import { fakeHash, installDisk } from '../../../test-support/code-disk';
import { resetPanelStores, TestHost } from '../../../test-support/panel';
import { registerCommentComposer } from '../anchor/anchor';
import { filesTool } from '../files/FilesTool';
import { useFiles } from '../files/store';
import { connectSideFiles } from '../files/tabs';
import { openFile, resetKeptOpens } from '../open-file';
import { FileViewer } from '../viewer/FileViewer';
import { existingViewState, useViewer } from '../viewer/viewer-store';
import { EditorDialogs, useEditorDialog } from './EditorDialogs';
import { focusedFile, registerEditor, sideFilesViewer } from './register';

const A = at('app-a' as AppSessionId); // P5 O6 M2: the page's address
const APP = '/r/app.ts';
const ID = `file:${TEST_MACHINE}:${APP}`;

const fileTab = (path = APP): Extract<TabRef, { kind: 'file' }> => ({ id: `file:${TEST_MACHINE}:${path}`, kind: 'file', path, line: null, appSessionId: A, machine: TEST_MACHINE, pinned: false });
const entry = () => useViewer.getState().entries.get(ID)!;
const view = () => EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;
const type = (text: string) => act(() => view().dispatch({ changes: { from: 0, insert: text }, userEvent: 'input.type', annotations: isolateHistory.of('full') }));
const tabOpen = () => allTabs(useLayout.getState().main).some((tab) => tab.id === ID);
const sheet = () => document.querySelector<HTMLElement>('[data-editor-close]');

describe('editor registrations', () => {
  const offs: (() => void)[] = [];
  // CodeView's chunk loaded once up front, so no case's first wait pays for it.
  beforeAll(() => import('../viewer/CodeView'));
  beforeEach(() => {
    useViewer.getState().reset();
    useFiles.getState().reset();
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, hydrated: true });
    useEditorDialog.setState({ open: null });
    offs.push(registerEditor());
  });
  afterEach(() => {
    cleanup();
    offs.splice(0).forEach((off) => off());
  });

  // app.ts open in the layout and shown, edited when `dirty`, with the dialogs mounted as App.tsx mounts them.
  async function openApp({ dirty }: { dirty: boolean }) {
    const disk = installDisk({ [APP]: 'const a = 1;\n' });
    offs.push(connectCodeEvents());
    openFile(A, APP, null, { main: true });
    const shown = render(
      <>
        <FileViewer tab={fileTab()} />
        <EditorDialogs />
      </>,
    );
    await waitFor(() => expect(view()?.state.facet(EditorView.editable)).toBe(true));
    if (dirty) {
      type('// mine\n');
      await waitFor(() => expect(entry().dirty).toBe(true));
    }
    return { disk, shown };
  }

  // E11 F2b (plan 2.5): opening a session in a file tab's place keeps a file with unsaved changes, and says so
  describe('replace verdict', () => {
    it('a clean file gives its place; an edited one stays, named', async () => {
      await openApp({ dirty: false });
      expect(replaceVerdict(fileTab())).toBeNull();
      type('// mine\n');
      await waitFor(() => expect(entry().dirty).toBe(true));
      expect(replaceVerdict(fileTab())).toEqual({ keep: 'app.ts has unsaved changes' });
      expect(sheet(), 'nothing asked').toBeNull();
    });
  });

  describe('editor dialogs', () => {
    it('closes a clean file tab at once, without the sheet', async () => {
      const { disk } = await openApp({ dirty: false });
      await act(() => requestCloseTab(ID));
      expect(tabOpen()).toBe(false);
      expect(sheet()).toBeNull();
      expect(disk.callsOf('files.write')).toHaveLength(0);
    });

    it('asks before closing a dirty tab: Cancel and Escape keep it dirty, Don’t save closes it with the disk unchanged', async () => {
      const { disk } = await openApp({ dirty: true });
      let closing = requestCloseTab(ID);
      const asked = await screen.findByRole('dialog', { name: 'Save changes to app.ts?' });
      expect(within(asked).getByText('Your changes will be lost if you don’t save them.')).toBeTruthy();
      expect(document.activeElement).toBe(within(asked).getByRole('button', { name: 'Save' })); // Enter saves
      fireEvent.click(within(asked).getByRole('button', { name: 'Cancel' }));
      await act(() => closing);
      expect(tabOpen()).toBe(true);
      expect(entry().dirty).toBe(true);

      closing = requestCloseTab(ID);
      await screen.findByRole('dialog', { name: 'Save changes to app.ts?' });
      await userEvent.keyboard('{Escape}');
      await act(() => closing);
      expect(tabOpen()).toBe(true);

      closing = requestCloseTab(ID);
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Don’t save' }));
      await act(() => closing);
      expect(tabOpen()).toBe(false);
      expect(sheet()).toBeNull();
      expect(disk.files[APP]).toBe('const a = 1;\n');
      expect(disk.callsOf('files.write')).toHaveLength(0);
    });

    it('saves and closes on Save, from the document a hidden tab left behind', async () => {
      const { disk, shown } = await openApp({ dirty: true });
      shown.rerender(<EditorDialogs />); // the tab is no longer shown; its entry and document stay
      expect(document.querySelector('.cm-editor')).toBeNull();
      const closing = requestCloseTab(ID);
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }));
      await act(() => closing);
      expect(disk.files[APP]).toBe('// mine\nconst a = 1;\n');
      expect(tabOpen()).toBe(false);
    });

    it('keeps the tab when typing lands while the guard’s Save writes: the typing stays, dirty against what was saved', async () => {
      const { disk } = await openApp({ dirty: true });
      const write = disk.hold('files.write');
      const closing = requestCloseTab(ID);
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(disk.callsOf('files.write')).toHaveLength(1));
      expect(sheet()).toBeNull(); // the sheet closed on submit; the editor takes typing again
      act(() => view().dispatch({ changes: { from: view().state.doc.length, insert: '// more\n' }, userEvent: 'input.type' }));
      await act(async () => write.release());
      await act(() => closing);
      expect(tabOpen()).toBe(true);
      expect(disk.files[APP]).toBe('// mine\nconst a = 1;\n');
      expect(view().state.doc.toString()).toBe('// mine\nconst a = 1;\n// more\n');
      expect(entry()).toMatchObject({ text: '// mine\nconst a = 1;\n', saving: false, dirty: true });
    });

    it('keeps the tab when the guard’s Save finds the file changed, now showing the merge view', async () => {
      const { disk } = await openApp({ dirty: true });
      disk.files[APP] = 'const a = 2;\n'; // no event: the save finds it
      const closing = requestCloseTab(ID);
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }));
      await act(() => closing);
      expect(tabOpen()).toBe(true);
      expect(entry().theirs).toEqual({ text: 'const a = 2;\n', hash: fakeHash('const a = 2;\n'), view: 'merge' });
      expect(disk.files[APP]).toBe('const a = 2;\n');
    });

    // Whole-branch review: a save from the merge view sends the hash the merge shows, so the sheet's default button
    // would write the unresolved document over the disk's change.
    it('never saves a tab in the merge view: the guard keeps it, brings it to the front and writes nothing', async () => {
      const { disk } = await openApp({ dirty: true });
      disk.files[APP] = 'const a = 2;\n'; // no event: the save finds it
      await act(async () => void (await useViewer.getState().save(ID)));
      expect(entry().theirs?.view).toBe('merge');
      act(() => useLayout.getState().openTab({ kind: 'session', appSessionId: at('app-s' as AppSessionId) }));
      expect(activeTab(useLayout.getState().main)?.id).not.toBe(ID);
      await act(() => requestCloseTab(ID));
      expect(sheet()).toBeNull();
      expect(tabOpen()).toBe(true);
      expect(activeTab(useLayout.getState().main)?.id).toBe(ID);
      expect(disk.callsOf('files.write')).toHaveLength(1); // the save that found the change, only
      expect(disk.files[APP]).toBe('const a = 2;\n');
      expect(entry()).toMatchObject({ dirty: true, theirs: { view: 'merge' } });
    });
  });

  describe('file.save', () => {
    it('saves the focused pane’s file tab, and writes nothing while a session tab is active', async () => {
      const { disk } = await openApp({ dirty: true });
      act(() => useLayout.getState().openTab({ kind: 'session', appSessionId: at('app-s' as AppSessionId) }));
      runAction('file.save');
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
      expect(disk.callsOf('files.write')).toHaveLength(0);
      act(() => useLayout.getState().activateTab(ID));
      runAction('file.save');
      await waitFor(() => expect(disk.files[APP]).toBe('// mine\nconst a = 1;\n'));
      expect(disk.callsOf('files.write')).toHaveLength(1);
    });

    // UX wave U7b (§N, the second table): a changed file's tab behind a page is not the focused one.
    it('does not save a changed file’s tab behind a page, and the same key after Back saves it', async () => {
      const { disk } = await openApp({ dirty: true });
      act(() => useLayout.getState().openDestination({ kind: 'projects' }));
      runAction('file.save');
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
      expect(disk.callsOf('files.write')).toHaveLength(0);
      act(() => useLayout.getState().closeDestination());
      runAction('file.save');
      await waitFor(() => expect(disk.callsOf('files.write')).toHaveLength(1));
    });
  });

  describe('tab mark', () => {
    const strip = (tab: TabRef) => render(<Tab tab={tab} pane={0} domId={`tab-${tab.id}`} active stop onKeyDown={() => {}} />);

    it('marks a dirty file tab with a dot and data-dirty, and no other tab', async () => {
      await openApp({ dirty: true });
      const marked = strip(fileTab());
      const tab = marked.getByRole('tab', { name: 'app.ts' });
      expect(tab.getAttribute('data-dirty')).toBe('true');
      expect(within(tab).getByRole('img', { name: 'Unsaved changes' }).textContent).toBe('•');
      marked.unmount();
      const session = strip({ id: `session:${at('app-s')}`, kind: 'session', appSessionId: at('app-s' as AppSessionId), pinned: false });
      expect(session.container.querySelector('[data-dirty]')).toBeNull();
      expect(session.queryByRole('img', { name: 'Unsaved changes' })).toBeNull();
    });

    it('shows no mark for a clean file tab, and drops it once saved', async () => {
      const { disk } = await openApp({ dirty: true });
      const marked = strip(fileTab());
      expect(marked.queryByRole('img', { name: 'Unsaved changes' })).not.toBeNull();
      await act(async () => void (await useViewer.getState().save(ID)));
      expect(disk.files[APP]).toBe('// mine\nconst a = 1;\n');
      expect(marked.queryByRole('img', { name: 'Unsaved changes' })).toBeNull();
      expect(marked.getByRole('tab').hasAttribute('data-dirty')).toBe(false);
    });
  });
});

// ---- a file beside the chat (UX wave U6b-1, M2) ------------------------------------------------------------------------
// Its close asks what a main file tab's close asks, by the file's key (`closeGuardOf`), and its answer acts only on the
// tab that asked while it still holds the file (sequence 2); ⌘S and Comment on this line act on the file whose viewer
// holds the keyboard, else on the main tab on screen when it is a file (R4). Over the fake disk, with the panel host as
// C5's region hands it its props and the dialogs mounted as App.tsx mounts them.
describe('a file beside the chat as an editor', () => {
  const LIB = '/r/lib.ts';
  const LIB_ID = `file:${TEST_MACHINE}:${LIB}`;
  const offs: (() => void)[] = [];
  let disk: ReturnType<typeof installDisk>;
  beforeAll(() => import('../viewer/CodeView'));
  beforeEach(() => {
    resetPanelStores();
    resetKeptOpens();
    useViewer.getState().reset();
    useFiles.getState().reset();
    useEditorDialog.setState({ open: null });
    disk = installDisk({ [APP]: 'const a = 1;\n', [LIB]: 'export const b = 2;\n' });
    offs.push(registerPanelTool(filesTool), registerEditor(), connectSideFiles(sideFilesViewer), connectCodeEvents());
  });
  afterEach(() => {
    cleanup();
    offs.splice(0).forEach((off) => off());
    resetKeptOpens();
  });

  const sideTabs = () => (useLayout.getState().panelBySession.get(A)?.tabs ?? []).filter((tab) => tab.toolId === 'files');
  const sideEditor = () => {
    const element = document.querySelector<HTMLElement>('[data-files-tab] .cm-editor');
    return element ? EditorView.findFromDOM(element) : null;
  };
  const mainEditor = () => EditorView.findFromDOM(document.querySelector<HTMLElement>('[data-main-file] .cm-editor')!)!;
  const typeIn = (target: EditorView, text: string) => act(() => target.dispatch({ changes: { from: 0, insert: text }, userEvent: 'input.type', annotations: isolateHistory.of('full') }));
  const closeSide = (tabId: string) => panelHost.closeTab(tabId);
  const docOf = (key: string) => existingViewState(key)?.docOf?.() ?? useViewer.getState().entries.get(key)?.text;

  // app.ts beside A's chat (kept, so a later open adds beside it), edited when `dirty`; lib.ts as a main tab when `main`.
  async function openBeside({ dirty, main = false }: { dirty: boolean; main?: boolean }) {
    act(() => void openFile(A, APP, null, { keep: true }));
    if (main) act(() => void openFile(A, LIB, null, { main: true }));
    render(
      <>
        <TestHost />
        {main ? <div data-main-file><FileViewer tab={fileTab(LIB)} /></div> : null}
        <textarea aria-label="composer" />
        <EditorDialogs />
      </>,
    );
    await waitFor(() => expect(sideEditor()?.state.facet(EditorView.editable)).toBe(true));
    if (main) await waitFor(() => expect(mainEditor().state.facet(EditorView.editable)).toBe(true));
    if (dirty) {
      typeIn(sideEditor()!, '// mine\n');
      await waitFor(() => expect(entry().dirty).toBe(true));
    }
    const [tab] = sideTabs();
    return tab.id;
  }

  describe('its close (L4; sequence 2)', () => {
    it('closes a clean side tab at once, without the sheet', async () => {
      const tabId = await openBeside({ dirty: false });
      await act(() => closeSide(tabId));
      expect(sideTabs()).toEqual([]);
      expect(sheet()).toBeNull();
    });

    it('asks as a main file tab asks: Cancel keeps it with its edit, Don’t save closes it, the disk unchanged and no main tab made', async () => {
      const tabId = await openBeside({ dirty: true });
      let closing = closeSide(tabId);
      const asked = await screen.findByRole('dialog', { name: 'Save changes to app.ts?' });
      expect(sheet()!.getAttribute('data-editor-close')).toBe(ID);
      fireEvent.click(within(asked).getByRole('button', { name: 'Cancel' }));
      expect(await act(() => closing)).toBe(false);
      expect(sideTabs().map((tab) => tab.id)).toEqual([tabId]);
      expect(entry().dirty).toBe(true);

      closing = closeSide(tabId);
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Don’t save' }));
      expect(await act(() => closing)).toBe(true);
      expect(sideTabs()).toEqual([]);
      expect(tabOpen()).toBe(false); // the answer let it go: no main tab keeps it
      expect(disk.files[APP]).toBe('const a = 1;\n');
      expect(disk.callsOf('files.write')).toHaveLength(0);
    });

    it('saves and closes on Save; a save that finds the file changed keeps the tab, now in the merge view', async () => {
      const tabId = await openBeside({ dirty: true });
      disk.files[APP] = 'const a = 2;\n'; // no event: the save finds it
      let closing = closeSide(tabId);
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }));
      expect(await act(() => closing)).toBe(false);
      expect(sideTabs().map((tab) => tab.id)).toEqual([tabId]);
      expect(entry().theirs?.view).toBe('merge');

      // in the merge view the close is vetoed and the tab comes into view, nothing written
      act(() => void openFile(A, LIB, null, { keep: true }));
      expect(surfaceTabs(useLayout.getState(), A).map((tab) => tab.id)).not.toContain(tabId);
      const writes = disk.callsOf('files.write').length;
      closing = closeSide(tabId);
      expect(await act(() => closing)).toBe(false);
      expect(sheet()).toBeNull();
      expect(surfaceTabs(useLayout.getState(), A).map((tab) => tab.id)).toContain(tabId);
      expect(disk.callsOf('files.write')).toHaveLength(writes);

      act(() => useViewer.getState().keepMine(ID)); // the disk's version adopted as the baseline, the edit standing
      closing = closeSide(tabId);
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }));
      expect(await act(() => closing)).toBe(true);
      expect(disk.files[APP]).toBe('// mine\nconst a = 1;\n');
      expect(sideTabs().map((tab) => tab.id)).not.toContain(tabId);
    });

    // Sequence 2: the person moves the file to the main area while the question is open (M4's move is one synchronous
    // step: the main tab opened and the side ref removed through the store, as here); the answer then changes nothing.
    it.each(['Don’t save', 'Save'])('with the question held open while the file moves to the main area, “%s” changes nothing: the main tab keeps the edit', async (answer) => {
      const tabId = await openBeside({ dirty: true });
      const closing = closeSide(tabId);
      const asked = await screen.findByRole('dialog');
      act(() => {
        useLayout.getState().openTab({ kind: 'file', path: APP, line: null, appSessionId: A, machine: TEST_MACHINE });
        useLayout.getState().updatePanelTabs(A, (refs) => refs.filter((ref) => ref.id !== tabId));
      });
      fireEvent.click(within(asked).getByRole('button', { name: answer }));
      await act(() => closing);
      expect(tabOpen()).toBe(true);
      expect(sideTabs()).toEqual([]);
      expect(entry().dirty).toBe(true);
      expect(docOf(ID)).toBe('// mine\nconst a = 1;\n');
      expect(disk.callsOf('files.write')).toHaveLength(0);
      expect(disk.files[APP]).toBe('const a = 1;\n');
    });

    it('a question never answered keeps the tab', async () => {
      const tabId = await openBeside({ dirty: true });
      void closeSide(tabId);
      await screen.findByRole('dialog');
      expect(sideTabs().map((tab) => tab.id)).toEqual([tabId]);
      expect(entry().dirty).toBe(true);
    });
  });

  describe('⌘S and Comment on this line (R4)', () => {
    it('saves the side file while the keyboard is in it, and not the main file tab on screen', async () => {
      await openBeside({ dirty: true, main: true });
      typeIn(mainEditor(), '// main\n');
      await waitFor(() => expect(useViewer.getState().entries.get(LIB_ID)?.dirty).toBe(true));
      expect(activeTab(useLayout.getState().main)?.id).toBe(LIB_ID);
      act(() => sideEditor()!.contentDOM.focus());
      runAction('file.save');
      await waitFor(() => expect(disk.files[APP]).toBe('// mine\nconst a = 1;\n'));
      expect(disk.callsOf('files.write').map((call) => call.path)).toEqual([APP]);
      expect(useViewer.getState().entries.get(LIB_ID)?.dirty).toBe(true);
    });

    it('with the keyboard elsewhere saves the main file tab on screen, as today, and leaves the side file unsaved', async () => {
      await openBeside({ dirty: true, main: true });
      typeIn(mainEditor(), '// main\n');
      await waitFor(() => expect(useViewer.getState().entries.get(LIB_ID)?.dirty).toBe(true));
      act(() => screen.getByRole('textbox', { name: 'composer' }).focus());
      runAction('file.save');
      await waitFor(() => expect(disk.files[LIB]).toBe('// main\nexport const b = 2;\n'));
      expect(disk.callsOf('files.write').map((call) => call.path)).toEqual([LIB]);
      expect(entry().dirty).toBe(true);
    });

    it('with a session’s tab in front and the keyboard in the composer saves nothing, and the side file stays unsaved', async () => {
      await openBeside({ dirty: true });
      expect(activeTab(useLayout.getState().main)?.kind).toBe('session');
      act(() => screen.getByRole('textbox', { name: 'composer' }).focus());
      runAction('file.save');
      expect(disk.callsOf('files.write')).toHaveLength(0);
      expect(entry()).toMatchObject({ dirty: true, saving: false });
    });

    // UX wave U7b (§N): the side column is not on screen behind a page, so its file holds no keyboard there.
    it('behind a page saves nothing, the keyboard left in the side file; after Back the same key saves it', async () => {
      await openBeside({ dirty: true });
      act(() => sideEditor()!.contentDOM.focus());
      act(() => useLayout.getState().openDestination({ kind: 'projects' }));
      runAction('file.save');
      expect(disk.callsOf('files.write')).toHaveLength(0);
      act(() => useLayout.getState().closeDestination());
      act(() => sideEditor()!.contentDOM.focus());
      runAction('file.save');
      await waitFor(() => expect(disk.files[APP]).toBe('// mine\nconst a = 1;\n'));
    });

    it('Comment on this line opens the composer on the side file’s cursor line while the keyboard is in it', async () => {
      const composer = vi.fn();
      offs.push(registerCommentComposer(composer));
      await openBeside({ dirty: false });
      act(() => runAction('file.commentLine'));
      expect(composer).not.toHaveBeenCalled(); // the keyboard is not in it, and a session's tab is in front
      act(() => sideEditor()!.contentDOM.focus());
      act(() => runAction('file.commentLine'));
      expect(composer).toHaveBeenCalledExactlyOnceWith({ kind: 'file-line', locator: `${APP}#L1`, label: 'app.ts:1', path: APP, line: 1 }, { appSessionId: A });
    });

    it('focusedFile names the side file that holds the keyboard, else the main file tab on screen, else nothing', async () => {
      await openBeside({ dirty: false, main: true });
      act(() => sideEditor()!.contentDOM.focus());
      expect(focusedFile()).toBe(ID);
      act(() => screen.getByRole('textbox', { name: 'composer' }).focus());
      expect(focusedFile()).toBe(LIB_ID);
      act(() => useLayout.getState().openSession(A));
      expect(focusedFile()).toBeNull();
    });
  });
});
