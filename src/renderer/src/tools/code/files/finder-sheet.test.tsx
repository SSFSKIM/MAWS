// Go to file in a narrow window (UX wave U6b-3b, docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md, Decision
// Log 15, the branch review's two findings): under 700 px the side column is a sheet over a main area the shell makes
// inert, so neither the element ⌘P found the keyboard in nor a file's tab in the main area can take the keyboard while
// the sheet stands. Esc's second step dismisses the sheet by the sheet's own path, which gives the keyboard back once main
// has left inert; an Esc the field cannot answer reaches the sheet's dismissal; Enter on a file whose tab is in the main
// area dismisses the sheet before it asks the keyboard for that file. Each with its control: full width, and a file that
// opens beside the tree. The shell drawn whole, with the real Files and file viewer. Invented paths.
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilesEntry } from '@shared/ipc/schema/files';
import { record } from '../../../../../../test/support/builders';
import { TEST_MACHINE } from '../../../../../../test/support/machine';
import { Shell } from '../../../app/Shell';
import { registerSlot, resetSlots } from '../../../app/slots';
import { connectCodeEvents } from '../../../ipc/events';
import { queryClient } from '../../../ipc/query';
import { runAction } from '../../../keymap/actions-runtime';
import { connectPanelHost, registerPanelTool } from '../../../panel/host';
import { PanelHost } from '../../../panel/PanelHost';
import { useLayout } from '../../../stores/layout';
import { activeTab } from '../../../stores/layout-model';
import { useSessions } from '../../../stores/sessions';
import { fail, installFakeMain, ok } from '../../../test-support/code';
import { A, resetPanelStores } from '../../../test-support/panel';
import { installResizeObserver } from '../../../test-support/resize';
import { openFile, resetKeptOpens } from '../open-file';
import { FileViewer } from '../viewer/FileViewer';
import { useViewer } from '../viewer/viewer-store';
import { filesTool } from './FilesTool';
import { connectGoToFile } from './finder';
import { showFiles } from './tabs';
import { useFiles } from './store';
import { resetTreeState, treeOf, useTreeState } from './tree-state';

vi.mock('../../../app/Diagnostics', () => ({ Diagnostics: () => <section aria-label="Diagnostics">diagnostics</section> }));

const APP = '/r/src/app.ts';
const TIDES = '/r/src/tides.ts';
const KEY = (path: string) => `file:${TEST_MACHINE}:${path}`;
const NARROW = 640; // under the shell's 700 px: the side column is a sheet
const WIDE = 1280;
const dir = (path: string): FilesEntry => ({ name: path.slice(path.lastIndexOf('/') + 1), path, kind: 'dir', size: 0, mtimeMs: 0, target: null });
const file = (path: string): FilesEntry => ({ ...dir(path), kind: 'file', size: 10 });
const REPO: Record<string, FilesEntry[]> = { '': [dir('/r')], '/r': [dir('/r/src')], '/r/src': [file(APP), file(TIDES)] };

// The calls Files, the finder and the viewer make, answered over the invented folder; the shell's own, answered quietly.
function openMain() {
  return installFakeMain(async (name, input) => {
    if (name === 'layout.get') return ok({ value: null });
    if (name === 'git.watch') return fail('not a git repository');
    if (name === 'fs.workflows') return ok({ runs: [] });
    if (name === 'git.lsFiles') return ok({ paths: ['src/app.ts', 'src/tides.ts', 'src/'].filter((path) => path.includes(input.query as string)), truncated: false, source: 'git' });
    if (name === 'files.list') {
      const path = (input.path as string | undefined) ?? '';
      const found = REPO[path];
      return found === undefined ? fail(`not found: ${path}`) : ok({ root: path === '' ? null : '/r', path, entries: found, truncated: false });
    }
    if (name === 'files.read') {
      const content = `export const app = '${String(input.path)}';\n`;
      return ok({ encoding: 'utf8', content, bytes: content.length, offset: 0, length: content.length, truncated: false, mime: 'text/plain', hash: null, utf8: null });
    }
    return ok();
  });
}

