import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parseTranscriptProps } from '@shared/engine/surface-rows';
import { renderRow } from '../view/rows/test-support';
import { rowsOf, turnRows, withAllExpanded } from '../model/derive';
import { applyEvents, createState, withReaderState } from '../model/reduce';
import type { Row } from '../model/rows';
import { BASH_RESULT, builder, api, tool, uuid } from '../model/test-events';
import type { ArrivalEntry } from '@shared/engine/arrival-schema';
import { loadUxwaveJournal } from '../../../../../test/support/fixtures';
import { journalToEvents } from '../dev/journal';
import { arrivalInput, assistantInput, commandInput, groupInput, noticeFollows, noticeIndexBuilds, questionInput, sentInput, toolInputs, userInput, withToolProps } from './adapters';

afterEach(cleanup);

const setup = (b: ReturnType<typeof builder>) => {
  const state = withAllExpanded(applyEvents(createState(null, null), b.events));
  const rows = rowsOf(state);
  return { state, rows, turn: [...state.turns.values()][0] };
};
const find = <K extends Row['kind']>(rows: Row[], kind: K) => rows.find((r): r is Extract<Row, { kind: K }> => r.kind === kind)!;

describe('transcript surface adapters', () => {
  it('asks only for a nonempty own prompt, preserving known provenance without guessing a terminal origin', () => {
    const b = builder(); b.turn('u');
    const { rows, turn } = setup(b); const row = find(rows, 'user');
    expect(userInput(row, turn)).toEqual({ instanceId: 'u', props: { text: 'prompt u', origin: { kind: 'sdk' }, isExpanded: true } });
    expect(userInput({ ...row, pending: 'held' }, turn)).toBeNull();
    expect(userInput({ ...row, dropped: true }, turn)).toBeNull();
    expect(userInput({ ...row, text: '' }, turn)).toBeNull();
    const event = turn.events.find((e) => e.kind === 'user.message')!;
    expect(userInput(row, { ...turn, events: [{ ...event, isSynthetic: true }] })).toBeNull();
    expect(userInput(row, { ...turn, events: [{ ...event, origin: 'peer' }] })).toBeNull();
    expect(userInput(row, { ...turn, events: [{ ...event, origin: null }] })?.props.origin).toEqual({ kind: 'unclassified' });
  });

  it('gives text blocks of one message separate stable slots, including commentary and a leading thinking block', () => {
    const b = builder(); b.turn('u'); b.thinking('api', 0, 'thinking');
    b.text('api', 1, 'First', { messageUuid: uuid('message') }); b.text('api', 2, 'Second', { messageUuid: uuid('message') });
    const { rows, turn } = setup(b); const texts = rows.filter((r): r is Extract<Row, { kind: 'assistant_text' }> => r.kind === 'assistant_text');
    expect(assistantInput(texts[0], turn)).toEqual({ instanceId: 'message', props: { text: 'First', isFirstOfReply: true } });
    expect(assistantInput({ ...texts[1], phase: 'commentary' }, turn)).toEqual({ instanceId: 'message:text:2', props: { text: 'Second', isFirstOfReply: false } });
    expect(assistantInput({ ...texts[0], markdown: '' }, turn)).toBeNull();
  });

  it('keeps display headers through split streaming deltas and completion, without leaking ANSI into native markdown', () => {
    const b = builder(); b.turn('u'); b.thinking('api', 0, 'thinking');
    const pieces = ['\u001b[1;', '36mto human\u001b[0m\n', 'Hello'];
    for (const textDelta of pieces) b.emit('assistant.block.delta', { apiMessageId: api('api'), blockIndex: 1, blockType: 'text', textDelta, thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null });
    const live = setup(b); const row = find(live.rows, 'assistant_text');
    expect(assistantInput(row, live.turn)?.props).toEqual({ text: pieces.join(''), isFirstOfReply: true });
    b.text('api', 0, pieces.join(''), { messageUuid: uuid('message') });
    const done = setup(b); const text = find(done.rows, 'assistant_text');
    expect(text.markdown).toBe('to human\nHello');
    expect(assistantInput(text, done.turn)?.props).toEqual({ text: pieces.join(''), isFirstOfReply: true });
  });

  it('keeps raw tool input and structured output, not the compact label, and keeps reads as individual calls', () => {
    const b = builder(); b.turn('u');
    b.toolUse('r1', 'Read', { file_path: '/a', offset: 3, limit: 4 }); b.result('r1', 'first');
    b.toolUse('r2', 'Read', { file_path: '/b' }); b.result('r2', 'second');
    b.toolUse('bash', 'Bash', { command: 'pwd', timeout: 123 }); b.result('bash', 'here', { structured: BASH_RESULT('here') });
    const { rows, turn, state } = setup(b); const group = find(rows, 'group');
    const calls = groupInput(group, turn, state.pending)!;
    expect(calls.instanceId).toBe('group:r1');
    expect(calls.props.calls).toMatchObject([
      { tool_use_id: 'r1', tool: 'Read', input: { file_path: '/a', offset: 3, limit: 4 }, output: 'first' },
      { tool_use_id: 'r2', tool: 'Read', input: { file_path: '/b' }, output: 'second' },
      { tool_use_id: 'bash', tool: 'Bash', input: { command: 'pwd', timeout: 123 }, output: { stdout: 'here' } },
    ]);
    expect(group.cells.slice(0, 2).flatMap((cell) => toolInputs(cell, turn).map((c) => c.props.tool_use_id))).toEqual(['r1', 'r2']);
    expect(calls.props).not.toHaveProperty('onScreen');
  });

  it('does not resurrect a retracted call between consecutive reads', () => {
    const b = builder(); b.turn('u');
    for (const id of ['r1', 'removed', 'r3']) { b.toolUse(id, 'Read', { file_path: `/${id}` }); b.result(id, id); }
    b.emit('boundary.retraction', { retractedMessageUuids: [uuid('msg-removed-u0')], reason: 'fallback', fallbackModel: null });
    const { rows, turn } = setup(b);
    const group = find(rows, 'group');
    expect(group.cells.flatMap((cell) => toolInputs(cell, turn).map((call) => call.instanceId))).toEqual(['r1', 'r3']);
  });

  // UX wave U2 (l6-artifacts-12; the U2a document, M3): a rewrite draws the artifact by the title the transcript gave it
  it('an output-only rewrite of an artifact call keeps the title an earlier turn and this turn gave it', () => {
    const MEMO_ID = '5b0c6c1e-7d2a-4c8e-9f10-2a3b4c5d6e7f';
    const json = (value: unknown) => [{ type: 'text', text: JSON.stringify(value) }];
    const b = builder(); b.turn('u1');
    b.toolUse('r1', 'mcp__maws__artifact_read', { artifact: 'q3-memo' });
    b.result('r1', json({ status: 'read', artifactId: MEMO_ID, kind: 'document', title: 'Q3 memo', revision: 4, handle: 'q3-memo', versions: [] }));
    b.end(['u1']); b.turn('u2');
    b.toolUse('e1', 'mcp__maws__artifact_edit', { artifact: 'q3-memo', edits: [] }); b.result('e1', json({ status: 'ok' }));
    b.toolUse('r2', 'mcp__maws__artifact_read', { artifact: 'q4-plan' });
    b.result('r2', json({ status: 'read', artifactId: '7a1d2e3f-4b5c-4d6e-8f70-1a2b3c4d5e6f', kind: 'document', title: 'Q4 plan', revision: 1, handle: 'q4-plan', versions: [] }));
    b.toolUse('e2', 'mcp__maws__artifact_edit', { artifact: 'q4-plan', edits: [] }); b.result('e2', json({ status: 'ok' }));
    b.end(['u2']);
    const { state, rows } = setup(b);
    const turn = [...state.turns.values()].at(-1)!;
    const cells = rows.flatMap((row) => (row.kind === 'group' ? row.cells : row.kind === 'cell' ? [row] : []));
    const rewritten = (id: string) => {
      const input = toolInputs(cells.find((cell) => cell.toolUseId === tool(id))!, turn, undefined, state)[0];
      return withToolProps(input, { ...input.props, output: json({ status: 'ok', note: 'rewritten' }) }).label;
    };
    expect([rewritten('e1'), rewritten('e2')]).toEqual(['Edited ‹Q3 memo›', 'Edited ‹Q4 plan›']);
  });

  it('keeps factual call details through rewrites without reviving an engine batch summary', () => {
    const b = builder(); b.turn('u');
    b.toolUse('bash', 'Bash', { command: 'pwd' }); b.result('bash', '/p');
    b.emit('tool.summary', { toolUseIds: [tool('bash')], summary: 'Checked the working directory' }); b.end(['u']);
    const { rows, turn } = setup(b);
    const input = toolInputs(find(rows, 'cell'), turn)[0];
    const rewritten = withToolProps(input, { ...input.props, output: '/rewritten' });
    expect(rewritten.detail).toMatchObject({ command: 'pwd', stdout: '/rewritten' });
    expect(rewritten.summary).toBeUndefined();
    const row = find(rows, 'cell');
    const { container } = renderRow({ ...row, ...rewritten, id: row.id, expanded: true });
    expect(container.querySelector('.transcript-cell-label')?.textContent).toBe('Ran pwd');
    expect(container.querySelector('pre')?.textContent).toBe('/rewritten');
    expect(container.textContent).not.toContain('Checked the working directory');
    const changed = withToolProps(input, { ...input.props, input: { command: 'echo changed' } });
    expect(changed.detail).toMatchObject({ command: 'echo changed', stdout: '/p' });
    expect(changed.summary).toBeUndefined();
  });

  it('withholds the group ask while a member needs approval', () => {
    const b = builder(); b.turn('u'); b.toolUse('bash', 'Bash', { command: 'pwd' });
    const { rows, turn } = setup(b); const row = find(rows, 'group');
    const pending = new Map([['r', { kind: 'permission.requested', toolUseId: tool('bash') }]]) as never;
    expect(groupInput(row, turn, pending)).toBeNull();
  });

  // UX wave U2 (the U2a document, M4 "The mods' site"; C13): the run's real open state, and the jump's rule for the run
  it('reports the run’s open state, and asks nothing for a run that is the tab’s revealed target or holds it', () => {
    const b = builder(); b.turn('u');
    b.toolUse('r1', 'Read', { file_path: '/a' }); b.result('r1', 'first');
    b.toolUse('r2', 'Read', { file_path: '/b' }); b.result('r2', 'second');
    const { rows, turn, state } = setup(b); const group = find(rows, 'group');
    expect(groupInput({ ...group, expanded: true }, turn, state.pending)?.props.isExpanded).toBe(true);
    expect(groupInput({ ...group, expanded: false }, turn, state.pending)?.props.isExpanded).toBe(false);
    expect(groupInput(group, turn, state.pending, group.id)).toBeNull();
    expect(groupInput(group, turn, state.pending, group.cells[1].id)).toBeNull();
    const asked = groupInput(group, turn, state.pending, 'cell:elsewhere' as never);
    expect(asked?.instanceId).toBe('group:r1');
    expect(asked?.props.calls.map((call) => call.tool_use_id)).toEqual(['r1', 'r2']);
  });

  it('retains newest calls within the character budget, retrying without output', () => {
    const b = builder(); b.turn('u');
    b.toolUse('old', 'Bash', { command: 'old', values: Array(5).fill('x'.repeat(60_000)) }); b.result('old', 'old');
    b.toolUse('large', 'Bash', { command: 'large' }); b.result('large', 'large', { structured: Array(5).fill('z'.repeat(60_000)) });
    b.toolUse('new', 'Bash', { command: 'new' }); b.result('new', 'new');
    b.toolUse('running', 'Bash', { command: 'run' });
    const { rows, turn, state } = setup(b); const group = find(rows, 'group');
    const calls = groupInput(group, turn, state.pending)!.props.calls;
    expect(calls.map((c) => c.tool_use_id)).toEqual(['large', 'new', 'running']);
    expect(calls[0]).not.toHaveProperty('output'); expect(calls[1].output).toBe('new'); expect(calls[2]).not.toHaveProperty('output');
  });

  it('bounds deeply nested calls before walking them and drops only their oversized output when possible', () => {
    let deep: unknown = 'leaf'; for (let i = 0; i < 10_000; i += 1) deep = { nested: deep };
    const b = builder(); b.turn('u');
    b.toolUse('bad-input', 'Bash', { command: 'deep', nested: deep }); b.result('bad-input', 'ok');
    b.toolUse('bad-output', 'Bash', { command: 'kept' }); b.result('bad-output', 'output', { structured: deep });
    const { rows, turn, state } = setup(b);
    expect(groupInput(find(rows, 'group'), turn, state.pending)?.props.calls).toEqual([{ tool_use_id: 'bad-output', tool: 'Bash', input: { command: 'kept' }, isRunning: false, isErrored: false, isInterrupted: false }]);
  });

  it('applies tool rewrites only to the native drawing without changing the model', () => {
    const b = builder(); b.turn('u'); b.toolUse('t', 'Bash', { command: 'original' }); b.result('t', 'old', { structured: BASH_RESULT('old') }); b.end(['u']);
    const { rows, turn } = setup(b); const row = find(rows, 'cell'); const input = toolInputs(row, turn)[0];
    const rewritten = withToolProps(input, { ...input.props, input: { command: 'shown' }, output: BASH_RESULT('replacement') });
    expect(rewritten.detail).toMatchObject({ command: 'shown', stdout: 'replacement' });
    expect(row.detail).toMatchObject({ command: 'original', stdout: 'old' });
    expect(b.events.find((e) => e.kind === 'tool.use')).toMatchObject({ input: { command: 'original' } });
  });

  it.each([
    { isRunning: true, isErrored: false, isInterrupted: false, status: 'running', label: 'Running make shown', exitCode: null },
    { isRunning: false, isErrored: true, isInterrupted: false, status: 'error', label: 'Failed make shown old', exitCode: null },
    // UX wave U2 (decision 23, R2; the revision's point 13): the stopped form goes by the status, so by a drawn one too; M3: the
    // row reads the rewritten command's short form, and a failed call's reason after it
    { isRunning: false, isErrored: false, isInterrupted: true, status: 'stopped', label: 'Stopped: make shown', exitCode: null },
  ])('derives the native label and detail from rewritten $status, not the recorded completion', (flags) => {
    const b = builder(); b.turn('u'); b.toolUse('t', 'Bash', { command: 'original' }); b.result('t', 'old'); b.end(['u']);
    const { rows, turn } = setup(b); const row = find(rows, 'cell'); const input = toolInputs(row, turn)[0];
    const props = parseTranscriptProps('ToolUse', { ...input.props, input: { command: 'make shown' }, isRunning: flags.isRunning, isErrored: flags.isErrored, isInterrupted: flags.isInterrupted }, input.props)!;
    expect(props).not.toBeNull();
    const drawn = withToolProps(input, props);
    expect(drawn).toMatchObject({ status: flags.status, detail: { command: 'make shown', stdout: 'old', exitCode: flags.exitCode } });
    const { container } = renderRow({ ...row, ...drawn, id: row.id, expanded: true });
    expect(container.querySelector('[data-cell-id]')?.getAttribute('data-status')).toBe(flags.status);
    expect(container.querySelector('.transcript-cell-label')?.textContent).toBe(flags.label);
    expect(drawn.classification).toBe(row.classification);
    expect(row.status).toBe('done');
  });

  it.each([undefined, null, '', false, 0, { replacement: 'new' }, [null, 'new'], [{ type: 'text', text: 'new' }]].map((output) => ({ output })))('replaces output $output without leaking historical text or its spill loader', ({ output }) => {
    const b = builder(); b.turn('u'); b.toolUse('t', 'Bash', { command: 'original' });
    b.result('t', 'HISTORICAL SECRET', { structured: BASH_RESULT('HISTORICAL SECRET'), spillPath: '/old-output' }); b.end(['u']);
    const { rows, turn } = setup(b); const row = find(rows, 'cell'); const input = toolInputs(row, turn)[0];
    const props = parseTranscriptProps('ToolUse', { ...input.props, output }, input.props)!;
    expect(props).not.toBeNull();
    const drawn = withToolProps(input, props);
    const { container } = renderRow({ ...row, ...drawn, id: row.id, expanded: true });
    expect(container.textContent).not.toContain('HISTORICAL SECRET');
    expect(drawn.detail).toMatchObject({ spill: null });
    const text = container.querySelector('pre')?.textContent ?? '';
    if (output === null || output === undefined || output === '') expect(text).toBe('');
    else expect(text).toContain(typeof output === 'object' ? 'new' : String(output));
    expect(input.record.result).toMatchObject({ content: 'HISTORICAL SECRET', spillPath: '/old-output' });
  });

  it('uses rewritten output and completion for a call without a recorded result', () => {
    const b = builder(); b.turn('u'); b.toolUse('t', 'Bash', { command: 'original' });
    const { rows, turn } = setup(b); const row = find(rows, 'group'); const input = toolInputs(row.cells[0], turn)[0];
    const drawn = withToolProps(input, { ...input.props, input: { command: 'shown' }, isRunning: false, output: BASH_RESULT('new') });
    expect(drawn).toMatchObject({ status: 'done', detail: { command: 'shown', stdout: 'new', exitCode: 0 } });
    expect(drawn.label).toMatch(/^Ran `shown`/);
    expect(input.record.result).toBeNull();
    expect(row.cells[0].status).toBe('running');
  });

  it('keeps denial identity but redraws its reason, and can display a rewritten successful status', () => {
    const b = builder(); b.turn('u'); b.toolUse('t', 'Bash', { command: 'original' });
    b.result('t', 'old reason', { isError: true, denial: 'permission-rule' }); b.end(['u']);
    const { rows, turn } = setup(b); const row = find(rows, 'cell'); const input = toolInputs(row, turn)[0];
    const denied = withToolProps(input, { ...input.props, input: { command: 'shown' }, output: 'new reason' });
    expect(denied.status).toBe('denied');
    expect(denied.label).toBe('Denied: `shown` · new reason');
    expect(denied.detail).toMatchObject({ stdout: 'new reason' });
    const { container } = renderRow({ ...row, ...denied, id: row.id, expanded: true });
    expect(container.querySelector('.transcript-cell-detail')?.textContent).toContain('new reason');
    expect(container.textContent).not.toContain('old reason');
    expect(denied.classification).toBe(row.classification);
    const done = withToolProps(input, { ...input.props, isErrored: false, output: 'allowed now' });
    expect(done).toMatchObject({ status: 'done', detail: { stdout: 'allowed now', exitCode: 0 } });
    expect(done.label).toMatch(/^Ran /);
    expect(done.classification).toBe(row.classification);
    expect(row.label).toContain('old reason');
  });

  it('preserves the native text/structured pair for unchanged output after a wire round trip', () => {
    const b = builder(); b.turn('u'); b.toolUse('t', 'Read', { file_path: '/old' });
    b.result('t', 'file text', { structured: { file: { content: 'file text', numLines: 1 } } }); b.end(['u']);
    const { rows, turn } = setup(b); const row = find(rows, 'cell'); const input = toolInputs(row, turn)[0];
    const props = JSON.parse(JSON.stringify({ ...input.props, input: { file_path: '/shown' } }));
    const drawn = withToolProps(input, props);
    expect(drawn.detail).toMatchObject({ kind: 'read', files: [{ path: '/shown' }], preview: 'file text' });
    const { container } = renderRow({ ...row, ...drawn, id: row.id, expanded: true });
    expect(container.querySelector('pre')?.textContent).toBe('file text');
  });

  it('rewrites the native tool kind and its input/output without reclassifying the stored row', () => {
    const b = builder(); b.turn('u'); b.toolUse('t', 'Bash', { command: 'original' }); b.result('t', 'old'); b.end(['u']);
    const { rows, turn } = setup(b); const row = find(rows, 'cell'); const input = toolInputs(row, turn)[0];
    const before = structuredClone(b.events);
    const drawn = withToolProps(input, { ...input.props, tool: 'Read', input: { file_path: '/shown', offset: 2, limit: 3 }, output: 'new file text' });
    expect(drawn).toMatchObject({ toolName: 'Read', paths: ['/shown'], detail: { kind: 'read', files: [{ path: '/shown', range: [2, 4] }], preview: 'new file text' } });
    const { container } = renderRow({ ...row, ...drawn, id: row.id, expanded: true });
    expect(container.querySelector('.transcript-cell-label')?.textContent).toBe('Read shown');
    expect(container.querySelector('pre')?.textContent).toBe('new file text');
    expect(drawn.classification).toBe(row.classification);
    expect(b.events).toEqual(before);
  });

  it('draws a rewritten error output even when the generic tool has no recorded result', () => {
    const b = builder(); b.turn('u'); b.toolUse('t', 'OtherTool', { value: 'old' }); b.end(['u']);
    const { rows, turn } = setup(b); const row = find(rows, 'cell'); const input = toolInputs(row, turn)[0];
    const drawn = withToolProps(input, { ...input.props, input: { value: 'shown' }, isRunning: false, isInterrupted: false, isErrored: true, output: [{ type: 'text', text: 'new error' }] });
    const { container } = renderRow({ ...row, ...drawn, id: row.id, expanded: true });
    expect(container.querySelector('[data-error]')?.textContent).toContain('new error');
    expect(container.querySelector('[data-error]')?.textContent).toContain('shown');
    expect(input.record.result).toBeNull();
    expect(row.status).toBe('stopped');
  });

  it.each((['loaded', 'loading'] as const).flatMap((state) => (['passthrough', 'input', 'output'] as const).map((rewrite) => ({ state, rewrite }))))('keeps $state spill state through $rewrite rendering, unless output changes', ({ state: loadState, rewrite }) => {
    const b = builder(); b.turn('u'); b.toolUse('t', 'Bash', { command: 'original' });
    b.result('t', 'wire preview', { structured: BASH_RESULT('wire preview'), spillPath: '/spilled-output' }); b.end(['u']);
    const state = applyEvents(createState(null, null), b.events); const turn = [...state.turns.values()][0];
    const loaded = withAllExpanded(withReaderState(state, { spills: new Map([['/spilled-output', { state: loadState, content: loadState === 'loaded' ? 'complete loaded output' : null, error: null }]]) }));
    const row = find(rowsOf(loaded), 'cell'); const input = toolInputs(row, turn)[0];
    const wireProps = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(input.props).reverse())));
    const props = rewrite === 'input' ? { ...wireProps, input: { command: 'make shown' }, isInterrupted: true }
      : rewrite === 'output' ? { ...wireProps, output: 'replacement' } : wireProps;
    const drawn = withToolProps(input, props);
    const { container, queryByRole } = renderRow({ ...row, ...drawn, id: row.id, expanded: true });
    expect(queryByRole('button', { name: /Load full result/ })).toBeNull();
    if (rewrite === 'output') {
      expect(container.querySelector('pre')?.textContent).toBe('replacement');
      expect(drawn.detail).toMatchObject({ spill: null });
    } else {
      expect(drawn.detail).toMatchObject({ spill: { state: loadState } });
      if (loadState === 'loaded') expect(container.querySelector('pre')?.textContent).toBe('complete loaded output');
      else expect(queryByRole('status')).not.toBeNull();
      if (rewrite === 'input') expect(container.querySelector('.transcript-cell-label')?.textContent).toMatch(/^Stopped: make shown/); // UX wave U2 (R2): the stopped form
      else expect(drawn).toBe(row);
    }
    expect(row.detail).toMatchObject({ spill: { state: loadState } });
  });

  it('builds command output props from the preceding command echo, not arbitrary text', () => {
    const b = builder(); b.turn('u', '/model haiku');
    b.emit('user.message', { messageUuid: uuid('out'), content: 'Set model', isReplay: true, isSynthetic: false, origin: 'local-command', bash: null });
    const { rows, state } = setup(b); const row = find(rows, 'local_command');
    expect(commandInput(row, state)).toEqual({ instanceId: 'out', props: { command: 'model', args: 'haiku', text: 'Set model', isErrored: false } });
  });
});

