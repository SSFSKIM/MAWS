// A framed file's body (UX wave U6b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, M5, decisions 3,
// 5, 7, 12, 14 and 15; sequences 4, 11 and 12): Loading while a token is asked, the frame main names once it is ready,
// the failure body with its button, and the row; Open externally in the bar of a drawn file; Chromium's PDF toolbar by
// the host the tab is drawn in; the line for a page that names files beside it; a media position across a hide. Main's
// commands and its event are the fake disk's (`installDisk`); every path and byte here is invented.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { frameUrl } from '@shared/files/framed';
import { LAYOUT_DEFAULTS, type TabRef } from '@shared/ipc/schema/layout';
import { at, TEST_MACHINE } from '../../../../../../test/support/machine';
import { connectCodeEvents } from '../../../ipc/events';
import { useLayout } from '../../../stores/layout';
import { ok } from '../../../test-support/code';
import { installDisk, type DiskOptions } from '../../../test-support/code-disk';
import { installResizeObserver } from '../../../test-support/resize';
import { useFiles } from '../files/store';
import { openFile } from '../open-file';
import { FileViewer } from './FileViewer';
import { useViewer } from './viewer-store';

// What the HTML frame is given, prop by prop (decision 13: no bridge): the real frame, drawn through a recorder.
const htmlProps = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('../../artifacts/viewers/frames/HtmlFrame', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../artifacts/viewers/frames/HtmlFrame')>();
  return {
    ...actual,
    HtmlFrame: (props: Parameters<typeof actual.HtmlFrame>[0]) => {
      htmlProps.push(props as unknown as Record<string, unknown>);
      return <actual.HtmlFrame {...props} />;
    },
  };
});

const MAIN_A = 'app-a' as AppSessionId;
const A = at(MAIN_A);
const FILE = (path: string) => `file:${TEST_MACHINE}:${path}`;
const PDF = '/r/ledger.pdf';
const PAGE = '/r/styled.html';
const VIDEO = '/r/tide.webm';
const SOUND = '/r/bell.wav';
const STOPPED = 'This file stopped loading: it changed, or it can no longer be read.';
const BESIDE = 'Shown without the files beside it';
const FILES = { [PDF]: '%PDF-1.4 invented\n', [PAGE]: '<link rel="stylesheet" href="ledger.css"><p>Kassenbuch</p>', '/r/alone.html': '<p>Kassenbuch</p>', [VIDEO]: 'invented clip bytes', [SOUND]: 'invented sound bytes' };

const fileTab = (path: string): Extract<TabRef, { kind: 'file' }> => ({ id: FILE(path), kind: 'file', path, line: null, appSessionId: A, machine: TEST_MACHINE, pinned: false });
const entry = (path = PDF) => useViewer.getState().entries.get(FILE(path));
const viewer = () => document.querySelector<HTMLElement>('[data-file-viewer]')!;
const bar = () => viewer().firstElementChild as HTMLElement;
const body = () => viewer().lastElementChild as HTMLElement;
const marker = () => viewer().getAttribute('data-frame');
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

