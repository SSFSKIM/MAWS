// The editor's registrations (E5 execution document, M2): the close sheet's three answers (`editor dialogs`), the
// `file` close guard and `file.save` over C5's runtime, and the strip's dirty mark (`tab mark`).
import { isolateHistory } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS, type TabRef } from '@shared/ipc/schema/layout';
import { connectCodeEvents } from '../../../ipc/events';
import { requestCloseTab, runAction } from '../../../keymap/actions-runtime';
import { Tab } from '../../../main/Tab';
import { useLayout } from '../../../stores/layout';
import { allTabs } from '../../../stores/layout-model';
import { fakeHash, installDisk } from '../../../test-support/code-disk';
import { useFiles } from '../files/store';
import { openFile } from '../open-file';
import { FileViewer } from '../viewer/FileViewer';
import { useViewer } from '../viewer/viewer-store';
import { EditorDialogs, useEditorDialog } from './EditorDialogs';
import { registerEditor } from './register';

const A = 'app-a' as AppSessionId;
const APP = '/r/app.ts';
const ID = `file:${APP}`;

const fileTab = (path = APP): Extract<TabRef, { kind: 'file' }> => ({ id: `file:${path}`, kind: 'file', path, line: null, appSessionId: A, pinned: false });
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
    useLayout.setState({ main: LAYOUT_DEFAULTS.main });
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
    openFile(A, APP);
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
  });

  describe('file.save', () => {
    it('saves the focused pane’s file tab, and writes nothing while a session tab is active', async () => {
      const { disk } = await openApp({ dirty: true });
      act(() => useLayout.getState().openTab({ kind: 'session', appSessionId: 'app-s' as AppSessionId }));
      runAction('file.save');
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
      expect(disk.callsOf('files.write')).toHaveLength(0);
      act(() => useLayout.getState().activateTab(ID));
      runAction('file.save');
      await waitFor(() => expect(disk.files[APP]).toBe('// mine\nconst a = 1;\n'));
      expect(disk.callsOf('files.write')).toHaveLength(1);
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
      const session = strip({ id: 'session:app-s', kind: 'session', appSessionId: 'app-s' as AppSessionId, pinned: false });
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
