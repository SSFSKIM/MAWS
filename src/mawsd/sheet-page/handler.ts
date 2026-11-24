// What answers the page server's requests (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, §J, §L;
// T7 to T13, T28): the routes, the pairing, the bundle's table and the opening of the live connection. A chunk serve.ts
// loads at the first request or the first pairing command, never at the daemon's start; `ws` comes with it.
//
// Each request meets the three checks (checks.ts) in their fixed order before anything else of it is read. The live
// connection (§L's opening): the tab speaks first with its browser's id and a fresh nonce, the server answers the MAC
// only the `mawsd` that browser was paired with can make (pairing.ts's `prove`), and only then does the tab send its
// credential; the server says nothing before the hello and nothing of any sheet before the credential was checked. Each
// step has `helloMs`; at most LIVE_MAX connections, LIVE_UNPAIRED_MAX of them not yet paired on the connection; frames
// of at most FRAME_MAX bytes; a ping every `pingMs`, and one silent for `silentMs` is ended. A browser revoked while
// connected is closed with 4403. A connection the server closes is ended CLOSE_GRACE_MS later whether or not the peer
// answered the close (`ws` would wait 30 s for a peer that never does).
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { SpineState } from '../spine-seam';
import { admit } from './checks';
import { isRefusal, refusal, refusalBytes, refusalHeaders, STANDING_HEADERS, type Refusal } from './headers';
import { createPairing, type BrowserList } from './pairing';
import type { SheetAccess } from './serve';
import { readBundle, type BundleFile, type BundleTable } from './static';
import type { SheetPageTiming } from './timing';

export const LIVE_MAX = 32;
export const LIVE_UNPAIRED_MAX = 8;
export const FRAME_MAX = 4 * 1024;
export const CODE_BODY_MAX = 1024; // the exchange's `{ "code" }`, and unpair's (empty) body
export const CLOSE_GRACE_MS = 1_000; // a connection the server closed is ended this long after, answered or not

// §L's close codes
export const CLOSE = { refused: 4401, unpaired: 4403, unexpected: 1008, stopping: 1001 } as const;

export interface HandlerDeps {
  port(): number; // the page's port when it answers (a handler a command loaded may come before the bind)
  bundleDir: string;
  file: string; // <profile>/mawsd/sheet-page.json
  sheets: SheetAccess;
  spine: SpineState; // the spine's state when the chunk loaded
  log(line: string): void;
  now(): number;
  write?(file: string, text: string): void; // a test's replace of the browsers' file that fails
  timing: SheetPageTiming;
}

export interface SheetPageHandler {
  request(req: IncomingMessage, res: ServerResponse): void;
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  pair(): { code: string; expiresAt: string };
  browsers(): BrowserList;
  unpair(id: string | null): { removed: number; saved: boolean; why?: string };
  connections(): number; // the live connections paired on the connection
  spineState(state: SpineState): void;
  tick(): void; // the page server's timer: a replace of the browsers' file still owed
  close(): void; // every live connection closed, 1001
}

export type SheetPageChunk = { createSheetPageHandler(deps: HandlerDeps): Promise<SheetPageHandler> };

// Closes with `code`, and ends the socket after the grace whatever the peer does
function closeWith(ws: WebSocket, code: number, reason: string): void {
  ws.close(code, reason);
  setTimeout(() => ws.terminate(), CLOSE_GRACE_MS).unref();
}

const BROWSER_ID = /^[0-9a-f]{8}$/;
const NONCE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes in base64url, unpadded
const WEBSOCKET_KEY = /^[+/0-9A-Za-z]{22}==$/;

interface Live {
  ws: WebSocket;
  step: 'hello' | 'credential' | 'paired';
  browser: string | null; // the id its hello named
  heard: number;
  listed: number; // when it last asked for a snapshot
}

