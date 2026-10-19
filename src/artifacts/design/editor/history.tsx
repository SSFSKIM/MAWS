// P3-E1 M4 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M4; parent §4.7 [binding], Decision Logs 13 (4)
// and 23): the design's version history in place of the live world. C's controller loads the comparison (the version
// against the one before it, two versions compared, or the live design since the owner's last view), owns the preview's
// two throwaway docs and frees them once nothing draws them; B's rail lists the versions. The design owns what it draws
// of that comparison: its projection (../history.ts: a cross-board move one change), the bar's count and ↑ ↓ over the
// projection's stops, and a read-only world of every board at its frame in that state, each drawn by C's canvas in the
// design system pinned at the version with the version's assets and faces. With Show changes on: a changed board's
// frame edged in its author's colour (a new one badged, a deleted one ghosted where it was), each changed, new or moved
// element outlined where it is drawn, each deleted one and each moved one's old place ghosted from the earlier state,
// in the board list the same edges; ↑ ↓ fit each change's board in view. Nothing here writes.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import type { AssetUrl, SlideCanvas } from '../../slides/canvas';
import type { FaceAliases } from '../../slides/canvas/faces';
import type { KeyChange } from '../../slides/history';
import type { DeckHistoryController, DeckPreview } from '../../slides/editor/history/controller';
import { HISTORY_COPY, keyLabel } from '../../slides/editor/history/copy';
import type { PreviewAssets } from '../../slides/editor/history/HistoryPreview';
import type { PreviewFaces } from '../../slides/editor/history/faces';
import { SlideView } from '../../slides/editor/SlideView';
import { measure } from '../../slides/editor/transform/measure';
import type { BoardFrame } from '../canvas';
import { designStops, type DesignBoardChange, type DesignChanges, type DesignElementChange, type DesignStop } from '../history';
import { boardLabel, readBoards, type BoardView } from './boards';
import { DESIGN_COPY as C } from './copy';
import { BOARD_FIT_MAX, DesignView, panBy, unionRect, zoomAt } from './viewport';
import '../../slides/editor/history/history.css';

/** A board key as the owner reads it: the frame's position and size, the name, else C's words. */
export function boardKeyLabel(key: string): string {
  return ({ x: 'position', y: 'position', w: 'size', h: 'size', title: 'name' } as Record<string, string>)[key] ?? keyLabel(key);
}
const keysLabel = (keys: readonly KeyChange[], label: (key: string) => string = keyLabel) => [...new Set(keys.map((k) => label(k.key)))].join(', ');

/** Changed keys grouped by who changed them and when, in their order: each group's words and its touch. */
function keyCredits(keys: readonly KeyChange[]): { label: string; by: string | null; at: number | null }[] {
  const groups: { keys: KeyChange[]; by: string | null; at: number | null }[] = [];
  for (const k of keys) {
    const group = groups.find((g) => g.by === k.by && g.at === k.at);
    if (group) group.keys.push(k);
    else groups.push({ keys: [k], by: k.by, at: k.at });
  }
  return groups.map((g) => ({ label: keysLabel(g.keys), by: g.by, at: g.at }));
}

/** Where ↑ ↓ stand in the projection: its stops and the one reached (null before the first step). */
export interface DesignFocus {
  stops: DesignStop[];
  index: number | null;
}

/** ↑ ↓ over the projection's stops, wrapping; the focus resets with each new comparison. */
export function useDesignFocus(projected: DesignChanges | null): { focus: DesignFocus; step(direction: 1 | -1): DesignStop | null } {
  const stops = useMemo(() => (projected ? designStops(projected) : []), [projected]);
  const [at, setAt] = useState<{ of: DesignChanges | null; index: number } | null>(null);
  const index = at && at.of === projected ? at.index : null;
  const step = useCallback(
    (direction: 1 | -1): DesignStop | null => {
      const n = stops.length;
      if (n === 0) return null;
      const next = index === null ? (direction === 1 ? 0 : n - 1) : (index + direction + n) % n;
      setAt({ of: projected, index: next });
      return stops[next]!;
    },
    [stops, index, projected],
  );
  return { focus: { stops, index }, step };
}

