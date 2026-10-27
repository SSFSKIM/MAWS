// The reference client's sockets that wait for a frame after the upgrade (O11 M7 fix wave 2): when that wait fails, the
// socket is closed before the failure is thrown, since its caller never receives it and so cannot close it. A bare
// WebSocket server upgrades every request and then sends nothing, so each wait times out. The caller's bound covers the
// upgrade too (O11 closing fix wave): a second server takes each request and never answers it, and each opening fails
// within its bound. (Node's WebSocket, closed while connecting, fails the connection but leaves its TCP socket to the
// server: the test asserts the bound, not the drop.)
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RelayApp } from '../test-support/machine-socket.ts';
import { ProjectSocket } from '../test-support/project-socket.ts';
import { RegistrySocket } from '../test-support/registry-socket.ts';

/** Each upgraded connection, and whether the client sent a close frame on it. */
const connections: Array<{ path: string; closed: boolean }> = [];
let server: Server;
let base: string;
const sockets = new Set<Socket>();
let silent: Server;
let silentBase: string;

beforeAll(async () => {
  server = createServer();
  server.on('upgrade', (request, socket: Socket) => {
    const accept = createHash('sha1').update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const connection = { path: request.url ?? '', closed: false };
    connections.push(connection);
    sockets.add(socket);
    // A client frame's first byte carries its opcode in the low four bits; 8 is close.
    socket.on('data', (data: Buffer) => {
      if ((data[0] & 0x0f) === 8) connection.closed = true;
    });
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  base = `http://127.0.0.1:${address.port}`;
  silent = createServer();
  silent.on('upgrade', (_request, socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
  silentBase = `http://127.0.0.1:${(silent.address() as { port: number }).port}`;
});
afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => silent.close(resolve));
});

const closedBy = async (path: RegExp) => {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const connection = connections.find((c) => path.test(c.path));
    if (connection?.closed) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
};

describe('a socket whose readiness never comes', () => {
  it('is closed when the Registry socket’s last listings page does not arrive', async () => {
    await expect(RegistrySocket.open(base, {}, 100)).rejects.toThrow(/the last listings page/);
    expect(await closedBy(/^\/api\/registry\/socket/)).toBe(true);
  });

  it('is closed when the Project socket’s welcome does not arrive', async () => {
    await expect(ProjectSocket.open(base, {}, '00000000-0000-4000-8000-000000000000', 100)).rejects.toThrow(/welcome/);
    expect(await closedBy(/^\/api\/projects\//)).toBe(true);
  });
});

/** How `opening` settled within `ms`: its rejection's message, or 'pending' past `ms`. */
const settledWithin = async (opening: Promise<unknown>, ms: number): Promise<string> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<string>((resolve) => (timer = setTimeout(() => resolve('pending'), ms)));
  const settled = opening.then(
    () => 'opened',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  try {
    return await Promise.race([settled, late]);
  } finally {
    clearTimeout(timer);
  }
};

describe('a socket whose upgrade is never answered', () => {
  it('fails the Registry socket’s opening within its bound', async () => {
    expect(await settledWithin(RegistrySocket.open(silentBase, {}, 50), 1000)).toMatch(/Registry socket.*unanswered/);
  });

  it('fails the Project socket’s opening within its bound', async () => {
    expect(await settledWithin(ProjectSocket.open(silentBase, {}, '00000000-0000-4000-8000-000000000000', 50), 1000)).toMatch(/project .*unanswered/);
  });

  it('fails the Machine socket’s opening within its bound', async () => {
    expect(await settledWithin(RelayApp.open(silentBase, 'a-machine', {}, 50), 1000)).toMatch(/Machine a-machine.*unanswered/);
  });
});
