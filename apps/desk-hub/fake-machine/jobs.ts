// DX4's jobs and agent status (composite DX4, "Jobs and agent status", "Precedence"), as the fake machine derives them:
// pure functions over a loop's transcript rows (plus each agent's own rows, for a nested agent's outcome), the session
// tree's metas, the bridge's agent state, and whether the session's process runs. DC8's shared vectors pin it
// (dx4/dx4-jobs.json, whose `about` is normative where DX4's prose is open); the plane derives the same body from the
// same inputs, so a cold open and an open subscription agree, and so do the two producers.
import type { JsonObject } from '../src/protocol/json';
import type { AgentFile, Job, JobStatus, McpServer, SubagentMeta, SubagentOutcome, SubagentSpawn, SubagentStatus, SubagentStatusFacts } from '../src/protocol/session';

/** The one normalization table: every raw status word a row carries, to DX4's status and whether it is terminal. */
export const TABLE: Readonly<Record<string, { status: Exclude<SubagentStatus, 'exited' | 'unknown'>; terminal: boolean }>> = {
  completed: { status: 'completed', terminal: true },
  failed: { status: 'failed', terminal: true },
  error: { status: 'failed', terminal: true },
  stopped: { status: 'stopped', terminal: true },
  killed: { status: 'stopped', terminal: true },
  cancelled: { status: 'stopped', terminal: true },
  interrupted: { status: 'stopped', terminal: true },
  running: { status: 'running', terminal: false },
  pending: { status: 'running', terminal: false },
};

/** The engine's expiry lines for a monitor's statusless notice (2.1.300): its end. */
const EXPIRY = /^(\[Monitor expired after |\[Monitor timed out)/;
const LAUNCHED = 'async_launched';

/**
 * The engine's launch texts for an agent that runs in the background, matched exactly: `Async agent launched
 * successfully.`, optionally a space and a parenthesis closed on that line, then a line `agentId: …` (2.1.2xx–2.1.300,
 * some written without a toolUseResult); or a fork's `Fork started — processing in background`.
 */
const LAUNCH = /^Async agent launched successfully\.(?: \([^\n]*\))?\nagentId: /;
const FORK_LAUNCH = 'Fork started — processing in background';
const isLaunchText = (text: string) => text === FORK_LAUNCH || LAUNCH.test(text);

/** One row's word about a task or an agent, before the table: what the fold reads. */
type Word = { raw: string | null; at: string; summary?: string; outputFile?: string; event?: string };

/** A row that names a task: by its task id, or, for an agent's result or notification, by the call's tool-use id. */
type Mention = Word & { taskId: string | null; toolUseId: string | null; from: 'result' | 'notification' | 'task_status' | 'stop' | 'note' };

type Call = { name: string; input: JsonObject; at: string };
type Started = { taskId: string; kind: Job['kind']; toolUseId: string; startedAt: string; description: string; command?: string };

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const obj = (value: unknown): JsonObject | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null);
const blocksOf = (row: JsonObject): JsonObject[] => {
  const content = obj(row.message)?.content;
  return Array.isArray(content) ? content.filter((b): b is JsonObject => obj(b) !== null) : [];
};
const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map((b) => str(obj(b)?.text) ?? '').join('') : '';

/** A `<task-notification>`'s elements, each trimmed; absent when not there. */
function notification(prompt: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ['task-id', 'tool-use-id', 'output-file', 'status', 'summary', 'event']) {
    const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(prompt);
    if (match) out[name] = match[1].trim();
  }
  return out;
}

const PREAMBLE = '[SYSTEM NOTIFICATION - NOT USER INPUT]\n';
const OPENING = '<task-notification>';

/**
 * The notification a plain user row carries, or null: the form the engine writes when a notification starts a turn
 * (bare in the main transcript; after its fixed preamble, then a blank line, in a subagent's). Only a row the engine
 * marked `origin.kind: task-notification` is one: a person can type the same text, and a peer's message can quote it.
 */
function plainNotification(row: JsonObject): string | null {
  if (obj(row.origin)?.kind !== 'task-notification') return null;
  const content = obj(row.message)?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) ? blocksOf(row).filter((b) => b.type === 'text').map((b) => str(b.text) ?? '').join('') : '';
  if (text.startsWith(OPENING)) return text;
  if (!text.startsWith(PREAMBLE)) return null;
  const at = text.indexOf(`\n\n${OPENING}`);
  return at < 0 ? null : text.slice(at + 2);
}

