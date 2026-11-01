import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, RequestId } from '@shared/graph/ids'; // C12: RequestId
import type { EngineSessionStatus } from '@shared/engine/status';
import { handshakeResponder, scriptedSession } from './conformance/session-harness';
import { HANDING_OVER, parsePsTree, ProcessTable } from './process-table';
import { endableClientRef } from '@shared/ipc/client'; // P5 O2 M2
import { evaluate, isIdleRow } from './budget'; // P5 O2 M2
import { SERVER_RELEASE_MS } from './supervision'; // P5 O2 M2
import { MemorySessionStateStore } from './store/memory-session-state-store'; // P5 O2 M2
import { FileSessionStateStore } from './store/file-session-state-store'; // P5 O2 branch review
import { mkdtemp, rm, writeFile } from 'node:fs/promises'; // P5 O2 branch review
import { tmpdir } from 'node:os'; // P5 O2 branch review
import type { CronRecord } from '@shared/engine/session-state-store'; // P5 O2 M2
import { EngineSession } from './session';
import { HandoverDrain } from './handover'; // P5 O16 M3b fix wave 1
import type { LiveRow } from './live-ledger'; // E10
// C12 start
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BudgetState } from '@shared/ipc/schema/engine';
// C12 end

const flush = () => new Promise((r) => setImmediate(r));
async function until(check: () => boolean, what: string, ms = 5_000): Promise<void> { // P5 O16 M3b fix wave 1
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('keep-alive reasons', () => {
  it('a session reports background_tasks after background_tasks_changed with one task and drops it when the list empties (pass1/subagent seq 171, 363)', async () => {
    const s = scriptedSession();
    await s.session.start();
    s.transport.push({ type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'ad286defbc77bc090', task_type: 'local_agent', description: 'Read and report one.txt content' }], uuid: 'b-1', session_id: 's' });
    await flush();
    expect(s.session.status().keepAlive).toEqual(['background_tasks']);
    expect(s.session.status().backgroundTasks).toEqual([{ taskId: 'ad286defbc77bc090', taskType: 'local_agent', description: 'Read and report one.txt content', ambient: false }]);
    s.transport.push({ type: 'system', subtype: 'background_tasks_changed', tasks: [], uuid: 'b-2', session_id: 's' });
    await flush();
    expect(s.session.status().keepAlive).toEqual([]);
  });

  it('a held peer message keeps the process and leaves the table five minutes after heldAt even without a release', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-09-28T10:00:00.000Z'));
    const s = scriptedSession();
    await s.session.start();
    const statuses: EngineSessionStatus[] = [];
    s.session.on('status', (st) => statuses.push(st));
    s.transport.push({ type: 'system', subtype: 'peer_message_hold', state: 'held', message_uuid: 'm-1', lane: 'socket', from: 'uds:/tmp/a', from_name: 'agent A', cause: 'explicit-setting', uuid: 'p-1', session_id: 's' });
    s.transport.push({ type: 'system', subtype: 'peer_message_hold', state: 'held', message_uuid: 'm-2', lane: 'socket', from: 'uds:/tmp/b', uuid: 'p-2', session_id: 's' });
    s.transport.push({ type: 'system', subtype: 'peer_message_hold', state: 'released', message_uuid: 'm-2', lane: 'socket', from: 'uds:/tmp/b', uuid: 'p-3', session_id: 's' });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.session.status().heldPeerMessages).toEqual([{ messageUuid: 'm-1', from: 'uds:/tmp/a', fromName: 'agent A', lane: 'socket', heldAt: '2026-09-28T10:00:00.000Z', expiresAt: '2026-09-28T10:05:00.000Z' }]);
    expect(s.session.status().keepAlive).toEqual(['held_peer_message']);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(s.session.status().heldPeerMessages).toEqual([]);
    expect(statuses.at(-1)!.keepAlive).toEqual([]);
  });

  it('the exited status carries no held peer message: a dead process cannot release one (M5 review)', async () => {
    const s = scriptedSession();
    await s.session.start();
    const statuses: EngineSessionStatus[] = [];
    s.session.on('status', (st) => statuses.push(st));
    s.transport.push({ type: 'system', subtype: 'peer_message_hold', state: 'held', message_uuid: 'm-1', lane: 'socket', from: 'uds:/tmp/a', uuid: 'p-1', session_id: 's' });
    await flush();
    expect(s.session.status().heldPeerMessages).toHaveLength(1);
    s.transport.exit(1);
    await s.session.exited;
    expect(statuses.at(-1)).toMatchObject({ process: 'exited', heldPeerMessages: [], keepAlive: [] });
    expect(statuses.filter((st) => st.process === 'exited').every((st) => st.heldPeerMessages.length === 0)).toBe(true);
  });

  it('grants and connected MCP servers no longer keep a process (§4.4 as amended, C12)', async () => {
    const s = scriptedSession({ session: { grants: { allow: ['Bash(ls)'] } } });
    await s.session.start();
    s.transport.push({ type: 'system', subtype: 'init', cwd: '/w', session_id: 's', tools: [], mcp_servers: [{ name: 'gh', status: 'connected', source: 'user' }], model: 'm', permissionMode: 'auto', slash_commands: [], claude_code_version: '2.1.283', output_style: 'default', uuid: 'i-1' });
    await flush();
    expect(s.session.status().keepAlive).toEqual(['turn']); // the init opened an engine-initiated turn
  });
});

