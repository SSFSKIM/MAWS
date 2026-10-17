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
//   product (P3-H H4): the built app on a scratch profile (support/connector-scene.ts), the fixture server in its
//          scratch config, an owner's HTML page in a Space linked to an indexed project's directory: the page declares
//          and watches the tool and reads `paused: noRoute`, its timer acquiring nothing, until the owner's Start in the
//          header's Connectors sheet starts a session there (no message); then `revoked: notGranted`, calling nothing,
//          until the owner allows it; then it reads through route E; hidden, it calls nothing for longer than its
//          interval and catches up once shown; revoked from the sheet, it stops at once and calls nothing; one launch
//          throughout; the grant outlives an ordinary quit and relaunch (nothing acquired until the owner's Start
//          again) and serves the next session without a new grant; a duplicate holds none, deletion drops it.
//   hot relaunch (P3-H H4): main killed with the owner's session live in the detached host and relaunched at once on the
//          same profile: the same supervisor and launch, and the restored page reads exactly once, through that engine
//          and its server (the soak's relaunch, without its five-minute waits).
import { createHash } from 'node:crypto';
import { test, expect, type Locator, type TestInfo } from '@playwright/test';
import { callMcpTool, probeMcpCall, qualifiedMcpToolName } from '../src/engine-host/mcp-call';
import { startScratchEngine, type FixtureServer, type ScratchEngine } from './support/connector-engine';
import { invoke, pageState, TOOL, TOOL_NAME, value, wait, WATCH_MS, withScene } from './support/connector-scene';

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

test('product: the owner starts a session and grants a page’s tool from the header, the page reads through route E, hidden or revoked it calls nothing, and the grant outlives a restart but not its artifact', async () => {
  test.setTimeout(540_000);
  await withScene('product', test.info(), async (scene) => {
    let run = await scene.launch();
    expect(await run.page.evaluate(() => document.visibilityState), 'the app’s window is visible (the e2e quiet mode keeps native visibility)').toBe('visible');
    const artifactId = await scene.createPage(run.page);
    let { frame } = await scene.openPage(run.page, artifactId);
    const row = (sheet: Locator) => sheet.locator(`[data-connector-tool="${TOOL_NAME}"]`);

    // declared and watched with no live session: paused, and no timer acquires one; nothing opens by itself
    await expect(frame.locator('#declared')).toHaveText('declared');
    await expect(frame.locator('#watch')).toHaveText(`watching every ${WATCH_MS}`);
    await expect(frame.locator('#last')).toHaveText('paused:noRoute', { timeout: 20_000 });
    await expect(run.page.locator('[data-connectors-sheet]')).toHaveCount(0);
    await wait(WATCH_MS + 5_000);
    expect(await scene.live(run.page), 'no engine acquired by the page’s timer').toEqual([]);
    expect(scene.toolCalls()).toEqual([]);

    // the owner's Start: one session in the artifact's directory; the page now finds a route but no grant
    const engine = await scene.ownerStart(run.page);
    await expect(frame.locator('#last')).toHaveText('revoked:notGranted', { timeout: WATCH_MS + 15_000 });
    expect(scene.toolCalls()).toEqual([]);

    // the owner allows it from the header: the watch wakes and reads through the live engine
    let sheet = await scene.openSheet(run.page);
    await expect(row(sheet).locator('[data-connector-state]')).toContainText('Not allowed');
    await row(sheet).getByRole('button', { name: `Allow ${TOOL_NAME} to read` }).click();
    await expect(row(sheet).locator('[data-connector-state]')).toContainText('Allowed to read');
    await scene.closeSheet(run.page);
    await expect(frame.locator('#last')).toHaveText('ok n=1 via=engine', { timeout: 20_000 });
    expect(scene.toolCalls()).toMatchObject([{ server: 'series', tool: TOOL, arguments: { series: 'signups' } }]);
    scene.note('read', await pageState(frame));

    // hidden: nothing for longer than the interval; shown again: the refresh that fell due runs once
    await scene.hideWindow(run);
    const hiddenAt = Date.now();
    await wait(WATCH_MS + 10_000);
    const shownAt = Date.now();
    expect(scene.toolCallsBetween(hiddenAt, shownAt), 'no call while hidden').toEqual([]);
    await scene.showWindow(run);
    await expect(frame.locator('#last')).toHaveText('ok n=2 via=engine', { timeout: 15_000 });

    // revoked from the header: the page reads it at once, and nothing is called for longer than the interval
    sheet = await scene.openSheet(run.page);
    await row(sheet).getByRole('button', { name: `Revoke ${TOOL_NAME}` }).click();
    await expect(frame.locator('#last')).toHaveText('revoked:revoked');
    await expect(row(sheet).locator('[data-connector-state]')).toContainText('Not allowed');
    const revoked = scene.toolCalls().length;
    await scene.closeSheet(run.page);
    await wait(WATCH_MS + 10_000);
    expect(scene.toolCalls(), 'no call after the revoke').toHaveLength(revoked);

    // no timer acquired an engine: the owner's one launch, still live
    expect((await scene.live(run.page)).map((s) => s.launchId)).toEqual([engine.launchId]);
    expect(scene.launches(engine.appSessionId)).toEqual({ spawns: 1, exits: 0 });

    // allowed again, then an ordinary quit: the idle engine stops with the app
    sheet = await scene.openSheet(run.page);
    await row(sheet).getByRole('button', { name: `Allow ${TOOL_NAME} to read` }).click();
    await expect(row(sheet).locator('[data-connector-state]')).toContainText('Allowed to read');
    await scene.closeSheet(run.page);
    await expect(frame.locator('#last')).toHaveText('ok n=3 via=engine', { timeout: 20_000 });
    await scene.quit(run);
    await expect.poll(() => scene.pidAlive(engine.pid), { timeout: 30_000, message: 'the engine stopped with the app' }).toBe(false);
    const quitCalls = scene.toolCalls().length;

    // relaunched on the same profile: nothing is acquired, the grant is held, the page reads paused with Start offered
    run = await scene.launch();
    ({ frame } = await scene.openPage(run.page, artifactId));
    await expect(frame.locator('#last')).toHaveText('paused:noRoute', { timeout: 20_000 });
    sheet = await scene.openSheet(run.page);
    await expect(row(sheet).locator('[data-connector-state]')).toContainText('Allowed to read');
    await expect(sheet.locator('[data-connectors-start]').getByRole('button', { name: 'Start session' })).toBeVisible();
    await scene.closeSheet(run.page);
    await wait(WATCH_MS + 5_000); // the paused watch asks for a route again at its interval, and acquires nothing
    expect(await scene.live(run.page), 'no engine acquired after the restart').toEqual([]);
    expect(scene.launches(engine.appSessionId).spawns).toBe(1);
    expect(scene.toolCalls()).toHaveLength(quitCalls);

    // the owner's Start again: the held grant serves the watch, no new grant
    const next = await scene.ownerStart(run.page);
    await expect(frame.locator('#last')).toHaveText('ok n=1 via=engine', { timeout: WATCH_MS + 20_000 });
    expect((await scene.live(run.page)).map((s) => s.launchId)).toEqual([next.launchId]);

    // no inheritance: a duplicate holds no grant, and the artifact's deletion takes its grant with it
    const copy = value(await invoke(run.page, 'artifacts.duplicate', { artifactId })).artifact.id;
    expect(value(await invoke(run.page, 'artifacts.connectorGrants', { artifactId: copy })).grants).toEqual([]);
    expect(value(await invoke(run.page, 'artifacts.connectorGrants', { artifactId })).grants).toMatchObject([{ server: 'fixture', tool: TOOL, mode: 'read' }]);
    value(await invoke(run.page, 'artifacts.delete', { artifactId }));
    const after = await invoke(run.page, 'artifacts.connectorGrants', { artifactId });
    expect(after.ok ? after.value.grants : [], 'a deleted artifact holds no grant').toEqual([]);
    const deletedCalls = scene.toolCalls().length;
    await wait(WATCH_MS + 5_000);
    expect(scene.toolCalls(), 'nothing is called for a deleted artifact').toHaveLength(deletedCalls);
  });
});

