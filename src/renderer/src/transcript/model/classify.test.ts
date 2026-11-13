import { describe, expect, it } from 'vitest';
import { classifyTool, continuedAfter, denialDisposition, presentationOf, type ClassifyContext } from './classify';
import { api, builder, MODEL, parent, tool, uuid } from './test-events';

const base: ClassifyContext = { denial: null, turn: { closed: false, stopped: false }, continued: false, humanDecision: false, safeguard: 'not_evaluated', imageResult: false, isError: false };

describe('classification table', () => {
  it.each([
    ['mcp__docs__search', 'mcp', 'grouped', false],
    ['Skill', 'skills', 'grouped', false],
    ['ToolSearch', 'skills', 'grouped', false],
    ['Read', 'exploration', 'grouped', false],
    ['Glob', 'exploration', 'grouped', false],
    ['LS', 'exploration', 'grouped', false],
    ['LSP', 'exploration', 'grouped', false],
    ['NotebookRead', 'exploration', 'grouped', false],
    ['Grep', 'exploration', 'grouped', false],
    ['Edit', 'files', 'grouped', false],
    ['MultiEdit', 'files', 'grouped', false],
    ['Write', 'files', 'grouped', false],
    ['NotebookEdit', 'files', 'grouped', false],
    ['Bash', 'commands', 'grouped', false],
    ['BashOutput', 'commands', 'grouped', false],
    ['KillShell', 'commands', 'grouped', false],
    ['Monitor', 'commands', 'grouped', false],
    ['WebFetch', 'web', 'grouped', false],
    ['WebSearch', 'web', 'grouped', false],
    ['EnterPlanMode', 'other', 'grouped', true],
    ['EnterWorktree', 'other', 'grouped', true],
    ['ExitWorktree', 'other', 'grouped', true],
    ['TodoWrite', 'other', 'grouped', true],
    ['TaskCreate', 'other', 'grouped', true],
    ['TaskUpdate', 'other', 'grouped', true],
    ['TaskList', 'other', 'grouped', true],
    ['TaskGet', 'other', 'grouped', true],
    ['TaskOutput', 'other', 'grouped', true],
    ['TaskStop', 'other', 'grouped', true],
    ['SomeFutureTool', 'other', 'grouped', false],
  ] as const)('%s → %s, %s%s', (name, category, presentation, hidden) => {
    const c = classifyTool(name, {}, base);
    expect(c.category).toBe(category);
    expect(c.groupable).toBe(presentation === 'grouped');
    expect(c.hidden).toBe(hidden);
    expect(c.subagentLifecycle).toBeNull();
    expect(c.denial).toBeNull();
  });

  // P3-B (M7)
  it.each(['artifact_edit', 'artifact_comments', 'artifact_reply', 'artifact_resolve'])('the document tool %s is a cell of its own, never folded into a group of MCP calls', (tool) => {
    const c = classifyTool(`mcp__maws__${tool}`, {}, base);
    expect([c.category, c.groupable, c.hidden]).toEqual(['other', false, false]);
    expect(presentationOf(`mcp__maws__${tool}`)).toBe('cell');
  });

  // P4-B4: the library search is a cell of its own, as the namespace's other readers (artifact_list, artifact_read) are
  it('artifact_search is a cell of its own, never folded into a group of MCP calls', () => {
    const c = classifyTool('mcp__maws__artifact_search', {}, base);
    expect([c.category, c.groupable, c.hidden]).toEqual(['other', false, false]);
    expect(presentationOf('mcp__maws__artifact_search')).toBe('cell');
  });

  it('routes the row-kind tools out of the cell table', () => {
    expect(presentationOf('Agent')).toBe('subagent');
    expect(presentationOf('Task')).toBe('subagent');
    expect(presentationOf('Workflow')).toBe('subagent');
    expect(presentationOf('SendMessage')).toBe('agent_message');
    expect(presentationOf('AskUserQuestion')).toBe('question');
    expect(presentationOf('mcp__doperpowers__AskUserQuestion')).toBe('question'); // DC9: doperpowers' ask tool
    expect(presentationOf('mcp__sminos__AskUserQuestion')).toBe('question'); // the same tool once it moved to the sminos plugin
    expect(presentationOf('ExitPlanMode')).toBe('plan');
    expect(presentationOf('Bash')).toBe('cell');
    expect(presentationOf('mcp__x__y')).toBe('cell');
  });
});

describe('classification overrides', () => {
  it('a denial makes any cell standalone, with the disposition from the denial table', () => {
    const denied = classifyTool('Bash', {}, { ...base, denial: { kind: 'permission-rule', reason: 'nope' } });
    expect(denied.groupable).toBe(false);
    expect(denied.denial).toEqual({ kind: 'permission-rule', disposition: 'denied', interruption: false, reason: 'nope' });
    const hidden = classifyTool('TodoWrite', {}, { ...base, denial: { kind: 'automode-blocked', reason: null } });
    expect(hidden.groupable).toBe(false);
    expect(hidden.denial?.disposition).toBe('auto_denied');
  });

  it('a human decision makes the cell standalone', () => {
    const c = classifyTool('Bash', {}, { ...base, humanDecision: true });
    expect(c.groupable).toBe(false);
    expect(c.humanDecision).toBe(true);
  });

  it('an image result makes the cell standalone', () => {
    expect(classifyTool('Read', {}, { ...base, imageResult: true }).groupable).toBe(false);
  });

  it('an error without a denial stays grouped', () => {
    const c = classifyTool('Bash', {}, { ...base, isError: true });
    expect(c.groupable).toBe(true);
    expect(c.denial).toBeNull();
  });

  it('carries the safeguard verdict', () => {
    expect(classifyTool('Bash', {}, { ...base, safeguard: 'not_flagged' }).safeguard).toBe('not_flagged');
  });
});

