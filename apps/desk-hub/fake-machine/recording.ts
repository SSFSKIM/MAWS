// A recorded session, as the fake machine replays it. A recording is a directory:
//
//   transcript.jsonl                     the session's transcript rows (lines carrying a `uuid`), as the engine wrote them
//   subagents/agent-<id>.jsonl           each subagent's rows, and agent-<id>.meta.json beside it, verbatim
//   events.jsonl                         the bridge's own stream (DX5 `GET /events`, as `sminos watch --json` prints it),
//                                        each line with `_ms`, its arrival in ms from the recording's start
//   presence.jsonl                       optional: `{_ms, record}` each time the session record's status changed
//   log/*.jsonl                          optional: the project's log events the session's machine wrote
//   deliveries.jsonl                     optional: `{_ms, event: {writer, seq}, session, outcome, reason}` each time the
//                                        machine's daemon settled delivering a log event (one under log/, named by its
//                                        recorded position) to a session: DX4's `delivery` without its code
//   diff.patch                           optional: the working tree's diff against its base branch
//   tasks/<taskId>.output                optional: background tasks' output files, as the engine wrote them under its
//                                        temporary directory (the fake machine maps the session's tasks roots here)
//   recorded.json                        `{session, cwd, member}`: the session id, its working directory, and the member
//                                        placeholder the recording's web answers name in `by`
//
// Stream chunks come from the bridge when the recording has them (record.py captures a real session). A recording whose
// events.jsonl holds no `chunk` lines, or none at all, has them synthesized from its transcript's text: each response
// row's block is streamed in small chunks, then its `block-row`, then the row, then its step's end. Either way the
// recording becomes one timeline of steps, each at a time in ms, which the fake machine plays.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { JsonObject } from '../src/protocol/json';
import type { BlockRow, Delivery, Raised, Settled, StepEnd, Usage } from '../src/protocol/session';
import type { BridgeAgent } from './jobs';

export type Row = JsonObject & { uuid: string };

/** A spawn record as the bridge's `agent` event carries it. */
export type Spawn = Omit<BridgeAgent, 'agentId' | 'running'>;

/** One step of a session's timeline. `agentId` is null for the main loop. */
export type Step = { at: number } & (
  | { k: 'turn-start'; turnId: string; agentId: string | null }
  | { k: 'turn-end'; turnId: string; agentId: string | null; reason: string }
  | { k: 'step-start'; turnId: string; agentId: string | null; step: number; model?: string }
  | { k: 'chunk'; turnId: string; agentId: string | null; step: number; chunkIndex: number; chunk: JsonObject }
  | { k: 'block-row'; body: BlockRow }
  | { k: 'step-end'; body: StepEnd }
  /** The row is on disk: subscribers of its transcript receive it. */
  | { k: 'row'; agentId: string | null; row: Row }
  /** A subagent started: its `meta.json` joins the session's tree, and the bridge holds it running when it saw the
   * spawn (DX5's `agent` spawn record). */
  | { k: 'agent'; agentId: string; spawn?: Spawn }
  /** The bridge saw a subagent stop (DX5's `agent` stop). */
  | { k: 'agent-stop'; agentId: string }
  /** The bridge's agent state whole, as its snapshot or a `resync` carries it: what a module (re)loaded mid-session
   * seeds from `$.agent.list()`. */
  | { k: 'agents'; agents: BridgeAgent[] }
  | { k: 'usage'; body: Usage }
  | { k: 'presence'; record: JsonObject | null }
  | { k: 'raised'; draft: Omit<Raised, 'mac' | 'session'> }
  | { k: 'settled'; draft: Omit<Settled, 'mac'> }
  /** A log event the session's machine wrote, as recorded (its writer and machine are the recording's). */
  | { k: 'log'; id: string; event: JsonObject }
  /** The outcome of delivering the log event `log` (a `log` step's id) to `session`. */
  | { k: 'delivery'; log: string; session: string; outcome: Delivery['outcome']; reason: string }
);

export type Recording = {
  /** The directory's name. */
  name: string;
  /** The directory itself, whose `tasks/<taskId>.output` files are the session's task outputs; absent for a recording
   * made in memory, which has none. */
  dir?: string;
  session: string;
  cwd: string;
  /** The member id the recording's web answers carry in `by`; the fake machine puts its own member in its place. */
  member: string | null;
  rows: { main: Row[]; agents: Record<string, Row[]> };
  /** Each subagent's `meta.json`, verbatim. */
  meta: Record<string, JsonObject>;
  steps: Step[];
  diff: string;
  /** Where the stream's chunks came from. */
  chunks: 'bridge' | 'synthesized';
};

