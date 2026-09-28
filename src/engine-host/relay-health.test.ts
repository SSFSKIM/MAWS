import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { checkRelay, RELAY_HEALTH_CACHE_MS, resetRelayHealthCache } from './relay-health';

const servers: Server[] = [];
afterEach(async () => {
  resetRelayHealthCache();
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

function serve(handler: (path: string, res: import('node:http').ServerResponse, req: import('node:http').IncomingMessage) => void): Promise<string> {
  const server = createServer((req, res) => handler(req.url ?? '', res, req));
  servers.push(server);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
}

describe('relay health', () => {
  it('is ok exactly when GET /api/hello answers 200, with Connection: close', async () => {
    const seen: { path: string; connection: string | undefined }[] = [];
    const url = await serve((path, res, req) => {
      seen.push({ path, connection: req.headers.connection });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    const health = await checkRelay(url, 1500);
    expect(health).toMatchObject({ url, ok: true, status: 200, error: null });
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    expect(health.checkedAt).toMatch(/^\d{4}-/);
    expect(seen).toEqual([{ path: '/api/hello', connection: 'close' }]);
  });

  it('is not ok on any other status and reports it', async () => {
    const url = await serve((_, res) => {
      res.writeHead(503);
      res.end('down');
    });
    expect(await checkRelay(url, 1500)).toMatchObject({ ok: false, status: 503, error: 'HTTP 503' });
  });

  it('is not ok when nothing listens, with the error named', async () => {
    const url = await serve((_, res) => res.end());
    await new Promise<void>((resolve) => servers.pop()!.close(() => resolve()));
    const health = await checkRelay(url, 1500);
    expect(health.ok).toBe(false);
    expect(health.status).toBeNull();
    expect(health.error).toMatch(/ECONNREFUSED/);
  });

  it('gives up after the timeout when the relay never answers', async () => {
    const url = await serve(() => {
      /* never answers */
    });
    const started = Date.now();
    const health = await checkRelay(url, 100);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(health).toMatchObject({ ok: false, status: null });
    expect(health.error).toMatch(/timeout/i);
  });

  it('caches a result for 5 s per url unless forced', async () => {
    let hits = 0;
    const url = await serve((_, res) => {
      hits += 1;
      res.writeHead(200);
      res.end();
    });
    expect(RELAY_HEALTH_CACHE_MS).toBe(5_000);
    const first = await checkRelay(url, 1500);
    const second = await checkRelay(url, 1500);
    expect(hits).toBe(1);
    expect(second).toBe(first);
    const forced = await checkRelay(url, 1500, { force: true });
    expect(hits).toBe(2);
    expect(forced).not.toBe(first);
    resetRelayHealthCache();
    await checkRelay(url, 1500);
    expect(hits).toBe(3);
  });
});
