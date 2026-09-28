// A thinking block as a row (between the last tool call and the answer, or in a turn without tools): a disclosure
// reading `Thinking` while it streams and `Thought for {t}` after, its text bounded when open.
import { liveBuffer, useTranscriptStore } from '../../../stores/transcript';
import { thinkingLabel } from '../../model/copy';
import type { Row } from '../../model/rows';
import { useDisclosure, useTranscriptContext } from '../context';
import { Chevron } from './parts';

export function ThinkingRow({ row }: { row: Extract<Row, { kind: 'thinking' }> }) {
  const { storeKey } = useTranscriptContext();
  const buffer = useTranscriptStore((state) => liveBuffer(state.entries[storeKey], row));
  const [open, toggle] = useDisclosure(row.id);
  return (
    <div className="transcript-thinking">
      <button type="button" className="transcript-disclosure" aria-expanded={open} onClick={toggle}>
        <Chevron />
        {thinkingLabel(row.live, row.durationMs)}
      </button>
      {open && <div className="transcript-thinking-text">{buffer ?? row.text}</div>}
    </div>
  );
}
