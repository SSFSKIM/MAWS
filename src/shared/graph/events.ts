// X1 event graph (charter §13 X1; C1 execution document, Interfaces "X1 — events").
// Every event is `EventBase & EventPayload`, a discriminated union on `kind`. The app's own record is strict: no unknown
// fields, because the raw frame is always reachable through `seq` in the journal (X8), so nothing is lost by strictness.
// Normalisation from frames to events is C3's (live) and C4's (disk); the derivation rules are pinned in the execution document.
import * as z from 'zod';
import { COMMAND_LIFECYCLE_STATES, DenialKindSchema, PermissionModeSchema, PLAN_OUTCOMES, SafeguardVerdictSchema, SESSION_STATES } from './enums';
import {
  AgentIdSchema,
  ApiMessageIdSchema,
  EventIdSchema,
  MessageUuidSchema,
  ParentToolUseIdSchema,
  RequestIdSchema,
  SessionIdSchema,
  TaskIdSchema,
  ToolUseIdSchema,
} from './ids';
import { PaneRosterSchema, PromptFillModeSchema, SURFACE_ASKS } from '../engine/surface'; // R2
// E1 start
import { PaneSchema } from '../maws/panes';
import { AskAnswerSchema, AskQuestionSchema, DeliveredFileSchema, ShowPaneOpenedSchema } from '../maws/tools';
// E1 end
// E4c start
import { BROWSER_TOOL_NAMES, BrowserWaitReasonSchema } from '../maws/browser';
// E4c end
// E3 start
import { AnchorSchema } from '../anchor/anchor';
import { AppSessionIdSchema } from './ids';
// E3 end

// P2-C start (2026-10-09; the P2-C document, Design §6's row table): the queue's transitions of a prompt, each journaled
// as a `meta queue` row at the transition it names; a drop's reason is the engine's lifecycle state that dropped it.
export const QUEUE_TRANSITION_ACTIONS = ['release', 'revert', 'uncertain', 'retire', 'drop', 'withdraw', 'giveback', 'hold', 'cancel', 'abandon', 'promote', 'remove'] as const;
export type QueueTransitionAction = (typeof QUEUE_TRANSITION_ACTIONS)[number];
export const QUEUE_DROP_REASONS = ['cancelled', 'discarded', 'refused'] as const;
export type QueueDropReason = (typeof QUEUE_DROP_REASONS)[number];
// P2-C end

// An API content block, unknown keys kept.
export const ContentBlockSchema = z.looseObject({ type: z.string() });
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

