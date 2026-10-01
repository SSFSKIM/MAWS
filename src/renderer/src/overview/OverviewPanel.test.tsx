import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { MawsBridge } from '@shared/ipc/schema';
import { fakeClient } from '../../../../test/support/fake-client';
import { TopBar } from '../main/TopBar';
import { useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { fillStores, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { OverviewLayer, placeRect } from './OverviewPanel';

const nine = scenarioFile('nine-sessions');
const idOf = (title: string) => nine.sessions.find((r) => r.title.text === title)!.appId;
const requests: Record<string, SessionEvent> = Object.assign({}, ...nine.attention.map((a) => a.requests));

// happy-dom lays nothing out: the area the panel moves in reads 1000 × 700.
const AREA = { width: 1000, height: 700 };
const sized = (name: 'clientWidth' | 'clientHeight', value: number) =>
  Object.defineProperty(HTMLElement.prototype, name, {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-overview-area') ? value : 0;
    },
  });

function World() {
  return (
    <>
      <button type="button">Somewhere else</button>
      <TopBar />
      <div style={{ position: 'relative' }}>
        <OverviewLayer />
      </div>
    </>
  );
}

const panel = () => screen.getByRole('dialog', { name: 'Overview' });
const button = () => screen.getByRole('button', { name: /^Overview/ });

beforeEach(() => {
  resetShellStores();
  fillStores(nine);
  sized('clientWidth', AREA.width);
  sized('clientHeight', AREA.height);
  window.maws = fakeClient({ 'attention.request': ({ requestId }: { requestId: string }) => ({ event: requests[requestId] ?? null }) }).client;
});
afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  delete (window as { maws?: MawsBridge }).maws;
});

