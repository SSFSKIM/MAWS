// P3-G (§D1.4, acceptance 1, 3, 4, 5, 7): the floating card inside C5's real Shell. The composer slot is a probe that
// registers a focus target as C7's composer does, so "one composer per session" is the composer store's own count.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { record } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { registerShellActions } from '../app/shell-actions';
import { Shell } from '../app/Shell';
import { registerSlot, resetSlots } from '../app/slots';
import { registerFocusTarget, useComposerStore } from '../stores/composer';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { mainShowing } from '../test-support/panel';
import { resetShellStores } from '../test-support/shell-stores';
import { useFloatingCard } from './floating';

vi.mock('../app/Diagnostics', () => ({ Diagnostics: () => <section aria-label="Diagnostics">diagnostics</section> }));

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;
const focused: AppSessionId[] = [];

function ProbeComposer({ appSessionId }: { appSessionId: AppSessionId; paneIndex: 0 | 1 }) {
  useEffect(
    () =>
      registerFocusTarget(appSessionId, {
        focusFrame: () => void focused.push(appSessionId),
      } as unknown as Parameters<typeof registerFocusTarget>[1]),
    [appSessionId],
  );
  return <div data-testid="composer" data-session={appSessionId} />;
}

const region = (name: string) => document.querySelector<HTMLElement>(`[data-region="${name}"]`)!;
const card = () => screen.queryByRole('region', { name: 'Session card' });
const composers = () => screen.queryAllByTestId('composer').map((el) => el.dataset.session);
const setWindowWidth = (width: number) => (window as unknown as { happyDOM: { setWindowSize(size: { width: number }): void } }).happyDOM.setWindowSize({ width });

let off: () => void;
beforeEach(() => {
  setWindowWidth(1440);
  resetShellStores();
  useSessions.setState({ records: new Map([[A, { ...record('app-a'), title: { text: 'Alpha session', source: 'user' } }], [B, record('app-b')]]) });
  useLayout.setState({ main: mainShowing(A) });
  useFloatingCard.setState({ closed: false, column: null });
  useComposerStore.setState({ focusTargets: new Map(), focusOnMount: new Set() });
  focused.splice(0);
  registerSlot('composer', ProbeComposer);
  off = registerShellActions(fakeClient({}).client);
});
afterEach(() => {
  cleanup();
  off();
  resetSlots();
  vi.restoreAllMocks();
});