describe('memory sampling', () => {
  const PS = ['  100     1   1000', '  101   100    500', '  102   101    200', '  200     1   9999', '  300     1     64', '  301   300     36', ''].join('\n');

  it('parses the tree: own and tree RSS for a root pid', () => {
    const tree = parsePsTree(PS);
    expect(tree.sample(100)).toEqual({ rssKiB: 1000, treeRssKiB: 1700 });
    expect(tree.sample(300)).toEqual({ rssKiB: 64, treeRssKiB: 100 });
    expect(tree.sample(999)).toBeNull();
  });

  it('one ps per interval for every live process; each status carries its sample and the peak rides the exit row', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-09-28T10:00:00.000Z'));
    let calls = 0;
    const table = new ProcessTable({ ps: async () => (calls += 1, PS) });
    const a = scriptedSession({ spec: { appSessionId: 'app-a' as AppSessionId }, transport: { pid: 100 } });
    const b = scriptedSession({ spec: { appSessionId: 'app-b' as AppSessionId }, transport: { pid: 300 } });
    table.reserve('app-a' as AppSessionId, () => a.session);
    table.reserve('app-b' as AppSessionId, () => b.session);
    await Promise.all([a.session.start(), b.session.start()]);
    table.startSampling();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(1);
    expect(a.session.status().memory).toEqual({ rssKiB: 1000, treeRssKiB: 1700, sampledAt: '2026-09-28T10:00:10.000Z' });
    expect(b.session.status().memory).toMatchObject({ rssKiB: 64, treeRssKiB: 100 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(2);
    table.stopSampling();
    a.transport.exit(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(a.journal.rows.at(-1)!.frame).toMatchObject({ event: 'exit', peakTreeRssKiB: 1700 });
  });
});

describe('process table: change notification, shutdown and reservations', () => {
  it('forwards every session\'s status changes to its listeners', async () => {
    const table = new ProcessTable({ ps: async () => '' });
    const seen: string[] = [];
    table.onChange((s) => seen.push(`${s.appSessionId}:${s.process}`));
    const s = scriptedSession();
    table.reserve(s.session.status().appSessionId, () => s.session);
    await s.session.start();
    expect(seen).toContain('app-s:ready');
  });

  it('engine.shutdown { graceMs: 5000 } waits 3 s, not 5, before SIGTERM; counts exits before SIGKILL as stopped and the SIGKILLs as forced', async () => {
    vi.useFakeTimers();
    const table = new ProcessTable({ ps: async () => '' });
    const polite = scriptedSession({ spec: { appSessionId: 'app-polite' as AppSessionId }, responder: handshakeResponder({ end_session: () => null }) });
    const stubborn = scriptedSession({ spec: { appSessionId: 'app-stubborn' as AppSessionId } });
    for (const s of [polite, stubborn]) table.reserve(s.session.status().appSessionId, () => s.session);
    await vi.advanceTimersByTimeAsync(0);
    const shutdown = table.shutdown({ graceMs: 5_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(polite.transport.requestsOf('end_session')).toHaveLength(1);
    polite.transport.exit(0); // exits on end_session
    await vi.advanceTimersByTimeAsync(2_999);
    expect(stubborn.transport.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(stubborn.transport.calls).toEqual(['endInput', 'kill:SIGTERM']);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(stubborn.transport.calls).toEqual(['endInput', 'kill:SIGTERM', 'kill:SIGKILL']);
    stubborn.transport.exit(null, 'SIGKILL');
    expect(await shutdown).toEqual({ stopped: 1, forced: 1 });
    expect(polite.session.status().exit).toMatchObject({ reason: 'quit' });
    expect(stubborn.session.status().exit).toMatchObject({ reason: 'quit', signal: 'SIGKILL' });
    expect(await table.shutdown({ graceMs: 5_000 })).toEqual({ stopped: 0, forced: 0 }); // idempotent
  });

  it('closes admission before awaiting shutdown stops, including after shutdown returns', async () => {
    const table = new ProcessTable({ ps: async () => '' });
    const first = scriptedSession();
    table.reserve('app-s' as AppSessionId, () => first.session);
    await first.session.start();
    const shutdown = table.shutdown({ graceMs: 5_000 });
    const create = vi.fn(() => scriptedSession().session);
    try {
      expect(() => table.reserve('late' as AppSessionId, create)).toThrow(/shutting down/);
      expect(create).not.toHaveBeenCalled();
    } finally {
      first.transport.exit(0);
      await shutdown;
    }
    expect(await shutdown).toEqual({ stopped: 1, forced: 0 });
    expect(table.list().every((row) => row.lifecycle === 'exited')).toBe(true);
    expect(() => table.reserve('after' as AppSessionId, create)).toThrow(/shutting down/);
  });

  // P5 O16 M3b (D9): the handover's one synchronous step and the detached exit order's shutdown
  it('freezes every live hosted row at the handover, refuses every launch after it, and the detach shutdown leaves hosted rows running', async () => {
    const table = new ProcessTable({ ps: async () => '' });
    const hosted = scriptedSession({ spec: { appSessionId: 'app-hosted' as AppSessionId }, transport: { holder: { pid: 4100, holderId: 'L1', fence: 1 } } });
    const direct = scriptedSession({ spec: { appSessionId: 'app-direct' as AppSessionId }, responder: handshakeResponder({ end_session: () => null }) });
    for (const s of [hosted, direct]) table.reserve(s.session.status().appSessionId, () => s.session);
    await hosted.session.start();
    await direct.session.start();
    expect(table.freezeForHandover()).toEqual([hosted.session]); // the direct row is the exit order's ladder's
    const create = vi.fn(() => scriptedSession().session);
    expect(() => table.reserve('late' as AppSessionId, create)).toThrow(HANDING_OVER);
    expect(() => table.reserve('adopted' as AppSessionId, create, { adoption: true })).toThrow(HANDING_OVER);
    expect(create).not.toHaveBeenCalled();
    const shutdown = table.shutdown({ graceMs: 5_000, mode: 'detach' });
    await flush();
    direct.transport.exit(0); // exits on end_session
    expect(await shutdown).toEqual({ stopped: 1, forced: 0 });
    expect(hosted.transport.calls).toEqual(['detach:ack']);
    expect(hosted.session.lifecycle).toBe('ready');
    expect(direct.session.lifecycle).toBe('exited');
  });

  // P5 O16 M3b fix wave 1 (Interfaces §D: a stop-all and a quit stay deliberate): a stop after the freeze takes the row
  // back from the handover and runs the real ladder; nothing is left to a successor
  it('a stop-all after the freeze stops every frozen row through the ladder: the engine exits, nothing detached', async () => {
    const table = new ProcessTable({ ps: async () => '' });
    const hosted = scriptedSession({ spec: { appSessionId: 'app-hosted' as AppSessionId }, transport: { holder: { pid: 4100, holderId: 'L1', fence: 1 } }, responder: handshakeResponder({ end_session: () => null }) });
    table.reserve('app-hosted' as AppSessionId, () => hosted.session);
    await hosted.session.start();
    const drain = new HandoverDrain(table.freezeForHandover(), { log: () => {}, settled: () => {} });
    const shutdown = table.shutdown({ graceMs: 5_000, mode: 'stop' });
    await until(() => hosted.transport.requestsOf('end_session').length === 1, 'the ladder’s end_session');
    hosted.transport.exit(0);
    expect(await shutdown).toEqual({ stopped: 1, forced: 0 });
    expect(hosted.session.lifecycle).toBe('exited');
    expect(hosted.session.status().exit).toMatchObject({ reason: 'quit' });
    expect(hosted.transport.calls).not.toContain('detach:ack');
    expect(hosted.journal.rows.some((row) => (row.frame as { event?: string }).event === 'host_detach')).toBe(false);
    expect(drain.settled).toBe(true); // the row left the drain; nothing waits for a successor
  });

  it('a user’s stop of a frozen row during the drain stops it through the ladder and takes it out of the handover; the rest still detach', async () => {
    const table = new ProcessTable({ ps: async () => '' });
    const rows = ['app-a', 'app-b'].map((id, i) => scriptedSession({ spec: { appSessionId: id as AppSessionId }, transport: { holder: { pid: 4100 + i, holderId: `L${i}`, fence: 1 } }, responder: handshakeResponder({ end_session: () => null }) }));
    for (const row of rows) table.reserve(row.session.status().appSessionId, () => row.session);
    for (const row of rows) await row.session.start();
    const [a, b] = rows as [typeof rows[0], typeof rows[0]];
    let settled = false;
    new HandoverDrain(table.freezeForHandover(), { log: () => {}, settled: () => void (settled = true) });
    const stopped = a.session.stop('stop');
    await until(() => a.transport.requestsOf('end_session').length === 1, 'the ladder’s end_session');
    a.transport.exit(0);
    await stopped;
    expect(a.session.status().exit).toMatchObject({ reason: 'stop' });
    await until(() => settled, 'the drain');
    await until(() => b.transport.calls.includes('detach:ack'), 'the other row’s detach');
    expect(a.transport.calls).not.toContain('detach:ack');
    expect(b.session.lifecycle).toBe('ready');
  });

  // P5 O16 M3 (D10): a row held for an adoption from before the first client is answered: live, holding the host as a
  // launch does, refusing a launch of its id; the adoption's own reservation takes it, a failed one releases it
  it('holds a row for an adoption: a launch of its id is refused, only the adoption reserves it, and its end releases the hold', async () => {
    const table = new ProcessTable({ ps: async () => '' });
    let rowsChanged = 0;
    table.onRowsChanged(() => void (rowsChanged += 1));
    table.holdForAdoption(['app-s' as AppSessionId, 'app-t' as AppSessionId]);
    expect([table.adoptingCount, table.launching(), table.isAdopting('app-s' as AppSessionId), rowsChanged]).toEqual([2, true, true, 1]);
    const create = vi.fn(() => scriptedSession().session);
    expect(table.reserve('app-s' as AppSessionId, create)).toEqual({ status: 'refused', reason: 'already_live', message: 'process is being adopted' });
    expect(create).not.toHaveBeenCalled();
    const s = scriptedSession();
    expect(table.reserve('app-s' as AppSessionId, () => s.session, { adoption: true })).toMatchObject({ status: 'launching' });
    expect(table.adoptingCount).toBe(1);
    table.adoptionEnded('app-s' as AppSessionId); // reserved already: nothing to release
    table.adoptionEnded('app-t' as AppSessionId); // failed: released
    expect([table.adoptingCount, table.launching()]).toEqual([0, false]);
    s.transport.exit(0);
    await s.session.exited;
  });

  it('release frees an exited row only: a live one stays reserved, an exited one leaves the table (archive, whole-branch review)', async () => {
    const table = new ProcessTable({ ps: async () => '' });
    const s = scriptedSession();
    table.reserve('app-s' as AppSessionId, () => s.session);
    await s.session.start();
    expect(table.release('app-s' as AppSessionId)).toBe(false);
    expect(table.get('app-s' as AppSessionId)).toBe(s.session);
    s.transport.exit(0);
    await s.session.exited;
    expect(table.release('app-s' as AppSessionId)).toBe(true);
    expect(table.get('app-s' as AppSessionId)).toBeUndefined();
    expect(table.list()).toEqual([]);
    expect(table.release('app-s' as AppSessionId)).toBe(false); // nothing left to release
  });

  it('after a journal_failed exit the reservation is released and a resume for the same app session is accepted', async () => {
    const table = new ProcessTable({ ps: async () => '' });
    const first = scriptedSession();
    table.reserve('app-s' as AppSessionId, () => first.session);
    await first.session.start();
    first.journal.failOnce = (direction) => direction === 'out';
    await first.session.send('hi').catch(() => {});
    await flush();
    expect(first.journal.rows.some((r) => (r.frame as { event?: string; code?: string }).code === 'journal_failed')).toBe(true);
    expect(first.transport.calls).toContain('kill:SIGTERM');
    expect(table.reserve('app-s' as AppSessionId, () => { throw new Error('must not create'); })).toMatchObject({ status: 'refused', reason: 'already_live' });
    first.transport.exit(null, 'SIGTERM');
    await first.session.exited;
    expect(first.session.status().exit).toMatchObject({ reason: 'crash' });
    const exitIndex = first.journal.rows.findIndex((r) => (r.frame as { event?: string }).event === 'exit');
    const failedIndex = first.journal.rows.findIndex((r) => (r.frame as { code?: string }).code === 'journal_failed');
    expect(failedIndex).toBeGreaterThanOrEqual(0);
    expect(failedIndex).toBeLessThan(exitIndex);

    const resumed = scriptedSession({ spec: { resume: { sessionId: '33333333-3333-4333-8333-333333333333' as never, fork: false }, sessionId: null } });
    const outcome = table.reserve('app-s' as AppSessionId, () => resumed.session);
    expect(outcome).toMatchObject({ status: 'launching' });
    expect((outcome as { session: EngineSession }).session).toBe(resumed.session);
    await resumed.session.start();
    expect(resumed.session.status().process).toBe('ready');
  });
});

// C12 start: the budget's table side (C12 execution document, Interfaces "The table's side"; M1 task 4)
describe('process table (C12): the memory budget', () => {
  type Scripted = ReturnType<typeof scriptedSession>;
  const RSS = (rows: [number, number][]) => rows.map(([pid, kib]) => `  ${pid}     1   ${kib}`).join('\n') + '\n';
  const idleFrame = (uuid: string) => ({ type: 'system', subtype: 'session_state_changed', state: 'idle', uuid, session_id: 's' });

  // Ready, engine-idle sessions under one table whose `ps` answers the given trees (KiB by pid). end_session is never
  // answered, so a released process stays `exiting` until the test pushes its exit.
  async function budgetTable(trees: Record<string, number>, opts: { limitKiB?: number; stateful?: string[] } = {}) {
    const rss = new Map<number, number>();
    const table = new ProcessTable({ ps: async () => RSS([...rss]) });
    const s: Record<string, Scripted> = {};
    let pid = 500;
    for (const [name, kib] of Object.entries(trees)) {
      pid += 1;
      rss.set(pid, kib);
      s[name] = scriptedSession({ spec: { appSessionId: name as AppSessionId }, transport: { pid }, responder: handshakeResponder({ end_session: () => null }), session: { statefulMcpServers: () => table.statefulMcpServers } });
      table.reserve(name as AppSessionId, () => s[name]!.session);
    }
    await Promise.all(Object.values(s).map((x) => x.session.start()));
    for (const [name, x] of Object.entries(s)) x.transport.push(idleFrame(`idle-${name}`));
    await flush();
    const states: BudgetState[] = [];
    table.onBudget((state) => states.push(state));
    if (opts.limitKiB !== undefined) table.configure({ enabled: true, limitKiB: opts.limitKiB, statefulMcpServers: opts.stateful ?? [] });
    return { table, s, states, rss };
  }
  const reasons = (x: Scripted) => x.session.status().exit?.reason ?? null;
  const fixture = readFileSync(join(__dirname, '../../spikes/protocol-probe/fixtures/subagent.jsonl'), 'utf8').split('\n');
  const TASK_RESULT = (JSON.parse(fixture[423]!) as { frame: Record<string, unknown> }).frame; // seq 424
  const FOLLOW_UP_INIT = (JSON.parse(fixture[424]!) as { frame: Record<string, unknown> }).frame; // seq 425
  const exitOf = async (x: Scripted) => {
    x.transport.exit(0);
    await x.session.exited;
  };

  it('evaluates after each sample: nothing is quiet at the first, and the second releases the least recently used idle session through the ladder with reason budget', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-29T10:00:00.000Z'));
    const { table, s, states } = await budgetTable({ a: 400, b: 300, c: 200 }, { limitKiB: 800 });
    s.b!.session.markUsed(); // a is now the least recently used, then c
    vi.setSystemTime(new Date('2026-09-29T10:00:01.000Z'));
    s.c!.session.markUsed();
    vi.setSystemTime(new Date('2026-09-29T10:00:02.000Z'));
    s.b!.session.markUsed();
    await table.sampleMemory();
    expect(table.budgetState()).toMatchObject({ totalKiB: 900, limitKiB: 800, over: true, candidates: 0, settling: 3, releasing: null, sampledAt: '2026-09-29T10:00:02.000Z' });
    expect(Object.values(s).map((x) => x.session.lifecycle)).toEqual(['ready', 'ready', 'ready']);
    await table.sampleMemory();
    expect(s.a!.session.lifecycle).toBe('exiting');
    expect(s.a!.transport.requestsOf('end_session').map((r) => r.request.reason)).toEqual(['stop']); // `budget` never goes on the wire
    expect(table.budgetState()).toMatchObject({ over: true, candidates: 3, releasing: 'a', lastRelease: { appSessionId: 'a', at: '2026-09-29T10:00:02.000Z', totalKiB: 900 } });
    expect(states.at(-1)).toMatchObject({ releasing: 'a' });
    await exitOf(s.a!);
    expect(s.a!.session.status().exit).toMatchObject({ reason: 'budget', release: { limitKiB: 800, totalKiB: 900 } });
    expect(table.budgetState().releasing).toBeNull();
    await table.sampleMemory();
    expect(table.budgetState()).toMatchObject({ totalKiB: 500, over: false });
    expect([s.b, s.c].map((x) => x!.session.lifecycle)).toEqual(['ready', 'ready']);
  });

  it('evaluates at a policy change against the previous sample, without waiting for the next', async () => {
    const { table, s } = await budgetTable({ a: 400, b: 300 });
    await table.sampleMemory(); // records each row's lastEventSeq; the default budget is far above 700 KiB
    await table.sampleMemory(); // classifies each row quiet
    expect(table.budgetState()).toMatchObject({ over: false, releasing: null });
    const state = table.configure({ enabled: true, limitKiB: 500, statefulMcpServers: [] });
    expect(state).toMatchObject({ limitKiB: 500, over: true, releasing: 'a' }); // a launched first, so it is the least recently used
    expect(s.a!.session.lifecycle).toBe('exiting');
  });

  // W7: the budget switched off in settings (charter §4.4 as amended 2026-10-01): the pre-C12 rule, with the totals kept
  it('with the budget off, keeps sampling and publishing the totals but never releases nor flags; on again, releases at the policy change', async () => {
    const { table, s, states } = await budgetTable({ a: 400, b: 300 }, { limitKiB: 10_000 });
    expect(table.configure({ enabled: false, limitKiB: 100, statefulMcpServers: [] })).toMatchObject({ enabled: false, limitKiB: 100, over: false });
    for (let i = 0; i < 3; i += 1) await table.sampleMemory();
    expect(table.budgetState()).toMatchObject({ enabled: false, totalKiB: 700, over: false, overWithoutCandidate: false, candidates: 2, releasing: null, lastRelease: null });
    expect(states.at(-1)).toMatchObject({ enabled: false, totalKiB: 700 }); // Session info's line follows the event
    expect([s.a, s.b].map((x) => x!.session.lifecycle)).toEqual(['ready', 'ready']);
    expect(table.configure({ enabled: true, limitKiB: 100, statefulMcpServers: [] })).toMatchObject({ enabled: true, over: true, releasing: 'a' });
    expect(s.a!.session.lifecycle).toBe('exiting');
  });

  it('with the budget off, a session holding work raises no over-budget flag however many samples pass', async () => {
    const { table, s } = await budgetTable({ a: 400 }, { limitKiB: 100 });
    s.a!.transport.push({ type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 't1', task_type: 'local_bash', description: 'sleep 900' }], uuid: 'bg', session_id: 's' });
    await flush();
    await table.sampleMemory();
    await table.sampleMemory();
    expect(table.budgetState().overWithoutCandidate).toBe(true);
    table.configure({ enabled: false, limitKiB: 100, statefulMcpServers: [] }); // off clears it at once
    expect(table.budgetState()).toMatchObject({ over: false, overWithoutCandidate: false, blocked: [{ appSessionId: 'a', reasons: ['background_tasks'] }] });
    await table.sampleMemory();
    await table.sampleMemory();
    expect(table.budgetState().overWithoutCandidate).toBe(false);
  });

  // pass1/subagent.jsonl seq 424-425: a task-notification turn's `result`, then the engine's own follow-up `system/init`
  // 3 ms later. Between the two the row has no turn, so only quiet protects it; a sample that saw the result must not
  // hand a policy change a fresh baseline to call quiet (M1 re-review of the unknown engine state).
  it('a policy change calls a row quiet only if the latest sample did and nothing moved since: result, sample, configure before the follow-up init releases nothing; the init then protects by its turn', async () => {
    const { table, s } = await budgetTable({ a: 400 });
    await table.sampleMemory();
    await table.sampleMemory(); // a is quiet at this sample
    const seq = s.a!.session.status().lastEventSeq;
    s.a!.transport.push({ ...TASK_RESULT, session_id: 's' });
    await flush();
    expect(s.a!.session.status().lastEventSeq).toBeGreaterThan(seq);
    expect(s.a!.session.status().turn).toBeNull();
    await table.sampleMemory(); // sees the result: not quiet, and records the new lastEventSeq
    expect(table.configure({ enabled: true, limitKiB: 100, statefulMcpServers: [] })).toMatchObject({ over: true, candidates: 0, releasing: null });
    expect(s.a!.session.lifecycle).toBe('ready');
    s.a!.transport.push({ ...FOLLOW_UP_INIT, session_id: 's' });
    await flush();
    expect(s.a!.session.status().turn).toMatchObject({ origin: 'engine' });
    expect(table.configure({ enabled: true, limitKiB: 100, statefulMcpServers: [] })).toMatchObject({ candidates: 0, releasing: null, blocked: [{ appSessionId: 'a', reasons: ['turn'] }] });
    await table.sampleMemory();
    await table.sampleMemory();
    expect(s.a!.session.lifecycle).toBe('ready');
  });

  // C12 M5: the real states, from the probe's recording under CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1 (pass3/
  // launch-env-state-events.jsonl: running at seq 6, requires_action at 29 with the can_use_tool at 30, running at 36,
  // the result at 53, idle at 55). The engine's frames are replayed in order (its echo of the host's answer, an `in`
  // control_response, is the host's own and is skipped; the host answers the request itself). Between the result and
  // `idle` the row holds no hard reason, so only its engine state keeps it: `running` blocks a release there, and the
  // release follows `idle` once the row is quiet.
  it('real engine states: running and requires_action block a release, idle allows it (pass3/launch-env-state-events)', async () => {
    const rows = readFileSync(join(__dirname, '../../spikes/protocol-probe/fixtures/pass3/launch-env-state-events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { seq: number; direction: string; frame: Record<string, unknown> });
    const engine = rows.filter((r) => r.direction === 'in' && r.frame.type !== 'control_response');
    const { table, s } = await budgetTable({ a: 400 }, { limitKiB: 100 });
    const a = s.a!;
    let next = 0;
    const replayThrough = async (seq: number) => {
      while (next < engine.length && engine[next]!.seq <= seq) a.transport.push({ ...engine[next++]!.frame, session_id: 's' });
      await flush();
    };
    const twoSamples = async () => {
      await table.sampleMemory();
      await table.sampleMemory();
    };

    await replayThrough(6);
    expect(a.session.status().engineState).toBe('running');
    await twoSamples();
    expect(a.session.lifecycle).toBe('ready');

    await replayThrough(30);
    expect(a.session.status()).toMatchObject({ engineState: 'requires_action', pendingRequests: 1 });
    await twoSamples();
    expect(a.session.lifecycle).toBe('ready');
    expect(await a.session.answer('babe54eb-6089-4878-a021-386ba22f4141' as RequestId, { kind: 'permission', decision: 'allow', scope: 'once' })).toBe('delivered');

    await replayThrough(53); // the result: the turn is over, the engine has not said idle yet
    expect(a.session.status()).toMatchObject({ engineState: 'running', turn: null, busy: false, pendingRequests: 0, keepAlive: [] });
    await twoSamples();
    expect(a.session.lifecycle).toBe('ready');
    expect(table.budgetState()).toMatchObject({ over: true, candidates: 0, settling: 1, blocked: [], releasing: null });

    await replayThrough(55);
    expect(a.session.status().engineState).toBe('idle');
    await table.sampleMemory(); // idle moved lastEventSeq: not quiet yet
    expect(a.session.lifecycle).toBe('ready');
    await table.sampleMemory();
    expect(a.session.lifecycle).toBe('exiting');
    await exitOf(a);
    expect(a.session.status().exit).toMatchObject({ reason: 'budget' });
  });

  it('a row whose lastEventSeq moved since the previous sample is not quiet, so it is not released', async () => {
    const { table, s } = await budgetTable({ a: 400 }, { limitKiB: 100 });
    await table.sampleMemory();
    s.a!.transport.push(idleFrame('idle-again'));
    await flush();
    await table.sampleMemory();
    expect(s.a!.session.lifecycle).toBe('ready');
    expect(table.budgetState()).toMatchObject({ candidates: 0, settling: 1 });
    await table.sampleMemory();
    expect(s.a!.session.lifecycle).toBe('exiting');
  });

  it('evaluates and stops in one synchronous step: a frame queued while the sample lands reaches the session only after the end_session', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-29T10:00:00.000Z'));
    const { table, s } = await budgetTable({ a: 400 }, { limitKiB: 100 });
    await table.sampleMemory();
    vi.setSystemTime(new Date('2026-09-29T10:00:10.000Z')); // the next sample's time, so its status goes out
    const turn = { type: 'system', subtype: 'init', cwd: '/w', session_id: 's', tools: [], mcp_servers: [], model: 'm', permissionMode: 'auto', slash_commands: [], claude_code_version: '2.1.283', output_style: 'default', uuid: 'late-init' };
    let pushed = false;
    s.a!.session.on('status', (st) => {
      if (!pushed && st.memory.sampledAt !== null && st.process === 'ready') {
        pushed = true;
        s.a!.transport.push(turn); // arrives while the table is between the sample and its verdict
      }
    });
    await table.sampleMemory();
    expect(pushed).toBe(true);
    await flush();
    const rows = s.a!.journal.rows.map((r) => r.frame as { type?: string; uuid?: string; request?: { subtype?: string } });
    const endSession = rows.findIndex((f) => f.type === 'control_request' && f.request?.subtype === 'end_session');
    const late = rows.findIndex((f) => f.uuid === 'late-init');
    expect(endSession).toBeGreaterThanOrEqual(0);
    expect(late).toBeGreaterThan(endSession);
    expect(s.a!.session.lifecycle).toBe('exiting');
  });

  it('releases no second session while one is exiting, then one per sample', async () => {
    const { table, s } = await budgetTable({ a: 400, b: 300, c: 200 }, { limitKiB: 100 });
    await table.sampleMemory();
    await table.sampleMemory();
    expect(Object.values(s).map((x) => x.session.lifecycle)).toEqual(['exiting', 'ready', 'ready']);
    await table.sampleMemory();
    expect(Object.values(s).map((x) => x.session.lifecycle)).toEqual(['exiting', 'ready', 'ready']);
    expect(table.budgetState()).toMatchObject({ totalKiB: 500, releasing: 'a' }); // the exiting tree is not in the sum
    await exitOf(s.a!);
    await table.sampleMemory();
    expect(Object.values(s).map((x) => x.session.lifecycle)).toEqual(['exited', 'exiting', 'ready']);
  });

  it('never releases a session whose ! command is still running past its no-output warning; it becomes a candidate once the output arrives', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { table, s } = await budgetTable({ a: 400 }, { limitKiB: 100 });
    await s.a!.session.bash('sleep 100');
    await vi.advanceTimersByTimeAsync(30_000); // the warning: no output yet
    await table.sampleMemory();
    await table.sampleMemory();
    expect(s.a!.session.lifecycle).toBe('ready');
    expect(table.budgetState()).toMatchObject({ candidates: 0, blocked: [{ appSessionId: 'a', reasons: ['busy'] }] });
    s.a!.transport.push({ type: 'user', message: { role: 'user', content: '<bash-input>sleep 100</bash-input>' }, parent_tool_use_id: null, session_id: 's' });
    s.a!.transport.push({ type: 'user', message: { role: 'user', content: '<bash-stdout></bash-stdout><bash-stderr></bash-stderr><bash-exit-code>0</bash-exit-code>' }, parent_tool_use_id: null, session_id: 's' });
    await vi.advanceTimersByTimeAsync(0);
    await table.sampleMemory(); // not quiet yet: the output moved lastEventSeq
    expect(s.a!.session.lifecycle).toBe('ready');
    await table.sampleMemory();
    expect(s.a!.session.lifecycle).toBe('exiting');
  });

  it('never touches a session with a hard reason, and names why in the state', async () => {
    const { table, s } = await budgetTable({ a: 400, b: 300 }, { limitKiB: 100, stateful: ['c12-kernel'] });
    s.a!.transport.push({ type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 't1', task_type: 'local_bash', description: 'sleep 900' }], uuid: 'bg', session_id: 's' });
    s.b!.transport.push({ type: 'system', subtype: 'init', cwd: '/w', session_id: 's', tools: [], mcp_servers: [{ name: 'c12-kernel', status: 'connected', source: 'project' }], model: 'm', permissionMode: 'auto', slash_commands: [], claude_code_version: '2.1.283', output_style: 'default', uuid: 'i-b' });
    s.b!.transport.push({ type: 'result', subtype: 'success', session_id: 's', is_error: false, duration_ms: 1, num_turns: 0, total_cost_usd: 0, usage: {}, permission_denials: [], terminal_reason: 'completed' });
    s.b!.transport.push(idleFrame('idle-b2'));
    await flush();
    await table.sampleMemory();
    await table.sampleMemory();
    expect([s.a, s.b].map((x) => x!.session.lifecycle)).toEqual(['ready', 'ready']);
    expect(table.budgetState()).toMatchObject({ over: true, candidates: 0, blocked: [{ appSessionId: 'a', reasons: ['background_tasks'] }, { appSessionId: 'b', reasons: ['stateful_mcp'] }] });
    expect(s.b!.session.status().keepAlive).toEqual(['stateful_mcp']);
  });

  it('raises overWithoutCandidate only on the second consecutive sample over budget with no candidate, and emits it', async () => {
    const { table, s, states } = await budgetTable({ a: 400 }, { limitKiB: 100 });
    s.a!.transport.push({ type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 't1', task_type: 'local_bash', description: 'sleep 900' }], uuid: 'bg', session_id: 's' });
    await flush();
    await table.sampleMemory();
    expect(table.budgetState()).toMatchObject({ over: true, candidates: 0, overWithoutCandidate: false });
    await table.sampleMemory();
    expect(table.budgetState().overWithoutCandidate).toBe(true);
    expect(states.at(-1)!.overWithoutCandidate).toBe(true);
    table.configure({ enabled: true, limitKiB: 1_000, statefulMcpServers: [] }); // under budget again: cleared at once
    expect(table.budgetState()).toMatchObject({ over: false, overWithoutCandidate: false });
  });

  it('emits the budget state when a field other than sampledAt changes, and at every release', async () => {
    const { table, states } = await budgetTable({ a: 400 }, { limitKiB: 10_000 });
    const before = states.length;
    await table.sampleMemory();
    const afterFirst = states.length;
    expect(afterFirst).toBeGreaterThan(before); // the total moved from nothing to 400
    await table.sampleMemory(); // a turns quiet: candidates 0 → 1
    await table.sampleMemory(); // nothing but sampledAt moved
    expect(states.length).toBe(afterFirst + 1);
    table.configure({ enabled: true, limitKiB: 100, statefulMcpServers: [] });
    expect(states.at(-1)).toMatchObject({ releasing: 'a', lastRelease: { appSessionId: 'a' } });
  });

  it("keeps the ids it released, each taken once by the id's next launch, and never an id whose release an explicit stop overrode", async () => {
    const { table, s } = await budgetTable({ a: 400, b: 300 }, { limitKiB: 100 });
    await table.sampleMemory();
    await table.sampleMemory();
    await exitOf(s.a!);
    await table.sampleMemory();
    expect(s.b!.session.lifecycle).toBe('exiting');
    void s.b!.session.stop('stop'); // the owner's stop during the release's ladder wins
    await exitOf(s.b!);
    expect(reasons(s.b!)).toBe('stop');
    expect(table.takeReleased('a' as AppSessionId)).toBe(true);
    expect(table.takeReleased('a' as AppSessionId)).toBe(false);
    expect(table.takeReleased('b' as AppSessionId)).toBe(false);
  });

  it('a released process that speaks again after its id relaunched does not mark the new launch released', async () => {
    const { table, s } = await budgetTable({ a: 400 }, { limitKiB: 100 });
    await table.sampleMemory();
    await table.sampleMemory();
    await exitOf(s.a!);
    expect(table.takeReleased('a' as AppSessionId)).toBe(true); // the launcher takes it as it creates the next launch
    const next = scriptedSession({ spec: { appSessionId: 'a' as AppSessionId } });
    table.reserve('a' as AppSessionId, () => next.session);
    await next.session.start();
    s.a!.session.markUsed(); // the old process emits another exited status
    expect(table.takeReleased('a' as AppSessionId)).toBe(false);
  });

  it('a policy change re-reads every live status, so keepAlive follows the stateful list', async () => {
    const { table, s } = await budgetTable({ a: 400 });
    s.a!.transport.push({ type: 'system', subtype: 'init', cwd: '/w', session_id: 's', tools: [], mcp_servers: [{ name: 'c12-kernel', status: 'pending', source: 'project' }], model: 'm', permissionMode: 'auto', slash_commands: [], claude_code_version: '2.1.283', output_style: 'default', uuid: 'i-a' });
    s.a!.transport.push({ type: 'result', subtype: 'success', session_id: 's', is_error: false, duration_ms: 1, num_turns: 0, total_cost_usd: 0, usage: {}, permission_denials: [], terminal_reason: 'completed' });
    await flush();
    const seen: EngineSessionStatus[] = [];
    table.onChange((st) => seen.push(st));
    table.configure({ enabled: true, limitKiB: 10_000, statefulMcpServers: ['c12-kernel'] });
    expect(seen.at(-1)!.keepAlive).toEqual(['stateful_mcp']);
  });

  it('defaults the budget to a quarter of physical memory until a policy arrives', () => {
    const table = new ProcessTable({ ps: async () => '', totalMemBytes: 32 * 1024 ** 3 });
    expect(table.budgetState()).toEqual({
      enabled: true, limitKiB: 8 * 1024 ** 2, totalKiB: 0, sampledAt: null, over: false, overWithoutCandidate: false, candidates: 0, settling: 0, releasing: null, blocked: [], lastRelease: null,
    });
  });
});
// C12 end

