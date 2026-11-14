// A run of tool calls (UX wave U2, O-29 and O-27; the U2a document, M4 "The row", Interfaces §C and §E): one line,
// folded while the turn runs and after it. The line reads the call that waits for the person's permission, with the
// attention glyph in the warning tone; else the foreground call running now; else the run's caption with the lines its
// finished edits changed. A click opens it onto its blocks of calls, each call's row as before, with a thought of ten
// seconds or more at its place between them or under the last; another click closes it. While folded, a thought
// streaming now has its line under the run's, once the closing body that drew it has gone. The body mounts only while open, so a folded run mounts no call and asks
// no ToolUse site.
import { Fragment, type ReactNode } from 'react';
import { ATTENTION_HEADINGS } from '@shared/attention/headings';
import type { AttentionItem } from '@shared/graph/attention';
import type { ToolUseId } from '@shared/graph/ids';
import { selectWaitingByCall, useAttention } from '../../../stores/attention';
import { useTranscriptStore } from '../../../stores/transcript';
import { DisclosureBody } from '../../../ui/disclosure';
import { waitingLabel } from '../../model/copy';
import { heldByPermission, runLine, runSegments, type RunLine, type RunSegment } from '../../model/groups';
import type { Cell, Row } from '../../model/rows';
import { callsOfTurn } from '../../surface/adapters';
import { CellLabel, CellLine, FilePathsContext } from '../cells/CellLine';
import { rowElementId, useRowSession, useTranscriptContext } from '../context';
import { Chevron, CodeText, LineCounts } from './parts';
import { ThoughtLine } from './Thinking';

type GroupRowData = Extract<Row, { kind: 'group' }>;
type DrawCell = (cell: Cell) => ReactNode;

const NO_CALLS: ReadonlyMap<ToolUseId, AttentionItem> = new Map();

export function GroupRow({ row, renderCell }: { row: GroupRowData; renderCell?: (cell: Cell) => ReactNode }) {
  const { storeKey, variant, idPrefix } = useTranscriptContext();
  // decision 16: the waiting calls of the row's own session (a subagent's transcript reads its parent's list, which
  // keys the subagent's requests by its calls); a transcript with no session reads none
  const session = useRowSession();
  const waiting = useAttention((state) => (session === null ? NO_CALLS : selectWaitingByCall(state, session)));
  // decision 21: only an open turn of a session's own transcript is held by a permission that names none of its calls.
  // Read as one boolean, so a batch of the open turn re-renders no run, and the turn's calls are read only while
  // something waits.
  const held = useTranscriptStore((state) => {
    if (variant !== 'session' || row.turnId === null || waiting.size === 0) return false;
    const turn = state.entries[storeKey]?.state.turns.get(row.turnId);
    return turn?.state === 'open' && heldByPermission(waiting, callsOfTurn(turn));
  });
  const line = runLine(row.cells, waiting, held);
  const active = row.state === 'active';
  const last = row.cells.at(-1);
  const streaming = active && last?.toolName === 'thinking' && last.status === 'running';
  const draw: DrawCell = (cell) => (renderCell ? renderCell(cell) : <CellLine cell={cell} turnId={row.turnId} />);
  const bodyId = rowElementId(idPrefix, `${row.id}-body`);
  const live = streaming && !row.expanded ? runSegments(row.cells, true).at(-1) : undefined;
  const heading = line.kind === 'waiting' ? ATTENTION_HEADINGS[line.item.kind] : null;
  return (
    <FilePathsContext value={row.cells.flatMap((cell) => cell.paths)}>
      <div className="transcript-group" data-state={row.state} data-cell-count={row.cells.length}>
        <button
          type="button" className="transcript-run-line" data-line={line.kind} data-tone={heading?.tone} aria-expanded={row.expanded} aria-controls={bodyId}
          onClick={() => useTranscriptStore.getState().toggleGroup(storeKey, row.id)}
        >
          {heading && <span className="transcript-run-glyph" aria-hidden="true">{heading.char}</span>}
          <span className="transcript-run-label"><LineLabel line={line} row={row} /></span>
          {line.kind === 'caption' && <LineCounts added={row.counts.added} removed={row.counts.removed} />}
          <Chevron />
        </button>
        <DisclosureBody open={row.expanded} id={bodyId} closed={live?.kind === 'thought' && <Thought segment={live} row={row} />}>
          <RunBody row={row} draw={draw} />
        </DisclosureBody>
      </div>
    </FilePathsContext>
  );
}

function LineLabel({ line, row }: { line: RunLine; row: GroupRowData }) {
  if (line.kind === 'waiting') return <CodeText text={waitingLabel(line.cell)} />;
  if (line.kind === 'running') return <CellLabel cell={line.cell} />;
  return <>{row.summary}</>;
}

// The opened run, computed only while its body is mounted.
function RunBody({ row, draw }: { row: GroupRowData; draw: DrawCell }) {
  return <>{runSegments(row.cells, row.state === 'active').map((segment) => segment.kind === 'calls'
    ? <div key={`calls:${segment.cells[0].id}`} className="transcript-tool-block" data-group-cells="">{segment.cells.map((cell) => <Fragment key={cell.id}>{draw(cell)}</Fragment>)}</div>
    : <Thought key={segment.id} segment={segment} row={row} />)}</>;
}

// A run's thought line: the component a thought outside a run is drawn by, keyed by its first member's cell, reading the
// recorded time; while its last member streams, that member's buffer follows the settled text.
function Thought({ segment, row }: { segment: Extract<RunSegment, { kind: 'thought' }>; row: GroupRowData }) {
  const streaming = segment.live === null ? undefined : row.cells.findLast((cell) => cell.toolName === 'thinking' && cell.status === 'running');
  const fallback = streaming?.detail.kind === 'thinking' ? streaming.detail.text : '';
  return <ThoughtLine id={segment.id} turnId={row.turnId} live={segment.live} text={segment.text} fallback={fallback} ms={segment.recordedMs} />;
}
