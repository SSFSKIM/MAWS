// The floating session card and its pill (P3-G execution document, §D1.4). Rendered by the panel region while the panel
// floats, as a sibling of its clipping content (so the region's overflow never clips it), over the panel body below the
// header: the shown session's whole pane (`SessionPane`: the report bar, the transcript, the docked request, the tab
// notes, the composer) under a header with the session's title, Dock and Close; or, closed, its pill (`FloatingPill.tsx`).
// Never `role="dialog"` and never a portal into `body`: the browser's cover watch classifies both as
// covering and would freeze the page under it. The card is never moved; the size is written once on pointer-up, per what
// it sits over (`cardSizeKey`). M2 (§D3): while a pane reserves a column for it (the browser pane, over a page, a native
// view the card cannot float over), the card lies on the column's rect instead, full height; the drag's width goes live
// to the pane through the store.
//
// P4-B3 M2 (X37, X30 amendment; its Decision Log 9, 10, 15): both cards sit at the bottom right, 16 px from the right and
// bottom edges, resized by the top edge, the left edge and the top-left corner (a column by its left edge), and both
// pills at the bottom right. The main split's card is drawn by `SplitCardLayer` in the main area's grid, on the content
// row across every column (never over a tab strip), over the pane beside the floating one; a press or focus in it
// focuses the floating pane, which it stands for. The open card publishes its rect and region (`useFloatingCard`).
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { FloatingCardSize } from '@shared/ipc/schema/layout';
import { IconButton, MaximizeIcon } from '../app/IconButton';
import { SessionPane } from '../session/SessionPane';
import { mainCardKey, useLayout } from '../stores/layout';
import { currentSet } from '../stores/layout-model';
import { CARD_MARGIN, CARD_MIN, cardHost, cardSession, cardSizeKey, closeCard, dockCard, placeCard, splitFloat, useFloatingCard, type CardHost, type CardRect, type ColumnDrag } from './floating';
import { Pill, useSessionTitle } from './FloatingPill';

type Bounds = { width: number; height: number };

function useSize(ref: RefObject<HTMLElement | null>): Bounds | null {
  const [size, setSize] = useState<Bounds | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

// Where the layer starts: the top of the panel host's tool body (its tabpanel, under the region's header and the host's
// tool strip, whatever their heights), else of `body` itself (a host with no tabpanel), in px from the top of the
// layer's containing block (the panel region). Measured, so the card never covers the header or the strip (§D1.4).
function useBodyTop(layer: RefObject<HTMLElement | null>, body: RefObject<HTMLElement | null>): number | null {
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = layer.current;
    const wrapper = body.current;
    const frame = element?.parentElement;
    if (!element || !wrapper || !frame) return;
    const target = () => wrapper.querySelector<HTMLElement>('[role="tabpanel"]') ?? wrapper;
    const measure = () => setTop(Math.round(target().getBoundingClientRect().top - frame.getBoundingClientRect().top - frame.clientTop));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    // A header or strip changing height resizes the body under it.
    const observer = new ResizeObserver(measure);
    observer.observe(wrapper);
    observer.observe(target());
    return () => observer.disconnect();
  }, [layer, body]);
  return top;
}

type Rect = CardRect;
const sameRect = (a: Rect | null, b: Rect) => a !== null && (['left', 'top', 'width', 'height'] as const).every((k) => a[k] === b[k]);
const rounded = (r: DOMRect): Rect => ({ left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) });

