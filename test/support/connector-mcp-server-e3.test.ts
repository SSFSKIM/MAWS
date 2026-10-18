// E3 M4 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R5, Decision Log 13): the connector fixture's rows mode
// (e2e/support/connector-mcp-server.mjs), run with the arguments the connector scene gives it (connector-scene.ts
// `fixtureServer`, which this project cannot typecheck: its page code needs the DOM) and driven over stdio as the
// engine drives it. H's default answer is unchanged; in rows mode a call answers the standard `{rows: [...]}` envelope of flat
// records, and the reply its control file names (other rows, an invalid structured result, a tool error, a delay) is
// read at each call, so one query (same server, tool and arguments) can answer differently. The host's own reader of a
// query result (query-result.ts) is the judge of which replies are rows. Stdio only: no network, no auth.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QUERY_RESULT_PROBLEMS, queryRowsOf } from '../../src/engine-host/dashboards/query-result';

const SERVER = join(__dirname, '..', '..', 'e2e', 'support', 'connector-mcp-server.mjs');
const TOOL = 'read_series'; // the scene's
// the scene's writer: whole, written aside and renamed
const writeFixtureReply = (file: string, reply: Record<string, unknown>) => {
  writeFileSync(`${file}.tmp`, JSON.stringify(reply));
  renameSync(`${file}.tmp`, file);
};

interface Answer {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

let scratch: string;
let log: string;
let control: string;
let child: ChildProcessWithoutNullStreams | null;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'maws-connector-fixture-e3-')));
  log = join(scratch, 'calls.jsonl');
  control = join(scratch, 'fixture-reply.json');
  child = null;
});
afterEach(async () => {
  if (child && child.exitCode === null) {
    child.stdin.end();
    await new Promise((resolve) => child!.once('exit', resolve));
  }
  rmSync(scratch, { recursive: true, force: true });
});

