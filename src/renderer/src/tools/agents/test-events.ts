// Test-only builders for the agent tools' suites (never imported by product code): X1 events of the kinds the task
// graph and the relay read, validated by `SessionEventSchema` so a suite never folds a shape C3 cannot emit, and the
// replayed fixtures through C6's `journalToEvents` (C3's normaliser; ids `replay:journal:<seq>:<n>`, launch `journal`).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionEventSchema, type EventKind, type SessionEvent } from '@shared/graph/events';
import type { AgentId } from '@shared/graph/ids';
import type { SubagentEntry, WorkflowRun } from '@shared/ipc/schema/fs';
import { SubagentMetaSchema, WorkflowSnapshotSchema } from '@shared/wire/store';
import { FIXTURE_DIR, loadJournal, type FixturePass } from '../../../../../test/support/fixtures';
import { journalToEvents } from '../../transcript/dev/journal';

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

export function workflowRunsOf(): WorkflowRun[] {
  const root = join(FIXTURE_DIR, 'pass2/workflow-disk');
  return readdirSync(root)
    .filter((name) => /^wf_.*\.json$/.test(name))
    .map((name) => {
      const snapshot = WorkflowSnapshotSchema.parse(JSON.parse(readFileSync(join(root, name), 'utf8')));
      return { runId: snapshot.runId, snapshot, journal: [] };
    });
}
