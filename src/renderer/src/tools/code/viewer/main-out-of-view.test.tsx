// A framed file in a main-area tab while the main area is not on screen (UX wave U6b-2,
// docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, "What a frame keeps and loses", the row "A hide";
// Decision Log 29 and 35): the shell keeps the main area mounted while the side column is maximized or floating over
// it, while the side column is a sheet over a narrow window, and while a page covers it, and the file's frame element is
// not in the document then. Shown again, a video or a sound is at the time it left, paused; a page or a PDF is a new
// element from the same token; a named file is read again. The real shell with the file viewer in its slot; main's
// commands are the fake disk's (`installDisk`); every path and byte here is invented.
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { frameUrl } from '@shared/files/framed';
import { TEST_MACHINE } from '../../../../../../test/support/machine';
import { record } from '../../../../../../test/support/builders';
import { Shell } from '../../../app/Shell';
import { registerSlot, resetSlots } from '../../../app/slots';
import { connectCodeEvents } from '../../../ipc/events';
import { registerPanelTool } from '../../../panel/host';
import { PanelHost } from '../../../panel/PanelHost';
import { queryClient } from '../../../ipc/query';
import { useLayout } from '../../../stores/layout';
import { useSessions } from '../../../stores/sessions';
import { installDisk, type DiskOptions } from '../../../test-support/code-disk';
import { A, probeTool, ref, resetPanelStores } from '../../../test-support/panel';
import { resetShellStores } from '../../../test-support/shell-stores';
import { useFiles } from '../files/store';
import { openFile, resetKeptOpens } from '../open-file';
import { FileViewer } from './FileViewer';
import { useViewer } from './viewer-store';

const VIDEO = '/r/tide.webm';
const SOUND = '/r/bell.wav';
const PDF = '/r/ledger.pdf';
const PAGE = '/r/notes.html';
const NAMED = '/elsewhere/minutes.pdf';
const FILES = { [VIDEO]: 'invented clip bytes', [SOUND]: 'invented sound bytes', [PDF]: '%PDF-1.4 invented\n', [PAGE]: '<p>Kassenbuch</p>', [NAMED]: '%PDF-1.4 invented, named\n' };
const NAMES: DiskOptions = { outside: ['/elsewhere'], names: (_, path) => path === NAMED };

const KEY = (path: string) => `file:${TEST_MACHINE}:${path}`;
const entry = (path: string) => useViewer.getState().entries.get(KEY(path));
const mainRegion = () => document.querySelector<HTMLElement>('[data-region="main"]')!;
const inMain = (selector: string) => mainRegion().querySelector<HTMLElement>(selector);
const ELEMENTS = 'iframe, video, audio';
// happy-dom's window, resized as a person resizes the app's (it dispatches `resize`)
const setWindowWidth = (width: number) => (window as unknown as { happyDOM: { setWindowSize(size: { width: number }): void } }).happyDOM.setWindowSize({ width });

// UX wave U6b-2: happy-dom knows no `maws-artifact:` scheme, so a file's frame only takes its URL (child-frame navigation off)
beforeAll(() => void ((window as unknown as { happyDOM: { settings: { navigation: { disableChildFrameNavigation: boolean } } } }).happyDOM.settings.navigation.disableChildFrameNavigation = true));
const offs: (() => void)[] = [];
let disk: ReturnType<typeof installDisk>;
beforeEach(() => {
  setWindowWidth(1440); // the app window's default size
  resetPanelStores();
  resetShellStores();
  resetKeptOpens();
  useViewer.getState().reset();
  useFiles.getState().reset();
  disk = installDisk({ ...FILES }, NAMES);
  // a side surface beside A's chat, so the side column can be maximized, floating or a sheet over the main area
  offs.push(registerPanelTool(probeTool('background').tool), connectCodeEvents());
  registerSlot('panelHost', PanelHost);
  registerSlot('fileTab', FileViewer);
  useSessions.setState({ records: new Map([[A, record(A)]]) });
  useLayout.setState({ panelBySession: new Map([[A, { tabs: [ref('background:aaaaaaaa')], activeTabId: 'background:aaaaaaaa' }]]) });
});
afterEach(() => {
  cleanup();
  resetSlots();
  offs.splice(0).forEach((off) => off());
  resetKeptOpens();
  vi.restoreAllMocks();
});

