// The rows MAWS's list draws for a transcript, in its order: what an index handed to its `scrollToIndex` counts, and
// what a page of older rows has to grow to have drawn anything. MAWS's `Transcript` (`transcript/view/Transcript.tsx`)
// draws the store's rows with its `tail` after them, and while the report is the view, the report's projection of
// those (`reportRows`): a marked turn's work folded into one working record, its unmarked text hidden. So in the report
// the store's raw rows are neither the list's indices nor its height. This is the same composition, from the same
// exported functions, read off the store when asked. The desk adds no browser activity (MAWS's attachment of it is fed
// by its own app alone), and passes no withdrawn prompts and no start index, so those parts of the composition are none.
import { useMemo } from 'react';
import { liveMarkedRowIds, reportRows, reportViewOf } from '../../../../../src/renderer/src/owner/report/project';
import { useTranscriptStore, type TranscriptEntry } from '../../../../../src/renderer/src/stores/transcript';
import { withQueueTail } from '../../../../../src/renderer/src/transcript/model/derive';
import type { Row } from '../../../../../src/renderer/src/transcript/model/rows';

const NO_ROWS: Row[] = [];
const NONE_WITHDRAWN: ReadonlySet<string> = new Set();

function project(entry: TranscriptEntry | undefined, rows: Row[], tail: readonly Row[], liveMarked: string): Row[] {
  const queued = withQueueTail(rows, NONE_WITHDRAWN, tail);
  return entry && reportViewOf(entry.state.ui) ? reportRows(queued, entry.state, { reportOpenTurns: entry.state.ui.reportOpenTurns }, liveMarked) : queued;
}

/** The rows the list draws now for the store key, its `tail` after the store's. */
export function drawnRows(key: string, tail: readonly Row[]): Row[] {
  const entry = useTranscriptStore.getState().entries[key];
  return project(entry, entry?.rows ?? NO_ROWS, tail, reportViewOf(entry?.state.ui) ? liveMarkedRowIds(entry?.state) : '');
}

/**
 * How many of the store's rows the list draws (its tail aside): the rows' count, or in the report its projection's.
 * Read again with what MAWS's view reads to project them, so it follows a page, a fold opened, a mark streaming in.
 */
export function useDrawnRowCount(key: string): number {
  const rows = useTranscriptStore((s) => s.entries[key]?.rows ?? NO_ROWS);
  const report = useTranscriptStore((s) => reportViewOf(s.entries[key]?.state.ui));
  const openRecords = useTranscriptStore((s) => s.entries[key]?.state.ui.reportOpenTurns);
  const liveMarked = useTranscriptStore((s) => (report ? liveMarkedRowIds(s.entries[key]?.state) : ''));
  return useMemo(
    () => (report ? project(useTranscriptStore.getState().entries[key], rows, NO_ROWS, liveMarked).length : rows.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the open records are read off the entry, as MAWS's view reads them
    [key, rows, report, openRecords, liveMarked],
  );
}