export type LoadOptions = {
  /** The session id to give the session, in place of the recorded one (every occurrence, rows included): two fake
   * machines replaying one recording into one project need two ids. */
  session?: string;
};

/** Reads a recording directory into a timeline. */
export function loadRecording(dir: string, options: LoadOptions = {}): Recording {
  const recorded = JSON.parse(readFileSync(join(dir, 'recorded.json'), 'utf8')) as { session: string; cwd: string; member?: string };
  const rename = (text: string) => (options.session ? text.split(recorded.session).join(options.session) : text);
  const read = (path: string) => (existsSync(path) ? rename(readFileSync(path, 'utf8')) : '');
  const lines = (path: string): JsonObject[] =>
    read(path)
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as JsonObject);

  const main = lines(join(dir, 'transcript.jsonl')).filter(hasUuid);
  const agents: Record<string, Row[]> = {};
  const meta: Record<string, JsonObject> = {};
  const subdir = join(dir, 'subagents');
  for (const file of existsSync(subdir) ? readdirSync(subdir).sort() : []) {
    const match = /^agent-(.+?)(\.meta)?\.json(l)?$/.exec(file);
    if (!match) continue;
    if (match[2]) meta[match[1]] = JSON.parse(read(join(subdir, file))) as JsonObject;
    else if (match[3]) agents[match[1]] = lines(join(subdir, file)).filter(hasUuid);
  }
  const events = lines(join(dir, 'events.jsonl'));
  const streamed = events.some((e) => e.type === 'chunk');
  const rows = { main, agents };
  const steps = streamed ? fromBridge(events, rows) : synthesize(rows, events);

  // The presence timeline and the log, merged by time.
  for (const p of lines(join(dir, 'presence.jsonl'))) steps.push({ at: Number(p._ms), k: 'presence', record: (p.record as JsonObject | null) ?? null });
  const clock = clockOf(events);
  let logIndex = 0;
  const logDir = join(dir, 'log');
  const logAt = new Map<string, { id: string; at: number }>();
  for (const file of existsSync(logDir) ? readdirSync(logDir).sort() : []) {
    for (const event of lines(join(logDir, file))) {
      const ts = Date.parse(String(event.ts));
      const step: Step = { at: clock === null ? 0 : Math.max(0, ts - clock), k: 'log', id: `${basename(file)}:${logIndex++}`, event };
      logAt.set(`${String(event.writer)}#${String(event.seq)}`, { id: step.id, at: step.at });
      steps.push(step);
    }
  }
  for (const d of lines(join(dir, 'deliveries.jsonl'))) {
    const event = d.event as { writer?: unknown; seq?: unknown } | undefined;
    const target = logAt.get(`${String(event?.writer)}#${String(event?.seq)}`);
    if (!target) throw new Error(`${dir}: a delivery names ${JSON.stringify(event)}, which is not an event under log/`);
    // Never before the event it delivers, whatever the clocks say.
    steps.push({ at: Math.max(Number(d._ms ?? 0), target.at), k: 'delivery', log: target.id, session: String(d.session), outcome: d.outcome as Delivery['outcome'], reason: String(d.reason ?? '') });
  }
  // A stable sort keeps each source's own order among steps at the same time.
  steps.sort((a, b) => a.at - b.at);
  return {
    name: basename(dir),
    dir: resolve(dir),
    session: options.session ?? recorded.session,
    cwd: recorded.cwd,
    member: recorded.member ?? null,
    rows,
    meta,
    steps,
    diff: read(join(dir, 'diff.patch')),
    chunks: streamed ? 'bridge' : 'synthesized',
  };
}

const hasUuid = (row: JsonObject): row is Row => typeof row.uuid === 'string';

/** The offset from the bridge's clock (`t`, epoch ms) to the recording's (`_ms`), from the events that carry both. */
function clockOf(events: JsonObject[]): number | null {
  const offsets = events.filter((e) => typeof e.t === 'number' && typeof e._ms === 'number').map((e) => (e.t as number) - (e._ms as number));
  if (!offsets.length) return null;
  offsets.sort((a, b) => a - b);
  return offsets[Math.floor(offsets.length / 2)];
}

const isoOf = (epochMs: unknown) => (typeof epochMs === 'number' ? new Date(epochMs).toISOString() : undefined);

