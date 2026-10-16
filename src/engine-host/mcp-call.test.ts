// Route E's engine half (P3 Decision Log 24; P3-H): the typed `mcp_call` control, answered from the live probe's own
// frames (spikes/p3-connectors/fixtures/engine-mcp-call.jsonl, Claude Code 2.1.296), its refusals classified, its
// cancellation through control_cancel_request, the compatibility probe, and the engine's tool-name identity checked
// against a recorded session whose init frame lists the qualified names (pass2/real-settings).
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JournalRow } from '@shared/wire/journal';
import type { StdinFrame } from '@shared/wire/frames';
import { mcpCall, REQUEST_TIMEOUT_MS } from './controls';
import { callMcpTool, probeMcpCall, qualifiedMcpToolName } from './mcp-call';
import { ControlClient } from './rpc';
import type { EngineTransport } from './transport';

const REPO_ROOT = resolve(__dirname, '../..');
type Row = { seq: number; direction: string; frame: Record<string, unknown> };
const rowsOf = (path: string): Row[] =>
  readFileSync(join(REPO_ROOT, path), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Row);
const CALLS = rowsOf('spikes/p3-connectors/fixtures/engine-mcp-call.jsonl');
const frameAt = (rows: Row[], seq: number) => rows.find((row) => row.seq === seq)!.frame;
type Envelope = { subtype: string; request_id: string; response?: unknown; error?: string };
const envelopeAt = (rows: Row[], seq: number) => (frameAt(rows, seq) as { response: Envelope }).response;
// pass3/mods-gate-served-off seq 30: how an engine refuses a control subtype it does not handle (2.1.287, ui_render)
const UNSUPPORTED_TEMPLATE = envelopeAt(rowsOf('spikes/protocol-probe/fixtures/pass3/mods-gate-served-off.jsonl'), 30).error!;

// A transport whose engine answers each written control request with `answer(request)`'s envelope under the minted id;
// null leaves the request unanswered.
function engine(answer: (request: Record<string, unknown>) => Omit<Envelope, 'request_id'> | null) {
  const writes: StdinFrame[] = [];
  const transport: EngineTransport = {
    pid: null,
    frames: (async function* () {})(),
    stderr: (async function* () {})(),
    write: (frame) => {
      writes.push(frame);
      if (frame.type === 'control_request') {
        const envelope = answer(frame.request as Record<string, unknown>);
        if (envelope) queueMicrotask(() => client.observe({ type: 'control_response', response: { ...envelope, request_id: frame.request_id } }));
      }
      return Promise.resolve();
    },
    endInput: () => {},
    kill: () => {},
    exited: new Promise(() => {}),
  };
  const warnings: string[] = [];
  const rows: JournalRow[] = [];
  const client = new ControlClient(transport, { row: (direction, frame) => { const row = { seq: rows.length + 1, direction, at: '', frame }; rows.push(row); return row; } }, 'L', { warn: (m) => warnings.push(m) });
  return { client, writes, warnings };
}

// The fixture's engine: the recorded answer to the recorded request with the same tool and arguments.
const fixtureEngine = () =>
  engine((request) => {
    const i = CALLS.findIndex((row) => row.direction === 'out' && JSON.stringify((row.frame as { request?: unknown }).request) === JSON.stringify(request));
    return i === -1 ? null : (CALLS[i + 1]!.frame as { response: Envelope }).response;
  });

afterEach(() => vi.useRealTimers());

describe('the mcp_call control (engine-mcp-call.jsonl)', () => {
  it('writes the request exactly as the probe did and parses the recorded success, structured and text content alike', async () => {
    const { client, writes } = fixtureEngine();
    const metrics = await mcpCall(client, { tool: 'mcp__dyntoy__metrics_snapshot', arguments: { series: 'revenue', points: 2 } });
    expect((writes[0] as { request: unknown }).request).toEqual((frameAt(CALLS, 10) as { request: unknown }).request); // seq 10
    expect(metrics).toEqual(envelopeAt(CALLS, 11).response); // seq 11: content a string, structuredContent the rows
    expect(metrics.structuredContent).toMatchObject({ series: 'revenue', rows: [{ v: 107 }, { v: 110 }] });
    const sent = await mcpCall(client, { tool: 'mcp__dyntoy__send_document', arguments: { title: 'plan-mode write', body: 'x' } });
    expect(sent.content).toEqual([{ type: 'text', text: 'delivered "plan-mode write" (1 chars) as doc-697a25b0' }]); // seq 17
  });

  it('is a long control: the engine may wait up to 30 s to bring a server up before the tool runs', async () => {
    vi.useFakeTimers();
    const { client } = engine(() => null);
    const pending = mcpCall(client, { tool: 'mcp__dyntoy__metrics_snapshot', arguments: {} }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS.read + 1);
    expect(client.pending).toBe(1);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS.long);
    expect(await pending).toMatchObject({ code: 'timeout' });
  });
});

