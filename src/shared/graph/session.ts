// X1 session record (charter §13 X1; C1 execution document, Interfaces "X1 — session record and attention item").
import * as z from 'zod';
import { AnchorSchema } from '../anchor/anchor'; // E3: X10, carried by a side thread's lineage
import { AutoModeRefusalCodeSchema, PermissionModeSchema, TITLE_SOURCES } from './enums';
import { AppSessionIdSchema, MessageUuidSchema, ProjectIdSchema, SessionIdSchema } from './ids';
import { JsonValueSchema } from '../ipc/schema/common'; // P5 O7 M4: `launchedBy.action`, a JSON value
import { ObservedRouteSchema, RouteSchema } from '../engine/route'; // P5 O7 M9

// Requested versus effective permission mode with the refusal code when they differ (D-18): `refusal` is null exactly
// when the request was honoured, and one of AUTO_MODE_REFUSAL_CODES exactly when it was not. Both the silent downgrade
// (`auto` → `default`, refusal null) and the refusal that did not happen (`auto` → `auto`, refusal set) are rejected.
export const SessionPermissionModeSchema = z
  .strictObject({ requested: PermissionModeSchema, effective: PermissionModeSchema, refusal: AutoModeRefusalCodeSchema.nullable() })
  .refine((pm) => (pm.requested === pm.effective) === (pm.refusal === null), {
    path: ['refusal'],
    message: 'refusal must be null exactly when requested equals effective',
  });

const TerminalHolderSchema = z.strictObject({ kind: z.literal('terminal'), pid: z.number().int() });
const BackgroundJobHolderSchema = z.strictObject({ kind: z.literal('background_job'), pid: z.number().int().nullable(), jobId: z.string().nullable() });
// A process other than MAWS's that holds the session (D-12's foreign-live holders).
export const ForeignHolderSchema = z.discriminatedUnion('kind', [TerminalHolderSchema, BackgroundJobHolderSchema]);
export type ForeignHolder = z.infer<typeof ForeignHolderSchema>;

export const SessionHolderSchema = z.discriminatedUnion('kind', [
  // W7 (charter §4.3 as amended 2026-10-01): `contestedBy` names a foreign process that holds the session too while
  // MAWS's own process runs it (the contested state); absent, MAWS alone holds it.
  z.strictObject({ kind: z.literal('self'), contestedBy: ForeignHolderSchema.optional() }),
  TerminalHolderSchema,
  BackgroundJobHolderSchema,
  z.strictObject({ kind: z.literal('none') }),
]);

// X11, lineage (P1 spec §10 X11; E3 execution document, Interfaces "X11"): what a session was forked from. Filled from
// the launch intent for MAWS's own forks (a side thread, C10's Fork) and from the disk rule for a `--fork-session` copy
// MAWS did not launch (A-16: a transcript repeating another's root uuid, drawn as a fork of the family's original).
export const LineageSchema = z.strictObject({
  kind: z.enum(['side-thread', 'fork']),
  parentAppSessionId: AppSessionIdSchema,
  parentEngineSessionId: SessionIdSchema.nullable(), // null only for a disk-derived fork whose original has no engine id yet (never in practice; kept nullable so a record never fails to load)
  anchor: AnchorSchema.optional(), // a comment-opened side thread; absent for 'btw' and 'fork'
  openedBy: z.enum(['comment', 'btw', 'fork']),
});
export type Lineage = z.infer<typeof LineageSchema>;

// P5 O7 M4 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, Interfaces §O): who started a session from another
// machine, written by `session.spawn`'s handler from the claim `machine.op` ran it under: the member and device the
// endpoint verified, the act's op id, and the sealed spawn action as the device sent it (step-up signature included),
// which O12's lane B observer reads to claim the member as the session's owner with the action as RL9's proof. Absent for
// every session started on its own machine.
export const LaunchedBySchema = z.strictObject({ member: z.string().min(1), device: z.string().min(1), opId: z.string().min(1), action: JsonValueSchema });
export type LaunchedBy = z.infer<typeof LaunchedBySchema>;

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
  // P5 O7 M9 (Interfaces §U): `route`, the route the session launched on, read before `routed` (src/shared/engine/route.ts's
  // readRecordedRoute), and `observed`, what get_status reported of its inference, named. `routed` stays written: true
  // when the session was observed through ClaudeUsage, so an older reader resuming it reaches the same inference.
  gateway: z.strictObject({ routed: z.boolean().nullable(), baseUrl: z.string().nullable(), autoModeServer: z.enum(['enabled', 'disabled', 'unknown']), route: RouteSchema.optional(), observed: ObservedRouteSchema.optional() }),
  // C3 end
  model: z.strictObject({ requested: z.string().nullable(), resolved: z.string().nullable() }),
  effort: z.string().nullable(),
  permissionMode: SessionPermissionModeSchema,
  lineage: LineageSchema.nullable(), // X11 (E3); null for a root session
  launchedBy: LaunchedBySchema.optional(), // P5 O7 M4: a remote spawn's requester and its signed action
  // UX wave U8c-2 (§D): two facts beside the fields build F's record carries, which keep build F's meaning (the folder the
  // engine files the session under). Written only by the index, each only while it differs from what those fields say,
  // and read only through the selector (src/shared/sessions/working-folder.ts): the folder the session was launched in,
  // while the engine files it elsewhere in the same repository; and where the main loop is, while that is not the filed
  // folder or the directory (the root of the work tree it is in, or the launch folder inside the launch folder's own work
  // tree; its realpath; the branch recorded for that checkout; whether the checkout is a linked worktree)
  launchFolder: z.string().optional(),
  agentFolder: z.strictObject({ checkout: z.string(), cwd: z.string(), branch: z.string().nullable(), linked: z.boolean() }).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SessionRecord = z.infer<typeof SessionRecordSchema>;

// P5 O8 M6a (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §P): what `session.reader.update`
// answers, a reader's own pinned, lastSeen and unread, and nothing else of the record (never its paths, settings or a
// spawn's signed act, which a `list` caller must not read). The renderer applies it to the record it holds.
export const ReaderStateSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  pinned: SessionRecordSchema.shape.pinned,
  lastSeen: SessionRecordSchema.shape.lastSeen,
  unread: SessionRecordSchema.shape.unread,
});
export type ReaderState = z.infer<typeof ReaderStateSchema>;

export const readerStateOf = (record: SessionRecord): ReaderState => ({ appSessionId: record.appId, pinned: record.pinned, lastSeen: record.lastSeen, unread: record.unread });
