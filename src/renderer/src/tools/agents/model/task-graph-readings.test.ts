// The graph's readings (the UX wave's U8b document, Interfaces §E; M5): who started a task, what runs under an agent,
// which agents are first level, and the two background lists, over built graphs and over the probe's three sessions
// (spikes/protocol-probe/findings-uxwave-U8-subagent-tasks.txt).
import { describe, expect, it } from 'vitest';
import { LaunchSpecSchema } from '@shared/engine/launch-spec';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, TaskId } from '@shared/graph/ids';
import { event, replayed, upTo } from '../../../../../../test/support/agents-events';
import { loadP5Journal } from '../../../../../../test/support/fixtures';
import { SessionStatusTracker } from '../../../../../engine-host/session-status';
import {
  agentsRunningUnder,
  applySnapshot,
  applyTaskEvents,
  backgroundDone,
  backgroundRunning,
  doneByKind,
  doneByOutcome,
  emptyGraph,
  firstLevelAgents,
  kindOf,
  nestedOf,
  onCard,
  runningAgents,
  runningUnder,
  tasksRunningUnder,
  type TaskGraph,
} from './task-graph';

const id = (s: string) => s as TaskId;
const ids = (list: readonly string[]) => list.map(id);
const graphOf = (events: SessionEvent[], base: TaskGraph = emptyGraph()) => applyTaskEvents(base, events);
const at = (second: number) => `2026-11-12T10:00:${String(second).padStart(2, '0')}.000Z`;

// An agent the main loop dispatched, or one another agent dispatched: the child's own Agent call names its parent first.
const agent = (taskId: string, parent: string | null = null): SessionEvent[] => [
  ...(parent === null ? [] : [event('tool.use', { toolUseId: `toolu_${taskId}`, toolName: 'Agent', agentId: parent })]),
  event('subagent.started', { taskId, toolUseId: `toolu_${taskId}` }),
];
const shell = (taskId: string, starter: string | null = null, fields: Record<string, unknown> = {}): SessionEvent =>
  event('task.started', { taskId, toolUseId: `toolu_${taskId}`, taskType: 'local_bash', isBackground: true, ...(starter === null ? {} : { parentTaskId: starter }), ...fields });
const monitor = (taskId: string, starter: string | null = null): SessionEvent[] => [
  event('tool.use', { toolUseId: `toolu_${taskId}`, toolName: 'Monitor', agentId: starter }),
  shell(taskId, starter),
];
const task = (taskId: string, taskType: string, starter: string | null = null): SessionEvent =>
  event('task.started', { taskId, toolUseId: `toolu_${taskId}`, taskType, isBackground: true, workflowName: null, ...(starter === null ? {} : { parentTaskId: starter }) });
const agentEnds = (taskId: string, status: 'completed' | 'failed' | 'stopped' = 'completed', second = 30) => event('subagent.finished', { taskId, status }, { at: at(second) });
const taskEnds = (taskId: string, status: 'completed' | 'failed' | 'stopped' = 'completed', second = 30) => event('task.notification', { taskId, status }, { at: at(second) });

