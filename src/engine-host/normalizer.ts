// The normaliser (charter §13 X1; C3 execution document, Interfaces "Normaliser"): the pure function from journal rows
// to X1 events, and the only source of events in the host. Every event derives from a row the host already wrote
// (`in` frames, the host's own `out` frames, and the `meta` rows the host writes for exits, reconnects and transport
// trouble), so `seq` is never null, every id is `${appSessionId}:${launchId}:${seq}:${i}`, and re-reading a journal
// through a fresh Normalizer reproduces the live event list exactly. The correlation state is explicit (`state`) so
// a replay can start from any row given a saved state. Turn rule: the human turn opens at the host's own querying
// `user` frame (the bubble shows on send), `system/init` marks acceptance inside it and opens an engine-initiated
// turn only when no turn is open and no `!` echo awaits its receipt. This file holds the class and the frames that
// touch turn, lane and correlation state; `normalizer-system.ts` maps the other system subtypes and
// `normalizer-support.ts` holds the pure projections.
import * as z from 'zod';
import { PERMISSION_MODES, type PermissionMode } from '@shared/graph/enums';
import type { EventPayload, Question, SessionEvent } from '@shared/graph/events';
import { QuestionSchema } from '@shared/graph/events';
import type { AgentId, ApiMessageId, AppSessionId, EventId, MessageUuid, ParentToolUseId, RequestId, SessionId, TaskId, ToolUseId } from '@shared/graph/ids';
import { CanUseToolRequestSchema, ElicitationRequestSchema, HookCallbackRequestSchema, RequestUserDialogRequestSchema, RewindConversationResponseSchema } from '@shared/wire/control';
import {
  parseStdinFrame,
  parseStdoutFrame,
  type AssistantFrame,
  type CommandLifecycleFrame,
  type ControlCancelRequestFrame,
  type ControlRequestFrame,
  type ControlResponseFrame,
  type ConversationResetFrame,
  type ResultFrame,
  type StdoutFrame,
  type StreamEventFrame,
  type SystemFrame,
  type SystemInitFrame,
  type ToolProgressFrame,
  type UserFrame,
  type UserInputFrame,
} from '@shared/wire/frames';
import type { JournalRow } from '@shared/wire/journal';
import { bashPartOf, compact, denialKindOf, spillPathOf, stringOrNull, tokenUsageOf } from './normalizer-support';
import { mapSystemFrame, type TaskRegistry } from './normalizer-system';
import type { SafeguardVerdict } from '@shared/graph/enums';

export interface NormalizerWarning {
  event: 'block_pairing' | 'unknown_denial_kind' | 'unmatched_response' | 'unknown_permission_mode';
  seq: number;
  detail: Record<string, unknown>;
}

// One inbound request awaiting our answer, kept so the answer (whose envelope carries no subtype) resolves to the right kind.
type InboundKind = 'permission' | 'question' | 'plan' | 'hook' | 'elicitation' | 'dialog';
interface InboundEntry {
  kind: InboundKind;
  toolUseId: ToolUseId | null;
  callbackId: string | null;
  parentToolUseId: ParentToolUseId | null;
  agentId: AgentId | null;
}

interface Lane {
  apiMessageId: ApiMessageId | null;
  started: { index: number; type: string }[];
  userMessageUuid: MessageUuid | null;
}

export interface NormalizerState {
  sessionId: SessionId | null;
  currentTurn: { origin: 'human' | 'engine'; userMessageUuids: MessageUuid[]; startedAt: string; acceptedAt: string | null } | null;
  toolUseToAgent: Map<ToolUseId, AgentId>;
  safeguards: Map<ToolUseId, SafeguardVerdict>;
  lastUserMessageUuid: MessageUuid | null;
  pendingHumanUuids: Set<MessageUuid>;
  pendingEcho: MessageUuid | null;
  outbound: Map<RequestId, { subtype: string; request: unknown }>;
  inbound: Map<RequestId, InboundEntry>;
  streaming: Map<ParentToolUseId | null, Lane>;
  completedBlocks: Map<ApiMessageId, number>;
  taskTypes: Map<string, string>;
  workflowNames: Map<string, string>;
}

