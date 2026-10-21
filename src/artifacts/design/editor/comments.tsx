// P3-E1 M4 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M4; the parent's §1 "Comments", Decision Logs 12,
// 13 (2) and 20): the design's comments, composed over C's (../../slides/editor/comments/) rather than copied. C's
// controller comments the one selected element; the design adds the board: with no element selected, Comment anchors a
// thread at the selected (else the active) board's ROOT, quoting its title. Both open P2's card through B's surface, the
// element's through C's controller with the surface's passage renamed for a board (its title, not a slide number) and
// both naming their target (`artifactTarget`, Decision Log 12) for the agent's lead. Showing a board's thread selects
// the board's frame. C's rail, Resolve and Reopen, reply and orphan reading are C's as they are; this module adds the
// comment frame's locator over every board (an element's box on its board's canvas, a board's frame). Thread writes
// carry C's comments origin, outside undo.
//
// P4-B2 (D16 of docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md; the prior art's V1 to V15): every pin of the
// world is in one layer here, the active board's included (its overlay draws none), so an element pins once wherever it
// is, including on a board another replica moved it to while this one shows another: each board's own pin at its
// frame's top-right corner and each commented element's at its own, in board order and then the board's reading order.
// Pins under 32 screen px apart merge into one count at their centroid (`clusterPins`), whose press fits its members
// (V15); the open popover's pin never merges. A pin opens C's popover (PinPopover.tsx), which follows its pin through a
// pan or a zoom and hides while the pin is outside the world's visible rect (V6); the compose card stands at its pin and
// hides under a popover, as the deck's.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { clusterPins } from '../../comments/pin-clusters';
import type { CommentAuthor, CommentOverlayProps, DocumentComments, PassageRect } from '../../document/editor/comments/surface';
import type { SlideCanvas } from '../../slides/canvas';
import type { Box } from '../../slides/geometry';
import { resolveAnchor, ROOT } from '../../slides/model';
import { addThread, discardThread, elementQuote, getThread, newThreadId, reopen, reply, resolve, threadStatus, type DeckThread } from '../../slides/threads';
import { commentKeys, pinRectOf } from '../../slides/editor/comments/CommentFrame';
import { COMMENTS_ORIGIN, HUMAN_AUTHOR, samePin, useDeckComments, type DeckCommentsApi } from '../../slides/editor/comments/controller';
import { COMMENTS_COPY } from '../../slides/editor/comments/copy';
import type { CommentsRailLabels } from '../../slides/editor/comments/CommentsRail';
import { PinPopover } from '../../slides/editor/comments/PinPopover';
import { inSlideOrder, PinButton, pinKey, pinNode, samePinBoxes, threadsByElement } from '../../slides/editor/comments/Pins';
import { useOpenDeckThreads, useOpenThreadCount } from '../../slides/editor/comments/use-threads';
import type { DeckSession } from '../../slides/editor/session';
import { measure } from '../../slides/editor/transform/measure';
import { useDocVersion } from '../../slides/editor/transform/use-doc-version';
import * as Y from '../../yjs/slides';
import type { BoardFrame } from '../canvas';
import { boardLabel, type BoardView } from './boards';
import { DESIGN_COPY as C } from './copy';
import { unionRect, type DesignView, type Rect } from './viewport';
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
  const { setActive, closePopover, openPopover, resumeDraft } = deck;

  const commentBoard = useCallback(
    (boardId: string): string | null => {
      if (!surface || readOnly) return null;
      const doc = session.doc;
      const quote = elementQuote(doc, boardId, ROOT); // the board's title (its id untitled); '' when it is no board
      if (quote === '') return null;
      const threadId = newThreadId();
      addThread(doc, { threadId, slideId: boardId, elementId: ROOT, quote, by: author.actor, at: author.now() }, COMMENTS_ORIGIN);
      setActive(threadId);
      closePopover(); // P4-B2: the card it opens shows
      surface.opened({ threadId, tabId: boardId, tabTitle: labelOf(session, boardId), quote, artifactTarget: 'board' });
      return threadId;
    },
    [surface, readOnly, session, author, setActive, closePopover],
  );
  const comment = useCallback((): string | null => {
    const kept = resumeDraft(); // P4-B2: the artifact's one draft first (X36)
    if (kept !== null) return kept;
    const { selection } = session.snapshot();
    if (selection.length === 1) return deck.comment();
    if (selection.length > 0) return null;
    const board = boardTarget(session, view);
    return board === null ? null : commentBoard(board);
  }, [session, view, deck, commentBoard, resumeDraft]);
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
        if (threadStatus(session.doc, thread.id) === 'open') openPopover({ slideId: thread.slideId, elementId: ROOT, threadId: thread.id }); // P4-B2 (V11)
      }
      setActive(thread.id);
    },
    [deck, session, view, reveal, setActive, openPopover],
  );
  return useMemo(() => ({ ...deck, comment, show }), [deck, comment, show]);
}

