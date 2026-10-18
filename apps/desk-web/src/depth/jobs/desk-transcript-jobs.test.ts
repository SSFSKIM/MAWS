// DC9's M5 through the main subscription: a DC8 producer's snapshot and `subagents` messages give the column its jobs,
// MCP names and agent statuses; a job's output is asked for on the subscription and its `output` answer drawn; a
// request an interruption lost is asked again after the fresh snapshot; an older producer's body leaves jobs unknown.
import type { Job, SessionBodies, SubagentMeta } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import { createTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import { FakePlane } from '../../../test/double/fake-plane';
import { DeskTranscript } from '../source/desk-transcript';
import { OUTPUT_TAIL } from './output-requests';

const MAIN = { machine: 'mini', session: 'sess-1', agentId: null };
const PATH = '/private/tmp/claude-501/p/sess-1/tasks/b1.output';
const shell: Job = { taskId: 'b1', kind: 'shell', toolUseId: 'toolu_b1', startedAt: '2026-10-17T10:00:00.000Z', description: 'Run the suites', outputFile: PATH, status: 'running' };
const agent: SubagentMeta = { agentId: 'a1', meta: { agentType: 'general-purpose', description: 'Alpha', toolUseId: 'toolu_a1' }, status: 'exited', evidence: 'session' };
const snapshot = (extra: Partial<SessionBodies['snapshot']> = {}): SessionBodies['snapshot'] => ({ rows: [], more: false, subagents: [], presence: { record: null, bridge: false }, streaming: [], usage: null, ...extra });

function open() {
  const plane = new FakePlane('proj');
  const controller = new DeskTranscript({ plane, project: 'proj', target: MAIN, store: createTranscriptStore() });
  controller.open();
  return { plane, controller, state: () => controller.state.getState() };
}

describe('the main subscription’s jobs', () => {
  it('carries a DC8 producer’s jobs, MCP names and agent statuses, and follows a subagents message', () => {
    const { plane, state } = open();
    plane.send('snapshot', snapshot({ subagents: [agent], jobs: [shell], mcp: [{ name: 'doperpowers' }] }));
    expect(state().jobs).toEqual([shell]);
    expect(state().mcp).toEqual([{ name: 'doperpowers' }]);
    expect(state().tasks.tasks.get('a1' as never)?.status).toBe('exited');
    plane.send('subagents', { subagents: [agent], jobs: [{ ...shell, status: 'completed', endedAt: '2026-10-17T10:02:00.000Z' }], mcp: [] });
    expect(state().jobs?.[0].status).toBe('completed');
    expect(state().mcp).toEqual([]);
  });

  it('leaves jobs unknown for a producer older than DC8, and its agents as DC6 drew them', () => {
    const { plane, state } = open();
    plane.send('snapshot', snapshot({ subagents: [{ agentId: 'a1', meta: agent.meta }] }));
    expect(state().jobs).toBeNull();
    expect(state().mcp).toBeNull();
    expect(state().tasks.tasks.get('a1' as never)?.status).toBe('unknown');
  });

  it('asks for a job’s output on the subscription and draws its answer; asks again after an interruption’s fresh snapshot', () => {
    const { plane, controller } = open();
    plane.send('snapshot', snapshot({ jobs: [shell] }));
    controller.outputs.open('b1');
    expect(plane.current.outputs).toEqual([{ taskId: 'b1', tail: OUTPUT_TAIL }]);
    plane.send('output', { taskId: 'b1', result: 'ok', path: PATH, size: 3, from: 0, text: 'ok\n', truncated: false });
    expect(controller.outputs.state.getState().open.get('b1')).toMatchObject({ phase: 'ok', answer: { text: 'ok\n' } });

    controller.outputs.refresh('b1');
    expect(plane.current.outputs).toHaveLength(2);
    plane.current.listener.interrupted(); // the answer is lost with the subscription
    plane.send('snapshot', snapshot({ jobs: [shell] }));
    expect(plane.current.outputs).toEqual([
      { taskId: 'b1', tail: OUTPUT_TAIL },
      { taskId: 'b1', tail: OUTPUT_TAIL },
      { taskId: 'b1', tail: OUTPUT_TAIL },
    ]);
  });

  it('forgets every output when the transcript closes', () => {
    const { plane, controller } = open();
    plane.send('snapshot', snapshot({ jobs: [shell] }));
    controller.outputs.open('b1');
    controller.close();
    expect(controller.outputs.state.getState().open.size).toBe(0);
  });
});
