// X9, the `maws` tool server (P1 spec §3 A and §10 X9; E1 execution document, Interfaces "X9"): the server's name, the
// tools' names, descriptions, input and result schemas, the JSON schemas `tools/list` answers with, the annotations and
// the exact texts of every refusal. The engine host and the normaliser parse a call's arguments with the same schemas
// (`parseToolArguments`), so the host refuses exactly the calls the normaliser declines to map (residue 1). The owner's
// skills target these names and shapes: they change only by a dated line in the P1 spec's Decision Log (A-1).
// E2 appends the four artifact tools (E2 execution document, Design §6 and Interfaces "X9 additions"), listed from the
// first `tools/list` (Decision Log 3), each with its own annotations (Decision Log 4).
// E4c appended six browser tools after the artifact tools; they left the server on 2026-10-08 (P1 A-54: cua_repl drives
// the in-app browser), and `./browser` keeps their names and schemas only to read journals written before.
// P3-A (M6; X25, the P3 composite spec §4.3) gives the artifact namespace its shape over the engine host's artifact store:
// `artifact_create` gains kinds, six tools are appended, and `artifact_update` is retired into `artifact_publish`
// (`./artifact-update` keeps its schemas for the journals written before). P3-B, P3-C, P3-H and P3-D append after A:
// a name to `MAWS_TOOL_NAMES`, its schemas, its `MAWS_TOOLS` entry and its refusals, each in a block of its own.
import * as z from 'zod';
import { ArtifactKindSchema } from '../artifacts/entity'; // P3-A
import { AppSessionIdSchema } from '../graph/ids'; // P2-E1
import { ARTIFACT_ID } from './artifact-id';
import { CAPTURE_ANSWER_MS, PANE_ANSWER_MS, PANE_NAMES, PaneSchema } from './panes';

export { ARTIFACT_ID } from './artifact-id';

export const MAWS_SERVER_NAME = 'maws';
export const MAWS_TOOL_NAMES = [
  'send_file', 'ask', 'show_pane', 'artifact_create', 'artifact_list', 'artifact_screenshot',
  // P3-A (M6)
  'artifact_describe_type', 'artifact_read', 'artifact_publish', 'artifact_upload_asset', 'artifact_list_assets', 'artifact_export',
] as const;
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

// E2: the size cap of an artifact's HTML (`ARTIFACT_ID`, its short name, is `./artifact-id`'s); the screenshot's default
// viewport and the cap on its PNG (applied in main).
export const ARTIFACT_MAX_BYTES = 16 * 1024 * 1024;
export const ARTIFACT_SCREENSHOT_DEFAULT = { width: 1280, height: 800 } as const;
export const ARTIFACT_SCREENSHOT_MAX_BYTES = 3.5 * 1024 * 1024; // A-34: its base64 stays under the API's 5 MB per image

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

// E2: a path is resolved against the working directory; the screenshot's size defaults to ARTIFACT_SCREENSHOT_DEFAULT
// where it is read. P3-A (Decision Log 3): every tool that names an artifact takes its id (the store's UUID) or a handle
// the calling session or one above it created; both match ARTIFACT_ID.
const ArtifactIdSchema = z.string().regex(ARTIFACT_ID);
const PathSchema = z.string().min(1).max(4096);
const ArtifactTitleSchema = z.string().min(1).max(200);
// P3-A: a file of a file kind (the generic file model, Decision Log 10), by its relative path
const FilePathSchema = z.string().min(1).max(512);
const FileTextSchema = z.string().max(ARTIFACT_MAX_BYTES); // characters; the store caps the bytes

