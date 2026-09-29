// C3's end-to-end test (C3 execution document, Acceptance item 2): fixtures of the protocol probe replayed through the
// whole stack under MAWS_ENGINE_REPLAY=1 (renderer → preload → main's router → the engine host → the replay transport),
// with no engine and no UI. The replay transport holds at the fixture's next `out` row and ends the replay on any write
// it did not record, so every step below issues exactly the fixture's next write, in the fixture's order.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { OperationEvent } from '@shared/engine/operations';
import type { QueueEntry } from '@shared/engine/session-state-store';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { REPO_ROOT, test } from './support/launch';

test.use({ mawsEnv: { MAWS_ENGINE_REPLAY: '1' } });

interface C3Log {
  batches: { appSessionId: string; events: SessionEvent[] }[];
  queues: { appSessionId: string; entries: QueueEntry[]; paused: boolean }[];
  attention: { appSessionId: string; items: AttentionItem[] }[];
  operations: OperationEvent[];
}

// Subscribes before anything is launched: events flow from the first frame on.
async function collect(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log = { batches: [] as unknown[], queues: [] as unknown[], attention: [] as unknown[], operations: [] as unknown[] };
    (window as unknown as { __c3: typeof log }).__c3 = log;
    window.maws.on('session.eventBatch', (payload) => log.batches.push(payload));
    window.maws.on('session.queue', (payload) => log.queues.push(payload));
    window.maws.on('attention.changed', (payload) => log.attention.push(payload));
    window.maws.on('session.operation', (payload) => log.operations.push(payload));
  });
}

const logOf = (page: Page) => page.evaluate(() => (window as unknown as { __c3: C3Log }).__c3);
const eventsOf = async (page: Page, id: string) => (await logOf(page)).batches.filter((b) => b.appSessionId === id).flatMap((b) => b.events);

function invoke<N extends CommandName>(page: Page, name: N, input: CommandInput<N>): Promise<CommandResult<N>> {
  return page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name, input] as const) as Promise<CommandResult<N>>;
}

// Timed in the page, so the measure is the bridge's round trip and not Playwright's.
function timedInvoke<N extends CommandName>(page: Page, name: N, input: CommandInput<N>): Promise<{ result: CommandResult<N>; ms: number }> {
  return page.evaluate(async ([n, i]) => {
    const start = performance.now();
    const result = await window.maws.invoke(n as never, i as never);
    return { result, ms: performance.now() - start };
  }, [name, input] as const) as Promise<{ result: CommandResult<N>; ms: number }>;
}

function value<N extends CommandName>(result: CommandResult<N>) {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

const spec = (appSessionId: string, replay: string) => ({
  appSessionId, cwd: '/tmp/maws-e2e-replay', additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway' as const, subagentModel: null,
  resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, replay,
});

async function launchReady(page: Page, id: string, replay: string): Promise<void> {
  expect(value(await invoke(page, 'session.launch', { spec: spec(id, replay) }))).toMatchObject({ status: 'launching', session: { appSessionId: id } });
  await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: id })).process).toBe('ready');
}

// The payload the fixture recorded for the `out` request at `seq`.
function recordedResponse(fixture: string, seq: number): unknown {
  const rows = readFileSync(join(REPO_ROOT, fixture), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { seq: number; direction: string; frame: { type: string; request_id?: string; response?: { request_id: string; response?: unknown } } });
  const requestId = rows.find((r) => r.seq === seq)!.frame.request_id;
  return rows.find((r) => r.direction === 'in' && r.frame.type === 'control_response' && r.frame.response!.request_id === requestId)!.frame.response!.response;
}

const PERMISSION = 'spikes/protocol-probe/fixtures/permission-roundtrip.jsonl';
const READS = 'spikes/protocol-probe/fixtures/reads.jsonl';
const TOOL_USE = 'toolu_01RWDevVWYVi2Tn3y58pxRS3';

