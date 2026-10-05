// Transcript-to-X1 backfill (C4 execution document, "Chain follower and backfill", the mapping table): one disk record
// in, the X1 events it stands for out. Used by the chain follower for every record it puts on the chain and by the
// replay engine's transcript source (M5). Disk records carry no journal row, so every event has `seq: null` and a
// deterministic id (`<uuid>`, `<uuid>#<n>`, `session:<id>:started`), which is what lets a consumer that receives the
// same backfill twice deduplicate.
import type { ContentBlock, EventBase, SessionEvent } from '@shared/graph/events';
import type { AgentId, ApiMessageId, EventId, MessageUuid, ParentToolUseId, SessionId, TaskId, ToolUseId } from '@shared/graph/ids';
import type { AgentMeta, TranscriptRecord } from '@shared/wire/transcript';
import { INTERRUPT_MARKER } from '../normalizer-support';

// The three engine strings that name a spilled result (SPEC 12.12 and 20.10); the structured field wins when present.
export const SPILL_MARKER = /(?:Full output saved to|were saved to|was saved to):? (\/[^\r\n]+\.(?:txt|json))(?=[.;\s]|$)/;

const TEXT_CAP = 200;
const EPOCH = '1970-01-01T00:00:00.000Z';

// What the parent's mapping needs to know about a child agent when it meets the `Agent` tool use that spawned it:
// the sidecar's meta (agent-<id>.meta.json, keyed by its `toolUseId`) and, when the sidecar transcript is readable,
// its first user record as the prompt. M3's subagents reader supplies the production lookup.
export interface SubagentLookup {
  byToolUseId(toolUseId: string): { agentId: AgentId; meta: AgentMeta; prompt: string | null } | null;
}

export interface BackfillContext {
  readonly sessionId: SessionId;
  readonly agentId: AgentId | null;
  readonly parentToolUseId: ParentToolUseId | null;
  readonly seenToolUses: Map<string, TaskId>; // Agent tool uses that started a subagent, for subagent.finished on their result
  // Agent tool uses read before their child's meta existed: a tailer reads the assistant record before the tool runs
  // and writes the meta, so the lookup is asked again at the tool use's result and at its task notification.
  readonly pendingAgents: Set<string>;
  readonly notificationSources: Set<string>;
  readonly notificationTools: Set<string>;
  readonly subagents: SubagentLookup | null;
  lastAt: string; // the previous event's `at`, inherited by records without a timestamp
  started: boolean; // session.started emitted (once per follow)
  lastTurnUserUuid: MessageUuid | null; // the last turn.started, for turn.ended.userMessageUuids
  // Inside a tool loop: the last word was a tool result, so the engine owes a model call, and the mid-turn fold that
  // takes or drops queued steers runs before it. Set by a tool result that is not an interrupt marker; cleared by an
  // assistant record, an interrupt marker, a prompt that opens a turn and `system/turn_duration`. It tells a blocked
  // steer (blockedPrompt, below) from a blocked prompt of its own.
  inToolLoop: boolean;
  lastAssistantWasApiError: boolean;
}

export function createBackfillContext(init: {
  sessionId: SessionId;
  agent: { agentId: AgentId; parentToolUseId: ParentToolUseId | null } | null; // a workflow agent names no tool use (its meta has no toolUseId)
  subagents?: SubagentLookup;
}): BackfillContext {
  return {
    sessionId: init.sessionId,
    agentId: init.agent?.agentId ?? null,
    parentToolUseId: init.agent?.parentToolUseId ?? null,
    seenToolUses: new Map(),
    pendingAgents: new Set(),
    notificationSources: new Set(),
    notificationTools: new Set(),
    subagents: init.subagents ?? null,
    lastAt: EPOCH,
    started: false,
    lastTurnUserUuid: null,
    inToolLoop: false,
    lastAssistantWasApiError: false,
  };
}

// The base fields of an event synthesised outside a record (anchors, branches, rewrites); the caller picks the id.
export function eventBase(ctx: BackfillContext, id: string): EventBase {
  return { id: id as EventId, sessionId: ctx.sessionId, at: ctx.lastAt, seq: null, agentId: ctx.agentId, parentToolUseId: ctx.parentToolUseId };
}

