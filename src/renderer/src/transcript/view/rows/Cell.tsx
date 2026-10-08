// A standalone cell row (X3 `cell`): a call that stands outside any group, a denied or stopped one, one the human
// decided, an image result, or the one visible call of a completed group. A denied cell is the divider count's jump
// target, so it takes focus itself. E13: a cua_repl `js` call (always standalone) shows what it did in the in-app
// browser under its line.
import { isCuaJsTool } from '../../model/classify'; // E13
import type { Row } from '../../model/rows';
import { SurfaceCellLine } from '../../surface/Tools';
import { BrowserActivityLines } from './BrowserActivity'; // E13

export function CellRow({ row }: { row: Extract<Row, { kind: 'cell' }> }) {
  return (
    <div className="transcript-standalone">
      <SurfaceCellLine standalone cell={row} turnId={row.turnId} focusable={row.status === 'denied'} />
      {row.toolUseId !== null && isCuaJsTool(row.toolName) && <BrowserActivityLines toolUseId={row.toolUseId} /> /* E13: what it did in the browser */}
    </div>
  );
}
