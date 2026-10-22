// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Stage and overlay"; M4, M5): the current slide at
// the zoom, centred in app chrome (the stage's surround is the app's; the slide paints its own background). The transform
// layer's overlay (M5) sits beside the scaled canvas in screen pixels; the stage's scroll box takes the pointer and, once
// focused, the keys and the clipboard. A held slide shows its last good version read-only under a banner with its
// reasons.
import { useCallback, useRef, type ReactNode, type RefObject } from 'react';
import type { AssetUrl, SlideCanvas } from '../canvas';
import type { FaceAliases } from '../canvas/faces';
import type { SlideEntry } from './deck-view';
import { describeElement } from './a11y';
import { DECK_COPY as C } from './copy';
import type { DeckSession } from './session';
import { SlideView } from './SlideView';
import { TextBox } from './TextBox';
import type { ImportAsset } from './transform/clipboard';
import { Overlay } from './transform/Overlay';
import { SlideLayer, type DeckProvisional } from './provisional';

export interface StageProps {
  session: DeckSession;
  slide: SlideEntry | null;
  scale: number;
  assetUrl: AssetUrl;
  /** The scroll box whose size the fit zoom reads; it takes the pointer and the keys. */
  viewport: RefObject<HTMLDivElement | null>;
  /** The scaled slide's frame (Mark-up's surface). */
  frame: (element: HTMLDivElement | null) => void;
  /** The stage's canvas, as it is made and disposed. */
  onCanvas?: (canvas: SlideCanvas | null) => void;
  canvas: SlideCanvas | null;
  readOnly: boolean;
  onNotice?: (text: string) => void;
  /** The deck's artifact and the clipboard's way to bring another deck's pictures over (fix wave 1). */
  artifactId?: string;
  importAsset?: ImportAsset;
  /** The DesignSystemScope the slide draws in. */
  scope: (children: ReactNode) => ReactNode;
  /** B6: the deck's uploaded faces' private names (editor/page-styles.ts). */
  faces?: FaceAliases;
  /** P4-A2 G2.3 (X35): a publish's slides as they stream, drawn on the shown slide beneath the human's states. */
  provisional?: DeckProvisional | null;
}

export function Stage({ session, slide, scale, assetUrl, viewport, frame, onCanvas, canvas, readOnly, onNotice, artifactId, importAsset, scope, faces, provisional }: StageProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const setFrame = useCallback(
    (element: HTMLDivElement | null) => {
      frameRef.current = element;
      frame(element);
    },
    [frame],
  );
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
      <div ref={viewport} className="deck-stage" aria-label={C.stage} role="region" tabIndex={0} data-stage-surface aria-keyshortcuts="F6" /* P4-B2 (D14): its keyboard exit */>
        {slide ? (
          <div className="deck-stage-center">
            <div ref={setFrame} className="deck-stage-frame" data-stage-slide={slide.id} data-held={slide.held ? '' : undefined}>
              {scope(<SlideView doc={session.doc} slideId={slide.id} token={slide.token} assetUrl={assetUrl} scale={scale} onCanvas={onCanvas} faces={faces} size={slide.size ?? null} /* P3-E: a board's size */ describe={describeElement} /* P4-B2 (D15, A1) */ />)}
              {provisional && canvas?.slideId === slide.id && scope(<SlideLayer deck={provisional} canvas={canvas} slideId={slide.id} scale={scale} size={slide.size ?? null} session={session} assetUrl={assetUrl} faces={faces} /> /* P4-A2 G2.3 (G-R3) */)}
              <div className="deck-stage-overlay">
                {scope(
                  <Overlay
                    session={session}
                    canvas={canvas?.slideId === slide.id ? canvas : null}
                    slideId={slide.id}
                    scale={scale}
                    readOnly={readOnly || slide.held !== null}
                    surface={viewport}
                    frame={frameRef}
                    onNotice={onNotice}
                    artifactId={artifactId}
                    importAsset={importAsset}
                    renderText={(elementId, stageCanvas, armed) => <TextBox session={session} canvas={stageCanvas} slideId={slide.id} elementId={elementId} readOnly={readOnly || slide.held !== null} armed={armed} />}
                  />,
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="deck-quiet">{C.emptyDeck}</p>
        )}
      </div>
    </div>
  );
}
