// P4-A2 G2.3 (X35; docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md G-R3 to G-R5): the deck layer's React
// mounts. React renders the layers' elements and nothing inside them: each mount hands its element to the imperative
// controller (slide.ts), which draws from the store's and the session's listeners in the task they fire in. Shared by
// the deck's stage and filmstrip and (G2.4) a design's boards.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from 'react';
import type { ProvisionalLayers } from '../../../provisional';
import type { Doc } from '../../../yjs';
import type { AssetUrl, SlideCanvas } from '../../canvas';
import type { FaceAliases } from '../../canvas/faces';
import { DECK_COPY as C } from '../copy';
import type { DeckSession } from '../session';
import { SLIDE_H, SLIDE_W } from '../SlideView';
import { DECK_FILES, DeckProvisional, writtenOrder, type DeckProvisionalSnapshot, type ProvisionalFiles } from './deck';
import { sessionProtection, SlideProvisional, ThumbnailProvisional } from './slide';
import './provisional.css';

/**
 * The open deck's provisional model over the tab's layers (null without them), following them while the editor is
 * mounted: a StrictMode remount stops and restarts the same model.
 */
export function useDeckProvisional(layers: ProvisionalLayers | null, doc: Doc, files: ProvisionalFiles = DECK_FILES): DeckProvisional | null {
  const deck = useMemo(() => (layers ? new DeckProvisional(layers, doc, files) : null), [layers, doc, files]);
  useEffect(() => deck?.attach(), [deck]);
  return deck;
}

const NO_SNAPSHOT: DeckProvisionalSnapshot = { slides: new Map() };
const noSubscribe = () => () => {};
const noSnapshot = () => NO_SNAPSHOT;

/** The filmstrip's order: the live slides, each new slide being written at its place in the streamed index (G-R5). */
export function useWrittenOrder(deck: DeckProvisional | null, liveOrder: readonly string[]): readonly string[] {
  const snapshot = useSyncExternalStore(deck?.subscribe ?? noSubscribe, deck?.snapshot ?? noSnapshot);
  return useMemo(() => writtenOrder(snapshot, liveOrder), [snapshot, liveOrder]);
}

/**
 * P4-A2 G2.4: the zoom a layer is shown at beyond its own scale (a design's world, whose one transform scales every
 * board), read and followed without a React render, as the world's pan and zoom are.
 */
export interface ScreenZoom {
  get(): number;
  subscribe(listener: () => void): () => void;
}

/**
 * A layer's screen-sized marks at its scale times the zoom: the outline's width (`--provisional-outline`, in the slide's
 * px) and the label's counter-scale (`--provisional-label-scale`), so both read the same at every zoom. Written on the
 * layer's element alone, so a zoom restyles no live canvas.
 */
export function useProvisionalZoom(host: RefObject<HTMLElement | null>, scale: number, zoom?: ScreenZoom | null): void {
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    let shown = Number.NaN;
    const apply = () => {
      const z = zoom?.get() ?? 1;
      if (z === shown) return; // a pan
      shown = z;
      el.style.setProperty('--provisional-outline', `${2 / (scale * z)}px`);
      el.style.setProperty('--provisional-label-scale', String(1 / z));
    };
    apply();
    return zoom?.subscribe(apply);
  }, [host, scale, zoom]);
}

/** A zoom's changes alone (a pan, which moves the layer and its protected boxes together, is not one). */
function zoomChanges(zoom: ScreenZoom): (listener: () => void) => () => void {
  return (listener) => {
    let shown = zoom.get();
    return zoom.subscribe(() => {
      const z = zoom.get();
      if (z === shown) return;
      shown = z;
      listener();
    });
  };
}

