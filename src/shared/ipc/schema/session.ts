// X2 `session.*` (charter §12 C1 *IPC registry composition*). Each child adds its entries as one delimited block and
// spreads it into the exported registries; C3's block is the engine host's per-session surface.
import * as z from 'zod';
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
import { QueueEntrySchema, QueueStateSchema, SendContentSchema } from '../../engine/session-state-store';
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
import type { CommandSpec } from './common';

// C3 start
const input = <S extends z.ZodRawShape>(shape: S) => z.strictObject({ appSessionId: AppSessionIdSchema, ...shape });
const host = <I extends z.ZodType, O extends z.ZodType>(i: I, o: O) => ({ input: i, output: o, owner: 'engine-host' as const });
const read = <O extends z.ZodType>(o: O) => host(input({}), o); // a structured read answers the typed response of the same name

export const LAUNCH_REFUSALS = ['already_live', 'binary_missing', 'binary_version', 'replay_disabled', 'settings_conflict'] as const;
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
  'session.launch': host(z.strictObject({ spec: LaunchSpecSchema }), LaunchResultSchema),
  'session.status': host(input({}), EngineSessionStatusSchema),
  'session.events': host(input({ afterSeq: z.number().int().nullable(), limit: z.number().int().positive().nullable() }), EventsSnapshotSchema),
  'session.stop': host(input({ reason: z.enum(['stop', 'archive']) }), z.strictObject({ exited: z.boolean(), code: z.number().int().nullable(), signal: z.string().nullable() })),
  'session.pendingRequest': host(input({ requestId: RequestIdSchema }), z.strictObject({ event: SessionEventSchema.nullable() })),
  'session.catalog': host(input({}), CatalogSchema),
  // the composer: sends, the app queue, steer, interrupt, answers, `!` and `#`
  'session.send': host(input({ content: SendContentSchema }), z.strictObject({ messageUuid: MessageUuidSchema.nullable(), disposition: z.enum(['sent', 'queued']), queueId: z.string() })),
  'session.steer': host(input({ content: SendContentSchema }), MessageUuidOutput),
  'session.queue.list': host(input({}), QueueStateSchema),
  'session.queue.edit': host(input({ queueId: z.string(), content: SendContentSchema }), QueueEntrySchema),
  'session.queue.remove': host(input({ queueId: z.string() }), z.void()),
  'session.queue.promote': host(input({ queueId: z.string() }), MessageUuidOutput),
  'session.queue.setPaused': host(input({ paused: z.boolean() }), z.void()),
  'session.interrupt': host(input({ cancelEngineQueued: z.boolean() }), z.strictObject({ stillQueued: z.array(z.string()), cancelled: z.array(z.string()) })),
  'session.answer': host(input({ requestId: RequestIdSchema, answer: RequestAnswerSchema }), z.strictObject({ outcome: z.enum(['delivered', 'not_pending', 'write_failed']) })),
  'session.bash': host(input({ command: z.string().min(1) }), z.strictObject({ commandUuid: MessageUuidSchema })),
  'session.memoryAppend': host(input({ text: z.string().min(1), target: MemoryTargetSchema }), z.strictObject({ path: z.string(), created: z.boolean() })),
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
  'session.sideQuestion': host(input({ question: z.string() }), OperationReceiptSchema),
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
  'session.queue': z.strictObject({ appSessionId: AppSessionIdSchema, entries: z.array(QueueEntrySchema), paused: z.boolean() }),
  'session.brokerItems': z.strictObject({ appSessionId: AppSessionIdSchema, items: z.array(AttentionItemSchema) }), // internal: main's attention service
  'session.operation': OperationEventSchema,
} as const;

export const C3_SESSION_COMMANDS = Object.keys(c3Commands) as (keyof typeof c3Commands)[];
export const C3_SESSION_EVENTS = Object.keys(c3Events) as (keyof typeof c3Events)[];
// C3 end

export const commands = {
  ...c3Commands, // C3
} as const satisfies Record<`session.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  ...c3Events, // C3
} as const satisfies Record<`session.${string}`, z.ZodType>;
