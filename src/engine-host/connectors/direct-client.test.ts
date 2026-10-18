// P3-HD M2: MAWS's own MCP connections (./direct-client.ts) driven through the real SDK Client 1.32.1, over the guarded
// HTTP transport with an in-memory fetch and over the owned stdio transport with modelled processes
// (./direct-test-fakes.ts). The write guard is proved where the bytes would leave: the fake fetch and the fake stdin.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectConnectionPool, directConnectionKey, type DirectConnectionSpec, type DirectPoolOptions } from './direct-client';
import { STDIO_STOP } from './direct-stdio';
import { FakeMcpServer, FakeProcesses, fakeFetch, fakeSource } from './direct-test-fakes';

const URL_ = 'http://127.0.0.1:4100/mcp';
const call = { name: 'rows', arguments: { q: 1 } };

function httpSpec(overrides: Partial<DirectConnectionSpec> = {}): DirectConnectionSpec {
  return { source: fakeSource({ transport: 'http', url: URL_ }), entry: { transport: 'http', url: URL_, headers: { 'x-configured': 'literal' } }, fence: () => true, ...overrides };
}

function stdioSpec(overrides: Partial<DirectConnectionSpec> = {}): DirectConnectionSpec {
  return { source: fakeSource(), entry: { transport: 'stdio', command: 'fixture', executable: '/scratch/bin/fixture', args: ['--serve'], cwd: '/scratch/project', env: { PATH: '/scratch/bin', MAWS_CONFIGURED: 'configured-value' } }, fence: () => true, ...overrides };
}

function httpPool(respond?: Parameters<typeof fakeFetch>[1], options: DirectPoolOptions = {}) {
  const server = new FakeMcpServer();
  const http = fakeFetch(server, respond);
  return { server, http, pool: new DirectConnectionPool({ fetch: http.fetch, ...options }) };
}

function stdioPool(options: DirectPoolOptions = {}) {
  const server = new FakeMcpServer();
  const processes = new FakeProcesses(server);
  return { server, processes, pool: new DirectConnectionPool({ spawn: processes.spawn, kill: processes.kill, ...options }) };
}

async function leaseOf(pool: DirectConnectionPool, spec: DirectConnectionSpec) {
  const acquired = await pool.acquire(spec, new AbortController().signal);
  if (!acquired.ok) throw new Error(`acquire failed: ${acquired.failure}`);
  return acquired.lease;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  vi.useRealTimers();
});

