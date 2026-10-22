// P3-E1 M3 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M3; the parent's §1 "The workbench" and
// Decision Log 20): the world. Every board is mounted, always (E0's ruling: no cached pictures, no virtual mounting), as
// C's own canvas (`SlideView` at scale 1 and the board's size) at its `x`, `y` in one layer the view's one CSS transform
// pans and zooms. The active board (the deck session's current slide) alone carries C's transform overlay, in an unscaled
// sibling at the board's screen origin and size, given the world's zoom as its scale: C's overlay measures in board px
// and draws in screen px, so the zoom is applied once. Board chrome (titles, the selected frame's handles, its guides)
// is the workbench's own.
//
// Pointer arbitration (Decision Log 20), decided at the world before C's overlay sees a press: a press on the active
// board's content, or on the overlay's own handles, text box or pins, is the overlay's; a press on another board's
// content activates that board and selects the element under it (C's `pick`), and that press does nothing more: no pan,
// no move, no replayed event; the next gesture edits. A press on a board's title selects its frame (its geometry) and a
// drag of it moves the board; the frame's handles resize it, snapped to sibling boards, refused (shown, nothing written)
// past the model's cap. A press on the empty world clears the selection and pans; so does Space-drag or the middle
// button anywhere. The wheel pans; ⌃-wheel (a pinch) or ⌥-wheel zooms about the pointer. A held or missing board, or a
// read-only replica, is selected and inspected but never written.
// P4-A2 G2.4 (X35; G-R6 of docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md): an agent's publish drawn as it
// streams (./provisional.tsx): each board it writes takes the deck's layer on its canvas, beneath the screen chrome and
// the overlay, the session protecting the human's elements on the active board; a new board stands at its frame.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import type { AssetUrl, SlideCanvas } from '../../slides/canvas';
import type { FaceAliases } from '../../slides/canvas/faces';
import type { Guide, Handle, Pt } from '../../slides/geometry';
import { HANDLES } from '../../slides/geometry';
import type { DeckSession } from '../../slides/editor/session';
import { describeElement, stageFocus } from '../../slides/editor/a11y';
import { SlideView } from '../../slides/editor/SlideView';
import { TextBox } from '../../slides/editor/TextBox';
import { CLIPBOARD_TYPE, type ImportAsset } from '../../slides/editor/transform/clipboard';
import { pasteElements } from '../../slides/writers-elements';
import { hitIds } from '../../slides/editor/transform/measure';
import { Overlay } from '../../slides/editor/transform/Overlay';
import { pick, slideTree } from '../../slides/editor/transform/selection';
import * as Y from '../../yjs/slides';
import { heldOf } from '../../slides/model';
import type { BoardFrame } from '../canvas';
import { boardFrame, boardOrder, isMissingSource } from '../model';
import { BoardError, setBoardFrame } from '../writers';
import { movedFrame, resizedFrame } from './board-gestures';
import { boardTextMarkup } from './insert';
import { boardLabel, type BoardView } from './boards';
import { DESIGN_COPY as C } from './copy';
import { useViewFrame, useViewZoom } from './use-view';
import { SlideLayer, type DeckProvisional, type ScreenZoom } from '../../slides/editor/provisional';
import { ProvisionalBoards, useBoardWritten, useWorldZoom } from './provisional';
import { panBy, zoomAt, type DesignView, type Viewport } from './viewport';

const DRAG_START_PX = 3; // screen px a title press moves before it is a drag (C's overlay's)
/** Where each frame handle sits on the board, as fractions of its width and height (C's overlay's). */
const HANDLE_AT: Record<Handle, [number, number]> = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
/** What C's overlay owns of a press: its handles, the text box and its bar, a comment pin. */
const OVERLAY_OWN = '[data-handle], .deck-markbar, .deck-textbox, .deck-comment-pin';

