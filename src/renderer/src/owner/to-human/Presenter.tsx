import { Markdown } from '../../transcript/view/markdown/Markdown';
import { MessageView, useReportOnly } from '../view/Message';
import { hasMessages, liveMessageInk, liveReportMessageInk, messageInk, reportMessageInk } from './message-ink';

// The native fallback is the authored Markdown with each message drawn as the mod draws it (`owner/view/Message.tsx`).
// Attached engine mods get first refusal; history and local mounts use this same drawing without inventing cards or a
// second working-record fold. A completed text draws a message only for a mark that closes (an unfinished one is never
// repaired); a streaming one (`streaming`) also for a mark still open at its end. Under a closed stretch's head (the
// mirror's `reportOnly`, read from the row's context) only the messages are drawn.
function AssistantInk({ text, live }: { text: string; live: boolean }) {
  const only = useReportOnly();
  const decorate = only ? (live ? liveReportMessageInk : reportMessageInk) : live ? liveMessageInk : messageInk;
  return <div className="transcript-answer"><Markdown markdown={text} live={live} decorate={decorate} /></div>;
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