// The fixture as the scene runs it (H's arguments; in a live data scene, the rows mode and its control file), and a
// client that sends requests and answers each by id, in the order the answers arrived.
function serve(controlFile: string | null) {
  const rows = controlFile === null ? [] : ['--mode', 'rows', '--control', controlFile];
  child = spawn(process.execPath, [SERVER, '--id', 'series', '--log', log, '--tools', JSON.stringify([TOOL]), ...rows], { stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = new Map<number, (answer: Answer) => void>();
  const arrived: number[] = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    const answer = JSON.parse(line) as Answer;
    arrived.push(answer.id);
    waiting.get(answer.id)?.(answer);
  });
  let next = 0;
  const request = (method: string, params?: unknown): Promise<Answer> => {
    const id = next++;
    const answered = new Promise<Answer>((resolve) => waiting.set(id, resolve));
    child!.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`);
    return answered;
  };
  const call = (args: Record<string, unknown> = { series: 'signups' }) => request('tools/call', { name: TOOL, arguments: args });
  return { request, call, arrived };
}
const toolCalls = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { method: string; tool?: string; arguments?: unknown }).filter((entry) => entry.method === 'tools/call');

describe('the connector fixture (E3 M4)', () => {
  it('keeps H’s default answer, {server, tool, arguments, n} as text and structured content, without the rows mode', async () => {
    const { call } = serve(null);
    const first = await call();
    const second = await call({ series: 'other' });
    expect(first.result).toEqual({ content: [{ type: 'text', text: JSON.stringify({ server: 'series', tool: TOOL, arguments: { series: 'signups' }, n: 1 }) }], structuredContent: { server: 'series', tool: TOOL, arguments: { series: 'signups' }, n: 1 } });
    expect(second.result!.structuredContent).toEqual({ server: 'series', tool: TOOL, arguments: { series: 'other' }, n: 2 });
  });

  it('in rows mode with no reply set, answers its built-in flat records in the {rows} envelope the host reads, unauthenticated and read-only', async () => {
    const { request, call } = serve(control);
    const init = await request('initialize', { protocolVersion: '2025-06-18' });
    expect(init.result).toEqual({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'maws-connector-fixture', version: '0.0.1' } });
    const listed = (await request('tools/list')).result!.tools as { name: string; annotations: { readOnlyHint: boolean } }[];
    expect(listed.map((tool) => [tool.name, tool.annotations.readOnlyHint])).toEqual([[TOOL, true]]);
    const answer = (await call()).result!;
    const rows = [
      { day: '2026-10-01', signups: 12 },
      { day: '2026-10-02', signups: 18 },
      { day: '2026-10-03', signups: 15 },
    ];
    expect(answer).toEqual({ content: [{ type: 'text', text: JSON.stringify({ rows }) }], structuredContent: { rows } });
    expect(queryRowsOf(answer)).toEqual({ ok: true, rows });
  });

  it('answers the rows its control file names, changed between two calls of the same query', async () => {
    const { call } = serve(control);
    const before = [{ day: '2026-10-01', signups: 12 }];
    const after = [{ day: '2026-10-01', signups: 12 }, { day: '2026-10-02', signups: 40 }];
    writeFixtureReply(control, { reply: 'rows', rows: before });
    expect(queryRowsOf((await call()).result)).toEqual({ ok: true, rows: before });
    writeFixtureReply(control, { reply: 'rows', rows: after });
    expect(queryRowsOf((await call()).result)).toEqual({ ok: true, rows: after });
    expect(toolCalls().map((entry) => [entry.tool, entry.arguments]), 'one query, called twice').toEqual([
      [TOOL, { series: 'signups' }],
      [TOOL, { series: 'signups' }],
    ]);
  });

  it('answers an invalid structured result, then a tool error, for the same query, each refused by the host’s reader', async () => {
    const { call } = serve(control);
    writeFixtureReply(control, { reply: 'invalid' });
    const invalid = (await call()).result!;
    expect(invalid.isError).toBeUndefined();
    expect(queryRowsOf(invalid)).toEqual({ ok: false, problem: QUERY_RESULT_PROBLEMS.structured });
    writeFixtureReply(control, { reply: 'isError' });
    const failed = (await call()).result!;
    expect(failed.isError).toBe(true);
    expect(queryRowsOf(failed)).toEqual({ ok: false, problem: QUERY_RESULT_PROBLEMS.toolError });
    writeFixtureReply(control, { reply: 'rows', rows: [{ day: '2026-10-04', signups: 9 }] });
    expect(queryRowsOf((await call()).result)).toEqual({ ok: true, rows: [{ day: '2026-10-04', signups: 9 }] });
    expect(toolCalls()).toHaveLength(3);
  });

  it('delays a call’s answer as set, answering requests that arrive meanwhile first', async () => {
    const { request, call, arrived } = serve(control);
    writeFixtureReply(control, { reply: 'rows', rows: [{ day: '2026-10-01', signups: 1 }], delayMs: 400 });
    const started = Date.now();
    const delayed = call();
    const ping = await request('ping');
    expect(ping.result).toEqual({});
    const answer = await delayed;
    expect(Date.now() - started).toBeGreaterThanOrEqual(400);
    expect(arrived).toEqual([1, 0]);
    expect(queryRowsOf(answer.result)).toEqual({ ok: true, rows: [{ day: '2026-10-01', signups: 1 }] });
  });

  it('answers an error, never rows, when its control file names no reply it knows', async () => {
    const { call } = serve(control);
    writeFileSync(control, JSON.stringify({ reply: 'sometimes' }));
    const answer = await call();
    expect(answer.result).toBeUndefined();
    expect(answer.error).toMatchObject({ code: -32603, message: expect.stringContaining('fixture reply') });
    writeFileSync(control, '{"reply": "rows", "rows": [');
    expect((await call()).error, 'a control file that is not JSON').toMatchObject({ code: -32603 });
    writeFixtureReply(control, { reply: 'rows', rows: [], delayMs: -1 });
    expect((await call()).error, 'a negative delay').toMatchObject({ code: -32603 });
  });
});
