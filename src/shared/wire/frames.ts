// X1 wire frames (charter §4.2 and §13 X1; C1 execution document, Interfaces "X1 — wire frames"): the shapes the engine
// emits on stdout (`in`) and accepts on stdin (`out`), as loose objects so unknown keys are retained and never dropped.
//
// Validation is dispatch by table, not one zod union: `parseStdoutFrame` reads `type`, parses the whole frame with
// STDOUT_FRAME_SCHEMAS[type], and for `system` frames parses with SYSTEM_SUBTYPE_SCHEMAS[subtype]; the loose schemas
// apply only to discriminators absent from the tables. So an unknown frame type or system subtype is accepted and
// retained (surfaced as `frame.unknown`), while a known one that fails its own schema is rejected, never demoted to the
// loose shape. Required fields are a lower bound: those every fixture frame of the type carries across both probe passes
// and consumers depend on; everything else is optional and retained. Subtypes the fixtures never captured are typed from
// `research/sdk-wire-gap.md` §1.2 with the same lower-bound rule.
import * as z from 'zod';
import { COMMAND_LIFECYCLE_STATES } from '../graph/enums';
import { ContentBlockSchema } from '../graph/events';
import { ControlErrorResponseSchema, UiPaneWireSchema } from './control';

// ---------------------------------------------------------------------------------------------------------------------
// Loose fallbacks

export const UnknownFrameSchema = z.looseObject({ type: z.string() }); // accepted, journaled, surfaced as frame.unknown
export type UnknownFrame = z.infer<typeof UnknownFrameSchema>;

// Fallback for a `system` subtype absent from SYSTEM_SUBTYPE_SCHEMAS. The envelope is optional because at least one
// unpublished subtype (`turn_starting`) travels without it (§1.2).
export const UnknownSystemFrameSchema = z.looseObject({
  type: z.literal('system'),
  subtype: z.string(),
  session_id: z.string().optional(),
  uuid: z.string().optional(),
});
export type UnknownSystemFrame = z.infer<typeof UnknownSystemFrameSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// System subtypes. Present in the fixtures (both passes): init, status, thinking_tokens, background_tasks_changed,
// task_started, task_progress, task_updated, task_notification, hook_started, hook_response, commands_changed.
// The rest are typed from research/sdk-wire-gap.md §1.2, except the remote-surface pushes (R1), typed from pass 3.

const systemFrame = <S extends string, T extends z.ZodRawShape>(subtype: S, shape: T) =>
  UnknownSystemFrameSchema.extend({ subtype: z.literal(subtype), ...shape });

export const SystemInitFrameSchema = systemFrame('init', {
  cwd: z.string(),
  session_id: z.string(),
  model: z.string(),
  permissionMode: z.string(),
  tools: z.array(z.string()),
  slash_commands: z.array(z.string()),
  agents: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  plugins: z.array(z.looseObject({ name: z.string(), source: z.string() })).optional(),
  mcp_servers: z.array(z.unknown()),
  capabilities: z.array(z.string()).optional(),
  claude_code_version: z.string(),
  output_style: z.string().optional(),
  // R1: plugin load errors and warnings (absent on 2.1.283 when there are none, null on 2.1.287); the engine's schema
  // names `plugin`, `type` and `message` on each, `path` on an error of a directory entry that did not load at all
  plugin_errors: z.array(z.looseObject({ plugin: z.string(), message: z.string(), type: z.string().optional() })).nullable().optional(),
  plugin_warnings: z.array(z.looseObject({ plugin: z.string(), message: z.string(), type: z.string().optional() })).nullable().optional(),
});
export type SystemInitFrame = z.infer<typeof SystemInitFrameSchema>;

export const SystemStatusFrameSchema = systemFrame('status', { status: z.string().nullable(), permissionMode: z.string().optional() });
export type SystemStatusFrame = z.infer<typeof SystemStatusFrameSchema>;

export const SystemCompactBoundaryFrameSchema = systemFrame('compact_boundary', {
  compact_metadata: z.looseObject({ trigger: z.string(), pre_tokens: z.number(), post_tokens: z.number().optional() }),
  logical_parent_uuid: z.string().optional(),
  historical: z.boolean().optional(),
});
export type SystemCompactBoundaryFrame = z.infer<typeof SystemCompactBoundaryFrameSchema>;