export function recordToEvents(record: TranscriptRecord, ctx: BackfillContext): SessionEvent[] {
  if (typeof record.uuid !== 'string') return [];
  const uuid = record.uuid as MessageUuid;
  if (typeof record.timestamp === 'string') ctx.lastAt = record.timestamp;
  const events: SessionEvent[] = [];
  let ordinal = 0;
  const base = (): EventBase => {
    const id = ordinal === 0 ? uuid : `${uuid}#${ordinal}`;
    ordinal += 1;
    return eventBase(ctx, id);
  };

  if (!ctx.started && typeof record.cwd === 'string') {
    ctx.started = true;
    const id = ctx.agentId === null ? `session:${ctx.sessionId}:started` : `session:${ctx.sessionId}:agent:${ctx.agentId}:started`;
    events.push({
      ...eventBase(ctx, id),
      kind: 'session.started',
      cwd: record.cwd,
      engineVersion: typeof record.version === 'string' ? record.version : null,
      resumedFrom: null,
      forked: Boolean(record.forkedFrom),
    });
  }

  switch (record.type) {
    case 'user':
      userEvents(record, uuid, ctx, base, events);
      break;
    case 'assistant':
      assistantEvents(record, uuid, ctx, base, events);
      break;
    case 'system':
      systemEvents(record, ctx, base, events);
      break;
    case 'attachment': // context injections: on the chain, nothing to show, except a relay's receipt in a child and a prompt taken mid-turn (W1)
      if (taskNotificationAttachment(record, uuid, ctx, base, events)) break;
      if (ctx.agentId === null) steeredPrompt(record, base, events);
      else coordinatorMessage(record, uuid, ctx, base, events);
      break;
    case 'progress': // never on the chain; the follower keeps only its skeleton
      break;
    default:
      events.push({ ...base(), kind: 'frame.unknown', frameType: `transcript:${record.type}`, subtype: null });
  }
  return events;
}

type Base = () => EventBase;

// Debt wave 4 (C8b's receipt ask): a message SendMessage queued for a live child reaches the child's transcript only as
// a `queued_command` attachment with the coordinator origin, written at the child's next tool round, which the model
// reads as a system reminder (pass3/relay-to-child seq 232 and 351, the recorded line: `attachment { type, prompt,
// source_uuid, origin: { kind: 'coordinator' }, isMeta: true }`). It becomes the child's synthetic `user.message` with
// the prompt as its content, as the resumed child's own `isMeta` user record already does, so C8b's relay sees the
// receipt; a synthetic message opens no turn and renders no row. Other attachments in a child's transcript stay unshown
// (the main transcript's are steeredPrompt's, below).
function coordinatorMessage(record: TranscriptRecord, uuid: MessageUuid, ctx: BackfillContext, base: Base, events: SessionEvent[]): void {
  const attachment = record.attachment as { type?: unknown; prompt?: unknown; origin?: { kind?: unknown } } | undefined;
  if (attachment?.type !== 'queued_command' || attachment.origin?.kind !== 'coordinator' || typeof attachment.prompt !== 'string') return;
  events.push({ ...base(), kind: 'user.message', messageUuid: uuid, content: attachment.prompt, isReplay: false, isSynthetic: true, origin: 'coordinator', bash: null });
}

