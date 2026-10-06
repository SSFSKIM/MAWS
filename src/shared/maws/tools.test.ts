import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { PANE_NAMES } from './panes';
import {
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

describe('X9: the maws server and its three tools', () => {
  it('names the server and the tools as the contract says', () => {
    expect(MAWS_SERVER_NAME).toBe('maws');
    expect(MAWS_TOOL_NAMES).toEqual(['send_file', 'ask', 'show_pane']);
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

  it('lists each tool with its title, description, the JSON schema of its zod input and the annotations', () => {
    const list = mawsToolList();
    expect(list.map((t) => t.name)).toEqual([...MAWS_TOOL_NAMES]);
    for (const tool of list) {
      const spec = MAWS_TOOLS[tool.name as keyof typeof MAWS_TOOLS];
      expect(tool).toEqual({ name: tool.name, title: spec.title, description: spec.description, inputSchema: z.toJSONSchema(spec.input), annotations: { ...MAWS_TOOL_ANNOTATIONS, title: spec.title } });
      expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
    }
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
