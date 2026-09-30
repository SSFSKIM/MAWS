// A fake agent-work client for C8b's store suites (test-only; product code never imports it): every call is recorded
// in order and waits until the test answers it, so a race can be staged either way; the four event streams are pushed by
// hand. It lives beside the stores rather than under test/support because it is typed by the renderer's
// `AgentWorkClient`, whose module reaches `window` through the IPC client, which the node test project cannot compile.
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { SubagentEntry } from '@shared/ipc/schema/fs';
import type { AgentWorkClient } from './client';

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type Answerable = 'events' | 'agentEvents' | 'subagents' | 'workflows' | 'steer' | 'stopTask';

export interface FakeAgentWorkClient {
  client: AgentWorkClient;
  calls: string[];
  inputs: Record<Answerable, unknown[][]>;
  answer(name: Answerable, value?: unknown): Promise<void>;
  fail(name: Answerable, message?: string): Promise<void>;
  pending(name: Answerable): number;
  batch(appSessionId: string, events: SessionEvent[]): void;
  subagentsChanged(appSessionId: string, agents: SubagentEntry[]): void;
  workflowChanged(appSessionId: string, runId: string): void;
  listeners(): number; // the event-batch listeners
}

// Lets promise chains settle without a timer (the suites run some cases under fake timers).
export async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

export function fakeAgentWorkClient(): FakeAgentWorkClient {
  const calls: string[] = [];
  const waiting: Record<Answerable, Pending[]> = { events: [], agentEvents: [], subagents: [], workflows: [], steer: [], stopTask: [] };
  const inputs: Record<Answerable, unknown[][]> = { events: [], agentEvents: [], subagents: [], workflows: [], steer: [], stopTask: [] };
  const batches = new Set<(batch: { appSessionId: AppSessionId; events: SessionEvent[] }) => void>();
  const subagents = new Set<(payload: { appSessionId: AppSessionId; agents: SubagentEntry[] }) => void>();
  const workflowsChanged = new Set<(payload: { appSessionId: AppSessionId; runId: string }) => void>();
  const call = <T>(name: Answerable, label: string, args: unknown[]) => {
    calls.push(label);
    inputs[name].push(args);
    return new Promise<T>((resolve, reject) => waiting[name].push({ resolve: resolve as (value: unknown) => void, reject }));
  };
  const listen = <L>(set: Set<L>, label: string, listener: L) => {
    calls.push(`on ${label}`);
    set.add(listener);
    return () => {
      calls.push(`off ${label}`);
      set.delete(listener);
    };
  };
  const client: AgentWorkClient = {
    subagents: (appSessionId) => call('subagents', `subagents ${appSessionId}`, [appSessionId]),
    workflows: (appSessionId) => call('workflows', `workflows ${appSessionId}`, [appSessionId]),
    tasks: async () => [],
    readSpill: () => Promise.reject(new Error('no spills in this fake')),
    events: (appSessionId, afterSeq) => call('events', `events ${appSessionId} ${afterSeq}`, [appSessionId, afterSeq]),
    agentEvents: (appSessionId, agentId) => call('agentEvents', `agentEvents ${appSessionId} ${agentId}`, [appSessionId, agentId]),
    steer: (appSessionId, content, priority) => call('steer', `steer ${appSessionId}`, [appSessionId, content, priority]),
    stopTask: (appSessionId, taskId) => call('stopTask', `stopTask ${taskId}`, [appSessionId, taskId]),
    onEventBatch: (listener) => listen(batches, 'eventBatch', listener),
    onSubagentsChanged: (listener) => listen(subagents, 'subagentsChanged', listener),
    onWorkflowChanged: (listener) => listen(workflowsChanged, 'workflowChanged', listener),
    onTasksChanged: () => () => {},
  };
  const settle = async (name: Answerable, act: (p: Pending) => void) => {
    const next = waiting[name].shift();
    if (!next) throw new Error(`fake agent-work client: no pending ${name}`);
    act(next);
    await flush();
  };
  return {
    client,
    calls,
    inputs,
    answer: (name, value) => settle(name, (p) => p.resolve(value)),
    fail: (name, message = 'failed') => settle(name, (p) => p.reject(new Error(message))),
    pending: (name) => waiting[name].length,
    batch: (appSessionId, events) => batches.forEach((l) => l({ appSessionId: appSessionId as AppSessionId, events })),
    subagentsChanged: (appSessionId, agents) => subagents.forEach((l) => l({ appSessionId: appSessionId as AppSessionId, agents })),
    workflowChanged: (appSessionId, runId) => workflowsChanged.forEach((l) => l({ appSessionId: appSessionId as AppSessionId, runId })),
    listeners: () => batches.size,
  };
}
