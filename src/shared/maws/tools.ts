// X9, the `maws` tool server (P1 spec §3 A and §10 X9; E1 execution document, Interfaces "X9"): the server's name, the
// tools' names, descriptions, input and result schemas, the JSON schemas `tools/list` answers with, the annotations and
// the exact texts of every refusal. The engine host and the normaliser parse a call's arguments with the same schemas
// (`parseToolArguments`), so the host refuses exactly the calls the normaliser declines to map (residue 1). The owner's
// skills target these names and shapes: they change only by a dated line in the P1 spec's Decision Log (A-1).
import * as z from 'zod';
import { PANE_ANSWER_MS, PANE_NAMES, PaneSchema } from './panes';

export const MAWS_SERVER_NAME = 'maws';
export const MAWS_TOOL_NAMES = ['send_file', 'ask', 'show_pane'] as const;
export type MawsToolName = (typeof MAWS_TOOL_NAMES)[number];
export const isMawsToolName = (name: unknown): name is MawsToolName => typeof name === 'string' && (MAWS_TOOL_NAMES as readonly string[]).includes(name);

// The `serverInfo` of the MCP initialize answer, carrying the app's version (the host knows it at launch).
export const mawsServerInfo = (version: string) => ({ name: MAWS_SERVER_NAME, version });

// Residue 5: none of the three tools mutates the repository, so the engine may run them in plan mode and batch them.
export const MAWS_TOOL_ANNOTATIONS = { readOnlyHint: true, openWorldHint: false } as const;

// ---------------------------------------------------------------------------------------------------------------------
// Inputs (strict; validators never default: `blocking`, `multi`, `allowOther`, `multiple` and a question's `id` take
// their defaults where they are read)

export const SendFileInputSchema = z.strictObject({
  files: z.array(z.string().min(1)).min(1).max(20),
  caption: z.string().max(2000).optional(),
  urgency: z.enum(['normal', 'high']).optional(),
});
export type SendFileInput = z.infer<typeof SendFileInputSchema>;

export const ASK_MODALITIES = ['choice', 'text', 'file', 'folder', 'repository'] as const;
export type AskModality = (typeof ASK_MODALITIES)[number];

export const AskOptionSchema = z.strictObject({ label: z.string().min(1).max(200), description: z.string().max(500).optional() });

// The fields that belong to one modality only; any of them on another modality is refused.
const MODALITY_FIELDS: Record<'options' | 'multi' | 'allowOther' | 'multiple' | 'placeholder', readonly AskModality[]> = {
  options: ['choice'], multi: ['choice'], allowOther: ['choice'], multiple: ['file', 'folder'], placeholder: ['text'],
};

export const AskQuestionSchema = z
  .strictObject({
    id: z.string().max(64).optional(), // default `q<n>` by position (askQuestionId)
    question: z.string().min(1).max(2000),
    header: z.string().max(60).optional(),
    modality: z.enum(ASK_MODALITIES),
    options: z.array(AskOptionSchema).min(1).max(12).optional(),
    multi: z.boolean().optional(), // default false
    allowOther: z.boolean().optional(), // default true
    multiple: z.boolean().optional(), // default false
    placeholder: z.string().max(200).optional(),
  })
  .superRefine((question, ctx) => {
    if (question.modality === 'choice' && question.options === undefined) ctx.addIssue({ code: 'custom', path: ['options'], message: 'a choice question needs options' });
    for (const [field, modalities] of Object.entries(MODALITY_FIELDS)) {
      if (question[field as keyof typeof MODALITY_FIELDS] !== undefined && !modalities.includes(question.modality)) {
        ctx.addIssue({ code: 'custom', path: [field], message: `${field} is for ${modalities.join(' or ')} questions only` });
      }
    }
  });
export type AskQuestion = z.infer<typeof AskQuestionSchema>;

export const AskInputSchema = z
  .strictObject({
    title: z.string().max(120).optional(),
    context: z.string().max(2000).optional(),
    blocking: z.boolean().optional(), // default true
    questions: z.array(AskQuestionSchema).min(1).max(12),
  })
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    input.questions.forEach((question, index) => {
      const id = askQuestionId(question, index);
      if (seen.has(id)) ctx.addIssue({ code: 'custom', path: ['questions', index, 'id'], message: `the id "${id}" is used twice` });
      seen.add(id);
    });
  });
export type AskInput = z.infer<typeof AskInputSchema>;

// A question's id: its own, else `q<n>` by its 1-based position.
export function askQuestionId(question: Pick<AskQuestion, 'id'>, index: number): string {
  return question.id ?? `q${index + 1}`;
}

export const ShowPaneInputSchema = z
  .strictObject({
    pane: PaneSchema,
    target: z.string().max(4096).optional(),
    line: z.number().int().min(1).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.line !== undefined && input.pane !== 'file') ctx.addIssue({ code: 'custom', path: ['line'], message: 'line is for the file pane only' });
  });
export type ShowPaneInput = z.infer<typeof ShowPaneInputSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Results (the text block of a successful call is this JSON, pretty-printed; `isError` absent)

export const DeliveredFileSchema = z.strictObject({ id: z.string(), path: z.string(), name: z.string() });
export type DeliveredFile = z.infer<typeof DeliveredFileSchema>;
export const SendFileResultSchema = z.strictObject({ status: z.literal('delivered'), deliverables: z.array(DeliveredFileSchema) });
export type SendFileResult = z.infer<typeof SendFileResultSchema>;