// P3-A (M6): `kind` defaults to `html`; an `html` page comes from `path` (an `.html` file) or `content` (its text), a
// `file` artifact from `path` (in place), a `document` from nothing or markdown `content` (P3-B's create, ledger X25),
// another Y kind from nothing or `files`. E2's `id` and `html_path` are accepted as
// `handle` and `path`, so the call skills already make keeps working.
export const ArtifactCreateInputSchema = z
  .strictObject({
    kind: ArtifactKindSchema.optional(),
    title: ArtifactTitleSchema,
    handle: ArtifactIdSchema.optional(),
    path: PathSchema.optional(),
    files: z.record(FilePathSchema, FileTextSchema).optional(),
    content: FileTextSchema.optional(),
    id: ArtifactIdSchema.optional(), // E2's name for `handle`
    html_path: PathSchema.optional(), // E2's name for `path`
  })
  .superRefine((input, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (input.id !== undefined && input.handle !== undefined) issue('id', 'give handle or id (its older name), not both');
    if (input.html_path !== undefined && input.path !== undefined) issue('html_path', 'give path or html_path (its older name), not both');
    const kind = input.kind ?? 'html';
    const path = input.path ?? input.html_path;
    if (kind === 'html' && (path === undefined) === (input.content === undefined)) issue('path', 'an html artifact takes path or content, one of them');
    if (kind === 'file' && path === undefined) issue('path', 'a file artifact takes the path of the file');
    if (kind !== 'html' && kind !== 'document' && input.content !== undefined) issue('content', `a ${kind} artifact takes no content`);
    if (kind !== 'html' && kind !== 'file' && path !== undefined) issue('path', `a ${kind} artifact takes files, not a path`);
    if ((kind === 'html' || kind === 'file' || kind === 'document') && input.files !== undefined) issue('files', `a ${kind} artifact takes no files`);
  });
export type ArtifactCreateInput = z.infer<typeof ArtifactCreateInputSchema>;
// `scope` defaults to `session`: the artifacts linked to this session and the sessions above it (X9's ancestors).
export const ArtifactListInputSchema = z.strictObject({
  kind: ArtifactKindSchema.optional(),
  spaceId: z.uuid().optional(),
  scope: z.enum(['session', 'all']).optional(),
  query: z.string().min(1).max(200).optional(),
});
export type ArtifactListInput = z.infer<typeof ArtifactListInputSchema>;
export const ArtifactScreenshotInputSchema = z.strictObject({
  id: ArtifactIdSchema,
  version: z.number().int().min(1).optional(), // the latest by default
  width: z.number().int().min(320).max(2560).optional(),
  height: z.number().int().min(240).max(2560).optional(),
});
export type ArtifactScreenshotInput = z.infer<typeof ArtifactScreenshotInputSchema>;
// P3-A (M6) start
export const ArtifactDescribeTypeInputSchema = z.strictObject({ kind: ArtifactKindSchema });
// P3-B's document read fields (ledger X25, the architect 2026-10-13): a tab, a block id to start from, how many blocks,
// and the changes since a revision. B's reader serves them for a document; A's generic reader ignores them. A owns them
// here, and B's `document-tools.ts` imports this export (it keeps no copy of its own; Decision Log 44d).
export const DOCUMENT_READ_FIELDS = {
  tab: z.string().min(1).max(64).optional(),
  from: z.string().min(1).max(64).optional(), // a block id
  count: z.number().int().min(1).max(1000).optional(),
  sinceRevision: z.number().int().min(0).optional(),
};
// `revision` reads a byte kind's content as of an earlier write; `version` a retained version, read-only; `paths` names
// the files of a file kind to return (all by default).
export const ArtifactReadInputSchema = z.strictObject({
  artifact: ArtifactIdSchema,
  revision: z.number().int().min(1).optional(),
  version: z.number().int().min(1).optional(),
  paths: z.array(FilePathSchema).min(1).max(200).optional(),
  ...DOCUMENT_READ_FIELDS,
});
export type ArtifactReadInput = z.infer<typeof ArtifactReadInputSchema>;
// `files` maps a path to its whole new text, `null` removing it (Decision Log 10); an `html` page is its one file
// (`index.html`, or the name it was created under).
export const ArtifactPublishInputSchema = z.strictObject({
  artifact: ArtifactIdSchema,
  baseRevision: z.number().int().min(0),
  files: z.record(FilePathSchema, FileTextSchema.nullable()).refine((files) => Object.keys(files).length > 0, { message: 'name at least one file' }),
  force: z.boolean().optional(), // default false
  message: z.string().max(2000).optional(),
});
export type ArtifactPublishInput = z.infer<typeof ArtifactPublishInputSchema>;
export const ArtifactUploadAssetInputSchema = z.strictObject({ artifact: ArtifactIdSchema, path: PathSchema, name: z.string().min(1).max(200).optional() });
export type ArtifactUploadAssetInput = z.infer<typeof ArtifactUploadAssetInputSchema>;
export const ArtifactListAssetsInputSchema = z.strictObject({ artifact: ArtifactIdSchema });
export const ARTIFACT_EXPORT_FORMATS = ['pdf', 'png', 'docx', 'pptx', 'md', 'html'] as const;
export type ArtifactExportFormat = (typeof ARTIFACT_EXPORT_FORMATS)[number];
// The paper an export prints on when asked (P3-A Decision Log 42, P3-B's M8); omitted, the exporter's own default.
export const ARTIFACT_EXPORT_PAGE_SIZES = ['letter', 'a4'] as const;
export type ArtifactExportPageSize = (typeof ARTIFACT_EXPORT_PAGE_SIZES)[number];
export const ArtifactExportInputSchema = z.strictObject({
  artifact: ArtifactIdSchema, format: z.enum(ARTIFACT_EXPORT_FORMATS), version: z.number().int().min(1).optional(), to: PathSchema.optional(),
  pageSize: z.enum(ARTIFACT_EXPORT_PAGE_SIZES).optional(),
});
export type ArtifactExportInput = z.infer<typeof ArtifactExportInputSchema>;
// How long the host waits for main's export service to answer (P3-A M7, X31) before the call answers an error; main's
// own guard and queue keep its answer inside it.
export const EXPORT_ANSWER_MS = 60_000;
const EXPORT_EXTENSIONS: Record<ArtifactExportFormat, string> = { pdf: 'pdf', png: 'png', docx: 'docx', pptx: 'pptx', md: 'md', html: 'html' };
// An export's file name under `<userData>/artifacts/<id>/exports/` (the tool's and the library's alike).
export const artifactExportName = (revision: number, format: ArtifactExportFormat): string => `${revision}-${format}.${EXPORT_EXTENSIONS[format]}`;
// P3-A (M6) end

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

