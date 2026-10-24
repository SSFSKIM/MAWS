// A blocking MAWS ask opens its sheet from the main request card. The sidebar hover card instead answers in place,
// through the sheet's controls and shared drafts; neither path uses the native tool's `session.answer`.
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, ToolUseId } from '@shared/graph/ids';
import { registeredActions, type AskRowData } from '../../transcript';
import { CardButton } from '../controls';
import { ASK_CARD } from '../copy';
import { HoverAsk } from '../../tools/maws/ask/HoverAsk';

export type AskOpenedEvent = Extract<SessionEvent, { kind: 'maws.ask.opened' }>;

// The ask as its capsule would hand it over while pending (the askId is the tool-use id whenever the call carried one).
const rowDataOf = (request: AskOpenedEvent): AskRowData => ({
  askId: request.askId, toolUseId: (request.toolUseId ?? request.askId) as ToolUseId, title: request.title, context: request.context, blocking: request.blocking,
  questions: request.questions, state: 'pending', answers: null, error: null, cancelReason: null,
});

export function AskBody({ appSessionId, request, hover = false }: { appSessionId: AppSessionId; request: AskOpenedEvent; hover?: boolean }) {
  if (hover) return <HoverAsk appSessionId={appSessionId} askId={request.askId} />;
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-ui-sm text-fg-muted">
      <span>{ASK_CARD.count(request.questions.length)}</span>
      <span aria-hidden>·</span>
      <CardButton onClick={() => registeredActions().openAsk(appSessionId, rowDataOf(request))}>{ASK_CARD.open}</CardButton>
    </div>
  );
}
