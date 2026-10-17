// P3-E1 M1 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md; the parent's §1 "Publish, repair, restore,
// history", XE7): the design kind's host-side behaviour on A's `KindAdapter`. The design's model is C's roots, so C's
// presentation adapter's hooks apply as they are and are composed, not copied: the repair after every update and restore
// scoped to the boards an update touched, the threads mirror, the last text a removal keeps (a replica's frame, a publish,
// a restore), and a restore that keeps every conversation since the version (`conversationsSince`). The design replaces
// the seed, the files and their paths, the publish (its manifest beside C's board publish), the turn's summary, and adds
// its frame repair beside C's. Portable: M2 registers it in the engine host; P4's network store the same.
import { readFiles } from '../files';
import type { KindAdapter } from '../host';
import { createPresentationAdapter } from '../slides/adapter';
import { importSlide } from '../slides/model';
import { captureQuotes, storeDeletedQuotes } from '../slides/threads';
import { transact, type Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { boardIdOf, CANVAS_PATH, FRAME_KEYS, frameProblems } from './canvas';
import { isLegacyDesign, migrateDesign, withDesignModel } from './migrate';
import { designFiles, designPaths, repairBoards, writeBoardEntry, writeCanvasKeys } from './model';
import { publishCanvas } from './publish';
import { blankBoard } from './writers';

export const FIRST_BOARD = { id: 'desktop', title: 'Desktop', frame: { x: 0, y: 0, w: 1440, h: 1024 } } as const;

/** A new design's manifest and its first board (a blank desktop screen on the design system's ground), in one transaction. */
export function writeInitialDesign(doc: Doc, title: string): void {
  transact(doc, () => {
    writeCanvasKeys(doc, { v: 1, title, boards: {}, order: [] });
    importSlide(doc, blankBoard(FIRST_BOARD.id), 'a0');
    writeBoardEntry(doc, FIRST_BOARD.id, { ...FIRST_BOARD.frame, title: FIRST_BOARD.title });
  });
}

/**
 * "Published N boards (M changed, K added, J removed)" over a turn's publish answers (`changed`, `added`, `removed`),
 * "Published the design’s canvas" when only the manifest changed; then the lines of its thread answers, one per line.
 */
export function summarizeDesignTurn(results: unknown[]): string {
  const lines = results.flatMap((result) => {
    const line = (result as { line?: unknown } | null)?.line;
    return typeof line === 'string' ? [line] : [];
  });
  const publishes = results.filter((result) => typeof result === 'object' && result !== null && typeof (result as { line?: unknown }).line !== 'string') as Record<string, unknown>[];
  if (publishes.length === 0 && lines.length > 0) return lines.join('\n');
  const paths = (v: unknown): string[] => (Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string') : []);
  const [added, changed, removed] = [new Set<string>(), new Set<string>(), new Set<string>()];
  let canvas = false;
  for (const r of publishes) {
    const fresh = new Set(paths(r.added));
    for (const p of paths(r.removed)) {
      if (boardIdOf(p) === null) continue;
      if (added.delete(p)) continue; // added and removed in one turn: nothing
      changed.delete(p);
      removed.add(p);
    }
    for (const p of paths(r.changed)) {
      if (p === CANVAS_PATH) canvas = true;
      if (boardIdOf(p) === null) continue;
      if (fresh.has(p)) {
        removed.delete(p);
        added.add(p);
      } else if (!added.has(p)) changed.add(p);
    }
  }
  const n = added.size + changed.size + removed.size;
  const summary = n === 0 ? (canvas ? 'Published the design’s canvas' : 'Published the design') : `Published ${n} board${n === 1 ? '' : 's'} (${changed.size} changed, ${added.size} added, ${removed.size} removed)`;
  return [summary, ...lines].join('\n');
}

export function createDesignAdapter(options: { now?: () => Date } = {}): KindAdapter {
  const deck = createPresentationAdapter(options);
  return {
    ...deck,
    kind: 'design',
    initial: (doc, { title }) => writeInitialDesign(doc, title),
    // M2: a legacy state (a retained version from before the migration) reads as the files it was (Decision Log 11 (1))
    readFiles: (doc) => (isLegacyDesign(doc) ? readFiles(doc) : designFiles(doc)),
    paths: (doc) => (isLegacyDesign(doc) ? Object.keys(readFiles(doc)) : designPaths(doc)),
    migrate: migrateDesign, // M2: the store's `ensureMigrated` runs it before live access
    // the agent's publish: the commented elements' quotes read first, stored for those its removals take away (C's rule)
    publish: (live, base, sent, force) => {
      const quotes = captureQuotes(live);
      const outcome = publishCanvas(live, base, sent, force);
      if (quotes.size > 0) storeDeletedQuotes(live, quotes);
      return outcome;
    },
    // C's repair and threads mirror, then the frames of the boards the update touched, as the triggering actor's write
    // (the parent's Decision Log 17: the one place a frame is bounded). Every single-writer route refuses an invalid frame
    // before it writes: the loader and publish (`frameProblems` on the sent and merged frames), the board writers, the
    // duplicate, and a restore (`revertScope` below); C's element writers and the dialect never write the frame keys. So
    // an update that reaches the host leaving a frame outside the rules is a merge of valid concurrent writes (a replica's
    // frame, or a reconnect's), which no one can be asked to redo: rejecting it would evict and replay it (A's Decision
    // Log 26), so it is bounded deterministically instead.
    afterUpdate: (live, info) => {
      const answer = deck.afterUpdate!(live, info);
      const touched = Y.touchedSlides(live, info.update);
      repairBoards(live, touched === null ? {} : { boards: touched });
      return answer;
    },
    // A restore writes the version's boards as they were: one whose frame breaks the rules (a state no writer of this
    // build makes) is refused before anything is written, never clamped.
    // M2: a version from before the migration is checked as its migration would build it, so a restore that could not
    // migrate is refused before it writes; `afterRestore` then migrates it in the restore's own frame.
    revertScope: (live, old, info) => {
      if (isLegacyDesign(old)) withDesignModel(old, () => undefined);
      const problems = Y.slideIds(old).flatMap((id) => {
        const s = Y.slideScalars(old, id);
        if (FRAME_KEYS.some((k) => s[k] === undefined)) return [`board ${id}: a frame has x, y, w and h`];
        return frameProblems(id, s);
      });
      if (problems.length > 0) throw new Error(`the version cannot be restored: ${problems.join('; ')}`);
      return deck.revertScope!(live, old, info);
    },
    // M2: a restore that brought back a legacy state migrates it synchronously inside the restore's frame, before its
    // version and announcement, as the restorer; C's after-effects then see the boards (and their anchors) it rebuilt.
    afterRestore: (live, info) => {
      migrateDesign(live);
      return deck.afterRestore!(live, info);
    },
    summarizeTurn: summarizeDesignTurn,
  };
}
