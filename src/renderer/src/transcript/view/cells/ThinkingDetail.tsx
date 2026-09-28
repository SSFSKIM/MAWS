// A thinking cell inside a group: its text, bounded; while the block streams, read from the store's live buffer (a
// delta changes no row, *Streaming*).
import { liveBlockBuffer, useTranscriptStore } from '../../../stores/transcript';
import type { Cell, CellDetail, TurnId } from '../../model/rows';
import { useTranscriptContext } from '../context';

type Thinking = Extract<CellDetail, { kind: 'thinking' }>;
const PREFIX = 'cell:think:';

export function ThinkingDetail({ cell, detail, turnId }: { cell: Cell; detail: Thinking; turnId: TurnId | null }) {
  const { storeKey } = useTranscriptContext();
  const live = cell.status === 'running' && turnId !== null && cell.id.startsWith(PREFIX);
  const buffer = useTranscriptStore((state) => (live ? liveBlockBuffer(state.entries[storeKey], turnId, cell.id.slice(PREFIX.length)) : null));
  return <div className="transcript-thinking-text">{buffer ?? detail.text}</div>;
}