// UX wave U3, first landing (docs/doperpowers/plans/2026-11-12-ux-wave-U3a-arrivals.md, M5 and decision 15; Acceptance
// 8): a row of what entered the session asks the engine's UserMessage site where the engine's own transcript draws its
// carrier through it, with the props the engine gives there (cli.pretty.js of 2.1.322: `useUserMessageSite` and its
// callers), and a message the agent sent asks ToolUse with its call's props. The carriers written by hand are invented,
// in the shapes the probes recorded (u3-sminos-r1-maws seq 100, u3-tasks-r1 seq 337 and 578).
describe('the rows of what entered the session ask the engine’s sites', () => {
  const closed = { revealed: undefined, expanded: false };
  const INBOX = 'Another Claude session sent a message:\n<cross-session-message from-name="docs">\n[sminos message from docs id=m1]\nthe index is stale\n</cross-session-message>\n\nThis came from another Claude session, not typed by your user.';
  const TASK = '<task-notification>\n<task-id>bt1</task-id>\n<tool-use-id>tu-bt1</tool-use-id>\n<output-file>/tmp/work/bt1.output</output-file>\n<status>failed</status>\n<summary>Background command "count files" failed with exit code 1</summary>\n</task-notification>';
  const taskEntry = (over: Record<string, unknown> = {}): ArrivalEntry => ({ class: 'task', taskId: 'bt1', toolUseId: 'tu-bt1', runId: 'run-1', outcome: 'failed', summary: 'Background command "count files" failed with exit code 1', durationMs: null, outputFile: '/tmp/work/bt1.output', detail: null, ...over } as ArrivalEntry);
  const peerTurn = (content: string, text = 'the index is stale') => {
    const b = builder();
    b.emit('turn.started', { userMessageUuid: null, origin: 'peer' });
    b.emit('user.message', { messageUuid: uuid('p1'), content, isReplay: true, isSynthetic: true, origin: 'peer', bash: null });
    b.emit('peer.message', { messageUuid: uuid('p1'), from: '', fromSession: null, fromName: 'docs', fromMode: null, fromPlugin: null, hopChain: [], text, midTurn: false, lineage: 'peer', replyable: false });
    return setup(b);
  };
  const noticeTurn = (content: string, arrival: ArrivalEntry[], origin = 'task-notification') => {
    const b = builder();
    b.emit('turn.started', { userMessageUuid: null, origin: 'engine' });
    b.emit('user.message', { messageUuid: uuid('n1'), content, isReplay: true, isSynthetic: true, origin, bash: null, arrival });
    return setup(b);
  };
  const valid = (input: ReturnType<typeof arrivalInput>) => input !== null && parseTranscriptProps('UserMessage', input.props, input.props) !== null;

  it('a message from another session asks as the engine’s cross-session message does: the text inside the envelope whole, the sender by its speaker label', () => {
    const { rows, turn } = peerTurn(INBOX);
    const row = find(rows, 'agent_message');
    const input = arrivalInput(row, turn, closed);
    expect(input).toEqual({ instanceId: 'p1', props: { text: '[sminos message from docs id=m1]\nthe index is stale', origin: { kind: 'peer' }, isExpanded: false, from: { name: 'docs' } } });
    expect(valid(input)).toBe(true);
    expect(arrivalInput(row, turn, { ...closed, expanded: true })?.props.isExpanded).toBe(true); // the line opened, as ctrl+o expands the engine's
    expect(arrivalInput(row, turn, { ...closed, revealed: row.id })).toBeNull(); // a jump's target is MAWS's to draw (Interfaces, F)
    expect(arrivalInput(row, undefined, closed)).toBeNull();
    // the bare envelope of a delivery taken into a running turn (u3-sminos-r1-maws seq 387) reads the same
    const busy = peerTurn('<cross-session-message from-name="docs">\nthe index is stale\n</cross-session-message>');
    expect(arrivalInput(find(busy.rows, 'agent_message'), busy.turn, closed)?.props.text).toBe('the index is stale');
  });

  it('a delivery whose carrier holds no envelope of the engine’s asks none: the engine draws it under an origin the event does not keep, or not at all', () => {
    const submitted = peerTurn('[sminos message from docs id=m1]\nthe index is stale'); // the bridge's row submitted as the user, or a background session's prompt
    expect(arrivalInput(find(submitted.rows, 'agent_message'), submitted.turn, closed)).toBeNull();
  });

  it('a subagent’s hand-back asks as the engine’s message from an agent does: the report, the agent by name', () => {
    const b = builder();
    b.turn('u');
    const report = '<agent-message from="ag1">\n[Subagent hand-back] The text below is the final report of a subagent this session delegated to. The report follows:\n  All three files read.\n  None was empty.\n</agent-message>';
    b.emit('user.message', { messageUuid: uuid('h1'), content: `Another Claude session sent a message:\n${report}`, isReplay: true, isSynthetic: true, origin: 'peer', bash: null });
    const body = report.slice(report.indexOf('\n') + 1, report.lastIndexOf('\n'));
    b.emit('subagent.message', { direction: 'from_child', fromAgentId: 'ag1' as never, toAgentId: null, text: body });
    b.emit('user.message', { messageUuid: uuid('h2'), content: '<agent-message from="ag1">\nSecond thoughts: one file is missing.\n</agent-message>', isReplay: true, isSynthetic: true, origin: 'peer', bash: null });
    b.emit('subagent.message', { direction: 'from_child', fromAgentId: 'ag1' as never, toAgentId: null, text: 'Second thoughts: one file is missing.' });
    const { rows, turn } = setup(b);
    const [handback, message] = rows.filter((r): r is Extract<Row, { kind: 'agent_message' }> => r.kind === 'agent_message');
    const input = arrivalInput(handback!, turn, closed);
    expect(input).toEqual({ instanceId: 'h1', props: { text: 'All three files read.\nNone was empty.', origin: { kind: 'peer' }, isExpanded: false, from: { name: 'ag1' } } });
    expect(valid(input)).toBe(true);
    expect(arrivalInput(message!, turn, closed)).toEqual({ instanceId: 'h2', props: { text: 'Second thoughts: one file is missing.', origin: { kind: 'peer' }, isExpanded: false, from: { name: 'ag1' } } });
  });

  it('a task’s end from a replayed frame or a row asks as the engine’s task notification does: its <summary>, the task’s fields', () => {
    const { rows, turn } = noticeTurn(TASK, [taskEntry()]);
    const input = arrivalInput(find(rows, 'notice'), turn, closed);
    expect(input).toEqual({ instanceId: 'n1', props: { text: 'Background command "count files" failed with exit code 1', origin: { kind: 'task-notification' }, isExpanded: false, task: { id: 'bt1', status: 'failed', toolUseId: 'tu-bt1' } } });
    expect(valid(input)).toBe(true);
    const agent = noticeTurn('<task-notification>\n<task-id>ag1</task-id>\n<task-type>local_agent</task-type>\n<status>completed</status>\n<summary>Agent &quot;Survey&quot; &lt;notes&gt; finished</summary>\n<usage><duration_ms>65000</duration_ms></usage>\n</task-notification>', [taskEntry({ taskId: 'ag1', toolUseId: null, runId: null, outcome: 'completed', summary: 'Agent "Survey" <notes> finished', durationMs: 65000, outputFile: null })]);
    expect(arrivalInput(find(agent.rows, 'notice'), agent.turn, closed)?.props).toEqual({ text: 'Agent &quot;Survey&quot; <notes> finished', origin: { kind: 'task-notification' }, isExpanded: false, task: { id: 'ag1', status: 'completed', type: 'local_agent', durationMs: 65000 } });
  });

  it('a carrier of two blocks is one site, its first block’s, asked by its first line and followed by the other, unless a jump revealed the first', () => {
    const second = TASK.replace(/bt1/g, 'bt2').replace('failed with exit code 1', 'completed (exit code 0)').replace('<status>failed', '<status>completed');
    const { rows, turn } = noticeTurn(`${TASK}\n\n${second}`, [taskEntry({ runId: null }), taskEntry({ taskId: 'bt2', toolUseId: 'tu-bt2', runId: null, outcome: 'completed', summary: 'Background command "count files" completed (exit code 0)' })]);
    const notices = rows.filter((r): r is Extract<Row, { kind: 'notice' }> => r.kind === 'notice');
    expect(notices).toHaveLength(2);
    const [first, next] = notices.map((row) => arrivalInput(row, turn, closed));
    expect(next).toBeNull();
    expect(first?.props.text).toBe('Background command "count files" failed with exit code 1');
    expect(notices.map((row) => noticeFollows(row, turn, undefined))).toEqual([null, first!.instanceId]);
    // the revealed first asks nothing and follows nothing; the second then asks for the carrier, with the same props
    expect(notices.map((row) => noticeFollows(row, turn, notices[0]!.id))).toEqual([null, null]);
    expect(notices.map((row) => arrivalInput(row, turn, { ...closed, revealed: notices[0]!.id }))).toEqual([null, first]);
  });

  it('a line the engine’s transcript draws through no UserMessage asks none: what the host made, a block with no <summary>, a scheduled fire, an answer by a hook’s context, the bridge’s wake as its prompt', () => {
    const cases: [string, ArrivalEntry[]][] = [
      ['', [taskEntry()]], // told while idle: the host made the event, and there is no text to give the site
      ['<task-notification>\n<task-id>bt1</task-id>\n<status>completed</status>\n</task-notification>', [taskEntry({ summary: '<task-id>bt1</task-id>' })]],
      ['<task-notification>\n<tool-use-id>tu-r1</tool-use-id>\n<task-type>tool_call</task-type>\n<summary>A result arrived late</summary>\n</task-notification>', [taskEntry({ summary: 'A result arrived late' })]], // drawn as the call's late result
      ['<task-notification>\n<task-type>artifact-room-view</task-type>\n<summary>A room was viewed</summary>\n</task-notification>', [taskEntry({ summary: 'A room was viewed' })]], // drawn as nothing
      ['UXW tick: reply with only the word TOCK.', [{ class: 'schedule', prompt: 'UXW tick: reply with only the word TOCK.' }]], // a meta row: the engine draws the fire's system row instead
      ['The human responded to your async AskUserQuestion (call tu-q1): Mango', [{ class: 'answer', tool: 'sminos', call: 'tu-q1', summary: 'Mango', answers: null, dismissed: false }]], // drawn as no message at all
      ['[sminos bridge]\nRead the message you have not read.', [{ class: 'wake' }]], // the bridge's prompt as the user: a plain prompt under the plugin's origin, which the event does not keep
    ];
    for (const [content, arrival] of cases) {
      const { rows, turn } = noticeTurn(content, arrival);
      expect(arrivalInput(find(rows, 'notice'), turn, closed), content).toBeNull();
    }
  });

  it('the bridge’s wake through the inbox asks as the cross-session message it is', () => {
    const { rows, turn } = noticeTurn('Another Claude session sent a message:\n<cross-session-message from-name="sminos">\n[sminos bridge]\nRead the message you have not read.\n</cross-session-message>', [{ class: 'wake' }]);
    expect(arrivalInput(find(rows, 'notice'), turn, closed)?.props).toEqual({ text: '[sminos bridge]\nRead the message you have not read.', origin: { kind: 'peer' }, isExpanded: false, from: { name: 'sminos' } });
  });

  it('a message the agent sent asks ToolUse with its call’s props, as a cell’s call asks', () => {
    const b = builder();
    b.turn('u');
    b.toolUse('sm1', 'SendMessage', { to: 'uds:/tmp/socks/docs.sock', message: 'the index is fixed' });
    b.result('sm1', '{"success":true}');
    const { rows, turn } = setup(b);
    const row = find(rows, 'agent_message');
    expect(sentInput(row, turn, undefined)).toEqual({ instanceId: 'sm1', props: { tool_use_id: 'sm1', tool: 'SendMessage', input: { to: 'uds:/tmp/socks/docs.sock', message: 'the index is fixed' }, isRunning: false, isErrored: false, isInterrupted: false, output: '{"success":true}' } });
    expect(sentInput(row, turn, row.id)).toBeNull();
    expect(arrivalInput(row, turn, closed)).toBeNull(); // a send is no arrival
    const inbound = peerTurn(INBOX);
    expect(sentInput(find(inbound.rows, 'agent_message'), inbound.turn, undefined)).toBeNull();
    const running = builder();
    running.turn('u');
    running.toolUse('sm2', 'SendMessage', { to: 'main', message: 'halfway there' });
    const open = setup(running);
    expect(sentInput(find(open.rows, 'agent_message'), open.turn, undefined)).toEqual({ instanceId: 'sm2', props: { tool_use_id: 'sm2', tool: 'SendMessage', input: { to: 'main', message: 'halfway there' }, isRunning: true, isErrored: false, isInterrupted: false } });
  });

  it('over the recorded sessions, each arrival row asks with the props of the engine’s drawing of its carrier, and a line the host made asks none', () => {
    const drawn = (name: string) => {
      const state = withAllExpanded(applyEvents(createState(null, null), journalToEvents(loadUxwaveJournal(name))));
      return { state, rows: rowsOf(state) };
    };
    const ask = (state: ReturnType<typeof drawn>['state'], row: Extract<Row, { kind: 'agent_message' | 'notice' }>) => arrivalInput(row, row.turnId === null ? undefined : state.turns.get(row.turnId), closed);

    const sminos = drawn('u3-sminos-r1-maws');
    const peers = sminos.rows.filter((r): r is Extract<Row, { kind: 'agent_message' }> => r.kind === 'agent_message' && r.peer?.sender != null);
    expect(peers).toHaveLength(2); // the peer's two sends, idle (seq 100) and taken into a running turn (seq 387); the owner's are the person's
    for (const row of peers) {
      const input = ask(sminos.state, row);
      expect(input?.props).toMatchObject({ origin: { kind: 'peer' }, from: { name: 'session:7ef6ac00' } });
      expect(input?.props.text).toMatch(/^\[sminos message from session:7ef6ac00 id=\w+\]\nUXW peer (idle|busy): [^\n]+\n\[To reply, run in Bash: [^\n]+\]$/); // the frame and reply lines the line cuts, which the engine's text keeps
      expect(input?.instanceId).toBe(row.peer!.messageUuid);
      expect(valid(input)).toBe(true);
    }

    const tasks = drawn('u3-tasks-r1');
    const notices = tasks.rows.filter((r): r is Extract<Row, { kind: 'notice' }> => r.kind === 'notice');
    const byText = (text: string) => notices.filter((row) => row.text === text).map((row) => ask(tasks.state, row));
    expect(byText('Background command "uxw ok" completed (exit code 0)')).toEqual([null]); // told while idle: the host made it
    const replayed = byText('Background command "uxw busy fail" failed with exit code 1'); // the replayed frame at seq 578
    expect(replayed).toHaveLength(1);
    expect(replayed[0]?.props).toMatchObject({ text: 'Background command "uxw busy fail" failed with exit code 1', origin: { kind: 'task-notification' }, task: { id: 'bzhlugr58', status: 'failed' } });
    expect(replayed[0]?.props.task?.toolUseId).toMatch(/^toolu_/);
    const reports = tasks.rows.filter((r): r is Extract<Row, { kind: 'agent_message' }> => r.kind === 'agent_message' && r.report !== undefined);
    expect(reports.map((row) => ask(tasks.state, row)?.props.text)).toEqual(['PONG', 'PONG3']); // the hand-backs at seq 337 and 666
    for (const row of reports) expect(ask(tasks.state, row)?.props.from).toEqual({ name: 'general-purpose' }); // the agent's type, which the engine names it by (its origin's `name`)
  });

  // The whole-branch review's finding 5: the drawing owner of a carrier is elected among the notices the fold keeps, so a
  // drawn notice never follows an owner that is not mounted
  it('a closed turn whose carrier’s first notice the fold drops: the notice it keeps owns the carrier’s ask', () => {
    const b = builder();
    b.emit('turn.started', { userMessageUuid: null, origin: 'engine' });
    const event = '<task-notification>\n<task-id>bt0</task-id>\n<summary>Monitor "watch logs" event: a line arrived</summary>\n</task-notification>';
    b.emit('user.message', { messageUuid: uuid('n1'), content: `${event}\n${TASK}`, isReplay: true, isSynthetic: true, origin: 'task-notification', bash: null, arrival: [taskEntry({ taskId: 'bt0', runId: null, outcome: null, summary: 'Monitor "watch logs" event: a line arrived' }), taskEntry({ runId: null })] });
    b.text('m1', 0, 'Noted.');
    b.end([], { origin: 'task-notification', numTurns: 1 });
    const state = applyEvents(createState(null, null), b.events);
    const kept = rowsOf(state).filter((r): r is Extract<Row, { kind: 'notice' }> => r.kind === 'notice');
    expect(kept.map((row) => row.outcome)).toEqual(['failed']); // the monitor's event folded with its turn
    const turn = state.turns.get(kept[0]!.turnId!)!;
    const drawn = turnRows(state, turn.id);
    expect(noticeFollows(kept[0]!, turn, undefined, drawn)).toBeNull();
    expect(arrivalInput(kept[0]!, turn, { ...closed, drawn })).toMatchObject({ instanceId: 'n1', props: { origin: { kind: 'task-notification' } } });
    // opened, both are drawn (the end above the divider, the event under it): the carrier's first asks again and the
    // kept one follows it
    const open = turnRows(withAllExpanded(state), turn.id);
    const both = open!.filter((r): r is Extract<Row, { kind: 'notice' }> => r.kind === 'notice');
    expect(both.map((row) => [row.outcome, noticeFollows(row, turn, undefined, open)])).toEqual([['failed', 'n1'], [null, null]]);
  });

  // The whole-branch review's finding 6: the notice-to-carrier index is built once per turn's event list and read by every
  // row; an update that leaves a turn's list untouched builds nothing for it (counted, not timed)
  it('builds a turn’s notice index once for all its rows, and not again on an update that leaves its events untouched', () => {
    const b = builder();
    b.emit('turn.started', { userMessageUuid: null, origin: 'engine' });
    for (let n = 0; n < 40; n++) b.emit('user.message', { messageUuid: uuid(`n${n}`), content: '', isReplay: false, isSynthetic: true, origin: 'task-notification', bash: null, arrival: [taskEntry({ taskId: `bt${n}`, runId: `run-${n}` })] });
    b.end([], { origin: 'task-notification', numTurns: 1 });
    b.turn('u2', 'and the next one?');
    let state = applyEvents(createState(null, null), b.events);
    const notices = rowsOf(withAllExpanded(state)).filter((r): r is Extract<Row, { kind: 'notice' }> => r.kind === 'notice');
    expect(notices).toHaveLength(40);
    const turn = state.turns.get(notices[0]!.turnId!)!;
    const askAll = (of: typeof turn) => { for (const row of notices) { arrivalInput(row, of, closed); noticeFollows(row, of, undefined); } };
    const before = noticeIndexBuilds();
    askAll(turn);
    askAll(turn);
    expect(noticeIndexBuilds() - before).toBe(1);
    const from = b.events.length;
    b.text('m2', 0, 'Streaming on in the next turn.');
    state = applyEvents(state, b.events.slice(from));
    const untouched = state.turns.get(turn.id)!;
    expect(untouched.events).toBe(turn.events);
    askAll(untouched);
    expect(noticeIndexBuilds() - before).toBe(1);
  });
});

