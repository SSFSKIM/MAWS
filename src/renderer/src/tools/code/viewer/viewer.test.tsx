// The file viewer (C8c execution document, M2): the kind decision and its caps, the data URL by encoding, the line jump's
// target, and the `fileTab` slot over a fake X2 client (a refusal in words, continuation reads, the line jump, Source,
// the follow-the-file refresh, the no-session tab).
import { EditorView } from '@codemirror/view';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mimeOf } from '@shared/files/mime';
import type { AppSessionId } from '@shared/graph/ids';
import { FILES_READ_DEFAULT_LENGTH } from '@shared/ipc/schema/files';
import { LAYOUT_DEFAULTS, type TabRef } from '@shared/ipc/schema/layout';
import { record } from '../../../../../../test/support/builders';
import { connectCodeEvents } from '../../../ipc/events';
import { useLayout } from '../../../stores/layout';
import { useSessions } from '../../../stores/sessions';
import type { TranscriptEntry } from '../../../stores/transcript';
import { useTranscriptStore, type TurnId } from '../../../transcript';
import { deferred, fail, installFakeMain, ok } from '../../../test-support/code';
import { useFiles } from '../files/store';
import { codeTranscriptActions, normalizeLexically, openFile, sessionOfTurn } from '../open-file';
import { FLASH_CLASS } from './CodeView';
import { FileViewer } from './FileViewer';
import { CODE_CAP, dataUrl, externalKindOf, IMAGE_CAP, jumpTarget, kindOf, MARKDOWN_RENDER_CAP } from './kinds';
import { useViewer, VIEWER_ENTRIES_MAX } from './viewer-store';
import { currentSet } from '../../../stores/layout-model';

const text = { encoding: 'utf8' as const };
const binary = { encoding: 'base64' as const };