// W1: a prompt the engine took into the running turn at a tool boundary is written to the main transcript only as a
// `queued_command` attachment after that tool's result, never as a user record: a stream-json `next` steer
// (test/fixtures/transcripts/w1-steer-next-disk.jsonl line 32) and a prompt the interactive terminal queued mid-turn
// (w1-terminal-queued.jsonl line 26) alike, `{ type, prompt, source_uuid, commandMode: 'prompt', origin: { kind:
// 'human' }, humanTurn: true }`. It becomes what the live stream shows: the prompt's `user.message` under its own uuid
// (`source_uuid`, the uuid it was written with), then the engine's `started` for it, which folds it into the open turn
// at this point (the reducer's `next` path), so a reloaded session places the steer where the live one did. A queued
// command of another origin (a task notification, a coordinator's) or a meta one is a context injection, as before.
function steeredPrompt(record: TranscriptRecord, base: Base, events: SessionEvent[]): void {
  const attachment = record.attachment as { type?: unknown; prompt?: unknown; source_uuid?: unknown; commandMode?: unknown; origin?: { kind?: unknown }; isMeta?: unknown } | undefined;
  if (attachment?.type !== 'queued_command' || attachment.origin?.kind !== 'human' || attachment.commandMode !== 'prompt' || attachment.isMeta === true) return;
  if (typeof attachment.source_uuid !== 'string' || attachment.source_uuid.length === 0) return;
  const content = typeof attachment.prompt === 'string' ? attachment.prompt : Array.isArray(attachment.prompt) ? attachment.prompt.filter(isContentBlock) : null;
  if (content === null) return;
  const messageUuid = attachment.source_uuid as MessageUuid;
  events.push({ ...base(), kind: 'user.message', messageUuid, content, isReplay: false, isSynthetic: false, origin: null, bash: null });
  events.push({ ...base(), kind: 'command.lifecycle', commandUuid: messageUuid, state: 'started' });
}

// Desktop's history adapter unwraps queued task notifications as user records. Old records lack source_uuid;
// their tool-use identity is the only stable delivery identity available.
function taskNotificationAttachment(record: TranscriptRecord, uuid: MessageUuid, ctx: BackfillContext, base: Base, events: SessionEvent[]): boolean {
  const attachment = record.attachment as { type?: unknown; commandMode?: unknown; prompt?: unknown; source_uuid?: unknown; isMeta?: unknown } | undefined;
  if (attachment?.type !== 'queued_command' || attachment.commandMode !== 'task-notification') return false;
  if (attachment.isMeta === true || typeof attachment.prompt !== 'string') return true;
  const source = typeof attachment.source_uuid === 'string' && attachment.source_uuid ? attachment.source_uuid as MessageUuid : null;
  userEvents({ ...record, type: 'user', message: { role: 'user', content: attachment.prompt } }, source ?? uuid, ctx, base, events, source);
  return true;
}