/** A plain change signal: what a layer's own `scale` prop tells its controller once React has applied it. */
function signal(): { tell(): void; subscribe(listener: () => void): () => void } {
  const listeners = new Set<() => void>();
  return {
    tell: () => listeners.forEach((listener) => listener()),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * A slide's layer over its live canvas, between the canvas and the overlay (G-R3): positioned over the slide's frame,
 * taking no pointer, no focus and no name. `session` protects the human's elements on its current slide (G-R4).
 */
export function SlideLayer(props: {
  deck: DeckProvisional;
  canvas: SlideCanvas;
  slideId: string;
  scale: number;
  /** A design board's size; the deck's 1920×1080 when absent. */
  size?: { w: number; h: number } | null;
  session?: DeckSession | null;
  assetUrl: AssetUrl;
  faces?: FaceAliases;
  /** P4-A2 G2.4: the zoom the layer is shown at beyond `scale` (a design's world); none on the deck's stage. */
  zoom?: ScreenZoom | null;
}) {
  const { deck, canvas, slideId, scale, size, session, assetUrl, faces, zoom } = props;
  const host = useRef<HTMLDivElement>(null);
  const scaler = useRef<HTMLDivElement>(null);
  useProvisionalZoom(host, scale, zoom);
  // The layer's screen transform changes with no layout pass of either canvas when the zoom changes (a design world's)
  // or the scale does (the stage's Fit as its pane resizes, a step of the zoom): either way the protection is judged
  // again once the new transform is on the page (G-R4: a screen-sized label clear of a box may meet it once the slide
  // is drawn smaller). The scale reaches the controller from a layout effect, after React has written the transforms.
  const [scaled] = useState(signal);
  useLayoutEffect(() => {
    const zoomed = zoom ? zoomChanges(zoom) : null;
    const onTransform = (listener: () => void) => {
      const offScale = scaled.subscribe(listener);
      const offZoom = zoomed?.(listener);
      return () => {
        offScale();
        offZoom?.();
      };
    };
    const layer = new SlideProvisional({ deck, slideId, live: canvas, host: host.current!, scaler: scaler.current!, protection: session ? sessionProtection(session, slideId) : null, assetUrl, ...(faces && { faces }), label: C.writing, onTransform });
    return () => layer.dispose();
  }, [deck, canvas, slideId, session, assetUrl, faces, zoom, scaled]);
  const drawnScale = useRef(scale);
  useLayoutEffect(() => {
    if (drawnScale.current === scale) return;
    drawnScale.current = scale;
    scaled.tell();
  }, [scale, scaled]);
  const [w, h] = size ? [size.w, size.h] : [SLIDE_W, SLIDE_H];
  const style: CSSProperties = { width: w * scale, height: h * scale };
  return (
    <div ref={host} className="deck-provisional" data-provisional-layer={slideId} aria-hidden="true" inert style={style}>
      <div ref={scaler} className="deck-slide-scaler" style={{ transform: `scale(${scale})`, ...(size && { width: w, height: h }) }} />
    </div>
  );
}

/**
 * A filmstrip entry's layer over its thumbnail (G-R5): the ring, and the whole provisional slide once it differs;
 * `keepLast` for a new slide's or board's ghost entry, which keeps its last drawing until it unmounts.
 */
export function ThumbnailLayer(props: { deck: DeckProvisional; slideId: string; scale: number; assetUrl: AssetUrl; faces?: FaceAliases; keepLast?: boolean }) {
  const { deck, slideId, scale, assetUrl, faces, keepLast } = props;
  const host = useRef<HTMLDivElement>(null);
  const scaler = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const layer = new ThumbnailProvisional({ deck, slideId, host: host.current!, scaler: scaler.current!, assetUrl, ...(faces && { faces }), ...(keepLast && { keepLast }) });
    return () => layer.dispose();
  }, [deck, slideId, assetUrl, faces, keepLast]);
  return (
    <div ref={host} className="deck-provisional-thumb" data-provisional-thumb={slideId} aria-hidden="true" inert>
      <div ref={scaler} className="deck-slide-scaler" style={{ transform: `scale(${scale})` }} />
    </div>
  );
}

/**
 * A slide new to the deck as its publish streams (G-R5): an entry at its place in the filmstrip, not a button, not
 * sortable, taking no focus, gone in the render that brings the real slide's entry.
 */
export function NewSlideEntry(props: { deck: DeckProvisional; slideId: string; scale: number; assetUrl: AssetUrl; faces?: FaceAliases }) {
  const { deck, slideId, scale, assetUrl, faces } = props;
  return (
    <li className="deck-filmstrip-item deck-filmstrip-new" data-provisional-new-slide={slideId} aria-hidden="true" inert>
      <div className="deck-thumb">
        <span className="deck-thumb-number" />
        <div className="deck-provisional-entry" style={{ width: SLIDE_W * scale, height: SLIDE_H * scale }}>
          <ThumbnailLayer deck={deck} slideId={slideId} scale={scale} assetUrl={assetUrl} faces={faces} keepLast />
        </div>
      </div>
    </li>
  );
}