export const SystemApiRetryFrameSchema = systemFrame('api_retry', {
  attempt: z.number(),
  max_retries: z.number(),
  retry_delay_ms: z.number(),
  error_status: z.number().nullable().optional(),
  error: z.string(),
});
export type SystemApiRetryFrame = z.infer<typeof SystemApiRetryFrameSchema>;

export const SystemInformationalFrameSchema = systemFrame('informational', {
  content: z.string(),
  level: z.enum(['info', 'notice', 'suggestion', 'warning']).optional(),
  tool_use_id: z.string().optional(),
  prevent_continuation: z.boolean().optional(),
});
export type SystemInformationalFrame = z.infer<typeof SystemInformationalFrameSchema>;

export const SystemTaskStartedFrameSchema = systemFrame('task_started', {
  task_id: z.string(),
  tool_use_id: z.string().optional(),
  description: z.string(),
  subagent_type: z.string().optional(),
  is_backgrounded: z.boolean().optional(),
  spawn_depth: z.number().optional(),
  task_type: z.string().optional(),
  workflow_name: z.string().optional(),
  prompt: z.string().optional(),
});
export type SystemTaskStartedFrame = z.infer<typeof SystemTaskStartedFrameSchema>;

export const SystemTaskUpdatedFrameSchema = systemFrame('task_updated', {
  task_id: z.string(),
  patch: z.looseObject({
    status: z.string().optional(),
    description: z.string().optional(),
    end_time: z.number().optional(),
    error: z.string().optional(),
    is_backgrounded: z.boolean().optional(),
  }),
});
export type SystemTaskUpdatedFrame = z.infer<typeof SystemTaskUpdatedFrameSchema>;

export const SystemTaskProgressFrameSchema = systemFrame('task_progress', {
  task_id: z.string(),
  tool_use_id: z.string().optional(),
  description: z.string(),
  subagent_type: z.string().optional(),
  usage: z.looseObject({ total_tokens: z.number(), tool_uses: z.number(), duration_ms: z.number() }),
  last_tool_name: z.string().optional(),
  summary: z.string().optional(),
  workflow_progress: z.array(z.unknown()).optional(), // runtime extension carrying workflow phases and agents
});
export type SystemTaskProgressFrame = z.infer<typeof SystemTaskProgressFrameSchema>;

export const SystemTaskNotificationFrameSchema = systemFrame('task_notification', {
  task_id: z.string(),
  tool_use_id: z.string().optional(),
  status: z.enum(['completed', 'failed', 'stopped']),
  reason: z.string().optional(),
  output_file: z.string().nullable().optional(),
  summary: z.string(),
  usage: z.unknown().optional(),
});
export type SystemTaskNotificationFrame = z.infer<typeof SystemTaskNotificationFrameSchema>;

export const SystemBackgroundTasksChangedFrameSchema = systemFrame('background_tasks_changed', {
  tasks: z.array(z.looseObject({ task_id: z.string(), task_type: z.string(), description: z.string(), ambient: z.boolean().optional() })),
});
export type SystemBackgroundTasksChangedFrame = z.infer<typeof SystemBackgroundTasksChangedFrameSchema>;

export const SystemSessionStateChangedFrameSchema = systemFrame('session_state_changed', { state: z.enum(['idle', 'running', 'requires_action']) });
export type SystemSessionStateChangedFrame = z.infer<typeof SystemSessionStateChangedFrameSchema>;

export const SystemThinkingTokensFrameSchema = systemFrame('thinking_tokens', {
  estimated_tokens: z.number(),
  estimated_tokens_delta: z.number(),
  user_message_uuid: z.string().optional(),
});
export type SystemThinkingTokensFrame = z.infer<typeof SystemThinkingTokensFrameSchema>;

