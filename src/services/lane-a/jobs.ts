// A port of sminos's `sminos_jobs.py` `Ledger`, `fold` and `derive`, the jobs only, pinned by test/fixtures/lane-a/dx4-jobs.json.
//
// P5 O9 M5 (docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, the Decision Log's derived-jobs entry): a local terminal
// session's background shells and monitors, derived from its transcript rows by the rules sminos's plane derives them by
// (DX4 "Jobs and agent status"), so a session here lists the jobs a remote one lists. Pure: rows in, in file order, in
// any batches; the jobs out. What the vectors' `subagents` and `mcp` pin (agents' outcomes, MCP names) is not ported:
// locally the agents tool and the MCP widget read their own sources. Keep it in step with sminos (the PROVENANCE note).
import type { Job, JobStatus, SessionBodies } from 'desk-hub/protocol';

type Row = Record<string, unknown>;

// DX4's one normalization table: raw word → [status, terminal]. A word not in it changes no status and is kept in `raw`.
const TABLE: Record<string, [JobStatus, boolean]> = {
  completed: ['completed', true],
  failed: ['failed', true],
  error: ['failed', true],
  stopped: ['stopped', true],
  killed: ['stopped', true],
  cancelled: ['stopped', true],
  interrupted: ['stopped', true],
  running: ['running', false],
  pending: ['running', false],
};
const LAUNCHED = 'async_launched'; // a background agent's launch: running evidence, never terminal
// A monitor's expiry notice: a notification with no <status> whose <event> is the engine's expiry line ends it.
const EXPIRED = 'expired';
const EXPIRY_EVENTS = ['[Monitor expired after ', '[Monitor timed out'];
const NOTIFICATION_PREAMBLE = '[SYSTEM NOTIFICATION - NOT USER INPUT]\n';
// The bridge's notes of tasks it stopped (a plugin's TaskStop writes no row), known by their row's whole text.
const TASK_ID = '([A-Za-z0-9_-]{1,64})';
const STOP_NOTE = new RegExp(`^Task ${TASK_ID}, a background task, was stopped from (?:the desk|outside the terminal): it is not running\\.$`);
const INTERRUPT_ORIGINS = ['The interrupt came from the desk.', 'The interrupt came from outside the terminal.'];
const INTERRUPT_STOPPED = new RegExp(`^Task ${TASK_ID}, the Bash command the interrupt moved to the background, was then stopped: it is not running, and no notification will come for it\\.$`);
const INTERRUPT_RUNNING = new RegExp(`^Task ${TASK_ID}, the Bash command the interrupt moved to the background, could not be stopped: it may still be running\\.$`);
const CALLS = ['Bash', 'Monitor', 'TaskStop'];
const OUTPUT_PATH = /Output is being written to: (\S+)/;

export interface Evidence {
  raw: string;
  at: unknown; // the row's `timestamp`
  summary?: string;
  outputFile?: string;
  expiry?: true;
}
export interface Outcome {
  status: JobStatus;
  raw: string;
  at: unknown;
  summary?: string;
  outputFile?: string;
}

const record = (value: unknown): Row | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null);
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const word = (raw: string): [JobStatus, boolean] | null => (raw === LAUNCHED ? ['running', false] : Object.hasOwn(TABLE, raw) ? TABLE[raw] : null);

function text(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => record(b)).filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b!.text as string).join('');
}

function outputPath(content: unknown): string | null {
  const m = OUTPUT_PATH.exec(text(content));
  return m ? str(m[1].endsWith('.') ? m[1].slice(0, -1) : m[1]) : null;
}

function element(prompt: string, name: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(prompt);
  return m ? m[1].trim() : null;
}

// The notification text of a plain user row the engine wrote for one (origin.kind task-notification), or null.
function plainNotification(row: Row, content: unknown): string | null {
  if (row.type !== 'user' || record(row.origin)?.kind !== 'task-notification') return null;
  let body = text(content);
  if (body.startsWith(NOTIFICATION_PREAMBLE)) {
    const cut = body.indexOf('\n\n<task-notification>');
    body = cut >= 0 ? body.slice(cut + 2) : '';
  }
  return body.startsWith('<task-notification>') ? body : null;
}

