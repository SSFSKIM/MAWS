// DC9's M5 proofs of the status patch (`task-feed.ts`, `withStatuses`): DX4's widened `subagents` body patched onto MAWS's
// task graph on the desk side — each status and its evidence, a nested agent placed under the parent its meta or spawn
// record names, DX4's status authoritative over what the held rows' events say (the machine reads the whole transcript
// with DX4's precedence; the web holds a window of it), and a producer older than DC8 drawn as DC6 drew it.
import type { SessionEvent } from '@shared/graph/events';
import type { SubagentMeta, SubagentStatusFacts } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import { agentRows, agentTree, type TaskGraph } from '../../../../../src/renderer/src/tools/agents/model/task-graph';
import { taskGraphOf, withEvents, withStatuses } from './task-feed';

const AT = '2026-10-17T10:00:00.000Z';
const meta = (description: string, extra: Record<string, unknown> = {}) => ({ agentType: 'general-purpose', description, toolUseId: `toolu_${description.replace(/\W/g, '')}`, spawnDepth: 1, ...extra });
const entry = (agentId: string, description: string, facts?: SubagentStatusFacts, extra: Record<string, unknown> = {}): SubagentMeta =>
  ({ agentId, meta: meta(description, extra), ...(facts ?? {}) }) as SubagentMeta;

let seq = 0;
const base = () => ({ id: `e${++seq}` as never, sessionId: 'sess' as never, at: AT, seq: null, agentId: null, parentToolUseId: null });
const started = (taskId: string, description: string): SessionEvent =>
  ({ ...base(), kind: 'subagent.started', taskId, toolUseId: `toolu_${description.replace(/\W/g, '')}`, description, subagentType: 'general-purpose', isBackground: true, spawnDepth: 1, prompt: null }) as unknown as SessionEvent;
const finished = (taskId: string, status: 'completed' | 'failed' | 'stopped'): SessionEvent =>
  ({ ...base(), kind: 'subagent.finished', taskId, status, summary: 'done', outputFile: null, reason: null }) as unknown as SessionEvent;

const statusOf = (graph: TaskGraph, agentId: string) => graph.tasks.get(agentId as never)?.status;
const patched = (metas: SubagentMeta[], events: SessionEvent[] = []) => withStatuses(taskGraphOf(metas, events), metas);

