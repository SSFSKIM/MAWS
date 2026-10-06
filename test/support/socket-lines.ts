// Test support for the socket layer's suites (socket-port, socket-server, the detached entry): a Unix socket in a
// fresh temp directory, and a raw line client that records every parsed line it receives.
import { mkdtempSync, rmSync } from 'node:fs';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { splitLines } from '@shared/host/socket-protocol';

export interface TempSocket {
  dir: string;
  path: string;
  server: Server;
  dispose(): Promise<void>;
}

// A listening server on `<temp>/s.sock` (short, so it fits sun_path wherever tmpdir is).
export async function listenTemp(server: Server = createServer()): Promise<TempSocket> {
  const dir = mkdtempSync(join(tmpdir(), 'maws-sock-'));
  const path = join(dir, 's.sock');
  const accepted = new Set<Socket>();
  server.on('connection', (socket) => {
    accepted.add(socket);
    socket.on('close', () => accepted.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => resolve());
  });
  return {
    dir,
    path,
    server,
    async dispose() {
      for (const socket of accepted) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface LineClient {
  socket: Socket;
  lines: unknown[];
  send(message: unknown): void;
  sendRaw(text: string): void;
  next(predicate?: (line: unknown) => boolean): Promise<unknown>;
  closed: Promise<void>;
  isClosed(): boolean;
}

export async function connectLines(path: string): Promise<LineClient> {
  const socket = createConnection(path);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('error', reject);
  });
  const lines: unknown[] = [];
  const waiters: { predicate: (line: unknown) => boolean; resolve: (line: unknown) => void }[] = [];
  let closed = false;
  const settle = () => {
    for (const waiter of [...waiters]) {
      const found = lines.find(waiter.predicate);
      if (found !== undefined) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(found);
      }
    }
  };
  const splitter = splitLines(
    (line) => {
      lines.push(JSON.parse(line));
      settle();
    },
    () => socket.destroy(),
  );
  socket.on('data', (chunk: Buffer) => splitter.push(chunk));
  socket.on('error', () => {});
  const closedPromise = new Promise<void>((resolve) => socket.on('close', () => ((closed = true), resolve())));
  return {
    socket,
    lines,
    send: (message) => socket.write(`${JSON.stringify(message)}\n`),
    sendRaw: (text) => socket.write(text),
    next(predicate = () => true) {
      return new Promise((resolve) => {
        waiters.push({ predicate, resolve });
        settle();
      });
    },
    closed: closedPromise,
    isClosed: () => closed,
  };
}
