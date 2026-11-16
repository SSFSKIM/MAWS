// The file viewer (C8c execution document, M2): the kind decision and its caps, the data URL by encoding, the line jump's
// target, and the `fileTab` slot over a fake X2 client (a refusal in words, continuation reads, the line jump, Source,
// the follow-the-file refresh, the no-session tab).
import { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mimeOf } from '@shared/files/mime';
import type { AppSessionId } from '@shared/graph/ids';
import { FILES_READ_DEFAULT_LENGTH } from '@shared/ipc/schema/files';
import { LAYOUT_DEFAULTS, type TabRef } from '@shared/ipc/schema/layout';
import { addressOf } from '@shared/machine/address';
import { record } from '../../../../../../test/support/builders';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../../../test/support/machine';
import { connectCodeEvents } from '../../../ipc/events';
import { useLayout } from '../../../stores/layout';
import { useSessions } from '../../../stores/sessions';
import type { TranscriptEntry } from '../../../stores/transcript';
import { useTranscriptStore, type TurnId } from '../../../transcript';
import { deferred, fail, installFakeMain, ok } from '../../../test-support/code';
import { openChosen } from '../files/open-chosen';
import { useFiles } from '../files/store';
import { codeTranscriptActions, normalizeLexically, openFile, sessionOfTurn } from '../open-file';
import { FLASH_CLASS } from './CodeView';
import { FileBody, FileViewer } from './FileViewer';
import { fakeHash, frameToken, installDisk, OUTSIDE_REFUSAL } from '../../../test-support/code-disk';
import { framedKindOf, frameUrl } from '@shared/files/framed';
import { installResizeObserver } from '../../../test-support/resize';
import { CODE_CAP, dataUrl, externalKindOf, IMAGE_CAP, jumpTarget, kindOf, MARKDOWN_RENDER_CAP } from './kinds';
import { existingViewState, readOnlyReason, useViewer, VIEWER_ENTRIES_MAX } from './viewer-store';
import { registerPanelTool } from '../../../panel/host'; // UX wave U6b-1: a link opens beside the chat, in a Files tab
import { filesTool } from '../files/FilesTool';
import { currentSet } from '../../../stores/layout-model';

// UX wave U6b-2: happy-dom knows no `maws-artifact:` scheme, so a file's frame only takes its URL (child-frame navigation off)
beforeAll(() => void ((window as unknown as { happyDOM: { settings: { navigation: { disableChildFrameNavigation: boolean } } } }).happyDOM.settings.navigation.disableChildFrameNavigation = true));
const text = { encoding: 'utf8' as const };
const binary = { encoding: 'base64' as const };

