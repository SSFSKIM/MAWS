// E4a (Task 3.2): the pane, where a tab's page shows (E4a execution document, Design §3 "The renderer's half" and §4 "The
// pane"). The page itself is a native view main lays exactly over this element; the pane tells main where it is
// (`placement.ts` decides what one pane sends) and draws what the view cannot:
//
// - the placement reports: a ResizeObserver on the element (its own size, within the frame), the layout store on the
//   next animation frame after any change of the regions or the main area (moves a ResizeObserver misses: the sidebar
//   collapsing, a split moving, the panel resizing from its other edge; once per frame while the Resizer drags), and
//   the window's resize; `null` on unmount;
// - the cover: the pane joins the window's cover (`covering.ts`) with the rect it owns the view at, and draws the page's
//   picture under a layer while main has the view hidden;
// - the renderer-drawn pages by the tab's state: another pane owns it, the view could not be created, the renderer
//   crashed, the load failed, the tab never navigated, the tab is suspended.
//
// A pane shows one tab: another tab is another mount with its own token (the caller keys it by tab).
//
// P2-E2: the comment card's dock. A placed pane is a column: the page's element (what the placement measures, so the
// view's bounds are its box) and under it the card's strip (`CommentCardHost`, layout `docked`), mounted while the pane
// holds or claims the view and registered as the tab's dock while it holds it (`comment/dock.ts`). An open card grows
// the strip and the page's element shrinks by as much: the view is never under the card and no cover is raised.
//
// P3-G (§D3, M2): the floating session card's column. In the panel, while the card is up, a spacer at the pane's right
// (`data-browser-reserved-column`, beside the column above; P4-B3, its Decision Log 9 and 26: the column follows the
// card to the bottom-right corner's side) leaves the card its column: the page's element excludes it, so the view lies
// beside the card, live, and the existing reports carry every change of the column's width. The spacer is registered as
// the card's column while the pane holds the view, before paint, so the card moves onto it in the same frame. Closed to
// its pill, the card asks nothing of the pane: the chrome's row draws the pill. P4-B3 (its Decision Log 10): a main tab
// does the same under the main split's card (the panel's card has the main region at 0 px, so it asks nothing there).
//
// U12a (the UX wave's U12, l9-browser-delivery-06; Interfaces §D): a device size. The page's element sits in a page box
// (`data-browser-page-box`), the column's flexible child, whose size is the room this mount has. With no size the element
// fills the box, exactly the box it had before; with one the element is `pageBox`'s size, centred and top-aligned on the
// box's surround, and the existing reports carry it to the view, so the page's own viewport is that size with no
// emulation. A pane that does not hold the view draws no size, and tells its surface no room (`onRoom`): one tab can be
// mounted twice at different sizes, and only the holder's room decides what its chrome offers.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BrowserTab } from '@shared/browser/tab';
import { shellGeometryOf } from '../../app/shell-view';
import { COLUMN_PAGE_MIN, useColumnWidth, useFloatingCard } from '../../shell/floating';
import { CommentCardHost, type CardFrame } from '../../side/card/CardHost';
import type { OpenCard } from '../../side/card/store';
import { useLayout } from '../../stores/layout';
import { place } from './actions';
import { BROWSER_COPY } from './copy';
import { registerDock } from './comment/dock';
import { coverPane } from './covering';
import { useBrowserMarkupSurface } from './markup'; // P3-G
import { CrashPage, ViewFailedPage } from './pages/CrashPage';
import { EmptyState, SuspendedPage } from './pages/EmptyState';
import { ErrorPage } from './pages/ErrorPage';
import { ShownElsewhere } from './pages/ShownElsewhere';
import { paneRect, Placement, type PlacementMode } from './placement';
import { onShowRequest, useBrowser } from './store';
import { pageBox, type Room } from './viewport'; // U12a

const PANE = 'relative h-full w-full overflow-hidden bg-bg';
// P2-E2: a placed pane's page, over the card's strip. U12a: in its page box, which takes the column's flexible place; the
// page fills it, or at a device size sits at its size, centred and top-aligned on the box's surround.
const PAGE_BOX = 'relative flex min-h-0 w-full flex-1 overflow-hidden';
const PAGE_BOX_SIZED = `${PAGE_BOX} items-start justify-center bg-bg-active`;
const PAGE = 'relative min-w-0 flex-1 overflow-hidden bg-bg';
const PAGE_SIZED = 'relative shrink-0 overflow-hidden bg-bg';

