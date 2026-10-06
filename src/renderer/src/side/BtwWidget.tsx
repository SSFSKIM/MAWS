// The `/btw` widget (E3 execution document, Design §7): the palette's path (choosing the `/btw` row, a bare `/btw`, or a
// typed question the session cannot take yet). One field holding the question, Ask, which asks it as a typed `/btw`
// does (the Side pane's question view shows the answer) and closes. Without a ready process it says to start the
// session and keeps the question.
import { useState, type KeyboardEvent } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { useSessions } from '../stores/sessions';
import { WIDGET_FOOT, WIDGET_TITLE } from '../widgets/copy';
import { WidgetFrame } from '../widgets/WidgetFrame';
import { askSideQuestion } from './btw';
import { SIDE_COPY } from './copy';

const COPY = SIDE_COPY.btw;

export function BtwWidget({ appSessionId, args, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const ready = useSessions((s) => s.engine.get(appSessionId)?.process === 'ready');
  const [question, setQuestion] = useState(args.trim());
  const canAsk = ready && question.trim() !== '';
  const ask = () => {
    if (!canAsk) return;
    askSideQuestion(appSessionId, question.trim());
    close();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    ask();
  };

  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.btw} command="btw" foot={WIDGET_FOOT.btw} state="ready" error={null} close={close}>
      <div className="flex flex-col gap-2">
        {!ready && (
          <p role="status" className="m-0 text-ui-sm text-fg-muted">
            {COPY.notRunning}
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
            onClick={ask}
            className="rounded-sm bg-accent px-2 py-0.5 text-ui-sm text-bg outline-accent focus-visible:outline-2 disabled:bg-bg-active disabled:text-fg-faint"
          >
            {COPY.ask}
          </button>
        </div>
      </div>
    </WidgetFrame>
  );
}
