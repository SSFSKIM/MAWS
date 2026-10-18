// P3-HD M2: the actual-write guard of one MAWS-owned MCP connection (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md,
// "Actual-write authority"; Decision Log 4). The official SDK Client writes through a transport; this module is where
// MAWS, not the SDK, decides what reaches the wire.
//
// - `sending` runs at `Transport.send`, synchronously inside the SDK's request: a request is bound there to what armed
//   it (`arm`, just before the SDK call), so a tools/call is tied to its operation by its JSON-RPC id. A tools/call with
//   no armed admission fails closed. A `notifications/cancelled` is forwarded only for a request actually written and
//   not yet answered: the SDK sends one on any abort, also for a request that never left (or already completed).
// - `writing` runs at the actual write: stdin's write for stdio (./direct-stdio.ts), the injected fetch for HTTP, after
//   the SDK's awaited headers (./direct-http.ts). It checks the connection's fence and, for a bound tools/call, its
//   operation's own synchronous admission, exactly once: a request is never written twice.
// - `received` marks a request answered the moment its response arrives, before the SDK settles it, so a later abort
//   of its operation sends no spurious cancellation; once the SDK has it, the answer's HTTP stream is ended.
import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage, MessageExtraInfo } from '@modelcontextprotocol/sdk/types.js';

// Why a connection stopped being reusable, or why one request failed.
export type WireFault = 'refused' | 'tooLarge' | 'unauthorized' | 'transport' | 'fenced';

export class DirectWireRefusal extends Error {}

// One request MAWS issued, from its send to its answer.
export interface WireRequest {
  id: number | null; // bound at `sending`
  readonly admit: (() => boolean) | null; // an artifact's tools/call: its operation's final synchronous fence
  readonly signal: AbortSignal | null; // the SDK request's own abort, combined into its fetch
  readonly abort: ((reason: unknown) => void) | null; // fails the SDK request (an over-bound streamed answer)
  admitted: boolean; // written: it may have reached the server
  answered: boolean;
  fault: WireFault | null;
  // P3-HD panel correction: ends its answer's HTTP stream once the answer was delivered (./direct-http.ts), so a server
  // holding each POST's SSE stream open leaves no reader behind; the SDK request itself is never aborted after it
  endStream?: () => void;
}

type Armed = Pick<WireRequest, 'admit' | 'signal' | 'abort'>;

const record = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const isRequest = (message: Record<string, unknown>) => typeof message.method === 'string' && message.id !== undefined;
const isResponse = (message: Record<string, unknown>) => message.method === undefined && message.id !== undefined && ('result' in message || 'error' in message);

export class DirectWire {
  private closed = false;
  private terminating = false;
  private armed: WireRequest | null = null;
  private readonly requests = new Map<number, WireRequest>();

  constructor(
    private readonly fence: () => boolean,
    private readonly onFault: (fault: WireFault) => void,
  ) {}

  // The next request the SDK sends belongs to this; `disarm` right after the (synchronous) SDK call.
  arm(armed: Armed): WireRequest {
    const request: WireRequest = { id: null, ...armed, admitted: false, answered: false, fault: null };
    this.armed = request;
    return request;
  }

  disarm(request: WireRequest): void {
    if (this.armed === request) this.armed = null;
  }

  // Over without its answer: no cancellation is written for it any more.
  settle(request: WireRequest): void {
    request.answered = true;
    this.forget(request);
  }

  forget(request: WireRequest): void {
    if (request.id !== null && this.requests.get(request.id) === request) this.requests.delete(request.id);
  }

  close(): void {
    this.closed = true;
    this.terminating = false;
    this.armed = null;
    this.requests.clear();
  }

  // A normal (idle) close: nothing is sent any more but one protocol termination of the session, at most once and only
  // while the fence still holds when it is fetched. A later `close` withdraws even that.
  closeForTermination(): void {
    this.close();
    this.terminating = true;
  }

  admitsTermination(): boolean {
    const admitted = this.terminating && this.fence();
    this.terminating = false;
    return admitted;
  }

