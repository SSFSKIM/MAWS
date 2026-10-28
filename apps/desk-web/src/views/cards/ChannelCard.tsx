// One card of a cut-over machine's session, drawn from the machine's own channel (P5 O13 M5) with today's request card's
// pieces (RequestCard.tsx's adapters and MAWS's variant pieces as RequestCard imports them: the question stepper, the
// tool preview, the controls) and its copy, answered with the device's passkey. A permission offers Allow and Deny and
// nothing more: no reason (a `message` is refused `class`) and no scope (a lane B Allow is `once`). A question offers
// Skip and Submit, and every question skipped declines it, as DX6's card does (an async one excepted). Before the passkey
// prompt the card says what the gesture approves, since the prompt shows nothing of the request (RL §5.10); while an
// answer is retained for a Retry the card draws that answer's request, labelled so, and a lane A input the bridge
// capped says so, as today's card does. Its state is the adapter's (cards/card-state.ts).
import type { AttentionItem } from '@shared/graph/attention';
import type { Question, SessionEvent } from '@shared/graph/events';
import type { RequestAnswer } from '@shared/engine/answers';
import { CardButton, Controls, Muted } from '../../../../../src/renderer/src/request-card/controls';
import { ToolPreview } from '../../../../../src/renderer/src/request-card/preview/ToolPreview';
import { toolVerb } from '../../../../../src/renderer/src/request-card/tools';
import { QuestionBody } from '../../../../../src/renderer/src/request-card/variants/Question';
import type { Answer } from '../../cards/answers';
import type { Attempt, ChannelCardState } from '../../cards/card-state';
import { cardId, cardKind, type Card } from '../../cards/cards';
import { isAsyncQuestion } from '../../conversation/card-state';
import { asPermission, questionsOf } from '../requests/RequestCard';
import { gestureOf, type Gesture } from './gesture';

type PermissionEvent = Extract<SessionEvent, { kind: 'permission.requested' }>;
type QuestionEvent = Extract<SessionEvent, { kind: 'question.requested' }>;

/** The permission the card asks for, as MAWS's pieces read it. */
const permissionOf = (card: Card): PermissionEvent => (card.lane === 'A' ? asPermission(card.raised) : (card.request as PermissionEvent));

/** The questions the card asks, as MAWS's stepper reads them. */
const questionsOfCard = (card: Card): Question[] => (card.lane === 'A' ? questionsOf(card.raised) : ((card.request as QuestionEvent).questions ?? []));

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export type ChannelCardProps = {
  card: Card;
  state: ChannelCardState;
  attempt: Attempt | null;
  note: string | null;
  /** The session as the card names it (its listing's title). */
  where: string;
  machine: string;
  /** Scopes the question stepper's draft to this card. */
  draftId: string;
  onAnswer(given: Answer): void;
  onRetry(): void;
  onNote(note: string | null): void;
};

export function ChannelCard({ card: current, state, attempt, note, where, machine, draftId, onAnswer, onRetry, onNote }: ChannelCardProps) {
  // An answer on its way, sent, or retained for a Retry is drawn over its own card, which its digest covers: never the
  // card as a later set redrew it, though sminos republished the request with another input since.
  const inFlight = attempt !== null && (state.kind === 'sending' || state.kind === 'sent' || state.kind === 'uncertain');
  const card = inFlight ? attempt.card : current;
  const retried = inFlight && (state.kind === 'uncertain' || attempt.operation !== null);
  const changedSince = retried && JSON.stringify(card.digest) !== JSON.stringify(current.digest);
  const kind = cardKind(card);
  const asynchronous = card.lane === 'A' && isAsyncQuestion(card.raised as Parameters<typeof isAsyncQuestion>[0]);
  const verb = kind === 'question' ? 'asks' : kind === 'permission' ? `wants to ${toolVerb(permissionOf(card))}` : 'waits in MAWS';
  const answerable = state.kind === 'open' || state.kind === 'failed';
  const emphasized = answerable || state.kind === 'uncertain';
  return (
    <article
      className={['flex max-w-[640px] flex-col gap-3 rounded-md border px-3.5 py-3 text-ui', emphasized ? 'border-border-strong bg-bg-raised' : 'border-border bg-bg'].join(' ')}
      data-card={cardId(card)}
      data-card-state={state.kind}
      aria-label={`${where} ${verb}`}
    >
      <header className="flex flex-wrap items-baseline gap-x-1.5 text-ui-sm">
        <span className="flex min-w-0 items-baseline gap-x-1.5">
          <span className="min-w-0 truncate font-semibold text-fg">{where}</span>
          <span className="shrink-0 text-fg-muted">@{machine}</span>
        </span>
        <span className="text-fg-muted">{verb}</span>
        {asynchronous && <span className="text-fg-faint">· it keeps working while it waits</span>}
      </header>
      {retried && (
        <p className="m-0 text-ui-sm text-fg-muted" data-testid="retained">
          Retry sends the first answer again, to this request as it was then.
          {changedSince && ' It has changed since: the new request can be answered once this answer is known.'}
        </p>
      )}
      {kind === 'question' ? (
        <QuestionPart card={card} asynchronous={asynchronous} answerable={answerable} draftId={draftId} onAnswer={onAnswer} onNote={onNote} />
      ) : kind === 'permission' ? (
        <PermissionPart card={card} answerable={answerable} onAnswer={onAnswer} />
      ) : (
        <p className="m-0 text-ui-sm text-fg-muted">{card.lane === 'B' ? `${capitalized(card.request.kind.replace('.requested', ''))} request` : 'A request'}</p>
      )}
      {card.lane === 'A' && card.raised.truncated === true && (
        <p className="m-0 text-ui-sm text-warning" data-testid="truncated">
          The input shown was capped: the full input was too large to send. A decision binds to what is shown here.
        </p>
      )}
      {note !== null && (
        <p className="m-0 text-ui-sm text-warning" role="status" data-testid="card-note">
          {note}
        </p>
      )}
      <StateLine state={state} attempt={attempt} where={where} machine={machine} onRetry={onRetry} />
    </article>
  );
}