export const SystemCommandsChangedFrameSchema = systemFrame('commands_changed', {
  commands: z.array(z.looseObject({ name: z.string(), description: z.string(), argumentHint: z.string().optional(), builtin: z.boolean().optional() })),
});
export type SystemCommandsChangedFrame = z.infer<typeof SystemCommandsChangedFrameSchema>;

const hookIdentity = { hook_id: z.string(), hook_name: z.string(), hook_event: z.string() };

export const SystemHookStartedFrameSchema = systemFrame('hook_started', hookIdentity);
export type SystemHookStartedFrame = z.infer<typeof SystemHookStartedFrameSchema>;

export const SystemHookProgressFrameSchema = systemFrame('hook_progress', {
  ...hookIdentity,
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  output: z.string().optional(),
});
export type SystemHookProgressFrame = z.infer<typeof SystemHookProgressFrameSchema>;

export const SystemHookResponseFrameSchema = systemFrame('hook_response', {
  ...hookIdentity,
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  output: z.string().optional(),
  exit_code: z.number().nullable().optional(),
  outcome: z.enum(['success', 'error', 'cancelled']),
});
export type SystemHookResponseFrame = z.infer<typeof SystemHookResponseFrameSchema>;

export const SystemModelRefusalFallbackFrameSchema = systemFrame('model_refusal_fallback', {
  direction: z.string().optional(),
  scope: z.string().optional(),
  original_model: z.string(),
  fallback_model: z.string(),
  request_id: z.string().optional(),
  content: z.string().optional(),
  retracted_message_uuids: z.array(z.string()).optional(),
});
export type SystemModelRefusalFallbackFrame = z.infer<typeof SystemModelRefusalFallbackFrameSchema>;

export const SystemModelRefusalNoFallbackFrameSchema = systemFrame('model_refusal_no_fallback', {
  original_model: z.string(),
  request_id: z.string().optional(),
  content: z.string().optional(),
});
export type SystemModelRefusalNoFallbackFrame = z.infer<typeof SystemModelRefusalNoFallbackFrameSchema>;

export const SystemNotificationFrameSchema = systemFrame('notification', {
  key: z.string(),
  text: z.string(),
  priority: z.string().optional(),
  color: z.string().optional(),
  timeout_ms: z.number().optional(),
});
export type SystemNotificationFrame = z.infer<typeof SystemNotificationFrameSchema>;

export const SystemPermissionDeniedFrameSchema = systemFrame('permission_denied', {
  tool_name: z.string(),
  tool_use_id: z.string(),
  agent_id: z.string().optional(),
  decision_reason_type: z.string().optional(),
  decision_reason_code: z.string().optional(),
  decision_reason: z.string().optional(),
  message: z.string().optional(),
});
export type SystemPermissionDeniedFrame = z.infer<typeof SystemPermissionDeniedFrameSchema>;

export const SystemPeerMessageHoldFrameSchema = systemFrame('peer_message_hold', {
  state: z.enum(['held', 'released', 'dropped']),
  message_uuid: z.string().optional(),
  lane: z.string().optional(),
  from: z.string().optional(),
  from_name: z.string().optional(),
  cause: z.string().optional(),
  outcome: z.string().optional(),
});
export type SystemPeerMessageHoldFrame = z.infer<typeof SystemPeerMessageHoldFrameSchema>;

export const SystemElicitationCompleteFrameSchema = systemFrame('elicitation_complete', { mcp_server_name: z.string(), elicitation_id: z.string() });
export type SystemElicitationCompleteFrame = z.infer<typeof SystemElicitationCompleteFrameSchema>;

// R1 (charter D-9 as amended 2026-10-01): the engine's remote-surface pushes (2.1.285 onward), fire-and-forget frames a
// headless session sends with no `ui_attach` for a plugin's `$.ui.toast`, `$.ui.status` and `$.ui.log`, and when a
// drawn tree may be stale. Typed from pass3/mods-* (2.1.287) and the engine's schema text: `plugin` is the registry name
// the hooks engine knows (never plugin-settable); `text` is plain text of at most 4096 characters, drawn as a text node;
// a toast's `timeout_ms` is the plugin's or the engine's default (4000); a status replaces the plugin's one pinned line
// and null removes it (no fixture records the removal, so the key may be absent too); an invalidate names the render
// event (`ui.render`), never a plugin.
export const SystemUiToastFrameSchema = systemFrame('ui_toast', { plugin: z.string(), text: z.string(), timeout_ms: z.number().optional() });
export type SystemUiToastFrame = z.infer<typeof SystemUiToastFrameSchema>;

