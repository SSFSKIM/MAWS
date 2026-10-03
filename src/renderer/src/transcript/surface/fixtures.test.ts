// The same content the installed engine rendered is projected through X1 -> X3 -> R3. These fixtures carry raw
// input and structured results; a label-only adapter or normalized-question nulls would fail this boundary check.
import { describe, expect, it } from 'vitest';
import { nativeQuestionsOf, type TranscriptProps, type TranscriptSite } from '@shared/engine/surface-rows';
import { loadJournal } from '../../../../../test/support/fixtures';
import { rowsOf, withAllExpanded } from '../model/derive';
import { applyEvents, createState } from '../model/reduce';
import type { Row } from '../model/rows';
import { builder, tool, uuid } from '../model/test-events';
import { assistantInput, commandInput, groupInput, questionInput, resultInput, toolInputs, userInput } from './adapters';

function recorded<C extends TranscriptSite>(name: string, component: C): TranscriptProps[C] {
  for (const row of loadJournal('pass3', `mods-surface-transcript-${name}`)) {
    const frame = row.frame as { request?: { subtype?: string; component?: string; props: TranscriptProps[C] } };
    if (row.direction === 'out' && frame.request?.subtype === 'ui_render' && frame.request.component === component) return frame.request.props;
  }
  throw new Error(`No recorded ${component}`);
}
const setup = (b: ReturnType<typeof builder>) => {
  const state = withAllExpanded(applyEvents(createState(null, null), b.events));
  return { state, rows: rowsOf(state), turn: [...state.turns.values()][0] };
};
const first = <K extends Row['kind']>(rows: Row[], kind: K) => rows.find((r): r is Extract<Row, { kind: K }> => r.kind === kind)!;

describe('adapters against installed-engine transcript asks', () => {
  it('UserMessage preserves the SDK person-prompt shape', () => {
    const props = recorded('user-message', 'UserMessage'); const b = builder(); b.turn('u', props.text);
    const { rows, turn } = setup(b);
    expect(userInput(first(rows, 'user'), turn)?.props).toEqual(props);
  });
  it('AssistantMessage uses the first text block shape', () => {
    const props = recorded('assistant-message', 'AssistantMessage'); const b = builder(); b.turn('u'); b.text('a', 0, props.text);
    const { rows, turn } = setup(b);
    expect(assistantInput(first(rows, 'assistant_text'), turn)?.props).toEqual(props);
  });
  it('ToolUse and ToolResult preserve structured output and resolution', () => {
    const props = recorded('tool-use', 'ToolUse'); const b = builder(); b.turn('u'); b.toolUse(props.tool_use_id, props.tool, props.input as Record<string, unknown>);
    b.result(props.tool_use_id, 'R3', { structured: props.output }); b.end(['u']);
    const { rows, turn } = setup(b); const input = toolInputs(first(rows, 'cell'), turn)[0];
    expect(input.props).toEqual(props);
    expect(resultInput(input)?.props).toEqual(recorded('tool-result', 'ToolResult'));
    expect(resultInput({ ...input, props: { ...input.props, isRunning: true } })).toBeNull();
  });
  it('ToolGroup uses flattened member records with no display-row envelope', () => {
    const props = recorded('tool-group', 'ToolGroup'); const b = builder(); b.turn('u');
    for (const call of props.calls) { b.toolUse(call.tool_use_id!, call.tool, call.input as Record<string, unknown>); b.result(call.tool_use_id!, 'R3', { structured: call.output }); }
    const { rows, turn, state } = setup(b);
    expect(groupInput(first(rows, 'group'), turn, state.pending)?.props).toEqual(props);
  });
  it('CommandOutput associates the native output with its command echo', () => {
    const props = recorded('command-output', 'CommandOutput'); const b = builder(); b.turn('u', `/${props.command}${props.args ? ` ${props.args}` : ''}`);
    b.emit('user.message', { messageUuid: uuid('echo'), content: props.text, isReplay: true, isSynthetic: false, origin: 'local-command', bash: null });
    const { rows, state } = setup(b);
    expect(commandInput(first(rows, 'local_command'), state)?.props).toEqual(props);
  });
  it('AskUserQuestion reconstructs normalized choices without null optional fields', () => {
    const props = recorded('ask-user-question', 'AskUserQuestion'); const b = builder(); b.turn('u');
    b.toolUse('q', 'AskUserQuestion', { questions: props.questions });
    const { turn } = setup(b);
    const row: Extract<Row, { kind: 'question' }> = { id: 'question:q' as never, turnId: turn.id, at: turn.startedAt, kind: 'question', toolUseId: tool('q'), questions: nativeQuestionsOf(props.questions)!, answers: { 'Which path?': 'One' } };
    expect(questionInput(row, turn).props).toEqual(props);
  });
});
