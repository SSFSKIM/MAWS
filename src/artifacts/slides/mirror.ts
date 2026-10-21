// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D7): the deck's linked-directory mirror (P3-L's
// `registerMirrorWriter`): `<slug>/deck.json` and `<slug>/slides/<id>.html`, Claude-readable on disk. Every design-system
// token is replaced by its value in the governing system at the deck's scale, the deck's own overrides set over the
// system's (as its stage sets them) and then left out of the index; a token neither the system nor its fallback gives a
// value takes its property out (Claude's grammar has no `var()`). A held slide is its held source, verbatim. The
// uploaded assets the deck names (pictures, CSS backgrounds, faces) are copied into `<slug>/assets/`, so its deck-root
// references resolve in the folder as a design system's do (Decision Log 37 (1)); a Google Fonts face the engine host
// fetched is the files it saved and their licence (P4-B2 D19's `faceAssetRefs`). Portable: the engine host's
// presentation module gives it the governing system's tokens.
import type { Artifact } from '@shared/artifacts/entity';
import { tokenProperties } from '../design-system/css';
import { overrideLiterals } from '../design-system/resolve-vars';
import type { TokenSet } from '../design-system/tokens';
import type { TokenOverrides } from '../design-system/view';
import { mirrorSlug, type MirrorOutput, type MirrorWriter } from '../library/mirror';
import { slideAssetRefs } from './asset-refs';
import { faceAssetRefs, serializeDeckJson } from './deck';
import { heldOf, readDeckJson, readSlide, slideOrder } from './model';
import { serializeSlide } from './serialize';

/**
 * The value of each `--ds-*` name in a deck, as its stage draws it: P3-D's literal resolver over the system's values at
 * the deck's scale (none when the system's tokens do not resolve, or there is no system) with the deck's overrides on
 * top, an override in a reference cycle, or resolving to nothing, dropped so its name keeps the system's value.
 */
export function deckTokenValues(tokens: TokenSet | null, overrides?: TokenOverrides): (name: string) => string | undefined {
  let system = new Map<string, string>();
  try {
    if (tokens) system = tokenProperties(tokens, 'deck');
  } catch {
    // a system mid-edit whose tokens do not resolve: every token takes its fallback
  }
  const values = overrideLiterals(system, overrides);
  return (name) => values.get(name);
}

/** The writer, over `tokensOf`: the tokens of the system governing an artifact, null when none can be read. */
export function presentationMirrorWriter(tokensOf: (artifact: Artifact) => TokenSet | null): MirrorWriter {
  return ({ artifact, doc, assets = [], readAsset }) => {
    if (!doc) return { files: {} };
    const folder = mirrorSlug(artifact);
    const { dsOverrides, ...deck } = readDeckJson(doc);
    const resolveVar = deckTokenValues(tokensOf(artifact), dsOverrides);
    const files: MirrorOutput['files'] = { [`${folder}/deck.json`]: serializeDeckJson(deck) };
    const used = new Set<string>();
    for (const face of Object.values(deck.faces ?? {})) for (const ref of faceAssetRefs(face)) used.add(ref);
    for (const id of slideOrder(doc)) {
      const held = heldOf(doc, id);
      const slide = held ? null : readSlide(doc, id);
      if (slide) for (const ref of slideAssetRefs(slide)) used.add(ref);
      files[`${folder}/slides/${id}.html`] = held?.source ?? serializeSlide(slide!, { resolveVar });
    }
    // the assets the deck names, beside its slides where its deck-root references (`assets/<name>`) find them (A14);
    // each a copy, read only when the mirror lacks it (a ref names one content for good)
    if (readAsset) for (const { ref } of assets) if (used.has(ref)) files[`${folder}/${ref}`] = { read: () => readAsset(ref) };
    return { files };
  };
}
