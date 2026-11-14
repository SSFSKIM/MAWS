// UX wave U2 (O-29, O-15; the U2a document, M2, Interfaces §B, decisions 7 and 8, acceptance 2 and 7): a run's caption
// and a turn's, in Claude Desktop's words and by its counting, through the reducer and the derivation as every route
// draws them. Invented content.
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { captionParts, captionText, stepsOfCells, turnOrder, type CaptionStep } from './caption';
import { rowsOf, withAllExpanded } from './derive';
import { applyEvents, createState } from './reduce';
import type { Row } from './rows';
import { BASH_RESULT, builder, task, tool, type Builder } from './test-events';

type RowOf<K extends Row['kind']> = Extract<Row, { kind: K }>;
const drawn = (events: SessionEvent[]): Row[] => rowsOf(withAllExpanded(applyEvents(createState(null, null), events)));
const runOf = (b: Builder): RowOf<'group'> => drawn(b.events).find((row): row is RowOf<'group'> => row.kind === 'group')!;
const lineOf = (b: Builder): RowOf<'divider'> => drawn(b.events).find((row): row is RowOf<'divider'> => row.kind === 'divider')!;

// The calls of a turn, each as one builder step: a read, an edit (one line in for each new line), a command, a search
const read = (b: Builder, id: string, path: string) => {
  b.toolUse(id, 'Read', { file_path: path });
  b.result(id, 'contents');
};
const edit = (b: Builder, id: string, path: string, outcome: 'done' | 'error' | 'none' = 'done', lines = 'one\ntwo') => {
  b.toolUse(id, 'Edit', { file_path: path, old_string: 'one', new_string: lines });
  if (outcome !== 'none') b.result(id, outcome === 'done' ? 'edited' : 'String not found in file.', { isError: outcome === 'error' });
};
const run = (b: Builder, id: string, command: string, outcome: 'done' | 'error' | 'none' = 'done') => {
  b.toolUse(id, 'Bash', { command });
  if (outcome !== 'none') b.result(id, outcome === 'done' ? 'ok' : 'Exit code 1', { isError: outcome === 'error', structured: BASH_RESULT('ok') });
};
const grep = (b: Builder, id: string, pattern: string) => {
  b.toolUse(id, 'Grep', { pattern });
  b.result(id, 'src/a.ts:1: match');
};
const fetch = (b: Builder, id: string, url: string) => {
  b.toolUse(id, 'WebFetch', { url, prompt: 'summarise' });
  b.result(id, 'a page');
};
const turnOf = (calls: (b: Builder) => void, close = true) => {
  const b = builder();
  b.turn('u1');
  calls(b);
  if (close) b.end(['u1']);
  return b;
};

