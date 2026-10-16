// P3-E1 M4 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M4; the parent's §1 "Comments", Decision Logs 12,
// 13 (2) and 20): the design's comments, composed over C's (../../slides/editor/comments/) rather than copied. C's
// controller comments the one selected element; the design adds the board: with no element selected, Comment anchors a
// thread at the selected (else the active) board's ROOT, quoting its title. Both open P2's card through B's surface, the
// element's through C's controller with the surface's passage renamed for a board (its title, not a slide number) and
// both naming their target (`artifactTarget`, Decision Log 12) for the agent's lead. Showing a board's thread selects
// the board's frame. C's pins, rail, Resolve and Reopen, reply and orphan reading are C's as they are; this module adds
// the comment frame's locator over every board (an element's box on its board's canvas, a board's frame) and the
// boards' own pins at their top-right corners. Thread writes carry C's comments origin, outside undo.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { CommentAuthor, CommentOverlayProps, DocumentComments, PassageRect } from '../../document/editor/comments/surface';
import type { SlideCanvas } from '../../slides/canvas';
import { ROOT } from '../../slides/model';
import { addThread, discardThread, elementQuote, getThread, newThreadId, reopen, reply, resolve, type DeckThread } from '../../slides/threads';
import { COMMENTS_ORIGIN, HUMAN_AUTHOR, useDeckComments, type DeckCommentsApi } from '../../slides/editor/comments/controller';
import { COMMENTS_COPY } from '../../slides/editor/comments/copy';
import { useDeckThreadStates, useOpenThreadCount } from '../../slides/editor/comments/use-threads';
import type { DeckSession } from '../../slides/editor/session';
import { useDocVersion } from '../../slides/editor/transform/use-doc-version';
import * as Y from '../../yjs/slides';
import type { BoardFrame } from '../canvas';
import { boardLabel, type BoardView } from './boards';
import { DESIGN_COPY as C } from './copy';
import type { DesignView } from './viewport';
import '../../slides/editor/comments/comments.css';

/** How the chrome names a board from the model (its title, else its id). */
const labelOf = (session: DeckSession, boardId: string): string => {
  const title = Y.hasSlide(session.doc, boardId) ? Y.slideScalars(session.doc, boardId).title : undefined;
  return boardLabel({ id: boardId, title: typeof title === 'string' ? title : '' });
};

export interface DesignCommentsOptions {
  session: DeckSession;
  view: DesignView;
  surface: DocumentComments | undefined;
  author?: CommentAuthor;
  readOnly: boolean;
  openRail(): void;
  /** Brings a board into view (a shown thread's). */
  reveal(boardId: string): void;
}

/** The board a comment with no element selected is on: the selected frame's, else the active board's. */
const boardTarget = (session: DeckSession, view: DesignView): string | null => view.snapshot().frame ?? session.snapshot().currentSlide;

