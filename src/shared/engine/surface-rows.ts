// R3, waves plan §2 K2: transcript props from 2.1.287 RenderPropsOf and ToolGroupCall
// (claude-code.d.ts-e37ccc4a.txt:9075–9363, 12191). Unlike the open render envelope, each
// row's rewrite is checked before drawing; immutable provenance and viewport reports survive intact.
import * as z from 'zod';
import type { Question } from '../graph/events';

export const TRANSCRIPT_SITES = ['UserMessage', 'AssistantMessage', 'ToolUse', 'ToolResult', 'ToolGroup', 'CommandOutput', 'AskUserQuestion'] as const;
export type TranscriptSite = (typeof TRANSCRIPT_SITES)[number];

const OriginSchema = z.union([
  z.strictObject({ kind: z.enum(['composer', 'bridge', 'sdk', 'task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay', 'coordinator', 'observer', 'observer-activity', 'auto-continuation', 'unclassified', 'slack-ping']) }),
  z.strictObject({ kind: z.literal('channel'), server: z.string() }),
  z.strictObject({ kind: z.literal('plugin'), name: z.string(), asUser: z.literal(true).optional() }),
]);
const OnScreenSchema = z.strictObject({ first: z.number().int().nonnegative(), last: z.number().int().nonnegative(), of: z.number().int().positive() })
  .refine(({ first, last, of }) => first <= last && last < of);
const viewport = { onScreen: OnScreenSchema.nullable().optional() };
const CallSchema = z.strictObject({
  tool_use_id: z.string().optional(), tool: z.string(), input: z.unknown(),
  isRunning: z.boolean(), isErrored: z.boolean(), isInterrupted: z.boolean(), output: z.unknown().optional(),
});

// The engine's actual AskUserQuestion schemas (2.1.287 chunk-brb1711z.js, X / me / ee / Q),
// not X1's normalized Question: 1–4 distinct questions, 2–4 distinct choice options.
// Lean/extended questions allow omitted descriptions; nullable X1 fields are not tool input.
const QuestionSchema = z.object({
  question: z.string(), header: z.string(),
  options: z.array(z.object({ label: z.string(), description: z.string().optional(), preview: z.string().optional() })).max(4).default([]),
  multiSelect: z.boolean().default(false), kind: z.enum(['choice', 'text', 'number']).optional(),
  description: z.string().optional(), placeholder: z.string().optional(),
  min: z.number().optional(), max: z.number().optional(), step: z.number().positive().optional(),
  defaultValue: z.number().optional(), unit: z.string().optional(),
}).superRefine((question, ctx) => {
  const kind = question.kind ?? 'choice';
  const issue = (field: string) => ctx.addIssue({ code: 'custom', path: [field], message: `Invalid ${field} for ${kind} question` });
  if (new Set(question.options.map((option) => option.label)).size !== question.options.length) issue('options');
  if (kind !== 'text' && question.placeholder !== undefined) issue('placeholder');
  for (const field of ['min', 'max', 'step', 'defaultValue', 'unit'] as const) {
    if (kind !== 'number' && question[field] !== undefined) issue(field);
  }
  if (kind === 'choice') {
    if (question.options.length < 2) issue('options');
    return;
  }
  if (question.options.length) issue('options');
  if (question.multiSelect) issue('multiSelect');
  if (kind === 'number') {
    const { min, max, defaultValue } = question;
    if (min === undefined || max === undefined || min >= max) issue('min');
    else if (defaultValue !== undefined && (defaultValue < min || defaultValue > max)) issue('defaultValue');
  }
});