// The bridge's notes of tasks it stopped (DC10; DX4's rule in the vectors' `about`): a plugin's TaskStop writes no row,
// and the engine queues no notification for a main-loop task it stops, so the note the bridge appends is the rows' word.
// Known by the whole text of a user row kept isMeta with the plugin's origin (a steer's row is kept so too): a stop's
// note is that whole text; an interrupt's is its origin line, then only lines naming each task it moved to the
// background, stopped or not. Only a stopped line is evidence; a text with any other line is no note.
const TASK = '([A-Za-z0-9_-]{1,64})';
const STOP_NOTE = new RegExp(`^Task ${TASK}, a background task, was stopped from (?:the desk|outside the terminal): it is not running\\.$`);
const INTERRUPT_ORIGINS = new Set(['The interrupt came from the desk.', 'The interrupt came from outside the terminal.']);
const INTERRUPT_STOPPED = new RegExp(`^Task ${TASK}, the Bash command the interrupt moved to the background, was then stopped: it is not running, and no notification will come for it\\.$`);
const INTERRUPT_RUNNING = new RegExp(`^Task ${TASK}, the Bash command the interrupt moved to the background, could not be stopped: it may still be running\\.$`);

/** The note's text for a stop the bridge ran (`from` the desk, or another surface outside the terminal). */
export const stopNote = (taskId: string, from: 'desk' | 'outside' = 'desk'): string =>
  `Task ${taskId}, a background task, was stopped from ${from === 'desk' ? 'the desk' : 'outside the terminal'}: it is not running.`;

/** Each task a bridge's note in this row says it stopped, with the line saying so; none for any other row. */
function noteStops(row: JsonObject): Array<{ taskId: string; line: string }> {
  if (row.type !== 'user' || row.isMeta !== true || obj(row.origin)?.kind !== 'plugin') return [];
  const text = textOf(obj(row.message)?.content);
  const whole = STOP_NOTE.exec(text);
  if (whole) return [{ taskId: whole[1], line: text }];
  const [first, ...lines] = text.split('\n');
  if (!INTERRUPT_ORIGINS.has(first)) return [];
  const out: Array<{ taskId: string; line: string }> = [];
  for (const line of lines) {
    const stopped = INTERRUPT_STOPPED.exec(line);
    if (stopped) out.push({ taskId: stopped[1], line });
    else if (!INTERRUPT_RUNNING.test(line)) return [];
  }
  return out;
}

/** The path a background Bash result's text names after "Output is being written to:", a trailing '.' dropped. */
function bashOutputPath(text: string): string | null {
  const match = /Output is being written to: (\S+)/.exec(text);
  return match ? match[1].replace(/\.$/, '') : null;
}

/**
 * One loop's index, fed its rows in file order: the calls and results that start jobs and end agents, each row naming a
 * task, the latest output path each task's rows named, and the loop's MCP server names. The fake machine keeps one per
 * transcript and feeds it as rows reach the disk; nothing is read twice.
 */
export class LoopIndex {
  private readonly calls = new Map<string, Call>();
  /** Each row naming a task or an agent, in row order. */
  readonly mentions: Mention[] = [];
  /** Background shells and monitors, in the order of their start rows. */
  readonly started: Started[] = [];
  readonly monitors = new Set<string>();
  /** Agent calls the engine ran in the background by their own input (`run_in_background` true, or the string "true"). */
  readonly backgroundCalls = new Set<string>();
  /** The latest output path a row named for each task id. */
  readonly paths = new Map<string, string>();
  /** Task ids some row names as a job, a notification, or a `task_status`: what `output` serves. */
  readonly known = new Set<string>();
  readonly mcp: string[] = [];

  feed(row: JsonObject): void {
    const at = str(row.timestamp) ?? '';
    if (row.type === 'assistant') {
      for (const b of blocksOf(row)) {
        if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') this.calls.set(b.id, { name: b.name, input: obj(b.input) ?? {}, at });
      }
      return;
    }
    if (row.type === 'attachment') return this.attachment(obj(row.attachment) ?? {}, at);
    if (row.type !== 'user') return;
    const plain = plainNotification(row);
    if (plain !== null) return this.notified(plain, at);
    for (const { taskId, line } of noteStops(row)) {
      this.known.add(taskId);
      this.mentions.push({ from: 'note', taskId, toolUseId: null, raw: 'stopped', at, summary: line });
    }
    for (const b of blocksOf(row)) if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') this.result(b, row.toolUseResult, at);
  }

