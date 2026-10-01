// Control-protocol payloads typed in C1 (charter §4.2; C1 execution document, Interfaces "X1 — wire frames", control
// payloads). Loose objects: unknown keys are retained. The rest of the control catalogue stays `unknown` in the frames;
// C3 types each read as it exposes it.
import * as z from 'zod';

// `can_use_tool`: the permission channel, which AskUserQuestion and ExitPlanMode also travel on (§4.2).
export const CanUseToolRequestSchema = z.looseObject({
  subtype: z.literal('can_use_tool'),
  tool_name: z.string(),
  display_name: z.string().optional(),
  input: z.unknown(),
  description: z.string().optional(),
  tool_use_id: z.string(),
  requires_user_interaction: z.boolean().optional(),
  decision_reason_type: z.string().optional(),
  permission_suggestions: z.array(z.unknown()).optional(),
  blocked_path: z.string().optional(),
});
export type CanUseToolRequest = z.infer<typeof CanUseToolRequestSchema>;

export const CanUseToolResponseSchema = z.discriminatedUnion('behavior', [
  z.looseObject({ behavior: z.literal('allow'), updatedInput: z.unknown().optional(), updatedPermissions: z.array(z.unknown()).optional() }),
  z.looseObject({ behavior: z.literal('deny'), message: z.string(), interrupt: z.boolean().optional() }),
]);
export type CanUseToolResponse = z.infer<typeof CanUseToolResponseSchema>;

export const HookCallbackRequestSchema = z.looseObject({
  subtype: z.literal('hook_callback'),
  callback_id: z.string(),
  tool_use_id: z.string().optional(),
  input: z.looseObject({
    hook_event_name: z.string(),
    session_id: z.string().optional(),
    cwd: z.string().optional(),
    tool_name: z.string().optional(),
    tool_input: z.unknown().optional(),
    tool_use_id: z.string().optional(),
    permission_mode: z.string().optional(),
  }),
});
export type HookCallbackRequest = z.infer<typeof HookCallbackRequestSchema>;

export const ElicitationRequestSchema = z.looseObject({
  subtype: z.literal('elicitation'),
  mcp_server_name: z.string(),
  message: z.string().optional(),
  mode: z.string(),
  requested_schema: z.unknown().optional(),
  url: z.string().optional(),
});
export type ElicitationRequest = z.infer<typeof ElicitationRequestSchema>;

export const ElicitationResponseSchema = z.discriminatedUnion('action', [
  z.looseObject({ action: z.literal('accept'), content: z.unknown().optional() }),
  z.looseObject({ action: z.enum(['decline', 'cancel']) }),
]);
export type ElicitationResponse = z.infer<typeof ElicitationResponseSchema>;

export const InterruptResponseSchema = z.looseObject({ still_queued: z.array(z.string()), cancelled: z.array(z.string()).optional() });
export type InterruptResponse = z.infer<typeof InterruptResponseSchema>;

export const SetPermissionModeResponseSchema = z.looseObject({ mode: z.string() });
export type SetPermissionModeResponse = z.infer<typeof SetPermissionModeResponseSchema>;

// `error_code` carries the auto-mode refusal codes (AUTO_MODE_REFUSAL_CODES) when `set_permission_mode` is refused.
export const ControlErrorResponseSchema = z.looseObject({
  subtype: z.literal('error'),
  request_id: z.string(),
  error: z.string(),
  error_code: z.string().optional(),
});
export type ControlErrorResponse = z.infer<typeof ControlErrorResponseSchema>;

export const RewindConversationResponseSchema = z.looseObject({
  rewound: z.boolean(),
  targetMessageUuid: z.string().optional(),
  prefillText: z.string().nullable(),
  precedingAssistantUuid: z.string().nullable(),
  error: z.string().optional(),
  reason: z.string().optional(),
});
export type RewindConversationResponse = z.infer<typeof RewindConversationResponseSchema>;

export const InitializeResponseSchema = z.looseObject({
  commands: z.array(z.unknown()),
  agents: z.array(z.unknown()).optional(),
  models: z.array(z.unknown()).optional(),
  account: z.unknown().optional(),
  current_permission_mode: z.string(),
  session_state: z.string().optional(),
  hooks_applied: z.boolean().optional(),
  workspace_trust_recorded: z.boolean().optional(),
});
export type InitializeResponse = z.infer<typeof InitializeResponseSchema>;

