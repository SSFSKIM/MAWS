import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { PANE_NAMES } from './panes';
import {
  ARTIFACT_ID,
  ARTIFACT_MAX_BYTES,
  ARTIFACT_SCREENSHOT_DEFAULT,
  ARTIFACT_SCREENSHOT_MAX_BYTES,
  ArtifactCreateInputSchema,
  ArtifactCreateResultSchema,
  ArtifactListInputSchema,
  ArtifactListResultSchema,
  ArtifactDeliverySchema,
  ArtifactPublishInputSchema,
  ArtifactPublishResultSchema,
  ArtifactReadInputSchema,
  artifactRefusalOf,
  DOCUMENT_READ_FIELDS,
  ArtifactScreenshotInputSchema,
  ArtifactScreenshotResultSchema,
  AskInputSchema,
  AskResultSchema,
  MAWS_SERVER_NAME,
  MAWS_TOOL_ANNOTATIONS,
  MAWS_TOOL_NAMES,
  MAWS_TOOLS,
  mawsServerInfo,
  mawsToolList,
  parseToolArguments,
  SendFileInputSchema,
  SendFileResultSchema,
  ShowPaneInputSchema,
  ShowPaneResultSchema,
  TOOL_ERRORS,
} from './tools';
import { ArtifactUpdateInputSchema, ArtifactUpdateResultSchema } from './artifact-update';

describe('X9: the maws server and its twelve tools', () => {
  it('names the server and the tools as the contract says (E2 appends the artifact tools; P3-A M6 retires artifact_update and appends six)', () => {
    expect(MAWS_SERVER_NAME).toBe('maws');
    expect(MAWS_TOOL_NAMES).toEqual([
      'send_file', 'ask', 'show_pane', 'artifact_create', 'artifact_list', 'artifact_screenshot',
      // E4c's six browser tools left on 2026-10-08 (P1 A-54): none of them, and no other tool moved
      'artifact_describe_type', 'artifact_read', 'artifact_publish', 'artifact_upload_asset', 'artifact_list_assets', 'artifact_export',
    ]);
    expect(MAWS_TOOL_NAMES).not.toContain('artifact_update');
    expect(Object.keys(MAWS_TOOLS)).toEqual([...MAWS_TOOL_NAMES]);
    expect(mawsServerInfo('0.9.0')).toEqual({ name: 'maws', version: '0.9.0' });
    expect(MAWS_TOOL_ANNOTATIONS).toEqual({ readOnlyHint: true, openWorldHint: false });
  });

  // A-18: ToolSearch indexes descriptions, so the fallback sentence comes first
  it('opens every description with its fallback sentence, word for word', () => {
    for (const name of MAWS_TOOL_NAMES) expect(MAWS_TOOLS[name].description, name).toMatch(/^[^.]*without this tool/);
    expect(MAWS_TOOLS.send_file.description).toBe(
      'Deliver files to the user inside MAWS; without this tool, write the file and tell the user its path. Each delivered file becomes a row in the MAWS transcript with your caption and buttons to open it or reveal it in Finder; use it when you have produced something the user should look at (a PDF, an HTML page, an image, a document). Paths may be absolute or relative to the working directory and must name existing files. Each becomes a File artifact; returns their artifact ids.',
    );
    expect(MAWS_TOOLS.ask.description).toBe(
      'Ask the user one or several questions at once through a MAWS sheet; without this tool, use AskUserQuestion. Each question has a modality: "choice" (options, single or multi, with an Other row), "text" (free text), "file" or "folder" (a native picker returning absolute paths), or "repository" (one of the user\'s MAWS projects). The user may answer any question with "decide for me" or skip it. With blocking true (the default) the call waits for the answers and returns them; with blocking false it returns {status: "asked", askId} at once and the answers arrive later as a user message that names the askId, so you can keep working meanwhile.',
    );
    expect(MAWS_TOOLS.show_pane.description).toBe(
      'Open a MAWS pane for the user: "diff", "file", "terminal", "tasks", "artifact", "browser" or "source-control"; without this tool, describe where the user should look. target names what to open: a file path for diff or file (line optional), an artifact id or handle for artifact, a URL for browser. Returns what was opened, or an error for an unknown pane or a pane this build of MAWS does not have.',
    );
  });

  it('lists each tool with its title, description, the JSON schema of its zod input and its own annotations', () => {
    const list = mawsToolList();
    expect(list.map((t) => t.name)).toEqual([...MAWS_TOOL_NAMES]);
    for (const tool of list) {
      const spec = MAWS_TOOLS[tool.name as keyof typeof MAWS_TOOLS];
      expect(tool).toEqual({ name: tool.name, title: spec.title, description: spec.description, inputSchema: z.toJSONSchema(spec.input), annotations: { ...spec.annotations, title: spec.title } });
      expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
    }
    // E2 (Decision Log 4): the two writers are not read-only, so the engine never batches them nor runs them in plan mode
    expect(list.map((t) => [t.name, t.annotations])).toEqual([
      ['send_file', { readOnlyHint: true, openWorldHint: false, title: 'Send file' }],
      ['ask', { readOnlyHint: true, openWorldHint: false, title: 'Ask questions' }],
      ['show_pane', { readOnlyHint: true, openWorldHint: false, title: 'Show pane' }],
      ['artifact_create', { readOnlyHint: false, openWorldHint: false, title: 'Create artifact' }],
      ['artifact_list', { readOnlyHint: true, openWorldHint: false, title: 'List artifacts' }],
      ['artifact_screenshot', { readOnlyHint: true, openWorldHint: false, title: 'Screenshot artifact' }],
      ['artifact_describe_type', { readOnlyHint: true, openWorldHint: false, title: 'Describe artifact kind' }],
      ['artifact_read', { readOnlyHint: true, openWorldHint: false, title: 'Read artifact' }],
      ['artifact_publish', { readOnlyHint: false, openWorldHint: false, title: 'Publish artifact' }],
      ['artifact_upload_asset', { readOnlyHint: false, openWorldHint: false, title: 'Upload artifact asset' }],
      ['artifact_list_assets', { readOnlyHint: true, openWorldHint: false, title: 'List artifact assets' }],
      ['artifact_export', { readOnlyHint: false, openWorldHint: false, title: 'Export artifact' }],
    ]);
    expect(list.find((t) => t.name === 'show_pane')!.inputSchema).toMatchObject({ properties: { pane: { enum: [...PANE_NAMES] } }, required: ['pane'] });
  });
});