describe('a tools/call over HTTP', () => {
  it('is bound at send and admitted inside the injected fetch, after the transport awaited its headers', async () => {
    const order: string[] = [];
    const { pool, http } = httpPool((message) => {
      if (message?.method === 'tools/call') order.push('fetch tools/call');
      return undefined;
    });
    const lease = await leaseOf(pool, httpSpec());
    const pending = lease.callTool(call, { admit: () => (order.push('admit'), true), signal: new AbortController().signal });
    expect(order).toEqual([]); // the SDK's send awaits its headers: nothing admitted yet
    const outcome = await pending;
    expect(outcome).toEqual({ ok: true, result: { content: [{ type: 'text', text: 'called rows' }] } });
    expect(order).toEqual(['admit', 'fetch tools/call']);
    expect(http.calls()).toHaveLength(1);
    expect(http.calls()[0]!.message).toMatchObject({ params: { name: 'rows', arguments: { q: 1 } } });
  });

  it('never reaches the network when the grant is withdrawn between the send and the fetch', async () => {
    const { pool, http } = httpPool();
    const lease = await leaseOf(pool, httpSpec());
    let granted = true;
    const pending = lease.callTool(call, { admit: () => granted, signal: new AbortController().signal });
    granted = false; // a revoke landing while the transport awaits its headers
    expect(await pending).toMatchObject({ ok: false, failure: 'refused', admitted: false });
    expect(http.calls()).toHaveLength(0);
  });

  it("never reaches the network when the connection's own fence breaks before the fetch", async () => {
    let current = true;
    const { pool, http } = httpPool();
    const lease = await leaseOf(pool, httpSpec({ fence: () => current }));
    const pending = lease.callTool(call, { admit: () => true, signal: new AbortController().signal });
    current = false; // the source changed or the credential epoch was withdrawn
    expect(await pending).toMatchObject({ ok: false, failure: 'unavailable', admitted: false });
    expect(http.calls()).toHaveLength(0);
  });

  it('cancelled before its write sends neither the call nor a cancellation', async () => {
    const { pool, http } = httpPool();
    const lease = await leaseOf(pool, httpSpec());
    const operation = new AbortController();
    const admit = vi.fn(() => true);
    const pending = lease.callTool(call, { admit, signal: operation.signal });
    operation.abort();
    expect(await pending).toMatchObject({ ok: false, failure: 'cancelled', admitted: false });
    await flush();
    expect(admit).not.toHaveBeenCalled();
    expect(http.seen.map((entry) => entry.message?.method)).not.toContain('tools/call');
    expect(http.seen.map((entry) => entry.message?.method)).not.toContain('notifications/cancelled');
  });

  it('cancelled after its write sends one cancellation naming it', async () => {
    const { pool, http, server } = httpPool();
    server.holdCalls = true;
    const lease = await leaseOf(pool, httpSpec());
    const operation = new AbortController();
    const pending = lease.callTool(call, { admit: () => true, signal: operation.signal });
    await vi.waitFor(() => expect(server.waiting).toBe(1));
    operation.abort();
    expect(await pending).toMatchObject({ ok: false, failure: 'cancelled', admitted: true });
    await vi.waitFor(() => expect(http.seen.filter((entry) => entry.message?.method === 'notifications/cancelled')).toHaveLength(1));
    const id = http.calls()[0]!.message!.id;
    expect(http.seen.find((entry) => entry.message?.method === 'notifications/cancelled')!.message).toMatchObject({ params: { requestId: id } });
    expect(http.calls()).toHaveLength(1);
  });

  it('completed, then its operation aborted, sends no cancellation', async () => {
    const { pool, http } = httpPool();
    const lease = await leaseOf(pool, httpSpec());
    const operation = new AbortController();
    expect((await lease.callTool(call, { admit: () => true, signal: operation.signal })).ok).toBe(true);
    operation.abort();
    await flush();
    expect(http.seen.map((entry) => entry.message?.method)).not.toContain('notifications/cancelled');
  });

  it('is submitted once when the server answers a redirect, which is not followed; the connection is not reused', async () => {
    const { pool, http } = httpPool((message) => (message?.method === 'tools/call' ? new Response(null, { status: 307, headers: { location: URL_ } }) : undefined));
    const lease = await leaseOf(pool, httpSpec());
    expect(await lease.callTool(call, { admit: () => true, signal: new AbortController().signal })).toMatchObject({ ok: false, failure: 'unavailable', admitted: true });
    expect(http.calls()).toHaveLength(1);
    lease.release();
    await leaseOf(pool, httpSpec());
    expect(http.seen.filter((entry) => entry.message?.method === 'initialize')).toHaveLength(2);
  });

  it('answered 401 is unauthorized, submitted once, and retires the connection', async () => {
    const { pool, http } = httpPool((message) => (message?.method === 'tools/call' ? new Response('{"error":"invalid_token"}', { status: 401 }) : undefined));
    const lease = await leaseOf(pool, httpSpec());
    expect(await lease.callTool(call, { admit: () => true, signal: new AbortController().signal })).toMatchObject({ ok: false, failure: 'unauthorized', admitted: true });
    expect(http.calls()).toHaveLength(1);
    lease.release();
    await leaseOf(pool, httpSpec());
    expect(http.seen.filter((entry) => entry.message?.method === 'initialize')).toHaveLength(2);
  });

  it("is answered failed without the server's own words", async () => {
    const { pool, server } = httpPool();
    server.error = (message) => (message.method === 'tools/call' ? { code: -32603, message: 'secret-server-detail' } : undefined);
    const lease = await leaseOf(pool, httpSpec());
    const outcome = await lease.callTool(call, { admit: () => true, signal: new AbortController().signal });
    expect(outcome).toMatchObject({ ok: false, failure: 'failed', admitted: true });
    expect(JSON.stringify(outcome)).not.toContain('secret');
  });
});

