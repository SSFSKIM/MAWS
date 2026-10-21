// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9; M7): the frame around the stage that P2's comment
// card is drawn over. The shell's surface (B's `DocumentComments`) draws its card host here, filling the frame, with the
// editor's reach (B's `CommentOverlayProps`): where a thread's element is drawn now (its box on screen, relative to the
// frame; nothing when its slide is not the one shown, so the card stays where it was), which thread is active, and the
// thread writes its card makes (Resolve, Reopen, the sent comment recorded as the thread's message, an unsent draft
// withdrawn), each under the comments' origin. The layout key moves with the deck, the zoom, the slide shown, a scroll
// a resize and (fix wave 1) every layout pass of the stage's canvas, so the card re-pins to its element even when a
// token or a face moves it with no deck write. ⌥⌘M comments the selected element.
//
// P4-B2 (D16 of docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md; the prior art's V2, V4, V12): the frame also
// holds the pin popover (PinPopover.tsx), outside the stage's surface. The card stands at its thread's pin (`locate`
// answers the pin's rect, read from the element as drawn: `pinRectOf`), so ⌥⌘M opens at the pin;
// while a popover is open the card's host is hidden, never unmounted, so its draft and its send live on. The card's
// host tells the editor which thread it is on (`hosting`). ⌥⌘M closes the popover first; ⌥⌘⇧J hides and shows the pins
// (Slides' key; Figma's Shift+C would collide with typing on a selected text element).
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { CommentOverlayProps, DocumentComments, PassageRect } from '../../../document/editor/comments/surface';
import type { SlideCanvas } from '../../canvas';
import { discardThread, getThread, newThreadId, reopen, reply, resolve } from '../../threads';
import { useDocVersion } from '../transform/use-doc-version';
import { COMMENTS_ORIGIN, type DeckCommentsApi } from './controller';
import { PinPopover, useShownSlide } from './PinPopover';
import './comments.css';

interface Props {
  api: DeckCommentsApi;
  surface: DocumentComments | undefined;
  /** The stage's canvas (the slide shown). */
  canvas: SlideCanvas | null;
  scale: number;
  children: ReactNode;
}