function userEvents(record: TranscriptRecord, uuid: MessageUuid, ctx: BackfillContext, base: Base, events: SessionEvent[], sourceUuid: MessageUuid | null = uuid): void {
  const content = messageContent(record);
  // W1 (A5): the summary `/compact` writes after its boundary (`isCompactSummary`, w1-compact.jsonl line 29) is the
  // engine's context for the model, which the live stream sends as a synthetic frame: no bubble and no turn, like meta.
  const isMeta = record.isMeta === true || record.isCompactSummary === true;
  const marker = isInterruptMarker(record);
  const local = isLocalCommandOutput(record);
  const turn = (origin: string | null): void => {
    if (isMeta || marker || local) return; // the marker belongs to the turn it interrupted, a command's output to the command's turn (W1)
    ctx.lastTurnUserUuid = uuid;
    ctx.inToolLoop = false;
    ctx.lastAssistantWasApiError = false;
    events.push({ ...base(), kind: 'turn.started', userMessageUuid: uuid, origin });
  };
  if (marker) ctx.inToolLoop = false; // an interrupt ends the loop: no model call follows
  if (typeof content === 'string' && marker) {
    events.push({ ...base(), kind: 'user.message', messageUuid: uuid, content, isReplay: false, isSynthetic: isMeta, origin: 'interrupt-marker', bash: null });
    return;
  }
  if (typeof content === 'string') {
    const notification = parseTaskNotification(content);
    if (notification !== null) {
      const duplicate = sourceUuid !== null ? ctx.notificationSources.has(sourceUuid) : notification.toolUseId !== null && ctx.notificationTools.has(notification.toolUseId);
      if (duplicate) return;
      if (sourceUuid !== null) ctx.notificationSources.add(sourceUuid);
      if (notification.toolUseId !== null) ctx.notificationTools.add(notification.toolUseId);
    }
    const origin = notification === null ? null : 'task-notification'; // X1's engine-initiated origin
    const bash = parseBash(content);
    turn(origin);
    events.push({ ...base(), kind: 'user.message', messageUuid: uuid, content: bashStripped(content, bash), isReplay: false, isSynthetic: isMeta, origin, bash });
    if (record.isMeta === true) hookFeedback(content, uuid, base, events);
    // The real completion of a background agent: the notification naming the tool use that started it.
    if (notification !== null && notification.toolUseId !== null) {
      const started = ctx.seenToolUses.get(notification.toolUseId) ?? startPendingSubagent(ctx, notification.toolUseId, base, events);
      if (started !== undefined) {
        const summary = notification.result ?? notification.summary;
        events.push({
          ...base(),
          kind: 'subagent.finished',
          taskId: notification.taskId === null ? started : (notification.taskId as TaskId),
          status: notification.status,
          summary: summary === null ? null : summary.slice(0, TEXT_CAP),
          outputFile: notification.outputFile,
          reason: null,
        });
      } else if (notification.taskId !== null) {
        // Like the live normaliser, an outcome without a known task type is a task.notification.
        events.push({ ...base(), kind: 'task.notification', taskId: notification.taskId as TaskId, toolUseId: notification.toolUseId as ToolUseId, status: notification.status, summary: notification.result ?? notification.summary ?? '', outputFile: notification.outputFile, reason: null });
      }
    }
    return;
  }
  if (!Array.isArray(content)) return;
  const blocks = content.filter(isContentBlock);
  const results = blocks.filter((block) => block.type === 'tool_result');
  const others = blocks.filter((block) => block.type !== 'tool_result');
  if (others.length > 0) {
    turn(null);
    events.push({ ...base(), kind: 'user.message', messageUuid: uuid, content: others, isReplay: false, isSynthetic: isMeta, origin: marker ? 'interrupt-marker' : null, bash: null });
  }
  const structured = record.toolUseResult ?? null;
  const persisted = (structured as { persistedOutputPath?: unknown } | null)?.persistedOutputPath;
  // A background agent's tool_result is its launch acknowledgement, not its outcome (`isAsync: true`); the outcome
  // arrives later as a <task-notification> user record.
  const asyncLaunched = (structured as { status?: unknown } | null)?.status === 'async_launched';
  if (results.length > 0 && !marker) ctx.inToolLoop = true;
  for (const block of results) {
    const toolUseId = block.tool_use_id;
    if (typeof toolUseId !== 'string' || toolUseId.length === 0) continue;
    const resultContent = block.content;
    const content: string | ContentBlock[] = typeof resultContent === 'string' ? resultContent : Array.isArray(resultContent) ? resultContent.filter(isContentBlock) : '';
    const text = typeof content === 'string' ? content : content.map((b) => (typeof b.text === 'string' ? b.text : '')).join('\n');
    const isError = block.is_error === true;
    startPendingSubagent(ctx, toolUseId, base, events);
    events.push({
      ...base(),
      kind: 'tool.result',
      toolUseId: toolUseId as ToolUseId,
      content,
      isError,
      structured,
      spillPath: typeof persisted === 'string' ? persisted : (SPILL_MARKER.exec(text)?.[1] ?? null),
      denial: null, // denial kinds are not recorded on disk in a parseable form
      safeguard: 'not_evaluated',
      messageUuid: uuid,
    });
    const taskId = ctx.seenToolUses.get(toolUseId);
    if (taskId !== undefined && !asyncLaunched) {
      events.push({
        ...base(),
        kind: 'subagent.finished',
        taskId,
        status: isError ? 'failed' : 'completed',
        summary: text.length > 0 ? text.slice(0, TEXT_CAP) : null,
        outputFile: null,
        reason: null,
      });
    }
  }
}

