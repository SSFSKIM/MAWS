// sminos's DX4 jobs vectors (test/fixtures/lane-a/dx4-jobs.json, a two-repo contract; its PROVENANCE beside it),
// replayed over the port: each case's rows, metas, parents' rows and bridge state give its expected `subagents` and
// `jobs`, the session running or not. Beside them, the port's own rules the vectors do not reach: the several-ids block
// (R9), `callAt`, the count of facts and `settled`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentMeta, BridgeAgent, DerivedAgent } from '@shared/lane-a/agents';
import { derive, fold, Ledger, settled } from './jobs';

interface Case {
  name: string;
  input: {
    session: { running: boolean };
    main: unknown[];
    metas: AgentMeta[];
    agentFiles: Record<string, { rows: unknown[] } | null>;
    bridge: { agents: BridgeAgent[] } | null;
  };
  expect: { subagents: Record<string, unknown>[]; jobs: unknown[] };
}
interface Vectors {
  table: { raw: string; status: string; terminal: boolean }[];
  cases: Case[];
  outputCases: unknown[];
}

const vectors = JSON.parse(readFileSync(join(__dirname, '../../../test/fixtures/lane-a/dx4-jobs.json'), 'utf8')) as Vectors;

const ledgerOf = (rows: readonly unknown[]): Ledger => {
  const ledger = new Ledger();
  ledger.feed(rows);
  return ledger;
};
const nonEmpty = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const noAgents = { metas: [], bridge: null, parents: new Map<string, Ledger | null>() };

// The parents' ledgers a case's derivation reads: one per agent a meta or a bridge record names as a parent, fed that
// agent's file; null where the case gives the file as null or not at all.
function parentsOf(c: Case): Map<string, Ledger | null> {
  const named = [...c.input.metas.map((m) => nonEmpty(m.meta.parentAgentId)), ...(c.input.bridge?.agents ?? []).map((a) => nonEmpty(a.parentAgentId))];
  const parents = new Map<string, Ledger | null>();
  for (const id of named) {
    if (id === null) continue;
    const file = c.input.agentFiles[id];
    parents.set(id, file ? ledgerOf(file.rows) : null);
  }
  return parents;
}

// The port reads no agent file's facts (the driver has another source for a start time), so an expected entry is
// compared without its `file`; and it answers `mcp` empty (this Mac's MCP widget reads its own source).
const withoutFile = (entry: Record<string, unknown>) => Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'file'));

describe('the port over dx4-jobs.json', () => {
  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const body = derive(ledgerOf(c.input.main), {
      metas: c.input.metas,
      bridge: c.input.bridge?.agents ?? null,
      parents: parentsOf(c),
      sessionRunning: c.input.session.running,
    });
    expect(body).toEqual({ subagents: c.expect.subagents.map(withoutFile), jobs: c.expect.jobs, mcp: [] });
  });

  it('sixteen cases expect agents', () => {
    expect(vectors.cases.filter((c) => c.expect.subagents.length > 0)).toHaveLength(16);
  });

  // The vectors join notifications in plain rows only; `about` reads either form alike, so the same blocks queued as one
  // attachment's prompt end the same jobs.
  it('reads several notifications in one queued_command prompt as in one plain row', () => {
    const c = vectors.cases.find((k) => k.name === 'several notifications in one row')!;
    const queued = (c.input.main as Record<string, unknown>[]).map((row) => {
      if ((row.origin as { kind?: unknown } | undefined)?.kind !== 'task-notification') return row;
      const body = (row.message as { content: string }).content;
      const prompt = body.slice(body.indexOf('<task-notification>'));
      return { type: 'attachment', uuid: row.uuid, timestamp: row.timestamp, attachment: { type: 'queued_command', commandMode: 'task-notification', prompt } };
    });
    expect(queued.filter((row) => row.type === 'attachment')).toHaveLength(2);
    expect(derive(ledgerOf(queued), { ...noAgents, sessionRunning: c.input.session.running }).jobs).toEqual(c.expect.jobs);
  });

  it('the cases hold background shells and monitors, ended and running', () => {
    const jobs = vectors.cases.flatMap((c) => c.expect.jobs as { kind: string; status: string }[]);
    expect(new Set(jobs.map((j) => j.kind))).toEqual(new Set(['shell', 'monitor']));
    expect(new Set(jobs.map((j) => j.status))).toEqual(new Set(['running', 'completed', 'failed', 'stopped', 'exited']));
  });

  it.each(vectors.table.map((t) => [t.raw, t] as const))('the table maps %s', (raw, t) => {
    const outcome = fold([{ raw, at: 'B' }], { status: 'running', raw: 'running', at: 'A' });
    expect(outcome).toEqual({ status: t.status, raw, at: 'B' }); // a recognized word replaces a running outcome
    expect(fold([{ raw: 'running', at: 'C' }], outcome).at).toBe(t.terminal ? 'B' : 'C'); // a later running never undoes a terminal word
  });

  it('an unrecognized word replaces only raw', () => {
    expect(fold([{ raw: 'paused', at: 'B' }], { status: 'running', raw: 'running', at: 'A' })).toEqual({ status: 'running', raw: 'paused', at: 'A' });
  });

  // R9 reads every <task-id> of a block where the shared rules read the first: outside everything the vectors pin, since
  // none of their blocks names more than one task.
  it('no notification block of the vectors names more than one task', () => {
    const blocks = JSON.stringify([vectors.cases, vectors.outputCases]).match(/<task-notification>[\s\S]*?<\/task-notification>/g) ?? [];
    expect(blocks).toHaveLength(53);
    expect(blocks.filter((b) => (b.match(/<task-id>/g) ?? []).length > 1)).toEqual([]);
  });
});

