// DC9's M5: a job's output asked for and answered (the composite's §9.4, DX4's `output` consumer paragraph): `ok` draws
// the tail; `missing` says the file is gone, or that none is named yet, and asks again once a later `subagents` names
// the job's file; `refused` is final; `unknown-task` waits for the next `subagents` to carry the task, asks again if it
// does, and otherwise says the task is unknown. A request lost to a reset or an end is asked again after the fresh
// snapshot.
import type { Job, TaskOutput } from 'desk-hub/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OUTPUT_TAIL, OutputRequests } from './output-requests';

const PATH = '/private/tmp/claude-501/p/s/tasks/b1.output';
const job = (taskId: string, outputFile: string | null = PATH): Job => ({ taskId, kind: 'shell', toolUseId: `toolu_${taskId}`, startedAt: '2026-10-17T10:00:00.000Z', description: taskId, outputFile, status: 'running' });
const ok = (taskId: string, text = 'line\n'): TaskOutput => ({ taskId, result: 'ok', path: PATH, size: 9000, from: 9000 - text.length, text, truncated: true });

let asked: Array<{ taskId: string; tail: number }>;
let up: boolean;
let outputs: OutputRequests;
const viewOf = (taskId: string) => outputs.state.getState().open.get(taskId);

beforeEach(() => {
  vi.useFakeTimers();
  asked = [];
  up = true;
  outputs = new OutputRequests((taskId, tail) => {
    if (!up) return false;
    asked.push({ taskId, tail });
    return true;
  });
});
afterEach(() => vi.useRealTimers());

describe('a job’s output', () => {
  it('asks for the tail when opened and draws an ok answer; Refresh asks again keeping the text meanwhile; Close forgets it', () => {
    outputs.open('b1');
    expect(asked).toEqual([{ taskId: 'b1', tail: OUTPUT_TAIL }]);
    expect(viewOf('b1')).toEqual({ phase: 'asking', last: null });
    outputs.answer(ok('b1', 'one\n'));
    expect(viewOf('b1')).toEqual({ phase: 'ok', answer: ok('b1', 'one\n') });
    outputs.refresh('b1');
    expect(asked).toHaveLength(2);
    expect(viewOf('b1')).toEqual({ phase: 'asking', last: ok('b1', 'one\n') });
    outputs.answer(ok('b1', 'two\n'));
    expect(viewOf('b1')).toMatchObject({ phase: 'ok', answer: { text: 'two\n' } });
    outputs.close('b1');
    expect(viewOf('b1')).toBeUndefined();
    outputs.answer(ok('b1')); // an answer for a closed output changes nothing
    expect(viewOf('b1')).toBeUndefined();
  });

  it('says a file gone with its path, and asks again once a later subagents changes the job’s file', () => {
    outputs.open('b1');
    outputs.answer({ taskId: 'b1', result: 'missing', path: PATH });
    expect(viewOf('b1')).toEqual({ phase: 'missing', path: PATH });
    outputs.jobs([job('b1')]); // the same file: nothing to ask again
    expect(asked).toHaveLength(1);
    outputs.jobs([job('b1', `${PATH}.2`)]);
    expect(asked).toHaveLength(2);
  });

  it('says no file is named yet for path null, and asks again when a subagents names one', () => {
    outputs.open('m1');
    outputs.answer({ taskId: 'm1', result: 'missing', path: null });
    expect(viewOf('m1')).toEqual({ phase: 'missing', path: null });
    outputs.jobs([job('m1', null)]);
    expect(asked).toHaveLength(1);
    outputs.jobs([job('m1', PATH)]);
    expect(asked).toEqual([
      { taskId: 'm1', tail: OUTPUT_TAIL },
      { taskId: 'm1', tail: OUTPUT_TAIL },
    ]);
    expect(viewOf('m1')).toEqual({ phase: 'asking', last: null });
  });

  it('draws a refusal with its reason and never asks again, not even on Refresh', () => {
    outputs.open('b1');
    outputs.answer({ taskId: 'b1', result: 'refused', path: '/etc/passwd', reason: 'The path the session named is outside its tasks directory.' });
    expect(viewOf('b1')).toEqual({ phase: 'refused', path: '/etc/passwd', reason: 'The path the session named is outside its tasks directory.' });
    outputs.refresh('b1');
    outputs.jobs([job('b1', '/elsewhere')]);
    expect(asked).toHaveLength(1);
  });

  it('waits on an unknown task for the next subagents: asks again when it carries the task, then says unknown if still so', () => {
    outputs.open('b1');
    outputs.answer({ taskId: 'b1', result: 'unknown-task' });
    expect(viewOf('b1')).toEqual({ phase: 'checking' });
    outputs.jobs([job('b1')]);
    expect(asked).toHaveLength(2);
    outputs.answer({ taskId: 'b1', result: 'unknown-task' });
    expect(viewOf('b1')).toEqual({ phase: 'unknown' });
  });

  it('says unknown when the next subagents does not carry the task', () => {
    outputs.open('b1');
    outputs.answer({ taskId: 'b1', result: 'unknown-task' });
    outputs.jobs([job('b2')]);
    expect(viewOf('b1')).toEqual({ phase: 'unknown' });
    expect(asked).toHaveLength(1);
  });

  it('says unknown when no subagents comes within its patience', () => {
    outputs.open('b1');
    outputs.answer({ taskId: 'b1', result: 'unknown-task' });
    vi.advanceTimersByTime(9_000);
    expect(viewOf('b1')).toEqual({ phase: 'checking' });
    vi.advanceTimersByTime(1_000);
    expect(viewOf('b1')).toEqual({ phase: 'unknown' });
    outputs.jobs([job('b1')]); // a late subagents changes nothing once it is said
    expect(asked).toHaveLength(1);
  });

  it('asks again after a fresh snapshot what a reset or an end lost, and what was opened while the subscription was down', () => {
    outputs.open('b1');
    outputs.lost();
    up = false;
    outputs.open('b2');
    expect(asked.map((a) => a.taskId)).toEqual(['b1']);
    up = true;
    outputs.resend();
    expect(asked.map((a) => a.taskId)).toEqual(['b1', 'b1', 'b2']);
    outputs.resend(); // nothing lost since: nothing asked twice
    expect(asked).toHaveLength(3);
  });

  it('keeps an answered output across a reset, and forgets every output on clear', () => {
    outputs.open('b1');
    outputs.answer(ok('b1'));
    outputs.lost();
    outputs.resend();
    expect(asked).toHaveLength(1);
    outputs.clear();
    expect(outputs.state.getState().open.size).toBe(0);
  });
});