// [task, line] for each task the bridge's note in this plugin's isMeta user row says it stopped.
function stopRecords(row: Row, content: unknown): [string, string][] {
  if (row.type !== 'user' || row.isMeta !== true || record(row.origin)?.kind !== 'plugin') return [];
  const body = text(content);
  const note = STOP_NOTE.exec(body);
  if (note) return [[note[1], body]];
  const lines = body.split('\n');
  if (!INTERRUPT_ORIGINS.includes(lines[0])) return [];
  const out: [string, string][] = [];
  for (const line of lines.slice(1)) {
    const stopped = INTERRUPT_STOPPED.exec(line);
    if (stopped) out.push([stopped[1], line]);
    else if (!INTERRUPT_RUNNING.test(line)) return [];
  }
  return out;
}

// The outcome a run of evidence comes to, in row order: a recognized word replaces the outcome unless the outcome is
// terminal and the word is not; an unrecognized word replaces only `raw` of an outcome there is.
export function fold(evidence: readonly Evidence[], outcome: Outcome): Outcome;
export function fold(evidence: readonly Evidence[], outcome?: Outcome | null): Outcome | null;
export function fold(evidence: readonly Evidence[], outcome: Outcome | null = null): Outcome | null {
  for (const ev of evidence) {
    const said = ev.expiry ? (['completed', true] as [JobStatus, boolean]) : word(ev.raw);
    if (said === null) {
      if (outcome !== null) outcome = { ...outcome, raw: ev.raw };
      continue;
    }
    const [status, terminal] = said;
    if (outcome !== null && outcome.status !== 'running' && !terminal) continue;
    outcome = { status, raw: ev.raw, at: ev.at };
    if (ev.summary !== undefined) outcome.summary = ev.summary;
    if (ev.outputFile !== undefined) outcome.outputFile = ev.outputFile;
  }
  return outcome;
}

interface Call {
  name: string;
  at: unknown;
  description?: string;
  command?: string;
  taskId?: string;
}
interface Started {
  kind: Job['kind'];
  toolUseId: string;
  startedAt: unknown;
  description: string;
  command?: string;
}

// One loop's rows, reduced to what its jobs read. Feed rows in file order, in any batches.
export class Ledger {
  private readonly calls = new Map<string, Call>(); // toolUseId → a Bash, Monitor or TaskStop call, until its result
  private readonly said = new Map<string, Evidence[]>(); // task id → the words rows said of it, in row order
  private readonly jobs = new Map<string, Started>(); // task id → its start, in start order
  private readonly outputs = new Map<string, string>(); // task id → the latest output path a row named

  feed(rows: Iterable<unknown>): void {
    for (const row of rows) this.add(row);
  }

  add(value: unknown): void {
    const row = record(value);
    if (row === null) return;
    const at = row.timestamp;
    const attachment = record(row.attachment);
    if (attachment !== null) this.attachment(attachment, at);
    const content = record(row.message)?.content;
    const plain = plainNotification(row, content);
    if (plain !== null) this.notification(plain, at);
    for (const [task, line] of stopRecords(row, content)) this.say(task, { raw: 'stopped', at, summary: line });
    if (!Array.isArray(content)) return;
    for (const value of content) {
      const block = record(value);
      if (block?.type === 'tool_use') this.call(block, at);
      else if (block?.type === 'tool_result') this.result(block, row.toolUseResult, at);
    }
  }

  // Whether the rows hold `task` as a job that runs (sminos's `running_task`, the session's process running).
  running(task: string): boolean {
    return this.jobsBody(true).some((j) => j.taskId === task && j.status === 'running');
  }

  // The loop's jobs; `sessionRunning` false once the session's process is gone (a job no word ended is `exited`).
  jobsBody(sessionRunning: boolean): Job[] {
    return [...this.jobs].map(([taskId, job]) => {
      const o = fold(this.said.get(taskId) ?? [], { status: 'running', raw: 'running', at: job.startedAt });
      const ended = o.status !== 'running';
      return {
        taskId, kind: job.kind, toolUseId: job.toolUseId, startedAt: job.startedAt as string, description: job.description,
        ...(job.command !== undefined && { command: job.command }),
        outputFile: this.outputs.get(taskId) ?? null,
        status: ended ? o.status : sessionRunning ? 'running' : 'exited',
        ...(ended && { endedAt: o.at as string }),
        ...(o.summary !== undefined && { summary: o.summary }),
      };
    });
  }

