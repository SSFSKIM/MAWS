// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D7): the deck's linked-directory mirror (P3-L's
// `registerMirrorWriter`): `<slug>/deck.json` and `<slug>/slides/<id>.html`, Claude-readable on disk. Every design-system
// token is replaced by its value in the governing system at the deck's scale, the deck's own overrides set over the
// system's (as its stage sets them) and then left out of the index; a token neither the system nor its fallback gives a
// value takes its property out (Claude's grammar has no `var()`). A held slide is its held source, verbatim. Portable:
// the engine host's presentation module gives it the governing system's tokens.
import type { Artifact } from '@shared/artifacts/entity';
import { tokenProperties } from '../design-system/css';
import type { TokenSet } from '../design-system/tokens';
import { safeOverrides, type TokenOverrides } from '../design-system/view';
import { mirrorSlug, type MirrorWriter } from '../library/mirror';
import { resolveVars } from './css';
import { serializeDeckJson } from './deck';
import { heldOf, readDeckJson, readSlide, slideOrder } from './model';
import { serializeSlide } from './serialize';

/**
 * The value of each `--ds-*` name in a deck: the system's at the deck's scale (none when the system's tokens do not
 * resolve, or there is no system), each of the deck's overrides over it, an override's own `var()`s resolved against
 * the others and the system (one in a cycle, or resolving to nothing, keeps the system's value).
 */
export function deckTokenValues(tokens: TokenSet | null, overrides?: TokenOverrides): (name: string) => string | undefined {
  let system = new Map<string, string>();
  try {
    if (tokens) system = tokenProperties(tokens, 'deck');
  } catch {
    // a system mid-edit whose tokens do not resolve: every token takes its fallback
  }
  const own = new Map(safeOverrides(overrides));
  const settled = new Map<string, string | undefined>();
  const resolving = new Set<string>();
  const valueOf = (name: string): string | undefined => {
    const override = own.get(name);
    if (override === undefined) return system.get(name);
    if (settled.has(name)) return settled.get(name);
    if (resolving.has(name)) return undefined; // a cycle
    resolving.add(name);
    const literal = resolveVars(override, valueOf) ?? undefined;
    resolving.delete(name);
    settled.set(name, literal ?? system.get(name));
    return settled.get(name);
  };
  return valueOf;
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
