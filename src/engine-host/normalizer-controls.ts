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
// E1 start
import { withQuestionIds } from '@shared/maws/ask';
import { readMcpMessage, toolCallOf } from '@shared/maws/rpc';
import { ArtifactCreateResultSchema, ArtifactUpdateResultSchema, AskAnswerSchema, AskResultSchema, isMawsToolName, parseToolArguments, SendFileResultSchema, ShowPaneResultSchema } from '@shared/maws/tools';
// E1 end
// E4c start (frozen since the browser tools left the server, P1 A-54)
import { browserCallOf, browserToolResultSchemaOf, isBrowserToolName, parseBrowserToolArguments, type BrowserToolName, type BrowserWaitReason } from '@shared/maws/browser';
// E4c end
import type { ControlRequestFrame, ControlResponseFrame } from '@shared/wire/frames';
import { compact, stringOrNull, type Attribution, type EventSink } from './normalizer-support';

// One inbound request awaiting our answer, kept so the answer (whose envelope carries no subtype) resolves to the right kind.
export type InboundKind = 'permission' | 'question' | 'plan' | 'hook' | 'elicitation' | 'dialog' | 'mcp' /* E1 */;
export interface InboundEntry {
  kind: InboundKind;
  toolUseId: ToolUseId | null;
  callbackId: string | null;
  parentToolUseId: ParentToolUseId | null;
  agentId: AgentId | null;
  mcp: McpCall | null; // E1: a `tools/call` of the `maws` server (kind 'mcp'), else null
}
// E1: one call of the `maws` server, remembered by its raw name and arguments (as the wire carried them) until the host's
// answer; `admitted` whether the arguments parse with the tool's input schema, decided once at the call (residue 1:
// a refused call yields no `maws.*` event, so the host and the normaliser agree on the same calls). `askId`: an admitted
// ask's id (the tool-use id, else the request id: residue 2), else null.
export interface McpCall {
  tool: string;
  askId: string | null;
  toolUseId: ToolUseId | null;
  args: unknown;
  admitted: boolean;
}
export type InboundTable = Map<RequestId, InboundEntry>;
// E1 M2: the asks whose `maws.ask.opened` was emitted and that are not yet answered or cancelled; an answer or a
// cancellation yields its event only for one of them.
export type OpenAsks = Set<string>;

// The deny message M3's broker sends for the plan outcome "clear context and implement" (Interfaces, Broker); the
// outcome is read back from it so a journal rebuild reproduces the live event.
export const CLEAR_AND_IMPLEMENT_MESSAGE = 'Plan approved; MAWS is clearing context and will restart with the plan.';

export function mapInboundRequest(inbound: InboundTable, frame: ControlRequestFrame, out: EventSink, attribution: Attribution, openAsks: OpenAsks = new Set() /* E1 */): void {
  const requestId = frame.request_id as RequestId;
  const request = frame.request;
  const remember = (entry: Omit<InboundEntry, 'parentToolUseId' | 'agentId' | 'mcp'> & { mcp?: McpCall }, agentId: AgentId | null = attribution.agentId) =>
    inbound.set(requestId, { ...entry, mcp: entry.mcp ?? null, parentToolUseId: attribution.parentToolUseId, agentId });
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
    // E1 start: the engine's JSON-RPC traffic for the `maws` server. Only a `tools/call` the server serves is remembered
    // (its answer makes the event), read exactly as the server reads it (src/shared/maws/rpc.ts: another server, a
    // malformed envelope or a notification-like id is never served); the handshake (`initialize`, `notifications/*`,
    // `ping`, `tools/list`) and another server's messages make nothing: they are not unknown, they are protocol
    case 'mcp_message': {
      const message = readMcpMessage(request);
      if (message.kind !== 'request' || message.method !== 'tools/call') return;
      const { name, args, toolUseId } = toolCallOf(message.params);
      const tool = typeof name === 'string' ? name : '';
      // E4c: a call of a removed browser tool (P1 A-54) is admitted as the server admitted it then, so a journal written
      // before the removal maps as it always did
      const admitted = isMawsToolName(tool) ? parseToolArguments(tool, args).ok : isBrowserToolName(tool) && parseBrowserToolArguments(tool, args).ok;
      const ask = admitted && tool === 'ask' ? parseToolArguments('ask', args) : null;
      const askId = ask?.ok ? (toolUseId ?? requestId) : null;
      remember({ kind: 'mcp', toolUseId, callbackId: null, mcp: { tool, askId, toolUseId, args, admitted } });
      if (ask?.ok && askId !== null) {
        // M2: the ask opens at the call, as the host holds it (question ids filled)
        const { title, context, blocking, questions } = ask.data;
        openAsks.add(askId);
        out.emit({ kind: 'maws.ask.opened', askId, toolUseId, requestId, blocking: blocking ?? true, title: title ?? null, context: context ?? null, questions: withQuestionIds(questions) }, attribution);
      }
      return;
    }
    // E1 end
    default:
      out.emit({ kind: 'frame.unknown', frameType: 'control_request', subtype: request.subtype }, attribution);
  }
}

