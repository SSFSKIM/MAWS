// P4-B2 (D16 of docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md; the P4 spec's §2 item 2 and §4.3; the prior
// art's V2 to V9): the pin popover of a deck's slide or a design's board, mounted by both comment frames, outside the
// stage's surface. It draws the open pin's threads in X36's ThreadPopover (the compose card's own thread left out while
// nothing is said in it: that card is its view), the drafts the editor's (shared with the rail), the writes the comments'
// own, outside undo.
//
// Placement: the card's (`placeCard(box, pinOf(pinRect))`), the box the frame's client size and the pin's rect read
// against the frame, re-placed in a layout effect after every render, after every placement the pins commit
// (`pinMoves`), at a resize and inside the frame's scroll handler (a scroll of the stage), so it never trails its pin
// by a frame (V6); hidden while its pin is outside the stage's visible rect, or not drawn.
//
// While it is open: a press inside the stage that is not on it or a pin closes it and is consumed with its click (it
// selects nothing, starts no marquee and no pan), the keyboard going to the pin (V4); a press outside the frame closes it and goes on;
// Escape on the stage closes it before the stage's own Escape. It closes on its own when its pin goes: the last open
// thread resolved, the element deleted (its threads stay, orphans in the rail, V9), or (the deck) the slide changed;
// the drafts stay (V5, V8). The keyboard goes into the popover when it opens and to the pin when it closes, never to
// the stage (the stage's keyboard is the state machine's, P4-B2 Decision Log 9).
import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { pinOf, placeCard, type CardStyle } from '../../../comments/placement';
import { ThreadPopover } from '../../../comments/ThreadPopover';
import { resolveAnchor } from '../../model';
import { newThreadId, reopen, reply, resolve } from '../../threads';
import { useDocVersion } from '../transform/use-doc-version';
import { COMMENTS_ORIGIN, type DeckCommentsApi, type PinTarget } from './controller';
import { COMMENTS_COPY as C } from './copy';
import { useReplyDrafts } from './drafts';
import { pinNode } from './Pins';
import { useOpenDeckThreads } from './use-threads';

const IDENTITY = { scale: 1, offset: { x: 0, y: 0 } };
const OWN = '[data-pin-popover], .deck-comment-pin'; // a press on these is theirs

interface Props {
  api: DeckCommentsApi;
  /** The frame it is placed in (as mounted): its host box, holding the stage's surface and the pins. */
  host: HTMLElement | null;
  /** The deck's: the slide on the stage, whose change closes the popover. A design's pins are on every board. */
  shownSlide?: string | null;
  /** Changes whenever pins may have moved without a render here (a zoom, a pan): placed again. */
  layoutKey: string;
}

export function PinPopover(props: Props) {
  return props.api.popover ? <Open {...props} target={props.api.popover} /> : null;
}

interface Placed {
  placement: CardStyle | null;
  hidden: boolean;
}

