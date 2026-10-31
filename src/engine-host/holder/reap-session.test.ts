// O16 M5: the session's side of the reap (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M5 and Interfaces §F;
// D15): an `idle` reap is `end_session` with the ladder's grace, then one SIGTERM, then a wait, on a path of its own that
// never closes stdin and never sends SIGKILL, so a session whose engine ignored both stays usable and an explicit stop
// afterwards runs the ladder whole; a `budget` reap keeps the ladder. And what the reap reads off the session: its
// status's `reap` and `work.descendants`, the observer's state as unknown work, its lineage for the gate's hello, the
// stdio MCP servers' command lines from `mcp_status`, and the observer seen on this launch kept in the state file.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { handshakeResponder, scriptedSession } from '../conformance/session-harness';
import { LADDER_MS } from '../session-ladder';
import { MemorySessionStateStore } from '../store/memory-session-state-store';
import { REAP_TERM_MS } from './reap';

afterEach(() => {
  vi.useRealTimers();
});

const ready = async (opts: Parameters<typeof scriptedSession>[0] = {}) => {
  const s = scriptedSession({ responder: handshakeResponder({ end_session: () => null }), ...opts });
  await s.session.start();
  return s;
};
const stop = (id: string) => ({ type: 'control_request', request_id: id, request: { subtype: 'hook_callback', callback_id: 'maws_Stop_1', input: { hook_event_name: 'Stop', session_id: 's', stop_hook_active: false, last_assistant_message: 'Done.', background_tasks: [], session_crons: [] } } });
const reapRows = (s: Awaited<ReturnType<typeof ready>>) => s.journal.rows.filter((r) => r.direction === 'meta' && (r.frame as { event?: string }).event === 'reap').map((r) => (r.frame as { phase: string }).phase);

describe('session.reap(idle)', () => {
  it('end_session first, as a stop (idle never goes on the wire); an engine that honours it ends the session as an idle release', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const s = await ready();
    const reaped = s.session.reap('idle');
    expect(s.transport.requestsOf('end_session').map((r) => r.request.reason)).toEqual(['stop']);
    expect(s.session.lifecycle).toBe('ready'); // the reap leaves the process state alone
    s.transport.exit(0);
    expect(await reaped).toBe('exited');
    expect(s.session.status().exit).toMatchObject({ reason: 'idle', release: null });
    expect(s.transport.calls).toEqual([]);
    expect(reapRows(s)).toEqual(['end_session']);
  });

  it('after the grace, one SIGTERM, and no stdin close: an engine that takes the signal exits as an idle release', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const s = await ready();
    const reaped = s.session.reap('idle');
    await vi.advanceTimersByTimeAsync(LADDER_MS.endSession - 1);
    expect(s.transport.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.transport.calls).toEqual(['kill:SIGTERM']);
    s.transport.exit(null, 'SIGTERM');
    expect(await reaped).toBe('exited');
    expect(s.session.status().exit).toMatchObject({ reason: 'idle' });
    expect(reapRows(s)).toEqual(['end_session', 'term']);
  });

  it('both ignored: the session stays ready with stdin open, its work unknown until the next Stop, and it takes a turn', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const s = await ready();
    const reaped = s.session.reap('idle');
    await vi.advanceTimersByTimeAsync(LADDER_MS.endSession + REAP_TERM_MS);
    expect(await reaped).toBe('ignored');
    expect(s.transport.calls).toEqual(['kill:SIGTERM']); // never endInput, never SIGKILL
    expect(reapRows(s)).toEqual(['end_session', 'term', 'term_ignored']);
    expect(s.session.lifecycle).toBe('ready');
    expect(s.session.status().work?.unknown).toBe('reap_term_ignored');
    await s.session.send('still here?');
    await vi.advanceTimersByTimeAsync(0);
    expect(s.transport.writes.some((w) => w.type === 'user')).toBe(true);
    s.transport.push(stop('stop-1'));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.session.status().work?.unknown).toBeNull();
  });

  it('an explicit stop after an ignored reap runs the ladder whole: end_session, stdin closed, SIGTERM, SIGKILL', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const s = await ready();
    const reaped = s.session.reap('idle');
    await vi.advanceTimersByTimeAsync(LADDER_MS.endSession + REAP_TERM_MS);
    expect(await reaped).toBe('ignored');
    const stopped = s.session.stop('stop');
    await vi.advanceTimersByTimeAsync(LADDER_MS.endSession + LADDER_MS.term + LADDER_MS.kill);
    expect(s.transport.requestsOf('end_session')).toHaveLength(2);
    expect(s.transport.calls).toEqual(['kill:SIGTERM', 'endInput', 'kill:SIGTERM', 'kill:SIGKILL']);
    await stopped;
    s.transport.exit(null, 'SIGKILL');
    await s.session.exited;
    expect(s.session.status().exit).toMatchObject({ reason: 'stop' });
  });

  it('an exit after an ignored reap, before the next Stop, is the idle release; after the Stop, an exit is the engine’s own', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const late = await ready();
    const reaped = late.session.reap('idle');
    await vi.advanceTimersByTimeAsync(LADDER_MS.endSession + REAP_TERM_MS);
    await reaped;
    late.transport.exit(0); // the end_session honoured after its turn
    await late.session.exited;
    expect(late.session.status().exit).toMatchObject({ reason: 'idle' });

    const after = await ready();
    const again = after.session.reap('idle');
    await vi.advanceTimersByTimeAsync(LADDER_MS.endSession + REAP_TERM_MS);
    await again;
    after.transport.push(stop('stop-1'));
    await vi.advanceTimersByTimeAsync(0);
    after.transport.exit(1);
    await after.session.exited;
    expect(after.session.status().exit).toMatchObject({ reason: 'crash' });
  });

  it('an explicit stop during the reap takes over; the reap reports the exit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const s = await ready();
    const reaped = s.session.reap('idle');
    const stopped = s.session.stop('archive');
    s.transport.exit(0);
    await stopped;
    expect(await reaped).toBe('exited');
    expect(s.session.status().exit).toMatchObject({ reason: 'archive' });
  });
});

