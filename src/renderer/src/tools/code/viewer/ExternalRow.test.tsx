// P5 O7 M4: the viewer's Open externally on a lane B session on another machine would open the file on that machine's
// desktop. P5 O7 M5a (A10): it opens a copy of the file here instead (`remote.openCopy`), saying where the file is; a
// local session's opens as before. UX wave U6c (M3, Interfaces §E): a session on this Mac asks with `named`, so a file
// outside its folders that its transcript names opens; a session on another machine is asked as today.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { REMOTE_COPY_MAX_BYTES } from '@shared/ipc/schema/remote';
import { addressOf } from '@shared/machine/address';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../../../test/support/machine';
import { ipc } from '../../../ipc/client';
import { applyRemoteSession, resetRemoteLaneBStore } from '../../../lane-b/remote-session';
import { remoteSessionState } from '../../../lane-b/test-support/remote-session';
import { useLayout } from '../../../stores/layout';
import { useMachines } from '../../../stores/machines';
import { ok } from '../../../test-support/code';
import { installDisk, leaveRl2, overRl2 } from '../../../test-support/code-disk';
import { formatSize, VIEWER_COPY } from '../copy';
import { useFiles } from '../files/store';
import { forgetOpenedThere, openedThere } from '../files/elsewhere';
import { ExternalRow, OpenExternally, rowWords } from './ExternalRow';
import { FileViewer } from './FileViewer';
import { useViewer, type EntryFrame, type ViewerEntry } from './viewer-store';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetRemoteLaneBStore();
  useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
});

