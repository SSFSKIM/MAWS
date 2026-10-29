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
  const markdown = text ?? buffer ?? row.markdown;
  if (!row.live && markdown.trim() === '') return null;
  return (
    <div className={row.phase === 'answer' || row.forHuman ? 'transcript-answer' : 'transcript-commentary'}>
      <Markdown markdown={markdown} live={row.live} />
    </div>
  );
}

// P5 O9 (the M10 sitting): a terminal session's reply an interrupt cut before the engine wrote it (`cut`). The engine
// keeps an assistant block only once it completes, so the session holds none of these words and its next turn won't
// see them: drawn as far as they streamed, muted, under the note that says so, never as the turn's answer.
export const CUT_NOTE = 'Cut off by the interrupt: the session didn’t keep it';

export function CutTextRow({ row }: { row: Extract<Row, { kind: 'assistant_text' }> }) {
  return (
    <div className="transcript-cut" data-cut="">
      <div className="transcript-cut-note">{CUT_NOTE}</div>
      <Markdown markdown={row.markdown} live={false} />
    </div>
  );
}
