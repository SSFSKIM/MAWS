// The code view's merge, conflict and comment modes (E5 execution document, M3): the merge view over the disk's version
// with its chunk controls and the bar's count (`code view editing`), git's conflict blocks decorated and resolved, the
// comment gutter producing X10's file-line anchor, and the placeholder sheet the anchor opens until E3 registers its
// composer (`editor dialogs`).
import { getChunks, getOriginalDoc } from '@codemirror/merge';
import { isolateHistory } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS, type TabRef } from '@shared/ipc/schema/layout';
import { connectCodeEvents } from '../../../ipc/events';
import { useLayout } from '../../../stores/layout';
import { fakeHash, installDisk, type DiskFile } from '../../../test-support/code-disk';
import { registerCommentComposer } from '../anchor/anchor';
import { useFiles } from '../files/store';
import { openFile } from '../open-file';
import { FileViewer } from '../viewer/FileViewer';
import { useViewer } from '../viewer/viewer-store';
import { EditorDialogs, useEditorDialog } from './EditorDialogs';
import { registerEditor } from './register'; // E11
import { runAction } from '../../../keymap/actions-runtime'; // E11

const A = 'app-a' as AppSessionId;
const MiB = 1024 * 1024;
const APP = '/r/app.ts';
const MERGE = '/r/conflicts/merge.ts';

const fileTab = (path: string): Extract<TabRef, { kind: 'file' }> => ({ id: `file:${path}`, kind: 'file', path, line: null, appSessionId: A, pinned: false });
const entry = (path = APP) => useViewer.getState().entries.get(`file:${path}`)!;
const view = () => EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;
const doc = () => view().state.doc.toString();
const lines = (...texts: string[]) => texts.map((text) => `${text}\n`).join('');
const numbered = (count: number, edit: Record<number, string> = {}) => lines(...Array.from({ length: count }, (_, i) => edit[i + 1] ?? `line ${i + 1}`));
const bar = () => document.querySelector<HTMLElement>('[data-editor-controls]');
const lineOf = (n: number) => document.querySelectorAll<HTMLElement>('.cm-content .cm-line')[n - 1];
// A line's comment mark, by its label (CodeMirror hides its gutters from the accessibility tree, so not by role).
const mark = (line: number) => document.querySelector<HTMLElement>(`.cm-comment-mark[aria-label="Comment on line ${line}"]`)!;
const settle = () =>act(() => new Promise((resolve) => setTimeout(resolve, 20)));

// The owner's edit: one undoable step.
const replaceLine = (n: number, text: string) =>
  act(() => {
    const line = view().state.doc.line(n);
    view().dispatch({ changes: { from: line.from, to: line.to, insert: text }, userEvent: 'input.type', annotations: isolateHistory.of('full') });
  });

