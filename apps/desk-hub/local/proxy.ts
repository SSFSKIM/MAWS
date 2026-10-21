// The stand-in's front door: an HTTP server that does to each request what Access does in front of the deployed hub,
// then passes it to the hub (`wrangler dev`, or the suites' Miniflare) and streams the answer back — SSE and WebSocket
// upgrades included. Its own paths (/standin/…) it answers itself. Node only; run by the local command and the suites.
// Each request to the hub gets a connection of its own (`agent: false`), so requests share nothing: a conservative
// choice after a 502 of unknown cause was seen once on the CI runner, on a request that needed nothing beyond the hub.
import { createServer, request as httpRequest, STATUS_CODES, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { AccessStandin } from './standin.ts';

// What a client may send that Access would not pass on as it came: its own assertion (Access sets the header), the
// service token's headers (consumed into the assertion), and the stand-in's test-identity header.
const STRIPPED = ['cf-access-jwt-assertion', 'cf-access-client-id', 'cf-access-client-secret', 'x-desk-standin-user'];
const HOP_BY_HOP = ['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection'];

export type Proxy = { url: string; port: number; close(): Promise<void> };

export async function startProxy(options: {
  standin: AccessStandin;
  /** The hub's origin, e.g. http://127.0.0.1:8788. Read on every request, so a suite can restart the hub behind it. */
  upstream: () => string;
  port?: number;
  host?: string;
  /** Extra /standin/ paths answered before the stand-in's own (the code helpers, ./helpers.ts). */
  extra?: (request: Request) => Promise<Response | null>;
}): Promise<Proxy> {
  const { standin, upstream } = options;
  const host = options.host ?? '127.0.0.1';
  const sockets = new Set<Socket>();

  const server = createServer((req, res) => {
    void serve(req, res).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'standin', message: String(error) }));
    });
  });

  async function serve(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? host}`);
    if (url.pathname.startsWith('/standin/')) {
      const request = await toRequest(req, url);
      const own = (await options.extra?.(request.clone())) ?? (await standin.handle(request));
      if (own) return writeResponse(res, own);
    }
    const admission = await standin.admit(url.pathname, req.headers);
    if (admission.kind === 'refuse') {
      res.writeHead(admission.status, { 'content-type': admission.contentType });
      return res.end(admission.body);
    }
    const target = new URL(upstream());
    const forwarded = req.pipe(
      httpRequest({ host: target.hostname, port: target.port, method: req.method, path: req.url, headers: outgoing(req.headers, target, admission), agent: false }, (up) => {
        res.writeHead(up.statusCode ?? 502, incoming(up.headers));
        res.flushHeaders();
        up.pipe(res);
      }),
    );
    forwarded.on('error', (error) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'upstream', message: error.message }));
    });
    // A client that goes away before its answer is done takes its upstream request with it, so the hub sees an SSE
    // stream close. The connection is reset, not closed: workerd notices a graceful close of a streaming response only
    // when its next write fails (a heartbeat later), and a reset at once, as Cloudflare's edge passes a close on at once.
    // (`close` also follows a finished answer; destroying then would be at best useless.)
    res.on('close', () => {
      if (res.writableFinished) return;
      forwarded.socket?.resetAndDestroy();
      forwarded.destroy();
    });
  }

  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? host}`);
      const admission = await standin.admit(url.pathname, req.headers);
      if (admission.kind === 'refuse') {
        const { status, contentType, body } = admission;
        socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\ncontent-type: ${contentType}\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`);
        return;
      }
      const target = new URL(upstream());
      const headers = outgoing(req.headers, target, admission);
      headers.connection = 'Upgrade';
      headers.upgrade = req.headers.upgrade ?? 'websocket';
      const up = httpRequest({ host: target.hostname, port: target.port, method: req.method, path: req.url, headers, agent: false });
      up.on('upgrade', (upRes, upSocket, upHead) => {
        const lines = [`HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage}`];
        for (let i = 0; i < upRes.rawHeaders.length; i += 2) lines.push(`${upRes.rawHeaders[i]}: ${upRes.rawHeaders[i + 1]}`);
        socket.write(`${lines.join('\r\n')}\r\n\r\n`);
        if (upHead.length) socket.write(upHead);
        if (head.length) upSocket.write(head);
        upSocket.pipe(socket).pipe(upSocket);
        upSocket.on('error', () => socket.destroy());
        socket.on('error', () => upSocket.destroy());
        socket.on('close', () => upSocket.destroy());
        upSocket.on('close', () => socket.destroy());
      });
      // The hub answered without upgrading (a refusal): pass its answer on and close.
      up.on('response', (upRes) => {
        const lines = [`HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage}`];
        for (const [name, value] of Object.entries(incoming(upRes.headers))) if (name !== 'content-length') lines.push(`${name}: ${value}`);
        const chunks: Buffer[] = [];
        upRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        upRes.on('end', () => {
          const body = Buffer.concat(chunks);
          socket.end(`${lines.join('\r\n')}\r\ncontent-length: ${body.length}\r\nconnection: close\r\n\r\n${body.toString('utf8')}`);
        });
      });
      up.on('error', () => socket.destroy());
      up.end();
    })().catch(() => socket.destroy());
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, host, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://${host}:${port}`,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

function outgoing(headers: IncomingHttpHeaders, target: URL, admission: { kind: 'bypass' } | { kind: 'assert'; assertion: string }) {
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || STRIPPED.includes(name) || HOP_BY_HOP.includes(name)) continue;
    out[name] = value;
  }
  out.host = target.host;
  if (admission.kind === 'assert') out['cf-access-jwt-assertion'] = admission.assertion;
  return out;
}

function incoming(headers: IncomingHttpHeaders) {
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) if (value !== undefined && !HOP_BY_HOP.includes(name)) out[name] = value;
  return out;
}

/** The stand-in's own requests, whose bodies are small; the hub's requests are piped, never read. */
async function toRequest(req: IncomingMessage, url: URL): Promise<Request> {
  const chunks: Buffer[] = [];
  if (req.method !== 'GET' && req.method !== 'HEAD') for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value);
  return new Request(url, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
}

async function writeResponse(res: ServerResponse, response: Response) {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => (headers[name] = value));
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}
