// The normaliser (charter §13 X1; C3 execution document, Interfaces "Normaliser"): the pure function from journal rows
// to X1 events, and the only source of events in the host. Every event derives from a row the host already wrote
// (`in` frames, the host's own `out` frames, and the `meta` rows the host writes for exits, reconnects and transport
// trouble), so `seq` is never null, every id is `${appSessionId}:${launchId}:${seq}:${i}`, and re-reading a journal
// through a fresh Normalizer reproduces the live event list exactly. The correlation state is explicit (`state`) so
// a replay can start from any row given a saved state. Turn rule: the human turn opens at the host's own querying
// `user` frame (the bubble shows on send), `system/init` marks acceptance inside it and opens an engine-initiated
// turn only when no turn is open and no `!` echo awaits its receipt. This file holds the class and the frames that
// touch turn, lane and correlation state; `normalizer-controls.ts` projects inbound requests and our answers,
// `normalizer-system.ts` maps the other system subtypes and `normalizer-support.ts` holds the pure projections.
import * as z from 'zod';
import { PERMISSION_MODES, type PermissionMode } from '@shared/graph/enums';
import type { EventPayload, SessionEvent } from '@shared/graph/events';
import type { AgentId, ApiMessageId, AppSessionId, EventId, MessageUuid, ParentToolUseId, RequestId, SessionId, TaskId, ToolUseId } from '@shared/graph/ids';
import { RewindConversationResponseSchema } from '@shared/wire/control';
import {
  ControlRequestFrameSchema,
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
import { bashPartOf, denialKindOf, engineUserMarkerOf, spillPathOf, stringOrNull, tokenUsageOf, type Attribution, type EventSink } from './normalizer-support';
import { mapInboundCancel, mapInboundRequest, mapOutboundResponse, type InboundEntry } from './normalizer-controls';
import { mapSystemFrame, type TaskRegistry } from './normalizer-system';
import type { SafeguardVerdict } from '@shared/graph/enums';

export interface NormalizerWarning {
  event: 'block_pairing' | 'unknown_denial_kind' | 'unmatched_response' | 'unknown_permission_mode';
  seq: number;
  detail: Record<string, unknown>;
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
  answerNotes: Map<RequestId, string>; // the broker's `meta answer_note` rows, folded into the answer they precede
  streaming: Map<ParentToolUseId | null, Lane>;
  completedBlocks: Map<ApiMessageId, number>;
  taskTypes: Map<string, string>;
  workflowNames: Map<string, string>;
}

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
      answerNotes: new Map(),
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
        this.droppedPrompt(f, out, attribution);
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
        mapInboundRequest(this.state.inbound, frame as ControlRequestFrame, out, attribution);
        return;
      case 'control_response':
        this.inboundResponse(frame as ControlResponseFrame, out, attribution);
        return;
      case 'control_cancel_request':
        mapInboundCancel(this.state.inbound, (frame as ControlCancelRequestFrame).request_id as RequestId, out);
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
    const marker = engineUserMarkerOf(content);
    if (marker) {
      // engine-authored, never a human prompt: opens nothing and dedupes against no outgoing frame
      out.emit({ kind: 'user.message', messageUuid: uuid, content: marker.content, isReplay: frame.isReplay ?? false, isSynthetic: frame.isSynthetic ?? false, origin: marker.origin, bash: null }, attribution);
      return;
    }
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

  // A prompt written at idle and dropped before it ran (Decision Log, coordinator ruling carried into M4): a
  // `cancelled`, `discarded` or `refused` lifecycle naming the uuid that opened the open human turn while no
  // `system/init` has accepted it closes that turn, so no turn stays open forever. A steer's cancellation inside a
  // running turn, and one arriving after the turn's result, close nothing (pass1/queue-and-interrupt seq 191, 200).
  private droppedPrompt(frame: CommandLifecycleFrame, out: Emitter, attribution: Attribution): void {
    const turn = this.state.currentTurn;
    if (frame.state !== 'cancelled' && frame.state !== 'discarded' && frame.state !== 'refused') return;
    if (!turn || turn.origin !== 'human' || turn.acceptedAt !== null || turn.userMessageUuids[0] !== frame.command_uuid) return;
    out.emit({
      kind: 'turn.ended', result: 'cancelled', isError: false, terminalReason: 'cancelled', resultText: null, durationMs: 0, numTurns: 0, costUsd: 0,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, thinkingTokens: 0 }, permissionDenials: [], errors: [],
      userMessageUuids: [frame.command_uuid as MessageUuid], origin: 'human', resultIndex: null, isEchoReceipt: false,
    }, attribution);
    this.state.currentTurn = null;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Inbound requests and our answers live in normalizer-controls.ts

  // The engine's answer to one of our requests: none as events, except the successful conversation rewind.
  private inboundResponse(frame: ControlResponseFrame, out: Emitter, attribution: Attribution): void {
    // Any response envelope may re-deliver the engine's still-open requests (SPEC 45 ControlResponseEnvelope); those we
    // do not already hold become their *.requested events here, as the broker re-accepts them from the same row.
    for (const key of ['pending_permission_requests', 'pending_user_dialog_requests'] as const) {
      const list = (frame.response as Record<string, unknown>)[key];
      if (!Array.isArray(list)) continue;
      for (const raw of list) {
        const pending = ControlRequestFrameSchema.safeParse(raw);
        if (pending.success && !this.state.inbound.has(pending.data.request_id as RequestId)) mapInboundRequest(this.state.inbound, pending.data, out, attribution);
      }
    }
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
      case 'control_response': {
        const requestId = frame.response.request_id as RequestId;
        const note = this.state.answerNotes.get(requestId) ?? null;
        this.state.answerNotes.delete(requestId);
        mapOutboundResponse(this.state.inbound, frame, out, note);
        return;
      }
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
      case 'notice': {
        const level = meta.level === 'info' || meta.level === 'notice' || meta.level === 'suggestion' ? meta.level : 'warning';
        out.emit({ kind: 'notice.posted', level, text: stringOrNull(meta.text) ?? '', key: stringOrNull(meta.key) }, main);
        return;
      }
      case 'answer_note':
        if (typeof meta.requestId === 'string' && typeof meta.note === 'string') this.state.answerNotes.set(meta.requestId as RequestId, meta.note);
        return;
      case 'write_failed': // a frame we meant to send never reached the pipe (M3 review): no out row exists for it
        out.emit({
          kind: 'error.raised', scope: 'transport', message: `${stringOrNull(meta.frameType) ?? 'frame'} not written: ${stringOrNull(meta.message) ?? 'unknown error'}`,
          code: 'write_failed', toolUseId: null, taskId: null, requestId: (stringOrNull(meta.requestId) as RequestId | null),
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
        return; // spawn, relay_health, initialize, status_check, queue, the normaliser's own warnings, and the probe's notes
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------

// Stamps the base fields on each payload a row yields: the row's seq, the frame's timestamp or the row's `at`, the
// session id known at that point, and the event's index within the row.
class Emitter implements EventSink {
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