/** C's preview bar for a design: the projection's count and ↑ ↓, Restore (confirmed), Make a copy, Name, Back to design. */
export function DesignHistoryBar({ preview, controller, count, onStep, onBack }: { preview: DeckPreview; controller: DeckHistoryController; count: number; onStep(direction: 1 | -1): void; onBack(): void }) {
  const [confirming, setConfirming] = useState(false);
  const [naming, setNaming] = useState(false);
  return (
    <>
      <div className="deck-toolbar deck-history-bar" role="toolbar" aria-label={HISTORY_COPY.bar}>
        <span className="deck-history-heading">{preview.title}</span>
        <span className="deck-toolbar-divider" aria-hidden />
        <label className="deck-history-toggle">
          <input type="checkbox" checked={preview.showChanges} onChange={(event) => controller.setShowChanges(event.target.checked)} />
          {HISTORY_COPY.showChanges}
        </label>
        {preview.showChanges && (
          <>
            <span className="deck-history-count" aria-live="polite" data-history-count={count}>
              {HISTORY_COPY.count(count)}
            </span>
            <Button label={HISTORY_COPY.previous} disabled={count === 0} onClick={() => onStep(-1)}>
              ↑
            </Button>
            <Button label={HISTORY_COPY.next} disabled={count === 0} onClick={() => onStep(1)}>
              ↓
            </Button>
          </>
        )}
        <span className="deck-toolbar-spacer" />
        {preview.versionId !== null && (
          <>
            <Button label={HISTORY_COPY.restore} onClick={() => setConfirming(true)}>
              {HISTORY_COPY.restore}
            </Button>
            <Button label={HISTORY_COPY.copy} onClick={() => void controller.duplicate()}>
              {HISTORY_COPY.copy}
            </Button>
            {controller.canName && (
              <Button label={HISTORY_COPY.name} onClick={() => setNaming(true)}>
                {HISTORY_COPY.name}
              </Button>
            )}
          </>
        )}
        <Button label={C.historyBack} onClick={onBack}>
          {C.historyBack}
        </Button>
      </div>
      {naming && <NameForm onName={(label) => controller.name(label)} onDone={() => setNaming(false)} />}
      {confirming && (
        <div className="deck-history-confirm" role="alertdialog" aria-label={HISTORY_COPY.restoreAsk}>
          <p>{C.historyRestoreBody}</p>
          <div className="deck-history-actions">
            <Button label={HISTORY_COPY.cancel} onClick={() => setConfirming(false)}>
              {HISTORY_COPY.cancel}
            </Button>
            <Button
              label={HISTORY_COPY.restoreConfirm}
              onClick={() => {
                setConfirming(false);
                void controller.restore();
              }}
            >
              {HISTORY_COPY.restoreConfirm}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function Button({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" className="deck-button" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function NameForm({ onName, onDone }: { onName(label: string): Promise<boolean>; onDone(): void }) {
  const [label, setLabel] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const name = label.trim();
    if (name === '') return;
    void onName(name).then((named) => named && onDone());
  };
  return (
    <form className="deck-history-confirm" aria-label={HISTORY_COPY.name} onSubmit={submit}>
      <input className="deck-history-name" aria-label={HISTORY_COPY.nameField} placeholder={HISTORY_COPY.namePlaceholder} maxLength={200} value={label} onChange={(event) => setLabel(event.target.value)} />
      <div className="deck-history-actions">
        <Button label={HISTORY_COPY.cancel} onClick={onDone}>
          {HISTORY_COPY.cancel}
        </Button>
        <button type="submit" className="deck-button" disabled={label.trim() === ''}>
          {HISTORY_COPY.save}
        </button>
      </div>
    </form>
  );
}

// ---- the boards of the comparison

/** A board as the preview draws it: from the shown state, or, deleted, from the earlier one where it was. */
export interface HistoryBoard {
  board: BoardView & { frame: BoardFrame };
  removed: boolean;
  change: DesignBoardChange | undefined;
}

/** The shown state's boards in order, each deleted board (Show changes on) at its earlier place in the order. */
export function historyBoards(preview: Pick<DeckPreview, 'shown' | 'earlier' | 'showChanges'>, projected: DesignChanges): HistoryBoard[] {
  const byId = new Map(projected.boards.map((b) => [b.id, b]));
  const shown = readBoards(preview.shown).boards;
  const earlier = readBoards(preview.earlier).boards;
  const out: HistoryBoard[] = shown.flatMap((board) => (board.frame ? [{ board: board as HistoryBoard['board'], removed: false, change: byId.get(board.id) }] : []));
  if (!preview.showChanges) return out;
  earlier.forEach((board, i) => {
    if (!board.frame || byId.get(board.id)?.kind !== 'removed') return;
    const before = earlier.slice(0, i).reverse().find((b) => out.some((o) => o.board.id === b.id));
    const at = before ? out.findIndex((o) => o.board.id === before.id) + 1 : 0;
    out.splice(at, 0, { board: board as HistoryBoard['board'], removed: true, change: byId.get(board.id) });
  });
  return out;
}

const authorStyle = (controller: DeckHistoryController, by: string | null): CSSProperties | undefined => (by ? ({ '--deck-history-author': `var(${controller.author(by).color})` } as CSSProperties) : undefined);

/** The read-only list of the comparison's boards, each changed one edged in its author's colour; a click fits it. */
export function HistoryBoardList({ controller, boards, showChanges, onFit, current = null }: { controller: DeckHistoryController; boards: readonly HistoryBoard[]; showChanges: boolean; onFit(boardId: string): void; /** M5: the version's board an export takes */ current?: string | null }) {
  return (
    <nav className="design-boards" aria-label={C.historyBoards} data-design-rail="boards">
      <div className="design-boards-header">
        <span>{C.historyBoards}</span>
      </div>
      <ol className="design-boards-list">
        {boards.map(({ board, change, removed }) => {
          const kind = showChanges ? (change?.kind ?? null) : null;
          const author = kind && change?.by ? controller.author(change.by) : null;
          return (
            <li key={board.id} className="design-board-item" data-history-board-row={board.id} data-history-change={kind ?? undefined} style={authorStyle(controller, kind ? (change?.by ?? null) : null)}>
              <button type="button" className="design-board-row" aria-label={C.historyBoardRow(boardLabel(board), kind)} title={author ? HISTORY_COPY.by(author.name, author.when(change!.at)) : undefined} aria-current={!removed && board.id === current ? 'true' : undefined} onClick={() => onFit(board.id)}>
                <span className="design-board-name">{boardLabel(board)}</span>
                {kind === 'added' && <span className="design-board-badge deck-history-badge">{HISTORY_COPY.newBadge}</span>}
                {kind === 'removed' && <span className="design-board-badge deck-history-badge">{HISTORY_COPY.deletedBadge}</span>}
                <span className="design-board-size">{C.size(board.frame.w, board.frame.h)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ---- the world of the comparison

interface Mark {
  board: string;
  id: string;
  kind: DesignElementChange['kind'];
  /** Board px. */
  box: { x: number; y: number; w: number; h: number };
  color: string | null;
  title: string;
}

interface WorldProps {
  controller: DeckHistoryController;
  preview: DeckPreview;
  projected: DesignChanges;
  boards: readonly HistoryBoard[];
  focus: DesignStop | null;
  /** The preview's own view (its pan and zoom; the live world's stays as it was). */
  view: DesignView;
  assets: PreviewAssets;
  faces: Pick<PreviewFaces, 'shown' | 'earlier'>;
  scope: (children: ReactNode) => ReactNode;
}

/** The comparison's boards, read-only, at their frames in one transformed layer, with the marks over them (module header). */
export function HistoryWorld({ controller, preview, projected, boards, focus, view, assets, faces, scope }: WorldProps) {
  const surface = useRef<HTMLDivElement>(null);
  const state = useSyncExternalStore(view.subscribe, view.snapshot);
  const viewport = state.viewport ?? { zoom: 1, x: 0, y: 0 };
  const labels = useMemo(() => new Map(boards.map((b) => [b.board.id, boardLabel(b.board)])), [boards]);

  // the room the preview has; a fresh view fits every board
  useLayoutEffect(() => {
    const el = surface.current;
    if (!el) return;
    const room = () => (el.clientWidth > 0 && el.clientHeight > 0 ? { w: el.clientWidth, h: el.clientHeight } : null);
    const measureRoom = () => {
      const r = room();
      if (r) view.setRoom(r);
    };
    measureRoom();
    const detach = view.measureRoomWith(room);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureRoom);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      detach();
    };
  }, [view]);
  useEffect(() => {
    const rect = unionRect(boards.map((b) => b.board.frame));
    if (!view.placed && rect) view.fitTo(rect, BOARD_FIT_MAX);
  }, [view, boards]);
  // ↑ ↓ reaching a change shows its board
  useEffect(() => {
    if (!focus || focus.part === 'deck') return;
    const frame = boards.find((b) => b.board.id === focus.boardId)?.board.frame;
    if (frame) view.fitTo(frame, BOARD_FIT_MAX);
  }, [focus, boards, view]);

  // pan by a drag or the wheel, zoom by a pinch or ⌥-wheel; nothing else takes the pointer
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    let drag: { id: number; x: number; y: number; start: { zoom: number; x: number; y: number } } | null = null;
    const vp = () => view.snapshot().viewport ?? { zoom: 1, x: 0, y: 0 };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 1) return;
      if ((e.target as HTMLElement).closest('.deck-history-mark')) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, start: vp() };
      el.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (drag && drag.id === e.pointerId) view.setViewport(panBy(drag.start, e.clientX - drag.x, e.clientY - drag.y));
    };
    const onUp = (e: PointerEvent) => {
      if (drag && drag.id === e.pointerId) drag = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = vp();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.altKey) view.setViewport(zoomAt(v, v.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), { x: e.clientX - r.left, y: e.clientY - r.top }));
      else view.setViewport(panBy(v, -e.deltaX, -e.deltaY));
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
    };
  }, [view]);

  // every board's canvas and its ghosts' (the earlier state's board, where deleted and moved-away elements are drawn)
  const [canvases, setCanvases] = useState<ReadonlyMap<string, SlideCanvas>>(() => new Map());
  const onCanvas = useCallback((key: string, canvas: SlideCanvas | null) => {
    setCanvases((now) => {
      if (canvas ? now.get(key) === canvas : !now.has(key)) return now;
      const next = new Map(now);
      if (canvas) next.set(key, canvas);
      else next.delete(key);
      return next;
    });
  }, []);
  const show = preview.showChanges;
  const ghostIds = useMemo(() => {
    const out = new Map<string, string[]>();
    if (!show) return out;
    for (const b of projected.boards) {
      if (b.kind === 'removed') continue;
      const ids = b.elements.filter((e) => e.kind === 'removed' || e.kind === 'movedAway').map((e) => e.id);
      if (ids.length > 0) out.set(b.id, ids);
    }
    return out;
  }, [projected, show]);
  useEffect(() => {
    for (const [board, ids] of ghostIds) {
      const ghosts = canvases.get(`ghosts:${board}`);
      for (const id of ids) {
        const node = ghosts?.node(id);
        if (node) node.dataset.ghost = '';
      }
    }
  }, [canvases, ghostIds]);

  // the marks, measured at every layout pass of any canvas (a system's style or a face arriving moves elements)
  const [marks, setMarks] = useState<Mark[]>([]);
  const zoom = viewport.zoom;
  useEffect(() => {
    if (!show) {
      setMarks((now) => (now.length === 0 ? now : []));
      return;
    }
    let live = true;
    const measureMarks = () => {
      if (!live) return;
      const next: Mark[] = [];
      for (const b of projected.boards) {
        if (b.kind !== 'changed' && b.elements.length === 0) continue;
        for (const e of b.elements) {
          const ghost = e.kind === 'removed' || e.kind === 'movedAway';
          const canvas = canvases.get(ghost ? `ghosts:${b.id}` : b.id) ?? (b.kind === 'removed' ? canvases.get(b.id) : undefined);
          const m = canvas ? measure(canvas, e.id, zoom) : null;
          if (!m) continue;
          const author = e.by ? controller.author(e.by) : null;
          const credited = (what: string, touch: { by: string | null; at: number | null }) => {
            const who = touch.by ? controller.author(touch.by) : null;
            return who ? `${what} — ${HISTORY_COPY.by(who.name, who.when(touch.at))}` : what;
          };
          // a move is its mover's; each key changed in it, or in a changed element, is its own author's
          const title =
            e.kind === 'moved'
              ? [credited(C.movedFrom(labels.get(e.from.board) ?? e.from.board), e), ...keyCredits(e.keys).map((g) => credited(g.label, g))].join('; ')
              : e.kind === 'movedAway'
                ? credited(C.movedAway(labels.get(e.to.board) ?? e.to.board), e)
                : e.kind === 'changed'
                  ? keyCredits(e.keys).map((g) => credited(g.label, g)).join('; ')
                  : credited(e.kind === 'added' ? HISTORY_COPY.newBadge : HISTORY_COPY.deletedBadge, e);
          next.push({ board: b.id, id: e.id, kind: e.kind, box: m.bounds, color: author?.color ?? null, title });
        }
      }
      setMarks((now) => (sameMarks(now, next) ? now : next));
    };
    const offs = [...canvases.values()].map((canvas) => canvas.onLayout(measureMarks));
    void Promise.all([...canvases.values()].map((canvas) => canvas.whenLaidOut())).then(measureMarks);
    return () => {
      live = false;
      offs.forEach((off) => off());
    };
  }, [canvases, projected, show, zoom, controller, labels]);

  const frames = useMemo(() => new Map(boards.map((b) => [b.board.id, b.board.frame])), [boards]);
  const focused = focus?.part === 'element' ? `${focus.boardId}\u0000${focus.elementId}` : null;
  const focusedBoard = focus?.part === 'board' || focus?.part === 'notes' ? focus.boardId : null; // notes have no surface here: their board's
  const layerStyle = { transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${zoom})`, '--design-inv-zoom': String(1 / zoom), '--design-zoom': String(zoom) } as CSSProperties;
  return (
    <div ref={surface} className="design-world" role="region" aria-label={C.historyWorld} data-design-world data-history-world={preview.target.kind}>
      <div className="design-world-ground" />
      <div className="design-world-layer" style={layerStyle}>
        {scope(
          boards.map(({ board, removed, change }) => {
            const kind = show ? (change?.kind ?? null) : null;
            const earlierFrame = removed ? board.frame : null;
            const ghosts = ghostIds.has(board.id);
            return (
              <div
                key={`${removed ? 'earlier' : 'shown'}:${board.id}`}
                className="design-board design-history-board"
                data-board-id={board.id}
                data-history-board={board.id}
                data-history-change={kind ?? undefined}
                data-focused={focusedBoard === board.id || undefined}
                title={kind === 'changed' && change && change.keys.length > 0 ? keysLabel(change.keys, boardKeyLabel) : undefined}
                style={{ left: board.frame.x, top: board.frame.y, width: board.frame.w, height: board.frame.h, '--board-w': String(board.frame.w), ...authorStyle(controller, kind ? (change?.by ?? null) : null) } as CSSProperties}
              >
                <span className="design-board-title" data-history-title={board.id}>
                  <span className="design-board-title-name">{boardLabel(board)}</span>
                  <span className="design-board-title-size">{C.size(board.frame.w, board.frame.h)}</span>
                  {kind === 'added' && <span className="design-board-badge deck-history-badge">{HISTORY_COPY.newBadge}</span>}
                  {kind === 'removed' && <span className="design-board-badge deck-history-badge">{HISTORY_COPY.deletedBadge}</span>}
                </span>
                <PreviewBoard doc={removed ? preview.earlier : preview.shown} board={board} assetUrl={removed ? assets.earlier : assets.shown} faces={removed ? faces.earlier : faces.shown} canvasKey={board.id} onCanvas={onCanvas} />
                {ghosts && !earlierFrame && <GhostBoard doc={preview.earlier} boardId={board.id} assetUrl={assets.earlier} faces={faces.earlier} onCanvas={onCanvas} />}
              </div>
            );
          }),
        )}
      </div>
      <div className="design-world-screen">
        {marks.map((m) => {
          const f = frames.get(m.board);
          if (!f) return null;
          const key = `${m.board}\u0000${m.id}`;
          return (
            <div
              key={key}
              className="deck-history-mark"
              data-history-mark={m.id}
              data-history-mark-board={m.board}
              data-kind={m.kind}
              data-focused={focused === key || undefined}
              title={m.title}
              style={{ left: viewport.x + (f.x + m.box.x) * zoom, top: viewport.y + (f.y + m.box.y) * zoom, width: m.box.w * zoom, height: m.box.h * zoom, ...(m.color ? { '--deck-history-author': `var(${m.color})` } : {}) } as CSSProperties}
            />
          );
        })}
      </div>
    </div>
  );
}

/** A board of a state drawn by C's canvas at scale 1, its faces under the state's private names. */
function PreviewBoard({ doc, board, assetUrl, faces, canvasKey, onCanvas }: { doc: DeckPreview['shown']; board: BoardView & { frame: BoardFrame }; assetUrl: AssetUrl; faces: FaceAliases; canvasKey: string; onCanvas(key: string, canvas: SlideCanvas | null): void }) {
  const canvasOf = useCallback((canvas: SlideCanvas | null) => onCanvas(canvasKey, canvas), [onCanvas, canvasKey]);
  return <SlideView doc={doc} slideId={board.id} token={board.token} assetUrl={assetUrl} scale={1} size={{ w: board.frame.w, h: board.frame.h }} onCanvas={canvasOf} faces={faces} className="design-board-canvas" />;
}

/** The earlier state's board over the shown one, only its deleted and moved-away elements visible (C's ghosts). */
function GhostBoard({ doc, boardId, assetUrl, faces, onCanvas }: { doc: DeckPreview['earlier']; boardId: string; assetUrl: AssetUrl; faces: FaceAliases; onCanvas(key: string, canvas: SlideCanvas | null): void }) {
  const earlier = useMemo(() => readBoards(doc).boards.find((b) => b.id === boardId), [doc, boardId]);
  const canvasOf = useCallback((canvas: SlideCanvas | null) => onCanvas(`ghosts:${boardId}`, canvas), [onCanvas, boardId]);
  if (!earlier?.frame) return null;
  return (
    <div className="deck-history-ghosts" aria-hidden>
      <SlideView doc={doc} slideId={boardId} token={earlier.token} assetUrl={assetUrl} scale={1} size={{ w: earlier.frame.w, h: earlier.frame.h }} onCanvas={canvasOf} faces={faces} />
    </div>
  );
}

const sameMarks = (a: readonly Mark[], b: readonly Mark[]): boolean =>
  a.length === b.length &&
  a.every((m, i) => {
    const n = b[i]!;
    return m.board === n.board && m.id === n.id && m.kind === n.kind && m.color === n.color && m.title === n.title && m.box.x === n.box.x && m.box.y === n.box.y && m.box.w === n.box.w && m.box.h === n.box.h;
  });
