import { Markdown } from '../../transcript/view/markdown/Markdown';
import { markedSpans } from '../view/marked';
import { MessageLabel, MessageView, useReportOnly } from '../view/Message';
import { hasMessages, liveMessageInk, messageInk } from './message-ink';

// The native fallback is the authored Markdown with each message drawn as the mod draws it (`owner/view/Message.tsx`).
// Attached engine mods get first refusal; history and local mounts use this same drawing without inventing cards or a
// second working-record fold. A completed text draws a message only for a mark that closes (an unfinished one is never
// repaired); a streaming one (`streaming`) also for a mark still open at its end.
function AssistantInk({ text, live }: { text: string; live: boolean }) {
  // Under a closed stretch's head (the mirror's `reportOnly`, read from the row's context) only its messages: another
  // component, so a head that opens or folds over the same text mounts afresh (Streamdown's root re-renders for a new
  // text or mode, never for new plugins).
  if (useReportOnly()) return <HeadMessages text={text} />;
  return <div className="transcript-answer"><Markdown markdown={text} live={live} decorate={live ? liveMessageInk : messageInk} /></div>;
}

// A closed stretch's head (UX wave U2b; the architect's direction of 2026-11-15): exactly the message spans the mod's
// `parseMarked` reads (`owner/view/marked.ts`), each its own Markdown under its own label, as the mod draws a folded
// mixed row (`spanRows` over the parsed spans), and nothing the mod assigns to the record. A span cut out of an
// emphasis, a list or a table cell leaves that container's styling behind, as the terminal does. The decoration takes
// a question's `choice` tags out of its span, as the full drawing does.
function HeadMessages({ text }: { text: string }) {
  return (
    <div className="transcript-answer">
      {markedSpans(text).map((span, i) => (
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
