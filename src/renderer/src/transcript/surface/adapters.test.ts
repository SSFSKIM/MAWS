import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parseTranscriptProps } from '@shared/engine/surface-rows';
import { renderRow } from '../view/rows/test-support';
import { rowsOf, withAllExpanded } from '../model/derive';
import { applyEvents, createState, withReaderState } from '../model/reduce';
import type { Row } from '../model/rows';
import { BASH_RESULT, builder, api, tool, uuid } from '../model/test-events';
import { assistantInput, commandInput, groupInput, toolInputs, userInput, withToolProps } from './adapters';

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

  it('keeps raw tool input and structured output, not the compact label, and unfolds merged reads into individual calls', () => {
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
    expect(toolInputs(group.cells[0], turn).map((c) => c.props.tool_use_id)).toEqual(['r1', 'r2']);
    expect(calls.props).not.toHaveProperty('onScreen');
  });

  it('does not resurrect a retracted call between members of a merged read', () => {
    const b = builder(); b.turn('u');
    for (const id of ['r1', 'removed', 'r3']) { b.toolUse(id, 'Read', { file_path: `/${id}` }); b.result(id, id); }
    b.emit('boundary.retraction', { retractedMessageUuids: [uuid('msg-removed-u0')], reason: 'fallback', fallbackModel: null });
    const { rows, turn } = setup(b);
    const cell = find(rows, 'cell');
    expect(toolInputs(cell, turn).map((call) => call.instanceId)).toEqual(['r1', 'r3']);
  });

  it('withholds the group ask while a member needs approval', () => {
    const b = builder(); b.turn('u'); b.toolUse('bash', 'Bash', { command: 'pwd' });
    const { rows, turn } = setup(b); const row = find(rows, 'group');
    const pending = new Map([['r', { kind: 'permission.requested', toolUseId: tool('bash') }]]) as never;
    expect(groupInput(row, turn, pending)).toBeNull();
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
    { isRunning: true, isErrored: false, isInterrupted: false, status: 'running', label: 'Running', exitCode: null },
    { isRunning: false, isErrored: true, isInterrupted: false, status: 'error', label: 'Failed', exitCode: null },
    { isRunning: false, isErrored: false, isInterrupted: true, status: 'stopped', label: 'Stopped', exitCode: null },
  ])('derives the native label and detail from rewritten $status, not the recorded completion', (flags) => {
    const b = builder(); b.turn('u'); b.toolUse('t', 'Bash', { command: 'original' }); b.result('t', 'old'); b.end(['u']);
    const { rows, turn } = setup(b); const row = find(rows, 'cell'); const input = toolInputs(row, turn)[0];
    const props = parseTranscriptProps('ToolUse', { ...input.props, input: { command: 'shown' }, isRunning: flags.isRunning, isErrored: flags.isErrored, isInterrupted: flags.isInterrupted }, input.props)!;
    expect(props).not.toBeNull();
    const drawn = withToolProps(input, props);
    expect(drawn).toMatchObject({ status: flags.status, detail: { command: 'shown', stdout: 'old', exitCode: flags.exitCode } });
    const { container } = renderRow({ ...row, ...drawn, id: row.id, expanded: true });
    expect(container.querySelector('[data-cell-id]')?.getAttribute('data-status')).toBe(flags.status);
    expect(container.querySelector('.transcript-cell-label')?.textContent).toMatch(new RegExp(`^${flags.label} shown`));
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
    expect(container.querySelector('.transcript-cell-label')?.textContent).toBe('Read /shown');
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
    const props = rewrite === 'input' ? { ...wireProps, input: { command: 'shown' }, isInterrupted: true }
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
      if (rewrite === 'input') expect(container.querySelector('.transcript-cell-label')?.textContent).toMatch(/^Stopped shown/);
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
