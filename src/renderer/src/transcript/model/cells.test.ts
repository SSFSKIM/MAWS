// E2 (M5, Design §9): `firstJsonBlock` reads a `maws` result's JSON from the first text block that is a JSON object.
// The engine puts its own pointer text beside an image block (M0: `[image, "[Image: source: …]", server JSON]`), so
// joining every text block, as E1's `resultJson` does, would not parse.
import { describe, expect, it } from 'vitest';
import type { ContentBlock, SessionEvent } from '@shared/graph/events';
import { ArtifactScreenshotResultSchema } from '@shared/maws/tools';
import { loadJournal } from '../../../../../test/support/fixtures';
import { journalToEvents } from '../dev/journal';
import { cellOf, firstJsonBlock, mergeReads, type ToolRecord } from './cells';

const IMAGE: ContentBlock = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } };
const RESULT = { status: 'captured', id: 'dash', title: 'Dashboard', version: 1 };
const text = (value: string): ContentBlock => ({ type: 'text', text: value });

describe('firstJsonBlock', () => {
  it('over [image, json, text]: the JSON block', () => {
    expect(firstJsonBlock([IMAGE, text(JSON.stringify(RESULT, null, 2)), text('[Image: source: /tmp/x.png]')])).toEqual(RESULT);
  });

  it('over the engine’s order [image, pointer text, json]: the JSON block', () => {
    expect(firstJsonBlock([IMAGE, text('[Image: source: /tmp/config/projects/p/s/tool-results/mcp-maws-blob-1.png]'), text(JSON.stringify(RESULT))])).toEqual(RESULT);
  });

  it('over text alone: a string result or one text block', () => {
    expect(firstJsonBlock(JSON.stringify(RESULT))).toEqual(RESULT);
    expect(firstJsonBlock([text(JSON.stringify(RESULT))])).toEqual(RESULT);
  });

  it('over no JSON object: null (prose, a bare value, an image alone, nothing)', () => {
    expect(firstJsonBlock('artifact_screenshot: no artifact "x" in this session')).toBeNull();
    expect(firstJsonBlock([text('the picture'), text('42'), text('"a string"'), text('null')])).toBeNull();
    expect(firstJsonBlock([IMAGE])).toBeNull();
    expect(firstJsonBlock([])).toBeNull();
  });

  it('p1-maws-artifacts: the recorded screenshot result parses as the tool’s result', () => {
    const results = journalToEvents(loadJournal('pass3', 'p1-maws-artifacts')).filter((event) => event.kind === 'tool.result');
    const screenshot = results.find((event) => typeof event.content !== 'string' && event.content.some((block) => block.type === 'image'));
    expect(screenshot && typeof screenshot.content !== 'string' && screenshot.content.map((block) => block.type)).toEqual(['image', 'text', 'text']);
    expect(ArtifactScreenshotResultSchema.parse(firstJsonBlock(screenshot!.content))).toMatchObject({ status: 'captured', id: 'dash', title: 'Dashboard', version: 1, width: 64, height: 64 });
  });
});

// UX wave U8c-2 (M5, §K): the shell cell keeps the two folders apart. Its `cwd` stays the input's (which the engine's
// Bash input never names); `rowCwd` is the folder the call's row records, present only when its event carries one.
describe('the shell cell’s folders', () => {
  const AT = '2026-11-13T10:00:00.000Z';
  const shell = (input: Record<string, unknown>, cwd?: string): ToolRecord => ({
    use: {
      id: 'e1', sessionId: 'S', at: AT, seq: 1, agentId: null, parentToolUseId: null, kind: 'tool.use', toolUseId: 't1', toolName: 'Bash', input, apiMessageId: null, messageUuid: null,
      ...(cwd !== undefined && { cwd }),
    } as Extract<SessionEvent, { kind: 'tool.use' }>,
    result: null, safeguard: 'not_evaluated', elapsedSeconds: 0, humanDecision: false, backgroundTaskId: null, backgroundDone: false,
  });
  const detailOf = (rec: ToolRecord) => cellOf(rec, { closed: false, stopped: false, continued: new Set(), lastAt: AT }, true).detail;

  it('carries the event’s folder beside the input’s, and neither stands in for the other', () => {
    expect(detailOf(shell({ command: 'ls' }, '/repo/.claude/worktrees/w1'))).toMatchObject({ kind: 'shell', cwd: null, rowCwd: '/repo/.claude/worktrees/w1' });
    expect(detailOf(shell({ command: 'ls', cwd: '/w/elsewhere' }, '/repo'))).toMatchObject({ kind: 'shell', cwd: '/w/elsewhere', rowCwd: '/repo' });
    const live = detailOf(shell({ command: 'ls' }));
    expect(live).toMatchObject({ kind: 'shell', cwd: null });
    expect('rowCwd' in live).toBe(false); // an event with no folder makes the cell it made before
  });
});

// UX wave U2b, M7 (the execution document, Interfaces §M, "Where the ids and the inputs come from"; reported point 25):
// a merged read keeps every member read's tool-use id in an additive list, so a stored run bounded by a later member is
// placed; the cell's own id and `toolUseId`, which every reader of the cell reads, are as they were.
describe('a merged read’s members', () => {
  const AT = '2026-11-16T10:00:00.000Z';
  const read = (id: string, path: string): ToolRecord => ({
    use: { id: `e-${id}`, sessionId: 'S', at: AT, seq: 1, agentId: null, parentToolUseId: null, kind: 'tool.use', toolUseId: id, toolName: 'Read', input: { file_path: path }, apiMessageId: null, messageUuid: null } as Extract<SessionEvent, { kind: 'tool.use' }>,
    result: null, safeguard: 'not_evaluated', elapsedSeconds: 0, humanDecision: false, backgroundTaskId: null, backgroundDone: false,
  });
  const cell = (id: string, path: string) => cellOf(read(id, path), { closed: false, stopped: false, continued: new Set(), lastAt: AT }, false);

  it('lists every member read’s id, in order, and leaves the cell’s own id and toolUseId as they were', () => {
    const first = cell('r1', '/notes/a.md');
    const two = mergeReads(first, cell('r2', '/notes/b.md'));
    const three = mergeReads(two, cell('r3', '/notes/c.md'));
    expect(two.reads).toEqual(['r1', 'r2']);
    expect(three.reads).toEqual(['r1', 'r2', 'r3']);
    expect([three.id, three.toolUseId, three.paths]).toEqual(['cell:reads:r1', 'r1', ['/notes/a.md', '/notes/b.md', '/notes/c.md']]);
    expect(first).not.toHaveProperty('reads');
  });
});
