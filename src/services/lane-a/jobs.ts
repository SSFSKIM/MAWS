// A port of sminos's `sminos_jobs.py` `Ledger`, `fold` and `derive`, pinned by test/fixtures/lane-a/dx4-jobs.json.
//
// P5 O9 M5 (docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, the Decision Log's derived-jobs entry): a local terminal
// session's background shells and monitors, derived from its transcript rows by the rules sminos's plane derives them by
// (DX4 "Jobs and agent status"), so a session here lists the jobs a remote one lists. UX wave U8d M1
// (docs/doperpowers/plans/2026-11-15-ux-wave-U8d-terminal-subagents.md): its subagents too, each with its status and what
// that rests on, from the rows, the metas, the bridge's agents, the parents' rows and whether the process runs. Pure:
// rows in, in file order, in any batches; the body out. Not ported: `mcp` (answered empty: the MCP widget reads its own
// source), an entry's `file` (the agent file's facts, which nothing here reads), `jobs_body`'s `also`, `view`, `copy` and
// the `output` answer. Beside the rules stand `callAt` and `facts`, which change nothing derived; and one rule is read
// more widely than sminos reads it, every <task-id> of a notification block (R9). Keep it in step with sminos (the
// PROVENANCE note).
import type { Job, JobStatus, SubagentOutcome, SubagentSpawn, SubagentStatus } from 'desk-hub/protocol';
import type { AgentMeta, BridgeAgent, DerivedAgent } from '@shared/lane-a/agents';

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
// The engine's launch texts, which name a launch on a result row with no toolUseResult: the background agent's first
// line (with or without the later parenthetical) then its agentId line, or a fork's whole text.
const LAUNCH_TEXT = /^Async agent launched successfully\.(?: \([^\n]*\))?\nagentId: /;
const FORK_STARTED = 'Fork started — processing in background';
// A monitor's expiry notice: a notification with no <status> whose <event> is the engine's expiry line ends it.
const EXPIRED = 'expired';
const EXPIRY_EVENTS = ['[Monitor expired after ', '[Monitor timed out'];
const NOTIFICATION_PREAMBLE = '[SYSTEM NOTIFICATION - NOT USER INPUT]\n';
const NOTIFICATION = /<task-notification>[\s\S]*?<\/task-notification>/g;
// The engine's queue record (2.1.319), no uuid, in the main loop's transcript: every notification it queues, whichever
// loop it is for, is enqueued there before it is handed over; one for an agent that handed back never is. Only an
// enqueue is read: a `remove` repeats its text.
const QUEUE_RECORD = 'queue-operation';
// The bridge's notes of tasks it stopped (a plugin's TaskStop writes no row), known by their row's whole text.
const TASK_ID = '([A-Za-z0-9_-]{1,64})';
const STOP_NOTE = new RegExp(`^Task ${TASK_ID}, a background task, was stopped from (?:the desk|outside the terminal): it is not running\\.$`);
const INTERRUPT_ORIGINS = ['The interrupt came from the desk.', 'The interrupt came from outside the terminal.'];
const INTERRUPT_STOPPED = new RegExp(`^Task ${TASK_ID}, the Bash command the interrupt moved to the background, was then stopped: it is not running, and no notification will come for it\\.$`);
const INTERRUPT_RUNNING = new RegExp(`^Task ${TASK_ID}, the Bash command the interrupt moved to the background, could not be stopped: it may still be running\\.$`);
const AGENT_CALLS = ['Agent', 'Task'];
const CALLS = [...AGENT_CALLS, 'Bash', 'Monitor', 'TaskStop'];
const ENDED: readonly SubagentStatus[] = ['completed', 'failed', 'stopped', 'exited'];
const SPAWN_FIELDS = ['parentAgentId', 'subagentType', 'description', 'name', 'background', 'model', 'toolUseId'];
const OUTPUT_PATH = /Output is being written to: (\S+)/;