/**
 * The rail's words for a design (C's rail's optional labels, the P3-E spec's Decision Log 29): where a thread is by its
 * board's name ("Board …" for a board's own thread), a deleted board said so; Show and the orphan note name a board or an
 * element.
 */
export function designRailLabels(boards: readonly BoardView[]): CommentsRailLabels {
  const names = new Map(boards.map((b) => [b.id, boardLabel(b)]));
  return {
    empty: C.commentsEmpty,
    target: (thread) => {
      const board = thread.elementId === ROOT;
      const name = names.get(thread.slideId);
      return {
        location: name === undefined ? C.threadDeletedBoard : board ? C.threadBoard(name) : name,
        show: board ? C.showBoard(thread.quote) : C.showElement(thread.quote),
        orphan: board ? C.orphanBoard : C.orphanElement,
      };
    },
  };
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
  /** The board the stage's overlay acts on (P4-B2: its pins are this frame's, as every board's). */
  activeId: string | null;
  surface: DocumentComments | undefined;
  view: DesignView;
  boards: readonly BoardView[];
  canvases: ReadonlyMap<string, SlideCanvas>;
  children: ReactNode;
}

/**
 * The frame around the world P2's card is drawn over (C's `CommentFrame` for a world of boards): the card's thread is
 * located on whichever board it is on, at its pin (P4-B2); the layout key moves with the view, every update and every
 * board's layout pass. ⌥⌘M comments, ⌥⌘⇧J hides the pins. Every pin of the world, and the pin popover.
 */
