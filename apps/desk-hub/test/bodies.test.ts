// A request body is read only to its limit: a body past it is refused as soon as it passes, never read whole first
// (panel finding scalpel-5#1). Each body here sends past its limit with no Content-Length and then stalls, so a hub that
// reads it whole before checking never answers.
import { request as httpRequest } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST_LIMIT } from '../src/protocol/machine';
import { enroll, MachineClient } from './support/clients';
import { ADMIN, startLocalHub, type LocalHub } from './support/local';

let hub: LocalHub;
beforeAll(async () => {
  hub = await startLocalHub();
});
afterAll(() => hub?.close());

/** Sends `bytes` of a chunked body through the stand-in and leaves the request open; the answer's status and how long
 * it took, or 'none' when there is no answer within `ms`. */
function stalledPost(path: string, headers: Record<string, string>, bytes: number, ms = 10_000): Promise<{ status: number | 'none'; ms: number }> {
  const url = new URL(path, hub.url);
  const started = Date.now();
  return new Promise((resolve) => {
    const req = httpRequest({ host: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { ...headers, 'transfer-encoding': 'chunked' } });
    const timer = setTimeout(() => {
      req.destroy();
      resolve({ status: 'none', ms: Date.now() - started });
    }, ms);
    req.on('response', (res) => {
      clearTimeout(timer);
      res.resume();
      resolve({ status: res.statusCode ?? 0, ms: Date.now() - started });
      req.destroy();
    });
    req.on('error', () => {});
    const chunk = Buffer.alloc(64 * 1024, 0x20);
    for (let sent = 0; sent < bytes; sent += chunk.length) req.write(chunk);
    // ...and nothing more: the body never ends.
  });
}

describe('a body past its limit, which then stalls', () => {
  it("is refused on enrollment's anonymous redeem path once it passes 64 KiB", async () => {
    const answer = await stalledPost('/machine/enroll', { 'content-type': 'application/json' }, 128 * 1024);
    expect(answer.status).toBe(400);
  });

  it("is refused on a machine's POST once it passes 4 MiB", async () => {
    const creds = await enroll(hub, ADMIN, 'big-poster');
    const machine = new MachineClient(hub, 'big-poster', creds);
    await machine.connect();
    const answer = await stalledPost(
      '/machine/frames',
      { 'CF-Access-Client-Id': creds.clientId, 'CF-Access-Client-Secret': creds.clientSecret, 'content-type': 'application/x-ndjson', 'X-Desk-Generation': String(machine.generation) },
      POST_LIMIT + 128 * 1024,
    );
    expect(answer.status).toBe(413);
    await machine.close();
  });
});
