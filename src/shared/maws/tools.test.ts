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
  ArtifactScreenshotInputSchema,
  ArtifactScreenshotResultSchema,
  ArtifactUpdateInputSchema,
  ArtifactUpdateResultSchema,
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

describe('X9: the maws server and its seven tools', () => {
  it('names the server and the tools as the contract says (E2 appends the four artifact tools)', () => {
    expect(MAWS_SERVER_NAME).toBe('maws');
    expect(MAWS_TOOL_NAMES).toEqual(['send_file', 'ask', 'show_pane', 'artifact_create', 'artifact_update', 'artifact_list', 'artifact_screenshot']);
    expect(Object.keys(MAWS_TOOLS)).toEqual([...MAWS_TOOL_NAMES]);
    expect(mawsServerInfo('0.9.0')).toEqual({ name: 'maws', version: '0.9.0' });
    expect(MAWS_TOOL_ANNOTATIONS).toEqual({ readOnlyHint: true, openWorldHint: false });
  });

  // A-18: ToolSearch indexes descriptions, so the fallback sentence comes first
  it('opens every description with its fallback sentence, word for word', () => {
    for (const name of MAWS_TOOL_NAMES) expect(MAWS_TOOLS[name].description, name).toMatch(/^[^.]*without this tool/);
    expect(MAWS_TOOLS.send_file.description).toBe(
      'Deliver files to the user inside MAWS; without this tool, write the file and tell the user its path. Each delivered file becomes a row in the MAWS transcript with your caption and buttons to open it or reveal it in Finder; use it when you have produced something the user should look at (a PDF, an HTML page, an image, a document). Paths may be absolute or relative to the working directory and must name existing files. Returns the deliverable ids MAWS recorded.',
    );
    expect(MAWS_TOOLS.ask.description).toBe(
      'Ask the user one or several questions at once through a MAWS sheet; without this tool, use AskUserQuestion. Each question has a modality: "choice" (options, single or multi, with an Other row), "text" (free text), "file" or "folder" (a native picker returning absolute paths), or "repository" (one of the user\'s MAWS projects). The user may answer any question with "decide for me" or skip it. With blocking true (the default) the call waits for the answers and returns them; with blocking false it returns {status: "asked", askId} at once and the answers arrive later as a user message that names the askId, so you can keep working meanwhile.',
    );
    expect(MAWS_TOOLS.show_pane.description).toBe(
      'Open a MAWS pane for the user: "diff", "file", "terminal", "tasks", "deliverable", "browser" or "source-control"; without this tool, describe where the user should look. target names what to open: a file path for diff or file (line optional), a deliverable id for deliverable, a URL for browser. Returns what was opened, or an error for an unknown pane or a pane this build of MAWS does not have.',
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
      ['artifact_update', { readOnlyHint: false, openWorldHint: false, title: 'Update artifact' }],
      ['artifact_list', { readOnlyHint: true, openWorldHint: false, title: 'List artifacts' }],
      ['artifact_screenshot', { readOnlyHint: true, openWorldHint: false, title: 'Screenshot artifact' }],
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
    expect(parseToolArguments('show_pane', { pane: 'nope' })).toEqual({ ok: false, error: 'show_pane: unknown pane "nope"; known panes: diff, file, terminal, tasks, deliverable, browser, source-control' });
    expect(TOOL_ERRORS.unknownPane('nope')).toBe('show_pane: unknown pane "nope"; known panes: diff, file, terminal, tasks, deliverable, browser, source-control');
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
    expect(TOOL_ERRORS.paneUnavailable('deliverable')).toBe('show_pane: the deliverable pane is not available in this build of MAWS');
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
    expect(ARTIFACT_SCREENSHOT_MAX_BYTES).toBe(4 * 1024 * 1024);
  });

  it('ARTIFACT_ID takes a short name and refuses a path, a blank and a 65-character id', () => {
    for (const id of ['dash', 'my.report-v2', 'A', 'x'.repeat(64), '0_a']) expect(ARTIFACT_ID.test(id), id).toBe(true);
    for (const id of ['/x', ' ', '', 'x'.repeat(65), '.hidden', '-x', 'a/b', 'a b']) expect(ARTIFACT_ID.test(id), id).toBe(false);
  });

  it('describes each tool word for word, the fallback sentence first', () => {
    expect(MAWS_TOOLS.artifact_create).toMatchObject({ title: 'Create artifact' });
    expect(MAWS_TOOLS.artifact_create.description).toBe(
      "Register a self-contained HTML file you wrote as a MAWS artifact the user can view and comment on; without this tool, write the HTML file and tell the user its path. Give it a short id you will reuse for updates, the path of the HTML file (absolute or relative to the working directory) and a title. MAWS copies the file, keeps every version, shows it in a sandboxed frame with no network access (inline everything: styles, scripts, images as data URLs) and reports how many external URLs it found. Returns the artifact's deliverable id and version 1.",
    );
    expect(MAWS_TOOLS.artifact_update).toMatchObject({ title: 'Update artifact' });
    expect(MAWS_TOOLS.artifact_update.description).toBe(
      "Add a new version of a MAWS artifact from an HTML file you rewrote; without this tool, write the HTML file and tell the user its path. Names the artifact by the id you gave artifact_create; the user can switch between versions, and a title replaces the artifact's title. Returns the new version number.",
    );
    expect(MAWS_TOOLS.artifact_list).toMatchObject({ title: 'List artifacts' });
    expect(MAWS_TOOLS.artifact_list.description).toBe(
      'List the artifacts this session registered with MAWS, with their ids, titles and version counts; without this tool, keep your own list of the HTML files you wrote.',
    );
    expect(MAWS_TOOLS.artifact_screenshot).toMatchObject({ title: 'Screenshot artifact' });
    expect(MAWS_TOOLS.artifact_screenshot.description).toBe(
      'Capture a PNG screenshot of a MAWS artifact as the user sees it, rendered in a sandboxed frame with no network; without this tool, describe the page from its source. Names the artifact by id and optionally a version (the latest by default) and a viewport size (1280 by 800 by default). Returns the image and the console errors the page logged while loading, so you can check your work.',
    );
  });

  it("publishes each input's JSON schema: strict, with the bounds of the contract", () => {
    const schemaOf = (name: 'artifact_create' | 'artifact_update' | 'artifact_list' | 'artifact_screenshot') => mawsToolList().find((t) => t.name === name)!.inputSchema;
    const id = { type: 'string', pattern: ARTIFACT_ID.source };
    expect(schemaOf('artifact_create')).toMatchObject({
      type: 'object', additionalProperties: false, required: ['id', 'html_path', 'title'],
      properties: { id, html_path: { type: 'string', minLength: 1, maxLength: 4096 }, title: { type: 'string', minLength: 1, maxLength: 200 } },
    });
    expect(schemaOf('artifact_update')).toMatchObject({
      type: 'object', additionalProperties: false, required: ['id', 'html_path'],
      properties: { id, html_path: { type: 'string', minLength: 1, maxLength: 4096 }, title: { type: 'string', minLength: 1, maxLength: 200 } },
    });
    expect(schemaOf('artifact_list')).toMatchObject({ type: 'object', additionalProperties: false, properties: {} });
    expect(schemaOf('artifact_screenshot')).toMatchObject({
      type: 'object', additionalProperties: false, required: ['id'],
      properties: { id, version: { type: 'integer', minimum: 1 }, width: { type: 'integer', minimum: 320, maximum: 2560 }, height: { type: 'integer', minimum: 240, maximum: 2560 } },
    });
  });

  it('parses the inputs strictly and never defaults', () => {
    expect(ArtifactCreateInputSchema.parse({ id: 'dash', html_path: 'dashboard.html', title: 'Dashboard' })).toEqual({ id: 'dash', html_path: 'dashboard.html', title: 'Dashboard' });
    expect(ArtifactCreateInputSchema.safeParse({ id: 'dash', html_path: 'dashboard.html' }).success).toBe(false); // a title is required
    expect(ArtifactCreateInputSchema.safeParse({ id: 'dash', html_path: '', title: 'D' }).success).toBe(false);
    expect(ArtifactCreateInputSchema.safeParse({ id: 'dash', html_path: 'x'.repeat(4097), title: 'D' }).success).toBe(false);
    expect(ArtifactCreateInputSchema.safeParse({ id: 'dash', html_path: 'a.html', title: 'x'.repeat(201) }).success).toBe(false);
    expect(ArtifactCreateInputSchema.safeParse({ id: '/x', html_path: 'a.html', title: 'D' }).success).toBe(false);
    expect(ArtifactCreateInputSchema.safeParse({ id: 'dash', html_path: 'a.html', title: 'D', extra: 1 }).success).toBe(false);
    expect(ArtifactUpdateInputSchema.parse({ id: 'dash', html_path: 'a.html' })).toEqual({ id: 'dash', html_path: 'a.html' });
    expect(ArtifactUpdateInputSchema.safeParse({ id: 'dash', html_path: 'a.html', title: 'Sales dashboard, Q3' }).success).toBe(true);
    expect(ArtifactUpdateInputSchema.safeParse({ id: 'dash', html_path: 'a.html', title: '' }).success).toBe(false);
    expect(ArtifactListInputSchema.parse({})).toEqual({});
    expect(ArtifactListInputSchema.safeParse({ all: true }).success).toBe(false);
    expect(ArtifactScreenshotInputSchema.parse({ id: 'dash' })).toEqual({ id: 'dash' });
    expect(ArtifactScreenshotInputSchema.safeParse({ id: 'dash', version: 2, width: 320, height: 240 }).success).toBe(true);
    expect(ArtifactScreenshotInputSchema.safeParse({ id: 'dash', width: 2560, height: 2560 }).success).toBe(true);
    for (const bad of [{ version: 0 }, { version: 1.5 }, { width: 319 }, { width: 2561 }, { height: 239 }, { height: 2561 }]) {
      expect(ArtifactScreenshotInputSchema.safeParse({ id: 'dash', ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
    const refused = parseToolArguments('artifact_screenshot', { id: 'dash', width: 10 });
    expect(refused.ok === false && refused.error).toMatch(/^artifact_screenshot: invalid arguments: width: /);
  });

  it('parses the results and refuses a stray key', () => {
    expect(ArtifactCreateResultSchema.safeParse({ status: 'created', id: 'dash', deliverableId: UUID, version: 1, title: 'Dashboard', externalReferences: 0 }).success).toBe(true);
    expect(ArtifactCreateResultSchema.safeParse({ status: 'created', id: 'dash', deliverableId: UUID, version: 2, title: 'Dashboard', externalReferences: 0 }).success).toBe(false);
    expect(ArtifactUpdateResultSchema.safeParse({ status: 'updated', id: 'dash', deliverableId: UUID, version: 2, title: 'Dashboard', externalReferences: 3 }).success).toBe(true);
    expect(ArtifactUpdateResultSchema.safeParse({ status: 'updated', id: 'dash', deliverableId: UUID, version: 1, title: 'Dashboard', externalReferences: 0 }).success).toBe(false);
    const listed = { id: 'dash', deliverableId: UUID, title: 'Dashboard', versions: 2, createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:01:00.000Z' };
    expect(ArtifactListResultSchema.safeParse({ status: 'listed', artifacts: [listed] }).success).toBe(true);
    expect(ArtifactListResultSchema.safeParse({ status: 'listed', artifacts: [] }).success).toBe(true);
    expect(ArtifactListResultSchema.safeParse({ status: 'listed', artifacts: [{ ...listed, extra: 1 }] }).success).toBe(false);
    const captured = { status: 'captured', id: 'dash', deliverableId: UUID, title: 'Dashboard', version: 1, width: 64, height: 64, bytes: 132, consoleErrors: ['Uncaught Error: E2_BOOM'] };
    expect(ArtifactScreenshotResultSchema.safeParse(captured).success).toBe(true);
    expect(ArtifactScreenshotResultSchema.safeParse({ ...captured, title: undefined }).success).toBe(false); // the title is the cell's label
  });

  it('carries the exact texts of every artifact refusal, each naming the tool whose call it answers', () => {
    expect(TOOL_ERRORS.artifactNotAFile('artifact_update', '/r/x.html')).toBe('artifact_update: not a file: /r/x.html');
    expect(TOOL_ERRORS.notHtml('artifact_create', '/r/x.txt')).toBe('artifact_create: not an HTML file: /r/x.txt');
    expect(TOOL_ERRORS.tooLarge('artifact_create', '/r/x.html', 16777217)).toBe('artifact_create: too large: /r/x.html (16777217 bytes; the limit is 16 MiB)');
    expect(TOOL_ERRORS.artifactExists('dash')).toBe('artifact_create: an artifact "dash" already exists in this session; use artifact_update');
    expect(TOOL_ERRORS.noArtifact('artifact_update', 'nope')).toBe('artifact_update: no artifact "nope" in this session; use artifact_create');
    expect(TOOL_ERRORS.noArtifact('artifact_screenshot', 'nope')).toBe('artifact_screenshot: no artifact "nope" in this session');
    expect(TOOL_ERRORS.noVersion('dash', 3, 2)).toBe('artifact_screenshot: version 3 does not exist; "dash" has 2 version(s)');
    expect(TOOL_ERRORS.captureFailed('did-fail-load -3 ERR_ABORTED')).toBe('artifact_screenshot: MAWS could not capture the artifact: did-fail-load -3 ERR_ABORTED');
    expect(TOOL_ERRORS.captureTimeout).toBe('artifact_screenshot: MAWS did not answer within 45 s');
    expect(TOOL_ERRORS.notRecorded('artifact_update', '/r/x.html', 'ENOSPC')).toBe('artifact_update: /r/x.html was not recorded: ENOSPC');
    expect(TOOL_ERRORS.deliverableNotFound('d1')).toBe('show_pane: no deliverable "d1" in this session');
    expect(TOOL_ERRORS.deliverableUnreadable('d1', 'EIO')).toBe('show_pane: could not read deliverable "d1": EIO');
    expect(TOOL_ERRORS.unknownTool('echo')).toBe('unknown tool "echo"; the maws server has send_file, ask, show_pane, artifact_create, artifact_update, artifact_list, artifact_screenshot');
  });
});
// E2 end
// E4a start: the browser pane's refusal, which E4c's browser tools reuse under their own names
describe('E4a: the browser refusal', () => {
  it('names the refused target and, by default, show_pane', () => {
    expect(TOOL_ERRORS.navigationRefused('file:///etc/hosts')).toBe('show_pane: MAWS opens only http and https pages in its browser; refused "file:///etc/hosts"');
    expect(TOOL_ERRORS.navigationRefused('javascript:1', 'show_pane')).toBe('show_pane: MAWS opens only http and https pages in its browser; refused "javascript:1"');
  });
});
// E4a end