export function CommentFrame({ api, surface, canvas, scale, children }: Props) {
  const { session, author, readOnly, setActive, setComposing } = api;
  const frame = useRef<HTMLDivElement | null>(null);
  // P4-B2: the frame as mounted, for the popover, which places itself in it
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const attach = useCallback((element: HTMLDivElement | null) => {
    const frameRef = frame; // a ref by its name, so the React Compiler takes this write for a ref's (World.tsx's way)
    frameRef.current = element;
    setHost(element);
  }, []);
  const version = useDocVersion(session);
  const shownSlide = useShownSlide(api); // P4-B2
  const [layout, setLayout] = useState(0);
  const pending = useRef<number | null>(null);
  const moved = useCallback(() => {
    if (pending.current !== null) return;
    pending.current = requestAnimationFrame(() => {
      pending.current = null;
      setLayout((n) => n + 1);
    });
  }, []);
  useEffect(() => {
    const box = frame.current;
    const observer = typeof ResizeObserver === 'undefined' || !box ? null : new ResizeObserver(moved);
    if (box) observer?.observe(box);
    return () => {
      observer?.disconnect();
      if (pending.current !== null) cancelAnimationFrame(pending.current);
      pending.current = null;
    };
  }, [moved]);
  // fix wave 1: the stage's layout passes move elements with no deck write (a token, a face): the card locates again
  useEffect(() => canvas?.onLayout(moved), [canvas, moved]);

  const reach = useMemo<Omit<CommentOverlayProps, 'layoutKey'>>(() => {
    const doc = session.doc;
    const writable = (threadId: string) => !readOnly && getThread(doc, threadId) !== null;
    return {
      doc,
      locate: (threadId) => pinRect(canvas, frame.current, getThread(doc, threadId)), // P4-B2: at the pin
      setActive,
      resolve: (threadId) => void (writable(threadId) && resolve(doc, threadId, author.actor, author.now(), COMMENTS_ORIGIN)),
      reopen: (threadId) => void (writable(threadId) && reopen(doc, threadId, author.actor, author.now(), COMMENTS_ORIGIN)),
      record: (threadId, body) => void (writable(threadId) && reply(doc, threadId, { id: `${threadId}:${newThreadId()}`, by: author.actor, at: author.now(), body }, COMMENTS_ORIGIN)),
      discard: (threadId) => void (!readOnly && discardThread(doc, threadId, COMMENTS_ORIGIN)),
      focus: () => frame.current?.querySelector<HTMLElement>('[data-stage-surface]')?.focus({ preventScroll: true }),
      hosting: setComposing, // P4-B2
    };
  }, [session, canvas, readOnly, author, setActive, setComposing]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => commentKeys(event, api);

  const layoutKey = `${canvas?.slideId ?? ''}:${scale}:${version}:${layout}`;
  return (
    <div ref={attach} className="deck-comment-frame" onScrollCapture={moved} onKeyDown={onKeyDown}>
      {children}
      {/* P4-B2: the card's host stays mounted under an open popover, hidden */}
      <div className="deck-comment-card-slot" data-card-slot={api.popover ? 'hidden' : undefined}>
        {surface?.overlay({ ...reach, layoutKey })}
      </div>
      <PinPopover api={api} host={host} shownSlide={shownSlide} layoutKey={layoutKey} />
    </div>
  );
}

/**
 * The comment frame's keys, the deck's and the design's: ⌥⌘M comments (the popover closed first, so the card it opens
 * shows; Google Slides' and Docs' key), ⌥⌘⇧J hides or shows the pins (P4-B2, Slides'). A key's character changes under ⌥;
 * its code does not.
 */
export function commentKeys(event: KeyboardEvent<HTMLElement>, api: DeckCommentsApi): void {
  if (!event.altKey || !(event.metaKey || event.ctrlKey) || event.nativeEvent.isComposing) return;
  if (event.code === 'KeyJ' && event.shiftKey) {
    event.preventDefault();
    api.togglePins();
    return;
  }
  if (event.code !== 'KeyM' || event.shiftKey) return;
  const wasOpen = api.popover !== null;
  if (wasOpen) api.closePopover();
  if (api.comment() !== null || wasOpen) event.preventDefault();
}

/** A thread's element as drawn on the stage, relative to the frame; null when it is not on the slide shown. */
function elementRect(canvas: SlideCanvas | null, frame: HTMLElement | null, thread: { slideId: string; elementId: string } | null): PassageRect | null {
  if (!canvas || !frame || !thread || canvas.slideId !== thread.slideId) return null;
  const node = canvas.node(thread.elementId);
  if (!node) return null;
  const r = node.getBoundingClientRect();
  const f = frame.getBoundingClientRect();
  return { x: r.left - f.left, y: r.top - f.top, width: r.width, height: r.height };
}

/**
 * P4-B2: where a thread's card stands, relative to the frame: its pin, which stands on the top-right corner of what it
 * marks (`rect`, as drawn now) above it (comments.css's `.deck-comment-pin`: 20 px, its point 2 px right of the corner).
 * Read from the drawn element, not the pin's node, so the card is located in the same pass as the element moves and
 * where the pin is not drawn (hidden, merged on a zoomed-out world) it still points there. The deck's and the design's.
 */
export function pinRectOf(rect: PassageRect | null): PassageRect | null {
  return rect && { x: rect.x + rect.width + PIN_GAP_PX, y: rect.y - PIN_PX, width: PIN_PX, height: PIN_PX };
}
const PIN_PX = 20;
const PIN_GAP_PX = 2;

const pinRect = (canvas: SlideCanvas | null, frame: HTMLElement | null, thread: { slideId: string; elementId: string } | null): PassageRect | null => pinRectOf(elementRect(canvas, frame, thread));
