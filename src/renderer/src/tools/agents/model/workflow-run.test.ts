// The workflow widget's model (E7 execution document, Design §2, M3): phases with the default selection, agent rows with
// their ids from the progress row or the run's journal, the ticking elapsed, inert rows, the card's summary line and the
// resolution of a transcript ref's id to a run node.
import { describe, expect, it } from 'vitest';
import type { TaskId, ToolUseId } from '@shared/graph/ids';
import type { WorkflowRun } from '@shared/ipc/schema/fs';
import { event, replayed, upTo, workflowRunsOf } from '../../../../../../test/support/agents-events';
import { applyTaskEvents, emptyGraph, mergeRuns, type TaskNode } from './task-graph';
import { agentsOf, defaultPhase, resolveRun, runSummary, runView } from './workflow-run';

const T = '2026-09-29T10:00:00.000Z';
const NOW = Date.parse(T) + 65_000;
const workflow = replayed('pass2', 'workflow');
const wireNode = (seq: number): TaskNode => [...applyTaskEvents(emptyGraph(), upTo(workflow, seq)).tasks.values()].find((n) => n.kind === 'workflow')!;
const progressNode = (progress: unknown[], over: Partial<TaskNode> = {}): TaskNode => ({
  ...[...applyTaskEvents(emptyGraph(), [
    event('task.started', { taskId: 'wf1', taskType: 'local_workflow', description: 'Judge panel', workflowName: 'demo' }, { seq: 1, at: T }),
    event('workflow.progress', { taskId: 'wf1', workflowName: 'demo', progress }, { seq: 2 }),
  ]).tasks.values()][0],
  ...over,
});
const three = [
  { type: 'workflow_phase', index: 1, title: 'Solve' },
  { type: 'workflow_phase', index: 2, title: 'Judge' },
  { type: 'workflow_phase', index: 3, title: 'Report' },
  { type: 'workflow_agent', index: 1, label: 'solve:a', phaseIndex: 1, state: 'done', startedAt: Date.parse(T), durationMs: 2_000, tokens: 10, agentId: 'aa' },
  { type: 'workflow_agent', index: 2, label: 'judge', phaseIndex: 2, state: 'running', startedAt: Date.parse(T) + 5_000, model: 'claude-haiku-4-5' },
  { type: 'workflow_agent', index: 3, label: 'report', phaseIndex: 3, state: 'queued', queuedAt: 1 },
];

describe('runView', () => {
  it('reads the recorded run per frame: Echo 0/2 then 2/2, alpha and beta with their ids, models and tokens', () => {
    const early = runView(wireNode(82), null, NOW);
    expect(early.phases.map(({ index, title, done, total, state }) => ({ index, title, done, total, state }))).toEqual([{ index: 1, title: 'Echo', done: 0, total: 2, state: 'running' }]);
    const done = runView(wireNode(93), null, NOW);
    expect(done.phases[0]).toMatchObject({ done: 2, total: 2, state: 'done' });
    expect(done.phases[0].agents.map(({ label, agentId, model, tokens }) => ({ label, agentId, model, tokens }))).toEqual([
      { label: 'alpha', agentId: 'a014f6be436bed86b', model: expect.any(String), tokens: 8861 },
      { label: 'beta', agentId: expect.any(String), model: expect.any(String), tokens: 8857 },
    ]);
    expect(done).toMatchObject({ agents: 2, tokens: 8861 + 8857 });
  });

  it('a running agent’s elapsed ticks from its start while the run runs; a reported duration wins; an ended run leaves it blank', () => {
    const view = runView(progressNode(three), null, NOW);
    const agents = view.phases.flatMap((p) => p.agents);
    expect(agents.map((a) => [a.label, a.elapsedMs, a.live])).toEqual([
      ['solve:a', 2_000, false],
      ['judge', 60_000, true],
      ['report', null, false],
    ]);
    expect(runView(progressNode(three), null, NOW + 1_000).phases[1].agents[0].elapsedMs).toBe(61_000);
    const ended = runView(progressNode(three, { status: 'stopped' }), null, NOW);
    expect(ended.phases[1].agents[0]).toMatchObject({ elapsedMs: null, live: false });
    expect(ended.running).toBe(false);
    // the run's own elapsed: from its start while it runs
    expect(view).toMatchObject({ running: true, elapsedMs: 65_000 });
  });

  it('a row with no agent id is inert (null), with its model unknown as null', () => {
    const view = runView(progressNode(three), null, NOW);
    expect(view.phases[2].agents[0]).toMatchObject({ label: 'report', agentId: null, model: null, state: 'queued' });
  });

  it('a disk-only run whose progress rows carry no agent id takes them from the journal’s started rows by label and phase', () => {
    const [run] = workflowRunsOf();
    const stripped: WorkflowRun = {
      ...run,
      snapshot: { ...run.snapshot!, workflowProgress: run.snapshot!.workflowProgress!.map((row) => ({ ...(row as Record<string, unknown>), agentId: undefined })) },
    };
    const node = [...mergeRuns(emptyGraph(), [stripped]).tasks.values()][0];
    const view = runView(node, stripped, NOW);
    expect(view.phases[0].agents.map((a) => [a.label, a.agentId])).toEqual([
      ['alpha', 'a014f6be436bed86b'],
      ['beta', 'ae03d49e48b8ed708'],
    ]);
    // a journal row of another phase does not match; two progress rows sharing a label and phase stay inert
    const otherPhase: WorkflowRun = { ...stripped, journal: stripped.journal.map((row) => ({ ...row, phase: row.phase === undefined ? undefined : 'Elsewhere' })) };
    expect(runView(node, otherPhase, NOW).phases[0].agents.map((a) => a.agentId)).toEqual([null, null]);
    const twins = progressNode([
      { type: 'workflow_agent', index: 1, label: 'twin', phaseIndex: 1, phaseTitle: 'P', state: 'done', startedAt: 1 },
      { type: 'workflow_agent', index: 2, label: 'twin', phaseIndex: 1, phaseTitle: 'P', state: 'done', startedAt: 1 },
    ]);
    const twinRun: WorkflowRun = { runId: 'r', snapshot: null, journal: [{ type: 'started', agentId: 'x1', label: 'twin', phase: 'P' }, { type: 'started', agentId: 'x2', label: 'twin', phase: 'P' }] };
    expect(runView(twins, twinRun, NOW).phases[0].agents.map((a) => a.agentId)).toEqual([null, null]);
    // a retried agent: the latest started row's id
    const once = progressNode([{ type: 'workflow_agent', index: 1, label: 'solo', phaseIndex: 1, phaseTitle: 'P', state: 'running', startedAt: 1 }]);
    const retried: WorkflowRun = { runId: 'r', snapshot: null, journal: [{ type: 'started', agentId: 'y1', label: 'solo', phase: 'P' }, { type: 'started', agentId: 'y2', label: 'solo', phase: 'P' }] };
    expect(runView(once, retried, NOW).phases[0].agents[0].agentId).toBe('y2');
    // a journal row with no phase is not used: its label may name agents of several phases
    const twoPhases = progressNode([
      { type: 'workflow_agent', index: 1, label: 'check', phaseIndex: 1, phaseTitle: 'P', state: 'done', startedAt: 1 },
      { type: 'workflow_agent', index: 2, label: 'check', phaseIndex: 2, phaseTitle: 'Q', state: 'done', startedAt: 1 },
    ]);
    const phaseless: WorkflowRun = { runId: 'r', snapshot: null, journal: [{ type: 'started', agentId: 'z1', label: 'check' }, { type: 'started', agentId: 'z2', label: 'check' }] };
    expect(runView(twoPhases, phaseless, NOW).phases.flatMap((p) => p.agents.map((a) => a.agentId))).toEqual([null, null]);
  });

  it('no progress yet: no phases', () => {
    const node = [...applyTaskEvents(emptyGraph(), [event('task.started', { taskId: 'wf1', taskType: 'local_workflow', description: 'Judge panel' }, { seq: 1, at: T })]).tasks.values()][0];
    expect(runView(node, null, NOW).phases).toEqual([]);
  });
});