function PermissionPart({ card, answerable, onAnswer }: { card: Card; answerable: boolean; onAnswer(given: Answer): void }) {
  return (
    <>
      <ToolPreview request={permissionOf(card)} />
      {answerable && (
        <>
          <Controls>
            <CardButton onClick={() => onAnswer({ kind: 'decision', decision: 'deny' })}>Deny</CardButton>
            <CardButton tone="primary" onClick={() => onAnswer({ kind: 'decision', decision: 'allow' })}>
              Allow
            </CardButton>
          </Controls>
          <Muted>Allow and Deny each ask for Face ID, and the answer carries a digest of exactly this request: if it changed, nothing is decided.</Muted>
        </>
      )}
    </>
  );
}

function QuestionPart({ card, asynchronous, answerable, draftId, onAnswer, onNote }: { card: Card; asynchronous: boolean; answerable: boolean; draftId: string; onAnswer(given: Answer): void; onNote(note: string | null): void }) {
  const questions = questionsOfCard(card);
  if (!answerable || questions.length === 0) {
    return (
      <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="question-shown">
        {questions.map((q) => (
          <li key={q.question}>
            <span className="text-fg">{q.question}</span>
            <span className="block text-ui-sm text-fg-muted">{q.options.map((o) => o.label).join(' · ')}</span>
          </li>
        ))}
      </ul>
    );
  }
  // An answer to at least one question is sent. One with every question skipped is the question declined, as DX6's card
  // and Esc in the terminal decline it; an async question is answered, never declined, so for it nothing is sent and
  // the card says why.
  const submit = (given: RequestAnswer) => {
    if (given.kind === 'question' && Object.keys(given.answers).length > 0) {
      onNote(null);
      onAnswer({ kind: 'question', answers: given.answers });
    } else if (asynchronous) onNote('Nothing was sent: an async question waits for an answer to at least one of its questions, and cannot be declined.');
    else {
      onNote(null);
      onAnswer({ kind: 'decline' });
    }
  };
  const item = (card.lane === 'B' ? { ...card.item, id: draftId } : { id: draftId }) as AttentionItem;
  const request = { kind: 'question.requested', questions } as QuestionEvent;
  return <QuestionBody item={item} request={request} placement="card" busy={false} submit={submit} bindKeys={() => {}} />;
}

function GestureLine({ gesture }: { gesture: Gesture }) {
  return (
    <p className="m-0 text-ui-sm text-fg" role="status" data-testid="gesture">
      Face ID approves: {gesture.action}
      {gesture.subject !== null && (
        <>
          {' '}
          <code className="rounded-sm bg-bg-hover px-1 font-mono text-ui-sm">{gesture.subject}</code>
        </>
      )}{' '}
      in {gesture.where}
    </p>
  );
}

function StateLine({ state, attempt, where, machine, onRetry }: { state: ChannelCardState; attempt: Attempt | null; where: string; machine: string; onRetry(): void }) {
  const line = (text: string, tone = 'text-fg-muted') => (
    <p className={`m-0 text-ui-sm ${tone}`} data-testid="card-state-line">
      {text}
    </p>
  );
  switch (state.kind) {
    case 'open':
      return null;
    case 'sending':
      // The answer's own card, which its operation's digest covers: never the card as a later set redrew it.
      return attempt?.phase === 'asking' ? <GestureLine gesture={gestureOf(attempt.card, attempt.answer, where)} /> : line('Sending…');
    case 'sent':
      return line(`Sent: waiting for ${machine} to settle it`);
    case 'closed':
      return line('No longer waiting');
    case 'failed':
      return line(`Not answered (${state.code})${state.message ? `: ${state.message}` : ''}. You can answer it again.`, 'text-danger');
    case 'changed':
      return line('The request changed: it can be answered once its card is drawn again.', 'text-warning');
    case 'not-actionable':
      return line(`Not yet actionable: ${state.text}`, 'text-warning');
    case 'disconnected':
      return line(`Not connected to ${machine}: shown, not answerable until the channel is back`, 'text-warning');
    case 'uncertain':
      return (
        <>
          {line(`No word from ${machine} on this answer. Retry asks for Face ID again and sends the same answer; nothing new can be sent until it is known.`, 'text-warning')}
          {state.offline && line(`Not connected to ${machine}: Retry waits for the channel`, 'text-warning')}
          <Controls>
            <CardButton tone="primary" onClick={onRetry} disabled={state.offline}>
              Retry
            </CardButton>
          </Controls>
        </>
      );
  }
}
