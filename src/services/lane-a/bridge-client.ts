// The bridge's HTTP over its Unix socket (DX5; P5 O9 M2, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, Orientation
// "The bridge"), as `sminos steer` reaches it from a terminal: the same uid, presenting nothing, one request per
// connection. `call` answers the status and the parsed body, or rejects with `BridgeUnreachable` when nothing answered
// (no socket, a stale one, a timeout, a connection that closed mid-answer). `subscribe` holds `GET /events`, handing
// each batch of parsed lines over as it arrives.
import { request, type ClientRequest } from 'node:http';

export type BridgeAnswer = { status: number; body: Record<string, unknown> | null };

export class BridgeUnreachable extends Error {
  constructor(
    readonly why: 'timeout' | 'gone',
    message: string,
  ) {
    super(message);
  }
}

const parse = (text: string): Record<string, unknown> | null => {
  if (text === '') return null;
  try {
    const value = JSON.parse(text) as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

export function call(socket: string, method: 'GET' | 'POST', path: string, body: unknown, timeoutMs: number): Promise<BridgeAnswer> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    let settled = false;
    const fail = (why: 'timeout' | 'gone', message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      reject(new BridgeUnreachable(why, message));
    };
    const req: ClientRequest = request(
      {
        socketPath: socket,
        method,
        path,
        agent: false,
        headers: { Connection: 'close', ...(data !== undefined && { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ status: res.statusCode ?? 0, body: parse(Buffer.concat(chunks).toString('utf8')) });
        });
        res.on('error', (error) => fail('gone', error.message));
        res.on('aborted', () => fail('gone', 'the bridge closed the connection mid-answer'));
      },
    );
    const timer = setTimeout(() => fail('timeout', `the bridge did not answer ${method} ${path} within ${timeoutMs} ms`), timeoutMs);
    req.on('error', (error) => fail('gone', error.message));
    req.end(data);
  });
}

export interface EventStream {
  close(): void; // ends it without `onEnd`
}

export interface EventHandlers {
  onLines(lines: Record<string, unknown>[]): void; // the snapshot line first, then the events, in order
  onEnd(reason: string): void; // exactly once, unless closed: a refusal (`503` while the bridge is not ready), an end, a reset, a cut
}

export function subscribe(socket: string, handlers: EventHandlers): EventStream {
  let done = false;
  const end = (reason: string) => {
    if (done) return;
    done = true;
    req.destroy();
    handlers.onEnd(reason);
  };
  const req = request({ socketPath: socket, method: 'GET', path: '/events', agent: false, headers: { Connection: 'close' } }, (res) => {
    // Whatever the answer, its connection's every way of ending ends the subscription: a truncated one emits no `end`.
    res.on('error', (error) => end(error.message));
    res.on('aborted', () => end('the bridge closed the stream'));
    res.on('close', () => end('the bridge closed the stream'));
    if (res.statusCode !== 200) {
      end(`the bridge refused the subscription (${res.statusCode ?? 0})`); // its body says nothing the driver reads
      return;
    }
    let rest = '';
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      if (done) return;
      const parts = (rest + chunk).split('\n');
      rest = parts.pop() ?? '';
      const lines: Record<string, unknown>[] = [];
      for (const part of parts) {
        if (part.trim() === '') continue;
        const line = parse(part);
        if (line === null) return end('the bridge sent a line that is not a JSON object');
        lines.push(line);
      }
      if (lines.length > 0) handlers.onLines(lines);
    });
    res.on('end', () => end('the bridge ended the stream'));
  });
  req.on('error', (error) => end(error.message));
  req.end();
  return {
    close() {
      done = true;
      req.destroy();
    },
  };
}