describe('X9 inputs: strict, bounded, never defaulted', () => {
  it('send_file takes 1 to 20 non-empty paths, a caption up to 2000 characters and an urgency', () => {
    expect(SendFileInputSchema.parse({ files: ['a.txt'] })).toEqual({ files: ['a.txt'] });
    expect(SendFileInputSchema.safeParse({ files: ['a.txt'], caption: 'c', urgency: 'high' }).success).toBe(true);
    expect(SendFileInputSchema.safeParse({ files: [] }).success).toBe(false);
    expect(SendFileInputSchema.safeParse({ files: [''] }).success).toBe(false);
    expect(SendFileInputSchema.safeParse({ files: Array.from({ length: 21 }, (_, i) => `${i}.txt`) }).success).toBe(false);
    expect(SendFileInputSchema.safeParse({ files: ['a'], caption: 'x'.repeat(2001) }).success).toBe(false);
    expect(SendFileInputSchema.safeParse({ files: ['a'], urgency: 'urgent' }).success).toBe(false);
    expect(SendFileInputSchema.safeParse({ files: ['a'], extra: 1 }).success).toBe(false);
  });

  it('ask: each modality takes only its own fields; choice needs options; ids are unique', () => {
    const ok = (question: Record<string, unknown>) => AskInputSchema.safeParse({ questions: [{ question: 'Q?', ...question }] }).success;
    expect(ok({ modality: 'choice', options: [{ label: 'Red' }, { label: 'Blue', description: 'cool' }], multi: true, allowOther: false })).toBe(true);
    expect(ok({ modality: 'choice' })).toBe(false); // options required
    expect(ok({ modality: 'choice', options: [] })).toBe(false);
    expect(ok({ modality: 'choice', options: Array.from({ length: 13 }, (_, i) => ({ label: `o${i}` })) })).toBe(false);
    expect(ok({ modality: 'text', placeholder: 'a title' })).toBe(true);
    expect(ok({ modality: 'text', options: [{ label: 'x' }] })).toBe(false); // options refused outside choice
    expect(ok({ modality: 'text', multi: true })).toBe(false);
    expect(ok({ modality: 'file', multiple: true })).toBe(true);
    expect(ok({ modality: 'folder', multiple: false })).toBe(true);
    expect(ok({ modality: 'choice', options: [{ label: 'a' }], multiple: true })).toBe(false);
    expect(ok({ modality: 'folder', placeholder: 'x' })).toBe(false);
    expect(ok({ modality: 'repository', allowOther: true })).toBe(false);
    expect(ok({ modality: 'repository', header: 'x'.repeat(61) })).toBe(false);
    expect(ok({ modality: 'telepathy' })).toBe(false);
    expect(AskInputSchema.safeParse({ title: 'Setup', context: 'why', blocking: false, questions: [{ id: 'a', question: 'Q?', modality: 'text' }, { id: 'b', question: 'R?', modality: 'repository' }] }).success).toBe(true);
    expect(AskInputSchema.safeParse({ questions: [{ id: 'a', question: 'Q?', modality: 'text' }, { id: 'a', question: 'R?', modality: 'text' }] }).success).toBe(false);
    expect(AskInputSchema.safeParse({ questions: [] }).success).toBe(false);
    expect(AskInputSchema.safeParse({ questions: [{ question: '', modality: 'text' }] }).success).toBe(false);
    // validators never default: what was not sent stays absent
    expect(AskInputSchema.parse({ questions: [{ question: 'Q?', modality: 'choice', options: [{ label: 'a' }] }] })).toEqual({ questions: [{ question: 'Q?', modality: 'choice', options: [{ label: 'a' }] }] });
  });

  it('show_pane takes a known pane, a target up to 4096 characters and a line only for a file', () => {
    expect(ShowPaneInputSchema.safeParse({ pane: 'terminal' }).success).toBe(true);
    expect(ShowPaneInputSchema.safeParse({ pane: 'file', target: 'src/a.ts', line: 3 }).success).toBe(true);
    expect(ShowPaneInputSchema.safeParse({ pane: 'diff', target: 'src/a.ts', line: 3 }).success).toBe(false);
    expect(ShowPaneInputSchema.safeParse({ pane: 'file', target: 'a', line: 0 }).success).toBe(false);
    expect(ShowPaneInputSchema.safeParse({ pane: 'file', target: 'x'.repeat(4097) }).success).toBe(false);
    expect(ShowPaneInputSchema.safeParse({ pane: 'nope' }).success).toBe(false);
  });
});