/** Steps for the requests and usage in a bridge stream; shared by both ways of getting chunks. */
function sideSteps(e: JsonObject, at: number): Step[] {
  switch (e.type) {
    case 'raised': {
      const draft: Record<string, unknown> = { request: e.request, tool: e.tool, input: e.input };
      if (typeof e.agentId === 'string' && e.agentId) draft.agentId = e.agentId;
      if (e.truncated === true) draft.truncated = true;
      if (e.async === true) draft.async = true;
      if (typeof e.toolUseId === 'string' && e.toolUseId && e.toolUseId !== e.request) draft.toolUseId = e.toolUseId;
      const deadline = isoOf(e.deadline);
      if (deadline) draft.deadline = deadline;
      return [{ at, k: 'raised', draft: draft as Omit<Raised, 'mac' | 'session'> }];
    }
    case 'settled':
      return [{ at, k: 'settled', draft: { request: String(e.request), winner: e.winner as Settled['winner'], outcome: e.outcome as Settled['outcome'], by: String(e.by) } }];
    case 'usage':
      return [{ at, k: 'usage', body: { context: e.context as Usage['context'], cost: (e.cost as Usage['cost']) ?? null } }];
    default:
      return [];
  }
}

/** A real recording: the bridge's events, with each row placed right after its notice (`block-row` or `row-seen`). */
function fromBridge(events: JsonObject[], rows: { main: Row[]; agents: Record<string, Row[]> }): Step[] {
  const byUuid = new Map<string, { agentId: string | null; row: Row }>();
  for (const row of rows.main) byUuid.set(row.uuid, { agentId: null, row });
  for (const [agentId, list] of Object.entries(rows.agents)) for (const row of list) byUuid.set(row.uuid, { agentId, row });
  const released = new Set<string>();
  const steps: Step[] = [];
  /** Releases every row of the loop up to and including `uuid`, in transcript order: a row passed over is unnamed. */
  const release = (agentId: string | null, uuid: string, at: number) => {
    const list = agentId === null ? rows.main : (rows.agents[agentId] ?? []);
    const upTo = list.findIndex((r) => r.uuid === uuid);
    for (let i = 0; i <= upTo; i++) {
      if (released.has(list[i].uuid)) continue;
      released.add(list[i].uuid);
      steps.push({ at, k: 'row', agentId, row: list[i] });
    }
  };
  for (const e of events) {
    const at = Number(e._ms ?? 0);
    const agentId = (e.agentId as string | null | undefined) ?? null;
    if (e.type === 'chunk') {
      steps.push({ at, k: 'chunk', turnId: String(e.turnId), agentId, step: Number(e.step), chunkIndex: Number(e.chunkIndex), chunk: e.chunk as JsonObject });
    } else if (e.type === 'block-row') {
      steps.push({ at, k: 'block-row', body: { uuid: String(e.uuid), turnId: String(e.turnId), agentId, step: Number(e.step), index: Number(e.index) } });
      const known = byUuid.get(String(e.uuid));
      if (known) release(known.agentId, String(e.uuid), at);
    } else if (e.type === 'row-seen') {
      const known = byUuid.get(String(e.uuid));
      if (known) release(known.agentId, String(e.uuid), at);
    } else if (e.type === 'step' && e.phase === 'start') {
      steps.push({ at, k: 'step-start', turnId: String(e.turnId), agentId, step: Number(e.step), ...(typeof e.model === 'string' && { model: e.model }) });
    } else if (e.type === 'step' && e.phase === 'end') {
      steps.push({ at, k: 'step-end', body: { turnId: String(e.turnId), agentId, step: Number(e.step) } });
    } else if (e.type === 'turn' && e.phase === 'start') {
      steps.push({ at, k: 'turn-start', turnId: String(e.turnId), agentId });
    } else if (e.type === 'turn' && e.phase === 'complete') {
      steps.push({ at, k: 'turn-end', turnId: String(e.turnId), agentId, reason: String(e.reason) });
    } else if (e.type === 'agent' && e.phase === 'spawn') {
      steps.push({ at, k: 'agent', agentId: String(e.agentId), spawn: spawnOf(e) });
    } else if (e.type === 'agent' && e.phase === 'stop') {
      steps.push({ at, k: 'agent-stop', agentId: String(e.agentId) });
    } else if ((e.type === 'snapshot' || e.type === 'resync') && Array.isArray(e.agents)) {
      steps.push({ at, k: 'agents', agents: (e.agents as JsonObject[]).map((a) => ({ agentId: String(a.agentId), ...spawnOf(a), running: a.running === true })) });
    } else {
      steps.push(...sideSteps(e, at));
    }
  }
  // Rows no notice named (none in a whole recording), at the end.
  const end = steps.at(-1)?.at ?? 0;
  for (const [uuid, { agentId }] of byUuid) if (!released.has(uuid)) release(agentId, uuid, end);
  return steps;
}