function assistantEvents(record: TranscriptRecord, uuid: MessageUuid, ctx: BackfillContext, base: Base, events: SessionEvent[]): void {
  const message = record.message as { id?: unknown; model?: unknown; content?: unknown } | undefined;
  const content = Array.isArray(message?.content) ? message.content.filter(isContentBlock) : [];
  // Every disk assistant record carries the API message id; the record uuid stands in if one ever lacks it.
  const apiMessageId = (typeof message?.id === 'string' && message.id.length > 0 ? message.id : uuid) as ApiMessageId;
  const model = typeof message?.model === 'string' ? message.model : '';
  const apiBlockIndex = typeof record.apiBlockIndex === 'number' ? record.apiBlockIndex : null;
  ctx.inToolLoop = false;
  ctx.lastAssistantWasApiError = record.isApiErrorMessage === true;
  content.forEach((block, i) => {
    events.push({
      ...base(),
      kind: 'assistant.block.complete',
      messageUuid: uuid,
      apiMessageId,
      blockIndex: apiBlockIndex === null ? i : apiBlockIndex + i,
      block,
      model,
      supersedes: [],
      aborted: false,
      userMessageUuids: [],
      ...(record.isApiErrorMessage === true && { isApiErrorMessage: true }),
      ...(typeof record.error === 'string' && { error: record.error }),
    });
    if (block.type !== 'tool_use' || typeof block.id !== 'string' || block.id.length === 0) return;
    const toolUseId = block.id as ToolUseId;
    const toolName = typeof block.name === 'string' ? block.name : '';
    events.push({ ...base(), kind: 'tool.use', toolUseId, toolName, input: block.input, apiMessageId, messageUuid: uuid });
    if (toolName !== 'Agent') return;
    if (startSubagent(ctx, toolUseId, base, events) === null) ctx.pendingAgents.add(toolUseId);
  });
}

// `subagent.started` for the child the lookup knows under this tool use; its task id, or null when the meta is unknown.
function startSubagent(ctx: BackfillContext, toolUseId: string, base: Base, events: SessionEvent[]): TaskId | null {
  const child = ctx.subagents?.byToolUseId(toolUseId) ?? null;
  if (child === null) return null;
  const taskId = child.agentId as string as TaskId;
  ctx.seenToolUses.set(toolUseId, taskId);
  events.push({
    ...base(),
    kind: 'subagent.started',
    taskId,
    toolUseId: toolUseId as ToolUseId,
    description: child.meta.description,
    subagentType: child.meta.agentType,
    isBackground: child.meta.requestShape === 'background',
    spawnDepth: child.meta.spawnDepth ?? 1,
    prompt: child.prompt,
  });
  return taskId;
}

// The late start of an Agent tool use read before its meta existed; undefined when it is not pending or still unknown.
function startPendingSubagent(ctx: BackfillContext, toolUseId: string, base: Base, events: SessionEvent[]): TaskId | undefined {
  if (!ctx.pendingAgents.has(toolUseId)) return undefined;
  const taskId = startSubagent(ctx, toolUseId, base, events);
  if (taskId === null) return undefined;
  ctx.pendingAgents.delete(toolUseId);
  return taskId;
}

