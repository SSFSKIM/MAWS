// The DX4 envelope's per-kind invariants are types: `pnpm typecheck` (tsconfig.test.json) fails if any
// `@ts-expect-error` below stops being an error. The runtime cases only keep the file a suite.
import { describe, expect, it } from 'vitest';
import { INTERPRETED_KINDS, SESSION_WIDE_KINDS, SUBSCRIPTION_KINDS, type Job, type SessionMessage, type SubagentMeta } from '../../src/protocol/session';

const base = { project: 'p', machine: 'mini' };
const chunk = { turnId: 't', agentId: null, step: 0, chunkIndex: 0, chunk: { text: 'hi' } };
const presence = { record: null, bridge: true };
const machine = { online: true, policy: { read_only: false, ceiling: 'default' }, checkouts: [] };

// The message-level `upTo` is the watermark; a block's own is informational; a tool block names its call.
const streaming = [
  {
    turnId: 't',
    agentId: null,
    step: 0,
    model: 'claude-opus-5-5',
    upTo: 7,
    blocks: [
      { index: 1, kind: 'text' as const, text: 'Hel', upTo: 3 },
      { index: 2, kind: 'tool' as const, text: '{"command":"ls', upTo: 7, id: 'toolu_01', name: 'Bash' },
    ],
  },
];
const usage = { context: { tokens: 5000, window: 200000, percent: 2 }, cost: { usd: 0.42 } };

// The `subagents` body as each producer age sends it: one older than DC8 names each agent and its meta alone; DC8's adds
// the status with its evidence and what it rests on, the loop's jobs, and its MCP servers' names.
const meta = { agentType: 'general-purpose', description: 'survey the code', toolUseId: 'toolu_01' };
const oldEntry: SubagentMeta = { agentId: 'a1', meta };
const spawn = { parentAgentId: null, subagentType: 'general-purpose', description: 'survey the code', name: null, background: true, model: 'claude-opus-5-5', toolUseId: 'toolu_01' };
const entries: SubagentMeta[] = [
  { agentId: 'a1', meta, status: 'completed', evidence: 'rows', outcome: { status: 'completed', raw: 'completed', at: '2026-10-17T08:00:00.000Z', summary: 'done', outputFile: '/tmp/x.output' }, file: { size: 4096, mtimeMs: 1760688000000, firstAt: '2026-10-17T07:59:00.000Z', lastAt: '2026-10-17T08:00:00.000Z' } },
  { agentId: 'a2', meta: { toolUseId: 'toolu_02' }, status: 'running', evidence: 'bridge', running: true, spawn },
  // A module reloaded mid-session seeds what `$.agent.list()` gives: no name, background, model, or tool-use id.
  { agentId: 'a3', meta: {}, status: 'running', evidence: 'bridge', running: true, spawn: { parentAgentId: 'a2', subagentType: 'Explore', description: 'look' } },
  { agentId: 'a4', meta: { parentAgentId: 'a2' }, status: 'exited', evidence: 'parent' },
  { agentId: 'a5', meta: {}, status: 'unknown', evidence: 'none' },
];
const jobs: Job[] = [
  { taskId: 'b7k2m9q4x', kind: 'shell', toolUseId: 'toolu_03', startedAt: '2026-10-17T08:01:00.000Z', description: 'the suite', command: 'pnpm test', outputFile: '/private/tmp/claude-501/p/s/tasks/b7k2m9q4x.output', status: 'running' },
  // A monitor names no output file at its start.
  { taskId: 'm3n8p1r5t', kind: 'monitor', toolUseId: 'toolu_04', startedAt: '2026-10-17T08:02:00.000Z', description: 'watch the build', outputFile: null, status: 'stopped', endedAt: '2026-10-17T08:05:00.000Z', summary: 'stopped' },
];
const mcp = [{ name: 'doperpowers' }, { name: 'cua_repl' }];

