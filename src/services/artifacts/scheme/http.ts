// The artifact scheme over HTTP on a unix socket (P5 O5 M2; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md,
// Interfaces §C, §D): the one convention between `mawsd`'s artifact endpoint and the scheme proxy in an Electron process.
// A request is HTTP/1.1 whose path is the `maws-artifact:` URL percent-encoded whole (`/maws-artifact%3A%2F%2F…`), its
// method GET or HEAD, its one header in `Range`; the answer is the handler's, its status and every header it set
// (Content-Length and Content-Range byte-exact, so a media seek through the proxy is the seek the handler answered).
// What the HTTP leg adds of its own (Connection, Keep-Alive, Transfer-Encoding, Date) never reaches the page. Each
// request is one connection (`agent: false`): the endpoint holds no idle connection between a page's loads.
//
// `serveOverHttp` is the endpoint's side (and a test's fake endpoint's), `fetchOverSocket` the proxy's. No Electron:
// the proxy's `protocol.handle` is src/render/scheme.ts's.
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { SchemeHandler } from './artifact-handler';

// The proxy's answer when the endpoint does not answer at all (no socket, nothing listening, the connection lost before
// an answer): one line, never a wait.
export const ENDPOINT_UNAVAILABLE = 'the artifact endpoint is not running';

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-connection', 'proxy-authenticate', 'proxy-authorization', 'date']);
const NO_BODY = new Set([101, 204, 205, 304]); // statuses a Response may not carry a body with

// The request path for a scheme URL.
export const endpointPath = (url: string): string => `/${encodeURIComponent(url)}`;

// The scheme URL a request path names, or null when the path is not exactly one URL as `endpointPath` encodes it.
function urlOfPath(path: string | undefined): string | null {
  if (path === undefined || !path.startsWith('/') || path.length === 1) return null;
  try {
    const url = decodeURIComponent(path.slice(1));
    return endpointPath(url) === path ? url : null;
  } catch {
    return null;
  }
}

const plain = (status: number, body: string): Response => new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });

// Node's request to the handler's, and the handler's answer back. A method but GET and HEAD is 405 and a path that names
// no URL 404, both before the handler is asked; whether a URL is the scheme's exact shape is the handler's resolver's.
export function serveOverHttp(handler: SchemeHandler): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    res.sendDate = false;
    void answer(handler, req).then(
      (response) => write(response, req.method === 'HEAD', res),
      () => write(plain(500, 'the request failed'), false, res),
    );
  };
}

async function answer(handler: SchemeHandler, req: IncomingMessage): Promise<Response> {
  const request = schemeRequest(urlOfPath(req.url), req.method ?? 'GET', req.headers.range);
  return request instanceof Request ? handler(request) : request;
}

// The handler's request for a scheme URL, a method and a `Range`, or the refusal to answer instead: 405 for a method but
// GET and HEAD, 404 for no URL or one that is not a URL at all (the endpoint's `fetch` refuses alike).
export function schemeRequest(url: string | null, method: string, range: string | undefined): Request | Response {
  if (method !== 'GET' && method !== 'HEAD') return plain(405, 'method not allowed');
  try {
    if (url === null) throw new Error('no URL');
    return new Request(url, { method, headers: range === undefined ? {} : { Range: range } });
  } catch {
    return plain(404, 'not found');
  }
}

async function write(response: Response, head: boolean, res: ServerResponse): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => (headers[name] = value));
  // a body the handler built whole (a page with its bridge script, a refusal) gets its length, so the leg never chunks
  if (response.body !== null && !('content-length' in headers) && !head) {
    const bytes = Buffer.from(await response.arrayBuffer());
    headers['content-length'] = String(bytes.length);
    res.writeHead(response.status, headers).end(bytes);
    return;
  }
  res.writeHead(response.status, headers);
  if (response.body === null || head) {
    await response.body?.cancel();
    res.end();
    return;
  }
  // a client gone mid-body ends the read (the file's descriptor closes with the stream)
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>), res).catch(() => {});
}

// The handler's request through the endpoint at `socketPath`: its URL, method and `Range`; the answer streamed back with
// the endpoint's status and headers. 503 with one line when the endpoint does not answer.
export function fetchOverSocket(socketPath: string, request: Request): Promise<Response> {
  return new Promise((resolve) => {
    const range = request.headers.get('Range');
    const req = httpRequest({ socketPath, path: endpointPath(request.url), method: request.method, headers: range === null ? {} : { Range: range }, agent: false });
    req.on('response', (res) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(res.headers)) {
        if (value === undefined || HOP_BY_HOP.has(name)) continue;
        headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      const status = res.statusCode ?? 502;
      if (request.method === 'HEAD' || NO_BODY.has(status)) {
        res.resume();
        return resolve(new Response(null, { status, headers }));
      }
      resolve(new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, { status, headers }));
    });
    req.on('error', () => resolve(plain(503, ENDPOINT_UNAVAILABLE)));
    req.end();
  });
}
