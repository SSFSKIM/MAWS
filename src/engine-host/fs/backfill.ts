// Transcript-to-X1 backfill (C4 execution document, "Chain follower and backfill", the mapping table): one disk record
// in, the X1 events it stands for out. Used by the chain follower for every record it puts on the chain and by the
// replay engine's transcript source (M5). Disk records carry no journal row, so every event has `seq: null` and a
// deterministic id (`<uuid>`, `<uuid>#<n>`, `session:<id>:started`), which is what lets a consumer that receives the
// same backfill twice deduplicate.
import type { ContentBlock, EventBase, SessionEvent } from '@shared/graph/events';
import type { AgentId, ApiMessageId, EventId, MessageUuid, ParentToolUseId, SessionId, TaskId, ToolUseId } from '@shared/graph/ids';
import type { AgentMeta, TranscriptRecord } from '@shared/wire/transcript';

// The three engine strings that name a spilled result (SPEC 12.12 and 20.10); the structured field wins when present.
export const SPILL_MARKER = /(?:Full output saved to|were saved to|was saved to):? (\/\S+?\.(?:txt|json))\b/;

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
  readonly subagents: SubagentLookup | null;
  lastAt: string; // the previous event's `at`, inherited by records without a timestamp
  started: boolean; // session.started emitted (once per follow)
  lastTurnUserUuid: MessageUuid | null; // the last turn.started, for turn.ended.userMessageUuids
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
    subagents: init.subagents ?? null,
    lastAt: EPOCH,
    started: false,
    lastTurnUserUuid: null,
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
    case 'attachment': // context injections: on the chain, nothing to show
    case 'progress': // never on the chain; the follower keeps only its skeleton
      break;
    default:
      events.push({ ...base(), kind: 'frame.unknown', frameType: `transcript:${record.type}`, subtype: null });
  }
  return events;
}

type Base = () => EventBase;

function userEvents(record: TranscriptRecord, uuid: MessageUuid, ctx: BackfillContext, base: Base, events: SessionEvent[]): void {
  const content = messageContent(record);
  const isMeta = record.isMeta === true;
  const marker = isInterruptMarker(record);
  const turn = (origin: string | null): void => {
    if (isMeta || marker) return; // the marker belongs to the turn it interrupted
    ctx.lastTurnUserUuid = uuid;
    events.push({ ...base(), kind: 'turn.started', userMessageUuid: uuid, origin });
  };
  if (typeof content === 'string' && marker) {
    events.push({ ...base(), kind: 'user.message', messageUuid: uuid, content, isReplay: false, isSynthetic: isMeta, origin: 'interrupt-marker', bash: null });
    return;
  }
  if (typeof content === 'string') {
    const notification = parseTaskNotification(content);
    const origin = notification === null ? null : 'task-notification'; // X1's engine-initiated origin
    const bash = parseBash(content);
    turn(origin);
    events.push({ ...base(), kind: 'user.message', messageUuid: uuid, content: bashStripped(content, bash), isReplay: false, isSynthetic: isMeta, origin, bash });
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
  content.forEach((block, i) => {
    events.push({
      ...base(),
      kind: 'assistant.block.complete',
      messageUuid: uuid,
      apiMessageId,
      blockIndex: apiBlockIndex === null ? i : apiBlockIndex + i,
      block,
      model,
      supersedes: null,
      aborted: false,
      userMessageUuids: [],
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
      const meta = record.compactMetadata as { trigger?: unknown; preTokens?: unknown } | undefined;
      events.push({
        ...base(),
        kind: 'boundary.compaction',
        trigger: typeof meta?.trigger === 'string' ? meta.trigger : 'unknown',
        preTokens: typeof meta?.preTokens === 'number' ? meta.preTokens : 0,
        postTokens: null,
        logicalParentUuid: typeof record.logicalParentUuid === 'string' ? (record.logicalParentUuid as MessageUuid) : null,
        historical: true,
      });
      return;
    }
    case 'turn_duration':
      // Accounting is not on disk per turn; `seq: null` marks the event synthesised and C6 shows duration, not cost.
      events.push({
        ...base(),
        kind: 'turn.ended',
        result: 'success',
        isError: false,
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
    case 'local_command':
      events.push({ ...base(), kind: 'notice.posted', level: 'info', text: typeof record.content === 'string' ? record.content : '', key: 'local_command' });
      return;
    default:
      events.push({ ...base(), kind: 'frame.unknown', frameType: 'transcript:system', subtype });
  }
}

// A prompt that opens a turn: a `user` record, not `isMeta`, not an interrupt marker, whose content is text or blocks
// with no tool result (a tool result continues the turn its tool use is in). The follower reads turn boundaries by it.
export function startsTurn(record: TranscriptRecord): boolean {
  if (record.type !== 'user' || record.isMeta === true || isInterruptMarker(record)) return false;
  const content = messageContent(record);
  if (typeof content === 'string') return true;
  if (!Array.isArray(content)) return false;
  const blocks = content.filter(isContentBlock);
  return blocks.length > 0 && blocks.every((block) => block.type !== 'tool_result');
}

// The marker the engine writes after an interrupt (`[Request interrupted by user]`, `… for tool use`): C3's
// `INTERRUPT_MARKER` (normalizer-support.ts), tested on the string content or on the joined text of the record's
// non-result blocks when all of them are text (the array form is the common one on disk). C3's normaliser tags it
// `origin: 'interrupt-marker'` on the wire; the backfill does the same, and it opens no turn.
const INTERRUPT_MARKER = /^\[Request interrupted by user[^\]]*\]$/;
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
