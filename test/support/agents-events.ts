// Test builders for C8b's agent-tool suites: X1 events of the kinds the task graph and the relay read, validated by
// `SessionEventSchema` so a suite never folds a shape C3 cannot emit; the replayed fixtures through C6's `journalToEvents`
// (C3's normaliser; ids `replay:journal:<seq>:<n>`, launch `journal`); and the fixture sidecars and runs as C4's
// `fs.subagents` and `fs.workflows` would answer them.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionEventSchema, type EventKind, type SessionEvent } from '@shared/graph/events';
import type { AgentId } from '@shared/graph/ids';
import type { SubagentEntry, WorkflowRun } from '@shared/ipc/schema/fs';
import { SubagentMetaSchema, WorkflowJournalRowSchema, WorkflowSnapshotSchema } from '@shared/wire/store';
import { journalToEvents } from '../../src/renderer/src/transcript/dev/journal';
import { FIXTURE_DIR, loadJournal, type FixturePass } from './fixtures';

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
    messageUuid: 'm1', apiMessageId: 'msg_1', blockIndex: 0, block: { type: 'text', text: '' }, model: 'claude', supersedes: [], aborted: false, userMessageUuids: [],
  },
  'command.lifecycle': { commandUuid: 'cmd-1', state: 'queued' },
  'turn.started': { userMessageUuid: null, origin: 'human' },
  'turn.ended': {
    result: 'success', isError: false, terminalReason: null, resultText: null, durationMs: 1, numTurns: 1, costUsd: 0,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, thinkingTokens: null },
    permissionDenials: [], errors: [], userMessageUuids: [], origin: 'human', resultIndex: null, isEchoReceipt: false,
  },
  'process.exited': { code: 0, signal: null, reason: 'quit', lostAttentionCount: 0, budget: null /* C12 */ },
  'session.state': { state: 'idle' },
};

// `seq` names the live form's journal row; `seq: null` is the disk form. The id carries the launch segment the store
// checks and the event's place in its row (`<app>:<launch>:<seq>:<n>`), launch `journal` and n 0 unless given.
export function event(kind: EventKind, fields: Record<string, unknown> = {}, opts: { seq?: number | null; n?: number; launch?: string; at?: string } = {}): SessionEvent {
  const seq = opts.seq === undefined ? 1 : opts.seq;
  const id = seq === null ? `disk-${kind}-${Math.random().toString(36).slice(2)}` : `app:${opts.launch ?? REPLAY_LAUNCH}:${seq}:${opts.n ?? 0}`;
  const defaults = DEFAULTS[kind];
  if (!defaults) throw new Error(`agents-events: no defaults for ${kind}`);
  const base = { id, sessionId: 'sess-1', at: opts.at ?? '2026-09-29T10:00:00.000Z', seq, agentId: null, parentToolUseId: null };
  return SessionEventSchema.parse({ ...base, kind, ...defaults, ...fields });
}

export function replayed(pass: FixturePass, name: string): SessionEvent[] {
  return journalToEvents(loadJournal(pass, name));
}

// Debt wave 4: the `queued_command` attachment R1's probe read from the live child's transcript after each relay
// (relay-to-child.jsonl's `relay_child_receipt` notes, seq 232 for idle and 351 for busy), rebuilt as the record C4's
// follower reads: the recorded type, timestamp, sidechain flag, agent, attachment type, prompt, origin and meta flag,
// with its key sets checked against the recorded ones. The values the note did not keep (uuids, cwd, branch, the
// rendered reminder) are stand-ins.
export function recordedReceiptRecord(kase: 'idle' | 'busy'): Record<string, unknown> {
  const rows = loadJournal('pass3', 'relay-to-child');
  type Line = { type: string; timestamp: string; isMeta: boolean; userType: string; isSidechain: boolean; origin: { kind: string }; keys: string[]; attachmentType: string; attachmentKeys: string[]; text: string };
  const note = rows.map((r) => r.frame as { event?: string; case?: string; line?: Line }).find((f) => f.event === 'relay_child_receipt' && f.case === kase);
  const child = rows.map((r) => r.frame as { event?: string; case?: string; task_id?: string }).find((f) => f.event === 'relay_child' && f.case === 'background');
  if (!note?.line || !child?.task_id) throw new Error(`agents-events: relay-to-child records no ${kase} receipt`);
  const line = note.line;
  const record: Record<string, unknown> = {
    parentUuid: `stand-in-parent-${kase}`, isSidechain: line.isSidechain, agentId: child.task_id,
    attachment: { type: line.attachmentType, prompt: line.text, source_uuid: `stand-in-source-${kase}`, origin: line.origin, isMeta: line.isMeta },
    type: line.type, uuid: `stand-in-receipt-${kase}`, timestamp: line.timestamp, rendered: [], userType: line.userType, entrypoint: 'sdk-ts',
    cwd: '/private/tmp/maws-probe2-stand-in', sessionId: '56c1ba30-803a-4d00-b548-f24e6778324f', version: '2.1.283', gitBranch: 'HEAD',
  };
  if (JSON.stringify(Object.keys(record)) !== JSON.stringify(line.keys) || JSON.stringify(Object.keys(record.attachment as object)) !== JSON.stringify(line.attachmentKeys)) {
    throw new Error('agents-events: the rebuilt receipt record drifted from the recorded keys');
  }
  return record;
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
      // The run's journal rows as C4 reads them (the fixture keeps `journal.jsonl` beside the run's snapshot).
      const journal = readFileSync(join(root, 'journal.jsonl'), 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => WorkflowJournalRowSchema.parse(JSON.parse(line)));
      return { runId: snapshot.runId, snapshot, journal };
    });
}