export interface WorldProps {
  session: DeckSession;
  view: DesignView;
  boards: readonly BoardView[];
  /** The board C's overlay acts on (the session's current slide), if it is drawn. */
  active: BoardView | null;
  canvases: ReadonlyMap<string, SlideCanvas>;
  onCanvas: (boardId: string, canvas: SlideCanvas | null) => void;
  assetUrl: AssetUrl;
  faces: FaceAliases;
  /** The design system's scope (the document medium) the boards draw in. */
  scope: (children: ReactNode) => ReactNode;
  readOnly: boolean;
  onNotice: (text: string) => void;
  artifactId?: string;
  importAsset?: ImportAsset;
  /** The world's focusable surface: it takes the pointer, the keys and the clipboard (C's overlay reads it too). */
  surface: RefObject<HTMLDivElement | null>;
  /** Told the surface as React attaches and detaches it (the owner's Mark-up surface follows each mount of the world). */
  onSurface?: (element: HTMLDivElement | null) => void;
  /** Fits the selection (the toolbar's and Shift+2's), fits every board (Shift+1). */
  fitSelection: () => void;
  fitAll: () => void;
  /** The board-frame commands the keys share with the list. */
  removeBoard: (boardId: string) => void;
  duplicateBoard: (boardId: string) => void;
  /** P4-A2 G2.4 (X35): a publish's boards as they stream, drawn on each board and at a new board's frame. */
  provisional?: DeckProvisional | null;
}

// A frame gesture owns the keys it moves (a move the position, a handle the edges it drags) and writes those alone, each
// frame against the board's current frame: another writer's change of the others (a replica's resize during a move,
// its move during an east resize) stands, and snapping and the cap are read against where the board is now.
// P4-B2 (D17): from its first move to its drop it holds the replica's remote frames (the session's gesture hold, as C's
// overlay gestures do), and the drop writes again the keys it last wrote that a held write moved (`owned`).
type FrameKey = keyof BoardFrame;
type FrameDrag = { kind: 'move' | 'resize'; pointerId: number; id: string; handle: Handle | null; keys: readonly FrameKey[]; from: Pt; start: BoardFrame; moving: boolean; last: string; owned: Partial<BoardFrame> | null };
type Drag = { kind: 'pan'; pointerId: number; from: Pt; start: Viewport } | FrameDrag;

/** The frame keys a resize by `handle` drags. */
function keysOf(handle: Handle): FrameKey[] {
  const keys: FrameKey[] = [];
  if (handle.includes('w')) keys.push('x');
  if (handle.includes('n')) keys.push('y');
  if (handle.includes('e') || handle.includes('w')) keys.push('w');
  if (handle.includes('n') || handle.includes('s')) keys.push('h');
  return keys;
}
const keysFrom = (frame: BoardFrame, keys: readonly FrameKey[]): Partial<BoardFrame> => Object.fromEntries(keys.map((k) => [k, frame[k]]));

const writable = (b: BoardView | undefined, readOnly: boolean): b is BoardView & { frame: BoardFrame } => !readOnly && b !== undefined && b.frame !== null && b.held === null && !b.missing;

