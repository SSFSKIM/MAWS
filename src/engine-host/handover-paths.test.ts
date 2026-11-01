// P5 O16 M3b fix wave 2 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3; Interfaces §D): the handover and the
// deliberate stops that meet it, through the engine host's own request path: the `host.*` commands Supervision registers,
// over a real ProcessTable whose hosted rows are scripted sessions under a session host, with the exit order wired as the
// detached entry wires it (detached.ts: a stop-all's exit stops, every other exit detaches).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { handshakeResponder, scriptedSession } from './conformance/session-harness';
import { REAP_TERM_MS } from './holder/reap';
import { ProcessTable } from './process-table';
import { LADDER_MS } from './session-ladder';
import { Supervision, type SupervisorExit } from './supervision';

afterEach(() => {
  vi.useRealTimers();
});

const IDENTITY = { pid: 1, startedAt: '2026-10-31T00:00:00.000Z', buildId: 'b', protocol: 3, wire: 'w', socketPath: '/s', logPath: '/l' };
const EXIT_GRACE_MS = 3_000; // detached.ts's

// The engine host's request path over `ids`, each a hosted row; `end` scripts how each engine answers end_session.
async function engineHost(ids: string[], opts: { endSession?: (id: string) => void } = {}) {
  const table = new ProcessTable({ ps: async () => '' });
  const rows = ids.map((id, i) => {
    const run = scriptedSession({
      spec: { appSessionId: id as AppSessionId },
      transport: { holder: { pid: 4100 + i, holderId: `L-${id}`, fence: 1 } },
      responder: handshakeResponder({
        end_session: () => {
          opts.endSession?.(id);
          return null;
        },
      }),
    });
    table.reserve(id as AppSessionId, () => run.session);
    return run;
  });
  for (const row of rows) await row.session.start();
  const exits: SupervisorExit[] = [];
  const exitOrders: Promise<unknown>[] = [];
  const supervision = new Supervision({
    mode: 'detached', identity: IDENTITY, table, role: 'laptop', log: () => {},
    plugins: { busy: () => false, onIdle: () => () => {}, onBusy: () => () => {} },
    shutdown: (graceMs) => table.shutdown({ graceMs }),
    emit: () => true,
  });
  const commands = new Map<string, (input: unknown) => Promise<unknown>>();
  supervision.register((name, handler) => void commands.set(name, handler as (input: unknown) => Promise<unknown>), { onConnect: () => {} });
  supervision.started(IDENTITY, (reason) => {
    exits.push(reason);
    exitOrders.push(table.shutdown({ graceMs: EXIT_GRACE_MS, mode: reason === 'stopAll' ? 'stop' : 'detach' }));
  });
  supervision.clientChanged(true);
  const call = (name: string, input: unknown) => commands.get(name)!(input);
  return { table, rows, supervision, exits, exitOrders, call };
}

describe('an ignored idle reap, then the handover', () => {
  // fix wave 2 (#3): a reap whose end_session and SIGTERM were both ignored keeps its reason (`idle`) for a later exit,
  // but nothing is ending: the row is frozen and detached like any other, never laddered by the exit order
  it('the row is frozen and detached with the final ack: no second end_session, no stdin close, no SIGKILL', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'Date'] });
    const host = await engineHost(['app-reaped']);
    const [row] = host.rows as [typeof host.rows[0]];
    const reaped = row.session.reap('idle');
    await vi.advanceTimersByTimeAsync(LADDER_MS.endSession + REAP_TERM_MS);
    expect(await reaped).toBe('ignored');
    expect(row.transport.calls).toEqual(['kill:SIGTERM']);

    const answer = host.call('host.handover', { graceMs: 1_000 });
    expect(await answer).toEqual({ state: 'detaching' });
    await vi.advanceTimersByTimeAsync(EXIT_GRACE_MS + LADDER_MS.term + LADDER_MS.kill);
    await Promise.all(host.exitOrders);
    expect(host.exits).toEqual(['handover']);
    expect(row.transport.calls).toEqual(['kill:SIGTERM', 'detach:ack']); // the reap's one signal, then the detach
    expect(row.transport.requestsOf('end_session')).toHaveLength(1); // the reap's
    expect(row.session.lifecycle).toBe('ready'); // the engine runs on for the successor
  });
});