describe('X9 refusals: one text per offender', () => {
  it('names an unknown pane with the known ones, and every other refusal by its issues', () => {
    expect(parseToolArguments('show_pane', { pane: 'nope' })).toEqual({ ok: false, error: 'show_pane: unknown pane "nope"; known panes: diff, file, terminal, tasks, artifact, browser, source-control' });
    expect(TOOL_ERRORS.unknownPane('nope')).toBe('show_pane: unknown pane "nope"; known panes: diff, file, terminal, tasks, artifact, browser, source-control');
    const missing = parseToolArguments('show_pane', {});
    expect(missing.ok === false && missing.error).toMatch(/^show_pane: invalid arguments: pane: /);
    const files = parseToolArguments('send_file', { files: [] });
    expect(files.ok === false && files.error).toMatch(/^send_file: invalid arguments: files: /);
    const ask = parseToolArguments('ask', { questions: [{ question: 'Q?', modality: 'choice' }] });
    expect(ask.ok === false && ask.error).toMatch(/^ask: invalid arguments: questions\.0\.options: /);
    expect(parseToolArguments('send_file', { files: ['a.txt'] })).toEqual({ ok: true, data: { files: ['a.txt'] } });
    expect(parseToolArguments('show_pane', null).ok).toBe(false);
  });

  it('carries the exact texts of every host refusal', () => {
    expect(TOOL_ERRORS.notAFile('/r/x')).toBe('send_file: not a file: /r/x');
    expect(TOOL_ERRORS.sessionEnded).toBe('ask: the session ended before the user answered');
    expect(TOOL_ERRORS.paneUnavailable('artifact')).toBe('show_pane: the artifact pane is not available in this build of MAWS');
    expect(TOOL_ERRORS.targetRequired('file')).toBe('show_pane: a target is required for the file pane');
    expect(TOOL_ERRORS.fileNotFound('/r/x')).toBe('show_pane: file not found: /r/x');
    expect(TOOL_ERRORS.paneTimeout).toBe('show_pane: no MAWS window answered within 8 s');
  });
});

