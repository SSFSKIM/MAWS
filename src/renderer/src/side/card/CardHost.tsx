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
// located.
//
// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, §C "What the host draws", decision 8): with
// no card of its own open, the host draws its place's note there: "Sent to <title>" for a confirmed delivery, or the
// pending line of a terminal session's hand-off with Show. Docked it is one line in the strip, in a margin a line in
// the entry, over an HTML page the top right corner of the box, over a document where the card was. The host supplies
// nothing for it; `namesParent` went (the card names the receiving session by one rule).
//
// UX wave U5a (M3; §C, §F): a host shows a `subject` (an artifact's id, a browser tab's id) and registers it, with how
// many unsent comments it keeps (`holds`) and its frame's callbacks, while mounted. X36's draft rule is every host's: its
// unmounting leaves its card (the comment stays in its pass) rather than closing it. With no card of its own open and no
// line to draw, a pass of its subject that holds comments is a chip, "N unsent comments", which opens the card on the
// newest: in the strip, in the margin's entry, at the top right of an HTML page, at the passage over a document.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { CardRect } from '../../tools/code/anchor/anchor';
import { hostedInSidePane, useSidePane } from '../store';
import type { ArtifactLocation } from '@shared/artifacts/link'; // P4-B4
import type { ArtifactOpenAt } from '../../artifacts/open-at';
import { CommentCard } from './CommentCard';
import { caretOf, cardPosition, marginCard /* P4-B1 */, pinOf, placeCard, stripCard, stripMax, type CardPin, type CardStyle } from './placement';
import { cardHostEntry, claimCard, closeCard, composingOf, editComment, leaveCard, placeNoteOf, registerCardHost, unsentOf, useCommentCard, type CardHostKind, type CardHostMode, type OpenCard, type PassComment, type PlaceNote, targetOf } from './store';
import { QUIET } from '../../sessions/ui'; // UX wave U5a
import { sameKey, useLaneA } from '../../stores/lane-a';
import { useLayout } from '../../stores/layout';
import { pendingWords, SIDE_COPY } from '../copy';

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
  // UX wave U5a start (§C): how many unsent comments the host keeps (absent: many; an editor that keeps one says 'one'),
  // its card going for whatever reason, and the person dropping a comment of its pass (a document withdraws its thread)
  holds?: 'one' | 'many';
  onClosed?(card: OpenCard): void;
  onDiscarded?(comment: PassComment): void;
  // UX wave U5a end
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
  subject: string; // UX wave U5a: what the host shows, whose passes it draws (an artifact's id, a browser tab's id)
}

// A comment of a pass as the frame's card callbacks take it: the card it would be (its anchor and target).
const cardOfComment = (card: OpenCard | null, comment: PassComment, host: CardHostKind, hostId: string): OpenCard =>
  card !== null && composingOf(card)?.comment.id === comment.id ? card : { serial: 0, parent: '' as OpenCard['parent'], anchor: comment.anchor, host, hostId, claimMode: null, openedAt: 0, target: targetOf(comment.anchor), rect: comment.rect, phase: { kind: 'composing', pass: '', comment: comment.id } };

