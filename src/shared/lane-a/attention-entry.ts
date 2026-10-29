// One lane A request as an attention item and the request view a card reads (P5 O9 M6, "The item"; M9: the same for a
// remote session's request, which its pane docks): the item of the kind the bridge's own rule names (`requestKind`), and
// the request built from the raised record (tool, input, questions, suggestions) in the shape of the engine's own request
// event, so the card, the hover preview and the docked swap read it as they read a broker item's. Both halves read it:
// the local spine's list (src/services/lane-a/attention.ts) and the renderer's remote pane
// (src/renderer/src/lane-a/remote-attention.ts).
import { LANE_A_ITEM_PREFIX } from '@shared/attention/lane-a-item';
import type { AttentionItem } from '@shared/graph/attention';
import type { Question, SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId, AttentionId, EventId, RequestId, SessionId, ToolUseId } from '@shared/graph/ids';
import type { LaneARaised } from '@shared/ipc/schema/lane-a';
import { requestKind } from './answers';

export interface LaneAEntry {
  item: AttentionItem;
  request: SessionEvent;
}

const record = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

// The engine's question shape (`QuestionSchema`), as the engine host reads a `can_use_tool` request's.
const questionsOf = (input: Record<string, unknown>): Question[] =>
  (Array.isArray(input.questions) ? input.questions : []).map((raw) => {
    const q = record(raw);
    return {
      question: String(q.question ?? ''),
      header: String(q.header ?? ''),
      options: (Array.isArray(q.options) ? q.options : []).map((o) => ({ label: String(record(o).label ?? ''), description: str(record(o).description), preview: str(record(o).preview) })),
      multiSelect: q.multiSelect === true,
    };
  });

// The one line Needs you shows, in the broker's words (`engine-host/broker.ts` `shapeOf`).
function summaryOf(raised: LaneARaised, kind: AttentionItem['kind']): string {
  if (kind === 'question') return questionsOf(raised.input)[0]?.question || 'Question';
  if (kind === 'plan') return 'Plan ready for review';
  const detail = str(raised.input.command) ?? str(raised.input.description) ?? '';
  return detail.length > 0 ? `${raised.tool}: ${detail.slice(0, 80)}` : raised.tool;
}

/** The request `raised` of session `appId` as an attention item and its request view, first seen at `createdAt`. */
export function laneAEntryOf(appId: AppSessionId, raised: LaneARaised, createdAt: string): LaneAEntry {
  const kind = requestKind(raised);
  const requestId = raised.request as RequestId;
  const toolUseId = (raised.toolUseId ?? raised.request) as ToolUseId;
  const agentId = (raised.agentId ?? null) as AgentId | null;
  const id = `${LANE_A_ITEM_PREFIX}${raised.session}:${raised.request}`; // a prompt its terminal shows too
  const item: AttentionItem = {
    id: id as AttentionId,
    appSessionId: appId,
    sessionId: raised.session as SessionId,
    kind,
    request: { requestId, toolUseId, taskId: null, agentId },
    summary: summaryOf(raised, kind),
    createdAt,
    state: 'pending',
    stateChangedAt: createdAt,
    expiresAt: raised.deadline ?? null,
  };
  const base = { id: id as EventId, sessionId: raised.session as SessionId, at: createdAt, seq: null, agentId, parentToolUseId: null };
  const request: SessionEvent =
    kind === 'question'
      ? { ...base, kind: 'question.requested', requestId, toolUseId, questions: questionsOf(raised.input) }
      : kind === 'plan'
        ? { ...base, kind: 'plan.requested', requestId, toolUseId, plan: str(raised.input.plan) ?? '', input: raised.input }
        : {
            ...base, kind: 'permission.requested', requestId, toolUseId, toolName: raised.tool, displayName: null, input: raised.input,
            description: null, decisionReasonType: null, suggestions: raised.suggestions ?? [], blockedPath: null,
          };
  return { item, request };
}
