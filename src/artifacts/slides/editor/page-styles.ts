// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D6, D8; M4, shared at M6 with the presenter): what a
// page drawing slides puts in its document: the canvas's stylesheet once, and the deck's uploaded faces as @font-face
// rules (a Google Fonts face is named, never fetched: D6).
import { useLayoutEffect, useMemo } from 'react';
import { stableHash } from '../../design-system/hash';
import { CANVAS_CSS, type AssetUrl } from '../canvas';
import type { FaceAliases } from '../canvas/faces';
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

/** The deck's uploaded faces as @font-face rules under their authored names (a page drawing one deck: the presenter). */
export function faceRules(faces: Readonly<Record<string, DeckFace>>, assetUrl: AssetUrl): string {
  return Object.values(faces)
    .map((face) => {
      const url = typeof face.src === 'string' && face.src.startsWith('assets/') ? assetUrl(face.src) : null;
      return url ? `@font-face { font-family: ${JSON.stringify(face.family)}; src: url(${JSON.stringify(url)}); }` : '';
    })
    .filter(Boolean)
    .join('\n');
}

const quoted = (name: string) => JSON.stringify(name);

/**
 * The deck's uploaded faces under private names (`deck-face-…`, from the face's URL, which names the artifact (and a
 * version's revision), and the family), and those names for its canvases' font-family values (canvas/faces.ts): for a
 * page drawing more than one deck, or one deck at more than one state (M8 fix wave 2; the live editor at B6).
 */
export function declareFaces(faces: Readonly<Record<string, DeckFace>>, assetUrl: AssetUrl): { rules: string[]; aliases: Map<string, string> } {
  const rules: string[] = [];
  const aliases = new Map<string, string>();
  for (const face of Object.values(faces)) {
    const url = typeof face.src === 'string' && face.src.startsWith('assets/') ? assetUrl(face.src) : null;
    if (!url || typeof face.family !== 'string') continue;
    const key = face.family.toLowerCase();
    const alias = aliases.get(key) ?? `deck-face-${stableHash(`${url}\n${key}`)}`;
    aliases.set(key, alias);
    rules.push(`@font-face { font-family: ${quoted(alias)}; src: url(${quoted(url)}); }`);
  }
  return { rules, aliases };
}

/**
 * B6: the live deck's faces under private names; the aliases the same map while they are the same (a canvas is made
 * anew when its aliases change, so a deck write that leaves the faces alone must not change them).
 */
export function useDeckFaces(faces: Readonly<Record<string, DeckFace>>, assetUrl: AssetUrl): { css: string; aliases: FaceAliases } {
  const declared = declareFaces(faces, assetUrl);
  const entries = JSON.stringify([...declared.aliases]);
  const aliases = useMemo<FaceAliases>(() => new Map(JSON.parse(entries) as [string, string][]), [entries]);
  return { css: declared.rules.join('\n'), aliases };
}
