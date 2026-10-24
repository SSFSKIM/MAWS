// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8, D10's first part; M4): the deck editor over one
// replica: the toolbar (undo and redo, zoom by fit and steps), the filmstrip, the stage and the speaker notes. The
// slides draw in the deck's governing design system (`DesignSystemScope`, medium deck, the deck's `dsOverrides` last),
// so a token change or a system switch restyles every slide by reference; the editor's chrome reads the app's tokens.
// Shared by the panel's record view and the `artifact` main tab (the shell, src/renderer/src/tools/presentation/).
// M5: the transform layer on the stage, the toolbar's Insert and arrange controls, the inspector beside the stage.
// M6: the Text style menu in the toolbar, New slide from layout in the filmstrip, and the panels the header's Theme and
// Check open beside the stage (menus/).
// M7: comments on elements (comments/): the toolbar's Comment and Comments, the threads rail beside the stage, the pins
// on the overlay, and the frame P2's card is drawn over, through the shell's surface (B's `DocumentComments`).
// M8: version history (history/): B's rail on the session's rail, the preview in place of the editor while a version
// shows (its bar for the toolbar, the version's slides read-only with their changes), "See N new changes", the restore
// banner, and Show editors on a right-click over the selected element.
// P4-B4: a place asked from outside (a link's `#slide=` and `#v<id>`, `show_pane`'s `at`) through `useDeckReveal`.
// P4-B2 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D14; tracker row 253): F6 and ⇧F6 cycle the editor's
// regions (a11y.ts), keeping the selection, so a middle element's selection reaches the inspector by keyboard.
// P4-A2 G2.3 (X35; G-R3 to G-R5 of docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md): an agent's publish drawn
// as it streams, from the tab's provisional layers: on the shown slide beneath the human's states, and in the filmstrip.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { DesignSystemScope, useDesignSystem, type DesignSystemRef } from '../../design-system/apply';
import type { AssetUrl, SlideCanvas } from '../canvas';
import { DECK_LIMITS } from '../deck';
import { insertElements, newElement, type NewKind } from '../writers-elements';
import { DECK_COPY as C } from './copy';
import { ElementBar } from './ElementBar';
import type { ImportAsset } from './transform/clipboard';
import { Inspector } from './Inspector';
import { measureInHost } from './transform/Overlay';
import { useDeckView } from './deck-view';
import { useCanvasCss, useDeckFaces } from './page-styles';
import { Filmstrip } from './Filmstrip';
import type { CommentAuthor, DocumentComments } from '../../document/editor/comments/surface';
import { CommentButtons } from './comments/CommentButtons';
import { CommentFrame } from './comments/CommentFrame';
import { CommentsRail } from './comments/CommentsRail';
import { ShowEditorsMenu } from '../../document/editor/history/ShowEditors';
import type { ShownEditor } from '../../document/editor/history/controller';
import { DeckHistoryRail } from './history/DeckHistoryRail';
import type { VersionExports } from '../../document/editor/history/HistoryRail';
import { HistoryBar } from './history/HistoryBar';
import { aliasOverrides, previewFaces } from './history/faces';
import { historyAssets, HistoryPreview } from './history/HistoryPreview';
import { HISTORY_COPY } from './history/copy';
import { useDeckHistoryController, useDeckHistorySnapshot, type DeckHistorySource } from './history/use-deck-history';
import { DeckCommentsProvider, useDeckComments } from './comments/controller';
import { CheckPanel } from './menus/Check';
import { insertLayoutSlide, LayoutsMenu } from './menus/Layouts';
import { TextStyleMenu } from './menus/TextStyle';
import { ThemePanel, type DeckThemeChoice } from './menus/Theme';
import { Notes } from './Notes';
import { ZOOM_STEPS, type DeckSession, type Zoom } from './session';
import { SLIDE_H, SLIDE_W } from './SlideView';
import { Stage } from './Stage';
import { useDeckReveal, type DeckRevealProps } from './reveal'; // P4-B4
import { useEditClaim, type RegisterEditClaimant } from './edit-claim'; // P4-B2 K6
import { DECK_REGIONS, RegionRing, regionKey } from './a11y';
import type { ProvisionalLayers } from '../../provisional';
import { useDeckProvisional } from './provisional';
import './chrome.css';
import './deck.css';

