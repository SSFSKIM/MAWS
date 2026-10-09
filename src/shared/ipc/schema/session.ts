// X2 `session.*` (charter §12 C1 *IPC registry composition*). Each child adds its entries as one delimited block and
// spreads it into the exported registries; C3's block is the engine host's per-session surface.
import * as z from 'zod';
import { SURFACE_VALUE_MAX } from '../../engine/surface';
// C3 start: the engine host's `session.*` commands and events (C3 execution document, Interfaces "X2 — commands and
// events"). Owner engine-host; every input names the session `appSessionId`. Each command is one of the three deadline
// shapes (immediate, bounded under 8 s, operation), named per command in src/engine-host/ipc.ts.
import { AttentionItemSchema } from '../../graph/attention';
import { AutoModeRefusalCodeSchema, PermissionModeSchema } from '../../graph/enums';
import { SessionEventSchema } from '../../graph/events';
import { AppSessionIdSchema, MessageUuidSchema, RequestIdSchema, TaskIdSchema } from '../../graph/ids';
import { RequestAnswerSchema } from '../../engine/answers';
import { EffortSchema, LaunchSpecSchema } from '../../engine/launch-spec';
import { OperationEventSchema, OperationReceiptSchema } from '../../engine/operations';
import { RelayHealthSchema } from '../../engine/relay-health';
import { RewindFilesOutcomeSchema, RewindOutcomeSchema } from '../../engine/rewind-outcome';
import { PendingSteerSchema, QueueEntrySchema, QueuePauseReasonSchema, QueueStateSchema, SendContentSchema } from '../../engine/session-state-store'; // C7: QueuePauseReasonSchema; W1: PendingSteerSchema
import { EngineSessionStatusSchema } from '../../engine/status';
import {
  ExportConversationResponseSchema,
  GetBinaryVersionResponseSchema,
  GetContextUsageResponseSchema,
  GetHooksListingResponseSchema,
  GetMemoryDialogResponseSchema,
  GetSandboxDialogResponseSchema,
  GetSessionCostResponseSchema,
  GetSettingsResponseSchema,
  GetSkillsDialogResponseSchema,
  GetStatusResponseSchema,
  GetUsageResponseSchema,
  GetWorkspaceDiffResponseSchema,
  ListModelsResponseSchema,
  ListPermissionRulesResponseSchema,
  McpStatusResponseSchema,
  SetCwdResponseSchema,
} from '../../wire/control';
// C3 end
// C4 start: the record side, projects, drafts and replay (C4 execution document, Interfaces "X2 additions")
// (AppSessionIdSchema and MessageUuidSchema come with C3's imports above.)
import { ProjectIdSchema, SessionIdSchema } from '@shared/graph/ids';
import { ForeignHolderSchema, SessionRecordSchema } from '@shared/graph/session';
// C4 end
// C7 start: the composer's prompt history shapes (C7 execution document, Interfaces "X2 additions")
import { HistoryEntrySchema, PastedContentSchema } from '../../composer/history-entry';
// C7 end
// C10 start (AppSessionIdSchema, MessageUuidSchema, EffortSchema come with C3's imports above; ProjectIdSchema and
// SessionRecordSchema with C4's)
import { SessionHolderSchema } from '@shared/graph/session';
import { FirstMessageSchema, ForkTargetSchema, LocationSchema, SetupIntentPatchSchema, SetupIntentSchema, TrustDecisionSchema } from '../../sessions/intent';
import { SetupEventSchema, SetupResourcesSchema, StartOutcomeSchema } from '../../sessions/setup';
import { TrustStateSchema } from '../../sessions/trust';
// C10 end
import type { CommandSpec } from './common';
// R2 start
import { PaneRosterSchema, RenderAnswerSchema, ScrollSiteSchema, SURFACE_SITES, SurfaceAnswerSchema, SurfaceElementSchema, SurfaceViewportSchema } from '../../engine/surface';
// R2 end

// C3 start
const input = <S extends z.ZodRawShape>(shape: S) => z.strictObject({ appSessionId: AppSessionIdSchema, ...shape });
const host = <I extends z.ZodType, O extends z.ZodType>(i: I, o: O) => ({ input: i, output: o, owner: 'engine-host' as const });
const read = <O extends z.ZodType>(o: O) => host(input({}), o); // a structured read answers the typed response of the same name

// W13: `binary_version` is retired with the pin; a missing binary and one that prints no version are `binary_missing`.
export const LAUNCH_REFUSALS = ['already_live', 'binary_missing', 'replay_disabled', 'settings_conflict'] as const;
export const LaunchResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('launching'), session: EngineSessionStatusSchema }), // readiness arrives as session.status
  z.strictObject({ status: z.literal('relay_unreachable'), health: RelayHealthSchema }),
  z.strictObject({ status: z.literal('refused'), reason: z.enum(LAUNCH_REFUSALS), message: z.string() }),
]);
export type LaunchResult = z.infer<typeof LaunchResultSchema>;

export const EventsSnapshotSchema = z.strictObject({ events: z.array(SessionEventSchema), lastSeq: z.number().int(), complete: z.boolean() });
export type EventsSnapshot = z.infer<typeof EventsSnapshotSchema>;

