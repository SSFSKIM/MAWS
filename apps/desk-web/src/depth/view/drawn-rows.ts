// The rows MAWS's list draws for a transcript, in its order: what an index handed to its `scrollToIndex` counts, and
// what a page of older rows has to grow to have drawn anything. MAWS's `Transcript` (`transcript/view/Transcript.tsx`)
// draws the store's rows with its `tail` after them, and while the report is the view, the report's projection of
// those (`reportRows`): a marked turn's work folded into one working record, its unmarked text hidden. So in the report
// the store's raw rows are neither the list's indices nor its height. This is the same composition, from the same
// exported functions, read off the store when asked. The desk adds no browser activity (MAWS's attachment of it is fed
// by its own app alone), and passes no withdrawn prompts and no start index, so those parts of the composition are none.
// While the session is at rest, the turn it was running draws closed (`restingRows`), here as there.
import { useMemo } from 'react';
import { liveMarkedRowIds, reportRows, reportViewOf } from '../../../../../src/renderer/src/owner/report/project';
import { useTranscriptStore, type TranscriptEntry } from '../../../../../src/renderer/src/stores/transcript';
import { restingRows, withQueueTail } from '../../../../../src/renderer/src/transcript/model/derive';
import type { Row } from '../../../../../src/renderer/src/transcript/model/rows';

const NO_ROWS: Row[] = [];
const NONE_WITHDRAWN: ReadonlySet<string> = new Set();

/** The marked turns whose working record the reader opened in the report. */
type OpenRecords = TranscriptEntry['state']['ui']['reportOpenTurns'];

/** The store's entry for the key as it is now: what the projection reads of the turns it folds. */
const entryOf = (key: string): TranscriptEntry | undefined => useTranscriptStore.getState().entries[key];

function project(entry: TranscriptEntry | undefined, rows: Row[], tail: readonly Row[], openRecords: OpenRecords, liveMarked: string, atRest: boolean): Row[] {
  const queued = withQueueTail(atRest && entry ? restingRows(entry.state, rows) : rows, NONE_WITHDRAWN, tail);
  return entry && reportViewOf(entry.state.ui) ? reportRows(queued, entry.state, { reportOpenTurns: openRecords }, liveMarked) : queued;
}

/** The rows the list draws now for the store key, its `tail` after the store's; `atRest` as the view is told it. */
export function drawnRows(key: string, tail: readonly Row[], atRest = false): Row[] {
  const entry = entryOf(key);
  return project(entry, entry?.rows ?? NO_ROWS, tail, entry?.state.ui.reportOpenTurns, reportViewOf(entry?.state.ui) ? liveMarkedRowIds(entry?.state) : '', atRest);
}

/**
 * How many of the store's rows the list draws (its tail aside): the rows' count, or in the report its projection's.
 * Read again with what MAWS's view reads to project them, each through the subscription, so it follows a page, a fold
 * opened, a mark streaming in; the turns the projection folds are read off the entry when those change, as MAWS's view
 * reads them.
 */
export function useDrawnRowCount(key: string, atRest = false): number {
  const rows = useTranscriptStore((s) => s.entries[key]?.rows ?? NO_ROWS);
  const report = useTranscriptStore((s) => reportViewOf(s.entries[key]?.state.ui));
  const openRecords = useTranscriptStore((s) => s.entries[key]?.state.ui.reportOpenTurns);
  const liveMarked = useTranscriptStore((s) => (report ? liveMarkedRowIds(s.entries[key]?.state) : ''));
  return useMemo(
    () => (report || atRest ? project(entryOf(key), rows, NO_ROWS, openRecords, liveMarked, atRest).length : rows.length),
    [key, rows, report, openRecords, liveMarked, atRest],
  );
}