export function CommentCardHost({ hostId, host, mode, layout, accepts, frame, visible, restoreFocus, subject }: Props) {
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

  // UX wave U5a: registered while mounted, with the latest frame's callbacks for a comment of its pass. Its unmounting
  // leaves its card (the comment stays in its pass); the check waits a microtask, so StrictMode's replay and a remount
  // under the same id (a tab switch) keep it open
  const latest = useRef(frame);
  useLayoutEffect(() => {
    latest.current = frame;
  });
  const holds = frame.holds ?? 'many';
  useEffect(() => {
    const off = registerCardHost(hostId, {
      kind: host,
      subject,
      holds,
      sending: (comment, sending) => latest.current.onSending?.(cardOfComment(useCommentCard.getState().open, comment, host, hostId), sending) ?? (() => {}),
      discarded: (comment) => latest.current.onDiscarded?.(comment),
    });
    return () => {
      off();
      queueMicrotask(() => {
        const card = useCommentCard.getState().open;
        if (card?.hostId !== hostId || hostOf(hostId)) return;
        if (card.phase.kind === 'composing') leaveCard(card.serial);
        else closeCard(card.serial);
      });
    };
  }, [hostId, host, subject, holds]);

  const card = open?.hostId === hostId ? open : null;
  // UX wave U5a (§C): told once when this host's card went, for whatever reason (closed, sent, replaced, handed to another
  // host, the host gone). Asked a microtask after the effect's cleanup, as the unmount's leave is: a StrictMode replay or
  // a remount under the same id, which keep the card open on this host, report nothing; the mount drawing it then does.
  const shownCard = card?.serial ?? null;
  useEffect(() => {
    if (shownCard === null) return;
    const went = useCommentCard.getState().open;
    if (went?.serial !== shownCard) return;
    // Drawing it again (a card handed back to this host): its next loss is a new one to report.
    if (reportedClosed.get(hostId) === shownCard) reportedClosed.delete(hostId);
    return () => {
      queueMicrotask(() => {
        const open = useCommentCard.getState().open;
        if (reportedClosed.get(hostId) === shownCard) return; // another mount of this host id told it already
        if (open?.serial === shownCard && open.hostId === hostId && hostOf(hostId)) return; // still this host's
        reportedClosed.set(hostId, shownCard);
        latest.current.onClosed?.(went);
      });
    };
  }, [shownCard, hostId]);
  const rect = useLocated(card, frame, box, layout);
  const pin = rect ? pinOf(rect, frame) : null;
  const style = layout === 'docked' ? stripCard(box) : layout === 'margin' ? marginCard(box) /* P4-B1 */ : placeCard(box, pin);
  // UX wave U5a: the place's note, drawn while no card of this host's is open; over a document where its card last was
  // pinned (kept from the renders that drew it, React's pattern for information from earlier renders)
  const note = useCommentCard((s) => placeNoteOf(s.notes, host, subject));
  const [lastPin, setLastPin] = useState<CardPin | null>(null);
  if (card !== null && pin !== null && (lastPin === null || pin.x !== lastPin.x || pin.y !== lastPin.y || pin.top !== lastPin.top)) setLastPin(pin);
  const placeNote = card === null && note !== null ? note : null;
  // UX wave U5a (§C): the chip, while no card is open on this subject's passes and no line is drawn
  const passes = useCommentCard((s) => s.passes);
  const composing = composingOf(open, { passes });
  const onSubject = composing !== null && composing.pass.host === host && composing.pass.subject === subject;
  const chip = card === null && placeNote === null && !onSubject ? unsentOf(passes, host, subject) : null;
  const chipAt = useChipPin(chip === null || layout !== 'anchored' || host !== 'artifact' ? null : chip.newest, frame, box);
  const openChip = () => chip && editComment(chip.newest.pass, chip.newest.comment, hostId);
  const cardProps = (open: OpenCard) => ({
    frame,
    visible,
    onDismiss: () => {
      closeCard(open.serial);
      restoreFocus?.();
    },
    ...(restoreFocus && { restoreFocus }),
  });
  if (layout === 'margin') {
    return (
      <div ref={ref} data-card-host={host} data-card-margin="" className="relative">
        {card && <CommentCard key={card.serial} card={card} style={style} pinned={false} {...cardProps(card)} />}
        {placeNote && <PlaceLine note={placeNote} className="py-1" /> /* UX wave U5a */}
        {chip && <UnsentChip count={chip.count} onOpen={openChip} className="my-1" />}
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
        {placeNote && <PlaceLine note={placeNote} className="px-3 py-1" /> /* UX wave U5a: one line in the strip */}
        {chip && <UnsentChip count={chip.count} onOpen={openChip} className="mx-3 my-1" />}
      </div>
    );
  }
  return (
    // P3-G (§D4.1): the anchored card floats over the viewer's body, so a mark-up still of that body is taken without it
    <div ref={ref} data-card-host={host} data-markup-occluder className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {card && <CommentCard key={card.serial} card={card} style={style} pinned={pin !== null && style.mode !== 'docked'} {...cardProps(card) /* P4-B1 */} />}
      {placeNote && <FloatingLine note={placeNote} where={host === 'artifact' && lastPin !== null ? placeCard(box, lastPin) : null} /> /* UX wave U5a */}
      {chip && <FloatingChip count={chip.count} onOpen={openChip} where={host !== 'artifact' ? null : chipAt !== null ? placeCard(box, pinOf(chipAt, frame)) : lastPin !== null ? placeCard(box, lastPin) : null} />}
    </div>
  );
}

const hostOf = (hostId: string): boolean => cardHostEntry(hostId) !== null;