export const SystemUiStatusFrameSchema = systemFrame('ui_status', { plugin: z.string(), text: z.string().nullable().optional() });
export type SystemUiStatusFrame = z.infer<typeof SystemUiStatusFrameSchema>;

export const SystemUiLogFrameSchema = systemFrame('ui_log', { plugin: z.string(), text: z.string() });
export type SystemUiLogFrame = z.infer<typeof SystemUiLogFrameSchema>;

export const SystemUiInvalidateFrameSchema = systemFrame('ui_invalidate', { event: z.string().optional() });
export type SystemUiInvalidateFrame = z.infer<typeof SystemUiInvalidateFrameSchema>;

// R2: the pushes a remote surface gets once attached (pass3/mods-surface-*, 2.1.287): the pane roster whenever it
// changes (a plugin opened, retitled or closed a pane, the person showed, focused or closed one, a placing client
// attached), and a plugin's own moves of a site's window (`$.ui.scroll`) and focus ring (`$.ui.focus`); the person's
// own moves are never pushed back.
export const SystemUiPanesFrameSchema = systemFrame('ui_panes', {
  panes: z.array(UiPaneWireSchema),
  shown_id: z.string().nullish(), focused_id: z.string().nullish(), focus_requested_id: z.string().nullish(),
});
export type SystemUiPanesFrame = z.infer<typeof SystemUiPanesFrameSchema>;

// `{client_id, component, instance_id, offset}`, and the same with `follow_end: true` while the window follows its end
// (pass3/mods-surface-panes seq 53, 54)
export const SystemUiScrollFrameSchema = systemFrame('ui_scroll', { client_id: z.string().optional(), component: z.string(), instance_id: z.string(), offset: z.number().int(), follow_end: z.boolean().optional() });
export type SystemUiScrollFrame = z.infer<typeof SystemUiScrollFrameSchema>;

// `{client_id, component, instance_id, plugin, key}`: the element (a Button, Input or Select by its `press.plugin` and
// `props.key`) to take the ring (pass3/mods-surface-panes seq 44)
export const SystemUiFocusFrameSchema = systemFrame('ui_focus', { client_id: z.string().optional(), component: z.string(), instance_id: z.string(), plugin: z.string(), key: z.string() });
export type SystemUiFocusFrame = z.infer<typeof SystemUiFocusFrameSchema>;

// The validator for every `system` frame: one entry per typed subtype; a subtype absent here parses as UnknownSystemFrame.
export const SYSTEM_SUBTYPE_SCHEMAS: Readonly<Record<string, z.ZodType>> = Object.freeze({
  init: SystemInitFrameSchema,
  status: SystemStatusFrameSchema,
  compact_boundary: SystemCompactBoundaryFrameSchema,
  api_retry: SystemApiRetryFrameSchema,
  informational: SystemInformationalFrameSchema,
  task_started: SystemTaskStartedFrameSchema,
  task_updated: SystemTaskUpdatedFrameSchema,
  task_progress: SystemTaskProgressFrameSchema,
  task_notification: SystemTaskNotificationFrameSchema,
  background_tasks_changed: SystemBackgroundTasksChangedFrameSchema,
  session_state_changed: SystemSessionStateChangedFrameSchema,
  thinking_tokens: SystemThinkingTokensFrameSchema,
  commands_changed: SystemCommandsChangedFrameSchema,
  hook_started: SystemHookStartedFrameSchema,
  hook_progress: SystemHookProgressFrameSchema,
  hook_response: SystemHookResponseFrameSchema,
  model_refusal_fallback: SystemModelRefusalFallbackFrameSchema,
  model_refusal_no_fallback: SystemModelRefusalNoFallbackFrameSchema,
  notification: SystemNotificationFrameSchema,
  permission_denied: SystemPermissionDeniedFrameSchema,
  peer_message_hold: SystemPeerMessageHoldFrameSchema,
  elicitation_complete: SystemElicitationCompleteFrameSchema,
  ui_toast: SystemUiToastFrameSchema, // R1
  ui_status: SystemUiStatusFrameSchema, // R1
  ui_log: SystemUiLogFrameSchema, // R1
  ui_invalidate: SystemUiInvalidateFrameSchema, // R1
  ui_panes: SystemUiPanesFrameSchema, // R2
  ui_scroll: SystemUiScrollFrameSchema, // R2
  ui_focus: SystemUiFocusFrameSchema, // R2
});