// C12 start: the exited-row cap (C12 execution document, M1 task 5)
describe('process table (C12): exited rows beyond the cap', () => {
  it('drops the oldest exit first once more rows have exited than the cap, telling its listeners; live rows are never dropped', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const table = new ProcessTable({ ps: async () => '', exitedRowsMax: 2 });
    const dropped: string[] = [];
    table.onDropped((id) => dropped.push(id));
    const names = ['a', 'b', 'c', 'd'];
    const sessions = names.map((name) => scriptedSession({ spec: { appSessionId: name as AppSessionId }, responder: handshakeResponder({ end_session: () => null }) }));
    sessions.forEach((x, i) => table.reserve(names[i] as AppSessionId, () => x.session));
    await Promise.all(sessions.map((x) => x.session.start()));
    const exit = async (i: number, at: string) => {
      vi.setSystemTime(new Date(at));
      const stopping = sessions[i]!.session.stop('stop');
      sessions[i]!.transport.exit(0);
      await stopping;
    };
    await exit(0, '2026-09-29T10:00:00.000Z');
    await exit(1, '2026-09-29T10:01:00.000Z');
    await exit(2, '2026-09-29T10:02:00.000Z');
    expect(dropped).toEqual(['a']);
    expect(table.list().map((x) => x.status().appSessionId)).toEqual(['b', 'c', 'd']); // d is live
    await exit(3, '2026-09-29T10:03:00.000Z');
    expect(dropped).toEqual(['a', 'b']);
    expect(table.list().map((x) => x.status().appSessionId)).toEqual(['c', 'd']);
  });

  // A row the budget released neither counts nor goes (tracker row: a capped row's released id survived archive, since
  // main archives through the host's row and the host's released id outlived it). The released ids and their rows now
  // leave together: at the id's next launch, which replaces the row, or at an archive or forget, which drops both.
  it('keeps a released row past the cap, so an archive reaches it and takes its released id; other exits stay capped', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-29T10:00:00.000Z'));
    const table = new ProcessTable({ ps: async () => '  601     1   400\n  602     1   400\n', exitedRowsMax: 1 });
    const dropped: string[] = [];
    table.onDropped((id) => dropped.push(id));
    const names = ['a', 'b', 'c', 'd', 'e'];
    const sessions = names.map((name, i) => scriptedSession({ spec: { appSessionId: name as AppSessionId }, transport: { pid: 601 + i }, responder: handshakeResponder({ end_session: () => null }) }));
    sessions.forEach((x, i) => table.reserve(names[i] as AppSessionId, () => x.session));
    await Promise.all(sessions.map((x) => x.session.start()));
    const [a, b] = sessions as [ReturnType<typeof scriptedSession>, ReturnType<typeof scriptedSession>];
    // a, then b, released by the budget (c, d and e are engine-unknown, never candidates)
    a.transport.push({ type: 'system', subtype: 'session_state_changed', state: 'idle', uuid: 'idle-a', session_id: 's' });
    b.transport.push({ type: 'system', subtype: 'session_state_changed', state: 'idle', uuid: 'idle-b', session_id: 's' });
    await flush();
    table.configure({ enabled: true, limitKiB: 100, statefulMcpServers: [] });
    await table.sampleMemory();
    await table.sampleMemory();
    expect(table.budgetState().releasing).toBe('a');
    a.transport.exit(0);
    await a.session.exited;
    await table.sampleMemory();
    expect(table.budgetState().releasing).toBe('b');
    b.transport.exit(0);
    await b.session.exited;
    expect([a, b].map((x) => x.session.status().exit?.reason)).toEqual(['budget', 'budget']);
    for (const [i, at] of [[2, '2026-09-29T10:01:00.000Z'], [3, '2026-09-29T10:02:00.000Z'], [4, '2026-09-29T10:03:00.000Z']] as const) {
      vi.setSystemTime(new Date(at));
      const stopping = sessions[i]!.session.stop('stop');
      sessions[i]!.transport.exit(0);
      await stopping;
    }
    expect(dropped).toEqual(['c', 'd']); // the cap still bounds the exits that were not releases
    expect(table.list().map((x) => x.status().appSessionId)).toEqual(['a', 'b', 'e']);
    expect(table.release('a' as AppSessionId)).toBe(true); // the archive's release
    expect(table.takeReleased('a' as AppSessionId)).toBe(false); // an unarchived a launches fresh, with no Resumed row
    expect(table.takeReleased('b' as AppSessionId)).toBe(true); // b's next launch still reconnects as process_exit
  });
});

