// The floating session card and its pill (P3-G execution document, §D1.4). Rendered by the panel region while the panel
// floats, as a sibling of its clipping content (so the region's overflow never clips it), over the panel body below the
// header: the shown session's whole pane (`SessionPane`: the report bar, the transcript, the docked request, the tab
// notes, the composer) under a header with the session's title, Dock and Close; or, closed, its pill (`FloatingPill.tsx`).
// Never `role="dialog"` and never a portal into `body`: the browser's cover watch classifies both as
// covering and would freeze the page under it. The card is resized by its top and right edges and the top-right corner,
// never moved; the size is written once on pointer-up, per panel tab (`cardSizeKey`). M2 (§D3): while a pane reserves a
// column for it (the browser pane, over a page, a native view the card cannot float over), the card lies on the column's
// rect instead, full height, resized by its right edge only; the drag's width goes live to the pane through the store.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { FloatingCardSize } from '@shared/ipc/schema/layout';
import { IconButton, MaximizeIcon } from '../app/IconButton';
import { SessionPane } from '../session/SessionPane';
import { useLayout } from '../stores/layout';
import { currentSet } from '../stores/layout-model';
import { CARD_MARGIN, CARD_MIN, cardSession, cardSizeKey, closeCard, dockPanel, placeCard, useFloatingCard, type ColumnDrag } from './floating';
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

type Rect = { left: number; top: number; width: number; height: number };

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
      setMeasured((last) => {
        const same = last?.element === element && (['left', 'top', 'width', 'height'] as const).every((k) => last.rect[k] === rect[k]);
        return same ? last : { element, rect };
      });
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

// The layer over the panel host's tool body (`body`: the region's element holding the host): the card, or the pill,
// for the session the card draws; nothing when no session is shown (§D1.4). The card lies on a reserved column once its
// rect is measured (§D3): the measure is a layout effect, so a reservation arriving re-lays the card before paint, and
// the card stays mounted through it (its session's composer keeps the keyboard). A browser chrome hosting the pill in its
// row leaves the layer none to draw.
export function FloatingCardLayer({ body }: { body: RefObject<HTMLElement | null> }) {
  const session = useLayout(cardSession);
  const closed = useFloatingCard((s) => s.closed);
  const column = useFloatingCard((s) => s.column?.element ?? null);
  const area = useRef<HTMLDivElement>(null);
  const top = useBodyTop(area, body);
  const bounds = useSize(area);
  const columnRect = useRectIn(area, column);
  const pillHosted = useFloatingCard((s) => s.pillHost !== null);
  return (
    <div ref={area} data-floating-layer className="pointer-events-none absolute inset-x-0 bottom-0 z-20" style={{ top: top ?? 0 }}>
      {session !== null &&
        top !== null &&
        bounds &&
        (closed ? (
          !pillHosted && <Pill appSessionId={session} placement="floating" />
        ) : (
          <Card key={session} appSessionId={session} bounds={bounds} column={column && columnRect && { element: column, rect: columnRect }} />
        ))}
    </div>
  );
}

// `drag`: a column's width drag (the store's, so the pane's spacer follows it); null for the floating card's own size.
type Gesture = { top: boolean; right: boolean; pointerX: number; pointerY: number; start: FloatingCardSize; key: string; drag: ColumnDrag | null };
type Column = { element: HTMLElement; rect: Rect };

