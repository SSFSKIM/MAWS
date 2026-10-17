// P3-E1 M2 (the parent's §1 "Publish": `artifact_read` answers `warnings?` and `held?` as C's answers do): what the
// agent's answers say of a design beyond its files, by board path. C's deck answers (`slides/answer.ts`) are reused over
// the same roots, their deck paths read as the design's (`project/deck.json` → `project/canvas.json`, a slide's file →
// its board's). Portable: A's tools call it on the host's doc.
import type { PublishWarning } from '../files';
import { assetWarnings, heldSlides } from '../slides/answer';
import { DECK_PATH, slideIdOf, slidePath } from '../slides/deck';
import type { Doc } from '../yjs';
import { boardIdOf, boardPath, CANVAS_PATH } from './canvas';

const toDesign = (path: string): string => (path === DECK_PATH ? CANVAS_PATH : slideIdOf(path) !== null ? boardPath(slideIdOf(path)!) : path);
const toDeck = (path: string): string => (path === CANVAS_PATH ? DECK_PATH : boardIdOf(path) !== null ? slidePath(boardIdOf(path)!) : path);

/** The design's held boards in order, each with the reasons it was held. */
export function heldBoards(doc: Doc): { path: string; reasons: string[] }[] {
  return heldSlides(doc).map((held) => ({ ...held, path: toDesign(held.path) }));
}

/** A warning for each picture and face whose source the design's assets do not hold, in every file or in `paths`. */
export function boardAssetWarnings(doc: Doc, assets: ReadonlySet<string>, paths?: readonly string[]): PublishWarning[] {
  return assetWarnings(doc, assets, paths?.map(toDeck)).map((warning) => ({ ...warning, path: toDesign(warning.path) }));
}
