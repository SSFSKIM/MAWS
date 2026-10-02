// The inbound half of the control channel as X1 events (C3 execution document, Interfaces "Normaliser", the
// `control_request (in)` / `control_response (out)` / `control_cancel_request (in)` rows): the engine's requests to
// the human or the host, our answers, and the engine's withdrawals. Our `control_response` envelope carries no
// subtype, so the request is remembered in the inbound table until its answer or cancellation resolves it. Pure over
// the table and the emitter; the Normalizer owns both.
import * as z from 'zod';
import type { EventPayload, Question } from '@shared/graph/events';
import { QuestionSchema } from '@shared/graph/events';
import type { AgentId, ParentToolUseId, RequestId, ToolUseId } from '@shared/graph/ids';
import { CanUseToolRequestSchema, ElicitationRequestSchema, HookCallbackRequestSchema, RequestUserDialogRequestSchema, UiCopyRequestSchema, UiPromptFillRequestSchema, UiPromptReadRequestSchema, UiPromptSuggestRequestSchema } from '@shared/wire/control';
import type { ControlRequestFrame, ControlResponseFrame } from '@shared/wire/frames';
import { compact, stringOrNull, type Attribution, type EventSink } from './normalizer-support';

// One inbound request awaiting our answer, kept so the answer (whose envelope carries no subtype) resolves to the right kind.
export type InboundKind = 'permission' | 'question' | 'plan' | 'hook' | 'elicitation' | 'dialog';
export interface InboundEntry {
  kind: InboundKind;
  toolUseId: ToolUseId | null;
  callbackId: string | null;
  parentToolUseId: ParentToolUseId | null;
  agentId: AgentId | null;
}
export type InboundTable = Map<RequestId, InboundEntry>;

// The deny message M3's broker sends for the plan outcome "clear context and implement" (Interfaces, Broker); the
// outcome is read back from it so a journal rebuild reproduces the live event.
export const CLEAR_AND_IMPLEMENT_MESSAGE = 'Plan approved; MAWS is clearing context and will restart with the plan.';

