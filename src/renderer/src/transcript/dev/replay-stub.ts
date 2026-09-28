// The replay stub (C6 execution document, "Replay stub, synthetic fixtures and harness"; residue *Replay stub and
// harness*): X8 journal rows → X1 events for the frames the transcript renders, implementing C1's derivation rules and
// the querying-user mapping shared with C3. A development artefact for the harness and the snapshot suite, retired
// behind the equivalence gate once C3's normaliser lands. Event ids are `j<seq>#<n>`; the equivalence test compares
// everything but `id`.
import { DENIAL_KINDS, type DenialKind, type PermissionMode } from '@shared/graph/enums';
import type { ContentBlock, SessionEvent, TokenUsage } from '@shared/graph/events';
import type { AgentId, ApiMessageId, EventId, MessageUuid, ParentToolUseId, RequestId, SessionId, TaskId, ToolUseId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';

type Payload<K extends SessionEvent['kind']> = Omit<Extract<SessionEvent, { kind: K }>, 'id' | 'sessionId' | 'at' | 'seq' | 'agentId' | 'parentToolUseId' | 'kind'>;
type Frame = Record<string, unknown>;

const rec = (value: unknown): Frame => (typeof value === 'object' && value !== null ? (value as Frame) : {});
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const bool = (value: unknown): boolean => value === true;

const BASH_INPUT = /^<bash-input>([\s\S]*?)<\/bash-input>$/;
const BASH_OUTPUT = /^<bash-stdout>([\s\S]*?)<\/bash-stdout><bash-stderr>([\s\S]*?)<\/bash-stderr><bash-exit-code>(-?\d+)<\/bash-exit-code>$/;

const NOTICE_LEVELS = new Set(['info', 'notice', 'suggestion', 'warning']);
const TASK_OUTCOMES = new Set(['completed', 'failed', 'stopped']);

function usageOf(usage: unknown): TokenUsage {
  const u = rec(usage);
  return {
    inputTokens: num(u.input_tokens) ?? 0, outputTokens: num(u.output_tokens) ?? 0, cacheReadInputTokens: num(u.cache_read_input_tokens) ?? 0,
    cacheCreationInputTokens: num(u.cache_creation_input_tokens) ?? 0, thinkingTokens: num(u.thinking_tokens),
  };
}

const questionsOf = (input: unknown) => (Array.isArray(rec(input).questions) ? (rec(input).questions as unknown[]).map(rec).map((q) => ({
  question: str(q.question) ?? '', header: str(q.header) ?? '', multiSelect: bool(q.multiSelect),
  options: Array.isArray(q.options) ? (q.options as unknown[]).map(rec).map((o) => ({ label: str(o.label) ?? '', description: str(o.description), preview: str(o.preview) })) : [],
})) : []);

export interface StubOptions { sessionId?: SessionId }

export function journalToEvents(rows: JournalRow[], options: StubOptions = {}): SessionEvent[] {
  const events: SessionEvent[] = [];
  let sessionId: SessionId | null = options.sessionId ?? null;
  let open = false; // a turn is open: after our querying user frame or an engine-initiated init, until its result
  let pendingEcho = false; // a shouldQuery:false frame went out and its receipt has not arrived
  const promptUuids = new Set<string>(); // our own prompts; the engine's inbound replay of one yields nothing
  const currentApi = new Map<string, string>(); // parent key → api message id of the message being streamed
  const blockTypes = new Map<string, string>(); // `${parent key}:${index}` → content block type
  const tasks = new Map<string, { taskType: string; workflowName: string | null }>();
  const agentByToolUse = new Map<string, string>(); // Agent tool use → agent id (the task id), for child traffic
  const safeguards = new Map<string, 'not_flagged' | 'flagged'>();
  const inboundRequests = new Map<string, Frame>(); // control requests from the engine, by request id
  const outboundRequests = new Map<string, Frame>(); // our control requests, by request id

  const emit = <K extends SessionEvent['kind']>(row: JournalRow, n: number, kind: K, payload: Payload<K>, frame: Frame, parent: string | null): void => {
    if (sessionId === null) sessionId = (str(frame.session_id) ?? 'journal') as SessionId;
    events.push({
      id: `j${row.seq}#${n}` as EventId, sessionId, at: str(frame.timestamp) ?? row.at, seq: row.seq,
      agentId: (parent === null ? null : (agentByToolUse.get(parent) ?? null)) as AgentId | null, parentToolUseId: parent as ParentToolUseId | null, kind, ...payload,
    } as unknown as SessionEvent);
  };

  rows.forEach((row, rowIndex) => {
    let n = 0;
    const frame = rec(row.frame);
    const parent = str(frame.parent_tool_use_id);
    const parentKey = parent ?? '';
    const put = <K extends SessionEvent['kind']>(kind: K, payload: Payload<K>) => emit(row, n++, kind, payload, frame, parent);

    if (row.direction === 'meta') {
      if (frame.event === 'exit') put('process.exited', { code: num(frame.code), signal: str(frame.signal), reason: num(frame.code) === 0 ? 'quit' : 'crash', lostAttentionCount: 0 });
      return;
    }
    if (row.direction === 'stderr') return;

    if (row.direction === 'out') {
      switch (frame.type) {
        case 'user': {
          const uuid = str(frame.uuid);
          const content = frame.message !== undefined ? (rec(frame.message).content as string | ContentBlock[]) : '';
          if (frame.shouldQuery === false) {
            pendingEcho = true;
            put('user.message', { messageUuid: uuid as MessageUuid | null, content, isReplay: false, isSynthetic: true, origin: 'bash_echo', bash: null });
            return;
          }
          if (uuid) promptUuids.add(uuid);
          put('turn.started', { userMessageUuid: uuid as MessageUuid | null, origin: 'human' });
          put('user.message', { messageUuid: uuid as MessageUuid | null, content, isReplay: false, isSynthetic: false, origin: str(rec(frame.origin).kind) ?? 'human', bash: null });
          open = true;
          return;
        }
        case 'control_request':
          outboundRequests.set(str(frame.request_id) ?? '', rec(frame.request));
          return;
        case 'control_response': {
          const response = rec(frame.response);
          const requestId = str(response.request_id) ?? '';
          const request = inboundRequests.get(requestId);
          if (!request || response.subtype !== 'success') return;
          inboundRequests.delete(requestId);
          const body = rec(response.response);
          const id = requestId as RequestId;
          switch (request.subtype) {
            case 'can_use_tool': {
              const toolUseId = (str(request.tool_use_id) ?? '') as ToolUseId;
              if (request.tool_name === 'AskUserQuestion') {
                const answers = rec(rec(body.updatedInput).answers);
                put('question.answered', { requestId: id, toolUseId, answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, String(v)])) });
              } else if (request.tool_name === 'ExitPlanMode') {
                const resetFollows = rows.slice(rowIndex + 1).some((later, i, slice) => rec(later.frame).type === 'conversation_reset' && !slice.slice(0, i).some((mid) => rec(mid.frame).type === 'result'));
                const outcome = resetFollows ? 'clear_and_implement' : body.behavior === 'allow' ? 'implement' : 'keep_planning';
                put('plan.resolved', { requestId: id, toolUseId, outcome, feedback: outcome === 'keep_planning' ? str(body.message) : null });
              } else {
                put('permission.resolved', {
                  requestId: id, toolUseId, behavior: body.behavior === 'deny' ? 'deny' : 'allow', message: str(body.message), updatedInput: body.updatedInput ?? null,
                  updatedPermissions: Array.isArray(body.updatedPermissions) ? body.updatedPermissions : [], resolvedBy: 'user',
                });
              }
              return;
            }
            case 'hook_callback':
              put('hook.callback_resolved', { requestId: id, callbackId: str(request.callback_id) ?? '', response: body });
              return;
            case 'elicitation':
              put('elicitation.resolved', { requestId: id, action: body.action === 'decline' ? 'decline' : body.action === 'cancel' ? 'cancel' : 'accept', content: body.content ?? null });
              return;
            default:
              put('dialog.resolved', { requestId: id, behavior: 'completed', result: body });
              return;
          }
        }
        default:
          return; // bash_command (the engine replays its frames), keep_alive, control_cancel_request
      }
    }

    // Stdout (`in`) frames.
    switch (frame.type) {
      case 'system':
        return systemFrame(row, frame, put, { get open() { return open; }, set open(v) { open = v; }, get pendingEcho() { return pendingEcho; } }, tasks, agentByToolUse);
      case 'assistant': {
        const message = rec(frame.message);
        const apiMessageId = (str(message.id) ?? '') as ApiMessageId;
        const uuid = (str(frame.uuid) ?? '') as MessageUuid;
        const blocks = Array.isArray(message.content) ? (message.content as ContentBlock[]) : [];
        if (!open && parent === null) {
          put('turn.started', { userMessageUuid: null, origin: 'engine' });
          open = true;
        }
        blocks.forEach((block, index) => {
          put('assistant.block.complete', {
            messageUuid: uuid, apiMessageId, blockIndex: index, block, model: str(message.model) ?? '', supersedes: (str(frame.supersedes) ?? null) as MessageUuid | null,
            aborted: bool(frame.aborted), userMessageUuids: Array.isArray(frame.user_message_uuids) ? (frame.user_message_uuids as MessageUuid[]) : [],
          });
          if (block.type === 'tool_use') put('tool.use', { toolUseId: str(block.id) as ToolUseId, toolName: str(block.name) ?? '', input: block.input, apiMessageId, messageUuid: uuid });
        });
        return;
      }
      case 'user': {
        const uuid = str(frame.uuid);
        const content = rec(frame.message).content as string | ContentBlock[];
        if (uuid && promptUuids.has(uuid)) return; // the engine's inbound replay of our own prompt
        if (typeof content === 'string') {
          const input = BASH_INPUT.exec(content);
          const output = BASH_OUTPUT.exec(content);
          put('user.message', {
            messageUuid: uuid as MessageUuid | null, content: input || output ? '' : content, isReplay: bool(frame.isReplay), isSynthetic: bool(frame.isSynthetic), origin: str(rec(frame.origin).kind),
            bash: input ? { part: 'input', command: input[1] } : output ? { part: 'output', stdout: output[1], stderr: output[2], exitCode: Number(output[3]) } : null,
          });
          return;
        }
        const results = content.filter((block) => block.type === 'tool_result');
        const meta = Array.isArray(frame.tool_result_meta) ? (frame.tool_result_meta as unknown[]).map(rec) : [];
        for (const block of results) {
          const toolUseId = str(block.tool_use_id) ?? '';
          const kind = str(meta.find((m) => m.id === toolUseId)?.non_execution_kind);
          put('tool.result', {
            toolUseId: toolUseId as ToolUseId, content: (block.content ?? '') as string | ContentBlock[], isError: bool(block.is_error), structured: frame.tool_use_result ?? null, spillPath: null,
            denial: kind !== null && (DENIAL_KINDS as readonly string[]).includes(kind) ? (kind as DenialKind) : null, safeguard: safeguards.get(toolUseId) ?? 'not_evaluated', messageUuid: uuid as MessageUuid | null,
          });
        }
        if (results.length < content.length) {
          put('user.message', { messageUuid: uuid as MessageUuid | null, content: content.filter((block) => block.type !== 'tool_result'), isReplay: bool(frame.isReplay), isSynthetic: bool(frame.isSynthetic), origin: str(rec(frame.origin).kind), bash: null });
        }
        return;
      }
      case 'stream_event': {
        const event = rec(frame.event);
        const index = num(event.index) ?? 0;
        switch (event.type) {
          case 'message_start':
            currentApi.set(parentKey, str(rec(event.message).id) ?? '');
            return;
          case 'content_block_start':
            blockTypes.set(`${parentKey}:${index}`, str(rec(event.content_block).type) ?? 'text');
            return;
          case 'content_block_delta': {
            const delta = rec(event.delta);
            const blockType = blockTypes.get(`${parentKey}:${index}`) ?? 'text';
            if (delta.type === 'signature_delta') return;
            if (!open && parent === null) {
              put('turn.started', { userMessageUuid: null, origin: 'engine' });
              open = true;
            }
            put('assistant.block.delta', {
              apiMessageId: (currentApi.get(parentKey) ?? null) as ApiMessageId | null, blockIndex: index, blockType,
              textDelta: delta.type === 'text_delta' ? (str(delta.text) ?? '') : null, thinkingDelta: delta.type === 'thinking_delta' ? (str(delta.thinking) ?? '') : null,
              inputJsonDelta: delta.type === 'input_json_delta' ? (str(delta.partial_json) ?? '') : null, userMessageUuid: null,
            });
            return;
          }
          case 'message_delta': {
            const results = Array.isArray(rec(event.delta).safeguard_results) ? (rec(event.delta).safeguard_results as unknown[]).map(rec) : [];
            for (const result of results) {
              for (const [toolUseId, entry] of Object.entries(rec(rec(result.status).tool_uses))) {
                const verdict = rec(entry).outcome === 'flagged' ? 'flagged' : 'not_flagged';
                safeguards.set(toolUseId, verdict);
                put('tool.safeguard', { toolUseId: toolUseId as ToolUseId, verdict, lane: 'server' });
              }
            }
            return;
          }
          default:
            return;
        }
      }
      case 'result': {
        const terminalReason = str(frame.terminal_reason);
        const isEchoReceipt = pendingEcho && num(frame.num_turns) === 0 && terminalReason === null;
        const denials = Array.isArray(frame.permission_denials) ? (frame.permission_denials as unknown[]).map(rec) : [];
        put('turn.ended', {
          result: str(frame.subtype) ?? 'success', isError: bool(frame.is_error), terminalReason, resultText: str(frame.result), durationMs: num(frame.duration_ms) ?? 0, numTurns: num(frame.num_turns) ?? 0,
          costUsd: num(frame.total_cost_usd) ?? 0, usage: usageOf(frame.usage),
          permissionDenials: denials.map((d) => ({ toolName: str(d.tool_name) ?? '', toolUseId: (str(d.tool_use_id) ?? '') as ToolUseId, toolInput: d.tool_input ?? null })),
          errors: Array.isArray(frame.errors) ? (frame.errors as unknown[]).map(String) : [], userMessageUuids: Array.isArray(frame.user_message_uuids) ? (frame.user_message_uuids as MessageUuid[]) : [],
          origin: str(rec(frame.origin).kind), resultIndex: num(frame.result_index), isEchoReceipt,
        });
        if (isEchoReceipt) pendingEcho = false;
        else open = false;
        return;
      }
      case 'control_request': {
        const request = rec(frame.request);
        const requestId = (str(frame.request_id) ?? '') as RequestId;
        inboundRequests.set(requestId, request);
        switch (request.subtype) {
          case 'can_use_tool': {
            const toolUseId = (str(request.tool_use_id) ?? '') as ToolUseId;
            if (request.tool_name === 'AskUserQuestion') put('question.requested', { requestId, toolUseId, questions: questionsOf(request.input) });
            else if (request.tool_name === 'ExitPlanMode') put('plan.requested', { requestId, toolUseId, plan: str(rec(request.input).plan) ?? '', input: request.input ?? null });
            else put('permission.requested', {
              requestId, toolUseId, toolName: str(request.tool_name) ?? '', displayName: str(request.display_name), input: request.input ?? null, description: str(request.description),
              decisionReasonType: str(request.decision_reason_type), suggestions: Array.isArray(request.permission_suggestions) ? request.permission_suggestions : [], blockedPath: str(request.blocked_path),
            });
            return;
          }
          case 'hook_callback':
            put('hook.callback_requested', { requestId, callbackId: str(request.callback_id) ?? '', hookEvent: str(rec(request.input).hook_event_name) ?? '', toolUseId: (str(request.tool_use_id) ?? null) as ToolUseId | null, input: request.input ?? null });
            return;
          case 'elicitation':
            put('elicitation.requested', { requestId, mcpServerName: str(request.mcp_server_name) ?? '', elicitationId: str(request.elicitation_id), mode: str(request.mode) ?? '', payload: request });
            return;
          default:
            put('dialog.requested', { requestId, dialogKind: str(request.subtype) ?? 'unknown', payload: request, toolUseId: (str(request.tool_use_id) ?? null) as ToolUseId | null });
            return;
        }
      }
      case 'control_response': {
        const response = rec(frame.response);
        const request = outboundRequests.get(str(response.request_id) ?? '');
        if (!request) return;
        outboundRequests.delete(str(response.request_id) ?? '');
        const body = rec(response.response);
        if (request.subtype === 'rewind_conversation' && response.subtype === 'success' && body.rewound === true) {
          put('boundary.rewind', { targetMessageUuid: (str(body.targetMessageUuid) ?? str(request.target_message_uuid) ?? '') as MessageUuid, precedingAssistantUuid: str(body.precedingAssistantUuid) as MessageUuid | null, prefillText: str(body.prefillText) });
        }
        return;
      }
      case 'conversation_reset':
        put('boundary.reset', { newConversationId: str(frame.new_conversation_id) ?? '', trigger: str(frame.trigger) });
        return;
      case 'command_lifecycle':
        put('command.lifecycle', { commandUuid: (str(frame.command_uuid) ?? '') as MessageUuid, state: frame.state as Payload<'command.lifecycle'>['state'] });
        return;
      case 'tool_progress':
        put('tool.progress', { toolUseId: (str(frame.tool_use_id) ?? '') as ToolUseId, toolName: str(frame.tool_name) ?? '', elapsedSeconds: num(frame.elapsed_time_seconds) ?? 0, taskId: str(frame.task_id) as TaskId | null, heartbeat: bool(frame.heartbeat) });
        return;
      case 'keep_alive': case 'tool_use_summary': case 'rate_limit_event': case 'prompt_suggestion': case 'auth_status': case 'control_cancel_request':
        return; // known frames the transcript does not render
      default:
        put('frame.unknown', { frameType: str(frame.type) ?? '?', subtype: str(frame.subtype) });
    }
  });
  return events;
}

