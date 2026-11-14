// The normaliser (charter §13 X1; C3 execution document, Interfaces "Normaliser"): the pure function from journal rows
// to X1 events, and the only source of events in the host. Every event derives from a row the host already wrote
// (`in` frames, the host's own `out` frames, and the `meta` rows the host writes for exits, reconnects and transport
// trouble), so `seq` is never null, every id is `${appSessionId}:${launchId}:${seq}:${i}`, and re-reading a journal
// through a fresh Normalizer reproduces the live event list exactly. The correlation state is explicit (`state`) so
// a replay can start from any row given a saved state. Turn rule: the bubble shows at the host's own querying `user`
// frame, the human turn opens at the engine's `started` lifecycle for it (a `started` while a turn is open joins that
// turn), and `system/init` opens an engine-initiated turn only when no turn is open and no `!` echo awaits its receipt. This file holds the class and the frames that
// touch turn, lane and correlation state; `normalizer-controls.ts` projects inbound requests and our answers,
// `normalizer-system.ts` maps the other system subtypes, `normalizer-support.ts` holds the pure projections, and
// `normalizer-arrivals.ts` keeps a background task's end until the model is told (UX wave U3, the arrivals reader's live caller).
import * as z from 'zod';
import { ExitCauseSchema, PERMISSION_MODES, type PermissionMode } from '@shared/graph/enums';
import type { EventPayload, SessionEvent } from '@shared/graph/events';
import { QUEUE_DROP_REASONS, QUEUE_TRANSITION_ACTIONS, type QueueDropReason, type QueueTransitionAction } from '@shared/graph/events'; // P2-C
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
  type ToolUseSummaryFrame,
  type UserFrame,
  type UserInputFrame,
} from '@shared/wire/frames';
import type { JournalRow } from '@shared/wire/journal';
import { bashPartOf, denialKindOf, engineUserMarkerOf, spillPathOf, stringOrNull, tokenUsageOf, type Attribution, type EventSink } from './normalizer-support';
import { mapInboundCancel, mapInboundRequest, mapMawsAskMeta, mapOutboundResponse, type InboundEntry } from './normalizer-controls';
import { mapSystemFrame, pluginLoadIssues, type TaskRegistry } from './normalizer-system';
import type { SafeguardVerdict } from '@shared/graph/enums';
import { messageText, peerEventsOf } from '@shared/engine/peer-envelope'; // E7
import { MAWS_SERVER_NAME } from '@shared/maws/tools'; // P2-C3
import { TranscriptRecordSchema } from '@shared/wire/transcript'; // P5 O16 M3
import { createBackfillContext, recordToEvents } from './fs/backfill'; // P5 O16 M3: a gap's reseed
import { isHookMadeMessageId, isMadeUpFinalAnswer, isMessageTool, messageCallText } from '@shared/owner/message-call'; // P4-R7z
import { carriedOf, readArrivals, type Arrival } from '@shared/engine/arrival'; // UX wave U3 (UC-2)
import { localCommandText } from '@shared/engine/engine-markers';
import { notificationText, taskNotificationBlocks } from '@shared/engine/task-notification';
import {
  arrivalTurnOpened, carried, engineTurnOpened, headed, idle, keep, launchEnded, noLiveArrivals, opensAtHead, output, personsTurnOpened, readFrame, resultReached, scheduleFire, userFrame,
  type LiveArrivals,
} from './normalizer-arrivals'; // UX wave U3 (the U3a document, M4 and Interfaces E)
import { interruptAnswered, interruptWritten, lifecycleSeen, noSendNow, outputSeen, promptStarted, promptWritten, replayJoins, turnEnded, type SendNowState } from './normalizer-send-now'; // UX wave U4a

export interface NormalizerWarning {
  event: 'block_pairing' | 'unknown_denial_kind' | 'unmatched_response' | 'unknown_permission_mode';
  seq: number;
  detail: Record<string, unknown>;
}