describe('X9 results', () => {
  it('parses the three result shapes and refuses a stray key', () => {
    expect(SendFileResultSchema.safeParse({ status: 'delivered', deliverables: [{ id: 'd1', path: '/r/a.pdf', name: 'a.pdf' }] }).success).toBe(true);
    expect(AskResultSchema.safeParse({ status: 'asked', askId: 'toolu_1' }).success).toBe(true);
    expect(AskResultSchema.safeParse({ status: 'answered', askId: 'toolu_1', answers: [{ id: 'q1', question: 'Q?', status: 'answered', value: ['Blue'], otherText: 'Teal' }, { id: 'q2', question: 'R?', status: 'skipped' }, { id: 'q3', question: 'S?', status: 'answered', value: '/r', name: 'repo' }] }).success).toBe(true);
    expect(AskResultSchema.safeParse({ status: 'answered', askId: 'toolu_1', answers: [{ id: 'q1', question: 'Q?', status: 'maybe' }] }).success).toBe(false);
    expect(ShowPaneResultSchema.safeParse({ status: 'shown', pane: 'terminal', opened: { kind: 'panel-tool', toolId: 'terminal', tabId: 'terminal:1', title: 'Terminal' } }).success).toBe(true);
    expect(ShowPaneResultSchema.safeParse({ status: 'shown', pane: 'file', opened: { kind: 'main-tab', tabId: 'file:/r/a.ts', path: '/r/a.ts', line: null } }).success).toBe(true);
    expect(ShowPaneResultSchema.safeParse({ status: 'shown', pane: 'file', opened: { kind: 'main-tab', tabId: 't', path: '/r/a.ts' } }).success).toBe(false);
    expect(SendFileResultSchema.safeParse({ status: 'delivered', deliverables: [], extra: 1 }).success).toBe(false);
  });
});

