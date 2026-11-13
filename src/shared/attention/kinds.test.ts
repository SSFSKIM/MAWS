// UC-1 (the UX wave's U1a, Interfaces §A): the one definition of waiting. An item waits while `pending` alone; an answer
// written (`delivered`) waits nowhere, though the engine has not yet shown that it acted.
import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '../graph/attention';
import type { AgentId, AppSessionId, AttentionId, RequestId, TaskId, ToolUseId } from '../graph/ids';
import * as kinds from './kinds';
import { waitingAgents, waitingByCall, waits, waitsOnAnswer } from './kinds';

const at = (minute: number) => `2026-11-12T10:${String(minute).padStart(2, '0')}:00.000Z`;
function entry(id: string, over: Partial<AttentionItem> & { call?: string | null; agent?: string | null; task?: string | null; request?: AttentionItem['request'] } = {}): AttentionItem {
  const { call = null, agent = null, task = null, ...rest } = over;
  return {
    id: id as AttentionId,
    appSessionId: 'app-1' as AppSessionId,
    sessionId: null,
    kind: 'permission',
    request: { requestId: `req-${id}` as RequestId, toolUseId: call as ToolUseId | null, taskId: task as TaskId | null, agentId: agent as AgentId | null },
    summary: 'Bash: echo made-up',
    createdAt: at(0),
    state: 'pending',
    stateChangedAt: at(0),
    expiresAt: null,
    ...rest,
  };
}

describe('waits', () => {
  it('holds for a pending item alone', () => {
    expect(waits({ state: 'pending' })).toBe(true);
    for (const state of ['delivered', 'confirmed', 'retired'] as const) expect(waits({ state }), state).toBe(false);
  });

  it('waitsOnAnswer adds a request id: a waiting notice is no request', () => {
    expect(waitsOnAnswer(entry('a'))).toBe(true);
    expect(waitsOnAnswer(entry('a', { state: 'delivered' }))).toBe(false);
    expect(waitsOnAnswer(entry('n', { kind: 'error', request: { requestId: null, toolUseId: null, taskId: null, agentId: null } }))).toBe(false);
  });

  it('is the only definition: the old two-state predicate is gone', () => {
    expect('isOpen' in kinds).toBe(false);
  });
});

describe('waitingByCall', () => {
  it('maps each waiting request to its call, oldest first when two name one call; answered and confirmed items are not in it', () => {
    const map = waitingByCall([
      entry('pending', { call: 'toolu_1', createdAt: at(2) }),
      entry('delivered', { call: 'toolu_2', state: 'delivered' }),
      entry('confirmed', { call: 'toolu_3', state: 'confirmed' }),
      entry('older', { call: 'toolu_1', kind: 'question', createdAt: at(1) }),
      entry('no-call'),
      entry('notice', { call: 'toolu_4', kind: 'error', request: { requestId: null, toolUseId: 'toolu_4' as ToolUseId, taskId: null, agentId: null } }),
    ]);
    expect([...map.keys()]).toEqual(['toolu_1']);
    expect(map.get('toolu_1' as ToolUseId)?.id).toBe('older');
  });
});

describe('waitingAgents', () => {
  it('names every agent and every agent task with a request of its own waiting, and none whose request was answered', () => {
    const agents = waitingAgents([
      entry('pending', { agent: 'agent-a', task: 'task-a' }),
      entry('delivered', { agent: 'agent-b', task: 'task-b', state: 'delivered' }),
      entry('confirmed', { agent: 'agent-c', state: 'confirmed' }),
      entry('main'),
    ]);
    expect([...agents].sort()).toEqual(['agent-a', 'task-a']);
  });
});