const schemas = {
  UserMessage: z.strictObject({
    text: z.string(), origin: OriginSchema, isExpanded: z.boolean(),
    task: z.strictObject({ id: z.string().optional(), status: z.string().optional(), type: z.string().optional(), toolUseId: z.string().optional(), durationMs: z.number().optional() }).optional(),
    from: z.strictObject({ name: z.string() }).optional(), ...viewport,
  }),
  AssistantMessage: z.strictObject({ text: z.string(), isFirstOfReply: z.boolean(), ...viewport }),
  ToolUse: CallSchema.extend({ tool_use_id: z.string(), ...viewport }),
  ToolResult: z.strictObject({ tool_use_id: z.string(), tool: z.string(), output: z.unknown(), isErrored: z.boolean(), ...viewport }),
  ToolGroup: z.strictObject({ calls: z.array(CallSchema), isActive: z.boolean(), isExpanded: z.boolean(), ...viewport }),
  CommandOutput: z.strictObject({ command: z.string(), args: z.string(), text: z.string(), isErrored: z.boolean(), ...viewport }),
  AskUserQuestion: z.strictObject({
    tool: z.string(), metadataSource: z.string().optional(),
    questions: z.array(QuestionSchema).min(1).max(4).refine((questions) => new Set(questions.map((question) => question.question)).size === questions.length),
  }),
} satisfies Record<TranscriptSite, z.ZodType>;

export type TranscriptProps = { [C in TranscriptSite]: z.infer<(typeof schemas)[C]> };

const READ_ONLY: { [C in TranscriptSite]: readonly (keyof TranscriptProps[C])[] } = {
  UserMessage: ['origin', 'isExpanded', 'task', 'from', 'onScreen'],
  AssistantMessage: ['onScreen'],
  ToolUse: ['tool_use_id', 'onScreen'],
  ToolResult: ['tool_use_id', 'tool', 'isErrored', 'onScreen'],
  ToolGroup: ['onScreen'],
  CommandOutput: ['command', 'args', 'isErrored', 'onScreen'],
  AskUserQuestion: [],
};

// Immutable structured props contain scalar fields only. Compare by value, not JSON key order,
// and preserve presence as well: absent onScreen must not become null (or vice versa).
function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => Object.hasOwn(b, key) && a[key] === b[key]);
}
function sameField(left: object, right: object, key: PropertyKey): boolean {
  return Object.hasOwn(left, key) === Object.hasOwn(right, key)
    && sameValue((left as Record<PropertyKey, unknown>)[key], (right as Record<PropertyKey, unknown>)[key]);
}

export function parseTranscriptProps<C extends TranscriptSite>(component: C, value: unknown, original: TranscriptProps[C]): TranscriptProps[C] | null {
  const parsed = schemas[component].safeParse(value);
  if (!parsed.success) return null;
  const props = parsed.data as TranscriptProps[C];
  if (!READ_ONLY[component].every((key) => sameField(props, original, key))) return null;
  if (component === 'ToolGroup') {
    const next = (props as TranscriptProps['ToolGroup']).calls;
    const before = (original as TranscriptProps['ToolGroup']).calls;
    if (next.length !== before.length || next.some((call, index) => !sameField(call, before[index]!, 'tool_use_id'))) return null;
  }
  if (component === 'AskUserQuestion' && nativeQuestionsOf((props as TranscriptProps['AskUserQuestion']).questions) === null) return null;
  return props;
}

// X1 normalizes absent option fields to null; the tool's render contract wants them omitted.
export function engineQuestionsOf(questions: Question[]): TranscriptProps['AskUserQuestion']['questions'] {
  return questions.map(({ question, header, options, multiSelect }) => ({
    question, header, multiSelect,
    options: options.map(({ label, description, preview }) => ({ label, ...(description !== null && { description }), ...(preview !== null && { preview }) })),
  }));
}

// R3 does not add new native form kinds. Refuse a rewrite rather than silently draw a text/number
// question as a choice, or discard helper text the current native card has nowhere to show.
export function nativeQuestionsOf(questions: TranscriptProps['AskUserQuestion']['questions']): Question[] | null {
  if (questions.some((question) => (question.kind !== undefined && question.kind !== 'choice') || question.description !== undefined)) return null;
  return questions.map(({ question, header, options, multiSelect }) => ({
    question, header, multiSelect,
    options: options.map(({ label, description, preview }) => ({ label, description: description ?? null, preview: preview ?? null })),
  }));
}