// UX wave U3, first landing (the U3a document, Interfaces F, as the controller ruled on M5): the target of the tab's
// last jump asks no mod's site and is drawn by MAWS, whatever asks it; its neighbour asks as before.
describe('a jump’s revealed target asks no site', () => {
  const QUESTIONS = [{ question: 'Which fruit?', header: 'Fruit', options: [{ label: 'Apple', description: null, preview: null }, { label: 'Mango', description: null, preview: null }], multiSelect: false }];

  it('the user row, the answer, the call and the command output it names ask nothing, and the rows beside them ask', () => {
    const b = builder();
    b.turn('u1', '/model haiku');
    b.emit('user.message', { messageUuid: uuid('out1'), content: 'Set model to haiku', isReplay: true, isSynthetic: false, origin: 'local-command', bash: null });
    b.end(['u1']);
    b.turn('u2');
    b.text('a', 0, 'First part');
    b.toolUse('t1', 'Bash', { command: 'ls' });
    b.result('t1', 'a', { structured: BASH_RESULT('a') });
    b.toolUse('t2', 'Bash', { command: 'pwd' });
    b.result('t2', 'b', { structured: BASH_RESULT('b') });
    b.text('c', 0, 'Second part');
    b.end(['u2']);
    b.turn('u3', '/model opus');
    b.emit('user.message', { messageUuid: uuid('out3'), content: 'Set model to opus', isReplay: true, isSynthetic: false, origin: 'local-command', bash: null });
    b.end(['u3']);
    const state = withAllExpanded(applyEvents(createState(null, null), b.events));
    const rows = rowsOf(state);
    const turnOf = (row: Row) => state.turns.get(row.turnId!);
    const of = <K extends Row['kind']>(kind: K) => rows.filter((r): r is Extract<Row, { kind: K }> => r.kind === kind);

    const [user, beside] = of('user');
    expect(userInput(user!, turnOf(user!), user!.id)).toBeNull();
    expect(userInput(beside!, turnOf(beside!), user!.id)).not.toBeNull();

    const [first, second] = of('assistant_text');
    expect(assistantInput(first!, turnOf(first!), first!.id)).toBeNull();
    expect(assistantInput(second!, turnOf(second!), first!.id)).not.toBeNull();

    const group = find(rows, 'group');
    const [t1, t2] = group.cells;
    expect(toolInputs(t2!, turnOf(group), t2!.id)).toEqual([]); // a cell jump's target
    expect(toolInputs(t1!, turnOf(group), t2!.id).map((input) => input.instanceId)).toEqual(['t1']);

    const [command, next] = of('local_command');
    expect(commandInput(command!, state, command!.id)).toBeNull();
    expect(commandInput(next!, state, command!.id)).not.toBeNull();
  });

  it('the question it names asks nothing, and the question beside it asks', () => {
    const b = builder();
    b.turn('u');
    b.toolUse('q1', 'AskUserQuestion', { questions: QUESTIONS });
    b.toolUse('q2', 'AskUserQuestion', { questions: QUESTIONS }, 'msg-q2');
    const { turn } = setup(b);
    const question = (id: string): Extract<Row, { kind: 'question' }> => ({ id: `question:${id}` as never, turnId: turn.id, at: turn.startedAt, kind: 'question', toolUseId: tool(id), questions: QUESTIONS, answers: null, error: null });
    expect(questionInput(question('q1'), turn, question('q1').id)).toBeNull();
    expect(questionInput(question('q2'), turn, question('q1').id)?.instanceId).toBe('q2');
  });
});
