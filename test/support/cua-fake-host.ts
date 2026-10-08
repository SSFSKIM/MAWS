// A stand-in for cua's native host on the other end of MAWS's primitive server (the in-app browser spec of 2026-10-08,
// "The MAWS primitive server"): a Node client on the app session's socket that speaks the extension protocol (u32 LE
// length + JSON-RPC 2.0), waits for MAWS's hello, sends primitives as requests and keeps every notification. The unit
// tests of src/main/browser/cua and the e2e case drive MAWS through it; the live proof uses cua's real host.
import { connect, type Socket } from 'node:net';

export interface HostNotification {
  method: string;
  params: Record<string, unknown>;
}

export interface FakeHost {
  hello: Record<string, unknown>;
  notifications: HostNotification[];
  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  notify(method: string, params?: Record<string, unknown>): void;
  // Resolves with the first notification (already received or later) that matches.
  waitFor(method: string, match?: (params: Record<string, unknown>) => boolean, timeoutMs?: number): Promise<HostNotification>;
  close(): Promise<void>;
  readonly closed: Promise<void>;
}

const frame = (message: unknown) => {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const out = Buffer.alloc(4 + body.length);
  out.writeUInt32LE(body.length, 0);
  body.copy(out, 4);
  return out;
};

export function connectFakeHost(path: string, { helloTimeoutMs = 5000 } = {}): Promise<FakeHost> {
  return new Promise((resolveHost, rejectHost) => {
    const socket: Socket = connect(path);
    let pending = Buffer.alloc(0);
    let nextId = 0;
    const calls = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
    const notifications: HostNotification[] = [];
    const waiters = new Set<{ method: string; match: (params: Record<string, unknown>) => boolean; resolve(n: HostNotification): void }>();
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => (resolveClosed = resolve));
    const timer = setTimeout(() => {
      socket.destroy();
      rejectHost(new Error(`no hello from ${path} within ${helloTimeoutMs} ms`));
    }, helloTimeoutMs);

    const host: Omit<FakeHost, 'hello'> = {
      notifications,
      request: (method, params = {}) =>
        new Promise((resolve, reject) => {
          const id = ++nextId;
          calls.set(id, { resolve: resolve as (value: unknown) => void, reject });
          socket.write(frame({ jsonrpc: '2.0', id, method, params }));
        }),
      notify: (method, params = {}) => void socket.write(frame({ jsonrpc: '2.0', method, params })),
      waitFor: (method, match = () => true, timeoutMs = 5000) => {
        const seen = notifications.find((n) => n.method === method && match(n.params));
        if (seen) return Promise.resolve(seen);
        return new Promise((resolve, reject) => {
          const waiter = { method, match, resolve: (n: HostNotification) => (clearTimeout(t), resolve(n)) };
          const t = setTimeout(() => (waiters.delete(waiter), reject(new Error(`no ${method} notification within ${timeoutMs} ms`))), timeoutMs);
          waiters.add(waiter);
        });
      },
      close: () => {
        socket.end();
        socket.destroy();
        return closed;
      },
      closed,
    };

    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 4) {
        const length = pending.readUInt32LE(0);
        if (pending.length < 4 + length) break;
        const message = JSON.parse(pending.subarray(4, 4 + length).toString('utf8')) as { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message: string } };
        pending = pending.subarray(4 + length);
        if (typeof message.method === 'string') {
          const n = { method: message.method, params: message.params ?? {} };
          if (n.method === 'hello') {
            clearTimeout(timer);
            resolveHost({ ...host, hello: n.params });
            continue;
          }
          notifications.push(n);
          for (const waiter of [...waiters]) {
            if (waiter.method === n.method && waiter.match(n.params)) {
              waiters.delete(waiter);
              waiter.resolve(n);
            }
          }
        } else if (typeof message.id === 'number') {
          const call = calls.get(message.id);
          calls.delete(message.id);
          if (message.error) call?.reject(new Error(message.error.message));
          else call?.resolve(message.result);
        }
      }
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      rejectHost(error);
    });
    socket.on('close', () => {
      for (const call of calls.values()) call.reject(new Error('the socket closed'));
      calls.clear();
      resolveClosed();
    });
  });
}
