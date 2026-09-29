// The model catalogue (C10 execution document, Terms "Catalogue", Interfaces "Shared shapes", models.ts): the engine's
// model list as `list_models` and the `initialize` response carry it, what `engine.models` answers before any session
// exists, and the two notes the model chip shows beside an auto-mode choice.
import * as z from 'zod';
import type { PermissionMode } from '../graph/enums';

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

// The relay's aliases for non-Anthropic providers (`claude/astra`, `claude/<vendor>/…`).
export function isGatewayModel(value: string): boolean {
  return value.startsWith('claude/');
}

export const CANNOT_HOLD_AUTO_NOTE = 'This model cannot hold auto mode; the engine will run in default.';
export const GATEWAY_AUTO_NOTE = 'Auto-mode reviews for this model run locally on Sonnet 5 and count against your usage.';

// A model that cannot hold auto mode, when auto is chosen; else a gateway model's local auto-mode lane (§19), when the
// mode is auto or left to settings (the owner's settings default is auto, D-18); else nothing.
export function autoModeNote(entry: ModelCatalogueEntry | null, permissionMode: PermissionMode | null): string | null {
  if (!entry) return null;
  if (permissionMode === 'auto' && entry.supportsAutoMode !== true) return CANNOT_HOLD_AUTO_NOTE;
  if (isGatewayModel(entry.value) && (permissionMode === 'auto' || permissionMode === null)) return GATEWAY_AUTO_NOTE;
  return null;
}
