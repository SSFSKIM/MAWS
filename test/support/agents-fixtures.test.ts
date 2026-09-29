import { readFileSync, writeFileSync } from 'node:fs';
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import { describe, expect, it } from 'vitest';
import { applyTaskEvents, emptyGraph } from '../../src/renderer/src/tools/agents/model/task-graph';
import { matchesSendMessage } from '../../src/renderer/src/tools/agents/model/relay';
import { phasesOf } from '../../src/renderer/src/tools/agents/model/workflow-progress';
import {
  AGENTS_FIXTURE_FILES,
  AGENTS_RELAY_TAIL,
  AGENTS_STOP_SHELL_TAIL,
  AGENTS_STOP_WORKFLOW_TAIL,
  deriveAgentsRelayFixture,
  deriveAgentsStopShellFixture,
  deriveAgentsStopWorkflowFixture,
  measureAgentsRelay,
  measureAgentsStopShell,
  measureAgentsStopWorkflow,
  serializeAgentsFixture,
} from './agents-fixtures';

// Regenerate the committed fixtures after a deliberate change with:
//   MAWS_WRITE_AGENTS_FIXTURES=1 pnpm test -- test/support/agents-fixtures
const derived = {
  relay: deriveAgentsRelayFixture(),
  stopWorkflow: deriveAgentsStopWorkflowFixture(),
  stopShell: deriveAgentsStopShellFixture(),
};

// The events a tail's batches release, in order, from its first event.
function batchesOf(events: SessionEvent[], first: number, batches: readonly number[]): SessionEvent[][] {
  let at = events.findIndex((event) => event.seq === first);
  return batches.map((count) => {
    const batch = events.slice(at, at + count);
    at += count;
    return batch;
  });
}