export function DesignCommentFrame({ api, activeId, surface, view, boards, canvases, children }: FrameProps) {
  void activeId; // P4-B2: the active board's pins are this frame's too
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
  // DL39's bounded wave: the view reaches this frame only while something drawn here follows it, an open thread's pin,
  // the card on screen (its thread active) or (P4-B2) the popover; else a pan or a zoom renders nothing here and asks
  // nothing of the host
  const open = useOpenDeckThreads(session.doc);
  const follows = api.active !== null || api.popover !== null || open.some((t) => resolveAnchor(session.doc, t).live);
  const at = useSyncExternalStore(view.subscribe, () => {
    const v = follows ? view.snapshot().viewport : null;
    return v ? `${v.zoom}:${v.x}:${v.y}` : '';
  });
  const viewport = at === '' ? null : view.snapshot().viewport;
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
      locate: (threadId) => pinRectOf(threadRect(latest.current, frame.current, getThread(doc, threadId))), // P4-B2: at the pin
      setActive,
      resolve: (threadId) => void (writable(threadId) && resolve(doc, threadId, author.actor, author.now(), COMMENTS_ORIGIN)),
      reopen: (threadId) => void (writable(threadId) && reopen(doc, threadId, author.actor, author.now(), COMMENTS_ORIGIN)),
      record: (threadId, body) => void (writable(threadId) && reply(doc, threadId, { id: `${threadId}:${newThreadId()}`, by: author.actor, at: author.now(), body }, COMMENTS_ORIGIN)),
      discard: (threadId) => void (!readOnly && discardThread(doc, threadId, COMMENTS_ORIGIN)),
      focus: () => frame.current?.querySelector<HTMLElement>('[data-stage-surface]')?.focus({ preventScroll: true }),
      hosting: setComposing, // P4-B2
    };
  }, [session, readOnly, author, setActive, setComposing]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => commentKeys(event, api);
  const layoutKey = `${at}:${version}:${layout}`;
  return (
    <div ref={attach} className="deck-comment-frame design-comment-frame" data-design-comment-frame onKeyDown={onKeyDown}>
      {children}
      {viewport && !api.pinsHidden && <WorldPins api={api} threads={open} boards={boards} canvases={canvases} view={view} version={version} zoom={viewport.zoom} x={viewport.x} y={viewport.y} />}
      {/* P4-B2: the card's host stays mounted under an open popover, hidden */}
      <div className="deck-comment-card-slot" data-card-slot={api.popover ? 'hidden' : undefined}>
        {surface?.overlay({ ...reach, layoutKey })}
      </div>
      <PinPopover api={api} host={host} layoutKey={layoutKey} />
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


interface WorldPin {
  slideId: string;
  elementId: string;
  threads: readonly DeckThread[];
  /** The pin's point on screen, relative to the frame (its target's top-right corner). */
  x: number;
  y: number;
  /** Its target in world px, for a cluster's fit. */
  world: Rect;
}

/**
 * P4-B2 (D16; V1, V13, V15): every pin of the world in one layer, in screen px: each board's own pin at its frame's
 * top-right corner and each commented element's at its top-right as its board's canvas draws it (measured in board px,
 * only the commented elements, again at every update, layout pass and zoom; a pan moves them with no measure), in board
 * order, a board's own pin before its elements' in their reading order. Pins under 32 screen px apart are one count at
 * their centroid, whose press fits its members.
 */
function WorldPins(props: { api: DeckCommentsApi; threads: readonly DeckThread[]; boards: readonly BoardView[]; canvases: ReadonlyMap<string, SlideCanvas>; view: DesignView; version: number; zoom: number; x: number; y: number }) {
  const { api, threads, boards, canvases, view, version, zoom, x, y } = props;
  const drawn = useMemo(() => boards.filter((b): b is BoardView & { frame: BoardFrame } => b.frame !== null), [boards]);
  // the open threads by board, then by element (a board's own under ROOT)
  const byBoard = useMemo(() => new Map(drawn.map((b) => [b.id, threadsByElement(threads, b.id)])), [drawn, threads]);
  // each board's commented elements as its canvas draws them, in its reading order, in board px
  const [boxes, setBoxes] = useState<ReadonlyMap<string, readonly [string, Box][]>>(new Map());
  const [laidOut, setLaidOut] = useState(0);
  useEffect(() => {
    const offs = [...canvases.values()].map((canvas) => canvas.onLayout(() => setLaidOut((n) => n + 1)));
    return () => offs.forEach((off) => off());
  }, [canvases]);
  useLayoutEffect(() => {
    const next = new Map<string, [string, Box][]>();
    for (const [boardId, elements] of byBoard) {
      const canvas = canvases.get(boardId);
      const ids = [...elements.keys()].filter((id) => id !== ROOT);
      if (!canvas || ids.length === 0) continue;
      next.set(
        boardId,
        inSlideOrder(canvas, ids).flatMap((id): [string, Box][] => {
          const m = measure(canvas, id, zoom);
          return m ? [[id, m.bounds]] : [];
        }),
      );
    }
    setBoxes((was) => (sameBoxes(was, next) ? was : next)); // unchanged geometry renders nothing and tells nobody
  }, [byBoard, canvases, zoom, version, laidOut]);
  // a re-measure that moved a pin tells the popover in this pass (a pan or a zoom renders it with this layer)
  const { pinMoves, popover } = api;
  useLayoutEffect(() => pinMoves.placed(), [boxes, pinMoves]);

  // The popover's last pin stays out of the clustering after the popover closes, for as long as it holds the keyboard:
  // closing focuses that pin, and a merge into a count would remove the focused node and drop the keyboard on the body.
  const layer = useRef<HTMLDivElement>(null);
  const [kept, setKept] = useState<{ slideId: string; elementId: string } | null>(null);
  useLayoutEffect(() => {
    if (popover) setKept({ slideId: popover.slideId, elementId: popover.elementId }); // another popover replaces it
  }, [popover]);
  useEffect(() => {
    // closed with the keyboard not on that pin (a press outside the frame closes and focuses nothing): nothing to keep
    if (popover || !kept) return;
    const node = layer.current ? pinNode(layer.current, kept) : null;
    if (!node || node !== node.ownerDocument.activeElement) setKept(null);
  }, [popover, kept]);
  const released = (event: FocusEvent<HTMLDivElement>) => {
    // the keyboard left the kept pin (while a popover is open, the pin hands it to the popover, which keeps its pin itself)
    if (!popover && kept && (event.target as HTMLElement).dataset.pinKey === pinKey(kept)) setKept(null);
  };

  const pins: WorldPin[] = drawn.flatMap((b) => {
    const elements = byBoard.get(b.id);
    if (!elements) return [];
    const f = b.frame;
    const own = elements.get(ROOT);
    const board: WorldPin[] = own ? [{ slideId: b.id, elementId: ROOT, threads: own, x: x + (f.x + f.w) * zoom, y: y + f.y * zoom, world: { x: f.x, y: f.y, w: f.w, h: f.h } }] : [];
    const placed = (boxes.get(b.id) ?? []).flatMap(([elementId, box]): WorldPin[] => {
      const list = elements.get(elementId);
      return list ? [{ slideId: b.id, elementId, threads: list, x: x + (f.x + box.x + box.w) * zoom, y: y + (f.y + box.y) * zoom, world: { x: f.x + box.x, y: f.y + box.y, w: box.w, h: box.h } }] : [];
    });
    return [...board, ...placed];
  });
  if (pins.length === 0) return null;
  // the open popover's pin stands alone, never merged, so the popover has its pin at any zoom (a zoom-out while it is
  // open, the rail's Show of a merged pin's thread), and after it closes the pin that holds the keyboard; every other pin
  // may merge, each group drawn where its first member reads in the order
  const open = pins.findIndex((p) => samePin(popover ?? kept, p));
  const clusters = [
    ...(open < 0 ? [] : [{ ids: [String(open)], x: pins[open]!.x, y: pins[open]!.y }]),
    ...clusterPins(pins.flatMap((p, i) => (i === open ? [] : [{ id: String(i), x: p.x, y: p.y }]))),
  ].sort((a, b) => Number(a.ids[0]) - Number(b.ids[0]));
  return (
    <div ref={layer} className="design-board-pins" onBlur={released}>
      {clusters.map((cluster) => {
        const members = cluster.ids.map((i) => pins[Number(i)]!);
        if (members.length === 1) {
          const p = members[0]!;
          const data: Record<`data-${string}`, string> = p.elementId === ROOT ? { 'data-board-pin': p.slideId } : { 'data-comment-pin': p.elementId, 'data-pin-board': p.slideId };
          return <PinButton key={`${p.slideId}/${p.elementId}`} api={api} slideId={p.slideId} elementId={p.elementId} threads={p.threads} style={{ left: p.x, top: p.y }} data={data} />;
        }
        const count = members.reduce((n, p) => n + p.threads.length, 0);
        const label = C.pinCluster(count);
        return (
          <button
            key={members.map((p) => `${p.slideId}/${p.elementId}`).join(' ')}
            type="button"
            className="deck-comment-pin"
            data-pin-cluster={members.map((p) => `${p.slideId}/${p.elementId}`).join(' ')}
            aria-label={label}
            title={label}
            style={{ left: cluster.x, top: cluster.y }}
            onClick={() => {
              const rect = unionRect(members.map((p) => p.world));
              if (rect) view.fitTo(rect);
            }}
          >
            {count}
          </button>
        );
      })}
    </div>
  );
}

/** The boards' measured pins are the same (ids and boxes). */
function sameBoxes(a: ReadonlyMap<string, readonly [string, Box][]>, b: ReadonlyMap<string, readonly [string, Box][]>): boolean {
  if (a.size !== b.size) return false;
  for (const [board, list] of b) {
    const was = a.get(board);
    if (!was || !samePinBoxes(was, list)) return false;
  }
  return true;
}
