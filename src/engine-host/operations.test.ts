import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { OperationEventSchema, OperationOutcomeSchema, type OperationEvent } from '@shared/engine/operations';
import { MemoryJournal, scriptedTransport, type ScriptedTransport } from './conformance/scripted-transport';
import { OPERATION_KEPT_MS, OPERATIONS_KEPT, OperationTable } from './operations';
import { ControlClient, LATE_TABLE_MS, REQUEST_TIMEOUT_MS } from './rpc';

const APP = 'app-op' as AppSessionId;

function setup(opts: Parameters<typeof scriptedTransport>[0] = {}) {
  const transport: ScriptedTransport = scriptedTransport(opts);
  const client = new ControlClient(transport, new MemoryJournal(), 'LAUNCHOP', { warn: () => {} });
  transport.frames[Symbol.asyncIterator](); // nothing reads the frames here: responses are fed to the client below
  const events: OperationEvent[] = [];
  const table = new OperationTable((event) => events.push(OperationEventSchema.parse(event)));
  const respond = (subtype: string, response: unknown, error?: string) => {
    const request = transport.requestsOf(subtype).at(-1)!;
    client.observe({ type: 'control_response', response: error === undefined ? { subtype: 'success', request_id: request.request_id, response } : { subtype: 'error', request_id: request.request_id, error, error_code: 'engine_said_no' } });
  };
  return { transport, client, table, events, respond };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('x2 deadlines fit the bridge', () => {
  describe('operations answer a receipt at the flushed write and complete through session.operation', () => {
    it('receipt { opId } = the minted request id at the write; the completion carries the typed value once', async () => {
      const { table, events, respond, transport, client } = setup();
      const { opId } = await table.start(APP, 'session.generateTitle', client, 'generate_session_title', { description: 'Protocol probe', persist: false });
      expect(opId).toBe('LAUNCHOP-1');
      expect(transport.requestsOf('generate_session_title')[0]).toMatchObject({ request_id: 'LAUNCHOP-1', request: { description: 'Protocol probe', persist: false } });
      expect(events).toEqual([]);
      respond('generate_session_title', { title: 'Protocol probe' });
      await vi.advanceTimersByTimeAsync(1);
      expect(events).toEqual([{ appSessionId: APP, opId, command: 'session.generateTitle', late: false, outcome: { ok: true, value: { title: 'Protocol probe' } } }]);
    });

    it('a response released by writer idle still answers the receipt before a correlated completion', async () => {
      const { table, events, respond, client } = setup();
      client.writer.onIdle(() => respond('generate_session_title', { title: 'Already answered' }));
      let receipt: { opId: string } | undefined;
      void table.start(APP, 'session.generateTitle', client, 'generate_session_title', { description: 'fast', persist: false })
        .then((value) => { receipt = value; });
      // Drain the write and response continuations, but not the completion's macrotask.
      for (let i = 0; i < 10; i++) await Promise.resolve();
      expect(receipt).toEqual({ opId: 'LAUNCHOP-1' });
      expect(events).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(events).toEqual([{ appSessionId: APP, opId: receipt!.opId, command: 'session.generateTitle', late: false, outcome: { ok: true, value: { title: 'Already answered' } } }]);
    });

    it('the MCP commands complete with value null; an engine error completes engine_error with its code', async () => {
      const { table, events, respond, client } = setup();
      const toggle = await table.start(APP, 'session.mcpToggle', client, 'mcp_toggle', { serverName: 'github', enabled: false });
      respond('mcp_toggle', undefined);
      const reconnect = await table.start(APP, 'session.mcpReconnect', client, 'mcp_reconnect', { serverName: 'github' });
      respond('mcp_reconnect', undefined, 'server github is not configured');
      await vi.advanceTimersByTimeAsync(1);
      expect(events).toEqual([
        { appSessionId: APP, opId: toggle.opId, command: 'session.mcpToggle', late: false, outcome: { ok: true, value: null } },
        { appSessionId: APP, opId: reconnect.opId, command: 'session.mcpReconnect', late: false, outcome: { ok: false, error: { code: 'engine_error', message: 'server github is not configured', engineCode: 'engine_said_no' } } },
      ]);
    });

    it('a response 20 s after the long deadline emits twice: timeout, then ok with late: true', async () => {
      const { table, events, respond, client } = setup();
      const { opId } = await table.start(APP, 'session.sideQuestion', client, 'side_question', { question: 'why?' });
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS.long);
      await vi.advanceTimersByTimeAsync(1); // the completion's macrotask
      expect(events).toEqual([{ appSessionId: APP, opId, command: 'session.sideQuestion', late: false, outcome: { ok: false, error: { code: 'timeout', message: 'side_question unanswered after 120 s', engineCode: null } } }]);
      await vi.advanceTimersByTimeAsync(20_000);
      respond('side_question', { response: 'because', synthetic: false });
      await vi.advanceTimersByTimeAsync(1);
      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({ appSessionId: APP, opId, command: 'session.sideQuestion', late: true, outcome: { ok: true, value: { response: 'because', synthetic: false } } });
    });

    it('a late error and an answer after the late table add nothing', async () => {
      const { table, events, respond, client } = setup();
      await table.start(APP, 'session.sideQuestion', client, 'side_question', { question: 'a' });
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS.long);
      respond('side_question', undefined, 'too late and wrong');
      await table.start(APP, 'session.reloadPlugins', client, 'reload_plugins', {});
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS.long + LATE_TABLE_MS + 1);
      respond('reload_plugins', {});
      await vi.advanceTimersByTimeAsync(1);
      expect(events.map((e) => [e.command, e.late, e.outcome.ok])).toEqual([
        ['session.sideQuestion', false, false],
        ['session.reloadPlugins', false, false],
      ]);
    });

    it('a process exit with one operation open completes it exited', async () => {
      const { table, events, client } = setup();
      const { opId } = await table.start(APP, 'session.reloadPlugins', client, 'reload_plugins', {});
      client.close('the process exited');
      await vi.advanceTimersByTimeAsync(1);
      expect(events).toEqual([{ appSessionId: APP, opId, command: 'session.reloadPlugins', late: false, outcome: { ok: false, error: { code: 'exited', message: 'reload_plugins unanswered: the process exited', engineCode: null } } }]);
    });

    it('a write that fails still answers a receipt, then completes write_failed; a closed client completes exited', async () => {
      const { table, events, client } = setup({ failWrites: true });
      const { opId } = await table.start(APP, 'session.generateTitle', client, 'generate_session_title', { description: 'x', persist: true });
      expect(events).toEqual([]); // the completion follows the receipt, never precedes it
      await vi.advanceTimersByTimeAsync(1);
      expect(events).toEqual([{ appSessionId: APP, opId, command: 'session.generateTitle', late: false, outcome: { ok: false, error: { code: 'write_failed', message: expect.stringContaining('not written'), engineCode: null } } }]);

      const closed = setup();
      closed.client.close('the process exited');
      const receipt = await closed.table.start(APP, 'session.mcpToggle', closed.client, 'mcp_toggle', { serverName: 's', enabled: true });
      await vi.advanceTimersByTimeAsync(1);
      expect(closed.events).toMatchObject([{ opId: receipt.opId, outcome: { ok: false, error: { code: 'exited' } } }]);
    });
  });
});

