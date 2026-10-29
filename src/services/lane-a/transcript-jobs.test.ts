// Following one transcript's jobs (P5 O9 M5): rows appended in any pieces, a line not yet whole, the engine's request
// records, a file replaced or cut short, and a file not there yet.
import { appendFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TranscriptJobs } from './transcript-jobs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const scratch = () => {
  const d = mkdtempSync(join('/tmp', 'o9j-'));
  dirs.push(d);
  return d;
};

const line = (row: unknown) => `${JSON.stringify(row)}\n`;
const call = (id: string, command: string, at: string) =>
  line({ type: 'assistant', uuid: `a-${id}`, timestamp: at, message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command, description: `run ${command}`, run_in_background: true } }] } });
const started = (id: string, task: string, at: string) =>
  line({
    type: 'user', uuid: `u-${id}`, timestamp: at, toolUseResult: { backgroundTaskId: task },
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: `Command running in background with ID: ${task}. Output is being written to: /tmp/x/tasks/${task}.output` }] },
  });
const ended = (task: string, status: string, at: string) =>
  line({ type: 'attachment', uuid: `n-${task}-${status}`, timestamp: at, attachment: { type: 'queued_command', commandMode: 'task-notification', prompt: `<task-notification>\n<task-id>${task}</task-id>\n<status>${status}</status>\n<summary>done</summary>\n</task-notification>` } });

describe('TranscriptJobs', () => {
  it('reads appended rows as they come, a line not yet whole waiting for its end', async () => {
    const path = join(scratch(), 'session.jsonl');
    const jobs = new TranscriptJobs(async () => path);
    await jobs.read();
    expect(jobs.body(true)).toEqual([]); // no file yet

    writeFileSync(path, call('toolu_1', 'sleep 60', '2026-10-28T10:00:00.000Z') + '{"type":"api-request","rows":"skipped"}\n');
    const start = started('toolu_1', 'bsleep01', '2026-10-28T10:00:01.000Z');
    appendFileSync(path, start.slice(0, 40));
    await jobs.read();
    expect(jobs.body(true)).toEqual([]);
    appendFileSync(path, start.slice(40));
    await jobs.read();
    expect(jobs.body(true)).toEqual([
      { taskId: 'bsleep01', kind: 'shell', toolUseId: 'toolu_1', startedAt: '2026-10-28T10:00:00.000Z', description: 'run sleep 60', command: 'sleep 60', outputFile: '/tmp/x/tasks/bsleep01.output', status: 'running' },
    ]);
    expect(jobs.running('bsleep01')).toBe(true);
    expect(jobs.body(false)[0]!.status).toBe('exited');

    appendFileSync(path, ended('bsleep01', 'killed', '2026-10-28T10:00:05.000Z'));
    await jobs.read();
    expect(jobs.body(true)[0]).toMatchObject({ status: 'stopped', endedAt: '2026-10-28T10:00:05.000Z', summary: 'done' });
    expect(jobs.running('bsleep01')).toBe(false);
  });

  it('starts over when the file is replaced or cut short', async () => {
    const dir = scratch();
    const path = join(dir, 'session.jsonl');
    writeFileSync(path, call('toolu_1', 'a', 'T1') + started('toolu_1', 'bfirst01', 'T2'));
    const jobs = new TranscriptJobs(async () => path);
    await jobs.read();
    expect(jobs.body(true).map((j) => j.taskId)).toEqual(['bfirst01']);

    writeFileSync(join(dir, 'next.jsonl'), call('toolu_2', 'b', 'T3') + started('toolu_2', 'bsecond2', 'T4') + call('toolu_3', 'c', 'T5') + started('toolu_3', 'bthird03', 'T6'));
    renameSync(join(dir, 'next.jsonl'), path);
    await jobs.read();
    expect(jobs.body(true).map((j) => j.taskId)).toEqual(['bsecond2', 'bthird03']);

    writeFileSync(path, call('toolu_4', 'd', 'T7') + started('toolu_4', 'bfourth4', 'T8')); // the same file, shorter
    await jobs.read();
    expect(jobs.body(true).map((j) => j.taskId)).toEqual(['bfourth4']);
  });
});
