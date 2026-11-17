// Enter and the file (UX wave U6b-3b, docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md, decision 10 and
// M2 decisions 5 and 6; sequence S3, the review's finding 4; B5): Enter on a result asks the keyboard for the file by its
// key, and the file's view takes it wherever it is drawn: on its body while the read is on its way, in its editor's text
// once the editor is drawn while the body still has it, and never on a tab's button. For a file already open in the main
// area, the main tab comes forward and the keyboard goes into its text. The main area and the side column are drawn as
// the shell draws them, with the real file viewer. Invented paths.
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilesEntry } from '@shared/ipc/schema/files';
import { record } from '../../../../../../test/support/builders';
import { TEST_MACHINE } from '../../../../../../test/support/machine';
import { registerSlot, resetSlots } from '../../../app/slots';
import { connectCodeEvents } from '../../../ipc/events';
import { queryClient } from '../../../ipc/query';
import { runAction } from '../../../keymap/actions-runtime';
import { MainArea } from '../../../main/MainArea';
import { connectPanelHost, registerPanelTool } from '../../../panel/host';
import { useLayout } from '../../../stores/layout';
import { activeTab } from '../../../stores/layout-model';
import { useSessions } from '../../../stores/sessions';
import { deferred, fail, installFakeMain, ok } from '../../../test-support/code';
import { A, resetPanelStores, TestHost } from '../../../test-support/panel';
import { installResizeObserver } from '../../../test-support/resize';
import { openFile, resetKeptOpens } from '../open-file';
import { FileViewer } from '../viewer/FileViewer';
import { useViewer } from '../viewer/viewer-store';
import { filesTool } from './FilesTool';
import { connectGoToFile } from './finder';
import { useFiles } from './store';
import { resetTreeState, treeOf, useTreeState } from './tree-state';

vi.mock('../../../app/Diagnostics', () => ({ Diagnostics: () => <section aria-label="Diagnostics">diagnostics</section> }));

const APP = '/r/src/app.ts';
const KEY = (path: string) => `file:${TEST_MACHINE}:${path}`;
const dir = (path: string): FilesEntry => ({ name: path.slice(path.lastIndexOf('/') + 1), path, kind: 'dir', size: 0, mtimeMs: 0, target: null });
const file = (path: string): FilesEntry => ({ ...dir(path), kind: 'file', size: 10 });
const REPO: Record<string, FilesEntry[]> = { '': [dir('/r')], '/r': [dir('/r/src')], '/r/src': [file(APP)] };

let heldReads: Map<string, ReturnType<typeof deferred<void>>>;
let failedReads: Set<string>;
function openMain() {
  return installFakeMain(async (name, input) => {
    if (name === 'layout.get') return ok({ value: null });
    if (name === 'layout.set' || name === 'files.watch' || name === 'files.unwatch' || name === 'git.unwatch') return ok();
    if (name === 'git.watch') return fail('not a git repository');
    if (name === 'fs.workflows') return ok({ runs: [] });
    if (name === 'git.lsFiles') return ok({ paths: ['src/app.ts', 'src/'], truncated: false, source: 'git' });
    if (name === 'files.list') {
      const path = (input.path as string | undefined) ?? '';
      const found = REPO[path];
      return found === undefined ? fail(`not found: ${path}`) : ok({ root: path === '' ? null : '/r', path, entries: found, truncated: false });
    }
    if (name === 'files.read') {
      const path = String(input.path);
      await heldReads.get(path)?.promise;
      if (failedReads.has(path)) return fail(`denied: ${path}`);
      const content = `export const app = '${path}';\n`;
      return ok({ encoding: 'utf8', content, bytes: content.length, offset: 0, length: content.length, truncated: false, mime: 'text/plain', hash: null, utf8: null });
    }
    return fail(`unexpected ${name}`);
  });
}

// The virtual list draws rows only in a scroller with a height (happy-dom lays nothing out).
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(async () => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-files-scroller') ? 600 : 0;
    },
  });
  await import('../viewer/CodeView'); // the editor's chunk, loaded once
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));

const offs: (() => void)[] = [];
beforeEach(() => {
  heldReads = new Map();
  failedReads = new Set();
  resetPanelStores();
  resetKeptOpens();
  resetTreeState();
  useFiles.getState().reset();
  useViewer.getState().reset();
  installResizeObserver();
  openMain();
  offs.push(connectCodeEvents(), connectPanelHost(), registerPanelTool(filesTool), connectGoToFile());
  registerSlot('fileTab', FileViewer);
  useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { directory: '/r' })) }));
});
afterEach(() => {
  cleanup();
  resetSlots();
  offs.splice(0).forEach((off) => off());
  vi.unstubAllGlobals();
  resetKeptOpens();
  useViewer.getState().reset();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })); // no request held over into the next case
});

// The page: a stand-in for the composer, the main area and the side column.
function Page() {
  return (
    <QueryClientProvider client={queryClient}>
      <textarea aria-label="Composer" />
      <div data-region="main" className="flex">
        <MainArea />
      </div>
      <div data-region="panel">
        <TestHost />
      </div>
    </QueryClientProvider>
  );
}

