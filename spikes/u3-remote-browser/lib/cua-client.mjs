// The cua host's end of the primitive server's socket, as the driver plays it: test/support/cua-fake-host.ts's client
// in plain JavaScript (u32 LE length + JSON-RPC 2.0; MAWS's hello first, then requests answered by id and notifications
// kept), plus a count of notifications by method and of their bytes, for the screencast-leak reading.
import { connect } from 'node:net';

const frame = (message) => {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const out = Buffer.alloc(4 + body.length);
  out.writeUInt32LE(body.length, 0);
  body.copy(out, 4);
  return out;
};

export function connectCua(path, { helloTimeoutMs = 10_000 } = {}) {
  return new Promise((resolveHost, rejectHost) => {
    const socket = connect(path);
    const connectedAt = Date.now();
    let pending = Buffer.alloc(0);
    let nextId = 0;
    const calls = new Map();
    const waiters = new Set();
    const counts = {}; // method → {n, bytes}
    const timer = setTimeout(() => (socket.destroy(), rejectHost(new Error(`no hello from ${path} within ${helloTimeoutMs} ms`))), helloTimeoutMs);
    let closedResolve;
    const closed = new Promise((resolve) => (closedResolve = resolve));
    const host = {
      counts,
      closed,
      request: (method, params = {}, timeoutMs = 15_000) =>
        new Promise((resolve, reject) => {
          const id = ++nextId;
          const t = setTimeout(() => (calls.delete(id), reject(new Error(`${method}: no answer within ${timeoutMs} ms`))), timeoutMs);
          calls.set(id, { resolve: (v) => (clearTimeout(t), resolve(v)), reject: (e) => (clearTimeout(t), reject(e)) });
          socket.write(frame({ jsonrpc: '2.0', id, method, params }));
        }),
      // the next notification after now that matches
      next: (method, match = () => true, timeoutMs = 5000) =>
        new Promise((resolve, reject) => {
          const waiter = { method, match, resolve: (n) => (clearTimeout(t), resolve(n)) };
          const t = setTimeout(() => (waiters.delete(waiter), reject(new Error(`no ${method} within ${timeoutMs} ms`))), timeoutMs);
          waiters.add(waiter);
        }),
      close: () => (socket.end(), socket.destroy(), closed),
    };
    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 4) {
        const length = pending.readUInt32LE(0);
        if (pending.length < 4 + length) break;
        const message = JSON.parse(pending.subarray(4, 4 + length).toString('utf8'));
        pending = pending.subarray(4 + length);
        if (typeof message.method === 'string') {
          const key = message.method === 'debugger.event' ? `debugger.event ${message.params?.method}` : message.method;
          counts[key] ??= { n: 0, bytes: 0 };
          counts[key].n += 1;
          counts[key].bytes += length;
          if (message.method === 'hello') {
            clearTimeout(timer);
            resolveHost({ ...host, hello: message.params, helloMs: Date.now() - connectedAt });
            continue;
          }
          for (const waiter of [...waiters]) {
            if (waiter.method === message.method && waiter.match(message.params ?? {})) {
              waiters.delete(waiter);
              waiter.resolve({ method: message.method, params: message.params ?? {}, at: Date.now() });
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
    socket.on('error', (error) => (clearTimeout(timer), rejectHost(error)));
    socket.on('close', () => {
      for (const call of calls.values()) call.reject(new Error('the socket closed'));
      calls.clear();
      clearTimeout(timer);
      rejectHost(new Error('the socket closed before the hello (the peer check refused it?)'));
      closedResolve();
    });
  });
}
