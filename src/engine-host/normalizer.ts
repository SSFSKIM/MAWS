// The normaliser (charter §13 X1; C3 execution document, Interfaces "Normaliser"): the pure function from journal rows
// to X1 events, and the only source of events in the host. Every event derives from a row the host already wrote
// (`in` frames, the host's own `out` frames, and the `meta` rows the host writes for exits, reconnects and transport
// trouble), so `seq` is never null, every id is `${appSessionId}:${launchId}:${seq}:${i}`, and re-reading a journal
// through a fresh Normalizer reproduces the live event list exactly. The correlation state is explicit (`state`) so
// a replay can start from any row given a saved state. Turn rule: the bubble shows at the host's own querying `user`
// frame, the human turn opens at the engine's `started` lifecycle for it (a `started` while a turn is open joins that
// turn), and `system/init` opens an engine-initiated turn only when no turn is open and no `!` echo awaits its receipt. This file holds the class and the frames that
// touch turn, lane and correlation state; `normalizer-controls.ts` projects inbound requests and our answers,
// `normalizer-system.ts` maps the other system subtypes and `normalizer-support.ts` holds the pure projections.
import * as z from 'zod';
import { PERMISSION_MODES, type PermissionMode } from '@shared/graph/enums';
import type { EventPayload, SessionEvent } from '@shared/graph/events';
import type { AgentId, ApiMessageId, AppSessionId, EventId, MessageUuid, ParentToolUseId, RequestId, SessionId, TaskId, ToolUseId } from '@shared/graph/ids';
import { contextTotal, GetContextUsageResponseSchema, RewindConversationResponseSchema, UiPanesResponseSchema } from '@shared/wire/control';
import { rosterOf } from './surface-wire'; // R2
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
import { mapSystemFrame, pluginLoadIssues, type TaskRegistry } from './normalizer-system';
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
  // Host-written querying prompts the engine has not started yet (coordinator ruling after M6 live 3.7): the human turn
  // opens at the engine's `command_lifecycle { state: 'started' }` naming one, so a `now` steer that preempts the
  // running turn, or a notification turn the engine runs first, never closes a turn that was not its own.
  unstartedPrompts: Set<MessageUuid>;
  pendingEcho: MessageUuid | null;
  outbound: Map<RequestId, { subtype: string; request: unknown }>;
  inbound: Map<RequestId, InboundEntry>;
  answerNotes: Map<RequestId, string>; // the broker's `meta answer_note` rows, folded into the answer they precede
  streaming: Map<ParentToolUseId | null, Lane>;
  completedBlocks: Map<ApiMessageId, number>;
  taskTypes: Map<string, string>;
  workflowNames: Map<string, string>;
  trustNotice: { held: string | null; settled: boolean }; // C10: the engine's stderr trust line, held until the launch's initialize response settles it (or the exit does)
}