  // At Transport.send. 'drop': the message is answered as sent and never written.
  sending(message: JSONRPCMessage): 'write' | 'drop' {
    if (this.closed) throw new DirectWireRefusal('the direct connection is closed');
    const fields = message as unknown as Record<string, unknown>;
    if (isRequest(fields)) {
      const armed = this.armed;
      this.armed = null;
      if (fields.method === 'tools/call' && !armed?.admit) throw new DirectWireRefusal('a tools/call without an admission is never written');
      const request = armed ?? { id: null, admit: null, signal: null, abort: null, admitted: false, answered: false, fault: null };
      request.id = Number(fields.id);
      this.requests.set(request.id, request);
      return 'write';
    }
    if (fields.method === 'notifications/cancelled') {
      const request = this.requests.get(Number(record(fields.params)?.requestId));
      return request?.admitted && !request.answered ? 'write' : 'drop';
    }
    return 'write';
  }

  // At the actual write, synchronously. Throws when nothing may be written; the bound request otherwise.
  writing(message: JSONRPCMessage): WireRequest | undefined {
    if (this.closed) throw new DirectWireRefusal('the direct connection is closed');
    if (!this.fence()) {
      this.onFault('fenced');
      throw new DirectWireRefusal('the direct connection is no longer admitted');
    }
    const fields = message as unknown as Record<string, unknown>;
    if (!isRequest(fields)) return undefined;
    const request = this.requests.get(Number(fields.id));
    if (!request) {
      if (fields.method === 'tools/call') throw new DirectWireRefusal('a tools/call without an admission is never written');
      return undefined;
    }
    if (request.admitted) throw new DirectWireRefusal('a request is written once');
    if (request.signal?.aborted) throw new DirectWireRefusal('the request was cancelled before its write');
    if (request.admit) {
      let admitted: boolean;
      try {
        admitted = request.admit() === true;
      } catch {
        admitted = false;
      }
      if (!admitted) {
        request.fault = 'refused';
        throw new DirectWireRefusal('the call was not admitted at its write');
      }
    }
    request.admitted = true;
    return request;
  }

  // The request a response answers, marked answered (undefined for any other message).
  received(message: JSONRPCMessage): WireRequest | undefined {
    const fields = message as unknown as Record<string, unknown>;
    if (!isResponse(fields)) return undefined;
    const request = this.requests.get(Number(fields.id));
    if (!request) return undefined;
    request.answered = true;
    this.requests.delete(Number(fields.id));
    return request;
  }

  // A transport fault, attributed to the request it answered when there is one. An over-bound answer also fails its
  // request (a streamed answer would otherwise wait for its timeout); the connection is no longer reused either way.
  fault(request: WireRequest | undefined, fault: WireFault): void {
    if (request) {
      request.fault ??= fault;
      if (fault === 'tooLarge' && !request.answered) request.abort?.(new DirectWireRefusal('the answer passed its bound'));
    }
    this.onFault(fault);
  }

  // Every request written and not yet answered (an unattributable over-bound stdio frame fails them all).
  faultPending(fault: WireFault): void {
    for (const request of this.requests.values()) if (request.admitted && !request.answered) request.fault ??= fault;
    this.onFault(fault);
  }
}

// The SDK Client's transport: `sending` at send, `received` before the SDK sees a response; the inner transport calls
// `writing` at its actual write.
export class WireTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;

  constructor(
    private readonly inner: Transport,
    private readonly wire: DirectWire,
  ) {}

  get sessionId(): string | undefined {
    return this.inner.sessionId;
  }

  async start(): Promise<void> {
    this.inner.onmessage = (message, extra) => {
      const answered = this.wire.received(message);
      this.onmessage?.(message, extra);
      answered?.endStream?.(); // P3-HD panel correction: delivered, so its answer's stream ends
    };
    this.inner.onerror = (error) => this.onerror?.(error);
    this.inner.onclose = () => this.onclose?.();
    await this.inner.start();
  }

  send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    let decision: 'write' | 'drop';
    try {
      decision = this.wire.sending(message);
    } catch (error) {
      return Promise.reject(error as Error);
    }
    return decision === 'drop' ? Promise.resolve() : this.inner.send(message, options);
  }

  close(): Promise<void> {
    return this.inner.close();
  }

  setProtocolVersion(version: string): void {
    this.inner.setProtocolVersion?.(version);
  }
}