test('hot relaunch: main killed and relaunched at once keeps the owner’s session, and the restored page reads exactly once through it', async () => {
  test.setTimeout(300_000);
  await withScene('hot', test.info(), async (scene) => {
    const first = await scene.launch();
    expect(await first.page.evaluate(() => document.visibilityState), 'the app’s window is visible').toBe('visible');
    const supervisor = await scene.supervisor(first.page);
    const artifactId = await scene.createPage(first.page);
    let { frame } = await scene.openPage(first.page, artifactId);
    await expect(frame.locator('#last')).toHaveText('paused:noRoute', { timeout: 20_000 });
    const engine = await scene.ownerStart(first.page);
    await expect(frame.locator('#last')).toHaveText('revoked:notGranted', { timeout: WATCH_MS + 15_000 });
    const sheet = await scene.openSheet(first.page);
    await sheet.locator(`[data-connector-tool="${TOOL_NAME}"]`).getByRole('button', { name: `Allow ${TOOL_NAME} to read` }).click();
    await scene.closeSheet(first.page);
    await expect(frame.locator('#last')).toHaveText('ok n=1 via=engine', { timeout: 20_000 });
    const server = scene.toolCalls()[0]!.pid;

    await scene.killApp(first);
    const reopenedAt = Date.now();
    const second = await scene.launch();
    expect(await scene.supervisor(second.page), 'the same supervisor').toBe(supervisor);
    expect(await scene.live(second.page), 'the same launch, no other').toEqual([engine]);
    expect(scene.launches(engine.appSessionId), 'one launch, never exited').toEqual({ spawns: 1, exits: 0 });
    ({ frame } = await scene.restoredPage(second.page, artifactId));
    await expect(frame.locator('#last')).toHaveText('ok n=2 via=engine', { timeout: 20_000 });
    await wait(5_000);
    expect(scene.toolCallsBetween(reopenedAt, Date.now()), 'the restored page read once').toMatchObject([{ pid: server, tool: TOOL }]);
    expect(scene.toolCalls()).toHaveLength(2);
  });
});
