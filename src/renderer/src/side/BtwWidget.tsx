// The `/btw` widget (E3 execution document, Design §7): the palette's path (choosing the `/btw` row, a bare `/btw`, or a
// typed question the session cannot take yet). One field holding the question, Ask, which asks it as a typed `/btw`
// does (the Side pane's question view shows the answer) and closes. P2-A (2026-10-09; the execution document §5.6):
// on a session with no ready process Ask starts it first (`acquireSession(id, 'side')`), reading Starting…, then
// asks; a refused start says why and keeps the question; a terminal or job holding it, or an archive, disables Ask
// with the reason. Opening the widget starts nothing.
import { useState, type KeyboardEvent } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { STARTS } from '../composer/submit/submit-state';
import { useAvailability } from '../sessions/availability';
import { useSessions } from '../stores/sessions';
import { WIDGET_TITLE } from '../widgets/copy';
import { WidgetFrame } from '../widgets/WidgetFrame';
import { askSideQuestion, sideBlock, startForSide } from './btw';
import { STARTING_SESSION } from '../sessions/acquire'; // P2-A
import { SIDE_COPY } from './copy';

const COPY = SIDE_COPY.btw;

export function BtwWidget({ appSessionId, args, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const ready = useSessions((s) => s.engine.get(appSessionId)?.process === 'ready');
  const holder = useSessions((s) => s.records.get(appSessionId)?.holder ?? null);
  const availability = useAvailability(appSessionId);
  const [question, setQuestion] = useState(args.trim());
  // P2-A: this widget's own start in flight, or the words of the one that was refused
  const [start, setStart] = useState<{ kind: 'idle' } | { kind: 'starting' } | { kind: 'refused'; words: string }>({ kind: 'idle' });
  const blocked = ready ? null : sideBlock(availability, holder);
  const starting = start.kind === 'starting';
  const canAsk = blocked === null && !starting && question.trim() !== '';
  const ask = async () => {
    if (!canAsk) return;
    const asked = question.trim();
    if (!ready) {
      setStart({ kind: 'starting' });
      const refusal = await startForSide(appSessionId);
      if (refusal !== null) return setStart({ kind: 'refused', words: refusal });
    }
    askSideQuestion(appSessionId, asked);
    close();
  };
  const note = blocked ?? (starting || availability === 'starting' ? STARTING_SESSION : ready ? null : STARTS);
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void ask();
  };

  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.btw} command="btw" state="ready" error={null} close={close}>
      <div className="flex flex-col gap-2">
        {note !== null && (
          <p role="status" className="m-0 text-ui-sm text-fg-muted">
            {note}
          </p>
        )}
        {start.kind === 'refused' && (
          <p role="alert" className="m-0 text-ui-sm break-words text-danger">
            {start.words}
          </p>
        )}
        <div className="flex items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-ui-sm">
            <span className="text-fg-muted">{COPY.field}</span>
            <textarea
              rows={2}
              autoFocus
              value={question}
              placeholder={COPY.placeholder}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={onKeyDown}
              className="resize-none rounded-sm border border-border bg-bg px-2 py-1 text-ui leading-snug outline-accent placeholder:text-fg-faint focus-visible:outline-2"
            />
          </label>
          <button
            type="button"
            disabled={!canAsk}
            onClick={() => void ask()}
            className="rounded-sm bg-accent px-2 py-0.5 text-ui-sm text-bg outline-accent focus-visible:outline-2 disabled:bg-bg-active disabled:text-fg-faint"
          >
            {COPY.ask}
          </button>
        </div>
      </div>
    </WidgetFrame>
  );
}
