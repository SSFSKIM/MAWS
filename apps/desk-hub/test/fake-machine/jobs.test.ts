// The fake machine's derivation and `output` beyond DC8's shared vectors (jobs-parity.test.ts): what a review found
// the vectors do not reach — a raw word that names a property every object has, and a dangling symlink under a root.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveFromRows, indexOf } from '../../fake-machine/jobs';
import { answerOutput } from '../../fake-machine/output';
import type { JsonObject } from '../../src/protocol/json';

const SESSION = 'd0c8a000-0000-4000-8000-00000000c0de';
const at = (s: number) => `2026-10-17T09:00:${String(s).padStart(2, '0')}.000Z`;

/** A background shell's call and result, naming its output file under `tasks`. */
function shell(task: string, tasks: string): JsonObject[] {
  return [
    { type: 'assistant', uuid: `${task}-call`, timestamp: at(1), message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_${task}`, name: 'Bash', input: { command: 'make', description: 'Make it', run_in_background: true } }] } },
    {
      type: 'user',
      uuid: `${task}-result`,
      timestamp: at(2),
      message: { role: 'user', content: [{ tool_use_id: `toolu_${task}`, type: 'tool_result', content: `Command running in background with ID: ${task}. Output is being written to: ${tasks}/${task}.output. You will be notified when it completes.`, is_error: false }] },
      toolUseResult: { stdout: '', stderr: '', backgroundTaskId: task },
    },
  ];
}

const notice = (task: string, status: string, s: number): JsonObject => ({
  type: 'attachment',
  uuid: `${task}-${status}`,
  timestamp: at(s),
  attachment: { type: 'queued_command', commandMode: 'task-notification', prompt: `<task-notification>\n<task-id>${task}</task-id>\n<status>${status}</status>\n</task-notification>` },
});

describe('a raw word', () => {
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])('%s, a property of every object, is no word of the table', (word) => {
    // A background agent running from its launch: an unrecognized word replaces only the outcome's raw.
    const agent = 'a0000000000000001';
    const main: JsonObject[] = [
      { type: 'assistant', uuid: 'call', timestamp: at(1), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_A', name: 'Agent', input: { description: 'Go', run_in_background: true } }] } },
      { type: 'user', uuid: 'launch', timestamp: at(2), message: { role: 'user', content: [{ tool_use_id: 'toolu_A', type: 'tool_result', content: 'Async agent launched successfully.' }] }, toolUseResult: { status: 'async_launched', agentId: agent } },
      notice(agent, word, 3),
    ];
    const metas = [{ agentId: agent, meta: { agentType: 'general-purpose', toolUseId: 'toolu_A', requestShape: 'background' } }];
    const [entry] = deriveFromRows({ session: { id: SESSION, running: true }, main, metas, agentFiles: {}, bridge: null }).subagents;
    expect(entry).toMatchObject({ status: 'running', evidence: 'rows', outcome: { status: 'running', raw: word, at: at(2) } });
  });
});

describe('output under a dangling symlink', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const setUp = () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'fm-dangling-')));
    const root = join(dir, 'tmp', 'claude-501', '-work', SESSION, 'tasks');
    mkdirSync(root, { recursive: true });
    return root;
  };

  it('is refused when the link names a place outside every root, though nothing is there', () => {
    const root = setUp();
    symlinkSync(join(dir, 'elsewhere', SESSION, 'tasks', 'bdang0001.output'), join(root, 'bdang0001.output'));
    const answer = answerOutput({ taskId: 'bdang0001', tail: 100 }, indexOf(shell('bdang0001', root)), SESSION, [`${root}/`]);
    expect(answer).toMatchObject({ taskId: 'bdang0001', result: 'refused', path: `${root}/bdang0001.output`, reason: expect.stringMatching(/\w/) });
  });

  it('is refused when a directory on the way links outside every root', () => {
    const root = setUp();
    const outside = join(dir, 'outside');
    symlinkSync(outside, join(dir, 'tmp', 'claude-501', '-work', 'link'));
    const named = join(dir, 'tmp', 'claude-501', '-work', 'link', SESSION, 'tasks');
    const answer = answerOutput({ taskId: 'bdang0002', tail: 100 }, indexOf(shell('bdang0002', named)), SESSION, [`${root}/`]);
    expect(answer).toMatchObject({ result: 'refused' });
  });

  it('is refused when the links loop, the destination never established', () => {
    const root = setUp();
    symlinkSync(join(root, 'b.loop'), join(root, 'a.loop'));
    symlinkSync(join(root, 'a.loop'), join(root, 'b.loop'));
    symlinkSync(join(root, 'a.loop'), join(root, 'bdang0003.output'));
    const answer = answerOutput({ taskId: 'bdang0003', tail: 100 }, indexOf(shell('bdang0003', root)), SESSION, [`${root}/`]);
    expect(answer).toMatchObject({ result: 'refused' });
  });

  it('is missing, with its path, when nothing is at the task’s own place under the root', () => {
    const root = setUp();
    const answer = answerOutput({ taskId: 'bdang0004', tail: 100 }, indexOf(shell('bdang0004', root)), SESSION, [`${root}/`]);
    expect(answer).toEqual({ taskId: 'bdang0004', result: 'missing', path: `${root}/bdang0004.output` });
  });
});
