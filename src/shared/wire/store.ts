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
  kind: z.enum(['interactive', 'bg', 'daemon', 'daemon-worker']).optional(),
  entrypoint: z.string().optional(),
  jobId: z.string().optional(),
  name: z.string().optional(),
  status: z.enum(['busy', 'shell', 'idle', 'waiting']).optional(),
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
  firstPrompt: z.string().nullable(), // last `last-prompt.lastPrompt` in the tail, else the first user text
  lastAssistantText: z.string().nullable(), // the last assistant text block in the tail, first 200 characters
  gitBranch: z.string().nullable(),
  engineVersion: z.string().nullable(),
  entrypoint: z.string().nullable(),
  sessionKind: z.enum(['bg', 'daemon', 'daemon-worker']).nullable(),
  hasMessages: z.boolean(), // a `"parentUuid":` marker was seen in head or tail (the engine's own `bookkeepingOnly` negation)
  leafUuid: MessageUuidSchema.nullable(), // last uuid-bearing non-progress record in the tail
});
export type TranscriptSummary = z.infer<typeof TranscriptSummarySchema>;

export const HolderSchema = SessionHolderSchema;
export type Holder = SessionRecord['holder'];
