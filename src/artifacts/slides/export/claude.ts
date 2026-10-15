// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D12 "For Claude"; parent Decision Log 12, 21): a deck
// as the files of Claude's Slides type, for the `claude` export's zip: `project/deck.json` without MAWS's
// `dsOverrides`, every slide canonical with each design-system token resolved to its literal (the overrides applied
// first, as the deck's stage draws them; a token with neither a value nor a fallback takes its property out, since
// Claude's grammar has no `var()`), and each uploaded asset the deck draws or loads a face from moved under
// `project/ds/maws/<name>`, the slides and the index pointing there; MAWS's pinned groups lowered into their hosts
// (lower.ts: Claude would flatten them and lose their transforms). A held slide has no Claude-readable form (its source
// failed the loader; its model is only its last good state): the export is refused, naming each held slide and its
// reasons (fix wave 1). Portable: the caller gives the token values and the assets' bytes.
import { DECK_PATH, serializeDeckJson, slidePath, type DeckFace } from '../deck';
import type { ElementIR } from '../ir';
import { heldOf, readDeckJson, readSlide, slideOrder } from '../model';
import { serializeSlide } from '../serialize';
import type { Doc } from '../../yjs';
import { lowerGroups } from './lower';
import { literalStyle } from './standalone';

/** Where an uploaded asset (`assets/<name>`) goes in the export: an installed system's path Claude's loader takes. */
export const claudeAssetPath = (ref: string): string => `project/ds/maws/${ref.slice('assets/'.length)}`;

// Each picture's source moved, each style literal (tokens resolved; a property with no value left out).
const rewrite = (children: ElementIR[], moved: (src: string) => string, resolveVar: (name: string) => string | undefined): ElementIR[] =>
  children.map((el) => ({
    ...el,
    attrs: el.tag === 'img' && el.attrs.src !== undefined ? { ...el.attrs, src: moved(el.attrs.src) } : el.attrs,
    style: literalStyle(el.style, resolveVar),
    children: rewrite(el.children, moved, resolveVar),
  }));

export interface ClaudeDeckOptions {
  /** A token's literal at the deck's scale with its overrides (the mirror's `deckTokenValues`). */
  resolveVar: (name: string) => string | undefined;
  /** The bytes of each uploaded asset the deck names, by ref (one missing stays named, unpacked). */
  assets: ReadonlyMap<string, Uint8Array>;
}

/** The export's files, path → content (text, or an asset's bytes). */
export function claudeDeckFiles(doc: Doc, { resolveVar, assets }: ClaudeDeckOptions): Record<string, string | Uint8Array> {
  const held = slideOrder(doc).flatMap((id) => {
    const h = heldOf(doc, id);
    return h ? [`slide ${id} is held (${h.reasons.join('; ')})`] : [];
  });
  if (held.length) throw new Error(`the presentation cannot be exported for Claude while slides are held: ${held.join('; ')}; fix or remove them first`);
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
    const slide = readSlide(doc, id);
    const walk = (els: ElementIR[]) => {
      for (const el of els) {
        if (el.tag === 'img' && el.attrs.src?.startsWith('assets/')) used.add(el.attrs.src);
        walk(el.children);
      }
    };
    walk(slide.children);
    // MAWS's pinned groups lowered to Claude's form (lower.ts), over literal geometry
    files[slidePath(id)] = serializeSlide({ ...slide, children: lowerGroups(rewrite(slide.children, moved, resolveVar)) }, { resolveVar });
  }
  for (const ref of [...used].sort()) {
    const bytes = assets.get(ref);
    if (bytes) files[claudeAssetPath(ref)] = bytes;
  }
  return files;
}