function Open({ api, host, shownSlide, layoutKey, target }: Props & { target: PinTarget }) {
  const { session, author, readOnly, drafts, pinMoves, closePopover, setActive } = api;
  const doc = session.doc;
  const version = useDocVersion(session);
  const open = useOpenDeckThreads(doc);
  // the pin's (live, so no orphan) threads; the compose card's own while nothing is said in it is the card's to show
  const threads = open.filter((t) => t.slideId === target.slideId && t.elementId === target.elementId && !(t.id === api.composing && t.messages.length === 0)).map((t) => ({ ...t, orphan: false }));
  const texts = useReplyDrafts(drafts);
  // the pin goes: nothing open on it, its element gone, or (the deck) another slide shown. Read from the model at each
  // update, never from the pins drawn (a pin shown from the rail on another slide is drawn only once its canvas is)
  const gone = threads.length === 0 || !resolveAnchor(doc, target).live || (shownSlide !== undefined && shownSlide !== target.slideId);
  useEffect(() => {
    if (gone) closePopover();
  }, [gone, closePopover, version]);

  const [placed, setPlaced] = useState<Placed>({ placement: null, hidden: true });
  const place = useCallback(() => {
    const pin = host ? pinNode(host, target) : null;
    let next: Placed = { placement: null, hidden: true };
    if (host && pin) {
      const f = host.getBoundingClientRect();
      const p = pin.getBoundingClientRect();
      const rect = { x: p.left - f.left, y: p.top - f.top, width: p.width, height: p.height };
      const stage = host.querySelector<HTMLElement>('[data-stage-surface]')?.getBoundingClientRect();
      const [cx, cy] = [p.left + p.width / 2, p.top + p.height / 2];
      const onStage = stage !== undefined && cx >= stage.left && cx <= stage.right && cy >= stage.top && cy <= stage.bottom;
      next = { placement: placeCard({ width: host.clientWidth, height: host.clientHeight }, pinOf(rect, IDENTITY)), hidden: !onStage };
    }
    setPlaced((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
  }, [host, target]);
  // after every render here (a zoom, a pan, an update), and as the pins commit theirs
  useLayoutEffect(place);
  useLayoutEffect(() => pinMoves.subscribe(place), [pinMoves, place]);
  useLayoutEffect(() => {
    if (!host) return;
    // the stage scrolled: placed inside the handler, so the popover is where its pin is in the frame that draws it
    const onScroll = () => flushSync(place);
    host.addEventListener('scroll', onScroll, { capture: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(host);
    return () => {
      host.removeEventListener('scroll', onScroll, { capture: true });
      observer?.disconnect();
    };
  }, [host, place]);
  void layoutKey; // a prop that changes renders here, and every render places again

  // the keyboard back on the pin: after an exit, or a closing press on the stage
  const toPin = useCallback(() => pinNode(host ?? document, target)?.focus({ preventScroll: true }), [host, target]);
  const exit = useCallback(() => {
    toPin();
    closePopover();
  }, [toPin, closePopover]);

  // closing presses and Escape on the stage, while it is open
  useEffect(() => {
    if (!host) return;
    const doc = host.ownerDocument;
    const onStage = (target: Element) => target.closest('[data-stage-surface]') !== null && host.contains(target);
    const inFrame = (e: PointerEvent) => {
      const target = e.target as Element;
      if (target.closest(OWN)) return;
      if (onStage(target)) {
        // consumed: the stage's overlay and the world never see it, so it selects nothing, no marquee, no pan; nor
        // does anything see the click the same gesture ends in (a board's title selects on its click)
        e.stopPropagation();
        e.preventDefault();
        swallowClick(host, e.pointerId);
        toPin();
      }
      closePopover();
    };
    const outside = (e: PointerEvent) => {
      if (!host.contains(e.target as Node)) closePopover(); // and the press goes on
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229 || !onStage(e.target as Element)) return;
      e.stopPropagation();
      e.preventDefault();
      exit();
    };
    host.addEventListener('pointerdown', inFrame, { capture: true });
    doc.addEventListener('pointerdown', outside, { capture: true });
    host.addEventListener('keydown', onKey, { capture: true });
    return () => {
      host.removeEventListener('pointerdown', inFrame, { capture: true });
      doc.removeEventListener('pointerdown', outside, { capture: true });
      host.removeEventListener('keydown', onKey, { capture: true });
    };
  }, [host, closePopover, toPin, exit]);

  if (gone) return null;
  const writable = !readOnly;
  return (
    <ThreadPopover
      key={`${target.slideId}/${target.elementId}/${target.threadId ?? ''}`}
      threads={threads}
      initial={target.threadId ?? null}
      placement={placed.placement}
      hidden={placed.hidden}
      label={C.popover(threads[0]!.quote)}
      drafts={texts}
      onDraftChange={(threadId, text) => drafts.set(threadId, text)}
      onReply={(threadId, body) => writable && reply(doc, threadId, { id: `${threadId}:${newThreadId()}`, by: author.actor, at: author.now(), body }, COMMENTS_ORIGIN)}
      onResolve={(threadId) => writable && resolve(doc, threadId, author.actor, author.now(), COMMENTS_ORIGIN)}
      onReopen={(threadId) => writable && reopen(doc, threadId, author.actor, author.now(), COMMENTS_ORIGIN)}
      onExit={exit}
      onActiveChange={setActive}
      readOnly={readOnly}
    />
  );
}

/**
 * The click a consumed press's gesture ends in, swallowed at the frame: a cancelled pointerdown does not cancel it. Only a
 * click a pointer made is taken (a keyboard activation, `detail` 0, acts), and the swallower goes at the earliest of that
 * click, just after the gesture's pointerup (or pointercancel), or the next pointerdown anywhere (a gesture whose end never
 * came); it leaves nothing attached, and outlives the popover, which the press closes. The consumed pointerdown itself
 * stopped at the frame, past the window's capture, so the window's listener added here never sees it.
 */
function swallowClick(host: HTMLElement, pointerId: number): void {
  const win = host.ownerDocument.defaultView ?? window;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const remove = () => {
    clearTimeout(timer);
    host.removeEventListener('click', onClick, { capture: true });
    win.removeEventListener('pointerup', end, { capture: true });
    win.removeEventListener('pointercancel', end, { capture: true });
    win.removeEventListener('pointerdown', remove, { capture: true });
  };
  const onClick = (e: MouseEvent) => {
    if (e.detail === 0) return;
    e.stopPropagation();
    e.preventDefault();
    remove();
  };
  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    win.removeEventListener('pointerup', end, { capture: true });
    win.removeEventListener('pointercancel', end, { capture: true });
    timer = setTimeout(remove, 0);
  };
  host.addEventListener('click', onClick, { capture: true });
  win.addEventListener('pointerup', end, { capture: true });
  win.addEventListener('pointercancel', end, { capture: true });
  win.addEventListener('pointerdown', remove, { capture: true });
}

/** P4-B2: the deck's slide shown, as the frame reads it. */
export function useShownSlide(api: DeckCommentsApi): string | null {
  const { session } = api;
  return useSyncExternalStore(session.subscribe, () => session.snapshot().currentSlide);
}