export type SystemFrame =
  | SystemInitFrame | SystemStatusFrame | SystemCompactBoundaryFrame | SystemApiRetryFrame | SystemInformationalFrame
  | SystemTaskStartedFrame | SystemTaskUpdatedFrame | SystemTaskProgressFrame | SystemTaskNotificationFrame
  | SystemBackgroundTasksChangedFrame | SystemSessionStateChangedFrame | SystemThinkingTokensFrame | SystemCommandsChangedFrame
  | SystemHookStartedFrame | SystemHookProgressFrame | SystemHookResponseFrame
  | SystemModelRefusalFallbackFrame | SystemModelRefusalNoFallbackFrame | SystemNotificationFrame | SystemPermissionDeniedFrame
  | SystemPeerMessageHoldFrame | SystemElicitationCompleteFrame
  | SystemUiToastFrame | SystemUiStatusFrame | SystemUiLogFrame | SystemUiInvalidateFrame // R1
  | SystemUiPanesFrame | SystemUiScrollFrame | SystemUiFocusFrame // R2
  | UnknownSystemFrame;

// Table lookup that ignores inherited keys, so a frame typed `constructor` or `toString` is unknown, not a prototype method.
function lookup(table: Readonly<Record<string, z.ZodType>>, key: string): z.ZodType | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

// The `system` entry of STDOUT_FRAME_SCHEMAS: the same subtype dispatch as parseStdoutFrame, as one zod schema, so that
// no exported schema accepts a malformed known subtype. Issues from the subtype's schema are reported at their own paths.
const SystemFrameDispatchSchema: z.ZodType<SystemFrame> = UnknownSystemFrameSchema.superRefine((frame, ctx) => {
  const schema = lookup(SYSTEM_SUBTYPE_SCHEMAS, frame.subtype);
  if (!schema) return;
  const result = schema.safeParse(frame);
  if (!result.success) for (const issue of result.error.issues) ctx.addIssue(issue as z.core.$ZodRawIssue);
});

// ---------------------------------------------------------------------------------------------------------------------
// Stdout (`in`) frames other than `system`

export const AssistantFrameSchema = z.looseObject({
  type: z.literal('assistant'),
  message: z.looseObject({ id: z.string(), role: z.literal('assistant'), content: z.array(ContentBlockSchema), model: z.string() }),
  parent_tool_use_id: z.string().nullable(),
  session_id: z.string(),
  uuid: z.string(),
});
export type AssistantFrame = z.infer<typeof AssistantFrameSchema>;

export const UserFrameSchema = z.looseObject({
  type: z.literal('user'),
  message: z.looseObject({ role: z.literal('user'), content: z.union([z.string(), z.array(ContentBlockSchema)]) }),
  parent_tool_use_id: z.string().nullable().optional(),
  session_id: z.string().optional(),
  uuid: z.string().optional(),
  isReplay: z.boolean().optional(),
  isSynthetic: z.boolean().optional(),
  origin: z.looseObject({ kind: z.string() }).optional(),
  tool_use_result: z.unknown().optional(),
  tool_result_meta: z.array(z.looseObject({ id: z.string(), non_execution_kind: z.string().optional() })).optional(),
});
export type UserFrame = z.infer<typeof UserFrameSchema>;