/** C's comments controller with the design's board target, labels and show (module header). */
export function useDesignComments({ session, view, surface, author = HUMAN_AUTHOR, readOnly, openRail, reveal }: DesignCommentsOptions): DeckCommentsApi {
  // C's controller names a passage by the slide's number; a design's is the board's title, and the target an element
  const elementSurface = useMemo<DocumentComments | undefined>(
    () => surface && { ...surface, opened: (passage) => surface.opened({ ...passage, tabTitle: labelOf(session, passage.tabId), artifactTarget: 'element' }) },
    [surface, session],
  );
  const deck = useDeckComments({ session, surface: elementSurface, author, readOnly, openRail });
  const { setActive } = deck;

  const commentBoard = useCallback(
    (boardId: string): string | null => {
      if (!surface || readOnly) return null;
      const doc = session.doc;
      const quote = elementQuote(doc, boardId, ROOT); // the board's title (its id untitled); '' when it is no board
      if (quote === '') return null;
      const threadId = newThreadId();
      addThread(doc, { threadId, slideId: boardId, elementId: ROOT, quote, by: author.actor, at: author.now() }, COMMENTS_ORIGIN);
      setActive(threadId);
      surface.opened({ threadId, tabId: boardId, tabTitle: labelOf(session, boardId), quote, artifactTarget: 'board' });
      return threadId;
    },
    [surface, readOnly, session, author, setActive],
  );
  const comment = useCallback((): string | null => {
    const { selection } = session.snapshot();
    if (selection.length === 1) return deck.comment();
    if (selection.length > 0) return null;
    const board = boardTarget(session, view);
    return board === null ? null : commentBoard(board);
  }, [session, view, deck, commentBoard]);
  const show = useCallback(
    (thread: Pick<DeckThread, 'id' | 'slideId' | 'elementId'>) => {
      if (thread.elementId !== ROOT) {
        deck.show(thread);
        if (Y.hasSlide(session.doc, thread.slideId)) reveal(thread.slideId);
        return;
      }
      if (Y.hasSlide(session.doc, thread.slideId)) {
        session.show(thread.slideId);
        session.select([]);
        view.selectFrame(thread.slideId);
        reveal(thread.slideId);
      }
      setActive(thread.id);
    },
    [deck, session, view, reveal, setActive],
  );
  return useMemo(() => ({ ...deck, comment, show }), [deck, comment, show]);
}

/** The toolbar's Comment (the one selected element, else the selected or active board) and Comments with the open count. */
export function DesignCommentButtons({ api, view, railOpen, onToggleRail }: { api: DeckCommentsApi; view: DesignView; railOpen: boolean; onToggleRail(): void }) {
  const { session } = api;
  const selection = useSyncExternalStore(session.subscribe, () => session.snapshot().selection);
  const target = useSyncExternalStore(view.subscribe, () => boardTarget(session, view));
  const open = useOpenThreadCount(session.doc);
  const board = selection.length === 0 && target !== null;
  return (
    <>
      {api.canComment && (
        <button type="button" className="deck-button" title={board ? C.commentBoard(labelOf(session, target)) : C.commentTitle} disabled={selection.length !== 1 && !board} onClick={() => api.comment()}>
          {COMMENTS_COPY.comment}
        </button>
      )}
      <button type="button" className="deck-button" aria-label={COMMENTS_COPY.commentsOpen(open)} aria-pressed={railOpen} data-comments-toggle onClick={onToggleRail}>
        {COMMENTS_COPY.comments}
        {open > 0 ? ` ${open}` : ''}
      </button>
    </>
  );
}

interface FrameProps {
  api: DeckCommentsApi;
  surface: DocumentComments | undefined;
  view: DesignView;
  boards: readonly BoardView[];
  canvases: ReadonlyMap<string, SlideCanvas>;
  children: ReactNode;
}

/**
 * The frame around the world P2's card is drawn over (C's `CommentFrame` for a world of boards): the card's thread is
 * located on whichever board it is on, an element by its node on that board's canvas, a board by its frame on screen;
 * the layout key moves with the view, every update and every board's layout pass. ⌥⌘M comments. The boards' pins.
 */
