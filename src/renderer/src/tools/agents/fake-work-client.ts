// A fake agent-work client for C8b's store suites (test-only; product code never imports it): every call is recorded
// in order and waits until the test answers it, so a race can be staged either way; the four event streams are pushed by
// hand. E7: its files half is a small disk the test fills (`files`, `dirs`), answered at once as main answers
// `files.*` (a missing file or directory is `not found: <path>`), its calls logged apart in `fileCalls`, and
// `files.changed` pushed by hand. It lives beside the stores rather than under test/support because it is typed by the
// renderer's `AgentWorkClient`, whose module reaches `window` through the IPC client, which the node test project
// cannot compile.
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { SubagentEntry } from '@shared/ipc/schema/fs';
import type { FilesChanged, FilesReadOutput } from '@shared/ipc/schema/files'; // E7
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
  // E7 start
  files: Map<string, string>; // path → text
  dirs: Set<string>; // the directories a watch finds
  fileCalls: string[]; // `read <path>`, `watch <path>`, `unwatch <path>`, `on filesChanged`, `off filesChanged`
  refuse: Map<string, string>; // path → the message a read or watch of it fails with (a refusal, an I/O error)
  filesChanged(payload: { appSessionId: string; path: string; kind: FilesChanged['kind'] }): void;
  // E7 end
}

// E7: a stand-in for main's SHA-256 (64 lowercase hex), a function of the text alone.
function fakeFileHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0').repeat(8);
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
  // E7 start
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const refuse = new Map<string, string>();
  const fileCalls: string[] = [];
  const filesListeners = new Set<(payload: FilesChanged) => void>();
  const found = (path: string, present: boolean) =>
    refuse.has(path) ? Promise.reject(new Error(refuse.get(path))) : present ? Promise.resolve() : Promise.reject(new Error(`not found: ${path}`));
  // E7 end
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
    unfollowAgent: async (appSessionId, agentId) => void calls.push(`unfollow ${appSessionId} ${agentId}`),
    steer: (appSessionId, content, priority) => call('steer', `steer ${appSessionId}`, [appSessionId, content, priority]),
    stopTask: (appSessionId, taskId) => call('stopTask', `stopTask ${taskId}`, [appSessionId, taskId]),
    onEventBatch: (listener) => listen(batches, 'eventBatch', listener),
    onSubagentsChanged: (listener) => listen(subagents, 'subagentsChanged', listener),
    onWorkflowChanged: (listener) => listen(workflowsChanged, 'workflowChanged', listener),
    onTasksChanged: () => () => {},
    // E7 start
    readFile: async ({ path, hash }) => {
      fileCalls.push(`read ${path}`);
      await found(path, files.has(path));
      const text = files.get(path)!;
      const bytes = new TextEncoder().encode(text).length;
      const answer: FilesReadOutput = {
        encoding: 'utf8', content: text, bytes, offset: 0, length: bytes, truncated: false, mime: 'application/json', hash: hash ? fakeFileHash(text) : null, utf8: hash ? true : null,
      };
      return answer;
    },
    watchDir: (_appSessionId, path) => {
      fileCalls.push(`watch ${path}`);
      return found(path, dirs.has(path));
    },
    unwatchDir: async (_appSessionId, path) => void fileCalls.push(`unwatch ${path}`),
    onFilesChanged: (listener) => {
      fileCalls.push('on filesChanged');
      filesListeners.add(listener);
      return () => {
        fileCalls.push('off filesChanged');
        filesListeners.delete(listener);
      };
    },
    // E7 end
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
    // E7 start
    files, dirs, fileCalls, refuse,
    filesChanged: ({ appSessionId, path, kind }) => filesListeners.forEach((l) => l({ appSessionId: appSessionId as AppSessionId, path, kind })),
    // E7 end
  };
}