// C10 start: the engine's trust line on stderr (fixture pass2/trust-no-attestation seq 5). It is printed at settings
// load, before `initialize` is read, so it means "ignored" only when that response did not record trust.
const TRUST_NOTICE_KEY = 'trust:ignored';
function isTrustNotice(text: string): boolean {
  return text.trimStart().startsWith('Ignoring ') && text.includes('this workspace has not been trusted');
}
// C10 end

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
      unstartedPrompts: new Set(),
      pendingEcho: null,
      outbound: new Map(),
      inbound: new Map(),
      answerNotes: new Map(),
      streaming: new Map(),
      completedBlocks: new Map(),
      taskTypes: new Map(),
      workflowNames: new Map(),
      trustNotice: { held: null, settled: false }, // C10
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
        case 'stderr': {
          // C10 start: held per launch, released at the correlated initialize response or the exit row
          const text = String((row.frame as { text?: unknown } | null)?.text ?? '');
          if (!this.state.trustNotice.settled && this.state.trustNotice.held === null && isTrustNotice(text)) this.state.trustNotice.held = text.trim();
          // C10 end
          break;
        }
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
        this.promptLifecycle(f, out, attribution);
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
    // Opens an engine turn only when no turn is open (a human turn: its `started` lifecycle opened it and marked
    // acceptance) and no `!` echo awaits its receipt (the echo's own lifecycle, pass2/bash-context-echoed seq 12: opens
    // nothing, marks nothing).
    if (this.state.pendingEcho === null && !this.state.currentTurn) {
      this.state.currentTurn = { origin: 'engine', userMessageUuids: [], startedAt: out.at, acceptedAt: out.at };
      out.emit({ kind: 'turn.started', userMessageUuid: null, origin: 'engine' }, attribution);
    }
    // R1: the plugins that failed to load or warned, inside the turn the init belongs to; every init repeats them, and
    // a child's init (returned above) carries its parent's
    for (const issue of pluginLoadIssues(frame)) out.emit(issue, attribution);
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
        for (const result of delta.safeguard_results as { status?: { tool_uses?: Record<string, { type?: string; outcome?: string }> } }[]) {
          for (const [id, entry] of Object.entries(result.status?.tool_uses ?? {})) {
            const verdict = entry.type === 'skipped' ? 'skipped' : entry.type === 'evaluated' && (entry.outcome === 'flagged' || entry.outcome === 'not_flagged') ? entry.outcome : null;
            if (verdict === null) continue; // an unknown or incomplete entry is not evidence of a review
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
    const wireSupersedes = (frame as { supersedes?: unknown }).supersedes;
    const supersedes = Array.isArray(wireSupersedes) ? wireSupersedes.filter((u): u is string => typeof u === 'string').map((u) => u as MessageUuid) : [];
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
      // `aborted`: the wire's `aborted: true`, set on the partial text block the engine flushes when an interrupt cuts
      // its stream (pass3/interrupt-text seq 96; an interrupted tool_use or thinking block is never flushed). `supersedes`
      // is the wire's list as sent (SPEC 45, refusal fallback: every block frame of the refused attempt, on the first
      // frame of the replacement only; `cli.pretty.js` `H0e`), empty when the frame has none. No fixture records a
      // refusal fallback yet (debt wave 4, a synthetic pin). The engine's `model_refusal_fallback` frame still yields
      // `boundary.retraction`.
      out.emit({ kind: 'assistant.block.complete', messageUuid, apiMessageId, blockIndex, block, model: frame.message.model, supersedes, aborted: (frame as { aborted?: unknown }).aborted === true, userMessageUuids, ...(frame.isApiErrorMessage === true && { isApiErrorMessage: true }), ...(typeof frame.error === 'string' && { error: frame.error }) }, attribution);
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
    // C7 start: the receipt is the echo's own (pass2/bash-context-echoed seq 13 names it and nothing else); an echo
    // written during a turn joins that turn instead (C7 M6 live), whose result names it and ends the wait, so a later
    // empty result of a local command such as /compact closes its own turn, even when it names the echo too.
    const named: unknown[] = Array.isArray(f.user_message_uuids) ? f.user_message_uuids : [];
    const pendingEcho = this.state.pendingEcho;
    const isEchoReceipt = pendingEcho !== null && frame.num_turns === 0 && terminalReason === null && named.every((u) => u === pendingEcho);
    if (!isEchoReceipt && pendingEcho !== null && named.includes(pendingEcho)) this.state.pendingEcho = null;
    // C7 end
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
      for (const uuid of Array.isArray(f.user_message_uuids) ? f.user_message_uuids : []) this.state.unstartedPrompts.delete(uuid as MessageUuid); // named: no longer waiting
    }
    out.emit({ kind: 'usage.sample', costUsd: frame.total_cost_usd, usage, modelUsage: (f.modelUsage ?? {}) as Record<string, unknown>, source: 'result' }, attribution);
  }

  // The human turn's boundary (coordinator ruling after M6 live 3.7): the engine's `started` for a host-written
  // querying prompt opens its turn, from this row; if a turn is already open (the engine drained two prompts into one
  // turn) the prompt joins it. A prompt cancelled, discarded or refused before it started has no turn to close: its
  // `command.lifecycle` event marks the dropped row (pass1/queue-and-interrupt seq 191), and it stops waiting.
  private promptLifecycle(frame: CommandLifecycleFrame, out: Emitter, attribution: Attribution): void {
    const uuid = frame.command_uuid as MessageUuid;
    if (!this.state.unstartedPrompts.has(uuid)) return;
    if (frame.state === 'cancelled' || frame.state === 'discarded' || frame.state === 'refused' || frame.state === 'completed') {
      this.state.unstartedPrompts.delete(uuid);
      return;
    }
    if (frame.state !== 'started') return;
    this.state.unstartedPrompts.delete(uuid);
    if (this.state.currentTurn) {
      this.state.currentTurn.userMessageUuids.push(uuid);
      return;
    }
    this.state.currentTurn = { origin: 'human', userMessageUuids: [uuid], startedAt: out.at, acceptedAt: out.at };
    out.emit({ kind: 'turn.started', userMessageUuid: uuid, origin: 'human' }, attribution);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Inbound requests and our answers live in normalizer-controls.ts

  // The engine's answer to one of our requests: none as events, except the successful conversation rewind and a context
  // read (whoever asked: the host at each turn's end, or C7's context popover).
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
    // C10 start: the launch's initialize answered; the held trust line was a warning only if trust was not recorded
    if (sent.subtype === 'initialize') {
      const recorded = frame.response.subtype === 'success' && (frame.response.response as { workspace_trust_recorded?: unknown } | undefined)?.workspace_trust_recorded === true;
      if (!recorded) this.postTrustNotice(out, attribution);
      this.state.trustNotice = { held: null, settled: true };
      return;
    }
    // C10 end
    if (sent.subtype === 'get_context_usage') {
      this.contextSample(frame, out, attribution);
      return;
    }
    // R2: the host's roster read (on attach, and the renderer's on mount) says what the push would have
    if (sent.subtype === 'ui_panes') {
      const parsed = frame.response.subtype === 'success' ? UiPanesResponseSchema.safeParse(frame.response.response ?? {}) : null;
      if (parsed?.success) out.emit({ kind: 'plugin.panes', ...rosterOf(parsed.data) }, attribution);
      return;
    }
    if (sent.subtype !== 'rewind_conversation' || frame.response.subtype !== 'success') return;
    const parsed = RewindConversationResponseSchema.safeParse(frame.response.response);
    if (!parsed.success || !parsed.data.rewound) return;
    const target = parsed.data.targetMessageUuid ?? (sent.request as { target_message_uuid?: unknown }).target_message_uuid;
    out.emit({ kind: 'boundary.rewind', targetMessageUuid: String(target) as MessageUuid, precedingAssistantUuid: (parsed.data.precedingAssistantUuid ?? null) as MessageUuid | null, prefillText: parsed.data.prefillText ?? null }, attribution);
  }

  // `context.sample` from a successful `get_context_usage` answer (reads.jsonl seq 57): the engine's own count and window,
  // the figures the result frame does not carry (it has the API usage of the last request and the model's
  // `contextWindow`, but neither the engine's total nor the auto-compact threshold). An answer without them (an error,
  // a replay's empty answer to a read it never recorded) samples nothing.
  private contextSample(frame: ControlResponseFrame, out: Emitter, attribution: Attribution): void {
    if (frame.response.subtype !== 'success') return;
    const parsed = GetContextUsageResponseSchema.safeParse(frame.response.response);
    if (!parsed.success) return;
    const { maxTokens, autoCompactThreshold, isAutoCompactEnabled, model } = parsed.data;
    const { totalTokens, percentage } = contextTotal(parsed.data);
    out.emit({ kind: 'context.sample', totalTokens, maxTokens, percentage, autoCompactThreshold: autoCompactThreshold ?? null, isAutoCompactEnabled, model }, attribution);
  }

  // C10 start: the held trust line as the session's warning, once
  private postTrustNotice(out: Emitter, attribution: Attribution): void {
    const text = this.state.trustNotice.held;
    if (text === null) return;
    this.state.trustNotice.held = null;
    out.emit({ kind: 'notice.posted', level: 'warning', text, key: TRUST_NOTICE_KEY }, attribution);
  }
  // C10 end

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
    // no turn opens at the write: the engine's `started` for this uuid opens it (promptLifecycle)
    if (uuid !== null) this.state.unstartedPrompts.add(uuid);
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
        this.postTrustNotice(out, main); // C10: exited before answering initialize: nothing recorded
        const code = typeof meta.code === 'number' ? meta.code : null;
        const signal = stringOrNull(meta.signal);
        const reason = typeof meta.reason === 'string' ? (meta.reason as 'quit' | 'stop' | 'archive' | 'crash' | 'unknown' | 'budget' /* C12 */) : code === 0 && signal === null ? 'unknown' : 'crash';
        // C12: a release carries the budget and the sum it was made at (the exit row's `budget`)
        const budget = reason === 'budget' ? budgetOf(meta.budget) : null;
        out.emit({ kind: 'process.exited', code, signal, reason, lostAttentionCount: typeof meta.lostAttentionCount === 'number' ? meta.lostAttentionCount : 0, budget }, main);
        return;
      }
      case 'reconnect':
        out.emit({
          kind: 'session.reconnect', phase: meta.phase as 'attempting' | 'reconnected' | 'failed', attempt: typeof meta.attempt === 'number' ? meta.attempt : 1,
          maxAttempts: typeof meta.maxAttempts === 'number' ? meta.maxAttempts : null, trigger: RECONNECT_TRIGGERS.has(meta.trigger as string) ? (meta.trigger as ReconnectTrigger) : 'user' /* C12: as recorded */, reason: stringOrNull(meta.reason),
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

// C12 start: the exit row's `budget` (a release's budget and sum) and the reconnect row's trigger, as the host recorded
// them; a trigger outside X1's set reads `user`, as every row did before C12 produced `process_exit`.
type ReconnectTrigger = Extract<SessionEvent, { kind: 'session.reconnect' }>['trigger'];
const RECONNECT_TRIGGERS: ReadonlySet<string> = new Set<ReconnectTrigger>(['process_exit', 'host_restart', 'transport_error', 'user']);

function budgetOf(value: unknown): { limitKiB: number; totalKiB: number } | null {
  const b = value as { limitKiB?: unknown; totalKiB?: unknown } | null | undefined;
  return b && typeof b.limitKiB === 'number' && typeof b.totalKiB === 'number' ? { limitKiB: b.limitKiB, totalKiB: b.totalKiB } : null;
}
// C12 end
