// One cell: its collapsed line (the X3 label, code spans as code, edit counts in the diff colours) as a disclosure
// whose state lives in the store, and its detail when open. The status shows as a mark drawn by CSS from
// `data-status`, so the line's text is the label alone. A standalone denied cell is itself focusable (tabindex -1,
// scroll-margin) so the divider's count can land on it.
import { useTranscriptStore } from '../../../stores/transcript';
import type { Cell, TurnId } from '../../model/rows';
import { useTranscriptContext } from '../context';
import { Chevron, CodeText, LineCounts } from '../rows/parts';
import { LiveThinkingLabel } from '../rows/ThinkingLabel';
import { CellDetailView } from './CellDetail';

const EDIT_COUNTS = / \+(\d+) −(\d+)$/;

function Label({ cell }: { cell: Cell }) {
  if (cell.toolName === 'thinking' && cell.status === 'running') return <LiveThinkingLabel startedAt={cell.startedAt} />; // W8
  const counts = cell.detail.kind === 'edit' ? EDIT_COUNTS.exec(cell.label) : null;
  if (!counts) return <CodeText text={cell.label} />;
  return (
    <>
      <CodeText text={cell.label.slice(0, counts.index)} /> <LineCounts added={Number(counts[1])} removed={Number(counts[2])} />
    </>
  );
}

export function CellLine({ cell, turnId, focusable = false }: { cell: Cell; turnId: TurnId | null; focusable?: boolean }) {
  const { storeKey } = useTranscriptContext();
  return (
    <div
      className="transcript-cell"
      data-cell-id={cell.id}
      data-status={cell.status}
      data-bookkeeping={cell.classification.hidden && cell.toolName !== 'thinking' ? '' : undefined}
      data-expanded={cell.expanded ? '' : undefined}
      tabIndex={focusable ? -1 : undefined}
    >
      <button type="button" className="transcript-cell-line" aria-expanded={cell.expanded} onClick={() => useTranscriptStore.getState().toggleCell(storeKey, cell.id)}>
        <span className="transcript-cell-label">
          <Label cell={cell} />
        </span>
        <Chevron />
      </button>
      {cell.expanded && <CellDetailView cell={cell} turnId={turnId} />}
    </div>
  );
}