export function World(props: WorldProps) {
  const { session, view, boards, active, canvases, onCanvas, assetUrl, faces, scope, readOnly, onNotice, artifactId, importAsset, surface, onSurface, provisional = null } = props;
  // M6 (the scale gate's pan and zoom frame work): the world renders on a change of zoom or of the selected frame alone;
  // the pan is two transforms written straight from the view (below), so a pan re-renders nothing and re-lays nothing
  const zoom = useViewZoom(view);
  const selectedFrame = useViewFrame(view);
  const worldZoom = useWorldZoom(view); // P4-A2 G2.4: the provisional layers' screen-sized marks, followed with no render
  // the surface as React attaches and detaches it: the ref object everything here and C's overlay read, and the owner told
  const attachSurface = useCallback(
    (element: HTMLDivElement | null) => {
      const surfaceRef = surface; // a ref by its name, so the React Compiler takes this write for a ref's, not a prop's
      surfaceRef.current = element;
      onSurface?.(element);
    },
    [surface, onSurface],
  );
  const layer = useRef<HTMLDivElement | null>(null);
  const pan = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const apply = () => {
      const v = view.snapshot().viewport ?? ORIGIN;
      // the boards: the world's one transform; the screen chrome (titles, outlines, the overlay, handles, guides, drawn
      // at the zoom from the world's origin): the pan alone, on the compositor
      if (layer.current) layer.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
      if (pan.current) pan.current.style.transform = `translate(${v.x}px, ${v.y}px)`;
    };
    apply();
    return view.subscribe(apply);
  }, [view]);
  const [guides, setGuides] = useState<readonly Guide[]>([]);
  const [panning, setPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const activeFrame = useRef<HTMLDivElement | null>(null);
  const onSelectBoard = useCallback((boardId: string) => selectFrame(session, view, boardId), [session, view]);

  // the latest of what the handlers read, without re-binding them every render
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const space = useRef(false);
  const drag = useRef<Drag | null>(null);

  // the room the world has: the view fits into it
  useLayoutEffect(() => {
    const el = surface.current;
    if (!el) return;
    // a body not laid out (a hidden tab) measures nothing: the room it had stands
    const room = () => (el.clientWidth > 0 && el.clientHeight > 0 ? { w: el.clientWidth, h: el.clientHeight } : null);
    const measure = () => {
      const r = room();
      if (r) view.setRoom(r);
    };
    measure();
    const detach = view.measureRoomWith(room); // every fit reads the world as it is then, reported or not
    if (typeof ResizeObserver === 'undefined') return detach;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
      detach();
    };
  }, [surface, view]);

  // an element selected (here or by the overlay) leaves the frame selection; a frame of a board gone is dropped
  useEffect(
    () =>
      session.subscribe(() => {
        if (session.snapshot().selection.length > 0 && view.snapshot().frame !== null) view.selectFrame(null);
      }),
    [session, view],
  );
  useEffect(() => {
    const frame = view.snapshot().frame;
    if (frame !== null && !boards.some((b) => b.id === frame)) view.selectFrame(null);
  }, [boards, view]);

  // ---- the pointer, decided before C's overlay (module header)
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const local = (e: { clientX: number; clientY: number }): Pt => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const vp = () => view.snapshot().viewport ?? { zoom: 1, x: 0, y: 0 };
    const capture = (e: PointerEvent) => {
      e.stopImmediatePropagation(); // C's overlay, listening on the same surface, never sees it
      e.preventDefault();
      el.focus({ preventScroll: true });
      el.setPointerCapture?.(e.pointerId);
    };
    // read from the replica at each frame, never from what the press saw
    const siblingsOf = (id: string) => boardOrder(session.doc).flatMap((b) => (b === id ? [] : (boardFrame(session.doc, b) ?? [])));
    /** The board's frame now, when a write to it may land now (the replica, the session, the board), else null. */
    const writableFrame = (id: string): BoardFrame | null =>
      latest.current.readOnly || !session.writable() || !Y.hasSlide(session.doc, id) || heldOf(session.doc, id) !== null || isMissingSource(session.doc, id) ? null : boardFrame(session.doc, id);
    /**
     * P4-B2 (D17): the drop's re-assert, which the session runs after the hold's flush while it takes writes: the keys
     * the drag last wrote whose value a held write moved, written again while the board still takes writes, so the
     * owner's frame wins whatever the clientIDs.
     */
    const reassertOf = (d: FrameDrag) => () => {
      const now = d.owned && writableFrame(d.id);
      if (!d.owned || !now) return;
      const moved = Object.fromEntries(Object.entries(d.owned).filter(([k, v]) => now[k as FrameKey] !== v)) as Partial<BoardFrame>;
      if (Object.keys(moved).length === 0) return;
      try {
        setBoardFrame(session.doc, d.id, moved, session.origin);
      } catch (error) {
        latest.current.onNotice(error instanceof BoardError ? error.problems.join('; ') : String(error));
      }
    };
    /** A gesture that may no longer write ends here: nothing more written, the undo step closed, the pointer let go. */
    const end = (d: Drag, pointerId: number) => {
      drag.current = null;
      if (el.hasPointerCapture?.(pointerId)) el.releasePointerCapture(pointerId);
      setGuides([]);
      if (d.kind === 'pan') setPanning(false);
      else if (d.moving) session.endDrag(reassertOf(d)); // D17: the hold's flush, the re-assert, the step's cut
    };
    const startPan = (e: PointerEvent) => {
      drag.current = { kind: 'pan', pointerId: e.pointerId, from: local(e), start: vp() };
      setPanning(true);
    };

    const onDown = (e: PointerEvent) => {
      const { boards: all, readOnly: ro } = latest.current;
      if (e.button === 1 || (e.button === 0 && space.current)) {
        capture(e);
        return startPan(e);
      }
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest(OVERLAY_OWN)) return; // the overlay's own
      const handle = target.closest<HTMLElement>('[data-board-handle]');
      const titled = target.closest<HTMLElement>('[data-board-title]');
      const content = target.closest<HTMLElement>('[data-board-id]');
      if (handle) {
        const id = view.snapshot().frame;
        const b = all.find((x) => x.id === id);
        capture(e);
        const h = handle.dataset.boardHandle as Handle;
        if (writable(b, ro)) drag.current = { kind: 'resize', pointerId: e.pointerId, id: b.id, handle: h, keys: keysOf(h), from: local(e), start: b.frame, moving: false, last: '', owned: null };
        return;
      }
      if (titled) {
        const id = titled.dataset.boardTitle!;
        capture(e);
        selectFrame(session, view, id);
        const b = all.find((x) => x.id === id);
        if (writable(b, ro)) drag.current = { kind: 'move', pointerId: e.pointerId, id, handle: null, keys: ['x', 'y'], from: local(e), start: b.frame, moving: false, last: '', owned: null };
        return;
      }
      if (content) {
        const id = content.dataset.boardId!;
        if (id === session.snapshot().currentSlide) {
          if (view.snapshot().frame !== null) view.selectFrame(null);
          return; // the active board's content: C's overlay
        }
        // an inactive board: activated, the element under the press selected; nothing else happens on this press
        capture(e);
        activate(session, view, id, latest.current.canvases.get(id) ?? null, e, target);
        return;
      }
      // the empty world
      capture(e);
      session.select([]);
      view.selectFrame(null);
      startPan(e);
    };

    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || d.pointerId !== e.pointerId) return;
      const p = local(e);
      const dx = p.x - d.from.x;
      const dy = p.y - d.from.y;
      if (d.kind === 'pan') return view.setViewport(panBy(d.start, dx, dy));
      const now = writableFrame(d.id);
      if (now === null) return end(d, e.pointerId); // read-only, held, missing, deleted, or the session stopped taking writes
      if (!d.moving) {
        if (Math.hypot(dx, dy) < DRAG_START_PX) return;
        d.moving = true;
        session.beginDrag();
      }
      const zoom = vp().zoom;
      const world = { x: dx / zoom, y: dy / zoom };
      const snap = !(e.metaKey || e.ctrlKey);
      const base = { ...now, ...keysFrom(d.start, d.keys) }; // the gesture's keys from its start, the rest as they are now
      const siblings = siblingsOf(d.id);
      const next = d.handle === null ? { ...movedFrame(base, world, siblings, zoom, snap), problems: [] as string[] } : resizedFrame(d.id, base, d.handle, world, siblings, zoom, snap);
      setGuides(next.guides);
      if (next.problems.length > 0) return latest.current.onNotice(next.problems.join('; ')); // shown, never adjusted
      const owned = keysFrom(next.frame, d.keys);
      const key = JSON.stringify(owned);
      if (key === d.last) return;
      d.last = key;
      try {
        setBoardFrame(session.doc, d.id, owned, session.origin);
        d.owned = owned;
      } catch (error) {
        latest.current.onNotice(error instanceof BoardError ? error.problems.join('; ') : String(error));
      }
    };

    const onUp = (e: PointerEvent) => {
      const d = drag.current;
      if (d && d.pointerId === e.pointerId) end(d, e.pointerId);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = vp();
      if (e.ctrlKey || e.altKey) view.setViewport(zoomAt(v, v.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), local(e)));
      else view.setViewport(panBy(v, -e.deltaX, -e.deltaY));
    };

    // the world never scrolls: a focus brought to a node outside the view (a text box opened on a board out of sight)
    // would scroll this overflow-hidden box and misplace every overlay; the view's pan is the only offset
    const onScroll = () => {
      if (el.scrollLeft !== 0) el.scrollLeft = 0;
      if (el.scrollTop !== 0) el.scrollTop = 0;
    };

    // A gesture's moves and release are followed on the whole window (its capture phase, so nothing below can stop
    // them), not on the world alone: the pointer capture the press takes did not hold in the product build once a pan
    // crossed the world's edge into the board list (the post-fix mini gate: 9 of 12 moves landed, the pan stuck), and
    // a drag must not depend on it. Each handler acts only on the gesture's own pointer.
    const win = el.ownerDocument.defaultView ?? window;
    el.addEventListener('scroll', onScroll);
    el.addEventListener('pointerdown', onDown, { capture: true });
    win.addEventListener('pointermove', onMove, { capture: true });
    win.addEventListener('pointerup', onUp, { capture: true });
    win.addEventListener('pointercancel', onUp, { capture: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      // P4-B2 (D13): a frame drag still running when the world goes ends here, so the session's drag ends with it (D17:
      // its hold released and its drop re-asserted, as a release does)
      const d = drag.current;
      drag.current = null;
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('pointerdown', onDown, { capture: true });
      win.removeEventListener('pointermove', onMove, { capture: true });
      win.removeEventListener('pointerup', onUp, { capture: true });
      win.removeEventListener('pointercancel', onUp, { capture: true });
      el.removeEventListener('wheel', onWheel);
      if (d && d.kind !== 'pan' && d.moving) session.endDrag(reassertOf(d));
    };
  }, [surface, session, view]);

  // ---- plain text pasted while the world has focus lands on the active board at its screen type (boardTextMarkup),
  // through C's validated paste; MAWS's own clipboard and slide markup stay C's paste, untouched. Taken at the document's
  // capture, before C's overlay's listener there.
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const doc = el.ownerDocument;
    const onPaste = (e: ClipboardEvent) => {
      const data = e.clipboardData;
      if (!stageFocus(el, doc.activeElement) || !data) return; // P4-B2 (A3): the world or an element's node holding the focus
      if (data.getData(CLIPBOARD_TYPE) || /<section[\s>]/i.test(data.getData('text/html'))) return; // structured: C's
      const text = data.getData('text/plain');
      const { active: board, readOnly: ro } = latest.current;
      if (!text.trim() || ro || !board?.frame || board.held !== null || board.missing || !session.writable()) return; // C's paste refuses these too
      e.preventDefault();
      e.stopImmediatePropagation();
      const markup = boardTextMarkup(text, board.frame);
      const out: { result: ReturnType<typeof pasteElements> } = { result: { ok: false, reason: 'nothing to paste' } };
      session.edit((origin) => (out.result = pasteElements(session.doc, board.id, markup, {}, origin)));
      if (out.result.ok) session.select(out.result.ids);
      else latest.current.onNotice(out.result.reason);
    };
    doc.addEventListener('paste', onPaste, { capture: true });
    return () => doc.removeEventListener('paste', onPaste, { capture: true });
  }, [surface, session]);

  // ---- the world's own keys, taken before C's overlay (whose listener re-binds on its own schedule, so listening order
  // decides nothing): Space to pan, the view's fits and zooms, and with a board's frame selected (no element selected,
  // so the overlay would act on nothing) the frame's nudge, duplicate and delete; Escape climbs from nothing selected to
  // the active board's frame. Every other key is the overlay's.
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (!stageFocus(el, e.target) || e.defaultPrevented) return; // P4-B2 (A3): the world or an element's node holding the focus
      const { boards: all, readOnly: ro, fitAll, fitSelection, removeBoard, duplicateBoard } = latest.current;
      const mod = e.metaKey || e.ctrlKey;
      const done = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      const frameId = view.snapshot().frame;
      const framed = all.find((b) => b.id === frameId);
      if (e.key === ' ') {
        if (!space.current) setSpaceHeld((space.current = true));
        return done();
      }
      const command = e.shiftKey && e.code === 'Digit1' ? fitAll : e.shiftKey && e.code === 'Digit2' ? fitSelection : null;
      const zoomKey = !mod ? null : e.key === '=' || e.key === '+' ? () => view.step(1) : e.key === '-' ? () => view.step(-1) : e.key === '0' ? () => view.setZoom(1) : null;
      if (command ?? zoomKey) {
        (command ?? zoomKey)!();
        return done();
      }
      if (e.key === 'Escape') {
        const current = session.snapshot().currentSlide;
        if (frameId !== null) view.selectFrame(null);
        else if (current !== null && session.snapshot().selection.length === 0) view.selectFrame(current);
        else return;
        return done();
      }
      if (!framed || ro) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        removeBoard(framed.id); // a held or missing board may be deleted, as C's filmstrip deletes a held slide
        return done();
      }
      if (!writable(framed, ro) || !session.writable()) return;
      if (mod && e.key.toLowerCase() === 'd') {
        duplicateBoard(framed.id);
        return done();
      }
      if (e.key.startsWith('Arrow') && !mod) {
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        session.typing(`board:${framed.id}`, (origin) => setBoardFrame(session.doc, framed.id, { x: framed.frame.x + dx, y: framed.frame.y + dy }, origin));
        return done();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && space.current) setSpaceHeld((space.current = false));
    };
    const onBlur = () => {
      if (space.current) setSpaceHeld((space.current = false));
    };
    el.addEventListener('keydown', onKey, { capture: true });
    el.addEventListener('keyup', onKeyUp);
    el.addEventListener('blur', onBlur);
    return () => {
      el.removeEventListener('keydown', onKey, { capture: true });
      el.removeEventListener('keyup', onKeyUp);
      el.removeEventListener('blur', onBlur);
    };
  }, [surface, session, view]);

  // the screen chrome's boxes, at the zoom from the world's origin (the pan wrapper adds the pan)
  const screen = (b: BoardFrame) => ({ left: b.x * zoom, top: b.y * zoom, width: b.w * zoom, height: b.h * zoom });
  const framed = boards.find((b) => b.id === selectedFrame && b.frame !== null) ?? null;
  const activeEditable = active !== null && active.held === null && !active.missing && !readOnly;

  return (
    <div
      ref={attachSurface}
      className="design-world"
      role="region"
      aria-label={C.world}
      tabIndex={0}
      data-design-world
      data-stage-surface
      aria-keyshortcuts="F6" // P4-B2 (D14): its keyboard exit
      data-panning={panning || undefined}
      data-space={spaceHeld || undefined}
    >
      <div className="design-world-ground" data-design-ground />
      <div ref={layer} className="design-world-layer" data-design-layer>
        {scope(
          <>
            {boards.map((b) =>
              b.frame ? (
                <Board
                  key={b.id}
                  session={session}
                  board={b as BoardView & { frame: BoardFrame }}
                  active={b.id === active?.id}
                  frameSelected={b.id === selectedFrame}
                  assetUrl={assetUrl}
                  faces={faces}
                  onCanvas={onCanvas}
                  canvas={canvases.get(b.id) ?? null}
                  provisional={provisional}
                  zoom={worldZoom}
                />
              ) : null,
            )}
            {provisional && (
              <ProvisionalBoards
                deck={provisional}
                zoom={worldZoom}
                assetUrl={assetUrl}
                faces={faces}
                session={session}
                canvases={canvases}
                activeFrame={active?.frame ? `${active.frame.x} ${active.frame.y} ${active.frame.w} ${active.frame.h}` : null}
              /> /* P4-A2 G2.4 (G-R6, G-R4) */
            )}
          </>,
        )}
      </div>
      <div ref={pan} className="design-world-pan" data-design-pan>
      <Titles view={view} boards={boards} activeId={active?.id ?? null} frameId={selectedFrame} onSelect={onSelectBoard} />
      <Marks boards={boards} zoom={zoom} />
      <div className="design-world-screen" aria-hidden>
        {active?.frame && <div className="design-active-outline" style={screen(active.frame)} />}
        {framed?.frame && <div className="design-frame-outline" data-frame-outline={framed.id} style={screen(framed.frame)} />}
        {guides.map((g, i) =>
          g.axis === 'x' ? (
            <div key={i} className="deck-guide" data-guide={g.kind} style={{ left: g.at * zoom, top: g.from * zoom, width: 0, height: (g.to - g.from) * zoom }} />
          ) : (
            <div key={i} className="deck-guide" data-guide={g.kind} style={{ left: g.from * zoom, top: g.at * zoom, width: (g.to - g.from) * zoom, height: 0 }} />
          ),
        )}
      </div>
      {active?.frame && (
        <div ref={activeFrame} className="design-active" data-active-board={active.id} style={screen(active.frame)}>
          {scope(
            <Overlay
              session={session}
              canvas={canvases.get(active.id) ?? null}
              slideId={active.id}
              scale={zoom}
              readOnly={!activeEditable}
              surface={surface}
              frame={activeFrame}
              onNotice={onNotice}
              artifactId={artifactId}
              importAsset={importAsset}
              renderText={(elementId, canvas, armed) => <TextBox session={session} canvas={canvas} slideId={active.id} elementId={elementId} readOnly={!activeEditable} armed={armed} />}
              pins={false} // P4-B2 (D16): the comment frame draws every board's pins, this one's too, in one layer
            />,
          )}
        </div>
      )}
      {framed?.frame && writable(framed, readOnly) && (
        <div className="design-frame-handles" style={screen(framed.frame)}>
          {HANDLES.map((h) => (
            <span key={h} className="deck-handle design-board-handle" data-board-handle={h} data-at={h} aria-label={C.resizeBoard(h)} style={{ left: `${HANDLE_AT[h][0] * 100}%`, top: `${HANDLE_AT[h][1] * 100}%` }} />
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

const ORIGIN = { zoom: 1, x: 0, y: 0 } as const;
/** A title's room on screen below which it shows the board's name alone (no size, no badge). */
const TITLE_FULL_PX = 160;

/**
 * The boards' titles in screen px over the world (M6: drawn at the zoom, not counter-scaled inside the boards' layer,
 * so a zoom restyles no board), each as wide as its board is drawn: the name truncates, and below 160 px the size and
 * the held badge drop out; the name and size stay the button's accessible name and tooltip.
 *
 * DL39's bounded wave: a title renders when its own board, its active or selected state, or its room for the size
 * (the 160 px threshold) changes; its place and width follow the zoom by three style writes from the view, so a zoom
 * renders no title and formats no size, and one board's frame write renders that board's title alone.
 */
const Titles = memo(function Titles(props: { view: DesignView; boards: readonly BoardView[]; activeId: string | null; frameId: string | null; onSelect: (boardId: string) => void }) {
  const { view, boards, activeId, frameId, onSelect } = props;
  const nodes = useRef(new Map<string, HTMLElement>());
  const register = useCallback((boardId: string, node: HTMLElement | null) => {
    if (node) nodes.current.set(boardId, node);
    else nodes.current.delete(boardId);
  }, []);
  const latest = useRef(boards);
  const placedAt = useRef<number | null>(null);
  const place = useCallback(
    (always: boolean) => {
      const zoom = view.snapshot().viewport?.zoom ?? 1;
      if (!always && zoom === placedAt.current) return; // a pan: the wrapper's transform moves them
      placedAt.current = zoom;
      for (const b of latest.current) {
        const node = b.frame ? nodes.current.get(b.id) : undefined;
        if (!node || !b.frame) continue;
        node.style.left = `${b.frame.x * zoom}px`;
        node.style.top = `${b.frame.y * zoom}px`;
        node.style.width = `${b.frame.w * zoom}px`;
      }
    },
    [view],
  );
  useLayoutEffect(() => {
    latest.current = boards;
    place(true);
  }, [boards, place]);
  useLayoutEffect(() => view.subscribe(() => place(false)), [view, place]);
  // the boards whose title has room for its size: a string, so it changes only when a title crosses the threshold
  const roomy = useSyncExternalStore(view.subscribe, () => {
    const zoom = view.snapshot().viewport?.zoom ?? 1;
    return boards.flatMap((b) => (b.frame && b.frame.w * zoom >= TITLE_FULL_PX ? [b.id] : [])).join(' ');
  });
  const full = useMemo(() => new Set(roomy.split(' ')), [roomy]);
  return (
    <>
      {boards.map((b) =>
        b.frame ? <Title key={b.id} board={b as BoardView & { frame: BoardFrame }} full={full.has(b.id)} active={b.id === activeId} selected={b.id === frameId} onSelect={onSelect} register={register} /> : null,
      )}
    </>
  );
});

/** One title: its words from its board alone (placed by `Titles`). */
const Title = memo(function Title(props: { board: BoardView & { frame: BoardFrame }; full: boolean; active: boolean; selected: boolean; onSelect: (boardId: string) => void; register: (boardId: string, node: HTMLElement | null) => void }) {
  const { board, full, active, selected, onSelect, register } = props;
  const { id, frame } = board;
  const ref = useCallback((node: HTMLButtonElement | null) => register(id, node), [register, id]);
  const words = useMemo(() => {
    const label = boardLabel(board);
    const size = C.size(frame.w, frame.h);
    return { label, size, aria: C.boardTitle(label), tooltip: `${label}, ${size}` };
  }, [board, frame.w, frame.h]);
  return (
    <button
      ref={ref}
      type="button"
      className="design-screen-title"
      data-board-title={id}
      data-active={active || undefined}
      data-frame-selected={selected || undefined}
      aria-label={words.aria}
      title={words.tooltip}
      aria-pressed={selected}
      onClick={() => onSelect(id)}
    >
      <span className="design-board-title-name">{words.label}</span>
      {full && <span className="design-board-title-size">{words.size}</span>}
      {full && board.held && <span className="design-board-badge">{C.held}</span>}
    </button>
  );
});

/** A held or missing board's dashed outline in screen px, and a missing board's label (M6: out of the boards' layer). */
const Marks = memo(function Marks({ boards, zoom }: { boards: readonly BoardView[]; zoom: number }) {
  return (
    <>
      {boards.map((b) =>
        b.frame && (b.held || b.missing) ? (
          <div key={b.id} className="design-board-mark" data-board-mark={b.id} style={{ left: b.frame.x * zoom, top: b.frame.y * zoom, width: b.frame.w * zoom, height: b.frame.h * zoom }}>
            {b.missing && (
              <span className="design-board-mark-label" role="note" data-missing-label={b.id}>
                {C.missing}
              </span>
            )}
          </div>
        ) : null,
      )}
    </>
  );
});

/** A board's frame selected: it becomes the board C's overlay acts on, with no element selected. */
function selectFrame(session: DeckSession, view: DesignView, boardId: string): void {
  session.show(boardId);
  session.select([]);
  view.selectFrame(boardId);
}

/** An inactive board pressed: it becomes the active board and the element under the press is selected (C's `pick`). */
function activate(session: DeckSession, view: DesignView, boardId: string, canvas: SlideCanvas | null, e: PointerEvent, target: HTMLElement): void {
  view.selectFrame(null);
  session.show(boardId);
  if (!canvas) return;
  let hits = hitIds(canvas, { x: e.clientX, y: e.clientY }, { x: 0, y: 0 }, 0, []);
  if (hits.length === 0) {
    // a page with no hit test of its own (or a press between painted nodes): the pressed node's element chain
    hits = [];
    for (let n: HTMLElement | null = target.closest('[data-eid]'); n && canvas.root.contains(n); n = n.parentElement?.closest<HTMLElement>('[data-eid]') ?? null) hits.push(n.dataset.eid!);
  }
  session.select(pick(slideTree(session.doc, boardId), hits, []).selection);
}

/**
 * One board in the world: its canvas at scale 1 in the boards' layer (its title and marks are screen chrome). P4-A2 G2.4:
 * while a publish writes it, the deck's layer over its canvas (G-R3), the session protecting the human's elements while
 * this is the active board (its current slide, G-R4).
 */
const Board = memo(function Board(props: {
  session: DeckSession;
  board: BoardView & { frame: BoardFrame };
  active: boolean;
  frameSelected: boolean;
  assetUrl: AssetUrl;
  faces: FaceAliases;
  onCanvas: (boardId: string, canvas: SlideCanvas | null) => void;
  canvas: SlideCanvas | null;
  provisional: DeckProvisional | null;
  zoom: ScreenZoom;
}) {
  const { session, board, active, frameSelected, assetUrl, faces, onCanvas, canvas, provisional, zoom } = props;
  const { id, frame } = board;
  const canvasOf = useCallback((canvas: SlideCanvas | null) => onCanvas(id, canvas), [onCanvas, id]);
  const written = useBoardWritten(provisional, id);
  return (
    <div
      className="design-board"
      data-board-id={id}
      data-active={active || undefined}
      data-frame-selected={frameSelected || undefined}
      data-held={board.held ? '' : undefined}
      data-missing={board.missing || undefined}
      style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}
    >
      <SlideView doc={session.doc} slideId={id} token={board.token} assetUrl={assetUrl} scale={1} size={{ w: frame.w, h: frame.h }} onCanvas={canvasOf} faces={faces} className="design-board-canvas" describe={describeElement} /* P4-B2 (D15, A1) */ />
      {provisional && written && canvas?.slideId === id && (
        <SlideLayer deck={provisional} canvas={canvas} slideId={id} scale={1} size={{ w: frame.w, h: frame.h }} session={session} assetUrl={assetUrl} faces={faces} zoom={zoom} /> /* P4-A2 G2.4 (G-R3, G-R4) */
      )}
      {board.missing && <div className="design-board-missing" />}
    </div>
  );
});