describe('the status patch', () => {
  it('replaces unknown with each status DX4 carries, whatever its evidence', () => {
    const cases: SubagentStatusFacts[] = [
      { status: 'running', evidence: 'bridge', running: true },
      { status: 'running', evidence: 'rows', outcome: { status: 'running', raw: 'async_launched', at: AT } },
      { status: 'completed', evidence: 'rows', outcome: { status: 'completed', raw: 'completed', at: AT, summary: 'all green' } },
      { status: 'failed', evidence: 'rows', outcome: { status: 'failed', raw: 'error', at: AT } },
      { status: 'stopped', evidence: 'rows', outcome: { status: 'stopped', raw: 'killed', at: AT } },
      { status: 'exited', evidence: 'session' },
      { status: 'exited', evidence: 'parent' },
      { status: 'exited', evidence: 'bridge', running: false },
    ];
    const metas = cases.map((facts, i) => entry(`a${i}`, `agent ${i}`, facts));
    const graph = patched(metas);
    cases.forEach((facts, i) => expect(statusOf(graph, `a${i}`), `${facts.status} on ${facts.evidence}`).toBe(facts.status));
    expect(agentRows(graph, 'disk')).toEqual([]); // no recorded agent sits under "On disk"
  });

  it('leaves an agent DX4 leaves unknown as unknown, under the section that says so', () => {
    const graph = patched([entry('a1', 'forked skill', { status: 'unknown', evidence: 'none' })]);
    expect(statusOf(graph, 'a1')).toBe('unknown');
    expect(agentRows(graph, 'disk').map((row) => row.taskId)).toEqual(['a1']);
  });

  it('takes the outcome’s time, summary and output file, and the agent file’s first row as its start', () => {
    const graph = patched([
      entry('a1', 'reader', { status: 'completed', evidence: 'rows', outcome: { status: 'completed', raw: 'completed', at: AT, summary: 'read it', outputFile: '/tmp/x.output' }, file: { size: 10, mtimeMs: 1, firstAt: '2026-10-17T09:59:00.000Z', lastAt: AT } }),
    ]);
    const node = graph.tasks.get('a1' as never)!;
    expect(node).toMatchObject({ endedAt: AT, summary: 'read it', outputFile: '/tmp/x.output', startedAt: '2026-10-17T09:59:00.000Z' });
  });

  it('places a nested agent under the parent its meta names, or failing that its spawn record', () => {
    const metas = [
      entry('parent', 'parent', { status: 'running', evidence: 'bridge', running: true }),
      entry('by-meta', 'by meta', { status: 'running', evidence: 'bridge', running: true }, { parentAgentId: 'parent', spawnDepth: 2 }),
      entry('by-spawn', 'by spawn', { status: 'completed', evidence: 'rows', outcome: { status: 'completed', raw: 'completed', at: AT }, spawn: { parentAgentId: 'parent', subagentType: 'general-purpose', description: 'by spawn' } }),
    ];
    const graph = patched(metas);
    expect(graph.tasks.get('by-spawn' as never)!.agent!.parentAgentId).toBe('parent');
    const rows = agentTree(graph).agents.flatMap((row) => (row.kind === 'agent' ? [[row.taskId, row.depth, row.parentTaskId]] : []));
    expect(rows).toEqual([
      ['parent', 0, null],
      ['by-meta', 1, 'parent'],
      ['by-spawn', 1, 'parent'],
    ]);
  });

  it('names an agent from its spawn record when its meta gives nothing', () => {
    const metas: SubagentMeta[] = [{ agentId: 'a1', meta: {}, status: 'running', evidence: 'bridge', running: true, spawn: { parentAgentId: null, subagentType: 'Explore', description: 'look around', name: 'scout', model: 'haiku' } }];
    const node = withStatuses(taskGraphOf(metas, []), metas).tasks.get('a1' as never)!;
    expect(node.description).toBe('look around');
    expect(node.agent).toMatchObject({ subagentType: 'Explore', name: 'scout', model: 'haiku' });
  });

  it('takes DX4’s status over a terminal one the held rows’ events gave, and drops what that end claimed', () => {
    const metas = [entry('a1', 'alpha', { status: 'running', evidence: 'bridge', running: true }), entry('a2', 'beta', { status: 'exited', evidence: 'session' })];
    const graph = patched(metas, [started('a1', 'alpha'), finished('a1', 'failed'), started('a2', 'beta'), finished('a2', 'completed')]);
    expect(graph.tasks.get('a1' as never)).toMatchObject({ status: 'running', endedAt: null, summary: null });
    expect(graph.tasks.get('a2' as never)).toMatchObject({ status: 'exited', summary: null });
  });

  it('takes DX4’s status over a held running one, and shows DX4’s unknown as unknown', () => {
    const metas = [entry('a1', 'alpha', { status: 'exited', evidence: 'session' }), entry('a2', 'beta', { status: 'unknown', evidence: 'none' })];
    const graph = patched(metas, [started('a1', 'alpha'), started('a2', 'beta')]);
    expect(statusOf(graph, 'a1')).toBe('exited');
    expect(statusOf(graph, 'a2')).toBe('unknown');
  });

  it('takes DX4’s completed over a meta that says the human stopped the agent', () => {
    const metas = [entry('a1', 'alpha', { status: 'completed', evidence: 'rows', outcome: { status: 'completed', raw: 'completed', at: AT } }, { stoppedByUser: true })];
    expect(statusOf(taskGraphOf(metas, []), 'a1')).toBe('stopped'); // MAWS's sidecar rule alone
    expect(statusOf(patched(metas), 'a1')).toBe('completed');
  });

  it('follows the body, not the rows between two bodies: a later body’s status is the status', () => {
    const running = [entry('a1', 'alpha', { status: 'running', evidence: 'rows', outcome: { status: 'running', raw: 'async_launched', at: AT } })];
    const held = withEvents(taskGraphOf(running, [started('a1', 'alpha')]), [finished('a1', 'stopped')]);
    expect(statusOf(withStatuses(held, running), 'a1')).toBe('running');
    const stopped = [entry('a1', 'alpha', { status: 'stopped', evidence: 'rows', outcome: { status: 'stopped', raw: 'killed', at: AT } })];
    expect(statusOf(withStatuses(held, stopped), 'a1')).toBe('stopped');
  });

  it('draws an older producer’s body (agentId and meta alone) as DC6 drew it: the same graph', () => {
    const metas = [entry('a1', 'alpha'), entry('a2', 'beta')];
    const held = taskGraphOf(metas, [started('a1', 'alpha')]);
    expect(withStatuses(held, metas)).toBe(held);
    expect(statusOf(held, 'a2')).toBe('unknown');
    expect(agentRows(held, 'disk').map((row) => row.taskId)).toEqual(['a2']);
  });

  it('keeps the graph’s identity when the body changes nothing', () => {
    const metas = [entry('a1', 'alpha', { status: 'completed', evidence: 'rows', outcome: { status: 'completed', raw: 'completed', at: AT } })];
    const held = taskGraphOf(metas, [started('a1', 'alpha'), finished('a1', 'completed')]);
    const once = withStatuses(held, metas);
    expect(withStatuses(once, metas)).toBe(once);
  });
});
