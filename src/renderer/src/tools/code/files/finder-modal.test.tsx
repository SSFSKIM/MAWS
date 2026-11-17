// Go to file while a modal holds the keyboard (UX wave U6b-3b, docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md,
// Decision Log 16, the architect's ruling on the xhigh panel). Go ▸ Go to file, or ⌘P, arrives from main as `layout.action`
// while the page may hold a Radix modal, whose focus trap no field outside it can take the keyboard from. A modal that
// holds nothing a person would lose (the Command palette, Keyboard shortcuts) is closed, and Go to file runs from its
// close: the keyboard is back at the modal's opener, which Esc's second step returns it to. Every other modal (a sheet, a
// modal menu) keeps the action disabled in the menu while it is open. The shell drawn whole, with the real Files; the
// actions main enables are read from what the page reports to it (`layout.setEnabledActions`). Invented paths.
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import type { FilesEntry } from '@shared/ipc/schema/files';
import { record } from '../../../../../../test/support/builders';
import { Shell } from '../../../app/Shell';
import { registerSlot, resetSlots } from '../../../app/slots';
import { connectCodeEvents } from '../../../ipc/events';
import { queryClient } from '../../../ipc/query';
import { isActionEnabled } from '../../../keymap/actions-runtime';
import { connectActions } from '../../../keymap/dispatcher';
import { toggleKeyboardShortcuts } from '../../../keymap/KeyboardShortcuts';
import { openPalette, usePalette } from '../../../palette/CommandPalette';
import { connectPanelHost, registerPanelTool } from '../../../panel/host';
import { PanelHost } from '../../../panel/PanelHost';
import { Sheet } from '../../../sessions/Sheet';
import { useLayout } from '../../../stores/layout';
import { useSessions } from '../../../stores/sessions';
import { fail, installFakeMain, ok } from '../../../test-support/code';
import { A, resetPanelStores } from '../../../test-support/panel';
import { installResizeObserver } from '../../../test-support/resize';
import { resetKeptOpens } from '../open-file';
import { FileViewer } from '../viewer/FileViewer';
import { useViewer } from '../viewer/viewer-store';
import { filesTool } from './FilesTool';
import { connectGoToFile } from './finder';
import { useFiles } from './store';
import { resetTreeState } from './tree-state';

vi.mock('../../../app/Diagnostics', () => ({ Diagnostics: () => <section aria-label="Diagnostics">diagnostics</section> }));

const dir = (path: string): FilesEntry => ({ name: path.slice(path.lastIndexOf('/') + 1), path, kind: 'dir', size: 0, mtimeMs: 0, target: null });
const file = (path: string): FilesEntry => ({ ...dir(path), kind: 'file', size: 10 });
const REPO: Record<string, FilesEntry[]> = { '': [dir('/r')], '/r': [dir('/r/src')], '/r/src': [file('/r/src/tides.ts')] };

let main: ReturnType<typeof installFakeMain>;
function openMain() {
  return installFakeMain(async (name, input) => {
    if (name === 'layout.get') return ok({ value: null });
    if (name === 'git.watch') return fail('not a git repository');
    if (name === 'fs.workflows') return ok({ runs: [] });
    if (name === 'git.lsFiles') return ok({ paths: ['src/tides.ts'], truncated: false, source: 'git' });
    if (name === 'files.list') {
      const path = (input.path as string | undefined) ?? '';
      const found = REPO[path];
      return found === undefined ? fail(`not found: ${path}`) : ok({ root: path === '' ? null : '/r', path, entries: found, truncated: false });
    }
    return ok();
  });
}

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

// A sheet the test opens and closes: a form with a field, as a rename is.
const useTestSheet = create<{ open: boolean }>(() => ({ open: false }));
function TestSheet() {
  const open = useTestSheet((s) => s.open);
  if (!open) return null;
  return (
    <Sheet title="Rename" onClose={() => useTestSheet.setState({ open: false })}>
      <input aria-label="An invented name" />
    </Sheet>
  );
}

