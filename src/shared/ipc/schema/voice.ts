// X2 `voice.*` (E9 execution document, Interfaces "X2 `voice.*`"): push-to-talk dictation. Main owns every command: it
// holds the one capture app-wide (one microphone) and drives a backend, the bundled Swift helper over Apple's Speech
// framework or, under the end-to-end harness, a scripted stand-in (`src/main/voice/`). The renderer mints a capture id
// per hold and carries it on every command; every event names it, so a late event of an earlier capture is dropped.
import * as z from 'zod';
import type { CommandSpec } from './common';

// The two TCC services' states as Apple names them; reading them never prompts (only the helper's `start` does).
export const PermissionStateSchema = z.enum(['notDetermined', 'authorized', 'denied', 'restricted']);
export type PermissionState = z.infer<typeof PermissionStateSchema>;
export const VoicePermissionSchema = z.strictObject({ microphone: PermissionStateSchema, speech: PermissionStateSchema });
export type VoicePermission = z.infer<typeof VoicePermissionSchema>;

export const VoiceHelperStateSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('ready'), path: z.string() }),
  z.strictObject({ state: z.literal('missing'), path: z.string() }), // not there, or not executable
  z.strictObject({ state: z.literal('failed'), path: z.string(), message: z.string() }), // would not start or answer
]);
export type VoiceHelperState = z.infer<typeof VoiceHelperStateSchema>;

export const VoiceStatusSchema = z.strictObject({
  helper: VoiceHelperStateSchema,
  backend: z.enum(['helper', 'scripted']),
  permission: VoicePermissionSchema.nullable(), // null when the helper could not be probed
  systemLocale: z.string().nullable(),
  locale: z.string().nullable(), // the locale the status was probed for (the settings' choice, resolved)
  supportsOnDevice: z.boolean().nullable(),
  locales: z.array(z.string()), // BCP-47 identifiers with hyphens (`en-US`), as Apple reports them
});
export type VoiceStatus = z.infer<typeof VoiceStatusSchema>;

const LocaleSchema = z.string().min(2).max(32).nullable(); // null = the system's current locale

export const VoiceStartInputSchema = z.strictObject({ captureId: z.uuid(), locale: LocaleSchema });
export type VoiceStartInput = z.infer<typeof VoiceStartInputSchema>;
// `accepted` once the backend took the command; every later outcome (permission, started, partials, final, error) is a
// `voice.event`. `path` names the helper for `helper_missing` and `helper_failed`, else null.
export const VoiceStartResultSchema = z.discriminatedUnion('accepted', [
  z.strictObject({ accepted: z.literal(true) }),
  z.strictObject({ accepted: z.literal(false), reason: z.enum(['busy', 'helper_missing', 'helper_failed', 'e2e_refused', 'cancelled']), path: z.string().nullable() }),
]);
export type VoiceStartResult = z.infer<typeof VoiceStartResultSchema>;

// The helper's own codes (the protocol, Design §1) plus main's two about the helper process itself.
export const VoiceErrorCodeSchema = z.enum([
  'microphone_denied', 'speech_denied', 'recognizer_unavailable', 'locale_unsupported', 'on_device_unavailable', 'audio_failed', 'recognition_failed',
  'helper_crashed', 'helper_failed', 'busy', 'bad_request',
]);
export type VoiceErrorCode = z.infer<typeof VoiceErrorCodeSchema>;

export const VoiceEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('permission'), captureId: z.string(), permission: VoicePermissionSchema }),
  z.strictObject({ kind: z.literal('started'), captureId: z.string(), locale: z.string() }),
  z.strictObject({ kind: z.literal('partial'), captureId: z.string(), text: z.string() }),
  z.strictObject({ kind: z.literal('final'), captureId: z.string(), text: z.string(), timedOut: z.boolean() }),
  z.strictObject({ kind: z.literal('cancelled'), captureId: z.string() }),
  z.strictObject({ kind: z.literal('error'), captureId: z.string(), code: VoiceErrorCodeSchema, message: z.string() }),
]);
export type VoiceEvent = z.infer<typeof VoiceEventSchema>;

export const VoicePrivacyPaneSchema = z.enum(['microphone', 'speech']);
export type VoicePrivacyPane = z.infer<typeof VoicePrivacyPaneSchema>;

export const commands = {
  'voice.status': { input: z.strictObject({ locale: LocaleSchema }), output: VoiceStatusSchema, owner: 'main' },
  'voice.start': { input: VoiceStartInputSchema, output: VoiceStartResultSchema, owner: 'main' },
  'voice.stop': { input: z.strictObject({ captureId: z.string() }), output: z.void(), owner: 'main' },
  'voice.cancel': { input: z.strictObject({ captureId: z.string() }), output: z.void(), owner: 'main' },
  'voice.openPrivacySettings': { input: z.strictObject({ pane: VoicePrivacyPaneSchema }), output: z.void(), owner: 'main' },
} as const satisfies Record<`voice.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = { 'voice.event': VoiceEventSchema } as const satisfies Record<`voice.${string}`, z.ZodType>;