describe('Open externally', () => {
  it('opens a copy here of a file of another machine’s lane B session, saying where the file is', () => {
    const invoke = vi.spyOn(ipc, 'invoke').mockResolvedValue({ ok: true, value: { opened: true, message: null } } as never);
    const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    useMachines.getState().applyRoster([
      { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-10-31T10:00:00Z', generation: 0 },
      { ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-10-31T10:00:00Z', generation: 0 },
    ]);
    applyRemoteSession(remoteSessionState(REMOTE));
    render(<OpenExternally appSessionId={REMOTE} path="/r/doc.pdf" />);
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Open externally' });
    expect(button.disabled).toBe(false);
    expect(button.title).toBe('Opens a copy of this file from mini on this Mac');
    expect(screen.getByText('on mini')).toBeTruthy();
    fireEvent.click(button);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('remote.openCopy', { machine: OTHER_MACHINE, source: { appSessionId: REMOTE, path: '/r/doc.pdf' } });
  });

  it('says why a copy was not opened', async () => {
    vi.spyOn(ipc, 'invoke').mockResolvedValue({ ok: true, value: { opened: false, message: 'too large to copy from mini' } } as never);
    const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    applyRemoteSession(remoteSessionState(REMOTE));
    render(<OpenExternally appSessionId={REMOTE} path="/r/big.mov" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open externally' }));
    expect((await screen.findByRole('alert')).textContent).toContain('too large to copy from mini');
  });

  it('opens a local session’s file, asking with named', () => {
    const invoke = vi.spyOn(ipc, 'invoke').mockResolvedValue({ ok: true, value: { opened: true, message: null } } as never);
    const LOCAL = addressOf(TEST_MACHINE, 'app-l' as AppSessionId);
    render(<OpenExternally appSessionId={LOCAL} path="/r/doc.pdf" />);
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Open externally' });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('files.openExternal', { appSessionId: LOCAL, path: '/r/doc.pdf', named: true });
  });

  // UX wave U6b-4b (M3; decision 9, L11): the line under the button reads the first sentence of the refusal's cause
  it.each([
    ['outside the folders', { code: 'internal', message: "path outside the session's directories" }, 'This file is outside the folders this session works in.'],
    ['gone', { code: 'internal', message: 'not found: /r/doc.pdf' }, 'No file at this path.'],
    ['this Mac’s service not answering', { code: 'host_unavailable', message: 'files.openExternal: the files service is not running' }, "MAWS's service on this Mac is not answering."],
  ] as const)('a refused open of a local session’s file (%s) reads the first sentence of its cause', async (_, error, sentence) => {
    vi.spyOn(ipc, 'invoke').mockResolvedValue({ ok: false, error } as never);
    render(<OpenExternally appSessionId={addressOf(TEST_MACHINE, 'app-l' as AppSessionId)} path="/r/doc.pdf" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open externally' }));
    expect((await screen.findByRole('alert')).textContent).toBe(sentence);
  });

  it('asks without named for a session on another machine that MAWS does not run there', () => {
    const invoke = vi.spyOn(ipc, 'invoke').mockResolvedValue({ ok: true, value: { opened: true, message: null } } as never);
    const TERMINAL = addressOf(OTHER_MACHINE, 'app-t' as AppSessionId); // no lane B state for it: not a session MAWS runs there
    render(<OpenExternally appSessionId={TERMINAL} path="/r/doc.pdf" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open externally' }));
    expect(invoke).toHaveBeenCalledExactlyOnceWith('files.openExternal', { appSessionId: TERMINAL, path: '/r/doc.pdf' });
  });
});

// UX wave U6f, the branch review (sweep#1; Decision Log 33 (3)): for a session that takes the remote route, Open externally
// carries `open` under the rule a frame's ask follows: only for a path the person opened on that machine this run
// (`openedThere`), as the tab's own reads carry it.
describe('Open externally on another machine, a protected folder opened there (U6f)', () => {
  const T = addressOf(OTHER_MACHINE, 'app-there' as AppSessionId);
  const DOCS = '/home/someone/Documents';
  afterEach(() => {
    leaveRl2();
    forgetOpenedThere();
  });
  const opensWith = (path: string) => {
    const invoke = vi.spyOn(ipc, 'invoke').mockResolvedValue({ ok: true, value: { opened: true, message: null } } as never);
    render(<OpenExternally appSessionId={T} path={path} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open externally' }));
    return invoke;
  };

  it('sends open on the copy of a path under a folder the person opened on that machine this run', () => {
    overRl2(T);
    openedThere(OTHER_MACHINE).add(DOCS);
    expect(opensWith(`${DOCS}/minutes.pdf`)).toHaveBeenCalledExactlyOnceWith('remote.openCopy', { machine: OTHER_MACHINE, source: { appSessionId: T, path: `${DOCS}/minutes.pdf` }, open: true });
  });

  it('the negative case: no open for a path the person did not open there, nor for one that leaves the opened folder by ".."', () => {
    overRl2(T);
    openedThere(OTHER_MACHINE).add(DOCS);
    for (const path of ['/home/someone/Desktop/minutes.pdf', `${DOCS}/../Desktop/minutes.pdf`]) {
      expect(opensWith(path), path).toHaveBeenCalledExactlyOnceWith('remote.openCopy', { machine: OTHER_MACHINE, source: { appSessionId: T, path } });
      cleanup();
      vi.restoreAllMocks();
    }
  });
});

// UX wave U6b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, M5, decision 12; card 3, "True sentences
// now"): a row says why its file is not drawn, and offers Open externally only where the act can work.
describe('what a row says (rowWords)', () => {
  const MiB = 1024 * 1024;
  const LOCAL = addressOf(TEST_MACHINE, 'app-l' as AppSessionId);
  const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
  const TOO_LARGE = 'Too large to show here: MAWS copies at most 64.0 MB from another machine.';
  const entryOf = (over: Partial<ViewerEntry> & { frame?: EntryFrame | null } = {}): ViewerEntry => ({
    tabId: 'file:t:/r/tide.mov', appSessionId: LOCAL, artifact: null, path: '/r/tide.mov', status: 'ready', error: null, kind: 'frame', mime: 'video/quicktime', encoding: 'base64',
    bytes: 3 * MiB, loaded: 0, complete: true, text: '', epoch: 1, base64: null, removed: false, updated: 0, sourceView: false, line: null, pendingJump: null, loadingMore: false,
    hash: null, editable: false, dirty: false, saving: false, saveError: null, theirs: null, diskUnusable: null, baseline: 0, loads: 1, pending: 0, readOnly: false, named: false, frame: null,
    locked: null, pin: null, agent: false, textEditable: false, // UX wave U6e's fields of the entry
    said: false, needsOpen: false, offersOpenFile: false, saveSaid: false, // UX wave U6f's
    failure: null, retrying: false, // UX wave U6b-4b's
    ...over,
  });
  const openButton = () => screen.queryByRole('button', { name: 'Open externally' });

  it('a file of another machine past the copy’s bound: its sentence, its size, and no Open externally', () => {
    applyRemoteSession(remoteSessionState(REMOTE));
    const entry = entryOf({ appSessionId: REMOTE, bytes: 70 * MiB, frame: { status: 'row', why: 'too-large' } });
    expect(rowWords(entry)).toEqual({ sentence: TOO_LARGE, open: false });
    render(<ExternalRow entry={entry} />);
    expect(screen.getByText(TOO_LARGE).tagName).toBe('P');
    expect(screen.getByText('70.0 MB')).toBeTruthy();
    expect(openButton()).toBeNull();
  });

  it('a video the player cannot play: its sentence and Open externally', () => {
    const entry = entryOf({ frame: { status: 'row', why: 'unplayable', from: 'f'.repeat(32) } });
    expect(rowWords(entry)).toEqual({ sentence: 'This video can’t be played here.', open: true });
    render(<ExternalRow entry={entry} />);
    expect(screen.getByText('This video can’t be played here.')).toBeTruthy();
    expect(screen.getByText('3.0 MB')).toBeTruthy();
    expect(openButton()).not.toBeNull();
  });

  it('a sound the player cannot play: its sentence and Open externally', () => {
    const entry = entryOf({ path: '/r/bell.wav', mime: 'audio/wav', frame: { status: 'row', why: 'unplayable', from: 'f'.repeat(32) } });
    expect(rowWords(entry)).toEqual({ sentence: 'This sound can’t be played here.', open: true });
    render(<ExternalRow entry={entry} />);
    expect(screen.getByText('This sound can’t be played here.')).toBeTruthy();
    expect(openButton()).not.toBeNull();
  });

  it('a file of this Mac whose service cannot serve a frame: its sentence and Open externally', () => {
    const entry = entryOf({ path: '/r/ledger.pdf', mime: 'application/pdf', frame: { status: 'row', why: 'unserved' } });
    expect(rowWords(entry)).toEqual({ sentence: 'MAWS’s service on this Mac is an older version, so this file can’t be shown here yet.', open: true });
    render(<ExternalRow entry={entry} />);
    expect(screen.getByText('MAWS’s service on this Mac is an older version, so this file can’t be shown here yet.')).toBeTruthy();
    expect(openButton()).not.toBeNull();
  });

  it('the bound in the too-large sentence is the formatter’s, for another bound too', () => {
    expect(VIEWER_COPY.tooLargeHere(REMOTE_COPY_MAX_BYTES)).toBe(TOO_LARGE);
    expect(VIEWER_COPY.tooLargeHere(1536)).toBe(`Too large to show here: MAWS copies at most ${formatSize(1536)} from another machine.`);
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(rowWords(entryOf({ frame: { status: 'row', why: 'too-large' } })).sentence).toBe(VIEWER_COPY.tooLargeHere(REMOTE_COPY_MAX_BYTES));
  });

  it('a kind MAWS does not frame reads as it did', () => {
    const binary = entryOf({ kind: 'external', path: '/r/data.bin', mime: 'application/octet-stream', bytes: 12 });
    expect(rowWords(binary)).toEqual({ sentence: 'Binary file · 12 B', open: true });
    const { unmount } = render(<ExternalRow entry={binary} />);
    expect(screen.getByText('Binary file · 12 B')).toBeTruthy();
    expect(openButton()).toBeNull(); // files.openExternal would not hand it out
    unmount();
    const tiff = entryOf({ kind: 'external', path: '/r/scan.tiff', mime: 'image/tiff', bytes: 2048 });
    expect(rowWords(tiff)).toEqual({ sentence: 'Image files open outside MAWS', open: true });
    render(<ExternalRow entry={tiff} />);
    expect(screen.getByText('Image files open outside MAWS')).toBeTruthy();
    expect(screen.getByText('2.0 KB')).toBeTruthy();
    expect(openButton()).not.toBeNull();
  });

  it('an ask answered unframed draws the failure body, not a row', async () => {
    useViewer.getState().reset();
    useFiles.getState().reset();
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, hydrated: true });
    installDisk({ '/r/ledger.pdf': '%PDF-1.4 invented\n' }, { frames: () => ok({ status: 'row', why: 'unframed' }) });
    render(<FileViewer tab={{ id: 'file:t:/r/ledger.pdf', kind: 'file', path: '/r/ledger.pdf', line: null, appSessionId: LOCAL, machine: TEST_MACHINE, pinned: false }} />);
    await waitFor(() => expect(screen.getByText('This file stopped loading: it changed, or it can no longer be read.')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Open again' })).toBeTruthy();
    expect(document.querySelector('[data-external-row]')).toBeNull();
    useViewer.getState().reset();
  });
});