const CLEAR_AND_IMPLEMENT_MESSAGE = 'Plan approved; MAWS is clearing context and will restart with the plan.';

export class Normalizer {
  readonly state: NormalizerState;
  private readonly appSessionId: AppSessionId;
  private readonly launchId: string;
  private readonly warn: (warning: NormalizerWarning) => void;

  constructor(ctx: { appSessionId: AppSessionId; launchId: string; sessionId: SessionId | null; warn?: (warning: NormalizerWarning) => void; state?: NormalizerState }) {
    this.appSessionId = ctx.appSessionId;
    this.launchId = ctx.launchId;
    this.warn = ctx.warn ?? (() => {});
    this.state = ctx.state ?? {
      sessionId: ctx.sessionId,
      currentTurn: null,
      toolUseToAgent: new Map(),
      safeguards: new Map(),
      lastUserMessageUuid: null,
      pendingHumanUuids: new Set(),
      pendingEcho: null,
      outbound: new Map(),
      inbound: new Map(),
      streaming: new Map(),
      completedBlocks: new Map(),
      taskTypes: new Map(),
      workflowNames: new Map(),
    };
  }

  // The events one journal row yields, in order. Never throws: a frame the schemas reject becomes `error.raised`.
  push(row: JournalRow): SessionEvent[] {
    const out = new Emitter(this.appSessionId, this.launchId, row, this.state);
    try {
      switch (row.direction) {
        case 'in':
          this.pushIn(row, out);
          break;
        case 'out':
          this.pushOut(row, out);
          break;
        case 'meta':
          this.pushMeta(row, out);
          break;
        case 'stderr':
          break;
      }
    } catch (error) {
      const message = error instanceof z.ZodError ? error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ') : error instanceof Error ? error.message : String(error);
      out.emit({ kind: 'error.raised', scope: 'transport', message: `row ${row.seq} could not be normalised: ${message}`, code: 'invalid_frame', toolUseId: null, taskId: null, requestId: null }, null);
    }
    return out.events;
  }

