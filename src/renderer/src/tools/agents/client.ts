// The agent-work client (C8b execution document, Interfaces *The agent-work client*): the one object through which the
// agent tools and their stores reach X2. Its disk half (the engine store's sidecars, workflow runs, task lists and
// spills with their change events), its command half (the relay's steer, Stop) and its wire half (`session.events` and
// `session.eventBatch`, the only wire inputs of the task-graph store and the relay store). The product uses the
// validated bridge; the `#panel` harness and the tests install a fake with `setAgentWorkClient`. C6's `ipcSource` is
// not behind this seam: the drill-in mounts it as it is (K2).
import type { AgentId, AppSessionId, MessageUuid, TaskId } from '@shared/graph/ids';
import type { SessionEvent } from '@shared/graph/events';
import type { CommandName, CommandResult, EventPayload, MawsBridge } from '@shared/ipc/schema';
import type { FsReadSpillInput, FsReadSpillOutput, SubagentEntry, WorkflowRun } from '@shared/ipc/schema/fs';
import type { EventsSnapshot } from '@shared/ipc/schema/session';
import type { PersistedTask } from '@shared/wire/store';
import { ipc } from '../../ipc/client';

export interface AgentWorkClient {
  subagents(appSessionId: AppSessionId): Promise<SubagentEntry[]>;
  workflows(appSessionId: AppSessionId): Promise<WorkflowRun[]>;
  tasks(listId: string): Promise<PersistedTask[]>;
  readSpill(input: FsReadSpillInput): Promise<FsReadSpillOutput>;
  events(appSessionId: AppSessionId, afterSeq: number | null): Promise<EventsSnapshot>; // session.events { afterSeq, limit: null }
  agentEvents(appSessionId: AppSessionId, agentId: AgentId): Promise<SessionEvent[]>; // fs.agentEvents: a child's transcript so far, following it (later events on session.eventBatch); debt wave 4, the relay's receipt
  unfollowAgent(appSessionId: AppSessionId, agentId: AgentId): Promise<void>; // fs.unfollow for that child only: releases the follow agentEvents started
  steer(appSessionId: AppSessionId, content: string, priority: 'next'): Promise<{ messageUuid: MessageUuid }>; // the relay never sends 'now'
  stopTask(appSessionId: AppSessionId, taskId: TaskId): Promise<void>; // bounded, 8 s
  onEventBatch(listener: (batch: { appSessionId: AppSessionId; events: SessionEvent[] }) => void): () => void;
  onSubagentsChanged(listener: (payload: EventPayload<'fs.subagentsChanged'>) => void): () => void;
  onWorkflowChanged(listener: (payload: EventPayload<'fs.workflowChanged'>) => void): () => void;
  onTasksChanged(listener: (payload: EventPayload<'fs.tasksChanged'>) => void): () => void;
}

const valueOf = <N extends CommandName>(result: CommandResult<N>) => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

export function createAgentWorkClient(bridge: MawsBridge): AgentWorkClient {
  return {
    subagents: async (appSessionId) => valueOf(await bridge.invoke('fs.subagents', { appSessionId })).agents,
    workflows: async (appSessionId) => valueOf(await bridge.invoke('fs.workflows', { appSessionId })).runs,
    tasks: async (listId) => valueOf(await bridge.invoke('fs.tasks', { listId })).tasks,
    readSpill: async (input) => valueOf(await bridge.invoke('fs.readSpill', input)),
    events: async (appSessionId, afterSeq) => valueOf(await bridge.invoke('session.events', { appSessionId, afterSeq, limit: null })),
    agentEvents: async (appSessionId, agentId) => valueOf(await bridge.invoke('fs.agentEvents', { appSessionId, agentId })).events,
    unfollowAgent: async (appSessionId, agentId) => valueOf(await bridge.invoke('fs.unfollow', { appSessionId, agentId })),
    steer: async (appSessionId, content, priority) => valueOf(await bridge.invoke('session.steer', { appSessionId, content, priority })),
    stopTask: async (appSessionId, taskId) => valueOf(await bridge.invoke('session.stopTask', { appSessionId, taskId })),
    onEventBatch: (listener) => bridge.on('session.eventBatch', listener),
    onSubagentsChanged: (listener) => bridge.on('fs.subagentsChanged', listener),
    onWorkflowChanged: (listener) => bridge.on('fs.workflowChanged', listener),
    onTasksChanged: (listener) => bridge.on('fs.tasksChanged', listener),
  };
}

let product: AgentWorkClient | null = null;
let installed: AgentWorkClient | null = null;

// The harness installs its fake here; null restores the bridge's. The product never calls it.
export function setAgentWorkClient(client: AgentWorkClient | null): void {
  installed = client;
}

export function agentWorkClient(): AgentWorkClient {
  return installed ?? (product ??= createAgentWorkClient(ipc));
}
