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
import { FileBody, FileViewer } from '../viewer/FileViewer';
import { useViewer } from '../viewer/viewer-store';
import { filesTool } from './FilesTool';
import { connectGoToFile, FILE_TAKE_BOUND_MS, keyboardWaits, requestKeyboard } from './finder';
import { useFiles } from './store';
import { resetTreeState, treeOf, useTreeState } from './tree-state';

vi.mock('../../../app/Diagnostics', () => ({ Diagnostics: () => <section aria-label="Diagnostics">diagnostics</section> }));

const APP = '/r/src/app.ts';
const TIDES = '/r/src/tides.ts';
const KEY = (path: string) => `file:${TEST_MACHINE}:${path}`;
const dir = (path: string): FilesEntry => ({ name: path.slice(path.lastIndexOf('/') + 1), path, kind: 'dir', size: 0, mtimeMs: 0, target: null });
const file = (path: string): FilesEntry => ({ ...dir(path), kind: 'file', size: 10 });
const REPO: Record<string, FilesEntry[]> = { '': [dir('/r')], '/r': [dir('/r/src')], '/r/src': [file(APP), file(TIDES)] };
const UNKNOWN_SESSION = `unknown app session ${A}`; // main's answer for a session it cannot place: the viewer's no-session notice

let heldReads: Map<string, ReturnType<typeof deferred<void>>>;
let failedReads: Map<string, string>; // a path's read fails with this message
function openMain() {
  return installFakeMain(async (name, input) => {
    if (name === 'layout.get') return ok({ value: null });
    if (name === 'layout.set' || name === 'files.watch' || name === 'files.unwatch' || name === 'git.unwatch') return ok();
    if (name === 'git.watch') return fail('not a git repository');
    if (name === 'fs.workflows') return ok({ runs: [] });
    if (name === 'git.lsFiles') return ok({ paths: ['src/app.ts', 'src/tides.ts', 'src/'].filter((path) => path.includes(input.query as string)), truncated: false, source: 'git' });
    if (name === 'files.list') {
      const path = (input.path as string | undefined) ?? '';
      const found = REPO[path];
      return found === undefined ? fail(`not found: ${path}`) : ok({ root: path === '' ? null : '/r', path, entries: found, truncated: false });
    }
    if (name === 'files.read') {
      const path = String(input.path);
      await heldReads.get(path)?.promise;
      const failure = failedReads.get(path);
      if (failure !== undefined) return fail(failure);
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
  failedReads = new Map();
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

// ⌘P from the composer, `query` typed, and Enter on its one result (`path`) once it is listed; `beforeEnter` runs just
// before the Enter.
async function findAndEnter(query = 'app', path = APP, beforeEnter?: () => void): Promise<void> {
  act(() => composer().focus());
  act(() => runAction('files.goToFile'));
  await waitFor(() => expect(document.activeElement).toBe(field()));
  fireEvent.change(field()!, { target: { value: query } });
  await waitFor(() => expect([...document.querySelectorAll('[data-files-result]')].map((row) => row.getAttribute('data-path'))).toEqual([path]));
  beforeEnter?.();
  fireEvent.keyDown(field()!, { key: 'Enter' });
}

// Each case waits on an editor's first drawing, which a loaded worker can take past a second, up to five each.
describe('Enter puts the keyboard in the file (S3; B5)', { timeout: 20_000 }, () => {
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

  it('beside the chat, a press in the composer before the read lands: the keyboard stays there and the editor takes nothing; with no press between, the editor takes it', async () => {
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
    const control = holdRead(TIDES); // the control: the same hand-off with nothing between
    await findAndEnter('tides', TIDES);
    await waitFor(() => expect(document.activeElement).toBe(body(TIDES, 'panel')));
    act(() => control.resolve());
    await waitFor(() => expect(document.activeElement).toBe(textOf(TIDES, 'panel')), { timeout: 5000 });
  });

  it('beside the chat, a read that fails because the session is not one main can place: the notice is drawn in the body, which keeps the keyboard', async () => {
    failedReads.set(APP, UNKNOWN_SESSION);
    render(<Page />);
    act(() => void openFile(A, APP, null, { keep: true }));
    await waitFor(() => expect(document.querySelector(`[data-region="panel"] [data-file-viewer][data-path="${APP}"]`)?.textContent).toContain('No session grants access to this file'));
    await findAndEnter(); // the failure is there before Enter: the body still takes the request
    await waitFor(() => expect(document.activeElement).toBe(body(APP, 'panel')));
    expect(document.activeElement!.textContent).toContain('No session grants access to this file');
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

  // Below Enter (Interfaces §E): the request by the file's key is what puts the keyboard in a file's text wherever it is
  // drawn; here with an open that brings the file's main tab forward, as Enter's does.
  it('the request for a file’s keyboard, made with an open that brings its main tab forward, is taken inside that tab’s text and never on a tab', async () => {
    render(<Page />);
    act(() => void openFile(A, APP, null, { main: true }));
    await waitFor(() => expect(textOf(APP, 'main')).not.toBeNull(), { timeout: 5000 });
    act(() => useLayout.getState().activateTab(`session:${A}`));
    await waitFor(() => expect(textOf(APP, 'main')).toBeNull());
    act(() => composer().focus());
    act(() => {
      void openFile(A, APP, null, { keep: true });
      requestKeyboard({ into: 'file', key: KEY(APP) });
    });
    await waitFor(() => expect(activeTab(useLayout.getState().main)?.id).toBe(KEY(APP)));
    await waitFor(() => expect(document.activeElement).toBe(textOf(APP, 'main')), { timeout: 5000 });
    expect(document.activeElement!.closest('[role="tab"]')).toBeNull();
  });

  it('a main tab of the file whose read is held and then fails: the keyboard is on the file’s body and stays there', async () => {
    render(<Page />);
    act(() => useLayout.getState().openTab({ kind: 'file', path: APP, line: null, appSessionId: A, machine: TEST_MACHINE }, { activate: false }));
    const read = holdRead(APP);
    failedReads.set(APP, `denied: ${APP}`);
    await findAndEnter();
    await waitFor(() => expect(activeTab(useLayout.getState().main)?.id).toBe(KEY(APP)));
    await waitFor(() => expect(document.activeElement).toBe(body(APP, 'main')));
    act(() => read.resolve());
    await waitFor(() => expect(body(APP, 'main')?.querySelector('[data-refusal]')).not.toBeNull());
    await settle();
    expect(document.activeElement).toBe(body(APP, 'main'));
    expect(document.activeElement!.closest('[role="tab"]')).toBeNull();
  });

  it('a main tab of the file whose read is held and then fails because the session is not one main can place: the keyboard stays on the body, which draws the notice', async () => {
    render(<Page />);
    act(() => useLayout.getState().openTab({ kind: 'file', path: APP, line: null, appSessionId: A, machine: TEST_MACHINE }, { activate: false }));
    const read = holdRead(APP);
    failedReads.set(APP, UNKNOWN_SESSION);
    await findAndEnter();
    await waitFor(() => expect(activeTab(useLayout.getState().main)?.id).toBe(KEY(APP)));
    const waiting = await waitFor(() => {
      expect(document.activeElement).toBe(body(APP, 'main'));
      return document.activeElement;
    });
    act(() => read.resolve());
    await waitFor(() => expect(document.querySelector(`[data-region="main"] [data-file-viewer][data-path="${APP}"]`)?.textContent).toContain('No session grants access to this file'));
    await settle();
    expect(document.activeElement).toBe(waiting); // the same element: the body is not drawn again
    expect(document.activeElement).toBe(body(APP, 'main'));
  });
});

// A take the page refuses (Decision Log 17). Chromium does not move the keyboard to an element under an inert or hidden
// ancestor, nor at a moment the page will not take it; happy-dom moves it anywhere. These cases model both refusals on
// the prototype, for their own run: `refusing` is a moment with no change to the page that would tell anyone it ended.
// The request holds until the keyboard is in the file's view, and is dropped only by the person's own press.
describe('a take the page refuses (Decision Log 17)', { timeout: 20_000 }, () => {
  const focus = HTMLElement.prototype.focus;
  let refusing = false;
  beforeEach(() => {
    refusing = false;
    HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
      if (refusing || this.closest('[inert], [hidden]') !== null) return;
      focus.call(this, options);
    };
  });
  afterEach(() => {
    HTMLElement.prototype.focus = focus;
  });
  const panel = () => document.querySelector<HTMLElement>('[data-region="panel"]')!;

  it('beside the chat, the body under an inert ancestor as it mounts: the request holds, the body takes the keyboard once the ancestor lets it, and the text when the read lands', async () => {
    const read = holdRead(APP);
    render(<Page />);
    await findAndEnter('app', APP, () => panel().setAttribute('inert', ''));
    await waitFor(() => expect(body(APP, 'panel')).not.toBeNull());
    await settle();
    expect(document.activeElement, 'the take refused').not.toBe(body(APP, 'panel'));
    act(() => panel().removeAttribute('inert'));
    await waitFor(() => expect(document.activeElement).toBe(body(APP, 'panel')));
    act(() => read.resolve());
    await waitFor(() => expect(document.activeElement).toBe(textOf(APP, 'panel')), { timeout: 5000 });
  });

  it('beside the chat, a moment that refuses the body’s take: the request holds, and the editor takes the keyboard when it is drawn', async () => {
    const read = holdRead(APP);
    render(<Page />);
    await findAndEnter('app', APP, () => {
      refusing = true;
    });
    await waitFor(() => expect(body(APP, 'panel')).not.toBeNull());
    await settle();
    expect(document.activeElement, 'the take refused').not.toBe(body(APP, 'panel'));
    refusing = false; // nothing in the page changes: only the editor's drawing can try again
    act(() => read.resolve());
    await waitFor(() => expect(document.activeElement).toBe(textOf(APP, 'panel')), { timeout: 5000 });
  });

  it('a refused take, then the person’s press in the composer: the held request is dropped, and neither the page’s change nor the editor takes the keyboard from there', async () => {
    const read = holdRead(APP);
    render(<Page />);
    await findAndEnter('app', APP, () => {
      refusing = true;
    });
    await waitFor(() => expect(body(APP, 'panel')).not.toBeNull());
    await settle();
    refusing = false;
    fireEvent.pointerDown(composer());
    act(() => composer().focus());
    act(() => {
      panel().setAttribute('inert', '');
      panel().removeAttribute('inert');
    });
    act(() => read.resolve());
    await waitFor(() => expect(textOf(APP, 'panel')).not.toBeNull(), { timeout: 5000 });
    await settle();
    expect(document.activeElement).toBe(composer());
    const control = holdRead(TIDES); // the control: the same refused take with no press between
    await findAndEnter('tides', TIDES, () => {
      refusing = true;
    });
    await waitFor(() => expect(body(TIDES, 'panel')).not.toBeNull());
    await settle();
    refusing = false;
    act(() => control.resolve());
    await waitFor(() => expect(document.activeElement).toBe(textOf(TIDES, 'panel')), { timeout: 5000 });
  });

  // Decision Log 19: the request is held through its bound once the view is ready, landed or not, so a view drawn again
  // in that time (here its read again: the entry back to loading, then ready, and the editor made anew) takes the
  // keyboard back from wherever the old editor's going left it, with no press between.
  it('the keyboard in the text, then the editor drawn anew with no press: the keyboard back in the new text', async () => {
    render(<Page />);
    act(() => void openFile(A, APP, null, { keep: true }));
    await waitFor(() => expect(textOf(APP, 'panel')).not.toBeNull(), { timeout: 5000 });
    await findAndEnter();
    await waitFor(() => expect(document.activeElement).toBe(textOf(APP, 'panel')));
    const first = textOf(APP, 'panel');
    const entry = () => useViewer.getState().entries.get(KEY(APP))!;
    act(() => useViewer.setState((s) => ({ entries: new Map(s.entries).set(KEY(APP), { ...entry(), status: 'loading' }) })));
    await waitFor(() => expect(textOf(APP, 'panel')).toBeNull());
    act(() => useViewer.setState((s) => ({ entries: new Map(s.entries).set(KEY(APP), { ...entry(), status: 'ready', epoch: entry().epoch + 1 }) })));
    await waitFor(() => expect(textOf(APP, 'panel')).not.toBeNull(), { timeout: 5000 });
    expect(textOf(APP, 'panel'), 'an editor made anew').not.toBe(first);
    await waitFor(() => expect(document.activeElement).toBe(textOf(APP, 'panel')));
  });

  // Decision Log 18: the keyboard put elsewhere by any means ends the held request, a native menu's command among them,
  // which makes no key or pointer press in the page.
  it('a refused take, then the keyboard moved to the composer with no press (a native menu’s command): the held request ends, and neither the page’s change nor the editor takes the keyboard back', async () => {
    const read = holdRead(APP);
    render(<Page />);
    await findAndEnter('app', APP, () => {
      refusing = true;
    });
    await waitFor(() => expect(body(APP, 'panel')).not.toBeNull());
    await settle();
    refusing = false;
    act(() => composer().focus()); // no keydown, no pointerdown
    expect(keyboardWaits({ into: 'file', key: KEY(APP) }), 'the request ended').toBe(false);
    act(() => {
      panel().setAttribute('inert', '');
      panel().removeAttribute('inert');
    });
    act(() => read.resolve());
    await waitFor(() => expect(textOf(APP, 'panel')).not.toBeNull(), { timeout: 5000 });
    await settle();
    expect(document.activeElement).toBe(composer());
    const control = holdRead(TIDES); // the control: the same refused take with nothing moved
    await findAndEnter('tides', TIDES, () => {
      refusing = true;
    });
    await waitFor(() => expect(body(TIDES, 'panel')).not.toBeNull());
    await settle();
    refusing = false;
    expect(keyboardWaits({ into: 'file', key: KEY(TIDES) }), 'the request still waits').toBe(true);
    act(() => control.resolve());
    await waitFor(() => expect(document.activeElement).toBe(textOf(TIDES, 'panel')), { timeout: 5000 });
  });

  // Decision Log 18: a view with no editor (here a read that fails) is ready once its read settles; a take still refused
  // `FILE_TAKE_BOUND_MS` after that is dropped, and its watch on the page with it, so a much later change of the page
  // moves nothing.
  it('a view with no editor under a refusal: within the bound after its read settles the request ends and the page is no longer watched; a later change takes nothing', async () => {
    const watching = new Set<MutationObserver>();
    let watched = 0;
    class Recording extends MutationObserver {
      override observe(target: Node, options?: MutationObserverInit): void {
        if (options?.attributeFilter?.includes('inert') === true) {
          watching.add(this);
          watched += 1;
        }
        super.observe(target, options);
      }
      override disconnect(): void {
        watching.delete(this);
        super.disconnect();
      }
    }
    vi.stubGlobal('MutationObserver', Recording);
    failedReads.set(APP, `denied: ${APP}`);
    render(<Page />);
    await findAndEnter('app', APP, () => {
      refusing = true;
    });
    await waitFor(() => expect(body(APP, 'panel')?.querySelector('[data-refusal]')).not.toBeNull());
    expect(watched, 'the held take watched the page').toBeGreaterThan(0);
    await waitFor(
      () => {
        expect(keyboardWaits({ into: 'file', key: KEY(APP) }), 'the request ended').toBe(false);
        expect(watching.size, 'the page no longer watched').toBe(0);
      },
      { timeout: FILE_TAKE_BOUND_MS * 4 },
    );
    refusing = false;
    act(() => panel().classList.add('a-later-change'));
    await settle();
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(document.activeElement).not.toBe(body(APP, 'panel'));
  });
});

// The file view's body as a place for the keyboard (Decision Log 11): no new tab stop, and its outline drawn under
// `focus-visible` only, so a mouse click that lands the keyboard on it draws no ring. The File artifact's body (no key)
// is not focusable.
describe('the file view’s body', () => {
  it('under a key is focusable at tabIndex -1 with the app’s outline under focus-visible only; with none it is not focusable', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <FileViewer tab={{ id: KEY(APP), kind: 'file', path: APP, line: null, appSessionId: A, machine: TEST_MACHINE, pinned: false }} />
        <FileBody tabId="artifact:a1:1" appSessionId={A} path={TIDES} />
      </QueryClientProvider>,
    );
    const keyed = document.querySelector<HTMLElement>(`[data-file-viewer][data-path="${APP}"]`)!;
    expect([keyed.getAttribute('tabindex'), keyed.getAttribute('data-file-keyboard'), keyed.getAttribute('data-key')]).toEqual(['-1', '', KEY(APP)]);
    const outlines = (element: HTMLElement) => element.className.split(/\s+/).filter((name) => /outline|focus|ring/.test(name)).sort();
    expect(outlines(keyed)).toEqual(['-outline-offset-2', 'focus-visible:outline-2', 'outline-accent']); // no `focus:` class among them
    const plain = document.querySelector<HTMLElement>(`[data-file-viewer][data-path="${TIDES}"]`)!;
    expect([plain.hasAttribute('tabindex'), plain.hasAttribute('data-file-keyboard')]).toEqual([false, false]);
    expect(outlines(plain)).toEqual([]);
  });
});
