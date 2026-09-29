// A cell's expanded body: the variant for its detail kind, then, for a tool call, the safeguard verdict as one line
// (§19: cell detail and the turn summary only, never the cell line). A call auto mode did not review reads "not
// reviewed" only in a turn where auto mode reviewed other calls; elsewhere the session was not in auto mode and the
// line would say nothing true.
import { useTranscriptStore } from '../../../stores/transcript';
import { SAFEGUARD_LINE } from '../../model/copy';
import type { Cell, Row, TurnId } from '../../model/rows';
import { useTranscriptContext } from '../context';
import { EditDetail } from './EditDetail';
import { GenericDetail } from './GenericDetail';
import { HookDetail } from './HookDetail';
import { ImageDetail } from './ImageDetail';
import { McpDetail } from './McpDetail';
import { ReadDetail } from './ReadDetail';
import { SearchDetail } from './SearchDetail';
import { ShellDetail } from './ShellDetail';
import { ThinkingDetail } from './ThinkingDetail';
import { WebDetail } from './WebDetail';

function Body({ cell, turnId }: { cell: Cell; turnId: TurnId | null }) {
  const { detail } = cell;
  switch (detail.kind) {
    case 'shell': return <ShellDetail cell={cell} detail={detail} />;
    case 'edit': return <EditDetail cell={cell} detail={detail} />;
    case 'read': return <ReadDetail detail={detail} />;
    case 'search': return <SearchDetail detail={detail} />;
    case 'web': return <WebDetail detail={detail} />;
    case 'mcp': return <McpDetail cell={cell} detail={detail} />;
    case 'image': return <ImageDetail detail={detail} />;
    case 'thinking': return <ThinkingDetail cell={cell} detail={detail} turnId={turnId} />;
    case 'hook': return <HookDetail detail={detail} />;
    case 'generic': return <GenericDetail cell={cell} detail={detail} />;
  }
}

// The turns whose summary counts an action auto mode reviewed, per row list (the divider rows carry the summary).
const reviewed = new WeakMap<Row[], Set<TurnId | null>>();
function reviewedTurns(rows: Row[] | undefined): Set<TurnId | null> {
  if (!rows) return new Set();
  let turns = reviewed.get(rows);
  if (!turns) {
    turns = new Set(rows.filter((row) => row.kind === 'divider' && row.summary.safeguard.reviewed > 0).map((row) => row.turnId));
    reviewed.set(rows, turns);
  }
  return turns;
}

function SafeguardLine({ cell, turnId }: { cell: Cell; turnId: TurnId | null }) {
  const { storeKey } = useTranscriptContext();
  const verdict = cell.classification.safeguard;
  const inReviewedTurn = useTranscriptStore((state) => verdict === 'not_evaluated' && turnId !== null && reviewedTurns(state.entries[storeKey]?.rows).has(turnId));
  if (verdict === 'not_evaluated' && !inReviewedTurn) return null;
  return (
    <div className="transcript-safeguard" data-verdict={verdict}>
      {SAFEGUARD_LINE[verdict]}
    </div>
  );
}

export function CellDetailView({ cell, turnId }: { cell: Cell; turnId: TurnId | null }) {
  return (
    <div className="transcript-cell-detail">
      <Body cell={cell} turnId={turnId} />
      {cell.toolUseId !== null && <SafeguardLine cell={cell} turnId={turnId} />}
    </div>
  );
}
