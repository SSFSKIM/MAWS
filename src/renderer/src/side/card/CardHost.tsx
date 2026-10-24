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
// artifact" starts from that pane, and the card's own close rule (one place draws a session with an input) would
// otherwise shut it the moment it showed beside a pane still drawing the thread.
//
// P2-E2 (the docked layout): a host beside a native view (the browser pane's page) cannot overlay it, since the view lies
// above the whole renderer. Docked, the host is no overlay but a strip in flow, the last child of the column it shares
// with the view's box: it measures that column, draws the card in flow (`stripCard`), so the strip grows with the card
// and the view's box shrinks by as much, and draws the pin as a caret on the strip's top edge under the element. The strip
// never takes more than half the column (`stripMax`), clipping a card whose floor is taller than that.
//
// P4-B1 (D7 of docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md): in a document's margin the host is a block
// in flow in the stack's entry the margin placed (`layout="margin"`), as the docked strip is in its column: the card at
// the entry's width (`marginCard`), its height capped by the page's scroll box (`.ds-doc`), never pinned, nothing
// located. The document host also opts into X36's draft rule (`keepDraftOnEscape`, `discardOnBlurEmpty`, `onDraft`).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { CardRect } from '../../tools/code/anchor/anchor';
import { hostedInSidePane, useSidePane } from '../store';
import type { ArtifactLocation } from '@shared/artifacts/link'; // P4-B4
import type { ArtifactOpenAt } from '../../artifacts/open-at';
import { CommentCard } from './CommentCard';
import { caretOf, marginCard /* P4-B1 */, pinOf, placeCard, stripCard, stripMax } from './placement';
import { claimCard, closeCard, useCommentCard, type CardHostKind, type CardHostMode, type OpenCard } from './store';

export interface CardFrame {
  scale: number;
  offset: { x: number; y: number };
  key: string; // changes when the frame is replaced (the viewer's `frame` string)
  locate?(selector: string): Promise<CardRect | null>; // the HTML frame's handle: a fresh function on mount and each page load
  showVersion?(at: ArtifactOpenAt, location?: ArtifactLocation): void; // the host viewer's: a version asked for from a card thread's row (P3-L M6b fix wave 2); P4-B4: or by a link's place (its version id)
  // P3-B start (docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D9): a document's own card controls, drawn in the
  // card's header before Close (its Resolve or Reopen), and a send of the card's composer as it sets out; the call it
  // returns is told whether the send went, before the card turns into its thread or closes, and also after the card went
  // (a send completes after its card is dismissed or replaced): the document records the comment in its thread.
  // P3-F (L154): the card's thread's Reply sets out through it too, so a later reply is recorded the same way
  actions?(card: OpenCard): ReactNode;
  onSending?(card: OpenCard, sending: { text: string; destination: 'thread' | 'main' }): (went: boolean) => void;
  // P3-B end
  // P3-F1 (the P3 interface ledger's X23 row of fix 2): the host has no chat beside it, so the composing card names the
  // session its comment goes to
  namesParent?: true;
  // P4-B1 start (D8; X36's draft rule, which the document host opts into): the composing field's text as it changes
  // (`draftOf` gives a remounted card its text back), Escape on a non-empty field returning the keyboard to the host's
  // control and keeping the card, and focus leaving the card for elsewhere with an empty field discarding it (C4, C6)
  onDraft?(card: OpenCard, text: string): void;
  draftOf?(card: OpenCard): string;
  keepDraftOnEscape?: true;
  discardOnBlurEmpty?: true;
  // P4-B1 end
}

type Layout = 'anchored' | 'docked' | 'margin'; // P4-B1: margin

interface Props {
  hostId: string;
  host: CardHostKind;
  mode: CardHostMode;
  layout: Layout; // P4-B1
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
    // P4-B1: in the margin, the width is the entry's (this block's) and the height the page's scroll box's
    const tall = layout === 'margin' ? (el.closest<HTMLElement>('.ds-doc') ?? el) : el;
    const measure = () => setBox((was) => (was.width === el.clientWidth && was.height === tall.clientHeight ? was : { width: el.clientWidth, height: tall.clientHeight }));
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    if (tall !== el) observer?.observe(tall); // P4-B1
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
  const style = layout === 'docked' ? stripCard(box) : layout === 'margin' ? marginCard(box) /* P4-B1 */ : placeCard(box, pin);
  const dismiss = (serial: number) => {
    closeCard(serial);
    restoreFocus?.();
  };
  // P4-B1: what the card is told beside its dismissal: Escape kept a draft (the keyboard goes back to the host's control)
  const cardProps = (open: OpenCard) => ({ frame, visible, onDismiss: () => dismiss(open.serial), onDiscard: () => closeCard(open.serial), ...(restoreFocus && { onEscapeKept: restoreFocus }) });
  if (layout === 'margin') {
    return (
      <div ref={ref} data-card-host={host} data-card-margin="" className="relative">
        {card && <CommentCard key={card.serial} card={card} style={style} pinned={false} {...cardProps(card)} />}
      </div>
    );
  }
  if (layout === 'docked') {
    const caret = card ? caretOf(pin, box) : null;
    return (
      <div
        ref={ref}
        data-card-host={host}
        data-card-dock=""
        style={card ? { maxHeight: stripMax(box) } : undefined}
        className={`relative shrink-0 bg-bg ${card ? 'overflow-hidden' : ''}`}
      >
        {caret !== null && <Caret x={caret} />}
        {card && <CommentCard key={card.serial} card={card} style={style} pinned={false} {...cardProps(card) /* P4-B1 */} />}
      </div>
    );
  }
  return (
    // P3-G (§D4.1): the anchored card floats over the viewer's body, so a mark-up still of that body is taken without it
    <div ref={ref} data-card-host={host} data-markup-occluder className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {card && <CommentCard key={card.serial} card={card} style={style} pinned={pin !== null && style.mode !== 'docked'} {...cardProps(card) /* P4-B1 */} />}
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
// claimed), on the frame's load (a fresh `locate` handle), and when the host's box resizes. A null can be a lost or
// timed-out bridge ask, not just a missing element: ask once more even if this card has a rect from the previous frame.
// Two nulls keep what was, without an unbounded retry for an element that really is gone.
function useLocated(card: OpenCard | null, frame: CardFrame, box: { width: number; height: number }, layout: Layout /* P4-B1 */): CardRect | null {
  const [located, setLocated] = useState<{ serial: number; rect: CardRect } | null>(null);
  const serial = card?.serial ?? null;
  const selector = card?.anchor.locator ?? null;
  const { key, locate } = frame;
  const { width, height } = box;
  useEffect(() => {
    if (serial === null || selector === null || layout !== 'anchored' /* P4-B1: docked or margin */ || locate === undefined) return;
    let latest = true;
    const ask = (again: boolean) =>
      void locate(selector).then((rect) => {
        if (!latest) return;
        if (rect !== null) setLocated({ serial, rect });
        else if (again) ask(false);
      });
    ask(true);
    return () => {
      latest = false;
    };
  }, [serial, selector, key, locate, width, height, layout]);
  return located !== null && located.serial === serial ? located.rect : (card?.rect ?? null);
}
