// One session's sheet (the composite's §8, "The sheet", and §4.3; the C3 plan's §G and "The look", M3; frames 1, 5 and
// 6): the notes of S15 at its head, its open cards oldest first, the accepted outcomes, a line for each question a
// queued dismissal hides, and one Send. The memory is the consumer's, and may be shown by two mounts at once or by
// none: every change is handed to `onMemory` as an update of the memory as it is when applied, and each new model meets
// it in `reconcile`. One Send is one call of the host with `sendOf`'s lines, named by its attempt; those lines are held
// from the press until the host answers (a press takes the slot through its update, and its call is made once the
// memory holds it, so two presses make one call), and the answer lands, once, through the update the Send was made
// with, in that session's memory, whether or not a mount still shows it. A late image does the same. A Send that
// failed, or whose call this window no longer has in the air (a reload), is offered again as the same lines; one in the
// air is waited for, whichever mount made it. While lines are held no other act is built, so every card waits.
import { useEffect, useRef } from 'react';
import type { SheetLine, SheetModel, SheetQuestion } from '@shared/sheet/model';
import { sendOf, type QuestionDraft } from '@shared/sheet/words';
import { CardButton } from '../request-card/controls';
import { NamedGlyph } from '../ui/glyph';
import { SHEET_WORDS } from './copy';
import type { SheetHost } from './host';
import { CloseIcon } from './icons';
import { attach, closeNote, editDraft, reconcile, settle, startSend, type SheetMemory } from './memory';
import { isKnown, launchHeld, newAttempt, prepare } from './attempts';
import { OutcomeCard } from './OutcomeCard';
import { QuestionCard } from './QuestionCard';

export interface SessionSheetProps {
  model: SheetModel;
  memory: SheetMemory;
  onMemory(update: (current: SheetMemory) => SheetMemory): void; // applied to this session's memory as it is at commit; may be called after unmount
  host: SheetHost;
  focus?: { id: string; request: number } | null; // bring this question's card into view and put the keyboard on it; `request` grows with each ask
  density?: 'full' | 'compact';
  unavailable?: string | null; // why this surface cannot send now; drawn in place of Send
}

const COUNTING = () => 'counting';
const clock = () => Date.now(); // read when a Send is pressed, never while drawing // `sendOf` asked only for its count makes no key worth keeping
const QUIET = 'shrink-0 rounded-sm text-ui-sm text-fg-muted outline-accent hover:text-fg focus-visible:outline-2 disabled:text-fg-faint disabled:hover:text-fg-faint';

