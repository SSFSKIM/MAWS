// A terminal session MAWS can drive, for `e2e:lane-a` (P5 O9 M5, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md,
// "The fake bridge in e2e"): no `claude` runs. The session's transcript is seeded in the launch's engine store, a live
// terminal holds it (a registry record naming this test runner's pid, its `procStart` as the engine renders it, as
// sessions.spec.ts's foreign-live scene writes one), and the fake bridge (test/support/fake-bridge.ts) serves its
// socket under the launch's scratch sminos home, with a catalog as the bridge pushes one.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { startFakeBridge, type FakeBridge, type FakeBridgeOptions } from '../../test/support/fake-bridge';
import type { StoreFixture } from '../../test/support/store-fixture';

const run = { class: 'run', enabled: true, measured: '2.1.300' } as const;

// The bridge's catalog: a command that runs with its argument, a panel, one the terminal alone runs, `/mcp` whose
// argument form runs, and the model widgets' routes; three models with their aliases.
export const CATALOG = {
  fingerprint: 'fp-e2e-1',
  commands: [
    { name: 'rename', description: 'Rename the session', source: 'builtin', route: { ...run, forms: { args: 'required', hint: '<name>' } } },
    { name: 'config', description: 'Open config', source: 'builtin', route: { class: 'panel', enabled: true, measured: '2.1.300' } },
    { name: 'doctor', description: 'Diagnose the install', source: 'builtin', route: { class: 'local', enabled: false, reason: 'runs only in the terminal', measured: '2.1.300' } },
    { name: 'mcp', description: 'Manage MCP servers', source: 'builtin', route: { class: 'panel', enabled: true, measured: '2.1.300' }, withArgs: { ...run, forms: { args: 'required', pattern: '(enable|disable|reconnect) .+' } } },
    { name: 'model', description: 'Set the model', source: 'builtin', route: { class: 'routed', to: 'model', enabled: true, measured: '2.1.300' } },
    { name: 'compact', description: 'Compact the conversation', source: 'builtin', route: { class: 'routed', to: 'compact', enabled: true, measured: '2.1.300' } },
  ],
  models: { options: ['opus', 'sonnet', 'haiku'], aliases: { opus: 'claude-opus-4-5', sonnet: 'claude-sonnet-4-5', haiku: 'claude-haiku-4-5', default: null } },
  measured: '2.1.300',
  skills: [],
};

export interface TerminalSession {
  bridge: FakeBridge;
  pid: number;
  close(): Promise<void>; // the bridge's socket goes and the terminal's record with it
}

// The test runner's process as the engine's registry names a live process: its pid and its start time.
function liveProcess(): { pid: number; procStart: string } {
  const pid = process.pid;
  const procStart = execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { env: { LC_ALL: 'C', TZ: 'UTC' }, encoding: 'utf8' }).trim();
  return { pid, procStart };
}

// A terminal holding `sessionId` (its transcript already in `store`), its bridge serving under `sminosHome`.
export async function terminalSession(opts: { store: StoreFixture; sminosHome: string; sessionId: string; cwd: string; bridge?: Partial<FakeBridgeOptions>; bridged?: boolean }): Promise<TerminalSession> {
  const { pid, procStart } = liveProcess();
  const bridge = opts.bridged === false ? null : await startFakeBridge({ home: opts.sminosHome, session: opts.sessionId, pid, sessionInfo: { session: opts.sessionId, cwd: opts.cwd, model: 'claude-opus-4-5', version: '2.1.300' }, ...opts.bridge });
  bridge?.emit({ type: 'catalog', ...CATALOG });
  await opts.store.addRegistryRecord(pid, { pid, sessionId: opts.sessionId, cwd: opts.cwd, kind: 'interactive', procStart, status: 'idle' });
  return {
    get bridge() {
      if (!bridge) throw new Error('this terminal session has no bridge');
      return bridge;
    },
    pid,
    async close() {
      await bridge?.close();
      await opts.store.removeRegistryRecord(pid);
    },
  };
}