describe('editor modes', () => {
  const offs: (() => void)[] = [];
  beforeAll(() => import('../viewer/CodeView'));
  beforeEach(() => {
    useViewer.getState().reset();
    useFiles.getState().reset();
    useLayout.setState({ main: LAYOUT_DEFAULTS.main });
    useEditorDialog.setState({ open: null });
  });
  afterEach(() => {
    cleanup();
    offs.splice(0).forEach((off) => off());
  });

  async function open(files: Record<string, DiskFile>, path = APP, { editable = true } = {}) {
    const disk = installDisk(files);
    offs.push(connectCodeEvents());
    openFile(A, path);
    const shown = render(
      <>
        <FileViewer tab={fileTab(path)} />
        <EditorDialogs />
      </>,
    );
    await waitFor(() => expect(entry(path)?.status).toBe('ready'));
    if (editable) await waitFor(() => expect(view()?.state.facet(EditorView.editable)).toBe(true));
    else await waitFor(() => expect(document.querySelector('.cm-content')).not.toBeNull());
    return { disk, shown };
  }

  // app.ts edited on line 2 while the disk changed line 8, the change seen and compared: two chunks in the merge view.
  async function merging() {
    const opened = await open({ [APP]: numbered(10) });
    replaceLine(2, 'mine 2');
    await waitFor(() => expect(entry().dirty).toBe(true));
    opened.disk.files[APP] = numbered(10, { 8: 'theirs 8' });
    act(() => opened.disk.emit('files.changed', { appSessionId: A, path: APP, kind: 'changed' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Compare' }));
    await waitFor(() => expect(document.querySelectorAll('.cm-deletedChunk')).toHaveLength(2));
    return opened;
  }
  const chunkControl = (chunk: number, name: 'Keep mine' | 'Take theirs') =>
    within(document.querySelectorAll<HTMLElement>('.cm-deletedChunk')[chunk]).getByRole('button', { name });
  const barButton = (name: string) => within(bar()!).getByRole('button', { name });

  describe('code view editing', () => {
    it('mounts the merge view on Compare: theirs as the original, chunk controls that name the sides, the bar counting the chunks', async () => {
      await merging();
      expect(document.querySelector('.cm-editor')?.classList.contains('cm-merge-b')).toBe(true);
      expect(getOriginalDoc(view().state).toString()).toBe(numbered(10, { 8: 'theirs 8' }));
      expect(getChunks(view().state)?.chunks).toHaveLength(2);
      expect(within(bar()!).getByText('2 changes from disk')).toBeTruthy();
      expect(bar()!.querySelector('[data-merge-changes]')?.getAttribute('data-merge-changes')).toBe('2');
      const controls = [...document.querySelectorAll<HTMLButtonElement>('.cm-deletedChunk button.cm-merge-control')].map((button) => button.textContent);
      expect(controls).toEqual(['Keep mine', 'Take theirs', 'Keep mine', 'Take theirs']);
      expect(doc()).toBe(numbered(10, { 2: 'mine 2' })); // the document is still mine
    });

    it('takes theirs for one chunk and keeps mine for the other, and Save writes the resolution against theirs’ hash', async () => {
      const { disk } = await merging();
      fireEvent.click(chunkControl(1, 'Take theirs'));
      await waitFor(() => expect(within(bar()!).getByText('1 change from disk')).toBeTruthy());
      expect(doc()).toBe(numbered(10, { 2: 'mine 2', 8: 'theirs 8' }));
      expect(getChunks(view().state)?.chunks).toHaveLength(1);
      fireEvent.click(chunkControl(0, 'Keep mine'));
      await waitFor(() => expect(within(bar()!).getByText('0 changes from disk')).toBeTruthy());
      expect(doc()).toBe(numbered(10, { 2: 'mine 2', 8: 'theirs 8' })); // keeping mine changes no line
      fireEvent.click(barButton('Save'));
      await waitFor(() => expect(disk.files[APP]).toBe(numbered(10, { 2: 'mine 2', 8: 'theirs 8' })));
      expect(disk.callsOf('files.write').at(-1)?.expectedHash).toBe(fakeHash(numbered(10, { 8: 'theirs 8' })));
      await waitFor(() => expect(entry()).toMatchObject({ theirs: null, dirty: false }));
      expect(document.querySelector('.cm-deletedChunk')).toBeNull();
      expect(getChunks(view().state)).toBeNull();
      expect(document.querySelector('.cm-editor')?.classList.contains('cm-merge-b')).toBe(false);
      expect(bar()).toBeNull();
    });

    it('steps through the chunks from the bar', async () => {
      await merging();
      const [first, second] = getChunks(view().state)!.chunks;
      fireEvent.click(barButton('Next change'));
      expect(view().state.selection.main.head).toBe(first.fromB);
      fireEvent.click(barButton('Next change'));
      expect(view().state.selection.main.head).toBe(second.fromB);
      fireEvent.click(barButton('Previous change'));
      expect(view().state.selection.main.head).toBe(first.fromB);
    });

    it('takes a newer disk version as the open merge view’s original', async () => {
      const { disk } = await merging();
      disk.files[APP] = numbered(10, { 8: 'theirs 8', 9: 'theirs 9' });
      act(() => disk.emit('files.changed', { appSessionId: A, path: APP, kind: 'changed' }));
      await waitFor(() => expect(getOriginalDoc(view().state).toString()).toBe(numbered(10, { 8: 'theirs 8', 9: 'theirs 9' })));
      expect(entry().theirs?.view).toBe('merge');
      expect(doc()).toBe(numbered(10, { 2: 'mine 2' }));
    });

    // E5 M4 (M3's review): a disk version the watcher never reported is still never overwritten by a resolution.
    it('answers a save from the merge view with conflict when the disk moved on unseen, keeping the resolution and taking the newer version as the original', async () => {
      const { disk } = await merging();
      fireEvent.click(chunkControl(1, 'Take theirs'));
      await waitFor(() => expect(within(bar()!).getByText('1 change from disk')).toBeTruthy());
      const resolution = numbered(10, { 2: 'mine 2', 8: 'theirs 8' });
      expect(doc()).toBe(resolution);
      const third = numbered(10, { 8: 'theirs 8', 10: 'third 10' });
      disk.files[APP] = third; // no files.changed: the watcher missed it
      fireEvent.click(barButton('Save'));
      await waitFor(() => expect(getOriginalDoc(view().state).toString()).toBe(third));
      const write = disk.callsOf('files.write').at(-1)!;
      expect(write.expectedHash).toBe(fakeHash(numbered(10, { 8: 'theirs 8' }))); // the version the merge view showed
      expect(disk.files[APP]).toBe(third); // nothing written over it
      expect(doc()).toBe(resolution);
      expect(entry()).toMatchObject({ saving: false, saveError: null, dirty: true, theirs: { view: 'merge', text: third, hash: fakeHash(third) } });
      expect(document.querySelector('.cm-editor')?.classList.contains('cm-merge-b')).toBe(true);
    });

    it('keeps the merge view’s resolution across a hidden tab', async () => {
      const { shown } = await merging();
      fireEvent.click(chunkControl(0, 'Keep mine')); // changes only the original
      await waitFor(() => expect(getChunks(view().state)?.chunks).toHaveLength(1));
      shown.rerender(<EditorDialogs />);
      shown.rerender(
        <>
          <FileViewer tab={fileTab(APP)} />
          <EditorDialogs />
        </>,
      );
      await waitFor(() => expect(document.querySelectorAll('.cm-deletedChunk')).toHaveLength(1));
      expect(getChunks(view().state)?.chunks).toHaveLength(1);
      expect(within(bar()!).getByText('1 change from disk')).toBeTruthy();
    });

    it('closes the merge view on Reload and on Keep mine', async () => {
      await merging();
      fireEvent.click(barButton('Reload'));
      await waitFor(() => expect(doc()).toBe(numbered(10, { 8: 'theirs 8' })));
      expect(document.querySelector('.cm-deletedChunk')).toBeNull();
      expect(getChunks(view().state)).toBeNull();
    });

    const CONFLICTED = lines('first', '<<<<<<< HEAD', 'mine', '||||||| base', 'base', '=======', 'theirs', '>>>>>>> feature', 'last');

    it('lays out a conflict block as mine, base and theirs with its actions and labels above it, counted in the bar', async () => {
      await open({ [MERGE]: CONFLICTED }, MERGE);
      await waitFor(() => expect(bar()?.textContent).toContain('1 conflict'));
      expect(bar()!.querySelector('[data-conflicts]')?.getAttribute('data-conflicts')).toBe('1');
      expect([2, 4, 6, 8].map((n) => lineOf(n).classList.contains('cm-conflict-marker'))).toEqual([true, true, true, true]);
      expect(lineOf(3).classList.contains('cm-conflict-mine')).toBe(true);
      expect(lineOf(5).classList.contains('cm-conflict-base')).toBe(true);
      expect(lineOf(7).classList.contains('cm-conflict-theirs')).toBe(true);
      expect([1, 9].map((n) => lineOf(n).className.includes('cm-conflict'))).toEqual([false, false]);
      const actions = document.querySelector<HTMLElement>('.cm-conflict-actions')!;
      expect(within(actions).getAllByRole('button').map((button) => button.textContent)).toEqual(['Accept mine', 'Accept theirs', 'Accept both']);
      expect([...actions.querySelectorAll('.cm-conflict-label')].map((label) => label.textContent)).toEqual(['mine (HEAD)', 'base', 'theirs (feature)']);
      expect(actions.compareDocumentPosition(lineOf(2)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // above the block
      expect(entry(MERGE).dirty).toBe(false);
    });

    for (const [choice, kept] of [
      ['Accept mine', ['mine']],
      ['Accept theirs', ['theirs']],
      ['Accept both', ['mine', 'theirs']],
    ] as const) {
      it(`resolves a block on ${choice}: no marker left, the counter gone, and Save writes it`, async () => {
        const { disk } = await open({ [MERGE]: CONFLICTED }, MERGE);
        fireEvent.click(await screen.findByRole('button', { name: choice }));
        await waitFor(() => expect(doc()).toBe(lines('first', ...kept, 'last')));
        expect(document.querySelector('.cm-conflict-actions')).toBeNull();
        expect(document.querySelector('[data-conflicts]')).toBeNull();
        await waitFor(() => expect(entry(MERGE).dirty).toBe(true));
        fireEvent.click(barButton('Save'));
        await waitFor(() => expect(disk.files[MERGE]).toBe(lines('first', ...kept, 'last')));
      });
    }

    it('steps through the blocks from the bar, and saves a document with blocks left as it is', async () => {
      const two = lines('top', '<<<<<<< HEAD', 'a', '=======', 'b', '>>>>>>> one', 'middle', '<<<<<<< HEAD', 'c', '=======', 'd', '>>>>>>> two');
      const { disk } = await open({ [MERGE]: two }, MERGE);
      await waitFor(() => expect(bar()?.textContent).toContain('2 conflicts'));
      const starts = [2, 8].map((n) => view().state.doc.line(n).from);
      fireEvent.click(barButton('Next conflict'));
      expect(view().state.selection.main.head).toBe(starts[0]);
      fireEvent.click(barButton('Next conflict'));
      expect(view().state.selection.main.head).toBe(starts[1]);
      fireEvent.click(barButton('Next conflict')); // wraps
      expect(view().state.selection.main.head).toBe(starts[0]);
      fireEvent.click(barButton('Previous conflict')); // wraps back
      expect(view().state.selection.main.head).toBe(starts[1]);
      fireEvent.click(within(document.querySelectorAll<HTMLElement>('.cm-conflict-actions')[1]).getByRole('button', { name: 'Accept theirs' }));
      await waitFor(() => expect(bar()?.textContent).toContain('1 conflict'));
      fireEvent.click(barButton('Save'));
      await waitFor(() => expect(disk.files[MERGE]).toBe(lines('top', '<<<<<<< HEAD', 'a', '=======', 'b', '>>>>>>> one', 'middle', 'd')));
    });

    it('finds a block typed into the document, and draws none over the merge view', async () => {
      const { disk } = await open({ [APP]: numbered(10) });
      act(() => view().dispatch({ changes: { from: 0, insert: lines('<<<<<<< HEAD', 'a', '=======', 'b', '>>>>>>> feature') }, userEvent: 'input.paste' }));
      await waitFor(() => expect(bar()?.textContent).toContain('1 conflict'));
      expect(document.querySelector('.cm-conflict-actions')).not.toBeNull();
      disk.files[APP] = numbered(10, { 8: 'theirs 8' });
      act(() => disk.emit('files.changed', { appSessionId: A, path: APP, kind: 'changed' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Compare' }));
      await waitFor(() => expect(document.querySelector('.cm-deletedChunk')).not.toBeNull());
      expect(document.querySelector('.cm-conflict-actions')).toBeNull();
      expect(document.querySelector('.cm-conflict-marker')).toBeNull();
      expect(document.querySelector('[data-conflicts]')).toBeNull();
    });

    it('offers no resolution in a read-only view, whose blocks still show', async () => {
      await open({ '/r/big.log': { text: lines('<<<<<<< HEAD', 'a', '=======', 'b', '>>>>>>> feature'), bytes: 5 * MiB } }, '/r/big.log', { editable: false });
      await waitFor(() => expect(document.querySelector('.cm-conflict-actions')).not.toBeNull());
      const buttons = within(document.querySelector<HTMLElement>('.cm-conflict-actions')!).getAllByRole('button');
      expect(buttons.map((button) => (button as HTMLButtonElement).disabled)).toEqual([true, true, true]);
    });

    it('opens the registered composer with the file-line anchor of the clicked gutter line and the tab’s session', async () => {
      const composer = vi.fn();
      offs.push(registerCommentComposer(composer));
      await open({ [APP]: numbered(10) });
      const marks = document.querySelectorAll<HTMLElement>('.cm-comment-mark');
      expect(marks).toHaveLength(11); // ten lines and the empty one after the last newline
      fireEvent.click(mark(7));
      expect(composer).toHaveBeenCalledWith({ kind: 'file-line', locator: `${APP}#L7`, label: 'app.ts:7', path: APP, line: 7 }, { appSessionId: A });
      expect(useEditorDialog.getState().open).toBeNull();
    });

    it('keeps each mark on its line as lines are added above it', async () => {
      const composer = vi.fn();
      offs.push(registerCommentComposer(composer));
      await open({ [APP]: numbered(10) });
      act(() => view().dispatch({ changes: { from: 0, insert: 'new\n' }, userEvent: 'input.type' }));
      await waitFor(() => expect(document.querySelectorAll('.cm-comment-mark')).toHaveLength(12));
      fireEvent.click(document.querySelectorAll<HTMLElement>('.cm-comment-mark')[7]); // the eighth line's, line 7's before
      expect(composer).toHaveBeenLastCalledWith(expect.objectContaining({ line: 8, label: 'app.ts:8' }), { appSessionId: A });
    });

    // E11 (W-C): CodeMirror hides its gutters from assistive technology, so the mark has a keyboard twin: "Comment on
    // this line" (the palette, File ▸ Comment on this line, a chord bound in Settings ▸ Keyboard) for the cursor's line
    it('Comment on this line opens the composer for the cursor’s line of the focused pane’s file tab, and nothing elsewhere', async () => {
      const composer = vi.fn();
      offs.push(registerCommentComposer(composer), registerEditor());
      await open({ [APP]: numbered(10) });
      act(() => view().dispatch({ selection: { anchor: view().state.doc.line(5).from + 2 } }));
      runAction('file.commentLine');
      expect(composer).toHaveBeenCalledWith({ kind: 'file-line', locator: `${APP}#L5`, label: 'app.ts:5', path: APP, line: 5 }, { appSessionId: A });
      act(() => view().dispatch({ selection: { anchor: view().state.doc.line(9).to } }));
      runAction('file.commentLine');
      expect(composer).toHaveBeenLastCalledWith(expect.objectContaining({ line: 9 }), { appSessionId: A });
      useLayout.setState({ main: LAYOUT_DEFAULTS.main }); // no file tab in front
      runAction('file.commentLine');
      expect(composer).toHaveBeenCalledTimes(2);
    });

    it('has the comment gutter in a read-only view too', async () => {
      await open({ '/r/big.log': { text: lines('one', 'two'), bytes: 5 * MiB } }, '/r/big.log', { editable: false });
      await waitFor(() => expect(mark(2)).toBeTruthy());
    });
  });

  describe('editor dialogs', () => {
    it('shows the anchor in the placeholder sheet when no composer is registered', async () => {
      await open({ [APP]: numbered(10) });
      fireEvent.click(mark(3));
      const sheet = await screen.findByRole('dialog', { name: 'Comment on app.ts:3' });
      const placeholder = sheet.closest('[data-anchor-placeholder]') ?? sheet.querySelector('[data-anchor-placeholder]') ?? sheet;
      expect(placeholder.getAttribute('data-anchor-kind')).toBe('file-line');
      expect(placeholder.getAttribute('data-anchor-path')).toBe(APP);
      expect(placeholder.getAttribute('data-anchor-line')).toBe('3');
      expect(placeholder.getAttribute('data-anchor-locator')).toBe(`${APP}#L3`);
      expect(placeholder.getAttribute('data-anchor-label')).toBe('app.ts:3');
      expect(within(sheet).getByText('The comment composer arrives with side threads (E3). This anchor will open it:')).toBeTruthy();
      for (const field of [`${APP}#L3`, 'app.ts:3', APP, '3']) expect(within(sheet).getByText(field)).toBeTruthy();
      fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(useEditorDialog.getState().open).toBeNull();
    });

    it('answers a close sheet cancel when the placeholder replaces it', async () => {
      await open({ [APP]: numbered(10) });
      replaceLine(1, 'mine');
      const { askClose } = await import('./EditorDialogs');
      let answer: string | null = null;
      act(() => void askClose(`file:${APP}`, 'app.ts').then((choice) => (answer = choice)));
      await screen.findByRole('dialog', { name: 'Save changes to app.ts?' });
      fireEvent.click(mark(3)); // under the modal sheet
      await screen.findByRole('dialog', { name: 'Comment on app.ts:3' });
      await settle();
      expect(answer).toBe('cancel');
    });
  });
});
