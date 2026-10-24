// P3-E1 M3 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M3; the parent's §1 "The workbench", Decision
// Log 20): the design's editor over one replica, shared by the panel's record view and the `artifact` main tab (the
// shell, src/renderer/src/tools/design/). The world dominates (World.tsx: every board mounted, pan and zoom, frames);
// the board list is the rail's navigation (BoardList.tsx); the inspector is contextual (an element's: C's; else the
// board's geometry above C's for the board's own fill). C's element engine is reused, not copied: the deck session (the
// active board, the selection, the one undo stack, awaited edits, the composition hold), the overlay, the text box,
// the element bar, the text style menu, the inspector and the Theme panel. The boards draw in the governing design
// system's `document` medium (a board is a screen, not a slide: E0 (f)) with the deck root's overrides last, and with the
// design's screen type defaults (board-css.ts). The chrome reads the app's tokens and C's classes; under 720 px of
// width the rails lie over the world rather than squeezing it (C's narrow-panel pattern). Export (M5) joins this tree
// later; the tab owns the view (`DesignView`), so the header's Zoom to fit and a remount keep their place.
// M4: comments on boards and elements (comments.tsx over C's controller, rail and pins, P2's card through B's surface),
// "Move to board…" in the inspector (MoveToBoard.tsx, the one cross-board move), and version history (history.tsx: C's
// controller and B's rail, the design's projection, bar and read-only world in place of the live one while a version
// shows; the pill and the restore banner as C's).
// P4-B4: a place asked from outside (a link's `#slide=` naming a board, `#v<id>`) through C's `useDeckReveal`: the board
// selected and brought into view, as a shown thread's is; a version previewed in the history rail.
// P4-B2 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D14; tracker row 253): F6 and ⇧F6 cycle the
// workbench's regions (C's a11y.ts), keeping the selection.
// P4-A2 G2.4 (X35; G-R6 of docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md): an agent's publish drawn as it
// streams, from the tab's provisional layers, in the live world (World.tsx, ./provisional.tsx).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { DesignSystemScope, useDesignSystem, type DesignSystemRef } from '../../design-system/apply';
import type { CommentAuthor, DocumentComments } from '../../document/editor/comments/surface';
import { onUpdate, type Doc } from '../../yjs';
import type { AssetUrl, SlideCanvas } from '../../slides/canvas';
import { insertElements, type NewKind } from '../../slides/writers-elements';
import { mintSlideId } from '../../slides/writers';
import { DECK_COPY } from '../../slides/editor/copy';
import { ElementBar } from '../../slides/editor/ElementBar';
import { DeckCommentsProvider } from '../../slides/editor/comments/controller';
import { CommentsRail } from '../../slides/editor/comments/CommentsRail';
import { DeckHistoryRail } from '../../slides/editor/history/DeckHistoryRail';
import type { VersionExports } from '../../document/editor/history/HistoryRail';
import { HISTORY_COPY } from '../../slides/editor/history/copy';
import { aliasOverrides, previewFaces } from '../../slides/editor/history/faces';
import { historyAssets } from '../../slides/editor/history/HistoryPreview';
import { useDeckHistoryController, useDeckHistorySnapshot, type DeckHistorySource } from '../../slides/editor/history/use-deck-history';
import { Inspector } from '../../slides/editor/Inspector';
import { TextStyleMenu } from '../../slides/editor/menus/TextStyle';
import { ThemePanel, type DeckThemeChoice } from '../../slides/editor/menus/Theme';
import { useCanvasCss, useDeckFaces } from '../../slides/editor/page-styles';
import { useDeckReveal, type DeckRevealProps } from '../../slides/editor/reveal'; // P4-B4
import { BOARD_REGIONS, RegionRing, regionKey } from '../../slides/editor/a11y';
import type { DeckSession } from '../../slides/editor/session';
import type { ImportAsset } from '../../slides/editor/transform/clipboard';
import { measureInHost } from '../../slides/editor/transform/Overlay';
import { measure } from '../../slides/editor/transform/measure';
import { BOARD_CSS } from '../board-css';
import { designChanges } from '../history';
import { placementAfter, writeBoardEntry } from '../model';
import { BoardError, deleteBoard, duplicateBoard, insertBoard } from '../writers';
import { BoardInspector } from './BoardInspector';
import { BoardList } from './BoardList';
import { boardLabel, keepEqualBoards, readBoards, type BoardView, type DesignBoards } from './boards';
import { DESIGN_COPY as C, type BoardPreset } from './copy';
import { DesignCommentButtons, DesignCommentFrame, designRailLabels, useDesignComments } from './comments';
import { DesignHistoryBar, HistoryBoardList, historyBoards, HistoryWorld, useDesignFocus } from './history';
import { boardElement } from './insert';
import { MoveToBoard } from './MoveToBoard';
import { BOARD_FIT_MAX, DesignView, unionRect, ZOOM_MAX, ZOOM_MIN, ZOOM_STEPS, type Rect } from './viewport';
import { useViewFrame, useViewZoom, WithZoom } from './use-view';
import { World } from './World';
import { useEditClaim, type RegisterEditClaimant } from '../../slides/editor/edit-claim'; // P4-B2 K6
import type { ProvisionalLayers } from '../../provisional';
import { useDeckProvisional } from '../../slides/editor/provisional';
import { DESIGN_FILES } from './provisional';
import '../../slides/editor/chrome.css';
import '../../slides/editor/deck.css';
import './workbench.css';

