// E4a (Task 3.2): the pane's half of the placement protocol (Design §3; Decision Log 22 and 39): a token per mount, the
// claim on mount (with the first real rect when it mounted under 1 px), rounded rects in CSS px, silence once another
// pane owns the tab, "Show here", a claim of its own when the owner lets go, `null` on unmount (an unknown tab's refusal
// swallowed), and the page's picture while covered.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserTab } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { useFloatingCard } from '../../shell/floating';
import { useLayout } from '../../stores/layout';
import { browserTab, T1 } from '../../test-support/browser';
import { installFakeMain, ok } from '../../test-support/code';
import { mainShowing } from '../../test-support/panel';
import { openCard, useCommentCard } from '../../side/card/store';
import { dockOf } from './comment/dock';
import { BROWSER_COPY } from './copy';
import { resetCovering } from './covering';
import { BrowserPane } from './Pane';
import { browser, requestShow, resetBrowser } from './store';

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

  it('a request to show its tab on its surface claims the view back, as Show here does; any other request is not its own', async () => {
    const { rerender } = render(<BrowserPane tab={tab()} surface="main" />);
    await frames();
    const paneId = places()[0]!.paneId as string;
    rerender(<BrowserPane tab={tab({ placedIn: { paneId, surface: 'main' } })} surface="main" />);
    rerender(<BrowserPane tab={tab({ placedIn: { paneId: 'panel-pane', surface: 'panel' } })} surface="main" />);
    expect(screen.getByText(BROWSER_COPY.shownElsewhere)).toBeTruthy();
    const count = places().length;
    act(() => {
      requestShow(T1, 'panel');
      requestShow('b_000000000009', 'main');
    });
    expect(places()).toHaveLength(count);
    act(() => requestShow(T1, 'main'));
    expect(places().at(-1)).toEqual({ tabId: T1, paneId, surface: 'main', rect: { x: 10, y: 21, width: 300, height: 199 }, claim: true });
    rerender(<BrowserPane tab={tab({ placedIn: { paneId, surface: 'main' } })} surface="main" />);
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

  it('tells its surface whether it holds the view (the chrome’s commands follow it, Task 3.3)', async () => {
    const owns = vi.fn();
    const { rerender, unmount } = render(<BrowserPane tab={tab()} surface="panel" onOwns={owns} />);
    await frames();
    expect(owns).toHaveBeenLastCalledWith(true);
    rerender(<BrowserPane tab={tab({ placedIn: { paneId: 'other', surface: 'main' } })} surface="panel" onOwns={owns} />);
    expect(owns).toHaveBeenLastCalledWith(false);
    rerender(<BrowserPane tab={tab({ placedIn: null })} surface="panel" onOwns={owns} />); // the other let go: this one claims
    expect(owns).toHaveBeenLastCalledWith(true);
    unmount();
    expect(owns).toHaveBeenLastCalledWith(false);
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

// P2-E2: the comment card's dock: a strip under the page's element, registered for the tab while the pane holds its view
describe('the comment card’s dock', () => {
  const ANCHOR = { kind: 'browser-element', locator: '#increment', label: 'button “Increment”', pageUrl: 'https://example.com/', css: '#increment' } as const;
  afterEach(() => act(() => useCommentCard.setState({ open: null })));

  it('registers the pane holding the view as its tab’s dock, and a card opened for it is drawn in the strip under the page', async () => {
    const { container } = render(<BrowserPane tab={tab()} surface="panel" />);
    await frames();
    const hostId = dockOf(T1);
    expect(hostId).not.toBeNull();
    act(() => openCard(ANCHOR, { appSessionId: A, placement: { kind: 'card', host: 'browser', hostId: hostId! } }));
    const column = container.querySelector('[data-browser-column]')!;
    const [page, strip] = [...column.children] as HTMLElement[];
    expect(page!.matches('[data-browser-pane]')).toBe(true);
    expect(strip!.matches('[data-card-dock]')).toBe(true);
    expect(page!.querySelector('[data-comment-card]'), 'nothing over the page').toBeNull();
    expect(strip!.querySelector('[data-comment-card]')!.getAttribute('data-placement')).toBe('strip');
  });

  it('another pane taking the view unmounts the strip and the dock: the card closes', async () => {
    const { rerender, container } = render(<BrowserPane tab={tab()} surface="panel" />);
    await frames();
    const hostId = dockOf(T1)!;
    act(() => openCard(ANCHOR, { appSessionId: A, placement: { kind: 'card', host: 'browser', hostId } }));
    expect(container.querySelector('[data-comment-card]')).not.toBeNull();
    rerender(<BrowserPane tab={tab({ placedIn: { paneId: 'other', surface: 'main' } })} surface="panel" />);
    await frames();
    expect(container.querySelector('[data-card-dock]')).toBeNull();
    expect(dockOf(T1)).toBeNull();
    expect(useCommentCard.getState().open).toBeNull();
  });

  it('a second pane that claims and unmounts before its echo reaches the first leaves the first pane the dock', async () => {
    const first = render(<BrowserPane tab={tab()} surface="panel" />);
    await frames();
    const paneA = places()[0]!.paneId as string;
    first.rerender(<BrowserPane tab={tab({ placedIn: { paneId: paneA, surface: 'panel' } })} surface="panel" />);
    const hostA = dockOf(T1);
    expect(hostA).not.toBeNull();
    const second = render(<BrowserPane tab={tab({ placedIn: { paneId: paneA, surface: 'panel' } })} surface="main" />);
    await frames();
    expect(places().at(-1)).toMatchObject({ surface: 'main', claim: true });
    expect(dockOf(T1)).not.toBe(hostA);
    second.unmount();
    await frames();
    // main's listing coalesced: the first pane sees no owner (never the second's name), claims back and stays owner
    first.rerender(<BrowserPane tab={tab({ placedIn: null })} surface="panel" />);
    expect(places().at(-1)).toMatchObject({ paneId: paneA, claim: true });
    expect(dockOf(T1)).toBe(hostA);
  });

  it('Close or Escape in the docked card gives focus back to its chrome’s Comment toggle', async () => {
    render(
      <div data-browser-view="panel">
        <button type="button" data-browser-comment="">
          Comment
        </button>
        <BrowserPane tab={tab()} surface="panel" />
      </div>,
    );
    await frames();
    act(() => openCard(ANCHOR, { appSessionId: A, placement: { kind: 'card', host: 'browser', hostId: dockOf(T1)! } }));
    const field = screen.getByRole('textbox', { name: 'Comment' });
    expect(document.activeElement).toBe(field);
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(useCommentCard.getState().open).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Comment' }));
  });

  it('Escape in the docked card gives focus to the chrome’s address field while the Comment toggle is disabled', async () => {
    render(
      <div data-browser-view="panel">
        <div data-address-box="">
          <input role="combobox" aria-label="Address" />
        </div>
        <button type="button" data-browser-comment="" disabled>
          Comment
        </button>
        <BrowserPane tab={tab()} surface="panel" />
      </div>,
    );
    await frames();
    act(() => openCard(ANCHOR, { appSessionId: A, placement: { kind: 'card', host: 'browser', hostId: dockOf(T1)! } }));
    const field = screen.getByRole('textbox', { name: 'Comment' });
    expect(document.activeElement).toBe(field);
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(useCommentCard.getState().open).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Address' }));
  });
});

// P3-G (§D3, M2): with the floating card up over a Browser tab in the panel, the pane reserves a left column for it: a
// spacer beside the page's column, outside the element the placement measures (so the view's bounds exclude it), and
// registered as the card's column while the pane holds the view. Closed to its pill, the pane leaves nothing: the page
// keeps its whole box (the chrome's row draws the pill, the coordinator's ruling on M2).
describe('the floating card’s column', () => {
  const BROWSER_TAB = 'browser:1';
  const float = (over: Partial<{ closed: boolean }> = {}) =>
    act(() => {
      useLayout.setState({
        main: mainShowing(A),
        regions: { ...LAYOUT_DEFAULTS.regions, panel: { ...LAYOUT_DEFAULTS.regions.panel, floating: true } },
        panelBySession: new Map([[A, { tabs: [{ id: BROWSER_TAB, toolId: 'browser', pinned: false }], activeTabId: BROWSER_TAB }]]),
      });
      useFloatingCard.setState({ closed: false, columnDrag: null, ...over });
    });
  const spacer = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-browser-reserved-column]');
  beforeEach(() => useFloatingCard.setState({ closed: false, column: null, columnDrag: null }));

  it('reserves a 420 px column beside the page, outside the measured element, the page keeping at least 280 px; registered while it holds the view', async () => {
    float();
    const { container } = render(<BrowserPane tab={tab()} surface="panel" />);
    await frames();
    const column = spacer(container)!;
    expect(column).not.toBeNull();
    const page = container.querySelector<HTMLElement>('[data-browser-pane]')!;
    expect(page.contains(column) || column.contains(page), 'the placement measures the page alone').toBe(false);
    expect(column.nextElementSibling!.matches('[data-browser-column]')).toBe(true);
    expect([column.style.width, column.style.maxWidth]).toEqual(['420px', 'calc(100% - 280px)']);
    expect(places()[0]!.rect).toEqual({ x: 10, y: 21, width: 300, height: 199 }); // the page's box, as before
    expect(useFloatingCard.getState().column?.element).toBe(column);
  });

  it('takes the stored width of the panel tab under the card, and the live width while the column’s edge is dragged', async () => {
    float();
    act(() => useLayout.getState().setFloatingCardSize(BROWSER_TAB, { w: 512, h: 400 }));
    const { container } = render(<BrowserPane tab={tab()} surface="panel" />);
    await frames();
    expect(spacer(container)!.style.width).toBe('512px');
    const drag = useFloatingCard.getState().startColumnDrag();
    act(() => drag.width(600));
    expect(spacer(container)!.style.width).toBe('600px');
    act(() => drag.end());
    expect(spacer(container)!.style.width).toBe('512px');
  });

  // M2 review: a width stored while the page's floor held the column under the card's minimum comes back to the minimum
  // once there is room (the floor still wins while there is none: the spacer's max-width)
  it('asks for no less than the card’s 360 px minimum, whatever width was stored', async () => {
    float();
    act(() => useLayout.getState().setFloatingCardSize(BROWSER_TAB, { w: 300, h: 400 }));
    const { container } = render(<BrowserPane tab={tab()} surface="panel" />);
    await frames();
    expect([spacer(container)!.style.width, spacer(container)!.style.maxWidth]).toEqual(['360px', 'calc(100% - 280px)']);
  });

  it('reserves nothing on a main tab, while docked, or with the panel collapsed', async () => {
    float();
    const main = render(<BrowserPane tab={tab()} surface="main" />);
    await frames();
    expect(spacer(main.container)).toBeNull();
    expect(useFloatingCard.getState().column).toBeNull();
    main.unmount();
    const { container } = render(<BrowserPane tab={tab()} surface="panel" />);
    await frames();
    act(() => useLayout.getState().setPanel({ floating: false }));
    expect(spacer(container)).toBeNull();
    expect(useFloatingCard.getState().column).toBeNull();
    float();
    expect(spacer(container)).not.toBeNull();
    act(() => useLayout.getState().setPanel({ collapsed: true }));
    expect(spacer(container)).toBeNull();
    expect(useFloatingCard.getState().column).toBeNull();
  });

  it('releases the column when another pane takes the view, and on unmount', async () => {
    float();
    const { container, rerender, unmount } = render(<BrowserPane tab={tab()} surface="panel" />);
    await frames();
    expect(useFloatingCard.getState().column).not.toBeNull();
    rerender(<BrowserPane tab={tab({ placedIn: { paneId: 'other', surface: 'main' } })} surface="panel" />);
    expect(spacer(container)).toBeNull();
    expect(useFloatingCard.getState().column).toBeNull();
    rerender(<BrowserPane tab={tab({ placedIn: null })} surface="panel" />); // the other let go: this one claims back
    expect(useFloatingCard.getState().column?.element).toBe(spacer(container));
    unmount();
    expect(useFloatingCard.getState().column).toBeNull();
  });

  it('closed to its pill, the column goes and the page keeps its whole column: nothing under it but the comment strip', async () => {
    float({ closed: true });
    const { container } = render(<BrowserPane tab={tab()} surface="panel" />);
    await frames();
    expect(spacer(container)).toBeNull();
    expect(useFloatingCard.getState().column).toBeNull();
    const column = container.querySelector('[data-browser-column]')!;
    expect([...column.children].map((child) => (child.matches('[data-browser-pane]') ? 'page' : child.matches('[data-card-dock]') ? 'strip' : child.outerHTML))).toEqual(['page', 'strip']);
    act(() => useFloatingCard.getState().setClosed(false));
    expect(spacer(container)).not.toBeNull();
  });
});
