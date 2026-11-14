import { describe, expect, it } from 'vitest';
import { classifyTool, continuedAfter, denialDisposition, presentationOf, stoppedMember, type ClassifyContext } from './classify';
import { DENIAL_KINDS } from '@shared/graph/enums';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId } from '@shared/graph/ids';
import { api, builder, MODEL, parent, tool, uuid } from './test-events';

const base: ClassifyContext = { denial: null, turn: { closed: false, stopped: false }, continued: false, humanDecision: false, safeguard: 'not_evaluated', imageResult: false, isError: false };

describe('classification table', () => {
  it.each([
    ['mcp__docs__search', 'mcp', 'grouped'],
    ['Skill', 'skills', 'grouped'],
    ['ToolSearch', 'skills', 'grouped'],
    ['Read', 'exploration', 'grouped'],
    ['Glob', 'exploration', 'grouped'],
    ['LS', 'exploration', 'grouped'],
    ['LSP', 'exploration', 'grouped'],
    ['NotebookRead', 'exploration', 'grouped'],
    ['Grep', 'exploration', 'grouped'],
    ['Edit', 'files', 'grouped'],
    ['MultiEdit', 'files', 'grouped'],
    ['Write', 'files', 'grouped'],
    ['NotebookEdit', 'files', 'grouped'],
    ['Bash', 'commands', 'grouped'],
    ['BashOutput', 'commands', 'grouped'],
    ['KillShell', 'commands', 'grouped'],
    ['Monitor', 'commands', 'grouped'],
    ['WebFetch', 'web', 'grouped'],
    ['WebSearch', 'web', 'grouped'],
    ['EnterPlanMode', 'other', 'grouped'],
    ['EnterWorktree', 'other', 'grouped'],
    ['ExitWorktree', 'other', 'grouped'],
    ['TodoWrite', 'other', 'grouped'],
    ['TaskCreate', 'other', 'grouped'],
    ['TaskUpdate', 'other', 'grouped'],
    ['TaskList', 'other', 'grouped'],
    ['TaskGet', 'other', 'grouped'],
    ['TaskOutput', 'other', 'grouped'],
    ['TaskStop', 'other', 'grouped'],
    ['SomeFutureTool', 'other', 'grouped'],
  ] as const)('%s → %s, %s', (name, category, presentation) => {
    const c = classifyTool(name, {}, base);
    expect(c.category).toBe(category);
    expect(c.groupable).toBe(presentation === 'grouped');
    expect(c).not.toHaveProperty('hidden'); // UX wave U2 (decision 10): nothing inside a run is hidden
    expect(c.subagentLifecycle).toBeNull();
    expect(c.denial).toBeNull();
  });

  // UX wave U2 (l6-artifacts-12): the `maws` server's plain artifact calls join runs, as every other call does (P3-B M7
  // and P4-B4 had made each a cell of its own); a screenshot stays one, its result an image
  it.each(['artifact_list', 'artifact_describe_type', 'artifact_read', 'artifact_upload_asset', 'artifact_list_assets', 'artifact_export', 'artifact_edit', 'artifact_comments', 'artifact_reply', 'artifact_resolve', 'artifact_dataset', 'artifact_search'])('the artifact tool %s is a step of its run', (tool) => {
    const c = classifyTool(`mcp__maws__${tool}`, {}, base);
    expect([c.category, c.groupable]).toEqual(['other', true]);
    expect(presentationOf(`mcp__maws__${tool}`)).toBe('cell');
  });

  it('an artifact screenshot, the pane-opening call and the computer-use call stay cells of their own', () => {
    for (const name of ['mcp__maws__artifact_screenshot', 'mcp__maws__show_pane', 'mcp__plugin_cua_cua_repl__js', 'mcp__cua_repl__js']) expect(classifyTool(name, {}, base).groupable, name).toBe(false);
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
  it('a denial makes a cell standalone, with the disposition from the denial table', () => {
    const denied = classifyTool('Bash', {}, { ...base, denial: { kind: 'permission-rule', reason: 'nope' } });
    expect(denied.groupable).toBe(false);
    expect(denied.denial).toEqual({ kind: 'permission-rule', disposition: 'denied', interruption: false, reason: 'nope' });
    const todo = classifyTool('TodoWrite', {}, { ...base, denial: { kind: 'automode-blocked', reason: null } });
    expect(todo.groupable).toBe(false);
    expect(todo.denial?.disposition).toBe('auto_denied');
  });

  // UX wave U2 (decision 23): a refused call stands alone unless it reads stopped by the person's Stop or the engine's
  // interrupt or cancel; automode-unavailable reads stopped and stands alone
  it.each([
    ['permission-rule', { closed: true, stopped: false }, false],
    ['automode-blocked', { closed: true, stopped: false }, false],
    ['automode-parsing-error', { closed: true, stopped: false }, false],
    ['automode-unavailable', { closed: true, stopped: false }, false],
    ['interrupted', { closed: true, stopped: false }, true],
    ['cancelled', { closed: true, stopped: false }, true],
    ['user-rejected', { closed: false, stopped: false }, true],
    ['user-rejected', { closed: true, stopped: true }, true],
    ['user-rejected', { closed: true, stopped: false }, false],
  ] as const)('a %s call in a turn %o joins its run: %s', (kind, turn, member) => {
    const c = classifyTool('Bash', {}, { ...base, denial: { kind, reason: null }, turn });
    expect(c.groupable).toBe(member);
    expect(stoppedMember(c.denial!)).toBe(member);
  });

  it('every denial kind has an answer for whether it joins its run', () => {
    for (const kind of DENIAL_KINDS) expect(typeof stoppedMember({ kind, ...denialDisposition(kind, { closed: true, stopped: true }, false) })).toBe('boolean');
  });

  it('a stopped member of a tool that stands alone stays alone', () => {
    expect(classifyTool('mcp__maws__show_pane', {}, { ...base, denial: { kind: 'interrupted', reason: null } }).groupable).toBe(false);
  });

  // UX wave U2 (O-29): only the live route knows who allowed a call, so it no longer decides membership
  it('a call the person allowed joins its run, and the fact stays on its classification', () => {
    const c = classifyTool('Bash', {}, { ...base, humanDecision: true });
    expect(c.groupable).toBe(true);
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
    expect([...continuedAfter(delta.events, null)]).toEqual([tool('toolu_a')]);
    const text = rejectedCall();
    text.text('msg_2', 0, 'Understood, leaving the linter for now.');
    expect([...continuedAfter(text.events, null)]).toEqual([tool('toolu_a')]);
    const call = rejectedCall();
    call.emit('tool.use', { toolUseId: tool('toolu_b'), toolName: 'Read', input: {}, apiMessageId: api('msg_2'), messageUuid: null });
    expect([...continuedAfter(call.events, null)]).toEqual([tool('toolu_a')]);
  });

  it('a later call of the call’s own message does not count: the engine starts a call before its message is whole', () => {
    const b = rejectedCall();
    b.toolUse('toolu_b', 'Read', { file_path: 'notes.md' }, 'msg_1', 1);
    b.result('toolu_b', 'The user doesn’t want to proceed with this tool use.', REJECTED);
    expect(continuedAfter(b.events, null).size).toBe(0);
  });

  it('another call’s result, the interrupt marker, an API error envelope, a subagent’s block and the turn’s end do not count', () => {
    const b = rejectedCall();
    b.result('toolu_z', 'ok');
    b.emit('user.message', { messageUuid: uuid('marker'), content: '[Request interrupted by user for tool use]', isReplay: false, isSynthetic: true, origin: 'interrupt-marker', bash: null });
    b.text('msg_err', 0, 'API Error: 500 upstream', { isApiErrorMessage: true });
    b.emit('assistant.block.complete', { messageUuid: uuid('child-1'), apiMessageId: api('msg_child'), blockIndex: 0, block: { type: 'text', text: 'child output' }, model: MODEL, supersedes: [], aborted: false, userMessageUuids: [] }, { parentToolUseId: parent('toolu_agent') });
    b.end(['u1'], { terminalReason: 'aborted_tools', isError: true, result: 'error_during_execution' });
    expect(continuedAfter(b.events, null).size).toBe(0);
  });

  it('work before the result is not work after it, and a block with no message id counts for nothing', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_a', 'Bash', { command: 'make lint' }, 'msg_1', 0);
    b.text('msg_2', 0, 'Running the linter meanwhile.');
    b.emit('assistant.block.delta', { apiMessageId: null, blockIndex: 0, blockType: 'text', textDelta: 'x', thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null, toolUseId: null, toolName: null });
    b.result('toolu_a', 'The user doesn’t want to proceed with this tool use.', REJECTED);
    expect(continuedAfter(b.events, null).size).toBe(0);
  });

  // The branch review's first finding: which loop counts is the transcript's. A child agent's own transcript keeps its
  // events' parent attribution (the file's context and the wire's lane name the call that launched it), so its loop is
  // its own agent's events; an agent below it is not its work.
  describe('in a child agent’s own transcript', () => {
    const CHILD = 'agent-child' as AgentId;
    const GRANDCHILD = 'agent-grandchild' as AgentId;
    // the events from `from` on, as an agent's: its id, and the call that launched it as their parent
    const asAgent = (events: readonly SessionEvent[], from: number, agentId: AgentId, launch: string): SessionEvent[] =>
      events.map((event, i) => (i < from ? event : { ...event, agentId, parentToolUseId: parent(launch) }));

    it('the child’s next API message counts, though every event of the child names the call that launched it', () => {
      const b = rejectedCall();
      b.text('msg_2', 0, 'Leaving the linter for now.');
      const events = asAgent(b.events, 0, CHILD, 'toolu_launch');
      expect([...continuedAfter(events, CHILD)]).toEqual([tool('toolu_a')]);
      expect(continuedAfter(events, null).size, 'read as a main loop, they are a child’s events').toBe(0);
    });

    it('an agent below the child does not count: its blocks are its own loop’s', () => {
      const b = rejectedCall();
      const from = b.events.length;
      b.text('msg_grandchild', 0, 'Grandchild looking.');
      b.toolUse('toolu_g', 'Read', { file_path: 'notes.md' }, 'msg_grandchild', 1);
      const events = asAgent(asAgent(b.events, 0, CHILD, 'toolu_launch'), from, GRANDCHILD, 'toolu_spawned_by_child');
      expect(continuedAfter(events, CHILD).size).toBe(0);
    });
  });

  it('only user-rejected results are read', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_a', 'Bash', { command: 'make lint' }, 'msg_1', 0);
    b.result('toolu_a', 'Permission to use Bash has been denied.', { isError: true, denial: 'permission-rule' });
    b.text('msg_2', 0, 'Trying another way.');
    expect(continuedAfter(b.events, null).size).toBe(0);
  });
});