// whole-branch review (P2): an exited row that still holds a queue is exempt from the cap's count and from eviction, so
// session.queue.edit and remove keep answering for what the list shows; once its queue is empty the next exit's cap
// picks it up
describe('process table (C12): exited rows holding a queue', () => {
  it('stay past the cap while their queue holds entries, and go at the next exit once it is empty', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const table = new ProcessTable({ ps: async () => '', exitedRowsMax: 1 });
    const dropped: string[] = [];
    table.onDropped((id) => dropped.push(id));
    const names = ['q1', 'q2', 'p1', 'p2', 'p3'];
    // q1 and q2's first message fails its write and waits in their paused queue (session.test: write_failed)
    const rows = names.map((name) => scriptedSession({ spec: { appSessionId: name as AppSessionId }, responder: handshakeResponder({ end_session: () => null }), transport: name.startsWith('q') ? { failWrite: (f) => f.type === 'user' } : {} }));
    rows.forEach((x, i) => table.reserve(names[i] as AppSessionId, () => x.session));
    await Promise.all(rows.map((x) => x.session.start()));
    const [q1, q2, p1, p2, p3] = rows as [(typeof rows)[number], (typeof rows)[number], (typeof rows)[number], (typeof rows)[number], (typeof rows)[number]];
    const entry1 = (await q1.session.send('draft one')).entry!;
    const entry2 = (await q2.session.send('draft two')).entry!;
    const exit = async (x: (typeof rows)[number], at: string) => {
      vi.setSystemTime(new Date(at));
      const stopping = x.session.stop('stop');
      x.transport.exit(0);
      await stopping;
    };
    await exit(q1, '2026-09-30T10:00:00.000Z');
    await exit(q2, '2026-09-30T10:01:00.000Z');
    await exit(p1, '2026-09-30T10:02:00.000Z');
    await exit(p2, '2026-09-30T10:03:00.000Z');
    expect(dropped).toEqual(['p1']); // the queue-holders neither count nor go
    const id = (x: string) => x as AppSessionId;
    await expect(table.get(id('q1'))!.queue.edit(entry1.queueId, 'draft one, edited')).resolves.toMatchObject({ content: 'draft one, edited' });
    await table.get(id('q2'))!.queue.remove(entry2.queueId); // q2's queue is now empty
    expect(dropped).toEqual(['p1']); // eligible again, picked up at the cap's next application
    await exit(p3, '2026-09-30T10:04:00.000Z');
    expect(dropped).toEqual(['p1', 'q2', 'p2']);
    expect(table.list().map((x) => x.status().appSessionId)).toEqual(['q1', 'p3']);
  });
});

