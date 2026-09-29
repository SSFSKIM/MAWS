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
});