// `element`'s rect in px from the layer's top left, followed through either's resizes (a column's width and the pane's
// height change its size; the layer moving with the header's height resizes the layer).
function useRectIn(layer: RefObject<HTMLElement | null>, element: HTMLElement | null): Rect | null {
  const [measured, setMeasured] = useState<{ element: HTMLElement; rect: Rect } | null>(null);
  useLayoutEffect(() => {
    const frame = layer.current;
    if (!frame || !element) return;
    const measure = () => {
      const [outer, inner] = [frame.getBoundingClientRect(), element.getBoundingClientRect()];
      const rect = { left: Math.round(inner.left - outer.left), top: Math.round(inner.top - outer.top), width: Math.round(inner.width), height: Math.round(inner.height) };
      setMeasured((last) => (last?.element === element && sameRect(last.rect, rect) ? last : { element, rect }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(element);
    return () => observer.disconnect();
  }, [layer, element]);
  return measured !== null && measured.element === element ? measured.rect : null;
}

// The layer over the panel host's tool body (`body`: the region's element holding the host): the panel's card, or its
// pill, for the session the card draws; nothing when no session is shown (§D1.4). The card lies on a reserved column
// once its rect is measured (§D3): the measure is a layout effect, so a reservation arriving re-lays the card before
// paint, and the card stays mounted through it (its session's composer keeps the keyboard). A browser chrome hosting the
// pill in its row leaves the layer none to draw.
export function FloatingCardLayer({ body }: { body: RefObject<HTMLElement | null> }) {
  const area = useRef<HTMLDivElement>(null);
  const top = useBodyTop(area, body);
  const bounds = useSize(area);
  return (
    // P3-G (§D4.1): a layer over panel content, hidden while the DOM route takes a mark-up still (markup/surface.ts)
    <div ref={area} data-floating-layer data-markup-occluder className="pointer-events-none absolute inset-x-0 bottom-0 z-20" style={{ top: top ?? 0 }}>
      {top !== null && bounds && <CardOrPill host="panel" area={area} bounds={bounds} />}
    </div>
  );
}

// P4-B3 (its Decision Log 10): the main split's layer, a cell of the main area's grid on the content row across every
// column (below the strips, never over one), pointer-transparent but for the card and the pill. The main area renders it
// while the current set floats a pane.
export function SplitCardLayer() {
  const area = useRef<HTMLDivElement>(null);
  const bounds = useSize(area);
  return (
    <div ref={area} data-floating-layer data-markup-occluder className="pointer-events-none relative z-20 min-h-0 min-w-0" style={{ gridRow: 3, gridColumn: '1 / -1' }}>
      {bounds && <CardOrPill host="split" area={area} bounds={bounds} />}
    </div>
  );
}

// LC-3 (2026-10-21; the architect's D1): while the divider's drag is armed, the outline of the card where the release
// will open it, sized as the card will be (what it will sit over: the pane beside the floating one). Nothing of the
// session mounts for it: S stays in its pane, held at 0 px, and its card mounts once, on release (its Decision Log 5).
// The main area renders it in the card layer's cell while armed only, so a disarm, a cancel or the release removes it.
// None beside a Browser tab: there the card lies on the column the page's pane reserves on release, and while armed the
// page's native view covers the whole pane, so no outline drawn here would show where the card goes.
export function SplitCardOutline({ floating }: { floating: 0 | 1 }) {
  const area = useRef<HTMLDivElement>(null);
  const bounds = useSize(area);
  const other = (s: { main: Parameters<typeof currentSet>[0] }) => currentSet(s.main).panes[floating === 0 ? 1 : 0];
  const beside = useLayout((s) => other(s)?.activeTabId ?? '');
  const overPage = useLayout((s) => other(s)?.tabs.find((t) => t.id === beside)?.kind === 'browser');
  const stored = useLayout((s) => s.regions.floatingCard[mainCardKey(beside)]);
  if (overPage) return null;
  const size = bounds && placeCard(stored, bounds, 'split');
  return (
    <div ref={area} aria-hidden className="pointer-events-none relative z-20 min-h-0 min-w-0" style={{ gridRow: 3, gridColumn: '1 / -1' }}>
      {size && (
        <div
          data-split-card-outline
          className="absolute rounded-lg border-2 border-dashed border-accent"
          style={{ right: CARD_MARGIN, bottom: CARD_MARGIN, width: size.w, height: size.h }}
        />
      )}
    </div>
  );
}

// The card or its pill of the `host` region's card, while that card is up.
function CardOrPill({ host, area, bounds }: { host: CardHost; area: RefObject<HTMLElement | null>; bounds: Bounds }) {
  const session = useLayout((s) => (cardHost(s) === host ? cardSession(s) : null));
  const closed = useFloatingCard((s) => s.closed);
  const column = useFloatingCard((s) => s.column?.element ?? null);
  const columnRect = useRectIn(area, column);
  const pillHosted = useFloatingCard((s) => s.pillHost !== null);
  if (session === null) return null;
  if (closed) return !pillHosted && <Pill appSessionId={session} placement="floating" />;
  return <Card key={session} host={host} appSessionId={session} area={area} bounds={bounds} column={column && columnRect && { element: column, rect: columnRect }} />;
}

// `drag`: a column's width drag (the store's, so the pane's spacer follows it); null for the floating card's own size.
type Gesture = { top: boolean; left: boolean; pointerX: number; pointerY: number; start: FloatingCardSize; key: string; drag: ColumnDrag | null };
type Column = { element: HTMLElement; rect: Rect };
type Edge = { name: 'top' | 'left' | 'top-left'; top: boolean; left: boolean; className: string };
const EDGES: Edge[] = [
  { name: 'top', top: true, left: false, className: 'inset-x-0 top-0 h-1.5 cursor-ns-resize' },
  { name: 'left', top: false, left: true, className: 'inset-y-0 left-0 w-1.5 cursor-ew-resize' },
  { name: 'top-left', top: true, left: true, className: 'top-0 left-0 size-3 cursor-nwse-resize' },
];

function Card({ host, appSessionId, area, bounds, column }: { host: CardHost; appSessionId: AppSessionId; area: RefObject<HTMLElement | null>; bounds: Bounds; column: Column | null }) {
  const title = useSessionTitle(appSessionId);
  // The pane the session stands in: the split's floating pane, or the focused pane the panel follows.
  const paneIndex = useLayout((s) => (host === 'split' ? (splitFloat(s.main)?.pane ?? 0) : currentSet(s.main).focusedPane));
  const sizeKey = useLayout(cardSizeKey);
  const stored = useLayout((s) => s.regions.floatingCard[sizeKey]);
  const [live, setLive] = useState<FloatingCardSize | null>(null); // the size while an edge is dragged
  const gesture = useRef<Gesture | null>(null);
  const self = useRef<HTMLDivElement>(null);
  const size = live ?? placeCard(stored, bounds, host);
  const columnElement = column?.element ?? null;

  // A gesture the card loses (it unmounts, docked mid-drag; the column comes or goes; what it sits over changes) is
  // abandoned, unwritten: its live size goes, and its column drag ends itself only, never a successor's.
  useEffect(
    () => () => {
      gesture.current?.drag?.end();
      gesture.current = null;
      setLive(null);
    },
    [columnElement, sizeKey],
  );

  // P4-B3 (X37, its Decision Log 15): the open card's rect in client px, after every render (a resize, a column) and
  // whenever it or its layer resizes (the window, the regions); withdrawn as it goes.
  const publish = () => {
    const element = self.current;
    if (!element) return;
    const rect = rounded(element.getBoundingClientRect());
    const now = useFloatingCard.getState();
    if (now.host !== host || !sameRect(now.rect, rect)) useFloatingCard.setState({ rect, host });
  };
  useLayoutEffect(publish);
  useLayoutEffect(() => {
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    if (self.current) observer?.observe(self.current);
    if (area.current) observer?.observe(area.current);
    return () => {
      observer?.disconnect();
      if (useFloatingCard.getState().host === host) useFloatingCard.setState({ rect: null, host: null });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `publish` reads the element and the host of the moment
  }, [host, area]);

  // The split's card stands for its floating pane (its Decision Log 7): a press or focus in it focuses that pane.
  const focusPane = () => {
    const state = useLayout.getState();
    const split = host === 'split' ? splitFloat(state.main) : null;
    if (split !== null && currentSet(state.main).focusedPane !== split.pane) state.focusPane(split.pane);
  };

  const begin = (edge: { top: boolean; left: boolean }, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId); // as the Resizer does: happy-dom has none
    const start = column ? { w: column.rect.width, h: size.h } : size;
    gesture.current?.drag?.end();
    const drag = column ? useFloatingCard.getState().startColumnDrag() : null;
    gesture.current = { ...edge, pointerX: event.clientX, pointerY: event.clientY, start, key: sizeKey, drag };
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    // Anchored at the bottom right: the left edge (dragged left) grows the width, the top edge (dragged up) the height.
    const w = g.start.w + (g.left ? g.pointerX - event.clientX : 0);
    const h = g.start.h + (g.top ? g.pointerY - event.clientY : 0);
    // A column's width goes to the pane, whose spacer holds the page's floor; the card follows the spacer's rect.
    if (g.drag) g.drag.width(Math.round(Math.max(CARD_MIN.w, w)));
    else setLive(placeCard({ w, h }, bounds, host));
  };
  const end = () => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    if (g.drag) {
      // What the pane gave the column (the page's floor may have held it narrower than the drag); the height stays the
      // key's, for a card floating over it when another pane shows its page.
      if (column && useFloatingCard.getState().columnDrag !== null) useLayout.getState().setFloatingCardSize(g.key, { w: Math.round(column.element.getBoundingClientRect().width), h: size.h });
      g.drag.end();
      return;
    }
    if (live) useLayout.getState().setFloatingCardSize(g.key, live);
    setLive(null);
  };
  const place = column
    ? { style: { left: column.rect.left, top: column.rect.top, width: column.rect.width, height: column.rect.height }, frame: 'border-l border-border' }
    : { style: { right: CARD_MARGIN, bottom: CARD_MARGIN, width: size.w, height: size.h }, frame: 'rounded-lg border border-border-strong shadow-float' };
  return (
    <div
      ref={self}
      role="region"
      aria-label="Session card"
      data-floating-card={column ? 'column' : 'card'}
      data-card-host={host}
      style={place.style}
      onPointerDownCapture={focusPane}
      onFocusCapture={focusPane}
      className={`pointer-events-auto absolute flex flex-col overflow-hidden bg-bg ${place.frame}`}
    >
      <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border bg-bg-raised pr-1 pl-3">
        <h2 title={title} className="m-0 min-w-0 flex-1 truncate text-ui font-semibold text-fg">
          {title}
        </h2>
        <IconButton label="Dock session" action="panel.float" onClick={dockCard}>
          <MaximizeIcon />
        </IconButton>
        <IconButton label="Close session card" onClick={closeCard}>
          <span aria-hidden className="text-ui leading-none">
            ×
          </span>
        </IconButton>
      </div>
      {/* A pane-focus boundary as a main pane is (`data-pane`): a docked request that arrives while the card's composer
          has the keyboard takes it (DockedCardFrame), and the transcript's pointer finds the card's own frame. It scrolls
          when the card is shorter than the pane's floor (a docked request and the composer at the minimum size): the
          transcript shrinks to nothing and every control stays reachable, the header and the resize edges in place. A
          child wider than the card is clipped, never scrolled sideways (P3-F L132). */}
      <div data-pane="card" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <SessionPane appSessionId={appSessionId} paneIndex={paneIndex} />
      </div>
      {EDGES.filter((edge) => !column || edge.name === 'left').map((edge) => (
        <button
          type="button"
          key={edge.name}
          aria-label={`Resize session card ${edge.name}`}
          title="Drag to resize; arrow keys to adjust"
          data-card-resize={edge.name}
          onPointerDown={(event) => begin(edge, event)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={(event) => {
            const dw = edge.left ? ({ ArrowLeft: 20, ArrowRight: -20 }[event.key] ?? 0) : 0;
            const dh = edge.top ? ({ ArrowUp: 20, ArrowDown: -20 }[event.key] ?? 0) : 0;
            if (!dw && !dh) return;
            event.preventDefault();
            const base = column ? { w: column.rect.width, h: size.h } : size;
            useLayout.getState().setFloatingCardSize(sizeKey, placeCard({ w: base.w + dw, h: base.h + dh }, bounds, host));
          }}
          className={`absolute flex items-center justify-center p-0 text-fg-muted outline-accent focus-visible:outline-2 ${edge.className}`}
        >
          {edge.name === 'top-left' && <svg aria-hidden viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor"><path d="M2 8V2h6M5 8V5h3" /></svg>}
          {column && <span aria-hidden className="h-8 w-0.5 rounded-full bg-fg-muted" />}
        </button>
      ))}
    </div>
  );
}