// The last card each host id told it lost (`onClosed`), by its serial: several mounts of a host (StrictMode's replay, a
// remount under the same id) may each ask after the card went, and one loss is told once. Kept per host id, since a card
// handed to another host (`handCardTo`) keeps its serial and is that host's to lose next; a host draws one card at a
// time, so this is one entry per host id.
const reportedClosed = new Map<string, number>();

// UX wave U5a (§C): the chip of a pass with no card open; a click opens the card on its newest comment.
function UnsentChip({ count, onOpen, className, style }: { count: number; onOpen(): void; className: string; style?: CSSProperties }) {
  return (
    <button type="button" data-unsent-chip={count} style={style} onClick={onOpen} className={`${QUIET} text-ui-sm ${className}`}>
      {SIDE_COPY.card.unsent(count)}
    </button>
  );
}

// Over a frame the chip floats raised, as the line does: at the passage over a document, else the box's top right.
function FloatingChip({ count, onOpen, where }: { count: number; onOpen(): void; where: CardStyle | null }) {
  const chip = 'pointer-events-auto absolute rounded-sm border border-border bg-bg-raised shadow-float';
  if (where === null || where.mode === 'strip' || where.mode === 'margin') return <UnsentChip count={count} onOpen={onOpen} className={`${chip} top-2 right-2`} />;
  const { left, top, bottom } = cardPosition(where);
  return <UnsentChip count={count} onOpen={onOpen} className={chip} style={{ left, top, bottom }} />;
}

// Where the newest unsent comment's passage is, over a document, located as a card's would be (the frame finds the
// document's unsent comment with no card open); null until found, or with nothing to find.
function useChipPin(newest: { pass: string; comment: string } | null, frame: CardFrame, box: { width: number; height: number }): CardRect | null {
  const [found, setFound] = useState<{ comment: string; rect: CardRect | null } | null>(null);
  const comment = newest?.comment ?? null;
  const { key, locate } = frame;
  const { width, height } = box;
  const selector = useCommentCard((s) => (newest === null ? null : (s.passes.get(newest.pass)?.comments.find((each) => each.id === newest.comment)?.anchor.locator ?? null)));
  useEffect(() => {
    if (comment === null || selector === null || locate === undefined) return;
    let live = true;
    void locate(selector).then((rect) => {
      if (live) setFound({ comment, rect });
    });
    return () => {
      live = false;
    };
  }, [comment, selector, key, locate, width, height]);
  return found !== null && found.comment === comment ? found.rect : null;
}

// UX wave U5a: over a frame the line floats as a small raised chip, where the card last was over a document (its
// corner's offsets, not its size), else in the box's top right corner.
function FloatingLine({ note, where }: { note: PlaceNote; where: CardStyle | null }) {
  const chip = 'pointer-events-auto absolute rounded-sm border border-border bg-bg-raised px-2 py-0.5 shadow-float';
  if (where === null || where.mode === 'strip' || where.mode === 'margin') return <PlaceLine note={note} className={`${chip} top-2 right-2`} />;
  const { left, top, bottom } = cardPosition(where);
  return <PlaceLine note={note} className={chip} style={{ left, top, bottom }} />;
}

// UX wave U5a: the line itself. A sent line is its words; a pending one is its pending send's state in the strip's
// words, followed by key, with Show, which brings the session's tab (and its composer's strip) to the front.
function PlaceLine({ note, className, style }: { note: PlaceNote; className: string; style?: CSSProperties }) {
  if (note.kind === 'sent') {
    return (
      <p role="status" data-sent-note="" style={style} className={`m-0 truncate text-ui-sm text-fg-muted ${className}`}>
        {note.text}
      </p>
    );
  }
  return <PendingLine note={note} className={className} {...(style && { style })} />;
}

function PendingLine({ note, className, style }: { note: Extract<PlaceNote, { kind: 'pending' }>; className: string; style?: CSSProperties }) {
  const send = useLaneA((s) => s.pendingSends.get(note.appSessionId)?.find((held) => sameKey(held.key, note.key)) ?? null);
  if (send === null) return null; // its send left: the store turns the line into the sent one, or drops it
  return (
    <div role="status" data-pending-note={send.state} style={style} className={`flex min-w-0 items-baseline gap-2 text-ui-sm ${send.state === 'refused' ? 'text-danger' : 'text-fg-muted'} ${className}`}>
      <span className="min-w-0 truncate">{pendingWords(send, note.title)}</span>
      <button type="button" className={`${QUIET} shrink-0 text-ui-sm`} onClick={() => useLayout.getState().openSession(note.appSessionId)}>
        {SIDE_COPY.place.show}
      </button>
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
