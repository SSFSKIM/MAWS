// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Canvas", "Stage and overlay"): one slide's canvas
// mounted in React at a scale, as the stage and every filmstrip thumbnail draw it. The canvas is the slide's own DOM
// (React never renders inside it); it is made anew when its slide's node is (an undo bringing a deleted slide back), as
// its observer is bound to the node it started on. The scale is a CSS transform of the 1920×1080 canvas, never a write.
import { useLayoutEffect, useRef } from 'react';
import type { Doc } from '../../yjs';
import { SlideCanvas, type AssetUrl } from '../canvas';

export const SLIDE_W = 1920;
export const SLIDE_H = 1080;

export function SlideView(props: { doc: Doc; slideId: string; token: object; assetUrl: AssetUrl; scale: number; onCanvas?: (canvas: SlideCanvas | null) => void; className?: string; thumbnail?: boolean }) {
  const { doc, slideId, token, assetUrl, scale, onCanvas, className, thumbnail = false } = props;
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(onCanvas);
  useLayoutEffect(() => {
    latest.current = onCanvas;
  });
  useLayoutEffect(() => {
    const canvas = new SlideCanvas(doc, slideId, host.current!, { assetUrl, thumbnail });
    latest.current?.(canvas);
    return () => {
      latest.current?.(null);
      canvas.dispose();
    };
  }, [doc, slideId, token, assetUrl, thumbnail]);
  return (
    <div className={`deck-slide-frame${className ? ` ${className}` : ''}`} style={{ width: SLIDE_W * scale, height: SLIDE_H * scale }}>
      <div ref={host} className="deck-slide-scaler" style={{ transform: `scale(${scale})` }} />
    </div>
  );
}