export interface BrowserPaneProps {
  tab: BrowserTab | null; // null: the session has no tab to show
  surface: 'panel' | 'main';
  gone?: boolean; // a main tab whose tab main no longer knows (Decision Log 21)
  onOwns?(owns: boolean): void; // whether this pane holds the page's view (the chrome's commands follow it)
  onRoom?(room: Room | null): void; // U12a: the page box's size while this pane holds the view; null when it does not, and at unmount
}

export function BrowserPane({ tab, surface, gone = false, onOwns, onRoom }: BrowserPaneProps) {
  if (tab === null) {
    return (
      <div data-browser-pane="" className={PANE}>
        <EmptyState notice={gone ? BROWSER_COPY.tabGone : undefined} />
      </div>
    );
  }
  return <PlacedPane key={tab.tabId} tab={tab} surface={surface} onOwns={onOwns} onRoom={onRoom} />;
}

// U12a: the page box's size in whole points, never more than it has
const roomOf = (box: HTMLElement): Room => {
  const { width, height } = box.getBoundingClientRect();
  return { width: Math.max(0, Math.floor(width)), height: Math.max(0, Math.floor(height)) };
};
const sameRoom = (a: Room | null, b: Room) => a !== null && a.width === b.width && a.height === b.height;

function PlacedPane({ tab, surface, onOwns, onRoom }: { tab: BrowserTab; surface: 'panel' | 'main'; onOwns?(owns: boolean): void; onRoom?(room: Room | null): void }) {
  const element = useRef<HTMLDivElement>(null);
  const boxElement = useRef<HTMLDivElement>(null); // U12a: the page box
  const placement = useRef<Placement | null>(null);
  const [mode, setMode] = useState<PlacementMode>('claiming');
  const { tabId, appSessionId } = tab;
  const owner = tab.placedIn?.paneId ?? null;
  const [ownerAtMount] = useState(owner);

  useEffect(() => {
    const pane = element.current;
    if (!pane) return;
    let cover: ReturnType<typeof coverPane> | null = null;
    const control = new Placement({
      tabId,
      paneId: crypto.randomUUID(),
      surface,
      owner: ownerAtMount,
      measure: () => {
        const geometry = shellGeometryOf(useLayout.getState(), window.innerWidth);
        // A sheet occludes main, not its own Browser surface. Release only main's native view rather than
        // freezing every view in the window, which would also make the opened Browser sheet unusable.
        if (surface === 'main' && (geometry.sheet || geometry.mainHidden)) return null;
        return paneRect(pane.getBoundingClientRect());
      },
      send: (report) => {
        place(report);
        cover?.refresh();
      },
      onMode: setMode,
    });
    placement.current = control;
    cover = coverPane(() => control.ownedRect(), appSessionId); // P4 W2-C: whose browser it shows
    control.report();

    const report = () => control.report();
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(report);
    resize?.observe(pane);
    let frame = 0;
    const offLayout = useLayout.subscribe((state, previous) => {
      if ((state.regions === previous.regions && state.main === previous.main && state.panelBySession === previous.panelBySession && state.panelPinned === previous.panelPinned && state.panelSurfaces === previous.panelSurfaces && state.panelActiveNoSession === previous.panelActiveNoSession) || frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        control.report();
      });
    });
    window.addEventListener('resize', report);
    return () => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      offLayout();
      window.removeEventListener('resize', report);
      control.dispose();
      cover.release();
      placement.current = null;
    };
  }, [tabId, appSessionId, surface, ownerAtMount]);

  useEffect(() => placement.current?.observe(owner), [owner]);
  // the overflow menu's "Open in tab" or "Show in panel" naming this pane's tab and surface: as "Show here"
  useEffect(
    () =>
      onShowRequest((request) => {
        if (request.tabId === tabId && request.surface === surface) placement.current?.showHere();
      }),
    [tabId, surface],
  );
  useEffect(() => onOwns?.(mode === 'owner'), [mode, onOwns]);
  useEffect(() => () => onOwns?.(false), [onOwns]);

  // U12a: the room, the page box's size as laid out (its own resizes, and the window's), and the page's box in it
  const [room, setRoom] = useState<Room | null>(null);
  useLayoutEffect(() => {
    const box = boxElement.current;
    if (!box) return;
    const read = () => {
      const next = roomOf(box);
      setRoom((previous) => (sameRoom(previous, next) ? previous : next));
    };
    read();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    observer?.observe(box);
    window.addEventListener('resize', read);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', read);
    };
  }, []);
  const sized = mode !== 'elsewhere' && room !== null ? pageBox(tab.viewport, tab.zoom, room) : null;
  // the page's element moved or resized with the room or its size: reported at once (a move inside a box that grew is no
  // resize of the element's own, which its observer would miss)
  const [sizedWidth, sizedHeight] = [sized?.width ?? null, sized?.height ?? null];
  useEffect(() => placement.current?.report(), [room, sizedWidth, sizedHeight]);
  const heldRoom = mode === 'owner' ? room : null;
  useEffect(() => onRoom?.(heldRoom), [heldRoom, onRoom]);
  useEffect(() => () => onRoom?.(null), [onRoom]);

  // P2-E2: the card's dock, registered for the tab while this pane holds its view (where main sends its picks)
  const hostId = useId();
  useEffect(() => (mode === 'owner' ? registerDock(tabId, hostId) : undefined), [mode, tabId, hostId]);
  const frame = useMemo<CardFrame>(() => ({ scale: 1, offset: { x: 0, y: 0 }, key: tabId }), [tabId]);
  const accepts = (card: OpenCard) => card.target?.kind === 'browser' && card.target.pageUrl === tab.url;
  // after Close, Escape or a send: the Comment toggle of the chrome over this pane, which armed the pick, or its address
  // field while the toggle is disabled (the agent took the page)
  const restoreFocus = () => {
    const view = element.current?.closest('[data-browser-view]');
    const toggle = view?.querySelector<HTMLButtonElement>('[data-browser-comment]');
    const target = toggle && !toggle.disabled ? toggle : view?.querySelector<HTMLElement>('[data-address-box] input');
    target?.focus({ preventScroll: true });
  };

  // P3-G (§D4.1): Mark-up over the page, while this pane holds the view in a panel tab
  useBrowserMarkupSurface(tab, element, mode === 'owner');

  // P3-G: the floating card's column, while this pane shows the page under the card of its region (another pane holding
  // the view leaves a DOM page here, which the card floats over as it does over any tool)
  const width = useColumnWidth(surface);
  const column = mode !== 'elsewhere' ? width : null;
  const reserving = column !== null && mode === 'owner';
  const spacer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => (reserving && spacer.current ? useFloatingCard.getState().reserveColumn(spacer.current) : undefined), [reserving]);

  return (
    <div className="flex h-full w-full">
      <div data-browser-column="" className="flex h-full min-w-0 flex-1 flex-col">
        <div ref={boxElement} data-browser-page-box="" className={sized ? PAGE_BOX_SIZED : PAGE_BOX}>
          <div ref={element} data-browser-pane="" className={sized ? PAGE_SIZED : PAGE} style={sized ? { width: sized.width, height: sized.height } : undefined}>
            {mode === 'elsewhere' ? <ShownElsewhere onShowHere={() => placement.current?.showHere()} /> : <TabPage tab={tab} />}
          </div>
        </div>
        {mode !== 'elsewhere' && <CommentCardHost hostId={hostId} host="browser" mode={surface === 'main' ? 'tab' : 'panel'} layout="docked" accepts={accepts} frame={frame} visible={mode === 'owner'} restoreFocus={restoreFocus} subject={tabId} /* UX wave U5a: the tab's pass */ />}
      </div>
      {column !== null && (
        <div ref={spacer} aria-hidden data-browser-reserved-column="" className="shrink-0" style={{ width: column, maxWidth: `calc(100% - ${COLUMN_PAGE_MIN}px)` }} />
      )}
    </div>
  );
}

// What the pane draws for the tab's state; nothing over a live page but its picture while a layer covers it.
function TabPage({ tab }: { tab: BrowserTab }) {
  const placeholder = useBrowser((s) => s.placeholders.get(tab.tabId) ?? null);
  if (tab.failed) return <ViewFailedPage tabId={tab.tabId} message={tab.failed.message} forward={tab.forward} />; // P5 O7 M3: forward
  if (tab.crashed) return <CrashPage tabId={tab.tabId} reason={tab.crashed.reason} />;
  if (tab.loadError) return <ErrorPage tabId={tab.tabId} loadError={tab.loadError} />;
  if (tab.url === '') return <EmptyState />;
  if (tab.suspended) return <SuspendedPage tab={tab} />;
  if (tab.covered && placeholder) return <img alt="" src={placeholder} className="pointer-events-none absolute inset-0 size-full object-cover object-top-left" />;
  return null;
}