export const ResultFrameSchema = z.looseObject({
  type: z.literal('result'),
  subtype: z.string(),
  session_id: z.string(),
  is_error: z.boolean(),
  duration_ms: z.number(),
  num_turns: z.number(),
  total_cost_usd: z.number(),
  usage: z.record(z.string(), z.unknown()),
  permission_denials: z.array(z.unknown()),
});
export type ResultFrame = z.infer<typeof ResultFrameSchema>;

export const StreamEventFrameSchema = z.looseObject({
  type: z.literal('stream_event'),
  event: z.looseObject({ type: z.string() }),
  session_id: z.string(),
  parent_tool_use_id: z.string().nullable(),
  uuid: z.string(),
});
export type StreamEventFrame = z.infer<typeof StreamEventFrameSchema>;

// `event.type === 'message_delta'` may carry `delta.safeguard_results`, loose beyond `status.tool_uses[id].outcome`.
export const SafeguardResultSchema = z.looseObject({
  type: z.string(),
  status: z.looseObject({
    type: z.string(),
    tool_uses: z.record(z.string(), z.looseObject({ type: z.string(), outcome: z.string().optional() })).optional(),
  }),
});
export type SafeguardResult = z.infer<typeof SafeguardResultSchema>;

export const ToolProgressFrameSchema = z.looseObject({
  type: z.literal('tool_progress'),
  tool_use_id: z.string(),
  tool_name: z.string(),
  parent_tool_use_id: z.string().nullable().optional(),
  elapsed_time_seconds: z.number(),
  task_id: z.string().optional(),
  heartbeat: z.boolean().optional(),
});
export type ToolProgressFrame = z.infer<typeof ToolProgressFrameSchema>;

export const ToolUseSummaryFrameSchema = z.looseObject({
  type: z.literal('tool_use_summary'),
  summary: z.string(),
  preceding_tool_use_ids: z.array(z.string()),
  timestamp: z.string().optional(),
});
export type ToolUseSummaryFrame = z.infer<typeof ToolUseSummaryFrameSchema>;

export const RateLimitEventFrameSchema = z.looseObject({ type: z.literal('rate_limit_event'), rate_limit_info: z.looseObject({}) });
export type RateLimitEventFrame = z.infer<typeof RateLimitEventFrameSchema>;

export const PromptSuggestionFrameSchema = z.looseObject({ type: z.literal('prompt_suggestion'), suggestion: z.string() });
export type PromptSuggestionFrame = z.infer<typeof PromptSuggestionFrameSchema>;

export const AuthStatusFrameSchema = z.looseObject({
  type: z.literal('auth_status'),
  isAuthenticating: z.boolean(),
  output: z.array(z.string()),
  error: z.string().optional(),
});
export type AuthStatusFrame = z.infer<typeof AuthStatusFrameSchema>;

export const ConversationResetFrameSchema = z.looseObject({
  type: z.literal('conversation_reset'),
  new_conversation_id: z.string(),
  trigger: z.string().optional(),
  user_message_uuid: z.string().optional(),
  timestamp: z.string().optional(),
});
export type ConversationResetFrame = z.infer<typeof ConversationResetFrameSchema>;

export const CommandLifecycleFrameSchema = z.looseObject({
  type: z.literal('command_lifecycle'),
  command_uuid: z.string(),
  state: z.enum(COMMAND_LIFECYCLE_STATES),
});
export type CommandLifecycleFrame = z.infer<typeof CommandLifecycleFrameSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Control envelopes and keep-alive, travelling in both directions

export const ControlRequestFrameSchema = z.looseObject({
  type: z.literal('control_request'),
  request_id: z.string(),
  request: z.looseObject({ subtype: z.string() }),
});
export type ControlRequestFrame = z.infer<typeof ControlRequestFrameSchema>;

export const ControlResponseFrameSchema = z.looseObject({
  type: z.literal('control_response'),
  response: z.discriminatedUnion('subtype', [
    z.looseObject({ subtype: z.literal('success'), request_id: z.string(), response: z.unknown().optional() }),
    ControlErrorResponseSchema,
  ]),
});
export type ControlResponseFrame = z.infer<typeof ControlResponseFrameSchema>;

export const ControlCancelRequestFrameSchema = z.looseObject({ type: z.literal('control_cancel_request'), request_id: z.string() });
export type ControlCancelRequestFrame = z.infer<typeof ControlCancelRequestFrameSchema>;