describe("the SDK's own request state", () => {
  // The SDK Client of each connection, captured at its connect (Protocol keeps a response handler per open request).
  function clients() {
    const seen: Client[] = [];
    const connect = Client.prototype.connect;
    vi.spyOn(Client.prototype, 'connect').mockImplementation(function (this: Client, ...args: Parameters<Client['connect']>) {
      seen.push(this);
      return connect.apply(this, args);
    });
    return seen;
  }
  const handlers = (client: Client) => (client as unknown as { _responseHandlers: Map<number, unknown> })._responseHandlers.size;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps no response handler for a call refused at its write, on a connection that stays open', async () => {
    const seen = clients();
    const { pool, http } = httpPool();
    const lease = await leaseOf(pool, httpSpec());
    expect(await lease.callTool(call, { admit: () => false, signal: new AbortController().signal })).toMatchObject({ failure: 'refused' });
    await flush();
    expect(handlers(seen[0]!)).toBe(0);
    expect(http.seen.map((entry) => entry.message?.method)).not.toContain('notifications/cancelled');
    expect((await lease.callTool(call, { admit: () => true, signal: new AbortController().signal })).ok).toBe(true); // still open
  });

  it('keeps no response handler for a stdio call refused at its write', async () => {
    const seen = clients();
    const { pool, processes } = stdioPool();
    const lease = await leaseOf(pool, stdioSpec());
    await lease.callTool(call, { admit: () => false, signal: new AbortController().signal });
    await flush();
    expect(handlers(seen[0]!)).toBe(0);
    expect(processes.children[0]!.written().map((message) => message.method)).not.toContain('notifications/cancelled');
  });

  it('sends one cancellation, not two, for a call that timed out after its write', async () => {
    vi.useFakeTimers();
    const seen = clients();
    const { pool, http, server } = httpPool();
    server.holdCalls = true;
    const lease = await leaseOf(pool, httpSpec());
    const pending = lease.callTool(call, { admit: () => true, signal: new AbortController().signal, timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await pending).toMatchObject({ failure: 'timeout', admitted: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(http.seen.filter((entry) => entry.message?.method === 'notifications/cancelled')).toHaveLength(1);
    expect(handlers(seen[0]!)).toBe(0);
  });
});

describe('an answer the transport cannot frame', () => {
  const initializes = (http: ReturnType<typeof fakeFetch>) => http.seen.filter((entry) => entry.message?.method === 'initialize').length;

  for (const [name, answer] of [
    ['malformed JSON', () => new Response('{"jsonrpc":', { status: 200, headers: { 'content-type': 'application/json' } })],
    ['an unexpected content type', () => new Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } })],
    ['a body that is no JSON-RPC message', () => new Response('{"hello":1}', { status: 200, headers: { 'content-type': 'application/json' } })],
  ] as const) {
    it(`(${name}) fails its call unanswered and retires the connection`, async () => {
      const { pool, http } = httpPool((message) => (message?.method === 'tools/call' ? answer() : undefined));
      const lease = await leaseOf(pool, httpSpec());
      expect(await lease.callTool(call, { admit: () => true, signal: new AbortController().signal })).toMatchObject({ ok: false, failure: 'unavailable', admitted: true });
      expect(http.calls()).toHaveLength(1);
      await flush();
      // it may have completed on the server: disposing of it claims no cancellation
      expect(http.seen.map((entry) => entry.message?.method)).not.toContain('notifications/cancelled');
      lease.release();
      await leaseOf(pool, httpSpec());
      expect(initializes(http)).toBe(2);
    });
  }

  it('is distinct from an answered JSON-RPC error, which keeps the connection', async () => {
    const { pool, http, server } = httpPool();
    server.error = (message) => (message.method === 'tools/call' ? { code: -32602, message: 'no such tool' } : undefined);
    const lease = await leaseOf(pool, httpSpec());
    expect(await lease.callTool(call, { admit: () => true, signal: new AbortController().signal })).toMatchObject({ ok: false, failure: 'failed', admitted: true });
    lease.release();
    await leaseOf(pool, httpSpec());
    expect(initializes(http)).toBe(1);
  });
});

describe('a startup', () => {
  it('is bounded as a whole, initialized notification included, and closed at its bound', async () => {
    vi.useFakeTimers();
    const { pool, http } = httpPool((message, init) =>
      message?.method === 'notifications/initialized' ? new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))) : undefined,
    );
    let outcome: unknown = null;
    void pool.acquire(httpSpec(), new AbortController().signal).then((value) => (outcome = value));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(outcome).toBeNull();
    expect(http.seen.map((entry) => entry.message?.method)).toEqual(['initialize', 'notifications/initialized']);
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toMatchObject({ ok: false, failure: 'unavailable', admitted: false });
    await pool.settled();
    expect(pool.size).toBe(0);
  });
});