describe('the floating Overview', () => {
  it('the top bar’s button toggles it, pressed while open, and carries the waiting count', async () => {
    const user = userEvent.setup();
    render(<World />);
    expect(screen.queryByRole('dialog', { name: 'Overview' })).toBeNull();
    expect(button().getAttribute('aria-label')).toBe('Overview, 3 waiting');
    expect(button().textContent).toBe('Overview◐3');
    await user.click(button());
    expect(useLayout.getState().overviewOpen).toBe(true);
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(within(panel()).getByRole('list', { name: 'Overview' })).toBeTruthy(); // the board, unchanged
    expect(within(panel()).getByRole('listitem', { name: 'Needs you' })).toBeTruthy();
    await user.click(button());
    expect(screen.queryByRole('dialog', { name: 'Overview' })).toBeNull();
  });

  it('takes focus itself when it opens (a focused card would take Esc as a decline), ArrowDown enters the board, and Esc gives focus back', async () => {
    const user = userEvent.setup();
    render(<World />);
    const elsewhere = screen.getByRole('button', { name: 'Somewhere else' });
    elsewhere.focus();
    act(() => useLayout.getState().setOverviewOpen(true));
    expect(document.activeElement).toBe(panel());
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(within(panel()).getAllByRole('article')[0]);
    act(() => panel().focus());
    await user.keyboard('{Escape}');
    expect(useLayout.getState().overviewOpen).toBe(false);
    expect(document.activeElement).toBe(elsewhere);
  });

  it('leaves Esc to a card that handles it (a request’s decline)', async () => {
    const user = userEvent.setup();
    render(<World />);
    act(() => useLayout.getState().setOverviewOpen(true));
    const first = within(panel()).getAllByRole('article')[0];
    first.addEventListener('keydown', (event) => event.preventDefault()); // as the request card's Esc binding does
    first.focus();
    await user.keyboard('{Escape}');
    expect(useLayout.getState().overviewOpen).toBe(true);
  });

  it('closes from its close control', async () => {
    const user = userEvent.setup();
    render(<World />);
    act(() => useLayout.getState().setOverviewOpen(true));
    await user.click(within(panel()).getByRole('button', { name: 'Close Overview' }));
    expect(screen.queryByRole('dialog', { name: 'Overview' })).toBeNull();
  });

  it('a card opens its session tab and closes the panel; the session behind it was never touched', async () => {
    const user = userEvent.setup();
    useLayout.getState().openSession(idOf('Settings idle probe'));
    render(<World />);
    act(() => useLayout.getState().setOverviewOpen(true));
    await user.click(within(panel()).getByText('Charter + research'));
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'session', appSessionId: idOf('Charter + research') });
    expect(useLayout.getState().main.panes[0].tabs.map((t) => t.id)).toEqual([`session:${idOf('Settings idle probe')}`, `session:${idOf('Charter + research')}`]);
    expect(useLayout.getState().overviewOpen).toBe(false);
  });

  // Opening changes the layout even when the active tab stays the same (the tab is activated again, or moves pane).
  it('a card of the session already active closes it, by click or Enter', async () => {
    const user = userEvent.setup();
    useLayout.getState().openSession(idOf('Charter + research'));
    render(<World />);
    act(() => useLayout.getState().setOverviewOpen(true));
    await user.click(within(panel()).getByText('Charter + research'));
    expect(useLayout.getState().overviewOpen).toBe(false);
    act(() => useLayout.getState().setOverviewOpen(true));
    within(panel()).getByRole('article', { name: 'Charter + research' }).focus();
    await user.keyboard('{Enter}');
    expect(useLayout.getState().overviewOpen).toBe(false);
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'session', appSessionId: idOf('Charter + research') });
  });

  it('a ⌘-click on the active session’s card moves it into the split and closes it', () => {
    useLayout.getState().openSession(idOf('Settings idle probe'));
    useLayout.getState().openSession(idOf('Charter + research'));
    render(<World />);
    act(() => useLayout.getState().setOverviewOpen(true));
    fireEvent.click(within(panel()).getByText('Charter + research'), { metaKey: true });
    expect(useLayout.getState().main.panes.map((p) => p.tabs.map((t) => t.id))).toEqual([[`session:${idOf('Settings idle probe')}`], [`session:${idOf('Charter + research')}`]]);
    expect(useLayout.getState().overviewOpen).toBe(false);
  });

  // Where focus is does not matter: a change made elsewhere (a sidebar click, ⌘⇧J, a notification, a background
  // removal) leaves the panel open even while a card holds focus.
  it('a tab opened from outside while it is open leaves it open', () => {
    render(<World />);
    act(() => useLayout.getState().setOverviewOpen(true));
    screen.getByRole('button', { name: 'Somewhere else' }).focus();
    act(() => useLayout.getState().openSession(idOf('Charter + research')));
    expect(useLayout.getState().overviewOpen).toBe(true);
    within(panel()).getAllByRole('article')[0].focus();
    act(() => useLayout.getState().openSession(idOf('Fix sidebar drag')));
    act(() => useLayout.getState().dropSession(idOf('Fix sidebar drag')));
    expect(useLayout.getState().overviewOpen).toBe(true);
  });

  it('opens centred near the top, drags by its header and resizes from its corner, inside the area, and remembers its rect', () => {
    render(<World />);
    act(() => useLayout.getState().setOverviewOpen(true));
    const box = () => ({ left: panel().style.left, top: panel().style.top, width: panel().style.width, height: panel().style.height });
    expect(box()).toEqual({ left: '60px', top: '52px', width: '880px', height: '632px' }); // under the tab strip, 16px off the bottom
    const header = panel().querySelector<HTMLElement>('[data-overview-header]')!;
    fireEvent.pointerDown(header, { button: 0, clientX: 300, clientY: 60, pointerId: 1 });
    fireEvent.pointerMove(header, { clientX: 200, clientY: 30, pointerId: 1 });
    expect(box()).toEqual({ left: '0px', top: '22px', width: '880px', height: '632px' }); // x stops at the edge
    fireEvent.pointerUp(header, { pointerId: 1 });
    expect(useLayout.getState().regions.overview).toEqual({ x: 0, y: 22, width: 880, height: 632 });
    const corner = panel().querySelector<HTMLElement>('[data-overview-resize]')!;
    fireEvent.pointerDown(corner, { button: 0, clientX: 880, clientY: 650, pointerId: 2 });
    fireEvent.pointerMove(corner, { clientX: 300, clientY: 100, pointerId: 2 });
    fireEvent.pointerUp(corner, { pointerId: 2 });
    expect(useLayout.getState().regions.overview).toEqual({ x: 0, y: 22, width: 360, height: 240 }); // the minimum
  });
});

describe('placeRect', () => {
  it('keeps a stored rect inside the area and no smaller than the minimum, unless the area is', () => {
    expect(placeRect(null, { width: 1200, height: 900 })).toEqual({ x: 160, y: 52, width: 880, height: 640 });
    expect(placeRect(null, { width: 600, height: 400 })).toEqual({ x: 16, y: 52, width: 568, height: 332 });
    expect(placeRect({ x: 900, y: 600, width: 500, height: 400 }, { width: 1000, height: 700 })).toEqual({ x: 500, y: 300, width: 500, height: 400 });
    expect(placeRect({ x: -40, y: -10, width: 100, height: 50 }, { width: 1000, height: 700 })).toEqual({ x: 0, y: 0, width: 360, height: 240 });
    expect(placeRect({ x: 0, y: 0, width: 800, height: 800 }, { width: 300, height: 200 })).toEqual({ x: 0, y: 0, width: 300, height: 200 });
  });
});
