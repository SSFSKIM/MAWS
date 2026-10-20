// P4-B3 M2 (X37, the prior art's §3.3 from "release armed" on, its round trip): the main split's floating card inside
// C5's real Shell. S (session A) on the left beside Settings on the right (an editor that registers X32, so its header
// draws Expand), the main area 1500 px wide, its content row 1000 × 700. The composer slot is a probe that registers a
// focus target as C7's composer does and counts its mounts, so "one composer per session" is counted at every commit.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS, NO_PROJECT, tabId, type LayoutMain, type TabRef } from '@shared/ipc/schema/layout';
import { item as attention, record, T0 } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { registerShellActions } from '../app/shell-actions';
import { Shell } from '../app/Shell';
import { registerSlot, resetSlots } from '../app/slots';
import { runAction } from '../keymap/actions-runtime';
import { resetEditorHosts, useEditorHost, useEditorHostScope } from '../panel/editor-host';
import { useAttention } from '../stores/attention';
import { registerFocusTarget, useComposerStore } from '../stores/composer';
import { useLayout } from '../stores/layout';
import { currentSet } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { installResizeObserver } from '../test-support/resize';
import { resetShellStores } from '../test-support/shell-stores';
import { useFloatingCard } from './floating';
import { ChromePill } from './FloatingPill';

vi.mock('../app/Diagnostics', () => ({ Diagnostics: () => <section aria-label="Diagnostics">diagnostics</section> }));

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;
const W = 1500;
const S: TabRef = { id: tabId({ kind: 'session', appSessionId: A }), kind: 'session', appSessionId: A, pinned: false };
const SETTINGS: TabRef = { id: 'settings', kind: 'settings', section: null, pinned: false };
const DIAGNOSTICS: TabRef = { id: 'diagnostics', kind: 'diagnostics', pinned: false };

// Every composer of A mounted at once, at its most (a pane's and the card's, across every commit of a transition).
const live = { now: 0, most: 0 };
const focused: AppSessionId[] = [];
function ProbeComposer({ appSessionId }: { appSessionId: AppSessionId; paneIndex: 0 | 1 }) {
  useLayoutEffect(() => {
    if (appSessionId !== A) return;
    live.now += 1;
    live.most = Math.max(live.most, live.now);
    return () => {
      live.now -= 1;
    };
  }, [appSessionId]);
  useEffect(() => registerFocusTarget(appSessionId, { focusFrame: () => void focused.push(appSessionId) } as unknown as Parameters<typeof registerFocusTarget>[1]), [appSessionId]);
  return <div data-testid="composer" data-session={appSessionId} />;
}
// Settings as an editor that registers X32 (so its pane header, with Expand, is drawn).
function SettingsEditor() {
  useEditorHost(useEditorHostScope(), { title: 'Preferences' });
  return <p>settings body</p>;
}

const mainRegion = () => document.querySelector<HTMLElement>('[data-region="main"]')!;
const area = () => mainRegion().querySelector<HTMLElement>('[data-main-area]')!;
const columns = () => area().style.gridTemplateColumns;
const card = () => screen.queryByRole('region', { name: 'Session card' });
const pill = () => screen.queryByRole('button', { name: 'Show session card' });
const composers = () => screen.queryAllByTestId('composer').map((el) => el.dataset.session);
const set = () => currentSet(useLayout.getState().main);
const divider = () => within(mainRegion()).getByRole('separator', { name: 'Resize panes' });
const splitOf = (right: TabRef = SETTINGS, ratio = 0.4): LayoutMain => ({
  ...LAYOUT_DEFAULTS.main,
  sets: { [NO_PROJECT]: { panes: [{ tabs: [S], activeTabId: S.id }, { tabs: [right], activeTabId: right.id }], focusedPane: 1, splitRatio: ratio } },
});

