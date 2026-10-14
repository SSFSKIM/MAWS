// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D6, D7; M3): what the agent's answers say of a deck
// beyond its files. A read names the slides held, with their reasons (the file it returns is the held source, which
// fails to load). A read and a publish name each picture and face whose source the deck's assets do not hold: MAWS
// draws only an uploaded asset (`assets/<name>`), so Claude's `/_blob/<id>` and `project/ds/<folder>/<file>`, kept
// verbatim, draw as a placeholder too (D6). Portable: A's tools call it on the host's doc.
import type { PublishWarning } from '../files';
import type { Doc } from '../yjs';
import { DECK_PATH, slideIdOf, slidePath } from './deck';
import { heldOf, readDeckJson, readFlat, slideOrder } from './model';

export const ASSET_PREFIX = 'assets/';

/** The deck's held slides in deck order, each with the reasons it was held. */
export function heldSlides(doc: Doc): { path: string; reasons: string[] }[] {
  return slideOrder(doc).flatMap((id) => {
    const held = heldOf(doc, id);
    return held ? [{ path: slidePath(id), reasons: held.reasons }] : [];
  });
}

/** Why `src` draws as a placeholder in this deck, or null when it draws (or names nothing, a placeholder by design). */
function missing(src: string, assets: ReadonlySet<string>): string | null {
  if (src.startsWith(ASSET_PREFIX)) return assets.has(src) ? null : `no asset ${src} in this deck (drawn as a placeholder): upload the file with artifact_upload_asset`;
  if (src === '') return null;
  return `${src} is a Claude reference with no asset in MAWS (drawn as a placeholder): upload the file with artifact_upload_asset and use its assets/<name> ref`;
}

/**
 * A warning for each picture and face whose source the deck's `assets` (their refs) do not hold: in every file, or in
 * the files at `paths` (a publish's changed files). A held slide is left out: its reasons already name it.
 */
export function assetWarnings(doc: Doc, assets: ReadonlySet<string>, paths?: readonly string[]): PublishWarning[] {
  const warnings: PublishWarning[] = [];
  const named = paths ? new Set(paths) : null;
  if (!named || named.has(DECK_PATH)) {
    for (const [key, face] of Object.entries(readDeckJson(doc).faces ?? {})) {
      const message = typeof face.src === 'string' ? missing(face.src, assets) : null;
      if (message) warnings.push({ path: DECK_PATH, property: `faces.${key}`, message });
    }
  }
  const slides = named ? [...named].flatMap((path) => slideIdOf(path) ?? []) : slideOrder(doc);
  for (const slide of slides) {
    if (heldOf(doc, slide)) continue;
    for (const element of readFlat(doc, slide, false)) {
      const src = element.tag === 'img' ? element.attrs.src : undefined;
      const message = typeof src === 'string' ? missing(src, assets) : null;
      if (message) warnings.push({ path: slidePath(slide), slide, element: element.id, property: 'src', message });
    }
  }
  return warnings;
}
