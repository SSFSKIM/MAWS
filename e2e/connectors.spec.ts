// P3-H's connector runs against the installed engine (`pnpm e2e:connectors`, MAWS_CONNECTORS_E2E=1; the spec skips
// itself otherwise, so `pnpm e2e` is unchanged). Each case starts a scratch engine (support/connector-engine.ts: fresh
// HOME and config home, control requests only, no model turn) whose MCP servers are the fixture server, and attaches
// the recorded wire and the servers' call log to the test's output (and prints them to the log between markers): they are
// the route E fixtures D-1 asks for.
//   names: the qualified name MAWS forms from mcp_status's names (qualifiedMcpToolName) reaches the right server and
//          tool for a claude.ai-shaped server name (one only the engine's claude.ai collapse and trim turns into what is
//          sent), a punctuated server name and punctuated tool names; what other spellings reach is recorded.
//   collision: names that normalise alike share one qualified name; the server each spelling reaches is recorded, two
//          pairs in opposite configuration orders.
//   probe: the compatibility probe reaches no configured tool, the old fixed sentinel `maws-compat-probe` and a server
//          holding the probe's first candidate name both configured, while a direct call to the sentinel does run.
import { createHash } from 'node:crypto';
import { test, expect, type TestInfo } from '@playwright/test';
import { callMcpTool, probeMcpCall, qualifiedMcpToolName } from '../src/engine-host/mcp-call';
import { startScratchEngine, type FixtureServer, type ScratchEngine } from './support/connector-engine';

test.skip(process.env.MAWS_CONNECTORS_E2E !== '1', 'the connector e2e runs under pnpm e2e:connectors (MAWS_CONNECTORS_E2E=1)');
test.describe.configure({ timeout: 120_000 });

// Until the gate keeps a passing job's artifacts, each file is also printed to the job's log between markers, as
// base64 lines with its digest: scrubbed control frames and fixture values only (support/connector-engine.ts).
function printEvidence(label: string, body: string): void {
  const bytes = Buffer.from(body, 'utf8');
  const lines = bytes.toString('base64').match(/.{1,1000}/g) ?? [];
  process.stdout.write(`MAWS-CONNECTORS-EVIDENCE BEGIN ${label} bytes=${bytes.length} sha256=${createHash('sha256').update(bytes).digest('hex')}\n${lines.join('\n')}\nMAWS-CONNECTORS-EVIDENCE END ${label}\n`);
}

async function withEngine(info: TestInfo, label: string, servers: FixtureServer[], run: (engine: ScratchEngine) => Promise<void>): Promise<void> {
  const engine = await startScratchEngine(servers);
  try {
    await run(engine);
  } finally {
    await engine.close();
    const wire = engine.wire();
    const calls = engine.calls().map((entry) => JSON.stringify(entry)).join('\n') + '\n';
    await info.attach('engine-wire.jsonl', { body: wire, contentType: 'application/x-ndjson' });
    await info.attach('fixture-calls.jsonl', { body: calls, contentType: 'application/x-ndjson' });
    printEvidence(`${label}/engine-wire.jsonl`, wire);
    printEvidence(`${label}/fixture-calls.jsonl`, calls);
    info.annotations.push({ type: 'engine', description: engine.version });
  }
}

// A call by a name the test spells itself, and the fixture servers that answered it (the call log's new tools/call
// rows), recorded as an annotation: what the engine resolves a name to is observed here, not assumed.
async function rawCall(engine: ScratchEngine, info: TestInfo, tool: string): Promise<{ ran: boolean; answeredBy: string[] }> {
  const before = engine.toolCalls().length;
  const ran = await engine.client.requestRaw('mcp_call', { tool, arguments: { raw: tool } }, { klass: 'long' }).then(() => true, () => false);
  const answeredBy = engine.toolCalls().slice(before).map((entry) => `${entry.server}:${entry.tool}`);
  info.annotations.push({ type: 'raw-call', description: JSON.stringify({ tool, ran, answeredBy }) });
  return { ran, answeredBy };
}

const NAMES: FixtureServer[] = [
  // adjacent separators and a trailing one: only the engine's claude.ai rule (collapse runs of `_`, trim the ends) turns
  // this into `claude_ai_Fixture_Drive`; a plain punctuation replacement gives `claude_ai__Fixture__Drive_`
  { name: 'claude.ai  Fixture (Drive)', id: 'claudeai-shaped', tools: ['rows.snapshot', 'rows-v2'] },
  { name: 'fixture.dots', id: 'dots', tools: ['rows.snapshot'] },
  { name: 'plain', id: 'plain', tools: ['rows_snapshot'] },
];

