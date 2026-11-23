// X9, the `maws` tool server (P1 spec §3 A and §10 X9; E1 execution document, Interfaces "X9"): the server's name, the
// tools' names, descriptions, input and result schemas, the JSON schemas `tools/list` answers with, the annotations and
// the exact texts of every refusal. The engine host and the normaliser parse a call's arguments with the same schemas
// (`parseToolArguments`), so the host refuses exactly the calls the normaliser declines to map (residue 1), with one
// exception since U6d: a call for the retired `artifact` pane, which the host refuses with `artifactPaneRetired` and the
// normaliser, reading every record with `parseRecordedToolArguments`, still maps to its `maws.pane.shown`. The owner's
// skills target these names and shapes: they change only by a dated line in the P1 spec's Decision Log (A-1).
// E2 appends the four artifact tools (E2 execution document, Design §6 and Interfaces "X9 additions"), listed from the
// first `tools/list` (Decision Log 3), each with its own annotations (Decision Log 4).
// E4c appended six browser tools after the artifact tools; they left the server on 2026-10-08 (P1 A-54: cua_repl drives
// the in-app browser), and `./browser` keeps their names and schemas only to read journals written before.
// P3-A (M6; X25, the P3 composite spec §4.3) gives the artifact namespace its shape over the engine host's artifact store:
// `artifact_create` gains kinds, six tools are appended, and `artifact_update` is retired into `artifact_publish`
// (`./artifact-update` keeps its schemas for the journals written before). P3-B, P3-C, P3-H and P3-D append after A:
// a name to `MAWS_TOOL_NAMES`, its schemas, its `MAWS_TOOLS` entry and its refusals, each in a block of its own.
// P3-D (D13 of docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md; ledger X25) gives `ask` a sixth modality,
// `design_system` with its `allowCreate`, answered `{designSystemId, name?}` or `{create: true}`. E1's ask schemas are
// declared before A's blocks and read at module load, so its lines sit in them, each marked `P3-D`; so does the export
// format `claude` (D12: a design system as a zip of Claude's design-system files), in A's list of formats.
// P4-B4 (docs/doperpowers/plans/2026-10-20-p4-b4-tool-surface.md; P4 ledger X33, the X9 amendment) appends
// `artifact_search` after the document tools (`./search-tools`), points `artifact_list` to it, and gives `show_pane` an
// `at` (`../artifacts/link`'s location); the listed artifact moved to the leaf `./listed-artifact`, re-exported here.
// P4-A3 (docs/doperpowers/plans/2026-10-21-p4-a3-edit-protocol.md) lists the tools an edit needs with `_meta` (always
// loaded, `./always-load`), `artifact_describe_type`, `artifact_read`, `artifact_publish` and the document's
// `artifact_edit`: under tool search a deferred tool costs one ToolSearch request before a session's first edit. P4-R7z
// (the P4 spec's Decision Log 92, the X9 amendment) takes out P4-R7's `message`: a MAWS session messages its human
// through the to-human plugin's `mcp__to-human__message`. U12a (docs/doperpowers/plans/2026-11-12-ux-wave-U12a-browser-
// computer-use-delivery.md, Interfaces §A; the X9 amendment) gives `show_pane` its reload clause, the result's `page` and
// `note` with the note texts, and the refusal for a page MAWS could not open. UX wave U6d (docs/doperpowers/plans/
// 2026-11-14-ux-wave-U6d-artifact-link.md, Interfaces §A and §B; the X9 amendment of 2026-11-14) takes the `artifact`
// pane and `at` out of `show_pane`: a call that names the pane is refused with `artifactPaneRetired`, the description and
// `artifact_create`'s lose their invitation to call it, and records are read with the schema they were written under
// (`ShowPaneRecordedInputSchema`, `parseRecordedToolArguments`). Board ticket 848 (the X9 amendment of 2026-11-23, the
// P1 spec's Decision Log) retires `send_file`: a file reaches the user as a Markdown link to its path in the agent's
// message, a call is answered `sendFileRetired`, and `./send-file` keeps its name and schemas for the records written
// before. Board ticket 420 (docs/doperpowers/plans/2026-11-23-tool-choice.md, §B; the X9 amendment of 2026-11-23) lists
// `ask` alone with `_meta` (always loaded) and gives the four tools an edit needs back to tool search; the ask's
// `blocking` is required (`AskInputSchema`), its description steering it to false, a call without it is answered
// `askBlockingRequired`, and records are read with the schema they were written under (`AskRecordedInputSchema`).
import * as z from 'zod';
import { ArtifactKindSchema } from '../artifacts/entity'; // P3-A
import { ArtifactLocationSchema } from '../artifacts/link'; // P4-B4
import { AppSessionIdSchema } from '../graph/ids'; // P2-E1
import { ARTIFACT_ID } from './artifact-id';
import { ArtifactEditorSchema, ListedArtifactSchema } from './listed-artifact'; // P4-B4
import { AGENT_PANE_NAMES, AgentPaneSchema, CAPTURE_ANSWER_MS, PANE_ANSWER_MS, PaneSchema } from './panes';
import { DOCUMENT_TOOL_NAMES, DOCUMENT_TOOLS } from './document-tools'; // P3-B (M7)
import { DASHBOARD_TOOL_NAMES, DASHBOARD_TOOLS } from './dashboard-tools'; // P3-E (E2 M2)
import { SEARCH_TOOL_NAMES, SEARCH_TOOLS } from './search-tools'; // P4-B4
import { ALWAYS_LOAD } from './always-load'; // P4-A3; board ticket 420: the ask alone
import { BrowserOpenPageSchema } from '../browser/tab'; // U12a

export { ARTIFACT_ID } from './artifact-id';
export { ArtifactEditorSchema, ListedArtifactSchema, type ArtifactEditor, type ListedArtifact } from './listed-artifact'; // P4-B4