// C3 start: typed payloads for every control subtype the engine host uses (C3 execution document, Interfaces
// "Control channel"; charter §4.2). Responses are `z.looseObject` and their required fields are those every fixture
// instance carries (pass 1 `reads.jsonl` seq 52–90, pass 2 `auto-routed`, `prewarm`, `trust-no-attestation`, `rewind`);
// a subtype the fixtures never answered (`get_session_cost`, `get_binary_version`, `side_question`, `reload_plugins`,
// the MCP mutations) is typed from the SPEC's lower bound. Outbound requests are TypeScript types: the host authors
// them and never parses them. Later children rebase over this block and never edit inside it.

// --- inbound requests C1 did not type ---------------------------------------------------------------------------------

// SPEC 45:4226: `dialog_kind`, `payload`, `tool_use_id?`; `payload` is the declared kind's own object, passed through.
export const RequestUserDialogRequestSchema = z.looseObject({
  subtype: z.literal('request_user_dialog'),
  dialog_kind: z.string(),
  payload: z.unknown(),
  tool_use_id: z.string().optional(),
});
export type RequestUserDialogRequest = z.infer<typeof RequestUserDialogRequestSchema>;

// `permission_suggestions[]` and the `updatedPermissions` we answer with (SPEC 45.19; `grant-reapply-start` seq 30, 32).
export const PermissionUpdateSchema = z.discriminatedUnion('type', [
  z.looseObject({
    type: z.enum(['addRules', 'replaceRules', 'removeRules']),
    rules: z.array(z.looseObject({ toolName: z.string(), ruleContent: z.string().optional() })),
    behavior: z.string(),
    destination: z.string(),
  }),
  z.looseObject({ type: z.enum(['addDirectories', 'removeDirectories']), directories: z.array(z.string()), destination: z.string() }),
  z.looseObject({ type: z.literal('setMode'), mode: z.string(), destination: z.string() }),
]);
export type PermissionUpdate = z.infer<typeof PermissionUpdateSchema>;

// --- outbound requests (authored by the host) -------------------------------------------------------------------------

export interface InitializeRequest {
  supportedDialogKinds?: string[];
  perTaskStopAffordance?: boolean;
  hooks?: Record<string, { matcher?: string; hookCallbackIds: string[]; timeout?: number }[]>;
  workspaceTrust?: { accepted: true; directory: string };
}
export interface InterruptRequest { reason?: string; cancel_queued?: boolean }
export interface SetPermissionModeRequest { mode: string }
export interface SetModelRequest { model: string | null }
export interface SetMaxThinkingTokensRequest { max_thinking_tokens: number | null; display?: string | null }
export interface ApplyFlagSettingsRequest { settings: Record<string, unknown> }
export interface RenameSessionRequest { title: string; source?: string }
export interface GenerateSessionTitleRequest { description: string; persist: boolean }
export interface StopTaskRequest { task_id: string }
export interface BackgroundTasksRequest { action?: string; task_id?: string }
export interface CancelAsyncMessageRequest { message_uuid: string } // W1: the engine reads `message_uuid` (2.1.283 cli.pretty.js 729935; pass3/steer-next-cancelled seq 32-36)
export interface SetCwdRequest { path: string; trust_accepted?: boolean; trusted_directory?: string }
export interface RewindConversationRequest { target_message_uuid: string; last_seen_user_message_uuid?: string; interrupt_if_running?: boolean }
export interface RewindFilesRequest { user_message_id: string; dry_run?: boolean }
export interface ClaimSessionRequest { cwd: string; include_initialize?: boolean; permission_mode?: string }
export interface EndSessionRequest { reason?: string }
export interface SideQuestionRequest { question: string }
export interface McpReconnectRequest { serverName: string }
export interface McpToggleRequest { serverName: string; enabled: boolean }
export interface GetContextUsageRequest { detail?: 'summary' | 'full' }
export type EmptyRequest = Record<string, never>;

// --- outbound responses ------------------------------------------------------------------------------------------------