interface TurnFlags { open: boolean; readonly pendingEcho: boolean }
type Put = <K extends SessionEvent['kind']>(kind: K, payload: Payload<K>) => void;

function systemFrame(row: JournalRow, frame: Frame, put: Put, turn: TurnFlags, tasks: Map<string, { taskType: string; workflowName: string | null }>, agentByToolUse: Map<string, string>): void {
  const taskId = (str(frame.task_id) ?? '') as TaskId;
  const toolUseId = (str(frame.tool_use_id) ?? null) as ToolUseId | null;
  switch (frame.subtype) {
    case 'init': {
      put('session.init', {
        cwd: str(frame.cwd) ?? '', model: str(frame.model) ?? '', permissionMode: (str(frame.permissionMode) ?? 'default') as PermissionMode, tools: (frame.tools as string[]) ?? [],
        slashCommands: (frame.slash_commands as string[]) ?? [], agents: (frame.agents as string[]) ?? [], skills: (frame.skills as string[]) ?? [],
        plugins: Array.isArray(frame.plugins) ? (frame.plugins as unknown[]).map(rec).map((p) => ({ name: str(p.name) ?? '', source: str(p.source) ?? '' })) : [],
        mcpServers: Array.isArray(frame.mcp_servers) ? frame.mcp_servers : [], capabilities: (frame.capabilities as string[]) ?? [], engineVersion: str(frame.claude_code_version) ?? '', outputStyle: str(frame.output_style),
      });
      if (!turn.open && !turn.pendingEcho) {
        put('turn.started', { userMessageUuid: null, origin: 'engine' });
        turn.open = true;
      }
      return;
    }
    case 'task_started': {
      const taskType = str(frame.task_type) ?? 'local_agent';
      tasks.set(taskId, { taskType, workflowName: str(frame.workflow_name) });
      if (toolUseId) agentByToolUse.set(toolUseId, taskId);
      if (taskType === 'local_agent') {
        put('subagent.started', { taskId, toolUseId, description: str(frame.description) ?? '', subagentType: str(frame.subagent_type), isBackground: bool(frame.is_backgrounded), spawnDepth: num(frame.spawn_depth) ?? 0, prompt: str(frame.prompt) });
      } else {
        put('task.started', { taskId, toolUseId, taskType, description: str(frame.description) ?? '', isBackground: bool(frame.is_backgrounded), workflowName: str(frame.workflow_name) });
      }
      return;
    }
    case 'task_progress': {
      const task = tasks.get(taskId);
      if (Array.isArray(frame.workflow_progress)) put('workflow.progress', { taskId, workflowName: task?.workflowName ?? null, progress: frame.workflow_progress });
      else if (!task || task.taskType === 'local_agent') {
        const usage = rec(frame.usage);
        put('subagent.progress', { taskId, description: str(frame.description) ?? '', usage: { totalTokens: num(usage.total_tokens) ?? 0, toolUses: num(usage.tool_uses) ?? 0, durationMs: num(usage.duration_ms) ?? 0 }, lastToolName: str(frame.last_tool_name), summary: str(frame.summary) });
      }
      return;
    }
    case 'task_updated': {
      const patch = rec(frame.patch);
      put('task.updated', {
        taskId, patch: {
          ...(str(patch.status) !== null ? { status: str(patch.status)! } : {}), ...(str(patch.description) !== null ? { description: str(patch.description)! } : {}),
          ...(num(patch.end_time) !== null ? { endTime: num(patch.end_time)! } : {}), ...(str(patch.error) !== null ? { error: str(patch.error)! } : {}),
          ...(typeof patch.is_backgrounded === 'boolean' ? { isBackground: patch.is_backgrounded } : {}),
        },
      });
      return;
    }
    case 'task_notification': {
      const task = tasks.get(taskId);
      const status = (TASK_OUTCOMES.has(str(frame.status) ?? '') ? frame.status : 'completed') as 'completed' | 'failed' | 'stopped';
      if (!task || task.taskType === 'local_agent') put('subagent.finished', { taskId, status, summary: str(frame.summary), outputFile: str(frame.output_file), reason: str(frame.reason) });
      else put('task.notification', { taskId, toolUseId, status, summary: str(frame.summary) ?? '', outputFile: str(frame.output_file), reason: str(frame.reason) });
      return;
    }
    case 'hook_started':
      put('hook.started', { hookId: str(frame.hook_id) ?? '', hookName: str(frame.hook_name) ?? '', hookEvent: str(frame.hook_event) ?? '' });
      return;
    case 'hook_response':
      put('hook.finished', {
        hookId: str(frame.hook_id) ?? '', hookName: str(frame.hook_name) ?? '', hookEvent: str(frame.hook_event) ?? '', outcome: (str(frame.outcome) ?? 'success') as 'success' | 'error' | 'cancelled',
        exitCode: num(frame.exit_code), stdout: str(frame.stdout) ?? str(frame.output) ?? '', stderr: str(frame.stderr) ?? '',
      });
      return;
    case 'compact_boundary': {
      const meta = rec(frame.compact_metadata);
      put('boundary.compaction', { trigger: str(meta.trigger) ?? 'auto', preTokens: num(meta.pre_tokens) ?? 0, postTokens: num(meta.post_tokens), logicalParentUuid: str(frame.logical_parent_uuid) as MessageUuid | null, historical: bool(frame.historical) });
      return;
    }
    case 'api_retry':
      put('api.retry', { attempt: num(frame.attempt) ?? 0, maxRetries: num(frame.max_retries) ?? 0, retryDelayMs: num(frame.retry_delay_ms) ?? 0, errorStatus: num(frame.error_status), error: str(frame.error) ?? '' });
      return;
    case 'model_refusal_fallback':
      put('boundary.retraction', { retractedMessageUuids: Array.isArray(frame.retracted_message_uuids) ? (frame.retracted_message_uuids as MessageUuid[]) : [], reason: str(frame.content) ?? 'refusal', fallbackModel: str(frame.fallback_model) });
      return;
    case 'informational':
      put('notice.posted', { level: (NOTICE_LEVELS.has(str(frame.level) ?? '') ? frame.level : 'info') as 'info', text: str(frame.content) ?? '', key: null });
      return;
    case 'notification':
      put('notice.posted', { level: 'notice', text: str(frame.text) ?? '', key: str(frame.key) });
      return;
    case 'session_state_changed':
      put('session.state', { state: frame.state as 'idle' | 'running' | 'requires_action' });
      return;
    case 'commands_changed':
      put('session.commands', { commands: Array.isArray(frame.commands) ? (frame.commands as unknown[]).map(rec).map((c) => ({ name: str(c.name) ?? '', description: str(c.description) ?? '', argumentHint: str(c.argumentHint), builtin: bool(c.builtin) })) : [] });
      return;
    case 'background_tasks_changed':
      put('tasks.snapshot', { tasks: Array.isArray(frame.tasks) ? (frame.tasks as unknown[]).map(rec).map((t) => ({ taskId: (str(t.task_id) ?? '') as TaskId, taskType: str(t.task_type) ?? '', description: str(t.description) ?? '', ambient: bool(t.ambient) })) : [] });
      return;
    case 'status': case 'thinking_tokens': case 'hook_progress': case 'elicitation_complete': case 'peer_message_hold': case 'permission_denied': case 'model_refusal_no_fallback':
      return; // known subtypes the transcript does not render
    default:
      put('frame.unknown', { frameType: 'system', subtype: str(frame.subtype) });
  }
  void row;
}
