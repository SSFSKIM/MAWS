// The comment card's host (P2-E1 document, D3 and D4; X21): the one thing a producer's view mounts, an overlay over the
// view's body (absolute, full size, pointer events on the card alone) that draws the store's card when it is this host's.
// A card opened for this host instance is its own; an unclaimed card (the re-dock) is claimed when this host's kind and
// mode are the card's and `accepts` it (the producer's view: its record). The layout is *anchored* (D4's placement from
// the pick's rect, mapped by the frame's scale and offset, re-placed when the host resizes) or *docked* (at the host's
// bottom edge, P2-E2's browser pane). The host's unmounting closes its card (Back to the list, another record, the tab
// closed, the panel switching session); the check waits a microtask so StrictMode's effect replay, which remounts at
// once, does not.
//
// Re-pin (P2-E1 M3, D8): the host asks its frame where the card's element is now (`frame.locate`, by the anchor's
// locator) when it shows a card, when the frame is replaced (`frame.key`: a version switch, a Reload, the thread's own
// update) and when its box resizes (a reflow moves an element fixed to the frame's viewport); a rect re-pins the card,
// null keeps it where it is (the top-right corner for a re-docked card, which has no rect). Only the latest ask's answer
// counts. A re-docked thread card is claimed only once the Side pane has stopped drawing its thread: "Show in
// deliverable" starts from that pane, and the card's own close rule (one place draws a session with an input) would
// otherwise shut it the moment it showed beside a pane still drawing the thread.
//
// P2-E2 (the docked layout): a host beside a native view (the browser pane's page) cannot overlay it, since the view lies
// above the whole renderer. Docked, the host is no overlay but a strip in flow, the last child of the column it shares
// with the view's box: it measures that column, draws the card in flow (`stripCard`), so the strip grows with the card
// and the view's box shrinks by as much, and draws the pin as a caret on the strip's top edge under the element.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CardRect } from '../../tools/code/anchor/anchor';
import { hostedInSidePane, useSidePane } from '../store';
import { CommentCard } from './CommentCard';
import { caretOf, pinOf, placeCard, stripCard } from './placement';
import { claimCard, closeCard, useCommentCard, type CardHostKind, type CardHostMode, type OpenCard } from './store';

export interface CardFrame {
  scale: number;
  offset: { x: number; y: number };
  key: string; // changes when the frame is replaced (the viewer's `frame` string)
  locate?(selector: string): Promise<CardRect | null>; // the HTML frame's handle: one function per mounted frame
  showVersion?(version: number | null): void; // the host viewer's onVersion; null: the latest
}

interface Props {
  hostId: string;
  host: CardHostKind;
  mode: CardHostMode;
  layout: 'anchored' | 'docked';
  accepts(card: OpenCard): boolean;
  frame: CardFrame;
  visible: boolean; // the host is on screen (the panel tool's `ctx.visible`, a main tab's active state)
  restoreFocus?(): void; // after Close, Escape or a send dismissed this host's card: the producer's control
}

const mountedHosts = new Set<string>();

export function CommentCardHost({ hostId, host, mode, layout, accepts, frame, visible, restoreFocus }: Props) {
  const open = useCommentCard((s) => s.open);
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    // docked, the strip's own height is the card's: the room it may take is the column's (P2-E2)
    const el = layout === 'docked' ? (ref.current?.parentElement ?? null) : ref.current;
    if (!el) return;
    const measure = () => setBox((was) => (was.width === el.clientWidth && was.height === el.clientHeight ? was : { width: el.clientWidth, height: el.clientHeight }));
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [layout]);

  const drawnInSidePane = useSidePane((s) => open !== null && open.phase.kind === 'thread' && hostedInSidePane(open.phase.child, s));
  const claimable =
    open !== null && open.hostId === null && open.host === host && (open.claimMode === null || open.claimMode === mode) && !drawnInSidePane && accepts(open) ? open.serial : null;
  useEffect(() => {
    if (claimable !== null) claimCard(claimable, hostId);
  }, [claimable, hostId]);

  useEffect(() => {
    mountedHosts.add(hostId);
    return () => {
      mountedHosts.delete(hostId);
      queueMicrotask(() => {
        if (mountedHosts.has(hostId)) return;
        const card = useCommentCard.getState().open;
        if (card?.hostId === hostId) closeCard(card.serial);
      });
    };
  }, [hostId]);

  const card = open?.hostId === hostId ? open : null;
  const rect = useLocated(card, frame, box, layout);
  const pin = rect ? pinOf(rect, frame) : null;
  const style = layout === 'docked' ? stripCard(box) : placeCard(box, pin);
  const dismiss = (serial: number) => {
    closeCard(serial);
    restoreFocus?.();
  };
  if (layout === 'docked') {
    const caret = card ? caretOf(pin, box) : null;
    return (
      <div ref={ref} data-card-host={host} data-card-dock="" className="relative shrink-0 bg-bg">
        {caret !== null && <Caret x={caret} />}
        {card && <CommentCard key={card.serial} card={card} style={style} pinned={false} frame={frame} visible={visible} onDismiss={() => dismiss(card.serial)} />}
      </div>
    );
  }
  return (
    <div ref={ref} data-card-host={host} className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {card && <CommentCard key={card.serial} card={card} style={style} pinned={pin !== null && style.mode !== 'docked'} frame={frame} visible={visible} onDismiss={() => dismiss(card.serial)} />}
    </div>
  );
}

// P2-E2: the strip's pin, a caret on its top edge pointing up at the element in the view above, drawn over the card's
// top border so the two read as one outline.
function Caret({ x }: { x: number }) {
  return (
    <span
      aria-hidden
      data-card-caret={Math.round(x)}
      style={{ left: x - 6 }}
      className="pointer-events-none absolute top-[2px] z-10 size-3 rotate-45 border-t border-l border-border-strong bg-bg-raised"
    />
  );
}

// The card's element as the frame last located it, else the card's own rect (the pick's; none for a re-dock). Asked
// when the card shows, when the frame is replaced or its locate arrives (a viewer whose frame mounts after the card was
// claimed), and when the host's box resizes; a null answer keeps what was. `locate` is one function per frame.
function useLocated(card: OpenCard | null, frame: CardFrame, box: { width: number; height: number }, layout: 'anchored' | 'docked'): CardRect | null {
  const [located, setLocated] = useState<{ serial: number; rect: CardRect } | null>(null);
  const serial = card?.serial ?? null;
  const selector = card?.anchor.locator ?? null;
  const { key, locate } = frame;
  const { width, height } = box;
  useEffect(() => {
    if (serial === null || selector === null || layout === 'docked' || locate === undefined) return;
    let latest = true;
    void locate(selector).then((rect) => {
      if (latest && rect !== null) setLocated({ serial, rect });
    });
    return () => {
      latest = false;
    };
  }, [serial, selector, key, locate, width, height, layout]);
  return located !== null && located.serial === serial ? located.rect : (card?.rect ?? null);
}
