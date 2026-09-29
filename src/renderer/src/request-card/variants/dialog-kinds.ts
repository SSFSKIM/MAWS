// The two `request_user_dialog` kinds C3's `initialize` declares, with zod mirrors of the pinned binary's payload
// schemas and their string results (X6, SPEC 45 §45.22.13): `refusal_fallback_prompt` (`cli.pretty.js:545548`) and
// `auto_mode_server_fallback` (`:927997`). Any other kind is undeclared, and a declared kind whose payload does not
// validate is treated like one: pending, visible and never answered by MAWS, rather than guessed. The objects are
// loose so a key a newer binary adds passes through untouched. Pure.
import * as z from 'zod';

export const RefusalFallbackPayloadSchema = z.looseObject({
  originalModel: z.string(),
  fallbackModel: z.string(),
  apiRefusalCategory: z.string().nullable().optional(),
  guidanceText: z.string().optional(),
  retractedMessageUuids: z.array(z.string()).optional(),
});
export type RefusalFallbackPayload = z.infer<typeof RefusalFallbackPayloadSchema>;

export const AutoModeServerFallbackPayloadSchema = z.looseObject({
  gatewayHost: z.string().optional(),
  title: z.string(),
  paragraphs: z.array(z.string()),
  helpUrl: z.string(),
});
export type AutoModeServerFallbackPayload = z.infer<typeof AutoModeServerFallbackPayloadSchema>;

// The results MAWS sends per declared kind. The schema's default `cancelled` is a real dismissal for the refusal
// dialog (its Cancel); the auto-mode consumer reads `cancelled` as the engine's own unanswered path, so a human at the
// card either continues or stops.
export const DIALOG_RESULTS = {
  refusal_fallback_prompt: ['retry_fallback', 'edit_prompt', 'cancelled'],
  auto_mode_server_fallback: ['continue', 'interrupt'],
} as const;
export type DeclaredDialogKind = keyof typeof DIALOG_RESULTS;

export type DeclaredDialog =
  | { kind: 'refusal_fallback_prompt'; payload: RefusalFallbackPayload }
  | { kind: 'auto_mode_server_fallback'; payload: AutoModeServerFallbackPayload };

export const isDeclaredDialogKind = (kind: string): kind is DeclaredDialogKind => Object.hasOwn(DIALOG_RESULTS, kind);

export function declaredDialog(kind: string, payload: unknown): { ok: true; dialog: DeclaredDialog } | { ok: false; reason: 'undeclared' } | { ok: false; reason: 'invalid'; problem: string } {
  const schema = kind === 'refusal_fallback_prompt' ? RefusalFallbackPayloadSchema : kind === 'auto_mode_server_fallback' ? AutoModeServerFallbackPayloadSchema : null;
  if (!schema) return { ok: false, reason: 'undeclared' };
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: 'invalid', problem: z.prettifyError(parsed.error) };
  return { ok: true, dialog: { kind, payload: parsed.data } as DeclaredDialog };
}
