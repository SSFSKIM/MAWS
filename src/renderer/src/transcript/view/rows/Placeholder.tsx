// PLACEHOLDER rows for the kinds M4 (groups, cells, receipts, subagent, agent-message and bash rows) and M5 (plan,
// question, request slot, boundary and error rows) build: one plain line each, and just enough disclosure on groups
// and cells (through the store's expansion state) that old work can be expanded in the harness and the anchoring
// spike. Replaced kind by kind; nothing here is a design.
import { useTranscriptStore } from '../../../stores/transcript';
import { bashHeader, requestSlotPlaceholder } from '../../model/copy';
import type { Cell, Row } from '../../model/rows';
import { useTranscriptContext } from '../context';
import { Chevron } from './parts';

function detailText(cell: Cell): string {
  const { detail } = cell;
  switch (detail.kind) {
    case 'shell': return [detail.command, detail.stdout, detail.stderr].filter(Boolean).join('\n');
    case 'edit': return detail.hunks.flatMap((hunk) => hunk.lines).join('\n');
    case 'read': return detail.preview ?? detail.files.map((file) => file.path).join('\n');
    case 'search': case 'web': return detail.output;
    case 'thinking': return detail.text;
    case 'hook': return [detail.stdout, detail.stderr].filter(Boolean).join('\n');
    case 'image': return detail.caption ?? `${detail.images.length} image(s)`;
    case 'mcp': case 'generic': return typeof detail.result === 'string' ? detail.result : JSON.stringify(detail.result);
  }
}

function CellLine({ cell }: { cell: Cell }) {
  const { storeKey } = useTranscriptContext();
  return (
    <div data-cell-id={cell.id} data-expanded={cell.expanded ? '' : undefined} className="transcript-placeholder-cell">
      <button type="button" className="transcript-disclosure" aria-expanded={cell.expanded} onClick={() => useTranscriptStore.getState().toggleCell(storeKey, cell.id)}>
        <Chevron />
        {cell.label}
      </button>
      {cell.expanded && <pre className="transcript-placeholder-detail">{detailText(cell)}</pre>}
    </div>
  );
}

function lineOf(row: Row): string {
  switch (row.kind) {
    case 'receipt': return `${row.files.length} files changed · +${row.added} −${row.removed}`;
    case 'subagent': return row.sentence;
    case 'agent_message': return row.text;
    case 'plan': return `Plan · ${row.outcome ?? 'Pending'}`;
    case 'question': return row.questions.map((question) => question.header || question.question).join(' · ');
    case 'request_slot': return requestSlotPlaceholder(row.toolName ?? row.requestKind);
    case 'error': case 'boundary': return row.text;
    case 'bash': return bashHeader(row.command);
    default: return row.kind;
  }
}

export function PlaceholderRow({ row }: { row: Row }) {
  const { storeKey } = useTranscriptContext();
  if (row.kind === 'group') {
    return (
      <div className="transcript-placeholder" data-cell-count={row.cells.length}>
        <button type="button" className="transcript-disclosure" aria-expanded={row.expanded} onClick={() => useTranscriptStore.getState().toggleGroup(storeKey, row.id)}>
          <Chevron />
          {row.state === 'active' ? row.activeLabel : row.summary}
        </button>
        {row.expanded && (
          <div className="transcript-placeholder-cells">
            {row.cells.map((cell) => (
              <CellLine key={cell.id} cell={cell} />
            ))}
          </div>
        )}
      </div>
    );
  }
  if (row.kind === 'cell') {
    return (
      <div className="transcript-placeholder">
        <CellLine cell={row} />
      </div>
    );
  }
  return <div className="transcript-placeholder">{lineOf(row)}</div>;
}
