// Zod schemas for X3 rows, used only by the snapshot suite to validate every derived row (C6 execution document,
// "Interfaces and Dependencies": X3 is TypeScript types because rows never cross a process). Kept beside rows.ts
// rather than inside it so the types file stays the readable contract.
import * as z from 'zod';
import { DENIAL_KINDS, PLAN_OUTCOMES, SAFEGUARD_VERDICTS } from '@shared/graph/enums';
import { ContentBlockSchema, QuestionSchema, TokenUsageSchema } from '@shared/graph/events';
import { AskAnswerSchema, AskQuestionSchema } from '@shared/maws/tools'; // E1
import { TOOL_CATEGORIES } from './rows';

const nullable = <T extends z.ZodType>(schema: T) => schema.nullable();
const category = z.enum(TOOL_CATEGORIES);
const disposition = z.enum(['denied', 'auto_denied', 'stopped']);

export const ToolClassificationSchema = z.strictObject({
  groupable: z.boolean(), hidden: z.boolean(), category,
  denial: nullable(z.strictObject({ kind: z.enum(DENIAL_KINDS), disposition, interruption: z.boolean(), reason: nullable(z.string()) })),
  subagentLifecycle: nullable(z.enum(['start', 'progress', 'finish', 'message'])), startsGroup: z.boolean(), safeguard: z.enum(SAFEGUARD_VERDICTS), humanDecision: z.boolean(),
});

const TruncationSchema = z.strictObject({ shownHead: z.number(), shownTail: z.number(), omittedBytes: z.number() });
const SpillSchema = z.strictObject({ path: z.string(), bytes: nullable(z.number()), state: z.enum(['not_loaded', 'loading', 'loaded', 'partial', 'failed']), content: nullable(z.string()) });
const HunkSchema = z.strictObject({ oldStart: z.number(), oldLines: z.number(), newStart: z.number(), newLines: z.number(), lines: z.array(z.string()) });
const result = z.union([z.string(), z.array(ContentBlockSchema)]);

export const CellDetailSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('shell'), command: z.string(), description: nullable(z.string()), cwd: nullable(z.string()), stdout: z.string(), stderr: z.string(), exitCode: nullable(z.number()),
    interrupted: z.boolean(), backgroundTaskId: nullable(z.string()), truncated: nullable(TruncationSchema), spill: nullable(SpillSchema),
  }),
  z.strictObject({ kind: z.literal('edit'), filePath: z.string(), change: z.enum(['create', 'update', 'delete']), hunks: z.array(HunkSchema), added: z.number(), removed: z.number() }),
  z.strictObject({ kind: z.literal('read'), files: z.array(z.strictObject({ path: z.string(), range: nullable(z.tuple([z.number(), z.number()])) })), preview: nullable(z.string()), truncated: nullable(TruncationSchema) }),
  z.strictObject({ kind: z.literal('search'), query: z.string(), scope: nullable(z.string()), matches: nullable(z.number()), output: z.string(), truncated: nullable(TruncationSchema) }),
  z.strictObject({ kind: z.literal('web'), url: nullable(z.string()), query: nullable(z.string()), output: z.string(), truncated: nullable(TruncationSchema) }),
  z.strictObject({ kind: z.literal('mcp'), server: z.string(), tool: z.string(), input: z.unknown(), result, structured: z.unknown(), spill: nullable(SpillSchema) }),
  z.strictObject({ kind: z.literal('image'), images: z.array(z.strictObject({ dataUrl: z.string(), mediaType: z.string(), alt: nullable(z.string()) })), caption: nullable(z.string()) }),
  z.strictObject({ kind: z.literal('thinking'), text: z.string(), durationMs: nullable(z.number()) }),
  z.strictObject({ kind: z.literal('generic'), input: z.unknown(), result, structured: z.unknown(), isError: z.boolean(), spill: nullable(SpillSchema), truncated: nullable(TruncationSchema) }),
]);

const SubagentRefSchema = z.strictObject({
  taskId: z.string(), agentId: nullable(z.string()), toolUseId: nullable(z.string()), name: z.string(), glyph: z.number().int().min(0).max(7), kind: z.enum(['agent', 'workflow']), subagentType: nullable(z.string()),
});

const cellShape = {
  id: z.string(), toolUseId: nullable(z.string()), toolName: z.string(), category, classification: ToolClassificationSchema,
  status: z.enum(['running', 'done', 'error', 'denied', 'stopped']), label: z.string(), paths: z.array(z.string()), startedAt: z.string(), endedAt: nullable(z.string()),
  detail: CellDetailSchema, expanded: z.boolean(), agent: nullable(SubagentRefSchema),
};
export const CellSchema = z.strictObject(cellShape);

export const TurnSummarySchema = z.strictObject({
  durationMs: nullable(z.number()), toolCalls: z.number(), byCategory: z.strictObject(Object.fromEntries(TOOL_CATEGORIES.map((c) => [c, z.number()])) as Record<(typeof TOOL_CATEGORIES)[number], z.ZodNumber>),
  denials: z.array(z.strictObject({ kind: z.enum(DENIAL_KINDS), cellId: z.string(), disposition, interruption: z.boolean() })), autoDenied: z.number(),
  safeguard: z.strictObject({ reviewed: z.number(), flagged: z.number(), notEvaluated: z.number() }),
  costUsd: nullable(z.number()), usage: nullable(TokenUsageSchema), model: nullable(z.string()), childAgents: z.number(), terminalReason: nullable(z.string()),
});

