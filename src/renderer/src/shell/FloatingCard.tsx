// The floating session card and its pill (P3-G execution document, §D1.4). Rendered by the panel region while the panel
// floats, as a sibling of its clipping content (so the region's overflow never clips it), over the panel body below the
// header: the shown session's whole pane (`SessionPane`: the report bar, the transcript, the docked request, the tab
// notes, the composer) under a header with the session's title, Dock and Close; or, closed, a pill with the title and
// the unread dot. Never `role="dialog"` and never a portal into `body`: the browser's cover watch classifies both as
// covering and would freeze the page under it. The card is resized by its top and right edges and the top-right corner,
// never moved; the size is written once on pointer-up, per panel tab (`cardSizeKey`).
import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { FloatingCardSize } from '@shared/ipc/schema/layout';
import { IconButton, MaximizeIcon } from '../app/IconButton';
import { SessionPane } from '../session/SessionPane';
import { displayTitle } from '../sessions/title';
import { useLayout } from '../stores/layout';
import { currentSet } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { CARD_MARGIN, cardSession, cardSizeKey, closeCard, dockPanel, openCard, placeCard, useFloatingCard } from './floating';

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

// The layer over the panel body (`top` is the header's height): the card, or the pill, for the session the card draws;
// nothing when no session is shown (§D1.4).
export function FloatingCardLayer({ top }: { top: number }) {
  const session = useLayout(cardSession);
  const closed = useFloatingCard((s) => s.closed);
  const area = useRef<HTMLDivElement>(null);
  const bounds = useSize(area);
  return (
    <div ref={area} data-floating-layer className="pointer-events-none absolute inset-x-0 bottom-0 z-20" style={{ top }}>
      {session !== null && bounds && (closed ? <Pill appSessionId={session} /> : <Card key={session} appSessionId={session} bounds={bounds} />)}
    </div>
  );
}

const useTitle = (appSessionId: AppSessionId) => useSessions((s) => displayTitle(s.records.get(appSessionId)));

type Gesture = { top: boolean; right: boolean; pointerX: number; pointerY: number; start: FloatingCardSize; key: string };

function Card({ appSessionId, bounds }: { appSessionId: AppSessionId; bounds: Bounds }) {
  const title = useTitle(appSessionId);
  const paneIndex = useLayout((s) => currentSet(s.main).focusedPane);
  const stored = useLayout((s) => s.regions.floatingCard[cardSizeKey(s)]);
  const [live, setLive] = useState<FloatingCardSize | null>(null); // the size while an edge is dragged
  const gesture = useRef<Gesture | null>(null);
  const size = live ?? placeCard(stored, bounds);

  const begin = (edges: { top: boolean; right: boolean }, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId); // as the Resizer does: happy-dom has none
    gesture.current = { ...edges, pointerX: event.clientX, pointerY: event.clientY, start: size, key: cardSizeKey(useLayout.getState()) };
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    // Anchored at the bottom left: the right edge grows the width, the top edge (dragged up) the height.
    const w = g.start.w + (g.right ? event.clientX - g.pointerX : 0);
    const h = g.start.h + (g.top ? g.pointerY - event.clientY : 0);
    setLive(placeCard({ w, h }, bounds));
  };
  const end = () => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    if (live) useLayout.getState().setFloatingCardSize(g.key, live);
    setLive(null);
  };
  return (
    <div
      role="region"
      aria-label="Session card"
      data-floating-card
      style={{ left: CARD_MARGIN, bottom: CARD_MARGIN, width: size.w, height: size.h }}
      className="pointer-events-auto absolute flex flex-col overflow-hidden rounded-lg border border-border-strong bg-bg shadow-float"
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
      <div className="min-h-0 flex-1">
        <SessionPane appSessionId={appSessionId} paneIndex={paneIndex} />
      </div>
      <div
        aria-hidden
        data-card-resize="top"
        onPointerDown={(event) => begin({ top: true, right: false }, event)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize"
      />
      <div
        aria-hidden
        data-card-resize="right"
        onPointerDown={(event) => begin({ top: false, right: true }, event)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize"
      />
      <div
        aria-hidden
        data-card-resize="top-right"
        onPointerDown={(event) => begin({ top: true, right: true }, event)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="absolute top-0 right-0 size-3 cursor-nesw-resize"
      />
    </div>
  );
}

function Pill({ appSessionId }: { appSessionId: AppSessionId }) {
  const title = useTitle(appSessionId);
  const unread = useSessions((s) => s.records.get(appSessionId)?.unread === true);
  return (
    <button
      type="button"
      aria-label="Show session card"
      title={unread ? `${title} · Unread` : title}
      data-floating-pill
      onClick={openCard}
      style={{ left: CARD_MARGIN, bottom: CARD_MARGIN }}
      className="pointer-events-auto absolute inline-flex h-7 items-center gap-2 rounded-full border border-border-strong bg-bg-raised px-3 text-ui-sm text-fg shadow-float outline-accent hover:bg-bg-hover focus-visible:outline-2"
    >
      <span className="max-w-[220px] truncate">{title}</span>
      {unread && <span aria-label="Unread" role="img" className="block size-[5px] shrink-0 rounded-full bg-info" />}
    </button>
  );
}
