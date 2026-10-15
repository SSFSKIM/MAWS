// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D6, D8; M4, shared at M6 with the presenter): what a
// page drawing slides puts in its document: the canvas's stylesheet once, and the deck's uploaded faces as @font-face
// rules (a Google Fonts face is named, never fetched: D6).
import { useLayoutEffect } from 'react';
import { CANVAS_CSS, type AssetUrl } from '../canvas';
import type { DeckFace } from '../deck';

/** The canvas's stylesheet, once per document. */
export function useCanvasCss(): void {
  useLayoutEffect(() => {
    if (document.querySelector('style[data-maws-canvas-css]')) return;
    const style = document.createElement('style');
    style.dataset.mawsCanvasCss = '';
    style.textContent = CANVAS_CSS;
    document.head.appendChild(style);
  }, []);
}

/** The deck's uploaded faces as @font-face rules. */
export function faceRules(faces: Readonly<Record<string, DeckFace>>, assetUrl: AssetUrl): string {
  return Object.values(faces)
    .map((face) => {
      const url = typeof face.src === 'string' && face.src.startsWith('assets/') ? assetUrl(face.src) : null;
      return url ? `@font-face { font-family: ${JSON.stringify(face.family)}; src: url(${JSON.stringify(url)}); }` : '';
    })
    .filter(Boolean)
    .join('\n');
}
