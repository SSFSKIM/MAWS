// UX wave U3b (M4): the red step's stub; the row follows in the next commit.
import type { Row, RowId } from '../model/rows';

export const COMPACTING_ROW = 'activity:compacting' as RowId;
export function compactingRow(rows: readonly Row[], _since: number | null): readonly Row[] {
  return rows;
}