const setWidth = (width: number) => (window as unknown as { happyDOM: { setWindowSize(size: { width: number }): void } }).happyDOM.setWindowSize({ width });

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
  resetPanelStores();
  resetKeptOpens();
  resetTreeState();
  useFiles.getState().reset();
  useViewer.getState().reset();
  useLayout.setState({ overviewOpen: false });
  installResizeObserver();
  openMain();
  offs.push(connectCodeEvents(), connectPanelHost(), registerPanelTool(filesTool), connectGoToFile());
  registerSlot('panelHost', PanelHost);
  registerSlot('fileTab', FileViewer);
  registerSlot('transcript', () => <div>an invented transcript</div>);
  registerSlot('composer', () => <textarea aria-label="Composer" />);
  registerSlot('newSession', () => <h2>setup</h2>);
  useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { directory: '/r' })) }));
});
afterEach(() => {
  cleanup();
  resetSlots();
  offs.splice(0).forEach((off) => off());
  vi.unstubAllGlobals();
  resetKeptOpens();
  useViewer.getState().reset();
  setWidth(1024);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })); // no request held over into the next case
});

function renderShell() {
  return render(
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>,
  );
}

const composer = () => screen.getByRole('textbox', { name: 'Composer' });
const field = () => document.querySelector<HTMLInputElement>('[data-files-filter]');
const mainRegion = () => document.querySelector<HTMLElement>('[data-region="main"]')!;
const sheetDismissal = () => screen.queryByRole('button', { name: 'Close surface sheet' });
const panelCollapsed = () => useLayout.getState().regions.panel.collapsed;
const finding = () => treeOf(useTreeState.getState(), A).finding;
const textOf = (path: string, region: 'main' | 'panel') => document.querySelector<HTMLElement>(`[data-region="${region}"] [data-file-viewer][data-path="${path}"] .cm-content`);
const esc = () => fireEvent.keyDown(field()!, { key: 'Escape' }); // false when the key was the field's (prevented)
const listed = (paths: string[]) => waitFor(() => expect([...document.querySelectorAll('[data-files-result]')].map((row) => row.getAttribute('data-path'))).toEqual(paths));

// The side column closed, the keyboard in the composer: Go to file, then `query` typed and its results listed.
async function findFromComposer(query: string, paths: string[]): Promise<void> {
  await waitFor(() => expect(composer()).toBeTruthy());
  act(() => composer().focus());
  act(() => runAction('files.goToFile'));
  await waitFor(() => expect(document.activeElement).toBe(field()));
  fireEvent.change(field()!, { target: { value: query } });
  await listed(paths);
}

