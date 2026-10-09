// `/compact` (C11 execution document, the widget table and M3 decisions): the context numbers from `get_context_usage`'s
// summary, an instructions field the palette's argument fills, and `Compact now`, which sends `/compact <instructions>`
// as the next message (a headless local command; the compaction boundary follows in the transcript as C6's row) and
// closes. It refuses while a turn is open (a mid-turn `/compact` would compact a conversation the human has not seen
// end) and while messages wait in C3's queue, which a send never overtakes, naming why a paused queue paused.
import { useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { contextTotal } from '@shared/wire/control';
import { PAUSED_COPY } from '../composer/queue/QueueList';
import { useSessionQueue } from '../stores/queue';
import { useSessions } from '../stores/sessions';
import { ipc } from '../ipc/client';
import { present as presentContext } from './ContextWidget';
import { COMPACT, CONTEXT, FRAME, WIDGET_TITLE } from './copy';
import { num } from './parts';
import { MOVES_READS, useEngineRead } from './read';
import { WidgetFrame } from './WidgetFrame';

export function CompactWidget({ appSessionId, args, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const read = useEngineRead('session.getContextUsage', { appSessionId, detail: 'summary' });
  const status = useSessions((s) => s.engine.get(appSessionId) ?? null);
  // C3's sample (the status line's `ctx`) first; the read's own figures, corrected as C3 corrects them, before one arrives
  const sampled = useSessions((s) => s.digests.get(appSessionId)?.context ?? null);
  const queue = useSessionQueue(appSessionId);
  const [instructions, setInstructions] = useState(args.trim());
  const [sending, setSending] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  // an unanswered send may still run: Compact now waits for the status to move before it offers a second one
  const [unanswered, setUnanswered] = useState<string | null>(null);
  const moved = status ? MOVES_READS(status) : null;
  const holding = unanswered !== null && unanswered === moved;

  const waiting = status?.queue.length ?? 0;
  const blocked = status?.turn ? COMPACT.waitTurn : waiting > 0 ? (status?.queue.paused ? PAUSED_COPY[queue.pauseReason ?? 'none'] : COMPACT.queuedFirst) : null;
  const send = async () => {
    setSending(true);
    setRefused(null);
    setUnanswered(null);
    const text = instructions.trim();
    const result = await ipc.invoke('session.send', { appSessionId, content: text === '' ? '/compact' : `/compact ${text}` });
    setSending(false);
    if (result.ok) return close();
    setRefused(result.error.code === 'timeout' ? COMPACT.unanswered : result.error.message);
    if (result.error.code === 'timeout') setUnanswered(moved);
  };

  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.compact} command="compact" state={read.state === 'not_running' ? 'not_running' : 'ready'} error={null} close={close}>
      <div className="flex flex-col gap-2">
        <p className="m-0 text-fg-muted">
          {sampled
            ? CONTEXT.line(num(sampled.totalTokens), num(sampled.maxTokens), Math.round(sampled.percent), sampled.autoCompactThreshold === null ? null : num(sampled.autoCompactThreshold))
            : read.data
              ? presentContext({ ...read.data, ...contextTotal(read.data) }).line
              : (read.error ?? FRAME.reading)}
        </p>
        <label className="flex flex-col gap-1 text-ui-sm">
          <span className="text-fg-muted">{COMPACT.instructions}</span>
          <textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder={COMPACT.placeholder}
            rows={2}
            className="resize-none rounded-sm border border-border bg-bg px-2 py-1 text-ui outline-accent focus-visible:outline-2"
          />
        </label>
        <div className="flex items-baseline gap-2">
          <button
            type="button"
            disabled={blocked !== null || sending || holding}
            onClick={() => void send()}
            className="rounded-sm bg-accent px-2 py-0.5 text-ui-sm text-bg outline-accent focus-visible:outline-2 disabled:bg-bg-active disabled:text-fg-faint"
          >
            {COMPACT.now}
          </button>
          {blocked && <span className="text-ui-sm text-fg-muted">{blocked}</span>}
        </div>
        <p className="m-0 text-ui-sm text-fg-muted">{COMPACT.consequence}</p>
        {refused && (
          <p role="alert" className="m-0 text-ui-sm text-danger">
            {refused}
          </p>
        )}
      </div>
    </WidgetFrame>
  );
}