// A model reply's rows as the engine writes them: a user prompt, and an assistant text answering it.
export function userRecord(sessionId: string, cwd: string, uuid: string, parentUuid: string | null, text: string, at: string): Record<string, unknown> {
  return { type: 'user', uuid, parentUuid, cwd, sessionId, timestamp: at, isSidechain: false, userType: 'external', version: '2.1.300', message: { role: 'user', content: text } };
}

export function assistantRecord(sessionId: string, cwd: string, uuid: string, parentUuid: string, text: string, at: string): Record<string, unknown> {
  return {
    type: 'assistant', uuid, parentUuid, cwd, sessionId, timestamp: at, isSidechain: false, userType: 'external', version: '2.1.300',
    message: { id: `msg_${uuid.slice(0, 8)}`, type: 'message', role: 'assistant', model: 'claude-opus-4-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 } },
  };
}

// A shell the model ran in the background, as the engine writes it: the Bash call, then its result, whose toolUseResult
// names the task and whose text the output file (the rows main's lane A jobs derivation reads, by sminos's rules).
export function backgroundBashRecords(sessionId: string, cwd: string, parentUuid: string, job: { taskId: string; command: string; description: string; at: string }): Record<string, unknown>[] {
  const call = randomUUID();
  const toolUseId = `toolu_${job.taskId}`;
  const base = { cwd, sessionId, timestamp: job.at, isSidechain: false, userType: 'external', version: '2.1.300' };
  return [
    {
      ...base, type: 'assistant', uuid: call, parentUuid,
      message: { id: `msg_${call.slice(0, 8)}`, type: 'message', role: 'assistant', model: 'claude-opus-4-5', content: [{ type: 'tool_use', id: toolUseId, name: 'Bash', input: { command: job.command, description: job.description, run_in_background: true } }], stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 } },
    },
    {
      ...base, type: 'user', uuid: randomUUID(), parentUuid: call, toolUseResult: { stdout: '', stderr: '', interrupted: false, isImage: false, backgroundTaskId: job.taskId },
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: false, content: `Command running in background with ID: ${job.taskId}. Output is being written to: /tmp/claude/tasks/${job.taskId}.output` }] },
    },
  ];
}

// The rows the engine writes as a turn ends (`stop_hook_summary`, then `turn_duration`), after `parentUuid`.
export function turnEndRecords(sessionId: string, cwd: string, parentUuid: string, at: string): Record<string, unknown>[] {
  const base = { cwd, sessionId, timestamp: at, isSidechain: false, userType: 'external', version: '2.1.300' };
  const summary = randomUUID();
  return [
    { ...base, type: 'system', subtype: 'stop_hook_summary', uuid: summary, parentUuid, hookCount: 0, hookInfos: [], hookErrors: [], preventedContinuation: false, stopReason: '', hasOutput: false, level: 'suggestion' },
    { ...base, type: 'system', subtype: 'turn_duration', uuid: randomUUID(), parentUuid: summary, durationMs: 1200, isMeta: false },
  ];
}

// The engine's notification that a background task ended, as the attachment row it queues for the model.
// `toolUseId`: the call that started the task, which an agent's notification names (2.1.312).
export function taskNotificationRecord(sessionId: string, cwd: string, parentUuid: string, note: { taskId: string; status: string; summary: string; at: string; toolUseId?: string }): Record<string, unknown> {
  const toolUse = note.toolUseId === undefined ? '' : `<tool-use-id>${note.toolUseId}</tool-use-id>\n`;
  return {
    type: 'attachment', uuid: randomUUID(), parentUuid, cwd, sessionId, timestamp: note.at, isSidechain: false, userType: 'external', version: '2.1.300',
    attachment: { type: 'queued_command', commandMode: 'task-notification', prompt: `<task-notification>\n<task-id>${note.taskId}</task-id>\n${toolUse}<status>${note.status}</status>\n<summary>${note.summary}</summary>\n</task-notification>` },
  };
}