describe('viewer kinds', () => {
  it('decides every row of the table', () => {
    expect(kindOf({ name: '/r/README.md', mime: 'text/markdown', bytes: 10, ...text })).toBe('markdown');
    expect(kindOf({ name: '/r/a.mdx', mime: 'text/markdown', bytes: 10, ...text })).toBe('markdown');
    expect(kindOf({ name: '/r/a.markdown', mime: 'text/plain', bytes: 10, ...text })).toBe('markdown');
    expect(kindOf({ name: '/r/dot.png', mime: 'image/png', bytes: 70, ...binary })).toBe('image');
    expect(kindOf({ name: '/r/label.svg', mime: 'image/svg+xml', bytes: 300, ...text })).toBe('image');
    // UX wave U6b-2: a PDF, an HTML page, a sound and a video are drawn in a frame, whatever their size
    expect(kindOf({ name: '/r/doc.pdf', mime: 'application/pdf', bytes: 30, ...binary })).toBe('frame');
    expect(kindOf({ name: '/r/page.html', mime: 'text/html', bytes: 30, ...text })).toBe('frame');
    expect(kindOf({ name: '/r/a.mp3', mime: 'audio/mpeg', bytes: 30, ...binary })).toBe('frame');
    expect(kindOf({ name: '/r/a.mov', mime: 'video/quicktime', bytes: 30, ...binary })).toBe('frame');
    expect(kindOf({ name: '/r/long.mp4', mime: 'video/mp4', bytes: CODE_CAP * 40, ...binary })).toBe('frame');
    expect(kindOf({ name: '/r/big.html', mime: 'text/html', bytes: CODE_CAP + 1, ...text })).toBe('frame');
    expect(kindOf({ name: '/r/data.bin', mime: 'application/octet-stream', bytes: 12, ...binary })).toBe('external');
    expect(kindOf({ name: '/r/scan.tiff', mime: 'image/tiff', bytes: 30, ...binary })).toBe('external'); // not drawable inline
    expect(kindOf({ name: '/r/huge.png', mime: 'image/png', bytes: IMAGE_CAP + 1, ...binary })).toBe('external'); // past the image cap
    expect(kindOf({ name: '/r/big.log', mime: 'text/plain', bytes: 20 * 1024 * 1024, ...text })).toBe('head');
    expect(kindOf({ name: '/r/app.ts', mime: 'text/x-typescript', bytes: 900, ...text })).toBe('code');
  });

  it('decides binary by the service encoding, never by the extension alone', () => {
    expect(kindOf({ name: '/r/nuls.txt', mime: 'application/octet-stream', bytes: 12, ...binary })).toBe('external');
    expect(kindOf({ name: '/r/table.dat', mime: 'text/plain', bytes: 12, ...text })).toBe('code');
  });

  it('holds each cap at its boundary: CAP renders, CAP + 1 does not', () => {
    expect(kindOf({ name: '/r/a.md', mime: 'text/markdown', bytes: MARKDOWN_RENDER_CAP, ...text })).toBe('markdown');
    expect(kindOf({ name: '/r/a.md', mime: 'text/markdown', bytes: MARKDOWN_RENDER_CAP + 1, ...text })).toBe('code');
    expect(kindOf({ name: '/r/a.png', mime: 'image/png', bytes: IMAGE_CAP, ...binary })).toBe('image');
    expect(kindOf({ name: '/r/a.png', mime: 'image/png', bytes: IMAGE_CAP + 1, ...binary })).toBe('external');
    expect(kindOf({ name: '/r/a.ts', mime: 'text/x-typescript', bytes: CODE_CAP, ...text })).toBe('code');
    expect(kindOf({ name: '/r/a.ts', mime: 'text/x-typescript', bytes: CODE_CAP + 1, ...text })).toBe('head');
    expect(kindOf({ name: '/r/a.md', mime: 'text/markdown', bytes: CODE_CAP + 1, ...text })).toBe('head');
  });

  it('names the external row by kind', () => {
    expect(externalKindOf({ mime: 'application/pdf', bytes: 1, ...binary })).toBe('PDF');
    expect(externalKindOf({ mime: 'text/html', bytes: 1, ...text })).toBe('HTML');
    expect(externalKindOf({ mime: 'audio/wav', bytes: 1, ...binary })).toBe('Audio');
    expect(externalKindOf({ mime: 'video/mp4', bytes: 1, ...binary })).toBe('Video');
    expect(externalKindOf({ mime: 'image/png', bytes: IMAGE_CAP + 1, ...binary })).toBe('Image');
    expect(externalKindOf({ mime: 'application/zip', bytes: 1, ...binary })).toBe('Binary');
    expect(externalKindOf({ mime: 'text/x-typescript', bytes: 1, ...text })).toBeNull();
  });

  it('builds the data URL from the read encoding: base64 as is, utf8 base64-encoded from its UTF-8 bytes', () => {
    expect(dataUrl('image/png', 'base64', 'iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Ünïcødé — 日本語 é</text></svg>';
    const url = dataUrl('image/svg+xml', 'utf8', svg);
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
    const bytes = Uint8Array.from(atob(url.slice('data:image/svg+xml;base64,'.length)), (c) => c.charCodeAt(0));
    expect(bytes).toEqual(new TextEncoder().encode(svg));
    expect(new TextDecoder().decode(bytes)).toBe(svg);
  });

  it('jumps to a loaded line, waits for one not yet loaded, and scrolls to the end past a complete document', () => {
    expect(jumpTarget({ line: null, lines: 10, complete: true })).toEqual({ kind: 'none' });
    expect(jumpTarget({ line: 5, lines: 10, complete: false })).toEqual({ kind: 'line', line: 5 });
    expect(jumpTarget({ line: 30_000, lines: 19_000, complete: false })).toEqual({ kind: 'wait' });
    expect(jumpTarget({ line: 30_000, lines: 40_001, complete: true })).toEqual({ kind: 'line', line: 30_000 });
    expect(jumpTarget({ line: 99, lines: 10, complete: true })).toEqual({ kind: 'end' });
    expect(jumpTarget({ line: 0, lines: 10, complete: true })).toEqual({ kind: 'line', line: 1 });
  });
});

// ---- the viewer over a fake main ------------------------------------------------------------------------------------

// P5 O6 M2: the page's ids are addresses and its file tabs name their machine; the fake main is asked and emits with
// the bare MAIN_A.
const MAIN_A = 'app-a' as AppSessionId;
const A = at(MAIN_A);
const B = at('app-b' as AppSessionId);
const FILE = (path: string) => `file:${TEST_MACHINE}:${path}`;
const MiB = 1024 * 1024;

// A file main serves: text (ASCII, so a byte is a character), a binary image, a file generated on demand (too large to
// hold), or a refusal message.
type Served = string | { text: string; mime?: string } | { base64: string; bytes: number; mime?: string } | { refusal: string } | { generated: number; line: string };

function serve(files: Record<string, Served>, gate?: (offset: number) => Promise<void>) {
  let frames = 0;
  return installFakeMain(async (name, input) => {
    if (name === 'layout.openExternal') return ok();
    if (name === 'files.watch' || name === 'files.unwatch') return ok();
    if (name === 'files.openExternal') return ok({ opened: true, message: null });
    if (name === 'layout.releaseFrame') return ok(); // UX wave U6b-2: main's file frames
    if (name === 'layout.frameFile') {
      const framed = framedKindOf(mimeOf(input.path as string));
      const token = frameToken(++frames);
      return framed === null ? ok({ status: 'row', why: 'unframed' }) : ok({ status: 'ready', token, url: frameUrl(token, 'file'), framed, ...(framed === 'html' ? { neighbours: false } : {}) });
    }
    if (name !== 'files.read') return fail(`unexpected ${name}`);
    const path = input.path as string;
    const offset = (input.offset as number | undefined) ?? 0;
    const length = (input.length as number | undefined) ?? FILES_READ_DEFAULT_LENGTH;
    await gate?.(offset);
    const file = files[path];
    if (file === undefined) return fail(`not found: ${path}`);
    const served = typeof file === 'string' ? { text: file } : file;
    if ('refusal' in served) return fail(served.refusal);
    const mime = ('mime' in served && served.mime) || mimeOf(path);
    if ('base64' in served) return ok({ encoding: 'base64', content: served.base64, bytes: served.bytes, offset: 0, length: served.bytes, truncated: false, mime, hash: null, utf8: null });
    const bytes = 'text' in served ? served.text.length : served.generated;
    const end = Math.min(bytes, offset + length);
    const content = 'text' in served ? served.text.slice(offset, end) : served.line.repeat(Math.ceil((end - offset) / served.line.length)).slice(0, end - offset);
    return ok({ encoding: 'utf8', content, bytes, offset, length: end - offset, truncated: end < bytes, mime, hash: null, utf8: null });
  });
}

const fileTab = (path: string, line: number | null = null, appSessionId: AppSessionId | null = A): Extract<TabRef, { kind: 'file' }> => ({
  id: FILE(path),
  kind: 'file',
  path,
  line,
  appSessionId,
  machine: TEST_MACHINE,
  pinned: false,
});

const lines = (count: number, at: (n: number) => string) => Array.from({ length: count }, (_, i) => `${at(i + 1)}\n`).join('');
const notice = () => document.querySelector('[data-notice]')?.getAttribute('data-notice') ?? null;
const flashed = () => document.querySelector(`.${FLASH_CLASS}`)?.textContent ?? null;
const codeText = () => document.querySelector('.cm-content')?.textContent ?? null;

describe('viewer', () => {
  const offs: (() => void)[] = [];
  // Main's pushed events into the stores, as App.tsx connects them; after `serve`, which installs the bridge.
  const connect = () => offs.push(connectCodeEvents());
  beforeEach(() => {
    useViewer.getState().reset();
    useFiles.getState().reset();
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, hydrated: true });
  });
  afterEach(() => {
    cleanup();
    offs.splice(0).forEach((off) => off());
    vi.unstubAllGlobals();
  });

  it('renders a refusal in words with the path, and reads no more than once', async () => {
    const main = serve({ '/r/secret': { refusal: "path outside the session's directories" } });
    render(<FileViewer tab={fileTab('/r/secret')} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Refused: path outside the session's directories");
    expect(alert.textContent).toContain('/r/secret');
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(main.callsOf('files.read')).toHaveLength(1);
    expect(main.callsOf('files.watch')).toEqual([{ appSessionId: MAIN_A, path: '/r' }]); // the file's directory, watched before the read
  });

  it('opens code at the line, centred and flashed, and jumps again when the line changes', async () => {
    serve({ '/r/app.ts': lines(60, (n) => `export const line${n} = ${n};`) });
    const { rerender } = render(<FileViewer tab={fileTab('/r/app.ts', 25)} />);
    await waitFor(() => expect(flashed()).toBe('export const line25 = 25;'));
    expect(document.querySelector('[data-code-view]')?.getAttribute('data-language')).toBe('TypeScript');
    rerender(<FileViewer tab={fileTab('/r/app.ts', 40)} />);
    await waitFor(() => expect(flashed()).toBe('export const line40 = 40;'));
    expect(useViewer.getState().entries.get(FILE('/r/app.ts'))?.pendingJump).toBeNull();
  });

  it('completes a 2,200,000-byte text by continuation reads before presenting it complete, the line landing after its chunk', async () => {
    const text = lines(40_000, (n) => (n === 30_000 ? "export const MARKER_30000 = 'target';" : `export const v${n} = 'x';`).padEnd(54, ' '));
    expect(text.length).toBe(2_200_000);
    const gates = new Map<number, ReturnType<typeof deferred<void>>>();
    const gateAt = (offset: number) => {
      if (!gates.has(offset)) gates.set(offset, deferred<void>());
      return gates.get(offset)!;
    };
    const main = serve({ '/r/generated.ts': text }, (offset) => gateAt(offset).promise);
    render(<FileViewer tab={fileTab('/r/generated.ts', 30_000)} />);
    await act(async () => gateAt(0).resolve());
    await waitFor(() => expect(notice()).toBe('Loading 1.0 MB of 2.1 MB'));
    expect(flashed()).toBeNull(); // line 30,000 is in the second chunk
    await act(async () => gateAt(MiB).resolve());
    await waitFor(() => expect(flashed()?.trim()).toBe("export const MARKER_30000 = 'target';"));
    expect(notice()).toBe('Loading 2.0 MB of 2.1 MB');
    await act(async () => gateAt(2 * MiB).resolve());
    await waitFor(() => expect(notice()).toBeNull());
    expect(main.callsOf('files.read').map((input) => input.offset)).toEqual([0, MiB, 2 * MiB]);
    const entry = useViewer.getState().entries.get(FILE('/r/generated.ts'))!;
    expect(entry.text).toBe(text);
    expect(entry.complete).toBe(true);
  });

  it('drops what it loaded when a continuation read is refused mid-file', async () => {
    let refuse = false;
    const text = 'a'.repeat(MiB + 10);
    installFakeMain(async (name, input) => {
      if (name !== 'files.read') return ok();
      const offset = (input.offset as number | undefined) ?? 0;
      if (offset > 0 && refuse) return fail("path outside the session's directories");
      const end = Math.min(text.length, offset + MiB);
      return ok({ encoding: 'utf8', content: text.slice(offset, end), bytes: text.length, offset, length: end - offset, truncated: end < text.length, mime: 'text/plain', hash: null, utf8: null });
    });
    refuse = true;
    render(<FileViewer tab={fileTab('/r/half.txt')} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Refused: path outside the session's directories");
    expect(useViewer.getState().entries.get(FILE('/r/half.txt'))?.text).toBe('');
    expect(document.querySelector('.cm-content')).toBeNull();
  });

  it('renders markdown and toggles Source to the code view and back', async () => {
    serve({ '/r/README.md': '# Title\n\n- one\n- two\n' });
    render(<FileViewer tab={fileTab('/r/README.md')} />);
    expect((await screen.findByRole('heading', { name: 'Title' })).tagName).toBe('H1');
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    await waitFor(() => expect(codeText()).toContain('# Title'));
    expect(screen.queryByRole('heading', { name: 'Title' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Rendered' }));
    expect((await screen.findByRole('heading', { name: 'Title' })).tagName).toBe('H1');
  });

  // UX wave U6b-1: the file's own session's, beside its chat (B's chat shown), and in the main area on ⌘-click
  it('opens links and path chips from standalone file Markdown', async () => {
    const off = registerPanelTool(filesTool);
    try {
      const main = serve({ '/r/README.md': '[Website](https://example.com)\n\n[Source](/r/app.ts#L7)' });
      useLayout.getState().openTab({ kind: 'file', path: '/r/README.md', line: null, appSessionId: A, machine: TEST_MACHINE });
      useLayout.getState().openTab({ kind: 'session', appSessionId: B });
      render(<FileViewer tab={fileTab('/r/README.md')} />);
      fireEvent.click(await screen.findByRole('link', { name: 'Website' }));
      expect(main.callsOf('layout.openExternal')).toEqual([{ url: 'https://example.com/' }]);
      const mainFiles = () => currentSet(useLayout.getState().main).panes.flatMap((pane) => pane.tabs).filter((tab) => tab.kind === 'file' && tab.path === '/r/app.ts');
      act(() => void fireEvent.click(screen.getByTitle('/r/app.ts')));
      const beside = (useLayout.getState().panelBySession.get(A)?.tabs ?? []).filter((tab) => tab.toolId === 'files');
      expect(beside.map((tab) => useLayout.getState().panelParams[tab.id])).toEqual([{ file: '/r/app.ts', line: 7, preview: true }]);
      expect(mainFiles()).toEqual([]);
      act(() => void fireEvent.click(screen.getByTitle('/r/app.ts'), { metaKey: true }));
      expect(mainFiles()).toEqual([expect.objectContaining({ line: 7, appSessionId: A })]);
      expect(useLayout.getState().panelBySession.get(A)?.tabs.filter((tab) => tab.toolId === 'files')).toEqual([]);
    } finally {
      off();
    }
  });

  it('does not retain the editor document after its parent releases a closed tab', async () => {
    serve({ '/r/closed.ts': 'const closedDocument = 1;' });
    const tab = fileTab('/r/closed.ts');
    const view = render(<FileViewer tab={tab} />);
    await waitFor(() => expect(codeText()).toContain('closedDocument'));
    view.unmount();
    expect(useViewer.getState().entries.has(tab.id)).toBe(false);
    expect(existingViewState(tab.id)).toBeUndefined();
  });

  it('opens a markdown file sent to a line as its Source, where the line exists', async () => {
    serve({ '/r/README.md': '# Title\n\n- one\n- two\n' });
    render(<FileViewer tab={fileTab('/r/README.md', 3)} />);
    await waitFor(() => expect(flashed()).toBe('- one'));
    expect(screen.getByRole('button', { name: 'Rendered' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows an image inline from a data URL, and an svg by its UTF-8 bytes with a Source', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><text>Ünïcødé — 日本語</text></svg>';
    serve({ '/r/dot.png': { base64: 'iVBORw0KGgo=', bytes: 8 }, '/r/label.svg': { text: svg } });
    const { unmount } = render(<FileViewer tab={fileTab('/r/dot.png')} />);
    expect((await screen.findByRole('img')).getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
    unmount();
    render(<FileViewer tab={fileTab('/r/label.svg')} />);
    const src = (await screen.findByRole('img')).getAttribute('src')!;
    expect(src).toBe(dataUrl('image/svg+xml', 'utf8', svg));
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    await waitFor(() => expect(codeText()).toContain('Ünïcødé — 日本語'));
  });

  // P2-F W-V (L95, §2 item 6): fit to the pane is the default; the zoom steps, actual size and fit are the bar's controls
  it('fits an image to the pane with its aspect, small grown and the fit following the pane, and zooms in, out, to actual size and back', async () => {
    const { resize } = installResizeObserver();
    serve({ '/r/dot.png': { base64: 'iVBORw0KGgo=', bytes: 8 } });
    render(<FileViewer tab={fileTab('/r/dot.png')} />);
    const img = (await screen.findByRole('img')) as HTMLImageElement;
    Object.defineProperties(img, { naturalWidth: { value: 64 }, naturalHeight: { value: 48 } });
    fireEvent.load(img);
    const stage = document.querySelector('[data-zoom-stage]')!;
    resize(stage, { width: 600, height: 400 });
    const drawn = () => [img.style.width, img.style.height];
    const percent = () => document.querySelector('[data-zoom-percent]')?.textContent;
    const button = (name: string) => screen.getByRole('button', { name });
    const pressed = (name: string) => button(name).getAttribute('aria-pressed');
    expect(drawn()).toEqual(['533px', '400px']); // 400 / 48 of 64 × 48: grown by the tighter side
    expect(percent()).toBe('833%');
    expect([pressed('Fit'), pressed('Actual size')]).toEqual(['true', 'false']);
    resize(stage, { width: 300, height: 400 }); // the pane narrows: the fit follows it
    expect(drawn()).toEqual(['300px', '225px']);
    fireEvent.click(button('Zoom in'));
    expect(drawn()).toEqual(['384px', '288px']); // 4.6875 → the next rung, 6
    expect(stage.getAttribute('data-zoom')).toBe('6');
    expect(pressed('Fit')).toBe('false');
    fireEvent.click(button('Zoom out'));
    fireEvent.click(button('Zoom out'));
    expect(drawn()).toEqual(['192px', '144px']);
    expect(percent()).toBe('300%');
    fireEvent.click(button('Actual size'));
    expect(drawn()).toEqual(['64px', '48px']);
    expect([pressed('Fit'), pressed('Actual size')]).toEqual(['false', 'true']);
    fireEvent.click(button('Fit'));
    expect(drawn()).toEqual(['300px', '225px']);
    fireEvent.click(img); // a click on the image toggles actual size and fit
    expect(drawn()).toEqual(['64px', '48px']);
    fireEvent.click(img);
    expect(drawn()).toEqual(['300px', '225px']);
    for (let k = 0; k < 4; k++) fireEvent.click(button('Zoom in'));
    expect(drawn()).toEqual(['1024px', '768px']); // the ladder's top, 16
    expect(button('Zoom in')).toHaveProperty('disabled', true);
  });

  it('offers no zoom on an svg shown as its source', async () => {
    installResizeObserver();
    serve({ '/r/label.svg': { text: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>' } });
    render(<FileViewer tab={fileTab('/r/label.svg')} />);
    await screen.findByRole('img');
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull());
  });

  // UX wave U6b-2: a PDF is drawn in its frame, with Open externally in the bar; a binary keeps its row
  it('draws a PDF with Open externally in its bar, and only the size for a binary MAWS will not hand out', async () => {
    const main = serve({ '/r/doc.pdf': { base64: 'JVBERi0xLjQ=', bytes: 30 }, '/r/data.bin': { base64: 'AAEC', bytes: 12, mime: 'application/octet-stream' } });
    const { unmount } = render(<FileViewer tab={fileTab('/r/doc.pdf')} />);
    await waitFor(() => expect(document.querySelector('[data-artifact-frame="pdf"]')).not.toBeNull());
    expect(screen.queryByText('PDF files open outside MAWS')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open externally' }));
    await waitFor(() => expect(main.callsOf('files.openExternal')).toEqual([{ appSessionId: MAIN_A, path: '/r/doc.pdf', named: true }]));
    unmount();
    render(<FileViewer tab={fileTab('/r/data.bin')} />);
    expect(await screen.findByText('Binary file · 12 B')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open externally' })).toBeNull();
  });

  it('opens a 20 MB text as a bounded head that grows by Load more', async () => {
    const main = serve({ '/r/big.log': { generated: 20 * MiB, line: 'log line\n' } });
    render(<FileViewer tab={fileTab('/r/big.log')} />);
    await waitFor(() => expect(notice()).toBe('Showing the first 1.0 MB of 20.0 MB'));
    expect(screen.getByRole('button', { name: 'Open externally' })).toBeTruthy();
    const loadMore = screen.getByRole<HTMLButtonElement>('button', { name: 'Load more' });
    fireEvent.click(loadMore);
    expect(loadMore.disabled).toBe(true); // `loadMore` sets `loadingMore` inside the click's act, before its read answers
    await waitFor(() => expect(notice()).toBe('Showing the first 2.0 MB of 20.0 MB'));
    expect(loadMore.disabled).toBe(false); // the read that grew the head cleared `loadingMore` in the same patch
    expect(main.callsOf('files.read').map((input) => [input.offset, input.length])).toEqual([
      [0, MiB],
      [MiB, MiB],
    ]);
  });

  it('follows an edit to its file, and keeps the last content under File removed', async () => {
    const files: Record<string, Served> = { '/r/app.ts': 'const a = 1;\n' };
    const main = serve(files);
    connect();
    render(<FileViewer tab={fileTab('/r/app.ts')} />);
    await waitFor(() => expect(codeText()).toBe('const a = 1;'));
    files['/r/app.ts'] = 'const a = 2;\n';
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: '/private/r/app.ts', kind: 'changed' })); // realpath spelling
    await waitFor(() => expect(codeText()).toBe('const a = 2;'));
    expect(document.querySelector('[data-updated]')?.textContent).toBe('Updated');
    expect(flashed()).toBeNull();
    delete files['/r/app.ts'];
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: '/r/app.ts', kind: 'removed' }));
    await waitFor(() => expect(notice()).toBe('File removed'));
    expect(codeText()).toBe('const a = 2;');
  });

  it('does not take an event for a file that merely ends like its own', async () => {
    const main = serve({ '/r/app.ts': 'x\n' });
    connect();
    render(<FileViewer tab={fileTab('/r/app.ts')} />);
    await waitFor(() => expect(codeText()).toBe('x'));
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: '/x/r/app.ts', kind: 'removed' }));
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: '/x/r', kind: 'changed' }));
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: '/x/r', kind: 'invalidated' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(main.callsOf('files.read')).toHaveLength(1);
    expect(notice()).toBeNull();
  });

  it('a follow-the-file re-read of a head keeps what Load more had reached', async () => {
    // Long lines: happy-dom has no layout, and CodeMirror replacing a whole document of 200,000 short lines there lays
    // them all out.
    const main = serve({ '/r/big.log': { generated: 20 * MiB, line: `${'log line '.repeat(28)}\n` } });
    connect();
    render(<FileViewer tab={fileTab('/r/big.log')} />);
    await waitFor(() => expect(notice()).toBe('Showing the first 1.0 MB of 20.0 MB'));
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(notice()).toBe('Showing the first 2.0 MB of 20.0 MB'));
    main.calls.splice(0);
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: '/r/big.log', kind: 'changed' }));
    await waitFor(() => expect(main.callsOf('files.read').map((input) => input.offset)).toEqual([0, MiB]));
    await waitFor(() => expect(document.querySelector('[data-updated]')).not.toBeNull());
    expect(notice()).toBe('Showing the first 2.0 MB of 20.0 MB');
  });

  // Gates the reads of a head at an offset, one call at a time, in the order they are asked for.
  function gatedHead() {
    const gates = new Map<number, ReturnType<typeof deferred<void>>[]>();
    const gated = (offset: number) => {
      const gate = deferred<void>();
      gates.set(offset, [...(gates.get(offset) ?? []), gate]);
      return gate;
    };
    const main = serve({ '/r/big.log': { generated: 20 * MiB, line: `${'log line '.repeat(28)}\n` } }, async (offset) => {
      const gate = gates.get(offset)?.shift();
      if (gate) await gate.promise;
    });
    return { main, gated };
  }
  const BIG_LOG = FILE('/r/big.log');
  const bigLog = () => useViewer.getState().entries.get(BIG_LOG)!;
  // E11 W-E: the two supersede cases drive the store the viewer mounts, not the rendered tab: CodeMirror laying out
  // megabytes of text under happy-dom took most of their time and all of their sensitivity to load (the button is
  // `disabled={entry.loadingMore}`, which the 20 MB Load more case asserts through the tab). Each wait is on the
  // store's own change, and `drained` lets an answer released by hand run its course before the case checks it landed
  // nowhere.
  const mountBigLog = () => offs.push(useViewer.getState().mount(BIG_LOG, { appSessionId: A, path: '/r/big.log', line: null }));
  const until = (holds: (entry: ReturnType<typeof bigLog>) => boolean) =>
    new Promise<void>((resolve) => {
      const check = () => {
        const entry = useViewer.getState().entries.get(BIG_LOG);
        if (entry && holds(entry)) {
          off();
          resolve();
        }
      };
      const off = useViewer.subscribe(check);
      check();
    });
  const drained = () => new Promise<void>((resolve) => setImmediate(resolve));

  it('enables Load more again when a follow-the-file re-read supersedes its read, and the next Load more lands once', async () => {
    const { main, gated } = gatedHead();
    connect();
    mountBigLog();
    await until((entry) => entry.status === 'ready' && entry.loaded === MiB);
    const superseded = gated(MiB);
    useViewer.getState().loadMore(BIG_LOG);
    expect(bigLog().loadingMore).toBe(true);
    main.emit('files.changed', { appSessionId: MAIN_A, path: '/r/big.log', kind: 'changed' });
    await until((entry) => entry.updated === 1);
    expect(bigLog().loadingMore).toBe(false);
    useViewer.getState().loadMore(BIG_LOG);
    await until((entry) => entry.loaded === 2 * MiB);
    superseded.resolve(); // its answer lands nowhere
    await drained();
    expect(bigLog()).toMatchObject({ loaded: 2 * MiB, loadingMore: false });
    expect(bigLog().text).toHaveLength(2 * MiB);
  });

  it('drops a Load more answer whose text a re-read replaced while it was in flight', async () => {
    const { main, gated } = gatedHead();
    connect();
    mountBigLog();
    await until((entry) => entry.status === 'ready' && entry.loaded === MiB);
    const reread = gated(0);
    main.emit('files.changed', { appSessionId: MAIN_A, path: '/r/big.log', kind: 'changed' });
    await drained();
    expect(main.callsOf('files.read')).toHaveLength(2);
    const outrun = gated(MiB);
    useViewer.getState().loadMore(BIG_LOG); // asked while the re-read is in flight: the same load, the old text
    expect(bigLog().loadingMore).toBe(true);
    reread.resolve();
    await until((entry) => entry.updated === 1);
    expect(bigLog().loadingMore).toBe(false);
    useViewer.getState().loadMore(BIG_LOG);
    await until((entry) => entry.loaded === 2 * MiB);
    outrun.resolve();
    await drained();
    expect(bigLog().text).toHaveLength(2 * MiB); // appended once, not twice
  });

  it('shows File removed with the last content when the file goes during a re-read continuation', async () => {
    const text = 'b'.repeat(MiB + 10);
    let gone = false;
    const main = installFakeMain(async (name, input) => {
      if (name !== 'files.read') return ok();
      const offset = (input.offset as number | undefined) ?? 0;
      if (gone && offset > 0) return fail(`not found: /r/log.txt`);
      const end = Math.min(text.length, offset + MiB);
      return ok({ encoding: 'utf8', content: text.slice(offset, end), bytes: text.length, offset, length: end - offset, truncated: end < text.length, mime: 'text/plain', hash: null, utf8: null });
    });
    connect();
    render(<FileViewer tab={fileTab('/r/log.txt')} />);
    await waitFor(() => expect(useViewer.getState().entries.get(FILE('/r/log.txt'))?.complete).toBe(true));
    gone = true;
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: '/r/log.txt', kind: 'changed' }));
    await waitFor(() => expect(notice()).toBe('File removed'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(useViewer.getState().entries.get(FILE('/r/log.txt'))?.text).toBe(text);
  });

  it('lets no load of a pruned tab land in the entry that replaced it', async () => {
    const gates = [deferred<void>(), deferred<void>()];
    let reads = 0;
    const answers = ['old\n', 'new\n'];
    installFakeMain(async (name) => {
      if (name !== 'files.read') return ok();
      const n = reads;
      reads++;
      await gates[n].promise;
      return ok({ encoding: 'utf8', content: answers[n], bytes: 4, offset: 0, length: 4, truncated: false, mime: 'text/plain', hash: null, utf8: null });
    });
    openFile(A, '/r/a.txt', null, { main: true });
    const first = render(<FileViewer tab={fileTab('/r/a.txt')} />);
    await waitFor(() => expect(reads).toBe(1));
    first.unmount();
    act(() => useLayout.getState().closeTab(FILE('/r/a.txt'))); // pruned while its read is in flight
    expect(useViewer.getState().entries.has(FILE('/r/a.txt'))).toBe(false);
    openFile(A, '/r/a.txt', null, { main: true });
    render(<FileViewer tab={fileTab('/r/a.txt')} />);
    await waitFor(() => expect(reads).toBe(2));
    await act(async () => gates[1].resolve());
    await waitFor(() => expect(codeText()).toBe('new'));
    await act(async () => gates[0].resolve());
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(useViewer.getState().entries.get(FILE('/r/a.txt'))?.text).toBe('new\n');
  });

  it("takes CodeMirror's dark theme with the page's, so none of its light base colours apply in dark", async () => {
    serve({ '/r/app.ts': 'x\n' });
    document.documentElement.dataset.theme = 'dark';
    try {
      render(<FileViewer tab={fileTab('/r/app.ts')} />);
      await waitFor(() => expect(codeText()).toBe('x'));
      const view = () => EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;
      expect(view().state.facet(EditorView.darkTheme)).toBe(true);
      act(() => void (document.documentElement.dataset.theme = 'light'));
      await waitFor(() => expect(view().state.facet(EditorView.darkTheme)).toBe(false));
    } finally {
      delete document.documentElement.dataset.theme;
    }
  });

  it('re-reads and re-watches after its directory watch is invalidated', async () => {
    const main = serve({ '/r/app.ts': 'x\n' });
    connect();
    render(<FileViewer tab={fileTab('/r/app.ts')} />);
    await waitFor(() => expect(codeText()).toBe('x'));
    main.calls.splice(0);
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: '/r', kind: 'invalidated' }));
    await waitFor(() => expect(main.calls.map((c) => c.name)).toEqual(['files.watch', 'files.read']));
  });

  it('a tab with no session, or one main does not know, says so and reads nothing', async () => {
    const main = serve({ '/r/a.ts': { refusal: 'unknown app session: app-z' } });
    openFile(null, '/r/../r/./a.ts', 3, { main: true });
    const tab = currentSet(useLayout.getState().main).panes[0].tabs.find((t) => t.kind === 'file') as Extract<TabRef, { kind: 'file' }>;
    expect(tab).toMatchObject({ path: '/r/a.ts', line: 3, appSessionId: null });
    const { unmount } = render(<FileViewer tab={tab} />);
    expect(screen.getByText('No session grants access to this file')).toBeTruthy();
    expect(main.callsOf('files.read')).toHaveLength(0);
    unmount();
    render(<FileViewer tab={fileTab('/r/a.ts', null, at('app-z' as AppSessionId))} />);
    expect(await screen.findByText('No session grants access to this file')).toBeTruthy();
  });

  it('prunes the state of a tab the layout dropped and keeps at most twenty', async () => {
    serve(Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`/r/f${i}.ts`, `${i}\n`])));
    for (let i = 0; i < 25; i++) openFile(A, `/r/f${i}.ts`, null, { main: true });
    for (let i = 0; i < 25; i++) {
      const { unmount } = render(<FileViewer tab={fileTab(`/r/f${i}.ts`)} />);
      unmount();
    }
    expect(useViewer.getState().entries.size).toBe(VIEWER_ENTRIES_MAX);
    expect(useViewer.getState().entries.has(FILE('/r/f0.ts'))).toBe(false); // the least recently used went first
    act(() => useLayout.getState().closeTab(FILE('/r/f24.ts')));
    expect(useViewer.getState().entries.has(FILE('/r/f24.ts'))).toBe(false);
  });
});