// UX wave U6b-2: happy-dom knows no `maws-artifact:` scheme, so a file's frame only takes its URL (child-frame navigation off)
beforeAll(() => void ((window as unknown as { happyDOM: { settings: { navigation: { disableChildFrameNavigation: boolean } } } }).happyDOM.settings.navigation.disableChildFrameNavigation = true));
const offs: (() => void)[] = [];
beforeEach(() => {
  installResizeObserver();
  useViewer.getState().reset();
  useFiles.getState().reset();
  useLayout.setState({ main: LAYOUT_DEFAULTS.main, hydrated: true });
  htmlProps.splice(0);
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// The fake disk with main's events connected, and the file's main tab opened (so its entry outlives a hide) and drawn.
function disk(options: DiskOptions = {}) {
  const main = installDisk({ ...FILES }, options);
  offs.push(connectCodeEvents());
  return main;
}
const show = (path = PDF, host?: 'side' | 'main') => {
  act(() => void openFile(A, path, null, { main: true }));
  return render(<FileViewer tab={fileTab(path)} host={host} />);
};
const drawn = (path = PDF) => waitFor(() => expect(entry(path)?.frame?.status).toBe('ready'));

describe('what a framed file’s body draws', () => {
  it('draws Loading while its token is asked and nothing is drawn yet', async () => {
    const main = disk();
    main.hold('layout.frameFile');
    show();
    await waitFor(() => expect(main.callsOf('layout.frameFile')).toHaveLength(1));
    expect(marker()).toBe('loading');
    expect(within(body()).getByText('Loading')).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it.each([
    [PDF, 'pdf', '[data-artifact-frame="pdf"]', 'ledger.pdf'],
    [PAGE, 'html', '[data-artifact-frame="html"]', 'styled.html'],
    [VIDEO, 'video', 'video[data-artifact-media="video"]', 'tide.webm'],
    [SOUND, 'audio', 'audio[data-artifact-media="audio"]', 'bell.wav'],
  ])('draws %s in the frame main names, once its token is ready', async (path, framed, selector, name) => {
    const main = disk();
    show(path);
    await drawn(path);
    expect(marker()).toBe(framed);
    const element = body().querySelector(selector)!;
    expect(element).not.toBeNull();
    const url = frameUrl(main.issued[0]!, name);
    expect(element.getAttribute('src')).toBe(framed === 'pdf' ? `${url}#navpanes=0` : url);
    if (element.tagName === 'IFRAME') expect(element.getAttribute('title')).toBe(name); // the frame's name is the file's
  });

  it('draws the row for a file past the copy’s bound, with no Open externally anywhere', async () => {
    disk({ frames: () => ok({ status: 'row', why: 'too-large' }) });
    show();
    await waitFor(() => expect(marker()).toBe('row'));
    expect(within(body()).getByText('Too large to show here: MAWS copies at most 64.0 MB from another machine.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open externally' })).toBeNull();
  });

  it('an HTML file’s frame is given no bridge', async () => {
    disk();
    show(PAGE);
    await drawn(PAGE);
    expect(htmlProps.length).toBeGreaterThan(0);
    for (const props of htmlProps) expect(Object.keys(props).sort()).toEqual(['title', 'url']);
  });

  it('a new URL makes a new frame element', async () => {
    const main = disk();
    show();
    await drawn();
    const first = body().querySelector('iframe')!;
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: PDF, kind: 'changed' }));
    await waitFor(() => expect(body().querySelector('iframe')?.getAttribute('src')).toBe(`${frameUrl(main.issued[1]!, 'ledger.pdf')}#navpanes=0`));
    expect(body().querySelector('iframe')).not.toBe(first);
  });

  it('a PDF’s URL ends in the side tab’s fragment beside the chat and in the main tab’s in the main area, and a move makes a new element with the other', async () => {
    const main = disk();
    const view = show(PDF, 'side');
    await drawn();
    const url = frameUrl(main.issued[0]!, 'ledger.pdf');
    const beside = body().querySelector('iframe')!;
    expect(beside.getAttribute('src')).toBe(`${url}#toolbar=0&navpanes=0`);
    view.rerender(<FileViewer tab={fileTab(PDF)} host="main" />);
    const inMain = body().querySelector('iframe')!;
    expect(inMain.getAttribute('src')).toBe(`${url}#navpanes=0`);
    expect(inMain).not.toBe(beside);
    await settle();
    expect(main.callsOf('layout.frameFile')).toHaveLength(1);
    expect(main.released()).toEqual([]);
  });
});

describe('Open externally beside a framed file', () => {
  it('Open externally is in the bar of a drawn file and of a failed one, and not beside a row’s own', async () => {
    const main = disk();
    show(VIDEO);
    await drawn(VIDEO);
    expect(within(bar()).getByRole('button', { name: 'Open externally' })).toBeTruthy();
    fireEvent.click(within(bar()).getByRole('button', { name: 'Open externally' }));
    await waitFor(() => expect(main.callsOf('files.openExternal')).toEqual([{ appSessionId: MAIN_A, path: VIDEO, named: true }]));
    // a row: the clip cannot be played; its own button and none in the bar
    fireEvent.error(body().querySelector('video')!);
    await waitFor(() => expect(marker()).toBe('row'));
    expect(screen.getAllByRole('button', { name: 'Open externally' })).toHaveLength(1);
    expect(within(body()).getByRole('button', { name: 'Open externally' })).toBeTruthy();
    // failed: main says a read for that token failed after the row
    act(() => main.emit('layout.frameFailed', { token: main.issued[0]! }));
    await waitFor(() => expect(marker()).toBe('failed'));
    expect(screen.getAllByRole('button', { name: 'Open externally' })).toHaveLength(1);
    expect(within(bar()).getByRole('button', { name: 'Open externally' })).toBeTruthy();
  });
});