export interface DesignWorkbenchProps extends DeckRevealProps /* P4-B4 */ {
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
  /** M6: the live world's canvases by board, whenever they change (none once unmounted): the tab keeps them for the scale gate's re-layout measure. */
  onCanvases?: (canvases: ReadonlyMap<string, SlideCanvas>) => void;
  /** M4: where a comment goes (P2's card, B's surface); without one, commenting is not offered. */
  comments?: DocumentComments;
  /** M4: who writes the editor's thread changes (the owner by default). */
  commentAuthor?: CommentAuthor;
  /** M4: the design's version history (B's api through the design model, the replica, the projection's count). */
  history?: DeckHistorySource;
  versionExports?: VersionExports;
  /** M4: a session's title for the history's author chips. */
  sessionTitle?: (appSessionId: string) => string | undefined;
  /** M4: an asset's URL at a revision (a version's), for a preview drawn with the version's assets. */
  assetUrlAt?: (ref: string, revision: number) => string | null;
  /** P4-B2 K6: the host's registration of the Edit menu's Undo and Redo claimant; without it the menu stays native. */
  registerEditClaimant?: RegisterEditClaimant;
  /** P4-B2 (D14): whether the owner's keymap binds a key (the shell's): the workbench's own F6 then steps aside. */
  bindsKey?: (event: KeyboardEvent) => boolean;
  /** P4-A2 G2.4 (X35): the replica's provisional layers (the tab's, one per handle); without them, none are drawn. */
  provisional?: ProvisionalLayers | null;
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

export function DesignWorkbench(props: DesignWorkbenchProps) {
  const { session, view, assetUrl, system, readOnly, compact = false, uploadAsset, artifactId, importAsset, theme, onStage, onDrawn, onCanvases, comments, commentAuthor, history: historySource, versionExports, sessionTitle, assetUrlAt, bindsKey, provisional = null } = props;
  useCanvasCss();
  useBoardCss();
  const doc = session.doc;
  const written = useDeckProvisional(provisional, doc, DESIGN_FILES); // P4-A2 G2.4
  const { boards, overrides, faces: deckFaces } = useBoards(doc);
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  // M6: the frame selection alone; the zoom is read where it is drawn (WithZoom), and a pan re-renders none of this
  const selectedFrame = useViewFrame(view);
  const order = useMemo(() => boards.map((b) => b.id), [boards]);

  // the active board follows the design: one deleted (here or elsewhere) gives way to its neighbour
  const shownOrder = useRef<readonly string[]>(order);
  useEffect(() => {
    session.reconcile(order, shownOrder.current);
    shownOrder.current = order;
  }, [session, order]);
  const active = boards.find((b) => b.id === state.currentSlide) ?? boards[0] ?? null; // C's: until the session reconciles

  // M4: the history controller (one per replica), its preview, and what the live editor tells it (C's lifecycle)
  const history = useDeckHistoryController(historySource);
  const historySnapshot = useDeckHistorySnapshot(history);
  const preview = historySnapshot?.preview ?? null;
  // the previous preview's canvases released (this effect runs after their cleanups), its docs may go
  useEffect(() => history?.applied(preview?.shown ?? null), [history, preview?.shown]);
  const historyOpen = state.rail === 'history';
  const previewing = preview !== null || historySnapshot?.loading === true;
  useEffect(() => {
    if (!historyOpen && previewing) history?.close(); // the rail closed: back to the live design
  }, [historyOpen, previewing, history]);
  useEffect(() => () => view.showVersion(null), [view]); // M5: unmounted, the controller drops its preview: the live design

  // no write lands while the replica is read-only (an awaited upload finishing after it turned so), nor behind a version
  const holdWrites = previewing || readOnly;
  useLayoutEffect(() => {
    session.holdWrites(holdWrites);
    return () => session.holdWrites(false);
  }, [session, holdWrites]);

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
  // the inspector's element box, measured at the zoom of the moment (the inspector does not re-render on a zoom)
  const measureAtZoom = useCallback((id: string) => measureInHost(activeCanvas, id, view.snapshot().viewport?.zoom ?? 1), [activeCanvas, view]);
  useEffect(() => {
    if (!onCanvases) return;
    onCanvases(canvases);
    return () => onCanvases(new Map());
  }, [onCanvases, canvases]);

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

  // the world's surface; World tells the owner (Mark-up's) each element React attaches and detaches there, since a
  // version's preview takes the world away and Back mounts a new one
  const surface = useRef<HTMLDivElement | null>(null);

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

  // ---- M4: comments, shared by the toolbar, C's overlay pins, the board pins, the rail and the card's frame
  /** A board out of sight is brought into view (a shown thread's, a move's destination); one in view stays put. */
  const reveal = useCallback(
    (boardId: string) => {
      const frame = boards.find((b) => b.id === boardId)?.frame;
      const { viewport, room } = view.snapshot();
      if (!frame) return;
      const seen = viewport && room && viewport.x + (frame.x + frame.w) * viewport.zoom > 0 && viewport.x + frame.x * viewport.zoom < room.w && viewport.y + (frame.y + frame.h) * viewport.zoom > 0 && viewport.y + frame.y * viewport.zoom < room.h;
      if (!seen) view.fitTo(frame, BOARD_FIT_MAX);
    },
    [boards, view],
  );
  const openComments = useCallback(() => void (session.snapshot().rail !== 'comments' && session.toggleRail('comments')), [session]);
  const railLabels = useMemo(() => designRailLabels(boards), [boards]);
  const commentsApi = useDesignComments({ session, view, surface: comments, author: commentAuthor, readOnly, openRail: openComments, reveal });
  // P4-B4: a board a link names, selected and brought into view as a shown thread's board is
  const showBoard = useCallback(
    (boardId: string) => {
      session.show(boardId);
      session.select([]);
      view.selectFrame(boardId);
      reveal(boardId);
    },
    [session, view, reveal],
  );
  useDeckReveal({ reveal: props.reveal, onRevealed: props.onRevealed, session, history, showSlide: showBoard });

  // ---- M4: a version's preview: the projection, ↑ ↓ over it, its own view, its faces and assets
  // keyed by the comparison (its docs and change set), not the preview object, which Show changes and ↑ ↓ remake
  const shownDoc = preview?.shown ?? null;
  const earlierDoc = preview?.earlier ?? null;
  const previewChanges = preview?.changes ?? null;
  const previewHistory = preview?.elementHistory; // C's element history over the preview's own diff (Decision Log 30)
  const projected = useMemo(() => (shownDoc && earlierDoc && previewChanges ? designChanges({ prevDoc: earlierDoc, nextDoc: shownDoc }, previewChanges, previewHistory) : null), [shownDoc, earlierDoc, previewChanges, previewHistory]);
  const { focus, step } = useDesignFocus(projected);
  const previewBoards = useMemo(() => (preview && projected ? historyBoards(preview, projected) : []), [preview, projected]);
  const previewView = useMemo(() => {
    const seeded = new DesignView();
    const live = previewing ? view.snapshot().viewport : null;
    if (live) seeded.setViewport(live); // the preview opens where the live world was
    return seeded;
  }, [previewing, view]);
  const shownRevision = preview?.revision ?? null;
  const earlierRevision = preview?.earlierRevision ?? null;
  const previewAssets = useMemo(() => historyAssets({ revision: shownRevision, earlierRevision }, assetUrl, assetUrlAt), [shownRevision, earlierRevision, assetUrl, assetUrlAt]);
  const versionFaces = useMemo(() => (shownDoc && earlierDoc ? previewFaces({ shown: shownDoc, earlier: earlierDoc }, previewAssets) : null), [shownDoc, earlierDoc, previewAssets]);
  // the version's design system (its pin; the live one's for the live design) with the version's overrides, its faces aliased
  const previewSystem = preview ? (preview.system ?? system) : system;
  const previewOverrides = useMemo(() => (shownDoc && versionFaces ? aliasOverrides(readBoards(shownDoc).overrides, versionFaces.shown) : scopeOverrides), [shownDoc, versionFaces, scopeOverrides]);
  const previewScope = useCallback(
    (children: ReactNode) => (
      <DesignSystemScope system={previewSystem} medium="document" overrides={previewOverrides} className="deck-ds-scope">
        {children}
      </DesignSystemScope>
    ),
    [previewSystem, previewOverrides],
  );
  // M5 (the parent's Decision Log 31; fix wave): the version's own board for the header's Export, kept apart from the live
  // selection (which Back returns to): the board last navigated to in this comparison (a list row, a change reached with
  // ↑ ↓) while the version holds it, else the live selection when the version holds it, else the version's first
  const [navigated, setNavigated] = useState<{ doc: Doc; board: string } | null>(null);
  const navigate = useCallback((boardId: string) => shownDoc && setNavigated({ doc: shownDoc, board: boardId }), [shownDoc]);
  const fitPreviewBoard = useCallback(
    (boardId: string) => {
      const frame = previewBoards.find((b) => b.board.id === boardId)?.board.frame;
      if (frame) previewView.fitTo(frame, BOARD_FIT_MAX);
      navigate(boardId);
    },
    [previewBoards, previewView, navigate],
  );

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
  // M6 final review: a rename commits only while the replica takes writes and the board, as the model holds it now, is
  // drawn from its file (not held, not missing); the field may have opened before either changed
  const rename = (boardId: string, title: string) => {
    const now = readBoards(doc).boards.find((b) => b.id === boardId);
    if (readOnly || !session.writable() || !now || now.held !== null || now.missing) return false;
    return tryEdit(() => writeBoardEntry(doc, boardId, { title: title || undefined })); // inside the edit's transaction
  };

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

  const [regions] = useState(() => new RegionRing(BOARD_REGIONS)); // P4-B2 (D14)
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (regionKey(event, regions, session, bindsKey)) return; // P4-B2 (D14): F6 and ⇧F6
    const mod = event.metaKey || event.ctrlKey;
    if (!mod || readOnly || preview) return; // M4: no undo in history (the live design is not shown)
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
  const root = useRef<HTMLDivElement | null>(null); // P4-B2 K6: the Edit menu's Undo and Redo, under onKeyDown's conditions
  useEditClaim(props.registerEditClaimant, root, session, readOnly || preview !== null); // P4-B2 K6

  const elementsSelected = state.selection.length > 0;
  const faces = versionFaces ? versionFaces.css : liveFaces.css;
  const focusStop = focus.index === null ? null : (focus.stops[focus.index] ?? null);
  const focusBoard = focusStop && focusStop.part !== 'deck' ? focusStop.boardId : null;
  useEffect(() => void (focusBoard && navigate(focusBoard)), [focusBoard, navigate]);
  const shownBoards = useMemo(() => (shownDoc ? readBoards(shownDoc).boards : []), [shownDoc]);
  const inShown = (id: string | null | undefined) => (id ? (shownBoards.find((b) => b.id === id) ?? null) : null);
  const exportBoard = inShown(navigated?.doc === shownDoc ? navigated.board : null) ?? inShown(selectedFrame ?? state.currentSlide) ?? shownBoards[0] ?? null;
  // the tab's view says what the history shows, so the header's Export (which outlives this body) exports it: the one
  // version previewed with its board, nothing while two are compared, else the live design
  const target = preview?.target ?? null;
  const shownKind = target?.kind ?? null;
  const shownId = target?.kind === 'version' ? target.versionId : null;
  const exportBoardId = exportBoard?.id ?? null;
  const exportLabel = exportBoard ? boardLabel(exportBoard) : null;
  useEffect(() => view.showVersion(shownKind === 'version' && shownId !== null ? { versionId: shownId, board: exportBoardId, label: exportLabel } : shownKind === 'compare' ? 'compare' : null), [view, shownKind, shownId, exportBoardId, exportLabel]);
  const historyRail = history && historySnapshot && historyOpen && <DeckHistoryRail controller={history} snapshot={historySnapshot} versionExports={versionExports} sessionTitle={sessionTitle} onClose={() => session.toggleRail('history')} />;
  const onMoved = (to: BoardView, ids: string[]) => {
    session.show(to.id);
    session.select(ids);
    reveal(to.id);
    setNotice(C.movedTo(boardLabel(to)));
  };
  const editor = (
    <div ref={root /* P4-B2 K6 */} className="deck-editor design-workbench" data-design-editor data-compact={compact || undefined} data-history-previewing={preview ? '' : undefined} onKeyDown={onKeyDown} onFocus={(event) => regions.note(event.currentTarget, event.target)}>
      {faces && <style data-deck-faces>{faces}</style>}
      {!preview && historySnapshot?.banner && (
        <div className="deck-history-banner" role="status" aria-label={HISTORY_COPY.restoredBanner}>
          <span>{historySnapshot.banner}</span>
          <button type="button" className="deck-button" onClick={() => history?.dismissBanner()}>
            {HISTORY_COPY.dismiss}
          </button>
        </div>
      )}
      {preview && projected && history ? (
        <DesignHistoryBar preview={preview} controller={history} count={projected.count} onStep={step} onBack={() => history.close()} />
      ) : (
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
        <WithZoom view={view}>
          {(zoom) => (
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
            >
              <TextStyleMenu session={session} slideId={active?.id ?? null} tokens={tokens} readOnly={!editable} onNotice={setNotice} />
            </ElementBar>
          )}
        </WithZoom>
        <DesignCommentButtons api={commentsApi} view={view} railOpen={state.rail === 'comments'} onToggleRail={() => session.toggleRail('comments')} />
        <span role="status" className="deck-notice" data-deck-notice>
          {notice}
        </span>
        <span className="deck-toolbar-spacer" />
        <ZoomControls view={view} onFitAll={fitAll} onFitSelection={fitSelection} />
      </div>
      )}
      {!preview && active?.held && (
        <div role="status" className="deck-held-banner" data-held-banner>
          <strong>{C.heldBanner}</strong>
          <ul>
            {active.held.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      {!preview && active?.missing && (
        <div role="status" className="deck-held-banner" data-missing-banner>
          <strong>{C.missingBanner}</strong>
        </div>
      )}
      {/* one tree in both modes, so B's rail keeps its place (and its open folds) while a version shows */}
      <div className="deck-editor-body">
        {preview && projected && history ? (
          <>
            {boardsOpen && <HistoryBoardList controller={history} boards={previewBoards} showChanges={preview.showChanges} onFit={fitPreviewBoard} current={exportBoardId} />}
            <HistoryWorld controller={history} preview={preview} projected={projected} boards={previewBoards} focus={focusStop} view={previewView} assets={previewAssets} faces={versionFaces!} scope={previewScope} />
          </>
        ) : (
          <>
        {boardsOpen && (
          <BoardList
            session={session}
            boards={boards}
            current={active?.id ?? null}
            frame={selectedFrame}
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
        {historySnapshot?.pill && (
          <div className="deck-history-pill" data-markup-occluder>
            <button
              type="button"
              className="deck-button"
              onClick={() => {
                if (!historyOpen) session.toggleRail('history');
                void history?.openNewChanges();
              }}
            >
              {HISTORY_COPY.pill(historySnapshot.pill.count)}
            </button>
            {historySnapshot.pill.failed !== null && (
              <button type="button" className="deck-button" aria-label={HISTORY_COPY.pillRetry} title={historySnapshot.pill.failed} onClick={() => void history?.recount()}>
                ↻
              </button>
            )}
            <button type="button" className="deck-button" aria-label={HISTORY_COPY.pillDismiss} onClick={() => history?.dismissPill()}>
              ×
            </button>
          </div>
        )}
        {boards.length === 0 ? (
          <div className="design-world design-world-empty">
            <p className="deck-quiet">{C.noBoards}</p>
          </div>
        ) : (
          <DesignCommentFrame api={commentsApi} activeId={active?.id ?? null} surface={comments} view={view} boards={boards} canvases={canvases}>
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
            onSurface={onStage}
            fitAll={fitAll}
            fitSelection={fitSelection}
            removeBoard={remove}
            duplicateBoard={duplicate}
            provisional={written}
          />
          </DesignCommentFrame>
        )}
        {state.rail === 'theme' && scope(<ThemePanel session={session} system={system} theme={theme} overrides={overrides} faces={deckFaces} readOnly={readOnly} />)}
        {state.rail === 'comments' && <CommentsRail api={commentsApi} labels={railLabels} onClose={() => session.toggleRail('comments')} />}
        {inspectorOpen && active && (
          <div className="design-inspector" data-design-rail="inspector" data-board-context={!elementsSelected || undefined}>
            {!elementsSelected && <BoardInspector session={session} board={active} readOnly={readOnly} />}
            {elementsSelected && <WithZoom view={view}>{(zoom) => <MoveToBoard session={session} boards={boards} active={active} selection={state.selection} canvas={activeCanvas} zoom={zoom} readOnly={!editable} onMoved={onMoved} onNotice={setNotice} />}</WithZoom>}
            {scope(<Inspector session={session} slideId={active.id} readOnly={!editable} faces={deckFaces} uploadAsset={uploadAsset} measure={measureAtZoom} canvas={activeCanvas} />)}
          </div>
        )}
          </>
        )}
        {historyRail}
      </div>
    </div>
  );
  return <DeckCommentsProvider value={commentsApi}>{editor}</DeckCommentsProvider>;
}

/** Zoom out, the zoom (with Fit all and Fit selection), zoom in: C's toolbar's controls over the tab's view. */
function ZoomControls({ view, onFitAll, onFitSelection }: { view: DesignView; onFitAll: () => void; onFitSelection: () => void }) {
  const zoom = useViewZoom(view); // M6: these controls alone re-render on a zoom
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
