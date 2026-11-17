// A framed file beside the chat that is not in view (UX wave U6b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md,
// "What a frame keeps and loses", the row "A hide"; Decision Log 29): with the Files tree standing in the file's place, or
// with the panel collapsed, the file's body stays mounted, and its frame's element is not in the document. Shown again, a
// video or a sound is at the time it left, paused; an HTML page or a PDF is a new element; a named file is read again. Main's
// commands are the fake disk's (`installDisk`); every path and byte here is invented.
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { frameUrl } from '@shared/files/framed';
import { TEST_MACHINE } from '../../../../../../test/support/machine';
import { connectCodeEvents } from '../../../ipc/events';
import { registerPanelTool } from '../../../panel/host';
import { useLayout } from '../../../stores/layout';
import { installDisk, type DiskOptions } from '../../../test-support/code-disk';
import { A, resetPanelStores, TestHost } from '../../../test-support/panel';
import { openFile, resetKeptOpens } from '../open-file';
import { useViewer } from '../viewer/viewer-store';
import { filesTool } from './FilesTool';
import { useFiles } from './store';
import { resetTreeState } from './tree-state';

const VIDEO = '/r/tide.webm';
const SOUND = '/r/bell.wav';
const PDF = '/r/ledger.pdf';
const PAGE = '/r/notes.html';
const NAMED = '/elsewhere/minutes.pdf';
const FILES = { [VIDEO]: 'invented clip bytes', [SOUND]: 'invented sound bytes', [PDF]: '%PDF-1.4 invented\n', [PAGE]: '<p>Kassenbuch</p>', [NAMED]: '%PDF-1.4 invented, named\n' };
const NAMES: DiskOptions = { outside: ['/elsewhere'], names: (_, path) => path === NAMED };

const KEY = (path: string) => `file:${TEST_MACHINE}:${path}`;
const entry = (path: string) => useViewer.getState().entries.get(KEY(path));
const ELEMENTS = 'iframe, video, audio';
const toggle = () => document.querySelector<HTMLElement>('[data-files-tree-toggle]')!;
const treePlace = () => document.querySelector('[data-files-tree]')?.getAttribute('data-place') ?? null;

// UX wave U6b-2: happy-dom knows no `maws-artifact:` scheme, so a file's frame only takes its URL (child-frame navigation off)
beforeAll(() => void ((window as unknown as { happyDOM: { settings: { navigation: { disableChildFrameNavigation: boolean } } } }).happyDOM.settings.navigation.disableChildFrameNavigation = true));
const offs: (() => void)[] = [];
let disk: ReturnType<typeof installDisk>;
beforeEach(() => {
  resetPanelStores();
  resetKeptOpens();
  resetTreeState();
  useViewer.getState().reset();
  useFiles.getState().reset();
  disk = installDisk({ ...FILES }, NAMES);
  offs.push(registerPanelTool(filesTool), connectCodeEvents());
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
  resetKeptOpens();
  vi.restoreAllMocks();
});

// `path` beside A's chat, its frame drawn
async function openBeside(path: string) {
  act(() => void openFile(A, path, null));
  await waitFor(() => expect(document.querySelector('[data-files-tab]')?.getAttribute('data-file')).toBe(path));
  await waitFor(() => expect(entry(path)?.frame?.status).toBe('ready'));
}

// The two hides that keep the file's body mounted, each with its showing again. A tab of happy-dom measures 0 wide, too
// narrow for the tree and the file both, so the tree's button shows the tree in the file's place.
const HIDES = {
  'the tree in the file’s place': {
    hide: () => {
      fireEvent.click(toggle());
      expect(treePlace()).toBe('instead');
    },
    show: () => {
      fireEvent.click(toggle());
      expect(treePlace()).toBeNull();
    },
  },
  'the panel collapsed': {
    hide: () => act(() => useLayout.getState().setPanel({ collapsed: true })),
    show: () => act(() => useLayout.getState().setPanel({ collapsed: false })),
  },
};
const each = Object.keys(HIDES) as (keyof typeof HIDES)[];

describe('a framed file beside the chat that is not in view', () => {
  it.each(each.flatMap((hide) => [[hide, VIDEO, 'video'] as const, [hide, SOUND, 'audio'] as const]))('with %s, no element of %s is in the document; shown again its %s is at the time it left, paused', async (how, path, tag) => {
    const play = vi.spyOn(window.HTMLMediaElement.prototype, 'play');
    render(<TestHost />);
    await openBeside(path);
    const media = document.querySelector<HTMLMediaElement>(tag)!;
    expect(media).not.toBeNull();
    Object.defineProperty(media, 'currentTime', { value: 12.5, writable: true, configurable: true });
    fireEvent.timeUpdate(media);
    HIDES[how].hide();
    expect(document.querySelector('[data-file-viewer]'), 'the file’s body stays mounted').not.toBeNull();
    expect(document.querySelector(ELEMENTS), 'no frame, video or audio element').toBeNull();
    HIDES[how].show();
    const shown = await waitFor(() => {
      const element = document.querySelector<HTMLMediaElement>(tag);
      expect(element).not.toBeNull();
      return element!;
    });
    expect(shown).not.toBe(media);
    Object.defineProperty(shown, 'currentTime', { value: 0, writable: true, configurable: true });
    if (tag === 'video') Object.defineProperties(shown, { videoWidth: { value: 160 }, videoHeight: { value: 120 } });
    fireEvent.loadedMetadata(shown);
    expect(shown.currentTime).toBe(12.5);
    expect(shown.paused).toBe(true);
    expect(play).not.toHaveBeenCalled();
  });

  it.each(each.flatMap((hide) => [[hide, PDF] as const, [hide, PAGE] as const]))('with %s, no frame of %s is in the document; shown again it is a new element from the same token', async (how, path) => {
    render(<TestHost />);
    await openBeside(path);
    const frame = document.querySelector('iframe')!;
    expect(frame).not.toBeNull();
    const src = frame.getAttribute('src');
    HIDES[how].hide();
    expect(document.querySelector(ELEMENTS)).toBeNull();
    HIDES[how].show();
    const shown = await waitFor(() => {
      const element = document.querySelector('iframe');
      expect(element).not.toBeNull();
      return element!;
    });
    expect(shown).not.toBe(frame);
    expect(shown.getAttribute('src')).toBe(src);
    expect(disk.callsOf('layout.frameFile')).toHaveLength(1);
    expect(disk.callsOf('files.read')).toHaveLength(1);
  });

  it.each(each)('with %s, a named file is read again on show: a new token and its frame', async (how) => {
    render(<TestHost />);
    await openBeside(NAMED);
    expect(entry(NAMED)?.named).toBe(true);
    expect(disk.callsOf('files.read')).toHaveLength(1);
    HIDES[how].hide();
    expect(document.querySelector(ELEMENTS)).toBeNull();
    expect(disk.callsOf('files.read')).toHaveLength(1); // nothing read while hidden
    HIDES[how].show();
    await waitFor(() => expect(document.querySelector('iframe')?.getAttribute('src')).toBe(`${frameUrl(disk.issued[1]!, 'minutes.pdf')}#toolbar=0&navpanes=0`));
    expect(disk.callsOf('files.read')).toHaveLength(2);
    expect(disk.callsOf('layout.frameFile')).toHaveLength(2);
    await waitFor(() => expect(disk.released()).toEqual([disk.issued[0]]));
  });
});