export const MAWS_SERVER_NAME = 'maws';
export const MAWS_TOOL_NAMES = [
  // board ticket 848: `send_file`, first until 2026-11-23, left the server (`./send-file`)
  'ask', 'show_pane', 'artifact_create', 'artifact_list', 'artifact_screenshot',
  // P3-A (M6)
  'artifact_describe_type', 'artifact_read', 'artifact_publish', 'artifact_upload_asset', 'artifact_list_assets', 'artifact_export',
  // P3-E (E2 M2): the dashboard's `artifact_dataset` (`./dashboard-tools`), after A's namespace; B's tools close the list
  ...DASHBOARD_TOOL_NAMES,
  // P3-B (M7): the document tools (`./document-tools`: their schemas, descriptions, limits and refusals)
  ...DOCUMENT_TOOL_NAMES,
  // P4-B4: the search tool (`./search-tools`: its schemas, description, limits, hints and refusals)
  ...SEARCH_TOOL_NAMES,
  'artifact_delete', // UX wave U10b (M4): the agent's delete of its own draft, last
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

export const ASK_MODALITIES = ['choice', 'text', 'file', 'folder', 'repository', 'design_system' /* P3-D */] as const;
export type AskModality = (typeof ASK_MODALITIES)[number];

// P2-C3 (2026-10-14; the P2 spec's Decision Log 34): an option's `preview`, markdown the sheet renders beside the
// options for the focused one, as the native AskUserQuestion's previews are (mockups, code snippets, diagrams,
// configuration examples). Its description is the only one in the schema: the rule the model cannot read off a type.
export const ASK_PREVIEW_MAX = 8000;
export const AskOptionSchema = z.strictObject({
  label: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  preview: z
    .string()
    .min(1)
    .max(ASK_PREVIEW_MAX)
    .optional()
    .describe('Markdown shown beside the options while this option is focused (a mockup, code snippet, diagram or configuration example), so the user can compare the alternatives side by side. Single-select questions only: previews on a multi-select question are refused.'),
});

// The fields that belong to one modality only; any of them on another modality is refused.
const MODALITY_FIELDS: Record<'options' | 'multi' | 'allowOther' | 'multiple' | 'placeholder' | 'allowCreate', readonly AskModality[]> = {
  options: ['choice'], multi: ['choice'], allowOther: ['choice'], multiple: ['file', 'folder'], placeholder: ['text'],
  allowCreate: ['design_system'], // P3-D
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
    allowCreate: z.boolean().optional(), // P3-D: design_system; default true ("Build one with me" offered)
  })
  .superRefine((question, ctx) => {
    if (question.modality === 'choice' && question.options === undefined) ctx.addIssue({ code: 'custom', path: ['options'], message: 'a choice question needs options' });
    for (const [field, modalities] of Object.entries(MODALITY_FIELDS)) {
      if (question[field as keyof typeof MODALITY_FIELDS] !== undefined && !modalities.includes(question.modality)) {
        ctx.addIssue({ code: 'custom', path: [field], message: `${field} is for ${modalities.join(' or ')} questions only` });
      }
    }
    // P2-C3: one preview pane shows the focused option's, which a set of checkboxes has no single answer for
    if (question.multi === true) {
      question.options?.forEach((option, index) => {
        if (option.preview !== undefined) ctx.addIssue({ code: 'custom', path: ['options', index, 'preview'], message: 'preview is for single-select questions only' });
      });
    }
  });
export type AskQuestion = z.infer<typeof AskQuestionSchema>;