  private result(block: JsonObject, toolUseResult: unknown, at: string): void {
    const id = block.tool_use_id as string;
    const call = this.calls.get(id);
    if (!call) return;
    const isError = block.is_error === true;
    const result = obj(toolUseResult);
    if (call.name === 'Agent' || call.name === 'Task') {
      const status = str(result?.status);
      // Where the engine wrote a toolUseResult, its status alone says whether this is a launch: a foreground agent's
      // answer may begin with the launch text. Only a row written without one is read by its text.
      const written = toolUseResult !== undefined && toolUseResult !== null;
      const launch = written ? status === LAUNCHED : !isError && isLaunchText(textOf(block.content));
      const raw = launch ? LAUNCHED : isError ? 'error' : (status ?? 'completed');
      // A launch written without a toolUseResult names no output file.
      const outputFile = status === LAUNCHED ? str(result?.outputFile) : null;
      const background = call.input.run_in_background === true || call.input.run_in_background === 'true';
      if (background) this.backgroundCalls.add(id);
      this.mentions.push({ from: 'result', taskId: null, toolUseId: id, raw, at, ...(outputFile !== null && { outputFile }) });
    } else if (call.name === 'Bash' && typeof result?.backgroundTaskId === 'string') {
      const taskId = result.backgroundTaskId;
      this.start({ taskId, kind: 'shell', toolUseId: id, startedAt: call.at, ...this.described(call) });
      const path = bashOutputPath(textOf(block.content));
      if (path !== null) this.paths.set(taskId, path);
    } else if (call.name === 'Monitor' && typeof result?.taskId === 'string') {
      this.monitors.add(result.taskId);
      this.start({ taskId: result.taskId, kind: 'monitor', toolUseId: id, startedAt: call.at, ...this.described(call) });
    } else if (call.name === 'TaskStop' && !isError && typeof call.input.task_id === 'string') {
      const message = str(result?.message);
      this.mentions.push({ from: 'stop', taskId: call.input.task_id, toolUseId: null, raw: 'stopped', at, ...(message !== null && { summary: message }) });
    }
  }

  private described(call: Call): { description: string; command?: string } {
    const command = str(call.input.command);
    return { description: str(call.input.description) ?? '', ...(command !== null && { command }) };
  }

  private start(job: Started): void {
    this.started.push(job);
    this.known.add(job.taskId);
  }

  private attachment(a: JsonObject, at: string): void {
    if (a.type === 'queued_command' && a.commandMode === 'task-notification' && typeof a.prompt === 'string') return this.notified(a.prompt, at);
    if (a.type === 'task_status' && typeof a.taskId === 'string') {
      const summary = str(a.deltaSummary);
      const outputFile = str(a.outputFilePath);
      this.known.add(a.taskId);
      if (outputFile !== null) this.paths.set(a.taskId, outputFile);
      this.mentions.push({ from: 'task_status', taskId: a.taskId, toolUseId: null, raw: str(a.status), at, ...(summary !== null && { summary }), ...(outputFile !== null && { outputFile }) });
      return;
    }
    if (a.type === 'mcp_instructions_delta') {
      for (const name of Array.isArray(a.removedNames) ? a.removedNames : []) {
        const i = this.mcp.indexOf(String(name));
        if (i >= 0) this.mcp.splice(i, 1);
      }
      for (const name of Array.isArray(a.addedNames) ? a.addedNames : []) if (!this.mcp.includes(String(name))) this.mcp.push(String(name));
    }
  }

  private notified(prompt: string, at: string): void {
    const n = notification(prompt);
    const taskId = n['task-id'] ?? null;
    if (taskId !== null) this.known.add(taskId);
    if (taskId !== null && n['output-file'] !== undefined) this.paths.set(taskId, n['output-file']);
    this.mentions.push({
      from: 'notification',
      taskId,
      toolUseId: n['tool-use-id'] ?? null,
      raw: n.status ?? null,
      at,
      ...(n.summary !== undefined && { summary: n.summary }),
      ...(n['output-file'] !== undefined && { outputFile: n['output-file'] }),
      ...(n.event !== undefined && { event: n.event }),
    });
  }
}

/** A word through the table, the launch rule, and the expiry rule: its status and whether it ends the task, or null
 * for no evidence. `monitor`: the task is one the loop holds as a monitor. */
function judge(m: Mention, monitor: boolean): { status: Exclude<SubagentStatus, 'exited' | 'unknown'>; raw: string; terminal: boolean; summary?: string } | 'unrecognized' | null {
  if (m.raw === null) {
    // A statusless notice: a monitor's expiry line ends it; any other (a monitor's event, a resumed agent) is nothing.
    if (m.from === 'notification' && monitor && m.event !== undefined && EXPIRY.test(m.event)) return { status: 'completed', raw: 'expired', terminal: true, summary: m.event };
    return null;
  }
  if (m.from === 'result' && m.raw === LAUNCHED) return { status: 'running', raw: LAUNCHED, terminal: false };
  const known = Object.hasOwn(TABLE, m.raw) ? TABLE[m.raw] : undefined;
  return known ? { ...known, raw: m.raw } : 'unrecognized';
}

