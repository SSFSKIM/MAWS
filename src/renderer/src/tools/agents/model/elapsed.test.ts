import { describe, expect, it } from 'vitest';
import type { TaskId } from '@shared/graph/ids';
import { event } from '../../../../../../test/support/agents-events';
import { elapsedOf, formatAgo, formatElapsed, formatTokens } from './elapsed';
import { formatIn } from './elapsed'; // E7
import { applyTaskEvents, emptyGraph, type TaskNode } from './task-graph';
import { REL } from '../../../test-support/relative-time';

const T = Date.parse('2026-09-29T10:00:00.000Z');
const nodeAfter = (...events: Parameters<typeof applyTaskEvents>[1]): TaskNode => [...applyTaskEvents(emptyGraph(), events).tasks.values()][0];
const usage = (durationMs: number) => ({ totalTokens: 1, toolUses: 1, durationMs });

describe('elapsed', () => {
  it('a running node with a start ticks from it', () => {
    const n = nodeAfter(event('subagent.started', { taskId: 'a' }, { at: '2026-09-29T10:00:00.000Z' }));
    expect(elapsedOf(n, T + 242_000)).toEqual({ ms: 242_000, live: true });
  });

  it('a running agent without a start reads the engine’s own count, not live', () => {
    const n = nodeAfter(event('subagent.progress', { taskId: 'a', usage: usage(5_000) }));
    expect(n.startedAt).toBeNull();
    expect(elapsedOf(n, T)).toEqual({ ms: 5_000, live: false });
  });

  it('an ended node reads its usage, else its end minus its start, else nothing', () => {
    const withUsage = nodeAfter(
      event('subagent.started', { taskId: 'a' }, { seq: 1, at: '2026-09-29T10:00:00.000Z' }),
      event('subagent.progress', { taskId: 'a', usage: usage(7_000) }, { seq: 2 }),
      event('subagent.finished', { taskId: 'a' }, { seq: 3, at: '2026-09-29T10:00:09.000Z' }),
    );
    expect(elapsedOf(withUsage, T + 60_000)).toEqual({ ms: 7_000, live: false });
    const shell = nodeAfter(event('task.started', { taskId: 's' }, { seq: 1, at: '2026-09-29T10:00:00.000Z' }), event('task.notification', { taskId: 's' }, { seq: 2, at: '2026-09-29T10:00:09.000Z' }));
    expect(elapsedOf(shell, T + 60_000)).toEqual({ ms: 9_000, live: false });
    const snapshotBorn = nodeAfter(event('tasks.snapshot', { tasks: [{ taskId: 'x' as TaskId, taskType: 'local_bash', description: 'x', ambient: false }] }));
    expect(elapsedOf(snapshotBorn, T)).toBeNull();
  });

  it('formats seconds, minutes and hours', () => {
    expect(formatElapsed(12_400)).toBe('12s');
    expect(formatElapsed(242_000)).toBe('4m 02s');
    expect(formatElapsed(3_840_000)).toBe('1h 04m');
    expect(formatElapsed(0)).toBe('0s');
  });

  it('formats tokens', () => {
    expect(formatTokens(38_100)).toBe('38.1k tokens');
    expect(formatTokens(256_310)).toBe('256.3k tokens');
    expect(formatTokens(1_200_000)).toBe('1.2M tokens');
    expect(formatTokens(999_990)).toBe('1.0M tokens');
    expect(formatTokens(512)).toBe('512 tokens');
  });

  it('formats how long ago an agent ended', () => {
    // compact, in the system locale (3m ago, 3분 전)
    expect(formatAgo(40_000)).toBe(REL.now);
    expect(formatAgo(180_000)).toBe(REL.agoNarrow(3, 'minute'));
    expect(formatAgo(2 * 3_600_000 + 5)).toBe(REL.agoNarrow(2, 'hour'));
    expect(formatAgo(26 * 3_600_000)).toBe(REL.agoNarrow(1, 'day'));
    expect(formatAgo(-5_000)).toBe(REL.now); // a clock a little behind the engine's
  });

  // E7: a scheduled job's next run, in the same form ahead of now, at least a minute away (in 3m, 3분 후).
  it('formats how long until a time to come', () => {
    expect(formatIn(40_000)).toBe(REL.in(1, 'minute'));
    expect(formatIn(-1)).toBe(REL.in(1, 'minute'));
    expect(formatIn(180_000)).toBe(REL.in(3, 'minute'));
    expect(formatIn(2 * 3_600_000 + 5)).toBe(REL.in(2, 'hour'));
    expect(formatIn(26 * 3_600_000)).toBe(REL.in(1, 'day'));
  });
});