test('names: the qualified name formed from mcp_status reaches the server and tool it names', async () => {
  const info = test.info();
  await withEngine(info, 'names', NAMES, async (engine) => {
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
    // what was sent for the claude.ai-shaped server: the collapsed and trimmed name, literally
    const sent = engine.rows.flatMap((row) => (row.direction === 'out' && (row.frame as { request?: { subtype?: string } }).request?.subtype === 'mcp_call' ? [(row.frame as { request: { tool: string } }).request.tool] : []));
    expect(sent).toEqual(expect.arrayContaining(['mcp__claude_ai_Fixture_Drive__rows_snapshot', 'mcp__claude_ai_Fixture_Drive__rows-v2']));
    // Other spellings, observed: 2.1.301 also ran the name as configured (gate 38891658458, seqs 16-17 of the names
    // wire). Whatever a spelling reaches must be the server and tool it names; whether it runs is recorded.
    const asConfigured = await rawCall(engine, info, 'mcp__claude.ai  Fixture (Drive)__rows.snapshot');
    expect(asConfigured.answeredBy).toEqual(asConfigured.ran ? ['claudeai-shaped:rows.snapshot'] : []);
    const plainReplacement = await rawCall(engine, info, 'mcp__claude_ai__Fixture__Drive___rows_snapshot');
    expect(plainReplacement.answeredBy.every((who) => who.startsWith('claudeai-shaped:'))).toBe(true);
  });
});

test('collision: names that normalise alike share one qualified name; which server each spelling reaches is recorded', async () => {
  const info = test.info();
  const servers: FixtureServer[] = [
    { name: 'collide.pair', id: 'dot', tools: ['which'] }, // the punctuated name configured first
    { name: 'collide_pair', id: 'underscore', tools: ['which'] },
    { name: 'swap_pair', id: 'swap-underscore', tools: ['which'] }, // and here the exact name first
    { name: 'swap.pair', id: 'swap-dot', tools: ['which'] },
  ];
  expect(qualifiedMcpToolName('collide.pair', 'which')).toBe(qualifiedMcpToolName('collide_pair', 'which'));
  expect(qualifiedMcpToolName('swap.pair', 'which')).toBe(qualifiedMcpToolName('swap_pair', 'which'));
  await withEngine(info, 'collision', servers, async (engine) => {
    const status = await engine.waitSettled();
    info.annotations.push({ type: 'reported', description: JSON.stringify(status.mcpServers.map((s) => ({ name: s.name, status: s.status }))) });
    // the qualified name MAWS forms: one call, one server of the pair answers it
    const before = engine.toolCalls().length;
    expect((await callMcpTool(engine.client, { server: 'collide.pair', tool: 'which' })).ok).toBe(true);
    const answered = engine.toolCalls().slice(before);
    expect(answered).toHaveLength(1);
    expect(['dot', 'underscore']).toContain(answered[0]!.server);
    info.annotations.push({ type: 'answered-by', description: answered[0]!.server });
    // each raw spelling of each pair: at most one server, of that pair
    for (const [pair, ids] of [['collide', ['dot', 'underscore']], ['swap', ['swap-dot', 'swap-underscore']]] as const) {
      for (const tool of [`mcp__${pair}.pair__which`, `mcp__${pair}_pair__which`]) {
        const { answeredBy } = await rawCall(engine, info, tool);
        expect(answeredBy.length).toBeLessThanOrEqual(1);
        for (const who of answeredBy) expect(ids.map((id) => `${id}:which`)).toContain(who);
      }
    }
  });
});

test('probe: the compatibility probe reaches no configured tool; the old sentinel is a real, callable server', async () => {
  const info = test.info();
  const servers: FixtureServer[] = [
    { name: 'maws-compat-probe', id: 'sentinel', tools: ['probe'] }, // H1's first probe called exactly this
    { name: 'maws_probe_deadbeef', id: 'first-candidate', tools: ['probe'] }, // the probe's first candidate below
  ];
  await withEngine(info, 'probe', servers, async (engine) => {
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
