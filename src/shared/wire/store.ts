// Store record shapes (C4 execution document, Interfaces "Store record shapes"): what the engine writes under the
// config home beside the transcripts, and what discovery learns from a transcript's head and tail. The engine's own
// files are loose objects (unknown fields retained, SPEC 35.27.1, 20.15.5, 20.2.4, pass-2 item 3); the summary is
// MAWS's own record and strict. C1's `TranscriptRecord`, `LastPromptAnchor` and `AgentMeta` stay in `./transcript`.
import * as z from 'zod';
import { MessageUuidSchema, SessionIdSchema } from '@shared/graph/ids';
import { SessionHolderSchema, type SessionRecord } from '@shared/graph/session';

// <configHome>/sessions/<pid>.json (SPEC 35.27.1). `pid` is taken from the file name by the reader.
export const LiveSessionRecordSchema = z.looseObject({
  pid: z.number().int(),
  sessionId: z.string().optional(),
  cwd: z.string().optional(),
  startedAt: z.number().optional(),
  procStart: z.string().optional(),
  version: z.string().optional(),
  // Open strings: a value the engine adds later must not drop the record, and with it a holder (M2 review). Known kinds:
  // 'interactive' | 'bg' | 'daemon' | 'daemon-worker' (the Holder rule maps them); known statuses: 'busy' | 'shell' |
  // 'idle' | 'waiting'.
  kind: z.string().optional(),
  entrypoint: z.string().optional(),
  jobId: z.string().optional(),
  name: z.string().optional(),
  status: z.string().optional(),
  waitingFor: z.string().optional(),
  updatedAt: z.number().optional(),
  spare: z.literal(true).optional(),
  parkedJobId: z.string().optional(),
});
export type LiveSessionRecord = z.infer<typeof LiveSessionRecordSchema>;

// <configHome>/jobs/<8hex>/state.json (SPEC 20.15.5); only the fields C4 reads are named.
export const JobStateSchema = z.looseObject({
  state: z.string(),
  detail: z.string().optional(),
  sessionId: z.string(),
  linkScanPath: z.string().optional(),
  template: z.string().optional(),
  cwd: z.string().optional(),
  name: z.string().optional(),
  cliVersion: z.string().optional(),
  updatedAt: z.number().optional(),
});
export type JobState = z.infer<typeof JobStateSchema>;

// <configHome>/tasks/<listId>/<id>.json (SPEC 20.2.4)
export const PersistedTaskSchema = z.looseObject({
  id: z.string(),
  subject: z.string(),
  description: z.string(),
  activeForm: z.string().optional(),
  owner: z.string().optional(),
  status: z.enum(['pending', 'in_progress', 'completed']),
  blocks: z.array(z.string()),
  blockedBy: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type PersistedTask = z.infer<typeof PersistedTaskSchema>;

// <projectDir>/<sessionId>/workflows/<runId>.json (pass-2 item 3; fixture pass2/workflow-disk/wf_*.json)
export const WorkflowSnapshotSchema = z.looseObject({
  runId: z.string(),
  workflowName: z.string().optional(),
  status: z.string().optional(),
  taskId: z.string().optional(),
  scriptPath: z.string().optional(),
  summary: z.string().optional(),
  agentCount: z.number().optional(),
  durationMs: z.number().optional(),
  startTime: z.number().optional(),
  workflowProgress: z.array(z.unknown()).optional(),
  result: z.unknown().optional(),
});
export type WorkflowSnapshot = z.infer<typeof WorkflowSnapshotSchema>;

// <projectDir>/<sessionId>/subagents/workflows/<runId>/journal.jsonl rows: launched, started, result, keyed by agent.
export const WorkflowJournalRowSchema = z.looseObject({
  type: z.string(),
  key: z.string().optional(),
  agentId: z.string().optional(),
  label: z.string().optional(),
  phase: z.string().optional(),
  result: z.unknown().optional(),
});
export type WorkflowJournalRow = z.infer<typeof WorkflowJournalRowSchema>;

// <projectDir>/<sessionId>/subagents/[<subdir>/]agent-<agentId>.meta.json (SPEC 35.11.1): `agentType` is the one field
// the engine requires. C1's `AgentMeta` also requires `toolUseId` and `description`, which an `Agent` tool call's meta
// carries and a workflow agent's does not (pass-2 `workflow-disk/agent-*.meta.json`), so the listing parses this looser
// shape and the backfill's lookup takes only the metas that are also an `AgentMeta`.
export const SubagentMetaSchema = z.looseObject({
  agentType: z.string(),
  description: z.string().optional(),
  toolUseId: z.string().optional(),
  spawnDepth: z.number().optional(),
  requestShape: z.string().optional(),
  requestNonInteractive: z.boolean().optional(),
  model: z.string().optional(),
  workflowPhase: z.string().optional(),
  parentAgentId: z.string().optional(), // a nested agent's parent (SPEC 18 §18.25.2), beside spawnDepth 2+
  name: z.string().optional(), // the name `Agent` was called with; what `SendMessage` addresses
  stoppedByUser: z.boolean().optional(), // the sidecar's one status fact (SPEC 18 §18.26.2)
});
export type SubagentMeta = z.infer<typeof SubagentMetaSchema>;

// What discovery learns about a transcript from its first and last 64 KiB, without parsing the whole file
// (SPEC 35.14.2 for which window each fact comes from).
export const TranscriptSummarySchema = z.strictObject({
  sessionId: SessionIdSchema,
  transcriptPath: z.string(),
  slug: z.string(),
  directory: z.string().nullable(), // first `cwd` in the head; null when the head has none
  relocatedCwd: z.string().nullable(), // last `relocated` record in the tail; overrides `directory` for project membership (SPEC 35.23)
  size: z.number(),
  mtimeMs: z.number(),
  firstRecordAt: z.string().nullable(), // ISO timestamps of the first and last uuid-bearing record seen
  lastRecordAt: z.string().nullable(),
  customTitle: z.string().nullable(), // last `custom-title` / `ai-title` in the tail, else `custom-title.json` (folded in by M2), else head
  aiTitle: z.string().nullable(),
  firstPrompt: z.string().nullable(), // the first user text in the head, else the earliest `last-prompt.lastPrompt` the windows hold (debt wave 4)
  lastAssistantText: z.string().nullable(), // the last assistant text block in the tail as its preview line (E11 F2b, `@shared/owner/preview`), at most 200 characters
  gitBranch: z.string().nullable(),
  engineVersion: z.string().nullable(),
  entrypoint: z.string().nullable(),
  sessionKind: z.enum(['bg', 'daemon', 'daemon-worker']).nullable(),
  hasMessages: z.boolean(), // a `"parentUuid":` marker was seen in head or tail (the engine's own `bookkeepingOnly` negation)
  leafUuid: MessageUuidSchema.nullable(), // last uuid-bearing non-progress record in the tail
  // E3 (A-16's disk signal; E3 execution document, Interfaces "TranscriptSummary"): the first head record with
  // `parentUuid: null`, which a `--fork-session` copy repeats from its parent; null when the head holds none
  rootUuid: MessageUuidSchema.nullable(),
  birthtimeMs: z.number(), // `stat().birthtimeMs`: orders a fork family, whose copied records keep the parent's timestamps
});
export type TranscriptSummary = z.infer<typeof TranscriptSummarySchema>;

export const HolderSchema = SessionHolderSchema;
export type Holder = SessionRecord['holder'];
