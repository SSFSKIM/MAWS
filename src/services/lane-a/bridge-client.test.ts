// The bridge's HTTP client (P5 O9 M2): a subscription the bridge refuses ends, `onEnd` called exactly once, however the
// refusal arrives, a truncated one included, so the driver's backoff takes it from there.
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { subscribe } from './bridge-client';

const scratch: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
});

// A socket whose every connection gets `answer` written raw, then closed.
async function rawSocket(answer: (socket: Socket) => void): Promise<string> {
  const dir = mkdtempSync(join('/tmp', 'o9b-'));
  scratch.push(dir);
  const path = join(dir, 'b.sock');
  const server = createServer((socket) => socket.once('data', () => answer(socket)));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(path, () => resolve()));
  return path;
}

describe('subscribe', () => {
  it('ends a refusal whose body is cut off, once', async () => {
    const path = await rawSocket((socket) => {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"error": "not re');
      socket.destroy();
    });
    const ends: string[] = [];
    subscribe(path, { onLines: () => {}, onEnd: (reason) => ends.push(reason) });
    await expect.poll(() => ends.length, { timeout: 2000 }).toBe(1);
    await new Promise((r) => setTimeout(r, 100));
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatch(/refused the subscription \(503\)/);
  });

  it('ends a whole refusal once', async () => {
    const path = await rawSocket((socket) => socket.end('HTTP/1.1 503 Service Unavailable\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}'));
    const ends: string[] = [];
    subscribe(path, { onLines: () => {}, onEnd: (reason) => ends.push(reason) });
    await expect.poll(() => ends.length, { timeout: 2000 }).toBe(1);
    await new Promise((r) => setTimeout(r, 100));
    expect(ends).toEqual(['the bridge refused the subscription (503)']);
  });

  it('ends a stream cut off mid-line once', async () => {
    const path = await rawSocket((socket) => {
      socket.write('HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nTransfer-Encoding: chunked\r\n\r\n');
      socket.write('5\r\n{"typ\r\n');
      socket.destroy();
    });
    const ends: string[] = [];
    subscribe(path, { onLines: () => {}, onEnd: (reason) => ends.push(reason) });
    await expect.poll(() => ends.length, { timeout: 2000 }).toBe(1);
    await new Promise((r) => setTimeout(r, 100));
    expect(ends).toHaveLength(1);
  });
});
