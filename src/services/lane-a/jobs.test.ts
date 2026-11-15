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

// The U8d probes' recordings on engine 2.1.322 (spikes/protocol-probe/findings-uxwave-u8d-resume-orphans.txt and
// findings-uxwave-u8d-process-end.txt), replayed from their fixtures: a main transcript holding a process that ended and
// the resume after it, and the agents' sidecars. Each expected body is written by hand from the rules. Where a case puts
// the port ahead of the shared rules (several ids in one block, R9; the parent rule, N1), doperpowers issue 504 asks
// sminos to follow.
const PROBES = join(__dirname, '../../../spikes/protocol-probe/fixtures/uxwave');
const jsonl = (path: string): unknown[] => readFileSync(path, 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as unknown);
const recorded = (name: string): Ledger => ledgerOf(jsonl(join(PROBES, `${name}.transcript.jsonl`)));
const sidecar = (name: string, agentId: string): AgentMeta => ({ agentId, meta: JSON.parse(readFileSync(join(PROBES, `${name}-subagents/agent-${agentId}.meta.json`), 'utf8')) as Record<string, unknown> });
const agentLedger = (name: string, agentId: string): Ledger => ledgerOf(jsonl(join(PROBES, `${name}-subagents/agent-${agentId}.jsonl`)));
const resumed = { bridge: null, parents: new Map<string, Ledger | null>(), sessionRunning: true }; // the resumed process runs