export const KeepAliveFrameSchema = z.looseObject({ type: z.literal('keep_alive') });
export type KeepAliveFrame = z.infer<typeof KeepAliveFrameSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Stdin (`out`) frames we author

export const UserInputFrameSchema = z.looseObject({
  type: z.literal('user'),
  uuid: z.string().optional(),
  message: z.looseObject({ role: z.literal('user'), content: z.union([z.string(), z.array(ContentBlockSchema)]) }),
  parent_tool_use_id: z.null(),
  origin: z.looseObject({ kind: z.string() }).optional(),
  priority: z.enum(['now', 'next', 'later']).optional(),
  shouldQuery: z.boolean().optional(), // false appends to the conversation without starting a turn; the engine answers with an echo receipt
});
export type UserInputFrame = z.infer<typeof UserInputFrameSchema>;

export const BashCommandFrameSchema = z.looseObject({
  type: z.literal('bash_command'),
  command: z.string(),
  cwd: z.string().optional(),
  uuid: z.string().optional(),
});
export type BashCommandFrame = z.infer<typeof BashCommandFrameSchema>;

// Frames we author have no catch-all: an unknown stdin frame is a programming error, not engine drift.
const StdinFrameSchema = z.discriminatedUnion('type', [
  UserInputFrameSchema,
  BashCommandFrameSchema,
  ControlRequestFrameSchema,
  ControlResponseFrameSchema,
  ControlCancelRequestFrameSchema,
  KeepAliveFrameSchema,
]);
export type StdinFrame = z.infer<typeof StdinFrameSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Dispatch

export type StdoutFrame =
  | SystemFrame | AssistantFrame | UserFrame | ResultFrame | StreamEventFrame
  | ToolProgressFrame | ToolUseSummaryFrame | RateLimitEventFrame | PromptSuggestionFrame | AuthStatusFrame
  | ConversationResetFrame | CommandLifecycleFrame
  | ControlRequestFrame | ControlResponseFrame | ControlCancelRequestFrame | KeepAliveFrame
  | UnknownFrame;

// One entry per member of StdoutFrame except UnknownFrame; a `type` absent here parses as UnknownFrame.
export const STDOUT_FRAME_SCHEMAS: Readonly<Record<string, z.ZodType>> = Object.freeze({
  system: SystemFrameDispatchSchema,
  assistant: AssistantFrameSchema,
  user: UserFrameSchema,
  result: ResultFrameSchema,
  stream_event: StreamEventFrameSchema,
  tool_progress: ToolProgressFrameSchema,
  tool_use_summary: ToolUseSummaryFrameSchema,
  rate_limit_event: RateLimitEventFrameSchema,
  prompt_suggestion: PromptSuggestionFrameSchema,
  auth_status: AuthStatusFrameSchema,
  conversation_reset: ConversationResetFrameSchema,
  command_lifecycle: CommandLifecycleFrameSchema,
  control_request: ControlRequestFrameSchema,
  control_response: ControlResponseFrameSchema,
  control_cancel_request: ControlCancelRequestFrameSchema,
  keep_alive: KeepAliveFrameSchema,
});

// Throws ZodError; never transforms. A frame of unknown `type` parses as UnknownFrame; a `system` frame of unknown
// `subtype` parses as UnknownSystemFrame; a frame of a known type or subtype that fails its schema is rejected.
export function parseStdoutFrame(frame: unknown): StdoutFrame {
  const { type } = UnknownFrameSchema.parse(frame);
  if (type === 'system') {
    const { subtype } = UnknownSystemFrameSchema.parse(frame);
    return (lookup(SYSTEM_SUBTYPE_SCHEMAS, subtype) ?? UnknownSystemFrameSchema).parse(frame) as SystemFrame;
  }
  return (lookup(STDOUT_FRAME_SCHEMAS, type) ?? UnknownFrameSchema).parse(frame) as StdoutFrame;
}

export function parseStdinFrame(frame: unknown): StdinFrame {
  return StdinFrameSchema.parse(frame);
}
