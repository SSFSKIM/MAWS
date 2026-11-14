// The Side pane's question view (E3 execution document, Design §7): the session's side questions, oldest first, each
// question with its answer (markdown, as the transcript draws one) or a spinner while pending; an answer the engine
// substituted carries a notice; a failed one its reason and Retry. Below them a field asks another (Enter asks,
// Shift+Enter breaks a line), Clear starts a new side conversation, and "Continue as a side thread" turns the answered
// exchanges (with what the field holds, as the thread's own ask) into a side thread the pane then shows. The log is
// the host's (`side.question.list`): it is listed on mount and whenever the session's process changes, so a renderer
// reload shows a pending question pending and then answered. P2-A (2026-10-09; the execution document §5.6): Ask and
// Retry on a session with no ready process start it first (`acquireSession(id, 'side')`, the field reading Starting…)
// and then ask; a refused start says why and keeps the question; a terminal or job holding it, or an archive, disables
// them with the reason. Continuing as a thread needs no process (a fork resumes from disk). Opening starts nothing.
// UX wave U4a (O-20): since a session's own `/btw` answers in its card (BtwCard.tsx), this view is a side thread's
// questions under its thread view; the card asks, lists and draws its exchanges through the same hook and row
// (`useSideAsk`, `Exchange`), with its own waiting line in place of the spinner.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { SideExchange } from '@shared/side/question';
import { STARTS } from '../composer/submit/submit-state';
import { useAvailability } from '../sessions/availability';
import { FIELD, PRIMARY, QUIET, SECONDARY } from '../sessions/ui';
import { useSessions } from '../stores/sessions';
import { Markdown } from '../transcript'; // lazy.tsx's: the side pane registers from the entry, and a static import would pull Markdown into it
import { promoteSide } from './actions';
import { useRemoteUnavailable } from '../lane-b/remote-unavailable'; // P5 O7 M8
import { sideBlock, startForSide, useDrivenAsk } from './btw';
import { STARTING_SESSION } from '../sessions/acquire'; // P2-A
import { SIDE_COPY } from './copy';
import { askSide, beginPromotion, btwCardOf, clearSide, promotable, promotionInFlight, refreshSide, retrySide, sidePaneOf, takeBtwFocus, useBtwCards, usePromotions, useSidePane } from './store';

const COPY = SIDE_COPY.btw;
const SHOWN = 50; // the most recent exchanges kept on screen

// Asking, listing and the field of one session's side questions: the view's and the card's alike. `log` is for the
// scroller, kept at its newest exchange; `field` for the textarea, which takes the keyboard when the session's side-question
// field is asked for it (a pick of `/btw` from the palette). `kept`: the field's text held outside the component (the
// card's, in its store, so a fold loses nothing); the component's own state otherwise.
type Kept = { question: string; setQuestion(next: string | ((current: string) => string)): void };
export function useSideAsk(parent: AppSessionId, kept?: Kept) {
  const log = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const focus = useBtwCards((s) => btwCardOf(s, parent).focus);
  useEffect(() => {
    if (!focus) return;
    field.current?.focus();
    takeBtwFocus(parent);
  }, [focus, parent]);
  const process = useSessions((s) => s.engine.get(parent)?.process ?? null);
  const exchanges = useSidePane((s) => sidePaneOf(s, parent).exchanges);
  const driven = useDrivenAsk(parent); // P5 O9 M5
  const ready = process === 'ready' || driven?.available === true;
  const holder = useSessions((s) => s.records.get(parent)?.holder ?? null);
  const availability = useAvailability(parent);
  const [ownQuestion, setOwnQuestion] = useState('');
  const question = kept?.question ?? ownQuestion;
  const setQuestion = kept?.setQuestion ?? setOwnQuestion;
  const [refusal, setRefusal] = useState<string | null>(null);
  const [starting, setStarting] = useState(false); // P2-A: this view's own start in flight
  // P5 O7 M8: an older machine with no side-question row greys Ask and Retry with its name (lane-b/remote-unavailable.ts)
  const askUnavailable = useRemoteUnavailable(parent, 'session.sideQuestion');
  const blocked = askUnavailable ?? (ready ? null : driven?.available === false ? driven.reason : sideBlock(availability, holder));
  const canAsk = blocked === null && !starting;
  // P5 O7 M8: why Continue as a side thread and Clear are greyed for a session on another machine (lane-b/remote-unavailable.ts)
  const promoteUnavailable = useRemoteUnavailable(parent, 'side.thread.open');
  const clearUnavailable = useRemoteUnavailable(parent, 'side.question.clear');

  useEffect(() => void refreshSide(parent), [parent, process]);
  const shown = (exchanges ?? []).slice(-SHOWN);
  const last = shown.at(-1);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight; // the newest exchange in view
  }, [shown.length, last?.state]);

  // P2-A: the session started first when it has no ready process; null when it can be asked, else the words shown
  const started = async (): Promise<boolean> => {
    if (ready) return true;
    setStarting(true);
    setRefusal(null);
    const words = await startForSide(parent);
    setStarting(false);
    if (words !== null) setRefusal(words);
    return words === null;
  };
  const ask = async () => {
    const q = question.trim();
    if (!canAsk || q === '') return;
    if (!(await started())) return;
    void askSide(parent, q);
    setQuestion((current) => (current.trim() === q ? '' : current));
  };
  const retry = async (exchange: SideExchange) => {
    if (canAsk && (await started())) void retrySide(parent, exchange);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void ask();
  };
  const note = blocked ?? (starting || availability === 'starting' ? STARTING_SESSION : ready ? null : STARTS);
  // UX wave U4a (the panel's finding 9): the promotion in flight is the store's, so it outlives this mount (a card's fold)
  const promoting = usePromotions((s) => promotionInFlight(s, parent, exchanges ?? []));
  const canPromote = !promoting && promotable(exchanges ?? []).length > 0 && promoteUnavailable === null;
  const promote = async () => {
    const end = canPromote ? beginPromotion(parent, exchanges ?? []) : null;
    if (end === null) return;
    setRefusal(null);
    const text = question.trim();
    try {
      const result = await promoteSide(parent, text === '' ? null : text);
      if (result.ok) setQuestion('');
      else setRefusal(result.error);
    } finally {
      end();
    }
  };
  const canClear = !shown.every((e) => e.state === 'pending') && clearUnavailable === null;
  const clear = () => void clearSide(parent);
  return { log, field, shown, question, setQuestion, canAsk, ask, retry, onKeyDown, note, refusal, promoting, canPromote, promote, promoteUnavailable, canClear, clear, clearUnavailable };
}