// P2-E1 (2026-10-09, a dated exception inside E2's result schemas; D10): `ownerAppSessionId` names the session whose
// X12 record the result is about when that is a side thread's ancestor, not the calling session; absent for its own.
const OwnerAppSessionIdSchema = AppSessionIdSchema.optional();
const IsoTimeSchema = z.string();

// E2's artifact row and `maws.delivery.artifact` read these fields of an answer that registered an X12 version (E2's
// create and update; P3-A's create and publish of an `html` artifact, whose X12 mirror it reports, Decision Log 4): `id`
// the name the agent gave it (its handle, else its id), `deliverableId` the record's uuid (the artifact's id),
// `version` the record's 1-based version. Loose on purpose: every answer shape that carries them reads alike.
export const ArtifactDeliverySchema = z.object({
  id: z.string(), deliverableId: z.uuid(), version: z.number().int().min(1), title: z.string(),
  ownerAppSessionId: OwnerAppSessionIdSchema, // P2-E1
});
export type ArtifactDelivery = z.infer<typeof ArtifactDeliverySchema>;

// P3-A (M6): the kind's guide, attached once per session to the first create of that kind (§4.3).
const KindGuideSchema = z.strictObject({ guide: z.string(), format: z.string() });
// An `html` create also answers E2's fields for its X12 mirror (`id`, `deliverableId`, `version` 1,
// `externalReferences`: the http(s) URLs the page names, advisory: the frame loads none of them).
export const ArtifactCreateResultSchema = z.strictObject({
  status: z.literal('created'), artifactId: z.uuid(), kind: ArtifactKindSchema, title: z.string(), revision: z.number().int().min(0),
  handle: z.string().optional(),
  id: z.string().optional(), deliverableId: z.uuid().optional(), version: z.literal(1).optional(), externalReferences: z.number().int().min(0).optional(),
  guide: KindGuideSchema.optional(),
  designSystem: z.string().optional(), // the governing design system's DESIGN.md (Decision Log 22d)
});
export type ArtifactCreateResult = z.infer<typeof ArtifactCreateResultSchema>;
// Who wrote an artifact last: the user, the calling session, or another session (named).
export const ArtifactEditorSchema = z.strictObject({ by: z.enum(['user', 'this session', 'another session']), appSessionId: AppSessionIdSchema.optional(), at: IsoTimeSchema });
export type ArtifactEditor = z.infer<typeof ArtifactEditorSchema>;
export const ListedArtifactSchema = z.strictObject({
  id: z.uuid(), handle: z.string().optional(), kind: ArtifactKindSchema, title: z.string(), revision: z.number().int().min(0), updatedAt: IsoTimeSchema,
  lastEditor: ArtifactEditorSchema.nullable(),
});
export type ListedArtifact = z.infer<typeof ListedArtifactSchema>;
export const ArtifactListResultSchema = z.strictObject({ status: z.literal('listed'), artifacts: z.array(ListedArtifactSchema) });
export type ArtifactListResult = z.infer<typeof ArtifactListResultSchema>;
export const ArtifactScreenshotResultSchema = z.strictObject({
  status: z.literal('captured'), id: z.string(), deliverableId: z.uuid(), title: z.string(), version: z.number().int().min(1),
  width: z.number().int(), height: z.number().int(), bytes: z.number().int().min(0), consoleErrors: z.array(z.string()),
  ownerAppSessionId: OwnerAppSessionIdSchema, // P2-E1
});
export type ArtifactScreenshotResult = z.infer<typeof ArtifactScreenshotResultSchema>;
// P3-A (M6) start
export const ArtifactDescribeTypeResultSchema = z.strictObject({
  status: z.literal('described'), kind: ArtifactKindSchema, guide: z.string(), format: z.string(),
  designSystem: z.string().optional(), // a document, presentation or design: the governing design system's DESIGN.md (Decision Log 42)
});
export type ArtifactDescribeTypeResult = z.infer<typeof ArtifactDescribeTypeResultSchema>;
const VersionSummarySchema = z.strictObject({ id: z.number().int().min(1), kind: z.string(), revision: z.number().int().min(0), at: IsoTimeSchema, by: ArtifactEditorSchema.shape.by, label: z.string().optional() });
export type VersionSummary = z.infer<typeof VersionSummarySchema>;
// A file kind's and an `html` artifact's `files`; a Y kind's other root types as `json` (the generic reader, until the
// kind registers its own); a `file` artifact's `file`. `versions`: the latest ones, newest first (ids `version` takes).
export const ArtifactReadResultSchema = z.strictObject({
  status: z.literal('read'), artifactId: z.uuid(), kind: ArtifactKindSchema, title: z.string(), revision: z.number().int().min(0),
  handle: z.string().optional(),
  version: VersionSummarySchema.optional(), // when a version was read
  files: z.record(z.string(), z.string()).optional(),
  missing: z.array(z.string()).optional(), // named paths the artifact has no file at
  json: z.record(z.string(), z.unknown()).optional(),
  file: z.strictObject({ name: z.string(), path: z.string(), size: z.number().int().min(0), sha256: z.string(), text: z.string().optional(), exists: z.boolean() }).optional(),
  versions: z.array(VersionSummarySchema),
});
export type ArtifactReadResult = z.infer<typeof ArtifactReadResultSchema>;
// `changed` and `removed` are the paths the publish wrote; `kept`, the artifact's other files, as they are live. An
// `html` publish also answers E2's fields for its X12 mirror's new version.
export const ArtifactPublishResultSchema = z.strictObject({
  status: z.literal('published'), artifactId: z.uuid(), kind: ArtifactKindSchema, title: z.string(), revision: z.number().int().min(0),
  changed: z.array(z.string()), kept: z.array(z.string()), removed: z.array(z.string()),
  id: z.string().optional(), deliverableId: z.uuid().optional(), version: z.number().int().min(1).optional(), externalReferences: z.number().int().min(0).optional(),
  ownerAppSessionId: OwnerAppSessionIdSchema, // P2-E1: the X12 record is its creator's
});
export type ArtifactPublishResult = z.infer<typeof ArtifactPublishResultSchema>;
export const ArtifactUploadAssetResultSchema = z.strictObject({ status: z.literal('uploaded'), artifactId: z.uuid(), assetId: z.string(), ref: z.string(), name: z.string(), size: z.number().int().min(0) });
export type ArtifactUploadAssetResult = z.infer<typeof ArtifactUploadAssetResultSchema>;
export const ListedAssetSchema = z.strictObject({ assetId: z.string(), ref: z.string(), name: z.string(), mime: z.string(), size: z.number().int().min(0), createdAt: IsoTimeSchema });
export const ArtifactListAssetsResultSchema = z.strictObject({ status: z.literal('listed'), artifactId: z.uuid(), assets: z.array(ListedAssetSchema) });
export type ArtifactListAssetsResult = z.infer<typeof ArtifactListAssetsResultSchema>;
export const ArtifactExportResultSchema = z.strictObject({
  status: z.literal('exported'), artifactId: z.uuid(), format: z.enum(ARTIFACT_EXPORT_FORMATS), revision: z.number().int().min(0), path: z.string(), copiedTo: z.string().optional(),
  blockedRequests: z.number().int().positive().optional(), // remote resources the page named, which the export did not load (P3-A Decision Log 44b)
});
export type ArtifactExportResult = z.infer<typeof ArtifactExportResultSchema>;