// E2 (M4): the deliverables viewer draws markdown and code through the same body, read-only (Decision Log 7): the entry
// is never editable whatever the file is, the bar holds no editor controls, and the file tab of the same file still edits.
describe('a read-only mount (E2)', () => {
  beforeAll(() => import('./CodeView'));
  beforeEach(() => {
    useViewer.getState().reset();
    useFiles.getState().reset();
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, hydrated: true });
  });
  afterEach(() => cleanup());

  it('reports editable: false for a file a file tab would edit, and the code view takes no typing', async () => {
    installDisk({ '/r/app.ts': 'const a = 1;\n' });
    render(<FileBody tabId="deliverable:d1:v1" appSessionId={A} path="/r/app.ts" readOnly />);
    await waitFor(() => expect(useViewer.getState().entries.get('deliverable:d1:v1')).toMatchObject({ status: 'ready', kind: 'code', complete: true, editable: false, readOnly: true }));
    expect(useViewer.getState().entries.get('deliverable:d1:v1')!.hash).not.toBeNull(); // everything isEditable asks for is there
    await waitFor(() => expect(document.querySelector('.cm-editor')).not.toBeNull());
    expect(EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!.state.facet(EditorView.editable)).toBe(false);
    expect(document.querySelector('[data-file-viewer]')!.getAttribute('data-editable')).toBe('false');
    cleanup();

    openFile(A, '/r/app.ts', null, { main: true });
    render(<FileViewer tab={fileTab('/r/app.ts')} />);
    await waitFor(() => expect(useViewer.getState().entries.get(FILE('/r/app.ts'))).toMatchObject({ editable: true, readOnly: false }));
  });
});