describe('the probes’ recordings', () => {
  // Two background agents orphaned by the process's end; the resume ends both with one block (its queue record, line
  // 43, then its user row, line 45), two <task-id> and one <status>. sminos reads the first id only, and would leave the
  // second running (doperpowers issue 504).
  it('u8d-p1-two-r1: one block names both orphaned agents, and both read stopped', () => {
    const name = 'u8d-p1-two-r1';
    const metas = [sidecar(name, 'a9e2112e4a1755b40'), sidecar(name, 'ab58a371c69e84a69')];
    const summary = '2 background agents didn\'t finish before the previous session ended: "uxw slow A" (a9e2112e4a1755b40), "uxw slow B" (ab58a371c69e84a69).';
    const outcome = { status: 'stopped', raw: 'stopped', at: '2026-11-15T10:55:33.094Z', summary };
    expect(derive(recorded(name), { ...resumed, metas })).toEqual({
      subagents: metas.map((m) => ({ ...m, status: 'stopped', evidence: 'rows', outcome })),
      jobs: [],
      mcp: [],
    });
  });

  // One agent finished before the end (its notification queued, line 42, and delivered, line 51); the other orphaned and
  // ended at the resume with a block of its own that carries its <output-file> (lines 55 and 57).
  it('u8d-p1-one-r1: the finished agent reads completed, the orphan stopped with its output file', () => {
    const name = 'u8d-p1-one-r1';
    const quick = sidecar(name, 'a1e5eb2c1a7a229a3');
    const slow = sidecar(name, 'a48fa20e5db72d1c0');
    const tasks = '/tmp/claude-501/-tmp-u8d-YZwo3F-work/f153eb67-d503-4016-9c1e-d538f5b4e441/tasks';
    expect(derive(recorded(name), { ...resumed, metas: [quick, slow] }).subagents).toEqual([
      { ...quick, status: 'completed', evidence: 'rows', outcome: { status: 'completed', raw: 'completed', at: '2026-11-15T10:55:23.788Z', summary: 'Agent "uxw quick Q" finished', outputFile: `${tasks}/a1e5eb2c1a7a229a3.output` } },
      { ...slow, status: 'stopped', evidence: 'rows', outcome: { status: 'stopped', raw: 'stopped', at: '2026-11-15T10:55:34.152Z', summary: 'Background agent "uxw slow B" didn\'t finish before the previous session ended', outputFile: `${tasks}/a48fa20e5db72d1c0.output` } },
    ]);
  });

  // N5: at the process's end each running shell gets its own `killed` queue record (lines 42, 43); the resume then ends
  // both with one block that also names the marker `__orphan_summary__:shell` (line 45, and its user row, line 47). A
  // terminal word replaces a terminal word, so each shell ends on the resume's `stopped`, the last of its words.
  it('u8d-p1-shells-r1: two shells killed at the exit, then stopped by one block with a marker id', () => {
    const tasks = '/tmp/claude-501/-tmp-u8d-FsYX0Z-work/305ba1ea-fefb-436f-a2aa-7f93dbc71691/tasks';
    const ended = { status: 'stopped', endedAt: '2026-11-15T10:55:31.408Z', summary: '2 background shell command tasks didn\'t finish before the previous session ended. Task ids: blarjjpox, b7zjm1p3t.' };
    expect(derive(recorded('u8d-p1-shells-r1'), { ...resumed, metas: [] })).toEqual({
      subagents: [],
      jobs: [
        { taskId: 'blarjjpox', kind: 'shell', toolUseId: 'toolu_01W9p9UCWqEiBRVFwpqK4YZ4', startedAt: '2026-11-15T10:55:18.406Z', description: 'uxw shell S1', command: 'python3 uxw8d_wait.py 300', outputFile: `${tasks}/blarjjpox.output`, ...ended },
        { taskId: 'b7zjm1p3t', kind: 'shell', toolUseId: 'toolu_01V4Na5zo9AfhCLdV8eBcwVA', startedAt: '2026-11-15T10:55:18.596Z', description: 'uxw shell S2', command: 'python3 uxw8d_wait.py 300', outputFile: `${tasks}/b7zjm1p3t.output`, ...ended },
      ],
      mcp: [],
    });
  });

  // One shell: killed at the exit (line 40), then a block of its own at the resume with its <tool-use-id> (lines 42, 44).
  it('u8d-p1-shell-r1: one shell killed at the exit, then stopped by its own block', () => {
    expect(derive(recorded('u8d-p1-shell-r1'), { ...resumed, metas: [] }).jobs).toEqual([{
      taskId: 'b7emsuyr8', kind: 'shell', toolUseId: 'toolu_014soDweDLuLctuPdNwEE3iK', startedAt: '2026-11-15T10:57:06.452Z', description: 'uxw shell S1', command: 'python3 uxw8d_wait.py 300',
      outputFile: '/tmp/claude-501/-tmp-u8d-VlztQ7-work/71e4a95e-ccce-4b0b-a3f6-bcf39e2139d1/tasks/b7emsuyr8.output',
      status: 'stopped', endedAt: '2026-11-15T10:57:21.417Z', summary: 'Background shell command didn\'t finish before the previous session ended',
    }]);
  });

  // N1: the parent P handed back while its nested background agent N still ran (P's meta `finished: true`); the rows give
  // P no end (a hand-back is no notification), and N's launch is in P's file. The bridge's account is written here by
  // hand, as the bridge folds an engine's SubagentStop for P: P not running, N running. sminos's parent rule would read N
  // exited (parent) while it ran (doperpowers issue 504).
  describe('u8d-p3-nested-r1: a nested background agent outlives its parent', () => {
    const name = 'u8d-p3-nested-r1';
    const parent = sidecar(name, 'a74b32748ee137457');
    const nested = sidecar(name, 'a55be110357fb4fc5');
    const tasks = '/tmp/claude-501/-tmp-u8d-CMS04c-work/1edf9488-5e1f-41e5-871d-fc9f9994ae5b/tasks';
    const parentLaunch = { status: 'running', raw: 'async_launched', at: '2026-11-15T10:58:39.774Z', outputFile: `${tasks}/a74b32748ee137457.output` };
    const nestedLaunch = { status: 'running', raw: 'async_launched', at: '2026-11-15T10:58:43.435Z', outputFile: `${tasks}/a55be110357fb4fc5.output` };
    const parentSpawn = { parentAgentId: null, subagentType: 'general-purpose', description: 'uxw parent P' };
    const nestedSpawn = { parentAgentId: 'a74b32748ee137457', subagentType: 'general-purpose', description: 'uxw nested N', background: true };
    const bridge = [{ agentId: 'a74b32748ee137457', ...parentSpawn, running: false }, { agentId: 'a55be110357fb4fc5', ...nestedSpawn, running: true }];
    const input = { metas: [parent, nested], parents: new Map([['a74b32748ee137457', agentLedger(name, 'a74b32748ee137457')]]) };

    it('the parent ended on the bridge’s word and the nested agent held running reads running (bridge)', () => {
      expect(derive(recorded(name), { ...input, bridge, sessionRunning: true }).subagents).toEqual([
        { ...parent, status: 'exited', evidence: 'bridge', running: false, spawn: parentSpawn, outcome: parentLaunch },
        { ...nested, status: 'running', evidence: 'bridge', running: true, spawn: nestedSpawn, outcome: nestedLaunch },
      ]);
    });

    it('with no bridge, both read running from their launches (rows)', () => {
      expect(derive(recorded(name), { ...input, bridge: null, sessionRunning: true }).subagents).toEqual([
        { ...parent, status: 'running', evidence: 'rows', outcome: parentLaunch },
        { ...nested, status: 'running', evidence: 'rows', outcome: nestedLaunch },
      ]);
    });

    // The architect's bound: once the process is gone, every agent that was running or provisionally ended reads
    // exited (session), background or not, nested or not, whatever its parent or the bridge's last word said.
    it('once the process is gone, both read exited (session), whatever the bridge last said', () => {
      expect(derive(recorded(name), { ...input, bridge, sessionRunning: false }).subagents).toEqual([
        { ...parent, status: 'exited', evidence: 'session', spawn: parentSpawn, outcome: parentLaunch },
        { ...nested, status: 'exited', evidence: 'session', spawn: nestedSpawn, outcome: nestedLaunch },
      ]);
    });
  });
});