describe('agents fixtures are reproducible', () => {
  it.each(Object.keys(derived) as (keyof typeof derived)[])('%s regenerates its committed file byte for byte', (name) => {
    if (process.env.MAWS_WRITE_AGENTS_FIXTURES === '1') writeFileSync(AGENTS_FIXTURE_FILES[name], serializeAgentsFixture(derived[name]));
    expect(readFileSync(AGENTS_FIXTURE_FILES[name], 'utf8')).toBe(serializeAgentsFixture(derived[name]));
  });

  it.each(Object.keys(derived) as (keyof typeof derived)[])('%s is valid X1 with unique ids, ordered seqs and the replay launch in every id', (name) => {
    const events = derived[name];
    for (const event of events) SessionEventSchema.parse(event);
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
    const seqs = events.map((event) => event.seq!);
    expect(seqs.every((seq, i) => i === 0 || seq >= seqs[i - 1])).toBe(true);
    // The task-graph store drops an event whose id names another launch than the status's (`feed` sets `journal`): the
    // launch is the third segment from the right of `<app>:<launch>:<seq>:<n>`.
    expect(events.every((event) => event.id.split(':').at(-3) === 'journal' && event.id.split(':').at(-2) === String(event.seq))).toBe(true);
    const ats = events.slice(-6).map((event) => Date.parse(event.at));
    expect(ats.every((at, i) => i === 0 || at >= ats[i - 1])).toBe(true);
  });

  it('agents-relay: two background agents running, then the SendMessage to the first, then a recorded foreground start', () => {
    const events = derived.relay;
    const measured = measureAgentsRelay(events);
    expect(measured).toEqual({ ...AGENTS_RELAY_TAIL, batches: [...AGENTS_RELAY_TAIL.batches] });
    const history = events.filter((event) => event.seq! < AGENTS_RELAY_TAIL.first);
    const graph = applyTaskEvents(emptyGraph(), history);
    const agents = [...graph.tasks.values()].filter((node) => node.kind === 'agent');
    expect(agents.map((node) => [node.taskId, node.status, node.isBackground])).toEqual([
      [AGENTS_RELAY_TAIL.agentId, 'running', true],
      ['ae75ba6ce5d866acc', 'running', true],
    ]);

    const [toSendMessage, toForeground] = batchesOf(events, AGENTS_RELAY_TAIL.first, AGENTS_RELAY_TAIL.batches);
    expect(toSendMessage.map((event) => event.kind)).toEqual(['assistant.block.complete', 'tool.use']);
    const send = toSendMessage.at(-1)!;
    expect(matchesSendMessage(send, { agentId: AGENTS_RELAY_TAIL.agentId as never, name: null }), 'the SendMessage names the running agent').toBe(true);
    expect(send).toMatchObject({ agentId: null, input: { message: AGENTS_RELAY_TAIL.text } });
    expect(toForeground.map((event) => event.kind)).toEqual(['tool.result', 'subagent.started']);
    expect(toForeground.at(-1)).toMatchObject({ taskId: AGENTS_RELAY_TAIL.foregroundAgentId, isBackground: false });
    // No receipt is appended (O3): nothing after the foreground start, and the first agent's finish is withheld.
    expect(events.at(-1)).toBe(toForeground.at(-1));
    expect(events.some((event) => event.kind === 'subagent.finished')).toBe(false);
    const after = applyTaskEvents(graph, [...toSendMessage, ...toForeground]);
    expect(after.tasks.get(AGENTS_RELAY_TAIL.foregroundAgentId as never)).toMatchObject({ status: 'running', isBackground: false });
  });

  it('agents-stop-workflow: the workflow runs through its last progress frame, then the recorded stop in order', () => {
    const events = derived.stopWorkflow;
    expect(measureAgentsStopWorkflow(events)).toEqual({
      ...AGENTS_STOP_WORKFLOW_TAIL,
      batches: [...AGENTS_STOP_WORKFLOW_TAIL.batches],
      progress: { ...AGENTS_STOP_WORKFLOW_TAIL.progress, frames: [...AGENTS_STOP_WORKFLOW_TAIL.progress.frames] },
    });
    const { taskId, progress } = AGENTS_STOP_WORKFLOW_TAIL;
    let graph = applyTaskEvents(emptyGraph(), events.filter((event) => event.seq! < progress.releaseTo));
    expect(graph.tasks.get(taskId as never)?.workflow?.progress ?? null).toBeNull();
    let at = events.findIndex((event) => event.seq === progress.releaseTo);
    const counts: string[] = [];
    for (const n of progress.frames) {
      graph = applyTaskEvents(graph, events.slice(at, at + n));
      at += n;
      expect(events[at - 1].kind, 'each frame count ends on a progress frame').toBe('workflow.progress');
      const [phase] = phasesOf(graph.tasks.get(taskId as never)!.workflow!.progress);
      counts.push(`${phase.title} ${phase.done}/${phase.total}`);
    }
    expect(counts).toEqual(['Echo 0/2', 'Echo 1/2', 'Echo 2/2']);
    expect(events[at].seq).toBe(AGENTS_STOP_WORKFLOW_TAIL.first);

    const [snapshot, updated, notification] = batchesOf(events, AGENTS_STOP_WORKFLOW_TAIL.first, AGENTS_STOP_WORKFLOW_TAIL.batches);
    expect(snapshot).toEqual([expect.objectContaining({ kind: 'tasks.snapshot', tasks: [] })]);
    expect(updated).toEqual([expect.objectContaining({ kind: 'task.updated', taskId, patch: expect.objectContaining({ status: 'killed' }) })]);
    expect(notification).toEqual([expect.objectContaining({ kind: 'task.notification', taskId, status: 'stopped' })]);
    expect(events.at(-1)).toBe(notification[0]);
    graph = applyTaskEvents(graph, [...snapshot, ...updated, ...notification]);
    expect(graph.tasks.get(taskId as never)?.status).toBe('stopped');
  });

  it('agents-stop-shell: the shell runs with its output path reported, then the recorded stop in order', () => {
    const events = derived.stopShell;
    expect(measureAgentsStopShell(events)).toEqual({ ...AGENTS_STOP_SHELL_TAIL, batches: [...AGENTS_STOP_SHELL_TAIL.batches] });
    const { taskId, outputFile } = AGENTS_STOP_SHELL_TAIL;
    let graph = applyTaskEvents(emptyGraph(), events.filter((event) => event.seq! < AGENTS_STOP_SHELL_TAIL.first));
    expect(graph.tasks.get(taskId as never)).toMatchObject({ kind: 'shell', status: 'running', isBackground: true, outputFile });

    const [snapshot, updated, notification] = batchesOf(events, AGENTS_STOP_SHELL_TAIL.first, AGENTS_STOP_SHELL_TAIL.batches);
    expect(snapshot).toEqual([expect.objectContaining({ kind: 'tasks.snapshot', tasks: [] })]);
    expect(updated).toEqual([expect.objectContaining({ kind: 'task.updated', taskId, patch: expect.objectContaining({ status: 'killed' }) })]);
    expect(notification).toEqual([expect.objectContaining({ kind: 'task.notification', taskId, status: 'stopped', outputFile })]);
    expect(events.at(-1)).toBe(notification[0]);
    graph = applyTaskEvents(graph, [...snapshot, ...updated, ...notification]);
    expect(graph.tasks.get(taskId as never)?.status).toBe('stopped');
  });
});