// C7's `session.catalog` (coordinator, C7's asks): the engine's command catalogue as the wire carries it.
export const CatalogSchema = z.strictObject({
  commands: z.array(z.unknown()), agents: z.array(z.unknown()), skills: z.array(z.unknown()), terminalSlashCommands: z.array(z.unknown()), revision: z.number().int(),
});

const MemoryTargetSchema = z.strictObject({ kind: z.enum(['user', 'project', 'path']), path: z.string().nullable() });
const MessageUuidOutput = z.strictObject({ messageUuid: MessageUuidSchema });

const c3Commands = {
  // lifecycle and state
  // P2-E1 start (2026-10-09): `artifactScope`, a side thread's ancestors nearest first (D10), a sibling of the spec so the
  // host never stores it (the stored spec's strict reader in an older build would move the state file aside)
  'session.launch': host(z.strictObject({ spec: LaunchSpecSchema, artifactScope: z.array(AppSessionIdSchema).max(16).optional() }), LaunchResultSchema),
  // P2-E1 end
  'session.status': host(input({}), EngineSessionStatusSchema),
  'session.events': host(input({ afterSeq: z.number().int().nullable(), limit: z.number().int().positive().nullable() }), EventsSnapshotSchema),
  // W7: `ifIdle` stops only while the process could end without losing work (`canYield`, decided in the host in the same
  // step as the stop); otherwise nothing happens and the answer says `skipped`
  'session.stop': host(input({ reason: z.enum(['stop', 'archive']), ifIdle: z.boolean().optional() }), z.strictObject({ exited: z.boolean(), code: z.number().int().nullable(), signal: z.string().nullable(), skipped: z.literal(true).optional() })),
  'session.pendingRequest': host(input({ requestId: RequestIdSchema }), z.strictObject({ event: SessionEventSchema.nullable() })),
  'session.catalog': host(input({}), CatalogSchema),
  // the composer: sends, the app queue, steer, interrupt, answers, `!` and `#`
  'session.send': host(input({ content: SendContentSchema }), z.strictObject({ messageUuid: MessageUuidSchema.nullable(), disposition: z.enum(['sent', 'queued']), queueId: z.string() })),
  // priority on 2.1.283: 'now' (the default; "Send now") preempts the running turn; 'next' (Enter while a turn runs, W1) folds into it at its next tool boundary (pass3/steer-next)
  'session.steer': host(input({ content: SendContentSchema, priority: z.enum(['now', 'next']).optional() }), MessageUuidOutput),
  // W1: "Hold until the turn ends" on a pending `next` steer: withdrawn from the engine (`cancel_async_message`) into the app queue's end; refused once the engine started it (pass3/steer-next-cancelled)
  'session.queue.hold': host(input({ messageUuid: MessageUuidSchema }), QueueEntrySchema),
  'session.queue.list': host(input({}), QueueStateSchema),
  'session.queue.edit': host(input({ queueId: z.string(), content: SendContentSchema }), QueueEntrySchema),
  'session.queue.remove': host(input({ queueId: z.string() }), z.void()),
  // steers a queued entry out of the app queue with steer's priority ('now' when absent; C7's composer picks 'next' to fold it in)
  'session.queue.promote': host(input({ queueId: z.string(), priority: z.enum(['now', 'next']).optional() }), MessageUuidOutput),
  'session.queue.setPaused': host(input({ paused: z.boolean() }), z.void()),
  // W1: `holdEngineQueued` (the plain stop: ⌘., the Stop button, a route switch) first holds every waiting `next` steer in the app queue, so nothing runs after the interrupt
  'session.interrupt': host(input({ cancelEngineQueued: z.boolean(), holdEngineQueued: z.boolean().optional() }), z.strictObject({ stillQueued: z.array(z.string()), cancelled: z.array(z.string()) })),
  'session.answer': host(input({ requestId: RequestIdSchema, answer: RequestAnswerSchema }), z.strictObject({ outcome: z.enum(['delivered', 'not_pending', 'write_failed']) })),
  'session.bash': host(input({ command: z.string().min(1) }), z.strictObject({ commandUuid: MessageUuidSchema })),
  'session.memoryAppend': host(input({ text: z.string().min(1).max(65_536) /* 64 KiB: the synchronous commit stays bounded (M5 re-review) */, target: MemoryTargetSchema }), z.strictObject({ path: z.string(), created: z.boolean() })),
  // mutations
  'session.setPermissionMode': host(input({ mode: PermissionModeSchema }), z.strictObject({ effective: PermissionModeSchema, refusal: AutoModeRefusalCodeSchema.nullable(), error: z.string().nullable() })),
  'session.setModel': host(input({ model: z.string().nullable() }), z.strictObject({ ok: z.boolean(), error: z.string().nullable(), code: z.string().nullable() })),
  'session.setEffort': host(input({ effort: EffortSchema.nullable() }), z.void()),
  'session.setThinking': host(input({ maxThinkingTokens: z.number().int().nonnegative().nullable(), display: z.enum(['summarized', 'omitted', 'highlights']).nullable() }), z.void()),
  'session.applyFlagSettings': host(input({ settings: z.record(z.string(), z.unknown()) }), z.void()),
  'session.stopTask': host(input({ taskId: TaskIdSchema }), z.void()),
  'session.rewind': host(input({ targetMessageUuid: MessageUuidSchema, lastSeenMessageUuid: MessageUuidSchema, files: z.boolean() }), RewindOutcomeSchema),
  'session.rewindFiles': host(input({ userMessageUuid: MessageUuidSchema, dryRun: z.boolean() }), RewindFilesOutcomeSchema),
  'session.setCwd': host(input({ path: z.string(), trust: z.strictObject({ accepted: z.literal(true), directory: z.string() }).nullable() }), SetCwdResponseSchema),
  'session.renameSession': host(input({ title: z.string() }), z.void()),
  // operations: a receipt at the flushed write, completion through session.operation
  'session.generateTitle': host(input({ description: z.string(), persist: z.boolean() }), OperationReceiptSchema),
  'session.reloadPlugins': host(input({}), OperationReceiptSchema),
  'session.mcpReconnect': host(input({ serverName: z.string() }), OperationReceiptSchema),
  'session.mcpToggle': host(input({ serverName: z.string(), enabled: z.boolean() }), OperationReceiptSchema),
  'session.sideQuestion': host(input({ question: z.string(), retryOf: z.string().optional() }), OperationReceiptSchema), // E11: retryOf, the failed log entry a Retry asks again
  // structured reads
  'session.getUsage': read(GetUsageResponseSchema),
  'session.getContextUsage': host(input({ detail: z.enum(['summary', 'full']) }), GetContextUsageResponseSchema),
  'session.getSettings': read(GetSettingsResponseSchema),
  'session.listPermissionRules': read(ListPermissionRulesResponseSchema),
  'session.getHooksListing': read(GetHooksListingResponseSchema),
  'session.getMemoryDialog': read(GetMemoryDialogResponseSchema),
  'session.getSkillsDialog': read(GetSkillsDialogResponseSchema),
  'session.getSandboxDialog': read(GetSandboxDialogResponseSchema),
  'session.getWorkspaceDiff': read(GetWorkspaceDiffResponseSchema),
  'session.exportConversation': read(ExportConversationResponseSchema),
  'session.getStatus': read(GetStatusResponseSchema),
  'session.mcpStatus': read(McpStatusResponseSchema),
  'session.listModels': read(ListModelsResponseSchema),
  'session.getSessionCost': read(GetSessionCostResponseSchema),
  'session.getBinaryVersion': read(GetBinaryVersionResponseSchema),
} as const;

