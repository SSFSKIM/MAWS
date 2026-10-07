// X9, the `maws` tool server (P1 spec §3 A and §10 X9; E1 execution document, Interfaces "X9"): the server's name, the
// tools' names, descriptions, input and result schemas, the JSON schemas `tools/list` answers with, the annotations and
// the exact texts of every refusal. The engine host and the normaliser parse a call's arguments with the same schemas
// (`parseToolArguments`), so the host refuses exactly the calls the normaliser declines to map (residue 1). The owner's
// skills target these names and shapes: they change only by a dated line in the P1 spec's Decision Log (A-1).
// E2 appends the four artifact tools (E2 execution document, Design §6 and Interfaces "X9 additions"), listed from the
// first `tools/list` (Decision Log 3), each with its own annotations (Decision Log 4).
import * as z from 'zod';
import { CAPTURE_ANSWER_MS, PANE_ANSWER_MS, PANE_NAMES, PaneSchema } from './panes';

export const MAWS_SERVER_NAME = 'maws';
export const MAWS_TOOL_NAMES = ['send_file', 'ask', 'show_pane', 'artifact_create', 'artifact_update', 'artifact_list', 'artifact_screenshot'] as const;
export type MawsToolName = (typeof MAWS_TOOL_NAMES)[number];
export const isMawsToolName = (name: unknown): name is MawsToolName => typeof name === 'string' && (MAWS_TOOL_NAMES as readonly string[]).includes(name);

// The `serverInfo` of the MCP initialize answer, carrying the app's version (the host knows it at launch).
export const mawsServerInfo = (version: string) => ({ name: MAWS_SERVER_NAME, version });

// Residue 5: none of E1's three tools mutates the repository, so the engine may run them in plan mode and batch them.
// The read-only default; a tool's own annotations are `MAWS_TOOLS[name].annotations`.
export const MAWS_TOOL_ANNOTATIONS = { readOnlyHint: true, openWorldHint: false } as const;
// E2 (Decision Log 4): `readOnlyHint` drives the engine's `isConcurrencySafe` and `isReadOnly` (SPEC 31 :4472-4489), so
// the two tools that add an artifact version are not read-only: two of them never run in parallel, and registering
// output is not planning.
const ARTIFACT_WRITER_ANNOTATIONS = { readOnlyHint: false, openWorldHint: false } as const;

// E2: an artifact's id is the short name the agent gives it, unique within a session; the size cap of its HTML; the
// screenshot's default viewport and the cap on its PNG (applied in main).
export const ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const ARTIFACT_MAX_BYTES = 16 * 1024 * 1024;
export const ARTIFACT_SCREENSHOT_DEFAULT = { width: 1280, height: 800 } as const;
export const ARTIFACT_SCREENSHOT_MAX_BYTES = 4 * 1024 * 1024;

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

// E2: `html_path` is resolved against the working directory; `title` on an update renames the artifact with its new
// version (Decision Log 5); the screenshot's size defaults to ARTIFACT_SCREENSHOT_DEFAULT where it is read.
const ArtifactIdSchema = z.string().regex(ARTIFACT_ID);
const HtmlPathSchema = z.string().min(1).max(4096);
const ArtifactTitleSchema = z.string().min(1).max(200);

export const ArtifactCreateInputSchema = z.strictObject({ id: ArtifactIdSchema, html_path: HtmlPathSchema, title: ArtifactTitleSchema });
export type ArtifactCreateInput = z.infer<typeof ArtifactCreateInputSchema>;
export const ArtifactUpdateInputSchema = z.strictObject({ id: ArtifactIdSchema, html_path: HtmlPathSchema, title: ArtifactTitleSchema.optional() });
export type ArtifactUpdateInput = z.infer<typeof ArtifactUpdateInputSchema>;
export const ArtifactListInputSchema = z.strictObject({});
export const ArtifactScreenshotInputSchema = z.strictObject({
  id: ArtifactIdSchema,
  version: z.number().int().min(1).optional(), // the latest by default
  width: z.number().int().min(320).max(2560).optional(),
  height: z.number().int().min(240).max(2560).optional(),
});
export type ArtifactScreenshotInput = z.infer<typeof ArtifactScreenshotInputSchema>;

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