describe('viewer kinds', () => {
  it('decides every row of the table', () => {
    expect(kindOf({ name: '/r/README.md', mime: 'text/markdown', bytes: 10, ...text })).toBe('markdown');
    expect(kindOf({ name: '/r/a.mdx', mime: 'text/markdown', bytes: 10, ...text })).toBe('markdown');
    expect(kindOf({ name: '/r/a.markdown', mime: 'text/plain', bytes: 10, ...text })).toBe('markdown');
    expect(kindOf({ name: '/r/dot.png', mime: 'image/png', bytes: 70, ...binary })).toBe('image');
    expect(kindOf({ name: '/r/label.svg', mime: 'image/svg+xml', bytes: 300, ...text })).toBe('image');
    expect(kindOf({ name: '/r/doc.pdf', mime: 'application/pdf', bytes: 30, ...binary })).toBe('external');
    expect(kindOf({ name: '/r/page.html', mime: 'text/html', bytes: 30, ...text })).toBe('external');
    expect(kindOf({ name: '/r/a.mp3', mime: 'audio/mpeg', bytes: 30, ...binary })).toBe('external');
    expect(kindOf({ name: '/r/a.mov', mime: 'video/quicktime', bytes: 30, ...binary })).toBe('external');
    expect(kindOf({ name: '/r/data.bin', mime: 'application/octet-stream', bytes: 12, ...binary })).toBe('external');
    expect(kindOf({ name: '/r/scan.tiff', mime: 'image/tiff', bytes: 30, ...binary })).toBe('external'); // not drawable inline
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

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;
const MiB = 1024 * 1024;

// A file main serves: text (ASCII, so a byte is a character), a binary image, a file generated on demand (too large to
// hold), or a refusal message.
type Served = string | { text: string; mime?: string } | { base64: string; bytes: number; mime?: string } | { refusal: string } | { generated: number; line: string };

function serve(files: Record<string, Served>, gate?: (offset: number) => Promise<void>) {
  return installFakeMain(async (name, input) => {
    if (name === 'files.watch' || name === 'files.unwatch') return ok();
    if (name === 'files.openExternal') return ok({ opened: true, message: null });
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
    if ('base64' in served) return ok({ encoding: 'base64', content: served.base64, bytes: served.bytes, offset: 0, length: served.bytes, truncated: false, mime });
    const bytes = 'text' in served ? served.text.length : served.generated;
    const end = Math.min(bytes, offset + length);
    const content = 'text' in served ? served.text.slice(offset, end) : served.line.repeat(Math.ceil((end - offset) / served.line.length)).slice(0, end - offset);
    return ok({ encoding: 'utf8', content, bytes, offset, length: end - offset, truncated: end < bytes, mime });
  });
}

const fileTab = (path: string, line: number | null = null, appSessionId: AppSessionId | null = A): Extract<TabRef, { kind: 'file' }> => ({
  id: `file:${path}`,
  kind: 'file',
  path,
  line,
  appSessionId,
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
    useLayout.setState({ main: LAYOUT_DEFAULTS.main });
  });
  afterEach(() => {
    cleanup();
    offs.splice(0).forEach((off) => off());
  });

  it('renders a refusal in words with the path, and reads no more than once', async () => {
    const main = serve({ '/r/secret': { refusal: "path outside the session's directories" } });
    render(<FileViewer tab={fileTab('/r/secret')} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Refused: path outside the session's directories");
    expect(alert.textContent).toContain('/r/secret');
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(main.callsOf('files.read')).toHaveLength(1);
    expect(main.callsOf('files.watch')).toEqual([{ appSessionId: A, path: '/r' }]); // the file's directory, watched before the read
  });

  it('opens code at the line, centred and flashed, and jumps again when the line changes', async () => {
    serve({ '/r/app.ts': lines(60, (n) => `export const line${n} = ${n};`) });
    const { rerender } = render(<FileViewer tab={fileTab('/r/app.ts', 25)} />);
    await waitFor(() => expect(flashed()).toBe('export const line25 = 25;'));
    expect(document.querySelector('[data-code-view]')?.getAttribute('data-language')).toBe('TypeScript');
    rerender(<FileViewer tab={fileTab('/r/app.ts', 40)} />);
    await waitFor(() => expect(flashed()).toBe('export const line40 = 40;'));
    expect(useViewer.getState().entries.get('file:/r/app.ts')?.pendingJump).toBeNull();
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
    const entry = useViewer.getState().entries.get('file:/r/generated.ts')!;
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
      return ok({ encoding: 'utf8', content: text.slice(offset, end), bytes: text.length, offset, length: end - offset, truncated: end < text.length, mime: 'text/plain' });
    });
    refuse = true;
    render(<FileViewer tab={fileTab('/r/half.txt')} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Refused: path outside the session's directories");
    expect(useViewer.getState().entries.get('file:/r/half.txt')?.text).toBe('');
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

  it('offers Open externally for a PDF and only the size for a binary MAWS will not hand out', async () => {
    const main = serve({ '/r/doc.pdf': { base64: 'JVBERi0xLjQ=', bytes: 30 }, '/r/data.bin': { base64: 'AAEC', bytes: 12, mime: 'application/octet-stream' } });
    const { unmount } = render(<FileViewer tab={fileTab('/r/doc.pdf')} />);
    expect((await screen.findByText('PDF files open outside MAWS')).tagName).toBe('P');
    fireEvent.click(screen.getByRole('button', { name: 'Open externally' }));
    await waitFor(() => expect(main.callsOf('files.openExternal')).toEqual([{ appSessionId: A, path: '/r/doc.pdf' }]));
    expect(document.querySelector('iframe, embed, object')).toBeNull();
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
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(notice()).toBe('Showing the first 2.0 MB of 20.0 MB'));
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
    act(() => main.emit('files.changed', { appSessionId: A, path: '/private/r/app.ts', kind: 'changed' })); // realpath spelling
    await waitFor(() => expect(codeText()).toBe('const a = 2;'));
    expect(document.querySelector('[data-updated]')?.textContent).toBe('Updated');
    expect(flashed()).toBeNull();
    delete files['/r/app.ts'];
    act(() => main.emit('files.changed', { appSessionId: A, path: '/r/app.ts', kind: 'removed' }));
    await waitFor(() => expect(notice()).toBe('File removed'));
    expect(codeText()).toBe('const a = 2;');
  });

  it('does not take an event for a file that merely ends like its own', async () => {
    const main = serve({ '/r/app.ts': 'x\n' });
    connect();
    render(<FileViewer tab={fileTab('/r/app.ts')} />);
    await waitFor(() => expect(codeText()).toBe('x'));
    act(() => main.emit('files.changed', { appSessionId: A, path: '/x/r/app.ts', kind: 'removed' }));
    act(() => main.emit('files.changed', { appSessionId: A, path: '/x/r', kind: 'changed' }));
    act(() => main.emit('files.changed', { appSessionId: A, path: '/x/r', kind: 'invalidated' }));
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
    act(() => main.emit('files.changed', { appSessionId: A, path: '/r/big.log', kind: 'changed' }));
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
  const loadMore = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Load more' });
  const bigLog = () => useViewer.getState().entries.get('file:/r/big.log')!;

  it('enables Load more again when a follow-the-file re-read supersedes its read, and the next Load more lands once', async () => {
    const { main, gated } = gatedHead();
    connect();
    render(<FileViewer tab={fileTab('/r/big.log')} />);
    await waitFor(() => expect(notice()).toBe('Showing the first 1.0 MB of 20.0 MB'));
    const superseded = gated(MiB);
    fireEvent.click(loadMore());
    await waitFor(() => expect(loadMore().disabled).toBe(true));
    act(() => main.emit('files.changed', { appSessionId: A, path: '/r/big.log', kind: 'changed' }));
    await waitFor(() => expect(document.querySelector('[data-updated]')).not.toBeNull());
    expect(loadMore().disabled).toBe(false);
    fireEvent.click(loadMore());
    await waitFor(() => expect(notice()).toBe('Showing the first 2.0 MB of 20.0 MB'));
    await act(async () => superseded.resolve()); // its answer lands nowhere
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(bigLog()).toMatchObject({ loaded: 2 * MiB, loadingMore: false });
    expect(bigLog().text).toHaveLength(2 * MiB);
  });

  it('drops a Load more answer whose text a re-read replaced while it was in flight', async () => {
    const { main, gated } = gatedHead();
    connect();
    render(<FileViewer tab={fileTab('/r/big.log')} />);
    await waitFor(() => expect(notice()).toBe('Showing the first 1.0 MB of 20.0 MB'));
    const reread = gated(0);
    act(() => main.emit('files.changed', { appSessionId: A, path: '/r/big.log', kind: 'changed' }));
    await waitFor(() => expect(main.callsOf('files.read')).toHaveLength(2));
    const outrun = gated(MiB);
    fireEvent.click(loadMore()); // asked while the re-read is in flight: the same load, the old text
    await waitFor(() => expect(loadMore().disabled).toBe(true));
    await act(async () => reread.resolve());
    await waitFor(() => expect(document.querySelector('[data-updated]')).not.toBeNull());
    expect(loadMore().disabled).toBe(false);
    fireEvent.click(loadMore());
    await waitFor(() => expect(notice()).toBe('Showing the first 2.0 MB of 20.0 MB'));
    await act(async () => outrun.resolve());
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
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
      return ok({ encoding: 'utf8', content: text.slice(offset, end), bytes: text.length, offset, length: end - offset, truncated: end < text.length, mime: 'text/plain' });
    });
    connect();
    render(<FileViewer tab={fileTab('/r/log.txt')} />);
    await waitFor(() => expect(useViewer.getState().entries.get('file:/r/log.txt')?.complete).toBe(true));
    gone = true;
    act(() => main.emit('files.changed', { appSessionId: A, path: '/r/log.txt', kind: 'changed' }));
    await waitFor(() => expect(notice()).toBe('File removed'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(useViewer.getState().entries.get('file:/r/log.txt')?.text).toBe(text);
  });

  it('lets no load of a pruned tab land in the entry that replaced it', async () => {
    const gates = [deferred<void>(), deferred<void>()];
    let reads = 0;
    const answers = ['old\n', 'new\n'];
    installFakeMain(async (name) => {
      if (name !== 'files.read') return ok();
      const n = reads++;
      await gates[n].promise;
      return ok({ encoding: 'utf8', content: answers[n], bytes: 4, offset: 0, length: 4, truncated: false, mime: 'text/plain' });
    });
    openFile(A, '/r/a.txt');
    const first = render(<FileViewer tab={fileTab('/r/a.txt')} />);
    await waitFor(() => expect(reads).toBe(1));
    first.unmount();
    act(() => useLayout.getState().closeTab('file:/r/a.txt')); // pruned while its read is in flight
    expect(useViewer.getState().entries.has('file:/r/a.txt')).toBe(false);
    openFile(A, '/r/a.txt');
    render(<FileViewer tab={fileTab('/r/a.txt')} />);
    await waitFor(() => expect(reads).toBe(2));
    await act(async () => gates[1].resolve());
    await waitFor(() => expect(codeText()).toBe('new'));
    await act(async () => gates[0].resolve());
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(useViewer.getState().entries.get('file:/r/a.txt')?.text).toBe('new\n');
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
    act(() => main.emit('files.changed', { appSessionId: A, path: '/r', kind: 'invalidated' }));
    await waitFor(() => expect(main.calls.map((c) => c.name)).toEqual(['files.watch', 'files.read']));
  });

  it('a tab with no session, or one main does not know, says so and reads nothing', async () => {
    const main = serve({ '/r/a.ts': { refusal: 'unknown app session: app-z' } });
    openFile(null, '/r/../r/./a.ts', 3);
    const tab = currentSet(useLayout.getState().main).panes[0].tabs.find((t) => t.kind === 'file') as Extract<TabRef, { kind: 'file' }>;
    expect(tab).toMatchObject({ path: '/r/a.ts', line: 3, appSessionId: null });
    const { unmount } = render(<FileViewer tab={tab} />);
    expect(screen.getByText('No session grants access to this file')).toBeTruthy();
    expect(main.callsOf('files.read')).toHaveLength(0);
    unmount();
    render(<FileViewer tab={fileTab('/r/a.ts', null, 'app-z' as AppSessionId)} />);
    expect(await screen.findByText('No session grants access to this file')).toBeTruthy();
  });

  it('prunes the state of a tab the layout dropped and keeps at most twenty', async () => {
    serve(Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`/r/f${i}.ts`, `${i}\n`])));
    for (let i = 0; i < 25; i++) openFile(A, `/r/f${i}.ts`);
    for (let i = 0; i < 25; i++) {
      const { unmount } = render(<FileViewer tab={fileTab(`/r/f${i}.ts`)} />);
      unmount();
    }
    expect(useViewer.getState().entries.size).toBe(VIEWER_ENTRIES_MAX);
    expect(useViewer.getState().entries.has('file:/r/f0.ts')).toBe(false); // the least recently used went first
    act(() => useLayout.getState().closeTab('file:/r/f24.ts'));
    expect(useViewer.getState().entries.has('file:/r/f24.ts')).toBe(false);
  });
});

describe('open file', () => {
  beforeEach(() => useLayout.setState({ main: LAYOUT_DEFAULTS.main }));

  it('normalises a path lexically before opening its tab', () => {
    expect(normalizeLexically('/r/src/../README.md')).toBe('/r/README.md');
    expect(normalizeLexically('/r//a/./b/')).toBe('/r/a/b');
    expect(normalizeLexically('/../etc')).toBe('/etc');
    expect(normalizeLexically('a/../../b')).toBe('../b');
  });

  it("codeTranscriptActions.openFile opens the tab for the focused pane's session", () => {
    useLayout.getState().openTab({ kind: 'session', appSessionId: B });
    codeTranscriptActions.openFile('/w/x.ts', 7);
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
