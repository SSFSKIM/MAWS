// An assistant text block, answer or commentary. While its block streams the row is `live` and its text is the
// store's live buffer for the block identity (a delta re-renders this component and nothing else); at completion the
// re-derived row carries the final markdown under the same id, and Markdown switches to static mode once.
import { liveBuffer, useTranscriptStore } from '../../../stores/transcript';
import type { Row } from '../../model/rows';
import { useTranscriptContext } from '../context';
import { Markdown } from '../markdown/Markdown';

export function AssistantTextRow({ row, text }: { row: Extract<Row, { kind: 'assistant_text' }>; text?: string }) {
  const { storeKey } = useTranscriptContext();
  const buffer = useTranscriptStore((state) => liveBuffer(state.entries[storeKey], row));
  return (
    <div className={row.phase === 'answer' ? 'transcript-answer' : 'transcript-commentary'}>
      <Markdown markdown={text ?? buffer ?? row.markdown} live={row.live} />
    </div>
  );
}
