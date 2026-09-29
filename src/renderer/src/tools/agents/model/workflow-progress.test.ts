import { describe, expect, it } from 'vitest';
import { replayed, workflowRunsOf } from '../../../../../../test/support/agents-events';
import { applyTaskEvents, emptyGraph, mergeRuns, type TaskNode } from './task-graph';
import { agentTableOf, phasesOf, workflowTotals } from './workflow-progress';

const events = replayed('pass2', 'workflow');
const progressAt = (seq: number) => {
  const frame = events.find((e) => e.seq === seq && e.kind === 'workflow.progress');
  if (frame?.kind !== 'workflow.progress' || !Array.isArray(frame.progress)) throw new Error(`no progress at ${seq}`);
  return frame.progress as unknown[];
};

describe('workflow progress', () => {
  it('reads Echo 0/2 running at seq 82 (alpha already started), 1/2 at 92 and 2/2 done at 93', () => {
    expect(phasesOf(progressAt(82)).map(({ title, done, total, state }) => ({ title, done, total, state }))).toEqual([{ title: 'Echo', done: 0, total: 2, state: 'running' }]);
    expect(phasesOf(progressAt(92)).map(({ done, total, state }) => ({ done, total, state }))).toEqual([{ done: 1, total: 2, state: 'running' }]);
    expect(phasesOf(progressAt(93)).map(({ done, total, state }) => ({ done, total, state }))).toEqual([{ done: 2, total: 2, state: 'done' }]);
  });

  it('reads the disk snapshot the same way', () => {
    const [run] = workflowRunsOf();
    const [phase] = phasesOf(run.snapshot?.workflowProgress ?? null);
    expect(phase).toMatchObject({ index: 1, title: 'Echo', done: 2, total: 2, state: 'done' });
    expect(agentTableOf(phase)).toEqual([
      { label: 'alpha', model: 'claude-opus-5-5[1m]', state: 'done', tokens: 8861, durationMs: 1419, agentId: 'a014f6be436bed86b' },
      { label: 'beta', model: 'claude-opus-5-5[1m]', state: 'done', tokens: 8857, durationMs: expect.any(Number), agentId: 'ae03d49e48b8ed708' },
    ]);
  });

  it('is queued while no agent of the phase has started (a synthetic frame; the recorded run never shows it)', () => {
    const queued = [
      { type: 'workflow_phase', index: 1, title: 'Solve' },
      { type: 'workflow_agent', index: 1, label: 'a', phaseIndex: 1, state: 'queued', queuedAt: 1 },
      { type: 'workflow_agent', index: 2, label: 'b', phaseIndex: 1, state: 'queued', queuedAt: 1 },
    ];
    expect(phasesOf(queued)).toMatchObject([{ title: 'Solve', done: 0, total: 2, state: 'queued' }]);
    expect(agentTableOf(phasesOf(queued)[0])[0]).toEqual({ label: 'a', model: null, state: 'queued', tokens: null, durationMs: null, agentId: null });
  });

  it('drops rows of an unknown type or a broken shape, never throws, and names a phase with no phase row', () => {
    const rows = [
      { type: 'workflow_note', text: 'x' },
      { type: 'workflow_agent', label: 'no index' },
      'garbage',
      null,
      { type: 'workflow_agent', index: 1, label: 'a', phaseIndex: 2, state: 'done', startedAt: 5 },
    ];
    expect(phasesOf(rows)).toMatchObject([{ index: 2, title: 'Phase 2', done: 1, total: 1, state: 'done' }]);
    expect(phasesOf(null)).toEqual([]);
  });

  it('keeps one row per agent index, the latest', () => {
    const rows = [
      { type: 'workflow_agent', index: 1, label: 'a', phaseIndex: 1, phaseTitle: 'Only', state: 'start', startedAt: 1, attempt: 1 },
      { type: 'workflow_agent', index: 1, label: 'a', phaseIndex: 1, phaseTitle: 'Only', state: 'done', startedAt: 1, attempt: 2 },
    ];
    expect(phasesOf(rows)).toMatchObject([{ title: 'Only', done: 1, total: 1, state: 'done' }]);
  });

  it('totals the agents and tokens: the snapshot’s totalTokens, else the rows’ sum, null when no row has tokens', () => {
    const wire = [...applyTaskEvents(emptyGraph(), events).tasks.values()][0];
    expect(workflowTotals(wire, wire.workflow?.progress ?? null)).toEqual({ agents: 2, tokens: 8861 + 8857, elapsedMs: 4_050 });
    const merged = [...mergeRuns(emptyGraph(), workflowRunsOf()).tasks.values()][0];
    expect(workflowTotals(merged, merged.workflow?.progress ?? null)).toEqual({ agents: 2, tokens: 17718, elapsedMs: 4045 });
    const bare = { ...wire, workflow: { workflowName: null, progress: null, runId: null, snapshot: null } } satisfies TaskNode;
    expect(workflowTotals(bare, [{ type: 'workflow_agent', index: 1, label: 'a', phaseIndex: 1, state: 'start' }])).toEqual({ agents: 1, tokens: null, elapsedMs: 4_050 });
  });
});