  private get tasks(): TaskRegistry {
    return { taskTypes: this.state.taskTypes, workflowNames: this.state.workflowNames, toolUseToAgent: this.state.toolUseToAgent };
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Stdout frames

  private pushIn(row: JournalRow, out: Emitter): void {
    const frame = parseStdoutFrame(row.frame);
    const sessionId = (frame as { session_id?: unknown }).session_id;
    if (typeof sessionId === 'string' && sessionId.length > 0) this.state.sessionId = sessionId as SessionId;
    const lane = laneOf(frame);
    const agentId = lane === null ? null : (this.state.toolUseToAgent.get(lane as unknown as ToolUseId) ?? null);
    const attribution = { parentToolUseId: lane, agentId };

    // C1's StdoutFrame union carries the loose UnknownFrame (`type: string`), so the switch does not narrow; each case
    // names the frame type `parseStdoutFrame` validated it against.
    switch (frame.type) {
      case 'system': {
        const system = frame as SystemFrame;
        if (system.subtype === 'init') this.systemInit(system as SystemInitFrame, row, out, attribution);
        else {
          const mapping = mapSystemFrame(system, this.tasks);
          for (const payload of mapping.payloads) out.emit(payload, { parentToolUseId: lane, agentId: agentId ?? mapping.agentId });
        }
        return;
      }
      case 'stream_event':
        this.streamEvent(frame as StreamEventFrame, out, attribution);
        return;
      case 'assistant':
        this.assistant(frame as AssistantFrame, row, out, attribution);
        return;
      case 'user':
        this.userIn(frame as UserFrame, row, out, attribution);
        return;
      case 'result':
        this.result(frame as ResultFrame, out, attribution);
        return;
      case 'command_lifecycle': {
        const f = frame as CommandLifecycleFrame;
        out.emit({ kind: 'command.lifecycle', commandUuid: f.command_uuid as MessageUuid, state: f.state }, attribution);
        return;
      }
      case 'tool_progress': {
        const f = frame as ToolProgressFrame;
        out.emit({ kind: 'tool.progress', toolUseId: f.tool_use_id as ToolUseId, toolName: f.tool_name, elapsedSeconds: f.elapsed_time_seconds, taskId: (f.task_id ?? null) as TaskId | null, heartbeat: f.heartbeat ?? false }, attribution);
        return;
      }
      case 'conversation_reset': {
        const f = frame as ConversationResetFrame;
        out.emit({ kind: 'boundary.reset', newConversationId: f.new_conversation_id, trigger: f.trigger ?? null }, attribution);
        return;
      }
      case 'control_request':
        this.inboundRequest(frame as ControlRequestFrame, out, attribution);
        return;
      case 'control_response':
        this.inboundResponse(frame as ControlResponseFrame, out, attribution);
        return;
      case 'control_cancel_request':
        this.inboundCancel((frame as ControlCancelRequestFrame).request_id as RequestId, out);
        return;
      case 'tool_use_summary':
      case 'prompt_suggestion':
      case 'rate_limit_event':
      case 'auth_status':
      case 'keep_alive':
        return; // journaled, no consumer in P0
      default:
        out.emit({ kind: 'frame.unknown', frameType: String((frame as { type: unknown }).type), subtype: null }, attribution);
    }
  }

  private systemInit(frame: SystemInitFrame, row: JournalRow, out: Emitter, attribution: Attribution): void {
    const permissionMode = frame.permissionMode as PermissionMode;
    if (!(PERMISSION_MODES as readonly string[]).includes(permissionMode)) this.warn({ event: 'unknown_permission_mode', seq: row.seq, detail: { permissionMode } });
    out.emit({
      kind: 'session.init', cwd: frame.cwd, model: frame.model, permissionMode, tools: frame.tools, slashCommands: frame.slash_commands, agents: frame.agents ?? [], skills: frame.skills ?? [],
      plugins: (frame.plugins ?? []).map((p) => ({ name: p.name, source: p.source })), mcpServers: frame.mcp_servers, capabilities: frame.capabilities ?? [], engineVersion: frame.claude_code_version,
      outputStyle: frame.output_style ?? null,
    }, attribution);
    if (attribution.parentToolUseId !== null) return;
    if (this.state.pendingEcho !== null) return; // the `!` echo's own lifecycle (pass2/bash-context-echoed seq 12): opens nothing, marks nothing
    if (this.state.currentTurn) {
      this.state.currentTurn.acceptedAt = out.at;
      return;
    }
    this.state.currentTurn = { origin: 'engine', userMessageUuids: [], startedAt: out.at, acceptedAt: out.at };
    out.emit({ kind: 'turn.started', userMessageUuid: null, origin: 'engine' }, attribution);
  }

  private streamEvent(frame: StreamEventFrame, out: Emitter, attribution: Attribution): void {
    const lane = attribution.parentToolUseId;
    const event = frame.event as Record<string, unknown> & { type: string };
    switch (event.type) {
      case 'message_start': {
        const message = event.message as { id?: unknown } | undefined;
        const userMessageUuid = (frame as { user_message_uuid?: unknown }).user_message_uuid;
        this.state.streaming.set(lane, { apiMessageId: typeof message?.id === 'string' ? (message.id as ApiMessageId) : null, started: [], userMessageUuid: typeof userMessageUuid === 'string' ? (userMessageUuid as MessageUuid) : null });
        return;
      }
      case 'content_block_start': {
        const block = event.content_block as { type?: unknown } | undefined;
        const current = this.state.streaming.get(lane) ?? { apiMessageId: null, started: [], userMessageUuid: null };
        current.started.push({ index: Number(event.index), type: typeof block?.type === 'string' ? block.type : 'unknown' });
        this.state.streaming.set(lane, current);
        return;
      }
      case 'content_block_delta': {
        const delta = event.delta as { type?: string; text?: string; thinking?: string; partial_json?: string } | undefined;
        if (!delta || delta.type === 'signature_delta') return; // a signature carries no content; the complete block carries it
        const current = this.state.streaming.get(lane);
        const index = Number(event.index);
        const started = current?.started.find((s) => s.index === index);
        const blockType = started?.type ?? (delta.type === 'text_delta' ? 'text' : delta.type === 'thinking_delta' ? 'thinking' : delta.type === 'input_json_delta' ? 'tool_use' : String(delta.type));
        out.emit({
          kind: 'assistant.block.delta', apiMessageId: current?.apiMessageId ?? null, blockIndex: index, blockType,
          textDelta: delta.type === 'text_delta' ? (delta.text ?? '') : null,
          thinkingDelta: delta.type === 'thinking_delta' ? (delta.thinking ?? '') : null,
          inputJsonDelta: delta.type === 'input_json_delta' ? (delta.partial_json ?? '') : null,
          userMessageUuid: current?.userMessageUuid ?? null,
        }, attribution);
        return;
      }
      case 'message_delta': {
        const delta = event.delta as { safeguard_results?: unknown } | undefined;
        if (!Array.isArray(delta?.safeguard_results)) return;
        for (const result of delta.safeguard_results as { status?: { tool_uses?: Record<string, { outcome?: string }> } }[]) {
          for (const [id, entry] of Object.entries(result.status?.tool_uses ?? {})) {
            const verdict = entry.outcome === 'flagged' ? 'flagged' : 'not_flagged';
            this.state.safeguards.set(id as ToolUseId, verdict);
            out.emit({ kind: 'tool.safeguard', toolUseId: id as ToolUseId, verdict, lane: 'server' }, attribution);
          }
        }
        return;
      }
      default:
        return; // content_block_stop, message_stop
    }
  }

  // One frame per content block on the wire; the block index is the stream's (`content_block_start`) index paired
  // per message id in order, and content order per message id when the message was not streamed (children).
  private assistant(frame: AssistantFrame, row: JournalRow, out: Emitter, attribution: Attribution): void {
    const lane = this.state.streaming.get(attribution.parentToolUseId);
    const apiMessageId = frame.message.id as ApiMessageId;
    const messageUuid = frame.uuid as MessageUuid;
    const userMessageUuids = attribution.parentToolUseId === null ? [...(this.state.currentTurn?.userMessageUuids ?? [])] : [];
    for (const block of frame.message.content) {
      let blockIndex: number;
      const streamed = lane && lane.apiMessageId === apiMessageId ? lane.started.shift() : undefined;
      if (streamed) {
        blockIndex = streamed.index;
        if (streamed.type !== block.type) this.warn({ event: 'block_pairing', seq: row.seq, detail: { apiMessageId, blockIndex, started: streamed.type, completed: block.type } });
      } else {
        blockIndex = this.state.completedBlocks.get(apiMessageId) ?? 0;
      }
      this.state.completedBlocks.set(apiMessageId, blockIndex + 1);
      out.emit({ kind: 'assistant.block.complete', messageUuid, apiMessageId, blockIndex, block, model: frame.message.model, supersedes: null, aborted: false, userMessageUuids }, attribution);
      if (block.type === 'tool_use') {
        out.emit({ kind: 'tool.use', toolUseId: String(block.id) as ToolUseId, toolName: String(block.name), input: block.input, apiMessageId, messageUuid }, attribution);
      }
    }
  }

  private userIn(frame: UserFrame, row: JournalRow, out: Emitter, attribution: Attribution): void {
    const content = frame.message.content;
    const results = typeof content === 'string' ? [] : content.filter((b) => b.type === 'tool_result');
    if (results.length > 0) {
      const meta = frame.tool_result_meta ?? [];
      const launch = frame.tool_use_result as { agentId?: unknown } | null | undefined;
      for (const block of results) {
        const toolUseId = String(block.tool_use_id) as ToolUseId;
        if (launch && typeof launch === 'object' && typeof launch.agentId === 'string') this.state.toolUseToAgent.set(toolUseId, launch.agentId as AgentId);
        const denial = denialKindOf(meta.find((m) => m.id === toolUseId)?.non_execution_kind);
        if (denial === 'unknown') this.warn({ event: 'unknown_denial_kind', seq: row.seq, detail: { toolUseId, kind: meta.find((m) => m.id === toolUseId)?.non_execution_kind } });
        const blockContent = (block.content ?? '') as string | typeof content;
        out.emit({
          kind: 'tool.result', toolUseId, content: blockContent, isError: block.is_error === true, structured: frame.tool_use_result ?? null,
          spillPath: spillPathOf(frame.tool_use_result, blockContent), denial: denial === 'unknown' ? null : denial,
          safeguard: this.state.safeguards.get(toolUseId) ?? 'not_evaluated', messageUuid: (frame.uuid ?? null) as MessageUuid | null,
        }, attribution);
      }
      return;
    }
    const uuid = (frame.uuid ?? null) as MessageUuid | null;
    if (uuid !== null && this.state.pendingHumanUuids.has(uuid)) {
      this.state.pendingHumanUuids.delete(uuid); // the engine's --replay-user-messages echo of our own frame
      return;
    }
    const bash = bashPartOf(content);
    out.emit({
      kind: 'user.message', messageUuid: uuid, content: bash === null ? content : bash.part === 'input' ? bash.command : bash.stdout,
      isReplay: frame.isReplay ?? false, isSynthetic: frame.isSynthetic ?? false, origin: frame.origin?.kind ?? null, bash,
    }, attribution);
  }

  private result(frame: ResultFrame, out: Emitter, attribution: Attribution): void {
    const f = frame as ResultFrame & Record<string, unknown>;
    const terminalReason = stringOrNull(f.terminal_reason);
    const isEchoReceipt = this.state.pendingEcho !== null && frame.num_turns === 0 && terminalReason === null;
    const denials = (frame.permission_denials as { tool_name?: unknown; tool_use_id?: unknown; tool_input?: unknown }[]).map((d) => ({ toolName: String(d.tool_name), toolUseId: String(d.tool_use_id) as ToolUseId, toolInput: d.tool_input }));
    const usage = tokenUsageOf(frame.usage);
    const origin = (f.origin as { kind?: unknown } | undefined)?.kind;
    if (attribution.parentToolUseId === null) {
      out.emit({
        kind: 'turn.ended', result: frame.subtype, isError: frame.is_error, terminalReason, resultText: stringOrNull(f.result), durationMs: frame.duration_ms, numTurns: frame.num_turns,
        costUsd: frame.total_cost_usd, usage, permissionDenials: denials, errors: Array.isArray(f.errors) ? f.errors.map(String) : [],
        userMessageUuids: (Array.isArray(f.user_message_uuids) ? f.user_message_uuids : []) as MessageUuid[], origin: stringOrNull(origin),
        resultIndex: typeof f.result_index === 'number' ? f.result_index : null, isEchoReceipt,
      }, attribution);
      if (isEchoReceipt) this.state.pendingEcho = null;
      else this.state.currentTurn = null;
    }
    out.emit({ kind: 'usage.sample', costUsd: frame.total_cost_usd, usage, modelUsage: (f.modelUsage ?? {}) as Record<string, unknown>, source: 'result' }, attribution);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Inbound requests and our answers

  private inboundRequest(frame: ControlRequestFrame, out: Emitter, attribution: Attribution): void {
    const requestId = frame.request_id as RequestId;
    const request = frame.request;
    const remember = (entry: Omit<InboundEntry, 'parentToolUseId' | 'agentId'>, agentId: AgentId | null = attribution.agentId) =>
      this.state.inbound.set(requestId, { ...entry, parentToolUseId: attribution.parentToolUseId, agentId });
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
        out.emit({ kind: 'dialog.requested', requestId, dialogKind: req.dialog_kind, payload: request, toolUseId }, attribution);
        return;
      }
      default:
        out.emit({ kind: 'frame.unknown', frameType: 'control_request', subtype: request.subtype }, attribution);
    }
  }