// A refusal an agent can act on: the `isError` text is `<tool>: <sentence> <this JSON>` (`artifactRefusalOf` reads it).
export const ARTIFACT_REFUSAL_REASONS = ['notFound', 'invalid', 'tooLarge', 'handleTaken', 'staleBase', 'conflict', 'exportUnavailable', 'unavailable'] as const;
export type ArtifactRefusalReason = (typeof ARTIFACT_REFUSAL_REASONS)[number];
export const ArtifactRefusalSchema = z.looseObject({ reason: z.enum(ARTIFACT_REFUSAL_REASONS) });
export type ArtifactRefusal = z.infer<typeof ArtifactRefusalSchema>;
// P3-A (M6) end

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
  // E2 start (P3-A M6: `artifact_create` gains kinds and `artifact_list` the library; `artifact_update` retired)
  artifact_create: {
    title: 'Create artifact',
    description:
      "Create a MAWS artifact the user can view, comment on and edit with you; without this tool, write the file and tell the user its path. kind is html by default: a self-contained HTML page from path (a .html file you wrote, absolute or relative to the working directory) or content (its text), shown in a sandboxed frame with no network access (inline everything: styles, scripts, images as data URLs); file delivers a file in place from path; a document starts empty or from markdown content; presentation, design, design_system and dashboard start empty or from files (path to text). Give a title and optionally a short handle to name it by in later calls (id and html_path are older names for handle and path). Returns the artifact's id and revision, and the first time this session creates a kind, that kind's guide and format reference.",
    input: ArtifactCreateInputSchema,
    annotations: ARTIFACT_WRITER_ANNOTATIONS,
  },
  artifact_list: {
    title: 'List artifacts',
    description:
      'List MAWS artifacts with their ids, handles, kinds, titles, revisions and who edited them last; without this tool, keep your own list of what you made. By default the artifacts this session and the sessions it was opened from created, edited or viewed; scope "all" lists the whole library. Filter by kind, Space or a title substring (query).',
    input: ArtifactListInputSchema,
    annotations: MAWS_TOOL_ANNOTATIONS,
  },
  artifact_screenshot: {
    title: 'Screenshot artifact',
    description:
      'Capture a PNG screenshot of a MAWS html artifact as the user sees it, rendered in a sandboxed frame with no network; without this tool, describe the page from its source. Names the artifact by id or handle and optionally a version (the latest by default) and a viewport size (1280 by 800 by default). Returns the image and the console errors the page logged while loading, so you can check your work.',
    input: ArtifactScreenshotInputSchema,
    annotations: MAWS_TOOL_ANNOTATIONS,
  },
  // E2 end
  // P3-A (M6) start
  artifact_describe_type: {
    title: 'Describe artifact kind',
    description:
      "Return a MAWS artifact kind's guide (when to use it, how to create, read and edit it) and its format reference; without this tool, use the guide artifact_create returned. Kinds: document, presentation, design, design_system, dashboard, html, file. For a document, presentation or design it also returns the governing design system's DESIGN.md when one governs.",
    input: ArtifactDescribeTypeInputSchema,
    annotations: MAWS_TOOL_ANNOTATIONS,
  },
  artifact_read: {
    title: 'Read artifact',
    description:
      "Read a MAWS artifact by id or handle; without this tool, ask the user what the artifact holds. Returns its live revision and content: an html page or a file kind's files (all, or the paths named), a document's structure, a file artifact's path and metadata (and its text when under 1 MiB). version reads one of the retained versions listed in the answer, read-only; revision reads an html page as an earlier write left it; for a document, tab, from, count and sinceRevision read one tab, count blocks from a block id, or the changes since a revision (other kinds ignore them). Read before you publish: artifact_publish takes the revision this read returned.",
    input: ArtifactReadInputSchema,
    annotations: MAWS_TOOL_ANNOTATIONS,
  },
  artifact_publish: {
    title: 'Publish artifact',
    description:
      "Write files of a MAWS artifact as one change, an html page or a file kind's files; without this tool, write the files to disk and tell the user. files maps each path to its whole new text, null removing it (an html page is its one file, index.html); baseRevision is the revision your last artifact_read (or create or publish) of it returned. A publish from an older revision is refused naming the live one: read again. Files nobody changed since your read merge over the live artifact and the others are kept; a file someone else changed since your read refuses the publish naming it (read, apply your change to what you read, publish again; force: true overwrites them as a last resort). All of it lands or none. Returns the new revision and the files changed, kept and removed.",
    input: ArtifactPublishInputSchema,
    annotations: ARTIFACT_WRITER_ANNOTATIONS,
  },
  artifact_upload_asset: {
    title: 'Upload artifact asset',
    description:
      "Add a file under the working directory (an image, a font; at most 16 MiB) to a MAWS artifact's assets; without this tool, inline it as a data URL. Returns the asset's ref (assets/<name>), the path the artifact's format uses to refer to it.",
    input: ArtifactUploadAssetInputSchema,
    annotations: ARTIFACT_WRITER_ANNOTATIONS,
  },
  artifact_list_assets: {
    title: 'List artifact assets',
    description: "List a MAWS artifact's assets with their refs, names, types and sizes; without this tool, keep your own list of what you uploaded.",
    input: ArtifactListAssetsInputSchema,
    annotations: MAWS_TOOL_ANNOTATIONS,
  },
  artifact_export: {
    title: 'Export artifact',
    description:
      'Export a MAWS artifact (its live state, or a retained version) as a file; without this tool, tell the user to export it from MAWS. Formats: pdf or png for an html page; docx, pptx, md and html where the kind supports them. Returns the exported file\'s path; to (a path under the working directory) copies it there too; pageSize (letter or a4) chooses the paper, else the format\'s own default. Needs the MAWS app open.',
    input: ArtifactExportInputSchema,
    annotations: ARTIFACT_WRITER_ANNOTATIONS,
  },
  // P3-A (M6) end
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
  artifactExists: (id: string) => `artifact_create: an artifact "${id}" already exists in this session; use artifact_publish`,
  // P2-E1 (D10, D12): a side thread's create of an id one of its ancestors holds
  artifactExistsInParent: (id: string) => `artifact_create: an artifact "${id}" already exists in the conversation this side thread was opened from; use artifact_publish`,
  noArtifact: (tool: ArtifactToolName, id: string) => `${tool}: no artifact "${id}" in this session`,
  noVersion: (id: string, version: number, versions: number) => `artifact_screenshot: version ${version} does not exist; "${id}" has ${versions} version(s)`,
  captureFailed: (reason: string) => `artifact_screenshot: MAWS could not capture the artifact: ${reason}`,
  captureTimeout: `artifact_screenshot: MAWS did not answer within ${CAPTURE_ANSWER_MS / 1000} s`,
  deliverableNotFound: (id: string) => `show_pane: no deliverable "${id}" in this session`,
  deliverableUnreadable: (id: string, message: string) => `show_pane: could not read deliverable "${id}": ${message}`, // E2: main refused the read
  // E2 end
  // E10: a bridge request made while no app is connected to the engine host (the detached supervisor), answered at once
  appNotOpen: (tool: 'show_pane' | 'artifact_screenshot' | 'artifact_export') => `${tool}: MAWS is not open; the ${tool === 'show_pane' ? 'pane cannot be shown' : tool === 'artifact_export' ? 'artifact cannot be exported' : 'artifact cannot be captured'}`,
  // P3-A (M6) start: a refusal the agent can act on, its machine-readable reason last (`artifactRefusalOf`)
  refused: (tool: ArtifactToolName, refusal: ArtifactRefusal, sentence: string) => `${tool}: ${sentence} ${JSON.stringify(refusal)}`,
  // P3-A (M6) end
  // E4a start: a target the browser refuses (not http or https; `validateBrowserUrl`)
  navigationRefused: (target: string) => `show_pane: MAWS opens only http and https pages in its browser; refused "${target}"`,
  // E4a end
} as const;

// P3-A (M6): the machine-readable part of an artifact tool's refusal (`TOOL_ERRORS.refused`), or null for any other text.
export function artifactRefusalOf(text: string): ArtifactRefusal | null {
  const start = text.indexOf(' {"reason":');
  if (start === -1) return null;
  try {
    const parsed = ArtifactRefusalSchema.safeParse(JSON.parse(text.slice(start + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

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