describe('denial disposition', () => {
  type Kind = Parameters<typeof denialDisposition>[0];
  const OPEN = { closed: false, stopped: false };
  const COMPLETED = { closed: true, stopped: false };
  const STOPPED = { closed: true, stopped: true };
  const dispose = (kind: Kind, turn: { closed: boolean; stopped: boolean }, continued = false) =>
    classifyTool('Bash', {}, { ...base, denial: { kind, reason: null }, turn, continued }).denial!;

  it.each([
    ['permission-rule', COMPLETED, 'denied', false],
    ['permission-rule', STOPPED, 'denied', false],
    ['automode-blocked', COMPLETED, 'auto_denied', false],
    ['automode-parsing-error', COMPLETED, 'auto_denied', false],
    ['automode-unavailable', COMPLETED, 'stopped', false],
    ['interrupted', COMPLETED, 'stopped', false],
    ['cancelled', COMPLETED, 'stopped', false],
  ] as const)('%s in a turn %o → %s (interruption %s)', (kind, turn, disposition, interruption) => {
    expect(dispose(kind, turn)).toMatchObject({ kind, disposition, interruption });
  });

  // UX wave U2 (decision 23, the architect's ruling R1): a rejected call reads stopped from its result on, on every route;
  // denied only once the model went on after it, or once its turn closed otherwise than stopped
  it.each([
    ['open, nothing after it', OPEN, false, 'stopped', true],
    ['closed as stopped', STOPPED, false, 'stopped', true],
    ['closed otherwise (completed, failed)', COMPLETED, false, 'denied', false],
    ['open, the model went on', OPEN, true, 'denied', false],
    ['closed as stopped after the model went on', STOPPED, true, 'denied', false],
  ] as const)('user-rejected, its turn %s → %s (interruption %s)', (_, turn, continued, disposition, interruption) => {
    expect(dispose('user-rejected', turn, continued)).toMatchObject({ kind: 'user-rejected', disposition, interruption });
    expect(denialDisposition('user-rejected', turn, continued)).toEqual({ disposition, interruption });
  });
});

// UX wave U2 (decision 23): which rejected calls the model went on after, over constructed events (invented content)
describe('continuedAfter', () => {
  const REJECTED = { isError: true, denial: 'user-rejected' as const };
  const rejectedCall = () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_a', 'Bash', { command: 'make lint' }, 'msg_1', 0);
    b.result('toolu_a', 'The user doesn’t want to proceed with this tool use.', REJECTED);
    return b;
  };

  it('a block of the next API message counts: its delta, its completion or its call', () => {
    const delta = rejectedCall();
    delta.emit('assistant.block.delta', { apiMessageId: api('msg_2'), blockIndex: 0, blockType: 'thinking', textDelta: null, thinkingDelta: '', inputJsonDelta: null, userMessageUuid: null, toolUseId: null, toolName: null });
    expect([...continuedAfter(delta.events)]).toEqual([tool('toolu_a')]);
    const text = rejectedCall();
    text.text('msg_2', 0, 'Understood, leaving the linter for now.');
    expect([...continuedAfter(text.events)]).toEqual([tool('toolu_a')]);
    const call = rejectedCall();
    call.emit('tool.use', { toolUseId: tool('toolu_b'), toolName: 'Read', input: {}, apiMessageId: api('msg_2'), messageUuid: null });
    expect([...continuedAfter(call.events)]).toEqual([tool('toolu_a')]);
  });

  it('a later call of the call’s own message does not count: the engine starts a call before its message is whole', () => {
    const b = rejectedCall();
    b.toolUse('toolu_b', 'Read', { file_path: 'notes.md' }, 'msg_1', 1);
    b.result('toolu_b', 'The user doesn’t want to proceed with this tool use.', REJECTED);
    expect(continuedAfter(b.events).size).toBe(0);
  });

  it('another call’s result, the interrupt marker, an API error envelope, a subagent’s block and the turn’s end do not count', () => {
    const b = rejectedCall();
    b.result('toolu_z', 'ok');
    b.emit('user.message', { messageUuid: uuid('marker'), content: '[Request interrupted by user for tool use]', isReplay: false, isSynthetic: true, origin: 'interrupt-marker', bash: null });
    b.text('msg_err', 0, 'API Error: 500 upstream', { isApiErrorMessage: true });
    b.emit('assistant.block.complete', { messageUuid: uuid('child-1'), apiMessageId: api('msg_child'), blockIndex: 0, block: { type: 'text', text: 'child output' }, model: MODEL, supersedes: [], aborted: false, userMessageUuids: [] }, { parentToolUseId: parent('toolu_agent') });
    b.end(['u1'], { terminalReason: 'aborted_tools', isError: true, result: 'error_during_execution' });
    expect(continuedAfter(b.events).size).toBe(0);
  });

  it('work before the result is not work after it, and a block with no message id counts for nothing', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_a', 'Bash', { command: 'make lint' }, 'msg_1', 0);
    b.text('msg_2', 0, 'Running the linter meanwhile.');
    b.emit('assistant.block.delta', { apiMessageId: null, blockIndex: 0, blockType: 'text', textDelta: 'x', thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null, toolUseId: null, toolName: null });
    b.result('toolu_a', 'The user doesn’t want to proceed with this tool use.', REJECTED);
    expect(continuedAfter(b.events).size).toBe(0);
  });

  it('only user-rejected results are read', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_a', 'Bash', { command: 'make lint' }, 'msg_1', 0);
    b.result('toolu_a', 'Permission to use Bash has been denied.', { isError: true, denial: 'permission-rule' });
    b.text('msg_2', 0, 'Trying another way.');
    expect(continuedAfter(b.events).size).toBe(0);
  });
});
