// An activity group: one header line (its category icon, the summary phrase, or while its turn works the live label of
// what is running) that opens into a bounded scroller of cells (224 px, `overscroll-behavior: contain`, reachable by
// keyboard), each cell a disclosure of its own. A running command's label ticks from the store's clock. W8: with nothing
// running, the live label is the live thinking label of a thinking cell still streaming, else `Thinking`, either under
// Codex's shimmer (ThinkingLabel.tsx).
import { ticks, useTranscriptStore, workingDurationMs } from '../../../stores/transcript';
import { activeGroupLabel } from '../../model/copy';
import type { Row } from '../../model/rows';
import { CellLine } from '../cells/CellLine';
import { useTranscriptContext } from '../context';
import { CategoryIcon } from './icons';
import { Chevron, CodeText, useTicker } from './parts';
import { LiveThinkingLabel, Shimmer } from './ThinkingLabel';

type GroupRowData = Extract<Row, { kind: 'group' }>;

function useHeader(row: GroupRowData, storeKey: string): string {
  const running = row.state === 'active' ? row.cells.find((cell) => cell.status === 'running' && cell.toolName === 'Bash') : undefined;
  const live = useTranscriptStore((state) => ticks(state, storeKey));
  const now = useTicker(running !== undefined && live);
  if (row.state === 'completed') return row.summary;
  if (running?.detail.kind !== 'shell') return row.activeLabel ?? row.summary;
  const elapsedMs = workingDurationMs(useTranscriptStore.getState().entries[storeKey], running.startedAt, now, live);
  return activeGroupLabel({ toolName: 'Bash', input: { command: running.detail.command }, elapsedMs });
}

function Header({ row, storeKey }: { row: GroupRowData; storeKey: string }) {
  const header = useHeader(row, storeKey);
  const idle = row.state === 'active' && !row.cells.some((cell) => cell.status === 'running' && cell.toolName !== 'thinking');
  const thinking = idle ? row.cells.find((cell) => cell.toolName === 'thinking' && cell.status === 'running') : undefined;
  if (thinking) return <LiveThinkingLabel startedAt={thinking.startedAt} />;
  if (idle && header === activeGroupLabel(null)) return <Shimmer>{header}</Shimmer>;
  return <CodeText text={header} />;
}

export function GroupRow({ row }: { row: GroupRowData }) {
  const { storeKey } = useTranscriptContext();
  return (
    <div className="transcript-group" data-state={row.state} data-cell-count={row.cells.length}>
      <button type="button" className="transcript-group-header" aria-expanded={row.expanded} onClick={() => useTranscriptStore.getState().toggleGroup(storeKey, row.id)}>
        <CategoryIcon category={row.icon} />
        <span className="transcript-group-label">
          <Header row={row} storeKey={storeKey} />
        </span>
        <Chevron />
      </button>
      {row.expanded && (
        <div className="transcript-group-cells" data-group-cells="" tabIndex={0} aria-label="Tool calls, scroll for details">
          {row.cells.map((cell) => (
            <CellLine key={cell.id} cell={cell} turnId={row.turnId} />
          ))}
        </div>
      )}
    </div>
  );
}
