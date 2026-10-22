// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D6, D8; M4, shared at M6 with the presenter): what a
// page drawing slides puts in its document: the canvas's stylesheet once, and the deck's faces as @font-face rules.
// P4-B2 D19 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md): a face's files are `faceFiles`'s, an uploaded
// face's one file or the files the engine host saved in the deck's assets for a Google Fonts face, so a fetched face
// draws offline; one rule per file, with the file's weight and style when it has them. A Google Fonts face with no
// saved files (pending, or refused by name) has no rule and draws as its fallback; nothing here loads from the network.
import { useLayoutEffect, useMemo } from 'react';
import { stableHash } from '../../design-system/hash';
import { CANVAS_CSS, type AssetUrl } from '../canvas';
import type { FaceAliases } from '../canvas/faces';
import { faceFiles, type DeckFace, type FaceFile } from '../deck';

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

const quoted = (name: string) => JSON.stringify(name);

/** A face's files at the page's URLs (a file the page cannot resolve left out). */
const resolvedFiles = (face: DeckFace, assetUrl: AssetUrl): (FaceFile & { url: string })[] =>
  faceFiles(face).flatMap((file) => {
    const url = assetUrl(file.src);
    return url ? [{ ...file, url }] : [];
  });

/** One file's @font-face rule: its family, its URL, and its weight and style when it has them (a fetched face's). */
const faceRule = (family: string, file: FaceFile & { url: string }) =>
  `@font-face { font-family: ${quoted(family)}; src: url(${quoted(file.url)});${file.weight ? ` font-weight: ${file.weight};` : ''}${file.style ? ` font-style: ${file.style};` : ''} }`;

/** The deck's faces as @font-face rules under their authored names (a page drawing one deck: the presenter). */
export function faceRules(faces: Readonly<Record<string, DeckFace>>, assetUrl: AssetUrl): string {
  return Object.values(faces)
    .flatMap((face) => resolvedFiles(face, assetUrl).map((file) => faceRule(face.family, file)))
    .join('\n');
}

/**
 * The deck's faces under private names (`deck-face-…`, from the face's URLs, which name the artifact (and a version's
 * revision), and the family; a single file's name is what it was before D19), and those names for its canvases'
 * font-family values (canvas/faces.ts): for a page drawing more than one deck, or one deck at more than one state (M8 fix
 * wave 2; the live editor at B6).
 */
export function declareFaces(faces: Readonly<Record<string, DeckFace>>, assetUrl: AssetUrl): { rules: string[]; aliases: Map<string, string> } {
  const rules: string[] = [];
  const aliases = new Map<string, string>();
  for (const face of Object.values(faces)) {
    const files = resolvedFiles(face, assetUrl);
    if (files.length === 0 || typeof face.family !== 'string') continue;
    const key = face.family.toLowerCase();
    const alias = aliases.get(key) ?? `deck-face-${stableHash([...files.map((file) => file.url), key].join('\n'))}`;
    aliases.set(key, alias);
    for (const file of files) rules.push(faceRule(alias, file));
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