const c3Events = {
  'session.eventBatch': z.strictObject({ appSessionId: AppSessionIdSchema, events: z.array(SessionEventSchema).max(500) }), // batched per session every 16 ms; C4 emits the same for backfill and replay
  'session.status': z.strictObject({ appSessionId: AppSessionIdSchema, status: EngineSessionStatusSchema }),
  'session.queue': z.strictObject({
    appSessionId: AppSessionIdSchema, entries: z.array(QueueEntrySchema), paused: z.boolean(), pauseReason: QueuePauseReasonSchema.nullable().optional(), // C7: pauseReason
    steers: z.array(PendingSteerSchema).optional(), withdrawn: z.array(MessageUuidSchema).optional(), // W1
  }),
  'session.brokerItems': z.strictObject({ appSessionId: AppSessionIdSchema, items: z.array(AttentionItemSchema) }), // internal: main's attention service
  'session.operation': OperationEventSchema,
  'session.forgotten': z.strictObject({ appSessionId: AppSessionIdSchema }), // internal (M5 review): archived or forgotten, live or exited; main's attention service retires the session
} as const;

export const C3_SESSION_COMMANDS = Object.keys(c3Commands) as (keyof typeof c3Commands)[];
export const C3_SESSION_EVENTS = Object.keys(c3Events) as (keyof typeof c3Events)[];
// C3 end

// C4 start ------------------------------------------------------------------------------------------------------------
// The record side of the index in main (C4 execution document, Interfaces "X2 additions", `session.ts`): records,
// projects and drafts, owner main. Every command naming an app session id with no index row fails with `internal`
// `unknown app session: <id>`, except `session.get`, which answers null (an unstarted tab has an id and no row yet).
// Replay (M5): `session.replay.start` and `.fixtures` in main, `.launch` and `.control` in the engine host, which runs
// the replay (`.control` for an id the host knows nothing of is a no-op), and its `session.replay.progress`.

// C5's project shape (C5 execution document, "Main modules"), defined here and imported by C5: the `projects` row
// projected, `order` being its sort order. W11 (I5, additive): `hidden` is true for a project removed from the sidebar
// (`session.projects.remove`), absent otherwise; the list and its change event carry hidden projects so the renderer
// can keep them and their sessions out of the sidebar and offer them under "Hidden projects…".
export const ProjectRecordSchema = z.strictObject({
  id: ProjectIdSchema,
  name: z.string(),
  directory: z.string(),
  order: z.number().int(),
  createdAt: z.string(),
  hidden: z.boolean().optional(),
});
export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;

// Every field optional, at least one present. `title` sets the MAWS-side override of the Title rule (`null` clears it);
// `generated` is never set by MAWS. "Mark all read" is `unread: false` plus `lastSeen`.
export const SessionPatchSchema = z
  .strictObject({
    title: z.strictObject({ text: z.string(), source: z.enum(['user', 'tool']) }).nullable().optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
    unread: z.boolean().optional(),
    lastSeen: z.strictObject({ messageUuid: MessageUuidSchema.nullable(), at: z.string() }).optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), { message: 'a patch sets at least one field' });
export type SessionPatch = z.infer<typeof SessionPatchSchema>;