describe('Esc in Go to file’s field over a narrow window’s sheet (Decision Log 15)', () => {
  it('the side column closed, the keyboard in the composer: ⌘P opens Files as a sheet; a query, then Esc twice: the sheet closes, the search ends and the composer has the keyboard', async () => {
    setWidth(NARROW);
    renderShell();
    await findFromComposer('app', [APP]);
    expect([sheetDismissal() !== null, mainRegion().hasAttribute('inert'), finding() !== null]).toEqual([true, true, true]); // the sheet, over an inert main
    expect(esc()).toBe(false); // with text: the field's
    expect(field()!.value).toBe('');
    expect(document.activeElement).toBe(field());
    esc();
    await waitFor(() => expect(sheetDismissal()).toBeNull());
    expect([panelCollapsed(), finding(), mainRegion().hasAttribute('inert')]).toEqual([true, null, false]);
    await waitFor(() => expect(document.activeElement).toBe(composer()));
  });

  it('the field holding the keyboard with no element to give it back to: its Esc is not swallowed, and the sheet’s own dismissal closes the sheet', async () => {
    setWidth(NARROW);
    renderShell();
    act(() => void showFiles(A)); // Files shown as a sheet by no ⌘P: nothing recorded
    await waitFor(() => expect(sheetDismissal()).not.toBeNull());
    await waitFor(() => expect(field()).not.toBeNull());
    act(() => field()!.focus());
    expect(esc()).toBe(false); // prevented by the sheet's dismissal, which took it
    await waitFor(() => expect(sheetDismissal()).toBeNull());
    expect(panelCollapsed()).toBe(true);
  });

  it('the control at full width: Esc twice gives the composer the keyboard and nothing about the side column changes', async () => {
    setWidth(WIDE);
    renderShell();
    await findFromComposer('app', [APP]);
    expect([sheetDismissal(), mainRegion().hasAttribute('inert')]).toEqual([null, false]);
    expect(esc()).toBe(false);
    expect(esc()).toBe(false); // the keyboard given back: the field's
    expect(document.activeElement).toBe(composer());
    expect([panelCollapsed(), sheetDismissal(), finding()]).toEqual([false, null, null]);
  });

  it('at full width, an Esc the field cannot answer (nothing to give the keyboard back to) is not swallowed, and the keyboard stays in the field; with an element recorded, the same field takes Esc and gives it back', async () => {
    setWidth(WIDE);
    renderShell();
    act(() => void showFiles(A));
    await waitFor(() => expect(field()).not.toBeNull());
    act(() => field()!.focus()); // no ⌘P: nothing recorded
    expect(esc()).toBe(true); // not prevented: it goes on to whatever stands behind
    expect([document.activeElement, panelCollapsed(), sheetDismissal()]).toEqual([field(), false, null]);
    // the control, in the same field: ⌘P from the composer records it, and the field's Esc is its own and gives it back
    act(() => composer().focus());
    act(() => runAction('files.goToFile'));
    await waitFor(() => expect(document.activeElement).toBe(field()));
    expect(field()!.value).toBe('');
    expect(esc()).toBe(false); // prevented: the field's
    expect([document.activeElement, panelCollapsed(), sheetDismissal()]).toEqual([composer(), false, null]);
  });
});

describe('Enter in a narrow window (Decision Log 15)', { timeout: 20_000 }, () => {
  it('a file already open in a main-area tab, the session’s tab in front: Go to file and Enter close the sheet, bring the file’s tab forward and put the keyboard in its text', async () => {
    setWidth(NARROW);
    renderShell();
    act(() => void openFile(A, APP, null, { main: true }));
    await waitFor(() => expect(textOf(APP, 'main')).not.toBeNull(), { timeout: 5000 });
    act(() => useLayout.getState().activateTab(`session:${A}`)); // back to the session: the file's tab behind it
    await waitFor(() => expect(textOf(APP, 'main')).toBeNull());
    await findFromComposer('app', [APP]);
    expect(sheetDismissal()).not.toBeNull();
    fireEvent.keyDown(field()!, { key: 'Enter' });
    await waitFor(() => expect(activeTab(useLayout.getState().main)?.id).toBe(KEY(APP)));
    await waitFor(() => expect(sheetDismissal()).toBeNull());
    expect([panelCollapsed(), mainRegion().hasAttribute('inert')]).toEqual([true, false]);
    await waitFor(() => expect(document.activeElement).toBe(textOf(APP, 'main')), { timeout: 5000 });
    expect(document.activeElement!.closest('[role="tab"]')).toBeNull();
  });

  it('the control, a file that opens beside the tree: the sheet stays and the keyboard is in the file’s text in it', async () => {
    setWidth(NARROW);
    renderShell();
    await findFromComposer('tides', [TIDES]);
    fireEvent.keyDown(field()!, { key: 'Enter' });
    await waitFor(() => expect(document.activeElement).toBe(textOf(TIDES, 'panel')), { timeout: 5000 });
    expect([sheetDismissal() !== null, panelCollapsed(), mainRegion().hasAttribute('inert')]).toEqual([true, false, true]);
    expect(activeTab(useLayout.getState().main)?.id).toBe(`session:${A}`);
  });
});