// E2: `id` is the agent's short name, `deliverableId` the record's uuid; `externalReferences` counts the http(s) URLs
// the page names (advisory: the frame loads none of them). The screenshot's text block follows its image block and
// carries the title the transcript's cell names it by (Decision Log 23); `bytes` is the PNG's size.
export const ArtifactCreateResultSchema = z.strictObject({
  status: z.literal('created'), id: z.string(), deliverableId: z.uuid(), version: z.literal(1), title: z.string(), externalReferences: z.number().int().min(0),
});
export type ArtifactCreateResult = z.infer<typeof ArtifactCreateResultSchema>;
export const ArtifactUpdateResultSchema = z.strictObject({
  status: z.literal('updated'), id: z.string(), deliverableId: z.uuid(), version: z.number().int().min(2), title: z.string(), externalReferences: z.number().int().min(0),
});
export type ArtifactUpdateResult = z.infer<typeof ArtifactUpdateResultSchema>;
export const ListedArtifactSchema = z.strictObject({ id: z.string(), deliverableId: z.uuid(), title: z.string(), versions: z.number().int().min(1), createdAt: z.string(), updatedAt: z.string() });
export type ListedArtifact = z.infer<typeof ListedArtifactSchema>;
export const ArtifactListResultSchema = z.strictObject({ status: z.literal('listed'), artifacts: z.array(ListedArtifactSchema) });
export type ArtifactListResult = z.infer<typeof ArtifactListResultSchema>;
export const ArtifactScreenshotResultSchema = z.strictObject({
  status: z.literal('captured'), id: z.string(), deliverableId: z.uuid(), title: z.string(), version: z.number().int().min(1),
  width: z.number().int(), height: z.number().int(), bytes: z.number().int().min(0), consoleErrors: z.array(z.string()),
});
export type ArtifactScreenshotResult = z.infer<typeof ArtifactScreenshotResultSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// The tools as `tools/list` describes them (descriptions exact; A-18: the fallback sentence first)

export const MAWS_TOOLS = {
  send_file: {
    title: 'Send file',
    description:
      'Deliver files to the user inside MAWS; without this tool, write the file and tell the user its path. Each delivered file becomes a row in the MAWS transcript with your caption and buttons to open it or reveal it in Finder; use it when you have produced something the user should look at (a PDF, an HTML page, an image, a document). Paths may be absolute or relative to the working directory and must name existing files. Returns the deliverable ids MAWS recorded.',
    input: SendFileInputSchema,
    annotations: MAWS_TOOL_ANNOTATIONS,
  },
  ask: {
    title: 'Ask questions',
    description:
      'Ask the user one or several questions at once through a MAWS sheet; without this tool, use AskUserQuestion. Each question has a modality: "choice" (options, single or multi, with an Other row), "text" (free text), "file" or "folder" (a native picker returning absolute paths), or "repository" (one of the user\'s MAWS projects). The user may answer any question with "decide for me" or skip it. With blocking true (the default) the call waits for the answers and returns them; with blocking false it returns {status: "asked", askId} at once and the answers arrive later as a user message that names the askId, so you can keep working meanwhile.',
    input: AskInputSchema,
    annotations: MAWS_TOOL_ANNOTATIONS,
  },
  show_pane: {
    title: 'Show pane',
    description:
      'Open a MAWS pane for the user: "diff", "file", "terminal", "tasks", "deliverable", "browser" or "source-control"; without this tool, describe where the user should look. target names what to open: a file path for diff or file (line optional), a deliverable id for deliverable, a URL for browser. Returns what was opened, or an error for an unknown pane or a pane this build of MAWS does not have.',
    input: ShowPaneInputSchema,
    annotations: MAWS_TOOL_ANNOTATIONS,
  },
  // E2 start
  artifact_create: {
    title: 'Create artifact',
    description:
      "Register a self-contained HTML file you wrote as a MAWS artifact the user can view and comment on; without this tool, write the HTML file and tell the user its path. Give it a short id you will reuse for updates, the path of the HTML file (absolute or relative to the working directory) and a title. MAWS copies the file, keeps every version, shows it in a sandboxed frame with no network access (inline everything: styles, scripts, images as data URLs) and reports how many external URLs it found. Returns the artifact's deliverable id and version 1.",
    input: ArtifactCreateInputSchema,
    annotations: ARTIFACT_WRITER_ANNOTATIONS,
  },
  artifact_update: {
    title: 'Update artifact',
    description:
      "Add a new version of a MAWS artifact from an HTML file you rewrote; without this tool, write the HTML file and tell the user its path. Names the artifact by the id you gave artifact_create; the user can switch between versions, and a title replaces the artifact's title. Returns the new version number.",
    input: ArtifactUpdateInputSchema,
    annotations: ARTIFACT_WRITER_ANNOTATIONS,
  },
  artifact_list: {
    title: 'List artifacts',
    description: 'List the artifacts this session registered with MAWS, with their ids, titles and version counts; without this tool, keep your own list of the HTML files you wrote.',
    input: ArtifactListInputSchema,
    annotations: MAWS_TOOL_ANNOTATIONS,
  },
  artifact_screenshot: {
    title: 'Screenshot artifact',
    description:
      'Capture a PNG screenshot of a MAWS artifact as the user sees it, rendered in a sandboxed frame with no network; without this tool, describe the page from its source. Names the artifact by id and optionally a version (the latest by default) and a viewport size (1280 by 800 by default). Returns the image and the console errors the page logged while loading, so you can check your work.',
    input: ArtifactScreenshotInputSchema,
    annotations: MAWS_TOOL_ANNOTATIONS,
  },
  // E2 end
} as const satisfies Record<MawsToolName, { title: string; description: string; input: z.ZodType; annotations: { readOnlyHint: boolean; openWorldHint: boolean } }>;

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
    const { title, description, input, annotations } = MAWS_TOOLS[name];
    return { name, title, description, inputSchema: z.toJSONSchema(input) as Record<string, unknown>, annotations: { ...annotations, title } };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Refusals (exact prefixes; the rest names the offender)

