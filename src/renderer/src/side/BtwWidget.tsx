// The `/btw` widget (E3 execution document, Design §7): the palette's path (choosing the `/btw` row, a bare `/btw`, or a
// typed question the session cannot take yet). One field holding the question, Ask, which asks it as a typed `/btw`
// does (the Side pane's question view shows the answer) and closes. P2-A (2026-10-09; the execution document §5.6):
// on a session with no ready process Ask starts it first (`acquireSession(id, 'side')`), reading Starting…, then
// asks; a refused start says why and keeps the question; a terminal or job holding it, or an archive, disables Ask
// with the reason. Opening the widget starts nothing. A widget put away while its start runs still asks (Ask was
// pressed), but closes nothing: the host's close puts away whichever widget is open by then. UX wave U4a (decision 26 d):
// on a session that can take a question now, the widget is not drawn at all: it closes before the dialog paints and the
// session's side questions open with their field focused where a typed question would answer (the session's `/btw` card,
// or under a side thread hosted in its parent's pane); with a question, it is asked there, as a typed `/btw <question>`
// is. The dialog stays for a session that cannot take one yet, which it starts or says why.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { STARTS } from '../composer/submit/submit-state';
import { useAvailability } from '../sessions/availability';
import { useSessions } from '../stores/sessions';
import { WIDGET_TITLE } from '../widgets/copy';
import { WidgetFrame } from '../widgets/WidgetFrame';
import { askSideQuestion, canAskSide, openSideQuestions, sideBlock, startForSide, useDrivenAsk } from './btw';
import { STARTING_SESSION } from '../sessions/acquire'; // P2-A
import { SIDE_COPY } from './copy';

const COPY = SIDE_COPY.btw;

export function BtwWidget({ appSessionId, args, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const driven = useDrivenAsk(appSessionId); // P5 O9 M5
  const ready = useSessions((s) => s.engine.get(appSessionId)?.process === 'ready') || driven?.available === true;
  const holder = useSessions((s) => s.records.get(appSessionId)?.holder ?? null);
  const availability = useAvailability(appSessionId);
  const [question, setQuestion] = useState(args.trim());
  // P2-A: this widget's own start in flight, or the words of the one that was refused
  const [start, setStart] = useState<{ kind: 'idle' } | { kind: 'starting' } | { kind: 'refused'; words: string }>({ kind: 'idle' });
  const blocked = ready ? null : driven?.available === false ? driven.reason : sideBlock(availability, holder);
  const starting = start.kind === 'starting';
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => void (mounted.current = false);
  }, []);
  // UX wave U4a: once, on open, before the dialog is drawn: the card takes it where the session can take a question now
  const handed = useRef(false);
  useLayoutEffect(() => {
    if (handed.current) return;
    handed.current = true;
    if (!canAskSide(appSessionId)) return;
    const asked = args.trim();
    if (asked === '') openSideQuestions(appSessionId, { focus: true }); // where a typed question would answer: the card, or under a hosted thread
    else askSideQuestion(appSessionId, asked);
    close();
  });
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
    if (mounted.current) close();
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