export function BtwView({ parent }: { parent: AppSessionId }) {
  const side = useSideAsk(parent);
  const { log, field, shown, question, setQuestion, canAsk, note, refusal } = side;

  return (
    <div data-side-btw-view={parent} className="flex h-full min-h-0 flex-col">
      <div ref={log} role="log" aria-label={COPY.log} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {shown.length === 0 ? (
          <p className="m-0 mx-auto mt-6 max-w-[280px] text-center text-ui text-fg-muted">{COPY.empty}</p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-4 p-0">
            {shown.map((exchange) => (
              <Exchange key={exchange.id} exchange={exchange} canRetry={canAsk} onRetry={() => void side.retry(exchange)} />
            ))}
          </ol>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-t border-border px-3 py-2.5">
        {note !== null && <p className="m-0 text-ui-sm text-fg-muted">{note}</p>}
        {refusal !== null && (
          <p role="alert" className="m-0 text-ui-sm break-words text-danger">
            {refusal}
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={field}
            aria-label={COPY.field}
            placeholder={COPY.placeholder}
            rows={2}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={side.onKeyDown}
            className={`${FIELD} min-h-[52px] resize-none leading-snug placeholder:text-fg-faint`}
          />
          <button type="button" className={PRIMARY} disabled={!canAsk || question.trim() === ''} onClick={() => void side.ask()}>
            {COPY.ask}
          </button>
        </div>
        <SideActions side={side} />
      </div>
    </div>
  );
}

// Clear and "Continue as a side thread", the view's and the card's.
export function SideActions({ side }: { side: ReturnType<typeof useSideAsk> }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <button type="button" className={`${QUIET} text-ui-sm`} disabled={!side.canClear} title={side.clearUnavailable ?? undefined} onClick={side.clear}>
        {COPY.clear}
      </button>
      <button type="button" className={`${SECONDARY} text-ui-sm`} disabled={!side.canPromote} title={side.promoteUnavailable ?? undefined} onClick={() => void side.promote()}>
        {side.promoting ? COPY.promoting : COPY.promote}
      </button>
    </div>
  );
}

// One exchange: the question, then its pending line (`waiting`, the card's; the view's spinner and "Answering…" otherwise),
// its answer, or its failure with Retry.
export function Exchange({ exchange, canRetry, onRetry, waiting }: { exchange: SideExchange; canRetry: boolean; onRetry(): void; waiting?: ReactNode }) {
  return (
    <li data-side-exchange={exchange.state} className="flex min-w-0 flex-col gap-2">
      <p className="m-0 max-w-[90%] self-end rounded-lg bg-(--bg-user-message) px-3 py-1.5 text-ui break-words whitespace-pre-wrap text-fg">{exchange.question}</p>
      {exchange.state === 'pending' &&
        (waiting ?? (
          <p role="status" className="m-0 flex items-center gap-2 text-ui-sm text-fg-muted">
            <span aria-hidden className="size-3 shrink-0 animate-spin rounded-full border border-border-strong border-t-accent motion-reduce:animate-none" />
            {COPY.answering}
          </p>
        ))}
      {/* P5 O9: a terminal session's question the bridge may not have taken: pending still, its doubt said, Retry offered */}
      {exchange.state === 'pending' && exchange.error !== null && (
        <div data-side-uncertain="" className="flex flex-wrap items-center gap-2 text-ui-sm text-warning">
          <span className="min-w-0 flex-1 break-words">{exchange.error}</span>
          <button type="button" className={SECONDARY} disabled={!canRetry} onClick={onRetry}>
            {COPY.retry}
          </button>
        </div>
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
