// The rows MAWS's list draws for a transcript, in its order: what an index handed to its `scrollToIndex` counts, and
// what a page of older rows has to grow to have drawn anything. MAWS's `Transcript` (`transcript/view/Transcript.tsx`)
// draws the store's rows with its `tail` after them, and while the to-human view is in force and MAWS draws it, the
// mirror of those (`mirrorRows`, UX wave U2b): each stretch of work between two rows the person reads one record line
// until it is opened. So in the view the store's raw rows are neither the list's indices nor its height. This is the
// same composition, from the same exported functions, read off the store when asked. The desk adds no browser activity
// (MAWS's attachment of it is fed by its own app alone), and passes no withdrawn prompts and no start index, so those
// parts of the composition are none. While the session is at rest, the turn it was running draws closed
// (`restingRows`), here as there. UX wave U2b (M7): the record lines' labels are not passed here: a label changes a
// line's words and never which rows are drawn, so the count is the same without them.
import { useMemo } from 'react';
import { liveMarkedRowIds, liveMarksOf, mirrorRows, mirrorsView } from '../../owner/view/mirror';
import { useTranscriptStore, type TranscriptEntry } from '../../stores/transcript';
import { restingRows, withQueueTail } from '../../transcript/model/derive';
import type { Row } from '../../transcript/model/rows';

const NO_ROWS: Row[] = [];
const NONE_WITHDRAWN: ReadonlySet<string> = new Set();

/** The stretches the reader opened in the view. */
type OpenStretches = TranscriptEntry['state']['ui']['openStretches'];

/** The store's entry for the key as it is now: what the composition reads of the turns it draws at rest. */
const entryOf = (key: string): TranscriptEntry | undefined => useTranscriptStore.getState().entries[key];

function project(entry: TranscriptEntry | undefined, rows: Row[], tail: readonly Row[], mirrored: boolean, openStretches: OpenStretches, liveMarked: string, atRest: boolean): Row[] {
  const queued = withQueueTail(atRest && entry ? restingRows(entry.state, rows) : rows, NONE_WITHDRAWN, tail);
  return mirrored ? mirrorRows(queued, { openStretches }, liveMarksOf(liveMarked, tail)) : queued;
}

/** The rows the list draws now for the store key, its `tail` after the store's; `atRest` as the view is told it. */
export function drawnRows(key: string, tail: readonly Row[], atRest = false): Row[] {
  const entry = entryOf(key);
  const mirrored = mirrorsView(entry?.state.ui);
  return project(entry, entry?.rows ?? NO_ROWS, tail, mirrored, entry?.state.ui.openStretches, mirrored ? liveMarkedRowIds(entry?.state) : '', atRest);
}

/**
 * How many of the store's rows the list draws (its tail aside): the rows' count, or in the view its mirror's. Read
 * again with what MAWS's view reads to mirror them, each through the subscription, so it follows a page, a stretch
 * opened, a mark streaming in.
 */
export function useDrawnRowCount(key: string, atRest = false): number {
  const rows = useTranscriptStore((s) => s.entries[key]?.rows ?? NO_ROWS);
  const mirrored = useTranscriptStore((s) => mirrorsView(s.entries[key]?.state.ui));
  const openStretches = useTranscriptStore((s) => s.entries[key]?.state.ui.openStretches);
  const liveMarked = useTranscriptStore((s) => (mirrored ? liveMarkedRowIds(s.entries[key]?.state) : ''));
  return useMemo(
    () => (mirrored || atRest ? project(entryOf(key), rows, NO_ROWS, mirrored, openStretches, liveMarked, atRest).length : rows.length),
    [key, rows, mirrored, openStretches, liveMarked, atRest],
  );
}
