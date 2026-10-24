// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D11, D8's "in history"; M8): the deck in place of the
// editor while a version shows, read-only, drawn from the version's own doc in the design system pinned at the version
// (the live deck's own for "See N new changes"). With Show changes on: the filmstrip edges each changed slide in its
// author's colour (a new slide badged, a deleted one ghosted at its earlier place), the stage outlines each changed
// element in its author's colour and ghosts each deleted one from the earlier doc where it was, the notes below show the
// diff (inserts in the author's colour, deletions struck), and the deck's own changes are named above the stage; ↑ ↓
// (the bar) reach each change, the stage moving to its slide. Nothing here writes: the docs are the controller's,
// throwaway, and no transform layer, text box or notes field is mounted.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DesignSystemScope, useDesignSystem, type DesignSystemRef } from '../../../design-system/apply';
import type { AssetUrl, SlideCanvas } from '../../canvas';
import type { ChangeStop, ElementChange, NotesPiece, SlideChange } from '../../history';
import { readNotes } from '../../../yjs/slides';
import { useDeckView } from '../deck-view';
import { SLIDE_H, SLIDE_W, SlideView } from '../SlideView';
import { measure } from '../transform/measure';
import { slideOrderOf, type DeckHistoryController, type DeckPreview } from './controller';
import { aliasFaces, aliasOverrides, type FaceAliases, type PreviewFaces } from './faces';
import type { Doc } from '../../../yjs';
import { HISTORY_COPY as C, keyLabel } from './copy';
import './history.css';

const STAGE_GUTTER = 48; // the editor's: px of app chrome around the fitted slide
const NO_ELEMENTS: readonly ElementChange[] = [];

interface Props {
  controller: DeckHistoryController;
  preview: DeckPreview;
  /** The live deck's system: what the live deck's own preview draws in. */
  liveSystem: DesignSystemRef | { builtin: 'maws' } | null;
  /** Fix wave 1 (R2): each state's assets: the shown version's and the earlier one's (`historyAssets`). */
  assets: PreviewAssets;
  /** Fix wave 2 (R2): each state's private face names (faces.ts), applied to every canvas the preview draws. */
  faces: Pick<PreviewFaces, 'shown' | 'earlier'>;
  /** The editor's zoom ('fit' or a scale). */
  zoom: 'fit' | number;
  thumbnailWidth: number;
  horizontal?: boolean;
  /** The floating tool stack's measured reservation, shared with the live stage's centering. */
  cardReserve?: number;
  /** A preview owns the stage while shown, so it also reports resizes for the floating stack's reservation. */
  onRoom?: (room: { w: number; h: number }) => void;
  /** Once the stage has drawn the shown slide with its marks (the e2e seam's preview time). */
  onDrawn?: () => void;
}

/** The asset URLs each state of a preview draws with. */
export interface PreviewAssets {
  shown: AssetUrl;
  earlier: AssetUrl;
}

/** Fix wave 1 (R2): a preview's assets at its states' revisions (the live deck's own when it shows the live deck). */
export function historyAssets(preview: Pick<DeckPreview, 'revision' | 'earlierRevision'>, live: AssetUrl, at: ((ref: string, revision: number) => string | null) | undefined): PreviewAssets {
  const pinned = (revision: number | null): AssetUrl => (revision === null || !at ? live : (ref) => at(ref, revision));
  return { shown: pinned(preview.revision), earlier: pinned(preview.earlierRevision) };
}