describe('a media element’s error and main’s failure', () => {
  it('a media error with no failure from main draws the row and releases the token', async () => {
    const main = disk();
    show(VIDEO);
    await drawn(VIDEO);
    fireEvent.error(body().querySelector('video')!);
    await waitFor(() => expect(within(body()).getByText('This video can’t be played here.')).toBeTruthy());
    expect(entry(VIDEO)!.frame).toEqual({ status: 'row', why: 'unplayable', from: main.issued[0] });
    await waitFor(() => expect(main.released()).toEqual([main.issued[0]]));
    expect(body().querySelector('video')).toBeNull();
  });

  it('a media error, then the failure for the same token, draws the failure state; and the other order', async () => {
    const main = disk();
    show(SOUND);
    await drawn(SOUND);
    fireEvent.error(body().querySelector('audio')!);
    await waitFor(() => expect(within(body()).getByText('This sound can’t be played here.')).toBeTruthy());
    act(() => main.emit('layout.frameFailed', { token: main.issued[0]! }));
    await waitFor(() => expect(within(body()).getByText(STOPPED)).toBeTruthy());
    expect(main.released()).toEqual([main.issued[0]]);

    cleanup();
    useViewer.getState().reset();
    const again = disk();
    show(VIDEO);
    await drawn(VIDEO);
    const video = body().querySelector('video')!;
    act(() => again.emit('layout.frameFailed', { token: again.issued[0]! }));
    await waitFor(() => expect(within(body()).getByText(STOPPED)).toBeTruthy());
    fireEvent.error(video); // the element that was drawn reports its own error afterwards: nothing to judge
    await settle();
    expect(entry(VIDEO)!.frame).toEqual({ status: 'failed' });
    expect(again.released()).toEqual([again.issued[0]]);
  });
});

describe('the failure body', () => {
  it('the failure body holds the sentence and a focusable button named Open again, which reads the entry again', async () => {
    const main = disk();
    show();
    await drawn();
    act(() => main.emit('layout.frameFailed', { token: main.issued[0]! }));
    await waitFor(() => expect(marker()).toBe('failed'));
    expect(within(body()).getByText(STOPPED).tagName).toBe('P');
    expect(body().querySelector('iframe')).toBeNull();
    const button = within(body()).getByRole<HTMLButtonElement>('button', { name: 'Open again' });
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    await waitFor(() => expect(body().querySelector('iframe')?.getAttribute('src')).toBe(`${frameUrl(main.issued[1]!, 'ledger.pdf')}#navpanes=0`));
    expect(main.callsOf('files.read')).toHaveLength(2);
  });

  // Sequence 4, the window's half.
  it('a token issued, its first request held and then failed: the tab draws the failure state', async () => {
    const main = disk();
    show();
    await drawn();
    act(() => main.emit('layout.frameFailed', { token: main.issued[0]! }));
    await waitFor(() => expect(within(body()).getByText(STOPPED)).toBeTruthy());
    expect(entry()!.frame).toEqual({ status: 'failed' });
    await waitFor(() => expect(main.released()).toEqual([main.issued[0]]));
  });

  it('a change that lands after a failure draws the new version', async () => {
    const main = disk();
    show();
    await drawn();
    act(() => main.emit('layout.frameFailed', { token: main.issued[0]! }));
    await waitFor(() => expect(marker()).toBe('failed'));
    main.files[PDF] = '%PDF-1.4 invented, written again\n';
    act(() => main.emit('files.changed', { appSessionId: MAIN_A, path: PDF, kind: 'changed' }));
    await waitFor(() => expect(body().querySelector('iframe')?.getAttribute('src')).toBe(`${frameUrl(main.issued[1]!, 'ledger.pdf')}#navpanes=0`));
  });

  // Sequence 12: a failed frame is read again by the person alone.
  it.each(['Open again pressed', 'the tab shown again', 'the file opened again while its tab is in view'])(
    'a response held to failure, the service restored with no file event, %s: a new token and a drawn frame',
    async (how) => {
      const main = disk();
      const view = show();
      await drawn();
      vi.useFakeTimers();
      act(() => main.emit('layout.frameFailed', { token: main.issued[0]! }));
      await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000)); // time passes; nothing reads by itself
      expect(marker()).toBe('failed');
      expect(main.callsOf('files.read')).toHaveLength(1);
      expect(main.callsOf('layout.frameFile')).toHaveLength(1);
      vi.useRealTimers();
      if (how === 'Open again pressed') fireEvent.click(within(body()).getByRole('button', { name: 'Open again' }));
      else if (how === 'the tab shown again') {
        view.unmount();
        render(<FileViewer tab={fileTab(PDF)} />);
      } else act(() => void openFile(A, PDF));
      await waitFor(() => expect(body().querySelector('iframe')?.getAttribute('src')).toBe(`${frameUrl(main.issued[1]!, 'ledger.pdf')}#navpanes=0`));
      expect(main.callsOf('files.read')).toHaveLength(2);
      expect(main.callsOf('layout.frameFile')).toHaveLength(2);
    },
  );

  it('Open again pressed while the read still fails returns to the same body, with one ask and no more', async () => {
    const main = disk();
    show();
    await drawn();
    act(() => main.emit('layout.frameFailed', { token: main.issued[0]! }));
    await waitFor(() => expect(marker()).toBe('failed'));
    fireEvent.click(within(body()).getByRole('button', { name: 'Open again' }));
    await waitFor(() => expect(entry()?.frame).toMatchObject({ status: 'ready', token: main.issued[1] }));
    act(() => main.emit('layout.frameFailed', { token: main.issued[1]! })); // its first request fails too
    await waitFor(() => expect(marker()).toBe('failed'));
    expect(within(body()).getByText(STOPPED)).toBeTruthy();
    expect(within(body()).getByRole('button', { name: 'Open again' })).toBeTruthy();
    await settle();
    expect(main.callsOf('layout.frameFile')).toHaveLength(2);
    expect(main.released()).toEqual([main.issued[0], main.issued[1]]);
  });
});