// `path` in a main-area tab in front, its frame drawn
async function openInMain(path: string) {
  render(
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>,
  );
  act(() => void openFile(A, path, null, { main: true }));
  await waitFor(() => expect(inMain(`[data-file-viewer][data-path="${path}"]`)).not.toBeNull());
  await waitFor(() => expect(entry(path)?.frame?.status).toBe('ready'));
}

// The three causes that take the main area off screen and keep it mounted, each with its showing again
const HIDES = {
  'the side column maximized over it': { hide: () => useLayout.getState().setPanel({ maximized: true }), show: () => useLayout.getState().setPanel({ maximized: false }) },
  'the side column floating over it': { hide: () => useLayout.getState().setPanel({ floating: true }), show: () => useLayout.getState().setPanel({ floating: false }) },
  'the side column a sheet over a narrow window': { hide: () => setWindowWidth(600), show: () => setWindowWidth(1440) },
  'a page covering it': { hide: () => useLayout.setState({ destination: { kind: 'library' } }), show: () => useLayout.setState({ destination: null }) },
};
const each = Object.keys(HIDES) as (keyof typeof HIDES)[];
function hide(how: keyof typeof HIDES) {
  act(() => HIDES[how].hide());
  expect(inMain('[data-file-viewer]'), 'the main area stays mounted').not.toBeNull();
  // what the shell says of the main area: inert, or behind an inert page wrapper
  expect(mainRegion().inert || mainRegion().querySelector<HTMLElement>('[data-behind-page]')!.inert, 'the main area off screen').toBe(true);
}
const show = (how: keyof typeof HIDES) => act(() => HIDES[how].show());

describe('a framed file in the main area while the main area is not on screen', () => {
  it.each(each.flatMap((how) => [[how, VIDEO, 'video'] as const, [how, SOUND, 'audio'] as const]))('with %s, no element of %s is in the document; shown again its %s is at the time it left, paused', async (how, path, tag) => {
    const play = vi.spyOn(window.HTMLMediaElement.prototype, 'play');
    await openInMain(path);
    const media = inMain(tag) as HTMLMediaElement;
    expect(media).not.toBeNull();
    Object.defineProperty(media, 'currentTime', { value: 12.5, writable: true, configurable: true });
    fireEvent.timeUpdate(media);
    hide(how);
    expect(document.querySelector(ELEMENTS), 'no frame, video or audio element').toBeNull();
    show(how);
    const shown = await waitFor(() => {
      const element = inMain(tag) as HTMLMediaElement | null;
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

  it.each(each.flatMap((how) => [[how, PDF] as const, [how, PAGE] as const]))('with %s, no frame of %s is in the document; shown again it is a new element from the same token', async (how, path) => {
    await openInMain(path);
    const frame = inMain('iframe')!;
    expect(frame).not.toBeNull();
    const src = frame.getAttribute('src');
    hide(how);
    expect(document.querySelector(ELEMENTS)).toBeNull();
    show(how);
    const shown = await waitFor(() => {
      const element = inMain('iframe');
      expect(element).not.toBeNull();
      return element!;
    });
    expect(shown).not.toBe(frame);
    expect(shown.getAttribute('src')).toBe(src);
    expect(disk.callsOf('layout.frameFile')).toHaveLength(1);
    expect(disk.callsOf('files.read')).toHaveLength(1);
  });

  it.each(each)('with %s, a named file is read again on show: a new token and its frame', async (how) => {
    await openInMain(NAMED);
    expect(entry(NAMED)?.named).toBe(true);
    expect(disk.callsOf('files.read')).toHaveLength(1);
    hide(how);
    expect(document.querySelector(ELEMENTS)).toBeNull();
    expect(disk.callsOf('files.read')).toHaveLength(1); // nothing read while hidden
    show(how);
    await waitFor(() => expect(inMain('iframe')?.getAttribute('src')).toBe(`${frameUrl(disk.issued[1]!, 'minutes.pdf')}#navpanes=0`));
    expect(disk.callsOf('files.read')).toHaveLength(2);
    expect(disk.callsOf('layout.frameFile')).toHaveLength(2);
    await waitFor(() => expect(disk.released()).toEqual([disk.issued[0]]));
  });
});
