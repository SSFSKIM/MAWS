// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8, D10's first part; M4): the deck editor over one
// replica: the toolbar (undo and redo, zoom by fit and steps), the filmstrip, the stage and the speaker notes. The
// slides draw in the deck's governing design system (`DesignSystemScope`, medium deck, the deck's `dsOverrides` last),
// so a token change or a system switch restyles every slide by reference; the editor's chrome reads the app's tokens.
// Shared by the panel's record view and the `artifact` main tab (the shell, src/renderer/src/tools/presentation/).
// M5: the transform layer on the stage, the toolbar's Insert and arrange controls, the inspector beside the stage.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { DesignSystemScope, type DesignSystemRef } from '../../design-system/apply';
import type { AssetUrl, SlideCanvas } from '../canvas';
import { CANVAS_CSS } from '../canvas';
import type { DeckFace } from '../deck';
import { insertElements, newElement, type NewKind } from '../writers-elements';
import { DECK_COPY as C } from './copy';
import { ElementBar } from './ElementBar';
import type { ImportAsset } from './transform/clipboard';
import { Inspector } from './Inspector';
import { measureInHost } from './transform/Overlay';
import { useDeckView } from './deck-view';
import { Filmstrip } from './Filmstrip';
import { Notes } from './Notes';
import { ZOOM_STEPS, type DeckSession, type Zoom } from './session';
import { SLIDE_H, SLIDE_W } from './SlideView';
import { Stage } from './Stage';
import './chrome.css';
import './deck.css';

export interface DeckEditorProps {
  session: DeckSession;
  assetUrl: AssetUrl;
  /** The deck's governing design system (D's chain); null draws the slides' own fallbacks. */
  system: DesignSystemRef | { builtin: 'maws' } | null;
  readOnly: boolean;
  /** The panel's narrow body: a narrower filmstrip. */
  compact?: boolean;
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
}

const NOTICE_MS = 6_000;
const TEXT_KINDS: readonly NewKind[] = ['text', 'heading', 'bullets', 'numbers'];

const STAGE_GUTTER = 48; // px of app chrome around the fitted slide

// the canvas's stylesheet, once per document
function useCanvasCss(): void {
  useLayoutEffect(() => {
    if (document.querySelector('style[data-maws-canvas-css]')) return;
    const style = document.createElement('style');
    style.dataset.mawsCanvasCss = '';
    style.textContent = CANVAS_CSS;
    document.head.appendChild(style);
  }, []);
}

/** The deck's uploaded faces as @font-face rules (a Google Fonts face is named, never fetched: D6). */
function faceRules(faces: Readonly<Record<string, DeckFace>>, assetUrl: AssetUrl): string {
  return Object.values(faces)
    .map((face) => {
      const url = typeof face.src === 'string' && face.src.startsWith('assets/') ? assetUrl(face.src) : null;
      return url ? `@font-face { font-family: ${JSON.stringify(face.family)}; src: url(${JSON.stringify(url)}); }` : '';
    })
    .filter(Boolean)
    .join('\n');
}

export function DeckEditor({ session, assetUrl, system, readOnly, compact = false, onStage, onDrawn, onThumbnailsDrawn, uploadAsset, artifactId, importAsset }: DeckEditorProps) {
  useCanvasCss();
  const doc = session.doc;
  const view = useDeckView(doc);
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const order = useMemo(() => view.slides.map((s) => s.id), [view.slides]);

  // the slide shown follows the deck: one deleted (here or elsewhere) gives way to its neighbour
  const shownOrder = useRef<readonly string[]>(order);
  useEffect(() => {
    session.reconcile(order, shownOrder.current);
    shownOrder.current = order;
  }, [session, order]);
  const slide = view.slides.find((s) => s.id === state.currentSlide) ?? view.slides[0] ?? null;

  // the fit zoom from the stage's own size
  const viewport = useRef<HTMLDivElement>(null);
  const hasSlide = slide !== null;
  const [room, setRoom] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => setRoom({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasSlide]);
  const fit = room ? Math.max(0.05, Math.min((room.w - STAGE_GUTTER) / SLIDE_W, (room.h - STAGE_GUTTER) / SLIDE_H)) : 0.25;
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

  const scope = (children: ReactNode) => (
    <DesignSystemScope system={system} medium="deck" overrides={view.overrides} className="deck-ds-scope">
      {children}
    </DesignSystemScope>
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod || readOnly) return;
    const target = event.target as HTMLElement;
    if (event.defaultPrevented || target.isContentEditable) return; // the text box routes its own (M5)
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

  // M5: what the slide's limits refused, an upload in progress: shown in the toolbar for a while
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  const [inspectorOpen, setInspectorOpen] = useState(!compact);
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

  const faces = faceRules(view.faces, assetUrl);
  return (
    <div className="deck-editor" data-deck-editor data-compact={compact || undefined} onKeyDown={onKeyDown}>
      {faces && <style data-deck-faces>{faces}</style>}
      <Toolbar session={session} zoom={state.zoom} scale={scale} canUndo={state.canUndo && !readOnly} canRedo={state.canRedo && !readOnly}>
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
        />
        <span role="status" className="deck-notice" data-deck-notice>
          {notice}
        </span>
      </Toolbar>
      <div className="deck-editor-body">
        {scope(
          <Filmstrip session={session} view={view} current={slide?.id ?? null} assetUrl={assetUrl} width={compact ? 120 : SLIDE_W / 8} readOnly={readOnly} onDrawn={onThumbnailsDrawn} />,
        )}
        <div className="deck-editor-main">
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
          />
          {slide && <Notes key={slide.id} session={session} slideId={slide.id} token={slide.token} readOnly={readOnly || slide.held !== null} />}
        </div>
        {inspectorOpen &&
          slide &&
          scope(<Inspector session={session} slideId={slide.id} readOnly={!editable} faces={view.faces} uploadAsset={uploadAsset} measure={(id) => measureInHost(stageCanvas, id, scale)} />)}
      </div>
    </div>
  );
}

function Toolbar({ session, zoom, scale, canUndo, canRedo, children }: { session: DeckSession; zoom: Zoom; scale: number; canUndo: boolean; canRedo: boolean; children?: ReactNode }) {
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
      <button type="button" className="deck-button" aria-label={C.zoomOut} disabled={scale <= ZOOM_STEPS[0] + 0.001} onClick={() => step(-1)}>
        −
      </button>
      <select
        className="deck-zoom"
        aria-label={C.zoom}
        value={zoom === 'fit' ? 'fit' : String(zoom)}
        onChange={(event) => session.setZoom(event.target.value === 'fit' ? 'fit' : Number(event.target.value))}
      >
        <option value="fit">{zoom === 'fit' ? `${C.fit} (${C.percent(scale)})` : C.fit}</option>
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
  );
}
