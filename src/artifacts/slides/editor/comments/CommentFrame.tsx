// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9; M7): the frame around the stage that P2's comment
// card is drawn over. The shell's surface (B's `DocumentComments`) draws its card host here, filling the frame, with the
// editor's reach (B's `CommentOverlayProps`): where a thread's element is drawn now (its box on screen, relative to the
// frame; nothing when its slide is not the one shown, so the card stays where it was), which thread is active, and the
// thread writes its card makes (Resolve, Reopen, the sent comment recorded as the thread's message, an unsent draft
// withdrawn), each under the comments' origin. The layout key moves with the deck, the zoom, the slide shown, a scroll
// a resize and (fix wave 1) every layout pass of the stage's canvas, so the card re-pins to its element even when a
// token or a face moves it with no deck write. ⌥⌘M comments the selected element.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { CommentOverlayProps, DocumentComments, PassageRect } from '../../../document/editor/comments/surface';
import type { SlideCanvas } from '../../canvas';
import { discardThread, getThread, newThreadId, reopen, reply, resolve } from '../../threads';
import { useDocVersion } from '../transform/use-doc-version';
import { COMMENTS_ORIGIN, type DeckCommentsApi } from './controller';
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
  const { session, author, readOnly, setActive } = api;
  const frame = useRef<HTMLDivElement>(null);
  const version = useDocVersion(session);
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
      locate: (threadId) => elementRect(canvas, frame.current, getThread(doc, threadId)),
      setActive,
      resolve: (threadId) => void (writable(threadId) && resolve(doc, threadId, author.actor, author.now(), COMMENTS_ORIGIN)),
      reopen: (threadId) => void (writable(threadId) && reopen(doc, threadId, author.actor, author.now(), COMMENTS_ORIGIN)),
      record: (threadId, body) => void (writable(threadId) && reply(doc, threadId, { id: `${threadId}:${newThreadId()}`, by: author.actor, at: author.now(), body }, COMMENTS_ORIGIN)),
      discard: (threadId) => void (!readOnly && discardThread(doc, threadId, COMMENTS_ORIGIN)),
      focus: () => frame.current?.querySelector<HTMLElement>('[data-stage-surface]')?.focus({ preventScroll: true }),
    };
  }, [session, canvas, readOnly, author, setActive]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // ⌥⌘M (Google Slides' and Docs' key); the key's character changes under ⌥, its code does not
    if (event.code !== 'KeyM' || !event.altKey || !(event.metaKey || event.ctrlKey) || event.shiftKey) return;
    if (api.comment() !== null) event.preventDefault();
  };

  return (
    <div ref={frame} className="deck-comment-frame" onScrollCapture={moved} onKeyDown={onKeyDown}>
      {children}
      {surface?.overlay({ ...reach, layoutKey: `${canvas?.slideId ?? ''}:${scale}:${version}:${layout}` })}
    </div>
  );
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
