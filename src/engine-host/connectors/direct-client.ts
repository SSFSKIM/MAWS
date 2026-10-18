// P3-HD M2: MAWS's own MCP connections to verified servers, route D's transport half (docs/doperpowers/plans/2026-10-17-
// p3-hd-direct-route.md, "Actual-write authority"; Decision Log 4 and 5). The host's direct operations (./direct-calls.ts)
// own the grant: they precheck it, acquire a lease here, list the live tools, authorize once, and only then call with
// their own synchronous admission, which this module invokes at the actual write and nowhere else. This module is not a
// grant authority; it decides only what reaches the wire and how long a connection lives.
//
// - The official SDK Client (1.32.1), no sampling, elicitation or roots capability, no listChanged subscription, over
//   MAWS's own stdio transport (./direct-stdio.ts) or the stock HTTP transport with a guarded fetch (./direct-http.ts),
//   both behind the write guard (./direct-wire.ts).
// - Pooled by the verified source (its directory, id, generation, server and entry digest) and, when supplied, the
//   credential's identity and epoch; never by a server name alone. Concurrent acquires share one startup (initialize);
//   at most `connections` exist (closing ones included, until their process is gone), past which an acquire is
//   unavailable. With no lease left a connection closes after `idleMs`; a startup no acquire waits for any more is closed
//   at once. Closing (one connection, a matching set, or the pool) invalidates synchronously, so a startup still in
//   flight never registers; its process cleanup finishes asynchronously, bounded (`settled`).
// - A tools/call is written at most once and never retried; a request that was written may have taken effect. An abort
//   cancels on the wire only a request actually written and not yet answered.
// - Failure messages are fixed words: never a server's own error text, a configured value or a credential.
// - P3-F: a tool's structured output is checked against the output schema its listing declared, whichever page listed
//   it. The SDK checks only against the last tools/list page it received (each listing replaces its cache), so the
//   connection keeps its latest complete listing's schemas and checks each call as the SDK does.
import type { spawn as nodeSpawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import type { JsonSchemaType } from '@modelcontextprotocol/sdk/validation/types.js';
import { ARTIFACT_MAX_BYTES } from '@shared/maws/tools';
import type { VerifiedConnectorSource } from './provenance';
import type { ConnectorLaunchEntry } from './source-entry';
import { directHttpTransport } from './direct-http';
import { OwnedStdioTransport } from './direct-stdio';
import { DirectWire, DirectWireRefusal, WireTransport, type WireFault, type WireRequest } from './direct-wire';

export const DIRECT_POOL_BOUNDS = { connections: 64, idleMs: 5_000, terminateMs: 5_000, startupMs: 60_000, callTimeoutMs: 180_000, toolPages: 16, tools: 1_024 } as const;
// One inbound frame or answer body: a whole result at H's bound, with room for its JSON-RPC envelope.
export const DIRECT_MESSAGE_MAX_BYTES = ARTIFACT_MAX_BYTES + 1024 * 1024;

export interface DirectConnectionKey {
  readonly cwd: string;
  readonly sourceId: string;
  readonly generation: number;
  readonly server: string;
  readonly entryDigest: string;
  readonly connectionId?: string;
  readonly credentialEpoch?: number;
}

export interface DirectCredential {
  readonly connectionId: string;
  readonly credentialEpoch: number;
  readonly accessToken: string; // HTTP only, attached to the entry's exact URL
}

export interface DirectConnectionSpec {
  readonly source: VerifiedConnectorSource;
  readonly entry: ConnectorLaunchEntry; // read transiently (ConnectorStatusCache.readEntry) just before the acquire
  readonly credential?: DirectCredential;
  // The key's own validity (source still current, credential epoch current, main still attached), checked
  // synchronously at every actual write of the connection this acquire starts, its connection traffic included.
  fence(): boolean;
}

export type DirectFailureKind = 'refused' | 'cancelled' | 'unavailable' | 'unauthorized' | 'timeout' | 'failed' | 'tooLarge';
// `admitted`: the request was written, so it may have reached the server (never retry it).
export interface DirectFailure {
  readonly ok: false;
  readonly failure: DirectFailureKind;
  readonly admitted: boolean;
  readonly message: string;
}

export interface DirectTool {
  readonly name: string;
  readonly readOnly: boolean; // annotations.readOnlyHint === true
  // P3-HD panel correction: execution.taskSupport === 'required'. The SDK's callTool throws for such a tool before any
  // tools/call is written (it needs the experimental task API), so route D cannot run it; absent otherwise.
  readonly taskRequired?: true;
}

export interface DirectCallOptions {
  admit(): boolean; // the operation's final synchronous fence, invoked once, at the actual write
  readonly signal: AbortSignal;
  readonly timeoutMs?: number;
}

export interface DirectLease {
  listTools(signal: AbortSignal): Promise<{ ok: true; tools: DirectTool[] } | DirectFailure>; // live, on this connection
  callTool(call: { name: string; arguments: Record<string, unknown> }, options: DirectCallOptions): Promise<{ ok: true; result: unknown } | DirectFailure>;
  release(): void;
}

export interface DirectPoolOptions {
  spawn?: typeof nodeSpawn;
  kill?: (pid: number, signal: NodeJS.Signals | 0) => void;
  fetch?: FetchLike;
  maxMessageBytes?: number;
  bounds?: Partial<Record<'connections' | 'idleMs' | 'startupMs' | 'callTimeoutMs', number>>;
}

type Bounds = { -readonly [K in keyof typeof DIRECT_POOL_BOUNDS]: number };

const failure = (kind: DirectFailureKind, admitted: boolean, message: string): DirectFailure => ({ ok: false, failure: kind, admitted, message });
const CLOSED = 'the direct connection closed';

export function directConnectionKey(spec: Pick<DirectConnectionSpec, 'source' | 'credential'>): DirectConnectionKey {
  const { source, credential } = spec;
  return { cwd: source.cwd, sourceId: source.sourceId, generation: source.generation, server: source.server, entryDigest: source.entryDigest, ...(credential && { connectionId: credential.connectionId, credentialEpoch: credential.credentialEpoch }) };
}

const keyText = (key: DirectConnectionKey) => JSON.stringify([key.cwd, key.sourceId, key.generation, key.server, key.entryDigest, key.connectionId ?? null, key.credentialEpoch ?? null]);

class Connection {
  state: 'starting' | 'ready' | 'closed' = 'starting';
  retired = false; // a fault: never leased again
  fault: WireFault | null = null;
  bearer: string | undefined;
  readonly startup: Promise<DirectFailure | null>;
  private demand = 0;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private closing: Promise<void> | null = null;
  private terminating = false; // an idle close's session termination, until it ends or an invalidation withdraws it
  private readonly wire: DirectWire;
  private readonly transport: WireTransport;
  private readonly http: StreamableHTTPClientTransport | null;
  private readonly client: Client;
  private readonly validator = new AjvJsonSchemaValidator(); // P3-F: the SDK's own, shared with its Client
  private outputSchemas = new Map<string, JsonSchemaType>(); // P3-F: by tool, from the latest complete listing

  constructor(
    readonly key: DirectConnectionKey,
    spec: DirectConnectionSpec,
    private readonly pool: DirectConnectionPool,
    private readonly options: DirectPoolOptions,
    private readonly bounds: Bounds,
  ) {
    this.bearer = spec.credential?.accessToken;
    this.wire = new DirectWire(spec.fence, (fault) => {
      this.fault ??= fault;
      this.retire();
    });
    const maxMessageBytes = options.maxMessageBytes ?? DIRECT_MESSAGE_MAX_BYTES;
    this.http = spec.entry.transport === 'http' ? directHttpTransport(spec.entry, this.wire, { maxMessageBytes, fetch: options.fetch, bearer: () => this.bearer }) : null;
    const inner = spec.entry.transport === 'stdio' ? new OwnedStdioTransport(spec.entry, this.wire, { maxMessageBytes, spawn: options.spawn, kill: options.kill }) : this.http!;
    this.transport = new WireTransport(inner, this.wire);
    this.client = new Client({ name: 'maws', version: '1.0.0' }, { capabilities: {}, jsonSchemaValidator: this.validator });
    this.client.onclose = () => this.close(); // the server went (its exit, a framing overflow)
    this.startup = this.start();
  }

  hold(): void {
    this.demand += 1;
    clearTimeout(this.idle);
    this.idle = undefined;
  }

  release(): void {
    this.demand -= 1;
    if (this.demand > 0 || this.state === 'closed') return;
    if (this.state === 'starting' || this.retired) {
      void this.close();
      return;
    }
    this.idle = setTimeout(() => void this.close('idle'), this.bounds.idleMs);
    (this.idle as { unref?: () => void }).unref?.();
  }

  // Synchronous invalidation; the promise is the process's (or the HTTP stream's) end. `idle`, a normal close, may still
  // end the server's HTTP session (./direct-http.ts: once, bounded, under the fence); any other close withdraws that.
  close(how: 'idle' | 'invalidate' = 'invalidate'): Promise<void> {
    if (this.closing) {
      // also the transport's own onclose, re-entering from below
      if (how === 'invalidate' && this.terminating) this.withdraw();
      return this.closing;
    }
    let ended!: () => void;
    this.closing = new Promise<void>((resolve) => (ended = resolve));
    this.state = 'closed';
    clearTimeout(this.idle);
    const session = how === 'idle' && !this.retired && this.http?.sessionId !== undefined ? this.http : null;
    if (session) {
      this.terminating = true;
      this.wire.closeForTermination();
    } else {
      this.wire.close();
      this.bearer = undefined;
    }
    this.pool.forget(this, this.closing);
    const local = () => this.transport.close().catch(() => {});
    const end = session
      ? session
          .terminateSession()
          .catch(() => {})
          .then(() => {
            this.terminating = false;
            this.bearer = undefined;
            return local();
          })
      : local();
    void end.then(ended);
    return this.closing;
  }

  private withdraw(): void {
    this.terminating = false;
    this.wire.close();
    this.bearer = undefined;
    void this.transport.close().catch(() => {}); // aborts a termination already fetching
  }

  async listTools(signal: AbortSignal): Promise<{ ok: true; tools: DirectTool[] } | DirectFailure> {
    const tools: DirectTool[] = [];
    const schemas = new Map<string, JsonSchemaType>(); // P3-F: as the SDK keeps them, but for every page
    let cursor: string | undefined;
    for (let page = 0; page < this.bounds.toolPages; page += 1) {
      const answer = await this.issue(null, signal, this.bounds.startupMs, (options) => this.client.listTools(cursor === undefined ? undefined : { cursor }, options));
      if (!answer.ok) return answer;
      for (const tool of answer.value.tools) {
        if (tools.length >= this.bounds.tools) return failure('unavailable', true, 'the server lists more tools than the bound');
        tools.push({ name: tool.name, readOnly: tool.annotations?.readOnlyHint === true, ...(tool.execution?.taskSupport === 'required' && { taskRequired: true as const }) });
        if (tool.outputSchema) schemas.set(tool.name, tool.outputSchema as JsonSchemaType);
        else schemas.delete(tool.name);
      }
      cursor = answer.value.nextCursor;
      if (cursor === undefined) {
        this.outputSchemas = schemas;
        return { ok: true, tools };
      }
    }
    return failure('unavailable', true, 'the server lists more pages of tools than the bound');
  }

  async callTool(call: { name: string; arguments: Record<string, unknown> }, options: DirectCallOptions): Promise<{ ok: true; result: unknown } | DirectFailure> {
    const schema = this.outputSchemas.get(call.name); // P3-F: the listing the call was authorized against
    const answer = await this.issue(options.admit, options.signal, options.timeoutMs ?? this.bounds.callTimeoutMs, (request) => this.client.callTool({ name: call.name, arguments: call.arguments }, undefined, request));
    if (!answer.ok) return answer;
    return this.conforms(schema, answer.value) ? { ok: true, result: answer.value } : failure('failed', true, 'the server answered something the client could not accept');
  }

  // P3-F: the SDK's own rule for a tool with an output schema: structured content matching it, unless an error result
  // carries none.
  private conforms(schema: JsonSchemaType | undefined, result: unknown): boolean {
    if (!schema) return true;
    const { structuredContent, isError } = result as { structuredContent?: unknown; isError?: unknown };
    if (!structuredContent) return Boolean(isError);
    try {
      return this.validator.getValidator(schema)(structuredContent).valid;
    } catch {
      return false;
    }
  }

  // One SDK request, bound to its admission on the wire. The SDK's own signal is aborted only while the request is
  // unanswered: its abort listener outlives the request, and an abort after the answer would cancel on the wire a
  // request that completed.
  private async issue<T>(admit: (() => boolean) | null, signal: AbortSignal, timeout: number, send: (options: { signal: AbortSignal; timeout: number }) => Promise<T>): Promise<{ ok: true; value: T } | DirectFailure> {
    if (this.state !== 'ready') return failure('unavailable', false, CLOSED);
    if (signal.aborted) return failure('cancelled', false, 'cancelled before the request');
    const controller = new AbortController();
    const request = this.wire.arm({ admit, signal: controller.signal, abort: (reason) => controller.abort(reason) });
    const withdraw = () => {
      if (!request.answered) controller.abort(signal.reason);
    };
    signal.addEventListener('abort', withdraw, { once: true });
    let pending: Promise<T>;
    try {
      pending = send({ signal: controller.signal, timeout });
    } finally {
      this.wire.disarm(request); // the SDK sends synchronously; an armed request it never sent goes
    }
    try {
      return { ok: true, value: await pending };
    } catch (error) {
      const outcome = this.failureOf(request, error, signal);
      this.dispose(request, controller);
      return outcome;
    } finally {
      signal.removeEventListener('abort', withdraw);
      this.wire.forget(request);
    }
  }

  // A request that failed without its answer (refused or failed at its send, an answer that could not be framed) is
  // still open in the SDK, its response handler and abort listener kept. Its own abort disposes of them; the wire
  // settles it first, so that abort writes no cancellation (it may have completed on the server; nothing claims it was
  // cancelled). A timeout's or an operation's cancellation was already sent by then, once.
  private dispose(request: WireRequest, controller: AbortController): void {
    this.wire.settle(request);
    if (!controller.signal.aborted) controller.abort(new DirectWireRefusal('the request ended without its answer'));
  }

  private failureOf(request: WireRequest, error: unknown, signal: AbortSignal): DirectFailure {
    const { admitted } = request;
    if (request.fault === 'refused') return failure('refused', false, 'the call was not admitted at its write');
    if (signal.aborted) return failure('cancelled', admitted, admitted ? 'cancelled after the request was sent' : 'cancelled before the request was sent');
    if (request.fault === 'tooLarge') return failure('tooLarge', admitted, 'the server answered more than the bound');
    if (request.fault === 'unauthorized') return failure('unauthorized', admitted, 'the server refused the credential');
    if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) {
      this.retire();
      return failure('timeout', admitted, 'the server did not answer in time');
    }
    // No JSON-RPC answer arrived for it (a send that failed, a closed connection, a body that is not a framed message):
    // a transport fault, and the connection is not reused. An answered error below is the server's, and it keeps it.
    if (!request.answered) {
      this.retire();
      return failure('unavailable', admitted, admitted ? 'the connection failed after the request was sent' : 'the request was not sent');
    }
    if (error instanceof McpError) return failure('failed', true, `the server answered error ${error.code}`);
    return failure('failed', true, 'the server answered something the client could not accept');
  }

  private retire(): void {
    if (this.retired) return;
    this.retired = true;
    this.pool.forget(this);
    if (this.demand === 0 && this.state !== 'starting') void this.close();
  }

  // The whole connect is bounded, its initialized notification included (the SDK's request timeout covers only the
  // initialize request); at the bound the connection is closed.
  private async start(): Promise<DirectFailure | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<'expired'>((resolve) => (timer = setTimeout(() => resolve('expired'), this.bounds.startupMs)));
    try {
      const outcome = await Promise.race([this.client.connect(this.transport, { timeout: this.bounds.startupMs }).then(() => 'connected' as const), expired]);
      if (outcome === 'expired') {
        void this.close();
        return failure('unavailable', false, 'the server did not complete its start in time');
      }
    } catch {
      const unauthorized = this.fault === 'unauthorized';
      void this.close();
      return failure(unauthorized ? 'unauthorized' : 'unavailable', false, unauthorized ? 'the server refused the credential' : 'the server could not be connected');
    } finally {
      clearTimeout(timer);
    }
    if (this.state === 'closed') return failure('unavailable', false, CLOSED);
    this.state = 'ready';
    if (this.retired) void this.close();
    return this.retired ? failure('unavailable', false, CLOSED) : null;
  }
}