// fix wave 3 (#2): a handover asked while an idle reap waits for its verdict does not upgrade the reap to the quit
// ladder: the reap runs its own path (its end_session, its one SIGTERM, its wait), and an engine that ignored both is
// then frozen and detached for the successor
describe('a handover during an idle reap', () => {
  it('waits for the reap’s verdict; an engine that ignored it is detached: no stdin close, no SIGKILL, one end_session', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'Date'] });
    const host = await engineHost(['app-reaping']);
    const [row] = host.rows as [typeof host.rows[0]];
    const reaped = row.session.reap('idle');
    await vi.advanceTimersByTimeAsync(LADDER_MS.endSession / 2); // its grace still pending
    const answer = host.call('host.handover', { graceMs: 60_000 });
    await vi.advanceTimersByTimeAsync(LADDER_MS.endSession + REAP_TERM_MS);
    expect(await reaped).toBe('ignored');
    expect(await answer).toEqual({ state: 'detaching' });
    await vi.advanceTimersByTimeAsync(EXIT_GRACE_MS + LADDER_MS.term + LADDER_MS.kill);
    await Promise.all(host.exitOrders);
    expect(host.exits).toEqual(['handover']);
    expect(row.transport.calls).toEqual(['kill:SIGTERM', 'detach:ack']); // the reap's own signal, then the detach
    expect(row.transport.requestsOf('end_session')).toHaveLength(1);
    expect(row.session.lifecycle).toBe('ready');
  });
});

// fix wave 2 (#2, Interfaces §D: a stop-all stays deliberate): a stop-all that reaches the draining host takes every
// frozen row back and stops it through the ladder, and the host's exit is the stop-all's; once the drain has settled the
// rows are the successor's, and a stop-all is refused rather than answered as if it had stopped them
describe('a stop-all and the drain', () => {
  const showPane = (row: Awaited<ReturnType<typeof engineHost>>['rows'][number]) =>
    row.transport.push({ type: 'control_request', request_id: 'mcp-1', request: { subtype: 'mcp_message', server_name: 'maws', message: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'show_pane', arguments: { pane: 'terminal' }, _meta: { 'claudecode/toolUseId': 'toolu_1' } } } } });
  const until = async (check: () => boolean, what: string, ms = 5_000) => {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  it('during a deferral: every frozen row stopped through the ladder, the engines exit, nothing detached, the exit is the stop-all’s', async () => {
    const host = await engineHost(['app-a', 'app-b'], { endSession: (id) => void setTimeout(() => host.rows.find((row) => row.session.status().appSessionId === id)!.transport.exit(0), 0) });
    const [a, b] = host.rows as [typeof host.rows[0], typeof host.rows[0]];
    showPane(a);
    await until(() => a.session.inFlightThroughDelivery() === 1, 'the call in flight');
    expect(await host.call('host.handover', { graceMs: 50 })).toEqual({ state: 'deferred', inFlight: 1 });
    expect(await host.call('host.stopAll', { graceMs: 5_000 })).toEqual({ stopped: 2, forced: 0 });
    for (const row of [a, b]) {
      expect(row.session.lifecycle).toBe('exited');
      expect(row.session.status().exit).toMatchObject({ reason: 'quit' });
      expect(row.transport.calls).not.toContain('detach:ack');
    }
    await until(() => host.exits.length > 0, 'the exit order');
    expect(host.exits).toEqual(['stopAll']);
  });

  it('once the drain has settled: refused host_unavailable, the rows detached and their engines running for the successor', async () => {
    const host = await engineHost(['app-a']);
    const [a] = host.rows as [typeof host.rows[0]];
    expect(await host.call('host.handover', { graceMs: 50 })).toEqual({ state: 'detaching' });
    await expect(host.call('host.stopAll', { graceMs: 5_000 })).rejects.toMatchObject({ ipcError: { code: 'host_unavailable' } });
    await until(() => a.transport.calls.includes('detach:ack'), 'the detach');
    expect(a.session.lifecycle).toBe('ready');
    expect(a.transport.requestsOf('end_session')).toEqual([]);
    await until(() => host.exits.length > 0, 'the exit order');
    expect(host.exits).toEqual(['handover']);
  });
});
