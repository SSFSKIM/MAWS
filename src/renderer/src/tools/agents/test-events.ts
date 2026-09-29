// Test-only builders for the agent tools' suites (never imported by product code): X1 events of the kinds the task
// graph and the relay read, validated by `SessionEventSchema` so a suite never folds a shape C3 cannot emit, and the
// replayed fixtures through C6's `journalToEvents` (C3's normaliser; ids `replay:journal:<seq>:<n>`, launch `journal`).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionEventSchema, type EventKind, type SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId } from '@shared/graph/ids';
import type { SubagentEntry, WorkflowRun } from '@shared/ipc/schema/fs';
import { SubagentMetaSchema, WorkflowSnapshotSchema } from '@shared/wire/store';
import { FIXTURE_DIR, loadJournal, type FixturePass } from '../../../../../test/support/fixtures';
import { journalToEvents } from '../../transcript/dev/journal';
import type { AgentWorkClient } from './client';

export const REPLAY_LAUNCH = 'journal'; // the launch segment of every replayed event id

const DEFAULTS: Partial<Record<EventKind, Record<string, unknown>>> = {
  'subagent.started': { taskId: 'agent-1', toolUseId: null, description: 'child', subagentType: null, isBackground: true, spawnDepth: 1, prompt: null },
  'subagent.progress': { taskId: 'agent-1', description: 'Working', usage: { totalTokens: 0, toolUses: 0, durationMs: 0 }, lastToolName: null, summary: null },
  'subagent.finished': { taskId: 'agent-1', status: 'completed', summary: null, outputFile: null, reason: null },
  'task.started': { taskId: 'task-1', toolUseId: null, taskType: 'local_bash', description: 'task', isBackground: true, workflowName: null },
  'task.updated': { taskId: 'task-1', patch: {} },
  'task.notification': { taskId: 'task-1', toolUseId: null, status: 'completed', summary: '', outputFile: null, reason: null },
  'tasks.snapshot': { tasks: [] },
  'workflow.progress': { taskId: 'task-1', workflowName: null, progress: [] },
  'tool.use': { toolUseId: 'toolu_1', toolName: 'Bash', input: {}, apiMessageId: null, messageUuid: null },
  'tool.result': { toolUseId: 'toolu_1', content: '', isError: false, structured: null, spillPath: null, denial: null, safeguard: 'not_evaluated', messageUuid: null },
  'user.message': { messageUuid: null, content: '', isReplay: false, isSynthetic: false, origin: null, bash: null },
  'assistant.block.complete': {
    messageUuid: 'm1', apiMessageId: 'msg_1', blockIndex: 0, block: { type: 'text', text: '' }, model: 'claude', supersedes: null, aborted: false, userMessageUuids: [],
  },
  'command.lifecycle': { commandUuid: 'cmd-1', state: 'queued' },
  'turn.started': { userMessageUuid: null, origin: 'human' },
  'turn.ended': {
    result: 'success', isError: false, terminalReason: null, resultText: null, durationMs: 1, numTurns: 1, costUsd: 0,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, thinkingTokens: null },
    permissionDenials: [], errors: [], userMessageUuids: [], origin: 'human', resultIndex: null, isEchoReceipt: false,
  },
  'process.exited': { code: 0, signal: null, reason: 'quit', lostAttentionCount: 0 },
  'session.state': { state: 'idle' },
};

// `seq` names the live form's journal row; `seq: null` is the disk form. The id carries the launch segment the store
// checks (`<app>:<launch>:<seq>:<n>`), `journal` unless given.
export function event(kind: EventKind, fields: Record<string, unknown> = {}, opts: { seq?: number | null; launch?: string; at?: string } = {}): SessionEvent {
  const seq = opts.seq === undefined ? 1 : opts.seq;
  const id = seq === null ? `disk-${kind}-${Math.random().toString(36).slice(2)}` : `app:${opts.launch ?? REPLAY_LAUNCH}:${seq}:0`;
  const defaults = DEFAULTS[kind];
  if (!defaults) throw new Error(`test-events: no defaults for ${kind}`);
  const base = { id, sessionId: 'sess-1', at: opts.at ?? '2026-09-29T10:00:00.000Z', seq, agentId: null, parentToolUseId: null };
  return SessionEventSchema.parse({ ...base, kind, ...defaults, ...fields });
}

export function replayed(pass: FixturePass, name: string): SessionEvent[] {
  return journalToEvents(loadJournal(pass, name));
}

export const upTo = (events: SessionEvent[], seq: number) => events.filter((e) => e.seq !== null && e.seq <= seq);
export const after = (events: SessionEvent[], seq: number) => events.filter((e) => e.seq !== null && e.seq > seq);

// The fixture directories as C4's `fs.subagents` and `fs.workflows` would answer them (sizes and times are the files').
export function sidecarsOf(dir: 'subagent-sidecars' | 'pass3/nested-agents-sidecars' | 'pass2/workflow-disk', runId: string | null = null): SubagentEntry[] {
  const root = join(FIXTURE_DIR, dir);
  return readdirSync(root)
    .filter((name) => /^agent-.*\.meta\.json$/.test(name))
    .sort()
    .map((name) => {
      const agentId = name.slice('agent-'.length, -'.meta.json'.length) as AgentId;
      const transcriptPath = join(root, `agent-${agentId}.jsonl`);
      return { agentId, meta: SubagentMetaSchema.parse(JSON.parse(readFileSync(join(root, name), 'utf8'))), transcriptPath, size: 100, mtimeMs: 1_790_000_000_000, runId };
    });
}

// A fake agent-work client for the store suites: every call is recorded in order and waits until the test answers it
// (so a race can be staged either way); the four event streams are pushed by hand.
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type Answerable = 'events' | 'subagents' | 'workflows' | 'steer' | 'stopTask';

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
  const waiting: Record<Answerable, Pending[]> = { events: [], subagents: [], workflows: [], steer: [], stopTask: [] };
  const inputs: Record<Answerable, unknown[][]> = { events: [], subagents: [], workflows: [], steer: [], stopTask: [] };
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

export function workflowRunsOf(): WorkflowRun[] {
  const root = join(FIXTURE_DIR, 'pass2/workflow-disk');
  return readdirSync(root)
    .filter((name) => /^wf_.*\.json$/.test(name))
    .map((name) => {
      const snapshot = WorkflowSnapshotSchema.parse(JSON.parse(readFileSync(join(root, name), 'utf8')));
      return { runId: snapshot.runId, snapshot, journal: [] };
    });
}