// Board ticket 420: the two forms differ in `blocking` alone. What `tools/list` lists and the host admits requires it;
// the form every earlier build carried out, kept to read records only, leaves it optional, absent meaning the call waited.
const askInputOf = <B extends z.ZodType>(blocking: B) =>
  z
    .strictObject({
      title: z.string().max(120).optional(),
      context: z.string().max(2000).optional(),
      blocking,
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
export const AskInputSchema = askInputOf(z.boolean());
export type AskInput = z.infer<typeof AskInputSchema>;
export const AskRecordedInputSchema = askInputOf(z.boolean().optional()); // absent: the call waited
export type AskRecordedInput = z.infer<typeof AskRecordedInputSchema>;

// A question's id: its own, else `q<n>` by its 1-based position.
export function askQuestionId(question: Pick<AskQuestion, 'id'>, index: number): string {
  return question.id ?? `q${index + 1}`;
}

// U6d: what `tools/list` answers and the host carries out, six panes and no `at`
export const ShowPaneInputSchema = z
  .strictObject({
    pane: AgentPaneSchema,
    target: z.string().max(4096).optional(),
    line: z.number().int().min(1).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.line !== undefined && input.pane !== 'file') ctx.addIssue({ code: 'custom', path: ['line'], message: 'line is for the file pane only' });
  });
export type ShowPaneInput = z.infer<typeof ShowPaneInputSchema>;
// U6d: the schema every earlier build carried out, kept to read records only: every pane a record can name, and `at`
export const ShowPaneRecordedInputSchema = z
  .strictObject({
    pane: PaneSchema,
    target: z.string().max(4096).optional(),
    line: z.number().int().min(1).optional(),
    at: ArtifactLocationSchema.optional(), // P4-B4: the place an artifact opens at
  })
  .superRefine((input, ctx) => {
    if (input.line !== undefined && input.pane !== 'file') ctx.addIssue({ code: 'custom', path: ['line'], message: 'line is for the file pane only' });
    if (input.at !== undefined && input.pane !== 'artifact') ctx.addIssue({ code: 'custom', path: ['at'], message: 'at is for the artifact pane only' }); // P4-B4
  });
export type ShowPaneRecordedInput = z.infer<typeof ShowPaneRecordedInputSchema>;

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
// `handle` and `path`, so the call skills already make keeps working. P3-F wave S (F5, the owner's DL13 change): `space`
// names the Space the artifact is made in, by its id or its name, resolved by the host. UX wave U10b (l6-artifacts-08):
// `designSystem` binds the new artifact to a design system, by its id or its title, for the kinds a system governs.
export const DESIGN_SYSTEM_KINDS = ['document', 'presentation', 'design', 'dashboard'] as const;
export const ArtifactCreateInputSchema = z
  .strictObject({
    kind: ArtifactKindSchema.optional(),
    title: ArtifactTitleSchema,
    handle: ArtifactIdSchema.optional(),
    path: PathSchema.optional(),
    files: z.record(FilePathSchema, FileTextSchema).optional(),
    content: FileTextSchema.optional(),
    space: z.string().min(1).max(200).optional(), // F5: a Space's id or its name
    designSystem: z.string().min(1).max(200).optional(), // UX wave U10b (l6-artifacts-08): a design system's id or its name, for a kind of DESIGN_SYSTEM_KINDS
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
    if (kind !== 'html' && kind !== 'document' && kind !== 'dashboard' /* P3-E: B's markdown */ && input.content !== undefined) issue('content', `a ${kind} artifact takes no content`);
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
  slide: z.string().min(1).max(64).optional(),
  offsetY: z.number().int().min(0).max(200_000).optional(),
  version: z.number().int().min(1).optional(), // the latest by default
  width: z.number().int().min(320).max(2560).optional(),
  height: z.number().int().min(240).max(2560).optional(),
});
export type ArtifactScreenshotInput = z.infer<typeof ArtifactScreenshotInputSchema>;
// P3-A (M6) start
// UX wave U10b (M10, §E.4): `space` names a Space by its id or its name, to describe a new artifact there.
export const ArtifactDescribeTypeInputSchema = z.strictObject({ kind: ArtifactKindSchema, artifact: z.string().min(1).optional(), space: z.string().min(1).max(200).optional() });
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
// (`index.html`, or the name it was created under). `mode: 'suggest'` writes the files as a suggestion the user accepts
// or rejects (M8; parent Decision Log 27), as does any publish to an artifact whose owner set `agentEditsAsSuggestions`;
// the default is a direct write, which never overrides the owner's setting. UX wave U10b (l6-artifacts-18; the execution
// document's §A.2): an html page may come from `path` instead, the .html file whose bytes become the new version, read
// as `artifact_create`'s is; exactly one of the two, the refusal `publishPathOrFiles`.
export const PUBLISH_MODES = ['direct', 'suggest'] as const;
export const ArtifactPublishInputSchema = z
  .strictObject({
    artifact: ArtifactIdSchema,
    baseRevision: z.number().int().min(0),
    files: z.record(FilePathSchema, FileTextSchema.nullable()).refine((files) => Object.keys(files).length > 0, { message: 'name at least one file' }).optional(),
    path: z.string().min(1).optional(), // U10b
    force: z.boolean().optional(), // default false
    message: z.string().max(2000).optional(),
    mode: z.enum(PUBLISH_MODES).optional(), // default 'direct'
  })
  .superRefine((input, ctx) => {
    if ((input.path === undefined) === (input.files === undefined)) ctx.addIssue({ code: 'custom', path: [], message: TOOL_ERRORS.publishPathOrFiles });
  });
export type ArtifactPublishInput = z.infer<typeof ArtifactPublishInputSchema>;
export const ArtifactUploadAssetInputSchema = z.strictObject({ artifact: ArtifactIdSchema, path: PathSchema, name: z.string().min(1).max(200).optional() });
export type ArtifactUploadAssetInput = z.infer<typeof ArtifactUploadAssetInputSchema>;
export const ArtifactListAssetsInputSchema = z.strictObject({ artifact: ArtifactIdSchema });
// UX wave U10b (M4; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md §C.1): the artifact, by id or handle
export const ArtifactDeleteInputSchema = z.strictObject({ artifact: ArtifactIdSchema });
export const ARTIFACT_EXPORT_FORMATS = ['pdf', 'png', 'pngs', 'docx', 'pptx', 'md', 'html', 'claude' /* P3-D: a design system in Claude's shape */] as const;
export type ArtifactExportFormat = (typeof ARTIFACT_EXPORT_FORMATS)[number];
// The paper an export prints on when asked (P3-A Decision Log 42, P3-B's M8); omitted, the exporter's own default.
export const ARTIFACT_EXPORT_PAGE_SIZES = ['letter', 'a4'] as const;
export type ArtifactExportPageSize = (typeof ARTIFACT_EXPORT_PAGE_SIZES)[number];
// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D12, H2-4; the parent's Decision Log 53 (4)): a deck's
// PPTX faces: basic (the default), named faces, slides as pictures, or uploaded faces embedded where their licence allows.
export const ARTIFACT_EXPORT_FONTS = ['named', 'basic', 'pictures', 'embedded'] as const; // P3-C
export type ArtifactExportFonts = (typeof ARTIFACT_EXPORT_FONTS)[number]; // P3-C
export const ArtifactExportInputSchema = z.strictObject({
  artifact: ArtifactIdSchema, format: z.enum(ARTIFACT_EXPORT_FORMATS), version: z.number().int().min(1).optional(), to: PathSchema.optional(),
  pageSize: z.enum(ARTIFACT_EXPORT_PAGE_SIZES).optional(),
  fonts: z.enum(ARTIFACT_EXPORT_FONTS).optional(), // P3-C: a presentation's PPTX faces; omitted, basic
  // P3-E (E1 M5; X23): a design's PNG board (the first by default), its PDF's boards (all by default), the output's scale
  board: z.string().min(1).max(64).optional(),
  boards: z.array(z.string().min(1).max(64)).max(200).optional(),
  scale: z.number().min(0.1).max(4).optional(),
});
export type ArtifactExportInput = z.infer<typeof ArtifactExportInputSchema>;
// How long the host waits for main's export service to answer (P3-A M7, X31) before the call answers an error; main's
// own guard and queue keep its answer inside it.
export const EXPORT_ANSWER_MS = 60_000;
const EXPORT_EXTENSIONS: Record<ArtifactExportFormat, string> = { pdf: 'pdf', png: 'png', pngs: 'zip', docx: 'docx', pptx: 'pptx', md: 'md', html: 'html', claude: 'zip' /* P3-D */ };
// An export's file name under `<userData>/artifacts/<id>/exports/` (the tool's and the library's alike). P3-E (E1 M5;
// E's Decision Log 33) and P3-H (P3 Decision Log 91): an export that is a file of its own (a design's, or one asked as
// `ownFile`) names the opaque `exportId` main minted for it, so no later export of the same revision and format
// replaces it; absent, the revision-and-format cache name.
export const artifactExportName = (revision: number, format: ArtifactExportFormat, exportId?: string): string => `${revision}-${format}${exportId !== undefined ? `-${exportId}` : ''}.${EXPORT_EXTENSIONS[format]}`;
// P3-A (M6) end

// ---------------------------------------------------------------------------------------------------------------------
// Results (the text block of a successful call is this JSON, pretty-printed; `isError` absent)

export const ASK_NOTE_MAX = 2000; // P2-C3: an answer's note, as long as a question may be

export const AskAnswerSchema = z.strictObject({
  id: z.string(),
  question: z.string(),
  status: z.enum(['answered', 'skipped', 'decide_for_me']),
  // choice: the chosen labels (one entry for single-select); text: the text; file and folder: absolute paths;
  // repository: the project's directory; design_system: none (its answer is `designSystemId` or `create`)
  value: z.union([z.string(), z.array(z.string())]).optional(),
  otherText: z.string().optional(), // choice: what was typed under Other, present only when used
  name: z.string().optional(), // repository: the project's name; design_system: the chosen system's (P3-D)
  designSystemId: z.uuid().optional(), // P3-D: design_system: the chosen system's artifact id
  create: z.literal(true).optional(), // P3-D: design_system: the user asked to build a new one with the agent
  // P2-C3 (Decision Log 34): what the user typed beside the answer, whatever its status; absent when nothing was
  note: z.string().min(1).max(ASK_NOTE_MAX).optional(),
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
// U12a (the UX wave's U12 execution document, Interfaces §A; a dated X9 line): a browser answer's two optional keys, in
// the order the agent reads them: what main did with the page at the address, and the note the engine host writes for
// a session launched with a browser backend (`SHOW_PANE_NOTES`).
export const ShowPaneResultSchema = z.strictObject({
  status: z.literal('shown'),
  pane: PaneSchema,
  opened: ShowPaneOpenedSchema,
  page: BrowserOpenPageSchema.optional(), // the browser pane with a target
  note: z.string().optional(), // the browser pane, in a session with a browser backend
});
export type ShowPaneResult = z.infer<typeof ShowPaneResultSchema>;
// U12a: the note on a browser answer, exact: `browserKept` with `page: 'kept'`, `browser` otherwise.
export const SHOW_PANE_NOTES = {
  browser: "This page is in the session's in-app browser, which the user sees. To act on it, use cua_repl's js tool: cua.getBrowser() with no id is this browser.",
  browserKept: "The user is using this tab, so it was shown without reloading. To act on it, use cua_repl's js tool: cua.getBrowser() with no id is this browser.",
} as const;

// P2-E1 (2026-10-09, a dated exception inside E2's result schemas; D10): `ownerAppSessionId` names the session whose
// X12 record the result is about when that is a side thread's ancestor, not the calling session; absent for its own.
const OwnerAppSessionIdSchema = AppSessionIdSchema.optional();
const IsoTimeSchema = z.string();

// E2's artifact row and `maws.delivery.artifact` read these fields of an answer that registered a page's version (E2's
// create and update; P3-A's create and publish of an `html` artifact): `id` the name the agent gave it (its handle, else
// its id), `deliverableId` the artifact's id (X12's record id before P3-L's cutover, which keeps the name), `version`
// the version's place, from 1, among the artifact's versions by revision. Loose on purpose: every answer shape that
// carries them reads alike. P3-L (M6b fix wave 2): `revision`, the revision the call wrote (P3-A's answers carry it), is
// the version's stable identity: the place shifts when the history before it thins, the revision never does.
export const ArtifactDeliverySchema = z.object({
  id: z.string(), deliverableId: z.uuid(), version: z.number().int().min(1), title: z.string(),
  ownerAppSessionId: OwnerAppSessionIdSchema, // P2-E1
  revision: z.number().int().min(0).optional(), // P3-L (M6b fix wave 2)
});
export type ArtifactDelivery = z.infer<typeof ArtifactDeliverySchema>;

// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D3; the parent's Decision Log 53 (3)): what a kind's
// loader said of the files, on a create, a read and a publish: its warnings (what it dropped, each naming the file and, where it
// can, the slide, the element and the property), and the files it held with their reasons
const FileWarningSchema = z.strictObject({ path: z.string(), slide: z.string().optional(), element: z.string().optional(), property: z.string().optional(), message: z.string() });
const HeldFileSchema = z.strictObject({ path: z.string(), reasons: z.array(z.string()) });
// UX wave U10b (M10, §E.4; l8-settings-13): a Space's instructions from the user, as an answer about an artifact in that
// Space (or a new one there) carries them: the first time the session meets the Space, and again once the text has
// changed or the session's context was compacted.
export const SpaceInstructionsAnswerSchema = z.strictObject({ spaceId: z.uuid(), name: z.string(), text: z.string() });
export type SpaceInstructionsAnswer = z.infer<typeof SpaceInstructionsAnswerSchema>;
// P3-A (M6): the kind's guide, attached once per session to the first create of that kind (§4.3).
const KindGuideSchema = z.strictObject({ guide: z.string(), format: z.string() });
// An `html` create also answers E2's fields (`id`, `deliverableId`, `version` 1,
// `externalReferences`: the http(s) URLs the page names, advisory: the frame loads none of them).
export const ArtifactCreateResultSchema = z.strictObject({
  status: z.literal('created'), artifactId: z.uuid(), kind: ArtifactKindSchema, title: z.string(), revision: z.number().int().min(0),
  handle: z.string().optional(),
  id: z.string().optional(), deliverableId: z.uuid().optional(), version: z.literal(1).optional(), externalReferences: z.number().int().min(0).optional(),
  guide: KindGuideSchema.optional(),
  designSystem: z.string().optional(), // the governing design system's DESIGN.md (Decision Log 22d)
  // P3-C (M3 fix wave 1): a file kind created from files answers what its loader said of them, as a publish does
  warnings: z.array(FileWarningSchema).optional(), notes: z.number().int().min(1).optional(), held: z.array(HeldFileSchema).optional(),
  spaceId: z.uuid().optional(), spaceName: z.string().optional(), // F5: the Space it was made in
  spaceInstructions: SpaceInstructionsAnswerSchema.optional(), // UX wave U10b (M10)
});
export type ArtifactCreateResult = z.infer<typeof ArtifactCreateResultSchema>;
// The listed artifact and who wrote it last (`ArtifactEditorSchema`, `ListedArtifactSchema`) are `./listed-artifact`'s
// (P4-B4: `artifact_search`'s hit extends the row), re-exported above.
export const ArtifactListResultSchema = z.strictObject({ status: z.literal('listed'), artifacts: z.array(ListedArtifactSchema) });
export type ArtifactListResult = z.infer<typeof ArtifactListResultSchema>;
export const ArtifactScreenshotResultSchema = z.strictObject({
  status: z.literal('captured'), id: z.string(), deliverableId: z.uuid(), title: z.string(), version: z.number().int().min(1).optional(),
  kind: ArtifactKindSchema.optional(), revision: z.number().int().nonnegative().optional(), slide: z.string().optional(), offsetY: z.number().int().nonnegative().optional(),
  width: z.number().int(), height: z.number().int(), bytes: z.number().int().min(0), consoleErrors: z.array(z.string()),
  ownerAppSessionId: OwnerAppSessionIdSchema, // P2-E1
});
export type ArtifactScreenshotResult = z.infer<typeof ArtifactScreenshotResultSchema>;
// P3-A (M6) start
export const DesignCheckSchema = z.strictObject({
  violations: z.array(z.strictObject({ unit: z.string(), element: z.string(), rule: z.string(), message: z.string() })),
  checks: z.array(z.strictObject({ rule: z.string(), violations: z.number().int().nonnegative() })),
  manual: z.array(z.string()), unknown: z.array(z.string()),
  problems: z.array(z.strictObject({ path: z.string(), message: z.string() })),
});
export const ArtifactDescribeTypeResultSchema = z.strictObject({
  status: z.literal('described'), kind: ArtifactKindSchema, guide: z.string(), format: z.string(),
  artifactId: z.uuid().optional(), home: z.string().optional(),
  designCheck: DesignCheckSchema.optional(),
  designSystem: z.string().optional(), // a document, presentation or design: the governing design system's DESIGN.md (Decision Log 42)
  spaceInstructions: SpaceInstructionsAnswerSchema.optional(), // UX wave U10b (M10): the artifact's Space's, or the Space named
});
export type ArtifactDescribeTypeResult = z.infer<typeof ArtifactDescribeTypeResultSchema>;
const VersionSummarySchema = z.strictObject({ id: z.number().int().min(1), kind: z.string(), revision: z.number().int().min(0), at: IsoTimeSchema, by: ArtifactEditorSchema.shape.by, label: z.string().optional() });
export type VersionSummary = z.infer<typeof VersionSummarySchema>;
// A file kind's and an `html` artifact's `files`; a Y kind's other root types as `json` (the generic reader, until the
// kind registers its own; P3-C: a kind with its own `readFiles` answers none); a `file` artifact's `file`. `versions`:
// the latest ones, newest first (ids `version` takes).
export const ArtifactReadResultSchema = z.strictObject({
  status: z.literal('read'), artifactId: z.uuid(), kind: ArtifactKindSchema, title: z.string(), revision: z.number().int().min(0),
  handle: z.string().optional(),
  version: VersionSummarySchema.optional(), // when a version was read
  files: z.record(z.string(), z.string()).optional(),
  missing: z.array(z.string()).optional(), // named paths the artifact has no file at
  json: z.record(z.string(), z.unknown()).optional(),
  warnings: z.array(FileWarningSchema).optional(), // P3-C
  held: z.array(HeldFileSchema).optional(), // P3-C
  file: z.strictObject({ name: z.string(), path: z.string(), size: z.number().int().min(0), sha256: z.string(), text: z.string().optional(), exists: z.boolean() }).optional(),
  versions: z.array(VersionSummarySchema),
  spaceInstructions: SpaceInstructionsAnswerSchema.optional(), // UX wave U10b (M10)
});
export type ArtifactReadResult = z.infer<typeof ArtifactReadResultSchema>;
// `changed` and `removed` are the paths the publish wrote; `kept`, the artifact's other files, as they are live. An
// `html` publish also answers E2's fields for the version it wrote. A suggestion (`status: 'suggested'`) answers
// the artifact's live revision, which it did not move, and its paths as the suggestions stand.
export const ArtifactPublishResultSchema = z.strictObject({
  status: z.enum(['published', 'suggested']), artifactId: z.uuid(), kind: ArtifactKindSchema, title: z.string(), revision: z.number().int().min(0),
  changed: z.array(z.string()), kept: z.array(z.string()), removed: z.array(z.string()),
  // P3-C: the files the publish created (among `changed`), the loader's warnings, its notes (heals to an equivalent,
  // counted) and the files it held
  added: z.array(z.string()).optional(), warnings: z.array(FileWarningSchema).optional(), notes: z.number().int().min(1).optional(), held: z.array(HeldFileSchema).optional(),
  id: z.string().optional(), deliverableId: z.uuid().optional(), version: z.number().int().min(1).optional(), externalReferences: z.number().int().min(0).optional(),
  ownerAppSessionId: OwnerAppSessionIdSchema, // P2-E1: the page is its creator's
});
export type ArtifactPublishResult = z.infer<typeof ArtifactPublishResultSchema>;
export const ArtifactUploadAssetResultSchema = z.strictObject({ status: z.literal('uploaded'), artifactId: z.uuid(), assetId: z.string(), ref: z.string(), name: z.string(), size: z.number().int().min(0) });
export type ArtifactUploadAssetResult = z.infer<typeof ArtifactUploadAssetResultSchema>;
export const ArtifactDeleteResultSchema = z.strictObject({ status: z.literal('deleted'), artifactId: z.uuid(), kind: ArtifactKindSchema, title: z.string() }); // UX wave U10b
export type ArtifactDeleteResult = z.infer<typeof ArtifactDeleteResultSchema>;
export const ListedAssetSchema = z.strictObject({ assetId: z.string(), ref: z.string(), name: z.string(), mime: z.string(), size: z.number().int().min(0), createdAt: IsoTimeSchema });
export const ArtifactListAssetsResultSchema = z.strictObject({ status: z.literal('listed'), artifactId: z.uuid(), assets: z.array(ListedAssetSchema) });
export type ArtifactListAssetsResult = z.infer<typeof ArtifactListAssetsResultSchema>;
export const ArtifactExportResultSchema = z.strictObject({
  status: z.literal('exported'), artifactId: z.uuid(), format: z.enum(ARTIFACT_EXPORT_FORMATS), revision: z.number().int().min(0), path: z.string(), copiedTo: z.string().optional(),
  blockedRequests: z.number().int().positive().optional(), // remote resources the page named, which the export did not load (P3-A Decision Log 44b)
  pages: z.number().int().positive().optional(), // UX wave U10b (§B.4): a pdf's page count, counted in the exported file by the tool server
});
export type ArtifactExportResult = z.infer<typeof ArtifactExportResultSchema>;

// A refusal an agent can act on: the `isError` text is `<tool>: <sentence> <this JSON>` (`artifactRefusalOf` reads it).
export const ARTIFACT_REFUSAL_REASONS = ['notFound', 'invalid', 'tooLarge', 'handleTaken', 'staleBase', 'conflict', 'exportUnavailable', 'unavailable', 'exportTooLarge' /* P3-E (E1 M5; Decision Log 26) */] as const;
export type ArtifactRefusalReason = (typeof ARTIFACT_REFUSAL_REASONS)[number];
export const ArtifactRefusalSchema = z.looseObject({ reason: z.enum(ARTIFACT_REFUSAL_REASONS) });
export type ArtifactRefusal = z.infer<typeof ArtifactRefusalSchema>;
// P3-A (M6) end

// ---------------------------------------------------------------------------------------------------------------------
// The tools as `tools/list` describes them (descriptions exact; A-18: the fallback sentence first)

export const MAWS_TOOLS = {
  ask: {
    title: 'Ask questions',
    description:
      'Ask the user one or several questions at once through a MAWS sheet; without this tool, use AskUserQuestion. Each question has a modality: "choice" (options, single or multi, with an Other row), "text" (free text), "file" or "folder" (a native picker returning absolute paths), "repository" (one of the user\'s MAWS projects), or "design_system" (one of the user\'s design systems, answered with its designSystemId and name; unless allowCreate is false, the user may answer create: true instead, asking you to build a new one with them). The user may answer any question with "decide for me" or skip it. blocking is required. With blocking false the call returns {status: "asked", askId} at once and the answers arrive later as a user message that names the askId, so you can keep working meanwhile; with blocking true it waits for the answers and returns them. Pass false unless you need the answers before your next step. In a subagent the call always waits and returns the answers, as with blocking true.',
    input: AskInputSchema,
    annotations: MAWS_TOOL_ANNOTATIONS,
    meta: ALWAYS_LOAD, // board ticket 420: the session's line to its human, loaded up front
  },
  show_pane: {
    title: 'Show pane',
    description:
      'Open a MAWS pane for the user: "diff", "file", "terminal", "tasks", "browser" or "source-control"; without this tool, describe where the user should look. target names what to open: a file path for diff or file (line optional), a URL for browser (a page already open is reloaded, unless the user is using that tab). Returns what was opened, or an error for an unknown pane or a pane this build of MAWS does not have.',
    input: ShowPaneInputSchema,
    annotations: MAWS_TOOL_ANNOTATIONS,
  },
  // E2 start (P3-A M6: `artifact_create` gains kinds and `artifact_list` the library; `artifact_update` retired)
  artifact_create: {
    title: 'Create artifact',
    description:
      "Create a MAWS artifact the user can view, comment on and edit with you; without this tool, write the file and tell the user its path. kind is html by default: a self-contained HTML page from path (a .html file you wrote, absolute or relative to the working directory) or content (its text), shown in a sandboxed frame with no network access (inline everything: styles, scripts, images as data URLs); file delivers a file in place from path; a document starts empty or from markdown content, and so does a dashboard (then bind its data with artifact_dataset); presentation, design and design_system start empty or from files (path to text). Give a title and optionally a short handle to name it by in later calls (id and html_path are older names for handle and path). Give space (a Space's id or its name) to make it in that Space: it is listed there, copied into the Space's linked folder if it has one, and styled by the Space's default design system if it has one; a Space that does not exist is refused. Give designSystem (a design system's id or its name) to bind a document, presentation, design or dashboard to that system in place of the default; one that does not exist is refused. Returns the artifact's id and revision, its Space when it has one, and the first time this session creates a kind, that kind's guide and format reference. To name it to the user, write a Markdown link [its title](maws-artifact:<artifactId>): a click opens it in MAWS. When the artifact's Space has instructions from the user, the answer carries them as spaceInstructions, the first time and again after they change: follow them for work in that Space.",
    input: ArtifactCreateInputSchema,
    annotations: ARTIFACT_WRITER_ANNOTATIONS,
  },
  artifact_list: {
    title: 'List artifacts',
    description:
      'List MAWS artifacts with their ids, handles, kinds, titles, revisions and who edited them last; without this tool, keep your own list of what you made. An artifact in a Space also carries its spaceId and spaceName. By default the artifacts this session and the sessions it was opened from created, edited or viewed; scope "all" lists the whole library. Filter by kind, Space (spaceId) or a title substring (query). To find artifacts by what they contain, use artifact_search. To name one to the user, write a Markdown link [its title](maws-artifact:<artifactId>), which opens it in MAWS with a click.',
    input: ArtifactListInputSchema,
    annotations: MAWS_TOOL_ANNOTATIONS,
  },
  artifact_screenshot: {
    title: 'Screenshot artifact',
    description:
      'Capture a PNG of a MAWS HTML artifact, document or presentation without human GUI steps; without this tool, inspect the exported file. Documents render their export layout in the actual governing system; use offsetY to inspect lower content. Presentations require slide (an id from artifact_read). HTML version is its ordinal; document and presentation version is a retained version id from artifact_read, otherwise the live state. Rendering is sandboxed with no network. Names the artifact by id or handle and optionally a version (the latest by default) and a viewport size (1280 by 800 by default). Returns the image and the console errors the page logged while loading, so you can check your work.',
    input: ArtifactScreenshotInputSchema,
    annotations: MAWS_TOOL_ANNOTATIONS,
  },
  // E2 end
  // P3-A (M6) start
  artifact_describe_type: {
    title: 'Describe artifact kind',
    description:
      "Return a MAWS artifact kind's guide (when to use it, how to create, read and edit it) and its format reference; without this tool, use the guide artifact_create returned. Kinds: document, presentation, design, design_system, dashboard, html, file. For a document, presentation or design it also returns the governing design system's DESIGN.md when one governs. Pass artifact (id or handle) to inspect that existing artifact's actual system and home, including its Space and explicit assignment; without artifact this describes the default for a new artifact. Pass space (a Space's id or its name) to describe a new artifact in that Space. For an existing design_system it also runs the canon and tagged law checks, reporting violations and checks requiring visual judgment. When the artifact's Space has instructions from the user, the answer carries them as spaceInstructions, the first time and again after they change: follow them for work in that Space.",
    input: ArtifactDescribeTypeInputSchema,
    annotations: MAWS_TOOL_ANNOTATIONS,
  },
  artifact_read: {
    title: 'Read artifact',
    description:
      "Read a MAWS artifact by id or handle; without this tool, ask the user what the artifact holds. Returns its live revision and content: an html page or a file kind's files (all, or the paths named), a document's structure (with its page setting), a file artifact's path and metadata (and its text when under 1 MiB). version reads one of the retained versions listed in the answer, read-only; revision reads an html page as an earlier write left it; for a document, tab, from, count and sinceRevision read one tab, count blocks from a block id, or the changes since a revision (other kinds ignore them). Read before you publish: artifact_publish takes the revision this read returned. When the artifact's Space has instructions from the user, the answer carries them as spaceInstructions, the first time and again after they change: follow them for work in that Space.",
    input: ArtifactReadInputSchema,
    annotations: MAWS_TOOL_ANNOTATIONS,
  },
  artifact_publish: {
    title: 'Publish artifact',
    description:
      "Write files of a MAWS artifact as one change, an html page or a file kind's files; without this tool, write the files to disk and tell the user. files maps each path to its whole new text, null removing it (an html page is its one file, index.html); for an html page, path (the .html file you wrote, absolute or relative to the working directory) publishes that file's bytes in place of files; baseRevision is the revision your last artifact_read (or create or publish) of it returned. A publish from an older revision is refused naming the live one: read again. Files nobody changed since your read merge over the live artifact and the others are kept; a file someone else changed since your read refuses the publish naming it (read, apply your change to what you read, publish again; force: true overwrites them as a last resort). All of it lands or none. Returns the new revision and the files changed, kept and removed. mode: \"suggest\" proposes the files instead: the user accepts or rejects them and the artifact stays as it is until then (an artifact the user set to take agent edits as suggestions takes every publish so; an html page takes none).",
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
      'Export a MAWS artifact (its live state, or a retained version) as a file; without this tool, tell the user to export it from MAWS. Formats: pdf, png or html (the stored page, unchanged) for an html page; docx, pptx, md and html where the kind supports them. Returns the exported file\'s path; a pdf\'s answer also names pages, its page count; to (a path under the working directory) copies it there too; pageSize (letter or a4) chooses the paper, else the format\'s own default; fonts chooses a presentation\'s pptx faces: basic (the default: faces every Office has), named (matching fonts must be installed) or pictures (each slide one picture, notes kept); embedded (uploaded faces inside the file) is not available yet. A presentation also exports as pdf, html (one standalone page), png (one slide: board selects its id, otherwise the cover), pngs (all slides as numbered PNGs in a managed archive) and claude (a zip of Claude-readable slides). A design exports as png (one board: board, the first by default) and pdf (one page per board at its own size: boards, all by default), at native size or at scale (0.1 to 4); a side too large is refused naming the scale that fits. Works whether or not the MAWS app is open.', // P3-C: fonts and the deck's formats; P3-E (E1 M5): the design's
    input: ArtifactExportInputSchema,
    annotations: ARTIFACT_WRITER_ANNOTATIONS,
  },
  // P3-A (M6) end
  ...DASHBOARD_TOOLS, // P3-E (E2 M2)
  // P3-B (M7)
  ...DOCUMENT_TOOLS,
  // P4-B4
  ...SEARCH_TOOLS,
  // UX wave U10b (M4; §C.1): last, as in MAWS_TOOL_NAMES; the one tool that removes what it names
  artifact_delete: {
    title: 'Delete artifact',
    description:
      "Delete a MAWS artifact this session made and no longer needs, such as an abandoned draft; without this tool, ask the user to delete it in the Library. Only an artifact that this session, or the session a side thread was opened from, created and that only agents have written to; anything else is refused with the reason. The user can undo it from the transcript. Returns the deleted artifact's id, kind and title.",
    input: ArtifactDeleteInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
} as const satisfies Record<MawsToolName, { title: string; description: string; input: z.ZodType; annotations: { readOnlyHint: boolean; destructiveHint?: boolean; openWorldHint: boolean }; meta?: Record<string, unknown> }>;

export interface MawsToolListEntry {
  name: MawsToolName;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, unknown>;
  _meta?: Record<string, unknown>; // P4-A3: the engine's keys on a listed tool (alwaysLoad)
}

// The `tools/list` answer's entries, in MAWS_TOOL_NAMES order.
export function mawsToolList(): MawsToolListEntry[] {
  return MAWS_TOOL_NAMES.map((name) => {
    const tool: (typeof MAWS_TOOLS)[MawsToolName] = MAWS_TOOLS[name];
    const { title, description, input, annotations } = tool;
    const meta = 'meta' in tool ? { _meta: { ...tool.meta } } : {};
    return { name, title, description, inputSchema: z.toJSONSchema(input) as Record<string, unknown>, annotations: { ...annotations, title }, ...meta };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Refusals (exact prefixes; the rest names the offender)

export type ArtifactToolName = Extract<MawsToolName, `artifact_${string}`>; // E2
const MIB = 1024 * 1024;

export const TOOL_ERRORS = {
  invalidArguments: (tool: MawsToolName, issues: string) => `${tool}: invalid arguments: ${issues}`,
  // board ticket 421: `listed`, the tools the session was listed (its set's, `./tool-set`), not the server's every tool
  unknownTool: (name: string, listed: readonly string[]) => `unknown tool "${name}"; the maws server has ${listed.length > 0 ? listed.join(', ') : 'no tools in this session'}`,
  // Board ticket 848: a call of the retired `send_file`, whatever it holds; the agent is told to write the path link
  sendFileRetired: 'send_file: MAWS no longer delivers files. Link the file in your message as a Markdown link to its absolute path, [its name](/absolute/path): a click opens it beside the chat, and ⌘-click opens it in the main area. Keep the file inside this session\'s folders, where everyone who sees the session can open it.',
  sessionEnded: 'ask: the session ended before the user answered',
  askQuotesGrant: 'An ask may not quote a permission grant. Ask the question in your own words.', // board ticket 711
  // board ticket 420: a call that leaves out the required `blocking`; a session started before it reads a description
  // that called it optional (the tool-choice plan's P4), and this sentence says what to pass
  askBlockingRequired: 'ask: pass blocking: false to keep working while the user answers, or blocking: true to wait for the answers.',
  unknownPane: (pane: string) => `show_pane: unknown pane "${pane}"; known panes: ${AGENT_PANE_NAMES.join(', ')}`,
  // UX wave U6d (O-44): a call for the retired `artifact` pane, whatever else it holds; the agent is told to write the link
  artifactPaneRetired: 'show_pane: MAWS no longer opens an artifact for the user. Name it in your message as a Markdown link, [its title](maws-artifact:<artifactId>), and the user opens it with a click.',
  paneUnavailable: (pane: string) => `show_pane: the ${pane} pane is not available in this build of MAWS`,
  targetRequired: (pane: string) => `show_pane: a target is required for the ${pane} pane`,
  fileNotFound: (path: string) => `show_pane: file not found: ${path}`,
  paneTimeout: `show_pane: no MAWS window answered within ${PANE_ANSWER_MS / 1000} s`,
  paneNotReady: 'show_pane: the MAWS window was still loading its layout; try again', // UX wave U6b-1: the window's wait for its layout ran out
  // E2 start: each artifact refusal names the tool whose call it answers
  artifactNotAFile: (tool: ArtifactToolName, path: string) => `${tool}: not a file: ${path}`,
  notHtml: (tool: ArtifactToolName, path: string) => `${tool}: not an HTML file: ${path}`,
  tooLarge: (tool: ArtifactToolName, path: string, bytes: number) => `${tool}: too large: ${path} (${bytes} bytes; the limit is ${ARTIFACT_MAX_BYTES / MIB} MiB)`,
  artifactExists: (id: string) => `artifact_create: an artifact "${id}" already exists in this session; use artifact_publish`,
  // P2-E1 (D10, D12): a side thread's create of an id one of its ancestors holds
  artifactExistsInParent: (id: string) => `artifact_create: an artifact "${id}" already exists in the conversation this side thread was opened from; use artifact_publish`,
  // UX wave U10b (l6-artifacts-08): a create's `designSystem` names no live design system, more than one, or a kind no system governs
  noDesignSystem: (ref: string, names: readonly string[]) =>
    names.length ? `artifact_create: no design system "${ref}"; the design systems are: ${names.join(', ')}` : `artifact_create: no design system "${ref}"; there are no design systems`,
  designSystemAmbiguous: (ref: string, ids: readonly string[]) => `artifact_create: more than one design system is named "${ref}"; give one of these ids: ${ids.join(', ')}`,
  designSystemNotForKind: (kind: string) => `artifact_create: kind "${kind}" takes no design system; designSystem is for ${DESIGN_SYSTEM_KINDS.join(', ')}`,
  noArtifact: (tool: ArtifactToolName, id: string) => `${tool}: no artifact "${id}" in this session`,
  // UX wave U10b (l6-artifacts-18, §A.2): a publish names path or files, exactly one; path is an html page's alone
  publishPathOrFiles: 'artifact_publish: give path or files, not both and not neither',
  publishPathHtmlOnly: (kind: string) => `artifact_publish: path publishes an html page; send files for a ${kind}`,
  noVersion: (id: string, version: number, versions: number) => `artifact_screenshot: version ${version} does not exist; "${id}" has ${versions} version(s)`,
  captureFailed: (reason: string) => `artifact_screenshot: MAWS could not capture the artifact: ${reason}`,
  captureTimeout: `artifact_screenshot: MAWS did not answer within ${CAPTURE_ANSWER_MS / 1000} s`,
  // E2 end
  // E10: a bridge request made while no app is connected to the engine host (the detached supervisor), answered at once
  appNotOpen: (tool: 'show_pane' | 'artifact_screenshot' | 'artifact_export') => `${tool}: MAWS is not open; the ${tool === 'show_pane' ? 'pane cannot be shown' : tool === 'artifact_export' ? 'artifact cannot be exported' : 'artifact cannot be captured'}`,
  // P3-A (M6) start: a refusal the agent can act on, its machine-readable reason last (`artifactRefusalOf`)
  refused: (tool: ArtifactToolName, refusal: ArtifactRefusal, sentence: string) => `${tool}: ${sentence} ${JSON.stringify(refusal)}`,
  // P3-A (M6) end
  // UX wave U10b (M4; §C.1): `artifact_delete`'s refusals, each followed by its JSON (`reason: 'invalid'` and the `why` named)
  deleteByUser: (title: string) => `artifact_delete: "${title}" was created by the user; ask them to delete it in the Library`, // why: 'byUser'
  deleteEdited: (title: string) => `artifact_delete: the user has edited "${title}"; ask them to delete it in the Library`, // why: 'edited'
  deleteOtherSession: (title: string) => `artifact_delete: "${title}" was created by another session; ask the user to delete it in the Library`, // why: 'otherSession'
  deleteUnknown: (title: string) => `artifact_delete: MAWS cannot tell that only agents have written to "${title}"; ask the user to delete it in the Library`, // why: 'unknown'
  // E4a start: a target the browser refuses (not http or https; `validateBrowserUrl`)
  navigationRefused: (target: string) => `show_pane: MAWS opens only http and https pages in its browser; refused "${target}"`,
  // E4a end
  // U12a (ruling R9): main refused the open of a page, so nothing was shown; the target as the agent gave it
  browserOpenFailed: (target: string, message: string) => `show_pane: MAWS could not open "${target}" in its browser: ${message}`,
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
// named with the known ones, every other refusal by its issues). U6d (decision 17): a `show_pane` that names the retired
// `artifact` pane is answered `artifactPaneRetired` before the schema is consulted, so the agent always reads the sentence
// that teaches the link, never a list of issues. UX wave U10b (§A.2): a publish the schema refused for naming both or
// neither of path and files is answered `publishPathOrFiles` alone, the sentence that says what to send. Board ticket 420:
// an ask whose only fault is a missing `blocking` (it reads as a record would) is answered `askBlockingRequired` alone.
export function parseToolArguments<N extends MawsToolName>(name: N, args: unknown): { ok: true; data: ToolInput<N> } | { ok: false; error: string } {
  if (name === 'show_pane' && (args as { pane?: unknown } | null | undefined)?.pane === 'artifact') return { ok: false, error: TOOL_ERRORS.artifactPaneRetired };
  const parsed = MAWS_TOOLS[name].input.safeParse(args);
  if (parsed.success) return { ok: true, data: parsed.data as ToolInput<N> };
  if (name === 'ask' && AskRecordedInputSchema.safeParse(args).success) return { ok: false, error: TOOL_ERRORS.askBlockingRequired };
  if (name === 'artifact_publish' && parsed.error.issues.some((issue) => issue.message === TOOL_ERRORS.publishPathOrFiles)) return { ok: false, error: TOOL_ERRORS.publishPathOrFiles };
  const pane = (args as { pane?: unknown } | null | undefined)?.pane;
  if (name === 'show_pane' && pane !== undefined && parsed.error.issues.some((issue) => issue.path.length === 1 && issue.path[0] === 'pane')) return { ok: false, error: TOOL_ERRORS.unknownPane(String(pane)) };
  return { ok: false, error: TOOL_ERRORS.invalidArguments(name, issuesText(parsed.error)) };
}

// U6d (Interfaces §B; decision 18): a record's arguments, read with the schema they were written under, so a journal of
// any build yields the events it always did. For `show_pane` the recorded schema decides (every pane a record can name,
// and `at`; its refusal's text is read by nobody), and for `ask` since board ticket 420 (`blocking` optional, absent
// meaning the call waited); every other tool is `parseToolArguments`. The normaliser's one parser of a `maws` call; the
// host's tools keep `parseToolArguments`.
type RecordedToolInput<N extends MawsToolName> = N extends 'show_pane' ? ShowPaneRecordedInput : N extends 'ask' ? AskRecordedInput : ToolInput<N>;
const RECORDED_INPUT_SCHEMAS: Partial<Record<MawsToolName, z.ZodType>> = { show_pane: ShowPaneRecordedInputSchema, ask: AskRecordedInputSchema };
export function parseRecordedToolArguments<N extends MawsToolName>(name: N, args: unknown): { ok: true; data: RecordedToolInput<N> } | { ok: false; error: string } {
  const recorded = RECORDED_INPUT_SCHEMAS[name];
  if (recorded === undefined) return parseToolArguments(name, args) as { ok: true; data: RecordedToolInput<N> } | { ok: false; error: string };
  const parsed = recorded.safeParse(args);
  if (parsed.success) return { ok: true, data: parsed.data as RecordedToolInput<N> };
  return { ok: false, error: TOOL_ERRORS.invalidArguments(name, issuesText(parsed.error)) };
}
