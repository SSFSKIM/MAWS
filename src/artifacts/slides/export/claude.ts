// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D12 "For Claude"; parent Decision Log 12, 21): a deck
// as the files of Claude's Slides type, for the `claude` export's zip: `project/deck.json` without MAWS's
// `dsOverrides`, every slide canonical with each design-system token resolved to its literal (the overrides applied
// first, as the deck's stage draws them; a token with neither a value nor a fallback takes its property out, since
// Claude's grammar has no `var()`), and each uploaded asset the deck draws or loads a face from moved under
// `project/ds/maws/<name>`, the slides and the index pointing there. A held slide is its held source, verbatim, as the
// mirror writes it. Portable: the caller gives the token values and the assets' bytes.
import { DECK_PATH, serializeDeckJson, slidePath, type DeckFace } from '../deck';
import type { ElementIR } from '../ir';
import { heldOf, readDeckJson, readSlide, slideOrder } from '../model';
import { serializeSlide } from '../serialize';
import type { Doc } from '../../yjs';

/** Where an uploaded asset (`assets/<name>`) goes in the export: an installed system's path Claude's loader takes. */
export const claudeAssetPath = (ref: string): string => `project/ds/maws/${ref.slice('assets/'.length)}`;

const rewrite = (children: ElementIR[], moved: (src: string) => string): ElementIR[] =>
  children.map((el) => ({
    ...el,
    attrs: el.tag === 'img' && el.attrs.src !== undefined ? { ...el.attrs, src: moved(el.attrs.src) } : el.attrs,
    children: rewrite(el.children, moved),
  }));

export interface ClaudeDeckOptions {
  /** A token's literal at the deck's scale with its overrides (the mirror's `deckTokenValues`). */
  resolveVar: (name: string) => string | undefined;
  /** The bytes of each uploaded asset the deck names, by ref (one missing stays named, unpacked). */
  assets: ReadonlyMap<string, Uint8Array>;
}

/** The export's files, path → content (text, or an asset's bytes). */
export function claudeDeckFiles(doc: Doc, { resolveVar, assets }: ClaudeDeckOptions): Record<string, string | Uint8Array> {
  const moved = (src: string) => (src.startsWith('assets/') ? claudeAssetPath(src) : src);
  const deck = readDeckJson(doc);
  delete deck.dsOverrides; // MAWS's, applied in the literals
  const used = new Set<string>();
  if (deck.faces) {
    const faces: Record<string, DeckFace> = {};
    for (const [key, face] of Object.entries(deck.faces)) {
      if (typeof face.src === 'string' && face.src.startsWith('assets/')) used.add(face.src);
      faces[key] = typeof face.src === 'string' ? { ...face, src: moved(face.src) } : face;
    }
    deck.faces = faces;
  }
  const files: Record<string, string | Uint8Array> = { [DECK_PATH]: serializeDeckJson(deck) };
  for (const id of slideOrder(doc)) {
    const held = heldOf(doc, id);
    if (held) {
      files[slidePath(id)] = held.source;
      continue;
    }
    const slide = readSlide(doc, id);
    const walk = (els: ElementIR[]) => {
      for (const el of els) {
        if (el.tag === 'img' && el.attrs.src?.startsWith('assets/')) used.add(el.attrs.src);
        walk(el.children);
      }
    };
    walk(slide.children);
    files[slidePath(id)] = serializeSlide({ ...slide, children: rewrite(slide.children, moved) }, { resolveVar });
  }
  for (const ref of [...used].sort()) {
    const bytes = assets.get(ref);
    if (bytes) files[claudeAssetPath(ref)] = bytes;
  }
  return files;
}