// UX wave U6c (M3; docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md, Interfaces §E and sequences W1 to W6):
// a file outside the session's folders that its transcript names is read with `named`, held read-only with the reason
// as the editor's title, and read again when it is asked for again, since no watch keeps it current; a session on
// another machine is asked as today. UX wave U6e (W6): these are now a daemon of the parent pin's answers (`older`), which
// say `named` with no `outside`, so the page holds the file read-only as U6c built it; this build's daemon is the suite
// below.
describe('a file the transcript names (U6c), from a daemon of the parent pin', () => {
  const OUT = '/elsewhere/notes.txt';
  const PDF = '/elsewhere/report.pdf';
  const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
  const OUTSIDE_TITLE = 'Read-only: the file is outside the folders this session works in';
  beforeAll(() => import('./CodeView'));
  beforeEach(() => {
    useViewer.getState().reset();
    useFiles.getState().reset();
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, hydrated: true });
  });
  afterEach(() => cleanup());

  const shown = (path = OUT) => useViewer.getState().entries.get(FILE(path));
  const title = () => document.querySelector('.cm-content')?.getAttribute('title') ?? null;
  const editorEditable = () => EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!.state.facet(EditorView.editable);
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  // The disk as the service answers it: `/elsewhere` outside the session's folders, and `named` the paths session A's
  // transcript names there (no other session's names any).
  function disk(files: Record<string, string>, named: string[] = []) {
    const names = new Set(named);
    const served = installDisk(files, { outside: ['/elsewhere'], names: (appSessionId, path) => appSessionId === MAIN_A && names.has(path), older: true });
    return { ...served, names };
  }
  // A file tab the layout holds (so a remount finds its entry), shown.
  const show = (path = OUT, appSessionId: AppSessionId = A) => {
    act(() => void openFile(appSessionId, path, null, { main: true }));
    return render(<FileViewer tab={fileTab(path, null, appSessionId)} />);
  };

  it('asks with named for a session on this Mac, and never for a session on another machine', async () => {
    const main = disk({ '/r/a.ts': 'a\n' });
    render(<FileViewer tab={fileTab('/r/a.ts')} />);
    await waitFor(() => expect(shown('/r/a.ts')?.status).toBe('ready'));
    expect(main.callsOf('files.read')).toEqual([{ appSessionId: MAIN_A, path: '/r/a.ts', offset: 0, length: FILES_READ_DEFAULT_LENGTH, hash: true, named: true }]);
    expect(shown('/r/a.ts')).toMatchObject({ named: false, editable: true }); // inside the folders the answer carries no named
    cleanup();
    main.calls.splice(0);
    const remote: Extract<TabRef, { kind: 'file' }> = { ...fileTab('/r/a.ts', null, REMOTE), id: `file:${OTHER_MACHINE}:/r/a.ts`, machine: OTHER_MACHINE };
    render(<FileViewer tab={remote} />);
    await waitFor(() => expect(useViewer.getState().entries.get(remote.id)?.status).toBe('ready'));
    expect(main.callsOf('files.read')).toEqual([{ appSessionId: 'app-r', path: '/r/a.ts', offset: 0, length: FILES_READ_DEFAULT_LENGTH, hash: true }]);
  });

  it('opens a file the transcript names read-only, the editor’s title saying why, and writes nothing', async () => {
    const main = disk({ [OUT]: 'outside text\n' }, [OUT]);
    show();
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', kind: 'code', complete: true, named: true, editable: false }));
    expect(shown()!.hash).not.toBeNull(); // everything else the editor asks for is there: the name alone withholds it
    expect(readOnlyReason(shown()!)).toBe('outside');
    await waitFor(() => expect(title()).toBe(OUTSIDE_TITLE));
    expect(codeText()).toBe('outside text');
    expect(editorEditable()).toBe(false);
    expect(document.querySelector('[data-file-viewer]')!.getAttribute('data-editable')).toBe('false');
    expect(document.querySelector('[data-editor-controls]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(await useViewer.getState().save(FILE(OUT))).toBe('noop');
    expect(main.callsOf('files.write')).toEqual([]);
    expect(main.files[OUT]).toBe('outside text\n');
  });

  it('draws a named PDF, its bar’s Open externally asking with named', async () => {
    const main = disk({ [PDF]: '%PDF-1.4 invented\n' }, [PDF]);
    show(PDF);
    await waitFor(() => expect(document.querySelector('[data-artifact-frame="pdf"]')).not.toBeNull());
    expect(shown(PDF)).toMatchObject({ named: true, kind: 'frame' });
    fireEvent.click(screen.getByRole('button', { name: 'Open externally' }));
    await waitFor(() => expect(main.callsOf('files.openExternal')).toEqual([{ appSessionId: MAIN_A, path: PDF, named: true }]));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('W3: reads a refused file again when its link is clicked again, and when its tab is shown again', async () => {
    const main = disk({ [OUT]: 'written later\n', '/elsewhere/other.txt': 'other\n' });
    show();
    expect((await screen.findByRole('alert')).textContent).toContain(`Refused: ${OUTSIDE_REFUSAL}`);
    await settle();
    expect(main.callsOf('files.read')).toHaveLength(1);
    main.names.add(OUT); // the row that links it is written
    act(() => void openFile(A, OUT)); // the link clicked again, its tab already shown
    await waitFor(() => expect(codeText()).toBe('written later'));
    expect(shown()).toMatchObject({ status: 'ready', named: true, editable: false });
    expect(main.callsOf('files.read')).toHaveLength(2);

    const OTHER = '/elsewhere/other.txt';
    const first = show(OTHER);
    expect((await screen.findByRole('alert')).textContent).toContain(OUTSIDE_REFUSAL);
    first.unmount();
    main.names.add(OTHER);
    render(<FileViewer tab={fileTab(OTHER)} />); // shown again
    await waitFor(() => expect(shown(OTHER)).toMatchObject({ status: 'ready', named: true, text: 'other\n' }));
  });

  // The branch review's finding 4, with the two real stores: a file opened before its folder exists fails its watch
  // and its read; read again once it exists, it takes its watch again too (the Files store installs a refused watch
  // again only for a new holder), so a later change shows Updated. Main's events follow only an installed watch.
  it.each(['its link is clicked again', 'its tab is shown again'])('a failed tab read again when %s is watched again, and shows a later change', async (how) => {
    const PATH = '/r/gen/file.ts';
    const files: Record<string, string> = {};
    const installed = new Set<string>();
    const main = installFakeMain(async (name, input) => {
      const path = input.path as string;
      if (name === 'files.watch') {
        if (!Object.keys(files).some((file) => file.startsWith(`${path}/`))) return fail(`not found: ${path}`);
        installed.add(path);
        return ok();
      }
      if (name === 'files.unwatch') {
        installed.delete(path);
        return ok();
      }
      if (name !== 'files.read') return fail(`unexpected ${name}`);
      const content = files[path];
      if (content === undefined) return fail(`not found: ${path}`);
      const hashed = input.hash === true;
      return ok({ encoding: 'utf8', content, bytes: content.length, offset: 0, length: content.length, truncated: false, mime: 'text/plain', hash: hashed ? fakeHash(content) : null, utf8: hashed ? true : null });
    });
    const offs = [connectCodeEvents()];
    const first = show(PATH);
    expect((await screen.findByRole('alert')).textContent).toContain(`not found: ${PATH}`);
    files[PATH] = 'one\n'; // the folder and the file are made
    if (how === 'its link is clicked again') act(() => void openFile(A, PATH));
    else {
      first.unmount();
      render(<FileViewer tab={fileTab(PATH)} />);
    }
    await waitFor(() => expect(codeText()).toBe('one'));
    files[PATH] = 'two\n';
    act(() => {
      if (installed.has('/r/gen')) main.emit('files.changed', { appSessionId: MAIN_A, path: PATH, kind: 'changed' });
    });
    await waitFor(() => expect(codeText()).toBe('two'));
    expect(document.querySelector('[data-updated]')?.textContent).toBe('Updated');
    offs.forEach((off) => off());
  });

  it('W4: reads a named file again each time its tab is shown, Updated only when its bytes changed', async () => {
    const main = disk({ [OUT]: 'one\n' }, [OUT]);
    const first = show();
    await waitFor(() => expect(codeText()).toBe('one'));
    first.unmount();
    const again = render(<FileViewer tab={fileTab(OUT)} />);
    await waitFor(() => expect(main.callsOf('files.read')).toHaveLength(2));
    await waitFor(() => expect(shown()!.pending).toBe(0));
    expect(document.querySelector('[data-updated]')).toBeNull(); // the same bytes land nothing
    again.unmount();
    main.files[OUT] = 'two\n';
    render(<FileViewer tab={fileTab(OUT)} />);
    await waitFor(() => expect(codeText()).toBe('two'));
    expect(document.querySelector('[data-updated]')?.textContent).toBe('Updated');
    expect(shown()).toMatchObject({ named: true, editable: false });
  });

  it('W4: a named PDF shown again with the same bytes lands nothing but named', async () => {
    const main = disk({ [PDF]: '%PDF-1.4 invented\n' }, [PDF]);
    const first = show(PDF);
    await waitFor(() => expect(shown(PDF)?.frame?.status).toBe('ready'));
    const { epoch } = shown(PDF)!;
    first.unmount();
    render(<FileViewer tab={fileTab(PDF)} />);
    await waitFor(() => expect(main.callsOf('files.read')).toHaveLength(2));
    await waitFor(() => expect(shown(PDF)!.pending).toBe(0));
    expect(shown(PDF)).toMatchObject({ named: true, updated: 0, epoch });
    expect(document.querySelector('[data-updated]')).toBeNull();
  });

  it('W4: a PDF changed in place to the same size and type lands, with Updated, when an event says so', async () => {
    const main = disk({ '/r/doc.pdf': '%PDF-1.4 one\n' });
    const offs = [connectCodeEvents()];
    show('/r/doc.pdf');
    await waitFor(() => expect(shown('/r/doc.pdf')?.frame?.status).toBe('ready'));
    const { epoch } = shown('/r/doc.pdf')!;
    main.files['/r/doc.pdf'] = '%PDF-1.4 two\n'; // other bytes, the same length: the external read sees size and type alone
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: '/r/doc.pdf', kind: 'changed' }));
    await waitFor(() => expect(shown('/r/doc.pdf')).toMatchObject({ updated: 1, epoch: epoch + 1 }));
    expect(document.querySelector('[data-updated]')?.textContent).toBe('Updated');
    offs.forEach((off) => off());
  });

  it('W5: a named file whose later read is refused shows the refusal and none of its content', async () => {
    const main = disk({ [OUT]: 'was named\n' }, [OUT]);
    show();
    await waitFor(() => expect(codeText()).toBe('was named'));
    main.names.delete(OUT); // the transcript no longer names it
    act(() => void openFile(A, OUT));
    expect((await screen.findByRole('alert')).textContent).toContain(OUTSIDE_REFUSAL);
    expect(shown()).toMatchObject({ status: 'error', named: false, text: '', kind: null, hash: null, editable: false });
    expect(codeText()).toBeNull();
  });

  it('W6: a read of the same bytes sets named, and with it whether the file may be edited', async () => {
    const main = disk({ '/r/app.ts': 'const a = 1;\n' });
    const offs = [connectCodeEvents()];
    show('/r/app.ts');
    await waitFor(() => expect(shown('/r/app.ts')).toMatchObject({ named: false, editable: true }));
    main.outside.add('/r'); // the folder is no longer the session's, and the transcript names the file
    main.names.add('/r/app.ts');
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: '/r/app.ts', kind: 'changed' }));
    await waitFor(() => expect(shown('/r/app.ts')).toMatchObject({ named: true, editable: false, text: 'const a = 1;\n' }));
    await waitFor(() => expect(title()).toBe(OUTSIDE_TITLE));
    main.outside.delete('/r'); // the session's again
    act(() => void openFile(A, '/r/app.ts'));
    await waitFor(() => expect(shown('/r/app.ts')).toMatchObject({ named: false, editable: true }));
    expect(shown('/r/app.ts')!.updated).toBe(0); // neither read changed the bytes
    offs.forEach((off) => off());
  });

  // The branch review's finding 3: admission is any chunk's answer, not the first one's alone. A text past its first
  // chunk read first inside the folders and then, the same file by its hash, admitted by the transcript is named.
  it('a continuation read that answers named makes the entry named and read-only', async () => {
    const big = 'a'.repeat(MiB + 1);
    installFakeMain(async (name, input) => {
      if (name === 'files.watch' || name === 'files.unwatch') return ok();
      if (name !== 'files.read') return fail(`unexpected ${name}`);
      const offset = (input.offset as number | undefined) ?? 0;
      const end = Math.min(big.length, offset + ((input.length as number | undefined) ?? FILES_READ_DEFAULT_LENGTH));
      const hashed = input.hash === true;
      return ok({
        encoding: 'utf8', content: big.slice(offset, end), bytes: big.length, offset, length: end - offset, truncated: end < big.length, mime: 'text/plain',
        hash: hashed ? fakeHash(big) : null, utf8: hashed ? true : null, ...(offset > 0 ? { named: true } : {}),
      });
    });
    show('/r/big.txt');
    await waitFor(() => expect(shown('/r/big.txt')?.loads).toBe(1));
    expect(shown('/r/big.txt')).toMatchObject({ status: 'ready', complete: true, named: true, editable: false });
    expect(readOnlyReason(shown('/r/big.txt')!)).toBe('outside');
  });

  it('W1: a read in flight when its tab closes lands nowhere', async () => {
    const main = disk({ [OUT]: 'late\n' }, [OUT]);
    const gate = main.hold('files.read');
    const { unmount } = show();
    await waitFor(() => expect(main.callsOf('files.read')).toHaveLength(1));
    act(() => useLayout.getState().closeTab(FILE(OUT)));
    unmount();
    expect(useViewer.getState().entries.has(FILE(OUT))).toBe(false);
    gate.release();
    await settle();
    expect(useViewer.getState().entries.has(FILE(OUT))).toBe(false);
  });

  it('W2: a read in flight when another session opens the same path lands nowhere, and the refusal under it shows none of the file', async () => {
    const main = disk({ [OUT]: 'session a’s\n' }, [OUT]);
    const gate = main.hold('files.read');
    const { rerender } = show();
    await waitFor(() => expect(main.callsOf('files.read')).toHaveLength(1));
    act(() => void openFile(B, OUT)); // the tab is one per machine and path: it takes session B
    rerender(<FileViewer tab={fileTab(OUT, null, B)} />);
    expect((await screen.findByRole('alert')).textContent).toContain(OUTSIDE_REFUSAL);
    gate.release(); // session A's answer, the file's text
    await settle();
    expect(shown()).toMatchObject({ appSessionId: B, status: 'error', named: false, text: '' });
    expect(codeText()).toBeNull();
    expect(main.callsOf('files.read').map((input) => input.appSessionId)).toEqual([MAIN_A, 'app-b']);
  });
});