describe('the graph’s readings', () => {
  describe('who started a task', () => {
    it('a task.started that names its starter keeps it; one that names none, and an agent, keep none', () => {
      const graph = graphOf([...agent('A'), shell('s1', 'A'), shell('s2')]);
      expect(graph.tasks.get(id('s1'))?.parentTaskId).toBe('A');
      expect(graph.tasks.get(id('s2'))?.parentTaskId).toBeNull();
      expect(graph.tasks.get(id('A'))?.parentTaskId).toBeNull();
    });

    it('a task known only from a snapshot takes its starter from it, and a later snapshot without the key leaves it', () => {
      const listed = applySnapshot(graphOf(agent('A')), [{ taskId: id('s1'), taskType: 'local_bash', description: 'sleep', ambient: false, parentTaskId: id('A') }]);
      expect(listed.tasks.get(id('s1'))?.parentTaskId).toBe('A');
      expect(tasksRunningUnder(listed, id('A'))).toBe(1);
      const again = applySnapshot(listed, [{ taskId: id('s1'), taskType: 'local_bash', description: 'sleep', ambient: false }]);
      expect(again).toBe(listed);
    });

    it('a snapshot names the starter of a task whose start named none', () => {
      const graph = applySnapshot(graphOf([...agent('A'), shell('s1')]), [{ taskId: id('s1'), taskType: 'local_bash', description: 'sleep', ambient: false, parentTaskId: id('A') }]);
      expect(graph.tasks.get(id('s1'))?.parentTaskId).toBe('A');
    });
  });

  describe('what runs under an agent', () => {
    // A dispatched B, B dispatched C; A started s1, C started s2; the main loop started s3.
    const tree = () => graphOf([...agent('A'), ...agent('B', 'A'), ...agent('C', 'B'), shell('s1', 'A'), shell('s2', 'C'), shell('s3')]);

    it('agentsRunningUnder counts the running agents at any depth, and no shell', () => {
      const graph = tree();
      expect(agentsRunningUnder(graph, id('A'))).toBe(2);
      expect(agentsRunningUnder(graph, id('B'))).toBe(1);
      expect(agentsRunningUnder(graph, id('C'))).toBe(0);
      expect(agentsRunningUnder(graphOf([agentEnds('C')], graph), id('A'))).toBe(1);
    });

    it('tasksRunningUnder counts the shell the agent started and a nested agent’s shell, and none of the main loop’s', () => {
      const graph = tree();
      expect(tasksRunningUnder(graph, id('A'))).toBe(2);
      expect(tasksRunningUnder(graph, id('B'))).toBe(1);
      expect(tasksRunningUnder(graph, id('C'))).toBe(1);
      expect(tasksRunningUnder(graphOf([taskEnds('s2')], graph), id('A'))).toBe(1);
    });

    it('tasksRunningUnder is zero where no task names a starter (an older producer)', () => {
      const graph = graphOf([...agent('A'), ...agent('B', 'A'), shell('s1'), shell('s2')]);
      expect(tasksRunningUnder(graph, id('A'))).toBe(0);
      expect(runningUnder(graph, id('A'))).toBe(1);
    });

    it('runningUnder is the two together', () => {
      expect(runningUnder(tree(), id('A'))).toBe(4);
      expect(runningUnder(tree(), id('C'))).toBe(1);
    });

    it('a foreground shell is no background task, and counts under nobody', () => {
      const graph = graphOf([...agent('A'), shell('f1', 'A', { isBackground: false })]);
      expect(tasksRunningUnder(graph, id('A'))).toBe(0);
      expect(backgroundRunning(graph)).toEqual([]);
    });

    it('a starter the session does not list is no starter', () => {
      const graph = graphOf([...agent('A'), shell('s1', 'gone')]);
      expect(tasksRunningUnder(graph, id('A'))).toBe(0);
      expect(backgroundRunning(graph).map((n) => n.taskId)).toEqual(['s1']);
    });
  });

  // Fix round A (the architect's ruling of 2026-11-13): the Stop callback's labels (`Guo`, engine 2.1.322), which a
  // status taken from its list carries, are read as the task types they name.
  describe('a task type or the Stop’s label', () => {
    it('reads each label as its type’s kind, and an unknown one, MCP task among them, as other', () => {
      expect(['local_bash', 'shell', 'local_agent', 'subagent', 'local_workflow', 'workflow', 'monitor_mcp', 'monitor', 'mcp_task', 'MCP task', 'teammate'].map(kindOf))
        .toEqual(['shell', 'shell', 'agent', 'agent', 'workflow', 'workflow', 'monitor', 'monitor', 'other', 'other', 'other']);
    });

    // A status whose list a Stop wrote carries the Stop's labels, as build F's does; the same two tasks, listed at
    // p5/p5-o16-holder-main seq 145 and named by the Stop at seq 162, read alike.
    it('a status from a recorded Stop’s list gives the readings the listing of the same tasks gives (the cards: panel/summary/running-cards.test.tsx)', () => {
      const rows = loadP5Journal('p5-o16-holder-main');
      const frameAt = (seq: number) => rows.find((row) => row.seq === seq)!.frame as Record<string, unknown>;
      const spec = LaunchSpecSchema.parse({
        appSessionId: 'app-labels', cwd: '/tmp/r', additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
        resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, inheritGrantsFrom: null, replay: null,
      });
      const listed = new SessionStatusTracker(spec, () => {});
      listed.observe(frameAt(145), '2026-10-31T00:00:00.000Z');
      const stopped = new SessionStatusTracker(spec, () => {}, { launchKind: 'adopted' });
      stopped.stopped((frameAt(162).request as { input: Record<string, unknown> }).input);
      const fromListing = listed.snapshot().backgroundTasks;
      const fromStop = stopped.snapshot().backgroundTasks;
      expect(fromListing.map((t) => t.taskType)).toEqual(['local_bash', 'local_agent']);
      expect(fromStop.map((t) => t.taskType)).toEqual(['shell', 'subagent']); // the status value stays as the engine wrote it
      const readings = (graph: TaskGraph) => ({
        kinds: graph.order.map((taskId) => [taskId, graph.tasks.get(taskId)!.kind]),
        firstLevel: firstLevelAgents(graph),
        runningAgents: runningAgents(graph),
        background: backgroundRunning(graph).map((n) => [n.taskId, n.kind]),
      });
      const stop = readings(applySnapshot(emptyGraph(), fromStop));
      expect(stop).toEqual(readings(applySnapshot(emptyGraph(), fromListing)));
      expect(stop).toMatchObject({ firstLevel: { running: ['a75a34c79539c9b3c'], done: [] }, runningAgents: 1, background: [['bzgk2epjt', 'shell']] });
    });

    it('a subagent listed by its label is an agent of the tree and no background task', () => {
      const graph = applySnapshot(emptyGraph(), [
        { taskId: id('b1'), taskType: 'shell', description: 'sleep', ambient: false },
        { taskId: id('a1'), taskType: 'subagent', description: 'Probe', ambient: false },
      ]);
      expect(firstLevelAgents(graph)).toEqual({ running: ids(['a1']), done: [] });
      expect(runningAgents(graph)).toBe(1);
      expect(backgroundRunning(graph).map((n) => [n.taskId, n.kind])).toEqual([['b1', 'shell']]);
    });
  });

  describe('first-level agents', () => {
    it('lists only the first level: what the main loop dispatched, and an agent whose parent the session does not list', () => {
      const graph = graphOf([...agent('A'), ...agent('B', 'A'), ...agent('X', 'unlisted')]);
      expect(firstLevelAgents(graph)).toEqual({ running: ids(['A', 'X']), done: [] });
      expect(nestedOf(graph, id('A'))).toEqual({ active: ids(['B']), done: [] });
    });

    it('keeps a parent among the running while a child agent runs, though its own run ended', () => {
      const graph = graphOf([...agent('A'), ...agent('B', 'A'), agentEnds('A')]);
      expect(firstLevelAgents(graph)).toEqual({ running: ids(['A']), done: [] });
    });

    it('keeps an agent among the running while a task it started runs (item 359), and moves it to done when that ends', () => {
      const graph = graphOf([...agent('A'), shell('s1', 'A'), agentEnds('A', 'completed', 20)]);
      expect(firstLevelAgents(graph)).toEqual({ running: ids(['A']), done: [] });
      expect(firstLevelAgents(graphOf([taskEnds('s1')], graph))).toEqual({ running: [], done: ids(['A']) });
    });

    it('lists the running in the order they started and done newest end first', () => {
      const graph = graphOf([...agent('A'), ...agent('B'), ...agent('C'), ...agent('D'), agentEnds('A', 'completed', 10), agentEnds('C', 'failed', 20)]);
      expect(firstLevelAgents(graph)).toEqual({ running: ids(['B', 'D']), done: ids(['C', 'A']) });
    });

    it('leaves out an agent known only from disk, whose status is unknown', () => {
      const graph = graphOf(agent('A'));
      const withDisk: TaskGraph = { ...graph, order: [...graph.order, id('D')], tasks: new Map(graph.tasks).set(id('D'), { ...graph.tasks.get(id('A'))!, taskId: id('D'), status: 'unknown' }) };
      expect(firstLevelAgents(withDisk)).toEqual({ running: ids(['A']), done: [] });
    });

    it('nestedOf splits a parent’s direct child agents by the same rule', () => {
      const graph = graphOf([
        ...agent('A'), ...agent('B', 'A'), ...agent('C', 'A'), ...agent('D', 'A'), ...agent('E', 'D'), shell('s1', 'C'),
        agentEnds('B', 'completed', 10), agentEnds('C', 'completed', 20), agentEnds('D', 'completed', 25),
      ]);
      expect(nestedOf(graph, id('A'))).toEqual({ active: ids(['C', 'D']), done: ids(['B']) });
      expect(nestedOf(graph, id('D'))).toEqual({ active: ids(['E']), done: [] });
    });

    it('lists the members of a parent cycle rather than lose them, the rest under its first member as the tree does', () => {
      const base = graphOf([...agent('A'), ...agent('B')]);
      const a = base.tasks.get(id('A'))!;
      const b = base.tasks.get(id('B'))!;
      const cycle: TaskGraph = { ...base, tasks: new Map(base.tasks).set(id('A'), { ...a, agent: { ...a.agent!, parentAgentId: 'B' as AgentId } }).set(id('B'), { ...b, agent: { ...b.agent!, parentAgentId: 'A' as AgentId } }) };
      expect(firstLevelAgents(cycle).running).toEqual(ids(['A']));
      expect(nestedOf(cycle, id('A')).active).toEqual(ids(['B']));
      expect(agentsRunningUnder(cycle, id('A'))).toBe(1);
      expect(agentsRunningUnder(cycle, id('B'))).toBe(0);
    });
  });

  describe('the card’s list and the count', () => {
    it('onCard keeps an agent that runs and an ended one with an agent running under it, and drops an ended one with only a shell', () => {
      const graph = graphOf([
        ...agent('A'), ...agent('B'), ...agent('B1', 'B'), ...agent('C'), shell('s1', 'C'), agentEnds('B'), agentEnds('C'),
      ]);
      const { running } = firstLevelAgents(graph);
      expect(running).toEqual(ids(['A', 'B', 'C']));
      expect(onCard(graph, running)).toEqual(ids(['A', 'B']));
    });

    it('runningAgents counts every running agent, nested ones included, and no ended agent a task keeps', () => {
      const graph = graphOf([...agent('A'), ...agent('B', 'A'), ...agent('C', 'B'), ...agent('D'), shell('s1', 'D'), agentEnds('D')]);
      expect(runningAgents(graph)).toBe(3);
    });
  });

  describe('background tasks', () => {
    it('backgroundRunning lists workflows, shells, monitors and other tasks that run, in the order they started, and no agent', () => {
      const graph = graphOf([shell('s1'), ...agent('A'), task('w1', 'local_workflow'), task('m1', 'mcp_task'), ...monitor('mon1', 'A'), shell('s2', 'A'), taskEnds('s2')]);
      expect(backgroundRunning(graph).map((n) => [n.taskId, n.kind])).toEqual([['s1', 'shell'], ['w1', 'workflow'], ['m1', 'other'], ['mon1', 'monitor']]);
    });

    it('backgroundDone lists those that ended, newest end first, and doneByKind counts them by kind', () => {
      const graph = graphOf([
        shell('s1'), shell('s2'), task('w1', 'local_workflow'), task('m1', 'mcp_task'), ...monitor('mon1'), ...agent('A'), shell('s3'),
        taskEnds('s1', 'completed', 10), taskEnds('w1', 'failed', 40), taskEnds('m1', 'stopped', 20), taskEnds('mon1', 'completed', 30), taskEnds('s2', 'completed', 50), agentEnds('A'),
      ]);
      const done = backgroundDone(graph);
      expect(done.map((n) => n.taskId)).toEqual(['s2', 'w1', 'mon1', 'm1', 's1']);
      expect(doneByKind(done)).toEqual({ workflows: 1, shells: 2, monitors: 1, other: 1 });
    });

    it('doneByOutcome counts the failed and the stopped among the agents given', () => {
      const graph = graphOf([...agent('A'), ...agent('B'), ...agent('C'), ...agent('D'), agentEnds('A', 'failed'), agentEnds('B', 'stopped'), agentEnds('C', 'failed'), agentEnds('D')]);
      expect(doneByOutcome(graph, firstLevelAgents(graph).done)).toEqual({ failed: 2, stopped: 1 });
      expect(doneByOutcome(graph, ids(['D']))).toEqual({ failed: 0, stopped: 0 });
    });

    it('answers the same object for the same graph', () => {
      const graph = graphOf([...agent('A'), shell('s1', 'A')]);
      expect(firstLevelAgents(graph)).toBe(firstLevelAgents(graph));
      expect(backgroundRunning(graph)).toBe(backgroundRunning(graph));
      expect(backgroundDone(graph)).toBe(backgroundDone(graph));
    });
  });

  // The probe's sessions through the normalizer and the reducer (findings-uxwave-U8-subagent-tasks.txt, (b) and (a)).
  describe('the recorded sessions', () => {
    it('run 1: the subagent’s shell and its monitor are under the subagent, the main loop’s shell under nothing', () => {
      const events = replayed('pass3', 'uxwave/uxwave-subagent-tasks-1');
      const AGENT = id('ac52cf3340dee3ad8');
      const graph = graphOf(events);
      expect(graph.tasks.get(id('bn3uhhbza'))).toMatchObject({ kind: 'shell', parentTaskId: AGENT });
      expect(graph.tasks.get(id('b47ejejpo'))).toMatchObject({ kind: 'monitor', parentTaskId: AGENT });
      expect(graph.tasks.get(id('bhf4sauza'))).toMatchObject({ kind: 'shell', parentTaskId: null });
      expect(tasksRunningUnder(graphOf(upTo(events, 49)), AGENT)).toBe(1); // its shell runs
      const mainShellRuns = graphOf(upTo(events, 190));
      expect(mainShellRuns.tasks.get(id('bhf4sauza'))?.status).toBe('running');
      expect(tasksRunningUnder(mainShellRuns, AGENT)).toBe(0);
      expect(firstLevelAgents(mainShellRuns).running).toEqual([AGENT]);
    });

    it('nodelay: an agent reported completed while its shell and monitor run stays among the running, and its wake continues the one node', () => {
      const events = replayed('pass3', 'uxwave/uxwave-subagent-tasks-nodelay');
      const AGENT = id('ab2a8ea9925ee4d69');
      const between = graphOf(upTo(events, 199));
      expect(between.tasks.get(AGENT)?.status).toBe('completed');
      expect(tasksRunningUnder(between, AGENT)).toBe(2);
      expect(firstLevelAgents(between).running).toContain(AGENT);
      expect(onCard(between, [AGENT])).toEqual([]); // the card lists agents; its tasks are the Background tasks card’s rows
      const oneLeft = graphOf(upTo(events, 236));
      expect(tasksRunningUnder(oneLeft, AGENT)).toBe(1);
      expect(firstLevelAgents(oneLeft).running).toContain(AGENT);
      const woken = graphOf(upTo(events, 238));
      expect(woken.tasks.get(AGENT)).toMatchObject({ status: 'running', endedAt: null, description: between.tasks.get(AGENT)!.description, toolUseId: 'toolu_019uM1DGYHFcPexTMMYY2EpB' });
      expect(woken.tasks.get(AGENT)?.agent).toMatchObject({ subagentType: 'general-purpose', spawnDepth: 1 });
      const ended = graphOf(events);
      expect(ended.order.filter((taskId) => taskId === AGENT)).toHaveLength(1);
      expect(ended.tasks.get(AGENT)?.status).toBe('exited'); // the recording ends with the process
    });
  });
});