describe('process table (C12): the cap never exceeds itself when exit times tie or go backward', () => {
  async function twoRows(max: number) {
    const table = new ProcessTable({ ps: async () => '', exitedRowsMax: max });
    const dropped: string[] = [];
    table.onDropped((id) => dropped.push(id));
    const rows = ['a', 'b'].map((name) => scriptedSession({ spec: { appSessionId: name as AppSessionId }, responder: handshakeResponder({ end_session: () => null }) }));
    rows.forEach((x, i) => table.reserve(['a', 'b'][i] as AppSessionId, () => x.session));
    await Promise.all(rows.map((x) => x.session.start()));
    const exit = async (x: (typeof rows)[number], at: string) => {
      vi.setSystemTime(new Date(at));
      const stopping = x.session.stop('stop');
      x.transport.exit(0);
      await stopping;
    };
    return { table, dropped, a: rows[0]!, b: rows[1]!, exit };
  }

  it('a tie with the row whose exit is being delivered drops the other row', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { table, dropped, a, b, exit } = await twoRows(1);
    await exit(b, '2026-09-29T10:00:00.000Z');
    await exit(a, '2026-09-29T10:00:00.000Z'); // a is first in the table's order and ties with b
    expect(dropped).toEqual(['b']);
    expect(table.list().map((x) => x.status().appSessionId)).toEqual(['a']);
  });

  it('an exit stamped before an earlier one (the clock went back) still keeps the table at the cap', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { table, dropped, a, b, exit } = await twoRows(1);
    await exit(a, '2026-09-29T10:05:00.000Z');
    await exit(b, '2026-09-29T10:00:00.000Z');
    expect(dropped).toEqual(['a']);
    expect(table.list().map((x) => x.status().appSessionId)).toEqual(['b']);
  });
});
// C12 end