// A composer draft: C7's Tiptap document, opaque here, and its attachments.
export const DraftSchema = z.strictObject({
  doc: z.unknown(),
  attachments: z.array(z.strictObject({ path: z.string(), kind: z.string() })),
  updatedAt: z.string(),
});
export type Draft = z.infer<typeof DraftSchema>;

// A replay fixture the index lists (M5 seeds and plays them).
export const ReplayFixtureSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['journal', 'transcript']),
  path: z.string(),
  sessionId: z.string().nullable(),
  addedAt: z.string(),
  lastPlayedAt: z.string().nullable(),
});
export type ReplayFixture = z.infer<typeof ReplayFixtureSchema>;

// Replay (M5; X8): a probe journal or a transcript JSONL, by absolute path, at 0.25× to 50× or everything at once.
export const ReplaySourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('journal'), path: z.string().refine((path) => path.startsWith('/'), 'an absolute path') }),
  z.strictObject({ kind: z.literal('transcript'), path: z.string().refine((path) => path.startsWith('/'), 'an absolute path') }),
]);
export type ReplaySource = z.infer<typeof ReplaySourceSchema>;
export const SpeedSchema = z.union([z.number().min(0.25).max(50), z.literal('instant')]);
export type Speed = z.infer<typeof SpeedSchema>;
export const REPLAY_STATES = ['running', 'paused', 'done', 'stopped', 'error'] as const;
export const ReplayProgressSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  state: z.enum(REPLAY_STATES),
  index: z.number().int(), // rows (journal) or chain records (transcript) played so far
  total: z.number().int(),
  at: z.string().nullable(), // the recorded time of the last row played
  speed: SpeedSchema,
  message: z.string().nullable(),
});
export type ReplayProgress = z.infer<typeof ReplayProgressSchema>;

export const SESSION_CHANGE_CAUSES = ['discovered', 'facts', 'holder', 'update', 'live', 'replay'] as const;
export type SessionChangeCause = (typeof SESSION_CHANGE_CAUSES)[number];

const appSession = z.strictObject({ appSessionId: AppSessionIdSchema });
const c4Commands = {
  'session.list': {
    input: z.strictObject({ includeArchived: z.boolean().optional() }),
    output: z.strictObject({ sessions: z.array(SessionRecordSchema), revision: z.number().int() }),
    owner: 'main',
  },
  'session.get': { input: appSession, output: SessionRecordSchema.nullable(), owner: 'main' },
  // pin, archive, mark read, C10's rename with provenance
  'session.update': { input: z.strictObject({ appSessionId: AppSessionIdSchema, patch: SessionPatchSchema }), output: SessionRecordSchema, owner: 'main' },
  'session.projects.list': { input: z.void(), output: z.strictObject({ projects: z.array(ProjectRecordSchema), revision: z.number().int() }), owner: 'main' },
  // realpathed; an existing directory is required; origin 'user'
  'session.projects.add': { input: z.strictObject({ directory: z.string() }), output: ProjectRecordSchema, owner: 'main' },
  'session.projects.update': {
    input: z.strictObject({ id: ProjectIdSchema, patch: z.strictObject({ name: z.string().optional(), order: z.number().int().optional() }) }),
    output: ProjectRecordSchema,
    owner: 'main',
  },
  // hides; rediscovery does not resurrect it
  'session.projects.remove': { input: z.strictObject({ id: ProjectIdSchema }), output: z.void(), owner: 'main' },
  'session.drafts.get': { input: appSession, output: DraftSchema.nullable(), owner: 'main' },
  'session.drafts.set': { input: z.strictObject({ appSessionId: AppSessionIdSchema, draft: DraftSchema.nullable() }), output: z.void(), owner: 'main' },
  // Main allocates the ids and the `kind: 'replay'` record, then dispatches session.replay.launch; a failed launch
  // removes the record again and fails with the launch's error (a `timeout` also cancels the launch on the host).
  'session.replay.start': {
    input: z.strictObject({ source: ReplaySourceSchema, speed: SpeedSchema }),
    output: z.strictObject({ appSessionId: AppSessionIdSchema, sessionId: SessionIdSchema, totalRows: z.number().int(), spanMs: z.number() }),
    owner: 'main',
  },
  // The host-side start: loads and validates the source and binds the ids before any event; fails `internal` otherwise.
  'session.replay.launch': {
    input: z.strictObject({ appSessionId: AppSessionIdSchema, sessionId: SessionIdSchema, source: ReplaySourceSchema, speed: SpeedSchema }),
    output: z.strictObject({ totalRows: z.number().int(), spanMs: z.number() }),
    owner: 'engine-host',
  },
  // Also main's cancel of a launch in flight; an id the host knows nothing of is a no-op.
  'session.replay.control': {
    input: z.strictObject({ appSessionId: AppSessionIdSchema, action: z.enum(['pause', 'resume', 'stop']).optional(), speed: SpeedSchema.optional() }),
    output: z.void(),
    owner: 'engine-host',
  },
  'session.replay.fixtures': { input: z.void(), output: z.strictObject({ fixtures: z.array(ReplayFixtureSchema) }), owner: 'main' },
} as const satisfies Record<`session.${string}`, CommandSpec<z.ZodType, z.ZodType>>;
// `revision` is one index-wide counter bumped on every session or project change; a consumer keeps the higher of
// snapshot and event (C5's rule).
const c4Events = {
  'session.changed': z.strictObject({ record: SessionRecordSchema, cause: z.enum(SESSION_CHANGE_CAUSES), revision: z.number().int() }),
  'session.removed': z.strictObject({ appSessionId: AppSessionIdSchema, revision: z.number().int() }),
  // the whole list, for C5's project tree (wave-2 ledger, d.6)
  'session.projects.changed': z.strictObject({ projects: z.array(ProjectRecordSchema), revision: z.number().int() }),
  // every 25 rows and on every state or speed change of a replay run
  'session.replay.progress': ReplayProgressSchema,
} as const satisfies Record<`session.${string}`, z.ZodType>;
// C4 end --------------------------------------------------------------------------------------------------------------