export type ArtifactToolName = Extract<MawsToolName, `artifact_${string}`>; // E2
const MIB = 1024 * 1024;

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
  // E2 start: each artifact refusal names the tool whose call it answers (E1's `notAFile` stays `send_file`'s)
  artifactNotAFile: (tool: ArtifactToolName, path: string) => `${tool}: not a file: ${path}`,
  notHtml: (tool: ArtifactToolName, path: string) => `${tool}: not an HTML file: ${path}`,
  tooLarge: (tool: ArtifactToolName, path: string, bytes: number) => `${tool}: too large: ${path} (${bytes} bytes; the limit is ${ARTIFACT_MAX_BYTES / MIB} MiB)`,
  artifactExists: (id: string) => `artifact_create: an artifact "${id}" already exists in this session; use artifact_update`,
  noArtifact: (tool: ArtifactToolName, id: string) => `${tool}: no artifact "${id}" in this session${tool === 'artifact_update' ? '; use artifact_create' : ''}`,
  noVersion: (id: string, version: number, versions: number) => `artifact_screenshot: version ${version} does not exist; "${id}" has ${versions} version(s)`,
  captureFailed: (reason: string) => `artifact_screenshot: MAWS could not capture the artifact: ${reason}`,
  captureTimeout: `artifact_screenshot: MAWS did not answer within ${CAPTURE_ANSWER_MS / 1000} s`,
  notRecorded: (tool: ArtifactToolName, path: string, message: string) => `${tool}: ${path} was not recorded: ${message}`,
  deliverableNotFound: (id: string) => `show_pane: no deliverable "${id}" in this session`,
  deliverableUnreadable: (id: string, message: string) => `show_pane: could not read deliverable "${id}": ${message}`, // E2: main refused the read
  // E2 end
  // E10: a bridge request made while no app is connected to the engine host (the detached supervisor), answered at once
  appNotOpen: (tool: 'show_pane' | 'artifact_screenshot') => `${tool}: MAWS is not open; the ${tool === 'show_pane' ? 'pane cannot be shown' : 'artifact cannot be captured'}`,
  // E4a start: a target the browser refuses (not http or https; `validateBrowserUrl`); E4c's tools pass their own name
  navigationRefused: (target: string, tool: MawsToolName = 'show_pane') => `${tool}: MAWS opens only http and https pages in its browser; refused "${target}"`,
  // E4a end
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