function systemEvents(record: TranscriptRecord, ctx: BackfillContext, base: Base, events: SessionEvent[]): void {
  const subtype = typeof record.subtype === 'string' ? record.subtype : null;
  switch (subtype) {
    case 'compact_boundary': {
      const meta = record.compactMetadata as { trigger?: unknown; preTokens?: unknown; postTokens?: unknown } | undefined;
      events.push({
        ...base(),
        kind: 'boundary.compaction',
        trigger: typeof meta?.trigger === 'string' ? meta.trigger : 'unknown',
        preTokens: typeof meta?.preTokens === 'number' ? meta.preTokens : 0,
        postTokens: typeof meta?.postTokens === 'number' ? meta.postTokens : null, // W1: 2.1.283 writes it (w1-compact.jsonl line 28)
        logicalParentUuid: typeof record.logicalParentUuid === 'string' ? (record.logicalParentUuid as MessageUuid) : null,
        historical: true,
      });
      return;
    }
    case 'turn_duration':
      // Accounting is not on disk per turn; `seq: null` marks the event synthesised and C6 shows duration, not cost.
      ctx.inToolLoop = false;
      events.push({
        ...base(),
        kind: 'turn.ended',
        result: ctx.lastAssistantWasApiError ? 'error_during_execution' : 'success',
        isError: ctx.lastAssistantWasApiError,
        terminalReason: null,
        resultText: null,
        durationMs: typeof record.durationMs === 'number' ? record.durationMs : 0,
        numTurns: 1,
        costUsd: 0,
        usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, thinkingTokens: null },
        permissionDenials: [],
        errors: [],
        userMessageUuids: ctx.lastTurnUserUuid === null ? [] : [ctx.lastTurnUserUuid],
        origin: null,
        resultIndex: null,
        isEchoReceipt: false,
      });
      return;
    case 'api_error':
      // Live also leaves this unmapped; retain its compatibility signal rather than inventing an error row.
      events.push({ ...base(), kind: 'frame.unknown', frameType: 'system', subtype });
      return;
    case 'model_refusal_fallback':
    case 'model_refusal_no_fallback':
      // Disk uses camelCase (the live stream uses snake_case). No-fallback retracts no messages on the live path.
      events.push({
        ...base(),
        kind: 'boundary.retraction',
        retractedMessageUuids: subtype === 'model_refusal_fallback' && Array.isArray(record.retractedMessageUuids)
          ? record.retractedMessageUuids.filter((uuid): uuid is MessageUuid => typeof uuid === 'string') : [],
        reason: typeof record.content === 'string' ? record.content : 'model refusal',
        fallbackModel: subtype === 'model_refusal_fallback' && typeof record.fallbackModel === 'string' ? record.fallbackModel : null,
      });
      return;
    case 'stop_hook_summary':
    case 'away_summary':
    case 'scheduled_task_fire':
    case 'bridge_status':
    case 'permission_retry':
      return;
    case 'local_command':
    case 'local_command_output':
      events.push({ ...base(), kind: 'user.message', messageUuid: record.uuid as MessageUuid, content: typeof record.content === 'string' ? record.content : '', isReplay: false, isSynthetic: record.isMeta === true, origin: 'local-command', bash: null });
      return;
    case 'informational': {
      const blocked = blockedPrompt(record);
      if (blocked === null) {
        const text = typeof record.content === 'string' ? record.content.trim() : '';
        if (record.level === 'info') return;
        if (record.level !== 'warning' && record.level !== 'notice') break; // preserve unknown shapes as compatibility signals
        if (text) events.push({ ...base(), kind: 'notice.posted', level: record.level, text, key: 'informational' });
        return;
      }
      // The prompt, from the record's "Original prompt:"; none when the hook suppressed it, though a queue operation
      // before the record may still hold its text, left unread as the hook asked.
      const uuid = record.uuid as MessageUuid;
      const prompt = (): void => {
        if (blocked.prompt !== null) events.push({ ...base(), kind: 'user.message', messageUuid: uuid, content: blocked.prompt, isReplay: false, isSynthetic: false, origin: null, bash: null });
      };
      // Inside a tool loop it is a queued `next` steer the hook rejected at the mid-turn fold, and the turn runs on
      // (2.1.283 cli.pretty.js 806590-806624, the fold's dropped prompts and their notices; 810567-810575, yielded inside
      // the running turn; from the bundle, not recorded): read as steeredPrompt reads a delivered steer, its bubble
      // folded into the running turn here (the record's uuid standing in for the steer's), then the hook that blocked it.
      if (ctx.inToolLoop) {
        prompt();
        events.push({ ...base(), kind: 'command.lifecycle', commandUuid: uuid, state: 'started' });
        blockingHook(uuid, 'UserPromptSubmit', blocked.blockingError, base, events);
        return;
      }
      // Otherwise a turn of its own as the live stream has it: the prompt, the hook that blocked it, and the end of a
      // turn that ran nothing (num_turns 0).
      ctx.lastTurnUserUuid = uuid;
      events.push({ ...base(), kind: 'turn.started', userMessageUuid: uuid, origin: null });
      prompt();
      blockingHook(uuid, 'UserPromptSubmit', blocked.blockingError, base, events);
      events.push({
        ...base(),
        kind: 'turn.ended',
        result: 'success',
        isError: false,
        terminalReason: null,
        resultText: blocked.text,
        durationMs: 0,
        numTurns: 0,
        costUsd: 0,
        usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, thinkingTokens: null },
        permissionDenials: [],
        errors: [],
        userMessageUuids: [uuid],
        origin: null,
        resultIndex: null,
        isEchoReceipt: false,
      });
      return;
    }
  }
  events.push({ ...base(), kind: 'frame.unknown', frameType: 'transcript:system', subtype });
}