// Rows written for these cases, invented: an assistant row's call, the user row of a call's result, the engine's queue
// record of a notification. Each row is a second later than the last.
let clock = 0;
const at = () => new Date(Date.UTC(2026, 10, 15, 10, 0, clock++)).toISOString();
const callRow = (id: string, name: string, input: Record<string, unknown> = {}) => ({
  type: 'assistant', uuid: `u-${id}`, timestamp: at(), message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
});
const resultRow = (id: string, toolUseResult?: unknown) => ({
  type: 'user', uuid: `r-${id}`, timestamp: at(),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'done' }] },
  ...(toolUseResult !== undefined && { toolUseResult }),
});
const queued = (block: string) => ({ type: 'queue-operation', operation: 'enqueue', timestamp: at(), sessionId: 's', content: block });
const notice = (elements: string) => `<task-notification>\n${elements}\n</task-notification>`;
const launch = (id: string, agentId: string, description: string) => [
  callRow(id, 'Agent', { description, prompt: '…', run_in_background: true }),
  resultRow(id, { isAsync: true, status: 'async_launched', agentId }),
];
const shell = (id: string, taskId: string) => [callRow(id, 'Bash', { command: 'sleep 60', run_in_background: true }), resultRow(id, { backgroundTaskId: taskId })];
const meta = (agentId: string, fields: Record<string, unknown>): AgentMeta => ({ agentId, meta: { agentType: 'general-purpose', ...fields } });
const running = { sessionRunning: true };

