// The comment card's host (P2-E1 document, D3 and D4; X21): the one thing a producer's view mounts, an overlay over the
// view's body (absolute, full size, pointer events on the card alone) that draws the store's card when it is this host's.
// A card opened for this host instance is its own; an unclaimed card (the re-dock) is claimed when this host's kind and
// mode are the card's and `accepts` it (the producer's view: its record). The layout is *anchored* (D4's placement from
// the pick's rect, mapped by the frame's scale and offset, re-placed when the host resizes) or *docked* (at the host's
// bottom edge, P2-E2's browser pane). The host's unmounting closes its card (Back to the list, another record, the tab
// closed, the panel switching session); the check waits a microtask so StrictMode's effect replay, which remounts at
// once, does not.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CardRect } from '../../tools/code/anchor/anchor';
import { CommentCard } from './CommentCard';
import { dockCard, pinOf, placeCard } from './placement';
import { claimCard, closeCard, useCommentCard, type CardHostKind, type CardHostMode, type OpenCard } from './store';

export interface CardFrame {
  scale: number;
  offset: { x: number; y: number };
  key: string; // changes when the frame is replaced (the viewer's `frame` string)
  locate?(selector: string): Promise<CardRect | null>; // the HTML frame's handle
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

export function CommentCardHost({ hostId, host, mode, layout, accepts, frame, restoreFocus }: Props) {
  const open = useCommentCard((s) => s.open);
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox((was) => (was.width === el.clientWidth && was.height === el.clientHeight ? was : { width: el.clientWidth, height: el.clientHeight }));
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);

  const claimable = open !== null && open.hostId === null && open.host === host && (open.claimMode === null || open.claimMode === mode) && accepts(open) ? open.serial : null;
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
  const pin = card?.rect ? pinOf(card.rect, frame) : null;
  const style = layout === 'docked' ? dockCard(box) : placeCard(box, pin);
  const dismiss = (serial: number) => {
    closeCard(serial);
    restoreFocus?.();
  };
  return (
    <div ref={ref} data-card-host={host} className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {card && <CommentCard key={card.serial} card={card} style={style} pinned={pin !== null && style.mode !== 'docked'} onDismiss={() => dismiss(card.serial)} />}
    </div>
  );
}
