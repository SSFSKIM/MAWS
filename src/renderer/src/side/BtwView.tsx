// The Side pane's question view (E3 execution document, Design §7): the session's side questions, oldest first, each
// question with its answer (markdown, as the transcript draws one) or a spinner while pending; an answer the engine
// substituted carries a notice; a failed one its reason and Retry. Below them a field asks another (Enter asks,
// Shift+Enter breaks a line), Clear starts a new side conversation, and "Continue as a side thread" turns the answered
// exchanges (with what the field holds, as the thread's own ask) into a side thread the pane then shows. The log is
// the host's (`side.question.list`): it is listed on mount and whenever the session's process changes, so a renderer
// reload shows a pending question pending and then answered. Asking and Retry need a ready process, and say so;
// continuing as a thread does not (a fork resumes from disk).
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { SideExchange } from '@shared/side/question';
import { FIELD, PRIMARY, QUIET, SECONDARY } from '../sessions/ui';
import { useSessions } from '../stores/sessions';
import { Markdown } from '../transcript/view/markdown/Markdown';
import { promoteSide } from './actions';
import { SIDE_COPY } from './copy';
import { askSide, clearSide, promotable, refreshSide, retrySide, sidePaneOf, useSidePane } from './store';

const COPY = SIDE_COPY.btw;
const SHOWN = 50; // the most recent exchanges kept on screen

export function BtwView({ parent }: { parent: AppSessionId }) {
  const process = useSessions((s) => s.engine.get(parent)?.process ?? null);
  const exchanges = useSidePane((s) => sidePaneOf(s, parent).exchanges);
  const ready = process === 'ready';
  const [question, setQuestion] = useState('');
  const [promoting, setPromoting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => void refreshSide(parent), [parent, process]);
  const shown = (exchanges ?? []).slice(-SHOWN);
  const last = shown.at(-1);
  useEffect(() => end.current?.scrollIntoView?.({ block: 'end' }), [shown.length, last?.state]);

  const ask = () => {
    const q = question.trim();
    if (!ready || q === '') return;
    void askSide(parent, q);
    setQuestion('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    ask();
  };
  const canPromote = !promoting && promotable(exchanges ?? []).length > 0;
  const promote = async () => {
    if (!canPromote) return;
    setPromoting(true);
    setRefusal(null);
    const text = question.trim();
    const result = await promoteSide(parent, text === '' ? null : text);
    setPromoting(false);
    if (result.ok) setQuestion('');
    else setRefusal(result.error);
  };

  return (
    <div data-side-btw-view={parent} className="flex h-full min-h-0 flex-col">
      <div role="log" aria-label={COPY.log} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {shown.length === 0 ? (
          <p className="m-0 mx-auto mt-6 max-w-[280px] text-center text-ui text-fg-muted">{COPY.empty}</p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-4 p-0">
            {shown.map((exchange) => (
              <Exchange key={exchange.id} exchange={exchange} canRetry={ready} onRetry={() => void retrySide(parent, exchange)} />
            ))}
          </ol>
        )}
        <div ref={end} />
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-t border-border px-3 py-2.5">
        {!ready && <p className="m-0 text-ui-sm text-fg-muted">{COPY.notRunning}</p>}
        {refusal !== null && (
          <p role="alert" className="m-0 text-ui-sm break-words text-danger">
            {refusal}
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            aria-label={COPY.field}
            placeholder={COPY.placeholder}
            rows={2}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={onKeyDown}
            className={`${FIELD} min-h-[52px] resize-none leading-snug placeholder:text-fg-faint`}
          />
          <button type="button" className={PRIMARY} disabled={!ready || question.trim() === ''} onClick={ask}>
            {COPY.ask}
          </button>
        </div>
        <div className="flex items-center justify-between gap-2">
          <button type="button" className={`${QUIET} text-ui-sm`} disabled={shown.every((e) => e.state === 'pending')} onClick={() => void clearSide(parent)}>
            {COPY.clear}
          </button>
          <button type="button" className={`${SECONDARY} text-ui-sm`} disabled={!canPromote} onClick={() => void promote()}>
            {promoting ? COPY.promoting : COPY.promote}
          </button>
        </div>
      </div>
    </div>
  );
}

function Exchange({ exchange, canRetry, onRetry }: { exchange: SideExchange; canRetry: boolean; onRetry(): void }) {
  return (
    <li data-side-exchange={exchange.state} className="flex min-w-0 flex-col gap-2">
      <p className="m-0 max-w-[90%] self-end rounded-lg bg-(--bg-user-message) px-3 py-1.5 text-ui break-words whitespace-pre-wrap text-fg">{exchange.question}</p>
      {exchange.state === 'pending' && (
        <p role="status" className="m-0 flex items-center gap-2 text-ui-sm text-fg-muted">
          <span aria-hidden className="size-3 shrink-0 animate-spin rounded-full border border-border-strong border-t-accent motion-reduce:animate-none" />
          {COPY.answering}
        </p>
      )}
      {exchange.state === 'answered' && (
        <div className="min-w-0 text-fg">
          {exchange.synthetic && (
            <p data-side-synthetic="" className="m-0 mb-1.5 inline-block rounded-sm bg-bg-active px-1.5 py-0.5 text-ui-sm text-warning">
              {COPY.synthetic}
            </p>
          )}
          {exchange.response === null || exchange.response.trim() === '' ? <p className="m-0 text-ui-sm text-fg-muted">{COPY.noAnswer}</p> : <Markdown markdown={exchange.response} live={false} />}
        </div>
      )}
      {exchange.state === 'failed' && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-ui-sm text-danger">
          <span className="min-w-0 flex-1 break-words">{exchange.error}</span>
          <button type="button" className={SECONDARY} disabled={!canRetry} onClick={onRetry}>
            {COPY.retry}
          </button>
        </div>
      )}
    </li>
  );
}