interface Lane {
  apiMessageId: ApiMessageId | null;
  // P4-A2 (X1 amendment, X35): a tool_use block's `content_block_start` announces its id and name, kept so its deltas
  // carry them (the host joins the deltas to the `tools/call` that follows by the id)
  started: { index: number; type: string; toolUseId: ToolUseId | null; toolName: string | null }[];
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
  openAsks: Set<string>; // E1: the asks opened (`maws.ask.opened`) and not yet answered or cancelled
  // P2-C3 (the P2 spec's Decision Log 35): the tool uses of the `maws` server's tools a subagent made, from the assistant
  // frames whose `parent_tool_use_id` is set; the engine writes that frame before the call reaches the server
  // (pass3/p2-c3-subagent-ask), so the server's call names one of them by its `claudecode/toolUseId`. Never pruned: a
  // handful per launch.
  subagentMawsUses: Set<ToolUseId>;
  // P4-R7z: the main lane's last message call in the open turn (its text), and whether the to-human plugin answered the
  // step after it in place of a request (a final message): the turn's result then reads the made-up answer, and the
  // turn's reply is the message
  lastMessage: { text: string | null; final: boolean };
  // P5 O16 M3 (D23): the transcript records a gap's reseed showed (`meta transcript_reseed`), by uuid; the same message
  // read later from the stream is shown already, so it yields nothing again
  reseeded: Set<string>;
  // P5 O16 M3 fix wave 1: the API message ids of the records a reseed showed; a surviving stream event of the same
  // message (its start before the gap or after it) streams nothing again
  reseededMessages: Set<string>;
  // UX wave U3 (UC-2; the U3a document, Interfaces E): what the main lane's frames carried from elsewhere, read in order,
  // and the background tasks' ends kept until the model is told (`normalizer-arrivals.ts`)
  arrivals: LiveArrivals;
  // UX wave U4a (the U4a document, Interfaces B; decision 32): the messages sent now and whether a stop was asked since the
  // last end, and what tells the engine's replay of several waiting prompts from an echo (`normalizer-send-now.ts`)
  sendNow: SendNowState;
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
      openAsks: new Set(), // E1
      subagentMawsUses: new Set(), // P2-C3
      lastMessage: { text: null, final: false }, // P4-R7z
      reseeded: new Set(), // P5 O16 M3
      reseededMessages: new Set(), // P5 O16 M3 fix wave 1
      arrivals: noLiveArrivals(), // UX wave U3
      sendNow: noSendNow(), // UX wave U4a
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

  // P2-C3: whether a `maws` tool call (named by its `claudecode/toolUseId`) is a subagent's, read by the host's tool
  // server for the call it is about to serve and by the ask's `maws.ask.opened` here, so both decide alike live and on
  // a rebuild.
  readonly fromSubagent = (toolUseId: ToolUseId | null): boolean => toolUseId !== null && this.state.subagentMawsUses.has(toolUseId);

