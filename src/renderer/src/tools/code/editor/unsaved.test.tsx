// The renderer's half of the quit guard's unsaved files (E5 execution document, M5; Interfaces "The quit guard and
// unsaved files (M5)"): the viewer store pushes the paths of its dirty file tabs to main whenever that set changes, and
// on main's `layout.saveAll` saves every dirty tab and answers with those that did not end clean, the push of what the
// saves cleaned going first. Over the fake disk, two tabs each in its own code view.
import { isolateHistory } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS, type TabRef } from '@shared/ipc/schema/layout';
import { connectCodeEvents } from '../../../ipc/events';
import { useLayout } from '../../../stores/layout';
import { installDisk, type DiskFile } from '../../../test-support/code-disk';
import { useFiles } from '../files/store';
import { openFile } from '../open-file';
import { FileViewer } from '../viewer/FileViewer';
import { useViewer } from '../viewer/viewer-store';

const A = 'app-a' as AppSessionId;
const APP = '/r/app.ts';
const LIB = '/r/lib.ts';

const fileTab = (path: string): Extract<TabRef, { kind: 'file' }> => ({ id: `file:${path}`, kind: 'file', path, line: null, appSessionId: A, pinned: false });
const entry = (path: string) => useViewer.getState().entries.get(`file:${path}`)!;

