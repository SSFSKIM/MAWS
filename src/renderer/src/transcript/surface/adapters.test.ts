import { describe, expect, it } from 'vitest';
import { rowsOf, withAllExpanded } from '../model/derive';
import { applyEvents, createState } from '../model/reduce';
import type { Row } from '../model/rows';
import { BASH_RESULT, builder, tool, uuid } from '../model/test-events';
import { assistantInput, commandInput, groupInput, toolInputs, userInput, withToolProps } from './adapters';

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

  it('builds command output props from the preceding command echo, not arbitrary text', () => {
    const b = builder(); b.turn('u', '/model haiku');
    b.emit('user.message', { messageUuid: uuid('out'), content: 'Set model', isReplay: true, isSynthetic: false, origin: 'local-command', bash: null });
    const { rows, state } = setup(b); const row = find(rows, 'local_command');
    expect(commandInput(row, state)).toEqual({ instanceId: 'out', props: { command: 'model', args: 'haiku', text: 'Set model', isErrored: false } });
  });
});