export function HistoryPreview({ controller, preview, liveSystem, assets, faces, zoom, thumbnailWidth, horizontal = false, cardReserve = 0, onRoom, onDrawn }: Props) {
  const view = useDeckView(preview.shown);
  const system = preview.system ?? liveSystem;
  // fix wave 3: the font tokens the Theme overrode with a deck-uploaded family name the family's private name here
  const overrides = useMemo(() => aliasOverrides(view.overrides, faces.shown), [view.overrides, faces.shown]);
  // fix wave 1 (R3): whether the system the version draws in has its style yet (the scope shares this view's lease)
  const systemReady = useDesignSystem(system).status !== 'loading';
  const scope = (children: ReactNode) => (
    <DesignSystemScope system={system} medium="deck" overrides={overrides} className="deck-ds-scope">
      {children}
    </DesignSystemScope>
  );
  const bySlide = new Map(preview.changes.slides.map((s) => [s.id, s]));
  const focus = preview.focus === null ? null : (preview.stops[preview.focus] ?? null);
  const slideId = preview.slideId;
  const change = slideId === null ? undefined : bySlide.get(slideId);
  return (
    <>
      {scope(<HistoryFilmstrip controller={controller} preview={preview} bySlide={bySlide} assets={assets} faces={faces} width={thumbnailWidth} horizontal={horizontal} />)}
      <div className="deck-editor-main" data-history-preview={preview.target.kind}>
        <HistoryStage controller={controller} preview={preview} change={change} focus={focus} assets={assets} faces={faces} zoom={zoom} cardReserve={cardReserve} onRoom={onRoom} scope={scope} systemReady={systemReady} onDrawn={onDrawn} />
        {slideId !== null && <NotesDiff controller={controller} preview={preview} slideId={slideId} change={change} focus={focus} />}
      </div>
    </>
  );
}

// ---- the filmstrip