export const AskAnswerSchema = z.strictObject({
  id: z.string(),
  question: z.string(),
  status: z.enum(['answered', 'skipped', 'decide_for_me']),
  // choice: the chosen labels (one entry for single-select); text: the text; file and folder: absolute paths;
  // repository: the project's directory
  value: z.union([z.string(), z.array(z.string())]).optional(),
  otherText: z.string().optional(), // choice: what was typed under Other, present only when used
  name: z.string().optional(), // repository: the project's name
});
export type AskAnswer = z.infer<typeof AskAnswerSchema>;

export const AskResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('answered'), askId: z.string(), answers: z.array(AskAnswerSchema) }),
  z.strictObject({ status: z.literal('asked'), askId: z.string() }),
]);
export type AskResult = z.infer<typeof AskResultSchema>;

export const ShowPaneOpenedSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('panel-tool'), toolId: z.string(), tabId: z.string(), title: z.string() }),
  z.strictObject({ kind: z.literal('main-tab'), tabId: z.string(), path: z.string(), line: z.number().int().nullable() }),
]);
export type ShowPaneOpened = z.infer<typeof ShowPaneOpenedSchema>;
export const ShowPaneResultSchema = z.strictObject({ status: z.literal('shown'), pane: PaneSchema, opened: ShowPaneOpenedSchema });
export type ShowPaneResult = z.infer<typeof ShowPaneResultSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// The tools as `tools/list` describes them (descriptions exact; A-18: the fallback sentence first)

export const MAWS_TOOLS = {
  send_file: {
    title: 'Send file',
    description:
      'Deliver files to the user inside MAWS; without this tool, write the file and tell the user its path. Each delivered file becomes a row in the MAWS transcript with your caption and buttons to open it or reveal it in Finder; use it when you have produced something the user should look at (a PDF, an HTML page, an image, a document). Paths may be absolute or relative to the working directory and must name existing files. Returns the deliverable ids MAWS recorded.',
    input: SendFileInputSchema,
  },
  ask: {
    title: 'Ask questions',
    description:
      'Ask the user one or several questions at once through a MAWS sheet; without this tool, use AskUserQuestion. Each question has a modality: "choice" (options, single or multi, with an Other row), "text" (free text), "file" or "folder" (a native picker returning absolute paths), or "repository" (one of the user\'s MAWS projects). The user may answer any question with "decide for me" or skip it. With blocking true (the default) the call waits for the answers and returns them; with blocking false it returns {status: "asked", askId} at once and the answers arrive later as a user message that names the askId, so you can keep working meanwhile.',
    input: AskInputSchema,
  },
  show_pane: {
    title: 'Show pane',
    description:
      'Open a MAWS pane for the user: "diff", "file", "terminal", "tasks", "deliverable", "browser" or "source-control"; without this tool, describe where the user should look. target names what to open: a file path for diff or file (line optional), a deliverable id for deliverable, a URL for browser. Returns what was opened, or an error for an unknown pane or a pane this build of MAWS does not have.',
    input: ShowPaneInputSchema,
  },
} as const satisfies Record<MawsToolName, { title: string; description: string; input: z.ZodType }>;

export interface MawsToolListEntry {
  name: MawsToolName;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, unknown>;
}

// The `tools/list` answer's entries, in MAWS_TOOL_NAMES order.
export function mawsToolList(): MawsToolListEntry[] {
  return MAWS_TOOL_NAMES.map((name) => {
    const { title, description, input } = MAWS_TOOLS[name];
    return { name, title, description, inputSchema: z.toJSONSchema(input) as Record<string, unknown>, annotations: { ...MAWS_TOOL_ANNOTATIONS, title } };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Refusals (exact prefixes; the rest names the offender)

export const TOOL_ERRORS = {
  invalidArguments: (tool: MawsToolName, issues: string) => `${tool}: invalid arguments: ${issues}`,
  unknownTool: (name: string) => `unknown tool "${name}"; the maws server has ${MAWS_TOOL_NAMES.join(', ')}`,
  notAFile: (path: string) => `send_file: not a file: ${path}`,
  sessionEnded: 'ask: the session ended before the user answered',
  unknownPane: (pane: string) => `show_pane: unknown pane "${pane}"; known panes: ${PANE_NAMES.join(', ')}`,
  paneUnavailable: (pane: string) => `show_pane: the ${pane} pane is not available in this build of MAWS`,
  targetRequired: (pane: string) => `show_pane: a target is required for the ${pane} pane`,
  fileNotFound: (path: string) => `show_pane: file not found: ${path}`,
  paneTimeout: `show_pane: no MAWS window answered within ${PANE_ANSWER_MS / 1000} s`,
} as const;

function issuesText(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');
}

type ToolInput<N extends MawsToolName> = z.infer<(typeof MAWS_TOOLS)[N]['input']>;

// A call's arguments through the tool's input schema: the data, or the refusal text the host answers (an unknown pane
// named with the known ones, every other refusal by its issues).
export function parseToolArguments<N extends MawsToolName>(name: N, args: unknown): { ok: true; data: ToolInput<N> } | { ok: false; error: string } {
  const parsed = MAWS_TOOLS[name].input.safeParse(args);
  if (parsed.success) return { ok: true, data: parsed.data as ToolInput<N> };
  const pane = (args as { pane?: unknown } | null | undefined)?.pane;
  if (name === 'show_pane' && pane !== undefined && parsed.error.issues.some((issue) => issue.path.length === 1 && issue.path[0] === 'pane')) return { ok: false, error: TOOL_ERRORS.unknownPane(String(pane)) };
  return { ok: false, error: TOOL_ERRORS.invalidArguments(name, issuesText(parsed.error)) };
}