// UX wave U6e (M3; docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, §D and sequences W2 to W8, W10):
// a file from outside the session's folders that this build's daemon admits for a save (a counted name, a grant or the
// agent's delivery) is editable, its path saying where Save writes, and is saved by `files.writeOutside` with the real
// path the page pinned when it showed the document; a file the daemon admits for a read alone (MAWS's own, only added to
// the Library, named only by a tool's result) reads "Read-only", a button whose panel gives the reason. Invented paths
// under `/elsewhere` and `/r`, invented text.
describe('a file from outside the folders edits and saves (U6e)', () => {
  const OUT = '/elsewhere/notes.txt';
  const REAL = '/elsewhere/real/notes.txt'; // OUT's real path: a link on the way
  const SWAPPED = '/elsewhere/swapped/notes.txt';
  const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
  const SENTENCES = {
    maws: 'Read-only: MAWS does not edit its own files',
    added: 'Read-only: this file is in the Library, not in this session’s folders. Choose it with File ▸ Open File… to edit it',
    result: 'Read-only: only a tool’s output names this file in this conversation. Choose it with File ▸ Open File… to edit it',
    outside: 'Read-only: the file is outside the folders this session works in',
  } as const;
  const MOVED = 'Could not save: the path no longer leads to the file that was opened';
  const REFUSED = 'Could not save: MAWS may no longer write this file for this session. Choose it with File ▸ Open File… to save it';
  const UNAVAILABLE = 'Could not save: MAWS’s service on this Mac is from an earlier version and cannot save a file from outside the session’s folders. Try again in a moment';
  const offs: (() => void)[] = [];
  beforeAll(() => import('./CodeView'));
  beforeEach(() => {
    useViewer.getState().reset();
    useFiles.getState().reset();
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, hydrated: true });
  });
  afterEach(() => {
    cleanup();
    offs.splice(0).forEach((off) => off());
  });

  const shown = (path = OUT) => useViewer.getState().entries.get(FILE(path))!;
  const view = () => EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;
  const typed = (text: string) => act(() => view().dispatch({ changes: { from: 0, insert: text }, userEvent: 'input.type', annotations: isolateHistory.of('full') }));
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  const lead = () => document.querySelector<HTMLElement>('[data-path-lead]')!;
  const label = () => document.querySelector<HTMLElement>('[data-read-only]');
  const saveButton = () => screen.queryByRole('button', { name: 'Save' });
  const title = () => document.querySelector('.cm-content')?.getAttribute('title') ?? null;
  const editorEditable = () => view().state.facet(EditorView.editable);
  // The disk as this build's daemon answers it: `/elsewhere` outside session A's folders; what admits a file there for A
  // (a counted name, a result-only name, an added record, the agent's delivery), and MAWS's own folders.
  function disk(files: Record<string, string>, how: { names?: readonly string[]; results?: readonly string[]; sent?: readonly string[]; added?: readonly string[]; own?: readonly string[]; older?: boolean } = {}) {
    const names = new Set(how.names ?? []);
    const results = new Set(how.results ?? []);
    const sent = new Set(how.sent ?? []);
    const forA = (set: Set<string>) => (appSessionId: string, path: string) => appSessionId === MAIN_A && set.has(path);
    const served = installDisk(files, { outside: ['/elsewhere'], names: forA(names), results: forA(results), sent: forA(sent), added: how.added, own: how.own, older: how.older });
    return { ...served, names, results, sent, saves: () => [...served.callsOf('files.write'), ...served.callsOf('files.writeOutside')] };
  }
  const show = (path = OUT, appSessionId: AppSessionId = A) => {
    act(() => void openFile(appSessionId, path, null, { main: true }));
    return render(<FileViewer tab={fileTab(path, null, appSessionId)} />);
  };
  const editable = async (path = OUT) => {
    await waitFor(() => expect(shown(path)).toMatchObject({ status: 'ready', editable: true }));
    await waitFor(() => expect(editorEditable()).toBe(true));
  };

  it('A1: a linked file opens editable, no label, its path saying where Save writes; typing writes nothing; Save writes it by files.writeOutside with its real path', async () => {
    const main = disk({ [OUT]: 'one\n' }, { names: [OUT] });
    main.reals[OUT] = REAL;
    show();
    await editable();
    expect(shown()).toMatchObject({ named: true, locked: null, pin: REAL });
    expect(readOnlyReason(shown())).toBeNull();
    expect(label()).toBeNull();
    expect(document.querySelector('[data-file-viewer] [data-read-only-chevron]')).toBeNull(); // the chevron is the label's alone
    expect(lead().querySelector('svg')).toBeNull();
    expect(lead().textContent).toBe(OUT); // the bar shows the path as any file's
    expect(lead().getAttribute('data-outside')).toBe('writable');
    expect(lead().getAttribute('title')).toBe(`Save writes to ${REAL}`);
    expect(lead().getAttribute('aria-description')).toBe(`Save writes to ${REAL}`);
    expect(title()).toBeNull(); // the editor's title is gone for a file that can be saved
    expect(document.querySelector('[data-file-viewer]')!.getAttribute('data-editable')).toBe('true');
    typed('two ');
    await waitFor(() => expect(shown().dirty).toBe(true));
    await settle();
    expect(main.saves()).toEqual([]);
    expect(main.files[OUT]).toBe('one\n');
    fireEvent.click(saveButton()!);
    await waitFor(() => expect(main.files[OUT]).toBe('two one\n'));
    expect(main.callsOf('files.writeOutside')).toEqual([{ appSessionId: MAIN_A, path: OUT, content: 'two one\n', expectedHash: fakeHash('one\n'), real: REAL }]);
    expect(main.callsOf('files.write')).toEqual([]);
    expect(shown()).toMatchObject({ dirty: false, saving: false, saveError: null });
  });

  it('a chosen and a sent file save the same way; a file inside the folders keeps its tooltip and today’s files.write', async () => {
    const main = disk({ [OUT]: 'chosen\n', '/elsewhere/sent.txt': 'sent\n', '/r/app.ts': 'inside\n' }, { sent: ['/elsewhere/sent.txt'] });
    main.grant(MAIN_A, OUT);
    for (const path of [OUT, '/elsewhere/sent.txt']) {
      const shownNow = show(path);
      await editable(path);
      expect(lead().getAttribute('title')).toBe(`Save writes to ${path}`);
      typed('+');
      await waitFor(() => expect(shown(path).dirty).toBe(true));
      expect(await act(() => useViewer.getState().save(FILE(path)))).toBe('ok');
      shownNow.unmount();
    }
    expect(main.files).toMatchObject({ [OUT]: '+chosen\n', '/elsewhere/sent.txt': '+sent\n' });
    expect(main.callsOf('files.writeOutside').map((input) => input.real)).toEqual([OUT, '/elsewhere/sent.txt']);
    show('/r/app.ts');
    await editable('/r/app.ts');
    expect(shown('/r/app.ts')).toMatchObject({ named: false, pin: null, locked: null });
    expect(lead().getAttribute('title')).toBe('/r/app.ts');
    expect(lead().hasAttribute('data-outside')).toBe(false);
    expect(lead().hasAttribute('aria-description')).toBe(false);
    typed('+');
    await waitFor(() => expect(shown('/r/app.ts').dirty).toBe(true));
    expect(await act(() => useViewer.getState().save(FILE('/r/app.ts')))).toBe('ok');
    expect(main.callsOf('files.write')).toEqual([{ appSessionId: MAIN_A, path: '/r/app.ts', content: '+inside\n', expectedHash: fakeHash('inside\n') }]);
    expect(main.callsOf('files.writeOutside')).toHaveLength(2);
  });

  it('a session on another machine reads with no named and saves by files.write, as today', async () => {
    const main = disk({ '/r/a.ts': 'remote\n' });
    const remote: Extract<TabRef, { kind: 'file' }> = { ...fileTab('/r/a.ts', null, REMOTE), id: `file:${OTHER_MACHINE}:/r/a.ts`, machine: OTHER_MACHINE };
    render(<FileViewer tab={remote} />);
    await waitFor(() => expect(useViewer.getState().entries.get(remote.id)).toMatchObject({ status: 'ready', editable: true, pin: null }));
    await waitFor(() => expect(editorEditable()).toBe(true));
    typed('+');
    await waitFor(() => expect(useViewer.getState().entries.get(remote.id)!.dirty).toBe(true));
    expect(await act(() => useViewer.getState().save(remote.id))).toBe('ok');
    expect(main.callsOf('files.read').every((input) => !('named' in input) && !('agent' in input))).toBe(true);
    expect(main.callsOf('files.write')).toEqual([{ appSessionId: 'app-r', path: '/r/a.ts', content: '+remote\n', expectedHash: fakeHash('remote\n') }]);
    expect(main.callsOf('files.writeOutside')).toEqual([]);
  });

  // §D's "Read-only": each reason a button before the path and after what the tab puts at the bar's start, in the normal
  // text colour, its sentence its accessible description and the editor's title; a press opens the panel with the
  // sentence, and "Open File…" where choosing the file makes it editable.
  const READ_ONLY = [
    { reason: 'maws', path: '/r/profile/settings.json', how: { own: ['/r/profile'] }, button: false, note: 'MAWS’s own, inside the folders' },
    { reason: 'maws', path: '/elsewhere/profile/key.txt', how: { own: ['/elsewhere/profile'], names: ['/elsewhere/profile/key.txt'] }, button: false, note: 'MAWS’s own, outside' },
    { reason: 'added', path: OUT, how: { added: [OUT] }, button: true, note: 'only added to the Library' },
    { reason: 'result', path: OUT, how: { results: [OUT] }, button: true, note: 'named only by a tool’s result' },
    { reason: 'outside', path: OUT, how: { names: [OUT], older: true }, button: false, note: 'named by a daemon of the parent pin' },
  ] as const;
  it.each(READ_ONLY)('“Read-only” for $reason ($note): before the path, its sentence, a panel on a press', async ({ reason, path, how, button }) => {
    const main = disk({ [path]: 'held\n' }, how);
    act(() => void openFile(A, path, null, { main: true }));
    render(<FileViewer tab={fileTab(path)} start={<button type="button" data-start>start</button>} />);
    await waitFor(() => expect(shown(path)?.status).toBe('ready'));
    expect(readOnlyReason(shown(path))).toBe(reason);
    expect(shown(path).editable).toBe(false);
    const at = label()!;
    expect(at.tagName).toBe('BUTTON');
    expect(at.getAttribute('data-read-only')).toBe(reason);
    expect(at.textContent).toBe('Read-only');
    expect(at.getAttribute('aria-description')).toBe(SENTENCES[reason]);
    expect(at.className.split(/\s+/)).toContain('text-fg');
    // Decision Log 18: a small chevron after the words, inside the same button, muted and hidden from assistive
    // technology, so the button's one accessible name stays "Read-only"
    const chevron = at.querySelector('[data-read-only-chevron]');
    expect(chevron).not.toBeNull();
    expect(chevron!.getAttribute('aria-hidden')).toBe('true');
    expect(chevron!.className.split(/\s+/)).toContain('text-fg-muted');
    expect(at.lastElementChild).toBe(chevron);
    expect(screen.getByRole('button', { name: 'Read-only' })).toBe(at);
    const bar = at.parentElement!;
    expect(bar.querySelectorAll('[data-read-only-chevron]')).toHaveLength(1);
    expect(lead().querySelector('svg')).toBeNull();
    const order = [...bar.children];
    expect(order.indexOf(bar.querySelector('[data-start]')!)).toBe(order.indexOf(at) - 1);
    expect(order.indexOf(lead())).toBe(order.indexOf(at) + 1);
    await waitFor(() => expect(title()).toBe(SENTENCES[reason]));
    expect(document.querySelector('[data-file-viewer]')!.getAttribute('data-editable')).toBe('false');
    expect(saveButton()).toBeNull();
    vi.spyOn(document.querySelector('[data-file-viewer]')!, 'getBoundingClientRect').mockReturnValue({ width: 320, height: 600, top: 0, left: 0, right: 320, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
    await userEvent.setup().click(at);
    const panel = await screen.findByRole('dialog');
    expect(panel.hasAttribute('data-read-only-panel')).toBe(true);
    expect(within(panel).getByText(SENTENCES[reason])).toBeTruthy();
    expect(panel.className.split(/\s+/)).toContain('shadow-float');
    expect(panel.style.getPropertyValue('--read-only-column')).toBe('320px'); // never wider than its column (K13)
    expect(panel.className.split(/\s+/)).toContain('w-[min(24rem,calc(var(--read-only-column,25rem)_-_1rem))]');
    const open = within(panel).queryByRole('button', { name: 'Open File…' });
    expect(open !== null).toBe(button);
    if (open) {
      // Decision Log 18: under the sentence, at the left
      const sentence = within(panel).getByText(SENTENCES[reason]);
      expect(sentence.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(open.className.split(/\s+/)).toContain('self-start');
      expect(open.className.split(/\s+/)).not.toContain('self-end');
      fireEvent.click(open);
      await waitFor(() => expect(main.callsOf('layout.openFile')).toEqual([{ appSessionId: MAIN_A }]));
    }
    expect(main.saves()).toEqual([]);
    expect(await useViewer.getState().save(FILE(path))).toBe('noop');
  });

  it('“Read-only” takes the keyboard: Enter on it opens the panel', async () => {
    disk({ [OUT]: 'held\n' }, { results: [OUT] });
    show();
    await waitFor(() => expect(label()).not.toBeNull());
    act(() => label()!.focus());
    await userEvent.setup().keyboard('{Enter}');
    expect(within(await screen.findByRole('dialog')).getByText(SENTENCES.result)).toBeTruthy();
  });

  // K11: drawn from the first frame the open knows the state; K10: kept across a refused read while the entry holds the
  // file's real path.
  it('“Read-only” is drawn from the first frame the open’s state is known, and kept across a refused read', async () => {
    const main = disk({ [OUT]: 'held\n' }, { added: [OUT] });
    const gate = main.hold('files.read');
    const frames: boolean[] = [];
    const observer = new MutationObserver(() => {
      const viewerEl = document.querySelector('[data-file-viewer]');
      if (viewerEl && viewerEl.getAttribute('data-kind') !== '') frames.push(label() !== null);
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    show();
    await waitFor(() => expect(main.callsOf('files.read')).toHaveLength(1));
    expect(label()).toBeNull(); // the open does not know the state yet
    gate.release();
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', locked: 'added', pin: OUT }));
    observer.disconnect();
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every(Boolean)).toBe(true);
    main.added.delete(OUT); // the Library's record goes: the next read is refused
    act(() => void openFile(A, OUT, null, { main: true }));
    expect((await screen.findByRole('alert')).textContent).toContain('Refused');
    expect(shown()).toMatchObject({ status: 'error', named: false, locked: 'added', pin: OUT });
    expect(label()?.getAttribute('data-read-only')).toBe('added');
  });

  it('W3: a conflict’s read that answers another real path leaves the pin; the next save sends it and is refused; Reload pins the version taken', async () => {
    const main = disk({ [OUT]: 'one\n' }, { names: [OUT] });
    show();
    await editable();
    typed('mine ');
    await waitFor(() => expect(shown().dirty).toBe(true));
    main.files[OUT] = 'theirs\n'; // changed on disk: the save conflicts
    const write = main.hold('files.writeOutside');
    fireEvent.click(saveButton()!);
    await waitFor(() => expect(main.callsOf('files.writeOutside')).toHaveLength(1));
    main.reals[OUT] = SWAPPED; // a folder on the path swapped before the conflict reads the file
    await act(async () => write.release());
    await waitFor(() => expect(shown()).toMatchObject({ saving: false, theirs: { view: 'merge', real: SWAPPED } }));
    expect(shown().pin).toBe(OUT);
    expect(document.querySelector('[data-file-viewer]')!.getAttribute('data-theirs')).toBe('merge');
    fireEvent.click(saveButton()!);
    await waitFor(() => expect(main.callsOf('files.writeOutside')).toHaveLength(2));
    expect(main.callsOf('files.writeOutside')[1]).toMatchObject({ real: OUT, expectedHash: fakeHash('theirs\n') });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(MOVED));
    expect(main.files[OUT]).toBe('theirs\n');
    expect(main.callsOf('files.write')).toEqual([]);
    act(() => useViewer.getState().reload(FILE(OUT)));
    expect(shown()).toMatchObject({ pin: SWAPPED, dirty: false, text: 'theirs\n' });
  });

  it('W4: under unsaved edits a read without named keeps the pin and the outside save; own or not writable stop it at once, the document standing; a later read gives it back', async () => {
    const main = disk({ [OUT]: 'one\n' }, { names: [OUT] });
    offs.push(connectCodeEvents());
    const changed = () => act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: OUT, kind: 'changed' }));
    show();
    await editable();
    typed('mine ');
    await waitFor(() => expect(shown().dirty).toBe(true));
    main.outside.delete('/elsewhere'); // the folder is the session's now
    changed();
    await waitFor(() => expect(shown().loads).toBe(2));
    expect(shown()).toMatchObject({ named: false, pin: OUT, locked: null, editable: true, dirty: true });
    main.own.add('/elsewhere'); // and MAWS's own
    changed();
    await waitFor(() => expect(shown()).toMatchObject({ locked: 'maws', editable: false, dirty: true }));
    await waitFor(() => expect(editorEditable()).toBe(false));
    expect(view().state.doc.toString()).toBe('mine one\n');
    expect(saveButton()).toBeNull();
    expect(label()?.getAttribute('data-read-only')).toBe('maws');
    expect(await useViewer.getState().save(FILE(OUT))).toBe('noop');
    expect(main.saves()).toEqual([]);
    main.own.delete('/elsewhere');
    changed();
    await waitFor(() => expect(shown()).toMatchObject({ locked: null, editable: true }));
    expect(label()).toBeNull();
    fireEvent.click(saveButton()!);
    await waitFor(() => expect(main.files[OUT]).toBe('mine one\n'));
    expect(main.callsOf('files.writeOutside')).toEqual([{ appSessionId: MAIN_A, path: OUT, content: 'mine one\n', expectedHash: fakeHash('one\n'), real: OUT }]);
    expect(main.callsOf('files.write')).toEqual([]);
  });

  it('W4: under unsaved edits an answer that the file is only added stops the save the same way', async () => {
    const main = disk({ [OUT]: 'one\n' }, { names: [OUT], added: [OUT] });
    offs.push(connectCodeEvents());
    show();
    await editable();
    typed('mine ');
    await waitFor(() => expect(shown().dirty).toBe(true));
    main.names.delete(OUT); // the conversation no longer names it; the Library's added record still admits a read
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: OUT, kind: 'changed' }));
    await waitFor(() => expect(shown()).toMatchObject({ locked: 'added', editable: false, dirty: true, pin: OUT }));
    expect(await useViewer.getState().save(FILE(OUT))).toBe('noop');
    expect(main.saves()).toEqual([]);
  });

  it('W5: a save over a file changed on disk answers conflict and shows the merge view; nothing is written', async () => {
    const main = disk({ [OUT]: 'one\n' }, { names: [OUT] });
    show();
    await editable();
    typed('mine ');
    await waitFor(() => expect(shown().dirty).toBe(true));
    main.files[OUT] = 'other\n';
    fireEvent.click(saveButton()!);
    await waitFor(() => expect(shown()).toMatchObject({ saving: false, theirs: { view: 'merge', text: 'other\n', real: OUT } }));
    expect(main.files[OUT]).toBe('other\n');
    expect(screen.getByText('Changed on disk since you opened it')).toBeTruthy();
  });

  it('W6: named with no outside (a daemon of the parent pin) is read-only with U6c’s title, and Save sends nothing', async () => {
    const main = disk({ [OUT]: 'held\n' }, { names: [OUT], older: true });
    show();
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', named: true, pin: null, locked: null, editable: false }));
    expect(readOnlyReason(shown())).toBe('outside');
    await waitFor(() => expect(title()).toBe(SENTENCES.outside));
    expect(lead().getAttribute('title')).toBe(OUT);
    expect(await useViewer.getState().save(FILE(OUT))).toBe('noop');
    expect(main.saves()).toEqual([]);
  });

  it('W7: a save refused with the service’s sentence asks for Open File…; choosing the file selects the tab with the edits, reads nothing over them, and the save lands', async () => {
    const main = disk({ [OUT]: 'one\n' }, { names: [OUT] });
    show();
    await editable();
    typed('mine ');
    await waitFor(() => expect(shown().dirty).toBe(true));
    main.names.delete(OUT); // the conversation was cleared
    fireEvent.click(saveButton()!);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(REFUSED));
    expect(main.files[OUT]).toBe('one\n');
    expect(main.callsOf('files.write')).toEqual([]);
    main.picks(() => ({ status: 'opened', path: OUT }));
    const reads = main.callsOf('files.read').length;
    await act(() => openChosen(A));
    await settle();
    // nothing read over the edits: the one read after the choice asks the admission alone (review finding 3), and the
    // document, its baseline and the pin stand
    expect(main.callsOf('files.read').slice(reads)).toEqual([{ appSessionId: MAIN_A, path: OUT, offset: 0, length: 1, named: true }]);
    expect(shown()).toMatchObject({ text: 'one\n', hash: fakeHash('one\n'), pin: OUT, dirty: true });
    expect(view().state.doc.toString()).toBe('mine one\n');
    fireEvent.click(saveButton()!);
    await waitFor(() => expect(main.files[OUT]).toBe('mine one\n'));
    expect(main.callsOf('files.write')).toEqual([]);
  });

  it('W8: a daemon replaced by one that does not know files.writeOutside answers unknown_command; no files.write follows; both files unchanged', async () => {
    const INSIDE = '/r/notes.txt';
    const main = disk({ [OUT]: 'one\n', [INSIDE]: 'one\n' }, { names: [OUT] });
    show();
    await editable();
    typed('mine ');
    await waitFor(() => expect(shown().dirty).toBe(true));
    main.daemon.older = true; // the daemon replaced by one of the parent pin
    main.reals[OUT] = INSIDE; // a folder on the path retargeted to a file of the same bytes inside the folders
    fireEvent.click(saveButton()!);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(UNAVAILABLE));
    expect(main.callsOf('files.writeOutside')).toHaveLength(1);
    await settle();
    expect(main.callsOf('files.write')).toEqual([]);
    expect(main.files).toMatchObject({ [OUT]: 'one\n', [INSIDE]: 'one\n' });
  });

  it('a refused save of a file inside the folders shows the service’s words, as today', async () => {
    const main = disk({ '/r/app.ts': 'inside\n' });
    show('/r/app.ts');
    await editable('/r/app.ts');
    typed('+');
    await waitFor(() => expect(shown('/r/app.ts').dirty).toBe(true));
    main.outside.add('/r');
    fireEvent.click(saveButton()!);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(`Could not save: ${OUTSIDE_REFUSAL}`));
    main.outside.delete('/r');
    main.own.add('/r');
    fireEvent.click(saveButton()!);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Could not save: not writable: /r/app.ts'));
    expect(main.callsOf('files.writeOutside')).toEqual([]);
  });

  // K1, K14, K15, K3: the failure on a line of its own at the bar's full width, never cut; Save and Wrap one group.
  it('a save’s failure takes a line of its own, never cut; Save and Wrap stay one group on the path’s line', async () => {
    const main = disk({ [OUT]: 'one\n' }, { names: [OUT] });
    show();
    await editable();
    typed('mine ');
    await waitFor(() => expect(shown().dirty).toBe(true));
    main.names.delete(OUT);
    fireEvent.click(saveButton()!);
    const failure = await screen.findByRole('alert');
    const bar = lead().parentElement!;
    expect(failure.parentElement).toBe(bar); // a line of the bar, not a part of the controls
    expect(bar.lastElementChild).toBe(failure);
    const classes = failure.className.split(/\s+/);
    expect(classes).toContain('basis-full');
    expect(classes).not.toContain('truncate');
    const group = bar.querySelector('[data-bar-controls]')!;
    expect(group.parentElement).toBe(bar);
    expect(within(group as HTMLElement).getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(within(group as HTMLElement).getByRole('button', { name: 'Wrap' })).toBeTruthy();
  });

  // Review finding 5 (K1, K14): an unbroken run (a long path component) wraps anywhere within the failure's own line.
  it('a failure that holds a long unbroken path wraps anywhere within its own line', async () => {
    const LONG = `/r/${'unbroken-component-'.repeat(12)}end.txt`;
    const main = disk({ [LONG]: 'one\n' });
    show(LONG);
    await editable(LONG);
    typed('mine ');
    await waitFor(() => expect(shown(LONG).dirty).toBe(true));
    delete main.files[LONG];
    fireEvent.click(saveButton()!);
    const failure = await screen.findByRole('alert');
    expect(failure.textContent).toContain(LONG);
    const classes = failure.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['basis-full', 'min-w-0', 'wrap-anywhere']));
    expect(classes).not.toContain('truncate');
  });

  // Review finding 1 (decision 6): every answer that comes back sets the latest admission from itself alone, a later
  // chunk's included, whether or not its content is taken; the pin moves by the document and dirty rule. Driven through
  // the store with continuations held (a file of two chunks).
  const BIG = 'a line of the notes\n'.repeat(80_000);
  const mountOut = () => offs.push(useViewer.getState().mount(FILE(OUT), { appSessionId: A, path: OUT, line: null }));
  const readsSoFar = (main: { callsOf: (name: 'files.read') => unknown[] }) => main.callsOf('files.read').length;

  it('decision 6: a lock the head said and a later chunk’s answer no longer says goes', async () => {
    const main = disk({ [OUT]: BIG }, { names: [OUT], own: ['/elsewhere'] });
    const head = main.hold('files.read');
    mountOut();
    await waitFor(() => expect(readsSoFar(main)).toBe(1));
    main.own.delete('/elsewhere');
    head.release();
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', complete: true }));
    expect(readsSoFar(main)).toBe(2);
    expect(shown()).toMatchObject({ locked: null, named: true, pin: OUT, editable: true });
  });

  it('decision 6: a clean read whose later chunk answers no outside clears the pin', async () => {
    const main = disk({ [OUT]: BIG }, { names: [OUT] });
    main.reals[OUT] = REAL;
    const head = main.hold('files.read');
    mountOut();
    await waitFor(() => expect(readsSoFar(main)).toBe(1));
    main.outside.delete('/elsewhere'); // the folder is the session's now
    head.release();
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', complete: true }));
    expect(shown()).toMatchObject({ named: false, locked: null, pin: null, editable: true });
  });

  it('decision 6: a downgrade to MAWS’s own in a chunk whose hash differs stops a dirty entry’s save, its content not taken', async () => {
    const main = disk({ [OUT]: BIG }, { names: [OUT] });
    offs.push(connectCodeEvents());
    mountOut();
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', editable: true, pin: OUT }));
    act(() => useViewer.getState().setDirty(FILE(OUT), true));
    const before = readsSoFar(main);
    const head = main.hold('files.read');
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: OUT, kind: 'changed' }));
    await waitFor(() => expect(readsSoFar(main)).toBe(before + 1));
    main.files[OUT] = `${BIG}one more line\n`; // changed between the head and the next chunk
    main.own.add('/elsewhere');
    head.release();
    await waitFor(() => expect(shown()).toMatchObject({ locked: 'maws', editable: false, dirty: true, pin: OUT }));
    expect(shown().text).toBe(BIG);
    expect(await useViewer.getState().save(FILE(OUT))).toBe('noop');
    expect(main.saves()).toEqual([]);
  });

  // Re-review residual 3 (decision 6): an answer's admission lands when the answer does, not when the load's content
  // commits; a zero-length continuation's included.
  it('decision 6: a head that answers MAWS’s own stops a dirty entry’s save while the next chunk is still out', async () => {
    const main = disk({ [OUT]: BIG }, { names: [OUT] });
    offs.push(connectCodeEvents());
    mountOut();
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', editable: true, pin: OUT }));
    act(() => useViewer.getState().setDirty(FILE(OUT), true));
    const before = readsSoFar(main);
    const head = main.hold('files.read');
    const next = main.hold('files.read');
    head.release(); // the head passes; the next chunk is held
    main.own.add('/elsewhere');
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: OUT, kind: 'changed' }));
    await waitFor(() => expect(readsSoFar(main)).toBe(before + 2));
    await waitFor(() => expect(shown()).toMatchObject({ locked: 'maws', editable: false, dirty: true }));
    expect(await useViewer.getState().save(FILE(OUT))).toBe('noop');
    expect(main.saves()).toEqual([]);
    next.release();
    await waitFor(() => expect(shown().pending).toBe(0));
    expect(shown()).toMatchObject({ locked: 'maws', editable: false, dirty: true, text: BIG });
  });

  it('decision 6: a zero-length continuation’s admission is the latest', async () => {
    const HEAD_BYTES = 5 * 1024 * 1024; // past CODE_CAP: a bounded head
    const TWO = 2 * 1024 * 1024;
    const main = disk({ [OUT]: { text: 'n'.repeat(TWO), bytes: HEAD_BYTES } } as never, { names: [OUT] });
    offs.push(connectCodeEvents());
    mountOut();
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', kind: 'head', loaded: 1024 * 1024 }));
    act(() => useViewer.getState().loadMore(FILE(OUT)));
    await waitFor(() => expect(shown()).toMatchObject({ loaded: TWO, loadingMore: false }));
    const before = readsSoFar(main);
    const head = main.hold('files.read');
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: OUT, kind: 'changed' }));
    await waitFor(() => expect(readsSoFar(main)).toBe(before + 1));
    (main.files as Record<string, unknown>)[OUT] = { text: 'n'.repeat(1024 * 1024), bytes: HEAD_BYTES }; // shrank: the next chunk answers no bytes
    main.own.add('/elsewhere');
    head.release();
    await waitFor(() => expect(readsSoFar(main)).toBe(before + 2));
    await waitFor(() => expect(shown()).toMatchObject({ pending: 0, locked: 'maws' }));
  });

  // Re-review residual 1: an admission-only answer lands only on the entry it was asked for, and only while no newer read
  // has spoken: a move to another session, or a newer read, leaves it nowhere.
  const lockedDirty = async (main: ReturnType<typeof disk>) => {
    offs.push(connectCodeEvents());
    mountOut();
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', editable: true, pin: OUT }));
    act(() => useViewer.getState().setDirty(FILE(OUT), true));
    main.names.delete(OUT);
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: OUT, kind: 'changed' }));
    await waitFor(() => expect(shown()).toMatchObject({ locked: 'added', editable: false, dirty: true, pin: OUT, pending: 0 }));
    main.grant(MAIN_A, OUT); // the person chose the file
  };

  // Fix round 3: one order for the admission. Every read that can set it draws a number when it is sent; an answer sets
  // it only above the last number that did, and a refused answer sets and records nothing. So the read sent after the
  // grant wins whatever order the answers land in.
  const lastRead = (main: ReturnType<typeof disk>) => main.callsOf('files.read').at(-1);

  it('one order (a): of two overlapping admission-only reads, the later-sent one’s answer stands when the earlier lands last', async () => {
    const main = disk({ [OUT]: 'one\n' }, { names: [OUT], added: [OUT] });
    await lockedDirty(main);
    const earlier = main.hold('files.read');
    act(() => useViewer.getState().readAdmission(A, OUT)); // answers chosen, writable, once released
    await waitFor(() => expect(lastRead(main)).toMatchObject({ offset: 0, length: 1 }));
    const count = main.callsOf('files.read').length;
    main.own.add('/elsewhere');
    act(() => useViewer.getState().readAdmission(A, OUT)); // answers MAWS's own at once
    await waitFor(() => expect(main.callsOf('files.read')).toHaveLength(count + 1));
    await waitFor(() => expect(shown()).toMatchObject({ locked: 'maws', editable: false }));
    earlier.release();
    await settle();
    expect(shown()).toMatchObject({ locked: 'maws', editable: false, dirty: true, pin: OUT });
    expect(await useViewer.getState().save(FILE(OUT))).toBe('noop');
  });

  it('one order (b): a save’s conflict read sent before an admission-only read lands after it and does not override it', async () => {
    const main = disk({ [OUT]: 'one\n' }, { names: [OUT], added: [OUT] });
    show();
    await editable();
    typed('mine ');
    await waitFor(() => expect(shown().dirty).toBe(true));
    main.files[OUT] = 'theirs\n'; // the save conflicts
    const write = main.hold('files.writeOutside');
    const conflictRead = main.hold('files.read');
    const saving = useViewer.getState().save(FILE(OUT));
    await waitFor(() => expect(main.callsOf('files.writeOutside')).toHaveLength(1));
    main.names.delete(OUT); // the conflict read, sent now, answers: only added
    write.release();
    await waitFor(() => expect(lastRead(main)).toMatchObject({ hash: true, offset: 0 }));
    const count = main.callsOf('files.read').length;
    main.names.add(OUT); // the admission-only read, sent after it, answers: named, writable
    act(() => useViewer.getState().readAdmission(A, OUT));
    await waitFor(() => expect(main.callsOf('files.read')).toHaveLength(count + 1));
    await settle();
    conflictRead.release();
    expect(await act(() => saving)).toBe('conflict');
    expect(shown()).toMatchObject({ locked: null, editable: true, pin: OUT, theirs: { view: 'merge', text: 'theirs\n' } });
  });

  it('one order (c): Open File… recovers a dirty tab locked as added when an older read’s answer lands after the post-grant one', async () => {
    const main = disk({ [OUT]: 'one\n' }, { names: [OUT], added: [OUT] });
    offs.push(connectCodeEvents());
    show();
    await editable();
    typed('mine ');
    await waitFor(() => expect(shown().dirty).toBe(true));
    main.names.delete(OUT);
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: OUT, kind: 'changed' }));
    await waitFor(() => expect(shown()).toMatchObject({ locked: 'added', editable: false, dirty: true, pin: OUT, pending: 0 }));
    const older = main.hold('files.read');
    const count = main.callsOf('files.read').length;
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: OUT, kind: 'changed' })); // sent before the grant: only added
    await waitFor(() => expect(main.callsOf('files.read')).toHaveLength(count + 1));
    main.picks(() => ({ status: 'opened', path: OUT }));
    await userEvent.setup().click(label()!);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Open File…' }));
    await waitFor(() => expect(lastRead(main)).toMatchObject({ offset: 0, length: 1 }));
    await waitFor(() => expect(shown()).toMatchObject({ locked: null, editable: true }));
    older.release();
    await waitFor(() => expect(shown().pending).toBe(0));
    await settle();
    expect(shown()).toMatchObject({ locked: null, editable: true, dirty: true, pin: OUT, text: 'one\n', hash: fakeHash('one\n') });
    expect(view().state.doc.toString()).toBe('mine one\n');
    fireEvent.click(saveButton()!);
    await waitFor(() => expect(main.files[OUT]).toBe('mine one\n'));
    expect(main.callsOf('files.writeOutside')).toEqual([{ appSessionId: MAIN_A, path: OUT, content: 'mine one\n', expectedHash: fakeHash('one\n'), real: OUT }]);
    expect(main.callsOf('files.write')).toEqual([]);
  });

  it('one order (d): a refused answer landing between an admission-only read’s send and its answer sets and records nothing', async () => {
    const main = disk({ [OUT]: 'one\n' }, { names: [OUT], added: [OUT] });
    await lockedDirty(main); // granted after the lock
    const refused = main.hold('files.read');
    delete main.files[OUT];
    const count = main.callsOf('files.read').length;
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: OUT, kind: 'changed' })); // answers not found
    await waitFor(() => expect(main.callsOf('files.read')).toHaveLength(count + 1));
    main.files[OUT] = 'one\n';
    const admission = main.hold('files.read');
    act(() => useViewer.getState().readAdmission(A, OUT)); // answers chosen, writable
    await waitFor(() => expect(main.callsOf('files.read')).toHaveLength(count + 2));
    refused.release();
    await waitFor(() => expect(shown().pending).toBe(0));
    expect(shown()).toMatchObject({ locked: 'added', editable: false });
    admission.release();
    await waitFor(() => expect(shown()).toMatchObject({ locked: null, editable: true, dirty: true, pin: OUT }));
  });

  it('an admission-only answer that lands after the entry moved to another session changes nothing', async () => {
    const main = disk({ [OUT]: 'one\n' }, { names: [OUT], added: [OUT] });
    await lockedDirty(main);
    const asked = main.hold('files.read');
    act(() => useViewer.getState().readAdmission(A, OUT));
    await waitFor(() => expect(main.callsOf('files.read').at(-1)).toMatchObject({ offset: 0, length: 1 }));
    offs.push(useViewer.getState().mount(FILE(OUT), { appSessionId: B, path: OUT, line: null })); // the edits move to session B
    await waitFor(() => expect(shown()).toMatchObject({ appSessionId: B, pending: 0 }));
    asked.release();
    await settle();
    expect(shown()).toMatchObject({ appSessionId: B, locked: 'added', editable: false, dirty: true });
    expect(await useViewer.getState().save(FILE(OUT))).toBe('noop');
  });

  it('an admission-only answer that lands after a newer read locked the entry leaves it locked', async () => {
    const main = disk({ [OUT]: 'one\n' }, { names: [OUT], added: [OUT] });
    await lockedDirty(main);
    const asked = main.hold('files.read');
    act(() => useViewer.getState().readAdmission(A, OUT));
    await waitFor(() => expect(main.callsOf('files.read').at(-1)).toMatchObject({ offset: 0, length: 1 }));
    main.own.add('/elsewhere'); // the newer read answers MAWS's own
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: OUT, kind: 'changed' }));
    await waitFor(() => expect(shown()).toMatchObject({ locked: 'maws', pending: 0 }));
    asked.release(); // the older answer: chosen, writable
    await settle();
    expect(shown()).toMatchObject({ locked: 'maws', editable: false, dirty: true });
    expect(await useViewer.getState().save(FILE(OUT))).toBe('noop');
  });

  // Review finding 3 (decision 18, the panel's promise): choosing the very file a dirty tab holds, after W4 left its edits
  // standing locked, reads its admission once more (the document and the pin standing), and the tab saves again.
  it('W4 then Open File…: choosing the file the dirty tab holds makes it editable again; Save writes it with the pin', async () => {
    const main = disk({ [OUT]: 'one\n' }, { names: [OUT], added: [OUT] });
    offs.push(connectCodeEvents());
    show();
    await editable();
    typed('mine ');
    await waitFor(() => expect(shown().dirty).toBe(true));
    main.names.delete(OUT);
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: OUT, kind: 'changed' }));
    await waitFor(() => expect(shown()).toMatchObject({ locked: 'added', editable: false, dirty: true, pin: OUT }));
    main.picks(() => ({ status: 'opened', path: OUT }));
    await userEvent.setup().click(label()!);
    const panel = await screen.findByRole('dialog');
    fireEvent.click(within(panel).getByRole('button', { name: 'Open File…' }));
    await waitFor(() => expect(shown()).toMatchObject({ locked: null, editable: true, dirty: true, pin: OUT }));
    await waitFor(() => expect(editorEditable()).toBe(true));
    expect(view().state.doc.toString()).toBe('mine one\n');
    fireEvent.click(saveButton()!);
    await waitFor(() => expect(main.files[OUT]).toBe('mine one\n'));
    expect(main.callsOf('files.writeOutside')).toEqual([{ appSessionId: MAIN_A, path: OUT, content: 'mine one\n', expectedHash: fakeHash('one\n'), real: OUT }]);
    expect(main.callsOf('files.write')).toEqual([]);
  });

  it('W2: a save in flight when its tab closes lands nowhere, and the file is what the save wrote', async () => {
    const main = disk({ [OUT]: 'one\n' }, { names: [OUT] });
    const { unmount } = show();
    await editable();
    typed('mine ');
    await waitFor(() => expect(shown().dirty).toBe(true));
    const write = main.hold('files.writeOutside');
    const saving = useViewer.getState().save(FILE(OUT));
    await waitFor(() => expect(main.callsOf('files.writeOutside')).toHaveLength(1));
    act(() => useLayout.getState().closeTab(FILE(OUT)));
    unmount();
    expect(useViewer.getState().entries.has(FILE(OUT))).toBe(false);
    write.release();
    expect(await saving).toBe('noop');
    await settle();
    expect(useViewer.getState().entries.has(FILE(OUT))).toBe(false);
    expect(main.files[OUT]).toBe('mine one\n');
  });

  it('W10: a file named only by a tool’s result, once the agent links it in its own text, is editable when shown again, and Save writes', async () => {
    const main = disk({ [OUT]: 'from a tool\n' }, { results: [OUT] });
    const first = show();
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', locked: 'result', editable: false }));
    expect(lead().getAttribute('data-outside')).toBe('result');
    expect(label()?.getAttribute('data-read-only')).toBe('result');
    main.names.add(OUT); // the agent's own text links it
    first.unmount();
    render(<FileViewer tab={fileTab(OUT)} />); // shown again
    await editable();
    expect(shown()).toMatchObject({ locked: null, named: true, pin: OUT });
    expect(label()).toBeNull();
    expect(lead().getAttribute('data-outside')).toBe('writable');
    typed('mine ');
    await waitFor(() => expect(shown().dirty).toBe(true));
    fireEvent.click(saveButton()!);
    await waitFor(() => expect(main.files[OUT]).toBe('mine from a tool\n'));
  });

  // The architect's case (M3's brief): at the narrowest width the bar keeps the path cut in its middle, both ends drawn
  // (the folder part cut first, at least its first character and the ellipsis; the name whole), and the path's
  // accessible description carries the whole path. M4's scene measures the 320 px step.
  it('at the narrowest width the path is cut in its middle with both ends visible, and its accessible description is the whole path', async () => {
    const LONG = '/elsewhere/notes/plans/todo.txt';
    disk({ [LONG]: 'one\n' }, { names: [LONG] });
    show(LONG);
    await waitFor(() => expect(shown(LONG)?.status).toBe('ready'));
    const [folder, slash, name] = [...lead().children] as HTMLElement[];
    expect(lead().textContent).toBe(LONG);
    expect([folder.textContent, slash.textContent, name.textContent]).toEqual(['/elsewhere/notes/plans', '/', 'todo.txt']);
    expect(folder.className.split(/\s+/)).toEqual(expect.arrayContaining(['truncate', 'min-w-[2ch]']));
    expect(slash.className.split(/\s+/)).toContain('shrink-0');
    expect(name.className.split(/\s+/)).toContain('shrink-0');
    expect(lead().style.minWidth).toBe(`${'todo.txt'.length + 3}ch`); // the name, the slash and the folder's two characters
    expect(lead().getAttribute('aria-description')).toBe(`Save writes to ${LONG}`);
  });

  it('reads with agent while the tab holds the agent’s mark; a grant alone is then refused, and the read without it shows the file', async () => {
    const main = disk({ [OUT]: 'chosen\n', '/elsewhere/report.pdf': '%PDF-1.4 invented\n' }, { names: ['/elsewhere/report.pdf'] });
    main.grant(MAIN_A, OUT);
    act(() => void openFile(A, OUT, null, { main: true }));
    const { rerender } = render(<FileViewer tab={fileTab(OUT)} agent />);
    expect((await screen.findByRole('alert')).textContent).toContain(OUTSIDE_REFUSAL);
    expect(main.callsOf('files.read')).toEqual([expect.objectContaining({ path: OUT, named: true, agent: true })]);
    rerender(<FileViewer tab={fileTab(OUT)} />); // the person's open removes the mark
    await editable();
    expect(main.callsOf('files.read').at(-1)).not.toHaveProperty('agent');
    cleanup();
    act(() => void openFile(A, '/elsewhere/report.pdf', null, { main: true }));
    render(<FileViewer tab={fileTab('/elsewhere/report.pdf')} agent />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open externally' }));
    await waitFor(() => expect(main.callsOf('files.openExternal')).toEqual([{ appSessionId: MAIN_A, path: '/elsewhere/report.pdf', named: true, agent: true }]));
  });
});

