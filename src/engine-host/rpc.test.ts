import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JournalRow } from '@shared/wire/journal';
import type { StdinFrame } from '@shared/wire/frames';
import { ControlCancelled, ControlClient, ControlError, ControlTimeout, REQUEST_TIMEOUT_MS } from './rpc';
import type { EngineTransport } from './transport';

// A transport that records writes and never produces frames on its own; the test feeds frames through `observe`.
function fakeTransport(opts: { failWrites?: boolean } = {}) {
  const writes: StdinFrame[] = [];
  let resolveExited!: (v: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((r) => (resolveExited = r));
  const transport: EngineTransport = {
    pid: null,
    frames: (async function* () {})(),
    stderr: (async function* () {})(),
    write: (frame) => {
      if (opts.failWrites) return Promise.reject(new Error('EPIPE'));
      writes.push(frame);
      return Promise.resolve();
    },
    endInput: () => {},
    kill: () => {},
    exited,
  };
  return { transport, writes, exit: resolveExited };
}

function fakeJournal() {
  const rows: JournalRow[] = [];
  return {
    rows,
    row(direction: JournalRow['direction'], frame: unknown): JournalRow {
      const row = { seq: rows.length + 1, direction, at: new Date().toISOString(), frame };
      rows.push(row);
      return row;
    },
  };
}

const success = (request_id: string, response?: unknown) => ({ type: 'control_response', response: { subtype: 'success', request_id, response } });
const failure = (request_id: string, error: string, error_code?: string) => ({ type: 'control_response', response: { subtype: 'error', request_id, error, error_code } });
const requestOf = (frame: StdinFrame) => frame as { type: string; request_id: string; request: { subtype: string } };

describe('control client ids, timeouts, cancellation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('mints ${launchId}-${n} ids, journals the out row before writing, and resolves the typed response', async () => {
    const { transport, writes } = fakeTransport();
    const journal = fakeJournal();
    const client = new ControlClient(transport, journal, 'LAUNCH01');
    const pending = client.request('get_usage', {});
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(1);
    expect(requestOf(writes[0]!).request_id).toBe('LAUNCH01-1');
    expect(journal.rows[0]).toMatchObject({ direction: 'out', frame: { type: 'control_request', request_id: 'LAUNCH01-1', request: { subtype: 'get_usage' } } });
    client.observe(success('LAUNCH01-1', { session: { total_cost_usd: 0.1, total_api_duration_ms: 1, total_duration_ms: 1, model_usage: {} }, subscription_type: null, rate_limits_available: false, rate_limits: null, behaviors: null }));
    const response = await pending;
    expect(response.session.total_cost_usd).toBe(0.1);
    expect(client.pending).toBe(0);
    const second = client.request('get_status', {});
    await vi.advanceTimersByTimeAsync(0);
    expect(requestOf(writes[1]!).request_id).toBe('LAUNCH01-2');
    client.observe(success('LAUNCH01-2', { sections: [] }));
    await second;
  });

  it('a read with no response rejects with ControlTimeout after 8 s and writes a control_cancel_request', async () => {
    const { transport, writes } = fakeTransport();
    const client = new ControlClient(transport, fakeJournal(), 'LAUNCH01');
    const pending = client.request('get_usage', {});
    const outcome = pending.then(() => 'resolved', (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS.read - 1);
    expect(writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const error = await outcome;
    expect(error).toBeInstanceOf(ControlTimeout);
    expect((error as ControlTimeout).subtype).toBe('get_usage');
    expect((error as ControlTimeout).message).toBe('get_usage unanswered after 8 s');
    expect(writes[1]).toEqual({ type: 'control_cancel_request', request_id: 'LAUNCH01-1' });
  });

  it('a late response after the timeout is reported to the late handler and does not throw', async () => {
    const { transport } = fakeTransport();
    const warn = vi.fn();
    const client = new ControlClient(transport, fakeJournal(), 'LAUNCH01', { warn });
    const late = vi.fn();
    client.onLateResponse(late);
    const pending = client.request('rename_session', { title: 'x' }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS.mutate);
    expect(await pending).toBeInstanceOf(ControlTimeout);
    expect(() => client.observe(success('LAUNCH01-1'))).not.toThrow();
    expect(late).toHaveBeenCalledWith({ requestId: 'LAUNCH01-1', subtype: 'rename_session', response: { subtype: 'success', request_id: 'LAUNCH01-1', response: undefined } });
    expect(warn).not.toHaveBeenCalled();
    // after the 60 s late window the id is forgotten and a response is merely unexpected
    await vi.advanceTimersByTimeAsync(60_000);
    client.observe(success('LAUNCH01-1'));
    expect(late).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('per-class deadlines: long requests wait 120 s, interrupt 8 s, and timeoutMs overrides', async () => {
    const { transport } = fakeTransport();
    const client = new ControlClient(transport, fakeJournal(), 'LAUNCH01');
    const init = client.request('initialize', {}).catch((e: unknown) => e);
    const interrupt = client.request('interrupt', { reason: 'user-cancel' }).catch((e: unknown) => e);
    const custom = client.request('get_status', {}, { timeoutMs: 1_000 }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await custom).toBeInstanceOf(ControlTimeout);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS.interrupt - 1_000);
    expect(await interrupt).toBeInstanceOf(ControlTimeout);
    expect(client.pending).toBe(1);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS.long - REQUEST_TIMEOUT_MS.interrupt);
    expect(await init).toBeInstanceOf(ControlTimeout);
  });

  it('an error response with error_code auto_mode_model rejects with ControlError.code', async () => {
    const { transport } = fakeTransport();
    const client = new ControlClient(transport, fakeJournal(), 'LAUNCH01');
    const pending = client.request('set_permission_mode', { mode: 'auto' }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    client.observe(failure('LAUNCH01-1', 'Cannot set permission mode to auto: auto mode unavailable for this model', 'auto_mode_model'));
    const error = (await pending) as ControlError;
    expect(error).toBeInstanceOf(ControlError);
    expect(error).not.toBeInstanceOf(ControlTimeout);
    expect(error.code).toBe('auto_mode_model');
    expect(error.requestId).toBe('LAUNCH01-1');
    expect(error.message).toContain('auto mode unavailable');
  });

  it('a response whose payload fails its typed schema rejects with ControlError invalid_response and logs the path', async () => {
    const { transport } = fakeTransport();
    const warn = vi.fn();
    const client = new ControlClient(transport, fakeJournal(), 'LAUNCH01', { warn });
    const pending = client.request('generate_session_title', { description: 'x', persist: false }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    client.observe(success('LAUNCH01-1', { title: 42 }));
    const error = (await pending) as ControlError;
    expect(error).toBeInstanceOf(ControlError);
    expect(error.code).toBe('invalid_response');
    expect(warn.mock.calls[0]![0]).toContain('title');
  });

  it('cancel writes control_cancel_request and rejects with ControlCancelled; an AbortSignal does the same', async () => {
    const { transport, writes } = fakeTransport();
    const client = new ControlClient(transport, fakeJournal(), 'LAUNCH01');
    const pending = client.request('generate_session_title', { description: 'x', persist: false }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    client.cancel('LAUNCH01-1' as never);
    expect(await pending).toBeInstanceOf(ControlCancelled);
    expect(writes[1]).toEqual({ type: 'control_cancel_request', request_id: 'LAUNCH01-1' });
    const controller = new AbortController();
    const aborted = client.request('side_question', { question: 'q' }, { signal: controller.signal }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await aborted).toBeInstanceOf(ControlCancelled);
    // a response for a cancelled id is a late response, not an error
    client.observe(success('LAUNCH01-2', { title: 't' }));
    expect(client.pending).toBe(0);
  });

  it('an already-aborted signal refuses the request before anything is journaled or written', async () => {
    const { transport, writes } = fakeTransport();
    const journal = fakeJournal();
    const client = new ControlClient(transport, journal, 'LAUNCH01');
    const controller = new AbortController();
    controller.abort();
    const error = await client.request('set_model', { model: 'haiku' }, { signal: controller.signal }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ControlCancelled);
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toEqual([]);
    expect(journal.rows).toEqual([]);
    expect(client.pending).toBe(0);
  });

  it('get_session_cost parses the SPEC-declared text response and rejects a malformed one', async () => {
    const { transport } = fakeTransport();
    const client = new ControlClient(transport, fakeJournal(), 'LAUNCH01', { warn: () => {} });
    const ok = client.request('get_session_cost', {});
    await vi.advanceTimersByTimeAsync(0);
    client.observe(success('LAUNCH01-1', { text: 'Total cost: $0.12' }));
    expect((await ok).text).toBe('Total cost: $0.12');
    const bad = client.request('get_session_cost', {}).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    client.observe(success('LAUNCH01-2', { cost: 0.12 }));
    expect(((await bad) as ControlError).code).toBe('invalid_response');
  });

  it('a failed write rejects with ControlError write_failed and leaves nothing pending', async () => {
    const { transport } = fakeTransport({ failWrites: true });
    const client = new ControlClient(transport, fakeJournal(), 'LAUNCH01');
    const error = (await client.request('get_usage', {}).catch((e: unknown) => e)) as ControlError;
    expect(error).toBeInstanceOf(ControlError);
    expect(error.code).toBe('write_failed');
    expect(client.pending).toBe(0);
  });

  it('close rejects every pending request with ControlError exited and clears its timers', async () => {
    const { transport } = fakeTransport();
    const client = new ControlClient(transport, fakeJournal(), 'LAUNCH01');
    const a = client.request('get_usage', {}).catch((e: unknown) => e);
    const b = client.request('initialize', {}).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    client.close('the process exited');
    expect(((await a) as ControlError).code).toBe('exited');
    expect(((await b) as ControlError).code).toBe('exited');
    expect(vi.getTimerCount()).toBe(0);
    const after = (await client.request('get_usage', {}).catch((e: unknown) => e)) as ControlError;
    expect(after.code).toBe('exited');
  });

  it('respond and respondError journal and write the success and error envelopes', async () => {
    const { transport, writes } = fakeTransport();
    const journal = fakeJournal();
    const client = new ControlClient(transport, journal, 'LAUNCH01');
    await client.respond('req-1' as never, { behavior: 'allow', updatedInput: {} });
    await client.respondError('req-2' as never, 'no such dialog');
    expect(writes[0]).toEqual({ type: 'control_response', response: { subtype: 'success', request_id: 'req-1', response: { behavior: 'allow', updatedInput: {} } } });
    expect(writes[1]).toEqual({ type: 'control_response', response: { subtype: 'error', request_id: 'req-2', error: 'no such dialog' } });
    expect(journal.rows.map((r) => r.direction)).toEqual(['out', 'out']);
  });

  it('dispatches inbound requests and cancellations to their handlers and ignores other frames', () => {
    const { transport } = fakeTransport();
    const client = new ControlClient(transport, fakeJournal(), 'LAUNCH01');
    const inbound = vi.fn();
    const cancelled = vi.fn();
    client.onInbound(inbound);
    client.onInboundCancel(cancelled);
    const request = { type: 'control_request', request_id: 'r-1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: {}, tool_use_id: 't-1' } };
    client.observe(request);
    client.observe({ type: 'control_cancel_request', request_id: 'r-1' });
    client.observe({ type: 'system', subtype: 'status', status: null });
    client.observe({ type: 'control_response', response: { subtype: 'success', request_id: 'never-sent' } });
    expect(inbound).toHaveBeenCalledWith(request);
    expect(cancelled).toHaveBeenCalledWith('r-1');
  });

  it('requestRaw sends a subtype without a typed schema and resolves the raw payload', async () => {
    const { transport, writes } = fakeTransport();
    const client = new ControlClient(transport, fakeJournal(), 'LAUNCH01');
    const pending = client.requestRaw('fork_conversation', { title: 'x' });
    await vi.advanceTimersByTimeAsync(0);
    expect(requestOf(writes[0]!).request).toEqual({ subtype: 'fork_conversation', title: 'x' });
    client.observe(success('LAUNCH01-1', { forked: false, error: 'unsupported' }));
    expect(await pending).toEqual({ forked: false, error: 'unsupported' });
  });
});