// C5 start: the read side the shell adds (C5 execution document, Interfaces "X2 — session.*, read side"): the digest
// of live facts and the visibility report C4's unread rule needs. Owner main.
export const SESSION_PHASES = ['starting', 'working', 'waiting', 'idle', 'exited', 'failed', 'foreign'] as const;
// working: a turn is running · waiting: the turn is blocked on a pending request · idle: process live, no turn
// exited: no live process (resumable from disk) · failed: the last turn or the process ended in error and nothing ran since
// foreign: holder is a terminal or background job (D-12) · starting: process launching, no turn yet
export type SessionPhase = (typeof SESSION_PHASES)[number];
export const SessionDigestSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  phase: z.enum(SESSION_PHASES),
  activity: z.string().nullable(),            // while working: "Running bun test", "Editing src/app.ts", "Thinking", "Compacting"; else null
  lastAssistantLine: z.string().nullable(),   // first line of the latest completed assistant text block, ≤ 160 chars
  turnStartedAt: z.string().nullable(), lastTurnEndedAt: z.string().nullable(),
  context: z.strictObject({ percent: z.number(), totalTokens: z.number().int(), maxTokens: z.number().int(), autoCompactThreshold: z.number().int().nullable() }).nullable(),
  cost: z.strictObject({ totalUsd: z.number(), sinceSeenUsd: z.number() }).nullable(),
  childAgents: z.strictObject({ active: z.number().int(), done: z.number().int() }),
  pendingRequests: z.number().int(),
  revision: z.number().int(),                 // per session, monotonic; a consumer keeps the higher of snapshot and event
  // C12 start: the memory budget's released mark (charter §4.4; D1): the session's last exit was a release, and it has
  // not launched, been archived, or been taken by a terminal or background job since. Absent means not released. Main's
  // in-memory state of this app run (D-16), never persisted; the phase reads `idle` while it is set.
  // E10: `reason` tells the budget's release from the supervisor's idle release (no app connected), whose `limitKiB` is
  // null: the renderer words the two apart.
  released: z.strictObject({ at: z.string(), reason: z.enum(['budget', 'idle']), limitKiB: z.number().int().nullable() }).optional(),
  // C12 end
});
export type SessionDigest = z.infer<typeof SessionDigestSchema>;

const c5Commands = {
  'session.digests':    { input: z.void(), output: z.strictObject({ digests: z.array(SessionDigestSchema) }), owner: 'main' },   // snapshot for a page that missed the events
  'session.setVisible': { input: z.strictObject({ appSessionId: AppSessionIdSchema, visible: z.boolean() }), output: z.void(), owner: 'main' },
  // The launch mode main decided at app ready (select-source.ts), so the page can register the scenario's session
  // creator in mode `scenario` (the owner's design 2026-09-28: the stub stands in for C10's `session.create`).
  'session.launchMode': { input: z.void(), output: z.strictObject({ mode: z.enum(['index', 'scenario']) }), owner: 'main' },
  // Debt wave 5 (additive X2, flagged to the architect): the events main synthesised for the session and keeps in its
  // read model (`isAppSynthesised`, as C10's route notice), oldest first, which no `session.events` snapshot carries.
  'session.appEvents': { input: z.strictObject({ appSessionId: AppSessionIdSchema }), output: z.strictObject({ events: z.array(SessionEventSchema) }), owner: 'main' },
} as const satisfies Record<`session.${string}`, CommandSpec<z.ZodType, z.ZodType>>;
const c5Events = {
  'session.digest': SessionDigestSchema,
} as const satisfies Record<`session.${string}`, z.ZodType>;
// C5 end --------------------------------------------------------------------------------------------------------------

