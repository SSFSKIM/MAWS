// P4-A2 G2.4 (X35, the design's provisional layer; docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md G-R6,
// with G-R3 and G-R4 per board; §4.2's four rules [binding]): a publish streaming into an open design, drawn in its
// world by the deck's layer (../../slides/editor/provisional). Every board a file names takes the deck's stage layer on
// its own canvas (World.tsx's `Board`: the ghost, the veil, the label; the protection the session's, which holds only
// on its current slide, the active board); a board new to the design is drawn whole at its frame once canvas.json's
// entry for it parses whole, not before (a board has no place until then), as a ghost board of the world that takes no
// press, no focus and no name; the board list shows nothing new. Frames may overlap, so a new board placed over the
// active board is held whole, its label with it (hidden, its box kept so it is measured again), while it meets an
// element the human is protected on (G-R4: EDIT, ARMED, a drag's targets), judged again as the protection, a board's
// layout, the world's zoom (the label's counter-scale) or either frame changes; drawn once clear, or gone at the swap.
// Everything here sits in the world's one transformed layer, so the label and the outlines are kept screen-sized against
// its zoom, written on each layer's element alone.
//
// The DOM hooks an e2e recorder reads (stable), besides the deck layer's inside a board (`[data-board-id="<id>"]
// [data-provisional-layer="<id>"]` and the rest, slide.ts): a new board's ghost `[data-design-layer]
// [data-provisional-new-board="<id>"]`, with `data-provisional-writing="<toolUseId>"`, `data-provisional-frame="<x> <y>
// <w> <h>"` (world px, as `left`/`top`/`width`/`height`) and `data-provisional-held` while held, its label
// `[data-provisional-label]` and its whole board `[data-provisional-thumb="<id>"] section.maws-slide`.
import { memo, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties } from 'react';
import { cssColor } from '../../document/editor/host-types';
import type { AssetUrl, SlideCanvas } from '../../slides/canvas';
import type { FaceAliases } from '../../slides/canvas/faces';
import { DECK_COPY } from '../../slides/editor/copy';
import { protectedIds, ThumbnailLayer, useProvisionalZoom, type DeckProvisional, type ProvisionalFiles, type ScreenZoom } from '../../slides/editor/provisional';
import type { DeckSession } from '../../slides/editor/session';
import { boardIdOf, CANVAS_PATH } from '../canvas';
import { provisionalBoardFrame } from '../provisional';
import type { DesignView } from './viewport';

/** A design's files: `project/boards/<id>.html`, `project/canvas.json`, a new board placed by its entry (G-R6). */
export const DESIGN_FILES: ProvisionalFiles = {
  slideOf: boardIdOf,
  indexPath: CANVAS_PATH,
  frameOf: (live, boardId, index, file) => provisionalBoardFrame(live, boardId, index.text, index.open, file),
};

const noSubscribe = () => () => {};

/** Whether a publish is writing the board now: its layer is mounted only then (a world of boards keeps none idle). */
export function useBoardWritten(deck: DeckProvisional | null, boardId: string): boolean {
  return useSyncExternalStore(deck?.subscribe ?? noSubscribe, () => deck?.snapshot().slides.has(boardId) ?? false);
}

/** The world's zoom as a layer follows it (the view's, read and followed with no render). */
export function useWorldZoom(view: DesignView): ScreenZoom {
  return useMemo(() => ({ get: () => view.snapshot().viewport?.zoom ?? 1, subscribe: view.subscribe }), [view]);
}

