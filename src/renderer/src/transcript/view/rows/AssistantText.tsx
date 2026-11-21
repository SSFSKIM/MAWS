// An assistant text block, answer or commentary. While its block streams the row is `live` and its text is the
// store's live buffer for the block identity (a delta re-renders this component and nothing else); at completion the
// re-derived row carries the final markdown under the same id, and Markdown switches to static mode once. UX wave U2b
// (M2; §D): a streaming block whose message is still open is drawn as that message, its label reading ` …`, by the
// owner's presenter, which draws a completed text only for a mark that closes.
import { assistantPresentation, MarkedText } from '../../../owner/to-human/Presenter';
import { hasMessages } from '../../../owner/to-human/message-ink';
import { liveBuffer, useTranscriptStore } from '../../../stores/transcript';
import type { Row } from '../../model/rows';
import { useTranscriptContext } from '../context';
import { Markdown } from '../markdown/Markdown';

export function AssistantTextRow({ row, text }: { row: Extract<Row, { kind: 'assistant_text' }>; text?: string }) {
  const { storeKey } = useTranscriptContext();
  const buffer = useTranscriptStore((state) => liveBuffer(state.entries[storeKey], row));
  const markdown = text ?? buffer ?? row.markdown;
  if (!row.live && markdown.trim() === '') return null;
  const streaming = row.live ? assistantPresentation(markdown, true) : null;
  if (streaming) return streaming.render({ live: true });
  return (
    <div className={row.phase === 'answer' || row.forHuman ? 'transcript-answer' : 'transcript-commentary'}>
      <Markdown markdown={markdown} live={row.live} />
    </div>
  );
}

// P5 O9 (the M10 sitting): a terminal session's reply an interrupt cut before the engine wrote it (`cut`). The engine
// keeps an assistant block only once it completes, so the session holds none of these words and its next turn won't
// see them: drawn as far as they streamed, muted, under the note that says so, never as the turn's answer.
// The sminos bridge's own record of it (1.27.16) may keep only a block's tail (`partway`): the note says so, and the text
// opens with an ellipsis. UX wave U2b: a message in it is drawn as every message is (`MarkedText`), and where it heads
// a closed stretch of the to-human view (the mirror's `reportOnly`, read from the row's context) only its messages,
// under the same note.
// The word cut (T65): the fact in short, and the partway mark after it
export const CUT_NOTE = 'Cut off · not kept by the session';
export const PARTWAY_NOTE = 'starts partway';

// The ellipsis of a text kept partway is drawn beside its words, not written into them: the words are read and drawn as
// the mirror classed them (an ellipsis before a fence glued to its tag would hide the fence from the one reading).
export function CutTextRow({ row }: { row: Extract<Row, { kind: 'assistant_text' }> }) {
  const { markdown } = row;
  return (
    <div className="transcript-cut" data-cut="" data-partway={row.partway ? '' : undefined}>
      <div className="transcript-cut-note">{row.partway ? `${CUT_NOTE} · ${PARTWAY_NOTE}` : CUT_NOTE}</div>
      {row.partway && <span className="transcript-cut-partway" aria-hidden="true">…</span>}
      {hasMessages(markdown) ? <MarkedText text={markdown} live={false} /> : <Markdown markdown={markdown} live={false} />}
    </div>
  );
}