// Our answer to an inbound request (an `out` control_response row). `note` is the broker's annotation journaled just
// before it (`meta answer_note`: why the answer differs from what the human chose), appended to a permission's message.
export function mapOutboundResponse(inbound: InboundTable, frame: ControlResponseFrame, out: EventSink, note: string | null = null, openAsks: OpenAsks = new Set() /* E1 */): void {
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
    case 'mcp': // E1
      if (envelope.subtype === 'success') mapMawsAnswer(requestId, entry.mcp!, payload.mcp_response, out, attribution, openAsks);
      return;
  }
}

// E1 start: the host's answer to a `tools/call` of the `maws` server, for an admitted call only: `maws.delivery.file`
// for a `send_file` whose result reads `delivered`, `maws.pane.shown` for a `show_pane` (what opened, or the error text
// of a pane this build lacks or a window that never answered), `maws.ask.answered` for a blocking ask answered with its
// AskResult (an async ask's `asked` acknowledgement yields nothing: its answers come with the `maws_ask_answered` meta
// row). Anything else (another tool, a result that parses as neither) is visible as the call's `tool.result` alone.
function mapMawsAnswer(requestId: RequestId, call: McpCall, rpc: unknown, out: EventSink, attribution: Attribution, openAsks: OpenAsks): void {
  if (!call.admitted) return;
  const result = (rpc as { result?: { content?: unknown; isError?: unknown } } | null | undefined)?.result;
  if (!result || !Array.isArray(result.content)) return;
  const text = (result.content as { type?: unknown; text?: unknown }[]).find((block) => block?.type === 'text' && typeof block.text === 'string')?.text as string | undefined;
  if (text === undefined) return;
  const isError = result.isError === true;
  const json = isError ? null : parseJson(text);
  if (call.tool === 'send_file') {
    const parsed = SendFileResultSchema.safeParse(json);
    const args = parseToolArguments('send_file', call.args);
    if (!parsed.success || !args.ok) return;
    out.emit({ kind: 'maws.delivery.file', toolUseId: call.toolUseId, requestId, deliverables: parsed.data.deliverables, caption: args.data.caption ?? null, urgency: args.data.urgency ?? 'normal' }, attribution);
    return;
  }
  if (call.tool === 'show_pane') {
    const args = parseToolArguments('show_pane', call.args);
    const parsed = ShowPaneResultSchema.safeParse(json);
    if (!args.ok || (!isError && !parsed.success)) return;
    out.emit({ kind: 'maws.pane.shown', toolUseId: call.toolUseId, requestId, pane: args.data.pane, target: args.data.target ?? null, opened: parsed.success ? parsed.data.opened : null, error: isError ? text : null }, attribution);
    return;
  }
  // E2 start: `maws.delivery.artifact` for an `artifact_create` or `artifact_update` whose answer parses as its result (a
  // refusal is an `isError` text and yields nothing). Their answers are the host's one text block; the engine's own
  // pointer block beside an image block reaches the transcript, never this answer (E2 M0).
  if (call.tool === 'artifact_create' || call.tool === 'artifact_update') {
    const parsed = call.tool === 'artifact_create' ? ArtifactCreateResultSchema.safeParse(json) : ArtifactUpdateResultSchema.safeParse(json);
    if (!parsed.success) return;
    const { id: artifactId, deliverableId, version, title } = parsed.data;
    const owner = 'ownerAppSessionId' in parsed.data && parsed.data.ownerAppSessionId !== undefined ? { ownerAppSessionId: parsed.data.ownerAppSessionId } : {}; // P2-E1: an ancestor's record
    out.emit({ kind: 'maws.delivery.artifact', toolUseId: call.toolUseId, requestId, action: call.tool === 'artifact_create' ? 'create' : 'update', artifactId, deliverableId, version, title, ...owner }, attribution);
    return;
  }
  // E2 end
  // E4c start: `maws.browser.action` for an admitted browser tool call the host answered, a success that parses as the
  // tool's result or a refusal (its text the `error`), so the row's facts come from the journal (E4c Design §10). Frozen
  // for journals written before the tools left the server (P1 A-54).
  if (isBrowserToolName(call.tool)) {
    const action = browserActionOf(call.tool, call.args, isError ? null : json, isError ? text : null);
    if (action !== null) out.emit({ kind: 'maws.browser.action', toolUseId: call.toolUseId, requestId, ...action }, attribution);
    return;
  }
  // E4c end
  if (call.tool === 'ask' && call.askId !== null && openAsks.has(call.askId)) {
    const parsed = AskResultSchema.safeParse(json);
    if (!parsed.success || parsed.data.status !== 'answered') return;
    openAsks.delete(call.askId);
    out.emit({ kind: 'maws.ask.answered', askId: call.askId, toolUseId: call.toolUseId, answers: parsed.data.answers, delivery: 'result' }, attribution);
  }
}

