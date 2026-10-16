// P3-H's connector runs against the installed engine (`pnpm e2e:connectors`, MAWS_CONNECTORS_E2E=1; the spec skips
// itself otherwise, so `pnpm e2e` is unchanged). Each case starts a scratch engine (support/connector-engine.ts: fresh
// HOME and config home, control requests only, no model turn) whose MCP servers are the fixture server, and attaches
// the recorded wire and the servers' call log to the test's output: they are the route E fixtures D-1 asks for.
//   names: the qualified name MAWS forms from mcp_status's names (qualifiedMcpToolName) reaches the right server and
//          tool for a claude.ai-shaped server name, a punctuated server name and punctuated tool names; the naive
//          concatenation does not.
//   collision: two configured names that normalise alike; one qualified name, one server answers (which is recorded).
//   probe: the compatibility probe reaches no configured tool, the old fixed sentinel `maws-compat-probe` and a server
//          holding the probe's first candidate name both configured, while a direct call to the sentinel does run.
import { test, expect, type TestInfo } from '@playwright/test';
import { callMcpTool, probeMcpCall, qualifiedMcpToolName } from '../src/engine-host/mcp-call';
import { startScratchEngine, type FixtureServer, type ScratchEngine } from './support/connector-engine';

test.skip(process.env.MAWS_CONNECTORS_E2E !== '1', 'the connector e2e runs under pnpm e2e:connectors (MAWS_CONNECTORS_E2E=1)');
test.describe.configure({ timeout: 120_000 });

async function withEngine(info: TestInfo, servers: FixtureServer[], run: (engine: ScratchEngine) => Promise<void>): Promise<void> {
  const engine = await startScratchEngine(servers);
  try {
    await run(engine);
  } finally {
    await engine.close();
    await info.attach('engine-wire.jsonl', { body: engine.wire(), contentType: 'application/x-ndjson' });
    await info.attach('fixture-calls.jsonl', { body: engine.calls().map((entry) => JSON.stringify(entry)).join('\n') + '\n', contentType: 'application/x-ndjson' });
    info.annotations.push({ type: 'engine', description: engine.version });
  }
}

const NAMES: FixtureServer[] = [
  { name: 'claude.ai Fixture Drive', id: 'claudeai-shaped', tools: ['rows.snapshot', 'rows-v2'] },
  { name: 'fixture.dots', id: 'dots', tools: ['rows.snapshot'] },
  { name: 'plain', id: 'plain', tools: ['rows_snapshot'] },
];

test('names: the qualified name formed from mcp_status reaches the server and tool it names', async () => {
  const info = test.info();
  await withEngine(info, NAMES, async (engine) => {
    const status = await engine.waitSettled();
    const reported = new Map(status.mcpServers.map((s) => [s.name, s]));
    for (const server of NAMES) {
      const entry = reported.get(server.name);
      expect(entry, `mcp_status names ${server.name} as configured`).toBeDefined();
      expect(entry!.status, server.name).toBe('connected');
      const listed = ((entry!.tools as { name: string }[] | undefined) ?? []).map((t) => t.name);
      expect(listed.sort(), `${server.name}'s tools as the server named them`).toEqual([...server.tools].sort());
      for (const tool of listed) {
        const before = engine.toolCalls().length;
        const outcome = await callMcpTool(engine.client, { server: entry!.name, tool, arguments: { case: 'names' } });
        expect(outcome, `${qualifiedMcpToolName(entry!.name, tool)}`).toMatchObject({ ok: true, result: { structuredContent: { server: server.id, tool, arguments: { case: 'names' } } } });
        expect(engine.toolCalls().slice(before)).toMatchObject([{ server: server.id, tool }]);
      }
    }
    // the names as configured are not what the engine resolves a call by
    const before = engine.toolCalls().length;
    const naive = await engine.client.requestRaw('mcp_call', { tool: 'mcp__claude.ai Fixture Drive__rows.snapshot', arguments: {} }, { klass: 'long' }).then(() => 'ran', (error: unknown) => String(error));
    expect(naive).not.toBe('ran');
    expect(engine.toolCalls().slice(before)).toEqual([]);
  });
});

test('collision: two names that normalise alike share one qualified name and one server answers it', async () => {
  const info = test.info();
  const servers: FixtureServer[] = [
    { name: 'collide.pair', id: 'dot', tools: ['which'] },
    { name: 'collide_pair', id: 'underscore', tools: ['which'] },
  ];
  expect(qualifiedMcpToolName('collide.pair', 'which')).toBe(qualifiedMcpToolName('collide_pair', 'which'));
  await withEngine(info, servers, async (engine) => {
    const status = await engine.waitSettled();
    info.annotations.push({ type: 'reported', description: JSON.stringify(status.mcpServers.map((s) => ({ name: s.name, status: s.status }))) });
    const outcome = await callMcpTool(engine.client, { server: 'collide.pair', tool: 'which' });
    expect(outcome.ok).toBe(true);
    const answered = engine.toolCalls();
    expect(answered).toHaveLength(1);
    info.annotations.push({ type: 'answered-by', description: answered[0]!.server });
  });
});

test('probe: the compatibility probe reaches no configured tool; the old sentinel is a real, callable server', async () => {
  const info = test.info();
  const servers: FixtureServer[] = [
    { name: 'maws-compat-probe', id: 'sentinel', tools: ['probe'] }, // H1's first probe called exactly this
    { name: 'maws_probe_deadbeef', id: 'first-candidate', tools: ['probe'] }, // the probe's first candidate below
  ];
  await withEngine(info, servers, async (engine) => {
    const status = await engine.waitSettled();
    expect(status.mcpServers.map((s) => [s.name, s.status]).sort()).toEqual([['maws-compat-probe', 'connected'], ['maws_probe_deadbeef', 'connected']]);
    const nonces = ['deadbeef'];
    expect(await probeMcpCall(engine.client, { nonce: () => nonces.shift() ?? 'f00d' })).toBe('supported');
    expect(await probeMcpCall(engine.client)).toBe('supported');
    expect(engine.toolCalls()).toEqual([]);
    const probed = engine.rows.flatMap((row) => (row.direction === 'out' && (row.frame as { request?: { subtype?: string } }).request?.subtype === 'mcp_call' ? [(row.frame as { request: { tool: string } }).request.tool] : []));
    expect(probed).toHaveLength(2);
    expect(probed[0]).toBe('mcp__maws_probe_f00d__probe');
    expect(probed[1]).toMatch(/^mcp__maws_probe_[0-9a-f]{32}__probe$/);
    // what the fixed sentinel would have done
    expect(await callMcpTool(engine.client, { server: 'maws-compat-probe', tool: 'probe' })).toMatchObject({ ok: true, result: { structuredContent: { server: 'sentinel', tool: 'probe' } } });
    expect(engine.toolCalls()).toMatchObject([{ server: 'sentinel', tool: 'probe' }]);
  });
});