  private call(block: Row, at: unknown): void {
    const { name, id } = block;
    if (typeof name !== 'string' || !CALLS.includes(name) || typeof id !== 'string') return;
    const input = record(block.input) ?? {};
    const call: Call = { name, at };
    if (typeof input.description === 'string') call.description = input.description;
    if (typeof input.command === 'string') call.command = input.command;
    if (typeof input.task_id === 'string') call.taskId = input.task_id;
    this.calls.set(id, call);
  }

  private result(block: Row, toolUseResult: unknown, at: unknown): void {
    const id = block.tool_use_id;
    const call = typeof id === 'string' ? this.calls.get(id) : undefined;
    if (call === undefined) return;
    this.calls.delete(id as string);
    const tur = record(toolUseResult) ?? {};
    const shell = str(tur.backgroundTaskId);
    const monitor = str(tur.taskId);
    if (call.name === 'Bash' && shell !== null) {
      this.start(shell, 'shell', id as string, call);
      const path = outputPath(block.content);
      if (path !== null) this.outputs.set(shell, path);
    } else if (call.name === 'Monitor' && monitor !== null) {
      this.start(monitor, 'monitor', id as string, call);
    } else if (call.name === 'TaskStop' && call.taskId && block.is_error !== true) {
      const message = str(tur.message);
      this.say(call.taskId, { raw: 'stopped', at, ...(message !== null && { summary: message }) });
    }
  }

  private attachment(att: Row, at: unknown): void {
    if (att.type === 'task_status') {
      const task = str(att.taskId);
      if (task === null) return;
      const path = str(att.outputFilePath);
      if (path !== null) this.outputs.set(task, path);
      if (typeof att.status !== 'string') return;
      const summary = str(att.deltaSummary);
      this.say(task, { raw: att.status, at, ...(summary !== null && { summary }), ...(path !== null && { outputFile: path }) });
    } else if (att.type === 'queued_command' && att.commandMode === 'task-notification' && typeof att.prompt === 'string') {
      this.notification(att.prompt, at);
    }
  }

  // One task-notification's text, from either form the engine writes it in.
  private notification(prompt: string, at: unknown): void {
    const task = element(prompt, 'task-id') || null;
    const path = element(prompt, 'output-file') || null;
    const raw = element(prompt, 'status');
    if (task === null) return; // a notification naming only a call speaks of an agent
    if (path !== null) this.outputs.set(task, path);
    if (raw !== null) {
      const summary = element(prompt, 'summary') || null;
      this.say(task, { raw, at, ...(summary !== null && { summary }), ...(path !== null && { outputFile: path }) });
    } else if (this.jobs.get(task)?.kind === 'monitor') {
      const event = element(prompt, 'event');
      if (event && EXPIRY_EVENTS.some((line) => event.startsWith(line))) this.say(task, { raw: EXPIRED, at, expiry: true, summary: event });
    }
  }

  private start(task: string, kind: Job['kind'], toolUseId: string, call: Call): void {
    if (this.jobs.has(task)) return;
    this.jobs.set(task, { kind, toolUseId, startedAt: call.at, description: call.description ?? '', ...(call.command !== undefined && { command: call.command }) });
  }

  private say(task: string, ev: Evidence): void {
    const said = this.said.get(task);
    if (said) said.push(ev);
    else this.said.set(task, [ev]);
  }
}

// DX4's `subagents` body as derived here: the ledger's jobs, the session's process running or gone. `subagents` and
// `mcp` are empty: a local session's agents and MCP servers are read from MAWS's own sources.
export function derive(ledger: Ledger, { sessionRunning }: { sessionRunning: boolean }): SessionBodies['subagents'] {
  return { subagents: [], jobs: ledger.jobsBody(sessionRunning), mcp: [] };
}
