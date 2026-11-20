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
import { FILES_MOVED, FILES_READ_DEFAULT_LENGTH } from '@shared/ipc/schema/files';
import { LAYOUT_DEFAULTS, type TabRef } from '@shared/ipc/schema/layout';
import { addressOf, bareOf, machineOf } from '@shared/machine/address';
import { failureWords } from '@shared/ipc/remote-unavailable'; // UX wave U6f
import { resetRemoteLaneBStore } from '../../../lane-b/remote-session'; // UX wave U6f
import { recordArtifactMachine, resetArtifactMachines } from '../../../artifacts/machines'; // UX wave U6b-4b, the branch review
import { forgetOpenedThere, openedThere } from '../files/elsewhere'; // UX wave U6f
import { chooserCalls, createRemoteChooser, forgetStarts } from '../files/remote-chooser'; // UX wave U6f
import { record } from '../../../../../../test/support/builders';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../../../test/support/machine';
import { connectCodeEvents } from '../../../ipc/events';
import { useLayout } from '../../../stores/layout';
import { useSessions } from '../../../stores/sessions';
import type { TranscriptEntry } from '../../../stores/transcript';
import { Markdown, useTranscriptStore, type TurnId } from '../../../transcript';
import { Disclosures, NO_ACTIONS, TranscriptProvider } from '../../../transcript/view/context'; // UX wave U6b-4b
import { deferred, fail, installFakeMain, ok } from '../../../test-support/code';
import { openChosen } from '../files/open-chosen';
import { useFiles } from '../files/store';
import { codeTranscriptActions, normalizeLexically, openFile, sessionOfTurn } from '../open-file';
import { follow, linkedCount, resetFollows } from '../follow'; // UX wave U6b-4c
import { ipc } from '../../../ipc/client'; // UX wave U6b-4c: a follow asked directly, as a page could
import { MarkdownView } from './MarkdownView'; // UX wave U6b-4c
import { FLASH_CLASS } from './CodeView';
import { FileBody, FileViewer } from './FileViewer';
import { fakeHash, frameToken, installDisk, leaveRl2, OUTSIDE_REFUSAL, overRl2, refused, rosterSays, type DiskLink } from '../../../test-support/code-disk';
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
// UX wave U6b-4b (M3): the notice of a file that cannot be read, as a person reads it: its paragraphs in order (the
// sentences, the path, the command's own words), and its cause
const noticeLines = () => [...document.querySelectorAll('[data-refusal] p')].map((p) => p.textContent);
const noticeCause = () => document.querySelector('[data-refusal]')?.getAttribute('data-notice-cause') ?? null;
const THREE_WAYS = "MAWS opens a file from elsewhere when this session's transcript links it, when you choose it with File ▸ Open File…, or when the agent sends it.";
const ASK_AGENT = 'Ask the agent to send the file to see it here.';
// The first notice, as this Mac says it, for `path`
const outsideHere = (path: string) => ['This file is outside the folders this session works in.', THREE_WAYS, ASK_AGENT, path, "path outside the session's directories"];

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

  it('renders a refusal as its notice, in words with the path, and reads no more than once', async () => {
    const main = serve({ '/r/secret': { refusal: "path outside the session's directories" } });
    render(<FileViewer tab={fileTab('/r/secret')} />);
    await screen.findByRole('alert');
    expect(noticeLines()).toEqual(outsideHere('/r/secret')); // UX wave U6b-4b: the notice's words, no longer "Refused: "
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
    await screen.findByRole('alert');
    expect(noticeLines()).toEqual(outsideHere('/r/half.txt'));
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
    await screen.findByRole('alert');
    expect(noticeLines()).toEqual(outsideHere(OUT));
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

  // UX wave U6b-2 at the chain merge (the architect's ruling): the path says where Save writes only for a file whose body
  // can be saved, the code view's text. A file drawn in a frame, or as an image, has no Save, so its path is the plain one;
  // the outside mark stays as it is.
  it('a framed outside file with a pin shows its plain path, its outside mark as it is, and no Save sentence', async () => {
    const PDF_OUT = '/elsewhere/ledger.pdf';
    disk({ [PDF_OUT]: '%PDF-1.4 invented\n' }, { names: [PDF_OUT] });
    show(PDF_OUT);
    await waitFor(() => expect(shown(PDF_OUT)).toMatchObject({ kind: 'frame', named: true, locked: null, pin: PDF_OUT, frame: { status: 'ready' } }));
    expect(lead().textContent).toBe(PDF_OUT);
    expect(lead().getAttribute('data-outside')).toBe('writable');
    expect(lead().getAttribute('title')).toBe(PDF_OUT);
    expect(lead().hasAttribute('aria-description')).toBe(false);
  });

  it('an image outside the folders with a pin shows its plain path and no Save sentence', async () => {
    const PNG_OUT = '/elsewhere/chart.png';
    disk({ [PNG_OUT]: 'invented image bytes' }, { names: [PNG_OUT] });
    show(PNG_OUT);
    await waitFor(() => expect(shown(PNG_OUT)).toMatchObject({ kind: 'image', named: true, locked: null, pin: PNG_OUT }));
    expect(lead().getAttribute('data-outside')).toBe('writable');
    expect(lead().getAttribute('title')).toBe(PNG_OUT);
    expect(lead().hasAttribute('aria-description')).toBe(false);
  });

  it('an editable outside file’s path says where Save writes, in its title and its description', async () => {
    disk({ [OUT]: 'one\n' }, { names: [OUT] });
    show();
    await editable();
    expect(lead().getAttribute('data-outside')).toBe('writable');
    expect(lead().getAttribute('title')).toBe(`Save writes to ${OUT}`);
    expect(lead().getAttribute('aria-description')).toBe(`Save writes to ${OUT}`);
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
    await screen.findByRole('alert');
    expect(noticeCause()).toBe('outside'); // UX wave U6b-4b: the notice in place of "Refused: "
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
  // mark reads with `agent`, so its frame is asked with it too, at `frameAsk`; a person's tab asks without it. A named file
  // (outside the folders) is read again when the mark changes (U6e's `readUnderMark`), so its frame is asked again under it.
  it('a tab that holds the agent’s mark asks its frame with agent, and a person’s tab asks without it', async () => {
    const main = installDisk({ [NAMED]: '%PDF-1.4 invented\n' }, { outside: ['/elsewhere'], names: (appSessionId, path) => appSessionId === MAIN_A && path === NAMED });
    act(() => void openFile(A, NAMED, null, { main: true }));
    const { rerender } = render(<FileViewer tab={fileTab(NAMED)} agent />);
    await waitFor(() => expect(entry(NAMED)?.frame?.status).toBe('ready'));
    expect(main.callsOf('files.read')).toEqual([expect.objectContaining({ path: NAMED, named: true, agent: true })]);
    expect(main.callsOf('layout.frameFile')).toEqual([{ appSessionId: MAIN_A, path: NAMED, agent: true }]);
    rerender(<FileViewer tab={fileTab(NAMED)} />); // the person's open removes the mark, and the file is read again under it
    await waitFor(() => expect(main.callsOf('layout.frameFile')).toHaveLength(2));
    expect(main.callsOf('files.read').at(-1)).not.toHaveProperty('agent');
    expect(main.callsOf('layout.frameFile')[1]).toEqual({ appSessionId: MAIN_A, path: NAMED });
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
    render(<FileBody tabId={`artifact:${ID}:1`} appSessionId={null} path="/w/ledger.pdf" readOnly artifact={{ artifactId: ID, machine: TEST_MACHINE, revision: 1 }} />);
    expect((await screen.findByText('PDF files open outside MAWS')).tagName).toBe('P');
    await settle();
    expect(main.callsOf('layout.frameFile')).toEqual([]);
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('an ask that fails makes the entry an error that revisit reads again', async () => {
    let connected = false;
    const main = installDisk({ [PDF]: '%PDF-1.4 invented\n' }, { frames: (_, issue) => (connected ? issue() : fail('layout.frameFile: machine mini is not connected')) });
    show();
    await screen.findByRole('alert');
    expect(noticeLines()).toEqual(['This file could not be opened.', PDF, 'layout.frameFile: machine mini is not connected']); // UX wave U6b-4b
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

  // Ticket 775: an event in the folder (one naming the folder alone, or the file itself) that leaves the file as it was keeps
  // the frame, its token and the page's state; a change of the file asks a new one, as before.
  it('an event that leaves the framed file as it was keeps its frame and token; a change asks a new one', async () => {
    const main = installDisk({ [PDF]: '%PDF-1.4 invented\n' });
    offs.push(connectCodeEvents());
    show();
    await waitFor(() => expect(frameSrc()).toBe(`${frameUrl(main.issued[0]!, 'ledger.pdf')}#navpanes=0`));
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: '/r', kind: 'changed' })); // the folder alone
    await waitFor(() => expect(main.callsOf('files.read')).toHaveLength(2));
    await waitFor(() => expect(entry()!.pending).toBe(0));
    changed(main); // the file itself, its bytes as they were
    await waitFor(() => expect(main.callsOf('files.read')).toHaveLength(3));
    await waitFor(() => expect(entry()!.pending).toBe(0));
    await settle();
    expect(main.callsOf('layout.frameFile')).toHaveLength(1);
    expect(entry()!.frame).toMatchObject({ status: 'ready', token: main.issued[0] });
    expect(frameSrc()).toBe(`${frameUrl(main.issued[0]!, 'ledger.pdf')}#navpanes=0`);
    expect(main.released()).toEqual([]);
    expect(document.querySelector('[data-updated]')).toBeNull();
    main.files[PDF] = '%PDF-1.4 invented, revised\n';
    changed(main);
    await waitFor(() => expect(frameSrc()).toBe(`${frameUrl(main.issued[1]!, 'ledger.pdf')}#navpanes=0`));
    await waitFor(() => expect(main.released()).toEqual([main.issued[0]]));
  });

  it('frameFailed for a token the entry no longer holds changes nothing', async () => {
    const main = installDisk({ [PDF]: '%PDF-1.4 invented\n' });
    offs.push(connectCodeEvents());
    show();
    await waitFor(() => expect(entry()?.frame?.status).toBe('ready'));
    main.files[PDF] = '%PDF-1.4 invented, revised\n'; // ticket 775: a change of the file asks a new token
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
    main.files[PDF] = '%PDF-1.4 invented, revised\n'; // ticket 775: a change of the file
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
    main.files[PDF] = '%PDF-1.4 invented, revised\n'; // ticket 775: a change of the file
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

// ---- UX wave U6f (docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, M4; §E; decisions 11 to
// 14 and 18; sequences W1 to W3, R7 and R9) ----------------------------------------------------------------------------
// A session main runs on another machine over RL2 (studio, for which the person is one of the owners unless a case says
// otherwise). The fake main stands for main's adapter: it answers a keyed read of an outside file as the act there does
// (`named` and `outside`), and, where a case gives `answers`, in UC-7's words with `issues.refusal`.
describe('a file outside the folders on another machine (U6f)', () => {
  const THERE = 'app-there';
  const T = addressOf(OTHER_MACHINE, THERE as AppSessionId);
  const P = addressOf('ThirdMachineRef0000000' as typeof OTHER_MACHINE, 'app-profile' as AppSessionId); // another profile of this Mac: no RL2 roster entry, its sessions take the manager's path
  const TERMINAL = addressOf(OTHER_MACHINE, 'app-terminal' as AppSessionId);
  const OUT = '/elsewhere/notes.txt';
  const REAL = '/elsewhere/real/notes.txt';
  const PRIVATE = '/elsewhere/Documents';
  const INSIDE = `${PRIVATE}/rota.txt`;
  const offs: (() => void)[] = [];
  beforeAll(() => import('./CodeView'));
  beforeEach(() => {
    useViewer.getState().reset();
    useFiles.getState().reset();
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, hydrated: true });
    resetRemoteLaneBStore();
    forgetOpenedThere();
    forgetStarts();
    overRl2(T);
  });
  afterEach(() => {
    document.querySelectorAll('[data-remote-chooser]').forEach((sheet) => fireEvent.click(within(sheet as HTMLElement).getByRole('button', { name: 'Cancel' })));
    cleanup();
    offs.splice(0).forEach((off) => off());
    leaveRl2();
  });

  const tab = (path: string, appSessionId: AppSessionId = T): Extract<TabRef, { kind: 'file' }> => ({ id: `file:${machineOf(appSessionId)}:${path}`, kind: 'file', path, line: null, appSessionId, machine: machineOf(appSessionId), pinned: false });
  const shown = (path = OUT, appSessionId: AppSessionId = T) => useViewer.getState().entries.get(tab(path, appSessionId).id)!;
  const view = () => EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;
  const typed = (text: string) => act(() => view().dispatch({ changes: { from: 0, insert: text }, userEvent: 'input.type', annotations: isolateHistory.of('full') }));
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  const lead = () => document.querySelector<HTMLElement>('[data-path-lead]')!;
  const label = () => document.querySelector<HTMLElement>('[data-read-only]');
  const body = () => document.querySelector<HTMLElement>('[data-refusal]');
  const saveFailure = () => document.querySelector<HTMLElement>('span[role="alert"]')?.textContent ?? null; // the bar's line below the path
  const reads = (main: { callsOf: ReturnType<typeof installDisk>['callsOf'] }) => main.callsOf('files.read');
  // The disk as studio's daemon answers it for an owner: `/elsewhere` outside the session's folders, and what admits a file
  // there for the session (a counted name, an added record).
  function disk(files: Record<string, string>, how: { names?: readonly string[]; added?: readonly string[] } = {}) {
    const names = new Set(how.names ?? []);
    const served = installDisk(files, { outside: ['/elsewhere'], names: (appSessionId, path) => appSessionId === THERE && names.has(path), added: how.added });
    offs.push(connectCodeEvents()); // main's pushed events into the stores, once the bridge is installed
    return served;
  }
  const show = (path = OUT, appSessionId: AppSessionId = T, agent = false) => {
    act(() => void openFile(appSessionId, path, null, { main: true }));
    return render(<FileViewer tab={tab(path, appSessionId)} agent={agent} />);
  };
  const editable = async (path = OUT) => {
    await waitFor(() => expect(shown(path)).toMatchObject({ status: 'ready', editable: true }));
    await waitFor(() => expect(view().state.facet(EditorView.editable)).toBe(true));
  };
  const protectedThere = 'This file is in a folder macOS protects on studio. Opening it may show a privacy prompt on studio’s own screen.';
  const protectedThrough = 'This path goes through a link into another folder macOS protects on studio. Choose the file with Open File… to open it.';
  // studio's answer to a read inside a private folder that did not carry `open`, as main's adapter words it
  const asksOpen = (only: (input: Record<string, unknown>) => boolean = () => true) => (name: string, input: Record<string, unknown>) =>
    name === 'files.read' && input.open !== true && (input.path as string).startsWith(`${PRIVATE}/`) && only(input) ? refused('Not opened: the file is in a folder macOS protects on studio', 'protected') : null;

  it('every read carries named (and agent with the agent’s mark); an entry with a pin saves by one files.writeOutside, never files.write; its path says where Save writes on studio, with no label', async () => {
    const main = disk({ [OUT]: 'one\n' }, { names: [OUT] });
    main.reals[OUT] = REAL;
    show();
    await editable();
    expect(reads(main).length).toBeGreaterThan(0);
    expect(reads(main).every((input) => input.named === true && !('open' in input) && !('agent' in input))).toBe(true);
    expect(shown()).toMatchObject({ named: true, locked: null, pin: REAL });
    expect(label()).toBeNull();
    expect(lead().getAttribute('data-outside')).toBe('writable');
    expect(lead().getAttribute('title')).toBe(`Save writes to ${REAL} on studio`);
    expect(lead().getAttribute('aria-description')).toBe(`Save writes to ${REAL} on studio`);
    typed('two ');
    await waitFor(() => expect(shown().dirty).toBe(true));
    await settle();
    expect(main.callsOf('files.writeOutside')).toEqual([]); // typing sends no save
    expect(await act(() => useViewer.getState().save(shown().tabId))).toBe('ok');
    expect(main.callsOf('files.writeOutside')).toEqual([{ appSessionId: THERE, path: OUT, content: 'two one\n', expectedHash: fakeHash('one\n'), real: REAL }]);
    expect(main.callsOf('files.write')).toEqual([]);
    cleanup();
    useViewer.getState().reset();
    main.calls.splice(0);
    show(OUT, T, true);
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready' }));
    expect(reads(main).every((input) => input.named === true && input.agent === true)).toBe(true);
  });

  it('a file inside the session’s folders there is read with named and answered unmarked; its save is files.write, as today', async () => {
    const main = disk({ '/r/a.ts': 'inside\n' });
    show('/r/a.ts');
    await editable('/r/a.ts');
    expect(reads(main).every((input) => input.named === true)).toBe(true);
    expect(shown('/r/a.ts')).toMatchObject({ named: false, pin: null });
    expect(lead().getAttribute('title')).toBe('/r/a.ts');
    typed('+');
    await waitFor(() => expect(shown('/r/a.ts').dirty).toBe(true));
    expect(await act(() => useViewer.getState().save(shown('/r/a.ts').tabId))).toBe('ok');
    expect(main.callsOf('files.write')).toEqual([{ appSessionId: THERE, path: '/r/a.ts', content: '+inside\n', expectedHash: fakeHash('inside\n') }]);
    expect(main.callsOf('files.writeOutside')).toEqual([]);
  });

  // Decision 11's two kinds (Decision Log 25: the property the renderer guard's old entry held, in a test of its own)
  it.each([
    ['a session of another profile of this Mac', P, () => {}],
    ['a terminal session on another machine', TERMINAL, () => overRl2(TERMINAL, {}, 'A')],
  ] as const)('%s is read without named, agent or open and never answered outside; its save is files.write', async (_, session, arrange) => {
    arrange();
    const main = disk({ '/r/a.ts': 'theirs\n', [OUT]: 'outside\n' }, { names: [OUT] });
    openedThere(OTHER_MACHINE).add('/r');
    show('/r/a.ts', session, true);
    await waitFor(() => expect(shown('/r/a.ts', session)).toMatchObject({ status: 'ready', editable: true }));
    await waitFor(() => expect(view().state.facet(EditorView.editable)).toBe(true));
    typed('+');
    await waitFor(() => expect(shown('/r/a.ts', session).dirty).toBe(true));
    expect(await act(() => useViewer.getState().save(shown('/r/a.ts', session).tabId))).toBe('ok');
    cleanup();
    show(OUT, session);
    await waitFor(() => expect(shown(OUT, session).status).toBe('error'));
    expect(reads(main).length).toBeGreaterThan(0);
    expect(reads(main).every((input) => !('named' in input) && !('agent' in input) && !('open' in input))).toBe(true);
    expect(shown('/r/a.ts', session)).toMatchObject({ named: false, pin: null, locked: null });
    expect(shown(OUT, session)).toMatchObject({ named: false, pin: null, error: OUTSIDE_REFUSAL });
    expect(main.callsOf('files.write')).toEqual([{ appSessionId: bareOf(session), path: '/r/a.ts', content: '+theirs\n', expectedHash: fakeHash('theirs\n') }]);
    expect(main.callsOf('files.writeOutside')).toEqual([]);
  });

  it('a read’s failure that carries issues.refusal is drawn as its message alone, nothing of the file shown; one that carries none as its notice (UX wave U6b-4b)', async () => {
    const main = disk({ [OUT]: 'secret\n' }, { names: [OUT] });
    main.answers.by = (name, input) => (name === 'files.read' && input.path === OUT ? refused('Not opened: only studio’s owners can', 'owners-only') : null);
    show();
    await waitFor(() => expect(body()).not.toBeNull());
    expect(body()!.querySelector('p')!.textContent).toBe('Not opened: only studio’s owners can');
    expect(shown()).toMatchObject({ said: true, kind: null, text: '' });
    expect(document.body.textContent).not.toContain('secret');
    cleanup();
    main.answers.by = () => null;
    show('/elsewhere/unnamed.txt');
    await waitFor(() => expect(body()).not.toBeNull());
    // UX wave U6b-4b: the plain read's refusal there: the path is outside the folders on studio; the three ways are not said,
    // since studio's daemon did not run the open itself
    expect(noticeLines()).toEqual(['This file is outside the folders this session works in on studio.', ASK_AGENT, '/elsewhere/unnamed.txt', OUTSIDE_REFUSAL]);
    expect(shown('/elsewhere/unnamed.txt').said).toBe(false);
  });

  it('a read that answers that the path moved (a claimed read’s FILES_MOVED) is drawn as a failed read', async () => {
    const main = disk({ [OUT]: 'one\n' }, { names: [OUT] });
    main.answers.by = (name) => (name === 'files.read' ? fail(failureWords('files.readOutside', FILES_MOVED)) : null);
    show();
    await waitFor(() => expect(body()).not.toBeNull());
    expect(body()!.querySelector('p')!.textContent).toBe('This file could not be opened.'); // UX wave U6b-4b: the act ran and failed otherwise
    expect(body()!.querySelector('[data-notice-detail]')!.textContent).toBe(`Not opened: ${FILES_MOVED}`);
    expect(shown()).toMatchObject({ status: 'error', kind: null, editable: false });
  });

  describe('“Read-only” (decision 12’s third column)', () => {
    it('an added file whose standing has a sentence reads elsewhere: its panel holds the sentence and no Open File…', async () => {
      disk({ [OUT]: 'added\n' }, { added: [OUT] });
      rosterSays(T, { owner: false });
      show();
      await waitFor(() => expect(label()).not.toBeNull());
      expect(readOnlyReason(shown())).toBe('elsewhere');
      expect(label()!.getAttribute('data-read-only')).toBe('elsewhere');
      expect(label()!.getAttribute('aria-description')).toBe('Read-only: Only studio’s owners can save this file there.');
      fireEvent.click(label()!);
      const panel = await waitFor(() => document.querySelector<HTMLElement>('[data-read-only-panel]')!);
      expect(panel.textContent).toBe('Read-only: Only studio’s owners can save this file there.');
      expect(within(panel).queryByRole('button')).toBeNull();
      expect(document.querySelector('.cm-content')?.getAttribute('title')).toBe('Read-only: Only studio’s owners can save this file there.');
    });

    it('with no sentence it reads added, and the panel’s Open File… opens the chooser on that machine', async () => {
      const main = disk({ [OUT]: 'added\n' }, { added: [OUT] });
      show();
      await waitFor(() => expect(label()).not.toBeNull());
      expect(readOnlyReason(shown())).toBe('added');
      fireEvent.click(label()!);
      const panel = await waitFor(() => document.querySelector<HTMLElement>('[data-read-only-panel]')!);
      fireEvent.click(within(panel).getByRole('button', { name: 'Open File…' }));
      await waitFor(() => expect(document.querySelector('[data-remote-chooser]')).not.toBeNull());
      expect(main.callsOf('layout.openFile')).toEqual([]);
      expect(main.callsOf('files.listOutside')).toEqual([{ appSessionId: THERE }]);
    });

    it('W1: an edited outside file whose read answers the ownership refusal keeps its document, stops being editable with the sentence, and Save sends nothing', async () => {
      const main = disk({ [OUT]: 'one\n' }, { names: [OUT] });
      show();
      await editable();
      typed('mine ');
      await waitFor(() => expect(shown().dirty).toBe(true));
      rosterSays(T, { owner: false });
      main.answers.by = (name) => (name === 'files.read' ? refused('Not opened: only studio’s owners can', 'owners-only') : null);
      act(() => main.emit('files.changed', { appSessionId: THERE as AppSessionId, path: OUT, kind: 'changed' }, OTHER_MACHINE)); // from studio, its bare id lifted with it
      await waitFor(() => expect(shown().status).toBe('error'));
      expect(shown()).toMatchObject({ dirty: true, editable: false, pin: OUT });
      expect(readOnlyReason(shown())).toBe('elsewhere');
      expect(existingViewState(shown().tabId)?.docOf?.()).toBe('mine one\n');
      expect(label()!.getAttribute('aria-description')).toBe('Read-only: Only studio’s owners can save this file there.');
      await act(() => useViewer.getState().save(shown().tabId));
      expect(saveFailure()).toBe('Not saved: only studio’s owners can'); // UC-7's sentence, said once (Decision Log 30 d)
      expect(main.callsOf('files.writeOutside')).toEqual([]);
      expect(main.callsOf('files.write')).toEqual([]);
    });

    it('R9: studio replaced by an older build under unsaved edits: the standing’s update sentence is the title, Save sends nothing and no files.write', async () => {
      const main = disk({ [OUT]: 'one\n' }, { names: [OUT] });
      show();
      await editable();
      typed('mine ');
      await waitFor(() => expect(shown().dirty).toBe(true));
      act(() => rosterSays(T, { capabilities: ['rl2.channel'] }));
      await waitFor(() => expect(label()?.getAttribute('data-read-only')).toBe('elsewhere'));
      expect(label()!.getAttribute('aria-description')).toBe('Read-only: Can’t save this file on studio yet. Update MAWS on studio and try again.');
      // Fix wave (review finding 7; decision 14, B9): Save answers the refusal as the save's failure, nothing sent
      await act(() => useViewer.getState().save(shown().tabId));
      expect(saveFailure()).toBe('Not saved: update MAWS on studio and try again');
      expect(shown()).toMatchObject({ dirty: true, saving: false });
      expect(main.callsOf('files.writeOutside')).toEqual([]);
      expect(main.callsOf('files.write')).toEqual([]);
    });

    it('offline, the edited document stays savable: its save waits for the machine, as decision 14 says', async () => {
      const main = disk({ [OUT]: 'one\n' }, { names: [OUT] });
      show();
      await editable();
      typed('mine ');
      await waitFor(() => expect(shown().dirty).toBe(true));
      act(() => rosterSays(T, { state: 'down', since: '2026-01-01T00:00:00.000Z', capabilities: undefined }));
      expect(readOnlyReason(shown())).toBeNull();
      expect(await act(() => useViewer.getState().save(shown().tabId))).toBe('ok');
      expect(main.callsOf('files.writeOutside')).toHaveLength(1);
    });

    // Fix wave (review finding 2): waiting offline is the owners'; a person known not to own the machine sends nothing
    it('offline, an edited file of a person who does not own the machine sends no save and says why', async () => {
      const main = disk({ [OUT]: 'one\n' }, { names: [OUT] });
      show();
      await editable();
      typed('mine ');
      await waitFor(() => expect(shown().dirty).toBe(true));
      act(() => rosterSays(T, { state: 'down', since: '2026-01-01T00:00:00.000Z', capabilities: undefined, owner: false }));
      expect(readOnlyReason(shown())).toBe('elsewhere');
      await act(() => useViewer.getState().save(shown().tabId));
      expect(saveFailure()).toBe('Not saved: only studio’s owners can');
      expect(main.callsOf('files.writeOutside')).toEqual([]);
      expect(main.callsOf('files.write')).toEqual([]);
    });

    // Decision Log 30 (d): the failure of a save the machine could not be reached for, as the bar draws it
    it('a save that fails with studio offline reads exactly the refusal’s sentence, said once', async () => {
      const main = disk({ [OUT]: 'one\n' }, { names: [OUT] });
      show();
      await editable();
      typed('mine ');
      await waitFor(() => expect(shown().dirty).toBe(true));
      act(() => rosterSays(T, { state: 'down', since: '2026-01-01T00:00:00.000Z', capabilities: undefined }));
      main.answers.by = (name) => (name === 'files.writeOutside' ? refused('Not saved: studio is offline', 'offline') : null);
      expect(await act(() => useViewer.getState().save(shown().tabId))).toBe('error');
      expect(saveFailure()).toBe('Not saved: studio is offline');
      expect(main.files[OUT]).toBe('one\n');
    });
  });

  it('R7: a save the service refuses there is worded as U6e’s, with the way on', async () => {
    const main = disk({ [OUT]: 'one\n' }, { names: [OUT] });
    show();
    await editable();
    typed('mine ');
    await waitFor(() => expect(shown().dirty).toBe(true));
    main.answers.by = (name) => (name === 'files.writeOutside' ? fail(failureWords('files.writeOutside', OUTSIDE_REFUSAL)) : null);
    expect(await act(() => useViewer.getState().save(shown().tabId))).toBe('error');
    expect(shown().saveError).toBe('MAWS may no longer write this file for this session. Choose it with File ▸ Open File… to save it');
    expect(saveFailure()).toBe('Could not save: MAWS may no longer write this file for this session. Choose it with File ▸ Open File… to save it'); // no sentence of UC-7: U6e's prefix
    expect(main.files[OUT]).toBe('one\n');
  });

  describe('a private folder there (decision 18; W3)', () => {
    it('shows the sentence and Open it with no document; the press sends one read with open, and every later read and save of that entry carries it', async () => {
      const main = disk({ [INSIDE]: 'rota\n' }, { names: [INSIDE] });
      main.answers.by = asksOpen();
      show(INSIDE);
      await waitFor(() => expect(body()).not.toBeNull());
      expect(body()!.querySelector('p')!.textContent).toBe(protectedThere);
      expect(shown(INSIDE)).toMatchObject({ needsOpen: true, said: true, kind: null, text: '' });
      expect(reads(main).every((input) => !('open' in input))).toBe(true);
      const before = reads(main).length;
      fireEvent.click(within(body()!).getByRole('button', { name: 'Open it' }));
      fireEvent.click(within(body()!).getByRole('button', { name: 'Open it' })); // a second press while it reads sends nothing more
      await editable(INSIDE);
      expect(reads(main).slice(before)).toEqual([{ appSessionId: THERE, path: INSIDE, offset: 0, length: FILES_READ_DEFAULT_LENGTH, hash: true, named: true, open: true }]);
      expect(openedThere(OTHER_MACHINE).has(INSIDE)).toBe(true);
      typed('+');
      await waitFor(() => expect(shown(INSIDE).dirty).toBe(true));
      expect(await act(() => useViewer.getState().save(shown(INSIDE).tabId))).toBe('ok');
      expect(main.callsOf('files.writeOutside')).toEqual([{ appSessionId: THERE, path: INSIDE, content: '+rota\n', expectedHash: fakeHash('rota\n'), real: INSIDE, open: true }]);
      const sent = reads(main).length;
      act(() => main.emit('files.changed', { appSessionId: THERE as AppSessionId, path: INSIDE, kind: 'changed' }, OTHER_MACHINE));
      await waitFor(() => expect(reads(main).length).toBeGreaterThan(sent)); // the change is read again
      await settle();
      expect(reads(main).slice(before).every((input) => input.open === true)).toBe(true);
    });

    it('a path under a folder confirmed in the chooser carries open from its first read; an entry never opened so carries none', async () => {
      const main = disk({ [INSIDE]: 'rota\n', [OUT]: 'notes\n' }, { names: [INSIDE, OUT] });
      main.answers.by = asksOpen();
      openedThere(OTHER_MACHINE).add(PRIVATE);
      show(INSIDE);
      await editable(INSIDE);
      expect(reads(main).every((input) => input.open === true)).toBe(true);
      cleanup();
      main.calls.splice(0);
      show(OUT);
      await editable(OUT);
      expect(reads(main).every((input) => !('open' in input))).toBe(true);
    });

    it('a read that carried open and answers protected again draws the second sentence with Open File… and no Open it (Decision Log 20)', async () => {
      const main = disk({ [INSIDE]: 'rota\n' }, { names: [INSIDE] });
      main.answers.by = (name, input) => (name === 'files.read' && input.path === INSIDE ? refused('Not opened: the file is in a folder macOS protects on studio', 'protected') : null);
      show(INSIDE);
      await waitFor(() => expect(within(body()!).queryByRole('button', { name: 'Open it' })).not.toBeNull());
      fireEvent.click(within(body()!).getByRole('button', { name: 'Open it' }));
      await waitFor(() => expect(body()!.querySelector('p')!.textContent).toBe(protectedThrough));
      expect(within(body()!).queryByRole('button', { name: 'Open it' })).toBeNull();
      expect(shown(INSIDE)).toMatchObject({ needsOpen: false });
      fireEvent.click(within(body()!).getByRole('button', { name: 'Open File…' }));
      await waitFor(() => expect(document.querySelector('[data-remote-chooser]')).not.toBeNull());
      expect(main.callsOf('layout.openFile')).toEqual([]);
    });

    // Decision Log 30 (c) as built (a): main's projection keeps no field of a refusal but its word, so Open it remembers the file
    it('Open it remembers the file: its reads carry open after, and another file in that folder still asks', async () => {
      const OTHER_INSIDE = `${PRIVATE}/minutes.txt`;
      const main = disk({ [INSIDE]: 'rota\n', [OTHER_INSIDE]: 'minutes\n' }, { names: [INSIDE, OTHER_INSIDE] });
      main.answers.by = asksOpen();
      show(INSIDE);
      await waitFor(() => expect(within(body()!).queryByRole('button', { name: 'Open it' })).not.toBeNull());
      fireEvent.click(within(body()!).getByRole('button', { name: 'Open it' }));
      await editable(INSIDE);
      expect(openedThere(OTHER_MACHINE).has(INSIDE)).toBe(true); // the control
      cleanup();
      main.calls.splice(0);
      show(OTHER_INSIDE);
      await waitFor(() => expect(within(body()!).queryByRole('button', { name: 'Open it' })).not.toBeNull());
      expect(reads(main).every((input) => !('open' in input))).toBe(true);
    });

    // Fix wave (review finding 6): the second sentence follows what the request carried, not what is known when it answers
    it('a read sent with no open, its folder confirmed while it is out, answers protected with the first sentence and Open it', async () => {
      const main = disk({ [INSIDE]: 'rota\n' }, { names: [INSIDE] });
      main.answers.by = asksOpen();
      const gate = main.hold('files.read');
      show(INSIDE);
      await waitFor(() => expect(reads(main)).toHaveLength(1));
      expect(reads(main)[0]).not.toHaveProperty('open');
      openedThere(OTHER_MACHINE).add(PRIVATE); // the chooser's confirmation lands meanwhile
      gate.release();
      await waitFor(() => expect(body()).not.toBeNull());
      expect(body()!.querySelector('p')!.textContent).toBe(protectedThere);
      expect(within(body()!).getByRole('button', { name: 'Open it' })).toBeTruthy();
      expect(shown(INSIDE)).toMatchObject({ needsOpen: true, offersOpenFile: false });
    });

    // Fix wave (review finding 3): a link into a private folder chosen in the chooser, followed through the tab's first read
    it('a file chosen through a link into a private folder opens with open on its first read, and asks nothing', async () => {
      const GRANTED = `${PRIVATE}/rota.txt`;
      const main = disk({ [GRANTED]: 'rota\n' }, { names: [GRANTED] });
      const asks = asksOpen();
      main.answers.by = (name, input) => {
        if (name === 'files.listOutside') return { ok: true, value: { status: 'listed', path: '/home/someone', parent: '/home', home: '/home/someone', entries: [{ name: 'latest', path: '/home/someone/latest', kind: 'link', protected: false }], cursor: null } };
        if (name === 'files.chooseOutside') return input.open === true ? { ok: true, value: { status: 'granted', path: GRANTED } } : { ok: true, value: { status: 'refused', reason: 'protected' } };
        return asks(name, input);
      };
      const chooser = createRemoteChooser(T, { ...chooserCalls(), machine: () => 'studio', startAt: null });
      await waitFor(() => expect(chooser.state().at).toBe('listed'));
      chooser.select('/home/someone/latest');
      const chosen = chooser.choose();
      await waitFor(() => expect(chooser.state().at).toBe('asking'));
      chooser.confirm();
      expect(await chosen).toBe(GRANTED);
      show(GRANTED);
      await editable(GRANTED);
      expect(reads(main).length).toBeGreaterThan(0);
      expect(reads(main).every((input) => input.open === true)).toBe(true);
      expect(body()).toBeNull();
    });

    it('W3: an answer for a tab closed meanwhile lands nowhere; a failure of the press leaves the sentence and the button', async () => {
      const main = disk({ [INSIDE]: 'rota\n' }, { names: [INSIDE] });
      main.answers.by = asksOpen();
      show(INSIDE);
      await waitFor(() => expect(within(body()!).queryByRole('button', { name: 'Open it' })).not.toBeNull());
      main.answers.by = (name, input) => (name === 'files.read' && input.open === true ? { ok: false, error: { code: 'host_unavailable', message: 'files.read: machine studio is not reachable' } } : asksOpen()(name, input));
      fireEvent.click(within(body()!).getByRole('button', { name: 'Open it' }));
      await settle();
      expect(body()!.querySelector('p')!.textContent).toBe(protectedThere);
      expect(within(body()!).getByRole('button', { name: 'Open it' })).toBeTruthy();
      main.answers.by = asksOpen();
      const gate = main.hold('files.read');
      fireEvent.click(within(body()!).getByRole('button', { name: 'Open it' }));
      await waitFor(() => expect(reads(main).at(-1)).toMatchObject({ open: true }));
      cleanup();
      act(() => useLayout.setState({ main: LAYOUT_DEFAULTS.main })); // the tab closed
      act(() => useViewer.getState().prune());
      gate.release();
      await settle();
      expect(useViewer.getState().entries.has(tab(INSIDE).id)).toBe(false);
    });

    it('a framed file there asks layout.frameFile with the tab’s agent, and with open only for an entry in openedThere (Decision Log 26)', async () => {
      const PDF = '/elsewhere/ledger.pdf';
      const PRIVATE_PDF = `${PRIVATE}/minutes.pdf`;
      const main = disk({ [PDF]: '%PDF-1.4 invented\n', [PRIVATE_PDF]: '%PDF-1.4 invented\n' }, { names: [PDF, PRIVATE_PDF] });
      main.answers.by = asksOpen();
      show(PDF, T, true);
      await waitFor(() => expect(shown(PDF).frame?.status).toBe('ready'));
      expect(main.callsOf('layout.frameFile')).toEqual([{ appSessionId: THERE, path: PDF, agent: true }]);
      cleanup();
      show(PRIVATE_PDF);
      await waitFor(() => expect(within(body()!).queryByRole('button', { name: 'Open it' })).not.toBeNull());
      expect(main.callsOf('layout.frameFile')).toHaveLength(1);
      fireEvent.click(within(body()!).getByRole('button', { name: 'Open it' }));
      await waitFor(() => expect(shown(PRIVATE_PDF).frame?.status).toBe('ready'));
      expect(main.callsOf('layout.frameFile')[1]).toEqual({ appSessionId: THERE, path: PRIVATE_PDF, open: true });
    });
  });

  it('W2: a tab shown again, remounted or restored reads as U6c has it, the same reads a named file of this Mac sends', async () => {
    const count = async (session: AppSessionId) => {
      useViewer.getState().reset();
      const named = (appSessionId: string, path: string) => path === OUT && (appSessionId === THERE || appSessionId === MAIN_A);
      const served = installDisk({ [OUT]: 'one\n' }, { outside: ['/elsewhere'], names: named });
      const first = show(OUT, session);
      await waitFor(() => expect(shown(OUT, session).status).toBe('ready'));
      first.unmount();
      const second = render(<FileViewer tab={tab(OUT, session)} />); // remounted: shown again
      await settle();
      second.unmount();
      useViewer.getState().reset(); // a relaunch: the store holds nothing, the tab is restored
      render(<FileViewer tab={tab(OUT, session)} />);
      await waitFor(() => expect(shown(OUT, session).status).toBe('ready'));
      await settle();
      cleanup();
      return served.callsOf('files.read').length;
    };
    expect(await count(T)).toBe(await count(A));
  });
});

// UX wave U6b-4b (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md, R2, decision 4, L14): a shown Markdown file
// resolves a relative link against the folder of the path its tab holds. UX wave U6b-4c (Q9) reverses its L14 and N2.3 in
// the window: a link there, or in a subagent's transcript, asks the daemon to follow it first (`files.follow`), and the
// read then asks by name as any chip's does; what the daemon finds is the only evidence the link adds.
describe('a link in a shown Markdown file, and in a subagent’s transcript (U6b-4b)', () => {
  const OUT = '/elsewhere/notes.txt';
  const offs: (() => void)[] = [];
  beforeAll(() => import('./CodeView'));
  beforeEach(() => {
    useViewer.getState().reset();
    useFiles.getState().reset();
    resetFollows(); // UX wave U6b-4c
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, hydrated: true });
    offs.push(registerPanelTool(filesTool));
  });
  afterEach(() => {
    cleanup();
    offs.splice(0).forEach((off) => off());
  });

  // `/elsewhere` is outside the folders; `named` the paths session A's transcript names there; U6b-4c: `links` what the
  // daemon's follow finds
  function disk(files: Record<string, string>, named: string[] = [], links: DiskLink[] = []) {
    const names = new Set(named);
    return { ...installDisk(files, { outside: ['/elsewhere'], names: (appSessionId, path) => appSessionId === MAIN_A && names.has(path), links }), names };
  }
  const sideFiles = () => (useLayout.getState().panelBySession.get(A)?.tabs ?? []).filter((tab) => tab.toolId === 'files').map((tab) => useLayout.getState().panelParams[tab.id]);
  const mainFile = (path: string) => currentSet(useLayout.getState().main).panes.flatMap((pane) => pane.tabs).find((tab): tab is Extract<TabRef, { kind: 'file' }> => tab.kind === 'file' && tab.path === path);
  const asked = (path: string) => ({ appSessionId: MAIN_A, path, offset: 0, length: FILES_READ_DEFAULT_LENGTH, hash: true, named: true });
  const shownFile = (path: string) => {
    act(() => void openFile(A, path, null, { main: true }));
    return render(<FileViewer tab={fileTab(path)} />);
  };

  it('a relative link opens against the shown file’s folder beside the chat, and on ⌘ in the main area (L4)', async () => {
    disk({ '/r/docs/guide.md': '[setup](setup.md) and [the app](../app.ts#L3)', '/r/docs/setup.md': 's\n', '/r/app.ts': 'a\n' });
    shownFile('/r/docs/guide.md');
    const setup = await screen.findByTitle('setup.md');
    act(() => void fireEvent.click(setup));
    expect(sideFiles()).toEqual([{ file: '/r/docs/setup.md', line: null, preview: true }]);
    act(() => void fireEvent.click(screen.getByTitle('../app.ts'), { metaKey: true }));
    expect(mainFile('/r/app.ts')).toMatchObject({ line: 3, appSessionId: A });
  });

  // U6b-4c reverses it in the window (Q9): one follow of exactly that path from the shown file, then the one read
  it('a relative link in a shown file outside the folders follows, then asks for its sibling by name for the tab’s session: one follow and one read of exactly that path, refused where the daemon finds no link (N2.3)', async () => {
    const main = disk({ '/elsewhere/docs/guide.md': '[setup](setup.md)', '/elsewhere/docs/setup.md': 'not named\n' }, ['/elsewhere/docs/guide.md']);
    shownFile('/elsewhere/docs/guide.md');
    const setup = await screen.findByTitle('setup.md');
    act(() => void fireEvent.click(setup, { metaKey: true }));
    const tab = mainFile('/elsewhere/docs/setup.md')!;
    expect(tab).toMatchObject({ appSessionId: A });
    render(<FileViewer tab={tab} />);
    await waitFor(() => expect(noticeLines()).toEqual(outsideHere('/elsewhere/docs/setup.md')));
    expect(main.callsOf('files.follow')).toEqual([{ appSessionId: MAIN_A, path: '/elsewhere/docs/setup.md', from: { file: '/elsewhere/docs/guide.md' } }]);
    expect(main.callsOf('files.read').filter((input) => input.path === '/elsewhere/docs/setup.md')).toEqual([asked('/elsewhere/docs/setup.md')]);
    const order = main.calls.filter((call) => call.input.path === '/elsewhere/docs/setup.md' && call.name !== 'files.watch').map((call) => call.name);
    expect(order).toEqual(['files.follow', 'files.read']);
  });

  // L5 (R2): the window resolves the relative chip against the session's working folder; the transcript wrote the relative
  // string, which names nothing, so the one read for the absolute path is refused
  it('a relative transcript chip that climbs out of the working folder makes one named read of the absolute path for the row’s session, refused (L5)', async () => {
    const main = installDisk({ '/outside/secret.md': 'secret\n' }, { outside: ['/outside'], names: () => false });
    // B's folder is deeper than A's, so a path resolved against B's would be /b/deep/outside/secret.md: only A's gives the one below
    useSessions.setState({ records: new Map([[A, record(A, { directory: '/r/work' })], [B, record(B, { directory: '/b/deep/er/work' })]]) });
    try {
      useLayout.getState().openTab({ kind: 'session', appSessionId: B }); // another session in front
      const row = { storeKey: A, variant: 'session', actions: { ...NO_ACTIONS, openFile: codeTranscriptActions.openFile }, rewind: null, renderRequest: null, disclosures: new Disclosures(), idPrefix: 'row' } as const;
      render(
        <TranscriptProvider value={row}>
          <Markdown markdown="See [x](../../outside/secret.md)." live={false} />
        </TranscriptProvider>,
      );
      const chip = await screen.findByTitle('../../outside/secret.md');
      act(() => void fireEvent.click(chip, { metaKey: true }));
      const tab = mainFile('/outside/secret.md')!;
      expect(tab).toMatchObject({ appSessionId: A });
      render(<FileViewer tab={tab} />);
      await waitFor(() => expect(noticeLines()).toEqual(outsideHere('/outside/secret.md')));
      expect(main.callsOf('files.read')).toEqual([asked('/outside/secret.md')]);
    } finally {
      useSessions.setState({ records: new Map() });
    }
  });

  // U6b-4c reverses it in the window (Q9): each click follows from its own source first, and then reads by name; the
  // subagent's transcript, which the daemon finds holds no such link, admits nothing; the shown file, which does, admits it
  it('a path link in a subagent’s transcript and in a shown Markdown file each follow from their source and then ask by name: refused where the daemon finds no link, opened where it does (L14)', async () => {
    const main = disk({ '/elsewhere/guide.md': `[the notes](${OUT})`, [OUT]: 'the notes\n' }, ['/elsewhere/guide.md'], [{ from: { file: '/elsewhere/guide.md' }, path: OUT }]);
    // a subagent's transcript is keyed `<session>:<agent>`; its rows act on the session (useRowSession), and its mount adds
    // the agent's id to every open (Transcript.tsx, held in Transcript.test.tsx)
    const openFromAgent: typeof codeTranscriptActions.openFile = (path, line, session, options) => codeTranscriptActions.openFile(path, line, session, { ...options, agent: 'agent-1' });
    const subagent = { storeKey: `${A}:agent-1`, variant: 'child', actions: { ...NO_ACTIONS, openFile: openFromAgent }, rewind: null, renderRequest: null, disclosures: new Disclosures(), idPrefix: 'agent' } as const;
    render(
      <TranscriptProvider value={subagent}>
        <Markdown markdown={`Wrote [the notes](${OUT}).`} live={false} />
      </TranscriptProvider>,
    );
    shownFile('/elsewhere/guide.md');
    await waitFor(() => expect(screen.getAllByTitle(OUT)).toHaveLength(2));
    const [inSubagent, inFile] = screen.getAllByTitle(OUT);
    const reads = () => main.callsOf('files.read').filter((input) => input.path === OUT);
    const follows = () => main.callsOf('files.follow');
    act(() => void fireEvent.click(inSubagent, { metaKey: true }));
    render(<FileViewer tab={mainFile(OUT)!} />);
    await waitFor(() => expect(noticeLines()).toEqual(outsideHere(OUT)));
    expect(follows()).toEqual([{ appSessionId: MAIN_A, path: OUT, from: { agent: 'agent-1' } }]);
    expect(reads()).toEqual([asked(OUT)]);
    act(() => void fireEvent.click(inFile, { metaKey: true })); // the same tab, read again after the follow: its last read failed
    await waitFor(() => expect(useViewer.getState().entries.get(FILE(OUT))).toMatchObject({ status: 'ready', text: 'the notes\n', named: true, locked: null }));
    expect(follows()).toEqual([
      { appSessionId: MAIN_A, path: OUT, from: { agent: 'agent-1' } },
      { appSessionId: MAIN_A, path: OUT, from: { file: '/elsewhere/guide.md' } },
    ]);
    expect(reads()).toEqual([asked(OUT), asked(OUT)]);
    expect(mainFile(OUT)).toMatchObject({ appSessionId: A });
  });
});

// ---- UX wave U6b-4c (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4c-markdown-links.md, M4; W1, Interfaces §F) -------
// A click on a link in a shown Markdown file, or on a link or a chip in a subagent's transcript, of a session on this Mac
// asks the daemon to follow it (`files.follow`) before the tab is placed, and the tab's read waits for the follow; a read
// sent before the click that lands refused, or read-only, after a follow that found the link is read once more. The fake
// disk's daemon finds the links each case gives (`links`). Invented paths under `/elsewhere` (outside session A's folders)
// and `/r`, invented text.
describe('a link followed from a shown Markdown file, or from a subagent’s transcript (U6b-4c)', () => {
  const OUT = '/elsewhere/notes.txt';
  const DOC = '/r/docs/guide.md';
  const LINKED = `[the notes](${OUT})`;
  const FROM_DOC = { appSessionId: MAIN_A, path: OUT, from: { file: DOC } };
  const LINKED_ONLY = 'Read-only: the file that links this one is read-only in this conversation. Choose it with File ▸ Open File… to edit it';
  const RESULT_ONLY = 'Read-only: only a tool’s output names this file in this conversation. Choose it with File ▸ Open File… to edit it';
  const REFUSED = 'Could not save: MAWS may no longer write this file for this session. Choose it with File ▸ Open File… to save it';
  const offs: (() => void)[] = [];
  beforeAll(() => import('./CodeView'));
  beforeEach(() => {
    useViewer.getState().reset();
    useFiles.getState().reset();
    resetFollows();
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, hydrated: true });
    offs.push(registerPanelTool(filesTool));
  });
  afterEach(() => {
    cleanup();
    offs.splice(0).forEach((off) => off());
  });

  // `/elsewhere` is outside the folders; what admits a file there for A: a counted name, a result-only name; `links` what
  // the daemon's follow finds
  function disk(files: Record<string, string>, how: { links?: DiskLink[]; names?: string[]; results?: string[]; older?: boolean } = {}) {
    const forA = (paths: string[] = []) => (appSessionId: string, path: string) => appSessionId === MAIN_A && paths.includes(path);
    return installDisk(files, { outside: ['/elsewhere'], names: forA(how.names), results: forA(how.results), links: how.links ?? [{ from: { file: DOC }, path: OUT }], older: how.older });
  }
  const shown = (path = OUT) => useViewer.getState().entries.get(FILE(path));
  const reads = (main: ReturnType<typeof installDisk>, path = OUT) => main.callsOf('files.read').filter((input) => input.path === path);
  const asked = (path: string, extra: Record<string, unknown> = {}) => ({ appSessionId: MAIN_A, path, offset: 0, length: FILES_READ_DEFAULT_LENGTH, hash: true, named: true, ...extra });
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  const view = () => EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;
  const typed = (text: string) => act(() => view().dispatch({ changes: { from: 0, insert: text }, userEvent: 'input.type', annotations: isolateHistory.of('full') }));
  const saveButton = () => screen.queryByRole('button', { name: 'Save' });
  const label = () => document.querySelector<HTMLElement>('[data-read-only]');
  const retryButton = () => document.querySelector<HTMLButtonElement>('[data-notice-retry]');
  const sideFiles = () => (useLayout.getState().panelBySession.get(A)?.tabs ?? []).filter((tab) => tab.toolId === 'files').map((tab) => useLayout.getState().panelParams[tab.id]);
  const mainFile = (path: string) => currentSet(useLayout.getState().main).panes.flatMap((pane) => pane.tabs).find((tab) => tab.kind === 'file' && tab.path === path);
  // A file's main tab and its viewer, as an open from the main area makes them
  const showFile = (path: string, appSessionId: AppSessionId = A) => {
    act(() => void openFile(appSessionId, path, null, { main: true }));
    return render(<FileViewer tab={fileTab(path, null, appSessionId)} />);
  };
  // The shown Markdown file `DOC` and its link to `path`, found before anything else is drawn with that title
  const linkIn = async (path = OUT, doc = DOC) => {
    showFile(doc);
    await waitFor(() => expect(shown(doc)?.status).toBe('ready'));
    return screen.findByTitle(path);
  };
  const click = (chip: HTMLElement, main = true) => act(() => void fireEvent.click(chip, { metaKey: main }));
  // A subagent's chip, as the child's mount opens it (Transcript.tsx gives `agent`)
  const fromAgent = (path: string, agent = 'agent-1') => act(() => codeTranscriptActions.openFile(path, undefined, A, { main: true, agent }));
  const unreachable = () => fail('files.read: no answer within 10 s', 'timeout');

  it('K1: the click follows from the shown file before its one read; the file opens beside the chat, and on ⌘ in the main area editable, with no label, and Save writes it', async () => {
    const main = disk({ [DOC]: `Notes: ${LINKED}`, [OUT]: 'one\n' });
    const chip = await linkIn();
    click(chip, false);
    expect(main.callsOf('files.follow')).toEqual([FROM_DOC]);
    expect(sideFiles()).toEqual([{ file: OUT, line: null, preview: true }]); // nothing of the source on the tab
    await settle(); // that follow answered
    click(chip);
    expect(main.callsOf('files.follow')).toHaveLength(2); // the first had settled, so this is a follow of its own
    render(<FileViewer tab={fileTab(OUT)} />);
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', editable: true, named: true, locked: null, pin: OUT }));
    await waitFor(() => expect(view().state.facet(EditorView.editable)).toBe(true));
    expect(label()).toBeNull();
    expect(reads(main)).toEqual([asked(OUT)]);
    const order = main.calls.filter((call) => call.input.path === OUT && call.name !== 'files.watch').map((call) => call.name);
    expect(order).toEqual(['files.follow', 'files.follow', 'files.read']);
    typed('two ');
    await waitFor(() => expect(shown()!.dirty).toBe(true));
    fireEvent.click(saveButton()!);
    await waitFor(() => expect(main.files[OUT]).toBe('two one\n'));
    expect(main.callsOf('files.writeOutside')).toEqual([{ appSessionId: MAIN_A, path: OUT, content: 'two one\n', expectedHash: fakeHash('one\n'), real: OUT }]);
  });

  it('K1: a PDF linked the same way is drawn in its frame', async () => {
    const PDF = '/elsewhere/ledger.pdf';
    const main = disk({ [DOC]: `[the ledger](${PDF})`, [PDF]: '%PDF-1.4 invented\n' }, { links: [{ from: { file: DOC }, path: PDF }] });
    click(await linkIn(PDF));
    render(<FileViewer tab={fileTab(PDF)} />);
    await waitFor(() => expect(shown(PDF)).toMatchObject({ kind: 'frame', named: true, frame: { status: 'ready' } }));
    expect(main.callsOf('layout.frameFile')).toEqual([{ appSessionId: MAIN_A, path: PDF }]);
  });

  it('X3.4 (M4): a relative chip of a file at /base/dir/doc.md follows with the entry’s path as its source and the path the read then asks; an artifact’s view follows nothing', async () => {
    const main = disk({ '/base/dir/doc.md': '[a](sub/a.md) and [out](/elsewhere/notes.txt)', '/base/dir/sub/a.md': 'a\n', [OUT]: 'the notes\n' });
    click(await linkIn('sub/a.md', '/base/dir/doc.md'));
    render(<FileViewer tab={fileTab('/base/dir/sub/a.md')} />);
    await waitFor(() => expect(shown('/base/dir/sub/a.md')?.status).toBe('ready'));
    const [followed] = main.callsOf('files.follow');
    expect(followed).toEqual({ appSessionId: MAIN_A, path: '/base/dir/sub/a.md', from: { file: '/base/dir/doc.md' } });
    expect(reads(main, '/base/dir/sub/a.md').map((input) => input.path)).toEqual([followed.path]);
    cleanup();
    // an artifact's view names no source: an absolute link, which a follow could take, follows nothing
    render(<MarkdownView entry={shown('/base/dir/doc.md')!} artifactView />);
    click(screen.getByTitle(OUT));
    expect(mainFile(OUT)).toBeDefined(); // the open was made
    expect(main.callsOf('files.follow')).toHaveLength(1);
  });

  it('W1 (a): while the follow is under way the tab shows its loading state and sends no files.read; when it is answered, exactly one', async () => {
    const main = disk({ [DOC]: LINKED, [OUT]: 'the notes\n' });
    const chip = await linkIn();
    const held = main.hold('files.follow');
    click(chip);
    render(<FileViewer tab={fileTab(OUT)} />);
    await settle();
    expect(main.callsOf('files.watch')).toContainEqual({ appSessionId: MAIN_A, path: '/elsewhere' }); // the watch was asked; the read waits
    expect(shown()).toMatchObject({ status: 'loading', pending: 1 });
    expect(reads(main)).toEqual([]);
    await act(async () => held.release());
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', text: 'the notes\n', editable: true }));
    await settle();
    expect(reads(main)).toEqual([asked(OUT)]); // one read: it noted the count after the wait, so nothing reads again
  });

  it.each([
    ['answers not-linked', (main: ReturnType<typeof installDisk>) => void main.links.splice(0)],
    ['is refused by a daemon of an older build (K11)', (main: ReturnType<typeof installDisk>) => void (main.daemon.older = true)],
    ['times out', (main: ReturnType<typeof installDisk>) => void (main.answers.by = (name) => (name === 'files.follow' ? fail('files.follow: no answer within 10 s', 'timeout') : null))],
    ['finds no host', (main: ReturnType<typeof installDisk>) => void (main.answers.by = (name) => (name === 'files.follow' ? fail('the files service is not running', 'host_unavailable') : null))],
    ['is refused to the caller', (main: ReturnType<typeof installDisk>) => void (main.answers.by = (name) => (name === 'files.follow' ? fail('forbidden sender', 'forbidden_sender') : null))],
  ])('W1 (b): a follow that %s settles the wait the same way: the read is sent and its refusal draws the notice', async (_, how) => {
    const main = disk({ [DOC]: LINKED, [OUT]: 'the notes\n' });
    how(main);
    click(await linkIn());
    render(<FileViewer tab={fileTab(OUT)} />);
    await waitFor(() => expect(noticeLines()).toEqual(outsideHere(OUT)));
    expect(main.callsOf('files.follow')).toEqual([FROM_DOC]);
    expect(reads(main)).toEqual([asked(OUT)]);
  });

  it('K11: on a daemon of an older build a link to a file inside the folders opens as before', async () => {
    const main = disk({ [DOC]: '[the app](/r/app.ts)', '/r/app.ts': 'export const a = 1;\n' }, { older: true });
    click(await linkIn('/r/app.ts'));
    render(<FileViewer tab={fileTab('/r/app.ts')} />);
    await waitFor(() => expect(codeText()).toBe('export const a = 1;'));
    expect(main.callsOf('files.follow')).toEqual([{ appSessionId: MAIN_A, path: '/r/app.ts', from: { file: DOC } }]);
  });

  it('W1 (c): a second click on the link while its follow is under way starts no second follow', async () => {
    const main = disk({ [DOC]: LINKED, [OUT]: 'the notes\n' });
    const chip = await linkIn();
    const held = main.hold('files.follow');
    click(chip);
    click(chip);
    click(chip, false);
    expect(main.callsOf('files.follow')).toEqual([FROM_DOC]);
    render(<FileViewer tab={fileTab(OUT)} />);
    await act(async () => held.release());
    await waitFor(() => expect(shown()?.status).toBe('ready'));
    expect(reads(main)).toHaveLength(1);
  });

  it('W1 (d): the same tab opened for another session while the follow is under way reads at once for it, and the read that waited lands nowhere', async () => {
    const main = disk({ [DOC]: LINKED, [OUT]: 'the notes\n' });
    const chip = await linkIn();
    const held = main.hold('files.follow');
    click(chip);
    const { rerender } = render(<FileViewer tab={fileTab(OUT)} />);
    await settle();
    expect(reads(main)).toEqual([]);
    rerender(<FileViewer tab={fileTab(OUT, null, B)} />); // the other session's read does not wait
    await waitFor(() => expect(shown()).toMatchObject({ appSessionId: B, status: 'error' }));
    expect(reads(main).map((input) => input.appSessionId)).toEqual(['app-b']);
    await act(async () => held.release());
    await settle();
    expect(reads(main).map((input) => input.appSessionId)).toEqual(['app-b', MAIN_A]); // sent when its follow settled ...
    expect(shown()).toMatchObject({ appSessionId: B, status: 'error' }); // ... and its answer landed nowhere
  });

  it('W1 (d): the tab closed while the follow is under way leaves no entry when its read answers', async () => {
    const main = disk({ [DOC]: LINKED, [OUT]: 'the notes\n' });
    const chip = await linkIn();
    const held = main.hold('files.follow');
    click(chip);
    const { unmount } = render(<FileViewer tab={fileTab(OUT)} />);
    await settle();
    unmount();
    act(() => useLayout.getState().closeTab(FILE(OUT)));
    expect(shown()).toBeUndefined();
    await act(async () => held.release());
    await settle();
    expect(shown()).toBeUndefined();
  });

  it('W1 (f): a tab that shows the file’s refusal is read again after the follow, and then shows the file', async () => {
    const main = disk({ [DOC]: LINKED, [OUT]: 'the notes\n' });
    const chip = await linkIn();
    showFile(OUT);
    await waitFor(() => expect(noticeLines()).toEqual(outsideHere(OUT)));
    click(chip);
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', text: 'the notes\n', editable: true }));
    expect(reads(main)).toEqual([asked(OUT), asked(OUT)]);
  });

  it('W1 (g): a read sent before the click that lands refused after the follow found the link is read once more: two reads in all', async () => {
    const main = disk({ [DOC]: LINKED, [OUT]: 'the notes\n' });
    const chip = await linkIn();
    const before = main.hold('files.read'); // answered as the disk is when it arrives: refused, no record yet
    showFile(OUT);
    await waitFor(() => expect(reads(main)).toHaveLength(1));
    click(chip); // the read is pending, so the open itself reads nothing
    await waitFor(() => expect(main.linked(MAIN_A, OUT)).toEqual({ why: null }));
    await settle();
    expect(reads(main)).toHaveLength(1);
    await act(async () => before.release());
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', text: 'the notes\n', editable: true }));
    await settle();
    expect(reads(main)).toEqual([asked(OUT), asked(OUT)]);
  });

  it('W1 (g): the held read landing refused before the follow answers waits for it, then reads once more: two reads in all', async () => {
    const main = disk({ [DOC]: LINKED, [OUT]: 'the notes\n' });
    const chip = await linkIn();
    const before = main.hold('files.read');
    showFile(OUT);
    await waitFor(() => expect(reads(main)).toHaveLength(1));
    const followed = main.hold('files.follow');
    click(chip);
    await act(async () => before.release());
    await waitFor(() => expect(noticeLines()).toEqual(outsideHere(OUT))); // drawn as it is
    await settle();
    expect(reads(main)).toHaveLength(1);
    await act(async () => followed.release());
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', text: 'the notes\n' }));
    await settle();
    expect(reads(main)).toHaveLength(2);
  });

  it('W1 (g): a file that opened read-only before the click is read once more after the follow, and is editable', async () => {
    const main = disk({ [DOC]: LINKED, [OUT]: 'the notes\n' }, { results: [OUT] });
    const chip = await linkIn();
    const before = main.hold('files.read');
    showFile(OUT);
    await waitFor(() => expect(reads(main)).toHaveLength(1));
    click(chip);
    await waitFor(() => expect(main.linked(MAIN_A, OUT)).not.toBeNull());
    await act(async () => before.release());
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', locked: null, editable: true }));
    await settle();
    expect(reads(main)).toHaveLength(2);
  });

  it('W1 (g): no further read for a key whose entry became another session’s while the follow was under way', async () => {
    const main = disk({ [DOC]: LINKED, [OUT]: 'the notes\n' });
    const chip = await linkIn();
    const before = main.hold('files.read');
    const { rerender } = showFile(OUT);
    await waitFor(() => expect(reads(main)).toHaveLength(1));
    const followed = main.hold('files.follow');
    click(chip);
    await act(async () => before.release());
    await waitFor(() => expect(noticeLines()).toEqual(outsideHere(OUT))); // landed refused; the store waits for the follow
    rerender(<FileViewer tab={fileTab(OUT, null, B)} />);
    await waitFor(() => expect(shown()).toMatchObject({ appSessionId: B, status: 'error' }));
    await act(async () => followed.release());
    await settle();
    expect(reads(main).map((input) => input.appSessionId)).toEqual([MAIN_A, 'app-b']);
  });

  it('W1 (g): a hidden tab whose read landed refused before the follow found the link reads again when it is next shown, once', async () => {
    const main = disk({ [DOC]: LINKED, [OUT]: 'the notes\n' });
    const chip = await linkIn();
    const before = main.hold('files.read');
    const { unmount } = showFile(OUT);
    await waitFor(() => expect(reads(main)).toHaveLength(1));
    const followed = main.hold('files.follow');
    click(chip);
    await act(async () => before.release());
    await waitFor(() => expect(shown()?.status).toBe('error'));
    unmount(); // the tab hidden: left for its next mount
    await act(async () => followed.release());
    await settle();
    expect(reads(main)).toHaveLength(1);
    render(<FileViewer tab={fileTab(OUT)} />);
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', text: 'the notes\n' }));
    await settle();
    expect(reads(main)).toHaveLength(2);
  });

  it('W1 (g) and Retry: while the store’s read again is out Retry is not offered and starts nothing', async () => {
    const main = disk({ [DOC]: LINKED, [OUT]: 'the notes\n' });
    const chip = await linkIn();
    main.answers.by = (name, input) => (name === 'files.read' && input.path === OUT ? unreachable() : null);
    const before = main.hold('files.read');
    showFile(OUT);
    await waitFor(() => expect(reads(main)).toHaveLength(1));
    const followed = main.hold('files.follow');
    click(chip);
    await act(async () => before.release());
    await waitFor(() => expect(retryButton()?.disabled).toBe(false)); // unreachable: Retry offered, nothing out
    main.answers.by = () => null; // the daemon answers again
    const again = main.hold('files.read');
    await act(async () => followed.release());
    await waitFor(() => expect(reads(main)).toHaveLength(2));
    expect(shown()).toMatchObject({ retrying: true });
    expect(retryButton()!.disabled).toBe(true);
    act(() => useViewer.getState().retry(FILE(OUT)));
    await settle();
    expect(reads(main)).toHaveLength(2);
    await act(async () => again.release());
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', text: 'the notes\n', retrying: false }));
    await settle();
    expect(reads(main)).toHaveLength(2);
  });

  it('W1 (g) and Retry: a Retry’s read out when the follow found the link starts nothing meanwhile; landing refused it is read once more, the guard held to the end', async () => {
    const main = disk({ [DOC]: LINKED, [OUT]: 'the notes\n' });
    const chip = await linkIn();
    main.answers.by = (name, input) => (name === 'files.read' && input.path === OUT ? unreachable() : null);
    showFile(OUT);
    await waitFor(() => expect(retryButton()?.disabled).toBe(false));
    main.answers.by = () => null;
    const retried = main.hold('files.read'); // Retry's read, answered refused: no record yet
    fireEvent.click(retryButton()!);
    await waitFor(() => expect(reads(main)).toHaveLength(2));
    click(chip);
    await waitFor(() => expect(main.linked(MAIN_A, OUT)).not.toBeNull());
    await settle();
    expect(reads(main)).toHaveLength(2); // nothing read while Retry's read is out
    const again = main.hold('files.read');
    await act(async () => retried.release());
    await waitFor(() => expect(reads(main)).toHaveLength(3));
    expect(shown()).toMatchObject({ retrying: true }); // the read again holds the guard Retry took
    await act(async () => again.release());
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', retrying: false }));
    await settle();
    expect(reads(main)).toHaveLength(3);
  });

  it('W1 (g) and Retry: a Retry pressed while the follow is under way reads after it, noting its count: one read and no read again', async () => {
    const main = disk({ [DOC]: LINKED, [OUT]: 'the notes\n' });
    const chip = await linkIn();
    main.answers.by = (name, input) => (name === 'files.read' && input.path === OUT ? unreachable() : null);
    showFile(OUT);
    await waitFor(() => expect(retryButton()?.disabled).toBe(false));
    main.answers.by = () => null;
    const followed = main.hold('files.follow');
    click(chip);
    fireEvent.click(retryButton()!);
    await settle();
    expect(reads(main)).toHaveLength(1);
    await act(async () => followed.release());
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', retrying: false }));
    await settle();
    expect(reads(main)).toHaveLength(2);
  });

  it('W1 (h): a Markdown file’s and a subagent’s clicks for one path are two follows, and the read waits for both, the one that came during its wait included', async () => {
    const main = disk({ [DOC]: LINKED, [OUT]: 'the notes\n' }, { links: [{ from: { file: DOC }, path: OUT }, { from: { agent: 'agent-1' }, path: OUT }] });
    const chip = await linkIn();
    const first = main.hold('files.follow');
    click(chip);
    render(<FileViewer tab={fileTab(OUT)} />);
    await settle();
    const second = main.hold('files.follow');
    fromAgent(OUT);
    expect(main.callsOf('files.follow')).toEqual([FROM_DOC, { appSessionId: MAIN_A, path: OUT, from: { agent: 'agent-1' } }]);
    await act(async () => first.release());
    await settle();
    expect(reads(main)).toEqual([]);
    await act(async () => second.release());
    await waitFor(() => expect(shown()?.status).toBe('ready'));
    expect(reads(main)).toHaveLength(1);
  });

  it('W1 (i): several loads that waited for one follow each send their read when it settles; only the newest lands', async () => {
    const main = disk({ [DOC]: LINKED, [OUT]: 'the notes\n' });
    const chip = await linkIn();
    const held = main.hold('files.follow');
    click(chip);
    render(<FileViewer tab={fileTab(OUT)} />);
    await settle();
    act(() => useViewer.getState().applyChanged({ appSessionId: A, path: OUT, kind: 'changed' })); // a second load, waiting too
    await settle();
    expect(reads(main)).toEqual([]);
    // the two reads tell apart: the older answers the old text and is held past the newer, which answers the new one
    let n = 0;
    main.answers.by = (name, input) => {
      if (name === 'files.read' && input.path === OUT && ++n === 2) main.files[OUT] = 'newer notes\n';
      return null;
    };
    const older = main.hold('files.read');
    await act(async () => held.release());
    await waitFor(() => expect(reads(main)).toHaveLength(2));
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', text: 'newer notes\n' }));
    await act(async () => older.release()); // the older answer, 'the notes', lands nowhere
    await settle();
    expect(shown()).toMatchObject({ status: 'ready', text: 'newer notes\n' });
    expect(reads(main)).toHaveLength(2);
  });

  it('K4: a file a read-only Markdown file links opens read-only with its own sentence and Open File…; once the Markdown file is chosen, the same link opens it editable', async () => {
    const SOURCE = '/elsewhere/docs/guide.md';
    const main = disk({ [SOURCE]: LINKED, [OUT]: 'the notes\n' }, { results: [SOURCE], links: [{ from: { file: SOURCE }, path: OUT }] });
    const chip = await linkIn(OUT, SOURCE);
    expect(shown(SOURCE)).toMatchObject({ locked: 'result' });
    click(chip);
    render(<FileViewer tab={fileTab(OUT)} />);
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', named: true, locked: 'linked', editable: false }));
    expect(readOnlyReason(shown()!)).toBe('linked');
    const at = [...document.querySelectorAll<HTMLElement>('[data-read-only]')].find((node) => node.getAttribute('data-read-only') === 'linked')!;
    expect(at.getAttribute('aria-description')).toBe(LINKED_ONLY);
    await userEvent.setup().click(at);
    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByText(LINKED_ONLY)).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'Open File…' })).not.toBeNull();
    main.grant(MAIN_A, SOURCE); // the person chose the Markdown file
    click(chip);
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', locked: null, editable: true }));
    expect(main.linked(MAIN_A, OUT)).toEqual({ why: null });
  });

  it('K5: a subagent’s link to a file its counted text names opens editable; a path only a tool’s result there holds opens read-only', async () => {
    const RESULT = '/elsewhere/listed.txt';
    const main = disk({ [OUT]: 'the notes\n', [RESULT]: 'listed\n' }, { links: [{ from: { agent: 'agent-1' }, path: OUT }, { from: { agent: 'agent-1', why: 'result' }, path: RESULT }] });
    fromAgent(OUT);
    render(<FileViewer tab={fileTab(OUT)} />);
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', locked: null, editable: true }));
    cleanup();
    fromAgent(RESULT);
    render(<FileViewer tab={fileTab(RESULT)} />);
    await waitFor(() => expect(shown(RESULT)).toMatchObject({ status: 'ready', locked: 'result', editable: false }));
    expect(label()!.getAttribute('aria-description')).toBe(RESULT_ONLY);
    expect(main.callsOf('files.follow')).toEqual([
      { appSessionId: MAIN_A, path: OUT, from: { agent: 'agent-1' } },
      { appSessionId: MAIN_A, path: RESULT, from: { agent: 'agent-1' } },
    ]);
  });

  it('K6: a link the shown file draws but the daemon no longer finds opens nothing: U6b-4b’s first notice', async () => {
    const main = disk({ [DOC]: LINKED, [OUT]: 'the notes\n' }, { links: [] }); // the file on disk changed since it was drawn
    click(await linkIn());
    render(<FileViewer tab={fileTab(OUT)} />);
    await waitFor(() => expect(noticeLines()).toEqual(outsideHere(OUT)));
    expect(main.linked(MAIN_A, OUT)).toBeNull();
  });

  it('K6: a link typed into the Source view and not saved draws no chip, and a follow of the path it names finds nothing; the saved link is still drawn and followed', async () => {
    const DRAFT = '/elsewhere/draft.txt';
    const main = disk({ [DOC]: `Saved: ${LINKED}\n`, [OUT]: 'the notes\n', [DRAFT]: 'a draft\n' }); // the daemon finds the saved link alone
    await linkIn();
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    await waitFor(() => expect(view().state.facet(EditorView.editable)).toBe(true));
    typed(`Draft: [the draft](${DRAFT})\n`);
    await waitFor(() => expect(shown(DOC)!.dirty).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Rendered' }));
    await waitFor(() => expect(document.querySelector('[data-markdown-view]')).not.toBeNull());
    expect(screen.queryByTitle(DRAFT), 'the rendered view draws the saved text: no chip for the typed link').toBeNull();
    expect(screen.getByTitle(OUT), 'the control: the saved link’s chip').toBeTruthy();
    expect(await ipc.invoke('files.follow', { appSessionId: A, path: DRAFT, from: { file: DOC } }), 'a direct follow of the typed link’s path').toEqual({ ok: true, value: { status: 'not-linked' } });
    act(() => follow(A, DRAFT, { file: DOC }));
    await settle();
    expect(linkedCount(A, DRAFT)).toBe(0);
    expect(main.linked(MAIN_A, DRAFT)).toBeNull();
    click(screen.getByTitle(OUT)); // the control: the saved link follows and is recorded
    await waitFor(() => expect(main.linked(MAIN_A, OUT)).toEqual({ why: null }));
    expect(linkedCount(A, OUT)).toBe(1);
  });

  it('K8: an open the agent asked for never follows, and a file only a link record admits is refused to it; the person’s own click then opens it', async () => {
    const main = disk({ [DOC]: LINKED, [OUT]: 'the notes\n' });
    const chip = await linkIn();
    act(() => void openFile(A, OUT, null, { main: true, asked: 'agent', from: { file: DOC } }));
    expect(main.callsOf('files.follow')).toEqual([]);
    click(chip); // the person's click records the link; the agent's mark on the tab still reads as the agent's
    await waitFor(() => expect(main.linked(MAIN_A, OUT)).not.toBeNull());
    const agentTab = render(<FileViewer tab={fileTab(OUT)} agent />);
    await waitFor(() => expect(noticeLines()).toEqual(outsideHere(OUT)));
    expect(reads(main).at(-1)).toEqual(asked(OUT, { agent: true }));
    agentTab.unmount();
    render(<FileViewer tab={fileTab(OUT)} />); // the person's tab: read without the mark
    click(chip);
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', agent: false, editable: true }));
    expect(reads(main).at(-1)).toEqual(asked(OUT));
  });

  it('K10: a click for a session on another machine sends no follow', () => {
    const main = disk({});
    const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    act(() => void openFile(REMOTE, OUT, null, { main: true, from: { file: DOC } }));
    act(() => codeTranscriptActions.openFile(OUT, undefined, REMOTE, { main: true, agent: 'agent-1' }));
    expect(main.callsOf('files.follow')).toEqual([]);
  });

  it('W1 (g): with two reads out from before the click, the newest landing refused while the older is still out is read once more when the older has ended', async () => {
    const main = disk({ [DOC]: LINKED, [OUT]: 'the notes\n' });
    const chip = await linkIn();
    const older = main.hold('files.read');
    const newer = main.hold('files.read');
    showFile(OUT);
    await waitFor(() => expect(reads(main)).toHaveLength(1));
    act(() => useViewer.getState().applyChanged({ appSessionId: A, path: OUT, kind: 'changed' })); // a newer load supersedes it
    await waitFor(() => expect(reads(main)).toHaveLength(2));
    click(chip);
    await waitFor(() => expect(main.linked(MAIN_A, OUT)).not.toBeNull());
    await act(async () => newer.release()); // the newest lands refused while the older read is out
    await waitFor(() => expect(noticeLines()).toEqual(outsideHere(OUT)));
    await settle();
    expect(reads(main)).toHaveLength(2);
    await act(async () => older.release()); // superseded: it lands nowhere, and the load it was ends
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', text: 'the notes\n' }));
    await settle();
    expect(reads(main)).toHaveLength(3);
  });

  it('W1 (g): a comparison of A’s read that ends after the tab became B’s leaves B’s owed read again in place: B reads once more', async () => {
    const main = disk({ [DOC]: LINKED, [OUT]: 'the notes\n' });
    const chip = await linkIn();
    const aRead = main.hold('files.read');
    const { rerender } = showFile(OUT);
    await waitFor(() => expect(reads(main)).toHaveLength(1));
    const aFollow = main.hold('files.follow');
    click(chip);
    await act(async () => aRead.release()); // A's read lands refused; its comparison waits for A's follow
    await waitFor(() => expect(shown()).toMatchObject({ appSessionId: A, status: 'error' }));
    const bOlder = main.hold('files.read');
    const bNewer = main.hold('files.read');
    rerender(<FileViewer tab={fileTab(OUT, null, B)} />); // the same tab, now B's
    await waitFor(() => expect(reads(main)).toHaveLength(2));
    act(() => useViewer.getState().applyChanged({ appSessionId: B, path: OUT, kind: 'changed' })); // B's newer load
    await waitFor(() => expect(reads(main)).toHaveLength(3));
    act(() => follow(B, OUT, { file: DOC })); // B's own follow finds the link
    await waitFor(() => expect(main.linked('app-b', OUT)).not.toBeNull());
    await act(async () => bNewer.release()); // B's newest lands refused while its older read is out: B owes a read again
    await waitFor(() => expect(shown()).toMatchObject({ appSessionId: B, status: 'error' }));
    await act(async () => aFollow.release()); // A's comparison resumes, for an entry no longer A's
    await settle();
    expect(reads(main)).toHaveLength(3);
    await act(async () => bOlder.release()); // B's superseded read ends: B's read again goes now
    await waitFor(() => expect(shown()).toMatchObject({ appSessionId: B, status: 'ready', text: 'the notes\n' }));
    await settle();
    expect(reads(main).map((input) => input.appSessionId)).toEqual([MAIN_A, 'app-b', 'app-b', 'app-b']);
  });

  it('W1 (g): a Load more sent before the click that lands from a file that may not be saved is read once more, keeping what it loaded', async () => {
    const BIG = '/elsewhere/big.log';
    // two and a half chunks of real lines, in a file past the editor's cap: a head of one chunk, and one more by Load more
    const text = lines(81_920, (n) => `log ${String(n).padStart(6, '0')} invented`.padEnd(31, '.'));
    expect(text.length).toBe(81_920 * 32);
    const main = disk({ [DOC]: `[the log](${BIG})`, [BIG]: text }, { results: [BIG], links: [{ from: { file: DOC }, path: BIG }] });
    main.files[BIG] = { text, bytes: 5 * MiB } as never;
    showFile(BIG);
    await waitFor(() => expect(shown(BIG)).toMatchObject({ status: 'ready', kind: 'head', locked: 'result', loaded: MiB }));
    const before = reads(main, BIG).length;
    const more = main.hold('files.read');
    act(() => useViewer.getState().loadMore(FILE(BIG)));
    await waitFor(() => expect(reads(main, BIG)).toHaveLength(before + 1));
    // the follow alone, with no open (whose own read again of a named tab would hide what this case holds)
    act(() => follow(A, BIG, { file: DOC }));
    await waitFor(() => expect(main.linked(MAIN_A, BIG)).not.toBeNull());
    await act(async () => more.release()); // lands read-only: no record when it arrived
    await waitFor(() => expect(shown(BIG)).toMatchObject({ status: 'ready', locked: null }));
    await settle();
    // the read again covers what Load more reached: its two chunks, and the text stays the two chunks' whole
    expect(reads(main, BIG).slice(before).map((input) => input.offset)).toEqual([MiB, 0, MiB]);
    expect(shown(BIG)).toMatchObject({ loaded: 2 * MiB, text: text.slice(0, 2 * MiB) });
  });

  it('K3: a relative link in a Markdown file outside the folders that the person chose opens the file beside it, editable', async () => {
    const SOURCE = '/elsewhere/docs/guide.md';
    const NEXT = '/elsewhere/docs/next.md';
    const main = disk({ [SOURCE]: '[next](next.md)', [NEXT]: 'next\n' }, { links: [{ from: { file: SOURCE }, path: NEXT }] });
    main.grant(MAIN_A, SOURCE); // chosen with Open File…
    click(await linkIn('next.md', SOURCE));
    expect(main.callsOf('files.follow')).toEqual([{ appSessionId: MAIN_A, path: NEXT, from: { file: SOURCE } }]);
    render(<FileViewer tab={fileTab(NEXT)} />);
    await waitFor(() => expect(shown(NEXT)).toMatchObject({ status: 'ready', named: true, locked: null, editable: true }));
    expect(main.linked(MAIN_A, NEXT)).toEqual({ why: null });
  });

  it('Decision Log 14: a Save the daemon admits after the record is written and before the window hears linked leaves the tab clean, as saved, with nothing read over it', async () => {
    const main = disk({ [DOC]: LINKED, [OUT]: 'one\n' });
    const chip = await linkIn();
    click(chip);
    render(<FileViewer tab={fileTab(OUT)} />);
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', editable: true }));
    await waitFor(() => expect(view().state.facet(EditorView.editable)).toBe(true));
    typed('two ');
    await waitFor(() => expect(shown()!.dirty).toBe(true));
    main.unlink(MAIN_A, OUT); // the record pushed out
    const readsBefore = reads(main).length;
    const held = main.hold('files.follow');
    click(chip);
    main.publish(MAIN_A, OUT); // the daemon wrote the record; its reply has not reached the window
    fireEvent.click(saveButton()!);
    await waitFor(() => expect(main.files[OUT]).toBe('two one\n'));
    await waitFor(() => expect(shown()).toMatchObject({ dirty: false, saving: false, saveError: null }));
    await act(async () => held.release());
    await settle();
    expect(shown()).toMatchObject({ status: 'ready', dirty: false, saveError: null, error: null, failure: null, locked: null, editable: true, text: 'two one\n', hash: fakeHash('two one\n') });
    expect(view().state.doc.toString()).toBe('two one\n');
    expect(document.body.textContent).not.toContain('Could not save');
    expect(reads(main).length - readsBefore).toBeLessThanOrEqual(1);
  });

  // The branch panel (scalpel-4, finding 1): the agent's open still reading when the person's own open takes the tab back
  // and that read refuses; the click's open then finds only the agent's superseded read pending, which lands nowhere
  it('W1 (f): a click whose open finds only a superseded read pending reads the file after the follow (the branch panel)', async () => {
    const main = disk({ [DOC]: LINKED, [OUT]: 'the notes\n' });
    const chip = await linkIn();
    const agentsRead = main.hold('files.read'); // the agent's open, its read held
    render(<FileViewer tab={fileTab(OUT)} agent />);
    await waitFor(() => expect(reads(main)).toHaveLength(1));
    act(() => void openFile(A, OUT, null, { main: true })); // the person's own open: the agent's mark goes, and the file is read again
    await waitFor(() => expect(noticeLines()).toEqual(outsideHere(OUT))); // that read refused, the agent's still out
    click(chip);
    await waitFor(() => expect(main.linked(MAIN_A, OUT)).toEqual({ why: null }));
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', text: 'the notes\n', editable: true }));
    await act(async () => agentsRead.release());
    await settle();
    expect(shown()).toMatchObject({ status: 'ready', text: 'the notes\n', editable: true });
  });

  // The branch panel (scalpel-4, finding 3): a Save made under session A answers after the tab moved to B, whose read waits
  // on a follow of B's own: that read lands, and the tab shows B's answer, not A's writable state
  it('a Save of the tab’s earlier session that answers while the tab’s read for its new session waits on a follow leaves that read to land (the branch panel)', async () => {
    const main = disk({ [DOC]: LINKED, [OUT]: 'one\n' });
    const chip = await linkIn();
    click(chip);
    const { rerender } = render(<FileViewer tab={fileTab(OUT)} />);
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', editable: true }));
    await waitFor(() => expect(view().state.facet(EditorView.editable)).toBe(true));
    typed('two ');
    await waitFor(() => expect(shown()!.dirty).toBe(true));
    const write = main.hold('files.writeOutside');
    fireEvent.click(saveButton()!);
    await waitFor(() => expect(main.callsOf('files.writeOutside')).toHaveLength(1));
    const followed = main.hold('files.follow');
    act(() => follow(B, OUT, { file: '/r/docs/other.md' })); // B's click on a link that holds nothing for it
    rerender(<FileViewer tab={fileTab(OUT, null, B)} />); // the tab moves to B, its save out
    await waitFor(() => expect(shown()).toMatchObject({ appSessionId: B, pending: 1 })); // B's read, waiting on the follow
    await act(async () => write.release());
    await waitFor(() => expect(shown()).toMatchObject({ saving: false, dirty: false }));
    await act(async () => followed.release());
    await waitFor(() => expect(shown()).toMatchObject({ appSessionId: B, status: 'error', editable: false }));
    expect(noticeLines()).toEqual(outsideHere(OUT));
    expect(main.files[OUT]).toBe('two one\n');
  });

  // The branch panel (scalpel-4, finding 4): an unwatched outside file read in chunks changes after its first; the
  // continuation, sent before the follow found the link, answers another version, read-only. The load ends there, and
  // once the follow has found the link the file is read once more, whole
  it('W1 (g): a first open whose continuation found the file changed, read-only before the follow found the link, is read once more after it, whole and editable (the branch panel)', async () => {
    const lines = (letter: string) => `${letter.repeat(99)}\n`.repeat(Math.ceil(FILES_READ_DEFAULT_LENGTH / 100) + 10);
    const main = disk({ [DOC]: LINKED, [OUT]: lines('a') }, { results: [OUT] });
    const chip = await linkIn();
    const first = main.hold('files.read');
    const second = main.hold('files.read');
    // the tab's view mounted through the store alone: a megabyte drawn by the editor would only slow the case
    act(() => void openFile(A, OUT, null, { main: true }));
    act(() => void useViewer.getState().mount(FILE(OUT), { appSessionId: A, path: OUT, line: null }));
    await waitFor(() => expect(reads(main)).toHaveLength(1));
    await act(async () => {
      first.release();
      main.files[OUT] = lines('b'); // changed before the continuation arrives
    });
    await waitFor(() => expect(reads(main)).toHaveLength(2)); // the continuation, answered as the changed file, read-only
    click(chip);
    await waitFor(() => expect(main.linked(MAIN_A, OUT)).toEqual({ why: null }));
    await act(async () => second.release());
    const changed = lines('b');
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', complete: true, locked: null, editable: true }));
    expect(shown()!.text === changed, 'the whole changed file').toBe(true);
    expect(reads(main)).toHaveLength(4); // the two of the first open, and the whole file once more in two
  });

  it('X5.14: with unsaved edits and the record gone, Save is refused and the edits stand; pressed while the click’s follow is under way, refused again; after it answers linked, Save writes', async () => {
    const main = disk({ [DOC]: LINKED, [OUT]: 'one\n' });
    const chip = await linkIn();
    click(chip);
    render(<FileViewer tab={fileTab(OUT)} />);
    await waitFor(() => expect(shown()).toMatchObject({ status: 'ready', editable: true }));
    await waitFor(() => expect(view().state.facet(EditorView.editable)).toBe(true));
    typed('two ');
    await waitFor(() => expect(shown()!.dirty).toBe(true));
    main.unlink(MAIN_A, OUT); // pushed out of the session's records
    fireEvent.click(saveButton()!);
    await waitFor(() => expect(shown()!.saveError).not.toBeNull());
    expect(document.body.textContent).toContain(REFUSED);
    expect(view().state.doc.toString()).toBe('two one\n');
    expect(main.files[OUT]).toBe('one\n');
    const held = main.hold('files.follow');
    click(chip);
    fireEvent.click(saveButton()!);
    await settle();
    expect(main.callsOf('files.writeOutside')).toHaveLength(2);
    expect(main.files[OUT]).toBe('one\n');
    expect(shown()).toMatchObject({ dirty: true, saving: false });
    await act(async () => held.release());
    await waitFor(() => expect(main.linked(MAIN_A, OUT)).toEqual({ why: null }));
    fireEvent.click(saveButton()!);
    await waitFor(() => expect(main.files[OUT]).toBe('two one\n'));
    expect(shown()).toMatchObject({ dirty: false, saveError: null });
    expect(reads(main)).toHaveLength(1); // nothing was read over the edits
  });
});