describe('the phase selection', () => {
  it('defaults to the first running phase, else the last; all phases lists every agent', () => {
    const view = runView(progressNode(three), null, NOW);
    expect(defaultPhase(view.phases)).toBe(2);
    const done = runView(wireNode(93), null, NOW);
    expect(defaultPhase(done.phases)).toBe(1);
    expect(defaultPhase([])).toBe('all');
    expect(agentsOf(view.phases, 'all').map((a) => a.label)).toEqual(['solve:a', 'judge', 'report']);
    expect(agentsOf(view.phases, 3).map((a) => a.label)).toEqual(['report']);
    expect(agentsOf(view.phases, 9)).toEqual([]);
  });
});

describe('runSummary', () => {
  it('reads Queued before any start, the first unfinished phase with its counts while it runs, Done when every phase is', () => {
    expect(runSummary([])).toBeNull();
    const queued = runView(progressNode([{ type: 'workflow_agent', index: 1, label: 'a', phaseIndex: 1, state: 'queued' }]), null, NOW);
    expect(runSummary(queued.phases)).toEqual({ kind: 'queued' });
    expect(runSummary(runView(progressNode(three), null, NOW).phases)).toEqual({ kind: 'phase', title: 'Judge', done: 0, total: 1 });
    expect(runSummary(runView(wireNode(82), null, NOW).phases)).toEqual({ kind: 'phase', title: 'Echo', done: 0, total: 2 });
    expect(runSummary(runView(wireNode(93), null, NOW).phases)).toEqual({ kind: 'done' });
  });
});

describe('resolveRun', () => {
  it('resolves a task id, a Workflow tool-use id, a run id and a snapshot’s task id, else null', () => {
    const live = applyTaskEvents(emptyGraph(), upTo(workflow, 82));
    const node = [...live.tasks.values()].find((n) => n.kind === 'workflow')!;
    expect(resolveRun(live, [node.taskId])).toBe(node.taskId);
    expect(resolveRun(live, [node.toolUseId as string])).toBe(node.taskId);
    expect(resolveRun(live, ['nothing'])).toBeNull();
    expect(resolveRun(live, [])).toBeNull();

    const [run] = workflowRunsOf();
    const disk = mergeRuns(emptyGraph(), [run]);
    expect(resolveRun(disk, [run.snapshot!.taskId!])).toBe(run.snapshot!.taskId);
    expect(resolveRun(disk, ['unknown', run.runId])).toBe(run.snapshot!.taskId);
    // before the snapshot is readable, the node is keyed by the run id
    const early = mergeRuns(emptyGraph(), [{ runId: run.runId, snapshot: null, journal: [] }]);
    expect(resolveRun(early, [run.snapshot!.taskId!, run.runId])).toBe(run.runId as TaskId);
    // a shell's id resolves to no run
    const shell = applyTaskEvents(emptyGraph(), [event('task.started', { taskId: 'b1', taskType: 'local_bash', description: 'sleep', toolUseId: 'tu-b1' as ToolUseId }, { seq: 1, at: T })]);
    expect(resolveRun(shell, ['b1'])).toBeNull();
  });
});