// E2 start (E2 execution document, Design §6): the four artifact tools
describe('X9 artifact tools (E2)', () => {
  const UUID = '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';

  it('carries the constants of the contract', () => {
    expect(ARTIFACT_MAX_BYTES).toBe(16 * 1024 * 1024);
    expect(ARTIFACT_SCREENSHOT_DEFAULT).toEqual({ width: 1280, height: 800 });
    // A-34: 3.5 MiB, so the base64 the engine sends (about 4.7 MB) stays under the API's 5 MB per-image limit
    expect(ARTIFACT_SCREENSHOT_MAX_BYTES).toBe(3.5 * 1024 * 1024);
  });

  it('ARTIFACT_ID takes a short name and refuses a path, a blank and a 65-character id', () => {
    for (const id of ['dash', 'my.report-v2', 'A', 'x'.repeat(64), '0_a']) expect(ARTIFACT_ID.test(id), id).toBe(true);
    for (const id of ['/x', ' ', '', 'x'.repeat(65), '.hidden', '-x', 'a/b', 'a b']) expect(ARTIFACT_ID.test(id), id).toBe(false);
  });

  it('names the artifact tools by their titles (their descriptions open with the fallback sentence, above)', () => {
    expect(MAWS_TOOLS.artifact_create.description).toContain('id and html_path are older names for handle and path');
    expect(MAWS_TOOLS.artifact_publish.description).toContain('baseRevision is the revision your last artifact_read');
  });

  it("publishes each input's JSON schema: strict, with the bounds of the contract", () => {
    const schemaOf = (name: 'artifact_create' | 'artifact_list' | 'artifact_screenshot' | 'artifact_publish') => mawsToolList().find((t) => t.name === name)!.inputSchema;
    const id = { type: 'string', pattern: ARTIFACT_ID.source };
    expect(schemaOf('artifact_create')).toMatchObject({
      type: 'object', additionalProperties: false, required: ['title'],
      properties: { id, handle: id, html_path: { type: 'string', minLength: 1, maxLength: 4096 }, path: { type: 'string', minLength: 1, maxLength: 4096 }, title: { type: 'string', minLength: 1, maxLength: 200 } },
    });
    expect(schemaOf('artifact_list')).toMatchObject({ type: 'object', additionalProperties: false, properties: { scope: { enum: ['session', 'all'] } } });
    expect(schemaOf('artifact_screenshot')).toMatchObject({
      type: 'object', additionalProperties: false, required: ['id'],
      properties: { id, version: { type: 'integer', minimum: 1 }, width: { type: 'integer', minimum: 320, maximum: 2560 }, height: { type: 'integer', minimum: 240, maximum: 2560 } },
    });
    expect(schemaOf('artifact_publish')).toMatchObject({ type: 'object', additionalProperties: false, required: ['artifact', 'baseRevision', 'files'] });
  });

  it('parses the inputs strictly and never defaults', () => {
    // E2's create keeps parsing as it was written; P3-A's names and kinds beside it
    expect(ArtifactCreateInputSchema.parse({ id: 'dash', html_path: 'dashboard.html', title: 'Dashboard' })).toEqual({ id: 'dash', html_path: 'dashboard.html', title: 'Dashboard' });
    expect(ArtifactCreateInputSchema.safeParse({ id: 'dash', html_path: 'dashboard.html' }).success).toBe(false); // a title is required
    expect(ArtifactCreateInputSchema.safeParse({ id: 'dash', html_path: '', title: 'D' }).success).toBe(false);
    expect(ArtifactCreateInputSchema.safeParse({ id: 'dash', html_path: 'x'.repeat(4097), title: 'D' }).success).toBe(false);
    expect(ArtifactCreateInputSchema.safeParse({ id: 'dash', html_path: 'a.html', title: 'x'.repeat(201) }).success).toBe(false);
    expect(ArtifactCreateInputSchema.safeParse({ id: '/x', html_path: 'a.html', title: 'D' }).success).toBe(false);
    expect(ArtifactCreateInputSchema.safeParse({ id: 'dash', html_path: 'a.html', title: 'D', extra: 1 }).success).toBe(false);
    expect(ArtifactCreateInputSchema.safeParse({ handle: 'dash', content: '<p/>', title: 'D' }).success).toBe(true);
    expect(ArtifactCreateInputSchema.safeParse({ kind: 'design', title: 'D', files: { 'a.css': 'x' } }).success).toBe(true);
    expect(ArtifactCreateInputSchema.safeParse({ kind: 'presentation', title: 'D' }).success).toBe(true);
    expect(ArtifactCreateInputSchema.safeParse({ kind: 'file', path: 'r.pdf', title: 'R' }).success).toBe(true);
    for (const bad of [{ title: 'D' }, { title: 'D', path: 'a.html', content: 'x' }, { kind: 'file', title: 'D' }, { kind: 'design', title: 'D', path: 'a' }, { kind: 'document', title: 'D', files: {} }, { id: 'a', handle: 'b', content: 'x', title: 'D' }, { html_path: 'a', path: 'b', title: 'D' }]) {
      expect(ArtifactCreateInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(ArtifactListInputSchema.parse({})).toEqual({});
    expect(ArtifactListInputSchema.safeParse({ all: true }).success).toBe(false);
    expect(ArtifactReadInputSchema.safeParse({ artifact: 'dash', paths: [] }).success).toBe(false);
    expect(ArtifactPublishInputSchema.safeParse({ artifact: 'dash', baseRevision: 3, files: { 'index.html': '<p/>', 'gone.css': null } }).success).toBe(true);
    expect(ArtifactPublishInputSchema.safeParse({ artifact: 'dash', baseRevision: 3, files: {} }).success).toBe(false);
    expect(ArtifactScreenshotInputSchema.parse({ id: 'dash' })).toEqual({ id: 'dash' });
    expect(ArtifactScreenshotInputSchema.safeParse({ id: 'dash', version: 2, width: 320, height: 240 }).success).toBe(true);
    expect(ArtifactScreenshotInputSchema.safeParse({ id: 'dash', width: 2560, height: 2560 }).success).toBe(true);
    for (const bad of [{ version: 0 }, { version: 1.5 }, { width: 319 }, { width: 2561 }, { height: 239 }, { height: 2561 }]) {
      expect(ArtifactScreenshotInputSchema.safeParse({ id: 'dash', ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
    const refused = parseToolArguments('artifact_screenshot', { id: 'dash', width: 10 });
    expect(refused.ok === false && refused.error).toMatch(/^artifact_screenshot: invalid arguments: width: /);
    // the retired update's schemas stay for the journals written before
    expect(ArtifactUpdateInputSchema.parse({ id: 'dash', html_path: 'a.html' })).toEqual({ id: 'dash', html_path: 'a.html' });
  });

  // P3-B's wiring (ledger X25, the architect 2026-10-13): the document read fields and a document's markdown create
  it('admits P3-B’s document read fields on artifact_read and advertises them in tools/list', () => {
    const read = { artifact: 'notes', tab: 'Draft', from: 'b-12', count: 40, sinceRevision: 7 };
    expect(parseToolArguments('artifact_read', read)).toEqual({ ok: true, data: read });
    for (const bad of [{ count: 0 }, { count: 1001 }, { count: 1.5 }, { tab: '' }, { tab: 'x'.repeat(65) }, { from: '' }, { sinceRevision: -1 }]) {
      expect(ArtifactReadInputSchema.safeParse({ artifact: 'notes', ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
    expect(Object.keys(DOCUMENT_READ_FIELDS)).toEqual(['tab', 'from', 'count', 'sinceRevision']);
    expect(mawsToolList().find((t) => t.name === 'artifact_read')!.inputSchema).toMatchObject({
      properties: { tab: { type: 'string', minLength: 1, maxLength: 64 }, from: { type: 'string', minLength: 1, maxLength: 64 }, count: { type: 'integer', minimum: 1, maximum: 1000 }, sinceRevision: { type: 'integer', minimum: 0 } },
    });
    expect(MAWS_TOOLS.artifact_read.description).toContain('tab, from, count and sinceRevision');
  });

  it('admits a document created from markdown content, and no other Y kind’s content', () => {
    expect(parseToolArguments('artifact_create', { kind: 'document', title: 'Notes', content: '# Notes' }).ok).toBe(true);
    expect(ArtifactCreateInputSchema.safeParse({ kind: 'presentation', title: 'Deck', content: '# Deck' }).success).toBe(false);
    expect(MAWS_TOOLS.artifact_create.description).toContain('a document starts empty or from markdown content');
  });

  it('parses the results and refuses a stray key; the delivery fields read alike from every answer that registered an X12 version', () => {
    const created = { status: 'created', artifactId: UUID, kind: 'html', title: 'Dashboard', revision: 1, handle: 'dash', id: 'dash', deliverableId: UUID, version: 1, externalReferences: 0 };
    expect(ArtifactCreateResultSchema.safeParse(created).success).toBe(true);
    expect(ArtifactCreateResultSchema.safeParse({ ...created, version: 2 }).success).toBe(false);
    expect(ArtifactCreateResultSchema.safeParse({ ...created, extra: 1 }).success).toBe(false);
    const published = { status: 'published', artifactId: UUID, kind: 'html', title: 'Dashboard', revision: 4, changed: ['index.html'], kept: [], removed: [], id: 'dash', deliverableId: UUID, version: 2, externalReferences: 0 };
    expect(ArtifactPublishResultSchema.safeParse(published).success).toBe(true);
    const e2Create = { status: 'created', id: 'dash', deliverableId: UUID, version: 1, title: 'Dashboard', externalReferences: 0 };
    const e2Update = { status: 'updated', id: 'dash', deliverableId: UUID, version: 2, title: 'Dashboard', externalReferences: 3 };
    expect(ArtifactUpdateResultSchema.safeParse(e2Update).success).toBe(true);
    for (const answer of [created, published, e2Create, e2Update]) expect(ArtifactDeliverySchema.parse(answer)).toMatchObject({ id: 'dash', deliverableId: UUID, title: 'Dashboard' });
    expect(ArtifactDeliverySchema.safeParse({ ...published, id: undefined, deliverableId: undefined, version: undefined }).success).toBe(false); // a file kind's publish registers none
    const listed = { id: UUID, handle: 'dash', kind: 'html', title: 'Dashboard', revision: 2, updatedAt: '2026-10-06T00:01:00.000Z', lastEditor: { by: 'this session', at: '2026-10-06T00:01:00.000Z' } };
    expect(ArtifactListResultSchema.safeParse({ status: 'listed', artifacts: [listed] }).success).toBe(true);
    expect(ArtifactListResultSchema.safeParse({ status: 'listed', artifacts: [{ ...listed, lastEditor: null }] }).success).toBe(true);
    expect(ArtifactListResultSchema.safeParse({ status: 'listed', artifacts: [{ ...listed, extra: 1 }] }).success).toBe(false);
    const captured = { status: 'captured', id: 'dash', deliverableId: UUID, title: 'Dashboard', version: 1, width: 64, height: 64, bytes: 132, consoleErrors: ['Uncaught Error: E2_BOOM'] };
    expect(ArtifactScreenshotResultSchema.safeParse(captured).success).toBe(true);
    expect(ArtifactScreenshotResultSchema.safeParse({ ...captured, title: undefined }).success).toBe(false); // the title is the cell's label
  });

  it('carries the exact texts of every artifact refusal, each naming the tool whose call it answers', () => {
    expect(TOOL_ERRORS.artifactNotAFile('artifact_upload_asset', '/r/x.png')).toBe('artifact_upload_asset: not a file: /r/x.png');
    expect(TOOL_ERRORS.notHtml('artifact_create', '/r/x.txt')).toBe('artifact_create: not an HTML file: /r/x.txt');
    expect(TOOL_ERRORS.tooLarge('artifact_create', '/r/x.html', 16777217)).toBe('artifact_create: too large: /r/x.html (16777217 bytes; the limit is 16 MiB)');
    expect(TOOL_ERRORS.artifactExists('dash')).toBe('artifact_create: an artifact "dash" already exists in this session; use artifact_publish');
    expect(TOOL_ERRORS.noArtifact('artifact_publish', 'nope')).toBe('artifact_publish: no artifact "nope" in this session');
    expect(TOOL_ERRORS.noArtifact('artifact_screenshot', 'nope')).toBe('artifact_screenshot: no artifact "nope" in this session');
    expect(TOOL_ERRORS.noVersion('dash', 3, 2)).toBe('artifact_screenshot: version 3 does not exist; "dash" has 2 version(s)');
    expect(TOOL_ERRORS.captureFailed('did-fail-load -3 ERR_ABORTED')).toBe('artifact_screenshot: MAWS could not capture the artifact: did-fail-load -3 ERR_ABORTED');
    expect(TOOL_ERRORS.captureTimeout).toBe('artifact_screenshot: MAWS did not answer within 45 s');
    const stale = TOOL_ERRORS.refused('artifact_publish', { reason: 'staleBase', liveRevision: 7 }, 'read the artifact again');
    expect(stale).toBe('artifact_publish: read the artifact again {"reason":"staleBase","liveRevision":7}');
    expect(artifactRefusalOf(stale)).toEqual({ reason: 'staleBase', liveRevision: 7 });
    expect(artifactRefusalOf('artifact_publish: no artifact "x" in this session')).toBeNull();
    expect(TOOL_ERRORS.artifactNotFound('d1')).toBe('show_pane: no artifact "d1" in this session'); // P3-L M6b
    expect(TOOL_ERRORS.artifactUnreadable('d1', 'EIO')).toBe('show_pane: could not read artifact "d1": EIO');
    expect(TOOL_ERRORS.deliveryUnavailable).toBe('send_file: the artifact store is unavailable in this run of MAWS; nothing was delivered');
    expect(TOOL_ERRORS.unknownTool('echo')).toMatch(/^unknown tool "echo"; the maws server has send_file, ask, show_pane, artifact_create, artifact_list, artifact_screenshot, /); // E4c: thirteen; P1 A-54: seven; P3-A: twelve
  });
});
// E2 end
// E4a start: the browser pane's refusal
describe('E4a: the browser refusal', () => {
  it('names the refused target and show_pane', () => {
    expect(TOOL_ERRORS.navigationRefused('file:///etc/hosts')).toBe('show_pane: MAWS opens only http and https pages in its browser; refused "file:///etc/hosts"');
  });
});
// E4a end