// Subtypes whose success envelope carries no `response` (`rename_session` seq 90, `apply_flag_settings`, `set_model`).
export const VoidResponseSchema = z.looseObject({});
export type VoidResponse = z.infer<typeof VoidResponseSchema>;

export const RenameSessionResponseSchema = VoidResponseSchema;
export type RenameSessionResponse = VoidResponse;

export const GenerateSessionTitleResponseSchema = z.looseObject({ title: z.string() });
export type GenerateSessionTitleResponse = z.infer<typeof GenerateSessionTitleResponseSchema>;

export const CancelAsyncMessageResponseSchema = z.looseObject({ cancelled: z.boolean().optional() });
export type CancelAsyncMessageResponse = z.infer<typeof CancelAsyncMessageResponseSchema>;

// The three arms `set_cwd` answers with (`trust-no-attestation` seq 11 `needs_trust`, seq 18 `ok`; SPEC 45 for `error`).
export const SetCwdResponseSchema = z.discriminatedUnion('status', [
  z.looseObject({ status: z.literal('ok'), cwd: z.string(), changed: z.boolean().optional(), transcript_relocated: z.boolean().optional() }),
  z.looseObject({ status: z.literal('needs_trust'), directory: z.string() }),
  z.looseObject({ status: z.literal('error'), error: z.string() }),
]);
export type SetCwdResponse = z.infer<typeof SetCwdResponseSchema>;

// A dry run answers `filesChanged`/`insertions`/`deletions`; a restore answers `skippedLinks`; a refusal `canRewind: false`
// with `error` (`rewind` seq 38). Both shapes parse here; `RewindFilesOutcome` (M4) converts each explicitly.
export const RewindFilesResponseSchema = z.looseObject({
  canRewind: z.boolean(),
  error: z.string().optional(),
  filesChanged: z.array(z.string()).optional(),
  insertions: z.number().optional(),
  deletions: z.number().optional(),
  skippedLinks: z.number().optional(),
});
export type RewindFilesResponse = z.infer<typeof RewindFilesResponseSchema>;

export const ClaimSessionResponseSchema = z.looseObject({
  status: z.string(),
  cwd: z.string().optional(),
  session_id: z.string().optional(),
  parked_ms: z.number().optional(),
  sdk_mcp_settled: z.boolean().optional(),
  initialize: InitializeResponseSchema.optional(),
});
export type ClaimSessionResponse = z.infer<typeof ClaimSessionResponseSchema>;

export const SideQuestionResponseSchema = z.looseObject({ text: z.string() });
export type SideQuestionResponse = z.infer<typeof SideQuestionResponseSchema>;

export const ReloadPluginsResponseSchema = VoidResponseSchema;
export type ReloadPluginsResponse = VoidResponse;

export const GetUsageResponseSchema = z.looseObject({
  session: z.looseObject({ total_cost_usd: z.number(), total_api_duration_ms: z.number(), total_duration_ms: z.number(), model_usage: z.record(z.string(), z.unknown()) }),
  subscription_type: z.string().nullable(),
  rate_limits_available: z.boolean(),
  rate_limits: z.unknown().nullable(),
  behaviors: z.unknown().nullable(),
});
export type GetUsageResponse = z.infer<typeof GetUsageResponseSchema>;

export const GetContextUsageResponseSchema = z.looseObject({
  categories: z.array(z.looseObject({ name: z.string(), tokens: z.number(), kind: z.string().optional() })),
  totalTokens: z.number(),
  maxTokens: z.number(),
  percentage: z.number(),
  autoCompactThreshold: z.number().nullable().optional(),
  isAutoCompactEnabled: z.boolean(),
  model: z.string(),
  // the last response's usage (pass3/context-full): its input side is the context the model last read
  apiUsage: z.looseObject({ input_tokens: z.number(), cache_creation_input_tokens: z.number(), cache_read_input_tokens: z.number() }).nullable().optional(),
});
export type GetContextUsageResponse = z.infer<typeof GetContextUsageResponseSchema>;

