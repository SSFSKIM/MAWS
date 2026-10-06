// E1 M4b (the architect's ruling 1): the card of a blocking `maws` ask, a `question` attention item whose originating
// event is `maws.ask.opened`. Compact in every placement: the count and one button that opens the Question sheet with
// the event's own data (the transcript's registered `openAsk`, as the capsule does). Nothing here answers: the sheet
// holds the modalities, so `session.answer` is never offered for an ask.
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, ToolUseId } from '@shared/graph/ids';
import { registeredActions, type AskRowData } from '../../transcript';
import { CardButton } from '../controls';

export type AskOpenedEvent = Extract<SessionEvent, { kind: 'maws.ask.opened' }>;

export const ASK_CARD = {
  untitled: 'Questions from the agent',
  count: (n: number) => `${n} ${n === 1 ? 'question' : 'questions'}`,
  open: 'Open the Question sheet',
} as const;

// The ask as its capsule would hand it over while pending (the askId is the tool-use id whenever the call carried one).
const rowDataOf = (request: AskOpenedEvent): AskRowData => ({
  askId: request.askId, toolUseId: (request.toolUseId ?? request.askId) as ToolUseId, title: request.title, context: request.context, blocking: request.blocking,
  questions: request.questions, state: 'pending', answers: null, error: null,
});

export function AskBody({ appSessionId, request }: { appSessionId: AppSessionId; request: AskOpenedEvent }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-ui-sm text-fg-muted">
      <span>{ASK_CARD.count(request.questions.length)}</span>
      <span aria-hidden>·</span>
      <CardButton onClick={() => registeredActions().openAsk(appSessionId, rowDataOf(request))}>{ASK_CARD.open}</CardButton>
    </div>
  );
}
