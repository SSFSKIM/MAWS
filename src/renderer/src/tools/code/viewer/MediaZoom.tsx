// P2-F W-V (L95, §2 item 6): the sizing of an image or a video in its viewer, shared by the file viewer's image (the
// Files route and a delivered image) and the deliverables viewer's video. The view owns a `useMediaZoom` and draws its
// media inside `ZoomStage`, which measures the pane (a ResizeObserver on the stage's content box) and lays the media out
// at `drawn`; `ZoomControls` are the view's bar controls: zoom out, the scale, zoom in, actual size and fit. Fit, the
// default, follows the pane as it resizes; a zoom keeps the point at the pane's centre where it was.
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { VIEWER_COPY } from '../copy';
import { drawnSize, fitScale, ZOOM_STEPS, zoomedIn, zoomedOut, type Size, type Zoom } from './zoom';

export interface MediaZoom {
  zoom: Zoom;
  scale: number | null; // null until both the media's natural size and the pane's are known
  fit: number | null; // the scale fit would draw at
  drawn: Size | null;
  attachStage(element: HTMLDivElement | null): void; // the stage's ref callback
  setMedia(size: Size): void; // the media's natural size, from its load (an image) or its metadata (a video)
  set(zoom: Zoom): void;
  zoomIn(): void;
  zoomOut(): void;
}

// `key` names what is shown: a new one starts at fit again with no size known.
export function useMediaZoom(key: string): MediaZoom {
  const [zoomed, setZoomed] = useState<{ key: string; zoom: Zoom }>({ key, zoom: 'fit' });
  const [natural, setNatural] = useState<{ key: string; size: Size } | null>(null);
  const [box, setBox] = useState<Size | null>(null);
  const zoom = zoomed.key === key ? zoomed.zoom : 'fit';
  const media = natural?.key === key ? natural.size : null;

  // the stage: measured while mounted, scrolled by a zoom
  const stage = useRef<HTMLDivElement | null>(null);
  const attachStage = useCallback((element: HTMLDivElement | null) => {
    stage.current = element;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setBox({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => {
      observer.disconnect();
      stage.current = null;
    };
  }, []);

  // the pane's centre as fractions of the scrolled content, taken before a zoom and restored after it draws
  const centre = useRef<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const at = centre.current;
    const element = stage.current;
    centre.current = null;
    if (at === null || element === null) return;
    element.scrollLeft = at.x * element.scrollWidth - element.clientWidth / 2;
    element.scrollTop = at.y * element.scrollHeight - element.clientHeight / 2;
  }, [zoom]);

  const fit = media !== null && box !== null && box.width > 0 && box.height > 0 ? fitScale(media, box) : null;
  const scale = fit === null ? null : zoom === 'fit' ? fit : zoom;
  const set = (next: Zoom) => {
    const element = stage.current;
    if (element !== null && element.scrollWidth > 0 && element.scrollHeight > 0) {
      centre.current = { x: (element.scrollLeft + element.clientWidth / 2) / element.scrollWidth, y: (element.scrollTop + element.clientHeight / 2) / element.scrollHeight };
    }
    setZoomed({ key, zoom: next });
  };
  return {
    zoom,
    scale,
    fit,
    drawn: media !== null && scale !== null ? drawnSize(media, scale) : null,
    attachStage,
    setMedia: (size) => {
      if (size.width > 0 && size.height > 0) setNatural({ key, size });
    },
    set,
    zoomIn: () => {
      if (scale !== null) set(zoomedIn(scale));
    },
    zoomOut: () => {
      if (scale !== null) set(zoomedOut(scale));
    },
  };
}

// The scrolling pane the media draws in: centred while it fits, scrolled from its edge when larger than the pane.
export function ZoomStage({ zoom, className = '', children }: { zoom: MediaZoom; className?: string; children: ReactNode }) {
  const { attachStage, zoom: level } = zoom;
  return (
    <div ref={attachStage} data-zoom-stage="" data-zoom={String(level)} className={`flex min-h-0 overflow-auto p-4 ${className}`}>
      {children}
    </div>
  );
}

// The media element's size and placement in the stage: the drawn size once known, else bounded by the pane.
export function zoomedMedia(zoom: MediaZoom): { className: string; style: CSSProperties | undefined } {
  return zoom.drawn === null
    ? { className: 'm-auto max-h-full max-w-full', style: undefined }
    : { className: 'm-auto max-w-none shrink-0', style: { width: zoom.drawn.width, height: zoom.drawn.height } };
}

const control = 'rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 aria-pressed:bg-bg-active aria-pressed:text-fg disabled:text-fg-faint disabled:hover:bg-transparent';

// The zoom group wraps among its own buttons in a bar narrower than it, so Fit stays reachable (scale review D
// scalpel-4#1, review round 1); its bars grow a line rather than clipping.
export function ZoomControls({ zoom }: { zoom: MediaZoom }) {
  const { scale } = zoom;
  const top = ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return (
    <span role="group" aria-label={VIEWER_COPY.zoom} className="flex min-w-0 flex-wrap items-center gap-1 whitespace-nowrap">
      <button type="button" className={control} aria-label={VIEWER_COPY.zoomOut} title={VIEWER_COPY.zoomOut} disabled={scale === null || scale <= ZOOM_STEPS[0]} onClick={zoom.zoomOut}>
        −
      </button>
      <span data-zoom-percent="" className="min-w-[4ch] text-center text-ui-sm text-fg-muted tabular-nums">
        {scale === null ? '' : VIEWER_COPY.zoomPercent(scale)}
      </span>
      <button type="button" className={control} aria-label={VIEWER_COPY.zoomIn} title={VIEWER_COPY.zoomIn} disabled={scale === null || scale >= top} onClick={zoom.zoomIn}>
        +
      </button>
      <button type="button" className={control} aria-pressed={zoom.zoom === 1} disabled={scale === null} onClick={() => zoom.set(1)}>
        {VIEWER_COPY.actualSize}
      </button>
      <button type="button" className={control} aria-pressed={zoom.zoom === 'fit'} disabled={scale === null} onClick={() => zoom.set('fit')}>
        {VIEWER_COPY.fit}
      </button>
    </span>
  );
}
