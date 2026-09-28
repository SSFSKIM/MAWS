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