describe('the HTTP transport', () => {
  it('fetches only the verified resource, by POST, never following a redirect, with the configured headers and the bearer', async () => {
    const { pool, http } = httpPool();
    const credential = { connectionId: 'conn-1', credentialEpoch: 3, accessToken: 'access-token-1' };
    const lease = await leaseOf(pool, httpSpec({ credential }));
    await lease.callTool(call, { admit: () => true, signal: new AbortController().signal });
    await flush();
    expect(http.seen.length).toBeGreaterThanOrEqual(3); // initialize, initialized, tools/call
    for (const entry of http.seen) {
      expect(entry).toMatchObject({ url: URL_, method: 'POST', redirect: 'manual' }); // the standalone SSE GET never left
      expect(entry.headers.get('x-configured')).toBe('literal');
      expect(entry.headers.get('authorization')).toBe('Bearer access-token-1');
    }
  });

  it('bounds a JSON answer before the SDK parses it', async () => {
    const { pool, server } = httpPool(undefined, { maxMessageBytes: 4_096 });
    server.result = () => ({ content: [{ type: 'text', text: 'x'.repeat(10_000) }] });
    const lease = await leaseOf(pool, httpSpec());
    expect(await lease.callTool(call, { admit: () => true, signal: new AbortController().signal })).toMatchObject({ ok: false, failure: 'tooLarge', admitted: true });
  });

  it('bounds a streamed answer, failing its request at once rather than at its timeout', async () => {
    const big = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'y'.repeat(10_000) }] } })}\n\n`;
    const stream = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (let at = 0; at < big.length; at += 1_000) controller.enqueue(new TextEncoder().encode(big.slice(at, at + 1_000)));
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    const { pool } = httpPool((message) => (message?.method === 'tools/call' ? stream() : undefined), { maxMessageBytes: 4_096 });
    const lease = await leaseOf(pool, httpSpec());
    const started = Date.now();
    expect(await lease.callTool(call, { admit: () => true, signal: new AbortController().signal, timeoutMs: 30_000 })).toMatchObject({ ok: false, failure: 'tooLarge', admitted: true });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  // P3-HD panel correction: a server answering each POST over an SSE stream it keeps open; the SDK's reader would keep
  // every completed request's stream (and its response body) open while the pooled connection stays in use
  it('closes each completed request’s answer stream, keeping the pooled connection usable', async () => {
    let open = 0;
    let cancelled = 0;
    const lingering = (reply: unknown) => {
      open += 1;
      let counted = false;
      const done = () => {
        if (counted) return;
        counted = true;
        open -= 1;
        cancelled += 1;
      };
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify(reply)}\n\n`));
          },
          cancel: done,
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    };
    const server = new FakeMcpServer();
    const { pool } = httpPool(async (message) => {
      if (message?.method !== 'tools/call') return undefined;
      return lingering(await server.answer(message));
    });
    const lease = await leaseOf(pool, httpSpec());
    for (let n = 0; n < 5; n += 1) expect(await lease.callTool(call, { admit: () => true, signal: new AbortController().signal })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(open).toBe(0));
    expect(cancelled).toBe(5);
    expect(server.calls()).toHaveLength(5); // each answered once, none resent
  });

  it('a server refusing the credential at initialize is an unauthorized acquire', async () => {
    const { pool } = httpPool((message) => (message?.method === 'initialize' ? new Response('{}', { status: 401 }) : undefined));
    expect(await pool.acquire(httpSpec(), new AbortController().signal)).toMatchObject({ ok: false, failure: 'unauthorized', admitted: false });
  });
});