export interface DeckEditorProps extends DeckRevealProps /* P4-B4: a place asked from outside (a slide, a version) */ {
  session: DeckSession;
  assetUrl: AssetUrl;
  /** The deck's governing design system (D's chain); null draws the slides' own fallbacks. */
  system: DesignSystemRef | { builtin: 'maws' } | null;
  readOnly: boolean;
  /** The panel's narrow body: a narrower filmstrip. */
  compact?: boolean;
  /** The portable toolbar slot where the shell can mount saved state and document/host actions. */
  onToolbarHost?: (element: HTMLDivElement | null) => void;
  /** The stage's slide frame, for Mark-up's surface. */
  onStage?: (element: HTMLElement | null) => void;
  /** Once, when the first slide is drawn on the stage. */
  onDrawn?: () => void;
  /** Once, when every thumbnail of the first showing is drawn too (how many). */
  onThumbnailsDrawn?: (thumbnails: number) => void;
  /** M5: uploads a picked image into the artifact and answers its `assets/<name>` ref (Insert's image, the inspector's Replace). */
  uploadAsset?: (file: File) => Promise<string>;
  /** Fix wave 1: the deck's artifact (named on copies) and how a paste brings another deck's pictures over. */
  artifactId?: string;
  importAsset?: ImportAsset;
  /** M6: the Theme panel's design systems and how the deck names one (the shell's: the artifact's `designSystemId`). */
  theme?: DeckThemeChoice;
  /** M7: where a comment goes (P2's card, B's surface); without one, commenting is not offered. */
  comments?: DocumentComments;
  /** M7: who writes the editor's thread changes (the owner by default). */
  commentAuthor?: CommentAuthor;
  /** M8: the deck's version history (B's api on A's IPC, the replica); without it, no history. */
  history?: DeckHistorySource;
  versionExports?: VersionExports;
  /** M8: a session's title for the history's author chips. */
  sessionTitle?: (appSessionId: string) => string | undefined;
  /** M8 fix wave 1 (R2): an asset's URL at a revision (a version's), for a preview drawn with the version's assets. */
  assetUrlAt?: (ref: string, revision: number) => string | null;
  /** M8: once a version's preview has drawn its slide and its marks: ms since it was asked for (the e2e seam's). */
  onPreviewDrawn?: (ms: number) => void;
  /** P4-B2 K6: the host's registration of the Edit menu's Undo and Redo claimant; without it the menu stays native. */
  registerEditClaimant?: RegisterEditClaimant;
  /** P4-B2 (D14): whether the owner's keymap binds a key (the shell's): the editor's own F6 then steps aside. */
  bindsKey?: (event: KeyboardEvent) => boolean;
  /** P4-A2 G2.3 (X35): the replica's provisional layers (the tab's, one per handle); without them, none are drawn. */
  provisional?: ProvisionalLayers | null;
}

const NOTICE_MS = 6_000;
const TEXT_KINDS: readonly NewKind[] = ['text', 'heading', 'bullets', 'numbers'];

const STAGE_GUTTER = 48; // px of app chrome around the fitted slide

