// The wire of the extension protocol, MAWS's side (the in-app browser spec of 2026-10-08, "The MAWS primitive server";
// cua's `src/chrome/protocol.mjs` is the reference, version 1): a u32 byte length in the host's native order (little-endian
// on every Mac MAWS ships for), then that many bytes of UTF-8 JSON-RPC 2.0. MAWS answers the host's requests and sends
// notifications; it never sends a request. An error reply is `{code, message}`: a handler's throw is code 1 (or the
// thrown error's numeric code), an unknown method code -1 with cua's exact "No handler registered" wording. A reply
// larger than `maxFrameBytes` is never sent: it becomes the error `message_too_large`.

export const NO_HANDLER = (method: string) => `No handler registered for method: ${method}`;
export const MESSAGE_TOO_LARGE = 'message_too_large';

const HEADER_BYTES = 4;

export interface RpcMessage {
  jsonrpc?: '2.0';
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

function frameOf(body: Buffer): Buffer {
  const frame = Buffer.alloc(HEADER_BYTES + body.length);
  frame.writeUInt32LE(body.length, 0);
  body.copy(frame, HEADER_BYTES);
  return frame;
}

export function encodeFrame(message: unknown): Buffer {
  return frameOf(Buffer.from(JSON.stringify(message), 'utf8'));
}

// push(chunk) → the messages completed so far; throws on a declared length over the limit or a body that is not JSON,
// after which the caller closes the connection.
export function frameDecoder(maxFrameBytes = 0xffffffff): (chunk: Buffer) => RpcMessage[] {
  let pending = Buffer.alloc(0);
  return (chunk) => {
    pending = pending.length > 0 ? Buffer.concat([pending, chunk]) : Buffer.from(chunk);
    const out: RpcMessage[] = [];
    while (pending.length >= HEADER_BYTES) {
      const length = pending.readUInt32LE(0);
      if (length > maxFrameBytes) throw new Error(`a frame of ${length} bytes exceeds the limit of ${maxFrameBytes}`);
      if (pending.length < HEADER_BYTES + length) break;
      out.push(JSON.parse(pending.subarray(HEADER_BYTES, HEADER_BYTES + length).toString('utf8')) as RpcMessage);
      pending = pending.subarray(HEADER_BYTES + length);
    }
    return out;
  };
}

export type RpcHandler = (params: Record<string, unknown>) => unknown;

export interface Peer {
  receive(message: RpcMessage): void;
  notify(method: string, params: unknown): void;
  close(): void;
}

export function createPeer({ send, handlers, maxFrameBytes = 0xffffffff }: { send(frame: Buffer): void; handlers: Record<string, RpcHandler>; maxFrameBytes?: number }): Peer {
  let closed = false;
  const write = (message: RpcMessage) => {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    if (body.length > maxFrameBytes) throw new Error(MESSAGE_TOO_LARGE);
    send(frameOf(body));
  };
  const reply = (id: RpcMessage['id'], outcome: Pick<RpcMessage, 'result' | 'error'>) => {
    if (closed) return;
    try {
      write({ jsonrpc: '2.0', id, ...outcome });
    } catch (error) {
      if ((error as Error).message !== MESSAGE_TOO_LARGE) throw error;
      write({ jsonrpc: '2.0', id, error: { code: 1, message: MESSAGE_TOO_LARGE } });
    }
  };
  const handlerOf = (method: string) => (Object.hasOwn(handlers, method) ? handlers[method]! : null);
  const paramsOf = (message: RpcMessage) => (typeof message.params === 'object' && message.params !== null ? (message.params as Record<string, unknown>) : {});

  async function answer(message: RpcMessage & { method: string }): Promise<void> {
    const handler = handlerOf(message.method);
    if (!handler) return reply(message.id, { error: { code: -1, message: NO_HANDLER(message.method) } });
    try {
      reply(message.id, { result: (await handler(paramsOf(message))) ?? null });
    } catch (error) {
      const code = typeof (error as { code?: unknown })?.code === 'number' ? (error as { code: number }).code : 1;
      reply(message.id, { error: { code, message: error instanceof Error ? error.message : String(error) } });
    }
  }

  return {
    receive(message) {
      if (closed || typeof message?.method !== 'string') return; // MAWS sends no requests: nothing else is expected
      const request = message as RpcMessage & { method: string };
      if (request.id !== undefined && request.id !== null) return void answer(request);
      const handler = handlerOf(request.method);
      if (handler) void Promise.resolve().then(() => handler(paramsOf(request))).catch(() => {});
    },
    notify(method, params) {
      if (!closed) write({ jsonrpc: '2.0', method, params });
    },
    close() {
      closed = true;
    },
  };
}
