// O16 M5: the session's side of the reap (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M5 and Interfaces §F;
// D15): an `idle` reap is `end_session` with the ladder's grace, then one SIGTERM, then a wait, on a path of its own that
// never closes stdin and never sends SIGKILL, so a session whose engine ignored both stays usable and an explicit stop
// afterwards runs the ladder whole; a `budget` reap keeps the ladder. And what the reap reads off the session: its
// status's `reap` and `work.descendants`, the observer's state as unknown work, its lineage for the gate's hello, the
// stdio MCP servers' command lines from `mcp_status`, and the observer seen on this launch kept in the state file. D69:
// with an observer, no SIGTERM goes in without a confirmed live lease at its instant; the reap re-arms for one when it
// holds none, and withholds the SIGTERM when no armed confirms it.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { handshakeResponder, scriptedSession } from '../conformance/session-harness';
import { LADDER_MS } from '../session-ladder';
import { MemorySessionStateStore } from '../store/memory-session-state-store';
import { FakeObserver } from './fake-observer';
import { Gate } from './gate';
import { LEASE_MARGIN_MS, LEASE_MS, Reap, REAP_TERM_MS, type ReapReason } from './reap';

afterEach(() => {
  vi.useRealTimers();
});

const ready = async (opts: Parameters<typeof scriptedSession>[0] = {}) => {
  const s = scriptedSession({ responder: handshakeResponder({ end_session: () => null }), ...opts });
  await s.session.start();
  return s;
};
const stop = (id: string) => ({ type: 'control_request', request_id: id, request: { subtype: 'hook_callback', callback_id: 'maws_Stop_1', input: { hook_event_name: 'Stop', session_id: 's', stop_hook_active: false, last_assistant_message: 'Done.', background_tasks: [], session_crons: [] } } });
// An engine-started turn: the main lane's init opens one (normalizer.ts), as a peer delivery's or a cron's would.
const ENGINE_TURN = { type: 'system', subtype: 'init', cwd: '/w', session_id: 's', tools: [], mcp_servers: [], model: 'm', permissionMode: 'auto', slash_commands: [], claude_code_version: '2.1.283', output_style: 'default', uuid: 'i-turn' };
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
    const reaped = s.session.reap('budget', { release: { limitKiB: 10, totalKiB: 20 } });
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

