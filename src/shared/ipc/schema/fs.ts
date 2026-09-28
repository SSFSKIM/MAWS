// X2 `fs.*` (C4 execution document, Interfaces "X2 additions"): the engine host's filesystem state service over the
// engine's own store. Owner `engine-host` for every command. M2 fills the discovery and holder surface (`fs.state`,
// `fs.scan`, `fs.bind`, `fs.holders`; `fs.sessionChanged`, `fs.sessionRemoved`, `fs.holderChanged`, `fs.scanProgress`); M3 adds
// following, subagents, workflows, tasks and spills. C8 adds its file-tree commands later under names not listed here.
// Every command that takes an `appSessionId` fails with `internal` `unknown app session: <id>` when main has not bound it.
import * as z from 'zod';
import { SessionEventSchema } from '@shared/graph/events';
import { AgentIdSchema, AppSessionIdSchema, MessageUuidSchema, SessionIdSchema } from '@shared/graph/ids';
import {
  HolderSchema,
  JobStateSchema,
  LiveSessionRecordSchema,
  PersistedTaskSchema,
  SubagentMetaSchema,
  TranscriptSummarySchema,
  WorkflowJournalRowSchema,
  WorkflowSnapshotSchema,
} from '@shared/wire/store';
import type { CommandSpec } from './common';

// The snapshot `fs.state` answers (C1's reload-survival rule: a page that arrives late reads the truth, not events).
export const FsStateSchema = z.strictObject({
  configHome: z.string(),
  watching: z.boolean(), // the projects/ and sessions/ watches are open
  projects: z.number().int(), // slug directories under projects/ holding at least one listed transcript
  sessions: z.number().int(), // listed transcripts
  bound: z.number().int(), // sessions with an appSessionId from main
  followed: z.array(z.strictObject({ appSessionId: AppSessionIdSchema, agentId: AgentIdSchema.nullable() })),
  holders: z.array(z.strictObject({ sessionId: SessionIdSchema, appSessionId: AppSessionIdSchema.nullable(), holder: HolderSchema })),
  lastScanAt: z.string().nullable(),
});
export type FsState = z.infer<typeof FsStateSchema>;

export const FsScanKnownSchema = z.strictObject({ sessionId: SessionIdSchema, appSessionId: AppSessionIdSchema, size: z.number(), mtimeMs: z.number() });
export type FsScanKnown = z.infer<typeof FsScanKnownSchema>;

export const FsScanResultSchema = z.strictObject({
  projects: z.number().int(),
  sessions: z.number().int(),
  changed: z.number().int(), // transcripts not skipped by `known`, each emitted as fs.sessionChanged
  durationMs: z.number(),
});
export type FsScanResult = z.infer<typeof FsScanResultSchema>;

export const FsBindingSchema = z.strictObject({ sessionId: SessionIdSchema, appSessionId: AppSessionIdSchema });

// C10's exclusive-writer guards: the registry as it is at the moment of the call, not the index's asynchronous projection.
export const FsHoldersQuerySchema = z.strictObject({ sessionIds: z.array(SessionIdSchema).nullable(), directories: z.array(z.string()).nullable() });
export type FsHoldersQuery = z.infer<typeof FsHoldersQuerySchema>;
export const FsHoldersAnswerSchema = z.strictObject({
  refreshedAt: z.string(),
  holders: z.array(z.strictObject({ sessionId: SessionIdSchema, appSessionId: AppSessionIdSchema.nullable(), holder: HolderSchema, cwd: z.string().nullable() })),
});
export type FsHoldersAnswer = z.infer<typeof FsHoldersAnswerSchema>;

// One sidecar transcript under `<sessionId>/subagents/` (`runId` set for `subagents/workflows/<runId>/agent-*.jsonl`).
// `meta` is null until `agent-<id>.meta.json` has been read whole.
export const SubagentEntrySchema = z.strictObject({
  agentId: AgentIdSchema,
  meta: SubagentMetaSchema.nullable(),
  transcriptPath: z.string(),
  size: z.number(),
  mtimeMs: z.number(),
  runId: z.string().nullable(),
});
export type SubagentEntry = z.infer<typeof SubagentEntrySchema>;

// One workflow run: `workflows/<runId>.json` (null until it has been read whole) and the rows of
// `subagents/workflows/<runId>/journal.jsonl` (empty when there is none yet).
export const WorkflowRunSchema = z.strictObject({ runId: z.string(), snapshot: WorkflowSnapshotSchema.nullable(), journal: z.array(WorkflowJournalRowSchema) });
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

export const GapSchema = z.strictObject({ parentUuid: z.string(), childUuid: z.string() });