describe('the agents half beside the vectors', () => {
  it('a block that names only a call ends that call’s agent and no job', () => {
    const ledger = ledgerOf([
      ...launch('toolu_A', 'agentA', 'Survey'),
      ...shell('toolu_S', 'shellS'),
      queued(notice('<tool-use-id>toolu_A</tool-use-id>\n<status>completed</status>\n<summary>Agent "Survey" finished</summary>')),
    ]);
    const body = derive(ledger, { ...noAgents, ...running, metas: [meta('agentA', { toolUseId: 'toolu_A', requestShape: 'background' })] });
    expect(body.subagents.map((e) => [e.status, e.evidence, e.outcome?.summary])).toEqual([['completed', 'rows', 'Agent "Survey" finished']]);
    expect(body.jobs.map((j) => [j.taskId, j.status])).toEqual([['shellS', 'running']]);
  });

  it('a background agent’s result row other than its launch is not its end', () => {
    const ledger = ledgerOf([callRow('toolu_B', 'Agent', { description: 'Draft', run_in_background: 'true' }), resultRow('toolu_B', { status: 'completed' })]);
    const metas = [meta('agentB', { toolUseId: 'toolu_B' })];
    expect(derive(ledger, { ...noAgents, ...running, metas }).subagents[0]).toMatchObject({ status: 'unknown', evidence: 'none' });
    expect(ledger.agentOutcome('agentB', 'toolu_B', false)).toBeNull(); // the call asked for the background
    expect(ledgerOf([callRow('toolu_F', 'Agent'), resultRow('toolu_F', { status: 'completed' })]).agentOutcome('agentF', 'toolu_F', false)).toMatchObject({ status: 'completed' });
  });

  it('a nested agent with no parent ledger and no bridge record is unknown', () => {
    const metas = [meta('agentP', { toolUseId: 'toolu_P', requestShape: 'background' }), meta('agentN', { toolUseId: 'toolu_N', parentAgentId: 'agentP' })];
    const body = derive(ledgerOf(launch('toolu_P', 'agentP', 'Parent')), { ...running, metas, bridge: null, parents: new Map([['agentP', null]]) });
    expect(body.subagents.map((e) => [e.agentId, e.status, e.evidence])).toEqual([['agentP', 'running', 'rows'], ['agentN', 'unknown', 'none']]);
  });

  // X's parent is Y and Y's is X: Y is derived inside X's derivation, where X is not yet decided, so Y cannot rest on X;
  // and X is decided once, from its own record.
  it('a parent cycle in the metas ends, each agent derived once', () => {
    const metas = [meta('agentX', { parentAgentId: 'agentY' }), meta('agentY', { parentAgentId: 'agentX' })];
    const ended = { agentId: 'agentX', parentAgentId: 'agentY', subagentType: 'general-purpose', description: 'X', running: false };
    const body = derive(new Ledger(), { ...running, metas, bridge: [ended], parents: new Map() });
    expect(body.subagents.map((e) => [e.agentId, e.status, e.evidence])).toEqual([['agentX', 'exited', 'bridge'], ['agentY', 'unknown', 'none']]);
  });

  it('callAt keeps an Agent or Task call’s row time after its result, and nothing else’s', () => {
    const call = callRow('toolu_C', 'Task', { description: 'Read' });
    const ledger = ledgerOf([call, resultRow('toolu_C', { status: 'completed' }), ...shell('toolu_D', 'shellD')]);
    expect(ledger.callAt('toolu_C')).toBe(call.timestamp);
    expect(ledger.callAt('toolu_D')).toBeNull();
    expect(ledger.callAt('toolu_none')).toBeNull();
  });

  it('facts grows by one for each row that adds a fact the body is made of, and for no other row', () => {
    const ledger = new Ledger();
    const moves = (row: unknown): number => {
      const before = ledger.facts;
      ledger.add(row);
      return ledger.facts - before;
    };
    // Rows that name no agent and no job: what a turn that streams writes.
    expect(moves({ type: 'user', uuid: 'p1', timestamp: at(), message: { role: 'user', content: 'Read the plan.' } })).toBe(0);
    expect(moves({ type: 'assistant', uuid: 'a1', timestamp: at(), message: { role: 'assistant', content: [{ type: 'text', text: 'Reading it.' }] } })).toBe(0);
    expect(moves(callRow('toolu_R', 'Read', { file_path: '/work/plan.md' }))).toBe(0);
    expect(moves(resultRow('toolu_R'))).toBe(0);
    expect(moves(callRow('toolu_E', 'Bash', { command: 'ls' }))).toBe(0); // a Bash call is no fact until its result starts a job
    expect(moves(resultRow('toolu_E', { stdout: 'plan.md' }))).toBe(0); // a command in the foreground starts none
    expect(moves({ type: 'queue-operation', operation: 'enqueue', timestamp: at(), sessionId: 's', content: 'A prompt typed ahead.' })).toBe(0);
    expect(moves({ type: 'attachment', uuid: 'x1', timestamp: at(), attachment: { type: 'hook_success', hookName: 'Stop' } })).toBe(0);
    expect(moves(callRow('toolu_K', 'TaskStop', { task_id: 'shellJ' }))).toBe(0); // a stop's word is its result's
    // Each kind of row that adds one.
    expect(moves(callRow('toolu_G', 'Agent', { description: 'Go', run_in_background: true }))).toBe(1);
    expect(moves(resultRow('toolu_G', { status: 'async_launched', agentId: 'agentG' }))).toBe(1);
    expect(moves(callRow('toolu_J', 'Bash', { command: 'sleep 9', run_in_background: true }))).toBe(0);
    expect(moves(resultRow('toolu_J', { backgroundTaskId: 'shellJ' }))).toBe(1); // a job's start
    expect(moves(queued(notice('<task-id>agentG</task-id>\n<status>completed</status>')))).toBe(1);
    expect(moves({ type: 'attachment', uuid: 'x2', timestamp: at(), attachment: { type: 'task_status', taskId: 'shellJ', status: 'running' } })).toBe(1);
    const path = { type: 'task_status', taskId: 'shellJ', outputFilePath: '/tmp/t/shellJ.output' };
    expect(moves({ type: 'attachment', uuid: 'x3', timestamp: at(), attachment: path })).toBe(1); // a job's output path
    expect(moves({ type: 'attachment', uuid: 'x4', timestamp: at(), attachment: path })).toBe(0); // the same path again
    expect(moves(resultRow('toolu_K', { message: 'Stopped' }))).toBe(1);
    expect(moves({ type: 'user', uuid: 'n1', isMeta: true, origin: { kind: 'plugin' }, timestamp: at(), message: { role: 'user', content: 'Task shellJ, a background task, was stopped from the desk: it is not running.' } })).toBe(1);
    // A row that adds several facts adds one.
    expect(moves(queued(`${notice('<task-id>shellJ</task-id>\n<status>killed</status>')}\n\n${notice('<task-id>agentG</task-id>\n<status>failed</status>')}`))).toBe(1);
  });

  it('settled holds an ended status no later row can change', () => {
    const entry = (agentId: string, status: DerivedAgent['status'], evidence: DerivedAgent['evidence'], parentAgentId?: string): DerivedAgent => ({
      agentId, meta: parentAgentId === undefined ? {} : { parentAgentId }, status, evidence,
    });
    const of = (...entries: DerivedAgent[]) => new Map(entries.map((e) => [e.agentId, e]));
    for (const status of ['completed', 'failed', 'stopped', 'exited'] as const) expect(settled(entry('a', status, 'rows'), of())).toBe(true);
    expect(settled(entry('a', 'exited', 'session'), of())).toBe(true);
    expect(settled(entry('a', 'exited', 'bridge'), of())).toBe(false);
    expect(settled(entry('a', 'running', 'bridge'), of())).toBe(false);
    expect(settled(entry('a', 'running', 'rows'), of())).toBe(false);
    expect(settled(entry('a', 'unknown', 'none'), of())).toBe(false);
    const settledParent = entry('p', 'completed', 'rows');
    const provisionalParent = entry('q', 'exited', 'bridge');
    expect(settled(entry('n', 'exited', 'parent', 'p'), of(settledParent))).toBe(true);
    expect(settled(entry('n', 'exited', 'parent', 'q'), of(provisionalParent))).toBe(false);
    expect(settled(entry('n', 'exited', 'parent', 'r'), of())).toBe(false); // a parent with no entry
    const nested: DerivedAgent = { agentId: 'n', meta: {}, status: 'exited', evidence: 'parent', spawn: { parentAgentId: 'p', subagentType: 'general-purpose', description: 'N' } };
    expect(settled(nested, of(settledParent))).toBe(true); // the parent named by the bridge's record
  });
});