// D69, on fake timers over the real gate socket, at production timings: the session's idle reap and its row's Reap wired
// as the process table wires them. The observer answers the first arm late (7 s, inside the lease less its margin), so
// the step signals at 7 s, the renewal is due at 9 s (the arm's lease less its margin) and the SIGTERM at 10 s (the
// end_session grace). Date, performance and the timers are faked; setImmediate and process.hrtime stay real, so the
// socket's I/O runs between the steps of `pass`.
describe('the SIGTERM under the lease (D69)', () => {
  const FAKE = { toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] } as const;
  const settle = async (check: () => boolean, what: string, ms = 2_000) => {
    const end = process.hrtime.bigint() + BigInt(ms) * 1_000_000n;
    while (!check()) {
      if (process.hrtime.bigint() > end) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setImmediate(r));
    }
  };
  const drain = (ms = 5) => settle(() => false, 'nothing', ms).catch(() => {});
  const pass = async (ms: number) => {
    for (let left = ms; left > 0; left -= 250) {
      await vi.advanceTimersByTimeAsync(Math.min(250, left));
      await drain();
    }
  };
  let dir: string;
  let gate: Gate;
  let at: string;
  const observers: FakeObserver[] = [];
  beforeEach(async () => {
    vi.useFakeTimers(FAKE);
    dir = mkdtempSync(join(tmpdir(), 'maws-reap-lease-'));
    at = join(dir, 'supervisor', 'gate.sock');
    gate = new Gate({ log: () => {} });
    await gate.listen(at);
  });
  afterEach(async () => {
    vi.useRealTimers();
    for (const o of observers.splice(0)) if (!o.isClosed) await o.close();
    await gate.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function wired() {
    const s = await ready();
    const channel = gate.channel({ lineage: () => s.session.engineSessionIds(), pid: () => s.session.pid });
    const w = { verdict: null as Promise<'exited' | 'ignored' | 'withheld'> | null, logs: [] as string[], cancelled: [] as ReapReason[] };
    const reap = new Reap('app-s', {
      gate: channel, current: () => s.session.status(), stateful: () => new Set(), interest: () => false, descendants: () => 0,
      reap: (_reason, mayTerm) => (w.verdict = s.session.reap('idle', { mayTerm })), // process-table.ts's wiring for an idle reap
      now: () => Date.now(), log: (line) => void w.logs.push(line), cancelled: (reason) => void w.cancelled.push(reason), ignored: () => {},
      changed: (view) => s.session.noteReap(view),
    });
    const o = await FakeObserver.connect(at);
    observers.push(o);
    o.hello(s.session.status().engineSessionId!, { pid: s.session.pid });
    await o.next('welcome');
    o.beat(5_000); // the bridge's heartbeat, throughout
    reap.due('idle');
    expect(await o.next('arm')).toEqual({ t: 'arm', fence: 1, leaseMs: LEASE_MS });
    await pass(7_000);
    o.send({ t: 'armed', fence: 1 });
    await settle(() => s.transport.requestsOf('end_session').length === 1, 'the step’s end_session');
    expect(reap.state).toBe('signalled');
    await pass(LEASE_MS - LEASE_MARGIN_MS - 7_000); // 9 s: the renewal
    expect(await o.next('arm')).toEqual({ t: 'arm', fence: 1, leaseMs: LEASE_MS });
    return Object.assign(w, { s, reap, o });
  }
  const arms = (o: FakeObserver) => o.pending().filter((f) => f.t === 'arm');

  it('the renewal answered, the SIGTERM goes in at its due time with no re-arm', async () => {
    const w = await wired();
    w.o.send({ t: 'armed', fence: 1 });
    await pass(LADDER_MS.endSession - 2_000); // 10 s
    expect(w.s.transport.calls).toEqual(['kill:SIGTERM']);
    expect(arms(w.o)).toEqual([]);
    w.s.transport.exit(null, 'SIGTERM');
    expect(await w.verdict).toBe('exited');
    expect(reapRows(w.s)).toEqual(['end_session', 'term']);
  });

  it('the renewal unanswered, the SIGTERM is withheld: re-armed, no armed within the lease less its margin, the reap ends idle with the fence disarmed', async () => {
    const w = await wired();
    await pass(LADDER_MS.endSession - 2_000); // 10 s: the SIGTERM is due, the latest arm unconfirmed
    expect(await w.o.next('arm')).toEqual({ t: 'arm', fence: 1, leaseMs: LEASE_MS }); // the re-arm
    expect(w.s.transport.calls).toEqual([]);
    expect(w.reap.state).toBe('signalled'); // a turn asked meanwhile is still told stop
    await pass(LEASE_MS - LEASE_MARGIN_MS - 250);
    expect(w.s.transport.calls).toEqual([]);
    await pass(250);
    expect(await w.o.next('disarm')).toEqual({ t: 'disarm', fence: 1 });
    expect(await w.verdict).toBe('withheld');
    expect(w.s.transport.calls).toEqual([]); // no SIGTERM, ever, and stdin stays open
    expect(w.reap.state).toBe('idle');
    expect(w.cancelled).toEqual(['idle']); // the row's clock restarts
    expect(w.logs.some((l) => /no SIGTERM/.test(l))).toBe(true);
    expect(reapRows(w.s)).toEqual(['end_session', 'term_withheld']);
    expect(w.s.session.lifecycle).toBe('ready');
    expect(w.s.session.status().work?.unknown).toBeNull(); // the observer is healthy: nothing unknown
    w.o.send({ t: 'turn', fence: 1, origin: 'query' }); // the fence is disarmed: a turn proceeds
    expect(await w.o.next('proceed')).toEqual({ t: 'proceed', fence: 1 });
  });

  it('an armed answering the earlier renewal does not confirm the re-arm; the re-arm’s own armed does, and the SIGTERM goes in', async () => {
    const w = await wired();
    await pass(LADDER_MS.endSession - 2_000); // 10 s: re-armed with the renewal still unanswered
    await w.o.next('arm');
    w.o.send({ t: 'armed', fence: 1 }); // answers the renewal, the older of the two in flight
    await pass(1_000);
    expect(w.s.transport.calls).toEqual([]);
    w.o.send({ t: 'armed', fence: 1 }); // answers the re-arm
    await settle(() => w.s.transport.calls.length === 1, 'the SIGTERM');
    expect(w.s.transport.calls).toEqual(['kill:SIGTERM']);
    w.s.transport.exit(null, 'SIGTERM');
    expect(await w.verdict).toBe('exited');
  });

  // D69: a lease proves the observer listening, not that no turn runs: the host's own turn state is the SIGTERM's last read
  it('a turn admitted while the lease had lapsed, the re-arm then answered: the host’s own status shows the turn and the SIGTERM is withheld', async () => {
    const w = await wired(); // the renewal unanswered: by the observer's clock its lease may run out
    await pass(LADDER_MS.endSession - 2_000); // 10 s: re-armed
    await w.o.next('arm');
    w.s.transport.push(ENGINE_TURN); // the engine starts a turn the lapsed fence did not hold
    await drain();
    expect(w.s.session.status().turn).not.toBeNull();
    w.o.send({ t: 'armed', fence: 1 }); // the renewal's
    w.o.send({ t: 'armed', fence: 1 }); // the re-arm's: the lease is confirmed
    expect(await w.o.next('disarm')).toEqual({ t: 'disarm', fence: 1 });
    expect(await w.verdict).toBe('withheld');
    expect(w.s.transport.calls).toEqual([]);
    expect(w.logs.some((l) => /no SIGTERM: a turn is under way/.test(l))).toBe(true);
    expect(reapRows(w.s)).toEqual(['end_session', 'term_withheld']);
  });

  it('with no observer ever seen there is no fence, but a turn under way at the SIGTERM still withholds it', async () => {
    const s = await ready();
    const channel = gate.channel({ lineage: () => s.session.engineSessionIds(), pid: () => s.session.pid });
    let verdict: Promise<'exited' | 'ignored' | 'withheld'> | null = null;
    const cancelled: ReapReason[] = [];
    const reap = new Reap('app-s', {
      gate: channel, current: () => s.session.status(), stateful: () => new Set(), interest: () => false, descendants: () => 0,
      reap: (_reason, mayTerm) => (verdict = s.session.reap('idle', { mayTerm })),
      now: () => Date.now(), log: () => {}, cancelled: (reason) => void cancelled.push(reason), ignored: () => {}, changed: (view) => s.session.noteReap(view),
    });
    expect(reap.observer).toBe('absent');
    reap.due('idle');
    expect(s.transport.requestsOf('end_session')).toHaveLength(1);
    s.transport.push(ENGINE_TURN);
    await pass(LADDER_MS.endSession);
    expect(await verdict).toBe('withheld');
    expect(s.transport.calls).toEqual([]);
    expect([reap.state, cancelled]).toEqual(['idle', ['idle']]);
  });

  it('a reap disposed while it awaits the re-arm’s armed (its row handed over) withholds the SIGTERM at once', async () => {
    const w = await wired();
    await pass(LADDER_MS.endSession - 2_000);
    await w.o.next('arm');
    w.reap.dispose();
    expect(await w.verdict).toBe('withheld');
    expect(w.s.transport.calls).toEqual([]);
  });
});