const composer = () => screen.getByRole('textbox', { name: 'Composer' });
const field = () => document.querySelector<HTMLInputElement>('[data-files-filter]');
const body = (path: string, region: 'main' | 'panel') => document.querySelector<HTMLElement>(`[data-region="${region}"] [data-file-keyboard][data-key="${KEY(path)}"]`);
// The file's text, found by its viewer, so the cases read where the keyboard is whether or not the body takes it.
const textOf = (path: string, region: 'main' | 'panel') => document.querySelector<HTMLElement>(`[data-region="${region}"] [data-file-viewer][data-path="${path}"] .cm-content`);
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const holdRead = (path: string) => {
  const gate = deferred<void>();
  heldReads.set(path, gate);
  return gate;
};

// ⌘P from the composer, `app` typed, and Enter on its one result once it is listed.
async function findAndEnter(): Promise<void> {
  act(() => composer().focus());
  act(() => runAction('files.goToFile'));
  await waitFor(() => expect(document.activeElement).toBe(field()));
  fireEvent.change(field()!, { target: { value: 'app' } });
  await waitFor(() => expect(document.querySelector(`[data-files-result][data-path="${APP}"]`)).not.toBeNull());
  fireEvent.keyDown(field()!, { key: 'Enter' });
}

describe('Enter puts the keyboard in the file (S3; B5)', () => {
  it('beside the chat, its read held: the keyboard is on the file’s body until the read lands, then in its text', async () => {
    const read = holdRead(APP);
    render(<Page />);
    await findAndEnter();
    await waitFor(() => expect(document.activeElement).toBe(body(APP, 'panel')));
    expect(document.activeElement!.getAttribute('tabindex')).toBe('-1');
    expect(textOf(APP, 'panel')).toBeNull(); // the read is on its way
    expect(treeOf(useTreeState.getState(), A).finding).toBeNull();
    act(() => read.resolve());
    await waitFor(() => expect(document.activeElement).toBe(textOf(APP, 'panel')), { timeout: 5000 });
    expect(document.activeElement!.closest('[role="tab"]')).toBeNull();
  });

  it('beside the chat, a press in the composer before the read lands: the keyboard stays there and the editor takes nothing', async () => {
    const read = holdRead(APP);
    render(<Page />);
    await findAndEnter();
    await waitFor(() => expect(document.activeElement).toBe(body(APP, 'panel')));
    fireEvent.pointerDown(composer());
    act(() => composer().focus());
    act(() => read.resolve());
    await waitFor(() => expect(textOf(APP, 'panel')).not.toBeNull(), { timeout: 5000 });
    await settle();
    expect(document.activeElement).toBe(composer());
  });

  it('beside the chat, already drawn: the keyboard is handed on to its text at once', async () => {
    render(<Page />);
    act(() => void openFile(A, APP, null, { keep: true }));
    await waitFor(() => expect(textOf(APP, 'panel')).not.toBeNull(), { timeout: 5000 });
    await findAndEnter();
    await waitFor(() => expect(document.activeElement).toBe(textOf(APP, 'panel')));
  });

  it('a main tab of the file already present, not in front: its tab comes forward and the keyboard is inside its text, not on a tab', async () => {
    render(<Page />);
    act(() => void openFile(A, APP, null, { main: true }));
    await waitFor(() => expect(textOf(APP, 'main')).not.toBeNull(), { timeout: 5000 });
    act(() => useLayout.getState().activateTab(`session:${A}`)); // the session's tab in front, the file's behind it
    await waitFor(() => expect(body(APP, 'main')).toBeNull());
    await findAndEnter();
    await waitFor(() => expect(activeTab(useLayout.getState().main)?.id).toBe(KEY(APP)));
    await waitFor(() => expect(document.activeElement).toBe(textOf(APP, 'main')), { timeout: 5000 });
    expect(document.activeElement!.getAttribute('role')).not.toBe('tab');
    expect(document.activeElement!.closest('[role="tab"]')).toBeNull();
    expect(document.querySelector(`[data-region="panel"] [data-file-viewer][data-path="${APP}"]`)).toBeNull(); // no side tab of it
  });

  it('a main tab of the file whose read is held and then fails: the keyboard is on the file’s body and stays there', async () => {
    render(<Page />);
    act(() => useLayout.getState().openTab({ kind: 'file', path: APP, line: null, appSessionId: A, machine: TEST_MACHINE }, { activate: false }));
    const read = holdRead(APP);
    failedReads.add(APP);
    await findAndEnter();
    await waitFor(() => expect(activeTab(useLayout.getState().main)?.id).toBe(KEY(APP)));
    await waitFor(() => expect(document.activeElement).toBe(body(APP, 'main')));
    act(() => read.resolve());
    await waitFor(() => expect(body(APP, 'main')?.querySelector('[data-refusal]')).not.toBeNull());
    await settle();
    expect(document.activeElement).toBe(body(APP, 'main'));
    expect(document.activeElement!.closest('[role="tab"]')).toBeNull();
  });
});
