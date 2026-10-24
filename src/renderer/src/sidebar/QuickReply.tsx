import { useRef, useState } from 'react';
import type { SessionRecord } from '@shared/graph/session';
import { sendHumanPrompt } from '../composer/submit/send-human-prompt';
import { displayTitle } from '../sessions/title';

// The draft belongs to the row, not the transient card. Sending uses the composer's queue/acquisition seam.
export function QuickReply({ record, value, onChange }: { record: SessionRecord; value: string; onChange(value: string): void }) {
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const submit = async () => {
    if (inFlight.current || !value.trim()) return;
    inFlight.current = true;
    setSending(true);
    setMessage(null);
    try {
      const result = await sendHumanPrompt(record.appId, value, { origin: 'reply' });
      const refused = result.disposition === 'refused' || result.disposition === 'held';
      setFailed(refused);
      setMessage(refused ? result.reason ?? 'Reply was not sent' : result.disposition === 'sent' ? 'Sent' : 'Queued');
      if (!refused) onChange('');
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : 'Reply was not sent');
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };
  return <form onSubmit={(event) => { event.preventDefault(); void submit(); }} onClick={(e) => e.stopPropagation()}>
    <div className="flex items-center gap-1 rounded-sm bg-bg-hover px-2 py-1">
      <input aria-label={`Reply to ${displayTitle(record)}`} placeholder="Reply…" value={value} readOnly={sending}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }}
        className="min-w-0 flex-1 bg-transparent py-1 text-ui text-fg outline-accent focus-visible:outline-2" />
      <button type="submit" aria-label="Send reply" disabled={sending || !value.trim()}
        className="rounded-sm px-1.5 py-1 text-fg-muted outline-accent hover:text-fg focus-visible:outline-2 disabled:text-fg-faint">↵</button>
    </div>
    {message && <p role={failed ? 'alert' : 'status'} className={`m-0 pt-1 ${failed ? 'text-danger' : 'text-fg-muted'}`}>{message}</p>}
  </form>;
}
