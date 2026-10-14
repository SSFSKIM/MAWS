// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Stage and overlay"; M4): the current slide at the
// zoom, centred in app chrome (the stage's surround is the app's; the slide paints its own background). The overlay of
// M5's transform layer sits beside the scaled canvas in screen pixels (`.deck-stage-overlay`). A held slide shows its last
// good version read-only under a banner with its reasons.
import type { ReactNode, Ref } from 'react';
import type { AssetUrl, SlideCanvas } from '../canvas';
import type { SlideEntry } from './deck-view';
import { DECK_COPY as C } from './copy';
import type { DeckSession } from './session';
import { SlideView } from './SlideView';

export interface StageProps {
  session: DeckSession;
  slide: SlideEntry | null;
  scale: number;
  assetUrl: AssetUrl;
  /** The scroll box whose size the fit zoom reads. */
  viewport: Ref<HTMLDivElement>;
  /** The scaled slide's frame (Mark-up's surface). */
  frame: Ref<HTMLDivElement>;
  onCanvas?: (canvas: SlideCanvas | null) => void;
  /** The DesignSystemScope the slide draws in. */
  scope: (children: ReactNode) => ReactNode;
}

export function Stage({ session, slide, scale, assetUrl, viewport, frame, onCanvas, scope }: StageProps) {
  return (
    <div className="deck-stage-column">
      {slide?.held && (
        <div role="status" className="deck-held-banner" data-held-banner>
          <strong>{C.heldBanner}</strong>
          <ul>
            {slide.held.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      <div ref={viewport} className="deck-stage" aria-label={C.stage} role="region">
        {slide ? (
          <div className="deck-stage-center">
            <div ref={frame} className="deck-stage-frame" data-stage-slide={slide.id} data-held={slide.held ? '' : undefined}>
              {scope(<SlideView doc={session.doc} slideId={slide.id} token={slide.token} assetUrl={assetUrl} scale={scale} onCanvas={onCanvas} />)}
              <div className="deck-stage-overlay" aria-hidden />
            </div>
          </div>
        ) : (
          <p className="deck-quiet">{C.emptyDeck}</p>
        )}
      </div>
    </div>
  );
}