export async function createSheetPageHandler(deps: HandlerDeps): Promise<SheetPageHandler> {
  const { timing, log } = deps;
  // the bundle's table, read at the first request that needs it: a command loads this chunk in any state, no-bundle too
  let table: Promise<BundleTable> | null = null;
  const bundle = (): Promise<BundleTable> =>
    (table ??= readBundle(deps.bundleDir).catch((error: unknown) => {
      table = null;
      throw error;
    }));
  const pairing = createPairing({ file: deps.file, ...(deps.write && { write: deps.write }), now: deps.now, random: randomBytes, log, timing });
  const live = new Set<Live>();
  let spine = deps.spine;
  const wss = new WebSocketServer({ noServer: true, maxPayload: FRAME_MAX, perMessageDeflate: false, clientTracking: false });
  wss.on('headers', (headers: string[]) => {
    for (const [name, value] of Object.entries(STANDING_HEADERS(deps.port()))) headers.push(`${name}: ${value}`); // the 101 too
  });
  pairing.onRevoked((id) => {
    for (const connection of live) if (connection.browser === id && connection.step === 'paired') closeWith(connection.ws, CLOSE.unpaired, 'unpaired');
  });

  const refuse = (res: ServerResponse, refused: Refusal) => void res.writeHead(refused.status, refusalHeaders(deps.port(), refused)).end(refused.body);
  const json = (res: ServerResponse, status: number, value: unknown) => {
    const body = JSON.stringify(value);
    res.writeHead(status, { ...STANDING_HEADERS(deps.port()), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': String(Buffer.byteLength(body)) }).end(body);
  };

  async function sendFile(req: IncomingMessage, res: ServerResponse, file: BundleFile): Promise<void> {
    const headers = { ...STANDING_HEADERS(deps.port()), 'Cache-Control': 'no-cache', ETag: file.etag };
    if (req.headers['if-none-match'] === file.etag) return void res.writeHead(304, headers).end();
    let bytes: Buffer;
    try {
      bytes = await file.read();
    } catch {
      return refuse(res, refusal(404)); // gone from under the table
    }
    res.writeHead(200, { ...headers, 'Content-Type': file.type, 'Content-Length': String(bytes.length) }).end(bytes);
  }

  // The body, refused as soon as it is known to pass `max`; 'aborted' when the request ended before its body did, after
  // which nothing changes and nothing is answered
  function readBody(req: IncomingMessage, max: number): Promise<Buffer | 'too-large' | 'aborted'> {
    if (Number(req.headers['content-length'] ?? 0) > max) return Promise.resolve('too-large');
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > max) {
          req.removeAllListeners('data');
          req.pause();
          return resolve('too-large');
        }
        chunks.push(chunk);
      });
      req.once('end', () => resolve(Buffer.concat(chunks)));
      req.once('error', () => resolve('aborted'));
      req.once('close', () => {
        if (!req.complete) resolve('aborted');
      });
    });
  }

  async function exchange(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req, CODE_BODY_MAX);
    if (body === 'aborted') return;
    if (body === 'too-large') return refuse(res, refusal(413));
    let code: unknown;
    try {
      code = (JSON.parse(body.toString('utf8')) as { code?: unknown }).code;
    } catch {
      return refuse(res, refusal(400));
    }
    if (typeof code !== 'string') return refuse(res, refusal(400));
    const answer = pairing.exchange(code, req.headers['user-agent'] ?? '');
    if (answer.ok) return json(res, 200, { id: answer.id, credential: answer.credential });
    if (answer.why === 'busy') return json(res, 429, { why: 'busy' });
    if (answer.why === 'not-saved') return json(res, 503, { why: 'not-saved' });
    json(res, 403, { why: answer.why, ...(answer.left !== undefined && { left: answer.left }) });
  }

  async function unpair(req: IncomingMessage, res: ServerResponse, credential: string): Promise<void> {
    const browser = pairing.check(credential);
    if (browser === null) return refuse(res, refusal(401));
    const body = await readBody(req, CODE_BODY_MAX);
    if (body === 'aborted') return;
    if (body === 'too-large') return refuse(res, refusal(413));
    const { saved } = pairing.revoke(browser.id);
    if (saved) return void res.writeHead(204, { ...STANDING_HEADERS(deps.port()), 'Cache-Control': 'no-store' }).end();
    json(res, 500, { why: 'not-saved' });
  }

  // --- the live connection ------------------------------------------------------------------------------------------
  const send = (connection: Live, message: object) => {
    if (connection.ws.readyState === connection.ws.OPEN) connection.ws.send(JSON.stringify(message));
  };
  // What a paired connection is told of the sheets. Until M3 the access is a stand-in that refuses, so it is told
  // `unavailable`; M3 sends the snapshot when the service answers.
  const tellSheets = (connection: Live) => {
    deps.sheets.service().then(
      () => send(connection, { t: 'unavailable', why: 'no-service' }),
      (error: unknown) => send(connection, { t: 'unavailable', why: whyOf(error) }),
    );
  };

  function open(ws: WebSocket): void {
    const connection: Live = { ws, step: 'hello', browser: null, heard: Date.now(), listed: 0 };
    live.add(connection);
    const late = () => closeWith(ws, CLOSE.refused, 'too late');
    let deadline = setTimeout(late, timing.helloMs);
    const ping = setInterval(() => {
      if (Date.now() - connection.heard >= timing.silentMs) return void ws.terminate();
      // a browser no longer paired (aged past its idle bound) leaves no socket paired; a live one's presence is its use
      if (connection.step === 'paired' && !pairing.seen(connection.browser!)) return closeWith(ws, CLOSE.unpaired, 'unpaired');
      ws.ping();
    }, timing.pingMs);
    ws.on('pong', () => void (connection.heard = Date.now()));
    ws.on('error', () => {});
    ws.on('close', () => {
      clearTimeout(deadline);
      clearInterval(ping);
      live.delete(connection);
    });
    ws.on('message', (data: RawData, binary: boolean) => {
      connection.heard = Date.now();
      const message = binary ? null : parsed(data);
      if (message === null) return closeWith(ws, CLOSE.unexpected, 'unexpected');
      if (connection.step === 'hello') {
        const { t, v, id, nonce } = message;
        if (t !== 'hello' || v !== 1 || typeof id !== 'string' || !BROWSER_ID.test(id) || typeof nonce !== 'string' || !NONCE.test(nonce)) return closeWith(ws, CLOSE.unexpected, 'unexpected');
        const mac = pairing.prove(id, nonce);
        if (mac === null) return closeWith(ws, CLOSE.refused, 'not known');
        connection.browser = id;
        connection.step = 'credential';
        clearTimeout(deadline);
        deadline = setTimeout(late, timing.helloMs);
        return send(connection, { t: 'proof', mac });
      }
      if (connection.step === 'credential') {
        if (message.t !== 'credential' || typeof message.credential !== 'string') return closeWith(ws, CLOSE.unexpected, 'unexpected');
        if (pairing.check(message.credential)?.id !== connection.browser) return closeWith(ws, CLOSE.refused, 'refused');
        clearTimeout(deadline);
        connection.step = 'paired';
        connection.listed = Date.now();
        send(connection, { t: 'paired' });
        return tellSheets(connection);
      }
      if (message.t !== 'list') return closeWith(ws, CLOSE.unexpected, 'unexpected');
      if (Date.now() - connection.listed < 1_000) return; // one sooner than a second after the last is ignored (§N)
      connection.listed = Date.now();
      tellSheets(connection);
    });
  }

  const unpaired = () => [...live].filter((connection) => connection.step !== 'paired').length;

  return {
    request(req, res) {
      const verdict = admit({ method: req.method ?? '', target: req.url ?? '', rawHeaders: req.rawHeaders, upgrade: false }, deps.port());
      if (isRefusal(verdict)) return refuse(res, verdict);
      const { route, credential } = verdict;
      const failed = (error: unknown) => {
        log(`a request failed: ${error instanceof Error ? error.message : String(error)}`);
        if (!res.headersSent) refuse(res, refusal(500));
      };
      switch (route.kind) {
        case 'shell':
        case 'file':
          return void bundle().then(
            (read) => {
              const file = route.kind === 'shell' ? read.shell : read.get(route.path);
              return file === null ? refuse(res, refusal(404)) : sendFile(req, res, file);
            },
            () => refuse(res, refusal(503)),
          ).catch(failed);
        case 'pair':
          return void exchange(req, res).catch(failed);
        case 'unpair':
          return void unpair(req, res, credential!).catch(failed);
        case 'live':
          return refuse(res, refusal(400)); // admit refuses it first: a live connection arrives as an upgrade
      }
    },

    upgrade(req, socket, head) {
      socket.on('error', () => {});
      const end = (refused: Refusal) => void socket.end(refusalBytes(deps.port(), refused), () => socket.destroy());
      const verdict = admit({ method: req.method ?? '', target: req.url ?? '', rawHeaders: req.rawHeaders, upgrade: true }, deps.port());
      if (isRefusal(verdict)) return end(verdict);
      // what `ws` would refuse with an answer of its own, refused here first, with the standing headers
      const { upgrade, 'sec-websocket-version': version, 'sec-websocket-key': key, 'sec-websocket-protocol': protocol } = req.headers;
      if (upgrade?.toLowerCase() !== 'websocket' || version !== '13' || typeof key !== 'string' || !WEBSOCKET_KEY.test(key) || protocol !== undefined) return end(refusal(400));
      if (live.size >= LIVE_MAX || unpaired() >= LIVE_UNPAIRED_MAX) return end(refusal(503));
      wss.handleUpgrade(req, socket, head, open);
    },

    pair: () => pairing.mint(),
    browsers: () => pairing.list(),
    unpair(id) {
      const { ids, saved, why } = pairing.revoke(id);
      return { removed: ids.length, saved, ...(why !== undefined && { why }) };
    },
    connections: () => [...live].filter((connection) => connection.step === 'paired').length,
    spineState(state) {
      spine = state;
      // T15: a spine that cannot be had is said on every paired connection, which stays open (it is the tab's proof)
      if (spine !== 'refused' && spine !== 'yielded') return;
      for (const connection of live) if (connection.step === 'paired') send(connection, { t: 'unavailable', why: spine });
    },
    tick: () => void pairing.retry(),
    close() {
      for (const connection of live) closeWith(connection.ws, CLOSE.stopping, 'mawsd is stopping');
    },
  };
}

// A text frame's one JSON object, or null
function parsed(data: RawData): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.concat(data as Buffer[]).toString('utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const whyOf = (error: unknown): string => {
  const why = (error as { why?: unknown } | null)?.why;
  return typeof why === 'string' ? why : 'no-service';
};
