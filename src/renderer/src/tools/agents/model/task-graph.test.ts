import { describe, expect, it } from 'vitest';
import type { AgentId, TaskId, ToolUseId } from '@shared/graph/ids';
import type { SessionEvent } from '@shared/graph/events';
import { after, event, replayed, sidecarsOf, upTo, workflowRunsOf } from '../test-events';
import {
  agentRows,
  applySnapshot,
  applyTaskEvents,
  counts,
  emptyGraph,
  markExited,
  mergeRuns,
  mergeSidecars,
  monitors,
  parseOutputPath,
  removeTask,
  setStopping,
  shells,
  workflows,
  type TaskGraph,
} from './task-graph';

const id = (s: string) => s as TaskId;
const graphOf = (events: SessionEvent[], base: TaskGraph = emptyGraph()) => applyTaskEvents(base, events);
const node = (graph: TaskGraph, taskId: string) => {
  const found = graph.tasks.get(id(taskId));
  if (!found) throw new Error(`no node ${taskId}`);
  return found;
};
const iso = (ms: number) => new Date(ms).toISOString();

describe('task graph', () => {
  describe('pass1/subagent', () => {
    const events = replayed('pass1', 'subagent');
    const ONE = 'ad286defbc77bc090';
    const TWO = 'ae75ba6ce5d866acc';

    it('creates both agents from subagent.started with startedAt and isBackground, usage from progress', () => {
      const graph = graphOf(upTo(events, 296));
      expect([...graph.tasks.keys()]).toEqual([ONE, TWO]);
      const one = node(graph, ONE);
      expect(one).toMatchObject({ kind: 'agent', taskType: 'local_agent', status: 'running', startedAt: '2026-09-28T09:22:09.332Z', isBackground: true });
      expect(one.toolUseId).toBe('toolu_01CYiK6ncgQLFUQ2iqC1b4oB');
      expect(one.usage).toEqual({ totalTokens: 10899, toolUses: 1, durationMs: 1436 });
      expect(one.lastToolName).toBe('Read');
      expect(one.agent).toMatchObject({ subagentType: 'general-purpose', spawnDepth: 1, parentAgentId: null });
      expect(node(graph, TWO).startedAt).toBe('2026-09-28T09:22:10.298Z');
      expect(graph.byToolUse.get('toolu_01A8AmiXuRTeJwjQEsaPE2DM' as ToolUseId)).toBe(TWO);
      expect(one.provenance).toEqual({ wire: true, disk: false, snapshot: true }); // the snapshot at 171 named it first
    });

    it('ends both completed with the notification outputFile and endedAt from task.updated.endTime', () => {
      const graph = graphOf(events);
      const one = node(graph, ONE);
      expect(one.status).toBe('completed');
      expect(one.summary).toBe('ONE');
      expect(one.outputFile).toBe('/private/tmp/claude-501/-private-tmp-maws-probe-WmHZ2j/9a1d4262-0b43-46ad-acb9-5982f31d209c/tasks/ad286defbc77bc090.output');
      expect(one.endedAt).toBe(iso(1790587332116));
      expect(node(graph, TWO)).toMatchObject({ status: 'completed', summary: 'TWO', endedAt: iso(1790587332989) });
    });
  });

  it('pass2/workflow: one workflow node whose progress is the last frame and whose name is maws-probe', () => {
    const events = replayed('pass2', 'workflow');
    const graph = graphOf(events);
    const last = events.filter((e) => e.kind === 'workflow.progress').at(-1);
    expect(last?.seq).toBe(93);
    expect([...graph.tasks.keys()]).toEqual(['wayue3on6']);
    const wf = node(graph, 'wayue3on6');
    expect(wf).toMatchObject({ kind: 'workflow', taskType: 'local_workflow', description: 'Two echo agents in one phase', status: 'completed' });
    expect(wf.workflow?.workflowName).toBe('maws-probe');
    expect(wf.workflow?.progress).toBe(last?.kind === 'workflow.progress' ? last.progress : undefined);
    expect(workflows(graph).map((n) => n.taskId)).toEqual(['wayue3on6']);
  });

  it('pass2/per-task-stop-workflow-off: the snapshot at 77 removes nothing, killed reads stopped at 78, the notification confirms it', () => {
    const events = replayed('pass2', 'per-task-stop-workflow-off');
    const at77 = graphOf(upTo(events, 77));
    expect(node(at77, 'w98jm1qvu').status).toBe('running');
    const at78 = graphOf(after(upTo(events, 78), 77), at77);
    expect(node(at78, 'w98jm1qvu')).toMatchObject({ status: 'stopped', endedAt: iso(1790589810346) });
    const at79 = graphOf(after(upTo(events, 79), 78), at78);
    expect(node(at79, 'w98jm1qvu')).toMatchObject({ status: 'stopped', summary: 'One slow agent' });
    expect(node(at79, 'w98jm1qvu').outputFile).toMatch(/w98jm1qvu\.output$/);
  });

  describe('pass3/stop-task: the recorded stop sequences end stopped with stopping cleared', () => {
    const events = replayed('pass3', 'stop-task');
    it.each([
      ['shell', 'ba3cr5gnx', 43, 46],
      ['agent', 'ac2bd8a00d8e492f4', 135, 138],
      ['workflow', 'wkmzd07jp', 230, 233],
    ])('%s %s', (kind, taskId, before, last) => {
      const running = setStopping(graphOf(upTo(events, before)), id(taskId), true);
      expect(node(running, taskId)).toMatchObject({ kind, status: 'running', stopping: true });
      const snapshotOnly = graphOf(after(upTo(events, before + 1), before), running);
      expect(node(snapshotOnly, taskId)).toMatchObject({ status: 'running', stopping: true }); // the absent snapshot comes first and removes nothing
      const stopped = graphOf(after(upTo(events, last), before), running);
      expect(node(stopped, taskId)).toMatchObject({ status: 'stopped', stopping: false });
    });
  });

  describe('pass3/nested-agents (R5: live nesting through the issuing tool.use)', () => {
    const events = replayed('pass3', 'nested-agents');
    const OUTER = 'a38d4aebfaea9f6b1';
    const INNER = 'a425e926e506edeb1';

    it('nests the inner agent under the outer one from the wire alone', () => {
      const graph = graphOf(upTo(events, 112));
      expect(graph.issuer.get('toolu_012rAuJDibGrcgfnNbY8TGbL' as ToolUseId)).toBe(OUTER);
      expect(node(graph, INNER).agent).toMatchObject({ parentAgentId: OUTER, spawnDepth: 2 });
      expect(node(graph, OUTER).agent?.parentAgentId).toBeNull();
      expect(agentRows(graph, 'active')).toEqual([
        { taskId: OUTER, depth: 0, parentTaskId: null, orphan: false },
        { taskId: INNER, depth: 1, parentTaskId: OUTER, orphan: false },
      ]);
    });

    it('keeps the nesting when both are done and the sidecars confirm it', () => {
      const graph = mergeSidecars(graphOf(events), sidecarsOf('pass3/nested-agents-sidecars'));
      expect(node(graph, INNER).agent?.parentAgentId).toBe(OUTER);
      expect(agentRows(graph, 'done').map((r) => [r.taskId, r.depth])).toEqual([
        [OUTER, 0],
        [INNER, 1],
      ]);
    });

    it('ignores the parent’s own Agent tool.use and every other tool.use', () => {
      const parentAgentCall = events.find((e) => e.kind === 'tool.use' && e.agentId === null);
      const graph = graphOf(upTo(events, 110));
      expect(parentAgentCall).toBeDefined();
      expect(applyTaskEvents(graph, [parentAgentCall!])).toBe(graph);
      expect(applyTaskEvents(graph, [event('tool.use', { toolName: 'Read', toolUseId: 'toolu_x' }, { seq: 900 })])).toBe(graph);
    });
  });

  describe('pass3/relay-to-child', () => {
    const events = replayed('pass3', 'relay-to-child');
    const WALKER = 'accea5ba03e220b64';

    it('treats a second subagent.started of a finished agent as a restart (the agent-stopped resume)', () => {
      const finished = graphOf(upTo(events, 547));
      expect(node(finished, WALKER)).toMatchObject({ status: 'completed', isBackground: false, toolUseId: 'toolu_01Rcv6NNoLrUG3EZtboMbtQz' });
      const usage = node(finished, WALKER).usage;
      const resumed = graphOf(after(upTo(events, 548), 547), finished);
      const walker = node(resumed, WALKER);
      expect(walker).toMatchObject({ status: 'running', stopping: false, endedAt: null, isBackground: true, toolUseId: 'toolu_01LhBx8vFkJpnjJqTP5YyNyn', startedAt: '2026-09-29T15:49:21.222Z' });
      expect(walker.usage).toBe(usage);
      expect(resumed.byToolUse.get('toolu_01LhBx8vFkJpnjJqTP5YyNyn' as ToolUseId)).toBe(WALKER);
      expect(resumed.byToolUse.get('toolu_01Rcv6NNoLrUG3EZtboMbtQz' as ToolUseId)).toBe(WALKER);
      expect(node(graphOf(events), WALKER).status).toBe('completed');
    });

    it('lists a shell only while it is in the background (every long foreground Bash registers a local_bash task)', () => {
      const graph = graphOf(upTo(events, 271));
      expect(node(graph, 'b5tgmqpyq')).toMatchObject({ kind: 'shell', isBackground: false, status: 'running' });
      expect(shells(graph)).toEqual([]);
      expect(counts(graph).shells).toBe(0);
      const backgrounded = applyTaskEvents(graph, [event('task.updated', { taskId: 'b5tgmqpyq', patch: { isBackground: true } }, { seq: 272 })]);
      expect(shells(backgrounded).map((n) => n.taskId)).toEqual(['b5tgmqpyq']);
      expect(counts(backgrounded).shells).toBe(1);
    });
  });

  describe('snapshots', () => {
    it('a tasks.snapshot naming an unknown id creates a running node with startedAt null', () => {
      const graph = graphOf([event('tasks.snapshot', { tasks: [{ taskId: 'bgx', taskType: 'local_bash', description: 'sleep', ambient: false }] })]);
      expect(node(graph, 'bgx')).toMatchObject({ kind: 'shell', status: 'running', startedAt: null, isBackground: null, description: 'sleep' });
      expect(node(graph, 'bgx').provenance).toEqual({ wire: false, disk: false, snapshot: true });
      expect(shells(graph).map((n) => n.taskId)).toEqual(['bgx']); // the engine's background list names background work only
    });

    it('a snapshot omitting a stopping node leaves it in place; applySnapshot never removes', () => {
      const started = graphOf([event('task.started', { taskId: 'bgx', taskType: 'local_bash' })]);
      const stopping = setStopping(started, id('bgx'), true);
      const after = graphOf([event('tasks.snapshot', { tasks: [] }, { seq: 2 })], stopping);
      expect(after).toBe(stopping);
      expect(applySnapshot(stopping, [])).toBe(stopping);
      expect(node(after, 'bgx')).toMatchObject({ status: 'running', stopping: true });
    });

    it('applySnapshot fills from the status without touching a known node', () => {
      const started = graphOf([event('task.started', { taskId: 'bgx', taskType: 'local_bash', description: 'from start' })]);
      const next = applySnapshot(started, [
        { taskId: id('bgx'), taskType: 'local_bash', description: 'from status', ambient: false },
        { taskId: id('mon'), taskType: 'monitor_ws', description: 'watch', ambient: false },
      ]);
      expect(node(next, 'bgx').description).toBe('from start');
      expect(node(next, 'mon')).toMatchObject({ kind: 'monitor', status: 'running' });
      expect(monitors(next).map((n) => n.taskId)).toEqual(['mon']);
    });
  });

  describe('the background shell’s output path', () => {
    const events = replayed('pass2', 'per-task-stop-on');

    it('comes from the Bash result text at seq 44 and equals the notification’s outputFile at 71, character for character', () => {
      const at44 = graphOf(upTo(events, 44));
      const notification = events.find((e) => e.seq === 71 && e.kind === 'task.notification');
      expect(notification?.kind === 'task.notification' && notification.outputFile).toBeTruthy();
      const parsed = node(at44, 'b53no4rmo').outputFile;
      expect(parsed).toBe(notification?.kind === 'task.notification' ? notification.outputFile : null);
      expect(node(at44, 'b53no4rmo').status).toBe('running');
      expect(shells(at44).map((n) => n.taskId)).toEqual(['b53no4rmo']);
    });

    it('parseOutputPath stops at whitespace and drops the sentence’s trailing period', () => {
      expect(parseOutputPath('Command running in background with ID: b1. Output is being written to: /tmp/x/tasks/b1.output. You will be notified when it completes.')).toBe('/tmp/x/tasks/b1.output');
      expect(parseOutputPath('Output is being written to: /tmp/a.b/c.output')).toBe('/tmp/a.b/c.output');
      expect(parseOutputPath('Command completed.')).toBeNull();
    });
  });

  it('process.exited (the parent’s) marks the running nodes exited and leaves the ended ones', () => {
    const events = replayed('pass1', 'subagent');
    const graph = graphOf(upTo(events, 340)); // one agent completed, the other running
    const exited = applyTaskEvents(graph, [event('process.exited', {}, { seq: 341, at: '2026-09-28T09:30:00.000Z' })]);
    expect(node(exited, 'ae75ba6ce5d866acc')).toMatchObject({ status: 'exited', endedAt: '2026-09-28T09:30:00.000Z' });
    expect(node(exited, 'ad286defbc77bc090').status).toBe('completed');
    expect(markExited(exited, '2026-09-28T09:31:00.000Z')).toBe(exited);
    const child = applyTaskEvents(graph, [event('process.exited', { agentId: 'ae75ba6ce5d866acc' }, { seq: 341 })]);
    expect(child).toBe(graph);
  });

  it('a task.updated with patch.isBackground true turns a foreground agent into a background one', () => {
    const events = replayed('pass3', 'nested-agents');
    const graph = graphOf(upTo(events, 106));
    expect(node(graph, 'a38d4aebfaea9f6b1').isBackground).toBe(false);
    const backgrounded = applyTaskEvents(graph, [event('task.updated', { taskId: 'a38d4aebfaea9f6b1', agentId: 'a38d4aebfaea9f6b1', patch: { isBackground: true } }, { seq: 107 })]);
    expect(node(backgrounded, 'a38d4aebfaea9f6b1')).toMatchObject({ isBackground: true, status: 'running' });
  });

  describe('the disk half', () => {
    it('mergeSidecars fills model on the wire nodes, adds a disk node as unknown and a stoppedByUser one as stopped', () => {
      const wire = graphOf(upTo(replayed('pass1', 'subagent'), 172)); // only the first agent started on the wire
      const [one, two] = sidecarsOf('subagent-sidecars');
      const stopped = { ...two, agentId: 'aStoppedByUser1' as AgentId, meta: { ...two.meta!, description: 'Stopped one', stoppedByUser: true } };
      const graph = mergeSidecars(wire, [one, two, stopped]);
      expect(node(graph, one.agentId)).toMatchObject({ status: 'running', startedAt: '2026-09-28T09:22:09.332Z' });
      expect(node(graph, one.agentId).agent).toMatchObject({ model: 'haiku', spawnDepth: 1, transcript: { path: one.transcriptPath, size: 100, mtimeMs: 1_790_000_000_000 } });
      expect(node(graph, one.agentId).provenance).toEqual({ wire: true, disk: true, snapshot: true });
      expect(node(graph, two.agentId)).toMatchObject({ kind: 'agent', status: 'unknown', startedAt: null, isBackground: null, description: 'Read and report two.txt content' });
      expect(node(graph, two.agentId).provenance).toEqual({ wire: false, disk: true, snapshot: false });
      expect(node(graph, 'aStoppedByUser1')).toMatchObject({ status: 'stopped' });
      expect(node(graph, 'aStoppedByUser1').agent?.stoppedByUser).toBe(true);
      expect(agentRows(graph, 'disk').map((r) => r.taskId)).toEqual([two.agentId]);
      expect(agentRows(graph, 'done').map((r) => r.taskId)).toEqual(['aStoppedByUser1']);
      expect(mergeSidecars(graph, [one, two, stopped])).toBe(graph);
    });

    it('a workflow’s agents (runId !== null) are nodes no section lists', () => {
      const graph = mergeSidecars(emptyGraph(), sidecarsOf('pass2/workflow-disk', 'wf_7cacbb2d-902'));
      expect(graph.tasks.size).toBe(2);
      expect(node(graph, 'a014f6be436bed86b').agent?.runId).toBe('wf_7cacbb2d-902');
      for (const section of ['active', 'done', 'disk'] as const) expect(agentRows(graph, section)).toEqual([]);
      expect(counts(graph)).toEqual({ working: 0, done: 0, onDisk: 0, shells: 0, workflows: 0, monitors: 0 });
    });

    it('mergeRuns matches the run to the wire node by snapshot.taskId and takes its status', () => {
      const events = replayed('pass2', 'workflow');
      const running = graphOf(upTo(events, 82));
      const [run] = workflowRunsOf();
      const merged = mergeRuns(running, [run]);
      expect([...merged.tasks.keys()]).toEqual(['wayue3on6']);
      const wf = node(merged, 'wayue3on6');
      expect(wf.workflow).toMatchObject({ runId: 'wf_7cacbb2d-902', snapshot: run.snapshot });
      expect(wf.status).toBe('running'); // a wire node keeps its wire status
      expect(wf.provenance.disk).toBe(true);
      expect(node(mergeRuns(graphOf(events), [run]), 'wayue3on6').status).toBe('completed');
      const disk = mergeRuns(emptyGraph(), [run]);
      expect(node(disk, 'wayue3on6')).toMatchObject({ kind: 'workflow', status: 'completed', startedAt: null, description: 'Two echo agents in one phase' });
      expect(node(disk, 'wayue3on6').workflow).toMatchObject({ workflowName: 'maws-probe', runId: 'wf_7cacbb2d-902', progress: run.snapshot?.workflowProgress });
      expect(mergeRuns(disk, [run])).toBe(disk);
    });

    it('mergeRuns with a null snapshot adds a disk node with status unknown and the run’s runId', () => {
      const graph = mergeRuns(emptyGraph(), [{ runId: 'wf_new', snapshot: null, journal: [] }]);
      expect(node(graph, 'wf_new')).toMatchObject({ kind: 'workflow', status: 'unknown', startedAt: null });
      expect(node(graph, 'wf_new').workflow?.runId).toBe('wf_new');
    });
  });

  describe('agentRows: one nesting rule across the three sections', () => {
    const start = (taskId: string, seq: number, toolUseId: string) => event('subagent.started', { taskId, agentId: taskId, toolUseId, description: taskId }, { seq });
    const issue = (by: string, toolUseId: string, seq: number) => event('tool.use', { toolName: 'Agent', toolUseId, agentId: by }, { seq });
    const finish = (taskId: string, seq: number, at: string) => event('subagent.finished', { taskId, agentId: taskId }, { seq, at });

    it('nests a child under its running parent in Active and marks a finished child orphan in Done', () => {
      const graph = graphOf([start('P', 1, 'tu_P'), issue('P', 'tu_C', 2), start('C', 3, 'tu_C'), issue('P', 'tu_D', 4), start('D', 5, 'tu_D'), finish('D', 6, '2026-09-29T10:00:06.000Z')]);
      expect(agentRows(graph, 'active')).toEqual([
        { taskId: 'P', depth: 0, parentTaskId: null, orphan: false },
        { taskId: 'C', depth: 1, parentTaskId: 'P', orphan: false },
      ]);
      expect(agentRows(graph, 'done')).toEqual([{ taskId: 'D', depth: 0, parentTaskId: 'P', orphan: true }]);
    });

    it('marks a running child of a finished parent orphan in Active, nests in Done, newest end first', () => {
      const graph = graphOf([
        start('P', 1, 'tu_P'), issue('P', 'tu_C', 2), start('C', 3, 'tu_C'), issue('P', 'tu_D', 4), start('D', 5, 'tu_D'), start('Q', 6, 'tu_Q'),
        finish('D', 7, '2026-09-29T10:00:07.000Z'), finish('P', 8, '2026-09-29T10:00:08.000Z'), finish('Q', 9, '2026-09-29T10:00:09.000Z'),
      ]);
      expect(agentRows(graph, 'active')).toEqual([{ taskId: 'C', depth: 0, parentTaskId: 'P', orphan: true }]);
      expect(agentRows(graph, 'done')).toEqual([
        { taskId: 'Q', depth: 0, parentTaskId: null, orphan: false },
        { taskId: 'P', depth: 0, parentTaskId: null, orphan: false },
        { taskId: 'D', depth: 1, parentTaskId: 'P', orphan: false },
      ]);
    });

    it('nests in On disk over the nested sidecars, and a parent unknown to the graph makes an orphan', () => {
      const graph = mergeSidecars(emptyGraph(), sidecarsOf('pass3/nested-agents-sidecars'));
      expect(agentRows(graph, 'disk')).toEqual([
        { taskId: 'a38d4aebfaea9f6b1', depth: 0, parentTaskId: null, orphan: false },
        { taskId: 'a425e926e506edeb1', depth: 1, parentTaskId: 'a38d4aebfaea9f6b1', orphan: false },
      ]);
      const [, inner] = sidecarsOf('pass3/nested-agents-sidecars');
      expect(agentRows(mergeSidecars(emptyGraph(), [inner]), 'disk')).toEqual([{ taskId: 'a425e926e506edeb1', depth: 0, parentTaskId: 'a38d4aebfaea9f6b1', orphan: true }]);
    });

    it('is memoised on the graph object', () => {
      const graph = graphOf([start('P', 1, 'tu_P')]);
      expect(agentRows(graph, 'active')).toBe(agentRows(graph, 'active'));
    });
  });

  describe('identity', () => {
    const graph = graphOf(upTo(replayed('pass1', 'subagent'), 224));

    it('returns the same graph for an empty array and for every kind it does not read, whatever the origin', () => {
      expect(applyTaskEvents(graph, [])).toBe(graph);
      const ignored = [
        event('session.state', {}, { seq: 900 }),
        event('turn.started', { origin: 'human' }, { seq: 901 }),
        event('turn.started', { origin: 'engine' }, { seq: 902 }),
        event('turn.ended', { origin: 'peer' }, { seq: 903 }),
        event('user.message', { origin: 'peer', content: 'hi' }, { seq: 904 }),
        event('user.message', { origin: 'peer', content: 'hi', agentId: 'ad286defbc77bc090' }, { seq: 905 }),
        event('tool.result', { toolUseId: 'toolu_x', content: 'plain', structured: { stdout: '' } }, { seq: 906 }),
      ];
      for (const e of ignored) expect(applyTaskEvents(graph, [e])).toBe(graph);
    });

    it('removeTask on an unknown id returns the same graph; on a known one drops it and its tool-use key', () => {
      expect(removeTask(graph, id('nope'))).toBe(graph);
      const removed = removeTask(graph, id('ad286defbc77bc090'));
      expect(removed.tasks.has(id('ad286defbc77bc090'))).toBe(false);
      expect(removed.order).not.toContain('ad286defbc77bc090');
      expect(removed.byToolUse.has('toolu_01CYiK6ncgQLFUQ2iqC1b4oB' as ToolUseId)).toBe(false);
    });
  });

  describe('pins', () => {
    it('a subagent.progress for an unknown task creates a node rather than dropping the fact', () => {
      const graph = graphOf([event('subagent.progress', { taskId: 'aUnseen', agentId: 'aUnseen', description: 'Reading', usage: { totalTokens: 5, toolUses: 1, durationMs: 900 } })]);
      expect(node(graph, 'aUnseen')).toMatchObject({ kind: 'agent', status: 'running', startedAt: null, isBackground: null, description: 'Reading' });
      expect(node(graph, 'aUnseen').provenance).toEqual({ wire: true, disk: false, snapshot: false });
    });

    it('a task.updated with endTime on a running node sets endedAt without changing status', () => {
      const graph = graphOf([event('task.started', { taskId: 'bgx' }), event('task.updated', { taskId: 'bgx', patch: { endTime: 1790700000000 } }, { seq: 2 })]);
      expect(node(graph, 'bgx')).toMatchObject({ status: 'running', endedAt: iso(1790700000000) });
    });

    it('counts: exited and unknown are not working; exited is done, unknown on disk, a workflow’s agents nowhere', () => {
      const wire = graphOf([
        event('subagent.started', { taskId: 'r1', agentId: 'r1' }, { seq: 1 }),
        event('subagent.started', { taskId: 'x1', agentId: 'x1' }, { seq: 2 }),
        event('subagent.started', { taskId: 'd1', agentId: 'd1' }, { seq: 3 }),
        event('subagent.finished', { taskId: 'd1', agentId: 'd1' }, { seq: 4 }),
        event('task.started', { taskId: 'wf', taskType: 'local_workflow' }, { seq: 5 }),
        event('task.started', { taskId: 'sh', taskType: 'local_bash', isBackground: true }, { seq: 6 }),
        event('task.started', { taskId: 'mo', taskType: 'monitor_ws', isBackground: true }, { seq: 7 }),
      ]);
      const exited = applyTaskEvents(wire, [event('subagent.finished', { taskId: 'r1', agentId: 'r1' }, { seq: 8 })]);
      const withExit = markExited(applyTaskEvents(exited, [event('subagent.started', { taskId: 'r2', agentId: 'r2' }, { seq: 9 })]), '2026-09-29T11:00:00.000Z');
      const graph = mergeSidecars(graphOf([event('subagent.started', { taskId: 'live', agentId: 'live' }, { seq: 10 })], withExit), [
        ...sidecarsOf('subagent-sidecars'),
        ...sidecarsOf('pass2/workflow-disk', 'wf_7cacbb2d-902'),
      ]);
      // markExited turned x1, r2 and the three tasks exited: done holds r1, d1, x1 and r2; the shell, workflow and monitor ran no more
      expect(counts(graph)).toEqual({ working: 1, done: 4, onDisk: 2, shells: 0, workflows: 0, monitors: 0 });
      expect(counts(wire)).toEqual({ working: 2, done: 1, onDisk: 0, shells: 1, workflows: 1, monitors: 1 });
    });

    it('workflows, shells and monitors list running first, then the ended newest first', () => {
      const graph = graphOf([
        event('task.started', { taskId: 's1', taskType: 'local_bash' }, { seq: 1 }),
        event('task.started', { taskId: 's2', taskType: 'local_bash' }, { seq: 2 }),
        event('task.started', { taskId: 's3', taskType: 'local_bash' }, { seq: 3 }),
        event('task.notification', { taskId: 's1' }, { seq: 4, at: '2026-09-29T10:00:04.000Z' }),
        event('task.notification', { taskId: 's2' }, { seq: 5, at: '2026-09-29T10:00:05.000Z' }),
      ]);
      expect(shells(graph).map((n) => n.taskId)).toEqual(['s3', 's2', 's1']);
      expect(shells(graph)).toBe(shells(graph));
    });
  });
});