export const admitted: SessionMessage[] = [
  { ...base, session: 's', kind: 'chunk', sub: 'x', n: 4, body: chunk },
  { ...base, session: 's', kind: 'snapshot', sub: 'x', n: 0, body: { rows: [], more: false, subagents: [], presence, streaming, usage } },
  // An agent-scope sub's snapshot carries no usage; a main one without a bridge carries null.
  { ...base, session: 's', kind: 'snapshot', sub: 'y', n: 0, body: { rows: [], more: false, subagents: [], presence, streaming: [] } },
  { ...base, session: 's', kind: 'snapshot', sub: 'z', n: 0, body: { rows: [], more: false, subagents: [], presence, streaming: [], usage: null } },
  { ...base, session: 's', kind: 'usage', sub: 'x', n: 7, body: { context: { window: 200000 }, cost: null } },
  { ...base, session: 's', kind: 'diff', sub: 'x', n: 8, body: { base: 'main', text: '' } },
  { ...base, session: 's', kind: 'compact', sub: null, n: null, body: { rpc: 'BQUFBQUFBQUFBQUFBQUFBQ', phase: 'end', tokensBefore: 90000, tokensAfter: 12000 } },
  { ...base, session: 's', kind: 'compact', sub: null, n: null, body: { rpc: null, phase: 'end', skip: 'a hook vetoed it' } },
  { ...base, session: 's', kind: 'block-row', sub: 'x', n: 5, body: { uuid: 'u', turnId: 't', agentId: null, step: 0, index: 1 } },
  // A step ended (finished, aborted, or cut off by its turn's end), after every block-row of it.
  { ...base, session: 's', kind: 'step-end', sub: 'x', n: 9, body: { turnId: 't', agentId: 'a1', step: 2 } },
  { ...base, session: 's', kind: 'end', sub: 'x', n: 6, body: { reason: 'discontinuity' } },
  // An end may come first, before a snapshot could be taken.
  { ...base, session: 's', kind: 'end', sub: 'w', n: 0, body: { reason: 'session-ended', message: 'no such session' } },
  { ...base, session: 's', kind: 'presence', sub: null, n: null, body: presence },
  { ...base, session: null, kind: 'machine', sub: null, n: null, body: machine },
  // A producer older than DC8: each agent's id and meta alone, in the snapshot and in `subagents`.
  { ...base, session: 's', kind: 'subagents', sub: 'x', n: 10, body: { subagents: [oldEntry] } },
  { ...base, session: 's', kind: 'snapshot', sub: 'v', n: 0, body: { rows: [], more: false, subagents: [oldEntry], presence, streaming: [], usage: null } },
  // DC8's: status, evidence, jobs, and MCP names, in both.
  { ...base, session: 's', kind: 'subagents', sub: 'x', n: 11, body: { subagents: entries, jobs, mcp } },
  { ...base, session: 's', kind: 'snapshot', sub: 'u', n: 0, body: { rows: [], more: false, subagents: entries, presence, streaming: [], usage: null, jobs, mcp } },
  // A task's output, each of its four answers.
  { ...base, session: 's', kind: 'output', sub: 'x', n: 12, body: { taskId: 'b7k2m9q4x', result: 'ok', path: '/private/tmp/claude-501/p/s/tasks/b7k2m9q4x.output', size: 70000, from: 4471, text: 'PASS\n', truncated: true } },
  { ...base, session: 's', kind: 'output', sub: 'x', n: 13, body: { taskId: 'b7k2m9q4x', result: 'missing', path: '/private/tmp/claude-501/p/s/tasks/b7k2m9q4x.output' } },
  // A known task whose output file no row has named yet (a monitor just started): asked again once one does.
  { ...base, session: 's', kind: 'output', sub: 'x', n: 14, body: { taskId: 'm3n8p1r5t', result: 'missing', path: null } },
  { ...base, session: 's', kind: 'output', sub: 'x', n: 15, body: { taskId: 'b7k2m9q4x', result: 'refused', path: '/etc/passwd', reason: 'the path is outside the session’s tasks directory' } },
  { ...base, session: 's', kind: 'output', sub: 'x', n: 16, body: { taskId: 'zzzz', result: 'unknown-task' } },
  // The desk control surface (M0): a presence with the bridge's capabilities beside `bridge`, a machine's desk, a read's
  // answer or its error on the sub that asked, and an op's start and end to every browser.
  { ...base, session: 's', kind: 'presence', sub: null, n: null, body: { ...presence, capabilities: { sminos: '1.7.0', protocol: 2, engine: '2.1.307', ops: ['read', 'command'], reads: ['status'], routes: { measured: '2.1.307' } } } },
  { ...base, session: null, kind: 'machine', sub: null, n: null, body: { ...machine, desk: { sminos: '1.7.0', rpcs: ['command'], reads: [] } } },
  { ...base, session: 's', kind: 'read', sub: 'x', n: 17, body: { id: 'r1', what: 'status', result: { surfaces: ['cli'] } } },
  { ...base, session: 's', kind: 'read', sub: 'x', n: 18, body: { id: 'r2', what: 'usage', error: { code: 'unsupported', message: 'no read usage' } } },
  { ...base, session: 's', kind: 'op', sub: null, n: null, body: { rpc: 'BQUFBQUFBQUFBQUFBQUFBQ', op: 'command', phase: 'start', id: 'c1', name: 'rename', args: 'x' } },
  { ...base, session: 's', kind: 'op', sub: null, n: null, body: { rpc: null, op: 'command', phase: 'end', id: 'c1', readback: { how: 'none' } } },
];

