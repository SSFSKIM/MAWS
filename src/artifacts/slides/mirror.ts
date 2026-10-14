// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D7): the deck's linked-directory mirror (P3-L's
// `registerMirrorWriter`): `<slug>/deck.json` and `<slug>/slides/<id>.html`, Claude-readable on disk. Every design-system
// token is replaced by its value in the governing system at the deck's scale, the deck's own overrides set over the
// system's (as its stage sets them) and then left out of the index; a token neither the system nor its fallback gives a
// value takes its property out (Claude's grammar has no `var()`). A held slide is its held source, verbatim. Portable:
// the engine host's presentation module gives it the governing system's tokens.
import type { Artifact } from '@shared/artifacts/entity';
import { tokenProperties } from '../design-system/css';
import { overrideLiterals } from '../design-system/literals';
import type { TokenSet } from '../design-system/tokens';
import type { TokenOverrides } from '../design-system/view';
import { mirrorSlug, type MirrorWriter } from '../library/mirror';
import { serializeDeckJson } from './deck';
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
  return ({ artifact, doc }) => {
    if (!doc) return { files: {} };
    const folder = mirrorSlug(artifact);
    const { dsOverrides, ...deck } = readDeckJson(doc);
    const resolveVar = deckTokenValues(tokensOf(artifact), dsOverrides);
    const files: Record<string, string> = { [`${folder}/deck.json`]: serializeDeckJson(deck) };
    for (const id of slideOrder(doc)) files[`${folder}/slides/${id}.html`] = heldOf(doc, id)?.source ?? serializeSlide(readSlide(doc, id), { resolveVar });
    return { files };
  };
}
