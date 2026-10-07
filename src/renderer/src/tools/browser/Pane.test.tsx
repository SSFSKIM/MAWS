// E4a (Task 3.2): the pane's half of the placement protocol (Design §3; Decision Log 22 and 39): a token per mount, the
// claim on mount (with the first real rect when it mounted under 1 px), rounded rects in CSS px, silence once another
// pane owns the tab, "Show here", a claim of its own when the owner lets go, `null` on unmount (an unknown tab's refusal
// swallowed), and the page's picture while covered.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserTab } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { useLayout } from '../../stores/layout';
import { browserTab, T1 } from '../../test-support/browser';
import { installFakeMain, ok } from '../../test-support/code';
import { BROWSER_COPY } from './copy';
import { resetCovering } from './covering';
import { BrowserPane } from './Pane';
import { browser, resetBrowser } from './store';

const A = 'app-a' as AppSessionId;
const PLACEHOLDER = 'data:image/jpeg;base64,AAAA';

let box = { left: 10.4, top: 20.6, right: 310.4, bottom: 220.4 };
let main: ReturnType<typeof installFakeMain>;
let refuse = false;
const places = () => main.callsOf('browser.view.place');
const frames = async (n = 2) => {
  for (let i = 0; i < n; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
};
const resize = async (next: typeof box) => {
  box = next;
  await act(async () => void window.dispatchEvent(new Event('resize')));
};

beforeEach(() => {
  resetBrowser();
  resetCovering();
  refuse = false;
  box = { left: 10.4, top: 20.6, right: 310.4, bottom: 220.4 };
  useLayout.setState({ regions: LAYOUT_DEFAULTS.regions, main: LAYOUT_DEFAULTS.main, overviewOpen: false });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (!this.matches('[data-browser-pane]')) return { left: 0, top: 0, right: 0, bottom: 0, x: 0, y: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
    return { ...box, x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top, toJSON: () => box } as DOMRect;
  });
  main = installFakeMain((name) => (name === 'browser.view.place' && refuse ? { ok: false, error: { code: 'invalid_input', message: 'unknown browser tab' } } : ok()));
});
afterEach(() => {
  cleanup();
  resetCovering();
  vi.restoreAllMocks();
});

const tab = (over: Partial<BrowserTab> = {}) => browserTab(T1, A, over);