// M2: the host's meta rows for what no frame carries: an async ask's answers, written once their steer was, and an ask
// cancelled because the engine withdrew its call or the process ended. Each yields its event only for an open ask.
export function mapMawsAskMeta(meta: Record<string, unknown>, out: EventSink, attribution: Attribution, openAsks: OpenAsks): void {
  const askId = typeof meta.askId === 'string' ? meta.askId : null;
  if (askId === null || !openAsks.has(askId)) return;
  const toolUseId = typeof meta.toolUseId === 'string' ? (meta.toolUseId as ToolUseId) : null;
  if (meta.event === 'maws_ask_answered') {
    const answers = z.array(AskAnswerSchema).safeParse(meta.answers);
    if (!answers.success) return;
    openAsks.delete(askId);
    out.emit({ kind: 'maws.ask.answered', askId, toolUseId, answers: answers.data, delivery: 'steer' }, attribution);
  } else if (meta.event === 'maws_ask_cancelled' && (meta.reason === 'exit' || meta.reason === 'withdrawn')) {
    openAsks.delete(askId);
    out.emit({ kind: 'maws.ask.cancelled', askId, toolUseId, reason: meta.reason }, attribution);
  }
}

// E4c start: what one browser call did, from its arguments (the action and its target) and its answer (the page, the
// timing, the deliverable, the waits); null when the answer is a success that is not the tool's result.
type BrowserAction = Omit<Extract<EventPayload, { kind: 'maws.browser.action' }>, 'kind' | 'toolUseId' | 'requestId'>;

function browserActionOf(tool: BrowserToolName, rawArgs: unknown, json: unknown, error: string | null): BrowserAction | null {
  const args = parseBrowserToolArguments(tool, rawArgs);
  if (!args.ok) return null;
  const call = browserCallOf(tool, args.data);
  let result: BrowserResultFields | null = null;
  if (error === null) {
    const parsed = browserToolResultSchemaOf(tool).safeParse(json);
    if (!parsed.success) return null;
    result = parsed.data as BrowserResultFields;
  }
  return {
    tool, action: call.action, tabId: result?.tabId ?? call.tabId, target: call.target,
    url: result?.url ?? null, title: result?.title ?? null, ms: result?.ms ?? null, deliverableId: result?.deliverableId ?? null, error,
    waitedFor: result?.waitedFor ?? null, waitedMs: result?.waitedMs ?? null,
  };
}

// The fields of the six results the event reads (each result has some of them).
interface BrowserResultFields {
  tabId?: string | null;
  url?: string | null;
  title?: string | null;
  ms?: number;
  deliverableId?: string;
  waitedFor?: BrowserWaitReason | null;
  waitedMs?: number | null;
}
// E4c end

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
// E1 end

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
    case 'mcp': // E1: a withdrawn tool call is never answered; its tool.result (if the engine writes one) says the rest
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