export const refused: SessionMessage[] = [
  // @ts-expect-error a chunk belongs to a subscription
  { ...base, session: 's', kind: 'chunk', sub: null, n: null, body: chunk },
  // @ts-expect-error a snapshot is n = 0
  { ...base, session: 's', kind: 'snapshot', sub: 'x', n: 3, body: { rows: [], more: false, subagents: [], presence, streaming: [] } },
  // @ts-expect-error machine presence names no session
  { ...base, session: 's', kind: 'machine', sub: null, n: null, body: machine },
  // @ts-expect-error session presence is published to every browser, outside any subscription
  { ...base, session: 's', kind: 'presence', sub: 'x', n: 1, body: presence },
  // @ts-expect-error the body follows the kind
  { ...base, session: 's', kind: 'row', sub: 'x', n: 1, body: presence },
  // @ts-expect-error a block-row belongs to a subscription
  { ...base, session: 's', kind: 'block-row', sub: null, n: null, body: { uuid: 'u', turnId: 't', agentId: null, step: 0, index: 1 } },
  // @ts-expect-error a step-end belongs to a subscription
  { ...base, session: 's', kind: 'step-end', sub: null, n: null, body: { turnId: 't', agentId: null, step: 0 } },
  // @ts-expect-error a step-end names its step, not a block
  { ...base, session: 's', kind: 'step-end', sub: 'x', n: 3, body: { turnId: 't', agentId: null, index: 0 } },
  // @ts-expect-error a snapshot's streaming entries are per block, not one text per message
  { ...base, session: 's', kind: 'snapshot', sub: 'x', n: 0, body: { rows: [], more: false, subagents: [], presence, streaming: [{ turnId: 't', agentId: null, step: 0, text: 'Hel', upTo: 3 }] } },
  // @ts-expect-error a block is text, thinking, or tool
  { ...base, session: 's', kind: 'snapshot', sub: 'x', n: 0, body: { rows: [], more: false, subagents: [], presence, streaming: [{ turnId: 't', agentId: null, step: 0, upTo: 0, blocks: [{ index: 0, kind: 'image', text: '', upTo: 0 }] }] } },
  // @ts-expect-error the watermark is the message's: an entry carries `upTo`
  { ...base, session: 's', kind: 'snapshot', sub: 'x', n: 0, body: { rows: [], more: false, subagents: [], presence, streaming: [{ turnId: 't', agentId: null, step: 0, blocks: [] }] } },
  // @ts-expect-error usage belongs to a (main-scope) subscription
  { ...base, session: 's', kind: 'usage', sub: null, n: null, body: usage },
  // @ts-expect-error a compaction goes to every browser, outside any subscription
  { ...base, session: 's', kind: 'compact', sub: 'x', n: 3, body: { rpc: null, phase: 'start' } },
  // @ts-expect-error a status is one of MAWS's TaskStatus words
  { ...base, session: 's', kind: 'subagents', sub: 'x', n: 3, body: { subagents: [{ agentId: 'a1', meta, status: 'done', evidence: 'rows' }] } },
  // @ts-expect-error a status comes with the evidence it rests on
  { ...base, session: 's', kind: 'subagents', sub: 'x', n: 3, body: { subagents: [{ agentId: 'a1', meta, status: 'running' }] } },
  // @ts-expect-error evidence is the bridge, the rows, the parent, the session, or none
  { ...base, session: 's', kind: 'subagents', sub: 'x', n: 3, body: { subagents: [{ agentId: 'a1', meta, status: 'running', evidence: 'a hunch' }] } },
  // @ts-expect-error a job's status is never unknown: it is running from its start row
  { ...base, session: 's', kind: 'subagents', sub: 'x', n: 3, body: { subagents: [], jobs: [{ ...jobs[0], status: 'unknown' }] } },
  // @ts-expect-error a job's output file is named or null, never left out
  { ...base, session: 's', kind: 'subagents', sub: 'x', n: 3, body: { subagents: [], jobs: [{ taskId: 't', kind: 'shell', toolUseId: 'u', startedAt: 'a', description: 'd', status: 'running' }] } },
  // @ts-expect-error a job is a shell or a monitor
  { ...base, session: 's', kind: 'subagents', sub: 'x', n: 3, body: { subagents: [], jobs: [{ ...jobs[0], kind: 'agent' }] } },
  // @ts-expect-error an output answers within its subscription
  { ...base, session: 's', kind: 'output', sub: null, n: null, body: { taskId: 't', result: 'unknown-task' } },
  // @ts-expect-error an ok tail says where it starts
  { ...base, session: 's', kind: 'output', sub: 'x', n: 3, body: { taskId: 't', result: 'ok', path: '/p', size: 10, text: 'x', truncated: false } },
  // @ts-expect-error a missing file says which path was looked at, or null for none named yet
  { ...base, session: 's', kind: 'output', sub: 'x', n: 3, body: { taskId: 't', result: 'missing' } },
  // @ts-expect-error a refusal says why
  { ...base, session: 's', kind: 'output', sub: 'x', n: 3, body: { taskId: 't', result: 'refused', path: '/p' } },
  // @ts-expect-error a refusal is of a path the rows named: never null
  { ...base, session: 's', kind: 'output', sub: 'x', n: 3, body: { taskId: 't', result: 'refused', path: null, reason: 'r' } },
  // @ts-expect-error no variant carries a field another's rule leaves out: an unknown task has no path
  { ...base, session: 's', kind: 'output', sub: 'x', n: 3, body: { taskId: 't', result: 'unknown-task', path: '/p' } },
  // @ts-expect-error nor a missing file a text
  { ...base, session: 's', kind: 'output', sub: 'x', n: 3, body: { taskId: 't', result: 'missing', path: '/p', text: '' } },
  // @ts-expect-error the answers are ok, missing, refused, and unknown-task
  { ...base, session: 's', kind: 'output', sub: 'x', n: 3, body: { taskId: 't', result: 'gone' } },
  // @ts-expect-error a read answers within its subscription
  { ...base, session: 's', kind: 'read', sub: null, n: null, body: { id: 'r1', what: 'status' } },
  // @ts-expect-error a read's error has a code from the set
  { ...base, session: 's', kind: 'read', sub: 'x', n: 3, body: { id: 'r1', what: 'status', error: { code: 'nope', message: '' } } },
  // @ts-expect-error an op goes to every browser, outside any subscription
  { ...base, session: 's', kind: 'op', sub: 'x', n: 3, body: { rpc: null, op: 'command', phase: 'start', id: 'c1' } },
  // @ts-expect-error capabilities name the bridge's own plugin version
  { ...base, session: 's', kind: 'presence', sub: null, n: null, body: { ...presence, capabilities: { protocol: 2, engine: '2.1.307', ops: [], reads: [], routes: { measured: '2.1.307' } } } },
];

describe('the DX4 envelope', () => {
  it('splits its kinds between subscriptions and what the hub interprets, with none in both', () => {
    expect(SUBSCRIPTION_KINDS.filter((kind) => (INTERPRETED_KINDS as readonly string[]).includes(kind))).toEqual([]);
    expect(SUBSCRIPTION_KINDS).toContain('block-row');
    expect(SUBSCRIPTION_KINDS).toContain('step-end');
    expect(SUBSCRIPTION_KINDS).toContain('usage');
    expect(SUBSCRIPTION_KINDS).toContain('output');
    expect(SESSION_WIDE_KINDS.filter((kind) => (SUBSCRIPTION_KINDS as readonly string[]).includes(kind))).toEqual([]);
    // The desk control surface's kinds: a read's answer and the catalog on a sub, an op to every browser.
    expect(SUBSCRIPTION_KINDS).toEqual(expect.arrayContaining(['read', 'catalog']));
    expect(SESSION_WIDE_KINDS).toContain('op');
    expect(admitted).toHaveLength(29);
    expect(refused).toHaveLength(31);
  });
});
