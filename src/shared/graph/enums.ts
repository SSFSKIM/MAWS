// X1 enums (charter §13 X1; C1 execution document, Interfaces "X1 — enums"). Values are the contract.
// Each enum that a record field validates against also has its `z.enum` under the type's name with the `Schema` suffix.
import * as z from 'zod';

export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions', 'dontAsk'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];
export const PermissionModeSchema = z.enum(PERMISSION_MODES);

// `error_code` of the control error the engine returns when it refuses `set_permission_mode` to auto (D-18).
export const AUTO_MODE_REFUSAL_CODES = [
  'auto_mode_settings', 'auto_mode_circuit_breaker', 'auto_mode_fast_mode',
  'auto_mode_model', 'auto_mode_unavailable',
] as const;
export type AutoModeRefusalCode = (typeof AUTO_MODE_REFUSAL_CODES)[number];
export const AutoModeRefusalCodeSchema = z.enum(AUTO_MODE_REFUSAL_CODES);

// Values match the wire's `tool_result_meta[].non_execution_kind` where the engine emits one
// (`permission-rule` and `user-rejected` appear in the fixtures); the rest are named the same way.
export const DENIAL_KINDS = [
  'user-rejected', 'permission-rule', 'automode-blocked', 'automode-unavailable',
  'automode-parsing-error', 'interrupted', 'cancelled',
] as const;
export type DenialKind = (typeof DENIAL_KINDS)[number];
export const DenialKindSchema = z.enum(DENIAL_KINDS);

export const ATTENTION_KINDS = [
  'permission', 'question', 'plan', 'dialog', 'elicitation', 'error', 'interrupted',
  'held_peer_message', 'auto_mode_unavailable',
] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];
export const AttentionKindSchema = z.enum(ATTENTION_KINDS);

export const ATTENTION_STATES = ['pending', 'delivered', 'confirmed', 'retired'] as const; // §4.6
export type AttentionState = (typeof ATTENTION_STATES)[number];
export const AttentionStateSchema = z.enum(ATTENTION_STATES);

// Server-lane auto-mode verdict, from `stream_event` `message_delta.safeguard_results[].status.tool_uses[<tool_use_id>]`
// `skipped` is explicit (pass3/plan-outcomes seq 120); `not_evaluated` means no verdict named the tool use.
export const SAFEGUARD_VERDICTS = ['not_evaluated', 'skipped', 'not_flagged', 'flagged'] as const;
export type SafeguardVerdict = (typeof SAFEGUARD_VERDICTS)[number];
export const SafeguardVerdictSchema = z.enum(SAFEGUARD_VERDICTS);

export const TITLE_SOURCES = ['user', 'generated', 'tool', 'none'] as const;
export const SESSION_STATES = ['idle', 'running', 'requires_action'] as const; // system/session_state_changed
export const COMMAND_LIFECYCLE_STATES = ['queued', 'started', 'completed', 'cancelled', 'discarded', 'refused'] as const;
export const PLAN_OUTCOMES = ['implement', 'clear_and_implement', 'keep_planning'] as const; // §4.2 plan approval
