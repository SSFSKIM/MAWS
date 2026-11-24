// A page server's client, as Node writes one (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, M1 and
// M3's Proves): raw HTTP over `net`, which writes any header and any bytes, each request made to a loopback address with
// its Host set by hand, so nothing depends on how the machine resolves a name; a tab's live connection over `ws`; §L's
// proof as a tab computes it. Every answer received is held to §M's six headers, written out here and not read from the
// code under test. Shared by src/mawsd/process-sheet-page*.test.ts and src/mawsd/sheet-page/*.test.ts.
import { createHmac, randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import { expect } from 'vitest';
import { WebSocket } from 'ws';
import { PROOF_KEY_LABEL, PROOF_MAC_LABEL } from '../../src/mawsd/sheet-page/pairing';

// --- raw HTTP -----------------------------------------------------------------------------------------------------------

export interface Answer {
  status: number;
  headers: Record<string, string[]>;
  body: Buffer;
  closedAfterMs: number;
}

// What one connection was answered, read to its close
export function exchangeBytes(port: number, bytes: string | Buffer, host = '127.0.0.1'): Promise<Answer> {
  return new Promise((done, failed) => {
    const began = Date.now();
    const socket = createConnection({ host, port });
    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => void chunks.push(chunk));
    socket.on('error', (error: NodeJS.ErrnoException) => (error.code === 'ECONNRESET' || error.code === 'EPIPE' ? undefined : failed(error))); // an answer before the body was all sent: read what came
    socket.on('close', () => {
      const answer = parse(Buffer.concat(chunks), Date.now() - began);
      try {
        if (answer.status !== 0) standing(answer, port); // every answer, whatever its status
        done(answer);
      } catch (error) {
        failed(error); // the test's failure, not an uncaught throw it would time out on
      }
    });
    socket.write(bytes);
  });
}

export function parse(bytes: Buffer, closedAfterMs: number): Answer {
  const end = bytes.indexOf('\r\n\r\n');
  if (end < 0) return { status: 0, headers: {}, body: bytes, closedAfterMs };
  const [line, ...lines] = bytes.subarray(0, end).toString('latin1').split('\r\n');
  const headers: Record<string, string[]> = {};
  for (const header of lines) {
    const at = header.indexOf(':');
    (headers[header.slice(0, at).toLowerCase()] ??= []).push(header.slice(at + 1).trim());
  }
  return { status: Number(line!.split(' ')[1]), headers, body: bytes.subarray(end + 4), closedAfterMs };
}

export type Headers = [string, string][];
export const HOST = (port: number): [string, string] => ['Host', `sheet.localhost:${port}`];
export const ORIGIN = (port: number): [string, string] => ['Origin', `http://sheet.localhost:${port}`];
export const JSON_BODY: [string, string] = ['Content-Type', 'application/json'];

export function request(port: number, method: string, target: string, headers: Headers, body: string | Buffer = ''): Promise<Answer> {
  const lines = [`${method} ${target} HTTP/1.1`, ...headers.map(([name, value]) => `${name}: ${value}`), 'Connection: close'];
  if (body.length > 0 || method === 'POST') lines.push(`Content-Length: ${Buffer.byteLength(body)}`);
  return exchangeBytes(port, Buffer.concat([Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'latin1'), Buffer.from(body)]));
}

// The six headers of §M, written out here and not read from the code under test. Every answer the suite receives is held
// to them by the helpers that receive it (exchangeBytes, and Tab for an upgrade's answer).
export const SIX = (port: number): Record<string, string> => ({
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-security-policy': `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://sheet.localhost:${port}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
});
export function standing(answer: { headers: Record<string, string[]> }, port: number): void {
  for (const [name, value] of Object.entries(SIX(port))) expect(answer.headers[name], name).toEqual([value]);
}
export const jsonOf = (answer: Answer) => JSON.parse(answer.body.toString('utf8')) as Record<string, unknown>;

export const macOf = (credential: string, id: string, nonce: string) => {
  const key = createHmac('sha256', Buffer.from(credential, 'base64url')).update(PROOF_KEY_LABEL).digest();
  return createHmac('sha256', key).update(`${PROOF_MAC_LABEL}\n${id}\n${nonce}`).digest('base64url');
};
export const nonce = () => randomBytes(32).toString('base64url');

// --- a tab's live connection --------------------------------------------------------------------------------------------

export class Tab {
  readonly frames: Record<string, unknown>[] = [];
  closed: number | null = null;
  refused: { status: number; headers: Record<string, string[]> } | null = null;
  upgradeHeaders: Record<string, string[]> = {};
  private waiters: (() => void)[] = [];

  private constructor(readonly ws: WebSocket) {}

  static open(port: number, headers: Record<string, string> = {}): Promise<Tab> {
    return Tab.opened(port, headers).then((tab) => {
      if (tab.refused) standing(tab.refused, port);
      else if (tab.closed === null || Object.keys(tab.upgradeHeaders).length > 0) standing({ headers: tab.upgradeHeaders }, port); // the 101 too
      return tab;
    });
  }

  private static opened(port: number, headers: Record<string, string>): Promise<Tab> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/live`, { headers: { Host: `sheet.localhost:${port}`, Origin: `http://sheet.localhost:${port}`, ...headers } });
    const tab = new Tab(ws);
    return new Promise((done) => {
      ws.on('upgrade', (res) => void (tab.upgradeHeaders = asLists(res.headers)));
      ws.on('open', () => done(tab));
      ws.on('unexpected-response', (_req, res) => {
        tab.refused = { status: res.statusCode ?? 0, headers: asLists(res.headers) };
        res.resume();
        ws.terminate();
        done(tab);
      });
      ws.on('error', () => done(tab));
      ws.on('message', (data) => {
        tab.frames.push(JSON.parse(String(data)) as Record<string, unknown>);
        tab.wake();
      });
      ws.on('close', (code) => {
        tab.closed = code;
        tab.wake();
        done(tab);
      });
    });
  }

  send(message: object): void {
    this.ws.send(JSON.stringify(message));
  }

  // The next frame after `seen` of them, or the close
  async next(seen = this.frames.length, ms = 3_000): Promise<Record<string, unknown> | { closed: number }> {
    const until = Date.now() + ms;
    while (this.frames.length <= seen && this.closed === null) {
      if (Date.now() > until) throw new Error('no frame and no close in time');
      await new Promise<void>((done) => {
        this.waiters.push(done);
        setTimeout(done, 50);
      });
    }
    return this.frames.length > seen ? this.frames[seen]! : { closed: this.closed! };
  }

  async closedWith(ms = 3_000): Promise<number> {
    const until = Date.now() + ms;
    while (this.closed === null) {
      if (Date.now() > until) throw new Error('not closed in time');
      await new Promise((done) => setTimeout(done, 20));
    }
    return this.closed;
  }

  private wake(): void {
    for (const waiter of this.waiters.splice(0)) waiter();
  }
}

export const asLists = (headers: Record<string, string | string[] | undefined>) => Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, Array.isArray(value) ? value : [value ?? '']]));

// A tab through the opening up to `paired`
export async function pairedTab(port: number, browser: { id: string; credential: string }): Promise<Tab> {
  const tab = await Tab.open(port);
  const once = nonce();
  tab.send({ t: 'hello', v: 1, id: browser.id, nonce: once });
  expect(await tab.next(0)).toEqual({ t: 'proof', mac: macOf(browser.credential, browser.id, once) });
  tab.send({ t: 'credential', credential: browser.credential });
  expect(await tab.next(1)).toEqual({ t: 'paired' });
  return tab;
}