describe('a page that names files beside it (the owner’s answer to card 2)', () => {
  const neighbours = (): DiskOptions => ({ frames: (input, issue) => issue({ neighbours: input.path === PAGE }) });

  it('a page that names files beside it is drawn with the line Shown without the files beside it under the bar', async () => {
    disk(neighbours());
    show(PAGE);
    await drawn(PAGE);
    const line = within(body()).getByText(BESIDE);
    expect(line.hasAttribute('data-beside-files')).toBe(true);
    const frame = body().querySelector('[data-artifact-frame="html"]')!;
    expect(frame).not.toBeNull(); // the page is still drawn
    expect(line.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // under the bar, above the page
    expect(within(bar()).getByRole('button', { name: 'Open externally' })).toBeTruthy();
  });

  it('a page that names none draws no line', async () => {
    disk(neighbours());
    show('/r/alone.html');
    await drawn('/r/alone.html');
    expect(body().querySelector('[data-artifact-frame="html"]')).not.toBeNull();
    expect(screen.queryByText(BESIDE)).toBeNull();
    expect(document.querySelector('[data-beside-files]')).toBeNull();
  });

  it('a PDF, a video and a sound draw no line', async () => {
    disk({ frames: (_, issue) => issue({ neighbours: true }) }); // the fact is an HTML page's alone, whatever else is answered
    for (const path of [PDF, VIDEO, SOUND]) {
      const view = show(path);
      await drawn(path);
      expect(document.querySelector('[data-beside-files]'), path).toBeNull();
      view.unmount();
    }
  });
});

describe('a media position', () => {
  // Sequence 11.
  it('a hidden and shown video is at the time it left, paused', async () => {
    const play = vi.spyOn(window.HTMLMediaElement.prototype, 'play');
    disk();
    const first = show(VIDEO);
    await drawn(VIDEO);
    const video = body().querySelector('video')!;
    Object.defineProperty(video, 'currentTime', { value: 12.5, writable: true, configurable: true });
    fireEvent.timeUpdate(video);
    first.unmount(); // hidden
    render(<FileViewer tab={fileTab(VIDEO)} />); // shown again
    const shown = body().querySelector('video')!;
    expect(shown).not.toBe(video);
    Object.defineProperty(shown, 'currentTime', { value: 0, writable: true, configurable: true });
    Object.defineProperties(shown, { videoWidth: { value: 160 }, videoHeight: { value: 120 } });
    fireEvent.loadedMetadata(shown);
    expect(shown.currentTime).toBe(12.5);
    expect(play).not.toHaveBeenCalled();
  });
});