export function DesignCommentFrame({ api, surface, view, boards, canvases, children }: FrameProps) {
  const { session, author, readOnly, setActive } = api;
  const frame = useRef<HTMLDivElement>(null);
  const version = useDocVersion(session);
  const viewport = useSyncExternalStore(view.subscribe, () => view.snapshot().viewport);
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
  useEffect(() => {
    const offs = [...canvases.values()].map((canvas) => canvas.onLayout(moved));
    return () => offs.forEach((off) => off());
  }, [canvases, moved]);

  const latest = useRef(canvases);
  useLayoutEffect(() => {
    latest.current = canvases;
  });
  const reach = useMemo<Omit<CommentOverlayProps, 'layoutKey'>>(() => {
    const doc = session.doc;
    const writable = (threadId: string) => !readOnly && getThread(doc, threadId) !== null;
    return {
      doc,
      locate: (threadId) => threadRect(latest.current, frame.current, getThread(doc, threadId)),
      setActive,
      resolve: (threadId) => void (writable(threadId) && resolve(doc, threadId, author.actor, author.now(), COMMENTS_ORIGIN)),
      reopen: (threadId) => void (writable(threadId) && reopen(doc, threadId, author.actor, author.now(), COMMENTS_ORIGIN)),
      record: (threadId, body) => void (writable(threadId) && reply(doc, threadId, { id: `${threadId}:${newThreadId()}`, by: author.actor, at: author.now(), body }, COMMENTS_ORIGIN)),
      discard: (threadId) => void (!readOnly && discardThread(doc, threadId, COMMENTS_ORIGIN)),
      focus: () => frame.current?.querySelector<HTMLElement>('[data-stage-surface]')?.focus({ preventScroll: true }),
    };
  }, [session, readOnly, author, setActive]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.code !== 'KeyM' || !event.altKey || !(event.metaKey || event.ctrlKey) || event.shiftKey) return;
    if (api.comment() !== null) event.preventDefault();
  };
  const at = viewport ? `${viewport.zoom}:${viewport.x}:${viewport.y}` : '';
  return (
    <div ref={frame} className="deck-comment-frame design-comment-frame" data-design-comment-frame onKeyDown={onKeyDown}>
      {children}
      {viewport && <BoardPins api={api} boards={boards} zoom={viewport.zoom} x={viewport.x} y={viewport.y} />}
      {surface?.overlay({ ...reach, layoutKey: `${at}:${version}:${layout}` })}
    </div>
  );
}

/** A thread's element or board as drawn now, relative to the frame; null when it is not drawn. */
function threadRect(canvases: ReadonlyMap<string, SlideCanvas>, frame: HTMLElement | null, thread: { slideId: string; elementId: string } | null): PassageRect | null {
  if (!frame || !thread) return null;
  const node = thread.elementId === ROOT ? frame.querySelector<HTMLElement>(`[data-board-id="${thread.slideId}"]`) /* a board id is [A-Za-z0-9_-] */ : (canvases.get(thread.slideId)?.node(thread.elementId) ?? null);
  if (!node) return null;
  const r = node.getBoundingClientRect();
  const f = frame.getBoundingClientRect();
  return { x: r.left - f.left, y: r.top - f.top, width: r.width, height: r.height };
}

/** One pin per board carrying an open board-level thread, at its frame's top-right corner on screen. */
function BoardPins({ api, boards, zoom, x, y }: { api: DeckCommentsApi; boards: readonly BoardView[]; zoom: number; x: number; y: number }) {
  const threads = useDeckThreadStates(api.session.doc);
  const byBoard = useMemo(() => {
    const out = new Map<string, typeof threads>();
    for (const t of threads) if (t.elementId === ROOT && t.status === 'open' && t.live) out.set(t.slideId, [...(out.get(t.slideId) ?? []), t]);
    return out;
  }, [threads]);
  if (byBoard.size === 0) return null;
  const frames = new Map(boards.flatMap((b): [string, BoardFrame][] => (b.frame ? [[b.id, b.frame]] : [])));
  return (
    <div className="design-board-pins">
      {[...byBoard].map(([boardId, list]) => {
        const f = frames.get(boardId);
        if (!f) return null;
        const latest = list[list.length - 1]!;
        const style: CSSProperties = { left: x + (f.x + f.w) * zoom, top: y + f.y * zoom };
        return (
          <button
            key={boardId}
            type="button"
            className="deck-comment-pin"
            data-board-pin={boardId}
            data-threads={list.map((t) => t.id).join(' ')}
            data-active={list.some((t) => t.id === api.active) || undefined}
            aria-label={COMMENTS_COPY.pin(latest.quote, list.length)}
            title={COMMENTS_COPY.pin(latest.quote, list.length)}
            style={style}
            onClick={() => api.openRail(latest.id)}
          >
            {list.length > 1 ? list.length : ''}
          </button>
        );
      })}
    </div>
  );
}