// ---- a framed file (UX wave U6b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, M5) ------------------
// The entry asks main for a token once a read of a PDF, an HTML page, a video or a sound lands, keeps one ask in flight,
// swaps the frame only when the new token is ready, and releases every token it no longer shows. Main's two commands
// and its event are the fake disk's (`installDisk`); every path and byte here is invented.

describe('a framed file (UX wave U6b-2)', () => {
  const PDF = '/r/ledger.pdf';
  const NAMED = '/elsewhere/ledger.pdf';
  const offs: (() => void)[] = [];
  beforeEach(() => {
    useViewer.getState().reset();
    useFiles.getState().reset();
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, hydrated: true });
  });
  afterEach(() => {
    cleanup();
    offs.splice(0).forEach((off) => off());
    vi.useRealTimers();
  });

  const entry = (path = PDF) => useViewer.getState().entries.get(FILE(path));
  const tokenOf = (path = PDF) => {
    const frame = entry(path)?.frame;
    return frame?.status === 'ready' ? frame.token : frame?.status === 'asking' ? (frame.shown?.token ?? null) : null;
  };
  const frameSrc = () => document.querySelector('[data-artifact-frame="pdf"]')?.getAttribute('src') ?? null;
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  // A main tab of the file the layout holds, so the prune keeps its entry while it is not shown; drawn.
  const show = (path = PDF) => {
    act(() => void openFile(A, path, null, { main: true }));
    return render(<FileViewer tab={fileTab(path)} />);
  };
  const changed = (main: { emit: ReturnType<typeof installDisk>['emit'] }, path = PDF) => act(() => main.emit('files.changed', { appSessionId: MAIN_A, path, kind: 'changed' }));

  it('a framed entry asks main once its read lands, with the session, the path and the read’s keys', async () => {
    const main = installDisk({ [PDF]: '%PDF-1.4 invented\n' });
    show();
    await waitFor(() => expect(entry()?.frame?.status).toBe('ready'));
    expect(main.callsOf('files.read')).toEqual([{ appSessionId: MAIN_A, path: PDF, offset: 0, length: FILES_READ_DEFAULT_LENGTH, hash: true, named: true }]);
    expect(main.callsOf('layout.frameFile')).toEqual([{ appSessionId: MAIN_A, path: PDF }]);
    expect(entry()).toMatchObject({ kind: 'frame', status: 'ready', frame: { status: 'ready', token: main.issued[0], url: frameUrl(main.issued[0]!, 'ledger.pdf'), framed: 'pdf' } });
    await settle();
    expect(main.callsOf('layout.frameFile')).toHaveLength(1);
  });

  // UX wave U6e arrived with the chain ("What this document assumes of landings in flight"): a tab that holds the agent's
  // mark reads with `agent`, so its frame is asked with it too, at `frameAsk`; a person's tab asks without it.
  it('a tab that holds the agent’s mark asks its frame with agent, and a person’s tab asks without it', async () => {
    const main = installDisk({ [PDF]: '%PDF-1.4 invented\n' });
    act(() => void openFile(A, PDF, null, { main: true }));
    const { rerender } = render(<FileViewer tab={fileTab(PDF)} agent />);
    await waitFor(() => expect(entry()?.frame?.status).toBe('ready'));
    expect(main.callsOf('files.read')).toEqual([expect.objectContaining({ path: PDF, named: true, agent: true })]);
    expect(main.callsOf('layout.frameFile')).toEqual([{ appSessionId: MAIN_A, path: PDF, agent: true }]);
    rerender(<FileViewer tab={fileTab(PDF)} />); // the person's open removes the mark, and the file is read again under it
    await waitFor(() => expect(main.callsOf('layout.frameFile')).toHaveLength(2));
    expect(main.callsOf('layout.frameFile')[1]).toEqual({ appSessionId: MAIN_A, path: PDF });
  });

  it('the bar’s Open externally of a drawn file the agent’s tab holds passes agent', async () => {
    const main = installDisk({ [PDF]: '%PDF-1.4 invented\n' });
    act(() => void openFile(A, PDF, null, { main: true }));
    render(<FileViewer tab={fileTab(PDF)} agent />);
    await waitFor(() => expect(entry()?.frame?.status).toBe('ready'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open externally' }));
    await waitFor(() => expect(main.callsOf('files.openExternal')).toEqual([{ appSessionId: MAIN_A, path: PDF, named: true, agent: true }]));
  });

  it('an entry read by its artifact asks nothing and draws the row', async () => {
    const main = installFakeMain(async (name) =>
      name === 'library.read'
        ? ok({ encoding: 'base64', content: 'JVBERi0xLjQ=', bytes: 8, offset: 0, length: 8, truncated: false, mime: 'application/pdf', hash: null, utf8: null })
        : fail(`unexpected ${name}`),
    );
    const ID = '00000000-0000-4000-8000-0000000000aa';
    render(<FileBody tabId={`artifact:${ID}:1`} appSessionId={null} path="/w/ledger.pdf" readOnly artifact={{ artifactId: ID, revision: 1 }} />);
    expect((await screen.findByText('PDF files open outside MAWS')).tagName).toBe('P');
    await settle();
    expect(main.callsOf('layout.frameFile')).toEqual([]);
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('an ask that fails makes the entry an error that revisit reads again', async () => {
    let connected = false;
    const main = installDisk({ [PDF]: '%PDF-1.4 invented\n' }, { frames: (_, issue) => (connected ? issue() : fail('layout.frameFile: machine mini is not connected')) });
    show();
    expect((await screen.findByRole('alert')).textContent).toContain('Refused: layout.frameFile: machine mini is not connected');
    expect(entry()).toMatchObject({ status: 'error', frame: null });
    connected = true;
    act(() => useViewer.getState().revisit(FILE(PDF)));
    await waitFor(() => expect(entry()?.frame?.status).toBe('ready'));
    expect(main.callsOf('files.read')).toHaveLength(2);
    expect(main.callsOf('layout.frameFile')).toHaveLength(2);
  });

  it('a row for a daemon that does not serve asks again when the entry is mounted again', async () => {
    let served = false;
    const main = installDisk({ [PDF]: '%PDF-1.4 invented\n' }, { frames: (_, issue) => (served ? issue() : ok({ status: 'row', why: 'unserved' })) });
    const first = show();
    expect((await screen.findByText('MAWS’s service on this Mac is an older version, so this file can’t be shown here yet.')).tagName).toBe('P');
    expect(entry()!.frame).toEqual({ status: 'row', why: 'unserved' });
    first.unmount();
    served = true;
    render(<FileViewer tab={fileTab(PDF)} />);
    await waitFor(() => expect(entry()?.frame?.status).toBe('ready'));
    expect(main.callsOf('files.read')).toHaveLength(1);
    expect(main.callsOf('layout.frameFile')).toHaveLength(2);
  });

  it('a revisit of a named file asks again and flashes nothing when type and size are the same', async () => {
    const main = installDisk({ [NAMED]: '%PDF-1.4 invented\n' }, { outside: ['/elsewhere'], names: (appSessionId, path) => appSessionId === MAIN_A && path === NAMED });
    const first = show(NAMED);
    await waitFor(() => expect(entry(NAMED)?.frame?.status).toBe('ready'));
    first.unmount();
    render(<FileViewer tab={fileTab(NAMED)} />);
    await waitFor(() => expect(entry(NAMED)?.frame).toMatchObject({ status: 'ready', token: main.issued[1] }));
    expect(main.callsOf('files.read')).toHaveLength(2);
    await waitFor(() => expect(main.released()).toEqual([main.issued[0]]));
    expect(entry(NAMED)).toMatchObject({ named: true, updated: 0 });
    expect(document.querySelector('[data-updated]')).toBeNull();
  });

  it('a failed frame releases its token and is revisitable; a failure starts no read by itself', async () => {
    const main = installDisk({ [PDF]: '%PDF-1.4 invented\n' });
    offs.push(connectCodeEvents());
    show();
    await waitFor(() => expect(entry()?.frame?.status).toBe('ready'));
    const before = main.calls.length;
    vi.useFakeTimers();
    act(() => main.emit('layout.frameFailed', { token: main.issued[0]! }));
    expect(entry()!.frame).toEqual({ status: 'failed' });
    await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000));
    expect(main.calls.slice(before)).toEqual([{ name: 'layout.releaseFrame', input: { token: main.issued[0] } }]);
    vi.useRealTimers();
    act(() => useViewer.getState().revisit(FILE(PDF)));
    await waitFor(() => expect(entry()?.frame).toMatchObject({ status: 'ready', token: main.issued[1] }));
    expect(main.callsOf('files.read')).toHaveLength(2);
  });

  it('frameFailed for a token the entry no longer holds changes nothing', async () => {
    const main = installDisk({ [PDF]: '%PDF-1.4 invented\n' });
    offs.push(connectCodeEvents());
    show();
    await waitFor(() => expect(entry()?.frame?.status).toBe('ready'));
    changed(main);
    await waitFor(() => expect(tokenOf()).toBe(main.issued[1]));
    await waitFor(() => expect(main.released()).toEqual([main.issued[0]]));
    act(() => main.emit('layout.frameFailed', { token: main.issued[0]! }));
    await settle();
    expect(entry()!.frame).toMatchObject({ status: 'ready', token: main.issued[1] });
    expect(main.released()).toEqual([main.issued[0]]);
  });

  it('the removal of an entry releases its token', async () => {
    const main = installDisk({ [PDF]: '%PDF-1.4 invented\n' });
    const view = show();
    await waitFor(() => expect(entry()?.frame?.status).toBe('ready'));
    view.unmount();
    expect(main.released()).toEqual([]);
    act(() => useLayout.getState().closeTab(FILE(PDF), { remember: false }));
    expect(entry()).toBeUndefined();
    await waitFor(() => expect(main.released()).toEqual([main.issued[0]]));
  });

  it('reset releases every token', async () => {
    const main = installDisk({ [PDF]: '%PDF-1.4 invented\n', '/r/tide.webm': 'invented clip bytes' });
    show();
    show('/r/tide.webm');
    await waitFor(() => expect([entry()?.frame?.status, entry('/r/tide.webm')?.frame?.status]).toEqual(['ready', 'ready']));
    cleanup();
    act(() => useViewer.getState().reset());
    await waitFor(() => expect(main.released().sort()).toEqual([...main.issued].sort()));
    expect(main.issued).toHaveLength(2);
  });

  // The task review's finding: a kind change, or a refusal, ends what the entry shows but not the ask main is answering, so
  // the next ask waits for that answer (decision 5: one ask in flight per entry), whose token is released on arrival.
  it('a kind change during an ask keeps one ask in flight: the next framed read waits for the first answer, whose token is released', async () => {
    const main = installDisk({ [PDF]: '%PDF-1.4 invented\n' });
    offs.push(connectCodeEvents());
    const first = main.hold('layout.frameFile');
    show();
    await waitFor(() => expect(main.callsOf('layout.frameFile')).toHaveLength(1));
    main.files[PDF] = { text: 'plain invented words\n', bytes: 21, mime: 'text/plain' }; // the file is a text now
    changed(main);
    await waitFor(() => expect(entry()).toMatchObject({ kind: 'code', frame: null }));
    main.files[PDF] = { text: '%PDF-1.4 invented again\n', bytes: 24, mime: 'application/pdf' }; // and a PDF again
    changed(main);
    await waitFor(() => expect(entry()).toMatchObject({ kind: 'frame', frame: { status: 'asking', shown: null } }));
    await settle();
    expect(main.callsOf('layout.frameFile')).toHaveLength(1); // the first is still out: no second
    first.release();
    await waitFor(() => expect(entry()!.frame).toMatchObject({ status: 'ready', token: main.issued[1] }));
    expect(main.callsOf('layout.frameFile')).toHaveLength(2);
    await waitFor(() => expect(main.released()).toEqual([main.issued[0]]));
  });

  it('a read refused during an ask keeps one ask in flight: the read again waits for the first answer, whose token is released', async () => {
    const main = installDisk({ [PDF]: '%PDF-1.4 invented\n' });
    offs.push(connectCodeEvents());
    const first = main.hold('layout.frameFile');
    show();
    await waitFor(() => expect(main.callsOf('layout.frameFile')).toHaveLength(1));
    main.outside.add('/r'); // the folder leaves the session's: the re-read is refused
    changed(main);
    await waitFor(() => expect(entry()).toMatchObject({ status: 'error', frame: null }));
    main.outside.delete('/r');
    act(() => useViewer.getState().revisit(FILE(PDF)));
    await waitFor(() => expect(entry()).toMatchObject({ kind: 'frame', frame: { status: 'asking', shown: null } }));
    await settle();
    expect(main.callsOf('layout.frameFile')).toHaveLength(1);
    first.release();
    await waitFor(() => expect(entry()!.frame).toMatchObject({ status: 'ready', token: main.issued[1] }));
    expect(main.callsOf('layout.frameFile')).toHaveLength(2);
    await waitFor(() => expect(main.released()).toEqual([main.issued[0]]));
  });

  // The re-review's finding: the bound is one ask in flight per living entry (decision 5); a removed or replaced entry's
  // ask goes on alone and its answer is released when it comes (the table's X row), never holding back the next entry.
  it('an entry closed and opened again while its ask is held asks at once and draws; the closed entry’s answer, arriving after, is released and overwrites nothing', async () => {
    const main = installDisk({ [PDF]: '%PDF-1.4 invented\n' });
    const first = main.hold('layout.frameFile');
    const view = show();
    await waitFor(() => expect(main.callsOf('layout.frameFile')).toHaveLength(1));
    view.unmount();
    act(() => useLayout.getState().closeTab(FILE(PDF), { remember: false }));
    expect(entry()).toBeUndefined();
    show(); // opened again
    await waitFor(() => expect(main.callsOf('layout.frameFile')).toHaveLength(2));
    await waitFor(() => expect(entry()!.frame).toMatchObject({ status: 'ready', token: main.issued[1] }));
    await waitFor(() => expect(frameSrc()).toBe(`${frameUrl(main.issued[1]!, 'ledger.pdf')}#navpanes=0`));
    first.release();
    await waitFor(() => expect(main.released()).toEqual([main.issued[0]]));
    await settle();
    expect(entry()!.frame).toMatchObject({ status: 'ready', token: main.issued[1] });
    expect(main.callsOf('layout.frameFile')).toHaveLength(2);
  });

  it('an entry replaced under the same key while its ask is held asks at once and draws; the replaced entry’s answer, arriving after, is released and overwrites nothing', async () => {
    const OTHER = '/r/annex.pdf';
    const main = installDisk({ [PDF]: '%PDF-1.4 invented\n', [OTHER]: '%PDF-1.4 annex\n' });
    const KEY_ = 'file:t:the-one-tab';
    const first = main.hold('layout.frameFile');
    const view = render(<FileBody tabId={KEY_} appSessionId={A} path={PDF} />);
    await waitFor(() => expect(main.callsOf('layout.frameFile')).toHaveLength(1));
    view.rerender(<FileBody tabId={KEY_} appSessionId={A} path={OTHER} />); // another file under the same key
    await waitFor(() => expect(main.callsOf('layout.frameFile')).toHaveLength(2));
    expect(main.callsOf('layout.frameFile')[1]).toEqual({ appSessionId: MAIN_A, path: OTHER });
    await waitFor(() => expect(useViewer.getState().entries.get(KEY_)).toMatchObject({ path: OTHER, frame: { status: 'ready', token: main.issued[1] } }));
    first.release();
    await waitFor(() => expect(main.released()).toEqual([main.issued[0]]));
    await settle();
    expect(useViewer.getState().entries.get(KEY_)).toMatchObject({ path: OTHER, frame: { status: 'ready', token: main.issued[1] } });
  });

  it('a closed entry’s answer that arrives before the reopened entry’s is released and leaves the new one asking until its own', async () => {
    const main = installDisk({ [PDF]: '%PDF-1.4 invented\n' });
    const first = main.hold('layout.frameFile');
    const second = main.hold('layout.frameFile');
    const view = show();
    await waitFor(() => expect(main.callsOf('layout.frameFile')).toHaveLength(1));
    view.unmount();
    act(() => useLayout.getState().closeTab(FILE(PDF), { remember: false }));
    show();
    await waitFor(() => expect(main.callsOf('layout.frameFile')).toHaveLength(2));
    first.release();
    await waitFor(() => expect(main.released()).toEqual([main.issued[0]]));
    await settle();
    expect(entry()!.frame).toEqual({ status: 'asking', shown: null });
    second.release();
    await waitFor(() => expect(entry()!.frame).toMatchObject({ status: 'ready', token: main.issued[1] }));
    expect(main.released()).toEqual([main.issued[0]]);
  });

  // Sequence 1: a token asked while the tab closes.
  it('an answer for an entry that is gone releases its token', async () => {
    const main = installDisk({ [PDF]: '%PDF-1.4 invented\n' });
    const ask = main.hold('layout.frameFile');
    const view = show();
    await waitFor(() => expect(main.callsOf('layout.frameFile')).toHaveLength(1));
    expect(entry()!.frame).toEqual({ status: 'asking', shown: null });
    view.unmount();
    act(() => useLayout.getState().closeTab(FILE(PDF), { remember: false }));
    expect(entry()).toBeUndefined();
    ask.release();
    await waitFor(() => expect(main.released()).toEqual([main.issued[0]]));
    expect(entry()).toBeUndefined();
  });

  // Sequence 2: a change during an ask.
  it('a read that lands during an ask is followed by one more ask, never two in flight', async () => {
    const main = installDisk({ [PDF]: '%PDF-1.4 invented\n' });
    offs.push(connectCodeEvents());
    const first = main.hold('layout.frameFile');
    show();
    await waitFor(() => expect(main.callsOf('layout.frameFile')).toHaveLength(1));
    changed(main);
    await waitFor(() => expect(main.callsOf('files.read')).toHaveLength(2));
    await waitFor(() => expect(entry()!.pending).toBe(0));
    await settle();
    expect(main.callsOf('layout.frameFile')).toHaveLength(1);
    const second = main.hold('layout.frameFile');
    first.release();
    await waitFor(() => expect(main.callsOf('layout.frameFile')).toHaveLength(2));
    expect(entry()!.frame).toMatchObject({ status: 'asking', shown: { token: main.issued[0] } });
    expect(main.released()).toEqual([]);
    second.release();
    await waitFor(() => expect(entry()!.frame).toMatchObject({ status: 'ready', token: main.issued[1] }));
    await waitFor(() => expect(main.released()).toEqual([main.issued[0]]));
    await settle();
    expect(main.callsOf('layout.frameFile')).toHaveLength(2);
  });

  // Sequence 3: the swap.
  it('the frame drawn stays until the new token is ready, and the old one is released after', async () => {
    const main = installDisk({ [PDF]: '%PDF-1.4 invented\n' });
    offs.push(connectCodeEvents());
    show();
    await waitFor(() => expect(frameSrc()).toBe(`${frameUrl(main.issued[0]!, 'ledger.pdf')}#navpanes=0`));
    // what the store shows when it releases a token
    const invoke = main.bridge.invoke.bind(main.bridge);
    const drawnAtRelease: (string | null)[] = [];
    (main.bridge as { invoke: typeof invoke }).invoke = ((name, input, ...rest) => {
      if (name === 'layout.releaseFrame') drawnAtRelease.push(tokenOf());
      return invoke(name, input, ...rest);
    }) as typeof invoke;
    const next = main.hold('layout.frameFile');
    changed(main);
    await waitFor(() => expect(main.callsOf('layout.frameFile')).toHaveLength(2));
    expect(frameSrc()).toBe(`${frameUrl(main.issued[0]!, 'ledger.pdf')}#navpanes=0`);
    expect(main.released()).toEqual([]);
    next.release();
    await waitFor(() => expect(frameSrc()).toBe(`${frameUrl(main.issued[1]!, 'ledger.pdf')}#navpanes=0`));
    await waitFor(() => expect(main.released()).toEqual([main.issued[0]]));
    expect(drawnAtRelease).toEqual([main.issued[1]]);
    expect(document.querySelector('[data-updated]')?.textContent).toBe('Updated');
  });
});

