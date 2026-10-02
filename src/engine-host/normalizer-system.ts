// The `system` half of the normaliser's mapping table (C3 execution document, Interfaces "Normaliser"): one parsed
// `system` frame to its X1 payloads. Subtypes observed in the fixtures: init (handled by the class: it touches turn
// state), status, thinking_tokens, background_tasks_changed, task_started, task_progress, task_updated,
// task_notification, hook_started, hook_response, commands_changed; the rest follow C1's typed frames and the table.
// R1: the remote-surface pushes (ui_toast, ui_status, ui_log, ui_invalidate; pass3/mods-*) map to `plugin.*`, and
// init's plugin load errors and warnings to `plugin.load_issue` (`pluginLoadIssues`, called by the class's init).
// C1's `SystemFrame` union carries the loose `UnknownSystemFrame` (`subtype: string`), so a switch on `subtype` does
// not narrow; each case names its frame type explicitly (the frame was parsed with that schema by `parseStdoutFrame`).
import type { AgentId, MessageUuid, TaskId, ToolUseId } from '@shared/graph/ids';
import type { EventPayload } from '@shared/graph/events';
import type {
  SystemApiRetryFrame,
  SystemBackgroundTasksChangedFrame,
  SystemCommandsChangedFrame,
  SystemCompactBoundaryFrame,
  SystemFrame,
  SystemHookResponseFrame,
  SystemHookStartedFrame,
  SystemInformationalFrame,
  SystemModelRefusalFallbackFrame,
  SystemModelRefusalNoFallbackFrame,
  SystemNotificationFrame,
  SystemPermissionDeniedFrame,
  SystemSessionStateChangedFrame,
  SystemTaskNotificationFrame,
  SystemTaskProgressFrame,
  SystemTaskStartedFrame,
  SystemTaskUpdatedFrame,
  SystemInitFrame,
  SystemUiInvalidateFrame,
  SystemUiLogFrame,
  SystemUiStatusFrame,
  SystemUiToastFrame,
} from '@shared/wire/frames';
import { taskUsageOf, boolOr, compact, stringOrNull } from './normalizer-support';

// What the task frames share across a session: the type each task was started with (a `task_notification` carries
// none), the workflow name, and the tool use → agent map child frames are attributed through.
export interface TaskRegistry {
  taskTypes: Map<string, string>;
  workflowNames: Map<string, string>;
  toolUseToAgent: Map<ToolUseId, AgentId>;
}

export interface SystemMapping {
  payloads: EventPayload[];
  agentId: AgentId | null; // the child a task frame concerns, when known
}

const none: SystemMapping = { payloads: [], agentId: null };
const one = (payload: EventPayload, agentId: AgentId | null = null): SystemMapping => ({ payloads: [payload], agentId });
const asTaskId = (id: string) => id as TaskId;
const emptyToNull = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

// R1: how long the engine would show a toast whose frame names no time (its documented default, 2.1.287).
export const ENGINE_TOAST_TIMEOUT_MS = 4000;

// R1: init's plugin load errors, then its warnings, one `plugin.load_issue` each, in the frame's order.
export function pluginLoadIssues(frame: SystemInitFrame): EventPayload[] {
  return [
    ...(frame.plugin_errors ?? []).map((e): EventPayload => ({ kind: 'plugin.load_issue', plugin: e.plugin, level: 'error', message: e.message })),
    ...(frame.plugin_warnings ?? []).map((w): EventPayload => ({ kind: 'plugin.load_issue', plugin: w.plugin, level: 'warning', message: w.message })),
  ];
}