// C7 start: the composer's additions (C7 execution document, Interfaces "X2 additions"). `session.catalogChanged` is the
// engine host's publication of C3's per-launch catalogue (the same `CatalogSchema` `session.catalog` answers), emitted
// whole whenever its revision moves; `revision` restarts with every launch, so a consumer keys it by `launchId`.
// `session.history.*` is main's: MAWS's own `<userData>/prompt-history.jsonl` and, read-only, the terminal's history.
const c7Commands = {
  'session.history.list': {
    input: z.strictObject({ appSessionId: AppSessionIdSchema, limit: z.number().int().positive().max(500) }),
    output: z.strictObject({ entries: z.array(HistoryEntrySchema) }),
    owner: 'main',
  },
  'session.history.append': {
    // project: the directory an unstarted session will run in (its setup intent's location); main files the row under it
    // only when the session has no record yet, so the first prompt of a new session is recalled there once it starts
    input: z.strictObject({ appSessionId: AppSessionIdSchema, display: z.string().min(1).max(65_536) /* a prompt as typed; the bodies ride in pastedContents */, pastedContents: z.record(z.string(), PastedContentSchema), project: z.string().nullable().optional() }),
    output: z.void(),
    owner: 'main',
  },
} as const satisfies Record<`session.${string}`, CommandSpec<z.ZodType, z.ZodType>>;
const c7Events = {
  'session.catalogChanged': z.strictObject({ appSessionId: AppSessionIdSchema, launchId: z.string(), catalog: CatalogSchema }),
} as const satisfies Record<`session.${string}`, z.ZodType>;
// C7 end --------------------------------------------------------------------------------------------------------------
// C10 start -----------------------------------------------------------------------------------------------------------
// Sessions, worktrees and trust (C10 execution document, "X2 additions"): the trust check (main: the trust reader over
// the engine's global config, read only), `session.forget` (the engine host: the state file and the journal, then
// `session.forgotten`; refused `already_live` while a process is reserved), and main's session service: the setup
// intent of an unstarted session, start (a setup, or a record's resume), fork, archive, delete and rename. A command
// answers synchronously only what is fast; a setup's phases stream as `session.setup` after `starting`.

// What `session.archive` answers: archived, refused for a foreign holder, or (`onlyIfIdle`, the cleanup dialog's step)
// skipped for a session live at the recheck, nothing stopped.
// W7: `session.takeOver`'s answer. `released`: the holder exited (or already had); the resume is the renderer's next
// `session.start`. `refused`: nothing more was done, for the reason in words.
export const TakeOverOutcomeSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('released') }),
  z.strictObject({ status: z.literal('resumed'), warning: z.string().nullable() }),
  z.strictObject({ status: z.literal('refused'), reason: z.enum(['unknown_session', 'self', 'changed', 'no_job_id', 'other_app', 'signal_failed', 'stop_failed', 'timeout', 'pause_failed', 'resume_failed']), message: z.string() }),
]);
export type TakeOverOutcome = z.infer<typeof TakeOverOutcomeSchema>;

export const ArchiveOutcomeSchema = z.union([
  z.strictObject({ archived: z.literal(true) }),
  z.strictObject({ status: z.literal('held'), holder: SessionHolderSchema }),
  z.strictObject({ status: z.literal('skipped_live'), holder: SessionHolderSchema }),
]);
export type ArchiveOutcome = z.infer<typeof ArchiveOutcomeSchema>;

// What `session.delete` answers: the conversation moved to the Trash whole, or a refusal with nothing moved, or a stop
// the host could not confirm (nothing moved), or a failure half-way (the transcript last, so the conversation stays
// discoverable; a retry re-enumerates).
export const DeleteOutcomeSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('deleted'), trashed: z.array(z.string()) }),
  z.strictObject({ status: z.literal('held'), holder: SessionHolderSchema }),
  z.strictObject({ status: z.literal('live') }),
  z.strictObject({ status: z.literal('stop_unconfirmed'), detail: z.string() }),
  z.strictObject({ status: z.literal('partial'), trashed: z.array(z.string()), failed: z.strictObject({ path: z.string(), error: z.string() }) }),
]);
export type DeleteOutcome = z.infer<typeof DeleteOutcomeSchema>;

// `model` and `effort` are a resume's overrides for that launch (C11's route switch); an intent's chips own them.
export const StartOptionsSchema = z.strictObject({
  gateway: z.enum(['gateway', 'direct']).optional(),
  trust: TrustDecisionSchema.optional(),
  model: z.string().nullable().optional(),
  effort: EffortSchema.nullable().optional(),
});
export type StartOptions = z.infer<typeof StartOptionsSchema>;

// What a delete meant to move and what it has moved, in move order (the transcript last).
export const DeletionManifestSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  engineSessionId: SessionIdSchema.nullable(),
  paths: z.array(z.string()),
  trashed: z.array(z.string()),
  createdAt: z.string(),
});
export type DeletionManifestView = z.infer<typeof DeletionManifestSchema>;