function HistoryFilmstrip({ controller, preview, bySlide, assets, faces, width, horizontal }: { controller: DeckHistoryController; preview: DeckPreview; bySlide: Map<string, SlideChange>; assets: PreviewAssets; faces: Props['faces']; width: number; horizontal: boolean }) {
  // a deleted slide is shown at its earlier place only while the changes are
  const order = slideOrderOf(preview).filter((id) => preview.showChanges || bySlide.get(id)?.kind !== 'removed');
  const scale = width / SLIDE_W;
  return (
    <nav className="deck-filmstrip" aria-label={C.filmstrip} data-direction={horizontal ? 'horizontal' : 'vertical'} style={{ width: horizontal ? undefined : width + 40 }}>
      <ol className="deck-filmstrip-list">
        {order.map((id, index) => {
          const change = preview.showChanges ? bySlide.get(id) : undefined;
          const removed = bySlide.get(id)?.kind === 'removed';
          const author = change?.by ? controller.author(change.by) : null;
          const style = author ? ({ '--deck-history-author': `var(${author.color})` } as CSSProperties) : undefined;
          return (
            <li key={id} className="deck-filmstrip-item">
              <div className="deck-thumb" data-slide-thumb={id} data-current={id === preview.slideId ? '' : undefined} data-history-change={change?.kind} style={style}>
                <span className="deck-thumb-number" aria-hidden>
                  {index + 1}
                </span>
                <button
                  type="button"
                  className="deck-thumb-button"
                  aria-label={C.slideLabel(index + 1, change?.kind ?? null)}
                  aria-current={id === preview.slideId ? 'true' : undefined}
                  title={author ? C.by(author.name, author.when(change!.at)) : undefined}
                  onClick={() => controller.showSlide(id)}
                >
                  <PreviewSlide doc={removed ? preview.earlier : preview.shown} slideId={id} assetUrl={removed ? assets.earlier : assets.shown} faces={removed ? faces.earlier : faces.shown} scale={scale} thumbnail />
                  {change?.kind === 'added' && <span className="deck-thumb-badge deck-history-badge">{C.newBadge}</span>}
                  {change?.kind === 'removed' && <span className="deck-thumb-badge deck-history-badge">{C.deletedBadge}</span>}
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ---- a slide of a state, its faces under the state's private names (fix wave 2, R2; display only)

function PreviewSlide({ doc, slideId, assetUrl, faces, scale, thumbnail, onCanvas }: { doc: Doc; slideId: string; assetUrl: AssetUrl; faces: FaceAliases; scale: number; thumbnail?: boolean; onCanvas?: (canvas: SlideCanvas | null) => void }) {
  const aliased = useCallback(
    (canvas: SlideCanvas | null) => {
      if (canvas) aliasFaces(canvas.root, faces); // before the canvas's first layout pass (the next frame)
      onCanvas?.(canvas);
    },
    [faces, onCanvas],
  );
  return <SlideView doc={doc} slideId={slideId} token={faces} assetUrl={assetUrl} scale={scale} onCanvas={aliased} thumbnail={thumbnail} />;
}

// ---- the stage

interface Mark {
  id: string;
  kind: ElementChange['kind'];
  box: { x: number; y: number; w: number; h: number };
  color: string | null;
  title: string;
}

function HistoryStage({ controller, preview, change, focus, assets, faces, zoom, cardReserve, onRoom, scope, systemReady, onDrawn }: { controller: DeckHistoryController; preview: DeckPreview; change: SlideChange | undefined; focus: ChangeStop | null; assets: PreviewAssets; faces: Props['faces']; zoom: 'fit' | number; cardReserve: number; onRoom: Props['onRoom']; scope: (children: ReactNode) => ReactNode; systemReady: boolean; onDrawn?: () => void }) {
  const slideId = preview.slideId;
  const requestedAt = preview.requestedAt;
  const removed = change?.kind === 'removed';
  const doc = removed ? preview.earlier : preview.shown;

  // the fit zoom from the stage's own size, as the editor's stage reads it
  const viewport = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const read = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) {
        setRoom((now) => now?.w === w && now.h === h ? now : { w, h });
        onRoom?.({ w, h });
      }
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onRoom]);
  const fit = room ? Math.max(0.05, Math.min((room.w - cardReserve - STAGE_GUTTER) / SLIDE_W, (room.h - STAGE_GUTTER) / SLIDE_H)) : 0.25;
  const scale = zoom === 'fit' ? fit : zoom;

  const [canvas, setCanvas] = useState<SlideCanvas | null>(null);
  const [ghosts, setGhosts] = useState<SlideCanvas | null>(null);
  const elements = preview.showChanges && change?.kind === 'changed' ? change.elements : NO_ELEMENTS;
  const removedIds = useMemo(() => elements.filter((e) => e.kind === 'removed').map((e) => e.id), [elements]);

  // the deleted elements are drawn from the earlier doc where they were, everything else of it hidden
  useEffect(() => {
    if (!ghosts) return;
    for (const id of removedIds) {
      const node = ghosts.node(id);
      if (node) node.dataset.ghost = '';
    }
  }, [ghosts, removedIds]);

  // the marks: each changed or new element outlined where it is drawn, each deleted one where it was; measured again at
  // every layout pass of either canvas (fix wave 1, R3: the pinned system's style arriving, a face loading or a picture
  // changing the flow moves elements after the first pass)
  const [marks, setMarks] = useState<Mark[]>([]);
  const drawnFor = useRef<number | null>(null); // the preview (its request time) whose drawing was reported
  useEffect(() => {
    if (!canvas) return;
    let live = true;
    const measureMarks = () => {
      if (!live) return;
      const next: Mark[] = [];
      for (const e of elements) {
        const source = e.kind === 'removed' ? ghosts : canvas;
        const m = source ? measure(source, e.id, scale) : null;
        if (!m) continue;
        const author = e.by ? controller.author(e.by) : null;
        const what = e.kind === 'changed' ? e.keys.map((k) => keyLabel(k.key)).join(', ') : e.kind === 'added' ? C.newBadge : C.deletedBadge;
        next.push({ id: e.id, kind: e.kind, box: m.bounds, color: author?.color ?? null, title: author ? `${what} — ${C.by(author.name, author.when(e.at))}` : what });
      }
      setMarks((shown) => (sameMarks(shown, next) ? shown : next));
      // the preview's time: its first measure once the system it draws in has its style (the canvas lays out again
      // when a scope's style arrives, so a later pass reports it when the system was still loading)
      if (systemReady && drawnFor.current !== requestedAt) {
        drawnFor.current = requestedAt;
        onDrawn?.();
      }
    };
    const offs = [canvas.onLayout(measureMarks), ...(ghosts ? [ghosts.onLayout(measureMarks)] : [])];
    void Promise.all([canvas.whenLaidOut(), ...(ghosts && removedIds.length > 0 ? [ghosts.whenLaidOut()] : [])]).then(measureMarks);
    return () => {
      live = false;
      for (const off of offs) off();
    };
  }, [canvas, ghosts, removedIds, scale, elements, controller, onDrawn, requestedAt, systemReady]);

  // ↑ ↓ reaching an element scrolls it into view
  const focusedMark = useRef<HTMLDivElement | null>(null);
  const focusedId = focus?.part === 'element' && focus.slideId === slideId ? focus.elementId : null;
  useEffect(() => {
    focusedMark.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [focusedId, marks]);

  return (
    <div className="deck-stage-column">
      <div ref={viewport} className="deck-stage" role="region" aria-label={C.stage} data-history-stage>
        {slideId !== null && (
          <div className="deck-stage-center">
            <div className="deck-stage-frame" data-stage-slide={slideId} data-history-slide={change?.kind ?? 'same'}>
              {scope(<PreviewSlide key={`${removed ? 'earlier' : 'shown'}:${slideId}`} doc={doc} slideId={slideId} assetUrl={removed ? assets.earlier : assets.shown} faces={removed ? faces.earlier : faces.shown} scale={scale} onCanvas={setCanvas} />)}
              {removedIds.length > 0 && (
                <div className="deck-history-ghosts" aria-hidden>
                  {scope(<PreviewSlide key={`ghosts:${slideId}`} doc={preview.earlier} slideId={slideId} assetUrl={assets.earlier} faces={faces.earlier} scale={scale} onCanvas={setGhosts} />)}
                </div>
              )}
              <div className="deck-stage-overlay">
                {marks.map((m) => (
                  <div
                    key={m.id}
                    ref={m.id === focusedId ? focusedMark : undefined}
                    className="deck-history-mark"
                    data-history-mark={m.id}
                    data-kind={m.kind}
                    data-focused={m.id === focusedId ? '' : undefined}
                    title={m.title}
                    style={{ left: m.box.x * scale, top: m.box.y * scale, width: m.box.w * scale, height: m.box.h * scale, ...(m.color ? { '--deck-history-author': `var(${m.color})` } : {}) } as CSSProperties}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- the notes

function NotesDiff({ controller, preview, slideId, change, focus }: { controller: DeckHistoryController; preview: DeckPreview; slideId: string; change: SlideChange | undefined; focus: ChangeStop | null }) {
  const pieces: NotesPiece[] | null = preview.showChanges && change?.notesPieces ? change.notesPieces : null;
  const text = pieces ? null : readNotes(change?.kind === 'removed' ? preview.earlier : preview.shown, slideId);
  const focusedRun = focus?.part === 'notes' && focus.slideId === slideId ? focus.run : null;
  return (
    <div className="deck-notes deck-history-notes" role="region" aria-label={C.notes} data-history-notes>
      {pieces ? (
        <p className="deck-history-notes-text">
          {pieces.map((piece, i) => (
            <NotesSpan key={i} piece={piece} color={piece.by ? controller.author(piece.by).color : null} focused={piece.run !== null && piece.run === focusedRun} />
          ))}
        </p>
      ) : text ? (
        <p className="deck-history-notes-text">{text}</p>
      ) : (
        <p className="deck-history-notes-text deck-quiet-text">{C.noNotes}</p>
      )}
    </div>
  );
}

function NotesSpan({ piece, color, focused }: { piece: NotesPiece; color: string | null; focused: boolean }) {
  if (piece.kind === 'same') return <span>{piece.text}</span>;
  const style = color ? ({ '--deck-history-author': `var(${color})` } as CSSProperties) : undefined;
  return piece.kind === 'ins' ? (
    <ins className="deck-history-ins" data-focused={focused ? '' : undefined} style={style}>
      {piece.text}
    </ins>
  ) : (
    <del className="deck-history-del" data-focused={focused ? '' : undefined} style={style}>
      {piece.text}
    </del>
  );
}

const sameMarks = (a: readonly Mark[], b: readonly Mark[]): boolean =>
  a.length === b.length && a.every((m, i) => m.id === b[i]!.id && m.kind === b[i]!.kind && m.color === b[i]!.color && m.title === b[i]!.title && m.box.x === b[i]!.box.x && m.box.y === b[i]!.box.y && m.box.w === b[i]!.box.w && m.box.h === b[i]!.box.h);