describe('the parent rule (N1)', () => {
  const metas = (nested: Record<string, unknown>) => [meta('agentP', { toolUseId: 'toolu_P', requestShape: 'background' }), meta('agentN', { toolUseId: 'toolu_N', parentAgentId: 'agentP', ...nested })];
  const main = () => ledgerOf([...launch('toolu_P', 'agentP', 'Parent'), queued(notice('<task-id>agentP</task-id>\n<status>completed</status>'))]);

  it('ends a nested agent that is not a background agent with its parent', () => {
    const parents = new Map([['agentP', ledgerOf([callRow('toolu_N', 'Agent', { description: 'Child' })])]]);
    expect(derive(main(), { ...running, metas: metas({ requestShape: 'foreground' }), bridge: null, parents }).subagents[1]).toMatchObject({ status: 'exited', evidence: 'parent' });
  });

  // §A's three ways to know a background agent: the meta, the bridge's spawn, the call's own input.
  const known: [string, Record<string, unknown>, unknown[], BridgeAgent[] | null][] = [
    ['its meta', { requestShape: 'background' }, [callRow('toolu_N', 'Agent', { description: 'Child' })], null],
    ['the bridge’s spawn', {}, [callRow('toolu_N', 'Agent', { description: 'Child' })], [{ agentId: 'agentN', parentAgentId: 'agentP', subagentType: 'general-purpose', description: 'Child', background: true, running: true }]],
    ['its call’s input', {}, [callRow('toolu_N', 'Agent', { description: 'Child', run_in_background: 'true' })], null],
  ];
  it.each(known)('does not end a background nested agent known by %s', (_how, nestedMeta, parentRows, bridge) => {
    const parents = new Map([['agentP', ledgerOf(parentRows)]]);
    expect(derive(main(), { ...running, metas: metas(nestedMeta), bridge, parents }).subagents[1].evidence).not.toBe('parent');
  });
});
