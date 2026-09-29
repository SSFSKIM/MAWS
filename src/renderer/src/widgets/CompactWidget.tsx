// `/compact` (C11 execution document, the widget table and M3 decisions): the context numbers from `get_context_usage`'s
// summary, an instructions field the palette's argument fills, and `Compact now`, which sends `/compact <instructions>`
// as the next message (a headless local command; the compaction boundary follows in the transcript as C6's row) and
// closes. It refuses while a turn is open (a mid-turn `/compact` would compact a conversation the human has not seen
// end) and while messages wait in C3's queue, which a send never overtakes, naming why a paused queue paused.
import { useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { PAUSED_COPY } from '../composer/queue/QueueList';
import { useSessionQueue } from '../stores/queue';
import { useSessions } from '../stores/sessions';
import { ipc } from '../ipc/client';
import { present as presentContext } from './ContextWidget';
import { COMPACT, FRAME, WIDGET_FOOT, WIDGET_TITLE } from './copy';
import { transportWords, useEngineRead } from './read';
import { WidgetFrame } from './WidgetFrame';

export function CompactWidget({ appSessionId, args, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const read = useEngineRead('session.getContextUsage', { appSessionId, detail: 'summary' });
  const status = useSessions((s) => s.engine.get(appSessionId) ?? null);
  const queue = useSessionQueue(appSessionId);
  const [instructions, setInstructions] = useState(args.trim());
  const [sending, setSending] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const waiting = status?.queue.length ?? 0;
  const blocked = status?.turn ? COMPACT.waitTurn : waiting > 0 ? (status?.queue.paused ? PAUSED_COPY[queue.pauseReason ?? 'none'] : COMPACT.queuedFirst) : null;
  const send = async () => {
    setSending(true);
    setRefused(null);
    const text = instructions.trim();
    const result = await ipc.invoke('session.send', { appSessionId, content: text === '' ? '/compact' : `/compact ${text}` });
    setSending(false);
    if (result.ok) close();
    else setRefused(result.error.code === 'timeout' ? transportWords(result.error) : result.error.message);
  };

  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.compact} command="compact" foot={WIDGET_FOOT.compact} state={read.state === 'not_running' ? 'not_running' : 'ready'} error={null} close={close}>
      <div className="flex flex-col gap-2">
        <p className="m-0 text-fg-muted">{read.data ? presentContext(read.data).line : (read.error ?? FRAME.reading)}</p>
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
            disabled={blocked !== null || sending}
            onClick={() => void send()}
            className="rounded-sm bg-accent px-2 py-0.5 text-ui-sm text-bg outline-accent focus-visible:outline-2 disabled:bg-bg-active disabled:text-fg-faint"
          >
            {COMPACT.now}
          </button>
          {blocked && <span className="text-ui-sm text-fg-muted">{blocked}</span>}
        </div>
        {refused && (
          <p role="alert" className="m-0 text-ui-sm text-danger">
            {refused}
          </p>
        )}
      </div>
    </WidgetFrame>
  );
}