export function DeckEditor({ session, assetUrl, system, readOnly, compact = false, onToolbarHost, onStage, onDrawn, onThumbnailsDrawn, uploadAsset, artifactId, importAsset, theme, comments, commentAuthor, history: historySource, versionExports, sessionTitle, assetUrlAt, onPreviewDrawn, reveal, onRevealed, registerEditClaimant /* P4-B2 K6 */, bindsKey, provisional = null }: DeckEditorProps) {
  useCanvasCss();
  const doc = session.doc;
  const view = useDeckView(doc);
  const written = useDeckProvisional(provisional, doc); // P4-A2 G2.3
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const order = useMemo(() => view.slides.map((s) => s.id), [view.slides]);

  // the slide shown follows the deck: one deleted (here or elsewhere) gives way to its neighbour
  const shownOrder = useRef<readonly string[]>(order);
  useEffect(() => {
    session.reconcile(order, shownOrder.current);
    shownOrder.current = order;
  }, [session, order]);
  const slide = view.slides.find((s) => s.id === state.currentSlide) ?? view.slides[0] ?? null;

  // the fit zoom from the stage's own size, observed on the stage's node as it is now: the stage is made anew when a
  // version's preview gives the editor back, and an observer left on the old node, taken out of the document, read 0 × 0
  // (Fit at its 5 % floor) and never again (W1, tracker 2026-10-19). A 0 × 0 reading (a detached or hidden stage) keeps
  // the last size, so Fit draws at the last known scale; a quarter until a size is known.
  const viewport = useRef<HTMLDivElement>(null);
  const observed = useRef<{ node: HTMLDivElement; observer: ResizeObserver } | null>(null);
  const [room, setRoom] = useState<{ w: number; h: number } | null>(null);
  const readRoom = useCallback((next: { w: number; h: number }) => setRoom((now) => now?.w === next.w && now.h === next.h ? now : next), []);
  useLayoutEffect(() => {
    const node = viewport.current;
    if (observed.current?.node === node) return;
    observed.current?.observer.disconnect();
    observed.current = null;
    if (!node) return;
    const measure = () => {
      const [w, h] = [node.clientWidth, node.clientHeight];
      if (w > 0 && h > 0) setRoom((now) => (now?.w === w && now.h === h ? now : { w, h }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observed.current = { node, observer };
  });
  useEffect(
    () => () => {
      observed.current?.observer.disconnect();
      observed.current = null;
    },
    [],
  );
  // The tools float in one stack, not independent columns. Measure that stack rather than adding each card's width;
  // Fit and the stage's centering share the exact space it leaves. In a small stage the stack is a sheet instead.
  const cards = useRef<HTMLDivElement>(null);
  const [cardWidth, setCardWidth] = useState(0);
  useLayoutEffect(() => {
    const node = cards.current;
    if (!node) {
      setCardWidth(0);
      return;
    }
    const read = () => setCardWidth(node.clientWidth);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  });
  const cardReserve = room && cardWidth > 0 && room.w - cardWidth - 16 >= 520 ? cardWidth + 16 : 0;
  const fit = room ? Math.max(0.05, Math.min((room.w - cardReserve - STAGE_GUTTER) / SLIDE_W, (room.h - STAGE_GUTTER) / SLIDE_H)) : 0.25;
  const scale = state.zoom === 'fit' ? fit : state.zoom;

  // the first slide drawn: once per showing
  const drawn = useRef(false);
  const [stageCanvas, setStageCanvas] = useState<SlideCanvas | null>(null);
  const onStageCanvas = useCallback(
    (canvas: SlideCanvas | null) => {
      setStageCanvas(canvas);
      if (!canvas || drawn.current) return;
      void canvas.whenLaidOut().then(() => {
        if (drawn.current) return;
        drawn.current = true;
        onDrawn?.();
      });
    },
    [onDrawn],
  );
  const frame = useCallback((element: HTMLDivElement | null) => onStage?.(element), [onStage]);

  // B6: the deck's uploaded faces under private names of its own (another deck in this window may upload a family of
  // the same name), its canvases and its font tokens' overrides drawing them by those names
  const liveFaces = useDeckFaces(view.faces, assetUrl);
  const scopeOverrides = useMemo(() => aliasOverrides(view.overrides, liveFaces.aliases), [view.overrides, liveFaces.aliases]);
  const scope = (children: ReactNode) => (
    <DesignSystemScope system={system} medium="deck" overrides={scopeOverrides} className="deck-ds-scope">
      {children}
    </DesignSystemScope>
  );

  // M8: the history controller (one per replica), its preview, and what the live editor tells it
  const history = useDeckHistoryController(historySource);
  const historySnapshot = useDeckHistorySnapshot(history);
  const preview = historySnapshot?.preview ?? null;
  const slideShown = slide?.id ?? null;
  useEffect(() => history?.setLiveSlide(slideShown), [history, slideShown]);
  useEffect(() => history?.applied(preview?.shown ?? null), [history, preview?.shown]);
  // P3-F (L233): the session says what the history shows, so the header's Export exports it: the one version previewed,
  // nothing while two are compared, else the live deck (as the design's workbench tells its view)
  const previewTarget = preview?.target ?? null;
  const shownKind = previewTarget?.kind ?? null;
  const shownId = previewTarget?.kind === 'version' ? previewTarget.versionId : null;
  useEffect(() => session.showVersion(shownId !== null ? { versionId: shownId } : shownKind === 'compare' ? 'compare' : null), [session, shownKind, shownId]);
  useEffect(() => () => session.showVersion(null), [session]); // unmounted, the controller drops its preview: the live deck
  const historyOpen = state.rail === 'history';
  const previewing = preview !== null || historySnapshot?.loading === true;
  // final fix wave (B4): an awaited edit (an upload, an asset copy) finishing while a version shows, or once the deck
  // turned read-only, writes nothing
  const holdWrites = previewing || readOnly;
  useLayoutEffect(() => {
    session.holdWrites(holdWrites);
    return () => session.holdWrites(false);
  }, [session, holdWrites]);
  useEffect(() => {
    if (!historyOpen && previewing) history?.close(); // the rail closed: back to the live deck
  }, [historyOpen, previewing, history]);
  const showEditors = useShowEditors(history, session, slideShown);
  const showSlide = useCallback((slideId: string) => session.show(slideId), [session]); // P4-B4
  useDeckReveal({ reveal, onRevealed, session, history, showSlide });
  const requestedAt = preview?.requestedAt ?? 0;
  const previewDrawn = useCallback(() => onPreviewDrawn?.(performance.now() - requestedAt), [onPreviewDrawn, requestedAt]);

  const [regions] = useState(() => new RegionRing(DECK_REGIONS)); // P4-B2 (D14)
  const root = useRef<HTMLDivElement | null>(null); // P4-B2 K6: the Edit menu's Undo and Redo, under onKeyDown's conditions
  const regionEvents = useRef(new WeakSet<KeyboardEvent>());
  const routeRegionKey = useCallback((event: ReactKeyboardEvent<HTMLDivElement> | KeyboardEvent) => {
    const node = root.current;
    if (!node) return false;
    const native = 'nativeEvent' in event ? event.nativeEvent : event;
    if (native.defaultPrevented || regionEvents.current.has(native)) return false;
    regionEvents.current.add(native);
    return regionKey(event, regions, session, bindsKey, node);
  }, [regions, session, bindsKey]);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (routeRegionKey(event)) return;
    const mod = event.metaKey || event.ctrlKey;
    if (!mod || readOnly || preview) return; // M8: no undo in history (the live deck is not shown)
    const target = event.target as HTMLElement;
    if (event.defaultPrevented || target.isContentEditable) return; // the text box routes its own (M5)
    // a field keeps its own undo (P3-F: a textarea too, a reply's or a version's note), but the notes' typing is the deck's
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || (target.tagName === 'TEXTAREA' && !target.classList.contains('deck-notes-field'))) return;
    if (event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) session.redoStep();
      else session.undoStep();
    } else if (event.key.toLowerCase() === 'y') {
      event.preventDefault();
      session.redoStep();
    }
  };
  const [below, setBelow] = useState(compact);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const read = () => { if (node.clientWidth > 0) setBelow(node.clientWidth < 1100); };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const thumbnailWidth = below ? 112 : 96;

  // React ownership reaches editor menus portalled under body; DOM ownership reaches host controls portalled into the
  // toolbar from a different React tree. One native event takes only one route, after nested handlers can consume it.
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const focus = (event: FocusEvent) => regions.note(node, event.target);
    const key = (event: KeyboardEvent) => {
      // Document bubbling follows React's delegated handlers, so nested controls can consume the key first.
      if (event.target instanceof Node && node.contains(event.target)) routeRegionKey(event);
    };
    node.addEventListener('focusin', focus);
    node.ownerDocument.addEventListener('keydown', key);
    return () => {
      node.removeEventListener('focusin', focus);
      node.ownerDocument.removeEventListener('keydown', key);
    };
  }, [regions, routeRegionKey]);

  useEditClaim(registerEditClaimant, root, session, readOnly || preview !== null); // P4-B2 K6

  // M5: what the slide's limits refused, an upload in progress: shown in the toolbar for a while
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const editable = !readOnly && slide !== null && slide.held === null;
  const insert = useCallback(
    (kind: NewKind) => {
      if (!editable || !slide) return;
      let ids: string[] = [];
      try {
        session.edit((origin) => (ids = insertElements(doc, slide.id, [newElement(kind, { x: SLIDE_W / 2, y: SLIDE_H / 2 })], {}, origin)));
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
        return;
      }
      viewport.current?.focus({ preventScroll: true });
      if (TEXT_KINDS.includes(kind)) session.editText(ids[0]!);
      else session.select(ids);
    },
    [editable, slide, session, doc],
  );

  const tokens = useDesignSystem(system).view?.tokens ?? null; // M6: the Text style menu's role faces
  // M7: the comments' controller, shared by the toolbar, the overlay's pins, the rail and the card's frame
  const openComments = useCallback(() => void (session.snapshot().rail !== 'comments' && session.toggleRail('comments')), [session]);
  const commentsApi = useDeckComments({ session, surface: comments, author: commentAuthor, readOnly, openRail: openComments });

  // M8 fix wave 1 (R2): while a version shows, its own faces at its own assets, never the live deck's mapping
  // (kept across ↑ ↓ and slide changes, so the preview's canvases are not made anew: keyed by the two revisions)
  const shownRevision = preview?.revision ?? null;
  const earlierRevision = preview?.earlierRevision ?? null;
  const previewAssets = useMemo(() => historyAssets({ revision: shownRevision, earlierRevision }, assetUrl, assetUrlAt), [shownRevision, earlierRevision, assetUrl, assetUrlAt]);
  // fix wave 2: under private names per state, so a live editor of this deck elsewhere in the window keeps its own
  const shownDoc = preview?.shown ?? null;
  const earlierDoc = preview?.earlier ?? null;
  const versionFaces = useMemo(() => (shownDoc && earlierDoc ? previewFaces({ shown: shownDoc, earlier: earlierDoc }, previewAssets) : null), [shownDoc, earlierDoc, previewAssets]);
  const faces = versionFaces ? versionFaces.css : liveFaces.css;
  const historyRail = history && historySnapshot && historyOpen && <DeckHistoryRail controller={history} snapshot={historySnapshot} versionExports={versionExports} sessionTitle={sessionTitle} onClose={() => session.toggleRail('history')} />;
  // one tree in both modes, so B's rail keeps its place (and its open folds) while a version shows
  const live = (
    <>
          {scope(
            <Filmstrip
              session={session}
              view={view}
              current={slide?.id ?? null}
              assetUrl={assetUrl}
              faces={liveFaces.aliases}
              width={thumbnailWidth}
              horizontal={below}
              readOnly={readOnly}
              onDrawn={onThumbnailsDrawn}
              provisional={written}
              fromLayout={<LayoutsMenu system={system} disabled={readOnly || view.slides.length >= DECK_LIMITS.slides} scope={scope} onPick={(layout) => void insertLayoutSlide(session, layout, slide?.id ?? order.at(-1) ?? null, importAsset).then((r) => 'reason' in r && setNotice(r.reason))} />}
            />,
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
          <div className="deck-editor-main" data-show-editors onContextMenu={showEditors.onContextMenu}>
            {showEditors.open && <ShowEditorsMenu open={showEditors.open} onShow={showEditors.show} onClose={showEditors.close} />}
            <CommentFrame api={commentsApi} surface={comments} canvas={stageCanvas} scale={scale}>
              <Stage
                session={session}
                slide={slide}
                scale={scale}
                assetUrl={assetUrl}
                viewport={viewport}
                frame={frame}
                onCanvas={onStageCanvas}
                canvas={stageCanvas}
                readOnly={!editable}
                onNotice={setNotice}
                artifactId={artifactId}
                importAsset={importAsset}
                scope={scope}
                faces={liveFaces.aliases}
                provisional={written}
              />
            </CommentFrame>
            {slide && <Notes key={slide.id} session={session} slideId={slide.id} token={slide.token} readOnly={readOnly || slide.held !== null} />}
          </div>
    </>
  );
  const toolbarHost = onToolbarHost && <div ref={onToolbarHost} className="deck-toolbar-host" />;
  const editor = (
    <div ref={root /* P4-B2 K6 */} className="deck-editor" data-deck-editor data-compact={compact || undefined} data-history-previewing={preview ? '' : undefined} onKeyDown={onKeyDown} onFocus={(event) => regions.note(event.currentTarget, event.target)}>
      {faces && <style data-deck-faces>{faces}</style>}
      {!preview &&
        historySnapshot?.banner && (
          <div className="deck-history-banner" role="status" aria-label={HISTORY_COPY.restoredBanner}>
            <span>{historySnapshot.banner}</span>
            <button type="button" className="deck-button" onClick={() => history?.dismissBanner()}>
              {HISTORY_COPY.dismiss}
            </button>
          </div>
        )}
      {preview ? (
        <HistoryBar preview={preview} controller={history!} onBack={() => history!.close()} toolbarEnd={toolbarHost} />
      ) : (
          <Toolbar session={session} zoom={state.zoom} scale={scale} fit={fit} canUndo={state.canUndo && !readOnly} canRedo={state.canRedo && !readOnly} metadata={toolbarHost}>
            <ElementBar
              session={session}
              slideId={slide?.id ?? null}
              canvas={stageCanvas}
              scale={scale}
              readOnly={!editable}
              onInsert={insert}
              uploadAsset={uploadAsset}
              onNotice={setNotice}
              inspectorOpen={inspectorOpen}
              onToggleInspector={() => setInspectorOpen((open) => !open)}
            >
              <TextStyleMenu session={session} slideId={slide?.id ?? null} tokens={tokens} readOnly={!editable} onNotice={setNotice} />
            </ElementBar>
            {history && <button type="button" className="deck-button" aria-label="Version history" aria-pressed={historyOpen} onClick={() => session.toggleRail('history')}>History</button>}
            <CommentButtons api={commentsApi} railOpen={state.rail === 'comments'} onToggleRail={() => session.toggleRail('comments')} />
            <span role="status" className="deck-notice" data-deck-notice>
              {notice}
            </span>
          </Toolbar>
      )}
      <div className="deck-editor-body" data-filmstrip={below ? 'horizontal' : 'vertical'} style={{ '--deck-card-reserve': `${cardReserve}px` } as CSSProperties}>
        {preview ? <HistoryPreview controller={history!} preview={preview} liveSystem={system} assets={previewAssets} faces={versionFaces!} zoom={state.zoom} thumbnailWidth={thumbnailWidth} horizontal={below} cardReserve={cardReserve} onRoom={readRoom} onDrawn={previewDrawn} /> : live}
        {(historyRail || (!preview && (state.rail === 'theme' || state.rail === 'check' || state.rail === 'comments' || (inspectorOpen && slide)))) && (
          <div ref={cards} className="deck-tool-cards">
            {!preview && inspectorOpen && slide && (
              <div className="deck-tool-card">
                <div className="deck-tool-card-header"><span>Inspector</span><button type="button" className="deck-button" aria-label="Close inspector" onClick={() => setInspectorOpen(false)}>×</button></div>
                {scope(<Inspector session={session} slideId={slide.id} readOnly={!editable} faces={view.faces} uploadAsset={uploadAsset} measure={(id) => measureInHost(stageCanvas, id, scale)} canvas={stageCanvas?.slideId === slide.id ? stageCanvas : null} overlayRail />)}
              </div>
            )}
            {historyRail && <div className="deck-tool-card">{historyRail}</div>}
            {!preview && state.rail === 'theme' && <div className="deck-tool-card">{scope(<ThemePanel session={session} system={system} theme={theme} overrides={view.overrides} faces={view.faces} readOnly={readOnly} />)}</div>}
            {!preview && state.rail === 'check' && <div className="deck-tool-card"><CheckPanel session={session} system={system} /></div>}
            {!preview && state.rail === 'comments' && <div className="deck-tool-card"><CommentsRail api={commentsApi} onClose={() => session.toggleRail('comments')} /></div>}
          </div>
        )}
      </div>
    </div>
  );
  return <DeckCommentsProvider value={commentsApi}>{editor}</DeckCommentsProvider>;
}

function Toolbar({ session, zoom, scale, fit, canUndo, canRedo, children, metadata }: { session: DeckSession; zoom: Zoom; scale: number; fit: number; canUndo: boolean; canRedo: boolean; children?: ReactNode; metadata?: ReactNode }) {
  const step = (direction: 1 | -1) => {
    const steps = direction === 1 ? ZOOM_STEPS.filter((s) => s > scale + 0.001) : ZOOM_STEPS.filter((s) => s < scale - 0.001).reverse();
    if (steps[0] !== undefined) session.setZoom(steps[0]);
  };
  return (
    <div className="deck-toolbar" role="toolbar" aria-label={C.toolbar}>
      <button type="button" className="deck-button" aria-label={C.undo} title={`${C.undo} (⌘Z)`} disabled={!canUndo} onClick={() => session.undoStep()}>
        ↶
      </button>
      <button type="button" className="deck-button" aria-label={C.redo} title={`${C.redo} (⇧⌘Z)`} disabled={!canRedo} onClick={() => session.redoStep()}>
        ↷
      </button>
      <span className="deck-toolbar-divider" aria-hidden />
      {children}
      <span className="deck-toolbar-spacer" />
      {metadata}
      <div className="deck-zoom-controls" role="group" aria-label={C.zoomControls}>
        <button type="button" className="deck-button" aria-label={C.zoomOut} disabled={scale <= ZOOM_STEPS[0] + 0.001} onClick={() => step(-1)}>
          −
        </button>
        <select
          className="deck-zoom"
          aria-label={C.zoom}
          value={zoom === 'fit' ? 'fit' : String(zoom)}
          onChange={(event) => session.setZoom(event.target.value === 'fit' ? 'fit' : Number(event.target.value))}
        >
          {/* the percentage beside Fit whether it is chosen or not: what it draws at, and a label that never changes with the choice */}
          <option value="fit">{`${C.fit} (${C.percent(fit)})`}</option>
          {ZOOM_STEPS.map((s) => (
            <option key={s} value={String(s)}>
              {C.percent(s)}
            </option>
          ))}
        </select>
        <button type="button" className="deck-button" aria-label={C.zoomIn} disabled={scale >= ZOOM_STEPS[ZOOM_STEPS.length - 1] - 0.001} onClick={() => step(1)}>
          +
        </button>
      </div>
    </div>
  );
}

/**
 * M8: Show editors (§4.7; B's menu, ShowEditors.tsx): a right-click over the stage with one element selected opens a
 * small menu; "Show editors" lists who set that element's keys and typed its text, and when, from provenance. A
 * right-click with no single selection keeps the system's menu.
 */
function useShowEditors(history: ReturnType<typeof useDeckHistoryController>, session: DeckSession, slideId: string | null) {
  type Open = { x: number; y: number; from: number; to: number; asked: boolean; editors: ShownEditor[] | null; error: string | null; elementId: string };
  const [open, setOpen] = useState<Open | null>(null);
  const onContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    const selection = session.snapshot().selection;
    if (!history || slideId === null || selection.length !== 1) return;
    if (!(event.target as HTMLElement).closest('[data-stage-surface]')) return;
    event.preventDefault();
    const frame = event.currentTarget.getBoundingClientRect();
    setOpen({ x: event.clientX - frame.left, y: event.clientY - frame.top, from: 0, to: 0, asked: false, editors: null, error: null, elementId: selection[0]! });
  };
  const show = () => {
    if (!open || !history || slideId === null) return;
    const asked: Open = { ...open, asked: true, editors: null, error: null };
    setOpen(asked);
    history
      .editorsOf(slideId, asked.elementId)
      .then((editors) => setOpen((now) => (now === asked ? { ...asked, editors } : now)))
      .catch((error: unknown) => setOpen((now) => (now === asked ? { ...asked, editors: [], error: error instanceof Error ? error.message : String(error) } : now)));
  };
  return { open, onContextMenu, show, close: () => setOpen(null) };
}
