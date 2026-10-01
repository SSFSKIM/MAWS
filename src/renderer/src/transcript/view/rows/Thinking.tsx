// A thinking block as a row (between the last tool call and the answer, or in a turn without tools): a disclosure
// reading `Thinking` while it streams and `Thought for {t}` after, its text bounded when open. A block with no text yet
// (a signature-only block still streaming) is a plain label with nothing to open; a completed one with no text has no
// row at all (derive.ts, W1).
import { liveBuffer, useTranscriptStore } from '../../../stores/transcript';
import { thinkingLabel } from '../../model/copy';
import type { Row } from '../../model/rows';
import { useDisclosure, useTranscriptContext } from '../context';
import { Chevron } from './parts';

export function ThinkingRow({ row }: { row: Extract<Row, { kind: 'thinking' }> }) {
  const { storeKey } = useTranscriptContext();
  const buffer = useTranscriptStore((state) => liveBuffer(state.entries[storeKey], row));
  const [open, toggle] = useDisclosure(row.id);
  const text = buffer ?? row.text;
  if (text.trim() === '') {
    return (
      <div className="transcript-thinking">
        <span className="transcript-disclosure">{thinkingLabel(row.live, row.durationMs)}</span>
      </div>
    );
  }
  return (
    <div className="transcript-thinking">
      <button type="button" className="transcript-disclosure" aria-expanded={open} onClick={toggle}>
        <Chevron />
        {thinkingLabel(row.live, row.durationMs)}
      </button>
      {open && <div className="transcript-thinking-text">{text}</div>}
    </div>
  );
}
