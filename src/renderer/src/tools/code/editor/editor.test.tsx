// The editor (E5 execution document, M2): the editing state machine over a fake main that hashes and compares as the
// service does, with answers held back so the interleavings are exact (`editor state`), and the code view's editing
// half (`code view editing`): editable by kind, the dirty listener, the baseline counter.
import { isolateHistory, undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { FILES_READ_MAX_LENGTH } from '@shared/ipc/schema/files';
import { LAYOUT_DEFAULTS, type TabRef } from '@shared/ipc/schema/layout';
import { connectCodeEvents } from '../../../ipc/events';
import { useLayout } from '../../../stores/layout';
import { fakeHash, installDisk, type DiskFile } from '../../../test-support/code-disk';
import { useFiles } from '../files/store';
import { openFile } from '../open-file';
import { FileViewer } from '../viewer/FileViewer';
import { useViewer, VIEWER_ENTRIES_MAX } from '../viewer/viewer-store';

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;
const MiB = 1024 * 1024;
const APP = '/r/app.ts';

const fileTab = (path: string, appSessionId: AppSessionId = A): Extract<TabRef, { kind: 'file' }> => ({ id: `file:${path}`, kind: 'file', path, line: null, appSessionId, pinned: false });
const entry = (path = APP) => useViewer.getState().entries.get(`file:${path}`)!;
const viewer = () => document.querySelector('[data-file-viewer]')!;
const view = () => EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;
const doc = () => view().state.doc.toString();
const saveButton = () => screen.queryByRole('button', { name: 'Save' });
const theirsNotice = () => document.querySelector('[data-theirs-notice]')?.textContent ?? null;

// The owner's edit: one undoable step each, as typing apart in time would be.
const type = (text: string, at = 0) => act(() => view().dispatch({ changes: { from: at, insert: text }, userEvent: 'input.type', annotations: isolateHistory.of('full') }));
const replaceAll = (text: string) => act(() => view().dispatch({ changes: { from: 0, to: view().state.doc.length, insert: text }, userEvent: 'input.paste', annotations: isolateHistory.of('full') }));
const undoOnce = () => act(() => void undo(view()));
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

describe('editor', () => {
  const offs: (() => void)[] = [];
  // CodeView's chunk loaded once up front, so no case's first wait pays for it.
  beforeAll(() => import('../viewer/CodeView'));
  beforeEach(() => {
    useViewer.getState().reset();
    useFiles.getState().reset();
    useLayout.setState({ main: LAYOUT_DEFAULTS.main });
  });
  afterEach(() => {
    cleanup();
    offs.splice(0).forEach((off) => off());
  });

  // A file tab over the fake disk, its main's events connected, its editor loaded and editable.
  async function open(files: Record<string, DiskFile>, path = APP) {
    const disk = installDisk(files);
    offs.push(connectCodeEvents());
    openFile(A, path); // the layout holds the tab, so a remount finds its entry
    const shown = render(<FileViewer tab={fileTab(path)} />);
    await waitFor(() => expect(entry(path)?.editable).toBe(true));
    await waitFor(() => expect(view().state.facet(EditorView.editable)).toBe(true));
    return { disk, shown };
  }
  const changed = (disk: ReturnType<typeof installDisk>, path = APP) => act(() => disk.emit('files.changed', { appSessionId: A, path, kind: 'changed' }));

  describe('code view editing', () => {
    it('reads every chunk with its hash and edits a complete text, read-only until it is', async () => {
      const text = `${'const line = 1; '.repeat(63)}\n`.repeat(1040); // past one chunk
      expect(text.length).toBeGreaterThan(MiB);
      const disk = installDisk({ [APP]: text });
      disk.hold('files.read').release(); // the first chunk answers at once
      const rest = disk.hold('files.read');
      render(<FileViewer tab={fileTab(APP)} />);
      await waitFor(() => expect(entry()?.status).toBe('ready'));
      await waitFor(() => expect(document.querySelector('.cm-content')?.getAttribute('title')).toBe('Read-only until the file has loaded'));
      expect(view().state.facet(EditorView.editable)).toBe(false);
      expect(viewer().getAttribute('data-editable')).toBe('false');
      rest.release();
      await waitFor(() => expect(entry().editable).toBe(true));
      await waitFor(() => expect(view().state.facet(EditorView.editable)).toBe(true));
      expect(document.querySelector('.cm-content')?.hasAttribute('title')).toBe(false);
      expect(viewer().getAttribute('data-editable')).toBe('true');
      expect(disk.callsOf('files.read').map((input) => [input.offset, input.hash])).toEqual([
        [0, true],
        [MiB, true],
      ]);
      expect(entry().hash).toBe(fakeHash(text));
    });

    it('ends a load read-only when a continuation answers another hash, even with zero bytes (the file shrank)', async () => {
      const text = `${'const line = 1; '.repeat(63)}\n`.repeat(1040); // past one chunk
      const disk = installDisk({ [APP]: text });
      const first = disk.hold('files.read'); // answered with the whole file as it is when the call arrives
      render(<FileViewer tab={fileTab(APP)} />);
      await waitFor(() => expect(disk.callsOf('files.read')).toHaveLength(1));
      disk.files[APP] = 'x\n'; // shrunk before the continuation: it answers zero bytes with the new file's hash
      await act(async () => first.release());
      await waitFor(() => expect(disk.callsOf('files.read')).toHaveLength(2));
      await settle();
      expect(disk.callsOf('files.read')[1]).toMatchObject({ offset: MiB, hash: true });
      expect(entry()).toMatchObject({ status: 'ready', hash: null, editable: false, complete: false, text: text.slice(0, MiB) });
      await waitFor(() => expect(document.querySelector('.cm-content')?.getAttribute('title')).toBe('Read-only until the file has loaded'));
      expect(view().state.facet(EditorView.editable)).toBe(false);
    });

    it('keeps a head and a lossy decode read-only, each with its reason as the content’s title', async () => {
      installDisk({ '/r/big.log': { text: 'log line\n', bytes: 5 * MiB }, '/r/latin1.txt': { text: 'caf�\n', bytes: 5, utf8: false } });
      const head = render(<FileViewer tab={fileTab('/r/big.log')} />);
      await waitFor(() => expect(document.querySelector('.cm-content')?.getAttribute('title')).toBe('Read-only: the file is larger than the editor’s cap'));
      expect(entry('/r/big.log').editable).toBe(false);
      head.unmount();
      render(<FileViewer tab={fileTab('/r/latin1.txt')} />);
      await waitFor(() => expect(document.querySelector('.cm-content')?.getAttribute('title')).toBe('Read-only: the file is not UTF-8'));
      expect(entry('/r/latin1.txt')).toMatchObject({ editable: false, complete: true });
      expect(view().state.facet(EditorView.editable)).toBe(false);
    });

    it('keeps a text read-only when main says its bytes are not UTF-8, even when the decode is as long as the file', async () => {
      // `a f0 9f 92 \n`: the truncated sequence decodes to U+FFFD, three bytes as the three it replaced
      installDisk({ '/r/cut.txt': { text: 'a\uFFFD\n', bytes: 5, utf8: false } });
      render(<FileViewer tab={fileTab('/r/cut.txt')} />);
      await waitFor(() => expect(document.querySelector('.cm-content')?.getAttribute('title')).toBe('Read-only: the file is not UTF-8'));
      expect(entry('/r/cut.txt')).toMatchObject({ editable: false, complete: true, bytes: 5 });
      expect(view().state.facet(EditorView.editable)).toBe(false);
    });

    it('marks the viewer dirty on an edit and clean again when the edit is undone', async () => {
      await open({ [APP]: 'const a = 1;\n' });
      expect(saveButton()).toBeNull();
      type('// typed\n');
      await waitFor(() => expect(entry().dirty).toBe(true));
      expect(viewer().getAttribute('data-dirty')).toBe('true');
      expect(saveButton()).not.toBeNull();
      undoOnce();
      await waitFor(() => expect(entry().dirty).toBe(false));
      expect(viewer().getAttribute('data-dirty')).toBe('false');
      expect(saveButton()).toBeNull();
    });

    it('edits markdown in Source, keeping the buffer and the mark across Rendered', async () => {
      installDisk({ '/r/README.md': '# Title\n' });
      render(<FileViewer tab={fileTab('/r/README.md')} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Source' }));
      await waitFor(() => expect(view().state.facet(EditorView.editable)).toBe(true));
      await waitFor(() => expect(doc()).toBe('# Title\n'));
      undoOnce(); // a fresh view's first text is no step to undo
      expect(doc()).toBe('# Title\n');
      type('Intro\n', '# Title\n'.length);
      await waitFor(() => expect(entry('/r/README.md').dirty).toBe(true));
      fireEvent.click(screen.getByRole('button', { name: 'Rendered' }));
      expect(await screen.findByRole('heading', { name: 'Title' })).toBeTruthy();
      expect(viewer().getAttribute('data-editable')).toBe('false'); // the rendered view has no editor
      expect(entry('/r/README.md').dirty).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Source' }));
      await waitFor(() => expect(doc()).toBe('# Title\nIntro\n'));
    });
  });

  describe('editor state', () => {
    it('saves the document against the baseline’s hash, and its own write’s event lands nothing', async () => {
      const { disk } = await open({ [APP]: 'const a = 1;\n' });
      type('// typed\n');
      await waitFor(() => expect(saveButton()).not.toBeNull());
      fireEvent.click(saveButton()!);
      await waitFor(() => expect(entry().dirty).toBe(false));
      expect(disk.callsOf('files.write')).toEqual([{ appSessionId: A, path: APP, content: '// typed\nconst a = 1;\n', expectedHash: fakeHash('const a = 1;\n') }]);
      expect(disk.files[APP]).toBe('// typed\nconst a = 1;\n');
      expect(entry()).toMatchObject({ text: '// typed\nconst a = 1;\n', hash: fakeHash('// typed\nconst a = 1;\n'), saving: false, theirs: null });
      expect(saveButton()).toBeNull();
      const epoch = entry().epoch;
      changed(disk); // the watcher reports the own write
      await waitFor(() => expect(disk.callsOf('files.read')).toHaveLength(2));
      await settle();
      expect(entry()).toMatchObject({ updated: 0, epoch, theirs: null });
      expect(document.querySelector('[data-updated]')).toBeNull();
    });

    it('offers Reload, Keep mine and Compare for a change on disk under unsaved edits; Reload takes the disk’s text', async () => {
      const { disk } = await open({ [APP]: 'const a = 1;\n' });
      type('// mine\n');
      disk.files[APP] = 'const a = 2;\n';
      changed(disk);
      await waitFor(() => expect(theirsNotice()).toBe('Changed on disk'));
      expect(viewer().getAttribute('data-theirs')).toBe('notice');
      expect(screen.getByRole('button', { name: 'Keep mine' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Compare' })).toBeTruthy();
      expect(doc()).toBe('// mine\nconst a = 1;\n');
      fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
      await waitFor(() => expect(doc()).toBe('const a = 2;\n'));
      expect(entry()).toMatchObject({ dirty: false, theirs: null, text: 'const a = 2;\n', hash: fakeHash('const a = 2;\n'), updated: 0 });
      expect(theirsNotice()).toBeNull();
      expect(saveButton()).toBeNull();
      expect(document.querySelector('[data-updated]')).toBeNull(); // the owner's own act
    });

    it('leaves theirs empty when a change event’s read answers the baseline’s own hash', async () => {
      const { disk } = await open({ [APP]: 'const a = 1;\n' });
      type('// mine\n');
      changed(disk); // spurious: the disk is the baseline
      await waitFor(() => expect(disk.callsOf('files.read')).toHaveLength(2));
      await settle();
      expect(entry()).toMatchObject({ theirs: null, dirty: true });
      expect(theirsNotice()).toBeNull();
    });

    it('lands a change read issued while clean and answered after an edit as theirs, the edit standing', async () => {
      const { disk } = await open({ [APP]: 'const a = 1;\n' });
      disk.files[APP] = 'const a = 2;\n';
      const read = disk.hold('files.read');
      changed(disk);
      await waitFor(() => expect(disk.callsOf('files.read')).toHaveLength(2));
      type('// mine\n');
      await waitFor(() => expect(entry().dirty).toBe(true));
      await act(async () => read.release());
      await waitFor(() => expect(theirsNotice()).toBe('Changed on disk'));
      expect(doc()).toBe('// mine\nconst a = 1;\n');
      expect(entry()).toMatchObject({ text: 'const a = 1;\n', theirs: { text: 'const a = 2;\n', hash: fakeHash('const a = 2;\n'), view: 'notice' }, updated: 0 });
    });

    it('lands nowhere a change read a save outran', async () => {
      const { disk } = await open({ [APP]: 'const a = 1;\n' });
      type('// mine\n');
      const read = disk.hold('files.read');
      changed(disk); // answered with the disk before the write
      await waitFor(() => expect(disk.callsOf('files.read')).toHaveLength(2));
      fireEvent.click(saveButton()!);
      await waitFor(() => expect(entry().hash).toBe(fakeHash('// mine\nconst a = 1;\n')));
      await act(async () => read.release());
      await settle();
      expect(entry()).toMatchObject({ text: '// mine\nconst a = 1;\n', theirs: null, dirty: false, updated: 0 });
      expect(doc()).toBe('// mine\nconst a = 1;\n');
    });

    // `loads` is the e2e's barrier for "my own save's re-read has finished": it moves only once a load is over, whatever
    // the load did, and the viewer root shows it.
    it('counts each completed load on the viewer root: an open load, one that lands nothing, one that lands in theirs', async () => {
      const { disk } = await open({ [APP]: 'const a = 1;\n' });
      const loads = () => viewer().getAttribute('data-loads');
      await waitFor(() => expect(loads()).toBe('1')); // the open load
      expect(entry().loads).toBe(1);

      const epoch = entry().epoch;
      const spurious = disk.hold('files.read'); // the disk is the baseline: this load lands nothing
      changed(disk);
      await waitFor(() => expect(disk.callsOf('files.read')).toHaveLength(2));
      await settle();
      expect(loads()).toBe('1'); // not before it completes
      await act(async () => spurious.release());
      await waitFor(() => expect(loads()).toBe('2'));
      expect(entry()).toMatchObject({ updated: 0, theirs: null, epoch });

      type('// mine\n');
      await waitFor(() => expect(entry().dirty).toBe(true));
      disk.files[APP] = 'const a = 2;\n';
      changed(disk); // lands in theirs
      await waitFor(() => expect(theirsNotice()).toBe('Changed on disk'));
      expect(loads()).toBe('3');
      expect(entry()).toMatchObject({ loads: 3, updated: 0 });
    });

    it('counts a change load a save outran once its read is answered, though it lands nowhere', async () => {
      const { disk } = await open({ [APP]: 'const a = 1;\n' });
      type('// mine\n');
      const read = disk.hold('files.read');
      changed(disk);
      await waitFor(() => expect(disk.callsOf('files.read')).toHaveLength(2));
      fireEvent.click(saveButton()!);
      await waitFor(() => expect(entry().hash).toBe(fakeHash('// mine\nconst a = 1;\n')));
      expect(entry().loads).toBe(1);
      await act(async () => read.release());
      await waitFor(() => expect(entry().loads).toBe(2));
      expect(entry()).toMatchObject({ text: '// mine\nconst a = 1;\n', theirs: null, dirty: false, updated: 0 });
    });

    it('keeps typing done during a save dirty against the content it submitted, which an undo returns to', async () => {
      const { disk } = await open({ [APP]: 'const a = 1;\n' });
      type('A');
      const write = disk.hold('files.write');
      fireEvent.click(saveButton()!);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Saving…' })).toHaveProperty('disabled', true));
      type('B', view().state.doc.length);
      await act(async () => write.release());
      await waitFor(() => expect(entry().saving).toBe(false));
      expect(disk.files[APP]).toBe('Aconst a = 1;\n');
      expect(entry()).toMatchObject({ text: 'Aconst a = 1;\n', dirty: true });
      expect(doc()).toBe('Aconst a = 1;\nB');
      undoOnce();
      await waitFor(() => expect(entry().dirty).toBe(false));
    });

    it('adopts the disk’s text on Keep mine: the old baseline is dirty against it, the disk’s text is clean, the next save wins', async () => {
      const { disk } = await open({ [APP]: 'const a = 1;\n' });
      type('// mine\n');
      disk.files[APP] = 'const a = 2;\n';
      changed(disk);
      await waitFor(() => expect(theirsNotice()).toBe('Changed on disk'));
      fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
      await waitFor(() => expect(theirsNotice()).toBeNull());
      expect(entry()).toMatchObject({ text: 'const a = 2;\n', hash: fakeHash('const a = 2;\n'), dirty: true, theirs: null });
      expect(doc()).toBe('// mine\nconst a = 1;\n');
      undoOnce(); // back to the old baseline, which is no longer the disk's
      await waitFor(() => expect(doc()).toBe('const a = 1;\n'));
      expect(entry().dirty).toBe(true);
      replaceAll('const a = 2;\n');
      await waitFor(() => expect(entry().dirty).toBe(false));
      replaceAll('// mine again\n');
      fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
      await waitFor(() => expect(disk.files[APP]).toBe('// mine again\n'));
      expect(disk.callsOf('files.write').at(-1)?.expectedHash).toBe(fakeHash('const a = 2;\n'));
    });

    it('sends the stale hash from the notice (a conflict opening the merge view) and theirs’ hash from the merge view', async () => {
      const { disk } = await open({ [APP]: 'const a = 1;\n' });
      type('// mine\n');
      disk.files[APP] = 'const a = 2;\n';
      changed(disk);
      await waitFor(() => expect(theirsNotice()).toBe('Changed on disk'));
      fireEvent.click(saveButton()!);
      await waitFor(() => expect(theirsNotice()).toBe('Changed on disk since you opened it'));
      expect(disk.callsOf('files.write')[0].expectedHash).toBe(fakeHash('const a = 1;\n'));
      expect(disk.files[APP]).toBe('const a = 2;\n'); // nothing written
      expect(viewer().getAttribute('data-theirs')).toBe('merge');
      expect(screen.queryByRole('button', { name: 'Compare' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
      fireEvent.click(saveButton()!);
      await waitFor(() => expect(disk.files[APP]).toBe('// mine\nconst a = 1;\n'));
      expect(disk.callsOf('files.write')[1].expectedHash).toBe(fakeHash('const a = 2;\n'));
      await waitFor(() => expect(entry()).toMatchObject({ theirs: null, dirty: false }));
    });

    it('turns the notice into the merge view on Compare', async () => {
      const { disk } = await open({ [APP]: 'const a = 1;\n' });
      type('// mine\n');
      disk.files[APP] = 'const a = 2;\n';
      changed(disk);
      fireEvent.click(await screen.findByRole('button', { name: 'Compare' }));
      await waitFor(() => expect(entry().theirs?.view).toBe('merge'));
      expect(theirsNotice()).toBe('Changed on disk since you opened it');
    });

    it('reads the file whole into the merge view when a save conflicts on a change the tab never saw', async () => {
      const { disk } = await open({ [APP]: 'const a = 1;\n' });
      type('// mine\n');
      disk.files[APP] = 'const a = 3;\n'; // no event
      fireEvent.click(saveButton()!);
      await waitFor(() => expect(entry().theirs).toEqual({ text: 'const a = 3;\n', hash: fakeHash('const a = 3;\n'), view: 'merge' }));
      expect(disk.callsOf('files.read').at(-1)).toEqual({ appSessionId: A, path: APP, offset: 0, length: FILES_READ_MAX_LENGTH, hash: true });
      expect(entry().saving).toBe(false);
    });

    it('answers noop to a save while one runs, and to a clean tab', async () => {
      const { disk } = await open({ [APP]: 'const a = 1;\n' });
      expect(await useViewer.getState().save(`file:${APP}`)).toBe('noop');
      type('x');
      const write = disk.hold('files.write');
      let first!: Promise<string>;
      act(() => void (first = useViewer.getState().save(`file:${APP}`)));
      expect(await useViewer.getState().save(`file:${APP}`)).toBe('noop');
      await act(async () => write.release());
      expect(await first).toBe('ok');
      expect(disk.callsOf('files.write')).toHaveLength(1);
    });

    it('keeps a file removed under unsaved edits editable, shows the save’s failure, and clears it on the next edit', async () => {
      const { disk } = await open({ [APP]: 'const a = 1;\n' });
      type('// mine\n');
      delete disk.files[APP];
      act(() => disk.emit('files.changed', { appSessionId: A, path: APP, kind: 'removed' }));
      await waitFor(() => expect(entry().removed).toBe(true));
      expect(view().state.facet(EditorView.editable)).toBe(true);
      fireEvent.click(saveButton()!);
      expect((await screen.findByRole('alert')).textContent).toBe(`Could not save: not found: ${APP}`);
      expect(entry()).toMatchObject({ dirty: true, saving: false });
      type('more ');
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    });

    it('writes a CRLF file back with its CRLF line breaks', async () => {
      const { disk } = await open({ '/r/win.txt': 'one\r\ntwo\r\n' }, '/r/win.txt');
      type('zero\n'); // CodeMirror's own break, in the editor
      fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
      await waitFor(() => expect(disk.files['/r/win.txt']).toBe('zero\r\none\r\ntwo\r\n'));
      await waitFor(() => expect(entry('/r/win.txt').dirty).toBe(false));
    });

    it('never evicts an idle tab with unsaved edits past the bound, and removes it once the layout drops its tab', async () => {
      const files = Object.fromEntries(Array.from({ length: VIEWER_ENTRIES_MAX + 3 }, (_, i) => [`/r/f${i}.ts`, `${i}\n`]));
      installDisk(files);
      for (let i = 0; i < VIEWER_ENTRIES_MAX + 3; i++) openFile(A, `/r/f${i}.ts`);
      const first = render(<FileViewer tab={fileTab('/r/f0.ts')} />);
      await waitFor(() => expect(entry('/r/f0.ts')?.editable).toBe(true));
      await waitFor(() => expect(view().state.facet(EditorView.editable)).toBe(true));
      type('// mine\n');
      await waitFor(() => expect(entry('/r/f0.ts').dirty).toBe(true));
      first.unmount();
      for (let i = 1; i < VIEWER_ENTRIES_MAX + 3; i++) render(<FileViewer tab={fileTab(`/r/f${i}.ts`)} />).unmount();
      expect(useViewer.getState().entries.size).toBe(VIEWER_ENTRIES_MAX);
      expect(entry('/r/f0.ts').dirty).toBe(true); // the least recently used, passed over
      act(() => useLayout.getState().closeTab('file:/r/f0.ts'));
      expect(useViewer.getState().entries.has('file:/r/f0.ts')).toBe(false);
    });

    it('keeps a dirty tab’s document when it is rebound to another session, re-reading under it into theirs', async () => {
      const { disk, shown } = await open({ [APP]: 'const a = 1;\n' });
      type('// mine\n');
      await waitFor(() => expect(entry().dirty).toBe(true));
      disk.files[APP] = 'const a = 2;\n';
      disk.calls.splice(0);
      const read = disk.hold('files.read');
      shown.rerender(<FileViewer tab={fileTab(APP, B)} />);
      await waitFor(() => expect(disk.callsOf('files.read')).toHaveLength(1));
      await settle();
      // while the new session's read is pending: the document and the baseline stand
      expect(entry()).toMatchObject({ appSessionId: B, text: 'const a = 1;\n', hash: fakeHash('const a = 1;\n'), dirty: true, theirs: null });
      expect(doc()).toBe('// mine\nconst a = 1;\n');
      await act(async () => read.release());
      await waitFor(() => expect(theirsNotice()).toBe('Changed on disk'));
      expect(disk.calls.filter((call) => call.name !== 'files.unwatch').map((call) => [call.name, call.input.appSessionId])).toEqual([
        ['files.watch', B],
        ['files.read', B],
      ]);
      expect(entry()).toMatchObject({ appSessionId: B, text: 'const a = 1;\n', dirty: true, theirs: { text: 'const a = 2;\n', view: 'notice' } });
      expect(doc()).toBe('// mine\nconst a = 1;\n');
    });

    // A dirty tab saving, discarded (its entry goes with the tab) and the same path reopened while the old write's answer
    // is pending: the old answer belongs to the entry that is gone, and lands nowhere on the fresh one, whichever of the
    // two answers arrives first.
    for (const order of ['the old write first', 'the new read first'] as const) {
      it(`lands nowhere a save’s answer for a discarded entry when the path is reopened (${order})`, async () => {
        const { disk, shown } = await open({ [APP]: 'const a = 1;\n' });
        type('// mine\n');
        await waitFor(() => expect(entry().dirty).toBe(true));
        const write = disk.hold('files.write');
        let saved!: Promise<string>;
        act(() => void (saved = useViewer.getState().save(`file:${APP}`)));
        await waitFor(() => expect(disk.callsOf('files.write')).toHaveLength(1));
        expect(disk.files[APP]).toBe('// mine\nconst a = 1;\n'); // the fake disk writes when the call arrives
        shown.unmount();
        act(() => useLayout.getState().closeTab(`file:${APP}`)); // Don't save: the entry goes with the tab
        expect(useViewer.getState().entries.has(`file:${APP}`)).toBe(false);

        const read = disk.hold('files.read');
        openFile(A, APP);
        render(<FileViewer tab={fileTab(APP)} />);
        await waitFor(() => expect(disk.callsOf('files.read')).toHaveLength(2));
        expect(entry()).toMatchObject({ status: 'loading', saving: false, dirty: false });
        if (order === 'the old write first') {
          await act(async () => write.release());
          const answered = await act(() => saved);
          expect(entry()).toMatchObject({ status: 'loading', text: '', hash: null, baseline: 0, saving: false });
          expect(answered).toBe('noop'); // landed nowhere: the entry it was for is gone
          await act(async () => read.release());
        } else {
          await act(async () => read.release());
          await waitFor(() => expect(entry().status).toBe('ready'));
          await act(async () => write.release());
          await act(() => saved);
        }
        await waitFor(() => expect(entry().editable).toBe(true));
        expect(entry()).toMatchObject({ status: 'ready', text: '// mine\nconst a = 1;\n', hash: fakeHash('// mine\nconst a = 1;\n'), baseline: 0, saving: false, dirty: false, theirs: null });
        await waitFor(() => expect(doc()).toBe('// mine\nconst a = 1;\n'));
        expect(await saved).toBe('noop');
      });
    }

    it('lands nowhere a conflict read for a discarded entry when the path is reopened', async () => {
      const { disk, shown } = await open({ [APP]: 'const a = 1;\n' });
      type('// mine\n');
      await waitFor(() => expect(entry().dirty).toBe(true));
      disk.files[APP] = 'const a = 3;\n'; // no event: the save conflicts and reads the file whole
      const conflictRead = disk.hold('files.read');
      let saved!: Promise<string>;
      act(() => void (saved = useViewer.getState().save(`file:${APP}`)));
      await waitFor(() => expect(disk.callsOf('files.read').at(-1)?.length).toBe(FILES_READ_MAX_LENGTH));
      shown.unmount();
      act(() => useLayout.getState().closeTab(`file:${APP}`));
      openFile(A, APP);
      render(<FileViewer tab={fileTab(APP)} />);
      await waitFor(() => expect(entry()?.editable).toBe(true));
      await act(async () => conflictRead.release());
      const answered = await act(() => saved);
      expect(entry()).toMatchObject({ text: 'const a = 3;\n', saving: false, dirty: false, theirs: null, saveError: null });
      expect(answered).toBe('noop');
    });
  });
});
