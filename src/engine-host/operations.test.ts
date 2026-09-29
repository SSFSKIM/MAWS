import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { OperationEventSchema, type OperationEvent } from '@shared/engine/operations';
import { MemoryJournal, scriptedTransport, type ScriptedTransport } from './conformance/scripted-transport';
import { OperationTable } from './operations';
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
      respond('side_question', { text: 'because' });
      await vi.advanceTimersByTimeAsync(1);
      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({ appSessionId: APP, opId, command: 'session.sideQuestion', late: true, outcome: { ok: true, value: { text: 'because' } } });
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