describe('placement', () => {
  it('claims on mount with its rect rounded to whole CSS px, then reports without claiming', async () => {
    render(<BrowserPane tab={tab()} surface="panel" />);
    await frames();
    const [first] = places();
    expect(first).toEqual({ tabId: T1, paneId: expect.any(String), surface: 'panel', rect: { x: 10, y: 21, width: 300, height: 199 }, claim: true });
    await resize({ left: 10, top: 20, right: 410, bottom: 320 });
    expect(places().at(-1)).toEqual({ tabId: T1, paneId: first!.paneId, surface: 'panel', rect: { x: 10, y: 20, width: 400, height: 300 }, claim: false });
    const count = places().length;
    await resize({ ...box }); // the same rect is not sent again
    expect(places()).toHaveLength(count);
  });

  it('a layout change reports on the next animation frame (a move no ResizeObserver sees)', async () => {
    render(<BrowserPane tab={tab()} surface="main" />);
    await frames();
    box = { left: 50, top: 20, right: 350, bottom: 220 };
    act(() => useLayout.setState({ regions: { ...LAYOUT_DEFAULTS.regions, sidebar: { ...LAYOUT_DEFAULTS.regions.sidebar, collapsed: true } } }));
    expect(places().at(-1)!.rect).toEqual({ x: 10, y: 21, width: 300, height: 199 }); // not yet
    await frames(1);
    expect(places().at(-1)).toMatchObject({ surface: 'main', rect: { x: 50, y: 20, width: 300, height: 200 }, claim: false });
  });

  it('sends null on unmount, and an unknown tab’s refusal of it is swallowed silently (Decision Log 39)', async () => {
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const { unmount } = render(<BrowserPane tab={tab()} surface="panel" />);
    await frames();
    refuse = true;
    unmount();
    await frames();
    expect(places().at(-1)).toEqual({ tabId: T1, paneId: places()[0]!.paneId, surface: 'panel', rect: null, claim: false });
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('mounted under 1 px (a collapsed panel) it claims nothing, then claims with its first real rect', async () => {
    box = { left: 0, top: 0, right: 0.4, bottom: 300 };
    render(<BrowserPane tab={tab()} surface="panel" />);
    await frames();
    expect(places()).toEqual([]);
    await resize({ left: 0, top: 0, right: 380, bottom: 300 });
    expect(places()).toEqual([{ tabId: T1, paneId: expect.any(String), surface: 'panel', rect: { x: 0, y: 0, width: 380, height: 300 }, claim: true }]);
  });

  it('the owner shrinking under 1 px lets go with null, and claims again when it has room', async () => {
    render(<BrowserPane tab={tab()} surface="panel" />);
    await frames();
    await resize({ left: 0, top: 0, right: 0, bottom: 300 });
    expect(places().at(-1)).toMatchObject({ rect: null, claim: false });
    await resize({ left: 0, top: 0, right: 380, bottom: 300 });
    expect(places().at(-1)).toMatchObject({ rect: { x: 0, y: 0, width: 380, height: 300 }, claim: true });
  });

  it('falls silent when another pane owns the tab, offers Show here, and claims back with it', async () => {
    const { rerender } = render(<BrowserPane tab={tab()} surface="panel" />);
    await frames();
    const paneId = places()[0]!.paneId as string;
    rerender(<BrowserPane tab={tab({ placedIn: { paneId, surface: 'panel' } })} surface="panel" />);
    rerender(<BrowserPane tab={tab({ placedIn: { paneId: 'other', surface: 'main' } })} surface="panel" />);
    expect(screen.getByText(BROWSER_COPY.shownElsewhere)).toBeTruthy();
    const count = places().length;
    await resize({ left: 0, top: 0, right: 500, bottom: 500 });
    expect(places()).toHaveLength(count);
    fireEvent.click(screen.getByRole('button', { name: BROWSER_COPY.showHere }));
    expect(places().at(-1)).toEqual({ tabId: T1, paneId, surface: 'panel', rect: { x: 0, y: 0, width: 500, height: 500 }, claim: true });
    rerender(<BrowserPane tab={tab({ placedIn: { paneId, surface: 'panel' } })} surface="panel" />);
    expect(screen.queryByText(BROWSER_COPY.shownElsewhere)).toBeNull();
  });

  it('a mount over another pane’s placement claims it, and the stale owner it saw first does not silence it', async () => {
    const { rerender } = render(<BrowserPane tab={tab({ placedIn: { paneId: 'panel-pane', surface: 'panel' } })} surface="main" />);
    await frames();
    expect(places()[0]).toMatchObject({ surface: 'main', claim: true });
    expect(screen.queryByText(BROWSER_COPY.shownElsewhere)).toBeNull();
    rerender(<BrowserPane tab={tab({ placedIn: null })} surface="main" />); // the panel let go before the claim landed
    expect(screen.queryByText(BROWSER_COPY.shownElsewhere)).toBeNull();
    const paneId = places()[0]!.paneId as string;
    rerender(<BrowserPane tab={tab({ placedIn: { paneId, surface: 'main' } })} surface="main" />);
    await resize({ left: 0, top: 0, right: 640, bottom: 480 });
    expect(places().at(-1)).toMatchObject({ paneId, rect: { x: 0, y: 0, width: 640, height: 480 }, claim: false });
  });

  it('claims on its own when the owner elsewhere lets go (the panel moving on from a main tab’s tab)', async () => {
    const { rerender } = render(<BrowserPane tab={tab()} surface="main" />);
    await frames();
    const paneId = places()[0]!.paneId as string;
    rerender(<BrowserPane tab={tab({ placedIn: { paneId: 'panel-pane', surface: 'panel' } })} surface="main" />);
    expect(screen.getByText(BROWSER_COPY.shownElsewhere)).toBeTruthy();
    rerender(<BrowserPane tab={tab({ placedIn: null })} surface="main" />);
    expect(places().at(-1)).toEqual({ tabId: T1, paneId, surface: 'main', rect: { x: 10, y: 21, width: 300, height: 199 }, claim: true });
    expect(screen.queryByText(BROWSER_COPY.shownElsewhere)).toBeNull();
  });

  it('a pane for another tab of the session is a new mount with its own token', async () => {
    const { rerender } = render(<BrowserPane tab={tab()} surface="panel" />);
    await frames();
    rerender(<BrowserPane tab={browserTab('b_000000000009', A)} surface="panel" />);
    await frames();
    const [first, release, second] = places();
    expect(release).toEqual({ tabId: T1, paneId: first!.paneId, surface: 'panel', rect: null, claim: false });
    expect(second).toMatchObject({ tabId: 'b_000000000009', claim: true });
    expect(second!.paneId).not.toBe(first!.paneId);
  });
});

describe('the placeholder', () => {
  it('draws the page’s picture while the tab is covered, and nothing once uncovered', () => {
    act(() => browser.setState({ placeholders: new Map([[T1, PLACEHOLDER]]) }));
    const { container, rerender } = render(<BrowserPane tab={tab({ covered: true, placedIn: null })} surface="panel" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(PLACEHOLDER);
    rerender(<BrowserPane tab={tab({ covered: false })} surface="panel" />);
    expect(container.querySelector('img')).toBeNull();
  });
});