class Lease implements DirectLease {
  private released = false;

  constructor(private readonly connection: Connection) {}

  listTools(signal: AbortSignal) {
    return this.released ? Promise.resolve(failure('unavailable', false, 'the lease was released')) : this.connection.listTools(signal);
  }

  callTool(call: { name: string; arguments: Record<string, unknown> }, options: DirectCallOptions) {
    return this.released ? Promise.resolve(failure('unavailable', false, 'the lease was released')) : this.connection.callTool(call, options);
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    this.connection.release();
  }
}

export class DirectConnectionPool {
  private readonly byKey = new Map<string, Connection>(); // leasable
  private readonly owned = new Set<Connection>(); // until its process (or stream) is gone
  private readonly cleanups = new Set<Promise<void>>();
  private readonly bounds: Bounds;
  private closed = false;

  constructor(private readonly options: DirectPoolOptions = {}) {
    this.bounds = { ...DIRECT_POOL_BOUNDS, ...options.bounds };
  }

  get size(): number {
    return this.owned.size;
  }

  async acquire(spec: DirectConnectionSpec, signal: AbortSignal): Promise<{ ok: true; lease: DirectLease } | DirectFailure> {
    if (this.closed) return failure('unavailable', false, 'the direct route is closed');
    if (signal.aborted) return failure('cancelled', false, 'cancelled before the connection');
    const key = directConnectionKey(spec);
    const text = keyText(key);
    let connection = this.byKey.get(text);
    if (connection) {
      if (spec.credential) connection.bearer = spec.credential.accessToken; // the same epoch's latest access token
    } else {
      if (this.owned.size >= this.bounds.connections) return failure('unavailable', false, 'too many direct connections');
      connection = new Connection(key, spec, this, this.options, this.bounds);
      if (connection.state !== 'closed') this.byKey.set(text, connection);
      this.owned.add(connection);
    }
    connection.hold();
    const started = await untilAborted(connection.startup, signal);
    if (started === ABORTED) {
      connection.release();
      return failure('cancelled', false, 'cancelled while connecting');
    }
    if (started !== null || connection.state !== 'ready' || connection.retired) {
      connection.release();
      return started ?? failure('unavailable', false, CLOSED);
    }
    return { ok: true, lease: new Lease(connection) };
  }

