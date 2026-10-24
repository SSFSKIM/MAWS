// P3-G (§D1.4, acceptance 1, 3, 4, 5, 7): the floating card inside C5's real Shell. The composer slot is a probe that
// registers a focus target as C7's composer does, so "one composer per session" is the composer store's own count.
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { EMPTY_TAB_SET, LAYOUT_DEFAULTS, NO_PROJECT, tabId } from '@shared/ipc/schema/layout';
import { record } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { registerShellActions } from '../app/shell-actions';
import { runAction } from '../keymap/actions-runtime'; // P3-F wave S (F6)
import { Shell } from '../app/Shell';
import { registerSlot, resetSlots } from '../app/slots';
import { DockedCardFrame } from '../composer/docked/DockedCardFrame';
import { registerFocusTarget, useComposerStore } from '../stores/composer';
import { useLayout } from '../stores/layout';
import { useNotices } from '../stores/notices'; // P3-F (F-shell)
import { useSessions } from '../stores/sessions';
import { mainShowing } from '../test-support/panel';
import { resetShellStores } from '../test-support/shell-stores';
import { dockPanel, FLOAT_COPY, floatPanel, useColumnWidth, useFloatingCard } from './floating';
import { ChromePill } from './FloatingPill'; // P3-F (F-shell)
import { MARKUP_COPY, resetMarkup, useMarkup } from '../markup/session'; // P3-G (M4)
import { resetMarkupSurfaces, useRegionMarkupSurface } from '../markup/surface'; // P3-G (M4)
import { EditorHostScopeContext } from '../panel/editor-host'; // P3-G (M4)
import { PanelHeader } from '../panel/PanelHeader';
import { CommentCardHost } from '../side/card/CardHost'; // P3-G (M4)
import { fail, installFakeMain, ok } from '../test-support/code'; // P3-G (M4)

vi.mock('../app/Diagnostics', () => ({ Diagnostics: () => <section aria-label="Diagnostics">diagnostics</section> }));

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;
const SURFACE = { id: 'files:probe', toolId: 'files', pinned: true };
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
// happy-dom lays nothing out: the panel body is 1000 × 700, and a probe column (the browser pane's spacer) lies at
// (300, 220) in the window, `columnWidth()` wide and 560 high, under a layer at (300, 180).
function mockColumnLayout(columnWidth: () => number): void {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const r = this.hasAttribute('data-probe-column')
      ? { left: 300, top: 220, width: columnWidth(), height: 560 }
      : this.hasAttribute('data-floating-layer')
        ? { left: 300, top: 180, width: 1000, height: 700 }
        : { left: 0, top: 0, width: 0, height: 0 };
    return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => ({}) } as DOMRect;
  });
}
function probeColumn(): HTMLElement {
  const column = document.body.appendChild(document.createElement('div'));
  column.setAttribute('data-probe-column', '');
  return column;
}
const setWindowWidth = (width: number) => (window as unknown as { happyDOM: { setWindowSize(size: { width: number }): void } }).happyDOM.setWindowSize({ width });

