// P3-HD M2: the HTTP transport of MAWS's own connection to a verified server (docs/doperpowers/plans/2026-10-17-p3-hd-
// direct-route.md, "Actual-write authority"; Decision Log 4). The SDK's stock StreamableHTTPClientTransport, with the
// one fetch it may use injected here:
//
// - The transport always awaits its headers before it fetches (sdk 1.32.1 client/streamableHttp.js `send`), so the
//   final check is inside this fetch, synchronously before the actual network call: the wire's fence and a bound
//   tools/call's own admission (./direct-wire.ts).
// - Only the exact verified resource URL is fetched, by POST. Redirects are never followed (`redirect: 'manual'`, and a
//   redirect answer is a failure), so a configured header or a bearer never reaches another resource.
// - No auth provider (main owns OAuth; a supplied access token is attached here, to that URL only), no resumption, no
//   reconnection (`maxRetries: 0`), and the optional standalone SSE GET is answered 405 without a request, which the
//   SDK treats as a server offering none.
// - Each answer's body is bounded before the SDK parses it, a streamed one included, and ended once its JSON-RPC answer
//   was delivered (a server may keep a POST's SSE stream open after it): a completed request leaves no stream open.
// - A 401, any other non-success answer, a redirect, a network failure or an over-bound body is a fault: the
//   connection is not reused. Nothing is retried here.
// - A normal close (idle) ends the server's session with the SDK's DELETE, once, bounded, and only while the fence
//   still holds; an invalidation (main gone, a credential withdrawn) sends nothing, so an old credential never leaves
//   after it. A local abort alone would leave the server's session to its own expiry.
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { ConnectorLaunchEntry } from './source-entry';
import { DirectWireRefusal, type DirectWire, type WireRequest } from './direct-wire';

export type HttpLaunch = Extract<ConnectorLaunchEntry, { transport: 'http' }>;

export interface DirectHttpOptions {
  maxMessageBytes: number;
  fetch?: FetchLike;
  bearer?: () => string | undefined; // the access token main supplied for this connection's credential epoch
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);
export const HTTP_TERMINATE_MS = 2_000; // a normal close's DELETE of the session

export function directHttpTransport(entry: HttpLaunch, wire: DirectWire, options: DirectHttpOptions): StreamableHTTPClientTransport {
  const resource = new URL(entry.url).href;
  const base: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const guarded: FetchLike = async (url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET') return new Response(null, { status: 405 }); // no standalone SSE stream
    if (hrefOf(url) !== resource) throw new DirectWireRefusal('a direct request goes only to its verified resource');
    if (method === 'DELETE') return terminate(init);
    if (method !== 'POST') throw new DirectWireRefusal('a direct request is a POST');
    const message = messageOf(init?.body);
    // ── synchronous from here to the network call ──
    const request = wire.writing(message);
    const headers = new Headers(init?.headers);
    const token = options.bearer?.();
    if (token) headers.set('authorization', `Bearer ${token}`);
    const signals = [init?.signal, request?.signal].filter((signal): signal is AbortSignal => !!signal);
    let response: Response;
    try {
      response = await base(resource, { ...init, headers, redirect: 'manual', signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0] });
    } catch {
      if (!signals.some((signal) => signal.aborted)) wire.fault(request, 'transport');
      throw new DirectWireRefusal('the server could not be reached');
    }
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel().catch(() => {});
      wire.fault(request, 'transport');
      throw new DirectWireRefusal('the server answered a redirect, which is not followed');
    }
    if (response.status === 401) wire.fault(request, 'unauthorized');
    else if (!response.ok) wire.fault(request, 'transport');
    return bounded(response, options.maxMessageBytes, request, wire);
  };
  // The session's termination at a normal close (StreamableHTTPClientTransport.terminateSession), bounded, never retried.
  const terminate = async (init: RequestInit | undefined): Promise<Response> => {
    if (!wire.admitsTermination()) throw new DirectWireRefusal('the session is not terminated after an invalidation');
    const headers = new Headers(init?.headers);
    const token = options.bearer?.();
    if (token) headers.set('authorization', `Bearer ${token}`);
    const bound = new AbortController();
    const timer = setTimeout(() => bound.abort(), HTTP_TERMINATE_MS);
    try {
      const response = await base(resource, { ...init, headers, redirect: 'manual', signal: init?.signal ? AbortSignal.any([init.signal, bound.signal]) : bound.signal });
      await response.body?.cancel().catch(() => {});
      return new Response(null, { status: response.status >= 300 && response.status < 400 ? 502 : response.status });
    } finally {
      clearTimeout(timer);
    }
  };
  return new StreamableHTTPClientTransport(new URL(resource), {
    fetch: guarded,
    requestInit: { headers: { ...entry.headers }, redirect: 'manual' },
    reconnectionOptions: { initialReconnectionDelay: 1_000, maxReconnectionDelay: 30_000, reconnectionDelayGrowFactor: 1.5, maxRetries: 0 },
  });
}

function hrefOf(url: string | URL): string | null {
  try {
    return new URL(url).href;
  } catch {
    return null;
  }
}

// The transport serializes exactly one message per POST.
function messageOf(body: unknown): JSONRPCMessage {
  if (typeof body !== 'string') throw new DirectWireRefusal('a direct request carries one serialized message');
  const message = JSON.parse(body) as unknown;
  if (typeof message !== 'object' || message === null || Array.isArray(message)) throw new DirectWireRefusal('a direct request carries one message');
  return message as JSONRPCMessage;
}

function bounded(response: Response, maxBytes: number, request: WireRequest | undefined, wire: DirectWire): Response {
  if (!response.body || NULL_BODY_STATUSES.has(response.status)) return response;
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void response.body.cancel().catch(() => {});
    wire.fault(request, 'tooLarge');
    throw new DirectWireRefusal('the server answered more than the bound');
  }
  let total = 0;
  let stream: TransformStreamDefaultController<Uint8Array> | undefined;
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      start(controller) {
        stream = controller;
      },
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          wire.fault(request, 'tooLarge');
          controller.error(new DirectWireRefusal('the server answered more than the bound'));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  // P3-HD panel correction: once its answer is delivered, the SDK's reader sees this stream end (no error, no
  // reconnection: it has its response) and the server's body is cancelled, even if the server kept it open
  if (request) {
    request.endStream = () => {
      try {
        stream?.terminate();
      } catch {
        // already ended
      }
    };
  }
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