type Outcome = SubagentOutcome & { terminal: boolean };

/** An outcome as the body carries it: without the fold's own `terminal`. */
const outcomeFacts = ({ status, raw, at, summary, outputFile }: Outcome): SubagentOutcome => ({
  status,
  raw,
  at,
  ...(summary !== undefined && { summary }),
  ...(outputFile !== undefined && { outputFile }),
});

/**
 * Folds a task's or an agent's mentions in row order: a recognized word replaces the outcome unless the outcome is
 * terminal and the word is not; an unrecognized word replaces only the `raw` of an outcome there is. `from`: where the
 * fold starts (a job starts running from its start row; an agent from nothing).
 */
function fold(mentions: Mention[], monitor: boolean, from: Outcome | null): Outcome | null {
  let outcome = from;
  for (const m of mentions) {
    const word = judge(m, monitor);
    if (word === null) continue;
    if (word === 'unrecognized') {
      if (outcome) outcome = { ...outcome, raw: m.raw! };
      continue;
    }
    if (outcome?.terminal && !word.terminal) continue;
    const summary = word.summary ?? m.summary;
    outcome = { status: word.status, raw: word.raw, at: m.at, terminal: word.terminal, ...(summary !== undefined && { summary }), ...(m.outputFile !== undefined && { outputFile: m.outputFile }) };
  }
  return outcome;
}

/** The bridge's agent state: DX5's snapshot `agents`, every `agent` spawn and stop applied (or a seed's entries). */
export type BridgeAgent = { agentId: string; parentAgentId: string | null; subagentType: string; description: string; name?: string | null; background?: boolean; model?: string; toolUseId?: string | null; agentType?: string; running: boolean };

/** One agent transcript as the derivation reads it: its index (a nested agent's outcome is in its parent's) and its
 * file facts. */
export type AgentLoop = { index: LoopIndex; file: AgentFile };

export type Derivation = {
  session: { id: string; running: boolean };
  main: LoopIndex;
  metas: Array<{ agentId: string; meta: JsonObject }>;
  /** Each agent's transcript; null or absent where the file is gone or unreadable. */
  agents: Record<string, AgentLoop | null | undefined>;
  bridge: { agents: BridgeAgent[] } | null;
};

export type Body = { subagents: Array<SubagentMeta & SubagentStatusFacts>; jobs: Job[]; mcp: McpServer[] };

const SPAWN_FIELDS = ['parentAgentId', 'subagentType', 'description', 'name', 'background', 'model', 'toolUseId'] as const;
const ENDED = new Set<SubagentStatus>(['completed', 'failed', 'stopped', 'exited']);

/** DX4's widened `subagents` body: each meta's agent with its status and what it rests on, the loop's jobs, its MCP names. */
export function derive(d: Derivation): Body {
  const running = d.session.running;
  const bridged = new Map((d.bridge?.agents ?? []).map((a) => [a.agentId, a]));
  const metas = new Map(d.metas.map((m) => [m.agentId, m.meta]));
  const statuses = new Map<string, { status: SubagentStatus; evidence: SubagentStatusFacts['evidence']; outcome: Outcome | null }>();

  const parentOf = (agentId: string): string | null => str(metas.get(agentId)?.parentAgentId) ?? bridged.get(agentId)?.parentAgentId ?? null;
  const statusOf = (agentId: string, seen = new Set<string>()): { status: SubagentStatus; evidence: SubagentStatusFacts['evidence']; outcome: Outcome | null } => {
    const held = statuses.get(agentId);
    if (held) return held;
    const meta = metas.get(agentId);
    const spawn = bridged.get(agentId);
    const parent = parentOf(agentId);
    // A nested agent's call, result and notification are in its parent agent's transcript.
    const loop = parent === null ? d.main : (d.agents[parent]?.index ?? null);
    const toolUseId = str(meta?.toolUseId) ?? spawn?.toolUseId ?? null;
    // Known background four ways: the meta, the bridge's spawn, the call's own input, or a launch among its rows.
    const background = meta?.requestShape === 'background' || spawn?.background === true || (toolUseId !== null && loop?.backgroundCalls.has(toolUseId) === true);
    const mentions = (loop?.mentions ?? []).filter((m) => {
      if (m.from === 'result') return m.toolUseId !== null && m.toolUseId === toolUseId && (!background || m.raw === LAUNCHED);
      if (m.from === 'notification') return m.taskId === agentId || (toolUseId !== null && m.toolUseId === toolUseId);
      return m.taskId === agentId;
    });
    const outcome = fold(mentions, false, null);
    const decide = (status: SubagentStatus, evidence: SubagentStatusFacts['evidence']) => ({ status, evidence, outcome });
    let decided: ReturnType<typeof decide>;
    if (outcome?.terminal) decided = decide(outcome.status, 'rows');
    else if (!running) decided = decide('exited', 'session');
    else if (parent !== null && !seen.has(parent) && ENDED.has(statusOf(parent, new Set([...seen, agentId])).status)) decided = decide('exited', 'parent');
    else if (spawn && !spawn.running) decided = decide('exited', 'bridge');
    else if (spawn?.running) decided = decide('running', 'bridge');
    else if (outcome?.status === 'running') decided = decide('running', 'rows');
    else decided = decide('unknown', 'none');
    statuses.set(agentId, decided);
    return decided;
  };

  const subagents = d.metas.map(({ agentId, meta }) => {
    const { status, evidence, outcome } = statusOf(agentId);
    const spawn = bridged.get(agentId);
    const file = d.agents[agentId]?.file;
    const entry: SubagentMeta & SubagentStatusFacts = { agentId, meta, status, evidence };
    if (spawn && running) entry.running = spawn.running;
    if (spawn) entry.spawn = Object.fromEntries(SPAWN_FIELDS.filter((k) => k in spawn).map((k) => [k, spawn[k]])) as SubagentSpawn;
    if (outcome) entry.outcome = outcomeFacts(outcome);
    if (file) entry.file = file;
    return entry;
  });

  return { subagents, ...loopJobs(d.main, running) };
}