describe('the floating card in the Shell', () => {
  it('floats from the header’s Float button: the card draws the session, the only composer of it, with the keyboard', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    expect(composers()).toEqual([A]);
    await user.click(within(region('panel')).getByRole('button', { name: 'Float session over panel' }));
    expect(region('main').inert).toBe(true);
    expect(region('main').parentElement!.style.gridTemplateColumns).toBe('300px 0px minmax(0, 1fr)');
    const shown = card()!;
    expect(within(shown).getByRole('heading', { name: 'Alpha session' })).toBeTruthy();
    // One composer of A, in the card; the main pane holds an empty element in its place
    expect(composers()).toEqual([A]);
    expect(within(shown).getByTestId('composer')).toBeTruthy();
    expect(useComposerStore.getState().focusTargets.size).toBe(1);
    expect(region('main').querySelector('[data-session-in-card]')).not.toBeNull();
    expect(focused).toEqual([A]);
    // The card sits 16 px from the panel body's left and bottom edges, below the 40 px header
    expect(shown.style.left).toBe('16px');
    expect(shown.style.bottom).toBe('16px');
    expect((shown.parentElement as HTMLElement).style.top).toBe('40px');
    expect(shown.closest('[role="dialog"]')).toBeNull();
    expect(shown.closest('#root, [data-region="panel"]')).toBe(region('panel'));
  });

  it('Close leaves the pill, with the unread dot while the record is unread; the pill brings the card back', async () => {
    const user = userEvent.setup();
    useLayout.getState().setPanel({ floating: true });
    render(<Shell />);
    await user.click(within(card()!).getByRole('button', { name: 'Close session card' }));
    expect(card()).toBeNull();
    expect(composers()).toEqual([]);
    const pill = screen.getByRole('button', { name: 'Show session card' });
    expect(pill.textContent).toBe('Alpha session');
    expect(pill.querySelector('[aria-label="Unread"]')).toBeNull();
    act(() => useSessions.setState({ records: new Map([[A, { ...record('app-a'), title: { text: 'Alpha session', source: 'user' }, unread: true }]]) }));
    expect(pill.querySelector('[aria-label="Unread"]')).not.toBeNull();
    await user.click(pill);
    expect(card()).not.toBeNull();
    expect(composers()).toEqual([A]);
  });

  it('Dock restores the column at its width and the main pane’s composer takes the keyboard', async () => {
    const user = userEvent.setup();
    useLayout.getState().setPanel({ width: 444 });
    render(<Shell />);
    act(() => useLayout.getState().setPanel({ floating: true }));
    focused.splice(0);
    await user.click(within(card()!).getByRole('button', { name: 'Dock session' }));
    expect(card()).toBeNull();
    expect(region('main').inert).toBe(false);
    expect(region('main').parentElement!.style.gridTemplateColumns).toBe('300px minmax(0, 1fr) 444px');
    expect(within(region('main')).getByTestId('composer').dataset.session).toBe(A);
    expect(focused).toEqual([A]);
  });

  it('with no shown session, there is no card and no pill', () => {
    useLayout.setState({ main: LAYOUT_DEFAULTS.main });
    useLayout.getState().setPanel({ floating: true });
    render(<Shell />);
    expect(card()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show session card' })).toBeNull();
  });

  it('a drag of the divider 40 px past the maximum floats the panel, the drag’s start kept as its width', () => {
    render(<Shell />);
    const divider = within(region('panel')).getByRole('separator', { name: 'Resize right panel' });
    const max = Number(divider.getAttribute('aria-valuemax'));
    act(() => void fireEvent.pointerDown(divider, { pointerId: 1, button: 0, clientX: 1000 }));
    act(() => void fireEvent.pointerMove(divider, { pointerId: 1, clientX: 1000 - (max - 380) - 39 }));
    expect(useLayout.getState().regions.panel).toMatchObject({ floating: false, width: max });
    act(() => void fireEvent.pointerMove(divider, { pointerId: 1, clientX: 1000 - (max - 380) - 40 }));
    expect(useLayout.getState().regions.panel).toMatchObject({ floating: true, width: 380 });
    expect(card()).not.toBeNull();
  });

  it('resizes from the top and right edges and writes the size once, on release, for the panel tab under it', () => {
    // happy-dom lays nothing out: the panel body the layer measures is 1000 × 700
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700);
    useLayout.getState().setPanel({ floating: true });
    render(<Shell />);
    const shown = card()!;
    const width = Number.parseInt(shown.style.width);
    const height = Number.parseInt(shown.style.height);
    expect([width, height]).toEqual([420, 420]); // 420 × 60 % of 700
    const corner = shown.querySelector<HTMLElement>('[data-card-resize="top-right"]')!;
    act(() => void fireEvent.pointerDown(corner, { pointerId: 1, button: 0, clientX: 500, clientY: 500 }));
    act(() => void fireEvent.pointerMove(corner, { pointerId: 1, clientX: 540, clientY: 470 }));
    expect([shown.style.width, shown.style.height]).toEqual([`${width + 40}px`, `${height + 30}px`]);
    expect(useLayout.getState().regions.floatingCard).toEqual({});
    act(() => void fireEvent.pointerUp(corner, { pointerId: 1, clientX: 540, clientY: 470 }));
    expect(useLayout.getState().regions.floatingCard).toEqual({ summary: { w: width + 40, h: height + 30 } });
  });
});
