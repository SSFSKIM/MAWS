// P3-E1 M3 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M3; the parent's §1 "The workbench", Decision
// Log 20): the design's editor over one replica, shared by the panel's record view and the `artifact` main tab (the
// shell, src/renderer/src/tools/design/). The world dominates (World.tsx: every board mounted, pan and zoom, frames);
// the board list is the rail's navigation (BoardList.tsx); the inspector is contextual (an element's: C's; else the
// board's geometry above C's for the board's own fill). C's element engine is reused, not copied: the deck session (the
// active board, the selection, the one undo stack, awaited edits, the composition hold), the overlay, the text box,
// the element bar, the text style menu, the inspector and the Theme panel. The boards draw in the governing design
// system's `document` medium (a board is a screen, not a slide: E0 (f)) with the deck root's overrides last, and with the
// design's screen type defaults (board-css.ts). The chrome reads the app's tokens and C's classes; under 720 px of
// width the rails lie over the world rather than squeezing it (C's narrow-panel pattern). Comments and history (M4)
// and export (M5) join this tree later; the tab owns the view (`DesignView`), so the header's Zoom to fit and a remount
// keep their place.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { DesignSystemScope, useDesignSystem, type DesignSystemRef } from '../../design-system/apply';
import { onUpdate, type Doc } from '../../yjs';
import type { AssetUrl, SlideCanvas } from '../../slides/canvas';
import { insertElements, type NewKind } from '../../slides/writers-elements';
import { mintSlideId } from '../../slides/writers';
import { DECK_COPY } from '../../slides/editor/copy';
import { ElementBar } from '../../slides/editor/ElementBar';
import { aliasOverrides } from '../../slides/editor/history/faces';
import { Inspector } from '../../slides/editor/Inspector';
import { TextStyleMenu } from '../../slides/editor/menus/TextStyle';
import { ThemePanel, type DeckThemeChoice } from '../../slides/editor/menus/Theme';
import { useCanvasCss, useDeckFaces } from '../../slides/editor/page-styles';
import type { DeckSession } from '../../slides/editor/session';
import type { ImportAsset } from '../../slides/editor/transform/clipboard';
import { measureInHost } from '../../slides/editor/transform/Overlay';
import { measure } from '../../slides/editor/transform/measure';
import { BOARD_CSS } from '../board-css';
import { placementAfter, writeBoardEntry } from '../model';
import { BoardError, deleteBoard, duplicateBoard, insertBoard } from '../writers';
import { BoardInspector } from './BoardInspector';
import { BoardList } from './BoardList';
import { keepEqualBoards, readBoards, type DesignBoards } from './boards';
import { DESIGN_COPY as C, type BoardPreset } from './copy';
import { boardElement } from './insert';
import { BOARD_FIT_MAX, unionRect, ZOOM_MAX, ZOOM_MIN, ZOOM_STEPS, type DesignView, type Rect } from './viewport';
import { World } from './World';
import '../../slides/editor/chrome.css';
import '../../slides/editor/deck.css';
import './workbench.css';

export interface DesignWorkbenchProps {
  session: DeckSession;
  /** The tab's view (its viewport and frame selection outlive this body). */
  view: DesignView;
  assetUrl: AssetUrl;
  /** The design's governing design system (D's chain); null draws the boards' own fallbacks. */
  system: DesignSystemRef | { builtin: 'maws' } | null;
  readOnly: boolean;
  /** The panel's narrow body: the rails start closed. */
  compact?: boolean;
  /** Uploads a picked image into the artifact and answers its `assets/<name>` ref (Insert's image, Replace). */
  uploadAsset?: (file: File) => Promise<string>;
  /** The design's artifact (named on copies) and how a paste brings another artifact's pictures over. */
  artifactId?: string;
  importAsset?: ImportAsset;
  /** The Theme panel's design systems and how the design names one. */
  theme?: DeckThemeChoice;
  /** The world's surface, for Mark-up. */
  onStage?: (element: HTMLElement | null) => void;
  /** Once, when every board of the first showing has laid out (how many). */
  onDrawn?: (boards: number) => void;
}

const NOTICE_MS = 6_000;
const TEXT_KINDS: readonly NewKind[] = ['text', 'heading', 'bullets', 'numbers'];

/** The boards, followed through the replica's updates (the same object while nothing they show changed). */
function useBoards(doc: Doc): DesignBoards {
  const held = useRef<{ value: DesignBoards; stale: boolean } | null>(null);
  return useSyncExternalStore(
    useCallback(
      (listener: () => void) =>
        onUpdate(doc, () => {
          if (held.current) held.current.stale = true;
          listener();
        }),
      [doc],
    ),
    () => {
      const h = held.current;
      if (h && !h.stale) return h.value;
      const value = h ? keepEqualBoards(h.value, readBoards(doc)) : readBoards(doc);
      held.current = { value, stale: false };
      return value;
    },
  );
}