/** Whether a new board's ghost, or its label, meets an element the human is protected on, on the active board (G-R4). */
function meetsProtected(host: HTMLElement, session: DeckSession, canvases: ReadonlyMap<string, SlideCanvas>): boolean {
  const state = session.snapshot();
  const current = state.currentSlide;
  const canvas = current === null ? undefined : canvases.get(current);
  if (current === null || !canvas) return false;
  const ids = protectedIds(state, session.doc, current);
  if (ids.size === 0) return false;
  const guarded = Array.from(canvas.root.querySelectorAll<HTMLElement>('[data-eid]')).flatMap((node) => (ids.has(node.dataset.eid!) ? [node.getBoundingClientRect()] : []));
  if (guarded.length === 0) return false;
  const own = [host, ...Array.from(host.querySelectorAll('[data-provisional-label]'))].map((node) => node.getBoundingClientRect());
  return own.some((a) => guarded.some((b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom));
}

/** The boards new to the design a publish is writing, each at its frame once placed and drawn (G-R6). */
export const ProvisionalBoards = memo(function ProvisionalBoards(props: {
  deck: DeckProvisional;
  zoom: ScreenZoom;
  assetUrl: AssetUrl;
  faces?: FaceAliases;
  /** The human's protection (on the session's current slide, the active board) and the boards' canvases it is read on. */
  session: DeckSession;
  canvases: ReadonlyMap<string, SlideCanvas>;
  /** The active board's frame as drawn now (`x y w h`): a move of it is judged again once React has placed it. */
  activeFrame: string | null;
}) {
  const { deck, zoom, assetUrl, faces, session, canvases, activeFrame } = props;
  const snapshot = useSyncExternalStore(deck.subscribe, deck.snapshot);
  const boards = [...snapshot.slides].flatMap(([id, slide]) => (slide.isNew && slide.frame && slide.drawn ? [{ id, slide, frame: slide.frame }] : []));
  return (
    <>
      {boards.map(({ id, slide, frame }) => (
        <NewBoard
          key={id}
          deck={deck}
          boardId={id}
          x={frame.x}
          y={frame.y}
          w={frame.w}
          h={frame.h}
          toolUseId={slide.toolUseId}
          name={slide.name}
          color={slide.color}
          zoom={zoom}
          assetUrl={assetUrl}
          faces={faces}
          session={session}
          canvases={canvases}
          activeFrame={activeFrame}
        />
      ))}
    </>
  );
});

/** One new board: the whole provisional board at its frame, ringed and named in the agent's colour. */
const NewBoard = memo(function NewBoard(props: {
  deck: DeckProvisional;
  boardId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  toolUseId: string;
  name: string;
  color: string;
  zoom: ScreenZoom;
  assetUrl: AssetUrl;
  faces?: FaceAliases;
  session: DeckSession;
  canvases: ReadonlyMap<string, SlideCanvas>;
  activeFrame: string | null;
}) {
  const { deck, boardId, x, y, w, h, toolUseId, name, color, zoom, assetUrl, faces, session, canvases, activeFrame } = props;
  const host = useRef<HTMLDivElement>(null);
  useProvisionalZoom(host, 1, zoom);
  // held while it meets the human's protected elements (G-R4), judged in the task of each change that can bring them
  // together; this effect runs again (and judges) when its frame, the active board's frame or the canvases change
  useLayoutEffect(() => {
    const el = host.current!;
    let disposed = false;
    const check = () => {
      if (disposed) return;
      const held = meetsProtected(el, session, canvases);
      if (held !== el.hasAttribute('data-provisional-held')) el.toggleAttribute('data-provisional-held', held);
    };
    check();
    let shown = zoom.get();
    const stops = [
      session.subscribe(check),
      ...Array.from(canvases.values(), (canvas) => canvas.onLayout(check)), // a protected box growing as the human types
      // a zoom rescales the label: judged once the world's transform and the counter-scale are both written (a pan moves
      // everything together)
      zoom.subscribe(() => {
        if (zoom.get() === shown) return;
        shown = zoom.get();
        queueMicrotask(check);
      }),
    ];
    return () => {
      disposed = true;
      stops.forEach((stop) => stop());
    };
  }, [session, canvases, zoom, x, y, w, h, activeFrame]);
  const style = { left: x, top: y, width: w, height: h, '--provisional-color': cssColor(color) } as CSSProperties;
  return (
    <div ref={host} className="design-board design-provisional-board" data-provisional-new-board={boardId} data-provisional-writing={toolUseId} data-provisional-frame={`${x} ${y} ${w} ${h}`} aria-hidden="true" inert style={style}>
      <ThumbnailLayer deck={deck} slideId={boardId} scale={1} assetUrl={assetUrl} faces={faces} keepLast />
      <div className="deck-provisional-label" data-provisional-label>
        {DECK_COPY.writing(name)}
      </div>
    </div>
  );
});
