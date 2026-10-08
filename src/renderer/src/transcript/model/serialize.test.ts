import type { SessionEvent } from '@shared/graph/events';
import { afterEach, describe, expect, it } from 'vitest';
import { rowsOf, withAllExpanded } from './derive';
import { applyEvents, createState } from './reduce';
import { serializeRows } from './serialize';
import { BASH_RESULT, builder } from './test-events';
import { configureTime } from './time';

const rows = (events: SessionEvent[]) => rowsOf(withAllExpanded(applyEvents(createState(null, null), events)));

afterEach(() => configureTime(null));

describe('serializeRows', () => {
  it('renders a turn as markdown: the prompt, the divider line, the work as a list, the answer verbatim, the receipt', () => {
    configureTime({ now: '2026-09-28T15:00:00.000Z', locale: 'en-US', timeZone: 'UTC' });
    const b = builder();
    b.turn('u1', 'Fix the tests');
    b.thinking('m1', 0, 'Look first.');
    b.toolUse('t1', 'Read', { file_path: '/p/a.ts' }, 'm1', 1);
    b.result('t1', '1\tx');
    b.toolUse('t2', 'Bash', { command: 'pnpm test' }, 'm1', 2);
    b.result('t2', '1 passed', { structured: BASH_RESULT('1 passed') });
    b.toolUse('t3', 'Edit', { file_path: '/p/a.ts', old_string: 'x', new_string: 'y' }, 'm1', 3);
    b.result('t3', 'ok', { structured: { filePath: '/p/a.ts', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-x', '+y'] }] } });
    b.toolUse('t4', 'Bash', { command: 'rm -rf x' }, 'm1', 4);
    b.result('t4', 'Denied by rule', { isError: true, denial: 'permission-rule' });
    b.text('m2', 0, 'Done: **one** edit.\n\n```ts\nconst y = 1;\n```');
    b.end(['u1'], { durationMs: 134_000 });
    const markdown = serializeRows(rows(b.events));
    expect(markdown).toBe([
      '### Today 10:00 AM',
      '**You**',
      'Fix the tests',
      '*Worked for 2m 14s · 4 tool calls · 1 denied*',
      ['- Edited a.ts, read a.ts, ran `pnpm test`', '  - Thought', '    > Look first.', '  - Read /p/a.ts', '  - Ran `pnpm test` in 0s', '    ```', '    $ pnpm test', '    1 passed', '    ```', '  - Edited /p/a.ts +1 −1'].join('\n'),
      '- Denied: `rm -rf x` · Denied by rule',
      'Done: **one** edit.\n\n```ts\nconst y = 1;\n```',
      '**1 file changed · +1 −1**\n- /p/a.ts (+1 −1)',
    ].join('\n\n'));
  });

  it('renders the other row kinds as one line each', () => {
    const b = builder();
    b.emit('user.message', { messageUuid: 'bi' as never, content: '', isReplay: true, isSynthetic: false, origin: null, bash: { part: 'input', command: 'ls' } });
    b.emit('user.message', { messageUuid: 'bo' as never, content: '', isReplay: true, isSynthetic: false, origin: null, bash: { part: 'output', stdout: 'a\nb', stderr: '', exitCode: 0 } });
    b.emit('boundary.compaction', { trigger: 'auto', preTokens: 100_000, postTokens: 20_000, logicalParentUuid: null, historical: false });
    b.emit('notice.posted', { level: 'info', text: 'Heads up', key: null });
    const markdown = serializeRows(rows(b.events).filter((row) => row.kind !== 'time'));
    expect(markdown).toBe(['```\n! ls\na\nb\nexit 0\n```', '---\n*Context compacted · 100k → 20k tokens · auto*', '*Heads up*'].join('\n\n'));
  });

  // E7: a listing as its counts (a pending one says so, an unparsed one its notes); a message's whole body under its
  // line when the line shows only its first; a hand-back's report under its line
  it('renders the listing, the messages between sessions and a hand-back (E7)', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('l1', 'ListAgents', {});
    b.result('l1', 'This session is a [1] — x.\n\nSubagents (2):\n  s1  ·  running\n  s2  ·  running\n\nPeer sessions (1):\n  b [2]  ·  idle');
    b.toolUse('l2', 'ListAgents', {});
    b.result('l2', 'Messaging is off.');
    b.toolUse('l3', 'ListAgents', {});
    b.toolUse('s1', 'SendMessage', { to: 'peer-b', message: 'first\nsecond' });
    b.emit('subagent.message', { direction: 'from_child', fromAgentId: 'a1' as never, toAgentId: null, text: '[Subagent hand-back] Framed. The report follows:\n  done\n  all of it' });
    b.toolUse('s2', 'SendMessage', { to: 'peer-c', message: '  padded  \n' }); // whitespace hides nothing: no quote
    b.emit('subagent.message', { direction: 'from_child', fromAgentId: 'a1' as never, toAgentId: null, text: 'note\nmore' });
    b.end(['u1']);
    const markdown = serializeRows(rows(b.events).filter((row) => row.kind === 'agent_list' || row.kind === 'agent_message'));
    expect(markdown).toBe([
      '- Agents: 2 subagents, 0 teammates, 1 peer session',
      '- Agents: Messaging is off.',
      '- Listing the agents was never answered', // its turn ended with no result (scale-review C scalpel-1#1)
      '- Sent to peer-b: first\n  > first\n  > second',
      '- Report from a1\n  > done\n  > all of it',
      '- Sent to peer-c: padded',
      '- Message from a1: note\n  > note\n  > more',
    ].join('\n\n'));
  });

  // E4c start
  it('renders a browser action as its line and its time, a refusal with its reason, a cancelled call as such', () => {
    const b = builder();
    b.turn('u1');
    const page = { status: 'ok', tabId: 'b_000000000001', url: 'https://example.com/', title: 'Example' };
    b.toolUse('o1', 'mcp__maws__browser_tabs', { action: 'open', url: 'https://example.com/' });
    b.result('o1', [{ type: 'text', text: JSON.stringify({ ...page, action: 'open', tabs: [], ms: 120 }) }]);
    b.toolUse('a1', 'mcp__maws__browser_act', { tabId: 'b_000000000001', action: 'fill', target: 'e2', value: 'secret' });
    b.result('a1', 'browser_act: ref "e2" is stale or missing in the current snapshot; call browser_snapshot again and use a ref from it', { isError: true });
    b.toolUse('a2', 'mcp__maws__browser_act', { tabId: 'b_000000000001', action: 'click', target: 'e3' });
    b.end(['u1'], { terminalReason: 'aborted_streaming' });
    expect(serializeRows(rows(b.events).filter((row) => row.kind === 'browser_action'))).toBe([
      '- Opened example.com · 120ms',
      '- Could not fill e2\n  *Ref "e2" is stale or missing in the current snapshot; call browser_snapshot again and use a ref from it*',
      '- Clicking e3 · Cancelled, the turn was interrupted',
    ].join('\n\n'));
  });
  // E4c end
});