let resize: ReturnType<typeof installResizeObserver>['resize'];
let off: () => void;
let size = { width: 1000, height: 700 };
beforeEach(() => {
  ({ resize } = installResizeObserver());
  resetShellStores();
  resetEditorHosts();
  useSessions.setState({ records: new Map([[A, { ...record('app-a'), title: { text: 'Alpha session', source: 'user' } }], [B, record('app-b')]]) });
  useLayout.setState({ main: splitOf() });
  useFloatingCard.setState({ closed: false, column: null, columnDrag: null, pillHost: null, rect: null, host: null });
  useComposerStore.setState({ focusTargets: new Map(), focusOnMount: new Set() });
  useAttention.setState({ bySession: new Map() });
  focused.splice(0);
  Object.assign(live, { now: 0, most: 0 });
  size = { width: 1000, height: 700 };
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => size.width);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => size.height);
  registerSlot('composer', ProbeComposer);
  registerSlot('settingsTab', SettingsEditor);
  off = registerShellActions(fakeClient({}).client);
});
afterEach(() => {
  cleanup();
  off();
  resetSlots();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function shell(): void {
  render(<Shell />);
  resize(area(), { width: W, height: 800 });
}
// The divider dragged from the ratio's place to `x`, released: S floats past 160.
function dragTo(x: number): void {
  const from = Math.round(set().splitRatio * W);
  act(() => void fireEvent.pointerDown(divider(), { pointerId: 1, button: 0, clientX: from }));
  act(() => void fireEvent.pointerMove(divider(), { pointerId: 1, clientX: x }));
  act(() => void fireEvent.pointerUp(divider(), { pointerId: 1, clientX: x }));
}

describe('the split’s floating card in the Shell', () => {
  it('released armed, S’s session is the card at the bottom right of the main area’s content: its only composer, with the keyboard', () => {
    shell();
    expect(composers()).toEqual([A]);
    dragTo(150);
    expect(set()).toMatchObject({ floating: { sessionTabId: S.id }, splitRatio: 0.4, focusedPane: 0 });
    const shown = card()!;
    expect(shown.dataset.cardHost).toBe('split');
    expect(within(shown).getByRole('heading', { name: 'Alpha session' })).toBeTruthy();
    expect([shown.style.right, shown.style.bottom, shown.style.width, shown.style.height]).toEqual(['16px', '16px', '420px', '420px']); // 420 × 60 % of 700
    // On the content row across the region, never over a strip, inside main; a mark-up occluder; never a dialog
    const layer = shown.closest<HTMLElement>('[data-floating-layer]')!;
    expect(layer.hasAttribute('data-markup-occluder')).toBe(true);
    expect([layer.style.gridRow, layer.style.gridColumn]).toEqual(['3', '1 / -1']);
    expect(layer.parentElement).toBe(area());
    expect(shown.closest('[role="dialog"]')).toBeNull();
    expect(composers()).toEqual([A]);
    expect(within(shown).getByTestId('composer')).toBeTruthy();
    expect(focused).toEqual([A]);
    expect(live.most).toBe(1);
  });

  it('Dock returns the split at the drag’s start, to the pixel, with S’s composer in its pane taking the keyboard', async () => {
    const user = userEvent.setup();
    shell();
    expect(columns()).toBe('600px 1px minmax(0, 1fr)');
    dragTo(150);
    expect(columns()).toBe('minmax(0, 1fr)');
    focused.splice(0);
    await user.click(within(card()!).getByRole('button', { name: 'Dock session' }));
    expect(card()).toBeNull();
    expect(set().floating).toBeUndefined();
    expect(set().splitRatio).toBe(0.4);
    expect(columns()).toBe('600px 1px minmax(0, 1fr)');
    expect(within(mainRegion().querySelector<HTMLElement>('[data-pane="0"] [role="tabpanel"]')!).getByTestId('composer').dataset.session).toBe(A);
    expect(focused).toEqual([A]);
    expect(set().focusedPane).toBe(0);
  });

  it('the round trip float → dock → float → dock keeps exactly one composer of S mounted at every moment', async () => {
    const user = userEvent.setup();
    shell();
    dragTo(150);
    await user.click(within(card()!).getByRole('button', { name: 'Dock session' }));
    act(() => runAction('main.expandArtifactPane')); // S's pane is focused: the pane beside it (Settings) has no session
    act(() => useLayout.getState().focusPane(1));
    act(() => runAction('main.expandArtifactPane'));
    expect(card()).not.toBeNull();
    act(() => runAction('panel.float')); // ⌥⌘B docks the split's card
    expect(card()).toBeNull();
    expect(composers()).toEqual([A]);
    expect(live).toEqual({ now: 1, most: 1 });
    expect(set().splitRatio).toBe(0.4);
  });

  it('Close leaves the pill at the bottom right with the unread dot; the pill brings the card back; a new request raises it', async () => {
    const user = userEvent.setup();
    shell();
    dragTo(150);
    await user.click(within(card()!).getByRole('button', { name: 'Close session card' }));
    expect(card()).toBeNull();
    expect(composers()).toEqual([]);
    expect(set().focusedPane, 'the pill is no pane: A is what is on screen').toBe(1);
    const shown = pill()!;
    expect(document.activeElement).toBe(shown);
    expect([shown.dataset.floatingPill, shown.style.right, shown.style.bottom]).toEqual(['floating', '16px', '16px']);
    expect(mainRegion().contains(shown)).toBe(true);
    expect(shown.querySelector('[aria-label="Unread"]')).toBeNull();
    act(() => useSessions.setState({ records: new Map([[A, { ...record('app-a'), title: { text: 'Alpha session', source: 'user' }, unread: true }]]) }));
    expect(shown.querySelector('[aria-label="Unread"]')).not.toBeNull();
    focused.splice(0);
    await user.click(shown);
    expect(card()).not.toBeNull();
    expect(focused).toEqual([A]);
    await user.click(within(card()!).getByRole('button', { name: 'Close session card' }));
    focused.splice(0);
    act(() => useAttention.setState({ bySession: new Map([[A, [attention('app-a', 'permission', T0)]]]) }));
    expect(card()).not.toBeNull();
    expect(focused, 'the raise never takes the keyboard').toEqual([]);
  });

  it('a window resize re-clamps the card inside the content and writes no size; a resize of its edges writes it on release, keyed by A’s tab', () => {
    shell();
    dragTo(150);
    const shown = card()!;
    size = { width: 600, height: 400 };
    resize(shown.parentElement!, size);
    expect([shown.style.width, shown.style.height]).toEqual(['420px', '240px']); // 60 % of 400, and the 240 minimum
    expect(set().floating).toBeDefined();
    expect(useLayout.getState().regions.floatingCard).toEqual({});
    const corner = shown.querySelector<HTMLElement>('[data-card-resize="top-left"]')!;
    act(() => void fireEvent.pointerDown(corner, { pointerId: 1, button: 0, clientX: 500, clientY: 300 }));
    act(() => void fireEvent.pointerMove(corner, { pointerId: 1, clientX: 450, clientY: 260 }));
    act(() => void fireEvent.pointerUp(corner, { pointerId: 1, clientX: 450, clientY: 260 }));
    expect(useLayout.getState().regions.floatingCard).toEqual({ [`main:${SETTINGS.id}`]: { w: 470, h: 280 } });
  });

  it('A’s last tab closing shows S full width, the card gone; S’s session tab closing takes the card and the pill with it', () => {
    shell();
    dragTo(150);
    act(() => useLayout.getState().closeTab(SETTINGS.id));
    expect(card()).toBeNull();
    expect(columns()).toBe('minmax(0, 1fr)');
    expect(composers()).toEqual([A]);
    expect(mainRegion().querySelector('[data-pane="0"] [data-testid="composer"]')).not.toBeNull();

    act(() => useLayout.setState({ main: splitOf() }));
    dragTo(150);
    act(() => useFloatingCard.getState().setClosed(true));
    act(() => useLayout.getState().closeTab(S.id));
    expect(card()).toBeNull();
    expect(pill()).toBeNull();
    expect(composers()).toEqual([]);
  });

  it('focus and tab changes in A keep S in the card; a press in the card focuses S; another tab set hides it and its return shows it', () => {
    shell();
    dragTo(150);
    const shown = card()!;
    act(() => void fireEvent.pointerDown(mainRegion().querySelector('[data-pane="1"] [role="tabpanel"]')!));
    expect(set().focusedPane).toBe(1);
    act(() => useLayout.getState().openTab({ kind: 'diagnostics' }, { pane: 1 }));
    expect(card()).toBe(shown);
    expect(within(shown).getByTestId('composer').dataset.session).toBe(A);
    act(() => void fireEvent.pointerDown(within(shown).getByTestId('composer')));
    expect(set().focusedPane).toBe(0);

    act(() => useLayout.getState().setCurrentProject('elsewhere' as ProjectId));
    expect(card()).toBeNull();
    expect(composers()).toEqual([]);
    act(() => useLayout.getState().setCurrentProject(null));
    expect(card()).not.toBeNull();
    expect(set().floating).toEqual({ sessionTabId: S.id });
  });

  it('relaunch: a stored floating split comes back with the card open', async () => {
    const values: Record<string, unknown> = { regions: LAYOUT_DEFAULTS.regions, 'main.tabs': { ...splitOf(DIAGNOSTICS), sets: { [NO_PROJECT]: { ...splitOf(DIAGNOSTICS).sets[NO_PROJECT]!, floating: { sessionTabId: S.id } } } } };
    const { client } = fakeClient({ 'layout.list': { keys: ['regions', 'main.tabs'] }, 'layout.get': (input: unknown) => ({ value: values[(input as { key: string }).key] ?? null }) });
    useLayout.setState({ hydrated: false, main: LAYOUT_DEFAULTS.main });
    useFloatingCard.setState({ closed: true }); // a moment's choice of the last run, never restored
    shell();
    await act(() => useLayout.getState().hydrate(client, () => true));
    expect(set().floating).toEqual({ sessionTabId: S.id });
    expect(card()).not.toBeNull();
    expect(composers()).toEqual([A]);
  });

  it('the open card publishes its rect and region, and withdraws them as a pill', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const r = this.hasAttribute('data-floating-card') ? { left: 1004, top: 300, width: 420, height: 420 } : { left: 0, top: 0, width: 0, height: 0 };
      return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => ({}) } as DOMRect;
    });
    shell();
    dragTo(150);
    expect(useFloatingCard.getState()).toMatchObject({ host: 'split', rect: { left: 1004, top: 300, width: 420, height: 420 } });
    await userEvent.click(within(card()!).getByRole('button', { name: 'Close session card' }));
    expect(useFloatingCard.getState()).toMatchObject({ host: null, rect: null });
  });

  // X32 amendment (its Decision Log 12): the main surface draws Expand in the header of an editor beside a session
  it('the editor’s header shows Expand beside a session and Restore split while it floats, absent otherwise', async () => {
    const user = userEvent.setup();
    shell();
    const header = () => mainRegion().querySelector<HTMLElement>('[data-pane="1"] [data-editor-header]')!;
    await user.click(within(header()).getByRole('button', { name: 'Expand pane', pressed: false }));
    expect(set()).toMatchObject({ floating: { sessionTabId: S.id }, splitRatio: 0.4 });
    expect(card()).not.toBeNull();
    expect(focused).toEqual([A]);
    await user.click(within(header()).getByRole('button', { name: 'Restore split', pressed: true }));
    expect(set().floating).toBeUndefined();
    expect(card()).toBeNull();
    expect(columns()).toBe('600px 1px minmax(0, 1fr)');
    act(() => useLayout.getState().openTab({ kind: 'diagnostics' }, { pane: 0 })); // no session beside Settings now
    expect(within(header()).queryByRole('button', { name: /Expand pane|Restore split/ })).toBeNull();
  });

  // One card at a time (its Decision Log 8): the panel's Float with the split's card up names and does a dock
  it('the panel header’s Float reads “Dock session” while the split’s card is up and docks it', async () => {
    const user = userEvent.setup();
    shell();
    dragTo(150);
    const panelHeader = document.querySelector<HTMLElement>('[data-region="panel"] [data-editor-header]')!;
    await user.click(within(panelHeader).getByRole('button', { name: 'Dock session' }));
    expect(set().floating).toBeUndefined();
    expect(useLayout.getState().regions.panel.floating).toBe(false);
    expect(within(panelHeader).getByRole('button', { name: 'Float session over panel' })).toBeTruthy();
  });

  // Over a Browser main tab in A the page is a native view: its chrome's row hosts the split card's pill (a panel
  // chrome hosts only the panel card's), and the layer draws none
  it('a main tab’s browser chrome hosts the split card’s pill; a panel chrome does not', () => {
    shell();
    dragTo(150);
    act(() => useFloatingCard.getState().setClosed(true));
    const panelChrome = render(<ChromePill surface="panel" />);
    expect(within(panelChrome.container).queryByRole('button', { name: 'Show session card' })).toBeNull();
    expect(mainRegion().querySelector('[data-floating-pill="floating"]')).not.toBeNull();
    panelChrome.unmount();
    const mainChrome = render(<ChromePill surface="main" />);
    expect(within(mainChrome.container).getByRole('button', { name: 'Show session card' }).dataset.floatingPill).toBe('inline');
    expect(mainRegion().querySelector('[data-floating-pill="floating"]')).toBeNull();
  });

  it('⌘⇧\\ from A goes into the card, opening a pill, its composer taking the keyboard', () => {
    shell();
    dragTo(150);
    act(() => useFloatingCard.getState().setClosed(true));
    act(() => useLayout.getState().focusPane(1));
    focused.splice(0);
    act(() => runAction('pane.focusOther'));
    expect(card()).not.toBeNull();
    expect(set().focusedPane).toBe(0);
    expect(focused).toEqual([A]);
  });
});