// E10 start: the supervisor's idle-row release (E10 execution document, §Design 1 "Idle exit, and idle rows"): while no
// app is connected, or under an armed exit-when-idle (the policy's `active`), a ready row that has held no hard reason
// for the idle time is stopped with reason `idle`, a release like the budget's. Its clock starts at the later of the
// moment its last hard reason cleared and the moment the release became active.
describe('process table (E10): the idle-row release', () => {
  const IDLE_MS = 60_000;
  const T0 = new Date('2026-10-06T10:00:00.000Z');
  type Scripted = ReturnType<typeof scriptedSession>;
  const tasks = (list: unknown[], uuid: string) => ({ type: 'system', subtype: 'background_tasks_changed', tasks: list, uuid, session_id: 's' });
  const TASK = { task_id: 't-1', task_type: 'local_agent', description: 'work' };
  const engineState = (state: string, uuid: string) => ({ type: 'system', subtype: 'session_state_changed', state, uuid, session_id: 's' });

  // Ready rows under one table, the clock faked; end_session is never answered, so a released row stays `exiting`.
  async function idleTable(names: string[], opts: { exitedRowsMax?: number } = {}) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(T0);
    const logs: string[] = [];
    const table = new ProcessTable({ ps: async () => '', exitedRowsMax: opts.exitedRowsMax, log: (line) => void logs.push(line) });
    const s: Record<string, Scripted> = {};
    for (const [i, name] of names.entries()) {
      s[name] = scriptedSession({ spec: { appSessionId: name as AppSessionId }, transport: { pid: 700 + i }, responder: handshakeResponder({ end_session: () => null }) });
      table.reserve(name as AppSessionId, () => s[name]!.session);
    }
    await Promise.all(Object.values(s).map((x) => x.session.start()));
    await vi.advanceTimersByTimeAsync(0);
    return { table, s, logs };
  }
  // O16 M5: an idle release goes through the row's reap, which leaves the process state alone and writes end_session
  // first (holder/reap-session.test.ts): a row it released reads `released` here
  const lifecycle = (x: Scripted) => (x.transport.requestsOf('end_session').length > 0 ? 'released' : x.session.lifecycle);

  it('stops a ready row with no hard reason once the idle time has passed since the release became active, as reason idle', async () => {
    const { table, s, logs } = await idleTable(['a']);
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    expect(lifecycle(s.a!)).toBe('ready');
    await vi.advanceTimersByTimeAsync(1);
    expect(lifecycle(s.a!)).toBe('released');
    expect(logs).toEqual(['idle release of a: idle for 60000 ms with no interest held', 'idle reap of a: signalled (no observer was ever seen on the process)']); // P5 O2 M2: re-keyed on interest; O16 M5: through the reap
    expect(s.a!.transport.requestsOf('end_session').map((r) => r.request.reason)).toEqual(['stop']); // `idle` never goes on the wire
    s.a!.transport.exit(0);
    await s.a!.session.exited;
    expect(s.a!.session.status().exit).toMatchObject({ reason: 'idle', release: null });
    expect(table.takeReleased('a' as AppSessionId)).toBe(true); // its next launch reconnects as process_exit, as a budget release's
  });

  it('keeps a row while it holds a hard reason, and starts its clock when the last one clears', async () => {
    const { table, s } = await idleTable(['a']);
    s.a!.transport.push(tasks([TASK], 'b-1'));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.a!.session.status().keepAlive).toEqual(['background_tasks']);
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(3 * IDLE_MS);
    expect(lifecycle(s.a!)).toBe('ready');
    s.a!.transport.push(tasks([], 'b-2'));
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    expect(lifecycle(s.a!)).toBe('ready');
    await vi.advanceTimersByTimeAsync(1);
    expect(lifecycle(s.a!)).toBe('released');
  });

  it('a hard reason that comes and goes inside the idle time restarts the clock', async () => {
    const { table, s } = await idleTable(['a']);
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(IDLE_MS / 2);
    s.a!.transport.push(tasks([TASK], 'b-1'));
    await vi.advanceTimersByTimeAsync(IDLE_MS / 2);
    s.a!.transport.push(tasks([], 'b-2'));
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    expect(lifecycle(s.a!)).toBe('ready');
    await vi.advanceTimersByTimeAsync(1);
    expect(lifecycle(s.a!)).toBe('released');
  });

  it('a row the engine says is working is not idle (running), even with no hard reason', async () => {
    const { table, s } = await idleTable(['a']);
    s.a!.transport.push(engineState('running', 'st-1'));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.a!.session.status()).toMatchObject({ engineState: 'running', keepAlive: [] });
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(3 * IDLE_MS);
    expect(lifecycle(s.a!)).toBe('ready');
    s.a!.transport.push(engineState('idle', 'st-2'));
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(lifecycle(s.a!)).toBe('released');
  });

  it('releases nothing while inactive (a client connected), however long the row has been idle; activation starts the clock', async () => {
    const { table, s } = await idleTable(['a']);
    table.setIdleRelease({ idleMs: IDLE_MS, active: false });
    await vi.advanceTimersByTimeAsync(10 * IDLE_MS);
    expect(lifecycle(s.a!)).toBe('ready');
    table.setIdleRelease({ idleMs: IDLE_MS, active: true }); // the client left
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    expect(lifecycle(s.a!)).toBe('ready');
    await vi.advanceTimersByTimeAsync(1);
    expect(lifecycle(s.a!)).toBe('released');
  });

  it('a client connecting cancels the clock; one leaving again starts it afresh; a new idle time keeps the activation', async () => {
    const { table, s } = await idleTable(['a']);
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(IDLE_MS - 10);
    table.setIdleRelease({ idleMs: IDLE_MS, active: false });
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(lifecycle(s.a!)).toBe('ready');
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(IDLE_MS / 2);
    table.setIdleRelease({ idleMs: 2 * IDLE_MS, active: true }); // host.configure while away: same activation, longer time
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(lifecycle(s.a!)).toBe('ready');
    await vi.advanceTimersByTimeAsync(IDLE_MS / 2);
    expect(lifecycle(s.a!)).toBe('released');
  });

  it('never releases with no idle time (never)', async () => {
    const { table, s, logs } = await idleTable(['a']);
    table.setIdleRelease({ idleMs: null, active: true });
    await vi.advanceTimersByTimeAsync(100 * IDLE_MS);
    expect(lifecycle(s.a!)).toBe('ready');
    expect(logs).toEqual([]);
  });

  it('an idle-released row is in the released set, so it survives exited-row pruning until its archive', async () => {
    const { table, s } = await idleTable(['a', 'b', 'c'], { exitedRowsMax: 1 });
    s.b!.transport.push(tasks([TASK], 'b-1')); // b and c hold work and are stopped by hand
    s.c!.transport.push(tasks([TASK], 'c-1'));
    await vi.advanceTimersByTimeAsync(0);
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect([s.a, s.b, s.c].map((x) => lifecycle(x!))).toEqual(['released', 'ready', 'ready']);
    s.a!.transport.exit(0);
    await s.a!.session.exited;
    for (const x of [s.b!, s.c!]) {
      vi.setSystemTime(Date.now() + 1_000);
      const stopping = x.session.stop('stop');
      x.transport.exit(0);
      await stopping;
    }
    expect(table.list().map((x) => x.status().appSessionId)).toEqual(['a', 'c']); // b went at the cap; the released a stayed
    expect(table.release('a' as AppSessionId)).toBe(true); // the archive's release takes the released id with the row
    expect(table.takeReleased('a' as AppSessionId)).toBe(false);
  });
});
// E10 end

// E10 start: the orphan ledger's rows (E10 execution document, §Design 1 "The orphan ledger and sweep")
describe('process table (E10): the orphan ledger', () => {
  type Scripted = ReturnType<typeof scriptedSession>;
  function ledgerTable() {
    const procStartOf = vi.fn((pid: number): string | null => `T${pid}`);
    const logs: string[] = [];
    const table = new ProcessTable({ ps: async () => '', procStartOf, log: (line) => void logs.push(line) });
    const writes: LiveRow[][] = [];
    const launch = async (name: string, pid: number): Promise<Scripted> => {
      const s = scriptedSession({ spec: { appSessionId: name as AppSessionId }, transport: { pid } });
      table.reserve(name as AppSessionId, () => s.session);
      await s.session.start();
      return s;
    };
    const row = (s: Scripted, pid: number): LiveRow => ({ appSessionId: s.session.status().appSessionId, pid, procStart: `T${pid}`, launchId: s.session.status().launchId, holderId: null });
    return { table, procStartOf, logs, writes, launch, row, record: () => table.recordLive((rows) => void writes.push([...rows])) };
  }

  it('writes nothing until it records, then the live rows at once', async () => {
    const { table, writes, launch, row, record } = ledgerTable();
    const a = await launch('a', 701);
    expect(writes).toEqual([]);
    record();
    expect(writes).toEqual([[row(a, 701)]]);
    expect(table.list()).toHaveLength(1);
  });

  it('rewrites at every launch and exit, and only then: statuses that leave the live set as it was write nothing', async () => {
    const { writes, launch, row, record, procStartOf } = ledgerTable();
    record();
    expect(writes).toEqual([[]]);
    const a = await launch('a', 701);
    const b = await launch('b', 702);
    expect(writes.at(-1)).toEqual([row(a, 701), row(b, 702)]);
    const count = writes.length;
    a.transport.push({ type: 'system', subtype: 'session_state_changed', state: 'running', uuid: 'u-1', session_id: 's' });
    await flush();
    expect(writes).toHaveLength(count);
    a.transport.exit(0);
    await a.session.exited;
    expect(writes.at(-1)).toEqual([row(b, 702)]);
    expect(writes).toHaveLength(count + 1);
    expect(procStartOf.mock.calls.map(([pid]) => pid)).toEqual([701, 702]); // once per process
  });

  // P5 O16 M2 (Interfaces §B): a row under a session host names it
  it('names the session host a row runs under', async () => {
    const { table, writes, record } = ledgerTable();
    const s = scriptedSession({ spec: { appSessionId: 'h' as AppSessionId }, transport: { pid: 703 }, session: { holder: { pid: 99, holderId: 'L-h', binary: '/bin/host' } } });
    table.reserve('h' as AppSessionId, () => s.session);
    await s.session.start();
    record();
    expect(writes.at(-1)).toEqual([{ appSessionId: 'h', pid: 703, procStart: 'T703', launchId: s.session.status().launchId, holderId: 'L-h' }]);
  });

  it('records a start time it cannot read as empty, and a failed write is logged and retried at the next change', async () => {
    const { table, logs, procStartOf, launch } = ledgerTable();
    procStartOf.mockReturnValueOnce(null);
    let fail = true;
    const writes: LiveRow[][] = [];
    table.recordLive((rows) => {
      if (fail) throw new Error('disk full');
      writes.push([...rows]);
    });
    const a = await launch('a', 701);
    expect(logs.some((line) => line.includes('disk full'))).toBe(true);
    expect(logs.filter((line) => line.includes('start time'))).toEqual([expect.stringContaining('pid 701')]); // the '' leaves a trace
    fail = false;
    const b = await launch('b', 702);
    expect(writes.at(-1)!.map((r) => [r.appSessionId, r.procStart])).toEqual([[a.session.status().appSessionId, ''], [b.session.status().appSessionId, 'T702']]);
  });
});
// E10 end

