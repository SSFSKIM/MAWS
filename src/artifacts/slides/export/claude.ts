// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D12 "For Claude"; parent Decision Log 12, 21): a deck
// as the files of Claude's Slides type, for the `claude` export's zip: `project/deck.json` without MAWS's
// `dsOverrides`, every slide canonical with each design-system token resolved to its literal (the overrides applied
// first, as the deck's stage draws them; a token with neither a value nor a fallback takes its property out, since
// Claude's grammar has no `var()`), and each uploaded asset the deck draws or loads a face from moved under
// `project/ds/maws/<name>`, the slides and the index pointing there; MAWS's pinned groups lowered into their hosts
// (lower.ts: Claude would flatten them and lose their transforms). A held slide has no Claude-readable form (its source
// failed the loader; its model is only its last good state): the export is refused, naming each held slide and its
// reasons (fix wave 1). P4-B2 D19 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md): a Google Fonts face is
// written without the engine host's record of its fetch, which is MAWS's: Claude's format names the face by its `href`
// and fetches it itself, so the files MAWS saved for it stay out of the zip. Portable: the caller gives the token values
// and the assets' bytes.
import { mapStyleMapAssets, slideAssetRefs } from '../asset-refs';
import { DECK_PATH, serializeDeckJson, slidePath, withoutRecord, type DeckFace } from '../deck';
import type { ElementIR } from '../ir';
import { heldOf, readDeckJson, readSlide, slideOrder } from '../model';
import { loadSlide } from '../parse';
import { serializeSlide } from '../serialize';
import type { Doc } from '../../yjs';
import { lowerGroups, MeasureNeeded } from './lower';
import type { MeasuredDeck, MeasuredElement } from './measure';
import { literalStyle } from './standalone';

/** Where an uploaded asset (`assets/<name>`) goes in the export: an installed system's path Claude's loader takes. */
export const claudeAssetPath = (ref: string): string => `project/ds/maws/${ref.slice('assets/'.length)}`;

// A style literal (tokens resolved; a property with no value left out), its assets' urls moved with the pictures (A13).
const movedStyle = (style: Readonly<Record<string, string>>, resolveVar: (name: string) => string | undefined): Record<string, string> => mapStyleMapAssets(literalStyle(style, resolveVar), (ref) => `url(${claudeAssetPath(ref)})`);

// Each picture's source moved, each style literal with its urls moved.
const rewrite = (children: ElementIR[], moved: (src: string) => string, resolveVar: (name: string) => string | undefined): ElementIR[] =>
  children.map((el) => ({
    ...el,
    attrs: el.tag === 'img' && el.attrs.src !== undefined ? { ...el.attrs, src: moved(el.attrs.src) } : el.attrs,
    style: movedStyle(el.style, resolveVar),
    children: rewrite(el.children, moved, resolveVar),
  }));

export interface ClaudeDeckOptions {
  /** A token's literal at the deck's scale with its overrides (the mirror's `deckTokenValues`). */
  resolveVar: (name: string) => string | undefined;
  /** The bytes of each uploaded asset the deck names, by ref (one missing stays named, unpacked). */
  assets: ReadonlyMap<string, Uint8Array>;
  /** The export window's measure, when lowering a group needs it (`MeasureNeeded`). */
  measured?: MeasuredDeck;
}

/** The export's files, path → content (text, or an asset's bytes). */
export function claudeDeckFiles(doc: Doc, { resolveVar, assets, measured }: ClaudeDeckOptions): Record<string, string | Uint8Array> {
  const bySlide = new Map((measured?.slides ?? []).map((s) => [s.id, new Map(s.elements.map((e) => [e.id, e]))]));
  const measuredOf = (id: string) => (measured ? (bySlide.get(id) ?? new Map<string, MeasuredElement>()) : null);
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
      const own = withoutRecord(face); // D19: the host's record stays MAWS's
      faces[key] = typeof own.src === 'string' ? { ...own, src: moved(own.src) } : own;
    }
    deck.faces = faces;
  }
  const files: Record<string, string | Uint8Array> = { [DECK_PATH]: serializeDeckJson(deck) };
  for (const id of slideOrder(doc)) {
    const slide = readSlide(doc, id);
    for (const ref of slideAssetRefs(slide)) used.add(ref);
    // MAWS's pinned groups lowered to Claude's form (lower.ts), over literal geometry; a pose the dialect cannot write
    // refuses the export, and a place the model cannot give asks for the window's measure (`MeasureNeeded`)
    const ctx = { slideId: id, measured: measuredOf(id) };
    let children: ElementIR[];
    try {
      children = lowerGroups(rewrite(slide.children, moved, resolveVar), null, ctx);
    } catch (error) {
      if (error instanceof MeasureNeeded) throw error;
      throw new Error(`the presentation cannot be exported for Claude: ${(error as Error).message}`, { cause: error });
    }
    const file = serializeSlide({ ...slide, style: movedStyle(slide.style, resolveVar), children }, { resolveVar });
    // the lowered slide is a slide of its own: the loader judges it (A7), since lifting members may cross a limit (two
    // groups of 13 pinned members each make 26 pinned children of their host)
    const loaded = loadSlide(file, { fileId: id });
    if (!loaded.ok) throw new Error(`the presentation cannot be exported for Claude: slide ${id} would not load once its groups are lowered to Claude's form (${loaded.held.reasons.join('; ')})`);
    files[slidePath(id)] = file;
  }
  for (const ref of [...used].sort()) {
    const bytes = assets.get(ref);
    if (bytes) files[claudeAssetPath(ref)] = bytes;
  }
  return files;
}