  // Our answer to an inbound request (an `out` control_response row).
  private outboundResponse(frame: ControlResponseFrame, out: Emitter): void {
    const envelope = frame.response;
    const requestId = envelope.request_id as RequestId;
    const entry = this.state.inbound.get(requestId);
    if (!entry) return;
    this.state.inbound.delete(requestId);
    const attribution = { parentToolUseId: entry.parentToolUseId, agentId: entry.agentId };
    const payload = (envelope.subtype === 'success' ? (envelope.response ?? {}) : { behavior: 'deny', message: envelope.error }) as Record<string, unknown>;
    const message = stringOrNull(payload.message);
    switch (entry.kind) {
      case 'permission':
        out.emit({
          kind: 'permission.resolved', requestId, toolUseId: entry.toolUseId!, behavior: payload.behavior === 'allow' ? 'allow' : 'deny', message,
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
  private inboundCancel(requestId: RequestId, out: Emitter): void {
    const entry = this.state.inbound.get(requestId);
    if (!entry) return;
    this.state.inbound.delete(requestId);
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

  // The engine's answer to one of our requests: none as events, except the successful conversation rewind.
  private inboundResponse(frame: ControlResponseFrame, out: Emitter, attribution: Attribution): void {
    const requestId = frame.response.request_id as RequestId;
    const sent = this.state.outbound.get(requestId);
    if (!sent) return;
    this.state.outbound.delete(requestId);
    if (sent.subtype !== 'rewind_conversation' || frame.response.subtype !== 'success') return;
    const parsed = RewindConversationResponseSchema.safeParse(frame.response.response);
    if (!parsed.success || !parsed.data.rewound) return;
    const target = parsed.data.targetMessageUuid ?? (sent.request as { target_message_uuid?: unknown }).target_message_uuid;
    out.emit({ kind: 'boundary.rewind', targetMessageUuid: String(target) as MessageUuid, precedingAssistantUuid: (parsed.data.precedingAssistantUuid ?? null) as MessageUuid | null, prefillText: parsed.data.prefillText ?? null }, attribution);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Stdin frames (ours)

  private pushOut(row: JournalRow, out: Emitter): void {
    const frame = parseStdinFrame(row.frame);
    const main: Attribution = { parentToolUseId: null, agentId: null };
    switch (frame.type) {
      case 'user':
        this.userOut(frame, out, main);
        return;
      case 'control_request':
        this.state.outbound.set(frame.request_id as RequestId, { subtype: frame.request.subtype, request: frame.request });
        return;
      case 'control_response':
        this.outboundResponse(frame, out);
        return;
      case 'bash_command':
      case 'control_cancel_request':
      case 'keep_alive':
        return;
    }
  }

  private userOut(frame: UserInputFrame, out: Emitter, main: Attribution): void {
    const uuid = (frame.uuid ?? null) as MessageUuid | null;
    const content = frame.message.content;
    if (uuid !== null) this.state.pendingHumanUuids.add(uuid);
    if (frame.shouldQuery === false) {
      this.state.pendingEcho = uuid;
      out.emit({ kind: 'user.message', messageUuid: uuid, content, isReplay: false, isSynthetic: true, origin: 'bash_echo', bash: null }, main);
      return;
    }
    if (this.state.currentTurn === null) {
      this.state.currentTurn = { origin: 'human', userMessageUuids: uuid === null ? [] : [uuid], startedAt: out.at, acceptedAt: null };
      out.emit({ kind: 'turn.started', userMessageUuid: uuid, origin: 'human' }, main);
    } else if (uuid !== null) {
      this.state.currentTurn.userMessageUuids.push(uuid); // a steer into the open turn
    }
    this.state.lastUserMessageUuid = uuid;
    out.emit({ kind: 'user.message', messageUuid: uuid, content, isReplay: false, isSynthetic: false, origin: 'human', bash: null }, main);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Meta rows the host writes for what the design called synthesised events

  private pushMeta(row: JournalRow, out: Emitter): void {
    const meta = row.frame as Record<string, unknown> & { event?: unknown };
    const main: Attribution = { parentToolUseId: null, agentId: null };
    switch (meta.event) {
      case 'exit': {
        const code = typeof meta.code === 'number' ? meta.code : null;
        const signal = stringOrNull(meta.signal);
        const reason = typeof meta.reason === 'string' ? (meta.reason as 'quit' | 'stop' | 'archive' | 'crash' | 'unknown') : code === 0 && signal === null ? 'unknown' : 'crash';
        out.emit({ kind: 'process.exited', code, signal, reason, lostAttentionCount: typeof meta.lostAttentionCount === 'number' ? meta.lostAttentionCount : 0 }, main);
        return;
      }
      case 'reconnect':
        out.emit({
          kind: 'session.reconnect', phase: meta.phase as 'attempting' | 'reconnected' | 'failed', attempt: typeof meta.attempt === 'number' ? meta.attempt : 1,
          maxAttempts: typeof meta.maxAttempts === 'number' ? meta.maxAttempts : null, trigger: (meta.trigger ?? 'user') as 'user', reason: stringOrNull(meta.reason),
        }, main);
        return;
      case 'parse_error':
      case 'transport_error':
      case 'replay_mismatch':
      case 'init_failed':
        out.emit({
          kind: 'error.raised', scope: meta.event === 'init_failed' ? 'process' : 'transport', message: stringOrNull(meta.message) ?? String(meta.event),
          code: stringOrNull(meta.code) ?? String(meta.event), toolUseId: null, taskId: null, requestId: null,
        }, main);
        return;
      default:
        return; // spawn, relay_health, initialize, status_check, queue, block_pairing, and the probe's own notes
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------

interface Attribution {
  parentToolUseId: ParentToolUseId | null;
  agentId: AgentId | null;
}

// Stamps the base fields on each payload a row yields: the row's seq, the frame's timestamp or the row's `at`, the
// session id known at that point, and the event's index within the row.
class Emitter {
  readonly events: SessionEvent[] = [];
  readonly at: string;
  private readonly sessionId: () => SessionId;

  constructor(
    private readonly appSessionId: AppSessionId,
    private readonly launchId: string,
    private readonly row: JournalRow,
    state: NormalizerState,
  ) {
    const timestamp = (row.frame as { timestamp?: unknown } | null)?.timestamp;
    this.at = typeof timestamp === 'string' ? timestamp : row.at;
    this.sessionId = () => state.sessionId ?? ('unknown' as SessionId);
  }

  emit(payload: EventPayload, attribution: Attribution | null): void {
    const id = `${this.appSessionId}:${this.launchId}:${this.row.seq}:${this.events.length}` as EventId;
    this.events.push({
      id, sessionId: this.sessionId(), at: this.at, seq: this.row.seq,
      agentId: attribution?.agentId ?? null, parentToolUseId: attribution?.parentToolUseId ?? null,
      ...payload,
    } as SessionEvent);
  }
}

function laneOf(frame: StdoutFrame): ParentToolUseId | null {
  const parent = (frame as { parent_tool_use_id?: unknown }).parent_tool_use_id;
  return typeof parent === 'string' && parent.length > 0 ? (parent as ParentToolUseId) : null;
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