// P5 O2 M2 start: the strict, interest-keyed idle release (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M2 "The
// release rule"; P5 §2 "Idle release"). A row is eligible when it is ready, the engine is not running or waiting, it holds
// no hard reason (background work of every kind, a session cron and unreadable work included), it is not kept, and no
// client holds interest in it; its clock starts at the latest of its eligibility by state, its interest's end, its keep
// mark's clearing and the release's activation. The memory budget honours the same work through `evaluate`.
describe('process table (P5 O2 M2): the strict, interest-keyed idle release', () => {
  const IDLE_MS = 10 * 60_000; // a laptop's default
  const T0 = new Date('2026-10-27T10:00:00.000Z');
  type Scripted = ReturnType<typeof scriptedSession>;
  const tasks = (list: unknown[], uuid: string) => ({ type: 'system', subtype: 'background_tasks_changed', tasks: list, uuid, session_id: 's' });
  const task = (taskType: string, ambient = false, description = 'work') => ({ task_id: `t-${taskType}`, task_type: taskType, description, ambient });
  const cron = { id: 'c-1', schedule: '*/5 * * * *', recurring: true, prompt: 'check the build' };
  const stop = (sessionCrons: unknown, id = 'stop-1') => ({ type: 'control_request', request_id: id, request: { subtype: 'hook_callback', callback_id: 'maws_Stop_1', input: { hook_event_name: 'Stop', session_id: 's', stop_hook_active: false, last_assistant_message: 'Done.', background_tasks: [], session_crons: sessionCrons } } });
  const assistantTool = (name: string, parent: string | null = null) => ({ type: 'assistant', message: { id: `msg-${name}`, role: 'assistant', content: [{ type: 'tool_use', id: `toolu-${name}`, name, input: {} }] }, parent_tool_use_id: parent, session_id: 's', uuid: `a-${name}` });
  const RESULT = { type: 'result', subtype: 'success', session_id: 's', is_error: false, duration_ms: 1, num_turns: 1, total_cost_usd: 0, usage: {}, permission_denials: [], terminal_reason: 'completed' };

  async function releaseTable(names: string[], per: (name: string) => NonNullable<Parameters<typeof scriptedSession>[0]> = () => ({})) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(T0);
    const logs: string[] = [];
    const table = new ProcessTable({ ps: async () => '', log: (line) => void logs.push(line) });
    const s: Record<string, Scripted> = {};
    for (const [i, name] of names.entries()) {
      const opts = per(name);
      s[name] = scriptedSession({ ...opts, spec: { appSessionId: name as AppSessionId, ...opts.spec }, transport: { pid: 800 + i }, responder: handshakeResponder({ end_session: () => null }) });
      table.reserve(name as AppSessionId, () => s[name]!.session);
    }
    await Promise.all(Object.values(s).map((x) => x.session.start()));
    await vi.advanceTimersByTimeAsync(0);
    return { table, s, logs };
  }
  // O16 M5: an idle release goes through the row's reap, which leaves the process state alone and writes end_session
  // first (holder/reap-session.test.ts): a row it released reads `released` here
  const lifecycle = (x: Scripted) => (x.transport.requestsOf('end_session').length > 0 ? 'released' : x.session.lifecycle);
  // One human turn, its frames pushed between the engine's `started` and its result.
  async function humanTurn(x: Scripted, frames: unknown[]): Promise<void> {
    const { messageUuid } = await x.session.send('go');
    x.transport.push({ type: 'command_lifecycle', command_uuid: messageUuid, state: 'started', uuid: `lc-${messageUuid}`, session_id: 's' });
    for (const frame of frames) x.transport.push(frame);
    x.transport.push({ ...RESULT, user_message_uuids: [messageUuid], origin: { kind: 'human' } });
    x.transport.push({ type: 'command_lifecycle', command_uuid: messageUuid, state: 'completed', uuid: `lc-done-${messageUuid}`, session_id: 's' });
    await vi.advanceTimersByTimeAsync(0);
  }
  // The memory budget's verdict on one row, over its limit and quiet, so a row with nothing held is its candidate.
  const budgetOf = (x: Scripted) => {
    x.session.recordMemory({ rssKiB: 1, treeRssKiB: 100, sampledAt: T0.toISOString() });
    const status = x.session.status();
    return evaluate({ rows: [status], policy: { enabled: true, limitKiB: 1, statefulMcpServers: [] }, quiet: new Set([status.appSessionId]), releasing: null, previousOverWithoutCandidate: false });
  };

  // Acceptance 3, first bullet: every non-ambient background task kind, by the idle release and by the memory budget
  it.each([
    ['a Bash job', task('local_bash', false, 'sleep 900')],
    ['a subagent', task('local_agent')],
    ['a Monitor (the Monitor tool’s local_bash)', task('local_bash', false, 'Monitor: tail -f build.log')],
    ['a Monitor (monitor_mcp)', task('monitor_mcp')],
    ['an MCP task', task('mcp_task')],
    ['a workflow', task('local_workflow')],
  ])('%s is never released, by the idle release or the memory budget', async (_kind, held) => {
    const { table, s } = await releaseTable(['a']);
    s.a!.transport.push(tasks([held], 'b-1'));
    await vi.advanceTimersByTimeAsync(0);
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(10 * IDLE_MS);
    expect(lifecycle(s.a!)).toBe('ready');
    expect(isIdleRow(s.a!.session.status(), new Set())).toBe(false);
    expect(budgetOf(s.a!)).toMatchObject({ over: true, release: null, blocked: [{ appSessionId: 'a', reasons: ['background_tasks'] }] });
  });

  it('only ambient tasks (an auto-started monitor_ws watcher, a dream) hold nothing: the session is released, and is the budget’s candidate', async () => {
    const { table, s } = await releaseTable(['a']);
    s.a!.transport.push(tasks([task('monitor_ws', true), task('dream', true)], 'b-1'));
    await vi.advanceTimersByTimeAsync(0);
    expect(budgetOf(s.a!)).toMatchObject({ over: true, release: 'a', blocked: [] });
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(lifecycle(s.a!)).toBe('released');
  });

  it('a session whose last Stop listed a session cron is never released; a Stop listing none starts its clock', async () => {
    const { table, s } = await releaseTable(['a']);
    await humanTurn(s.a!, [assistantTool('CronCreate'), stop([cron])]);
    expect(s.a!.session.status()).toMatchObject({ work: { crons: [cron], unknown: null }, keepAlive: ['background_tasks'] });
    expect(s.a!.transport.writes.filter((w) => w.type === 'control_response').map((w) => (w as { response: unknown }).response)).toContainEqual({ subtype: 'success', request_id: 'stop-1', response: {} }); // answered at once
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(10 * IDLE_MS);
    expect(lifecycle(s.a!)).toBe('ready');
    expect(budgetOf(s.a!)).toMatchObject({ release: null, blocked: [{ appSessionId: 'a', reasons: ['background_tasks'] }] });
    await humanTurn(s.a!, [assistantTool('CronDelete'), stop([], 'stop-2')]);
    expect(s.a!.session.status().work).toEqual({ crons: [], unknown: null, descendants: 0 });
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(lifecycle(s.a!)).toBe('released');
  });

  it('a cron tool (a subagent’s included) in a turn that ended without Stop holds the session until the next Stop', async () => {
    const { table, s } = await releaseTable(['a']);
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await humanTurn(s.a!, [assistantTool('CronCreate', 'toolu-agent')]); // interrupted: no Stop
    expect(s.a!.session.status().work).toEqual({ crons: [], unknown: 'turn_ended_without_stop', descendants: 0 });
    await vi.advanceTimersByTimeAsync(10 * IDLE_MS);
    expect(lifecycle(s.a!)).toBe('ready');
    await humanTurn(s.a!, [stop([])]);
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    expect(lifecycle(s.a!)).toBe('ready');
    await vi.advanceTimersByTimeAsync(1);
    expect(lifecycle(s.a!)).toBe('released');
  });

  it('a --resume after an exit that was not a release holds the session until its first Stop (a resurrected session-only cron can fire before it)', async () => {
    const { table, s } = await releaseTable(['a'], () => ({ spec: { resume: { sessionId: '44444444-4444-4444-8444-444444444444' as never, fork: false }, sessionId: null } }));
    expect(s.a!.session.status().work).toEqual({ crons: [], unknown: 'resumed', descendants: 0 });
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(10 * IDLE_MS);
    expect(lifecycle(s.a!)).toBe('ready');
    await humanTurn(s.a!, [stop([])]);
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(lifecycle(s.a!)).toBe('released');
  });

  it('a resume after a release starts known: nothing holds it', async () => {
    const { table, s } = await releaseTable(['a'], () => ({ spec: { resume: { sessionId: '44444444-4444-4444-8444-444444444444' as never, fork: false }, sessionId: null }, session: { launchKind: 'resumed_after_release' } }));
    expect(s.a!.session.status().work).toEqual({ crons: [], unknown: null, descendants: 0 });
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(lifecycle(s.a!)).toBe('released');
  });

  // P5 Decision Log 46: the durable crons, in the project's scheduled-tasks file, which no Stop lists
  const RESUMED = '44444444-4444-4444-8444-444444444444';
  const durableJob = (createdBySessionId = RESUMED) => ({ id: 'd-1', cron: '0 3 * * *', prompt: 'nightly', createdAt: 1_793_094_929_539, recurring: true, createdBySessionId });
  const tasksFile = (files: Map<string, string>) => (path: string) => files.get(path) ?? null;
  const resumeOf = (kind: 'resumed' | 'resumed_after_release', files: Map<string, string>) => () => ({
    spec: { resume: { sessionId: RESUMED as never, fork: false }, sessionId: null, cwd: '/p' },
    session: { launchKind: kind, scheduledTasksFile: tasksFile(files) },
  });

  it.each(['resumed', 'resumed_after_release'] as const)('a durable job created before a resume (%s) holds the session from its launch; its deletion, read at a Stop, frees it', async (kind) => {
    const files = new Map([['/p/.claude/scheduled_tasks.json', JSON.stringify({ tasks: [durableJob(), durableJob('someone-else')] })]]);
    const { table, s } = await releaseTable(['a'], resumeOf(kind, files));
    const job = { id: 'd-1', schedule: '0 3 * * *', recurring: true, prompt: 'nightly' };
    expect(s.a!.session.status()).toMatchObject({ work: { crons: [job] }, keepAlive: ['background_tasks'] });
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await humanTurn(s.a!, [stop([])]); // the Stop lists no durable job; the file still holds it
    expect(s.a!.session.status().work).toEqual({ crons: [job], unknown: null, descendants: 0 });
    await vi.advanceTimersByTimeAsync(10 * IDLE_MS);
    expect(lifecycle(s.a!)).toBe('ready');
    expect(budgetOf(s.a!)).toMatchObject({ release: null, blocked: [{ appSessionId: 'a', reasons: ['background_tasks'] }] });
    files.set('/p/.claude/scheduled_tasks.json', JSON.stringify({ tasks: [durableJob('someone-else')] })); // CronDelete
    await humanTurn(s.a!, [assistantTool('CronDelete'), stop([], 'stop-2')]);
    expect(s.a!.session.status().work).toEqual({ crons: [], unknown: null, descendants: 0 });
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(lifecycle(s.a!)).toBe('released');
  });

  it('a scheduled-tasks file that exists but cannot be read holds the session until a read succeeds', async () => {
    const files = new Map([['/p/.claude/scheduled_tasks.json', '{"tasks": [']]);
    const { table, s } = await releaseTable(['a'], resumeOf('resumed_after_release', files));
    expect(s.a!.session.status().work).toEqual({ crons: [], unknown: 'durable_unreadable', descendants: 0 });
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(10 * IDLE_MS);
    expect(lifecycle(s.a!)).toBe('ready');
    files.delete('/p/.claude/scheduled_tasks.json');
    await humanTurn(s.a!, [stop([])]);
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(lifecycle(s.a!)).toBe('released');
  });

  // P5 Decision Log 49: the cron record beside the state file bounds a resume's unknown
  it('each Stop and each cron tool writes the cron record', async () => {
    const store = new MemorySessionStateStore();
    const { s } = await releaseTable(['a'], () => ({ session: { store } }));
    await humanTurn(s.a!, [assistantTool('CronCreate')]); // interrupted: no Stop
    expect(await store.loadCronRecord('a' as AppSessionId)).toEqual({ sessionCrons: [], toolSinceStop: true });
    await humanTurn(s.a!, [stop([cron])]);
    expect(await store.loadCronRecord('a' as AppSessionId)).toEqual({ sessionCrons: [cron], toolSinceStop: false });
  });

  it('a failed cron record write fails closed: the record reads as unknown until a write succeeds, and the same Stop is written again once storage recovers', async () => {
    const store = new MemorySessionStateStore();
    const { s } = await releaseTable(['a'], () => ({ session: { store } }));
    await humanTurn(s.a!, [stop([])]);
    expect(await store.loadCronRecord('a' as AppSessionId)).toEqual({ sessionCrons: [], toolSinceStop: false }); // clean on disk
    store.cronRecordWriteError = Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
    await humanTurn(s.a!, [assistantTool('CronCreate'), stop([cron])]);
    expect(s.a!.logs.filter((line) => line.includes('cron record not saved'))).toHaveLength(2); // the tool's and the Stop's
    expect(await store.loadCronRecord('a' as AppSessionId)).toBeNull(); // the older, cleaner record was removed
    // a resume while the record is unconfirmed is unknown, not known-empty
    const resumed = await releaseTable(['a'], () => ({ spec: { resume: { sessionId: RESUMED as never, fork: false }, sessionId: null }, session: { store } }));
    expect(resumed.s.a!.session.status().work).toEqual({ crons: [], unknown: 'resumed', descendants: 0 });
    // storage recovers: the next Stop, identical to the failed one, is written
    store.cronRecordWriteError = null;
    await humanTurn(s.a!, [stop([cron], 'stop-3')]);
    expect(await store.loadCronRecord('a' as AppSessionId)).toEqual({ sessionCrons: [cron], toolSinceStop: false });
  });

  const resumeWithRecord = (record: CronRecord | null) => () => {
    const store = new MemorySessionStateStore();
    if (record !== null) void store.saveCronRecord('a' as AppSessionId, record);
    return { spec: { resume: { sessionId: RESUMED as never, fork: false }, sessionId: null }, session: { store } };
  };

  it('a resume whose record shows no listed cron and no cron tool since starts known and empty, and is released', async () => {
    const { table, s } = await releaseTable(['a'], resumeWithRecord({ sessionCrons: [], toolSinceStop: false }));
    expect(s.a!.session.status().work).toEqual({ crons: [], unknown: null, descendants: 0 });
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(lifecycle(s.a!)).toBe('released');
  });

  it.each<[string, CronRecord | null]>([
    ['a listed session cron', { sessionCrons: [cron], toolSinceStop: false }],
    ['a cron tool since the Stop', { sessionCrons: [], toolSinceStop: true }],
    ['no record', null],
  ])('a resume whose record shows %s holds the session until its first Stop', async (_case, record) => {
    const { table, s } = await releaseTable(['a'], resumeWithRecord(record));
    expect(s.a!.session.status().work).toEqual({ crons: [], unknown: 'resumed', descendants: 0 });
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(10 * IDLE_MS);
    expect(lifecycle(s.a!)).toBe('ready');
  });

  it('a record the state file cannot give (an unreadable file) holds the session too', async () => {
    const store = new MemorySessionStateStore();
    store.loadCronRecord = async () => {
      throw new Error('state file unreadable');
    };
    const { table, s } = await releaseTable(['a'], () => ({ spec: { resume: { sessionId: RESUMED as never, fork: false }, sessionId: null }, session: { store } }));
    expect(s.a!.session.status().work).toEqual({ crons: [], unknown: 'resumed', descendants: 0 });
    expect(s.a!.logs).toContainEqual(expect.stringContaining('cron record not loaded'));
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(10 * IDLE_MS);
    expect(lifecycle(s.a!)).toBe('ready');
  });

  // Branch review: a durable job an id before a /clear created, its lineage lost with an unreadable state file, read
  // through the disk store, its cron record clean. Whichever load finds the file unreadable, the job may be the
  // session's, so the resume stays unknown and is never released.
  it.each([
    ['the keep mark\'s load finds the unreadable state file first', false],
    ['the lineage\'s load finds it first', true],
  ])('a lineage lost with an unreadable state file holds a resume while another id\'s durable job exists (%s)', async (_case, lineageFirst) => {
    const userData = await mkdtemp(join(tmpdir(), 'maws-lineage-'));
    try {
      const store = new FileSessionStateStore(userData, { warn: () => {} });
      await store.saveCronRecord('a' as AppSessionId, { sessionCrons: [], toolSinceStop: false }); // clean: alone it would clear the resume's unknown
      await writeFile(join(userData, 'engine-host', 'state', 'a.json'), '{"version":1,"engineSessionIds":["');
      if (lineageFirst) store.loadKeep = async () => false; // the keep mark read elsewhere: the lineage's load is the first read
      const beforeClear = '66666666-6666-4666-8666-666666666666'; // the id the job keeps after a /clear moved the session on
      const files = new Map([['/p/.claude/scheduled_tasks.json', JSON.stringify({ tasks: [durableJob(beforeClear)] })]]);
      const { table, s } = await releaseTable(['a'], () => ({ spec: resumeOf('resumed', files)().spec, session: { launchKind: 'resumed', scheduledTasksFile: tasksFile(files), store } }));
      expect(s.a!.session.status().work).toEqual({ crons: [], unknown: 'durable_unreadable', descendants: 0 });
      expect(s.a!.logs).toContainEqual(expect.stringContaining('engine session ids not loaded'));
      table.setIdleRelease({ idleMs: IDLE_MS, active: true });
      await humanTurn(s.a!, [stop([])]); // a Stop re-reads the file on the same lost lineage
      expect(s.a!.session.status().work).toEqual({ crons: [], unknown: 'durable_unreadable', descendants: 0 });
      await vi.advanceTimersByTimeAsync(10 * IDLE_MS);
      expect(lifecycle(s.a!)).toBe('ready');
      expect(budgetOf(s.a!)).toMatchObject({ release: null, blocked: [{ appSessionId: 'a' }] });
    } finally {
      await rm(userData, { recursive: true, force: true });
    }
  });

  // P5 O16 M2 (D48): a Stop that carries `background_tasks` reads the tasks too; one without them leaves them unknown
  it('an adopted process holds the session until its tasks and its crons have both been read', async () => {
    const { table, s } = await releaseTable(['a'], () => ({ session: { launchKind: 'adopted' } }));
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    const withoutTasks = stop([]);
    delete (withoutTasks.request.input as { background_tasks?: unknown }).background_tasks;
    await humanTurn(s.a!, [withoutTasks]);
    expect(s.a!.session.status().work).toEqual({ crons: [], unknown: 'adopted', descendants: 0 }); // the tasks are not read yet
    await vi.advanceTimersByTimeAsync(10 * IDLE_MS);
    expect(lifecycle(s.a!)).toBe('ready');
    s.a!.transport.push(tasks([], 'b-1'));
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(lifecycle(s.a!)).toBe('released');
  });

  it('an adopted process\'s Stop with its background_tasks reads both at once (D48)', async () => {
    const { table, s } = await releaseTable(['a'], () => ({ session: { launchKind: 'adopted' } }));
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await humanTurn(s.a!, [stop([])]);
    expect(s.a!.session.status().work).toEqual({ crons: [], unknown: null, descendants: 0 });
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(lifecycle(s.a!)).toBe('released'); // O16 M5: through the reap
  });

  it('interest holds a row; its end (a set without it, or the holder gone) starts the clock', async () => {
    const { table, s } = await releaseTable(['a', 'b']);
    const app = endableClientRef('1');
    table.setInterest(app, ['a', 'b'] as AppSessionId[]);
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(10 * IDLE_MS);
    expect([lifecycle(s.a!), lifecycle(s.b!)]).toEqual(['ready', 'ready']);
    table.setInterest(app, ['b'] as AppSessionId[]); // a's tab closed
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    expect(lifecycle(s.a!)).toBe('ready');
    await vi.advanceTimersByTimeAsync(1);
    expect([lifecycle(s.a!), lifecycle(s.b!)]).toEqual(['released', 'ready']);
    app.end(); // the client's connection ended
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    expect(lifecycle(s.b!)).toBe('ready');
    await vi.advanceTimersByTimeAsync(1);
    expect(lifecycle(s.b!)).toBe('released');
  });

  it('interest is the union of its holders; a holder already gone holds nothing', async () => {
    const { table, s } = await releaseTable(['a']);
    const gone = endableClientRef('old');
    gone.end();
    table.setInterest(gone, ['a'] as AppSessionId[]);
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    const first = endableClientRef('1');
    const second = endableClientRef('2');
    table.setInterest(first, ['a'] as AppSessionId[]);
    table.setInterest(second, ['a'] as AppSessionId[]);
    first.end();
    await vi.advanceTimersByTimeAsync(10 * IDLE_MS);
    expect(lifecycle(s.a!)).toBe('ready');
    table.setInterest(second, []);
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(lifecycle(s.a!)).toBe('released');
  });

  it('a server’s idle time (24 hours) on the same rule; a due time passed while the machine slept releases soon after it wakes', async () => {
    const { table, s } = await releaseTable(['a', 'b']);
    s.b!.session.setKept(true);
    table.setIdleRelease({ idleMs: SERVER_RELEASE_MS, active: true });
    await vi.advanceTimersByTimeAsync(SERVER_RELEASE_MS - 1);
    expect(lifecycle(s.a!)).toBe('ready');
    await vi.advanceTimersByTimeAsync(1);
    expect([lifecycle(s.a!), lifecycle(s.b!)]).toEqual(['released', 'ready']);
    // b's mark clears; then the wall clock jumps past its due time while no timer runs (the machine slept)
    s.b!.session.setKept(false);
    vi.setSystemTime(Date.now() + 2 * SERVER_RELEASE_MS);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lifecycle(s.b!)).toBe('released');
  });

  it('a kept session is never idle-released, though the memory budget may still release it; clearing the mark starts the clock', async () => {
    const { table, s } = await releaseTable(['a']);
    s.a!.session.setKept(true);
    expect(s.a!.session.status()).toMatchObject({ kept: true, keepAlive: [] });
    expect(budgetOf(s.a!)).toMatchObject({ release: 'a' }); // keep exempts the idle release only
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(10 * IDLE_MS);
    expect(lifecycle(s.a!)).toBe('ready');
    s.a!.session.setKept(false);
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    expect(lifecycle(s.a!)).toBe('ready');
    await vi.advanceTimersByTimeAsync(1);
    expect(lifecycle(s.a!)).toBe('released');
  });

  it('under an armed exit-when-idle interest is ignored, its clock starting at the arming, and the keep mark is honoured', async () => {
    const { table, s, logs } = await releaseTable(['a', 'b']);
    table.setInterest(endableClientRef('1'), ['a', 'b'] as AppSessionId[]);
    s.b!.session.setKept(true);
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(5 * IDLE_MS);
    table.setIdleRelease({ idleMs: IDLE_MS, active: true, ignoreInterest: true }); // an old supervisor asked to empty
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    expect(lifecycle(s.a!)).toBe('ready');
    await vi.advanceTimersByTimeAsync(1);
    expect([lifecycle(s.a!), lifecycle(s.b!)]).toEqual(['released', 'ready']);
    expect(logs).toEqual(['idle release of a: idle for 600000 ms with no interest held (exit-when-idle armed: interest ignored)', 'idle reap of a: signalled (no observer was ever seen on the process)']); // O16 M5: the reap's step reads the interest as ignored too
  });
});
// P5 O2 M2 end