  private get tasks(): TaskRegistry {
    return { taskTypes: this.state.taskTypes, workflowNames: this.state.workflowNames, toolUseToAgent: this.state.toolUseToAgent };
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Stdout frames

  private pushIn(row: JournalRow, out: Emitter): void {
    const frame = parseStdoutFrame(row.frame);
    const lane = laneOf(frame);
    // UX wave U3 (UC-2): the reader is given every main-lane frame in order, as the engine wrote it (rule 5), but for one
    // whose record a gap's reseed read: the reseed read it into the live reader's state, so it is read once; a child
    // lane's frames map as today
    const uuid = (frame as { uuid?: unknown }).uuid;
    if ((frame.type === 'assistant' || frame.type === 'user') && typeof uuid === 'string' && this.state.reseeded.has(uuid)) return; // P5 O16 M3: shown by its reseed
    const arrivals = lane === null ? readFrame(this.state.arrivals, row.frame) : [];
    const sessionId = (frame as { session_id?: unknown }).session_id;
    if (typeof sessionId === 'string' && sessionId.length > 0) this.state.sessionId = sessionId as SessionId;
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
          // UX wave U3 (Interfaces E): a background command's or monitor's end is kept until the model is told; the
          // engine going idle gives up the ends no turn told
          if (lane === null && system.subtype === 'task_notification' && typeof uuid === 'string') keep(this.state.arrivals, arrivals, uuid as MessageUuid, row.seq);
          if (lane === null && system.subtype === 'session_state_changed' && (system as { state?: unknown }).state === 'idle') idle(this.state.arrivals);
        }
        return;
      }
      case 'stream_event':
        this.streamEvent(frame as StreamEventFrame, out, attribution);
        return;
      case 'assistant':
        this.assistant(frame as AssistantFrame, row, out, attribution, arrivals);
        return;
      case 'user':
        this.userIn(frame as UserFrame, row, out, attribution, arrivals);
        return;
      case 'result':
        this.result(frame as ResultFrame, out, attribution);
        return;
      case 'command_lifecycle': {
        const f = frame as CommandLifecycleFrame;
        out.emit({ kind: 'command.lifecycle', commandUuid: f.command_uuid as MessageUuid, state: f.state }, attribution);
        lifecycleSeen(this.state.sendNow, f.command_uuid as MessageUuid, f.state, this.state.currentTurn !== null); // UX wave U4a: before it opens a turn
        this.promptLifecycle(f, row, out, attribution);
        if (lane === null) scheduleFire(this.state.arrivals, arrivals, f.command_uuid as MessageUuid); // UX wave U3: a scheduled fire's turn opens next
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
        mapInboundRequest(this.state.inbound, frame as ControlRequestFrame, out, attribution, this.state.openAsks, this.fromSubagent);
        return;
      case 'control_response':
        this.inboundResponse(frame as ControlResponseFrame, out, attribution);
        return;
      case 'control_cancel_request':
        mapInboundCancel(this.state.inbound, (frame as ControlCancelRequestFrame).request_id as RequestId, out);
        return;
      case 'tool_use_summary': {
        const f = frame as ToolUseSummaryFrame;
        if (f.preceding_tool_use_ids.length > 0) out.emit({ kind: 'tool.summary', toolUseIds: f.preceding_tool_use_ids as ToolUseId[], summary: f.summary }, attribution);
        return;
      }
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
      engineTurnOpened(this.state.arrivals, row.seq, out); // UX wave U3: a scheduled fire's line, or a kept end's, at its head
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
        const block = event.content_block as { type?: unknown; id?: unknown; name?: unknown } | undefined;
        const current = this.state.streaming.get(lane) ?? { apiMessageId: null, started: [], userMessageUuid: null };
        const type = typeof block?.type === 'string' ? block.type : 'unknown';
        const toolUseId = type === 'tool_use' && typeof block?.id === 'string' ? (block.id as ToolUseId) : null;
        const toolName = type === 'tool_use' && typeof block?.name === 'string' ? block.name : null;
        current.started.push({ index: Number(event.index), type, toolUseId, toolName });
        this.state.streaming.set(lane, current);
        if (lane === null) output(this.state.arrivals); // UX wave U3: the model answers; what arrives now is not at the turn's head
        // P5 O7 M10's follow-up: a thinking block starts here. On claude-opus-5-5 its text arrives in one burst just before
        // its end, seconds later (p4-tool-summaries-thinking-edits, seq 108 to 153), so its first delta is no start: the
        // block's start is told as an empty thinking delta, the shape a delta has, so a reader draws it from now and
        // measures it from now, as the CLI's own timer does. A redacted block, and every other kind, starts silently.
        if (type === 'thinking' && !isHookMadeMessageId(current.apiMessageId) && !(current.apiMessageId !== null && this.state.reseededMessages.has(current.apiMessageId))) {
          out.emit({
            kind: 'assistant.block.delta', apiMessageId: current.apiMessageId, blockIndex: Number(event.index), blockType: 'thinking',
            textDelta: null, thinkingDelta: '', inputJsonDelta: null, userMessageUuid: current.userMessageUuid, toolUseId: null, toolName: null,
          }, attribution);
        }
        return;
      }
      case 'content_block_delta': {
        const delta = event.delta as { type?: string; text?: string; thinking?: string; partial_json?: string } | undefined;
        if (!delta || delta.type === 'signature_delta') return; // a signature carries no content; the complete block carries it
        const current = this.state.streaming.get(lane);
        // P4-R7z: a response a hook made up streams no partials, since whether it is a reply is known only once it is
        // whole (the to-human plugin's answer after a final message is none; `assistant` decides)
        if (isHookMadeMessageId(current?.apiMessageId)) return;
        if (current?.apiMessageId != null && this.state.reseededMessages.has(current.apiMessageId)) return; // P5 O16 M3: shown whole by a reseed
        const index = Number(event.index);
        const started = current?.started.find((s) => s.index === index);
        const blockType = started?.type ?? (delta.type === 'text_delta' ? 'text' : delta.type === 'thinking_delta' ? 'thinking' : delta.type === 'input_json_delta' ? 'tool_use' : String(delta.type));
        out.emit({
          kind: 'assistant.block.delta', apiMessageId: current?.apiMessageId ?? null, blockIndex: index, blockType,
          textDelta: delta.type === 'text_delta' ? (delta.text ?? '') : null,
          thinkingDelta: delta.type === 'thinking_delta' ? (delta.thinking ?? '') : null,
          inputJsonDelta: delta.type === 'input_json_delta' ? (delta.partial_json ?? '') : null,
          userMessageUuid: current?.userMessageUuid ?? null,
          toolUseId: started?.toolUseId ?? null, toolName: started?.toolName ?? null, // P4-A2 (X1 amendment)
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
  private assistant(frame: AssistantFrame, row: JournalRow, out: Emitter, attribution: Attribution, arrivals: Arrival[]): void {
    // P4-R7z: the to-human plugin's answer after a final message said nothing (`@shared/owner/message-call`)
    if (isMadeUpFinalAnswer(frame)) {
      if (attribution.parentToolUseId === null) this.state.lastMessage.final = true;
      return;
    }
    // UX wave U3 (UC-2, class `command`): the frame the engine writes for a slash command's output, told by its
    // `local_command_source`, is the command's output and never the model's answer
    if (attribution.parentToolUseId === null) {
      if (arrivals.some((arrival) => arrival.class === 'command')) return this.commandOutput((frame.uuid ?? null) as MessageUuid | null, arrivals, false, out, attribution);
      output(this.state.arrivals);
      outputSeen(this.state.sendNow); // UX wave U4a
    }
    // a response after it (a Stop hook that blocked the stop) is the turn's again: its result is its own
    if (attribution.parentToolUseId === null) this.state.lastMessage.final = false;
    const lane = this.state.streaming.get(attribution.parentToolUseId);
    const apiMessageId = frame.message.id as ApiMessageId;
    const messageUuid = frame.uuid as MessageUuid;
    const userMessageUuids = attribution.parentToolUseId === null ? [...(this.state.currentTurn?.userMessageUuids ?? [])] : [];
    const wireSupersedes = (frame as { supersedes?: unknown }).supersedes;
    const supersedes = Array.isArray(wireSupersedes) ? wireSupersedes.filter((u): u is string => typeof u === 'string').map((u) => u as MessageUuid) : [];
    // The engine's API error envelope: the live wire spells the flag `is_api_error_message` (SPEC 45's
    // SDKAssistantMessage; pass2/auto-unrouted seq 11), the transcript record `isApiErrorMessage`.
    const apiError = frame.is_api_error_message === true || frame.isApiErrorMessage === true;
    // UX wave U2 (X1): the engine's recorded duration of the frame's thinking block (`thinking_duration_ms`), carried on
    // that block's event when the frame holds exactly one thinking block and the value is a duration; a subagent's
    // forwarded thought has none
    const recordedMs = (frame as { thinking_duration_ms?: unknown }).thinking_duration_ms;
    const thinkingDurationMs = typeof recordedMs === 'number' && Number.isFinite(recordedMs) && recordedMs >= 0 && frame.message.content.filter((block) => block.type === 'thinking').length === 1 ? recordedMs : undefined;
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
      out.emit({ kind: 'assistant.block.complete', messageUuid, apiMessageId, blockIndex, block, model: frame.message.model, supersedes, aborted: (frame as { aborted?: unknown }).aborted === true, userMessageUuids, ...(apiError && { isApiErrorMessage: true }), ...(typeof frame.error === 'string' && { error: frame.error }), ...(block.type === 'thinking' && thinkingDurationMs !== undefined && { thinkingDurationMs }) }, attribution);
      if (block.type === 'tool_use') {
        out.emit({ kind: 'tool.use', toolUseId: String(block.id) as ToolUseId, toolName: String(block.name), input: block.input, apiMessageId, messageUuid }, attribution);
        if (attribution.parentToolUseId !== null && String(block.name).startsWith(MAWS_TOOL_PREFIX)) this.state.subagentMawsUses.add(String(block.id) as ToolUseId); // P2-C3
        if (attribution.parentToolUseId === null && isMessageTool(block.name)) this.state.lastMessage = { text: messageCallText(block.input), final: false }; // P4-R7z
      }
    }
  }

  private userIn(frame: UserFrame, row: JournalRow, out: Emitter, attribution: Attribution, arrivals: Arrival[]): void {
    const content = frame.message.content;
    const results = typeof content === 'string' ? [] : content.filter((b) => b.type === 'tool_result');
    const main = attribution.parentToolUseId === null;
    if (results.length > 0) {
      if (main) output(this.state.arrivals); // UX wave U3
      if (main) outputSeen(this.state.sendNow); // UX wave U4a
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
    if (main) userFrame(this.state.arrivals, arrivals, out); // UX wave U3 (Interfaces E): a placed line this frame tells, or whose turn it takes, is withdrawn first
    const uuid = (frame.uuid ?? null) as MessageUuid | null;
    if (uuid !== null && this.state.pendingHumanUuids.has(uuid)) {
      this.state.pendingHumanUuids.delete(uuid); // the engine's --replay-user-messages echo of our own frame
      // UX wave U4a (decision 32 b): unless the engine wrote several waiting prompts as one under this uuid: then the one
      // message it wrote, which a reader draws in their place
      const joined = replayJoins(this.state.sendNow, uuid, content);
      if (joined !== null) out.emit({ kind: 'user.message', messageUuid: uuid, content, isReplay: true, isSynthetic: false, origin: 'human', bash: null, joined }, attribution);
      return;
    }
    if (main && this.arrivalIn(frame, row.seq, uuid, arrivals, out, attribution)) return; // UX wave U3 (UC-2)
    const marker = frame.origin?.kind === 'human' ? null : engineUserMarkerOf(content);
    if (marker) {
      // engine-authored, never a human prompt: opens nothing and dedupes against no outgoing frame
      out.emit({ kind: 'user.message', messageUuid: uuid, content: marker.content, isReplay: frame.isReplay ?? false, isSynthetic: frame.isSynthetic ?? false, origin: marker.origin, bash: null }, attribution);
      return;
    }
    const bash = bashPartOf(content);
    // UX wave U3 (decision 4): the engine's notification frame is never a prompt, whether or not it carries an arrival
    const isSynthetic = (main && frame.origin?.kind === 'task-notification') || (frame.isSynthetic ?? false);
    out.emit({
      kind: 'user.message', messageUuid: uuid, content: bash === null ? content : bash.part === 'input' ? bash.command : bash.stdout,
      isReplay: frame.isReplay ?? false, isSynthetic, origin: frame.origin?.kind ?? null, bash,
    }, attribution);
    // E7 start: a message from another session (or an in-process agent's to this conversation) also yields its parsed
    // event, from the same parser the disk backfill uses (E7 execution document, Design §4)
    if (frame.origin?.kind === 'peer') {
      const companion = peerEventsOf(messageText(content), uuid, frame.origin);
      if (companion) out.emit(companion, attribution);
    }
    // E7 end
  }

  // UX wave U3 start (UC-2; the U3a document, Interfaces C and M4). What a main-lane `user` frame carries from elsewhere
  // becomes the events every caller makes of its class; false when it carries none of them (MAWS's own answer envelope
  // and consent message are the person's, and map as today). An arrival at the head of a turn the engine opened opens
  // the turn of its class when that turn is not the engine's: a peer's, or the person's for their own words; a second
  // one at the head joins the turn the first opened (`opensAtHead`).
  private arrivalIn(frame: UserFrame, seq: number, uuid: MessageUuid | null, arrivals: Arrival[], out: Emitter, attribution: Attribution): boolean {
    const claimed = arrivals.filter((arrival) => arrival.class !== 'consent' && !(arrival.class === 'answer' && arrival.tool === 'maws'));
    const [first] = claimed;
    const live = this.state.arrivals;
    const content = frame.message.content;
    const isReplay = frame.isReplay ?? false;
    if (first === undefined) return this.secondCarrier(frame);
    switch (first.class) {
      case 'peer':
      case 'subagent': {
        if (first.class === 'peer' && (this.state.currentTurn === null || opensAtHead(live))) {
          // idle: a peer's turn, in the place of the engine's that held nothing (decision 6); the normaliser's own record
          // keeps the engine's word, the status's (`EngineSessionStatus.turn.origin` is the person's or the engine's)
          if (this.state.currentTurn === null) this.state.currentTurn = { origin: 'engine', userMessageUuids: [], startedAt: out.at, acceptedAt: out.at };
          arrivalTurnOpened(live, seq);
          out.emit({ kind: 'turn.started', userMessageUuid: null, origin: 'peer' }, attribution);
        }
        headed(live, first);
        // decision 4: synthetic whatever the frame's own flag, so it never opens a turn of the person's beside its own
        out.emit({ kind: 'user.message', messageUuid: uuid, content, isReplay, isSynthetic: true, origin: 'peer', bash: null }, attribution);
        const companion = peerEventsOf(messageText(content), uuid, frame.origin);
        if (companion) out.emit(companion, attribution);
        return true;
      }
      case 'own': {
        if (this.state.currentTurn === null || opensAtHead(live)) {
          // idle: the person's turn, in the place of the engine's that held nothing (decision 6)
          arrivalTurnOpened(live, seq);
          headed(live, first);
          this.state.currentTurn = { origin: 'human', userMessageUuids: uuid === null ? [] : [uuid], startedAt: out.at, acceptedAt: out.at };
          out.emit({ kind: 'turn.started', userMessageUuid: uuid, origin: 'human' }, attribution);
          out.emit({ kind: 'user.message', messageUuid: uuid, content: first.words, isReplay, isSynthetic: false, origin: 'human', bash: null }, attribution);
          return true;
        }
        // into the running turn: a prompt taken into it
        if (uuid !== null) this.state.currentTurn.userMessageUuids.push(uuid);
        out.emit({ kind: 'user.message', messageUuid: uuid, content: first.words, isReplay, isSynthetic: false, origin: 'human', bash: null }, attribution);
        if (uuid !== null) out.emit({ kind: 'command.lifecycle', commandUuid: uuid, state: 'started' }, attribution);
        return true;
      }
      case 'command':
        this.commandOutput(uuid, claimed, isReplay, out, attribution);
        return true;
      default:
        headed(live, first);
        out.emit({ ...carried(uuid, content, carriedOf(claimed)), isReplay }, attribution);
        return true;
    }
  }

  // Rule 5: the replayed notification of a task whose end an earlier carrier told (the hand-back that claimed it) is
  // that end's second carrier and emits nothing; any other frame the reader claims nothing of maps as today.
  private secondCarrier(frame: UserFrame): boolean {
    const kind = frame.origin?.kind;
    if (kind === 'human' || kind === 'peer' || kind === 'plugin') return false;
    const content = frame.message.content;
    const text = notificationText(typeof content === 'string' ? content : messageText(content), kind);
    return text !== null && taskNotificationBlocks(text).length > 0;
  }

  // A slash command's output (class `command`): the engine's own tag around it, its escapes removed, in the turn that
  // runs, which is its command's. The engine sends one output again under the same uuid (u3-commands-r1, seq 406 and
  // 422): a uuid already mapped in this launch emits nothing.
  private commandOutput(uuid: MessageUuid | null, arrivals: Arrival[], isReplay: boolean, out: Emitter, attribution: Attribution): void {
    const outputs = this.state.arrivals.commandOutputs;
    if (uuid !== null && outputs.has(uuid)) return;
    if (uuid !== null) outputs.add(uuid);
    const content = localCommandText(arrivals.flatMap((arrival) => (arrival.class === 'command' ? [arrival] : [])));
    out.emit({ kind: 'user.message', messageUuid: uuid, content, isReplay, isSynthetic: false, origin: 'local-command', bash: null }, attribution);
  }
  // UX wave U3 end

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
      // UX wave U3 (Interfaces E; pitfall 5): a placed line settles or is withdrawn before the turn's end, and the end
      // carries the origin of the arrival at the head of the engine's turn (a hand-back's turn is the engine's, the
      // owner's own send the person's), else the result's own word
      const runId = (f.origin as { runId?: unknown } | undefined)?.runId;
      const word = isEchoReceipt ? null : resultReached(this.state.arrivals, typeof runId === 'string' ? runId : null, out);
      const message = this.state.lastMessage; // P4-R7z: after a final message the reply is the message, not the made-up answer
      this.state.lastMessage = { text: null, final: false };
      // UX wave U4a (Interfaces B): an end a sent-now message caused, by what the frames show
      const endedForMessage = !isEchoReceipt && turnEnded(this.state.sendNow, terminalReason, frame.subtype);
      if (!isEchoReceipt) outputSeen(this.state.sendNow);
      out.emit({
        kind: 'turn.ended', result: frame.subtype, isError: frame.is_error, terminalReason, resultText: message.final ? message.text : stringOrNull(f.result), durationMs: frame.duration_ms, numTurns: frame.num_turns,
        costUsd: frame.total_cost_usd, usage, permissionDenials: denials, errors: Array.isArray(f.errors) ? f.errors.map(String) : [],
        userMessageUuids: (Array.isArray(f.user_message_uuids) ? f.user_message_uuids : []) as MessageUuid[], origin: word ?? stringOrNull(origin),
        resultIndex: typeof f.result_index === 'number' ? f.result_index : null, isEchoReceipt, ...(endedForMessage && { endedForMessage: true as const }),
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
  private promptLifecycle(frame: CommandLifecycleFrame, row: JournalRow, out: Emitter, attribution: Attribution): void {
    const uuid = frame.command_uuid as MessageUuid;
    if (!this.state.unstartedPrompts.has(uuid)) return;
    if (frame.state === 'cancelled' || frame.state === 'discarded' || frame.state === 'refused' || frame.state === 'completed') {
      this.state.unstartedPrompts.delete(uuid);
      return;
    }
    if (frame.state !== 'started') return;
    this.state.unstartedPrompts.delete(uuid);
    promptStarted(this.state.sendNow, uuid); // UX wave U4a
    if (this.state.currentTurn) {
      this.state.currentTurn.userMessageUuids.push(uuid);
      return;
    }
    this.state.currentTurn = { origin: 'human', userMessageUuids: [uuid], startedAt: out.at, acceptedAt: out.at };
    out.emit({ kind: 'turn.started', userMessageUuid: uuid, origin: 'human' }, attribution);
    personsTurnOpened(this.state.arrivals, row.seq); // UX wave U3: no kept end is placed on it
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
        if (pending.success && !this.state.inbound.has(pending.data.request_id as RequestId)) mapInboundRequest(this.state.inbound, pending.data, out, attribution, this.state.openAsks, this.fromSubagent);
      }
    }
    const requestId = frame.response.request_id as RequestId;
    const sent = this.state.outbound.get(requestId);
    if (!sent) return;
    this.state.outbound.delete(requestId);
    if (sent.subtype === 'interrupt') interruptAnswered(this.state.sendNow, sent.request as Record<string, unknown>, frame.response); // UX wave U4a
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
    const sample = contextSampleOf(frame.response.response);
    if (sample) out.emit({ kind: 'context.sample', ...sample }, attribution);
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
        interruptWritten(this.state.sendNow, frame.request, this.state.currentTurn !== null); // UX wave U4a
        return;
      case 'control_response': {
        const requestId = frame.response.request_id as RequestId;
        const note = this.state.answerNotes.get(requestId) ?? null;
        this.state.answerNotes.delete(requestId);
        mapOutboundResponse(this.state.inbound, frame, out, note, this.state.openAsks);
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
    // UX wave U4a: a `now` frame while a turn runs or an earlier prompt waits is a message sent now
    if (uuid !== null) promptWritten(this.state.sendNow, uuid, content, frame.priority, this.state.currentTurn !== null || this.state.unstartedPrompts.size > 0);
    // no turn opens at the write: the engine's `started` for this uuid opens it (promptLifecycle)
    if (uuid !== null) this.state.unstartedPrompts.add(uuid);
    this.state.lastUserMessageUuid = uuid;
    // UX wave U3 (UC-2, class `consent`; decision 10): MAWS's own "Approve and retry" message is the person's prompt or
    // steer and carries its arrival, which draws it as one line
    const consent = readArrivals({ type: 'user', origin: { kind: 'human' }, message: frame.message }).filter((arrival) => arrival.class === 'consent');
    out.emit({ kind: 'user.message', messageUuid: uuid, content, isReplay: false, isSynthetic: false, origin: 'human', bash: null, ...(consent.length > 0 && { arrival: consent }) }, main);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Meta rows the host writes for what the design called synthesised events

  private pushMeta(row: JournalRow, out: Emitter): void {
    const meta = row.frame as Record<string, unknown> & { event?: unknown };
    const main: Attribution = { parentToolUseId: null, agentId: null };
    switch (meta.event) {
      case 'exit': {
        this.postTrustNotice(out, main); // C10: exited before answering initialize: nothing recorded
        launchEnded(this.state.arrivals, out); // UX wave U3 (decision 21): a line placed and not settled stands on no turn once its launch has ended
        const code = typeof meta.code === 'number' ? meta.code : null;
        const signal = stringOrNull(meta.signal);
        const reason = typeof meta.reason === 'string' ? (meta.reason as 'quit' | 'stop' | 'archive' | 'crash' | 'unknown' | 'budget' /* C12 */ | 'idle' /* E10 */) : code === 0 && signal === null ? 'unknown' : 'crash';
        // C12: a release carries the budget and the sum it was made at (the exit row's `budget`)
        const budget = reason === 'budget' ? budgetOf(meta.budget) : null;
        const cause = ExitCauseSchema.safeParse(meta.cause); // P5 O16 M3b (D58a)
        out.emit({ kind: 'process.exited', code, signal, reason, lostAttentionCount: typeof meta.lostAttentionCount === 'number' ? meta.lostAttentionCount : 0, ...(typeof meta.lostAskCount === 'number' && meta.lostAskCount > 0 ? { lostAskCount: meta.lostAskCount } : {}) /* E1 */, budget, ...(cause.success && { cause: cause.data }) }, main);
        return;
      }
      case 'reconnect':
        if (meta.phase === 'failed' && ExitCauseSchema.safeParse(meta.cause).success) return; // P5 O16 M3b (D58a): told by the exit's cause
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
        if (meta.event === 'init_failed' && ExitCauseSchema.safeParse(meta.cause).success) return; // P5 O16 M3b (D58a): told by the exit's cause
        out.emit({
          kind: 'error.raised', scope: meta.event === 'init_failed' ? 'process' : 'transport', message: stringOrNull(meta.message) ?? String(meta.event),
          code: stringOrNull(meta.code) ?? String(meta.event), toolUseId: null, taskId: null, requestId: null,
        }, main);
        return;
      // E1 start: an async ask's answers (journaled once their steer was written) and a cancelled ask
      case 'maws_ask_answered':
      case 'maws_ask_cancelled':
        mapMawsAskMeta(meta, out, main, this.state.openAsks);
        return;
      // E1 end
      // P2-C start (2026-10-09; the P2-C document, Design §6): a prompt's transition through the host's queue; the
      // queue's pause and resume rows are not a prompt's and yield nothing
      case 'queue':
        if (QUEUE_TRANSITIONS.has(meta.action)) {
          out.emit({
            kind: 'queue.transition', action: meta.action as QueueTransitionAction, queueId: stringOrNull(meta.queueId), messageUuid: stringOrNull(meta.messageUuid) as MessageUuid | null,
            reason: meta.action === 'drop' && QUEUE_DROPS.has(meta.reason) ? (meta.reason as QueueDropReason) : null,
          }, main);
        }
        return;
      // P2-C end
      // P5 O16 M3 (D23; holder design §3.3): output a session host's ring lost before an engine host read it, restored from
      // the engine's own transcript: each record's events as the disk reader maps them (fs/backfill.ts), ids and seq this
      // row's, marked `reseeded`; stream events and tool progress inside the gap are not in a transcript. A record an
      // earlier reseed showed yields nothing again. The lanes' streaming state is reset, but for a lane streaming a
      // message the reseed showed, whose surviving deltas are dropped by its id; the next message start re-anchors it.
      case 'transcript_reseed': {
        // UX wave U3 (the whole-branch review's finding 2 and the wave review's): the rows are read on from what the live
        // reader already read (the tasks it knows, the completions a hand-back claimed), so an arrival the live wire told
        // is not told again, and what they told is the live reader's state after them, for the frames that follow and
        // the next reseed; a frame of a record read here is not read again (pushIn). The gap's frames never come
        const ctx = createBackfillContext({ sessionId: this.state.sessionId ?? ('unknown' as SessionId), agent: null, arrivals: this.state.arrivals.open });
        for (const raw of Array.isArray(meta.rows) ? meta.rows : []) {
          const parsed = TranscriptRecordSchema.safeParse(raw);
          if (!parsed.success || typeof parsed.data.uuid !== 'string' || this.state.reseeded.has(parsed.data.uuid)) continue;
          this.state.reseeded.add(parsed.data.uuid);
          const messageId = (parsed.data as { message?: { id?: unknown } }).message?.id;
          if (parsed.data.type === 'assistant' && typeof messageId === 'string') this.state.reseededMessages.add(messageId);
          for (const event of recordToEvents(parsed.data, ctx)) {
            const payload: Partial<SessionEvent> = { ...event };
            for (const key of ['id', 'sessionId', 'seq', 'at', 'agentId', 'parentToolUseId'] as const) delete payload[key]; // the base this row restamps
            out.emit(payload as EventPayload, { agentId: event.agentId, parentToolUseId: event.parentToolUseId }, { at: event.at, reseeded: true });
          }
        }
        this.state.arrivals.open = ctx.arrivals; // UX wave U3
        for (const [lane, current] of this.state.streaming) if (current.apiMessageId === null || !this.state.reseededMessages.has(current.apiMessageId)) this.state.streaming.delete(lane);
        return;
      }
      default:
        return; // spawn, relay_health, initialize, status_check, host_attach, the normaliser's own warnings, and the probe's notes
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

  // P5 O16 M3: `restored`, an event a gap's reseed rebuilt from the transcript (its record's time, `reseeded: true`)
  emit(payload: EventPayload, attribution: Attribution | null, restored?: { at: string; reseeded: true }): void {
    const id = `${this.appSessionId}:${this.launchId}:${this.row.seq}:${this.events.length}` as EventId;
    this.events.push({
      id, sessionId: this.sessionId(), at: restored?.at ?? this.at, seq: this.row.seq,
      agentId: attribution?.agentId ?? null, parentToolUseId: attribution?.parentToolUseId ?? null,
      ...(restored && { reseeded: true }),
      ...payload,
    } as SessionEvent);
  }
}

const MAWS_TOOL_PREFIX = `mcp__${MAWS_SERVER_NAME}__`; // P2-C3: the engine's name for a `maws` tool, as tool uses carry it

function laneOf(frame: StdoutFrame): ParentToolUseId | null {
  const parent = (frame as { parent_tool_use_id?: unknown }).parent_tool_use_id;
  return typeof parent === 'string' && parent.length > 0 ? (parent as ParentToolUseId) : null;
}

// P2-C start (2026-10-09): the actions of a `meta queue` row that are a prompt's transitions, and a drop's reasons
const QUEUE_TRANSITIONS: ReadonlySet<unknown> = new Set<string>(QUEUE_TRANSITION_ACTIONS);
const QUEUE_DROPS: ReadonlySet<unknown> = new Set<string>(QUEUE_DROP_REASONS);
// P2-C end

// C12 start: the exit row's `budget` (a release's budget and sum) and the reconnect row's trigger, as the host recorded
// them; a trigger outside X1's set reads `user`, as every row did before C12 produced `process_exit`.
type ReconnectTrigger = Extract<SessionEvent, { kind: 'session.reconnect' }>['trigger'];
const RECONNECT_TRIGGERS: ReadonlySet<string> = new Set<ReconnectTrigger>(['process_exit', 'host_restart', 'transport_error', 'user']);

function budgetOf(value: unknown): { limitKiB: number; totalKiB: number } | null {
  const b = value as { limitKiB?: unknown; totalKiB?: unknown } | null | undefined;
  return b && typeof b.limitKiB === 'number' && typeof b.totalKiB === 'number' ? { limitKiB: b.limitKiB, totalKiB: b.totalKiB } : null;
}
// C12 end

// P2-A start (2026-10-09): the `context.sample` payload of a successful `get_context_usage` answer, or null for one
// without the figures; X17's journal recovery maps the journal's answers with it, so there is one mapping.
export type ContextSample = Omit<Extract<EventPayload, { kind: 'context.sample' }>, 'kind'>;
export function contextSampleOf(response: unknown): ContextSample | null {
  const parsed = GetContextUsageResponseSchema.safeParse(response);
  if (!parsed.success) return null;
  const { maxTokens, autoCompactThreshold, isAutoCompactEnabled, model } = parsed.data;
  const { totalTokens, percentage } = contextTotal(parsed.data);
  return { totalTokens, maxTokens, percentage, autoCompactThreshold: autoCompactThreshold ?? null, isAutoCompactEnabled, model };
}
// P2-A end