export const FsReadSpillInputSchema = z.strictObject({
  path: z.string(),
  offset: z.number().int().nonnegative().optional(),
  length: z.number().int().positive().max(8 * 1024 * 1024).optional(),
});
export type FsReadSpillInput = z.infer<typeof FsReadSpillInputSchema>;
export const FsReadSpillOutputSchema = z.strictObject({ content: z.string(), bytes: z.number().int(), offset: z.number().int(), truncated: z.boolean() });
export type FsReadSpillOutput = z.infer<typeof FsReadSpillOutputSchema>;

export const FOLLOW_STATES = ['backfilling', 'following', 'reloading', 'stopped', 'error'] as const;

export const commands = {
  'fs.state': { input: z.void(), output: FsStateSchema, owner: 'engine-host' },
  'fs.scan': { input: z.strictObject({ known: z.array(FsScanKnownSchema).optional() }), output: FsScanResultSchema, owner: 'engine-host' },
  // main → host, after the index allocates or binds an app id
  'fs.bind': { input: z.strictObject({ bindings: z.array(FsBindingSchema) }), output: z.void(), owner: 'engine-host' },
  // Refreshes the registry (the poll's liveness rule), then answers every live holder whose sessionId is listed or whose
  // cwd (NFC-normalised realpath) is one of `directories`; both null answers every live holder. C10's ask.
  'fs.holders': { input: FsHoldersQuerySchema, output: FsHoldersAnswerSchema, owner: 'engine-host' },
  // Stops the follower (and, with agentId null, the session's agent followers); following starts through
  // `session.events` and `fs.agentEvents`.
  'fs.unfollow': { input: z.strictObject({ appSessionId: AppSessionIdSchema, agentId: AgentIdSchema.nullable() }), output: z.void(), owner: 'engine-host' },
  'fs.subagents': { input: z.strictObject({ appSessionId: AppSessionIdSchema }), output: z.strictObject({ agents: z.array(SubagentEntrySchema) }), owner: 'engine-host' },
  // C6's name: the child's transcript as X1 events; starts following it, and later events arrive on
  // `session.eventBatch` with `agentId` set. `complete` is true once its backfill has finished.
  'fs.agentEvents': {
    input: z.strictObject({ appSessionId: AppSessionIdSchema, agentId: AgentIdSchema }),
    output: z.strictObject({ events: z.array(SessionEventSchema), complete: z.boolean() }),
    owner: 'engine-host',
  },
  'fs.workflows': { input: z.strictObject({ appSessionId: AppSessionIdSchema }), output: z.strictObject({ runs: z.array(WorkflowRunSchema) }), owner: 'engine-host' },
  'fs.tasks': { input: z.strictObject({ listId: z.string() }), output: z.strictObject({ tasks: z.array(PersistedTaskSchema) }), owner: 'engine-host' },
  // C6's name and fields (`bytes` is the file's total size); `offset` is additive. Only a path whose realpath lies under
  // `<configHome>/projects/`, `tasks/` or `jobs/` is read.
  'fs.readSpill': { input: FsReadSpillInputSchema, output: FsReadSpillOutputSchema, owner: 'engine-host' },
} as const satisfies Record<`fs.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  // discovered, or head/tail facts changed; appSessionId once bound
  'fs.sessionChanged': z.strictObject({ summary: TranscriptSummarySchema, appSessionId: AppSessionIdSchema.nullable() }),
  // the .jsonl vanished (retention sweep, quarantine rename)
  'fs.sessionRemoved': z.strictObject({ sessionId: SessionIdSchema, appSessionId: AppSessionIdSchema.nullable() }),
  'fs.holderChanged': z.strictObject({
    sessionId: SessionIdSchema,
    appSessionId: AppSessionIdSchema.nullable(),
    holder: HolderSchema,
    registry: LiveSessionRecordSchema.nullable(),
    job: JobStateSchema.nullable(),
  }),
  'fs.scanProgress': z.strictObject({ scanned: z.number().int(), total: z.number().int() }),
  'fs.followState': z.strictObject({
    appSessionId: AppSessionIdSchema,
    agentId: AgentIdSchema.nullable(),
    state: z.enum(FOLLOW_STATES),
    chainLength: z.number().int(),
    leafUuid: MessageUuidSchema.nullable(),
    gap: GapSchema.nullable(),
    skippedLines: z.number().int(),
    message: z.string().nullable(),
  }),
  'fs.subagentsChanged': z.strictObject({ appSessionId: AppSessionIdSchema, agents: z.array(SubagentEntrySchema) }),
  'fs.workflowChanged': z.strictObject({ appSessionId: AppSessionIdSchema, runId: z.string() }),
  'fs.tasksChanged': z.strictObject({ listId: z.string() }),
} as const satisfies Record<`fs.${string}`, z.ZodType>;
