// Hooks in the transcript (W1, A4): a hook that ran and let things go on shows nothing; one that got in the way is a
// notice outside the work area, in Claude Desktop's words.
import { describe, expect, it } from 'vitest';
import { rowsOf, withAllExpanded } from './derive';
import { applyEvents, createState } from './reduce';
import type { Row } from './rows';
import { builder, type Builder } from './test-events';

type Finish = { outcome: 'success' | 'error' | 'cancelled'; exitCode: number | null; stdout?: string; stderr?: string };
const hook = (b: Builder, id: string, name: string, event: string, finish: Finish | null) => {
  b.emit('hook.started', { hookId: id, hookName: name, hookEvent: event });
  if (finish) b.emit('hook.finished', { hookId: id, hookName: name, hookEvent: event, outcome: finish.outcome, exitCode: finish.exitCode, stdout: finish.stdout ?? '', stderr: finish.stderr ?? '' });
};
const rowsFor = (b: Builder, expand = true) => {
  const state = applyEvents(createState(null, null), b.events);
  return rowsOf(expand ? withAllExpanded(state) : state);
};
const notices = (rows: Row[]) => rows.filter((row): row is Extract<Row, { kind: 'error' }> => row.kind === 'error' && row.scope === 'hook');
const cells = (rows: Row[]) => rows.flatMap((row) => (row.kind === 'group' ? row.cells : row.kind === 'cell' ? [row] : []));

describe('hooks in the transcript', () => {
  it('a successful or still running hook makes no row, no cell and no phrase', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'ls' });
    hook(b, 'h1', 'PreToolUse:Bash', 'PreToolUse', { outcome: 'success', exitCode: 0 });
    b.result('t1', 'a\nb');
    b.text('m2', 0, 'Done.');
    hook(b, 'h2', 'MessageDisplay', 'MessageDisplay', { outcome: 'success', exitCode: 0, stdout: '{"hookSpecificOutput":{"hookEventName":"MessageDisplay","displayContent":"Done."}}' });
    hook(b, 'h3', 'Stop', 'Stop', null); // still running
    const open = rowsFor(b);
    expect(notices(open)).toEqual([]);
    expect(cells(open).map((cell) => cell.toolName)).toEqual(['Bash']);
    b.end(['u1']);
    const rows = rowsFor(b);
    expect(rows.find((row) => row.kind === 'group')).toBeUndefined(); // the lone Bash call unwraps: no "ran N hooks"
    expect(rows.at(-1)).toMatchObject({ kind: 'assistant_text', phase: 'answer', markdown: 'Done.' });
  });

  it('a UserPromptSubmit hook that exits 2 blocked the prompt: a notice with Edit prompt, visible with the turn collapsed, and no divider', () => {
    const b = builder();
    b.turn('u1', 'BLOCKME please');
    hook(b, 'h1', 'UserPromptSubmit', 'UserPromptSubmit', { outcome: 'error', exitCode: 2, stderr: 'BLOCKED_BY_TEST_HOOK\nmore' });
    b.end(['u1'], { resultText: null });
    const rows = rowsFor(b, false);
    expect(notices(rows)).toEqual([expect.objectContaining({ severity: 'notice', text: 'A hook blocked your prompt · BLOCKED_BY_TEST_HOOK', action: 'edit_prompt', id: 'hook:h1' })]);
    expect(rows.map((row) => row.kind)).toEqual(['time', 'user', 'error']);
  });

  it('a UserPromptSubmit hook answering decision: block blocks too, with its reason', () => {
    const b = builder();
    b.turn('u1');
    hook(b, 'h1', 'UserPromptSubmit', 'UserPromptSubmit', { outcome: 'success', exitCode: 0, stdout: '{"decision":"block","reason":"Not on main"}' });
    expect(notices(rowsFor(b))[0]).toMatchObject({ text: 'A hook blocked your prompt · Not on main', action: 'edit_prompt' });
  });

  it('a Stop hook that blocks re-prompted Claude: the notice stays outside the work area, between the commentary and the answer', () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'First answer.');
    hook(b, 'h1', 'Stop', 'Stop', { outcome: 'success', exitCode: 0, stdout: '{"decision":"block","reason":"Say REPROMPTED and stop"}' });
    b.toolUse('t1', 'Bash', { command: 'true' }, 'm2', 0);
    b.result('t1', '');
    b.text('m3', 0, 'REPROMPTED');
    hook(b, 'h2', 'Stop', 'Stop', { outcome: 'success', exitCode: 0 });
    b.end(['u1']);
    const collapsed = rowsFor(b, false);
    expect(collapsed.map((row) => (row.kind === 'error' ? row.text : row.kind === 'assistant_text' ? `${row.phase}:${row.markdown}` : row.kind))).toEqual([
      'time', 'user', 'divider', 'Hook re-prompted Claude · Say REPROMPTED and stop', 'answer:REPROMPTED',
    ]);
    expect(notices(collapsed)[0].action).toBeUndefined();
  });

  it('a Stop hook exiting 2 re-prompts with its stderr as the reason', () => {
    const b = builder();
    b.turn('u1');
    hook(b, 'h1', 'Stop', 'Stop', { outcome: 'error', exitCode: 2, stderr: 'Tests are failing' });
    expect(notices(rowsFor(b))[0].text).toBe('Hook re-prompted Claude · Tests are failing');
  });

  it('other hooks that got in the way name themselves: blocked, failed (an error), cancelled', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'rm -rf x' });
    hook(b, 'h1', 'PreToolUse:Bash', 'PreToolUse', { outcome: 'error', exitCode: 2, stderr: 'Refusing rm -rf' });
    b.result('t1', 'Refusing rm -rf', { isError: true });
    hook(b, 'h2', 'PostToolUse:Bash', 'PostToolUse', { outcome: 'error', exitCode: 1, stderr: 'lint crashed' });
    hook(b, 'h3', 'MessageDisplay', 'MessageDisplay', { outcome: 'cancelled', exitCode: null });
    const rows = notices(rowsFor(b));
    expect(rows.map((row) => [row.severity, row.text])).toEqual([
      ['notice', 'Hook PreToolUse:Bash blocked this step · Refusing rm -rf'],
      ['error', 'Hook PostToolUse:Bash failed · exit 1 · lint crashed'],
      ['notice', 'Hook MessageDisplay was cancelled'],
    ]);
  });
});