export interface Evidence {
  raw: string;
  at: unknown; // the row's `timestamp`
  summary?: string;
  outputFile?: string;
  expiry?: true;
}
// A word as the ledger keeps it: an Agent or Task call's result row is marked `result`, and `background` when its call
// asked for the background (agentOutcome reads both; fold reads neither).
interface Said extends Evidence {
  result?: true;
  background?: true;
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

// Every non-empty element of that name, in order: the engine names several tasks in one block at a resume (R9).
const elements = (prompt: string, name: string): string[] =>
  [...prompt.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => m[1].trim()).filter((v) => v !== '');

const launchText = (body: string): boolean => body === FORK_STARTED || LAUNCH_TEXT.test(body);

// Each notification a notification's text carries, in order: every whole block, its elements read within it. The
// engine joins the notifications it delivers at once into one row, each block after a blank line (2.1.257 on).
const notifications = (text: string): string[] => text.match(NOTIFICATION) ?? [];

// The notifications' text of an engine queue record that enqueues them, or null: its content, which must start with
// `<task-notification>` (the queue holds a person's prompts and peers' messages too).
function queuedNotice(row: Row): string | null {
  if (row.type !== QUEUE_RECORD || row.operation !== 'enqueue' || typeof row.content !== 'string') return null;
  return row.content.startsWith('<task-notification>') ? row.content : null;
}

// The notification text of a plain user row the engine wrote for its notifications (origin.kind task-notification),
// or null.
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
// terminal and the word is not; an unrecognized word replaces only `raw` of an outcome there is. An expiry notice is a
// word only for a task the folding loop holds as a monitor (`monitor`): judged here, not where it was said.
export function fold(evidence: readonly Evidence[], outcome: Outcome, monitor?: boolean): Outcome;
export function fold(evidence: readonly Evidence[], outcome?: Outcome | null, monitor?: boolean): Outcome | null;
export function fold(evidence: readonly Evidence[], outcome: Outcome | null = null, monitor = false): Outcome | null {
  for (const ev of evidence) {
    if (ev.expiry && !monitor) continue;
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
  background?: true;
}
interface Started {
  kind: Job['kind'];
  toolUseId: string;
  startedAt: unknown;
  description: string;
  command?: string;
}

// One loop's rows, reduced to what its body reads. Feed rows in file order, in any batches. Fed a parent agent's
// transcript, the same ledger gives its nested agents' outcomes.
export class Ledger {
  private readonly calls = new Map<string, Call>(); // toolUseId → an Agent, Task, Bash, Monitor or TaskStop call, until its result
  private readonly callTimes = new Map<string, string>(); // toolUseId → an Agent or Task call's row time, kept after its result
  private readonly evidence: Said[] = []; // every word a row said, in row order
  private readonly byTask = new Map<string, number[]>(); // task id → indexes into evidence
  private readonly byTool = new Map<string, number[]>(); // toolUseId → indexes into evidence
  private readonly jobs = new Map<string, Started>(); // task id → its start, in start order
  private readonly outputs = new Map<string, string>(); // task id → the latest output path a row named
  private rowFacts = 0; // the facts the row being read added
  private count = 0;

  // F5: grows by one for each row that added a fact the body is made of (an Agent or Task call or its result, a job's
  // start, a task's output path, each word said about a task or a call), and for no other row. Rows that say nothing
  // of an agent or a job, nearly every row of a transcript that streams, leave it where it was.
  get facts(): number {
    return this.count;
  }

  feed(rows: Iterable<unknown>): void {
    for (const row of rows) this.add(row);
  }

  add(value: unknown): void {
    this.rowFacts = 0;
    this.read(value);
    if (this.rowFacts > 0) this.count++;
  }

  // Whether the rows hold `task` as a job that runs (sminos's `running_task`, the session's process running).
  running(task: string): boolean {
    return this.jobsBody(true).some((j) => j.taskId === task && j.status === 'running');
  }

  // The loop's jobs; `sessionRunning` false once the session's process is gone (a job no word ended is `exited`).
  jobsBody(sessionRunning: boolean): Job[] {
    return [...this.jobs].map(([taskId, job]) => {
      const o = fold(this.saidOf(this.byTask.get(taskId)), { status: 'running', raw: 'running', at: job.startedAt }, job.kind === 'monitor');
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

  // The outcome the rows give an agent: what names its task id (its agent id) or its call's toolUseId, in row order. A
  // background agent's result row counts only as its launch: `background` as the meta or the spawn says, or as its
  // call's input did.
  agentOutcome(agentId: string, toolUseId: string | null, background: boolean): Outcome | null {
    const found = new Set([...(this.byTask.get(agentId) ?? []), ...(toolUseId ? (this.byTool.get(toolUseId) ?? []) : [])]);
    const said = this.saidOf([...found].sort((a, b) => a - b));
    return fold(said.filter((ev) => !(ev.result && ev.raw !== LAUNCHED && (background || ev.background))));
  }

  // R2: when an Agent or Task call was made, the time of the row that holds it; sminos forgets a call at its result.
  callAt(toolUseId: string): string | null {
    return this.callTimes.get(toolUseId) ?? null;
  }

  private read(value: unknown): void {
    const row = record(value);
    if (row === null) return;
    const at = row.timestamp;
    const attachment = record(row.attachment);
    if (attachment !== null) this.attachment(attachment, at);
    const queued = queuedNotice(row);
    for (const block of queued === null ? [] : notifications(queued)) this.notification(block, at);
    const content = record(row.message)?.content;
    const plain = plainNotification(row, content);
    for (const block of plain === null ? [] : notifications(plain)) this.notification(block, at);
    for (const [task, line] of stopRecords(row, content)) this.say({ raw: 'stopped', at, summary: line }, [task]);
    if (!Array.isArray(content)) return;
    for (const value of content) {
      const block = record(value);
      if (block?.type === 'tool_use') this.call(block, at);
      else if (block?.type === 'tool_result') this.result(block, row.toolUseResult, at);
    }
  }

  private call(block: Row, at: unknown): void {
    const { name, id } = block;
    if (typeof name !== 'string' || !CALLS.includes(name) || typeof id !== 'string') return;
    const input = record(block.input) ?? {};
    const call: Call = { name, at };
    if (typeof input.description === 'string') call.description = input.description;
    if (typeof input.command === 'string') call.command = input.command;
    if (typeof input.task_id === 'string') call.taskId = input.task_id;
    if (AGENT_CALLS.includes(name)) {
      if (input.run_in_background === true || input.run_in_background === 'true') call.background = true;
      if (typeof at === 'string') this.callTimes.set(id, at);
      this.rowFacts++;
    }
    this.calls.set(id, call);
  }

  private result(block: Row, toolUseResult: unknown, at: unknown): void {
    const id = block.tool_use_id;
    const call = typeof id === 'string' ? this.calls.get(id) : undefined;
    if (call === undefined) return;
    this.calls.delete(id as string);
    // A launch's text names it only on a row with no toolUseResult: where there is one, its status decides (an agent's
    // own answer may begin as a launch does).
    const byText = toolUseResult === undefined || toolUseResult === null;
    const tur = record(toolUseResult) ?? {};
    const isError = block.is_error === true;
    const shell = str(tur.backgroundTaskId);
    const monitor = str(tur.taskId);
    if (AGENT_CALLS.includes(call.name)) {
      const launch = tur.status === LAUNCHED || (byText && !isError && launchText(text(block.content)));
      const raw = launch ? LAUNCHED : isError ? 'error' : typeof tur.status === 'string' ? tur.status : 'completed';
      const ev: Said = { raw, at, result: true };
      const path = str(tur.outputFile);
      if (raw === LAUNCHED && path !== null) ev.outputFile = path;
      if (call.background) ev.background = true;
      this.say(ev, [], id as string);
    } else if (call.name === 'Bash' && shell !== null) {
      this.start(shell, 'shell', id as string, call);
      const path = outputPath(block.content);
      if (path !== null) this.output(shell, path);
    } else if (call.name === 'Monitor' && monitor !== null) {
      this.start(monitor, 'monitor', id as string, call);
    } else if (call.name === 'TaskStop' && call.taskId && !isError) {
      const message = str(tur.message);
      this.say({ raw: 'stopped', at, ...(message !== null && { summary: message }) }, [call.taskId]);
    }
  }

  private attachment(att: Row, at: unknown): void {
    if (att.type === 'task_status') {
      const task = str(att.taskId);
      if (task === null) return;
      const path = str(att.outputFilePath);
      if (path !== null) this.output(task, path);
      if (typeof att.status !== 'string') return;
      const summary = str(att.deltaSummary);
      this.say({ raw: att.status, at, ...(summary !== null && { summary }), ...(path !== null && { outputFile: path }) }, [task]);
    } else if (att.type === 'queued_command' && att.commandMode === 'task-notification' && typeof att.prompt === 'string') {
      for (const block of notifications(att.prompt)) this.notification(block, at);
    }
  }

  // One task-notification's block, from any form the engine writes it in. It names its tasks by <task-id>, its call by
  // <tool-use-id>, or both; one word said of them all. R9: every <task-id> of the block, where sminos reads the first
  // (the engine ends several orphans of a resumed session with one block, which also carries ids that name no task:
  // a word said of an id no job and no agent has is read by nobody).
  private notification(prompt: string, at: unknown): void {
    const tasks = elements(prompt, 'task-id');
    const tool = element(prompt, 'tool-use-id') || null;
    const path = element(prompt, 'output-file') || null;
    const raw = element(prompt, 'status');
    if (path !== null) for (const task of tasks) this.output(task, path);
    if (raw !== null && (tasks.length > 0 || tool !== null)) {
      const summary = element(prompt, 'summary') || null;
      this.say({ raw, at, ...(summary !== null && { summary }), ...(path !== null && { outputFile: path }) }, tasks, tool);
    } else if (raw === null && tasks.length > 0) {
      const event = element(prompt, 'event');
      if (event && EXPIRY_EVENTS.some((line) => event.startsWith(line))) this.say({ raw: EXPIRED, at, expiry: true, summary: event }, tasks);
    }
  }

  private start(task: string, kind: Job['kind'], toolUseId: string, call: Call): void {
    if (this.jobs.has(task)) return;
    this.jobs.set(task, { kind, toolUseId, startedAt: call.at, description: call.description ?? '', ...(call.command !== undefined && { command: call.command }) });
    this.rowFacts++;
  }

  private output(task: string, path: string): void {
    if (this.outputs.get(task) === path) return;
    this.outputs.set(task, path);
    this.rowFacts++;
  }

  // One word, said of each task named and of the call named.
  private say(ev: Said, tasks: readonly string[], tool: string | null = null): void {
    const i = this.evidence.push(ev) - 1;
    for (const task of tasks) index(this.byTask, task, i);
    if (tool !== null) index(this.byTool, tool, i);
    this.rowFacts++;
  }

  private saidOf(indexes: readonly number[] | undefined): Said[] {
    return (indexes ?? []).map((i) => this.evidence[i]);
  }
}

function index(by: Map<string, number[]>, key: string, i: number): void {
  const held = by.get(key);
  if (held === undefined) by.set(key, [i]);
  else if (held.at(-1) !== i) held.push(i); // a block that names one task twice says one word of it
}

export interface DeriveInput {
  metas: readonly AgentMeta[]; // one entry out per meta, in this order
  bridge: readonly BridgeAgent[] | null; // null: no bridge state is held
  parents: ReadonlyMap<string, Ledger | null>; // by parent agent id; null or absent: its transcript is not readable
  sessionRunning: boolean;
}

// DX4's `subagents` body as derived here: each meta's agent with its status and what that rests on, the loop's jobs.
// `mcp` is empty: a local session's MCP servers are read from MAWS's own source. The status and its evidence, the first
// that holds (DX4, "Precedence"): the rows' outcome is terminal; the session's process is gone; the parent has ended;
// the bridge holds the agent as not running; the bridge holds it as running; the rows say it runs (a launch); none.
// The bridge counts only while the process runs.
export function derive(ledger: Ledger, { metas, bridge, parents, sessionRunning }: DeriveInput): { subagents: DerivedAgent[]; jobs: Job[]; mcp: [] } {
  const held = new Map<string, BridgeAgent>();
  for (const agent of bridge ?? []) if (record(agent) !== null) held.set(agent.agentId, agent);
  const metaOf = new Map(metas.map((m) => [m.agentId, m.meta]));
  const done = new Map<string, DerivedAgent>();
  const busy = new Set<string>(); // the agents whose entry is being decided: a parent cycle stops at them

  const entry = (agentId: string): DerivedAgent => {
    const known = done.get(agentId);
    if (known !== undefined) return known;
    busy.add(agentId);
    const meta = metaOf.get(agentId)!;
    const spawn = held.get(agentId) ?? null;
    const live = sessionRunning ? spawn : null;
    const background = meta.requestShape === 'background' || spawn?.background === true;
    const parent = str(meta.parentAgentId) ?? str(spawn?.parentAgentId);
    const tool = str(meta.toolUseId) ?? str(spawn?.toolUseId);
    const loop = parent !== null ? (parents.get(parent) ?? null) : ledger;
    const outcome = loop?.agentOutcome(agentId, tool, background) ?? null;
    const running = live !== null && typeof live.running === 'boolean' ? live.running : null;
    const decided = ((): Pick<DerivedAgent, 'status' | 'evidence'> => {
      if (outcome !== null && outcome.status !== 'running') return { status: outcome.status, evidence: 'rows' };
      if (!sessionRunning) return { status: 'exited', evidence: 'session' };
      if (parent !== null && metaOf.has(parent) && !busy.has(parent) && ENDED.includes(entry(parent).status)) return { status: 'exited', evidence: 'parent' };
      if (running === false) return { status: 'exited', evidence: 'bridge' };
      if (running === true) return { status: 'running', evidence: 'bridge' };
      if (outcome !== null) return { status: 'running', evidence: 'rows' };
      return { status: 'unknown', evidence: 'none' };
    })();
    const e: DerivedAgent = { agentId, meta, ...decided };
    if (running !== null) e.running = running;
    if (spawn !== null) e.spawn = Object.fromEntries(SPAWN_FIELDS.filter((k) => Object.hasOwn(spawn, k)).map((k) => [k, spawn[k]])) as SubagentSpawn;
    if (outcome !== null) e.outcome = { ...outcome, at: outcome.at as SubagentOutcome['at'] };
    busy.delete(agentId);
    done.set(agentId, e);
    return e;
  };

  return { subagents: metas.map((m) => entry(m.agentId)), jobs: ledger.jobsBody(sessionRunning), mcp: [] };
}

// F1: whether an entry's status is an ended one no later row can change: ended on the rows' word or on the process
// gone, or ended with a parent that is itself settled. Running, unknown, and ended on the bridge's word alone are
// provisional, and so is ended under a parent that is provisional or has no entry. `entries` is the derivation the
// entry came from, by agent id.
export function settled(entry: DerivedAgent, entries: ReadonlyMap<string, DerivedAgent>): boolean {
  const seen = new Set<string>(); // derive gives no parent cycle this evidence; this stops one all the same
  for (let e: DerivedAgent | undefined = entry; e !== undefined && !seen.has(e.agentId); ) {
    seen.add(e.agentId);
    if (!ENDED.includes(e.status)) return false;
    if (e.evidence === 'rows' || e.evidence === 'session') return true;
    if (e.evidence !== 'parent') return false;
    const parentId: string | null = str(e.meta.parentAgentId) ?? str(e.spawn?.parentAgentId);
    e = parentId === null ? undefined : entries.get(parentId);
  }
  return false;
}
