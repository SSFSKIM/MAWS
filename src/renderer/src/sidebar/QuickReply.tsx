import { useRef, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { sendHumanPrompt } from '../composer/submit/send-human-prompt';
import { displayTitle } from '../sessions/title';

export interface QuickReplyState {
  value: string;
  setValue(value: string): void;
  sending: boolean;
  message: { text: string; failed: boolean } | null;
  submit(): void;
}

// The draft and its send belong to the row, not the transient card: closing the card mid-send keeps both, so a reopened
// card shows the send still out (no second one), and its answer clears only the draft it sent. Sending uses the
// composer's queue/acquisition seam.
export function useQuickReply(appSessionId: AppSessionId): QuickReplyState {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const [message, setMessage] = useState<QuickReplyState['message']>(null);
  const submit = async () => {
    const content = value;
    if (inFlight.current || !content.trim()) return;
    inFlight.current = true;
    setSending(true);
    setMessage(null);
    try {
      const result = await sendHumanPrompt(appSessionId, content, { origin: 'reply' });
      const refused = result.disposition === 'refused' || result.disposition === 'held';
      setMessage({ failed: refused, text: refused ? result.reason ?? 'Reply was not sent' : result.disposition === 'sent' ? 'Sent' : 'Queued' });
      if (!refused) setValue((current) => (current === content ? '' : current));
    } catch (error) {
      setMessage({ failed: true, text: error instanceof Error ? error.message : 'Reply was not sent' });
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };
  return { value, setValue, sending, message, submit: () => void submit() };
}

export function QuickReply({ record, reply }: { record: SessionRecord; reply: QuickReplyState }) {
  const { value, sending, message } = reply;
  return <form onSubmit={(event) => { event.preventDefault(); reply.submit(); }} onClick={(e) => e.stopPropagation()}>
    <div className="flex items-center gap-1 rounded-sm bg-bg-hover px-2 py-1">
      <input aria-label={`Reply to ${displayTitle(record)}`} placeholder="Reply…" value={value} readOnly={sending}
        onChange={(event) => reply.setValue(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }}
        className="min-w-0 flex-1 bg-transparent py-1 text-ui text-fg outline-accent focus-visible:outline-2" />
      <button type="submit" aria-label="Send reply" disabled={sending || !value.trim()}
        className="rounded-sm px-1.5 py-1 text-fg-muted outline-accent hover:text-fg focus-visible:outline-2 disabled:text-fg-faint">↵</button>
    </div>
    {message && <p role={message.failed ? 'alert' : 'status'} className={`m-0 pt-1 ${message.failed ? 'text-danger' : 'text-fg-muted'}`}>{message.text}</p>}
  </form>;
}