// R9 (the architect's ruling of 2026-11-15): a block the engine writes at a resume can name several tasks, with one
// status; each named task takes it. Until probe P1 records such a block and its vector is written, these two hold it.
describe('every <task-id> of a block', () => {
  it('one block with two agents’ ids and stopped ends both', () => {
    const ledger = ledgerOf([
      ...launch('toolu_1', 'agent1', 'One'),
      ...launch('toolu_2', 'agent2', 'Two'),
      ...launch('toolu_3', 'agent3', 'Three'),
      queued(notice('<task-id>agent1</task-id>\n<task-id>agent2</task-id>\n<status>stopped</status>\n<summary>2 background agents: "One" (agent1), "Two" (agent2).</summary>')),
    ]);
    const metas = ['1', '2', '3'].map((n) => meta(`agent${n}`, { toolUseId: `toolu_${n}`, requestShape: 'background' }));
    const body = derive(ledger, { ...noAgents, ...running, metas });
    expect(body.subagents.map((e) => [e.agentId, e.status, e.evidence, e.outcome?.raw])).toEqual([
      ['agent1', 'stopped', 'rows', 'stopped'],
      ['agent2', 'stopped', 'rows', 'stopped'],
      ['agent3', 'running', 'rows', 'async_launched'],
    ]);
  });

  it('one block with two shells’ ids and a marker id ends both jobs and nothing else', () => {
    const ledger = ledgerOf([
      ...shell('toolu_4', 'shell4'),
      ...shell('toolu_5', 'shell5'),
      ...shell('toolu_6', 'shell6'),
      ...launch('toolu_7', 'agent7', 'Seven'),
      queued(notice('<task-id>shell4</task-id>\n<task-id>shell5</task-id>\n<task-id>__orphan_summary__:shell</task-id>\n<status>stopped</status>\n<summary>2 background shell command tasks.</summary>')),
    ]);
    const body = derive(ledger, { ...noAgents, ...running, metas: [meta('agent7', { toolUseId: 'toolu_7', requestShape: 'background' })] });
    expect(body.jobs.map((j) => [j.taskId, j.status])).toEqual([['shell4', 'stopped'], ['shell5', 'stopped'], ['shell6', 'running']]);
    expect(body.subagents.map((e) => [e.agentId, e.status])).toEqual([['agent7', 'running']]);
  });
});