export function SessionSheet({ model, memory, onMemory, host, focus = null, density = 'full', unavailable = null }: SessionSheetProps) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (reconcile(memory, model) !== memory) onMemory((current) => reconcile(current, model));
  }, [memory, model, onMemory]);

  // A request to show a card is used once, when its question is in the model.
  const focusId = focus?.id ?? null;
  const focusRequest = focus?.request ?? null;
  const focusUsed = useRef<string | null>(null);
  const focusListed = focusId !== null && model.open.some((question) => question.id === focusId);
  useEffect(() => {
    const request = `${focusRequest}:${focusId}`;
    if (!focusListed || focusUsed.current === request) return;
    const card = root.current?.querySelector<HTMLElement>(`[data-sheet-question="${focusId}"]`);
    if (!card) return;
    focusUsed.current = request;
    card.scrollIntoView?.({ block: 'nearest' });
    card.focus({ preventScroll: true });
  }, [focusId, focusRequest, focusListed]);

  const held = memory.sending;
  const lost = held?.state === 'sending' && !isKnown(held.attempt); // a call this window will not make or hear: its answer will not come
  // The call of the Send the memory holds, made once, by the first mount to show the hold.
  const heldAttempt = held?.state === 'sending' ? held.attempt : null;
  useEffect(() => {
    if (heldAttempt !== null) launchHeld(heldAttempt);
  }, [heldAttempt]);
  const awaiting = new Set(memory.acts.filter((act) => act.state === 'sending').map((act) => act.id));
  const sendable = new Map([...memory.drafts].filter(([id]) => !awaiting.has(id)));
  const plan = sendOf(model.open, sendable, host.by, COUNTING);

  // A Send takes the slot through the update (`startSend`), against the memory as it is when applied: a new one only
  // where none is held, one sent again only over the hold it was drawn for (`over`) while that hold failed or will get
  // no answer. Its call is prepared here and made once the memory holds it, so a press that lost the slot calls
  // nothing.
  const run = (lines: readonly SheetLine[], over: string | null = null) => {
    const attempt = newAttempt();
    const land = onMemory; // this session's memory, wherever the answer finds this mount
    const drafts = memory.drafts; // the drafts these lines were built from: what each act records as sent
    const targets = targetsOf(model);
    const now = clock();
    prepare(attempt, model.session, () => host.send(model.session, [...lines]), (result) => land((current) => settle(current, attempt, result)));
    land((current) => (over !== null && current.sending?.state === 'sending' && isKnown(over) ? current : startSend(current, lines, now, attempt, { drafts, over, targets })));
  };
  const free = held === null;
  const send = () => free && plan.ids.length > 0 && run(sendOf(model.open, sendable, host.by, () => host.newKey()).lines);
  const sendAgain = () => held !== null && (held.state === 'failed' || lost) && run(held.lines, held.attempt);
  const dismiss = (question: SheetQuestion) => free && run([{ v: 1, key: host.newKey(), kind: 'dismiss', id: question.id, by: host.by }]);
  const retract = (target: string) => free && run([{ v: 1, key: host.newKey(), kind: 'retract', target, by: host.by }]);
  // The person's act on a card, applied to the draft as it stands when applied, so an image or a sibling's edit applied
  // first stays; none while a Send holds the memory.
  const draft = (question: SheetQuestion, update: (current: QuestionDraft | undefined) => QuestionDraft | null) =>
    free &&
    onMemory((current) => {
      if (current.sending !== null) return current;
      const was = current.drafts.get(question.id);
      const next = update(was);
      return next === was && was !== undefined ? current : editDraft(current, question, next); // a draft left untouched leaves the memory so
    });
  // A pasted image, saved: it joins the draft of the question it was pasted on, in this session's memory, as that is when it lands.
  const attachTo = (question: SheetQuestion) => {
    const land = onMemory;
    return (path: string) => land((current) => attach(current, question, path));
  };

  const markOf = (question: SheetQuestion) =>
    memory.acts.some((act) => act.id === question.id && act.state === 'stale') ? ('stale' as const) : memory.marked.has(question.id) ? ('updated' as const) : ('none' as const);
  const notes = memory.acts.filter((act) => act.note !== null);
  const compact = density === 'compact';
  const nothing = model.open.length === 0 && model.pending.length === 0 && model.hidden.length === 0;

  const foot = (() => {
    if (unavailable !== null) return <p className="m-0 flex-1 text-ui-sm text-fg-muted">{unavailable}</p>;
    if (held !== null && (held.state === 'failed' || lost)) {
      return (
        <>
          <p className="m-0 min-w-0 flex-1 text-ui-sm text-fg-muted">
            {SHEET_WORDS.notSent}
            {held.note && <span className="block truncate">{held.note}</span>}
          </p>
          <CardButton tone="primary" onClick={sendAgain}>
            {SHEET_WORDS.sendAgain}
          </CardButton>
        </>
      );
    }
    return (
      <>
        {plan.left > 0 && <p className="m-0 flex-1 text-ui-sm text-fg-muted">{SHEET_WORDS.rest(plan.left)}</p>}
        <CardButton tone="primary" disabled={!free || plan.ids.length === 0} onClick={send}>
          {SHEET_WORDS.send(plan.ids.length)}
        </CardButton>
      </>
    );
  })();

  const content = (
    <>
      {notes.length > 0 && (
        <div className={`flex flex-col gap-1.5 ${compact ? 'pb-1.5' : 'px-3 pt-3'}`}>
          {notes.map((act) => (
            <div key={act.key} role="status" data-sheet-note={act.key} className="flex items-center gap-2 rounded-sm border border-border-strong bg-bg-raised py-1 pr-1 pl-2.5 text-fg">
              <span className="min-w-0 flex-1">{act.note}</span>
              <NamedGlyph label={SHEET_WORDS.closeNote} onClick={() => onMemory((current) => closeNote(current, act.key))} className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2">
                <CloseIcon />
              </NamedGlyph>
            </div>
          ))}
        </div>
      )}
      {nothing ? (
        <p className={`m-0 text-center text-fg-muted ${compact ? 'py-2' : 'flex min-h-42 flex-1 items-center justify-center p-6'}`}>{SHEET_WORDS.empty}</p>
      ) : (
        <div className={`flex min-w-0 flex-col ${compact ? '' : 'gap-2 p-3'}`}>
          {model.open.map((question) => (
            <QuestionCard
              key={question.id}
              session={model.session}
              question={question}
              draft={memory.drafts.get(question.id)}
              mark={markOf(question)}
              busy={!free || awaiting.has(question.id)}
              host={host}
              density={density}
              onDraft={(update) => draft(question, update)}
              onDismiss={() => dismiss(question)}
              onRetract={retract}
              onAttach={attachTo(question)}
            />
          ))}
          {model.pending.map((outcome) => (
            <OutcomeCard key={outcome.key} outcome={outcome} />
          ))}
          {model.hidden.map((hidden) => (
            <div key={hidden.key} data-sheet-hidden={hidden.id} className={`flex min-w-0 items-baseline gap-1.5 text-fg-muted ${compact ? 'py-1' : 'px-3 py-1'}`}>
              <span className="shrink-0 text-ui-sm text-fg-faint tabular-nums">{hidden.id}</span>
              {memory.headers.has(hidden.id) && <span className="min-w-0 truncate">{memory.headers.get(hidden.id)}</span>}
              <span aria-hidden="true" className="transcript-question-arrow shrink-0">
                →
              </span>
              <span className="shrink-0">{SHEET_WORDS.dismissed}</span>
              <span className="min-w-0 flex-1 text-fg-faint">{SHEET_WORDS.queuedWord}</span>
              <button type="button" disabled={!free || awaiting.has(hidden.id)} onClick={() => retract(hidden.key)} className={QUIET}>
                {SHEET_WORDS.takeBack}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );

  if (compact) {
    return (
      <section ref={root} data-sheet-session={model.session} data-density="compact" className="flex min-w-0 flex-col text-ui-sm text-fg">
        {content}
        {!nothing && <div className="flex items-center justify-end gap-2 border-t border-border pt-2">{foot}</div>}
      </section>
    );
  }
  return (
    <section ref={root} data-sheet-session={model.session} data-density="full" className="flex h-full min-h-0 flex-col bg-bg text-ui text-fg">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{content}</div>
      {!nothing && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-bg p-3">{foot}</div>}
    </section>
  );
}

// The question each key a retract may name stands on: a queued answer's, a queued dismissal's.
// A Map: a key named `__proto__` is a valid inbox key, kept as its own.
function targetsOf(model: SheetModel): Map<string, string> {
  const targets = new Map<string, string>();
  for (const question of model.open) if (question.queued) targets.set(question.queued.key, question.id);
  for (const hidden of model.hidden) targets.set(hidden.key, hidden.id);
  return targets;
}