let off: () => void;
beforeEach(() => {
  setWindowWidth(1440);
  resetShellStores();
  useSessions.setState({ records: new Map([[A, { ...record('app-a'), title: { text: 'Alpha session', source: 'user' } }], [B, record('app-b')]]) });
  // A real open surface earns the panel column; absent stacks derive these legacy selections.
  useLayout.setState({ main: mainShowing(A), panelPinned: [SURFACE], panelActiveNoSession: SURFACE.id, panelBySession: new Map([[A, { tabs: [], activeTabId: SURFACE.id }]]) });
  registerSlot('panelHost', (props) => <PanelHeader tabs={props.tabs} activeTabId={props.activeTabId} />);
  useFloatingCard.setState({ closed: false, column: null, columnDrag: null, pillHost: null });
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
    await user.click(within(region('panel')).getByRole('button', { name: 'Float conversation over surface' }));
    expect(region('main').inert).toBe(true);
    expect(region('main').parentElement!.style.gridTemplateColumns).toBe('240px 0px minmax(0, 1fr)');
    const shown = card()!;
    expect(within(shown).getByRole('heading', { name: 'Alpha session' })).toBeTruthy();
    // One composer of A, in the card; the main pane holds an empty element in its place
    expect(composers()).toEqual([A]);
    expect(within(shown).getByTestId('composer')).toBeTruthy();
    expect(useComposerStore.getState().focusTargets.size).toBe(1);
    expect(region('main').querySelector('[data-session-in-card]')).not.toBeNull();
    expect(focused).toEqual([A]);
    // The card sits 16 px from the panel body's right and bottom edges (its top: the anchoring case below). P4-B3: the
    // corner moved from the bottom left (parent Decision Log 15.7: both floating cards at the bottom right)
    expect(shown.style.right).toBe('16px');
    expect(shown.style.bottom).toBe('16px');
    expect(shown.style.left).toBe('');
    expect(shown.closest('[role="dialog"]')).toBeNull();
    expect(shown.closest('#root, [data-region="panel"]')).toBe(region('panel'));
  });

  it('offers a visible grip that also resizes with the keyboard', () => {
    mockColumnLayout(() => 420);
    useLayout.getState().setPanel({ floating: true });
    render(<Shell />);
    const before = Number.parseInt(card()!.style.width);
    const grip = screen.getByRole('button', { name: 'Resize session card top-left' });
    expect(grip.querySelector('svg')).not.toBeNull();
    fireEvent.keyDown(grip, { key: 'ArrowLeft' });
    expect(Number.parseInt(card()!.style.width)).toBe(before + 20);
  });

  it('Close keeps a usable compact composer and unread title; the title brings the transcript back', async () => {
    const user = userEvent.setup();
    useLayout.getState().setPanel({ floating: true });
    render(<Shell />);
    await user.click(within(card()!).getByRole('button', { name: 'Close session card' }));
    expect(card()).toBeNull();
    expect(composers()).toEqual([A]);
    expect(within(screen.getByRole('region', { name: 'Compact session composer' })).getByTestId('composer')).toBeTruthy();
    const pill = screen.getByRole('button', { name: 'Show session card' });
    expect(pill.textContent).toBe('Alpha session');
    expect(pill.querySelector('[aria-label="Unread"]')).toBeNull();
    act(() => useSessions.setState({ records: new Map([[A, { ...record('app-a'), title: { text: 'Alpha session', source: 'user' }, unread: true }]]) }));
    expect(pill.querySelector('[aria-label="Unread"]')).not.toBeNull();
    await user.click(pill);
    expect(card()).not.toBeNull();
    expect(composers()).toEqual([A]);
  });

  // P3-F (F-shell, scalpel-4#5): Close unmounts the focused Close button with the card; the pill it leaves takes the
  // keyboard, the layer's or the one a browser chrome's row hosts, so focus never drops to the body
  it.each([
    ['the layer’s', false],
    ['a browser chrome’s row’s', true],
  ])('after Close, %s pill has the keyboard', async (_, hosted) => {
    const user = userEvent.setup();
    if (hosted) registerSlot('panelHost', () => <ChromePill surface="panel" />);
    useLayout.getState().setPanel({ floating: true });
    render(<Shell />);
    await user.click(within(card()!).getByRole('button', { name: 'Close session card' }));
    expect(card()).toBeNull();
    const pill = screen.getByRole('button', { name: 'Show session card' });
    expect(pill.dataset.floatingPill).toBe(hosted ? 'inline' : 'floating');
    expect(document.activeElement).toBe(pill);
  });

  // P3-F L129: the panel header's Float names what a click does: over a card closed to its pill it brings the card back
  it('the header’s Float reads "Open session card" while the card is a pill and brings it back; over the open card it reads "Dock session"', async () => {
    const user = userEvent.setup();
    useLayout.getState().setPanel({ floating: true });
    render(<Shell />);
    const header = () => region('panel').querySelector<HTMLElement>('[data-editor-header]')!;
    expect(within(header()).getByRole('button', { name: 'Dock session', pressed: true })).toBeTruthy();
    await user.click(within(card()!).getByRole('button', { name: 'Close session card' }));
    expect(within(header()).queryByRole('button', { name: 'Dock session' })).toBeNull();
    await user.click(within(header()).getByRole('button', { name: 'Open session card', pressed: true }));
    expect(card()).not.toBeNull();
    expect(composers()).toEqual([A]);
    expect(within(header()).getByRole('button', { name: 'Dock session', pressed: true })).toBeTruthy();
  });

  // P3-F L132: `overflow-y-auto` alone makes x-overflow auto too; a child wider than the card is clipped, never scrolled
  it('the card’s body scrolls vertically and clips a horizontally overflowing child', () => {
    useLayout.getState().setPanel({ floating: true });
    render(<Shell />);
    const body = card()!.querySelector<HTMLElement>('[data-pane="card"]')!;
    expect(body.classList).toContain('overflow-y-auto');
    expect(body.classList).toContain('overflow-x-hidden');
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
    expect(region('main').parentElement!.style.gridTemplateColumns).toBe('240px minmax(0, 1fr) 444px');
    expect(within(region('main')).getByTestId('composer').dataset.session).toBe(A);
    expect(focused).toEqual([A]);
  });

  // P3-F wave S (F6, candidate 58): with no shown session there is nothing for the card to draw, so the panel never takes
  // main's place: a float that meets none docks, and main keeps its tab strip
  it('with no shown session, there is no card and no pill, and main is shown', async () => {
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, panelPinned: [], panelActiveNoSession: null });
    useLayout.getState().setPanel({ floating: true });
    render(<Shell />);
    await act(async () => {});
    expect(card()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show session card' })).toBeNull();
    expect(region('main').inert).toBe(false);
    expect(region('main').parentElement!.style.gridTemplateColumns).toBe('240px minmax(0, 1fr) 0px');
  });

  // The owner's case (P3 sitting, 09:58Z): an artifact tab in front. Float is disabled and says why; ⌥⌘B (the menu
  // action) floats nothing and says why in a toast; main and its tab strip stay on screen.
  it('with an artifact tab in front, the header’s Float is disabled with its reason and ⌥⌘B leaves main and its tab strip shown', async () => {
    installFakeMain(() => fail('not answered here'));
    const artifact = { id: tabId({ kind: 'artifact', artifactId: 'deck-1' }), kind: 'artifact', artifactId: 'deck-1', pinned: false } as const;
    useLayout.setState({ main: { ...LAYOUT_DEFAULTS.main, sets: { [NO_PROJECT]: { ...EMPTY_TAB_SET, panes: [{ tabs: [artifact], activeTabId: artifact.id }] } } } });
    render(<Shell />);
    const header = region('panel').querySelector<HTMLElement>('[data-editor-header]')!;
    const float = within(header).getByRole('button', { name: FLOAT_COPY.noSession }) as HTMLButtonElement;
    expect(float.disabled).toBe(true);
    expect(within(header).queryByRole('button', { name: 'Float conversation over surface' })).toBeNull();
    act(() => runAction('panel.float'));
    await act(async () => {});
    expect(useLayout.getState().regions.panel.floating).toBe(false);
    expect(region('main').inert).toBe(false);
    expect(region('main').parentElement!.style.gridTemplateColumns).toBe('240px minmax(0, 1fr) 720px');
    expect(within(document.querySelector<HTMLElement>('[data-chrome-tabs]')!).getByRole('tablist')).toBeTruthy();
    expect(useNotices.getState().notices.map((n) => n.text)).toContain(FLOAT_COPY.noSession);
  });

  it('a drag of the divider 40 px past the maximum floats the panel, the drag’s start kept as its width', () => {
    render(<Shell />);
    const divider = within(region('panel')).getByRole('separator', { name: 'Resize right panel' });
    const max = Number(divider.getAttribute('aria-valuemax'));
    const start = Number(divider.getAttribute('aria-valuenow'));
    const remembered = useLayout.getState().regions.panel.width;
    act(() => void fireEvent.pointerDown(divider, { pointerId: 1, button: 0, clientX: 1000 }));
    act(() => void fireEvent.pointerMove(divider, { pointerId: 1, clientX: 1000 - (max - start) - 39 }));
    expect(useLayout.getState().regions.panel).toMatchObject({ floating: false, width: max });
    act(() => void fireEvent.pointerMove(divider, { pointerId: 1, clientX: 1000 - (max - start) - 40 }));
    expect(useLayout.getState().regions.panel).toMatchObject({ floating: true, width: remembered });
    expect(card()).not.toBeNull();
  });

  // P3-F wave S (F6 review): the Resizer writes the width on every move, so the stored width is the maximum by the time
  // the drag passes it; a float refused there puts the drag's start back, as a float does, rather than keeping the
  // maximum (main pushed to its floor, and saved)
  it('a drag of the divider past the maximum with an artifact tab in front floats nothing and keeps the drag’s start as its width', async () => {
    installFakeMain(() => fail('not answered here'));
    const artifact = { id: tabId({ kind: 'artifact', artifactId: 'deck-1' }), kind: 'artifact', artifactId: 'deck-1', pinned: false } as const;
    useLayout.setState({ main: { ...LAYOUT_DEFAULTS.main, sets: { [NO_PROJECT]: { ...EMPTY_TAB_SET, panes: [{ tabs: [artifact], activeTabId: artifact.id }] } } } });
    render(<Shell />);
    const divider = within(region('panel')).getByRole('separator', { name: 'Resize right panel' });
    const max = Number(divider.getAttribute('aria-valuemax'));
    const start = Number(divider.getAttribute('aria-valuenow'));
    const remembered = useLayout.getState().regions.panel.width;
    act(() => void fireEvent.pointerDown(divider, { pointerId: 1, button: 0, clientX: 1000 }));
    act(() => void fireEvent.pointerMove(divider, { pointerId: 1, clientX: 1000 - (max - start) - 39 }));
    expect(useLayout.getState().regions.panel).toMatchObject({ floating: false, width: max });
    act(() => void fireEvent.pointerMove(divider, { pointerId: 1, clientX: 1000 - (max - start) - 40 }));
    await act(async () => {});
    expect(useLayout.getState().regions.panel).toMatchObject({ floating: false, width: remembered });
    expect(region('main').inert).toBe(false);
    expect(region('main').parentElement!.style.gridTemplateColumns).toBe(`240px minmax(0, 1fr) ${start}px`);
    expect(useNotices.getState().notices.map((n) => n.text)).toContain(FLOAT_COPY.noSession);
  });

  // M1 review: the card never covers the header or the tool strip (§D1.4). The layer starts where the host's tool body
  // does (its tabpanel, under whatever strip or header sits above it), measured, not at a fixed offset.
  it('anchors the layer at the top of the host’s tool body, so a card at its largest leaves the strip clear', () => {
    registerSlot('panelHost', () => (
      <div>
        <div role="tablist" aria-label="Panel tools" />
        <div role="tabpanel" data-probe-body />
      </div>
    ));
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const top = this.hasAttribute('data-probe-body') ? 176 : this.dataset.region === 'panel' ? 100 : 0; // 40 px header + 36 px strip
      return { top, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    useLayout.getState().setPanel({ floating: true });
    render(<Shell />);
    const layer = document.querySelector<HTMLElement>('[data-floating-layer]')!;
    expect(layer.style.top).toBe('76px');
    // At its largest the card is the layer less its margins: its top edge stays 16 px under the body's top
    const corner = card()!.querySelector<HTMLElement>('[data-card-resize="top"]')!;
    act(() => void fireEvent.pointerDown(corner, { pointerId: 1, button: 0, clientX: 500, clientY: 500 }));
    act(() => void fireEvent.pointerMove(corner, { pointerId: 1, clientX: 500, clientY: -2000 }));
    expect(card()!.style.height).toBe('668px'); // 700 - 2 × 16
  });

  // M1 review: the card's session surface is a pane-focus boundary as the main pane is, so a request arriving while the
  // card's composer holds the keyboard takes it (DockedCardFrame reads the nearest `[data-pane]`), and Enter answers it.
  it('a docked request arriving while the card’s composer has focus takes the keyboard', () => {
    let arrive = () => {};
    function RequestProbe({ appSessionId }: { appSessionId: AppSessionId; paneIndex: 0 | 1 }) {
      const [pending, setPending] = useState(false);
      useEffect(() => void (arrive = () => setPending(true)), []);
      return (
        <div>
          <input aria-label="Message" hidden={pending} />
          {pending && (
            <DockedCardFrame appSessionId={appSessionId} title="Permission" onAccept={() => {}} onDecline={() => {}}>
              A request
            </DockedCardFrame>
          )}
        </div>
      );
    }
    registerSlot('composer', RequestProbe);
    useLayout.getState().setPanel({ floating: true });
    render(<Shell />);
    within(card()!).getByRole('textbox', { name: 'Message' }).focus();
    act(() => arrive());
    expect(document.activeElement).toBe(within(card()!).getByRole('group', { name: 'Permission' }));
  });

  // P4-B3 (parent Decision Log 15.7): anchored at the bottom right, the card is resized by its top and left edges and the
  // top-left corner (the mirror of P3-G's top, right and top-right)
  it('resizes from the top and left edges and writes the size once, on release, for the panel tab under it', () => {
    // happy-dom lays nothing out: the panel body the layer measures is 1000 × 700
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700);
    useLayout.getState().setPanel({ floating: true });
    render(<Shell />);
    const shown = card()!;
    const width = Number.parseInt(shown.style.width);
    const height = Number.parseInt(shown.style.height);
    expect([width, height]).toEqual([420, 420]); // 420 × 60 % of 700
    expect([...shown.querySelectorAll<HTMLElement>('[data-card-resize]')].map((handle) => handle.dataset.cardResize)).toEqual(['top', 'left', 'top-left']);
    const corner = shown.querySelector<HTMLElement>('[data-card-resize="top-left"]')!;
    act(() => void fireEvent.pointerDown(corner, { pointerId: 1, button: 0, clientX: 500, clientY: 500 }));
    act(() => void fireEvent.pointerMove(corner, { pointerId: 1, clientX: 460, clientY: 470 }));
    expect([shown.style.width, shown.style.height]).toEqual([`${width + 40}px`, `${height + 30}px`]);
    expect(useLayout.getState().regions.floatingCard).toEqual({});
    act(() => void fireEvent.pointerUp(corner, { pointerId: 1, clientX: 460, clientY: 470 }));
    expect(useLayout.getState().regions.floatingCard).toEqual({ [SURFACE.id]: { w: width + 40, h: height + 30 } });
  });

  // M2 (§D3): a pane over a native view (the browser's) reserves a column; the card lies on the column's rect, full
  // height, and is resized by its inner edge only. The live width goes to the store the pane reads (the page moves with
  // the drag); on release the column's measured width (what the page's floor left it) is written for the panel tab.
  // P4-B3 (parent Decision Log 15.7, its Decision Log 9 and 26): the column is on the right, its inner edge the left one.
  it('over a reserved column the card lies on the column’s rect and resizes from its left edge only', () => {
    let columnWidth = 430;
    mockColumnLayout(() => columnWidth);
    const column = probeColumn();
    let release = () => {};
    act(() => void (release = useFloatingCard.getState().reserveColumn(column)));
    useLayout.getState().setPanel({ floating: true });
    render(<Shell />);
    const shown = card()!;
    expect([shown.style.left, shown.style.top, shown.style.width, shown.style.height]).toEqual(['0px', '40px', '430px', '560px']);
    expect([...shown.querySelectorAll<HTMLElement>('[data-card-resize]')].map((handle) => handle.dataset.cardResize)).toEqual(['left']);
    expect(shown.classList).toContain('border-l');

    const edge = shown.querySelector<HTMLElement>('[data-card-resize="left"]')!;
    act(() => void fireEvent.pointerDown(edge, { pointerId: 1, button: 0, clientX: 730, clientY: 500 }));
    act(() => void fireEvent.pointerMove(edge, { pointerId: 1, clientX: 670, clientY: 400 }));
    expect(useFloatingCard.getState().columnDrag).toBe(490);
    act(() => void fireEvent.pointerMove(edge, { pointerId: 1, clientX: 960, clientY: 400 }));
    expect(useFloatingCard.getState().columnDrag, 'no narrower than the card’s minimum').toBe(360);
    act(() => void fireEvent.pointerMove(edge, { pointerId: 1, clientX: 670, clientY: 400 }));
    expect(useLayout.getState().regions.floatingCard).toEqual({});
    columnWidth = 470; // the page's 280 px floor held the column narrower than the drag
    act(() => void fireEvent.pointerUp(edge, { pointerId: 1, clientX: 670, clientY: 400 }));
    expect(useFloatingCard.getState().columnDrag).toBeNull();
    expect(useLayout.getState().regions.floatingCard).toEqual({ [SURFACE.id]: { w: 470, h: 420 } }); // the height kept for a floating card

    act(() => release());
    expect([card()!.style.right, card()!.style.bottom]).toEqual(['16px', '16px']);
    column.remove();
  });
  // M2 review: a column is layout only. A reservation arriving re-lays the card before paint, the card and its session
  // subtree stay mounted, and the composer that had the keyboard keeps it.
  it('a reservation arriving re-lays the open card in place: its composer stays mounted, with the keyboard', () => {
    function FocusComposer({ appSessionId }: { appSessionId: AppSessionId; paneIndex: 0 | 1 }) {
      const field = useRef<HTMLInputElement>(null);
      useEffect(
        () => registerFocusTarget(appSessionId, { focusFrame: () => field.current?.focus() } as unknown as Parameters<typeof registerFocusTarget>[1]),
        [appSessionId],
      );
      return <input ref={field} aria-label="Probe composer" />;
    }
    registerSlot('composer', FocusComposer);
    mockColumnLayout(() => 420);
    render(<Shell />);
    act(() => floatPanel());
    const original = screen.getByRole('textbox', { name: 'Probe composer' });
    expect(document.activeElement).toBe(original);
    const column = probeColumn();
    act(() => void useFloatingCard.getState().reserveColumn(column));
    expect(card()!.dataset.floatingCard).toBe('column');
    expect(screen.getByRole('textbox', { name: 'Probe composer' }), 'the same editor, never remounted').toBe(original);
    expect(document.activeElement).toBe(original);
    column.remove();
  });

  // M2 review: a column drag the card loses is abandoned, unwritten, and its live width never outlives it
  it('a column drag lost mid-way (the column released, the panel tab changed, the card docked) leaves the stored width in force', () => {
    mockColumnLayout(() => 430);
    const tabs = [
      { id: 'browser:1', toolId: 'browser', pinned: false },
      { id: 'browser:2', toolId: 'browser', pinned: false },
    ];
    useLayout.setState({ panelBySession: new Map([[A, { tabs, activeTabId: 'browser:1' }]]) });
    useLayout.getState().setFloatingCardSize('browser:2', { w: 512, h: 400 });
    useLayout.getState().setPanel({ floating: true });
    const width = renderHook(() => useColumnWidth('panel'));
    render(<Shell />);
    const drag = () => {
      const edge = card()!.querySelector<HTMLElement>('[data-card-resize="left"]')!; // P4-B3: the column's inner edge (parent Decision Log 15.7)
      act(() => void fireEvent.pointerDown(edge, { pointerId: 1, button: 0, clientX: 730, clientY: 500 }));
      act(() => void fireEvent.pointerMove(edge, { pointerId: 1, clientX: 670, clientY: 500 }));
      expect(useFloatingCard.getState().columnDrag).toBe(490);
      return edge;
    };
    const column = probeColumn();

    // the column released mid-drag (another pane took the page): the drag ends, and a late release writes nothing
    let release = () => {};
    act(() => void (release = useFloatingCard.getState().reserveColumn(column)));
    const edge = drag();
    act(() => release());
    expect(useFloatingCard.getState().columnDrag).toBeNull();
    act(() => void fireEvent.pointerUp(edge, { pointerId: 1, clientX: 670, clientY: 500 }));
    expect(useLayout.getState().regions.floatingCard).toEqual({ 'browser:2': { w: 512, h: 400 } });

    // the panel tab under the card changed mid-drag: over the other Browser tab its stored width wins
    act(() => void (release = useFloatingCard.getState().reserveColumn(column)));
    drag();
    act(() => useLayout.setState({ panelBySession: new Map([[A, { tabs, activeTabId: 'browser:2' }]]) }));
    expect(useFloatingCard.getState().columnDrag).toBeNull();
    expect(width.result.current).toBe(512);

    // docked by the keyboard mid-drag: the card unmounts, and floating again finds the stored width
    drag();
    act(() => dockPanel());
    expect(card()).toBeNull();
    expect(useFloatingCard.getState().columnDrag).toBeNull();
    act(() => floatPanel());
    expect(width.result.current).toBe(512);
    expect(useLayout.getState().regions.floatingCard).toEqual({ 'browser:2': { w: 512, h: 400 } });
    act(() => release());
    column.remove();
  });

  // The coordinator's ruling on M2: over a page (a native view) the browser's chrome draws the pill in its tab row
  it('draws no pill of its own while a browser chrome hosts it', () => {
    useLayout.getState().setPanel({ floating: true });
    useFloatingCard.setState({ closed: true });
    render(<Shell />);
    const pill = () => screen.queryByRole('button', { name: 'Show session card' });
    expect(pill()).not.toBeNull();
    let release = () => {};
    act(() => void (release = useFloatingCard.getState().hostPill()));
    expect(pill()).toBeNull();
    act(() => release());
    expect(pill()).not.toBeNull();
  });
});