describe('callMcpTool', () => {
  it('runs an engine-reported server and tool by its qualified name and answers the result', async () => {
    const { client, writes } = fixtureEngine();
    const outcome = await callMcpTool(client, { server: 'userhttp', tool: 'metrics_snapshot', arguments: { series: 'http', points: 1 } });
    expect(outcome).toEqual({ ok: true, result: envelopeAt(CALLS, 19).response }); // seq 18-19, the HTTP server
    expect((writes[0] as { request: unknown }).request).toEqual({ subtype: 'mcp_call', tool: 'mcp__userhttp__metrics_snapshot', arguments: { series: 'http', points: 1 } });
  });

  it('sends empty arguments when the call names none, as the probe did for its unknown server', async () => {
    const { client, writes } = fixtureEngine();
    expect(await callMcpTool(client, { server: 'nosuch', tool: 'tool' })).toEqual({ ok: false, refusal: 'not_connected', message: 'MCP server not connected: nosuch' }); // seq 22-23
    expect((writes[0] as { request: unknown }).request).toEqual((frameAt(CALLS, 22) as { request: unknown }).request);
  });

  it('refuses cleanly on an engine that does not handle the subtype', async () => {
    const { client } = engine(() => ({ subtype: 'error', error: UNSUPPORTED_TEMPLATE.replace('ui_render', 'mcp_call') }));
    expect(await callMcpTool(client, { server: 'dyntoy', tool: 'metrics_snapshot' })).toEqual({ ok: false, refusal: 'unsupported', message: 'Unsupported control request subtype: mcp_call' });
  });

  // The engine's own repair hints (2.1.292 cli.pretty.js 598471-598475; the same strings in 2.1.300 at 76785-76787)
  it('names the repair the engine asks for: authenticate, or reconnect an expired session; any other failure is the tool’s', async () => {
    const answers: Record<string, string> = {
      auth: 'MCP server auth requires authentication — send mcp_authenticate and retry mcp_call: 401',
      expired: 'MCP session expired for expired — send mcp_reconnect and retry mcp_call: 404',
      broken: 'Tool metrics_snapshot failed: boom',
    };
    const { client } = engine((request) => ({ subtype: 'error', error: answers[String(request.tool).split('__')[1]!]! }));
    expect(await callMcpTool(client, { server: 'auth', tool: 't' })).toMatchObject({ ok: false, refusal: 'needs_auth' });
    expect(await callMcpTool(client, { server: 'expired', tool: 't' })).toMatchObject({ ok: false, refusal: 'session_expired' });
    expect(await callMcpTool(client, { server: 'broken', tool: 't' })).toEqual({ ok: false, refusal: 'failed', message: answers.broken });
  });

  it('cancels through control_cancel_request; the engine’s own cancelled answer is late, never unexpected', async () => {
    const { client, writes, warnings } = engine(() => null);
    const abort = new AbortController();
    const pending = callMcpTool(client, { server: 'dyntoy', tool: 'metrics_snapshot' }, { signal: abort.signal });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    abort.abort();
    expect(await pending).toMatchObject({ ok: false, refusal: 'cancelled' });
    const id = (writes[0] as { request_id: string }).request_id;
    expect(writes[1]).toEqual({ type: 'control_cancel_request', request_id: id });
    // the engine answers a cancelled call "mcp_call cancelled by client: <server>" (2.1.292 cli.pretty.js 598419)
    client.observe({ type: 'control_response', response: { subtype: 'error', request_id: id, error: 'mcp_call cancelled by client: dyntoy' } });
    expect(warnings).toEqual([]);
  });

  it('answers timeout under the caller’s bound, and exited once the process is gone', async () => {
    vi.useFakeTimers();
    const { client, writes } = engine(() => null);
    const timed = callMcpTool(client, { server: 'dyntoy', tool: 'metrics_snapshot' }, { timeoutMs: 5_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await timed).toMatchObject({ ok: false, refusal: 'timeout' });
    expect(writes.at(-1)).toMatchObject({ type: 'control_cancel_request' });
    const gone = callMcpTool(client, { server: 'dyntoy', tool: 'metrics_snapshot' });
    await vi.advanceTimersByTimeAsync(0);
    client.close('the engine exited');
    expect(await gone).toMatchObject({ ok: false, refusal: 'exited' });
    expect(await callMcpTool(client, { server: 'dyntoy', tool: 'metrics_snapshot' })).toMatchObject({ ok: false, refusal: 'exited' });
  });
});

describe('probeMcpCall, the compatibility check', () => {
  // The engine's servers as mcp_status reports them, and its answer to a call naming a server it does not have.
  const statusOf = (names: string[]) => ({ subtype: 'success', response: { mcpServers: names.map((name) => ({ name, status: 'connected', tools: [{ name: 'probe' }] })) } });
  const prober = (names: string[], onCall: (tool: string) => Omit<Envelope, 'request_id'> = (tool) => ({ subtype: 'error', error: `MCP server not connected: ${tool.split('__')[1]}` })) =>
    engine((request) => (request.subtype === 'mcp_status' ? statusOf(names) : onCall(String(request.tool))));
  const calledTools = (writes: StdinFrame[]) => writes.flatMap((w) => (w.type === 'control_request' && w.request.subtype === 'mcp_call' ? [String(w.request.tool)] : []));

  it('calls an unguessable server absent from the session, never the old fixed sentinel even when one is configured', async () => {
    const { client, writes } = prober(['maws-compat-probe', 'dyntoy']);
    expect(await probeMcpCall(client)).toBe('supported');
    const [tool, ...more] = calledTools(writes);
    expect(more).toEqual([]);
    expect(tool).not.toBe('mcp__maws-compat-probe__probe');
    expect(tool).toMatch(/^mcp__maws_probe_[0-9a-f]{32}__probe$/);
    expect((writes.find((w) => w.type === 'control_request' && w.request.subtype === 'mcp_call') as { request: unknown }).request).toEqual({ subtype: 'mcp_call', tool, arguments: {} });
    const second = prober([]);
    await probeMcpCall(second.client);
    expect(calledTools(second.writes)[0]).not.toBe(tool); // a fresh name per probe
  });

  it('skips a candidate that any reported server shares once normalised, and gives up rather than call a present one', async () => {
    const nonces = ['deadbeef', 'cafe'];
    const { client, writes } = prober(['maws.probe.deadbeef']); // normalises to maws_probe_deadbeef
    expect(await probeMcpCall(client, { nonce: () => nonces.shift()! })).toBe('supported');
    expect(calledTools(writes)).toEqual(['mcp__maws_probe_cafe__probe']);
    const stuck = prober(['maws_probe_same']);
    expect(await probeMcpCall(stuck.client, { nonce: () => 'same' })).toBe('unknown');
    expect(calledTools(stuck.writes)).toEqual([]);
  });

  it('answers unknown when the servers cannot be read, so absence cannot be checked', async () => {
    const { client, writes } = engine((request) => (request.subtype === 'mcp_status' ? { subtype: 'error', error: 'no status' } : null));
    expect(await probeMcpCall(client)).toBe('unknown');
    expect(calledTools(writes)).toEqual([]);
  });

  it('answers unsupported on an engine without the subtype, unknown when the engine never answers the call', async () => {
    const old = prober([], () => ({ subtype: 'error', error: UNSUPPORTED_TEMPLATE.replace('ui_render', 'mcp_call') }));
    expect(await probeMcpCall(old.client)).toBe('unsupported');
    vi.useFakeTimers();
    const silent = engine((request) => (request.subtype === 'mcp_status' ? statusOf([]) : null));
    const probing = probeMcpCall(silent.client, { timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await probing).toBe('unknown');
  });
});

describe('qualifiedMcpToolName, the engine’s identity for a server’s tool', () => {
  // pass2/real-settings: seq 63's mcp_status names the servers as configured (plugin servers `plugin:<plugin>:<server>`)
  // and seq 15's init lists the tools the model sees by their qualified names
  it('maps every tool mcp_status reports onto the qualified name the engine itself lists', () => {
    const rows = rowsOf('spikes/protocol-probe/fixtures/pass2/real-settings.jsonl');
    const listed = (frameAt(rows, 15) as { tools: string[] }).tools.filter((name) => name.startsWith('mcp__'));
    const servers = (envelopeAt(rows, 63).response as { mcpServers: { name: string; tools: { name: string }[] }[] }).mcpServers;
    const qualified = servers.flatMap((server) => server.tools.map((tool) => qualifiedMcpToolName(server.name, tool.name)));
    expect(servers.map((s) => s.name)).toEqual(expect.arrayContaining(['plugin:ptc:ptc', 'plugin:chatgpt-advisor:advisor', 'openaiDeveloperDocs']));
    expect(qualified.sort()).toEqual([...listed].sort());
  });

  // 2.1.292 cli.pretty.js 610421-610425 (the normaliser) and 16875 (`mcp__<server>__<tool>`, both parts normalised)
  it('collapses a claude.ai connector’s name as the engine does', () => {
    expect(qualifiedMcpToolName('claude.ai Google Drive', 'search')).toBe('mcp__claude_ai_Google_Drive__search');
    expect(qualifiedMcpToolName('claude.ai  Notion (work)', 'notion-search')).toBe('mcp__claude_ai_Notion_work__notion-search');
    expect(qualifiedMcpToolName('my.server', 'a.b')).toBe('mcp__my_server__a_b');
  });
});