// A menu the test opens: Radix's default is modal, as a request card's "More deny options" is; `modal={false}` as most of
// the app's menus are.
function TestMenu({ modal }: { modal: boolean }) {
  return (
    <DropdownMenu.Root modal={modal}>
      <DropdownMenu.Trigger>More options</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <DropdownMenu.Item>An invented option</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const offs: (() => void)[] = [];
beforeEach(() => {
  resetPanelStores();
  resetKeptOpens();
  resetTreeState();
  useFiles.getState().reset();
  useViewer.getState().reset();
  useLayout.setState({ overviewOpen: false });
  usePalette.setState({ open: false });
  useTestSheet.setState({ open: false });
  installResizeObserver();
  main = openMain();
  offs.push(connectCodeEvents(), connectPanelHost(), registerPanelTool(filesTool), connectGoToFile(), connectActions());
  registerSlot('panelHost', PanelHost);
  registerSlot('fileTab', FileViewer);
  registerSlot('transcript', () => <div>an invented transcript</div>);
  registerSlot('composer', () => <textarea aria-label="Composer" />);
  registerSlot('newSession', () => <h2>setup</h2>);
  useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { directory: '/r' })) }));
});
afterEach(() => {
  if (shortcuts() !== null) act(() => toggleKeyboardShortcuts()); // its open state is its store's, which outlives the page
  cleanup();
  resetSlots();
  offs.splice(0).forEach((off) => off());
  resetKeptOpens();
  useViewer.getState().reset();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })); // no request held over into the next case
});

function renderShell(extra: ReactNode = null) {
  return render(
    <QueryClientProvider client={queryClient}>
      <Shell />
      {extra}
    </QueryClientProvider>,
  );
}

const composer = () => screen.getByRole('textbox', { name: 'Composer' });
const field = () => document.querySelector<HTMLInputElement>('[data-files-filter]');
const palette = () => screen.queryByRole('dialog', { name: 'Command palette' });
const shortcuts = () => screen.queryByRole('dialog', { name: 'Keyboard shortcuts' });
const esc = () => fireEvent.keyDown(field()!, { key: 'Escape' });
// What main last heard the page enable, so what the application menu enables
const menuEnables = () => (main.callsOf('layout.setEnabledActions').at(-1)?.actions ?? []) as string[];
// Go ▸ Go to file, or its ⌘P: main's menu sends the action to the page
const menuGoToFile = () => act(() => main.emit('layout.action', { action: 'files.goToFile', arg: null }));

async function composerHoldsKeyboard(): Promise<void> {
  await waitFor(() => expect(composer()).toBeTruthy());
  act(() => composer().focus());
}

