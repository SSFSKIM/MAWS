// Adjacent tool calls share one quiet block. Every call's summary is visible; its input/output is one disclosure
// away, not behind an additional group fold. Thinking and internal bookkeeping remain available on demand.
import { Fragment, type ReactNode } from 'react';
import { useTranscriptStore } from '../../../stores/transcript';
import { DisclosureBody } from '../../../ui/disclosure';
import type { Cell, Row } from '../../model/rows';
import { CellLine, FilePathsContext } from '../cells/CellLine';
import { useTranscriptContext } from '../context';
import { Chevron, LineCounts } from './parts';
import { LiveThinkingCellLabel } from './ThinkingLabel';

type GroupRowData = Extract<Row, { kind: 'group' }>;

export function GroupRow({ row, renderCell }: { row: GroupRowData; renderCell?: (cell: Cell) => ReactNode }) {
  const { storeKey } = useTranscriptContext();
  const visible = row.cells.filter((cell) => !cell.classification.hidden);
  const internal = row.cells.filter((cell) => cell.classification.hidden);
  const thinking = row.state === 'active' && !visible.some((cell) => cell.status === 'running')
    ? internal.find((cell) => cell.toolName === 'thinking' && cell.status === 'running') : undefined;
  const edits = visible.flatMap((cell) => cell.status === 'done' && cell.detail.kind === 'edit' ? [cell.detail] : []);
  const draw = (cells: Cell[]) => cells.map((cell) => (
    <Fragment key={cell.id}>{renderCell ? renderCell(cell) : <CellLine cell={cell} turnId={row.turnId} />}</Fragment>
  ));
  return (
    <FilePathsContext value={row.cells.flatMap((cell) => cell.paths)}>
      <div className="transcript-group" data-state={row.state} data-cell-count={row.cells.length}>
        {visible.length > 1 && <div className="transcript-group-summary">{row.summary} {edits.length > 0 && <LineCounts added={edits.reduce((n, edit) => n + edit.added, 0)} removed={edits.reduce((n, edit) => n + edit.removed, 0)} />}</div>}
        <div className="transcript-tool-block" data-group-cells="">{draw(visible)}</div>
        {internal.length > 0 && <>
          <button type="button" className="transcript-group-header" aria-expanded={row.expanded} onClick={() => useTranscriptStore.getState().toggleGroup(storeKey, row.id)}>
            <span className="transcript-group-label">{thinking ? <LiveThinkingCellLabel cell={thinking} turnId={row.turnId} /> : 'Internal activity'}</span><Chevron />
          </button>
          <DisclosureBody open={row.expanded}>
            <div className="transcript-group-cells" tabIndex={0} aria-label="Internal activity, scroll for details">{draw(internal)}</div>
          </DisclosureBody>
        </>}
      </div>
    </FilePathsContext>
  );
}