describe('a run’s caption (acceptance 2)', () => {
  it('two reads of different files, one edit, three commands of which one failed and one search, with the edit’s lines on the row', () => {
    const b = turnOf((t) => {
      read(t, 't1', '/w/a.ts');
      read(t, 't2', '/w/b.ts');
      edit(t, 't3', '/w/c.ts');
      run(t, 't4', 'pnpm lint');
      run(t, 't5', 'pnpm test', 'error');
      run(t, 't6', 'pnpm build');
      grep(t, 't7', 'TODO');
    });
    const group = runOf(b);
    expect(group.summary).toBe('Read 2 files, edited a file, ran 3 commands (1 failed), searched code');
    expect(group.counts).toEqual({ added: 2, removed: 1 });
  });

  it('five parts read the first three and one more item, `and N more actions`, N the left-out parts’ counts; four are not capped', () => {
    const five = turnOf((t) => {
      read(t, 't1', '/w/a.ts');
      edit(t, 't2', '/w/b.ts');
      run(t, 't3', 'pnpm test');
      grep(t, 't4', 'TODO');
      fetch(t, 't5', 'https://example.test/a');
      fetch(t, 't6', 'https://example.test/b');
    });
    expect(runOf(five).summary).toBe('Read a file, edited a file, ran a command, and 3 more actions');
    const four = turnOf((t) => {
      read(t, 't1', '/w/a.ts');
      edit(t, 't2', '/w/b.ts');
      run(t, 't3', 'pnpm test');
      grep(t, 't4', 'TODO');
    });
    expect(runOf(four).summary).toBe('Read a file, edited a file, ran a command, searched code');
    const one = turnOf((t) => {
      read(t, 't1', '/w/a.ts');
      edit(t, 't2', '/w/b.ts');
      run(t, 't3', 'pnpm test');
      grep(t, 't4', 'TODO');
      fetch(t, 't5', 'https://example.test/a');
    });
    expect(runOf(one).summary).toBe('Read a file, edited a file, ran a command, and 2 more actions');
  });

  it('a part of files counts paths and a part of commands counts calls', () => {
    const b = turnOf((t) => {
      read(t, 't1', '/w/a.ts');
      read(t, 't2', '/w/b.ts');
      read(t, 't3', '/w/a.ts');
      run(t, 't4', 'pnpm test');
      run(t, 't5', 'pnpm test');
    });
    expect(runOf(b).summary).toBe('Read 2 files, ran 2 commands');
  });

  it('one file read twice and edited once is one part that names it, and it is a changed part', () => {
    const b = turnOf((t) => {
      read(t, 't1', '/w/src/copy.ts');
      edit(t, 't2', '/w/src/copy.ts');
      read(t, 't3', '/w/src/copy.ts');
    });
    expect(runOf(b).summary).toBe('Read and edited copy.ts');
    const steps = stepsOfCells(runOf(b).cells);
    expect(captionParts(steps)).toEqual([{ text: 'read and edited copy.ts', calls: 3, count: 2, changed: true, agent: false }]);
  });

  it('a file whose edit failed and then succeeded has no mark; two failed edits of one file are one failed key', () => {
    const recovered = turnOf((t) => {
      read(t, 't0', '/w/notes.md');
      edit(t, 't1', '/w/a.ts', 'error');
      edit(t, 't2', '/w/a.ts');
    });
    expect(runOf(recovered).summary).toBe('Read a file, edited a file');
    const failed = turnOf((t) => {
      read(t, 't0', '/w/notes.md');
      edit(t, 't1', '/w/a.ts', 'error');
      edit(t, 't2', '/w/a.ts', 'error');
    });
    expect(runOf(failed).summary).toBe('Read a file, edited a file (1 failed)');
    // the same on one path alone, where the parts name the file
    const alone = turnOf((t) => {
      edit(t, 't1', '/w/a.ts', 'error');
      edit(t, 't2', '/w/a.ts', 'error');
    });
    expect(runOf(alone).summary).toBe('Edited a.ts (1 failed)');
    const back = turnOf((t) => {
      edit(t, 't1', '/w/a.ts', 'error');
      edit(t, 't2', '/w/a.ts');
    });
    expect(runOf(back).summary).toBe('Edited a.ts');
  });

  it('a successful edit then a stopped one has no mark; a path whose latest edit still runs has no outcome yet', () => {
    const stopped = turnOf((t) => {
      read(t, 't0', '/w/notes.md');
      edit(t, 't1', '/w/a.ts');
      edit(t, 't2', '/w/a.ts', 'none'); // no result when its turn closes: stopped
    });
    expect(runOf(stopped).cells.map((cell) => cell.status)).toEqual(['done', 'done', 'stopped']);
    expect(runOf(stopped).summary).toBe('Read a file, edited a file');
    const running = turnOf((t) => {
      read(t, 't0', '/w/notes.md');
      edit(t, 't1', '/w/a.ts', 'error');
      edit(t, 't2', '/w/a.ts', 'none');
    }, false);
    expect(runOf(running).summary).toBe('Read a file, edited a file');
  });

  it('marks failed and stopped calls: `(1 failed)`, `(1 stopped)`, `(1 failed, 1 stopped)`', () => {
    const failed = turnOf((t) => {
      run(t, 't1', 'a');
      run(t, 't2', 'b', 'error');
    });
    expect(runOf(failed).summary).toBe('Ran 2 commands (1 failed)');
    const stopped = turnOf((t) => {
      run(t, 't1', 'a');
      run(t, 't2', 'b', 'none');
    });
    expect(runOf(stopped).summary).toBe('Ran 2 commands (1 stopped)');
    const both = turnOf((t) => {
      run(t, 't1', 'a');
      run(t, 't2', 'b', 'error');
      run(t, 't3', 'c', 'none');
    });
    expect(runOf(both).summary).toBe('Ran 3 commands (1 failed, 1 stopped)');
  });

  it('a TodoWrite between two reads is a member and a part', () => {
    const b = turnOf((t) => {
      read(t, 't1', '/w/a.ts');
      t.toolUse('t2', 'TodoWrite', { todos: [] });
      t.result('t2', 'ok');
      read(t, 't3', '/w/b.ts');
    });
    const group = runOf(b);
    expect(group.cells.map((cell) => cell.toolUseId)).toEqual(['t1', 't2', 't3']);
    expect(group.summary).toBe('Read 2 files, updated todos');
  });

  it('a call of no kind reads its row’s words: two ToolSearch calls with different counts are two parts, the same words twice are counted', () => {
    const search = (t: Builder, id: string, n: number) => {
      t.toolUse(id, 'ToolSearch', { query: 'select:x' });
      t.result(id, 'loaded', { structured: { matches: Array.from({ length: n }, (_, i) => `tool${i}`) } });
    };
    const two = turnOf((t) => {
      search(t, 't1', 2);
      search(t, 't2', 3);
    });
    expect(runOf(two).summary).toBe('Loaded 2 tools, loaded 3 tools');
    const twice = turnOf((t) => {
      search(t, 't1', 2);
      search(t, 't2', 2);
      t.toolUse('t3', 'mcp__docs__search', { q: 'x' });
      t.result('t3', 'boom', { isError: true });
    });
    expect(runOf(twice).summary).toBe('Loaded 2 tools 2 times, used docs · search (1 failed)');
    const skill = turnOf((t) => {
      t.toolUse('t1', 'Skill', { skill: 'release-notes' });
      t.result('t1', 'loaded');
      run(t, 't2', 'pnpm test');
    });
    expect(runOf(skill).summary).toBe('Ran a command, ran /release-notes');
  });

  it('a stopped call of no kind is counted under its done words', () => {
    const b = turnOf((t) => {
      t.toolUse('t1', 'mcp__docs__search', { q: 'x' });
      t.result('t1', 'ok');
      t.toolUse('t2', 'mcp__docs__search', { q: 'y' }); // no result when the turn closes
    });
    const group = runOf(b);
    expect(group.cells.map((cell) => [cell.label, cell.doneLabel])).toEqual([['Used docs · search', undefined], ['Stopped: `docs · search`', 'Used docs · search']]);
    expect(group.summary).toBe('Used docs · search 2 times (1 stopped)');
  });

  it('the shell’s output, kill and monitor calls are commands, LS searches for files, the Task tools update todos', () => {
    const b = turnOf((t) => {
      for (const [id, name] of [['t1', 'BashOutput'], ['t2', 'KillShell'], ['t3', 'Monitor'], ['t4', 'TaskOutput'], ['t5', 'TaskStop']] as const) {
        t.toolUse(id, name, { bash_id: 'b1' });
        t.result(id, 'ok');
      }
      t.toolUse('t6', 'LS', { path: '/w' });
      t.result('t6', 'a.ts');
      t.toolUse('t7', 'TaskCreate', { subject: 'x' });
      t.result('t7', 'ok');
    });
    expect(runOf(b).summary).toBe('Ran 5 commands, searched for files, updated todos');
  });

  it('a Write that created its file reads created, and a Write over a file reads edited', () => {
    const b = turnOf((t) => {
      t.toolUse('t1', 'Write', { file_path: '/w/new.ts', content: 'a\nb\n' });
      t.result('t1', 'written', { structured: { type: 'create', filePath: '/w/new.ts', content: 'a\nb\n' } });
      t.toolUse('t2', 'Write', { file_path: '/w/old.ts', content: 'c\n' });
      t.result('t2', 'written', { structured: { type: 'update', filePath: '/w/old.ts', content: 'c\n' } });
    });
    expect(runOf(b).summary).toBe('Created a file, edited a file');
  });
});