describe('session.reap(budget)', () => {
  it('runs the stop ladder with the budget’s numbers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const s = await ready();
    const reaped = s.session.reap('budget', { limitKiB: 10, totalKiB: 20 });
    expect(s.session.lifecycle).toBe('exiting');
    s.transport.exit(0);
    expect(await reaped).toBe('exited');
    expect(s.session.status().exit).toMatchObject({ reason: 'budget', release: { limitKiB: 10, totalKiB: 20 } });
  });
});

describe('what the reap reads off the session', () => {
  it('the status carries the reap’s view; an unhealthy observer is unknown work', async () => {
    const s = await ready();
    expect(s.session.status().reap).toBeUndefined();
    s.session.noteReap({ state: 'idle', observer: 'healthy' });
    expect(s.session.status().reap).toEqual({ state: 'idle', observer: 'healthy' });
    expect(s.session.status().work?.unknown).toBeNull();
    s.session.noteReap({ state: 'idle', observer: 'unhealthy' });
    expect(s.session.status().work?.unknown).toBe('observer_unhealthy');
    expect(s.session.status().keepAlive).toContain('background_tasks');
  });

  it('work.descendants: the last read under a live pid, 0 before one, null and unknown while unreadable; 0 with no process', async () => {
    const s = await ready();
    expect(s.session.status().work?.descendants).toBe(0);
    s.session.noteDescendants(2);
    expect(s.session.status().work?.descendants).toBe(2);
    expect(s.session.status().keepAlive).toContain('background_tasks');
    s.session.noteDescendants('unreadable');
    expect(s.session.status().work).toMatchObject({ descendants: null, unknown: 'descendants_unreadable' });
    s.session.noteDescendants(0);
    expect(s.session.status().work).toMatchObject({ descendants: 0, unknown: null });
    expect(s.session.status().keepAlive).toEqual([]);
    const unspawned = scriptedSession();
    unspawned.session.noteDescendants(3);
    expect(unspawned.session.status().work?.descendants).toBe(0); // no process, no tree to veto
  });

  it('its lineage: the launch’s pinned id and every id its frames carried', async () => {
    const s = await ready();
    expect([...s.session.engineSessionIds()]).toContain('33333333-3333-4333-8333-333333333333');
    s.transport.push({ type: 'system', subtype: 'init', cwd: '/w', session_id: 'after-clear', tools: [], mcp_servers: [], model: 'm', permissionMode: 'default', slash_commands: [], claude_code_version: '2.1.316', output_style: 'default', uuid: 'i-1' });
    await new Promise((r) => setImmediate(r));
    expect(s.session.engineSessionIds().has('after-clear')).toBe(true);
  });

  it('the stdio MCP servers’ command lines, from one mcp_status read (concurrent asks share it; a failure is asked again later)', async () => {
    const servers = [
      { name: 'a', status: 'connected', config: { type: 'stdio', command: '/usr/bin/node', args: ['/tmp/a.mjs', 'user'] } },
      { name: 'b', status: 'pending', config: { type: 'stdio', command: 'uvx', args: [] } },
      { name: 'c', status: 'connected', config: { type: 'http', url: 'https://x' } },
      { name: 'maws', status: 'connected', config: { type: 'sdk' } },
    ];
    let fail = true;
    const s = await ready({ responder: handshakeResponder({ mcp_status: () => (fail ? { error: 'not now' } : { response: { mcpServers: servers } }) }) });
    expect(s.session.mcpCommands()).toBeNull();
    await s.session.readMcpCommands();
    expect(s.session.mcpCommands()).toBeNull();
    fail = false;
    await Promise.all([s.session.readMcpCommands(), s.session.readMcpCommands()]);
    expect(s.transport.requestsOf('mcp_status')).toHaveLength(2);
    expect(s.session.mcpCommands()).toEqual([['/usr/bin/node', '/tmp/a.mjs', 'user'], ['uvx']]);
    await s.session.readMcpCommands();
    expect(s.transport.requestsOf('mcp_status')).toHaveLength(2); // once read, never again for the launch
  });

  it('D52: a `#!` server is registered as the kernel runs it, resolved through the launch’s PATH, never the host’s', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maws-reap-argv-'));
    const hostPath = process.env.PATH;
    try {
      writeFileSync(join(dir, 'o16-script'), '#!/usr/bin/env node\n');
      writeFileSync(join(dir, 'o16-host-only'), '#!/bin/sh\n');
      chmodSync(join(dir, 'o16-script'), 0o755);
      chmodSync(join(dir, 'o16-host-only'), 0o755);
      process.env.PATH = `${dir}:${hostPath ?? ''}`; // the host's PATH finds it; the launch's (the harness's /usr/bin) does not
      const servers = [
        { name: 'a', status: 'connected', config: { type: 'stdio', command: join(dir, 'o16-script'), args: ['--stdio'] } },
        { name: 'b', status: 'connected', config: { type: 'stdio', command: 'o16-host-only', args: [] } },
      ];
      const s = await ready({ responder: handshakeResponder({ mcp_status: () => ({ response: { mcpServers: servers } }) }) });
      await s.session.readMcpCommands();
      expect(s.session.mcpCommands()).toEqual([['node', join(dir, 'o16-script'), '--stdio'], ['o16-host-only']]);
    } finally {
      process.env.PATH = hostPath;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the first observer seen on the launch is kept in the state file as observerSeenLaunch', async () => {
    const store = new MemorySessionStateStore();
    const s = await ready({ session: { store } });
    expect(await store.loadObserverSeen('app-s' as AppSessionId)).toBeNull();
    s.session.observerSeen();
    await vi.waitFor(async () => expect(await store.loadObserverSeen('app-s' as AppSessionId)).toBe(s.session.status().launchId));
  });
});