export const TokenUsageSchema = z.strictObject({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadInputTokens: z.number(),
  cacheCreationInputTokens: z.number(),
  thinkingTokens: z.number().nullable(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const TaskUsageSchema = z.strictObject({ totalTokens: z.number(), toolUses: z.number(), durationMs: z.number() });
export type TaskUsage = z.infer<typeof TaskUsageSchema>;

export const QuestionSchema = z.strictObject({
  question: z.string(),
  header: z.string(),
  options: z.array(z.strictObject({ label: z.string(), description: z.string().nullable(), preview: z.string().nullable() })),
  multiSelect: z.boolean(),
});
export type Question = z.infer<typeof QuestionSchema>;

export const EventBaseSchema = z.strictObject({
  id: EventIdSchema,
  sessionId: SessionIdSchema,
  at: z.string(), // ISO-8601: the frame's timestamp when it has one, else receive time
  seq: z.number().int().nullable(), // journal row the event derives from (X8); null for app-synthesised events
  agentId: AgentIdSchema.nullable(), // the child agent this belongs to, when known
  parentToolUseId: ParentToolUseIdSchema.nullable(), // non-null for child-agent traffic; the parent conversation is never joined
});
export type EventBase = z.infer<typeof EventBaseSchema>;

export const EVENT_KINDS = [
  // session lifecycle
  'session.started', 'session.init', 'session.state', 'session.commands',
  // turn lifecycle and the engine's command receipts
  'turn.started', 'turn.ended', 'command.lifecycle',
  // assistant output
  'assistant.block.delta', 'assistant.block.complete',
  // user input (replayed, bash-tagged, synthetic)
  'user.message',
  // tools (safeguard verdicts arrive separately and are folded onto the result)
  'tool.use', 'tool.safeguard', 'tool.result', 'tool.progress',
  // hooks: settings and plugin hooks emit lifecycle; host callback hooks are requests to us
  'hook.started', 'hook.finished', 'hook.callback_requested', 'hook.callback_resolved',
  // requests to the human (all arrive as can_use_tool or dedicated control requests)
  'permission.requested', 'permission.resolved',
  'question.requested', 'question.answered',
  'plan.requested', 'plan.resolved',
  'dialog.requested', 'dialog.resolved',
  'elicitation.requested', 'elicitation.resolved',
  // child agents and background work
  'subagent.started', 'subagent.progress', 'subagent.finished', 'subagent.message',
  'task.started', 'task.updated', 'task.notification', 'tasks.snapshot',
  'workflow.progress',
  // the revisable log
  'boundary.compaction', 'boundary.reset', 'boundary.retraction', 'boundary.rewind',
  // accounting
  'usage.sample', 'context.sample',
  // trouble: api.retry is the engine's own HTTP retry inside a turn (system/api_retry); session.reconnect is the app
  // re-attaching a session record to an engine process (charter X1 "error and reconnect")
  'error.raised', 'api.retry', 'session.reconnect', 'notice.posted', 'process.exited',
  // plugins (R1; charter D-9 as amended 2026-10-01): a plugin's toast, pinned status line and log line from the engine's
  // remote-surface pushes, a drawn tree the engine says may be stale (carried, unused until R2), and a load error or
  // warning from `system/init`
  'plugin.toast', 'plugin.status', 'plugin.log', 'plugin.invalidate', 'plugin.load_issue',
  // the remote surface (R2): the pane roster, a plugin's move of a site's window or focus ring, and a request the engine
  // sends the surface (the clipboard, the composer's read, fill and suggest), which the renderer answers through X2
  'plugin.panes', 'plugin.scroll', 'plugin.focus', 'plugin.ask',
  // retention of the unknown
  'frame.unknown',
  // E1 start: the maws tool server (P1 X9): an ask's life, a delivered file, a pane shown for the model
  'maws.ask.opened', 'maws.ask.answered', 'maws.ask.cancelled', 'maws.delivery.file', 'maws.pane.shown',
  // E1 end
  // E3 start: side threads (P1 X10/X11): a thread opened from this session, and its latest turn's summary
  'side.thread.opened', 'side.thread.summarised',
  // E3 end
  // E7 start: a message from another session, parsed from the engine's envelope
  'peer.message',
  // E7 end
  // E2 start: an artifact version the maws server registered (P1 X9 `artifact_create`, `artifact_update`)
  'maws.delivery.artifact',
  // E2 end
  // E4c start: one browser tool call the maws server answered (P1 X9 `browser_*`)
  'maws.browser.action',
  // E4c end
  // P2-C start (2026-10-09): a prompt's transition through the host's queue, from the queue's `meta queue` row
  'queue.transition',
  // P2-C end
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

const TaskOutcomeSchema = z.enum(['completed', 'failed', 'stopped']);
const nullableString = () => z.string().nullable();

// One strict member per kind: the base fields, the discriminator, the payload.
const event = <K extends EventKind, S extends z.ZodRawShape>(kind: K, shape: S) =>
  z.strictObject({ ...EventBaseSchema.shape, kind: z.literal(kind), ...shape });

export const SessionEventSchema = z.discriminatedUnion('kind', [
  event('session.started', { cwd: z.string(), engineVersion: nullableString(), resumedFrom: SessionIdSchema.nullable(), forked: z.boolean() }),
  event('session.init', {
    cwd: z.string(), model: z.string(), permissionMode: PermissionModeSchema, tools: z.array(z.string()),
    slashCommands: z.array(z.string()), agents: z.array(z.string()), skills: z.array(z.string()),
    plugins: z.array(z.strictObject({ name: z.string(), source: z.string() })),
    mcpServers: z.array(z.unknown()), capabilities: z.array(z.string()), engineVersion: z.string(), outputStyle: nullableString(),
  }),
  event('session.state', { state: z.enum(SESSION_STATES) }),
  event('session.commands', { // system/commands_changed
    commands: z.array(z.strictObject({ name: z.string(), description: z.string(), argumentHint: nullableString(), builtin: z.boolean() })),
  }),
  event('turn.started', { userMessageUuid: MessageUuidSchema.nullable(), origin: nullableString() }),
  event('turn.ended', {
    result: z.string(), isError: z.boolean(), terminalReason: nullableString(), resultText: nullableString(),
    durationMs: z.number(), numTurns: z.number(), costUsd: z.number(), usage: TokenUsageSchema,
    permissionDenials: z.array(z.strictObject({ toolName: z.string(), toolUseId: ToolUseIdSchema, toolInput: z.unknown() })),
    errors: z.array(z.string()), userMessageUuids: z.array(MessageUuidSchema),
    origin: nullableString(), // `result.origin.kind`: 'human' for a turn we started, 'task-notification' for an engine-initiated turn
    resultIndex: z.number().nullable(),
    isEchoReceipt: z.boolean(), // true for the empty result (num_turns 0, null terminal_reason) that follows a shouldQuery:false frame; not a turn
  }),
  event('command.lifecycle', { commandUuid: MessageUuidSchema, state: z.enum(COMMAND_LIFECYCLE_STATES) }),
  event('assistant.block.delta', {
    apiMessageId: ApiMessageIdSchema.nullable(), blockIndex: z.number(), blockType: z.string(),
    textDelta: nullableString(), thinkingDelta: nullableString(), inputJsonDelta: nullableString(), userMessageUuid: MessageUuidSchema.nullable(),
  }),
  event('assistant.block.complete', {
    messageUuid: MessageUuidSchema, apiMessageId: ApiMessageIdSchema, blockIndex: z.number(), block: ContentBlockSchema, model: z.string(),
    // the message uuids this block replaces (SPEC 45, refusal fallback: every block frame of the refused attempt, on the
    // first frame of the replacement only); empty on every other block (debt wave 4: was one uuid or null)
    supersedes: z.array(MessageUuidSchema), aborted: z.boolean(), userMessageUuids: z.array(MessageUuidSchema),
    isApiErrorMessage: z.boolean().optional(), error: z.string().optional(), // synthetic API diagnostic envelope (live and disk)
  }),
  event('user.message', {
    messageUuid: MessageUuidSchema.nullable(), content: z.union([z.string(), z.array(ContentBlockSchema)]), isReplay: z.boolean(),
    isSynthetic: z.boolean(), origin: nullableString(),
    bash: z.discriminatedUnion('part', [
      z.strictObject({ part: z.literal('input'), command: z.string() }),
      z.strictObject({ part: z.literal('output'), stdout: z.string(), stderr: z.string(), exitCode: z.number() }),
    ]).nullable(),
  }),
  event('tool.use', { toolUseId: ToolUseIdSchema, toolName: z.string(), input: z.unknown(), apiMessageId: ApiMessageIdSchema.nullable(), messageUuid: MessageUuidSchema.nullable() }),
  event('tool.safeguard', { toolUseId: ToolUseIdSchema, verdict: z.enum(['skipped', 'not_flagged', 'flagged']), lane: z.literal('server') }), // one per tool use named in a message_delta.safeguard_results entry
  event('tool.result', {
    toolUseId: ToolUseIdSchema, content: z.union([z.string(), z.array(ContentBlockSchema)]), isError: z.boolean(), structured: z.unknown(),
    spillPath: nullableString(), denial: DenialKindSchema.nullable(), safeguard: SafeguardVerdictSchema, messageUuid: MessageUuidSchema.nullable(),
  }),
  event('tool.progress', { toolUseId: ToolUseIdSchema, toolName: z.string(), elapsedSeconds: z.number(), taskId: TaskIdSchema.nullable(), heartbeat: z.boolean() }),
  event('hook.started', { hookId: z.string(), hookName: z.string(), hookEvent: z.string() }),
  event('hook.finished', {
    hookId: z.string(), hookName: z.string(), hookEvent: z.string(), outcome: z.enum(['success', 'error', 'cancelled']),
    exitCode: z.number().nullable(), stdout: z.string(), stderr: z.string(),
  }),
  event('hook.callback_requested', { requestId: RequestIdSchema, callbackId: z.string(), hookEvent: z.string(), toolUseId: ToolUseIdSchema.nullable(), input: z.unknown() }),
  event('hook.callback_resolved', { requestId: RequestIdSchema, callbackId: z.string(), response: z.unknown() }),
  event('permission.requested', {
    requestId: RequestIdSchema, toolUseId: ToolUseIdSchema, toolName: z.string(), displayName: nullableString(),
    input: z.unknown(), description: nullableString(), decisionReasonType: nullableString(), suggestions: z.array(z.unknown()), blockedPath: nullableString(),
    // C3 start: C7's additive asks (C3 execution document, Decision Log "coordinator, C7's asks"): present only when
    // the `can_use_tool` request carries the wire key, so a fixture recorded without them validates unchanged.
    decisionReason: nullableString().optional(), // decision_reason
    suppressAlwaysAllow: z.boolean().optional(), // suppress_always_allow_rule
    defaultToNo: z.boolean().optional(), // default_to_no
    matchedAskRule: z.strictObject({ source: z.string(), toolName: z.string(), ruleContent: nullableString() }).nullable().optional(), // matched_ask_rule
    requiresUserInteraction: z.boolean().optional(), // requires_user_interaction
    mcpServer: z.strictObject({ name: z.string(), source: z.string() }).nullable().optional(), // mcp_server (an object on the wire, SPEC 45)
    // C3 end
  }),
  event('permission.resolved', {
    requestId: RequestIdSchema, toolUseId: ToolUseIdSchema, behavior: z.enum(['allow', 'deny']), message: nullableString(),
    updatedInput: z.unknown(), updatedPermissions: z.array(z.unknown()), resolvedBy: z.enum(['user', 'rule', 'auto', 'abort', 'exit']),
  }),
  event('question.requested', { requestId: RequestIdSchema, toolUseId: ToolUseIdSchema, questions: z.array(QuestionSchema) }),
  event('question.answered', { requestId: RequestIdSchema, toolUseId: ToolUseIdSchema, answers: z.record(z.string(), z.string()) }),
  event('plan.requested', { requestId: RequestIdSchema, toolUseId: ToolUseIdSchema, plan: z.string(), input: z.unknown() }),
  event('plan.resolved', { requestId: RequestIdSchema, toolUseId: ToolUseIdSchema, outcome: z.enum(PLAN_OUTCOMES), feedback: nullableString() }),
  event('dialog.requested', { requestId: RequestIdSchema, dialogKind: z.string(), payload: z.unknown(), toolUseId: ToolUseIdSchema.nullable() }),
  event('dialog.resolved', { requestId: RequestIdSchema, behavior: z.enum(['completed', 'cancelled']), result: z.unknown() }),
  event('elicitation.requested', { requestId: RequestIdSchema, mcpServerName: z.string(), elicitationId: nullableString(), mode: z.string(), payload: z.unknown() }),
  event('elicitation.resolved', { requestId: RequestIdSchema, action: z.enum(['accept', 'decline', 'cancel']), content: z.unknown() }),
  event('subagent.started', {
    taskId: TaskIdSchema, toolUseId: ToolUseIdSchema.nullable(), description: z.string(), subagentType: nullableString(),
    isBackground: z.boolean(), spawnDepth: z.number(), prompt: nullableString(),
  }),
  event('subagent.progress', {
    taskId: TaskIdSchema, description: z.string(), usage: TaskUsageSchema,
    lastToolName: nullableString(), summary: nullableString(),
  }),
  event('subagent.finished', { taskId: TaskIdSchema, status: TaskOutcomeSchema, summary: nullableString(), outputFile: nullableString(), reason: nullableString(), usage: TaskUsageSchema.optional() }),
  event('subagent.message', { direction: z.enum(['to_child', 'from_child', 'between']), fromAgentId: AgentIdSchema.nullable(), toAgentId: AgentIdSchema.nullable(), text: z.string() }),
  event('task.started', { taskId: TaskIdSchema, toolUseId: ToolUseIdSchema.nullable(), taskType: z.string(), description: z.string(), isBackground: z.boolean(), workflowName: nullableString() }),
  event('task.updated', {
    taskId: TaskIdSchema,
    patch: z.strictObject({ status: z.string().optional(), description: z.string().optional(), endTime: z.number().optional(), error: z.string().optional(), isBackground: z.boolean().optional() }),
  }),
  event('task.notification', { taskId: TaskIdSchema, toolUseId: ToolUseIdSchema.nullable(), status: TaskOutcomeSchema, summary: z.string(), outputFile: nullableString(), reason: nullableString() }),
  event('tasks.snapshot', { tasks: z.array(z.strictObject({ taskId: TaskIdSchema, taskType: z.string(), description: z.string(), ambient: z.boolean() })) }),
  event('workflow.progress', { taskId: TaskIdSchema, workflowName: nullableString(), progress: z.unknown() }), // shape fixed by C2's findings; kept opaque here
  event('boundary.compaction', { trigger: z.string(), preTokens: z.number(), postTokens: z.number().nullable(), logicalParentUuid: MessageUuidSchema.nullable(), historical: z.boolean() }),
  event('boundary.reset', { newConversationId: z.string(), trigger: nullableString() }),
  event('boundary.retraction', { retractedMessageUuids: z.array(MessageUuidSchema), reason: z.string(), fallbackModel: nullableString() }),
  event('boundary.rewind', { targetMessageUuid: MessageUuidSchema, precedingAssistantUuid: MessageUuidSchema.nullable(), prefillText: nullableString() }), // app-synthesised from a successful rewind_conversation; the engine emits no reset frame
  event('usage.sample', { costUsd: z.number(), usage: TokenUsageSchema, modelUsage: z.record(z.string(), z.unknown()), source: z.enum(['result', 'get_usage']) }),
  event('context.sample', { totalTokens: z.number(), maxTokens: z.number(), percentage: z.number(), autoCompactThreshold: z.number().nullable(), isAutoCompactEnabled: z.boolean(), model: z.string() }),
  event('error.raised', {
    scope: z.enum(['turn', 'task', 'process', 'transport', 'request']), message: z.string(), code: nullableString(),
    toolUseId: ToolUseIdSchema.nullable(), taskId: TaskIdSchema.nullable(), requestId: RequestIdSchema.nullable(),
  }),
  event('api.retry', { attempt: z.number(), maxRetries: z.number(), retryDelayMs: z.number(), errorStatus: z.number().nullable(), error: z.string() }),
  event('session.reconnect', { // app-synthesised: the session record is being re-attached to an engine process; C3 decides when it fires (D-16), C6 renders the phases (§5.3)
    phase: z.enum(['attempting', 'reconnected', 'failed']), attempt: z.number(), maxAttempts: z.number().nullable(),
    trigger: z.enum(['process_exit', 'host_restart', 'transport_error', 'user']), reason: nullableString(),
  }),
  event('notice.posted', { level: z.enum(['info', 'notice', 'suggestion', 'warning']), text: z.string(), key: nullableString() }),
  // reason 'unknown' (C4): also synthesised by the disk backfill, once per follow, for a transcript no live process holds
  // whose last turn never ended (SDK entrypoints write no turn_duration): the process is gone and nobody saw it go.
  // C12: reason 'budget' is MAWS's release under the memory budget (charter §4.4; never on the wire, which carries
  // end_session `stop`), with the budget and the sum at the release in `budget`, non-null exactly then.
  // E10: reason 'idle' is the supervisor's release of a row with no hard reason for its idle time while no app is
  // connected (or under an armed exit-when-idle): a release like the budget's, also `stop` on the wire, `budget` null.
  // E1: `lostAskCount` is how many of `lostAttentionCount` were blocking `maws` asks (questions, not approvals); absent
  // when none was.
  event('process.exited', {
    code: z.number().nullable(), signal: nullableString(), reason: z.enum(['quit', 'stop', 'archive', 'crash', 'unknown', 'budget' /* C12 */, 'idle' /* E10 */]), lostAttentionCount: z.number(), lostAskCount: z.number().optional() /* E1 */,
    budget: z.strictObject({ limitKiB: z.number(), totalKiB: z.number() }).nullable(), // C12
  }),
  // R1: `plugin` is the engine's registry name for the plugin; `text` is plain text. A toast's `timeoutMs` is the
  // plugin's, else the engine's default (4000). A status replaces the plugin's one pinned line; '' removes it (the
  // wire's null). An invalidate names the render event whose trees may be stale (`ui.render`), not a plugin. A load
  // issue is one entry of init's `plugin_errors` (level error) or `plugin_warnings` (level warning); every init repeats them.
  event('plugin.toast', { plugin: z.string(), text: z.string(), timeoutMs: z.number() }),
  event('plugin.status', { plugin: z.string(), text: z.string() }),
  event('plugin.log', { plugin: z.string(), text: z.string() }),
  event('plugin.invalidate', { event: nullableString() }),
  event('plugin.load_issue', { plugin: z.string(), level: z.enum(['error', 'warning']), message: z.string() }),
  // R2 (charter D-9 as amended 2026-10-01): `plugin.panes` is the roster from the engine's `ui_panes` push and from the
  // host's roster read (`ui_panes` answered), camelCased (shared/engine/surface.ts PaneRosterSchema). `plugin.scroll` and
  // `plugin.focus` are a plugin's own moves of a site's window (`followEnd`: keep the end in view) and focus ring (the
  // element by its plugin and key). `plugin.ask` is the engine's request to this surface, `requestId` the engine's id,
  // which `session.ui.answer` answers within the engine's 5 s: `copy` with the text and the asking plugin, `prompt_read`,
  // `prompt_fill` with the text and where it goes, `prompt_suggest` with the suggestion.
  event('plugin.panes', { ...PaneRosterSchema.shape }),
  event('plugin.scroll', { component: z.string(), instanceId: z.string(), offset: z.number().int(), followEnd: z.boolean() }),
  event('plugin.focus', { component: z.string(), instanceId: z.string(), plugin: z.string(), key: z.string() }),
  event('plugin.ask', { requestId: RequestIdSchema, ask: z.enum(SURFACE_ASKS), plugin: nullableString(), text: nullableString(), mode: PromptFillModeSchema.nullable() }),
  event('frame.unknown', { frameType: z.string(), subtype: nullableString() }),
  // E1 start (E1 execution document, Interfaces "X1 events", residue 1): mapped from the `maws` server's `tools/call`
  // rows and the host's answers, an async answer and a cancellation from the host's meta rows. `askId` is the call's
  // tool-use id (else its control request id); a call whose arguments its schema refuses yields none of these.
  event('maws.ask.opened', { askId: z.string(), toolUseId: ToolUseIdSchema.nullable(), requestId: RequestIdSchema, blocking: z.boolean(), title: nullableString(), context: nullableString(), questions: z.array(AskQuestionSchema) }),
  event('maws.ask.answered', { askId: z.string(), toolUseId: ToolUseIdSchema.nullable(), answers: z.array(AskAnswerSchema), delivery: z.enum(['result', 'steer']) }),
  event('maws.ask.cancelled', { askId: z.string(), toolUseId: ToolUseIdSchema.nullable(), reason: z.enum(['exit', 'withdrawn']) }),
  event('maws.delivery.file', { toolUseId: ToolUseIdSchema.nullable(), requestId: RequestIdSchema, deliverables: z.array(DeliveredFileSchema), caption: nullableString(), urgency: z.enum(['normal', 'high']) }),
  event('maws.pane.shown', { toolUseId: ToolUseIdSchema.nullable(), requestId: RequestIdSchema, pane: PaneSchema, target: nullableString(), opened: ShowPaneOpenedSchema.nullable(), error: nullableString() }),
  // E1 end
  // E3 start (E3 execution document, Interfaces "X1 events", Design §5): app-synthesised by main into the parent's
  // stream (`seq: null`; ids `<parent>:side-thread:<child>:opened` and `…:summarised:<turns>`), re-synthesised from the
  // index's `side_threads` row for a snapshot. `turns` counts the thread's ended turns; one row per thread, updated.
  event('side.thread.opened', { childAppSessionId: AppSessionIdSchema, childEngineSessionId: SessionIdSchema.nullable(), anchor: AnchorSchema.nullable(), openedBy: z.enum(['comment', 'btw']) }),
  event('side.thread.summarised', { childAppSessionId: AppSessionIdSchema, text: nullableString(), isError: z.boolean(), turns: z.number().int().positive() }),
  // E3 end
  // E7 start: a message from another session, parsed from the engine's envelope (SPEC 38 §38.23); emitted beside the
  // `user.message` that carried it, by the live normaliser and the disk backfill alike. `replyable` is false when the
  // suffix says SendMessage cannot reach the sender (a host-injected message).
  event('peer.message', {
    messageUuid: MessageUuidSchema.nullable(), from: z.string(), fromSession: nullableString(), fromName: nullableString(),
    fromMode: nullableString(), fromPlugin: nullableString(), hopChain: z.array(z.string()), text: z.string(),
    midTurn: z.boolean(), lineage: z.enum(['peer', 'descendant']), replyable: z.boolean(),
  }),
  // E7 end
  // E2 start (E2 execution document, Interfaces "X1", Design §9): mapped from an admitted `artifact_create` or
  // `artifact_update` call and its answer when the answer parses (E1 residue 1's rule); a refusal yields none. `artifactId`
  // is the agent's short name, `deliverableId` the record's uuid.
  // P2-E1 (2026-10-09, a dated exception inside E2's entry; D10): `ownerAppSessionId`, copied from the answer, names the
  // side thread's ancestor whose record the version belongs to; absent for the session's own.
  event('maws.delivery.artifact', {
    toolUseId: ToolUseIdSchema.nullable(), requestId: RequestIdSchema, action: z.enum(['create', 'update']), artifactId: z.string(), deliverableId: z.string(), version: z.number().int(), title: z.string(),
    ownerAppSessionId: AppSessionIdSchema.optional(), // P2-E1
    revision: z.number().int().nonnegative().optional(), // P3-L (M6b fix wave 2): the revision written, when the answer named it
  }),
  // E2 end
  // E4c start (E4c execution document, Design §10): mapped from an admitted `browser_*` call and its answer (E1 residue
  // 1's rule), so a journal rebuild reproduces it; a refusal yields none. `action` is the tabs or act action, navigate's
  // `back`/`forward`/`reload`/`url`, else the tool's noun; `target` the ref or css, the URL, the snapshot's root or the
  // screenshot's `page`/`fullPage`; the rest from the answer's first JSON block, `error` its isError text.
  event('maws.browser.action', {
    toolUseId: ToolUseIdSchema.nullable(), requestId: RequestIdSchema, tool: z.enum(BROWSER_TOOL_NAMES), action: z.string(), tabId: nullableString(), target: nullableString(),
    url: nullableString(), title: nullableString(), ms: z.number().int().min(0).nullable(), deliverableId: nullableString(), error: nullableString(),
    waitedFor: BrowserWaitReasonSchema.nullable(), waitedMs: z.number().int().min(0).nullable(),
  }),
  // E4c end
  // P2-C start (2026-10-09; the P2-C document, Design §6 and Interfaces X1): one row of the host queue's prompt record,
  // mapped from its `meta queue` row by the normaliser. The ids are the entry (`queueId`) and the prompt (`messageUuid`)
  // the row names, each null where its action names none; `reason` is a drop's lifecycle state, null on every other row.
  event('queue.transition', { action: z.enum(QUEUE_TRANSITION_ACTIONS), queueId: z.string().nullable(), messageUuid: MessageUuidSchema.nullable(), reason: z.enum(QUEUE_DROP_REASONS).nullable() }),
  // P2-C end
]);

export type SessionEvent = z.infer<typeof SessionEventSchema>;

// P2-C start (2026-10-09; the P2-C document, Interfaces `session.promptHistory`): the two kinds of the prompt record read
// back from the journals, as the very members of SessionEventSchema
type EventMember<K extends EventKind> = Extract<(typeof SessionEventSchema.options)[number], { shape: { kind: z.ZodLiteral<K> } }>;
const memberOf = <K extends EventKind>(kind: K): EventMember<K> => SessionEventSchema.options.find((option) => option.shape.kind.value === kind) as EventMember<K>;
export const PromptHistoryEventSchema = z.discriminatedUnion('kind', [memberOf('queue.transition'), memberOf('command.lifecycle')]);
export type PromptHistoryEvent = z.infer<typeof PromptHistoryEventSchema>;
// P2-C end

// The payload half of each member, `kind` included; `SessionEvent` is `EventBase & EventPayload` member by member.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type EventPayload = DistributiveOmit<SessionEvent, keyof EventBase>;
