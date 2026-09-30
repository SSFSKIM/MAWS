import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import { handshakeResponder, scriptedSession } from './conformance/session-harness';
import { parsePsTree, ProcessTable } from './process-table';
import { EngineSession } from './session';

const flush = () => new Promise((r) => setImmediate(r));

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