describe('the parts, by hand', () => {
  const step = (partial: Partial<CaptionStep>): CaptionStep => ({ kind: 'command', key: 'k', words: '', outcome: 'succeeded', path: null, ...partial });

  it('a step still running clears its key’s outcome until it ends; a stopped one does not replace an outcome the key has', () => {
    expect(captionText(captionParts([step({ key: 'a', outcome: 'failed' }), step({ key: 'a', outcome: 'running' })]), true)).toBe('Ran a command');
    expect(captionText(captionParts([step({ key: 'a', outcome: 'failed' }), step({ key: 'a', outcome: 'stopped' })]), true)).toBe('Ran a command (1 failed)');
    expect(captionText(captionParts([step({ key: 'a', outcome: 'stopped' })]), true)).toBe('Ran a command (1 stopped)');
  });

  it('the parts left out are counted by what each counts (keys, or calls for a part counted by call); without the cap every part is kept', () => {
    const parts = captionParts([
      step({ kind: 'read', key: '/a', path: '/a' }), step({ kind: 'read', key: '/b', path: '/b' }), step({ kind: 'command', key: 'c1' }),
      step({ kind: 'grep', key: 'g1' }), step({ kind: 'web_fetch', key: 'f1' }), step({ kind: 'todos', key: 'd1' }), step({ kind: 'todos', key: 'd2' }),
    ]);
    expect(captionText(parts, true)).toBe('Read 2 files, ran a command, searched code, and 3 more actions');
    expect(captionText(parts, false)).toBe('Read 2 files, ran a command, searched code, fetched a page, updated todos');
    expect(captionText([], true)).toBe('');
    // a file read twice, left out, is one action: its part counts its one key, not its two calls
    const keyed = captionParts([
      step({ kind: 'command', key: 'c1' }), step({ kind: 'grep', key: 'g1' }), step({ kind: 'web_fetch', key: 'f1' }), step({ kind: 'todos', key: 'd1' }),
      step({ kind: 'read', key: '/a', path: '/a' }), step({ kind: 'read', key: '/a', path: '/a' }),
    ]);
    expect(captionText(keyed, true)).toBe('Ran a command, searched code, fetched a page, and 2 more actions');
    expect(captionText([...keyed.slice(0, 4), ...captionParts([step({ kind: null, key: 'x', words: 'used docs · search' })])], true)).toBe('Ran a command, searched code, fetched a page, and 2 more actions');
    expect(captionText(captionParts([step({ kind: 'command', key: 'c1' }), step({ kind: 'grep', key: 'g1' }), step({ kind: 'web_fetch', key: 'f1' }), step({ kind: 'todos', key: 'd1' }), step({ kind: 'glob', key: 'h1' })]), true)).toBe('Ran a command, searched code, fetched a page, and 2 more actions');
  });

  it('three verbs of one file are joined as a list', () => {
    const parts = captionParts([step({ kind: 'read', key: '/w/a.ts', path: '/w/a.ts' }), step({ kind: 'create', key: '/w/a.ts', path: '/w/a.ts' }), step({ kind: 'edit', key: '/w/a.ts', path: '/w/a.ts', outcome: 'failed' })]);
    expect(captionText(parts, true)).toBe('Read, created, and edited a.ts (1 failed)');
  });

  it('the turn’s order: the parts that changed files first, then agents, then the rest, each stable', () => {
    const parts = captionParts([
      step({ kind: 'command', key: 'c1' }), step({ kind: 'read', key: '/a', path: '/a' }), step({ kind: 'agent', key: 'k1' }),
      step({ kind: 'edit', key: '/b', path: '/b' }), step({ kind: null, key: 'x', words: 'used docs · search' }), step({ kind: 'create', key: '/c', path: '/c' }),
    ]);
    expect(captionText(parts, false)).toBe('Ran a command, read a file, ran an agent, edited a file, created a file, used docs · search');
    expect(captionText(turnOrder(parts), false)).toBe('Edited a file, created a file, ran an agent, ran a command, read a file, used docs · search');
    expect(captionText(turnOrder(parts), true)).toBe('Edited a file, created a file, ran an agent, and 3 more actions');
  });
});