// One tool call and its result, then the model's closing answer, as the engine writes a turn's rows after `parentUuid`.
function toolTurn(sessionId: string, cwd: string, parentUuid: string, call: { id: string; name: string; input: Record<string, unknown>; result: string; toolUseResult: Record<string, unknown>; answer: string; at: string }): Record<string, unknown>[] {
  const base = { cwd, sessionId, timestamp: call.at, isSidechain: false, userType: 'external', version: '2.1.300' };
  const [use, result, answer] = [randomUUID(), randomUUID(), randomUUID()];
  const message = (uuid: string, content: unknown[], stop: string) => ({ id: `msg_${uuid.slice(0, 8)}`, type: 'message', role: 'assistant', model: 'claude-opus-4-5', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 } });
  return [
    { ...base, type: 'assistant', uuid: use, parentUuid, message: message(use, [{ type: 'tool_use', id: call.id, name: call.name, input: call.input }], 'tool_use') },
    { ...base, type: 'user', uuid: result, parentUuid: use, toolUseResult: call.toolUseResult, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, is_error: false, content: call.result }] } },
    { ...base, type: 'assistant', uuid: answer, parentUuid: result, message: message(answer, [{ type: 'text', text: call.answer }], 'end_turn') },
  ];
}

// A turn that edited a file: its divider offers Restore files.
export function editTurnRecords(sessionId: string, cwd: string, parentUuid: string, edit: { file: string; at: string }): Record<string, unknown>[] {
  return toolTurn(sessionId, cwd, parentUuid, {
    id: `toolu_${randomUUID().slice(0, 8)}`, name: 'Edit', input: { file_path: edit.file, old_string: 'once', new_string: 'twice' },
    result: `The file ${edit.file} has been updated.`, toolUseResult: { filePath: edit.file, oldString: 'once', newString: 'twice', structuredPatch: [] }, answer: 'Edited.', at: edit.at,
  });
}

// A subagent the model started in the background: the Agent call and its launch result in the main transcript
// (`backgroundAgentRecords`), and the agent's own transcript and meta beside it (`subagents/agent-<id>.*`).
export function backgroundAgentRecords(sessionId: string, cwd: string, parentUuid: string, agent: BackgroundAgent): Record<string, unknown>[] {
  return toolTurn(sessionId, cwd, parentUuid, {
    id: `toolu_${agent.agentId}`, name: 'Agent', input: { description: agent.description, prompt: agent.prompt, subagent_type: 'general-purpose', run_in_background: true },
    result: `Async agent launched successfully.\nagentId: ${agent.agentId} (internal ID - do not mention to user.)`,
    toolUseResult: { isAsync: true, status: 'async_launched', agentId: agent.agentId, description: agent.description, prompt: agent.prompt },
    answer: 'It is working in the background.', at: agent.at,
  });
}

export interface BackgroundAgent {
  agentId: string;
  description: string;
  prompt: string;
  at: string;
}

export async function backgroundAgentSidecars(store: StoreFixture, sessionId: string, cwd: string, agent: BackgroundAgent): Promise<void> {
  await store.addSidecar(sessionId, `subagents/agent-${agent.agentId}.meta.json`, { agentType: 'general-purpose', description: agent.description, toolUseId: `toolu_${agent.agentId}`, spawnDepth: 1, requestShape: 'background' });
  const prompt = { parentUuid: null, isSidechain: true, agentId: agent.agentId, type: 'user', message: { role: 'user', content: agent.prompt }, uuid: randomUUID(), timestamp: agent.at, userType: 'external', cwd, sessionId, version: '2.1.300' };
  await store.addSidecar(sessionId, `subagents/agent-${agent.agentId}.jsonl`, `${JSON.stringify(prompt)}\n`);
}