test('a replayed permission round trip crosses the X2 surface and survives reload', async ({ maws }) => {
  const { page } = maws;
  const id = 'e2e-permission';
  await collect(page);
  await launchReady(page, id, PERMISSION); // the fixture answers initialize (seq 2–3), the prelude get_status
  expect(value(await invoke(page, 'session.launch', { spec: spec(id, PERMISSION) }))).toEqual({ status: 'refused', reason: 'already_live', message: 'process is ready' });

  const sent = value(await invoke(page, 'session.send', { appSessionId: id, content: 'Use Bash to run exactly git log --oneline. Then say DONE.' })); // seq 4
  expect(sent).toMatchObject({ disposition: 'sent', messageUuid: expect.any(String) });
  await expect.poll(async () => (await eventsOf(page, id)).some((e) => e.kind === 'permission.requested')).toBe(true);
  const early = await eventsOf(page, id);
  const at = (predicate: (e: SessionEvent) => boolean) => early.findIndex(predicate);
  const order = [
    at((e) => e.kind === 'turn.started' && e.origin === 'human'),
    at((e) => e.kind === 'user.message' && e.messageUuid === sent.messageUuid),
    at((e) => e.kind === 'session.init'), // seq 7
    at((e) => e.kind === 'assistant.block.delta'), // the first, seq 12
    at((e) => e.kind === 'tool.use' && e.toolUseId === TOOL_USE), // seq 47
    at((e) => e.kind === 'permission.requested'), // seq 49
  ];
  expect(order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1]!)), `in order: ${order.join(', ')}`).toBe(true);
  expect(early[order[3]!]).toMatchObject({ kind: 'assistant.block.delta', thinkingDelta: expect.any(String) });
  const requested = early[order[5]!] as Extract<SessionEvent, { kind: 'permission.requested' }>;
  expect(requested).toMatchObject({ toolUseId: TOOL_USE, decisionReasonType: 'rule' });
  await expect.poll(async () => (await logOf(page)).queues.filter((q) => q.appSessionId === id).some((q) => q.entries[0]?.state === 'released')).toBe(true); // the command_lifecycle of seq 5
  await expect.poll(async () => (await logOf(page)).attention.filter((a) => a.appSessionId === id).at(-1)?.items.map((i) => [i.kind, i.state])).toEqual([['permission', 'pending']]);
  expect(value(await invoke(page, 'attention.request', { appSessionId: id, requestId: requested.requestId }))).toEqual({ event: requested });
  expect(value(await invoke(page, 'session.answer', { appSessionId: id, requestId: 'no-such-request', answer: { kind: 'permission', decision: 'deny' } }))).toEqual({ outcome: 'not_pending' });

  expect(value(await invoke(page, 'session.answer', { appSessionId: id, requestId: requested.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } }))).toEqual({ outcome: 'delivered' }); // seq 50
  await expect.poll(async () => (await eventsOf(page, id)).some((e) => e.kind === 'turn.ended')).toBe(true);
  const events = await eventsOf(page, id);
  const result = events.findIndex((e) => e.kind === 'tool.result' && e.toolUseId === TOOL_USE); // seq 53
  const ended = events.findIndex((e) => e.kind === 'turn.ended'); // seq 93
  expect(result).toBeGreaterThan(order[5]!);
  expect(ended).toBeGreaterThan(result);
  expect(events[ended]).toMatchObject({ terminalReason: 'completed', userMessageUuids: [sent.messageUuid] });
  await expect.poll(async () => (await logOf(page)).attention.filter((a) => a.appSessionId === id).at(-1)?.items).toEqual([]); // confirmed at the tool result, then retired
  // the replay now holds at the fixture's second prompt (seq 94), which this test does not send

  await expect.poll(async () => value(await invoke(page, 'session.events', { appSessionId: id, afterSeq: null, limit: null })).events.length).toBe((await eventsOf(page, id)).length);
  const snapshot = value(await invoke(page, 'session.events', { appSessionId: id, afterSeq: null, limit: null }));
  expect(snapshot.events).toEqual(await eventsOf(page, id));
  expect(snapshot.complete).toBe(true);
  expect(value(await invoke(page, 'engine.sessions', undefined)).find((s) => s.appSessionId === id)).toMatchObject({ process: 'ready', gateway: { verified: 'routed' } }); // the prelude answered get_status at startup and after seq 93

  await page.reload();
  await expect(page.locator('[data-region="main"]')).toBeVisible();
  expect(value(await invoke(page, 'session.events', { appSessionId: id, afterSeq: null, limit: null })).events).toEqual(snapshot.events); // they live in the host

  expect(value(await invoke(page, 'session.stop', { appSessionId: id, reason: 'stop' }))).toEqual({ exited: true, code: 0, signal: null });
  expect(value(await invoke(page, 'engine.sessions', undefined)).find((s) => s.appSessionId === id)).toMatchObject({ process: 'exited', exit: { reason: 'stop' } });
  expect(maws.consoleErrors()).toEqual([]);
});

