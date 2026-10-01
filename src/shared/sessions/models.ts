// The model catalogue (C10 execution document, Terms "Catalogue", Interfaces "Shared shapes", models.ts): the engine's
// model list as `list_models` and the `initialize` response carry it, what `engine.models` answers before any session
// exists, and the two notes the model chip shows beside an auto-mode choice.
import * as z from 'zod';
import type { PermissionMode } from '../graph/enums';
import { PERMISSION_MODE_LABELS } from './permission-mode-labels';

export const ModelCatalogueEntrySchema = z.looseObject({
  value: z.string(),
  displayName: z.string(),
  supportsAutoMode: z.boolean().optional(),
  supportsFastMode: z.boolean().optional(),
});
export type ModelCatalogueEntry = z.infer<typeof ModelCatalogueEntrySchema>;

export const ModelCatalogueSchema = z.strictObject({
  models: z.array(ModelCatalogueEntrySchema),
  source: z.enum(['live', 'cached', 'builtin']),
  at: z.string().nullable(),
});
export type ModelCatalogue = z.infer<typeof ModelCatalogueSchema>;

// The five entries `reads.jsonl` seq 3 carries before the relay's aliases, which exist only through the relay and
// arrive with the first routed launch. Haiku is the one that cannot hold auto mode and has no effort levels. W3: with the
// resolved model and the effort levels, so an unstarted tab names what `default` runs and offers its levels before any
// launch has listed the catalogue (the engine is pinned, so the fixture's rows are its rows).
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const BUILTIN_MODELS: readonly ModelCatalogueEntry[] = Object.freeze([
  { value: 'default', displayName: 'Default (recommended)', resolvedModel: 'claude-opus-5-5[1m]', supportedEffortLevels: LEVELS, supportsAutoMode: true, supportsFastMode: true },
  { value: 'opus', displayName: 'Opus 5.5 (1M context)', resolvedModel: 'claude-opus-5-5[1m]', supportedEffortLevels: LEVELS, supportsAutoMode: true, supportsFastMode: true },
  { value: 'fable', displayName: 'Fable 5.1', resolvedModel: 'claude-fable-5-1[1m]', supportedEffortLevels: LEVELS, supportsAutoMode: true },
  { value: 'sonnet', displayName: 'Sonnet 5', resolvedModel: 'claude-sonnet-5[1m]', supportedEffortLevels: LEVELS, supportsAutoMode: true },
  { value: 'haiku', displayName: 'Haiku', resolvedModel: 'claude-haiku-4-5-20251001', supportsAutoMode: false },
]);

// The relay's aliases for non-Anthropic providers (`claude/astra`, `claude/<vendor>/…`).
export function isGatewayModel(value: string): boolean {
  return value.startsWith('claude/');
}

// W3 (charter D-18 as amended 2026-10-01): Claude Desktop's notice in MAWS's words, with the mode MAWS sets instead.
export const autoFallbackNotice = (fallback: PermissionMode): string => `Auto mode isn't available for this session. Using ${PERMISSION_MODE_LABELS[fallback]} instead.`;
export const cannotHoldAutoNote = (model: string, fallback: PermissionMode): string => `Auto mode isn't available for ${model}. This session will use ${PERMISSION_MODE_LABELS[fallback]} instead.`;
export const GATEWAY_AUTO_NOTE = 'Auto-mode reviews for this model run locally on Sonnet 5 and count against your usage.';

// A model that cannot hold auto mode, when auto is chosen (W3: with the fallback the launch will set); else a gateway
// model's local auto-mode lane (§19), when the mode is auto or left to settings (D-18); else nothing.
export function autoModeNote(entry: ModelCatalogueEntry | null, permissionMode: PermissionMode | null, fallback: PermissionMode = 'acceptEdits'): string | null {
  if (!entry) return null;
  if (permissionMode === 'auto' && entry.supportsAutoMode !== true) return cannotHoldAutoNote(entry.displayName, fallback);
  if (isGatewayModel(entry.value) && (permissionMode === 'auto' || permissionMode === null)) return GATEWAY_AUTO_NOTE;
  return null;
}