// Debt wave 4: `context.sample`'s total, and any surface that shows a `get_context_usage` answer before a sample. The engine's total is its non-message categories plus the messages it
// measures as the last response's input side (input + cache creation + cache read, `apiUsage`) minus those categories,
// floored at zero, plus a local estimate of what was appended since that response (SPEC 13.18.2, "The total"). The
// `summary` detail C3 reads at each turn's end estimates the non-message categories locally and high (pass3/context-full
// seq 77: 30,304 tokens, where `detail: 'full'` counts 18,817 at seq 79), so while the measured input is below that
// estimate the floor swallows the messages and the total stands still (15 % of a 200k window in pass3/context-sample).
// Then the context the model reads is the measured input plus the post-response estimate, which is the engine's total
// less the floor's excess (the non-message categories over the measured input), and what `detail: 'full'` answers
// (30,305 − (30,304 − 21,520) = 21,521 at seq 77, against 21,521 at seq 79); once the measured input passes the
// estimate the excess is zero and the engine's total stands (seq 311 onwards, both details agree). The non-message sum
// is taken from the categories, not as the total less `Messages`: the engine clamps that row to the window, never the
// total (review fix).
type ContextFigures = { totalTokens: number; maxTokens: number; percentage: number; categories: { name: string; tokens: number; kind?: string }[]; apiUsage?: { input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number } | null };
export function contextTotal(usage: ContextFigures): { totalTokens: number; percentage: number } {
  const { totalTokens, maxTokens, percentage, categories, apiUsage } = usage;
  if (!apiUsage) return { totalTokens, percentage }; // no response yet: the estimate is all there is
  const measured = apiUsage.input_tokens + apiUsage.cache_creation_input_tokens + apiUsage.cache_read_input_tokens;
  const nonMessages = categories.filter((c) => c.kind === 'used' && c.name !== 'Messages').reduce((sum, c) => sum + c.tokens, 0);
  const excess = Math.max(0, nonMessages - measured);
  if (excess === 0) return { totalTokens, percentage };
  const derived = totalTokens - excess;
  return { totalTokens: derived, percentage: maxTokens > 0 ? Math.round((derived / maxTokens) * 100) : percentage };
}

export const GetSettingsResponseSchema = z.looseObject({
  effective: z.record(z.string(), z.unknown()),
  sources: z.array(z.unknown()),
  applied: z.record(z.string(), z.unknown()).optional(),
  errors: z.array(z.unknown()).optional(),
});
export type GetSettingsResponse = z.infer<typeof GetSettingsResponseSchema>;

export const PermissionRuleSchema = z.looseObject({
  behavior: z.string(),
  source: z.string(),
  rule: z.string(),
  description: z.unknown().optional(), // `{ prefix, emphasis }` in `grant-reapply-resume` seq 10
  editability: z.string().optional(),
});
export type PermissionRule = z.infer<typeof PermissionRuleSchema>;

export const ListPermissionRulesResponseSchema = z.looseObject({
  state: z.looseObject({ rules: z.array(PermissionRuleSchema), workspaceDirectories: z.array(z.unknown()), originalCwd: z.string(), managedOnly: z.boolean() }),
});
export type ListPermissionRulesResponse = z.infer<typeof ListPermissionRulesResponseSchema>;

export const GetHooksListingResponseSchema = z.looseObject({
  events: z.array(z.unknown()),
  hooks: z.array(z.unknown()),
  eventCatalog: z.array(z.looseObject({ name: z.string(), summary: z.string().optional(), supportsMatcher: z.boolean().optional() })).optional(),
  policy: z.unknown().optional(),
});
export type GetHooksListingResponse = z.infer<typeof GetHooksListingResponseSchema>;

export const MemoryFileSchema = z.looseObject({ kind: z.string(), path: z.string(), label: z.string(), description: z.string(), exists: z.boolean() });
export const GetMemoryDialogResponseSchema = z.looseObject({
  files: z.array(MemoryFileSchema),
  folders: z.array(z.looseObject({ kind: z.string(), path: z.string(), label: z.string(), description: z.string() })),
  memories: z.array(z.unknown()).optional(),
  auto_memory: z.unknown().optional(),
  auto_dream: z.unknown().optional(),
});
export type GetMemoryDialogResponse = z.infer<typeof GetMemoryDialogResponseSchema>;