const appSessionC10 = z.strictObject({ appSessionId: AppSessionIdSchema });
const c10Commands = {
  'session.trust.check': { input: z.strictObject({ directory: z.string() }), output: TrustStateSchema, owner: 'main' },
  'session.forget': { input: appSessionC10, output: z.void(), owner: 'engine-host' },
  // the unstarted session: an app id and a persisted intent, nothing launched
  'session.create': {
    input: z.strictObject({ projectId: ProjectIdSchema.nullable(), location: LocationSchema.nullable() }),
    output: z.strictObject({ appSessionId: AppSessionIdSchema, intent: SetupIntentSchema }),
    owner: 'main',
  },
  'session.intent.get': { input: appSessionC10, output: SetupIntentSchema.nullable(), owner: 'main' },
  'session.intent.list': { input: z.void(), output: z.strictObject({ intents: z.array(SetupIntentSchema) }), owner: 'main' },
  // refused `invalid_input` naming the field; `internal` `starting` while a start is in flight, `retained_worktree` for a
  // location patch while a failed attempt's checkout is retained
  'session.intent.patch': { input: z.strictObject({ appSessionId: AppSessionIdSchema, patch: SetupIntentPatchSchema }), output: SetupIntentSchema, owner: 'main' },
  // the hand-back: `message` cleared, `draft` untouched; for a record's id, the message a resume retained behind its card
  // is dropped and the answer is null
  'session.intent.release': { input: appSessionC10, output: SetupIntentSchema.nullable(), owner: 'main' },
  'session.intent.discard': {
    input: appSessionC10,
    output: z.strictObject({ leftover: z.strictObject({ worktree: z.strictObject({ path: z.string(), branch: z.string().nullable() }) }).nullable() }),
    owner: 'main',
  },
  // the failure card's resolutions of a checkout a failed attempt created and kept: "Discard changes and remove" (the
  // acknowledged discard, then the branch step) or "Keep the worktree" (the location becomes that existing worktree)
  'session.intent.resolveWorktree': {
    input: z.strictObject({ appSessionId: AppSessionIdSchema, resolution: z.enum(['discard', 'keep']) }),
    output: z.strictObject({ intent: SetupIntentSchema, worktree: SetupResourcesSchema.shape.worktree.unwrap() }),
    owner: 'main',
  },
  // an intent: its setup; a record: a resume
  'session.start': {
    input: z.strictObject({ appSessionId: AppSessionIdSchema, message: FirstMessageSchema.nullable(), options: StartOptionsSchema }),
    output: StartOutcomeSchema,
    owner: 'main',
  },
  // the outcome's appSessionId is the fork's once it is allocated
  'session.fork': {
    input: z.strictObject({ appSessionId: AppSessionIdSchema, target: ForkTargetSchema, message: FirstMessageSchema.nullable(), rewindTo: MessageUuidSchema.nullable() }),
    output: StartOutcomeSchema,
    owner: 'main',
  },
  'session.archive': { input: z.strictObject({ appSessionId: AppSessionIdSchema, onlyIfIdle: z.boolean().optional() }), output: ArchiveOutcomeSchema, owner: 'main' },
  // W7 (D-12 as amended 2026-10-01): "Take over here": ends the holder the owner confirmed (`claude stop` for a `--bg`
  // job, SIGTERM to an interactive holder's verified pid) and waits for the registry to clear; on `released` the
  // renderer resumes the record with `session.start`
  'session.takeOverPane': { input: z.strictObject({ pid: z.number().int().positive() }), output: z.strictObject({ ptyId: z.string(), label: z.string() }).nullable(), owner: 'main' },
  'session.takeOver': { input: z.strictObject({ appSessionId: AppSessionIdSchema, holder: ForeignHolderSchema, paneId: z.string().nullable().optional() }), output: TakeOverOutcomeSchema, owner: 'main' },
  'session.delete': { input: z.strictObject({ appSessionId: AppSessionIdSchema, stopIfLive: z.boolean() }), output: DeleteOutcomeSchema, owner: 'main' },
  // validators never transform: the service trims; a title that is only whitespace is refused here
  'session.rename': {
    input: z.strictObject({ appSessionId: AppSessionIdSchema, title: z.string().max(200).refine((title) => title.trim().length > 0, 'a title is not empty') }),
    output: z.strictObject({ record: SessionRecordSchema, via: z.enum(['engine', 'override']) }),
    owner: 'main',
  },
  'session.revealPath': { input: z.strictObject({ path: z.string() }), output: z.void(), owner: 'main' },
  // (M4a) a delete interrupted half-way, found at start, offered in the session's tab: "Finish deleting" is
  // `session.delete` again; "Keep" drops the manifest and leaves every file that did not move where it is
  'session.deletions.list': { input: z.void(), output: z.strictObject({ manifests: z.array(DeletionManifestSchema) }), owner: 'main' },
  'session.deletions.keep': { input: appSessionC10, output: z.void(), owner: 'main' },
  // what `session.delete` would move, for its sheet (the transcript, null when already gone; its subagent transcripts;
  // its recordings; every path); nothing moves
  'session.deletions.preview': {
    input: appSessionC10,
    output: z.strictObject({ transcript: z.string().nullable(), subagents: z.number().int(), recordings: z.number().int(), paths: z.number().int(), store: z.string() }), // store: the config home the engine reads, `~`-abbreviated under the home directory
    owner: 'main',
  },
} as const satisfies Record<`session.${string}`, CommandSpec<z.ZodType, z.ZodType>>;
const c10Events = {
  'session.setup': SetupEventSchema,
  'session.intent.changed': z.strictObject({ appSessionId: AppSessionIdSchema, intent: SetupIntentSchema.nullable() }), // null when discarded or bound
} as const satisfies Record<`session.${string}`, z.ZodType>;
// C10 end -------------------------------------------------------------------------------------------------------------
// New chat start (2026-10-01; charter §5.1 and §5.4) ------------------------------------------------------------------
// "Open folder…" in a New chat's project picker: the picked folder (`layout.pickFiles`, kind directory) becomes a
// project by the membership rule (a worktree folds under its main checkout's project, created or made the user's and
// visible as `session.projects.add` does), answered with where a session there starts. Owner main.
const newChatCommands = {
  'session.projects.addFolder': {
    input: z.strictObject({ directory: z.string() }),
    output: z.strictObject({ project: ProjectRecordSchema, location: LocationSchema }),
    owner: 'main',
  },
} as const satisfies Record<`session.${string}`, CommandSpec<z.ZodType, z.ZodType>>;
// New chat end ----------------------------------------------------------------------------------------------------------