// ---- UX wave U6b-4b (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md, M3; Interfaces §C, S1, "The look") ------
// A file that cannot be read shows the notice of its cause where "Refused: " and the command's words stood: its sentences,
// the path (with Copy path where the path is outside the folders), Retry where reading again can help, and the command's
// own words last. Retry is the store's `retry`: one read per press, held from the press until that read has settled, and
// none while a save is out; under unsaved edits it reads as a watch's event does, the edits standing. Invented paths under
// `/elsewhere` (outside session A's folders) and `/r`, invented text.
describe('the notice of a file that cannot be read (U6b-4b)', () => {
  const OUT = '/elsewhere/notes.txt';
  const CODE = '/r/a.ts';
  const T = addressOf(OTHER_MACHINE, 'app-notice' as AppSessionId); // a session MAWS runs on studio
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
    leaveRl2();
    resetRemoteLaneBStore();
  });

  const unreachable = (message = 'files.read: the files service is not running') => fail(message, 'host_unavailable');
  function disk(files: Record<string, string>) {
    const served = installDisk(files, { outside: ['/elsewhere'], names: () => false });
    offs.push(connectCodeEvents());
    return served;
  }
  const tabOf = (path: string, appSessionId: AppSessionId = A): Extract<TabRef, { kind: 'file' }> => ({ id: `file:${machineOf(appSessionId)}:${path}`, kind: 'file', path, line: null, appSessionId, machine: machineOf(appSessionId), pinned: false });
  const shown = (path: string, appSessionId: AppSessionId = A) => useViewer.getState().entries.get(tabOf(path, appSessionId).id);
  const show = (path: string, appSessionId: AppSessionId = A) => {
    act(() => void openFile(appSessionId, path, null, { main: true }));
    return render(<FileViewer tab={tabOf(path, appSessionId)} />);
  };
  const block = () => document.querySelector<HTMLElement>('[data-refusal]');
  const retry = () => block()?.querySelector<HTMLButtonElement>('[data-notice-retry]') ?? null;
  const reads = (main: { callsOf: ReturnType<typeof installDisk>['callsOf'] }, path: string) => main.callsOf('files.read').filter((input) => input.path === path);
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  const view = () => EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;
  const typed = (text: string) => act(() => view().dispatch({ changes: { from: 0, insert: text }, userEvent: 'input.type', annotations: isolateHistory.of('full') }));

  it('L7: on this Mac a path outside the folders the session has no evidence for reads the first notice: three sentences, the path with Copy path, the command’s words small, and no Retry', async () => {
    disk({ [OUT]: 'secret\n' });
    const writeText = vi.fn(async () => {});
    const before = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      show(OUT);
      await waitFor(() => expect(block()).not.toBeNull());
      expect(block()!.getAttribute('role')).toBe('alert');
      expect(noticeCause()).toBe('outside');
      expect(noticeLines()).toEqual(outsideHere(OUT));
      expect(block()!.querySelector('p')!.textContent).toBe('This file is outside the folders this session works in.'); // the headline, first
      expect(block()!.querySelector('[data-notice-detail]')!.textContent).toBe(OUTSIDE_REFUSAL);
      for (const line of noticeLines()) expect(line).not.toMatch(/^(Refused|files\.)/);
      expect(retry()).toBeNull();
      await act(async () => void fireEvent.click(within(block()!).getByRole('button', { name: 'Copy path' })));
      expect(writeText).toHaveBeenCalledExactlyOnceWith(OUT);
      expect(block()!.querySelector('[data-notice-copy]')!.textContent).toBe('Copied');
      expect(document.body.textContent).not.toContain('secret\n');
    } finally {
      if (before) Object.defineProperty(navigator, 'clipboard', before);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('Copy path says when the clipboard refused the path, and when there is no clipboard', async () => {
    disk({ [OUT]: 'secret\n' });
    const before = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const copy = () => block()!.querySelector<HTMLButtonElement>('[data-notice-copy]')!;
    try {
      for (const clipboard of [undefined, { writeText: async () => Promise.reject(new Error('denied')) }]) {
        Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
        cleanup();
        useViewer.getState().reset();
        show(OUT);
        await waitFor(() => expect(block()).not.toBeNull());
        expect(copy().textContent).toBe('Copy path');
        await act(async () => void fireEvent.click(copy()));
        await waitFor(() => expect(copy().textContent).toBe("Couldn't copy the path"));
      }
    } finally {
      if (before) Object.defineProperty(navigator, 'clipboard', before);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('L8: a path with no file reads “No file at this path.” with its path, and offers neither Copy path nor Retry', async () => {
    disk({});
    show('/r/gone.md');
    await waitFor(() => expect(block()).not.toBeNull());
    expect(noticeCause()).toBe('not-found');
    expect(noticeLines()).toEqual(['No file at this path.', '/r/gone.md', 'not found: /r/gone.md']);
    expect(block()!.querySelector('[data-notice-copy]')).toBeNull();
    expect(retry()).toBeNull();
  });

  it('L10 and S1 (b): with this Mac’s daemon not answering the notice offers Retry; a Retry that fails again draws its own cause, and one that reads shows the file', async () => {
    const main = disk({ [CODE]: 'export const a = 1;\n' });
    main.answers.by = (name) => (name === 'files.read' ? unreachable() : null);
    show(CODE);
    await waitFor(() => expect(noticeCause()).toBe('unreachable'));
    expect(noticeLines()).toEqual(["MAWS's service on this Mac is not answering.", CODE, 'files.read: the files service is not running']);
    expect(retry()!.textContent).toBe('Retry');
    expect(retry()!.disabled).toBe(false);
    main.answers.by = (name, input) => (name === 'files.read' ? fail(`not found: ${input.path as string}`) : null); // back, and the file is not there
    fireEvent.click(retry()!);
    await waitFor(() => expect(noticeCause()).toBe('not-found'));
    expect(retry()).toBeNull();
    expect(reads(main, CODE)).toHaveLength(2);

    cleanup();
    useViewer.getState().reset();
    main.answers.by = (name) => (name === 'files.read' ? unreachable() : null);
    show(CODE);
    await waitFor(() => expect(noticeCause()).toBe('unreachable'));
    main.answers.by = () => null; // the daemon answers again
    fireEvent.click(retry()!);
    await waitFor(() => expect(codeText()).toBe('export const a = 1;'));
    expect(block()).toBeNull();
    expect(shown(CODE)).toMatchObject({ status: 'ready', error: null, failure: null, retrying: false });
  });

  it('S1 (c): a read the route gave up on reads as unreachable, with Retry', async () => {
    const main = disk({ [CODE]: 'a\n' });
    main.answers.by = (name) => (name === 'files.read' ? fail('files.read: no answer within 10 s', 'timeout') : null);
    show(CODE);
    await waitFor(() => expect(noticeCause()).toBe('unreachable'));
    expect(noticeLines()[0]).toBe("MAWS's service on this Mac is not answering.");
    expect(retry()).not.toBeNull();
  });

  it('S1 (a): a second press while the file’s watch has not answered starts nothing, the button drawn disabled; one read follows the watch', async () => {
    const main = disk({ [CODE]: 'a\n' });
    // the first watch is refused, so a read again takes the watch again first (the Files store installs a refused watch again)
    let watches = 0;
    main.answers.by = (name) => (name === 'files.watch' && ++watches === 1 ? fail('files.watch: the files service is not running', 'host_unavailable') : name === 'files.read' ? unreachable() : null);
    show(CODE);
    await waitFor(() => expect(noticeCause()).toBe('unreachable'));
    main.answers.by = (name) => (name === 'files.read' ? unreachable() : null);
    const watch = main.hold('files.watch');
    fireEvent.click(retry()!);
    await waitFor(() => expect(retry()!.disabled).toBe(true));
    fireEvent.click(retry()!);
    act(() => useViewer.getState().retry(tabOf(CODE).id)); // the act itself refuses too, not only the button
    await settle();
    expect(main.callsOf('files.watch')).toHaveLength(2);
    expect(reads(main, CODE)).toHaveLength(1); // none yet: the read waits for the watch
    watch.release();
    await waitFor(() => expect(reads(main, CODE)).toHaveLength(2));
    await waitFor(() => expect(retry()!.disabled).toBe(false));
    await settle();
    expect(reads(main, CODE)).toHaveLength(2);
  });

  it('S1 (a): a second press while the read is held starts nothing, the button drawn disabled', async () => {
    const main = disk({ [CODE]: 'a\n' });
    main.answers.by = (name) => (name === 'files.read' ? unreachable() : null);
    show(CODE);
    await waitFor(() => expect(noticeCause()).toBe('unreachable'));
    const read = main.hold('files.read');
    fireEvent.click(retry()!);
    await waitFor(() => expect(reads(main, CODE)).toHaveLength(2));
    expect(retry()!.disabled).toBe(true);
    fireEvent.click(retry()!);
    act(() => useViewer.getState().retry(tabOf(CODE).id));
    await settle();
    expect(reads(main, CODE)).toHaveLength(2);
    read.release();
    await waitFor(() => expect(retry()!.disabled).toBe(false));
    expect(reads(main, CODE)).toHaveLength(2);
  });

  it('S1 (d): a Retry’s read held while the same path is opened for another session lands nowhere', async () => {
    const main = disk({ [CODE]: 'session a’s\n' });
    main.answers.by = (name) => (name === 'files.read' ? unreachable() : null);
    const { rerender } = show(CODE);
    await waitFor(() => expect(noticeCause()).toBe('unreachable'));
    main.answers.by = () => null;
    const read = main.hold('files.read'); // session A's Retry, answered with A's text once released
    fireEvent.click(retry()!);
    await waitFor(() => expect(reads(main, CODE)).toHaveLength(2));
    main.files[CODE] = 'session b’s\n';
    act(() => void openFile(B, CODE)); // the tab is one per machine and path: it takes session B
    rerender(<FileViewer tab={tabOf(CODE, B)} />);
    await waitFor(() => expect(shown(CODE, B)).toMatchObject({ appSessionId: B, status: 'ready', text: 'session b’s\n' }));
    read.release();
    await settle();
    expect(shown(CODE, B)).toMatchObject({ appSessionId: B, status: 'ready', text: 'session b’s\n', retrying: false });
  });

  it('S1 (e): under unsaved edits a re-read that failed shows the notice over them; Retry keeps the edit while held, lands the file with the edit standing in the view the person chose, and a failure again keeps it', async () => {
    const main = disk({ [CODE]: 'one\n' });
    show(CODE);
    await waitFor(() => expect(shown(CODE)).toMatchObject({ status: 'ready', editable: true }));
    await waitFor(() => expect(view().state.facet(EditorView.editable)).toBe(true));
    typed('mine ');
    await waitFor(() => expect(shown(CODE)!.dirty).toBe(true));
    main.answers.by = (name) => (name === 'files.read' ? unreachable() : null);
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: CODE, kind: 'changed' }));
    await waitFor(() => expect(noticeCause()).toBe('unreachable'));
    expect(shown(CODE)).toMatchObject({ status: 'error', dirty: true });
    expect(existingViewState(tabOf(CODE).id)?.docOf?.()).toBe('mine one\n');

    // held: the notice stands and so does the edit
    main.answers.by = () => null;
    const read = main.hold('files.read');
    fireEvent.click(retry()!);
    await waitFor(() => expect(shown(CODE)!.pending).toBe(1));
    expect(noticeCause()).toBe('unreachable');
    expect(retry()!.disabled).toBe(true);
    expect(shown(CODE)).toMatchObject({ dirty: true });
    read.release();
    // answered with the file: the notice goes, the entry still unsaved, the edited text in the editor
    await waitFor(() => expect(block()).toBeNull());
    expect(shown(CODE)).toMatchObject({ status: 'ready', dirty: true, sourceView: false, failure: null });
    await waitFor(() => expect(codeText()).toBe('mine one'));

    // answered with a failure: the notice again, the edit still held; Retry's own read answers a failure of its own words
    main.answers.by = (name) => (name === 'files.read' ? unreachable() : null);
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: CODE, kind: 'changed' }));
    await waitFor(() => expect(noticeCause()).toBe('unreachable'));
    const before = reads(main, CODE).length;
    main.answers.by = (name) => (name === 'files.read' ? fail('files.read: no answer within 10 s', 'timeout') : null);
    fireEvent.click(retry()!);
    await waitFor(() => expect(document.querySelector('[data-notice-detail]')?.textContent).toBe('files.read: no answer within 10 s'));
    await waitFor(() => expect(retry()!.disabled).toBe(false));
    expect(reads(main, CODE)).toHaveLength(before + 1);
    expect(noticeCause()).toBe('unreachable');
    expect(shown(CODE)).toMatchObject({ status: 'error', dirty: true });
    expect(existingViewState(tabOf(CODE).id)?.docOf?.()).toBe('mine one\n');
  });

  it('S1 (e): a Markdown file left on Rendered with unsaved edits stays on Rendered after a Retry, and its Source holds the edit', async () => {
    const DOC = '/r/notes.md';
    const main = disk({ [DOC]: 'saved\n' });
    show(DOC);
    await waitFor(() => expect(shown(DOC)).toMatchObject({ status: 'ready', kind: 'markdown' }));
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    await waitFor(() => expect(view().state.facet(EditorView.editable)).toBe(true));
    typed('edited ');
    await waitFor(() => expect(shown(DOC)!.dirty).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Rendered' }));
    main.answers.by = (name) => (name === 'files.read' ? unreachable() : null);
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: DOC, kind: 'changed' }));
    await waitFor(() => expect(noticeCause()).toBe('unreachable'));
    main.answers.by = () => null;
    fireEvent.click(retry()!);
    await waitFor(() => expect(block()).toBeNull());
    expect(shown(DOC)).toMatchObject({ status: 'ready', dirty: true, sourceView: false });
    expect(screen.getByText('saved')).toBeTruthy(); // Rendered shows the saved text, as for any unsaved edit
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    await waitFor(() => expect(codeText()).toBe('edited saved'));
  });

  it('S1 (f): while a save is out Retry is drawn disabled and starts nothing', async () => {
    const main = disk({ [CODE]: 'one\n' });
    show(CODE);
    await waitFor(() => expect(view().state.facet(EditorView.editable)).toBe(true));
    typed('mine ');
    await waitFor(() => expect(shown(CODE)!.dirty).toBe(true));
    main.answers.by = (name) => (name === 'files.read' ? unreachable() : null);
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: CODE, kind: 'changed' }));
    await waitFor(() => expect(noticeCause()).toBe('unreachable'));
    const write = main.hold('files.write');
    let saved: Promise<unknown> = Promise.resolve();
    act(() => void (saved = useViewer.getState().save(tabOf(CODE).id)));
    await waitFor(() => expect(shown(CODE)!.saving).toBe(true));
    expect(retry()!.disabled).toBe(true);
    const before = reads(main, CODE).length;
    fireEvent.click(retry()!);
    act(() => useViewer.getState().retry(tabOf(CODE).id));
    await settle();
    expect(reads(main, CODE)).toHaveLength(before);
    write.release();
    await act(() => saved);
    await waitFor(() => expect(retry()?.disabled).toBe(false));
  });

  it('S1 (f), the other order: Retry pressed while the watch is held, then a save whose conflict read is out when the watch answers: Retry reads nothing, and the conflict view stands', async () => {
    const main = disk({ [CODE]: 'one\n' });
    let watches = 0; // the first watch is refused, so Retry takes the watch again and waits for it
    main.answers.by = (name) => (name === 'files.watch' && ++watches === 1 ? fail('files.watch: the files service is not running', 'host_unavailable') : null);
    show(CODE);
    await waitFor(() => expect(view().state.facet(EditorView.editable)).toBe(true));
    typed('mine ');
    await waitFor(() => expect(shown(CODE)!.dirty).toBe(true));
    main.files[CODE] = 'theirs\n'; // changed on disk: the save will conflict
    main.answers.by = (name) => (name === 'files.read' ? unreachable() : null);
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: CODE, kind: 'changed' }));
    await waitFor(() => expect(noticeCause()).toBe('unreachable'));
    main.answers.by = () => null;
    const watch = main.hold('files.watch');
    fireEvent.click(retry()!);
    await waitFor(() => expect(main.callsOf('files.watch')).toHaveLength(2));
    const before = reads(main, CODE).length;
    const conflictRead = main.hold('files.read');
    let saved: Promise<unknown> = Promise.resolve();
    act(() => void (saved = useViewer.getState().save(tabOf(CODE).id)));
    await waitFor(() => expect(reads(main, CODE)).toHaveLength(before + 1)); // the save's conflict read, out
    watch.release();
    await settle();
    conflictRead.release();
    expect(await act(() => saved)).toBe('conflict');
    await settle();
    expect(reads(main, CODE)).toHaveLength(before + 1); // Retry read nothing
    expect(shown(CODE)).toMatchObject({ saving: false, retrying: false, dirty: true, theirs: { view: 'merge', text: 'theirs\n' } });
  });

  // The branch review: the folder's watch invalidated while Retry waits for it is read by Retry's own read, once the watch
  // installed again has answered: one read, whose file is shown
  it('S1 (a): an invalidation while Retry waits for the watch starts no second read; Retry’s read shows the file', async () => {
    const main = disk({ [CODE]: 'a\n' });
    let watches = 0; // the first watch is refused, so Retry takes the watch again and waits for it
    main.answers.by = (name) => (name === 'files.watch' && ++watches === 1 ? fail('files.watch: the files service is not running', 'host_unavailable') : name === 'files.read' ? unreachable() : null);
    show(CODE);
    await waitFor(() => expect(noticeCause()).toBe('unreachable'));
    main.answers.by = () => null; // the daemon answers again
    const watch = main.hold('files.watch');
    fireEvent.click(retry()!);
    await waitFor(() => expect(main.callsOf('files.watch')).toHaveLength(2));
    const before = reads(main, CODE).length;
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: '/r', kind: 'invalidated' }));
    watch.release();
    await waitFor(() => expect(codeText()).toBe('a'));
    await settle();
    expect(reads(main, CODE)).toHaveLength(before + 1);
    expect(shown(CODE)).toMatchObject({ status: 'ready', error: null, failure: null, retrying: false, pending: 0 });
    expect(block()).toBeNull();
  });

  // The branch review: in a short split pane the notice is its own scroll box, its column centred only within at least the
  // box's height, so a notice taller than the pane starts at its headline and scrolls, nothing above the scroll origin
  it('the notice scrolls from its top: the block is the scroll box, and its column is centred within at least its height', async () => {
    disk({ [OUT]: 'secret\n' });
    show(OUT);
    await waitFor(() => expect(block()).not.toBeNull());
    const classes = (element: Element) => element.className.split(/\s+/);
    expect(classes(block()!)).toEqual(expect.arrayContaining(['h-full', 'overflow-y-auto']));
    expect(classes(block()!)).not.toContain('justify-center');
    const column = block()!.firstElementChild!;
    expect(classes(column)).toEqual(expect.arrayContaining(['flex', 'min-h-full', 'flex-col', 'justify-center']));
    expect(classes(column)).not.toContain('h-full');
    expect(column.querySelector('p')!.textContent).toBe('This file is outside the folders this session works in.');
  });

  // The branch review: a File artifact of another machine, read by the artifact alone (its session not in the window),
  // names the artifact's machine when the read fails, not this Mac's service
  it('a Library File artifact of another machine whose session the window does not know names that machine', async () => {
    const ARTIFACT = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
    const main = disk({});
    overRl2(T); // the roster names the other machine studio
    main.answers.by = (name) => (name === 'library.read' ? unreachable('library.read: machine studio is not reachable') : null);
    const artifactView = (tabId: string, machine: typeof TEST_MACHINE) => render(<FileBody tabId={tabId} appSessionId={null} path="/r/notes.txt" readOnly artifactView artifact={{ artifactId: ARTIFACT, machine, revision: 3 }} />);
    try {
      recordArtifactMachine(ARTIFACT, OTHER_MACHINE, TEST_MACHINE);
      artifactView(`artifact:${ARTIFACT}:3`, OTHER_MACHINE);
      await waitFor(() => expect(noticeCause()).toBe('unreachable'));
      expect(noticeLines()[0]).toBe('studio is not reachable.');
      expect(retry()).not.toBeNull();
      // the control: the same artifact of this Mac
      cleanup();
      useViewer.getState().reset();
      resetArtifactMachines();
      artifactView(`artifact:${ARTIFACT}:3:r1`, TEST_MACHINE);
      await waitFor(() => expect(noticeCause()).toBe('unreachable'));
      expect(noticeLines()[0]).toBe("MAWS's service on this Mac is not answering.");
    } finally {
      resetArtifactMachines();
    }
  });

  describe('a session on another machine', () => {
    beforeEach(() => overRl2(T));
    const listed = (mine: boolean | null) =>
      useSessions.setState((s) => {
        const next = new Map(s.listed);
        if (mine === null) next.delete(T);
        else next.set(T, { ...s.listed.get(T)!, mine });
        return { listed: next };
      });
    const grade = () => refused('files.read: refused grade by machine studio', 'grade');

    it.each([
      [true, 'not-on-record', 'studio does not have this session on record right now.', true],
      [false, 'no-access', 'Your access to this session on studio does not include its files.', false],
      [null, 'other', 'This file could not be opened.', true],
    ] as const)('L9: a grade refusal of the read, the listing’s mine %s, reads %s', async (mine, cause, headline, offersRetry) => {
      const main = disk({ '/r/a.ts': 'a\n' });
      main.answers.by = (name) => (name === 'files.read' ? grade() : null);
      listed(mine);
      show('/r/a.ts', T);
      await waitFor(() => expect(noticeCause()).toBe(cause));
      expect(noticeLines()).toEqual([headline, '/r/a.ts', 'files.read: refused grade by machine studio']);
      expect(retry() !== null).toBe(offersRetry);
    });

    it('L9: with the machine not reachable the notice names it and offers Retry; started again, Retry shows the file', async () => {
      const main = disk({ '/r/a.ts': 'from studio\n' });
      main.answers.by = (name) => (name === 'files.read' ? unreachable('files.read: machine studio is not reachable') : null);
      show('/r/a.ts', T);
      await waitFor(() => expect(noticeCause()).toBe('unreachable'));
      expect(noticeLines()[0]).toBe('studio is not reachable.');
      main.answers.by = () => null;
      fireEvent.click(retry()!);
      await waitFor(() => expect(codeText()).toBe('from studio'));
    });

    // The Mac run of e2e:remote's L9 scene: the link's return reopens the session's checkout feed, and main tells the folder
    // of every files watch it gave back there invalidated (`src/main/lane-b/remote-checkout.ts`, `replay`). An errored tab
    // whose folder's watch stood is read again by that invalidation, with no press: once, and the file shown.
    it('L9: the machine back, the invalidation of the folder whose watch stood reads the unreachable file once, with no press', async () => {
      const main = disk({ '/r/a.ts': 'from studio\n' });
      main.answers.by = (name) => (name === 'files.read' ? unreachable('files.read: machine studio is not reachable') : null);
      show('/r/a.ts', T);
      await waitFor(() => expect(noticeCause()).toBe('unreachable'));
      main.answers.by = () => null; // the link is up again
      const before = reads(main, '/r/a.ts').length;
      act(() => main.emit('files.changed', { appSessionId: bareOf(T), path: '/r', kind: 'invalidated' }, OTHER_MACHINE));
      await waitFor(() => expect(codeText()).toBe('from studio'));
      await settle();
      expect(reads(main, '/r/a.ts')).toHaveLength(before + 1);
      expect(shown('/r/a.ts', T)).toMatchObject({ status: 'ready', error: null, failure: null, retrying: false, pending: 0 });
      expect(block()).toBeNull();
    });

    it('L9: Retry pressed while the invalidation’s read is held is drawn disabled and starts nothing; the held read shows the file', async () => {
      const main = disk({ '/r/a.ts': 'from studio\n' });
      main.answers.by = (name) => (name === 'files.read' ? unreachable('files.read: machine studio is not reachable') : null);
      show('/r/a.ts', T);
      await waitFor(() => expect(noticeCause()).toBe('unreachable'));
      main.answers.by = () => null;
      const before = reads(main, '/r/a.ts').length;
      const read = main.hold('files.read');
      act(() => main.emit('files.changed', { appSessionId: bareOf(T), path: '/r', kind: 'invalidated' }, OTHER_MACHINE));
      await waitFor(() => expect(reads(main, '/r/a.ts')).toHaveLength(before + 1));
      await waitFor(() => expect(retry()?.disabled).toBe(true)); // the notice stands while the read is out
      expect(noticeCause()).toBe('unreachable');
      fireEvent.click(retry()!);
      act(() => useViewer.getState().retry(tabOf('/r/a.ts', T).id));
      await settle();
      expect(reads(main, '/r/a.ts')).toHaveLength(before + 1);
      read.release();
      await waitFor(() => expect(codeText()).toBe('from studio'));
      await settle();
      expect(reads(main, '/r/a.ts')).toHaveLength(before + 1);
      expect(shown('/r/a.ts', T)).toMatchObject({ status: 'ready', retrying: false, pending: 0 });
      expect(block()).toBeNull();
    });

    // The scene's other half: a folder nothing watched before the link went down (its watch failed with the read) is given
    // back by no reopening, so nothing reads the tab again by itself; Retry, pressed with the machine back, shows the file.
    it('L9: a folder whose watch failed with the read hears no invalidation, so the notice stands until Retry, which shows the file', async () => {
      const main = disk({ '/r/notes/a.ts': 'from studio\n' });
      main.answers.by = (name) => (name === 'files.read' || name === 'files.watch' ? unreachable('files.read: machine studio is not reachable') : null);
      show('/r/notes/a.ts', T);
      await waitFor(() => expect(noticeCause()).toBe('unreachable'));
      main.answers.by = () => null;
      const before = reads(main, '/r/notes/a.ts').length;
      act(() => main.emit('files.changed', { appSessionId: bareOf(T), path: '/r', kind: 'invalidated' }, OTHER_MACHINE)); // the parent's, which stood
      await settle();
      expect(reads(main, '/r/notes/a.ts')).toHaveLength(before);
      expect(retry()?.disabled).toBe(false);
      fireEvent.click(retry()!);
      await waitFor(() => expect(codeText()).toBe('from studio'));
      expect(reads(main, '/r/notes/a.ts')).toHaveLength(before + 1);
    });

    it('L9: where studio’s daemon ran the open and refused the path, the notice says the three ways; UC-7’s refusal of the act is its headline, as it is', async () => {
      const main = disk({ [OUT]: 'x\n' });
      main.answers.by = (name) => (name === 'files.read' ? fail(failureWords('files.readOutside', OUTSIDE_REFUSAL)) : null);
      show(OUT, T);
      await waitFor(() => expect(noticeCause()).toBe('outside'));
      expect(noticeLines()).toEqual(['This file is outside the folders this session works in on studio.', THREE_WAYS, ASK_AGENT, OUT, `Not opened: ${OUTSIDE_REFUSAL}`]);
      expect(block()!.querySelector('[data-notice-copy]')).not.toBeNull();

      cleanup();
      useViewer.getState().reset();
      main.answers.by = (name) => (name === 'files.read' ? refused('Not opened: only studio’s owners can', 'owners-only') : null);
      show(OUT, T);
      await waitFor(() => expect(noticeCause()).toBe('said'));
      expect(noticeLines()).toEqual(['Not opened: only studio’s owners can', OUT]); // no small line: it would say the same
      expect(retry()).toBeNull();
    });

    it('decision 20: a folder macOS protects there keeps U6f’s sentence and Open it inside the notice’s block; the failure is kept whole', async () => {
      const main = disk({ '/elsewhere/Documents/rota.txt': 'x\n' });
      main.answers.by = (name) => (name === 'files.read' ? refused('Not opened: the file is in a folder macOS protects on studio', 'protected') : null);
      show('/elsewhere/Documents/rota.txt', T);
      await waitFor(() => expect(noticeCause()).toBe('protected'));
      expect(block()!.getAttribute('role')).toBe('alert');
      expect(block()!.querySelector('p')!.textContent).toBe('This file is in a folder macOS protects on studio. Opening it may show a privacy prompt on studio’s own screen.');
      expect(within(block()!).getByRole('button', { name: 'Open it' })).toBeTruthy();
      expect(retry()).toBeNull();
      expect(shown('/elsewhere/Documents/rota.txt', T)!.failure).toEqual({ code: 'internal', message: 'Not opened: the file is in a folder macOS protects on studio', refusal: 'protected' });
    });
  });
});