  // Every matching connection closes now (no lease, startup or request of it writes again); the promise is their end.
  invalidate(match: (key: DirectConnectionKey) => boolean): Promise<void> {
    return Promise.all([...this.owned].filter((connection) => match(connection.key)).map((connection) => connection.close())).then(() => {});
  }

  // Terminal: nothing is acquired again.
  close(): Promise<void> {
    this.closed = true;
    return this.invalidate(() => true);
  }

  // Every cleanup begun so far has finished.
  settled(): Promise<void> {
    return Promise.all([...this.cleanups]).then(() => {});
  }

  // A connection's closing (`end`, its cleanup) or retirement: it is never leased again; it stays owned until its end
  // settles.
  forget(connection: Connection, end?: Promise<void>): void {
    const text = keyText(connection.key);
    if (this.byKey.get(text) === connection) this.byKey.delete(text);
    if (!end) return;
    const cleanup = end.then(() => {
      this.owned.delete(connection);
      this.cleanups.delete(cleanup);
    });
    this.cleanups.add(cleanup);
  }
}

const ABORTED = Symbol('aborted');

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | typeof ABORTED> {
  if (signal.aborted) return Promise.resolve(ABORTED);
  return new Promise((resolve) => {
    const onAbort = () => resolve(ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then((value) => {
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    });
  });
}