describe('unsaved files for the quit guard', () => {
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

  // app.ts and lib.ts open in the layout, each shown in its own editable code view, main's events connected.
  async function openBoth(files: Record<string, DiskFile> = { [APP]: 'const a = 1;\n', [LIB]: 'export const b = 2;\n' }) {
    const disk = installDisk(files);
    offs.push(connectCodeEvents());
    const views = new Map<string, () => EditorView>();
    for (const path of [APP, LIB]) {
      openFile(A, path);
      const { container } = render(<FileViewer tab={fileTab(path)} />);
      views.set(path, () => EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!);
      await waitFor(() => expect(entry(path)?.editable).toBe(true));
      await waitFor(() => expect(views.get(path)!().state.facet(EditorView.editable)).toBe(true));
    }
    const view = (path: string) => views.get(path)!();
    const type = (path: string, text: string) =>
      act(() => view(path).dispatch({ changes: { from: 0, insert: text }, userEvent: 'input.type', annotations: isolateHistory.of('full') }));
    const pushes = () => disk.callsOf('layout.unsavedFiles').map((input) => input.paths);
    return { disk, view, type, pushes };
  }

  it('pushes the sorted set of dirty paths on each change of it, and only then', async () => {
    const { type, pushes, view } = await openBoth();
    expect(pushes()).toEqual([]); // opening and loading change no dirty set
    type(LIB, '// lib\n');
    await waitFor(() => expect(pushes()).toEqual([[LIB]]));
    type(LIB, '// more\n'); // still dirty: the set is unchanged
    type(APP, '// app\n');
    await waitFor(() => expect(pushes()).toEqual([[LIB], [APP, LIB]]));
    act(() => view(APP).dispatch({ changes: { from: 0, to: '// app\n'.length, insert: '' } })); // back to the disk's text
    await waitFor(() => expect(pushes()).toEqual([[LIB], [APP, LIB], [LIB]]));
    act(() => useLayout.getState().closeTab(`file:${LIB}`)); // a dirty tab closed (its guard asked)
    cleanup(); // its viewer unmounts with it, and the store prunes the entry
    await waitFor(() => expect(pushes()).toEqual([[LIB], [APP, LIB], [LIB], []]));
  });

  it('a connection pushes the set it finds, and leaves main’s set for the window empty when it disconnects', async () => {
    const { type, pushes } = await openBoth();
    type(APP, '// app\n');
    await waitFor(() => expect(pushes()).toEqual([[APP]]));
    offs.splice(0).forEach((off) => off()); // nothing reports this window's edits any more
    expect(pushes()).toEqual([[APP], []]);
    offs.push(connectCodeEvents());
    expect(pushes()).toEqual([[APP], [], [APP]]);
  });

  it('on layout.saveAll saves every dirty tab and answers with none failed, after pushing the empty set', async () => {
    const { disk, type } = await openBoth();
    type(APP, '// app\n');
    type(LIB, '// lib\n');
    await waitFor(() => expect(disk.callsOf('layout.unsavedFiles').at(-1)).toEqual({ paths: [APP, LIB] }));
    act(() => disk.emit('layout.saveAll', { requestId: 'r1' }));
    await waitFor(() => expect(disk.callsOf('layout.saveAllDone')).toEqual([{ requestId: 'r1', failed: [] }]));
    expect(disk.files[APP]).toBe('// app\nconst a = 1;\n');
    expect(disk.files[LIB]).toBe('// lib\nexport const b = 2;\n');
    expect([entry(APP).dirty, entry(LIB).dirty]).toEqual([false, false]);
    // main reads the set after the answer, so the push that emptied it went first
    const order = disk.calls.filter((c) => c.name === 'layout.unsavedFiles' || c.name === 'layout.saveAllDone').map((c) => [c.name, c.input]);
    expect(order.slice(-2)).toEqual([['layout.unsavedFiles', { paths: [] }], ['layout.saveAllDone', { requestId: 'r1', failed: [] }]]);
  });

  it('answers the tabs a save left unsaved with their bar’s message: a conflict (now in the merge view) and an error', async () => {
    const { disk, type } = await openBoth();
    type(APP, '// app\n');
    type(LIB, '// lib\n');
    disk.files[APP] = 'const a = 2;\n'; // another writer, unseen by the tab
    delete disk.files[LIB]; // gone: the write answers not found
    act(() => disk.emit('layout.saveAll', { requestId: 'r2' }));
    await waitFor(() => expect(disk.callsOf('layout.saveAllDone')).toHaveLength(1));
    expect(disk.callsOf('layout.saveAllDone')[0]).toEqual({
      requestId: 'r2',
      failed: [
        { path: APP, message: 'Changed on disk since you opened it' },
        { path: LIB, message: `Could not save: not found: ${LIB}` },
      ],
    });
    expect(entry(APP)).toMatchObject({ dirty: true, theirs: { view: 'merge' } });
    expect(disk.files[APP]).toBe('const a = 2;\n'); // nothing overwritten blind
    expect(disk.callsOf('layout.unsavedFiles').at(-1)).toEqual({ paths: [APP, LIB] });
  });

  // Fix wave 1: a save from the merge view sends the hash the merge shows, so Save all saving it would write the owner's
  // unresolved document over the disk's change; resolving it is the owner's act in that tab.
  it('never saves a tab in the merge view: a later Save all leaves the disk’s change and answers the conflict again', async () => {
    const { disk, type } = await openBoth();
    type(APP, '// app\n');
    disk.files[APP] = 'const a = 2;\n'; // another writer, unseen by the tab
    act(() => disk.emit('layout.saveAll', { requestId: 'r1' }));
    await waitFor(() => expect(disk.callsOf('layout.saveAllDone')).toHaveLength(1));
    expect(entry(APP)).toMatchObject({ dirty: true, theirs: { view: 'merge' } });
    const writes = disk.callsOf('files.write').length;
    act(() => disk.emit('layout.saveAll', { requestId: 'r2' }));
    await waitFor(() => expect(disk.callsOf('layout.saveAllDone')).toHaveLength(2));
    expect(disk.callsOf('layout.saveAllDone')[1]).toEqual({ requestId: 'r2', failed: [{ path: APP, message: 'Changed on disk since you opened it' }] });
    expect(disk.callsOf('files.write')).toHaveLength(writes); // not written
    expect(disk.files[APP]).toBe('const a = 2;\n'); // the agent's version stays
    expect(entry(APP)).toMatchObject({ dirty: true, theirs: { view: 'merge' } });
  });

  it('answers a tab whose save was already running as not clean, saving it once', async () => {
    const { disk, type } = await openBoth();
    type(APP, '// app\n');
    const write = disk.hold('files.write');
    const first = useViewer.getState().save(`file:${APP}`);
    await waitFor(() => expect(entry(APP).saving).toBe(true));
    act(() => disk.emit('layout.saveAll', { requestId: 'r3' }));
    await waitFor(() => expect(disk.callsOf('layout.saveAllDone')).toEqual([{ requestId: 'r3', failed: [{ path: APP, message: 'Saving…' }] }]));
    await act(async () => write.release());
    expect(await first).toBe('ok');
    expect(disk.callsOf('files.write')).toHaveLength(1);
  });
});