// P5 O7 M8 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, *Operations and panel events*; §U): a waiter that
// lost its completion (a channel dropped between the receipt and the completion) asks `session.operations` for its opIds:
// each is its completion while the table keeps it (at most OPERATIONS_KEPT a session, for OPERATION_KEPT_MS), `pending`
// while it runs, and `unknown` otherwise, another session's op included.
describe('operation outcomes kept by opId', () => {
  it('answers a completed op its event, a running one pending, and any other unknown, another session’s op included', async () => {
    const { table, respond, client } = setup();
    const done = await table.start(APP, 'session.generateTitle', client, 'generate_session_title', { description: 'one', persist: false });
    respond('generate_session_title', { title: 'one' });
    const running = await table.start(APP, 'session.reloadPlugins', client, 'reload_plugins', {});
    const other = await table.start('app-other' as AppSessionId, 'session.mcpToggle', client, 'mcp_toggle', { serverName: 's', enabled: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(table.outcomes(APP, [done.opId, running.opId, other.opId, 'never-minted'])).toEqual([
      { opId: done.opId, event: { appSessionId: APP, opId: done.opId, command: 'session.generateTitle', late: false, outcome: { ok: true, value: { title: 'one' } } } },
      { opId: running.opId, pending: true },
      { opId: other.opId, unknown: true },
      { opId: 'never-minted', unknown: true },
    ]);
    expect(table.outcomes('app-other' as AppSessionId, [other.opId])).toEqual([{ opId: other.opId, pending: true }]);
  });

  it('answers pending from the receipt until the completion goes out, then the completion', async () => {
    const { table, events, respond, client } = setup();
    const { opId } = await table.start(APP, 'session.sideQuestion', client, 'side_question', { question: 'why?' });
    expect(table.outcomes(APP, [opId])).toEqual([{ opId, pending: true }]);
    respond('side_question', { response: 'because', synthetic: false });
    await Promise.resolve();
    expect(events).toEqual([]);
    expect(table.outcomes(APP, [opId])).toEqual([{ opId, pending: true }]); // the completion not out yet: never ahead of it
    await vi.advanceTimersByTimeAsync(1);
    expect(table.outcomes(APP, [opId])).toEqual([{ opId, event: events[0] }]);
  });

  it('keeps a late success in place of the timeout it reconciles', async () => {
    const { table, events, respond, client } = setup();
    const { opId } = await table.start(APP, 'session.sideQuestion', client, 'side_question', { question: 'why?' });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS.long + 1);
    expect(table.outcomes(APP, [opId])).toEqual([{ opId, event: events[0] }]);
    expect(events[0].outcome.ok).toBe(false);
    respond('side_question', { response: 'because', synthetic: false });
    await vi.advanceTimersByTimeAsync(1);
    expect(table.outcomes(APP, [opId])).toEqual([{ opId, event: events[1] }]);
    expect(events[1]).toMatchObject({ late: true, outcome: { ok: true } });
  });

  it(`keeps at most ${OPERATIONS_KEPT} completions a session, the oldest going first`, async () => {
    const { table, respond, client } = setup();
    const ids: string[] = [];
    for (let i = 0; i <= OPERATIONS_KEPT; i++) {
      ids.push((await table.start(APP, 'session.generateTitle', client, 'generate_session_title', { description: `t${i}`, persist: false })).opId);
      respond('generate_session_title', { title: `t${i}` });
      await vi.advanceTimersByTimeAsync(1);
    }
    const answers = table.outcomes(APP, ids);
    expect(answers[0]).toEqual({ opId: ids[0], unknown: true });
    expect(answers.slice(1).every((answer) => 'event' in answer)).toBe(true);
    // another session's completions are its own count
    const other = await table.start('app-other' as AppSessionId, 'session.generateTitle', client, 'generate_session_title', { description: 'x', persist: false });
    respond('generate_session_title', { title: 'x' });
    await vi.advanceTimersByTimeAsync(1);
    expect('event' in table.outcomes('app-other' as AppSessionId, [other.opId])[0]).toBe(true);
    expect('event' in table.outcomes(APP, [ids[1]])[0]).toBe(true);
  });

  it('forgets a completion 10 minutes after it went out', async () => {
    const { table, respond, client } = setup();
    const { opId } = await table.start(APP, 'session.generateTitle', client, 'generate_session_title', { description: 'one', persist: false });
    respond('generate_session_title', { title: 'one' });
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(OPERATION_KEPT_MS - 1_000);
    expect('event' in table.outcomes(APP, [opId])[0]).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(table.outcomes(APP, [opId])).toEqual([{ opId, unknown: true }]);
    expect(OPERATION_KEPT_MS).toBe(10 * 60_000);
  });

  it('answers each a schema-valid outcome', async () => {
    const { table, respond, client } = setup();
    const { opId } = await table.start(APP, 'session.generateTitle', client, 'generate_session_title', { description: 'one', persist: false });
    respond('generate_session_title', { title: 'one' });
    await vi.advanceTimersByTimeAsync(1);
    for (const answer of table.outcomes(APP, [opId, 'x'])) expect(OperationOutcomeSchema.safeParse(answer).success).toBe(true);
  });
});
