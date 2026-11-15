import { Markdown } from '../../transcript/view/markdown/Markdown';
import { markedSpans } from '@shared/owner/marked';
import { MessageLabel, MessageView, useReportOnly } from '../view/Message';
import { hasMessages, liveMessageInk, messageInk } from './message-ink';

// The native fallback is the authored Markdown with each message drawn as the mod draws it (`owner/view/Message.tsx`).
// Attached engine mods get first refusal; history and local mounts use this same drawing without inventing cards or a
// second working-record fold. Which words are a message is the one reading of a text's marks (`src/shared/owner/marked.ts`)
// in the gate, the full drawing and a closed head alike: a completed text draws a message only for a mark that closes
// (one left open stays literal, as main reads it too); a streaming one (`streaming`) also for a mark still open at its
// end.
function AssistantInk({ text, live }: { text: string; live: boolean }) {
  // Under a closed stretch's head (the mirror's `reportOnly`, read from the row's context) only its messages: another
  // component, so a head that opens or folds over the same text mounts afresh (Streamdown's root re-renders for a new
  // text or mode, never for new plugins).
  if (useReportOnly()) return <HeadMessages text={text} live={live} />;
  return <div className="transcript-answer"><Markdown markdown={text} live={live} decorate={live ? liveMessageInk : messageInk} /></div>;
}

// A closed stretch's head (UX wave U2b; the architect's direction of 2026-11-15): exactly the one reading's message
// spans, each its own Markdown under its own label, as the mod draws a folded mixed row (`spanRows` over the parsed
// spans), and nothing of the record. A span cut out of an emphasis, a list or a table cell leaves that container's
// styling behind, as the terminal does. The decoration takes a question's `choice` tags out of its span, as the full
// drawing does.
function HeadMessages({ text, live }: { text: string; live: boolean }) {
  return (
    <div className="transcript-answer">
      {markedSpans(text, live).map((span, i) => (
        <div key={i} className="owner-message-ink">
          <MessageLabel first={i === 0} open={span.isOpen} />
          <Markdown markdown={span.text} live={false} decorate={messageInk} />
        </div>
      ))}
    </div>
  );
}

export function assistantPresentation(text: string, streaming = false) {
  return hasMessages(text, streaming) ? {
    render: ({ live }: { live: boolean }) => <AssistantInk text={text} live={live} />,
  } : null;
}

// The message tool's body is one message: the same drawing, its label always with the bullet.
export function messagePresentation(text: string) {
  return <MessageView text={text} />;
}