/** The spawn fields an `agent` event (or a snapshot's agent entry) carries, as it carries them. */
function spawnOf(e: JsonObject): Spawn {
  const spawn: Record<string, unknown> = { parentAgentId: (e.parentAgentId as string | null | undefined) ?? null, subagentType: String(e.subagentType ?? ''), description: String(e.description ?? '') };
  for (const k of ['name', 'background', 'model', 'toolUseId', 'agentType'] as const) if (k in e) spawn[k] = e[k];
  return spawn as Spawn;
}

/** How long, in ms, the synthesized stream takes per chunk, and how many characters a chunk carries. */
const CHUNK_MS = 20;
const CHUNK_CHARS = 12;

/**
 * A recording with no stream: chunks synthesized from the transcript. Each loop's rows play in order, a row every
 * 100 ms; a user row with text of its own starts a turn, and the response rows of one API message (`message.id`) form
 * one model request, each row one content block whose text streams before its `block-row` and the row, and the
 * request's `step-end` after its last row. The events.jsonl lines that are not stream (requests, usage) are kept.
 */
function synthesize(rows: { main: Row[]; agents: Record<string, Row[]> }, events: JsonObject[]): Step[] {
  const steps: Step[] = [];
  for (const e of events) steps.push(...sideSteps(e, Number(e._ms ?? 0)));
  const loop = (agentId: string | null, list: Row[], start: number) => {
    let at = start;
    let turnId: string | null = null;
    let step = -1;
    type Message = { id: string; step: number; blocks: number; chunks: number };
    let message = null as Message | null;
    const endStep = () => {
      if (message && turnId) steps.push({ at, k: 'step-end', body: { turnId, agentId, step: message.step } });
      message = null;
    };
    const endTurn = (reason: string) => {
      endStep();
      if (turnId) steps.push({ at, k: 'turn-end', turnId, agentId, reason });
      turnId = null;
    };
    for (const row of list) {
      at += 100;
      const msg = row.message as JsonObject | undefined;
      if (row.type === 'user' && promptText(msg) !== null) {
        endTurn('answer');
        turnId = row.uuid;
        step = -1;
        steps.push({ at, k: 'turn-start', turnId, agentId });
      }
      if (row.type === 'assistant' && msg && turnId) {
        const id = String(msg.id ?? row.uuid);
        if (message?.id !== id) {
          endStep();
          message = { id, step: ++step, blocks: 0, chunks: 0 };
          steps.push({ at, k: 'step-start', turnId, agentId, step, ...(typeof msg.model === 'string' && { model: msg.model }) });
        }
        const index = message.blocks++;
        for (const block of (msg.content as JsonObject[] | undefined) ?? []) {
          for (const chunk of blockChunks(block, index)) {
            at += CHUNK_MS;
            steps.push({ at, k: 'chunk', turnId, agentId, step: message.step, chunkIndex: message.chunks++, chunk });
          }
        }
        steps.push({ at, k: 'block-row', body: { uuid: row.uuid, turnId, agentId, step: message.step, index } });
      } else if (row.type !== 'assistant') {
        endStep();
      }
      steps.push({ at, k: 'row', agentId, row });
    }
    endTurn('answer');
  };
  loop(null, rows.main, 0);
  let start = 0;
  for (const [agentId, list] of Object.entries(rows.agents)) {
    start += 500;
    steps.push({ at: start, k: 'agent', agentId });
    loop(agentId, list, start);
  }
  steps.sort((a, b) => a.at - b.at);
  return steps;
}

/** A user row's own text (a prompt), or null for a tool result or anything else. */
function promptText(message: JsonObject | undefined): string | null {
  if (!message) return null;
  if (typeof message.content === 'string') return message.content;
  const blocks = (message.content as JsonObject[] | undefined) ?? [];
  const text = blocks.find((b) => b.type === 'text');
  return text && !blocks.some((b) => b.type === 'tool_result') ? String(text.text) : null;
}

/** The `turn.step` chunks a content block streams as (DX5's chunk objects: `text`, `thinking`, `tool`, `input`). */
function blockChunks(block: JsonObject, index: number): JsonObject[] {
  const pieces = (text: string) => {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += CHUNK_CHARS) out.push(text.slice(i, i + CHUNK_CHARS));
    return out.length ? out : [''];
  };
  if (block.type === 'text') return pieces(String(block.text ?? '')).map((text) => ({ kind: 'text', index, text }));
  if (block.type === 'thinking') return pieces(String(block.thinking ?? '')).map((text) => ({ kind: 'thinking', index, text }));
  if (block.type === 'tool_use') {
    return [{ kind: 'tool', index, id: String(block.id), name: String(block.name) }, ...pieces(JSON.stringify(block.input ?? {})).map((json) => ({ kind: 'input', index, json }))];
  }
  return [];
}