// R2 start (charter D-9 as amended 2026-10-01; the waves plan's R2 rulings) ---------------------------------------------
// The renderer's asks of the engine's remote surface, owner engine-host, each a control round trip on the session's
// attached client (`ui_*` with `surface: "desktop"` and the host's client id) under the bounded 8 s budget, except
// `session.ui.answer`, which writes the renderer's answer to one of the engine's requests (`plugin.ask`) at once. An
// element is named by the `plugin` and `handle` its latest drawing carried (`press`), and by its `key`, site and instance
// so a field redrawn under typing is re-resolved. A session not attached (no `ui_surface_v1`) answers `internal`.
const ElementRefSchema = z.strictObject({ plugin: z.string(), handle: z.number().int() });
const KeyedSchema = z.array(z.strictObject({ plugin: z.string(), key: z.string(), top: z.number().int().nonnegative(), bottom: z.number().int().nonnegative() })).max(512);
const r2Commands = {
  'session.ui.render': host(
    input({ component: z.enum(SURFACE_SITES), instanceId: z.string().min(1).max(256), props: z.record(z.string(), z.unknown()), viewport: SurfaceViewportSchema.optional(), contentRows: z.number().int().nonnegative().optional(), keyed: KeyedSchema.optional() }),
    RenderAnswerSchema,
  ),
  'session.ui.press': host(input({ ...ElementRefSchema.shape, key: z.string().optional(), href: z.string().max(2048).optional() }), z.strictObject({ handled: z.boolean(), element: z.string().nullable() })),
  'session.ui.input': host(
    input({ ...ElementRefSchema.shape, kind: z.enum(['change', 'submit']), value: z.string().max(SURFACE_VALUE_MAX), key: z.string().optional(), component: z.enum(SURFACE_SITES).optional(), instanceId: z.string().optional() }),
    z.strictObject({ handled: z.boolean(), element: z.string().nullable(), value: z.string().nullable() }),
  ),
  'session.ui.select': host(
    input({ ...ElementRefSchema.shape, value: z.string().max(SURFACE_VALUE_MAX), key: z.string().optional(), component: z.enum(SURFACE_SITES).optional(), instanceId: z.string().optional() }),
    z.strictObject({ handled: z.boolean(), element: z.string().nullable(), value: z.string().nullable() }),
  ),
  'session.ui.focus': host(
    input({ component: ScrollSiteSchema, instanceId: z.string().max(256), isHeld: z.boolean(), element: SurfaceElementSchema.nullable(), by: z.enum(['person', 'auto']) }),
    z.strictObject({ moved: z.boolean(), element: SurfaceElementSchema.nullable(), deny: z.string().nullable() }),
  ),
  'session.ui.scroll': host(
    input({ component: ScrollSiteSchema, instanceId: z.string().max(256), offset: z.number().int().nonnegative(), by: z.number().int(), bodyRows: z.number().int().nonnegative(), contentRows: z.number().int().nonnegative(), keyed: KeyedSchema.optional() }),
    z.strictObject({ moved: z.boolean(), offset: z.number().int().nullable(), deny: z.string().nullable(), followEnd: z.boolean() }),
  ),
  'session.ui.panes': host(input({}), PaneRosterSchema),
  'session.ui.paneShow': host(input({ id: z.string() }), z.strictObject({ shownId: z.string().nullable() })),
  'session.ui.paneFocus': host(input({ id: z.string().nullable() }), z.strictObject({ focusedId: z.string().nullable() })),
  'session.ui.close': host(input({ id: z.string() }), z.strictObject({ closed: z.boolean() })),
  'session.ui.promptEdit': host(
    input({ text: z.string().max(1_000_000), cursor: z.number().int().nonnegative(), key: z.strictObject({ key: z.string().min(1).max(32), ctrl: z.literal(true).optional(), shift: z.literal(true).optional(), meta: z.literal(true).optional() }).optional(), by: z.enum(['person', 'app']) }),
    z.void(),
  ),
  'session.ui.answer': host(input({ requestId: RequestIdSchema, answer: SurfaceAnswerSchema }), z.strictObject({ outcome: z.enum(['delivered', 'not_pending']) })),
} as const;
export const R2_SESSION_COMMANDS = Object.keys(r2Commands) as (keyof typeof r2Commands)[];
// R2 end ----------------------------------------------------------------------------------------------------------------

// E8 start (E8 execution document, Interfaces; D-11) ------------------------------------------------------------------
// `reload_skills` beside C3's `session.reloadPlugins`: an operation (a receipt, completion through session.operation with
// the skills the engine now offers), owner engine-host.
const e8Commands = {
  'session.reloadSkills': host(input({}), OperationReceiptSchema),
} as const;
export const E8_SESSION_COMMANDS = Object.keys(e8Commands) as (keyof typeof e8Commands)[];
// E8 end ----------------------------------------------------------------------------------------------------------------

export const commands = {
  ...c3Commands, // C3
  ...c4Commands, // C4
  ...c5Commands, // C5
  ...c7Commands, // C7
  ...c10Commands, // C10
  ...newChatCommands, // New chat
  ...r2Commands, // R2
  ...e8Commands, // E8
} as const satisfies Record<`session.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  ...c3Events, // C3
  ...c4Events, // C4
  ...c5Events, // C5
  ...c7Events, // C7
  ...c10Events, // C10
} as const satisfies Record<`session.${string}`, z.ZodType>;