/** One loop's background shells and monitors, and its MCP server names: the main loop's for the session's body, an
 * agent's own for a subscription to that agent. `running`: whether the session's process runs. */
export function loopJobs(loop: LoopIndex, running: boolean, also?: LoopIndex): Pick<Body, 'jobs' | 'mcp'> {
  const naming = (index: LoopIndex, taskId: string) => index.mentions.filter((m) => m.taskId === taskId && m.from !== 'result');
  const jobs = loop.started.map((s): Job => {
    // `also`, the main loop's index for a subagent's loop: its words on the agent's tasks count after the loop's own,
    // since the bridge's note of a subagent's task it stopped is in the main transcript (the plane's `jobs_body`).
    const mentions = [...naming(loop, s.taskId), ...(also ? naming(also, s.taskId) : [])];
    const start: Outcome = { status: 'running', raw: 'running', at: s.startedAt, terminal: false };
    const outcome = fold(mentions, loop.monitors.has(s.taskId), start)!;
    const status: JobStatus = outcome.terminal ? (outcome.status as JobStatus) : running ? 'running' : 'exited';
    return {
      ...s,
      outputFile: loop.paths.get(s.taskId) ?? null,
      status,
      ...(outcome.terminal && { endedAt: outcome.at }),
      ...(outcome !== start && outcome.summary !== undefined && { summary: outcome.summary }),
    };
  });
  return { jobs, mcp: loop.mcp.map((name) => ({ name })) };
}

/** An agent transcript's file facts from its rows: the timestamps of its first and last rows that carry one. */
export function fileFacts(rows: JsonObject[], size: number, mtimeMs: number): AgentFile {
  const stamps = rows.map((r) => str(r.timestamp)).filter((t): t is string => t !== null);
  return { size, mtimeMs, firstAt: stamps[0] ?? null, lastAt: stamps.at(-1) ?? null };
}

/** The inputs as DC8's vectors give them: rows, not indexes. */
export type BodyInput = {
  session: { id: string; running: boolean };
  main: JsonObject[];
  metas: Array<{ agentId: string; meta: JsonObject }>;
  agentFiles: Record<string, { rows: JsonObject[]; size: number; mtimeMs: number } | null>;
  bridge: { agents: BridgeAgent[] } | null;
};

export function indexOf(rows: JsonObject[]): LoopIndex {
  const index = new LoopIndex();
  for (const row of rows) index.feed(row);
  return index;
}

/** `derive` over rows: what the vectors pin. */
export function deriveFromRows(input: BodyInput): Body {
  const agents: Derivation['agents'] = {};
  for (const [agentId, f] of Object.entries(input.agentFiles)) agents[agentId] = f && { index: indexOf(f.rows), file: fileFacts(f.rows, f.size, f.mtimeMs) };
  return derive({ session: input.session, main: indexOf(input.main), metas: input.metas, agents, bridge: input.bridge });
}
