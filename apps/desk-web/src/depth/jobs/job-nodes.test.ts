// DC9's M5: the job adapter — DX4's `Job` as the node MAWS's `ShellRow` and `MonitorRow` read, and MAWS's list order.
import type { Job } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import { taskLine } from '../../../../../src/renderer/src/tools/agents/background/TaskRows';
import { jobLists, taskNodeOf } from './job-nodes';

const job = (taskId: string, extra: Partial<Job> = {}): Job => ({
  taskId, kind: 'shell', toolUseId: `toolu_${taskId}`, startedAt: '2026-10-17T10:00:00.000Z', description: `job ${taskId}`, outputFile: `/private/tmp/claude-501/p/s/tasks/${taskId}.output`, status: 'running', ...extra,
});
const NOW = Date.parse('2026-10-17T10:05:00.000Z');

describe('the job adapter', () => {
  it('gives a running shell the line MAWS draws: its description and elapsed, its output file for Output', () => {
    const node = taskNodeOf(job('b1', { command: 'npm test' }));
    expect(node).toMatchObject({ taskId: 'b1', kind: 'shell', taskType: 'local_bash', toolUseId: 'toolu_b1', status: 'running', isBackground: true, outputFile: '/private/tmp/claude-501/p/s/tasks/b1.output', endedAt: null });
    expect(taskLine(node, NOW)).toBe('job b1 · running 5m 00s');
  });

  it('ends a job as its status and time say, and one that ended with the session undated', () => {
    expect(taskLine(taskNodeOf(job('b1', { status: 'completed', endedAt: '2026-10-17T10:01:00.000Z', summary: 'exit 0' })), NOW)).toMatch(/^job b1 · completed /);
    expect(taskLine(taskNodeOf(job('b2', { status: 'failed', endedAt: '2026-10-17T10:01:00.000Z' })), NOW)).toMatch(/^job b2 · failed /);
    expect(taskLine(taskNodeOf(job('b3', { status: 'exited' })), NOW)).toBe('job b3 · ended with the session');
    expect(taskNodeOf(job('b1', { summary: 'exit 0', status: 'completed' })).summary).toBe('exit 0');
  });

  it('names a job without a description by its command, else its id; a monitor with no output file yet has none', () => {
    expect(taskNodeOf(job('b1', { description: '', command: 'make' })).description).toBe('make');
    expect(taskNodeOf(job('b2', { description: '' })).description).toBe('b2');
    const monitor = taskNodeOf(job('m1', { kind: 'monitor', outputFile: null }));
    expect(monitor).toMatchObject({ kind: 'monitor', taskType: 'monitor', outputFile: null });
  });

  it('lists shells and monitors apart, each running first, then newest end first', () => {
    const lists = jobLists([
      job('old', { status: 'completed', endedAt: '2026-10-17T10:01:00.000Z' }),
      job('run'),
      job('new', { status: 'stopped', endedAt: '2026-10-17T10:03:00.000Z' }),
      job('mon', { kind: 'monitor', outputFile: null }),
    ]);
    expect(lists.shells.map((n) => n.taskId)).toEqual(['run', 'new', 'old']);
    expect(lists.monitors.map((n) => n.taskId)).toEqual(['mon']);
  });
});