// Debt wave 7 (W1's hook notices after a reload): disk carries no hook events, so a hook that got in the way is read
// from what the engine writes instead, as the hook events the live stream has for it (pass3/hooks-blocking seq 30 and
// 57, pass3/hooks-flipped seq 30, 65 and 82; the same runs on disk: test/fixtures/transcripts/w1-hooks-blocking.jsonl
// lines 24 and 31, dw7-hooks-flipped.jsonl lines 24, 31 and 35).
//
// On disk the engine keeps a blocking error's text (`blockingError`: the hook's JSON `reason`, or `[<command>]: <stderr>`
// when it exited 2), not how the hook signalled it, nor its exit code, output or hook id. The finish is stated in the
// form the hook protocol defines a blocking error by, exit code 2 with the reason on stderr, which C6's hook notice
// reads as blocking (model/hooks.ts) whichever way the hook blocked live; the `[<command>]: ` prefix is dropped, since
// live stderr carries the reason alone. The record's uuid stands in for the hook id.
function blockingHook(hookId: string, hookEvent: string, blockingError: string, base: Base, events: SessionEvent[]): void {
  const stderr = blockingError.replace(COMMAND_PREFIX, '');
  events.push({ ...base(), kind: 'hook.started', hookId, hookName: hookEvent, hookEvent });
  events.push({ ...base(), kind: 'hook.finished', hookId, hookName: hookEvent, hookEvent, outcome: 'error', exitCode: 2, stdout: '', stderr });
}

const COMMAND_PREFIX = /^\[[^\n]*?\]: /;

// A Stop hook that blocked (re-prompting Claude) leaves, per blocking hook, a meta user record `<Event> hook
// feedback:\n<blockingError>` whichever way it blocked (2.1.283's `ffn`, the one formatter for Stop, TeammateIdle,
// TaskCreated and TaskCompleted blocks). Its `hook_blocking_error` attachment is written only for a JSON block, and the
// `stop_hook_summary` record's `hookErrors` also lists non-blocking failures, so neither is read.
const HOOK_FEEDBACK = /^(\w+) hook feedback:\n([\s\S]*)$/;
function hookFeedback(content: string, uuid: MessageUuid, base: Base, events: SessionEvent[]): void {
  const match = HOOK_FEEDBACK.exec(content);
  if (match !== null) blockingHook(uuid, match[1], match[2], base, events);
}

// A prompt a UserPromptSubmit hook blocked leaves no user record, only a system `informational` record:
// `UserPromptSubmit operation blocked by hook:\n<blockingError>` and, unless the hook suppressed it, `\n\nOriginal
// prompt: <prompt>` (2.1.283 cli.pretty.js 525245-525248). The first such separator splits them. The same record is
// written for a prompt submitted on its own and for a steer dropped at the mid-turn fold (systemEvents tells them apart
// by `inToolLoop`), so the follower does not count it as a turn end.
const BLOCKED_PROMPT = 'UserPromptSubmit operation blocked by hook:\n';
const ORIGINAL_PROMPT = '\n\nOriginal prompt: ';
function blockedPrompt(record: TranscriptRecord): { text: string; blockingError: string; prompt: string | null } | null {
  if (record.type !== 'system' || record.subtype !== 'informational' || typeof record.content !== 'string' || !record.content.startsWith(BLOCKED_PROMPT)) return null;
  const text = record.content;
  const rest = text.slice(BLOCKED_PROMPT.length);
  const at = rest.indexOf(ORIGINAL_PROMPT);
  return at < 0 ? { text, blockingError: rest, prompt: null } : { text, blockingError: rest.slice(0, at), prompt: rest.slice(at + ORIGINAL_PROMPT.length) };
}

// A prompt that opens a turn: a `user` record, not `isMeta`, not an interrupt marker, whose content is text or blocks
// with no tool result (a tool result continues the turn its tool use is in). The follower reads turn boundaries by it.
export function startsTurn(record: TranscriptRecord): boolean {
  if (record.type !== 'user' || record.isMeta === true || record.isCompactSummary === true || isInterruptMarker(record) || isLocalCommandOutput(record)) return false; // W1: a compact summary and a command's output too
  const content = messageContent(record);
  if (typeof content === 'string') return true;
  if (!Array.isArray(content)) return false;
  const blocks = content.filter(isContentBlock);
  return blocks.length > 0 && blocks.every((block) => block.type !== 'tool_result');
}