export const GetSkillsDialogResponseSchema = z.looseObject({ skills: z.array(z.unknown()) });
export type GetSkillsDialogResponse = z.infer<typeof GetSkillsDialogResponseSchema>;

export const GetSandboxDialogResponseSchema = z.looseObject({ supported: z.boolean(), enabled: z.boolean(), mode: z.string() });
export type GetSandboxDialogResponse = z.infer<typeof GetSandboxDialogResponseSchema>;

// Typed from C8c's pass-3 fixtures (`workspace-diff-dirty` seq 8, 13, 18; `workspace-diff-branch` seq 7, 12; C3 M6):
// hunk lines carry a leading space, minus or plus and no `@@` header; `diff` is null outside a git repository or during
// a merge, rebase or cherry-pick (the engine's own declaration, findings-pass3-workspace-diff.md).
export const WorkspaceDiffSourceSchema = z.union([
  z.looseObject({ kind: z.literal('working-tree') }),
  z.looseObject({ kind: z.literal('branch'), baseBranch: z.string(), baseRef: z.string() }),
]);
export const GetWorkspaceDiffResponseSchema = z.looseObject({
  diff: z
    .looseObject({
      stats: z.looseObject({ filesCount: z.number(), linesAdded: z.number(), linesRemoved: z.number() }),
      perFileStats: z.array(z.looseObject({ path: z.string(), added: z.number(), removed: z.number(), isBinary: z.boolean(), isUntracked: z.boolean() })),
      hunks: z.array(
        z.looseObject({
          path: z.string(),
          hunks: z.array(z.looseObject({ oldStart: z.number(), oldLines: z.number(), newStart: z.number(), newLines: z.number(), lines: z.array(z.string()) })),
        }),
      ),
      skippedLarge: z.array(z.string()),
      restricted: z.array(z.string()),
      source: WorkspaceDiffSourceSchema,
    })
    .nullable(),
});
export type GetWorkspaceDiffResponse = z.infer<typeof GetWorkspaceDiffResponseSchema>;

export const ExportConversationResponseSchema = z.looseObject({ text: z.string(), default_filename: z.string() });
export type ExportConversationResponse = z.infer<typeof ExportConversationResponseSchema>;

export const StatusRowSchema = z.looseObject({ label: z.string().optional(), value: z.string() });
export const GetStatusResponseSchema = z.looseObject({ sections: z.array(z.looseObject({ title: z.string(), rows: z.array(StatusRowSchema) })) });
export type GetStatusResponse = z.infer<typeof GetStatusResponseSchema>;

export const McpStatusResponseSchema = z.looseObject({ mcpServers: z.array(z.looseObject({ name: z.string(), status: z.string(), source: z.string().optional() })) });
export type McpStatusResponse = z.infer<typeof McpStatusResponseSchema>;

// `auto-routed` seq 143: every entry carries value, resolvedModel, displayName, description; the capability flags are
// present on the first entries and absent on others (models.4 carries none of the four), so they are optional.
export const ModelOptionSchema = z.looseObject({
  value: z.string(),
  resolvedModel: z.string(),
  displayName: z.string(),
  description: z.string(),
  supportsEffort: z.boolean().optional(),
  supportedEffortLevels: z.array(z.string()).optional(),
  supportsAdaptiveThinking: z.boolean().optional(),
  supportsFastMode: z.boolean().optional(),
  supportsAutoMode: z.boolean().optional(),
});
export const ListModelsResponseSchema = z.looseObject({ models: z.array(ModelOptionSchema) });
export type ListModelsResponse = z.infer<typeof ListModelsResponseSchema>;

// No fixture carries `get_session_cost`; SPEC 45 (~/claude-code-bundle/2.1.283/SPEC/45-headless-and-sdk-protocol.md line
// 4190: `| get_session_cost | C→A | — | text | …`) declares the one response field, the `/usage` text.
export const GetSessionCostResponseSchema = z.looseObject({ text: z.string() });
export type GetSessionCostResponse = z.infer<typeof GetSessionCostResponseSchema>;

export const GetBinaryVersionResponseSchema = z.looseObject({ version: z.string() });
export type GetBinaryVersionResponse = z.infer<typeof GetBinaryVersionResponseSchema>;
// C3 end