describe('open file', () => {
  beforeEach(() => useLayout.setState({ main: LAYOUT_DEFAULTS.main, hydrated: true }));

  it('normalises a path lexically before opening its tab', () => {
    expect(normalizeLexically('/r/src/../README.md')).toBe('/r/README.md');
    expect(normalizeLexically('/r//a/./b/')).toBe('/r/a/b');
    expect(normalizeLexically('/../etc')).toBe('/etc');
    expect(normalizeLexically('a/../../b')).toBe('../b');
  });

  // UX wave U6b-1: a plain click opens it beside that session's chat (files/tabs.test.tsx); a ⌘-click in the main area
  it("codeTranscriptActions.openFile opens the file for the focused pane's session, a ⌘-click as a main tab", () => {
    useLayout.getState().openTab({ kind: 'session', appSessionId: B });
    codeTranscriptActions.openFile('/w/x.ts', 7, undefined, { main: true });
    expect(currentSet(useLayout.getState().main).panes[0].tabs.find((t) => t.kind === 'file')).toMatchObject({ path: '/w/x.ts', line: 7, appSessionId: B });
  });

  it("finds a turn's session by its transcript key, a child agent's key naming the session before its ':'", () => {
    const turn = 'turn-1' as TurnId;
    const holding = (key: string) =>
      useTranscriptStore.setState({ entries: { [key]: { state: { turns: new Map([[turn, {}]]) } } as unknown as TranscriptEntry } });
    useSessions.setState({ records: new Map([[A, record(A)]]) });
    holding(`${A}:agent-1`);
    expect(sessionOfTurn(turn)).toBe(A);
    holding(A);
    expect(sessionOfTurn(turn)).toBe(A);
    holding(`${A}x`); // no ':': no shorter key is tried
    expect(sessionOfTurn(turn)).toBeNull();
    useTranscriptStore.setState({ entries: {} });
  });
});