export function mapInboundRequest(inbound: InboundTable, frame: ControlRequestFrame, out: EventSink, attribution: Attribution): void {
  const requestId = frame.request_id as RequestId;
  const request = frame.request;
  const remember = (entry: Omit<InboundEntry, 'parentToolUseId' | 'agentId'>, agentId: AgentId | null = attribution.agentId) =>
    inbound.set(requestId, { ...entry, parentToolUseId: attribution.parentToolUseId, agentId });
  switch (request.subtype) {
    case 'can_use_tool': {
      const req = CanUseToolRequestSchema.parse(request) as z.infer<typeof CanUseToolRequestSchema> & Record<string, unknown>;
      const toolUseId = req.tool_use_id as ToolUseId;
      const agentId = (typeof req.agent_id === 'string' ? (req.agent_id as AgentId) : null) ?? attribution.agentId;
      const attributed = { parentToolUseId: attribution.parentToolUseId, agentId };
      if (req.tool_name === 'AskUserQuestion') {
        remember({ kind: 'question', toolUseId, callbackId: null }, agentId);
        const raw = (req.input as { questions?: unknown[] } | undefined)?.questions ?? [];
        out.emit({ kind: 'question.requested', requestId, toolUseId, questions: raw.map(questionOf) }, attributed);
        return;
      }
      if (req.tool_name === 'ExitPlanMode') {
        remember({ kind: 'plan', toolUseId, callbackId: null }, agentId);
        out.emit({ kind: 'plan.requested', requestId, toolUseId, plan: stringOrNull((req.input as { plan?: unknown } | undefined)?.plan) ?? '', input: req.input }, attributed);
        return;
      }
      remember({ kind: 'permission', toolUseId, callbackId: null }, agentId);
      const rule = req.matched_ask_rule as { source?: unknown; toolName?: unknown; ruleContent?: unknown } | null | undefined;
      const mcp = req.mcp_server as { name?: unknown; source?: unknown } | null | undefined;
      out.emit(compact({
        kind: 'permission.requested', requestId, toolUseId, toolName: req.tool_name, displayName: req.display_name ?? null, input: req.input, description: req.description ?? null,
        decisionReasonType: req.decision_reason_type ?? null, suggestions: req.permission_suggestions ?? [], blockedPath: req.blocked_path ?? null,
        // C7's additive fields: present only when the wire carries the key
        decisionReason: 'decision_reason' in req ? stringOrNull(req.decision_reason) : undefined,
        suppressAlwaysAllow: 'suppress_always_allow_rule' in req ? req.suppress_always_allow_rule === true : undefined,
        defaultToNo: 'default_to_no' in req ? req.default_to_no === true : undefined,
        matchedAskRule: 'matched_ask_rule' in req ? (rule && typeof rule === 'object' ? { source: String(rule.source), toolName: String(rule.toolName), ruleContent: stringOrNull(rule.ruleContent) } : null) : undefined,
        requiresUserInteraction: 'requires_user_interaction' in req ? req.requires_user_interaction === true : undefined,
        mcpServer: 'mcp_server' in req ? (mcp && typeof mcp === 'object' ? { name: String(mcp.name), source: String(mcp.source) } : null) : undefined,
      }) as EventPayload, attributed);
      return;
    }
    case 'hook_callback': {
      const req = HookCallbackRequestSchema.parse(request);
      const toolUseId = (req.tool_use_id ?? req.input.tool_use_id ?? null) as ToolUseId | null;
      remember({ kind: 'hook', toolUseId, callbackId: req.callback_id });
      out.emit({ kind: 'hook.callback_requested', requestId, callbackId: req.callback_id, hookEvent: req.input.hook_event_name, toolUseId, input: req.input }, attribution);
      return;
    }
    case 'elicitation': {
      const req = ElicitationRequestSchema.parse(request) as z.infer<typeof ElicitationRequestSchema> & { elicitation_id?: unknown };
      remember({ kind: 'elicitation', toolUseId: null, callbackId: null });
      out.emit({ kind: 'elicitation.requested', requestId, mcpServerName: req.mcp_server_name, elicitationId: stringOrNull(req.elicitation_id), mode: req.mode, payload: request }, attribution);
      return;
    }
    case 'request_user_dialog': {
      const req = RequestUserDialogRequestSchema.parse(request);
      const toolUseId = (req.tool_use_id ?? null) as ToolUseId | null;
      remember({ kind: 'dialog', toolUseId, callbackId: null });
      out.emit({ kind: 'dialog.requested', requestId, dialogKind: req.dialog_kind, payload: req.payload, toolUseId }, attribution); // the wire `payload` value, untouched (C7 validates it per kind)
      return;
    }
    // R2: the engine's requests to the attached surface, answered by the renderer through `session.ui.answer` (or by
    // the host's refusal when no window does in time); our answer makes no event, the request alone is the record
    case 'ui_copy': {
      const req = UiCopyRequestSchema.parse(request);
      out.emit({ kind: 'plugin.ask', requestId, ask: 'copy', plugin: req.plugin ?? null, text: req.text, mode: null }, attribution);
      return;
    }
    case 'ui_prompt_read':
      UiPromptReadRequestSchema.parse(request);
      out.emit({ kind: 'plugin.ask', requestId, ask: 'prompt_read', plugin: null, text: null, mode: null }, attribution);
      return;
    case 'ui_prompt_fill': {
      const req = UiPromptFillRequestSchema.parse(request);
      out.emit({ kind: 'plugin.ask', requestId, ask: 'prompt_fill', plugin: null, text: req.text, mode: req.mode ?? 'replace' }, attribution);
      return;
    }
    case 'ui_prompt_suggest': {
      const req = UiPromptSuggestRequestSchema.parse(request);
      out.emit({ kind: 'plugin.ask', requestId, ask: 'prompt_suggest', plugin: null, text: req.text, mode: null }, attribution);
      return;
    }
    default:
      out.emit({ kind: 'frame.unknown', frameType: 'control_request', subtype: request.subtype }, attribution);
  }
}

