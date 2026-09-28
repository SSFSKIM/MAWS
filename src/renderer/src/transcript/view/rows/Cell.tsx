// A standalone cell row (X3 `cell`): a call that stands outside any group, a denied or stopped one, one the human
// decided, an image result, or the one visible call of a completed group. A denied cell is the divider count's jump
// target, so it takes focus itself.
import type { Row } from '../../model/rows';
import { CellLine } from '../cells/CellLine';

export function CellRow({ row }: { row: Extract<Row, { kind: 'cell' }> }) {
  return (
    <div className="transcript-standalone">
      <CellLine cell={row} turnId={row.turnId} focusable={row.status === 'denied'} />
    </div>
  );
}