describe('a turn’s line (acceptance 7, decisions 8 and 9)', () => {
  it('a closed turn’s line carries its caption, ordered by what changed, every part uncapped and the lines of its finished edits', () => {
    const b = turnOf((t) => {
      run(t, 't1', 'pnpm test');
      read(t, 't2', '/w/src/copy.ts');
      edit(t, 't3', '/w/src/copy.ts');
      t.text('m1', 0, 'Now the docs.');
      run(t, 't4', 'pnpm lint');
      run(t, 't5', 'pnpm build');
      grep(t, 't6', 'TODO');
      fetch(t, 't7', 'https://example.test');
      edit(t, 't8', '/w/README.md', 'error');
    });
    const line = lineOf(b);
    expect(line.caption).toBe('Edited 2 files (1 failed), ran 3 commands, read a file, and 2 more actions');
    expect(line.parts).toEqual(['edited 2 files (1 failed)', 'ran 3 commands', 'read a file', 'searched code', 'fetched a page']);
    expect(line.counts).toEqual({ added: 2, removed: 1 });
    expect(line.toolCalls).toBe(8); // the data the report reads until U2b
  });

  // The branch review's second finding: a Read that returned image blocks is an image row of its own (cells.ts), and its
  // step is keyed by its file's path like any other read: one key, so the one file's part (`read home.png`)
  const image = (b: Builder, id: string, path: string) => {
    b.toolUse(id, 'Read', { file_path: path });
    b.result(id, [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }], { structured: { isImage: true } });
  };

  it('two reads of one image are one file', () => {
    const b = turnOf((t) => {
      image(t, 't1', '/w/shots/home.png');
      image(t, 't2', '/w/shots/home.png');
    });
    expect(drawn(b.events).filter((row) => row.kind === 'cell' && row.detail.kind === 'image')).toHaveLength(2);
    expect(lineOf(b).caption).toBe('Read home.png');
  });

  it('beside a read of another file, two reads of one image count as one file', () => {
    const b = turnOf((t) => {
      image(t, 't1', '/w/shots/home.png');
      read(t, 't2', '/w/src/copy.ts');
      image(t, 't3', '/w/shots/home.png');
    });
    expect(lineOf(b).caption).toBe('Read 2 files');
  });

  it('a failed read of an image and then a successful one of the same path are one file, with no failure', () => {
    const b = turnOf((t) => {
      t.toolUse('t1', 'Read', { file_path: '/w/shots/home.png' });
      t.result('t1', 'File is not readable yet.', { isError: true });
      image(t, 't2', '/w/shots/home.png');
    });
    expect(lineOf(b).caption).toBe('Read home.png');
  });

  it('the turn order moves a merged part that names a changed file to the front', () => {
    const b = turnOf((t) => {
      run(t, 't1', 'pnpm test');
      read(t, 't2', '/w/src/copy.ts');
      edit(t, 't3', '/w/src/copy.ts');
    });
    expect(runOf(b).summary).toBe('Ran a command, read and edited copy.ts');
    expect(lineOf(b).caption).toBe('Read and edited copy.ts, ran a command');
  });

  it('counts an agent of a subagent row, a message to a subagent and a message to another session by recipient', () => {
    const b = turnOf((t) => {
      t.toolUse('a1', 'Agent', { description: 'Survey', prompt: 'p' });
      t.emit('subagent.started', { taskId: task('k1'), toolUseId: tool('a1'), description: 'Survey', subagentType: null, isBackground: false, spawnDepth: 1, prompt: null });
      t.emit('subagent.finished', { taskId: task('k1'), status: 'completed', summary: null, outputFile: null, reason: null });
      t.result('a1', 'done');
      t.toolUse('m1', 'SendMessage', { to: 'k1', message: 'one more thing' });
      t.result('m1', 'sent');
      t.toolUse('m2', 'SendMessage', { to: 'peer-a', message: 'hello' });
      t.result('m2', JSON.stringify({ success: true }));
      t.toolUse('m3', 'SendMessage', { to: 'peer-a', message: 'again' });
      t.result('m3', JSON.stringify({ success: true }));
      t.toolUse('m4', 'SendMessage', { to: 'peer-b', message: 'hi' });
      t.result('m4', JSON.stringify({ success: true }));
    });
    expect(lineOf(b).caption).toBe('Ran an agent, messaged a subagent, messaged 2 other sessions');
  });

  // The architect's ruling on M5 (G), narrowed: every agent of the turn's subagent rows is a step, but one whose start
  // names a call of this turn that launches nothing. Live, an agent the turn messaged starts again under the sending
  // call's id (u3-tasks-r1's turn be122771); the message is the step, as the file and another machine's rows read it
  describe('an agent a message of this turn re-started is no step of it', () => {
    const lines = (b: Builder) => drawn(b.events).filter((row): row is RowOf<'divider'> => row.kind === 'divider').map((row) => row.caption);
    const launch = (t: Builder, call: string, agent: string) => {
      t.toolUse(call, 'Agent', { description: 'Survey', prompt: 'p' });
      t.emit('subagent.started', { taskId: task(agent), toolUseId: tool(call), description: 'Survey', subagentType: null, isBackground: true, spawnDepth: 1, prompt: null });
      t.result(call, 'Async agent launched.');
    };

    it('a start carrying the turn’s own SendMessage call reads the message only, and the launching turn its agent', () => {
      const b = builder();
      b.turn('u1');
      launch(b, 'a1', 'k1');
      b.end(['u1']);
      b.turn('u2');
      b.toolUse('m1', 'SendMessage', { to: 'k1', message: 'one more thing' });
      b.emit('subagent.started', { taskId: task('k1'), toolUseId: tool('m1'), description: 'Survey', subagentType: null, isBackground: true, spawnDepth: 1, prompt: null });
      b.result('m1', 'sent');
      b.end(['u2']);
      expect(lines(b)).toEqual(['Ran an agent', 'Messaged a subagent']);
    });

    it('a nested launch, its start naming a call this turn does not hold, counts with the agent that made it', () => {
      const b = turnOf((t) => {
        launch(t, 'a1', 'k1');
        t.emit('subagent.started', { taskId: task('k2'), toolUseId: tool('a-inner'), description: 'Inner', subagentType: null, isBackground: true, spawnDepth: 2, prompt: null });
      });
      expect(lines(b)).toEqual(['Ran 2 agents']);
    });

    it('a workflow launched by its call in the turn counts', () => {
      const b = turnOf((t) => {
        t.toolUse('w1', 'Workflow', { workflow: 'maws-probe' });
        t.emit('task.started', { taskId: task('wf1'), toolUseId: tool('w1'), taskType: 'local_workflow', description: 'Two echo agents in one phase', isBackground: true, workflowName: 'maws-probe' });
        t.result('w1', JSON.stringify({ status: 'async_launched', taskId: 'wf1', taskType: 'local_workflow', workflowName: 'maws-probe' }));
      });
      expect(lines(b)).toEqual(['Ran an agent']);
    });

    it('the rule’s known edge: a start that names no call counts as an agent', () => {
      const b = turnOf((t) => {
        t.emit('subagent.started', { taskId: task('k2'), toolUseId: null, description: 'Orphan', subagentType: null, isBackground: true, spawnDepth: 1, prompt: null });
        run(t, 't1', 'pnpm test');
      });
      expect(lines(b)).toEqual(['Ran an agent, ran a command']);
    });
  });

  // The M2 review: a sent message's step reads its call's own result, as a call's does: a failed send is marked failed,
  // one with no result in a closed turn stopped, a refusal that stands alone is no step, a stopped refusal a stopped one
  describe('a sent message’s step, by its call’s own result', () => {
    type Outcome = 'failed' | 'unfinished' | 'refused' | 'rejected';
    const agent = (t: Builder) => {
      t.toolUse('a1', 'Agent', { description: 'Survey', prompt: 'p' });
      t.emit('subagent.started', { taskId: task('k1'), toolUseId: tool('a1'), description: 'Survey', subagentType: null, isBackground: false, spawnDepth: 1, prompt: null });
      t.emit('subagent.finished', { taskId: task('k1'), status: 'completed', summary: null, outputFile: null, reason: null });
      t.result('a1', 'done');
    };
    const send = (to: string, outcome: Outcome) => {
      const b = builder();
      b.turn('u1');
      if (to === 'k1') agent(b);
      b.toolUse('m1', 'SendMessage', { to, message: 'one more thing' });
      if (outcome === 'failed') b.result('m1', to === 'k1' ? 'No agent is listening.' : JSON.stringify({ success: false, message: 'No session at that address.' }), { isError: to === 'k1' });
      if (outcome === 'refused') b.result('m1', 'Permission to use SendMessage has been denied.', { isError: true, denial: 'permission-rule' });
      if (outcome === 'rejected') b.result('m1', 'The user doesn’t want to proceed with this tool use.', { isError: true, denial: 'user-rejected' });
      b.end(['u1'], outcome === 'rejected' ? { isError: true, result: 'error_during_execution', terminalReason: 'aborted_tools' } : {});
      return lineOf(b);
    };

    it.each([
      ['failed', 'Ran an agent, messaged a subagent (1 failed)'],
      ['unfinished', 'Ran an agent, messaged a subagent (1 stopped)'],
      ['refused', 'Ran an agent'],
      ['rejected', 'Ran an agent, messaged a subagent (1 stopped)'],
    ] as const)('to a subagent, %s', (outcome, caption) => {
      expect(send('k1', outcome).caption).toBe(caption);
    });

    it.each([
      ['failed', 'Messaged another session (1 failed)'],
      ['unfinished', 'Messaged another session (1 stopped)'],
      ['refused', ''],
      ['rejected', 'Messaged another session (1 stopped)'],
    ] as const)('to another session, %s', (outcome, caption) => {
      expect(send('peer-a', outcome).caption).toBe(caption);
    });
  });

  it('a running turn’s line carries no caption and its counts so far: an edit in flight adds nothing', () => {
    const b = turnOf((t) => {
      edit(t, 't1', '/w/a.ts', 'done', 'one\ntwo\nthree');
      edit(t, 't2', '/w/b.ts', 'none');
    }, false);
    const line = lineOf(b);
    expect(line).toMatchObject({ state: 'working', caption: '', parts: [], counts: { added: 3, removed: 1 } });
  });

  it('a refused call that stands alone is no step of the turn; it stays in the denied count', () => {
    const b = turnOf((t) => {
      run(t, 't1', 'pnpm test');
      t.toolUse('t2', 'Bash', { command: 'git push --force' });
      t.result('t2', 'Permission to use Bash has been denied.', { isError: true, denial: 'permission-rule' });
    });
    expect(lineOf(b)).toMatchObject({ caption: 'Ran a command', denied: 1 });
  });
});