export function mapSystemFrame(frame: SystemFrame, tasks: TaskRegistry): SystemMapping {
  switch (frame.subtype) {
    case 'session_state_changed': {
      const f = frame as SystemSessionStateChangedFrame;
      return one({ kind: 'session.state', state: f.state });
    }
    case 'commands_changed': {
      const f = frame as SystemCommandsChangedFrame;
      return one({ kind: 'session.commands', commands: f.commands.map((c) => ({ name: c.name, description: c.description, argumentHint: c.argumentHint ?? null, builtin: c.builtin ?? false })) });
    }
    case 'compact_boundary': {
      const f = frame as SystemCompactBoundaryFrame;
      return one({
        kind: 'boundary.compaction', trigger: f.compact_metadata.trigger, preTokens: f.compact_metadata.pre_tokens, postTokens: f.compact_metadata.post_tokens ?? null,
        logicalParentUuid: (f.logical_parent_uuid ?? null) as MessageUuid | null, historical: f.historical ?? false,
      });
    }
    case 'model_refusal_fallback': {
      const f = frame as SystemModelRefusalFallbackFrame;
      return one({ kind: 'boundary.retraction', retractedMessageUuids: (f.retracted_message_uuids ?? []) as MessageUuid[], reason: f.content ?? 'model refusal', fallbackModel: f.fallback_model });
    }
    case 'model_refusal_no_fallback': {
      const f = frame as SystemModelRefusalNoFallbackFrame;
      return one({ kind: 'boundary.retraction', retractedMessageUuids: [], reason: f.content ?? 'model refusal', fallbackModel: null });
    }
    case 'api_retry': {
      const f = frame as SystemApiRetryFrame;
      return one({ kind: 'api.retry', attempt: f.attempt, maxRetries: f.max_retries, retryDelayMs: f.retry_delay_ms, errorStatus: f.error_status ?? null, error: f.error });
    }
    case 'informational': {
      const f = frame as SystemInformationalFrame;
      return one({ kind: 'notice.posted', level: f.level ?? 'info', text: f.content, key: null });
    }
    case 'notification': {
      const f = frame as SystemNotificationFrame;
      return one({ kind: 'notice.posted', level: f.priority === 'high' ? 'warning' : 'info', text: f.text, key: f.key });
    }
    case 'permission_denied': {
      const f = frame as SystemPermissionDeniedFrame;
      return one({ kind: 'notice.posted', level: 'info', text: f.message ?? `${f.tool_name} denied`, key: `permission_denied:${f.tool_use_id}` }, (f.agent_id ?? null) as AgentId | null);
    }
    case 'hook_started': {
      const f = frame as SystemHookStartedFrame;
      return one({ kind: 'hook.started', hookId: f.hook_id, hookName: f.hook_name, hookEvent: f.hook_event });
    }
    case 'hook_response': {
      const f = frame as SystemHookResponseFrame;
      return one({ kind: 'hook.finished', hookId: f.hook_id, hookName: f.hook_name, hookEvent: f.hook_event, outcome: f.outcome, exitCode: f.exit_code ?? null, stdout: f.stdout ?? '', stderr: f.stderr ?? '' });
    }
    case 'task_started': {
      const f = frame as SystemTaskStartedFrame;
      const taskType = f.task_type ?? 'unknown';
      tasks.taskTypes.set(f.task_id, taskType);
      if (f.workflow_name) tasks.workflowNames.set(f.task_id, f.workflow_name);
      const toolUseId = (f.tool_use_id ?? null) as ToolUseId | null;
      if (taskType === 'local_agent') {
        if (toolUseId && !tasks.toolUseToAgent.has(toolUseId)) tasks.toolUseToAgent.set(toolUseId, f.task_id as AgentId);
        return one({
          kind: 'subagent.started', taskId: asTaskId(f.task_id), toolUseId, description: f.description, subagentType: f.subagent_type ?? null,
          isBackground: f.is_backgrounded ?? false, spawnDepth: f.spawn_depth ?? 0, prompt: f.prompt ?? null,
        }, f.task_id as AgentId);
      }
      return one({ kind: 'task.started', taskId: asTaskId(f.task_id), toolUseId, taskType, description: f.description, isBackground: f.is_backgrounded ?? false, workflowName: f.workflow_name ?? null });
    }
    case 'task_progress': {
      const f = frame as SystemTaskProgressFrame;
      const payloads: EventPayload[] = [];
      const local = tasks.taskTypes.get(f.task_id) === 'local_agent';
      if (local) {
        payloads.push({
          kind: 'subagent.progress', taskId: asTaskId(f.task_id), description: f.description,
          usage: { totalTokens: f.usage.total_tokens, toolUses: f.usage.tool_uses, durationMs: f.usage.duration_ms },
          lastToolName: f.last_tool_name ?? null, summary: f.summary ?? null,
        });
      }
      if (f.workflow_progress) payloads.push({ kind: 'workflow.progress', taskId: asTaskId(f.task_id), workflowName: tasks.workflowNames.get(f.task_id) ?? null, progress: f.workflow_progress });
      return { payloads, agentId: local ? (f.task_id as AgentId) : null };
    }
    case 'task_updated': {
      const f = frame as SystemTaskUpdatedFrame;
      return one(
        { kind: 'task.updated', taskId: asTaskId(f.task_id), patch: compact({ status: f.patch.status, description: f.patch.description, endTime: f.patch.end_time, error: f.patch.error, isBackground: f.patch.is_backgrounded }) },
        tasks.taskTypes.get(f.task_id) === 'local_agent' ? (f.task_id as AgentId) : null,
      );
    }
    case 'task_notification': {
      const f = frame as SystemTaskNotificationFrame;
      const outputFile = emptyToNull(f.output_file);
      if (tasks.taskTypes.get(f.task_id) === 'local_agent') {
        return one(compact({ kind: 'subagent.finished', taskId: asTaskId(f.task_id), status: f.status, summary: f.summary, outputFile, reason: f.reason ?? null, usage: taskUsageOf(f.usage) }), f.task_id as AgentId);
      }
      return one({ kind: 'task.notification', taskId: asTaskId(f.task_id), toolUseId: (f.tool_use_id ?? null) as ToolUseId | null, status: f.status, summary: f.summary, outputFile, reason: f.reason ?? null });
    }
    case 'background_tasks_changed': {
      const f = frame as SystemBackgroundTasksChangedFrame;
      return one({ kind: 'tasks.snapshot', tasks: f.tasks.map((t) => ({ taskId: asTaskId(t.task_id), taskType: t.task_type, description: t.description, ambient: boolOr(t.ambient, false) })) });
    }
    case 'ui_toast': { // R1
      const f = frame as SystemUiToastFrame;
      return one({ kind: 'plugin.toast', plugin: f.plugin, text: f.text, timeoutMs: f.timeout_ms ?? ENGINE_TOAST_TIMEOUT_MS });
    }
    case 'ui_status': { // R1: the wire's null (a removal) is ''
      const f = frame as SystemUiStatusFrame;
      return one({ kind: 'plugin.status', plugin: f.plugin, text: f.text ?? '' });
    }
    case 'ui_log': { // R1
      const f = frame as SystemUiLogFrame;
      return one({ kind: 'plugin.log', plugin: f.plugin, text: f.text });
    }
    case 'ui_invalidate': { // R1: carried for R2's surface, which re-asks the trees it drew
      const f = frame as SystemUiInvalidateFrame;
      return one({ kind: 'plugin.invalidate', event: f.event ?? null });
    }
    // Journaled, no event, no consumer in P0 (the process table reads status and peer holds from the frames themselves).
    case 'status':
    case 'thinking_tokens':
    case 'hook_progress':
    case 'peer_message_hold':
    case 'elicitation_complete':
    case 'local_command_output': // untyped by C1 (parses as UnknownSystemFrame); the table lists it as none
      return none;
    case 'init':
      throw new Error('system/init is mapped by the Normalizer (it touches turn state)');
    default:
      return one({ kind: 'frame.unknown', frameType: 'system', subtype: stringOrNull(frame.subtype) });
  }
}