const base = { id: z.string(), turnId: nullable(z.string()), at: z.string() };
const AttachmentSchema = z.strictObject({ kind: z.enum(['image', 'file', 'text']), name: z.string(), bytes: nullable(z.number()), dataUrl: nullable(z.string()), mediaType: nullable(z.string()), text: nullable(z.string()) });

export const RowSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...base, kind: z.literal('time'), label: z.string() }),
  z.strictObject({ ...base, kind: z.literal('user'), messageUuid: nullable(z.string()), text: z.string(), attachments: z.array(AttachmentSchema), placeholders: z.array(z.number().int()), lines: z.number(), editable: z.boolean(), steer: z.boolean(), dropped: z.boolean(), pending: z.enum(['next', 'held']).optional() }),
  z.strictObject({ ...base, kind: z.literal('assistant_text'), messageUuid: nullable(z.string()), blockIndex: z.number(), markdown: z.string(), live: z.boolean(), phase: z.enum(['answer', 'commentary']), model: nullable(z.string()) }),
  z.strictObject({
    ...base, kind: z.literal('divider'), state: z.enum(['working', 'completed', 'stopped', 'failed']), origin: z.enum(['human', 'engine', 'peer']), startedAt: z.string(), endedAt: nullable(z.string()),
    toolCalls: z.number(), denied: z.number(), autoDenied: z.number(), firstDeniedCell: nullable(z.string()), expanded: z.boolean(), summary: TurnSummarySchema,
  }),
  z.strictObject({ ...base, kind: z.literal('group'), state: z.enum(['active', 'completed']), cells: z.array(CellSchema), summary: z.string(), activeLabel: nullable(z.string()), icon: category, expanded: z.boolean() }),
  z.strictObject({ ...base, kind: z.literal('cell'), ...cellShape }),
  z.strictObject({
    ...base, kind: z.literal('receipt'), files: z.array(z.strictObject({ path: z.string(), change: z.enum(['create', 'update', 'delete']), added: z.number(), removed: z.number(), cellId: z.string() })),
    added: z.number(), removed: z.number(), state: z.enum(['applied', 'undoing', 'undone', 'reapplying']), canUndo: z.boolean(), canReapply: z.boolean(),
  }),
  z.strictObject({ ...base, kind: z.literal('subagent'), agents: z.array(SubagentRefSchema), sentence: z.string(), status: z.enum(['started', 'working', 'finished', 'finished_with_errors', 'stopped']), overflow: z.number() }),
  z.strictObject({ ...base, kind: z.literal('agent_message'), direction: z.enum(['to_child', 'from_child', 'between']), from: nullable(SubagentRefSchema), to: nullable(SubagentRefSchema), text: z.string() }),
  z.strictObject({ ...base, kind: z.literal('thinking'), messageUuid: nullable(z.string()), text: z.string(), live: z.boolean(), durationMs: nullable(z.number()) }),
  z.strictObject({ ...base, kind: z.literal('plan'), toolUseId: z.string(), plan: z.string(), outcome: nullable(z.enum(PLAN_OUTCOMES)), feedback: nullable(z.string()) }),
  z.strictObject({ ...base, kind: z.literal('question'), toolUseId: z.string(), questions: z.array(QuestionSchema), answers: nullable(z.record(z.string(), z.string())), error: nullable(z.string()) /* E1 */ }),
  z.strictObject({
    ...base, kind: z.literal('request_slot'), requestId: z.string(), toolUseId: nullable(z.string()), requestKind: z.enum(['permission', 'question', 'plan', 'dialog', 'elicitation']), toolName: nullable(z.string()), requestedAt: z.string(),
  }),
  z.strictObject({
    ...base, kind: z.literal('error'), severity: z.enum(['transient', 'error', 'notice']), text: z.string(), attempt: nullable(z.strictObject({ n: z.number(), max: nullable(z.number()) })),
    scope: z.enum(['turn', 'task', 'process', 'transport', 'request', 'api', 'reconnect', 'notice', 'exit', 'hook', 'plugin' /* R1 */]), lostAttentionCount: nullable(z.number()),
    action: z.enum(['edit_prompt', 'engine_settings']).optional(), // W13: engine_settings
  }),
  z.strictObject({ ...base, kind: z.literal('boundary'), boundaryKind: z.enum(['compaction', 'reset', 'retraction', 'rewind']), text: z.string(), secondary: z.string().optional(), detail: nullable(z.string()), hiddenRows: z.number(), revealed: z.boolean() }),
  z.strictObject({ ...base, kind: z.literal('bash'), command: z.string(), stdout: z.string(), stderr: z.string(), exitCode: nullable(z.number()), cwd: nullable(z.string()) }),
  z.strictObject({ ...base, kind: z.literal('local_command'), messageUuid: nullable(z.string()), text: z.string() }),
  // E1 start
  z.strictObject({
    ...base, kind: z.literal('ask'), toolUseId: z.string(), askId: z.string(), title: nullable(z.string()), context: nullable(z.string()), blocking: z.boolean(), questions: z.array(AskQuestionSchema),
    state: z.enum(['pending', 'asked', 'answered', 'cancelled', 'error']), answers: nullable(z.array(AskAnswerSchema)), error: nullable(z.string()),
  }),
  z.strictObject({
    ...base, kind: z.literal('delivery'), toolUseId: z.string(), files: z.array(z.strictObject({ path: z.string(), name: z.string(), id: nullable(z.string()) })), caption: nullable(z.string()),
    urgency: z.enum(['normal', 'high']), error: nullable(z.string()),
  }),
  // E1 end
]);