function Card({ appSessionId, bounds, column }: { appSessionId: AppSessionId; bounds: Bounds; column: Column | null }) {
  const title = useSessionTitle(appSessionId);
  const paneIndex = useLayout((s) => currentSet(s.main).focusedPane);
  const sizeKey = useLayout(cardSizeKey);
  const stored = useLayout((s) => s.regions.floatingCard[sizeKey]);
  const [live, setLive] = useState<FloatingCardSize | null>(null); // the size while an edge is dragged
  const gesture = useRef<Gesture | null>(null);
  const size = live ?? placeCard(stored, bounds);
  const columnElement = column?.element ?? null;

  // A gesture the card loses (it unmounts, docked mid-drag; the column comes or goes; the panel tab under it changes) is
  // abandoned, unwritten: its live size goes, and its column drag ends itself only, never a successor's.
  useEffect(
    () => () => {
      gesture.current?.drag?.end();
      gesture.current = null;
      setLive(null);
    },
    [columnElement, sizeKey],
  );

  const begin = (edges: { top: boolean; right: boolean }, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId); // as the Resizer does: happy-dom has none
    const start = column ? { w: column.rect.width, h: size.h } : size;
    gesture.current?.drag?.end();
    const drag = column ? useFloatingCard.getState().startColumnDrag() : null;
    gesture.current = { ...edges, pointerX: event.clientX, pointerY: event.clientY, start, key: sizeKey, drag };
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    // Anchored at the bottom left: the right edge grows the width, the top edge (dragged up) the height.
    const w = g.start.w + (g.right ? event.clientX - g.pointerX : 0);
    const h = g.start.h + (g.top ? g.pointerY - event.clientY : 0);
    // A column's width goes to the pane, whose spacer holds the page's floor; the card follows the spacer's rect.
    if (g.drag) g.drag.width(Math.round(Math.max(CARD_MIN.w, w)));
    else setLive(placeCard({ w, h }, bounds));
  };
  const end = () => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    if (g.drag) {
      // What the pane gave the column (the page's floor may have held it narrower than the drag); the height stays the
      // panel tab's, for a card floating over it when another pane shows its page.
      if (column && useFloatingCard.getState().columnDrag !== null) useLayout.getState().setFloatingCardSize(g.key, { w: Math.round(column.element.getBoundingClientRect().width), h: size.h });
      g.drag.end();
      return;
    }
    if (live) useLayout.getState().setFloatingCardSize(g.key, live);
    setLive(null);
  };
  const place = column
    ? { style: { left: column.rect.left, top: column.rect.top, width: column.rect.width, height: column.rect.height }, frame: 'border-r border-border' }
    : { style: { left: CARD_MARGIN, bottom: CARD_MARGIN, width: size.w, height: size.h }, frame: 'rounded-lg border border-border-strong shadow-float' };
  return (
    <div
      role="region"
      aria-label="Session card"
      data-floating-card={column ? 'column' : 'card'}
      style={place.style}
      className={`pointer-events-auto absolute flex flex-col overflow-hidden bg-bg ${place.frame}`}
    >
      <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border bg-bg-raised pr-1 pl-3">
        <h2 title={title} className="m-0 min-w-0 flex-1 truncate text-ui font-semibold text-fg">
          {title}
        </h2>
        <IconButton label="Dock session" action="panel.float" onClick={dockPanel}>
          <MaximizeIcon />
        </IconButton>
        <IconButton label="Close session card" onClick={closeCard}>
          <span aria-hidden className="text-ui leading-none">
            ×
          </span>
        </IconButton>
      </div>
      {/* A pane-focus boundary as a main pane is (`data-pane`): a docked request that arrives while the card's composer
          has the keyboard takes it (DockedCardFrame), and the transcript's pointer finds the card's own frame. */}
      <div data-pane="card" className="min-h-0 flex-1">
        <SessionPane appSessionId={appSessionId} paneIndex={paneIndex} />
      </div>
      {!column && (
        <div
          aria-hidden
          data-card-resize="top"
          onPointerDown={(event) => begin({ top: true, right: false }, event)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize"
        />
      )}
      <div
        aria-hidden
        data-card-resize="right"
        onPointerDown={(event) => begin({ top: false, right: true }, event)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize"
      />
      {!column && (
        <div
          aria-hidden
          data-card-resize="top-right"
          onPointerDown={(event) => begin({ top: true, right: true }, event)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          className="absolute top-0 right-0 size-3 cursor-nesw-resize"
        />
      )}
    </div>
  );
}
