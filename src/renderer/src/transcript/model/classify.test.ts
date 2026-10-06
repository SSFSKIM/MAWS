import { describe, expect, it } from 'vitest';
import { classifyTool, presentationOf, type ClassifyContext } from './classify';

const base: ClassifyContext = { denial: null, terminalReason: null, turnClosed: false, humanDecision: false, safeguard: 'not_evaluated', imageResult: false, isError: false };

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

  it('routes the row-kind tools out of the cell table', () => {
    expect(presentationOf('Agent')).toBe('subagent');
    expect(presentationOf('Task')).toBe('subagent');
    expect(presentationOf('Workflow')).toBe('subagent');
    expect(presentationOf('SendMessage')).toBe('agent_message');
    expect(presentationOf('AskUserQuestion')).toBe('question');
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
  const dispose = (kind: Parameters<typeof classifyTool>[2]['denial'] extends infer D ? (D extends { kind: infer K } ? K : never) : never, terminalReason: string | null, turnClosed = true) =>
    classifyTool('Bash', {}, { ...base, denial: { kind, reason: null }, terminalReason, turnClosed }).denial!;

  it.each([
    ['user-rejected', 'completed', 'denied', false],
    ['user-rejected', 'aborted_streaming', 'stopped', true],
    ['user-rejected', 'aborted_tools', 'stopped', true],
    ['permission-rule', 'completed', 'denied', false],
    ['permission-rule', 'aborted_streaming', 'denied', false],
    ['automode-blocked', 'completed', 'auto_denied', false],
    ['automode-parsing-error', 'completed', 'auto_denied', false],
    ['automode-unavailable', 'completed', 'stopped', false],
    ['interrupted', 'completed', 'stopped', false],
    ['cancelled', 'completed', 'stopped', false],
  ] as const)('%s with terminal reason %s → %s (interruption %s)', (kind, reason, disposition, interruption) => {
    expect(dispose(kind, reason)).toMatchObject({ kind, disposition, interruption });
  });

  it('interruption pairing waits for the turn to close: a user-rejected denial in an open turn is denied for now', () => {
    expect(dispose('user-rejected', null, false).disposition).toBe('denied');
  });
});
