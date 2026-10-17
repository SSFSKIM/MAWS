// P3-E1 M2 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md; the parent's Decision Log 11 (1) and 13 (3)):
// a design made before E1 held its agent's files uninterpreted in A's generic `files` root (relative path → whole text).
// `migrateDesign` is the adapter's `migrate`: it publishes those files into the model exactly as an agent's first
// publish would (`publishCanvas` on an empty base, so the warned defaults, held boards and missing-source entries are
// the publish's), then empties the generic root, in the caller's transaction; the publish plans on a scratch copy and
// writes nothing when it refuses, so the files go only after the whole model validated. `withDesignModel` is the
// read-only projection the mirror, history and export use for a legacy state they must not write (a startup mirror, a
// retained version): the same migration on a temporary copy. Portable.
import { FilesError, publishFiles, readFiles } from '../files';
import { applyV2, newDoc, stateV2, transact, type Doc } from '../yjs';
import { publishCanvas } from './publish';

/** Whether the doc still holds a design in the generic file model (its `files` root holds a file). */
export const isLegacyDesign = (doc: Doc): boolean => Object.keys(readFiles(doc)).length > 0;

/**
 * Builds the design model from the generic files and empties them, in one transaction; answers whether it wrote. A
 * design without generic files answers false and writes nothing. Input the model cannot hold (an unreadable manifest, a
 * reserved key, a path that is no design file, a frame outside the caps) throws `FilesError` naming it, writing nothing;
 * so does a doc that already holds boards beside generic files, rather than either silently winning.
 */
export function migrateDesign(doc: Doc): boolean {
  const files = readFiles(doc);
  const paths = Object.keys(files);
  if (paths.length === 0) return false;
  transact(doc, () => {
    const outcome = publishCanvas(doc, {}, files, false);
    if (outcome.conflicts.length > 0) throw new FilesError(outcome.conflicts.map((c) => ({ path: c.path, message: `already in the design's model beside its generic files${c.detail ? ` (${c.detail})` : ''}` })));
    publishFiles(doc, files, Object.fromEntries(paths.map((path) => [path, null])), false);
  });
  return true;
}

/** `use` over the design's model: the doc itself when it holds one, else a migrated temporary copy, destroyed after. */
export function withDesignModel<T>(doc: Doc, use: (model: Doc) => T): T {
  if (!isLegacyDesign(doc)) return use(doc);
  const copy = newDoc();
  try {
    applyV2(copy, stateV2(doc));
    migrateDesign(copy);
    return use(copy);
  } finally {
    copy.destroy();
  }
}