test('reads answer through the bridge and generateTitle completes as an operation', async ({ maws }) => {
  const { page } = maws;
  const id = 'e2e-reads';
  await collect(page);
  await launchReady(page, id, READS);
  value(await invoke(page, 'session.send', { appSessionId: id, content: 'Reply with exactly OK' })); // seq 4
  await expect.poll(async () => (await eventsOf(page, id)).some((e) => e.kind === 'turn.ended')).toBe(true); // seq 51; the post-turn get_status goes to the prelude

  const reads: [CommandName, Record<string, unknown>, number][] = [
    ['session.getUsage', {}, 52], ['session.getContextUsage', { detail: 'summary' }, 56], ['session.getSettings', {}, 59], ['session.listPermissionRules', {}, 62],
    ['session.getHooksListing', {}, 65], ['session.getMemoryDialog', {}, 68], ['session.getSkillsDialog', {}, 71], ['session.getSandboxDialog', {}, 74],
    ['session.getStatus', {}, 77], // the one get_status the fixture recorded: matched there, not answered from the prelude
    ['session.getWorkspaceDiff', {}, 80], ['session.exportConversation', {}, 83],
  ];
  for (const [name, input, seq] of reads) {
    const { result, ms } = await timedInvoke(page, name, { appSessionId: id, ...input } as never);
    expect(result, name).toEqual({ ok: true, value: recordedResponse(READS, seq) });
    expect(ms, name).toBeLessThan(1_000);
  }

  const { result: receipt, ms } = await timedInvoke(page, 'session.generateTitle', { appSessionId: id, description: 'Protocol probe', persist: false }); // seq 86
  const { opId } = value(receipt);
  expect(ms).toBeLessThan(1_000);
  await expect.poll(async () => (await logOf(page)).operations.find((o) => o.opId === opId)).toEqual({ appSessionId: id, opId, command: 'session.generateTitle', late: false, outcome: { ok: true, value: { title: 'Protocol probe' } } }); // seq 87
  expect((await invoke(page, 'session.renameSession', { appSessionId: id, title: 'MAWS protocol probe' })).ok).toBe(true); // seq 89, answered at 90
  await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: id })).process).toBe('exited'); // the meta exit row, seq 92
  expect(maws.consoleErrors()).toEqual([]);
});

test('an unanswered read fails with the host\'s deadline before the router\'s', async ({ maws }) => {
  const { page } = maws;
  const id = 'e2e-unanswered';
  await launchReady(page, id, 'test/fixtures/engine/unanswered-read.jsonl');
  const { result, ms } = await timedInvoke(page, 'session.getUsage', { appSessionId: id });
  expect(result).toEqual({ ok: false, error: { code: 'timeout', message: 'get_usage unanswered after 8 s' } });
  expect(ms).toBeGreaterThanOrEqual(8_000);
  expect(ms).toBeLessThan(10_000);
});