// Our answer to an inbound request (an `out` control_response row). `note` is the broker's annotation journaled just
// before it (`meta answer_note`: why the answer differs from what the human chose), appended to a permission's message.
export function mapOutboundResponse(inbound: InboundTable, frame: ControlResponseFrame, out: EventSink, note: string | null = null): void {
  const envelope = frame.response;
  const requestId = envelope.request_id as RequestId;
  const entry = inbound.get(requestId);
  if (!entry) return;
  inbound.delete(requestId);
  const attribution = { parentToolUseId: entry.parentToolUseId, agentId: entry.agentId };
  const payload = (envelope.subtype === 'success' ? (envelope.response ?? {}) : { behavior: 'deny', message: envelope.error }) as Record<string, unknown>;
  const message = stringOrNull(payload.message);
  switch (entry.kind) {
    case 'permission':
      out.emit({
        kind: 'permission.resolved', requestId, toolUseId: entry.toolUseId!, behavior: payload.behavior === 'allow' ? 'allow' : 'deny', message: [message, note].filter((m) => m !== null).join('; ') || null,
        updatedInput: payload.updatedInput ?? null, updatedPermissions: Array.isArray(payload.updatedPermissions) ? payload.updatedPermissions : [], resolvedBy: 'user',
      }, attribution);
      return;
    case 'question': {
      const answers = ((payload.updatedInput as { answers?: unknown } | undefined)?.answers ?? {}) as Record<string, string>;
      out.emit({ kind: 'question.answered', requestId, toolUseId: entry.toolUseId!, answers }, attribution);
      return;
    }
    case 'plan': {
      const outcome = payload.behavior === 'allow' ? 'implement' : message === CLEAR_AND_IMPLEMENT_MESSAGE ? 'clear_and_implement' : 'keep_planning';
      out.emit({ kind: 'plan.resolved', requestId, toolUseId: entry.toolUseId!, outcome, feedback: outcome === 'keep_planning' ? message : null }, attribution);
      return;
    }
    case 'hook':
      out.emit({ kind: 'hook.callback_resolved', requestId, callbackId: entry.callbackId!, response: envelope.subtype === 'success' ? envelope.response : { error: envelope.error } }, attribution);
      return;
    case 'elicitation':
      out.emit({ kind: 'elicitation.resolved', requestId, action: payload.action === 'accept' ? 'accept' : payload.action === 'decline' ? 'decline' : 'cancel', content: payload.content ?? null }, attribution);
      return;
    case 'dialog':
      out.emit({ kind: 'dialog.resolved', requestId, behavior: payload.behavior === 'completed' ? 'completed' : 'cancelled', result: payload.result ?? null }, attribution);
      return;
  }
}

// The engine withdrew one of its requests (none observed in the fixtures; SPEC 45).
export function mapInboundCancel(inbound: InboundTable, requestId: RequestId, out: EventSink): void {
  const entry = inbound.get(requestId);
  if (!entry) return;
  inbound.delete(requestId);
  const attribution = { parentToolUseId: entry.parentToolUseId, agentId: entry.agentId };
  switch (entry.kind) {
    case 'permission':
      out.emit({ kind: 'permission.resolved', requestId, toolUseId: entry.toolUseId!, behavior: 'deny', message: 'withdrawn by the engine', updatedInput: null, updatedPermissions: [], resolvedBy: 'abort' }, attribution);
      return;
    case 'dialog':
      out.emit({ kind: 'dialog.resolved', requestId, behavior: 'cancelled', result: null }, attribution);
      return;
    case 'elicitation':
      out.emit({ kind: 'elicitation.resolved', requestId, action: 'cancel', content: null }, attribution);
      return;
    default: // question, plan, hook: X1 has no withdrawn form; the request scope error says why the card went away
      out.emit({ kind: 'error.raised', scope: 'request', message: `${entry.kind} request withdrawn by the engine`, code: 'abort', toolUseId: entry.toolUseId, taskId: null, requestId }, attribution);
  }
}

function questionOf(raw: unknown): Question {
  const q = (raw ?? {}) as { question?: unknown; header?: unknown; options?: unknown[]; multiSelect?: unknown };
  return QuestionSchema.parse({
    question: String(q.question ?? ''),
    header: String(q.header ?? ''),
    options: (q.options ?? []).map((o) => {
      const opt = (o ?? {}) as { label?: unknown; description?: unknown; preview?: unknown };
      return { label: String(opt.label ?? ''), description: stringOrNull(opt.description), preview: stringOrNull(opt.preview) };
    }),
    multiSelect: q.multiSelect === true,
  });
}