describe('Go to file while a modal that holds nothing a person would lose has the keyboard: the modal closes and Go to file runs from its close (Decision Log 16)', () => {
  it('the Command palette open over the composer: Go ▸ Go to file closes it and the field has the keyboard; Esc twice gives it back to the composer, still in the page', async () => {
    renderShell();
    await composerHoldsKeyboard();
    act(() => openPalette());
    await waitFor(() => expect(palette()?.contains(document.activeElement)).toBe(true));
    await waitFor(() => expect(menuEnables()).toContain('files.goToFile')); // enabled while the palette holds the keyboard
    menuGoToFile();
    await waitFor(() => expect(palette()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(field()));
    expect(field()!.value).toBe('');
    esc(); // the field empty: the keyboard back where Go to file found it, the palette's opener
    expect(document.activeElement).toBe(composer());
    expect(composer().isConnected).toBe(true);
  });

  it('Keyboard shortcuts open over the composer: the same', async () => {
    renderShell();
    await composerHoldsKeyboard();
    act(() => toggleKeyboardShortcuts());
    await waitFor(() => expect(shortcuts()?.contains(document.activeElement)).toBe(true));
    await waitFor(() => expect(menuEnables()).toContain('files.goToFile'));
    menuGoToFile();
    await waitFor(() => expect(shortcuts()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(field()));
    esc();
    expect(document.activeElement).toBe(composer());
    expect(composer().isConnected).toBe(true);
  });

  it('the control: with no modal open, the same Go ▸ Go to file takes the keyboard from the composer and Esc twice gives it back', async () => {
    renderShell();
    await composerHoldsKeyboard();
    menuGoToFile();
    await waitFor(() => expect(document.activeElement).toBe(field()));
    esc();
    expect(document.activeElement).toBe(composer());
  });
});

describe('Go to file while any other modal is open: disabled in the menu (Decision Log 16)', () => {
  it('a sheet: Go to file leaves the menu’s enabled actions while it is open and comes back when it closes', async () => {
    renderShell(<TestSheet />);
    await composerHoldsKeyboard();
    await waitFor(() => expect(menuEnables()).toContain('files.goToFile')); // the control: nothing open
    act(() => useTestSheet.setState({ open: true }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Rename' }).contains(document.activeElement)).toBe(true));
    await waitFor(() => expect(menuEnables()).not.toContain('files.goToFile'));
    act(() => useTestSheet.setState({ open: false }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rename' })).toBeNull());
    await waitFor(() => expect(menuEnables()).toContain('files.goToFile'));
  });

  // The task review's finding: a lender holding the keyboard must not hide a modal under it
  it.each([
    ['the Command palette', () => openPalette(), () => usePalette.setState({ open: false }), () => palette()],
    ['Keyboard shortcuts', () => toggleKeyboardShortcuts(), () => toggleKeyboardShortcuts(), () => shortcuts()],
  ])('%s opened over a sheet: Go to file stays disabled while the sheet is under it; the control, the same modal alone, enables it', async (_name, open, close, modal) => {
    renderShell(<TestSheet />);
    await composerHoldsKeyboard();
    // the control: the lender alone holds the keyboard, and Go to file is enabled
    act(() => open());
    await waitFor(() => expect(modal()?.contains(document.activeElement)).toBe(true));
    await waitFor(() => expect(menuEnables()).toContain('files.goToFile'));
    expect(isActionEnabled('files.goToFile')).toBe(true);
    act(() => close());
    await waitFor(() => expect(modal()).toBeNull());
    // the sheet, then the same lender over it: the keyboard in the lender, the sheet still open under it
    act(() => useTestSheet.setState({ open: true }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Rename' }).contains(document.activeElement)).toBe(true));
    await waitFor(() => expect(menuEnables()).not.toContain('files.goToFile'));
    act(() => open());
    await waitFor(() => expect(modal()?.contains(document.activeElement)).toBe(true));
    expect(document.querySelector('input[aria-label="An invented name"]')).not.toBeNull(); // the sheet still open, under it
    await waitFor(() => expect(isActionEnabled('files.goToFile')).toBe(false));
    expect(menuEnables()).not.toContain('files.goToFile');
    act(() => close());
    await waitFor(() => expect(modal()).toBeNull());
    expect(isActionEnabled('files.goToFile')).toBe(false); // the sheet still open
    act(() => useTestSheet.setState({ open: false }));
    await waitFor(() => expect(isActionEnabled('files.goToFile')).toBe(true));
  });

  it('a menu Radix draws as modal (its default, as a request card’s answer menus): disabled while it is open; the control, a menu drawn with `modal={false}`, leaves it enabled', async () => {
    renderShell(
      <>
        <TestMenu modal />
        <TestMenu modal={false} />
      </>,
    );
    await composerHoldsKeyboard();
    const [modalTrigger, plainTrigger] = screen.getAllByRole('button', { name: 'More options' });
    await waitFor(() => expect(menuEnables()).toContain('files.goToFile'));
    fireEvent.keyDown(modalTrigger!, { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('menu').contains(document.activeElement)).toBe(true));
    await waitFor(() => expect(menuEnables()).not.toContain('files.goToFile'));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(menuEnables()).toContain('files.goToFile'));
    fireEvent.keyDown(plainTrigger!, { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('menu').contains(document.activeElement)).toBe(true));
    expect(menuEnables()).toContain('files.goToFile');
  });
});