// The marker the engine writes after an interrupt (`[Request interrupted by user]`, `… for tool use`): C3's
// `INTERRUPT_MARKER`, tested on the string content or on the joined text of the record's non-result blocks when all of
// them are text (the array form is the common one on disk). C3's normaliser tags it `origin: 'interrupt-marker'` on the
// wire; the backfill does the same, and it opens no turn.
function isInterruptMarker(record: TranscriptRecord): boolean {
  if (record.type !== 'user') return false;
  const content = messageContent(record);
  let text: string | null = null;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    const others = content.filter(isContentBlock).filter((block) => block.type !== 'tool_result');
    if (others.length > 0 && others.every((block) => block.type === 'text' && typeof block.text === 'string')) text = others.map((block) => block.text as string).join('');
  }
  return text !== null && INTERRUPT_MARKER.test(text.trim());
}

// W1 (A5): a slash command's output, `<local-command-stdout>…` after the command's own record (w1-compact.jsonl line
// 32, the terminal's `/exit` in w1-terminal-queued.jsonl), is the engine's echo, not a prompt: it belongs to the
// command's turn, as the live stream's replay of it does (pass3/compact seq 45), so it opens none of its own (a turn of
// its own read "Worked for 0s" under a bubble-less divider).
function isLocalCommandOutput(record: TranscriptRecord): boolean {
  if (record.type !== 'user') return false;
  const content = messageContent(record);
  const text = typeof content === 'string' ? content : Array.isArray(content) && content.length === 1 && isContentBlock(content[0]) && content[0].type === 'text' && typeof content[0].text === 'string' ? content[0].text : null;
  return text !== null && /^\s*<local-command-(stdout|caveat)>/.test(text);
}

function messageContent(record: TranscriptRecord): unknown {
  return (record.message as { content?: unknown } | undefined)?.content;
}

const isContentBlock = (value: unknown): value is ContentBlock & { [k: string]: unknown } =>
  typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';

type Bash = Extract<SessionEvent, { kind: 'user.message' }>['bash'];

// Bash-mode messages carry their command and output as tags (`<bash-input>`, `<bash-stdout>…<bash-exit-code>`).
function parseBash(content: string): Bash {
  const input = /^<bash-input>([\s\S]*?)<\/bash-input>/.exec(content);
  if (input) return { part: 'input', command: input[1] };
  const stdout = /<bash-stdout>([\s\S]*?)<\/bash-stdout>/.exec(content);
  if (!stdout) return null;
  const stderr = /<bash-stderr>([\s\S]*?)<\/bash-stderr>/.exec(content);
  const exit = /<bash-exit-code>(-?\d+)<\/bash-exit-code>/.exec(content);
  return { part: 'output', stdout: stdout[1], stderr: stderr?.[1] ?? '', exitCode: exit ? Number(exit[1]) : 0 };
}

// C1's derivation rule: the tags are stripped from the content and `bash` is filled.
function bashStripped(content: string, bash: Bash): string {
  if (bash === null) return content;
  if (bash.part === 'input') return bash.command;
  return bash.stderr.length > 0 ? `${bash.stdout}\n${bash.stderr}` : bash.stdout;
}

interface TaskNotification {
  taskId: string | null;
  toolUseId: string | null;
  status: 'completed' | 'failed' | 'stopped';
  summary: string | null;
  result: string | null;
  outputFile: string | null;
}

// The engine's `<task-notification>` block (SPEC 20.9): the outcome of a background task, delivered as a user record.
function parseTaskNotification(content: string): TaskNotification | null {
  if (!content.trimStart().startsWith('<task-notification>')) return null;
  const element = (name: string): string | null => {
    const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(content);
    return match === null ? null : match[1].trim();
  };
  const status = element('status');
  const outcome: TaskNotification['status'] =
    status === 'failed' || status === 'error' ? 'failed'
    : status === 'stopped' || status === 'killed' || status === 'cancelled' || status === 'interrupted' ? 'stopped'
    : 'completed';
  return {
    taskId: element('task-id'),
    toolUseId: element('tool-use-id'),
    status: outcome,
    summary: element('summary'),
    result: element('result'),
    outputFile: element('output-file'),
  };
}