describe("an HTTP connection's close", () => {
  const deletes = (http: ReturnType<typeof fakeFetch>) => http.seen.filter((entry) => entry.method === 'DELETE');

  it('ends the server session once at an idle close, with the credential still current; a local abort alone would not', async () => {
    vi.useFakeTimers();
    const { pool, http, server } = httpPool();
    server.sessionId = 'session-1';
    const lease = await leaseOf(pool, httpSpec({ credential: { connectionId: 'conn-1', credentialEpoch: 1, accessToken: 'token-1' } }));
    lease.release();
    await vi.advanceTimersByTimeAsync(5_000);
    await pool.settled();
    expect(deletes(http)).toHaveLength(1);
    expect(deletes(http)[0]!.headers.get('mcp-session-id')).toBe('session-1');
    expect(deletes(http)[0]!.headers.get('authorization')).toBe('Bearer token-1');
    expect(pool.size).toBe(0);
  });

  it('sends nothing at an invalidation: an old credential never leaves after it', async () => {
    const { pool, http, server } = httpPool();
    server.sessionId = 'session-1';
    await leaseOf(pool, httpSpec());
    await pool.invalidate(() => true);
    expect(deletes(http)).toHaveLength(0);
  });

  it('sends no termination when the fence broke before the idle close fetched it', async () => {
    vi.useFakeTimers();
    let current = true;
    const { pool, http, server } = httpPool();
    server.sessionId = 'session-1';
    const lease = await leaseOf(pool, httpSpec({ fence: () => current }));
    lease.release();
    current = false;
    await vi.advanceTimersByTimeAsync(5_000);
    await pool.settled();
    expect(deletes(http)).toHaveLength(0);
  });

  it('withdraws a pending termination when an invalidation overtakes it', async () => {
    vi.useFakeTimers();
    const { pool, http, server } = httpPool((message, init) =>
      message === null && init?.method === 'DELETE' ? new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')))) : undefined,
    );
    server.sessionId = 'session-1';
    const lease = await leaseOf(pool, httpSpec());
    lease.release();
    await vi.advanceTimersByTimeAsync(5_000); // the DELETE is in flight and never answers
    let ended = false;
    void pool.invalidate(() => true).then(() => (ended = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(ended).toBe(true);
    expect(deletes(http)).toHaveLength(1);
  });

  it('bounds an unanswered termination', async () => {
    vi.useFakeTimers();
    const { pool, server } = httpPool((message, init) =>
      message === null && init?.method === 'DELETE' ? new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')))) : undefined,
    );
    server.sessionId = 'session-1';
    const lease = await leaseOf(pool, httpSpec());
    lease.release();
    await vi.advanceTimersByTimeAsync(5_000);
    let settled = false;
    void pool.settled().then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(1_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    expect(pool.size).toBe(0);
  });
});

describe('tools/list', () => {
  it('is live on the connection each time, readOnly being the tool’s readOnlyHint', async () => {
    const { pool, server } = httpPool();
    const lease = await leaseOf(pool, httpSpec());
    expect(await lease.listTools(new AbortController().signal)).toEqual({ ok: true, tools: [{ name: 'rows', readOnly: true }, { name: 'write', readOnly: false }] });
    server.tools = [{ name: 'rows', annotations: { readOnlyHint: false } }];
    expect(await lease.listTools(new AbortController().signal)).toEqual({ ok: true, tools: [{ name: 'rows', readOnly: false }] });
  });

  // P3-HD panel correction: the SDK's callTool throws for a task-required tool before tools/call, so the listing says so
  it('marks a tool whose execution requires a task, and only that one', async () => {
    const { pool, server } = httpPool();
    server.tools = [
      { name: 'rows', annotations: { readOnlyHint: true }, execution: { taskSupport: 'required' } },
      { name: 'maybe', execution: { taskSupport: 'optional' } },
      { name: 'plain', execution: { taskSupport: 'forbidden' } },
    ];
    const lease = await leaseOf(pool, httpSpec());
    expect(await lease.listTools(new AbortController().signal)).toEqual({ ok: true, tools: [{ name: 'rows', readOnly: true, taskRequired: true }, { name: 'maybe', readOnly: false }, { name: 'plain', readOnly: false }] });
  });

  // P3-F: each tools/list replaces the SDK's own output validators, so its last page alone would be checked
  it('checks a tool’s structured output against its own schema when a later page listed other tools', async () => {
    const { pool, server } = httpPool();
    server.toolPages = [[{ name: 'rows', annotations: { readOnlyHint: true }, outputSchema: { type: 'object', properties: { rows: { type: 'array' } }, required: ['rows'] } }], [{ name: 'write' }]];
    const lease = await leaseOf(pool, httpSpec());
    expect(await lease.listTools(new AbortController().signal)).toEqual({ ok: true, tools: [{ name: 'rows', readOnly: true }, { name: 'write', readOnly: false }] });
    const answered = async (result: unknown) => {
      server.result = () => result;
      return lease.callTool(call, { admit: () => true, signal: new AbortController().signal });
    };
    expect(await answered({ content: [], structuredContent: { other: 107 } })).toMatchObject({ ok: false, failure: 'failed', admitted: true });
    expect(await answered({ content: [{ type: 'text', text: 'rows 107' }] })).toMatchObject({ ok: false, failure: 'failed', admitted: true });
    expect(await answered({ content: [], structuredContent: { rows: [107] } })).toEqual({ ok: true, result: { content: [], structuredContent: { rows: [107] } } });
    expect(await answered({ content: [{ type: 'text', text: 'no rows' }], isError: true })).toMatchObject({ ok: true }); // an error result carries none
  });
});

describe('a tools/call over stdio', () => {
  it('is written to stdin only when its admission holds at the write', async () => {
    const { pool, processes } = stdioPool();
    const lease = await leaseOf(pool, stdioSpec());
    expect(await lease.callTool(call, { admit: () => false, signal: new AbortController().signal })).toMatchObject({ ok: false, failure: 'refused', admitted: false });
    expect(processes.children[0]!.written().filter((message) => message.method === 'tools/call')).toHaveLength(0);
    expect((await lease.callTool(call, { admit: () => true, signal: new AbortController().signal })).ok).toBe(true);
    expect(processes.children[0]!.written().filter((message) => message.method === 'tools/call')).toHaveLength(1);
  });

  it('fails a written request as too large when a frame passes the bound, and closes the connection', async () => {
    const { pool, processes, server } = stdioPool({ maxMessageBytes: 4_096 });
    server.holdCalls = true;
    const lease = await leaseOf(pool, stdioSpec());
    const pending = lease.callTool(call, { admit: () => true, signal: new AbortController().signal });
    await vi.waitFor(() => expect(server.waiting).toBe(1));
    processes.children[0]!.emitStdout('z'.repeat(5_000)); // no newline: an unterminated line past the bound
    expect(await pending).toMatchObject({ ok: false, failure: 'tooLarge', admitted: true });
    expect(processes.children[0]!.stdinEnded).toBe(true);
  });

  // P3-F: a server that closed its input but did not exit fails the write only asynchronously (EPIPE)
  it('fails a call whose write the server’s closed input refused, at once, and ends the connection', async () => {
    vi.useFakeTimers();
    const { pool, processes } = stdioPool();
    processes.behaviour = { exitOnStdinEnd: false, exitOn: ['SIGTERM', 'SIGKILL'] };
    const lease = await leaseOf(pool, stdioSpec());
    const child = processes.children[0]!;
    child.inputClosed = true;
    let outcome: unknown = 'pending';
    void lease.callTool(call, { admit: () => true, signal: new AbortController().signal }).then((value) => (outcome = value));
    await vi.advanceTimersByTimeAsync(10);
    expect(outcome).toMatchObject({ ok: false, failure: 'unavailable', admitted: true });
    await vi.advanceTimersByTimeAsync(STDIO_STOP.termAfterMs + STDIO_STOP.pollMs);
    expect(processes.signals).toContainEqual({ pid: -child.pid, signal: 'SIGTERM' });
    expect(processes.alive(child.pid)).toEqual([]);
    expect(pool.size).toBe(0);
    lease.release();
  });
});

describe('the pool', () => {
  it('shares one startup between concurrent acquires of one source', async () => {
    const { pool, processes } = stdioPool();
    const [a, b] = await Promise.all([pool.acquire(stdioSpec(), new AbortController().signal), pool.acquire(stdioSpec(), new AbortController().signal)]);
    expect(a.ok && b.ok).toBe(true);
    expect(processes.children).toHaveLength(1);
  });

  it('keys by source generation, entry digest and credential epoch, never by the server name alone', async () => {
    const { pool, processes } = stdioPool();
    await leaseOf(pool, stdioSpec());
    await leaseOf(pool, stdioSpec({ source: fakeSource({ generation: 2 }) }));
    await leaseOf(pool, stdioSpec({ source: fakeSource({ entryDigest: 'digest-2' }) }));
    await leaseOf(pool, stdioSpec({ source: fakeSource({ sourceId: 'source-2' }) }));
    await leaseOf(pool, stdioSpec({ credential: { connectionId: 'c', credentialEpoch: 1, accessToken: 't' } }));
    await leaseOf(pool, stdioSpec({ credential: { connectionId: 'c', credentialEpoch: 2, accessToken: 't' } }));
    expect(processes.children).toHaveLength(6);
    expect(directConnectionKey(stdioSpec({ credential: { connectionId: 'c', credentialEpoch: 2, accessToken: 'secret' } }))).not.toHaveProperty('accessToken');
  });

  it('refuses past its cap without spawning', async () => {
    const { pool, processes } = stdioPool({ bounds: { connections: 2 } });
    await leaseOf(pool, stdioSpec());
    await leaseOf(pool, stdioSpec({ source: fakeSource({ generation: 2 }) }));
    expect(await pool.acquire(stdioSpec({ source: fakeSource({ generation: 3 }) }), new AbortController().signal)).toMatchObject({ ok: false, failure: 'unavailable' });
    expect(processes.children).toHaveLength(2);
  });

  it('closes a connection 5 s after its last lease, reusing it within the window', async () => {
    vi.useFakeTimers();
    const { pool, processes } = stdioPool();
    const first = await leaseOf(pool, stdioSpec());
    first.release();
    await vi.advanceTimersByTimeAsync(4_900);
    const second = await leaseOf(pool, stdioSpec());
    expect(processes.children).toHaveLength(1);
    second.release();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(processes.children[0]!.stdinEnded).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(processes.children[0]!.stdinEnded).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(pool.size).toBe(0);
    await leaseOf(pool, stdioSpec());
    expect(processes.children).toHaveLength(2);
  });

  it('keeps a connection with a lease open past the idle bound', async () => {
    vi.useFakeTimers();
    const { pool, processes } = stdioPool();
    await leaseOf(pool, stdioSpec());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(processes.children[0]!.stdinEnded).toBe(false);
  });

  it('never registers a startup that an invalidation overtook', async () => {
    const { pool, processes } = stdioPool();
    const pending = pool.acquire(stdioSpec(), new AbortController().signal);
    const cleanup = pool.invalidate(() => true); // main went while the server was starting
    expect(await pending).toMatchObject({ ok: false, failure: 'unavailable' });
    await cleanup;
    expect(processes.alive(processes.children[0]!.pid)).toEqual([]);
    expect(pool.size).toBe(0);
    await leaseOf(pool, stdioSpec()); // the pool stays usable after an invalidation
    expect(processes.children).toHaveLength(2);
  });

  it('closes a startup whose only acquire was cancelled', async () => {
    const { pool, processes } = stdioPool();
    const operation = new AbortController();
    const pending = pool.acquire(stdioSpec(), operation.signal);
    operation.abort();
    expect(await pending).toMatchObject({ ok: false, failure: 'cancelled' });
    await pool.settled();
    expect(processes.children[0]!.stdinEnded).toBe(true);
    expect(pool.size).toBe(0);
  });

  it('invalidates the connections a match names, synchronously, and leaves the others', async () => {
    const { pool, processes } = stdioPool();
    const a = await leaseOf(pool, stdioSpec({ credential: { connectionId: 'c', credentialEpoch: 1, accessToken: 't' } }));
    const b = await leaseOf(pool, stdioSpec({ source: fakeSource({ generation: 2 }) }));
    const done = pool.invalidate((key) => key.connectionId === 'c' && (key.credentialEpoch ?? 0) <= 1);
    expect(await a.callTool(call, { admit: () => true, signal: new AbortController().signal })).toMatchObject({ ok: false, failure: 'unavailable', admitted: false });
    expect((await b.callTool(call, { admit: () => true, signal: new AbortController().signal })).ok).toBe(true);
    await done;
    expect(processes.children[0]!.written().filter((message) => message.method === 'tools/call')).toHaveLength(0);
  });

  it('is terminal once closed, its groups gone when the close settles', async () => {
    vi.useFakeTimers();
    const { pool, processes } = stdioPool();
    processes.behaviour = { exitOnStdinEnd: true, exitOn: ['SIGTERM', 'SIGKILL'], grandchild: { exitOn: ['SIGKILL'] } };
    await leaseOf(pool, stdioSpec());
    let closed = false;
    void pool.close().then(() => (closed = true));
    expect(await pool.acquire(stdioSpec(), new AbortController().signal)).toMatchObject({ ok: false, failure: 'unavailable' });
    await vi.advanceTimersByTimeAsync(4_500);
    expect(closed).toBe(true);
    expect(processes.alive(processes.children[0]!.pid)).toEqual([]);
  });

  it('is unavailable when the server cannot be started', async () => {
    const { pool, processes } = stdioPool();
    processes.failSpawn = true;
    expect(await pool.acquire(stdioSpec(), new AbortController().signal)).toMatchObject({ ok: false, failure: 'unavailable', admitted: false });
  });
});
