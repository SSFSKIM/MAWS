// The compaction's row (UX wave U3b, M4; docs/doperpowers/plans/2026-11-15-ux-wave-U3b-transcript-rows-find.md,
// decisions 16 and 17, Interfaces §E): while the session compacts, one `activity` row at the end of the drawn list reads
// "Compacting session…" with the time so far. The view places it after every other projection of its rows; it is never
// derived, never in the store's rows, and no turn line's words change for it. The time comes from the mount (the app's
// compacting store, through the slots); this module imports nothing of the app.
import type { Row, RowId } from '../model/rows';

export const COMPACTING_ROW = 'activity:compacting' as RowId;

/** The drawn list with the compaction's row at its end, before a row that must stay last (U1b's end row, on a tree that
 *  has it); the list itself when `since` is null. */
export function compactingRow(rows: readonly Row[], since: number | null): readonly Row[] {
  if (since === null) return rows;
  const at = new Date(since).toISOString();
  return [...rows, { id: COMPACTING_ROW, turnId: null, at, kind: 'activity', activity: 'compacting', since: at }];
}
