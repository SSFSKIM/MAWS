// X1 session record (charter §13 X1; C1 execution document, Interfaces "X1 — session record and attention item").
import * as z from 'zod';
import { AutoModeRefusalCodeSchema, PermissionModeSchema, TITLE_SOURCES } from './enums';
import { AppSessionIdSchema, MessageUuidSchema, ProjectIdSchema, SessionIdSchema } from './ids';

// Requested versus effective permission mode with the refusal code when they differ (D-18): `refusal` is null exactly
// when the request was honoured, and one of AUTO_MODE_REFUSAL_CODES exactly when it was not. Both the silent downgrade
// (`auto` → `default`, refusal null) and the refusal that did not happen (`auto` → `auto`, refusal set) are rejected.
export const SessionPermissionModeSchema = z
  .strictObject({ requested: PermissionModeSchema, effective: PermissionModeSchema, refusal: AutoModeRefusalCodeSchema.nullable() })
  .refine((pm) => (pm.requested === pm.effective) === (pm.refusal === null), {
    path: ['refusal'],
    message: 'refusal must be null exactly when requested equals effective',
  });

export const SessionHolderSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('self') }),
  z.strictObject({ kind: z.literal('terminal'), pid: z.number().int() }),
  z.strictObject({ kind: z.literal('background_job'), pid: z.number().int().nullable(), jobId: z.string().nullable() }),
  z.strictObject({ kind: z.literal('none') }),
]);

export const SessionRecordSchema = z.strictObject({
  appId: AppSessionIdSchema,
  engineSessionId: SessionIdSchema.nullable(), // null until the first frame carrying session_id
  projectId: ProjectIdSchema.nullable(),
  directory: z.string(), // realpath, from the first JSONL record (§4.3)
  additionalDirectories: z.array(z.string()),
  worktree: z.strictObject({ path: z.string(), branch: z.string().nullable() }).nullable(),
  branch: z.string().nullable(),
  title: z.strictObject({ text: z.string(), source: z.enum(TITLE_SOURCES) }),
  pinned: z.boolean(),
  archived: z.boolean(),
  holder: SessionHolderSchema,
  lastSeen: z.strictObject({ messageUuid: MessageUuidSchema.nullable(), at: z.string().nullable() }),
  unread: z.boolean(),
  engineVersion: z.string().nullable(),
  // C3 start: the auto-mode lanes in the session record (C3 execution document, "X1 extension"; additive, flagged to the
  // coordinator): `baseUrl` from get_status's `Anthropic base URL` row, `autoModeServer` from its `Auto mode server` row.
  // `routed` is C3's verification (`get_status`'s base URL against the relay's) and null until one ran: the state of every
  // session MAWS discovered on disk and did not launch (X1 amended, wave 1). C4 fills `null` / `null` / `unknown` for those.
  gateway: z.strictObject({ routed: z.boolean().nullable(), baseUrl: z.string().nullable(), autoModeServer: z.enum(['enabled', 'disabled', 'unknown']) }),
  // C3 end
  model: z.strictObject({ requested: z.string().nullable(), resolved: z.string().nullable() }),
  effort: z.string().nullable(),
  permissionMode: SessionPermissionModeSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SessionRecord = z.infer<typeof SessionRecordSchema>;
