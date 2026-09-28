// X2 `fs.*` (C4 execution document, Interfaces "X2 additions"): the engine host's filesystem state service over the
// engine's own store. Owner `engine-host` for every command. M2 fills the discovery and holder surface (`fs.state`,
// `fs.scan`, `fs.bind`, `fs.holders`; `fs.sessionChanged`, `fs.sessionRemoved`, `fs.holderChanged`, `fs.scanProgress`); M3 adds
// following, subagents, workflows, tasks and spills. C8 adds its file-tree commands later under names not listed here.
import * as z from 'zod';
import { AgentIdSchema, AppSessionIdSchema, SessionIdSchema } from '@shared/graph/ids';
import { HolderSchema, JobStateSchema, LiveSessionRecordSchema, TranscriptSummarySchema } from '@shared/wire/store';
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

export const commands = {
  'fs.state': { input: z.void(), output: FsStateSchema, owner: 'engine-host' },
  'fs.scan': { input: z.strictObject({ known: z.array(FsScanKnownSchema).optional() }), output: FsScanResultSchema, owner: 'engine-host' },
  // main → host, after the index allocates or binds an app id
  'fs.bind': { input: z.strictObject({ bindings: z.array(FsBindingSchema) }), output: z.void(), owner: 'engine-host' },
  // Refreshes the registry (the poll's liveness rule), then answers every live holder whose sessionId is listed or whose
  // cwd (NFC-normalised realpath) is one of `directories`; both null answers every live holder. C10's ask.
  'fs.holders': { input: FsHoldersQuerySchema, output: FsHoldersAnswerSchema, owner: 'engine-host' },
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
} as const satisfies Record<`fs.${string}`, z.ZodType>;