// P3-G (§D4.1, the M4 review's ruling 2): the DOM route's still is the surface alone. The Shell's layers over panel
// content (the card's layer, the comment card's host) are hidden for the capture, never unmounted, and shown after it.
describe('a mark-up still taken under the open card', () => {
  const TAB = 'artifacts:1';
  const still = { mediaType: 'image/png', data: 'c3RpbGw=', width: 800, height: 500 } as const;
  afterEach(() => {
    resetMarkup();
    resetMarkupSurfaces();
    delete (window as { maws?: unknown }).maws;
  });

  // a viewer as the artifact viewer draws one: its body registered through the DOM route, the comment card's host in it
  function ViewerProbe() {
    const body = useRef<HTMLDivElement>(null);
    useRegionMarkupSurface(body, 'Sales dashboard', true);
    return (
      <div ref={body} data-probe-viewer>
        <CommentCardHost hostId="viewer" host="artifact-page" mode="panel" layout="anchored" accepts={() => false} frame={{ scale: 1, offset: { x: 0, y: 0 }, key: 'v2' }} visible />
      </div>
    );
  }

  it('hides the card’s layer and the comment card’s host while main takes the still, keeps both mounted, and shows them after', async () => {
    registerSlot('panelHost', (props) => (
      <>
        <PanelHeader tabs={props.tabs} activeTabId={props.activeTabId} />
        <EditorHostScopeContext.Provider value={{ surface: 'panel', tabId: TAB }}>
          <ViewerProbe />
        </EditorHostScopeContext.Provider>
      </>
    ));
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const r = this.hasAttribute('data-probe-viewer') ? { left: 300, top: 180, width: 800, height: 500 } : { left: 0, top: 0, width: 0, height: 0 };
      return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => ({}) } as DOMRect;
    });
    useLayout.setState({ panelBySession: new Map([[A, { tabs: [{ id: TAB, toolId: 'artifacts', pinned: false }], activeTabId: TAB }]]) });
    useLayout.getState().setPanel({ floating: true });
    render(<Shell />);
    const shown = card()!;
    const occluders = () => [...document.querySelectorAll<HTMLElement>('[data-markup-occluder]')];
    const named = () =>
      occluders().map((el) =>
        el.hasAttribute('data-floating-layer') ? 'card layer' : el.hasAttribute('data-card-host') ? 'comment card host' : el.hasAttribute('data-toast-viewport') ? 'toast viewport' : el.tagName,
      );
    expect(named()).toEqual(['toast viewport', 'comment card host', 'card layer']); // P3-F (F-shell): the toasts too

    const during: { visibility: string[]; card: HTMLElement | null; rect: unknown }[] = [];
    installFakeMain((name, input) => {
      if (name !== 'layout.captureRegion') return fail(`unexpected ${name}`);
      during.push({ visibility: occluders().map((el) => el.style.visibility), card: document.querySelector('[data-floating-card]'), rect: input.rect }); // hidden, so no role query finds it
      return ok({ image: still });
    });
    await userEvent.click(within(region('panel')).getByRole('button', { name: 'Mark up' }));
    await waitFor(() => expect(useMarkup.getState().session).not.toBeNull());

    expect(during).toEqual([{ visibility: ['hidden', 'hidden', 'hidden'], card: shown, rect: { x: 300, y: 180, width: 800, height: 500 } }]);
    expect(occluders().map((el) => el.style.visibility)).toEqual(['', '', '']);
    expect(card()).toBe(shown);
  });

  it('shows them again when the capture fails', async () => {
    registerSlot('panelHost', (props) => (
      <>
        <PanelHeader tabs={props.tabs} activeTabId={props.activeTabId} />
        <EditorHostScopeContext.Provider value={{ surface: 'panel', tabId: TAB }}>
          <ViewerProbe />
        </EditorHostScopeContext.Provider>
      </>
    ));
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const r = this.hasAttribute('data-probe-viewer') ? { left: 300, top: 180, width: 800, height: 500 } : { left: 0, top: 0, width: 0, height: 0 };
      return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => ({}) } as DOMRect;
    });
    useLayout.setState({ panelBySession: new Map([[A, { tabs: [{ id: TAB, toolId: 'artifacts', pinned: false }], activeTabId: TAB }]]) });
    useLayout.getState().setPanel({ floating: true });
    render(<Shell />);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.maws = {
      invoke: async () => {
        throw new Error('the window went');
      },
      on: () => () => {},
    } as unknown as typeof window.maws;
    await userEvent.click(within(region('panel')).getByRole('button', { name: 'Mark up' }));
    await waitFor(() => expect(warn).toHaveBeenCalledWith('[markup] the still was not taken:', 'the window went'));
    expect(useMarkup.getState().session).toBeNull();
    expect([...document.querySelectorAll<HTMLElement>('[data-markup-occluder]')].map((el) => el.style.visibility)).toEqual(['', '', '']);
  });

  // P3-F (F-shell, scalpel-4#3): the toasts sit at the shell's bottom right, over the panel. A retry right after a
  // refused capture would otherwise take the refusal's own toast into the still and the picture sent to chat.
  it('hides a showing toast while main takes the still: the retry’s still holds no “Couldn’t capture” toast', async () => {
    registerSlot('panelHost', (props) => (
      <>
        <PanelHeader tabs={props.tabs} activeTabId={props.activeTabId} />
        <EditorHostScopeContext.Provider value={{ surface: 'panel', tabId: TAB }}>
          <ViewerProbe />
        </EditorHostScopeContext.Provider>
      </>
    ));
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const r = this.hasAttribute('data-probe-viewer') ? { left: 300, top: 180, width: 800, height: 500 } : { left: 0, top: 0, width: 0, height: 0 };
      return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => ({}) } as DOMRect;
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    useNotices.setState({ notices: [] });
    useLayout.setState({ panelBySession: new Map([[A, { tabs: [{ id: TAB, toolId: 'artifacts', pinned: false }], activeTabId: TAB }]]) });
    useLayout.getState().setPanel({ floating: true });
    render(<Shell />);
    let refuse = true;
    const during: { toast: boolean; visibility: string }[] = [];
    // the toast as it shows, in the viewport (Radix also announces its text in a body child, which is never drawn)
    const viewport = () => document.querySelector<HTMLElement>('[data-toast-viewport]')!;
    const showing = () => viewport().textContent?.includes(MARKUP_COPY.captureFailed) === true;
    installFakeMain((name) => {
      if (name !== 'layout.captureRegion') return fail(`unexpected ${name}`);
      if (refuse) {
        refuse = false;
        return fail('not now');
      }
      during.push({ toast: showing(), visibility: viewport().style.visibility });
      return ok({ image: still });
    });
    const markUp = within(region('panel')).getByRole('button', { name: 'Mark up' });
    await userEvent.click(markUp);
    await waitFor(() => expect(showing()).toBe(true));
    expect(useMarkup.getState().session).toBeNull();
    await userEvent.click(markUp);
    await waitFor(() => expect(useMarkup.getState().session).not.toBeNull());
    expect(during).toEqual([{ toast: true, visibility: 'hidden' }]);
    expect(viewport().style.visibility).toBe('');
  });
});