/** The board style sheet, once per document, after C's canvas sheet. */
function useBoardCss(): void {
  useLayoutEffect(() => {
    if (document.querySelector('style[data-maws-board-css]')) return;
    const style = document.createElement('style');
    style.dataset.mawsBoardCss = '';
    style.textContent = BOARD_CSS;
    document.head.appendChild(style);
  }, []);
}

export function DesignWorkbench({ session, view, assetUrl, system, readOnly, compact = false, uploadAsset, artifactId, importAsset, theme, onStage, onDrawn }: DesignWorkbenchProps) {
  useCanvasCss();
  useBoardCss();
  const doc = session.doc;
  const { boards, overrides, faces: deckFaces } = useBoards(doc);
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const viewState = useSyncExternalStore(view.subscribe, view.snapshot);
  const order = useMemo(() => boards.map((b) => b.id), [boards]);

  // the active board follows the design: one deleted (here or elsewhere) gives way to its neighbour
  const shownOrder = useRef<readonly string[]>(order);
  useEffect(() => {
    session.reconcile(order, shownOrder.current);
    shownOrder.current = order;
  }, [session, order]);
  const active = boards.find((b) => b.id === state.currentSlide) ?? boards[0] ?? null; // C's: until the session reconciles

  // no write lands while the replica is read-only (an awaited upload finishing after it turned so)
  useLayoutEffect(() => {
    session.holdWrites(readOnly);
    return () => session.holdWrites(false);
  }, [session, readOnly]);

  // every board's canvas, by board (the overlay, the element bar and the inspector read the active one's)
  const [canvases, setCanvases] = useState<ReadonlyMap<string, SlideCanvas>>(() => new Map());
  const onCanvas = useCallback((boardId: string, canvas: SlideCanvas | null) => {
    setCanvases((now) => {
      if (canvas ? now.get(boardId) === canvas : !now.has(boardId)) return now;
      const next = new Map(now);
      if (canvas) next.set(boardId, canvas);
      else next.delete(boardId);
      return next;
    });
  }, []);
  const activeCanvas = active ? (canvases.get(active.id) ?? null) : null;

  // the first showing drawn: every board laid out once (the open-to-interactive measure)
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current || !onDrawn) return;
    const drawn = boards.filter((b) => b.frame !== null);
    if (drawn.some((b) => !canvases.has(b.id))) return;
    reported.current = true;
    void Promise.all(drawn.map((b) => canvases.get(b.id)!.whenLaidOut())).then(() => onDrawn(drawn.length));
  }, [boards, canvases, onDrawn]);

  // the deck root's faces under private names, its overrides last in the document medium's scope
  const liveFaces = useDeckFaces(deckFaces, assetUrl);
  const scopeOverrides = useMemo(() => aliasOverrides(overrides, liveFaces.aliases), [overrides, liveFaces.aliases]);
  const scope = useCallback(
    (children: ReactNode) => (
      <DesignSystemScope system={system} medium="document" overrides={scopeOverrides} className="deck-ds-scope">
        {children}
      </DesignSystemScope>
    ),
    [system, scopeOverrides],
  );
  const tokens = useDesignSystem(system).view?.tokens ?? null;

  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  const [inspectorOpen, setInspectorOpen] = useState(!compact);
  const [boardsOpen, setBoardsOpen] = useState(!compact);

  const surface = useRef<HTMLDivElement | null>(null);
  const hasBoards = boards.length > 0;
  useEffect(() => {
    onStage?.(surface.current);
    return () => onStage?.(null);
  }, [onStage, hasBoards]);

  // ---- the view's fits
  const allRect = useCallback((): Rect | null => unionRect(boards.flatMap((b) => (b.frame ? [b.frame] : []))), [boards]);
  const fitAll = useCallback(() => {
    const rect = allRect();
    if (rect) view.fitTo(rect, BOARD_FIT_MAX);
  }, [allRect, view]);
  const zoomTo = useCallback(
    (boardId: string) => {
      const frame = boards.find((b) => b.id === boardId)?.frame;
      if (frame) view.fitTo(frame, BOARD_FIT_MAX);
    },
    [boards, view],
  );
  const fitSelection = useCallback(() => {
    const selection = session.snapshot().selection;
    const frame = active?.frame;
    if (frame && activeCanvas && selection.length > 0) {
      const boxes = selection.flatMap((id) => {
        const m = measure(activeCanvas, id, view.snapshot().viewport?.zoom ?? 1); // the canvas is drawn at the world's zoom
        return m ? [{ x: frame.x + m.bounds.x, y: frame.y + m.bounds.y, w: m.bounds.w, h: m.bounds.h }] : [];
      });
      const rect = unionRect(boxes);
      if (rect) return view.fitTo(rect, ZOOM_MAX);
    }
    const framed = boards.find((b) => b.id === (view.snapshot().frame ?? active?.id))?.frame;
    if (framed) view.fitTo(framed, BOARD_FIT_MAX);
    else fitAll();
  }, [session, active, activeCanvas, boards, view, fitAll]);
  // the first showing in this tab places the world: every board in view
  useEffect(() => {
    if (!view.placed && boards.some((b) => b.frame !== null)) fitAll();
  }, [view, boards, fitAll]);

  // ---- board commands (each one gesture, one undo step)
  const tryEdit = (write: (origin: object) => void): boolean => {
    try {
      session.edit(write);
      return true;
    } catch (error) {
      setNotice(error instanceof BoardError ? error.problems.join('; ') : error instanceof Error ? error.message : String(error));
      return false;
    }
  };
  const selectBoard = (boardId: string) => {
    session.show(boardId);
    session.select([]);
    view.selectFrame(boardId);
  };
  const addBoard = (preset: BoardPreset) => {
    const id = mintSlideId(doc);
    const frame = { ...placementAfter(doc), w: preset.w, h: preset.h };
    if (!tryEdit((origin) => insertBoard(doc, { id, frame, title: preset.label }, order.at(-1) ?? null, origin))) return;
    selectBoard(id);
    view.fitTo(frame, BOARD_FIT_MAX);
  };
  const duplicate = (boardId: string) => {
    let made: string | null = null;
    if (!tryEdit((origin) => (made = duplicateBoard(doc, boardId, {}, origin).id)) || made === null) return;
    selectBoard(made);
  };
  const remove = (boardId: string) => {
    tryEdit((origin) => deleteBoard(doc, boardId, origin));
    if (view.snapshot().frame === boardId) view.selectFrame(null);
  };
  const rename = (boardId: string, title: string) => tryEdit(() => writeBoardEntry(doc, boardId, { title: title || undefined })); // inside the edit's transaction

  const editable = !readOnly && active !== null && active.held === null && !active.missing;
  const insert = useCallback(
    (kind: NewKind) => {
      if (!editable || !active?.frame) return;
      let ids: string[] = [];
      try {
        session.edit((origin) => (ids = insertElements(doc, active.id, [boardElement(kind, active.frame!)], {}, origin)));
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
        return;
      }
      surface.current?.focus({ preventScroll: true });
      if (TEXT_KINDS.includes(kind)) session.editText(ids[0]!);
      else session.select(ids);
    },
    [editable, active, session, doc],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod || readOnly) return;
    const target = event.target as HTMLElement;
    if (event.defaultPrevented || target.isContentEditable) return; // the text box routes its own
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT') return; // a field keeps its own undo
    if (event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) session.redoStep();
      else session.undoStep();
    } else if (event.key.toLowerCase() === 'y') {
      event.preventDefault();
      session.redoStep();
    }
  };

  const zoom = viewState.viewport?.zoom ?? 1;
  const elementsSelected = state.selection.length > 0;
  return (
    <div className="deck-editor design-workbench" data-design-editor data-compact={compact || undefined} onKeyDown={onKeyDown}>
      {liveFaces.css && <style data-deck-faces>{liveFaces.css}</style>}
      <div className="deck-toolbar" role="toolbar" aria-label={C.toolbar}>
        <button type="button" className="deck-button" aria-label={C.boards} aria-pressed={boardsOpen} title={C.showBoards} onClick={() => setBoardsOpen((open) => !open)}>
          ☷
        </button>
        <span className="deck-toolbar-divider" aria-hidden />
        <button type="button" className="deck-button" aria-label={DECK_COPY.undo} title={`${DECK_COPY.undo} (⌘Z)`} disabled={!state.canUndo || readOnly} onClick={() => session.undoStep()}>
          ↶
        </button>
        <button type="button" className="deck-button" aria-label={DECK_COPY.redo} title={`${DECK_COPY.redo} (⇧⌘Z)`} disabled={!state.canRedo || readOnly} onClick={() => session.redoStep()}>
          ↷
        </button>
        <span className="deck-toolbar-divider" aria-hidden />
        <ElementBar
          session={session}
          slideId={active?.id ?? null}
          canvas={activeCanvas}
          scale={zoom}
          readOnly={!editable}
          onInsert={insert}
          uploadAsset={uploadAsset}
          onNotice={setNotice}
          inspectorOpen={inspectorOpen}
          onToggleInspector={() => setInspectorOpen((open) => !open)}
        />
        <TextStyleMenu session={session} slideId={active?.id ?? null} tokens={tokens} readOnly={!editable} onNotice={setNotice} />
        <span role="status" className="deck-notice" data-deck-notice>
          {notice}
        </span>
        <span className="deck-toolbar-spacer" />
        <ZoomControls view={view} zoom={zoom} onFitAll={fitAll} onFitSelection={fitSelection} />
      </div>
      {active?.held && (
        <div role="status" className="deck-held-banner" data-held-banner>
          <strong>{C.heldBanner}</strong>
          <ul>
            {active.held.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      {active?.missing && (
        <div role="status" className="deck-held-banner" data-missing-banner>
          <strong>{C.missingBanner}</strong>
        </div>
      )}
      <div className="deck-editor-body">
        {boardsOpen && (
          <BoardList
            session={session}
            boards={boards}
            current={active?.id ?? null}
            frame={viewState.frame}
            readOnly={readOnly}
            onSelect={(boardId) => {
              selectBoard(boardId);
              if (compact) setBoardsOpen(false); // the panel's sheet over the world: picked, it gets out of the way
            }}
            onZoomTo={zoomTo}
            onAdd={addBoard}
            onDuplicate={duplicate}
            onRemove={remove}
            onRename={rename}
          />
        )}
        {boards.length === 0 ? (
          <div className="design-world design-world-empty">
            <p className="deck-quiet">{C.noBoards}</p>
          </div>
        ) : (
          <World
            session={session}
            view={view}
            boards={boards}
            active={active}
            canvases={canvases}
            onCanvas={onCanvas}
            assetUrl={assetUrl}
            faces={liveFaces.aliases}
            scope={scope}
            readOnly={readOnly}
            onNotice={setNotice}
            artifactId={artifactId}
            importAsset={importAsset}
            surface={surface}
            fitAll={fitAll}
            fitSelection={fitSelection}
            removeBoard={remove}
            duplicateBoard={duplicate}
          />
        )}
        {state.rail === 'theme' && scope(<ThemePanel session={session} system={system} theme={theme} overrides={overrides} faces={deckFaces} readOnly={readOnly} />)}
        {inspectorOpen && active && (
          <div className="design-inspector" data-design-rail="inspector" data-board-context={!elementsSelected || undefined}>
            {!elementsSelected && <BoardInspector session={session} board={active} readOnly={readOnly} />}
            {scope(<Inspector session={session} slideId={active.id} readOnly={!editable} faces={deckFaces} uploadAsset={uploadAsset} measure={(id) => measureInHost(activeCanvas, id, zoom)} />)}
          </div>
        )}
      </div>
    </div>
  );
}

/** Zoom out, the zoom (with Fit all and Fit selection), zoom in: C's toolbar's controls over the tab's view. */
function ZoomControls({ view, zoom, onFitAll, onFitSelection }: { view: DesignView; zoom: number; onFitAll: () => void; onFitSelection: () => void }) {
  return (
    <>
      <button type="button" className="deck-button" aria-label={C.zoomOut} title={`${C.zoomOut} (⌘−)`} disabled={zoom <= ZOOM_MIN + 1e-6} onClick={() => view.step(-1)}>
        −
      </button>
      <select
        className="deck-zoom"
        aria-label={C.zoom}
        value="current"
        onChange={(event) => {
          const v = event.target.value;
          if (v === 'fit-all') onFitAll();
          else if (v === 'fit-selection') onFitSelection();
          else if (v !== 'current') view.setZoom(Number(v));
        }}
      >
        <option value="current" hidden>
          {C.percent(zoom)}
        </option>
        <option value="fit-all">{`${C.fitAll} (⇧1)`}</option>
        <option value="fit-selection">{`${C.fitSelection} (⇧2)`}</option>
        {ZOOM_STEPS.map((s) => (
          <option key={s} value={String(s)}>
            {C.percent(s)}
          </option>
        ))}
      </select>
      <button type="button" className="deck-button" aria-label={C.zoomIn} title={`${C.zoomIn} (⌘=)`} disabled={zoom >= ZOOM_MAX - 1e-6} onClick={() => view.step(1)}>
        +
      </button>
    </>
  );
}
