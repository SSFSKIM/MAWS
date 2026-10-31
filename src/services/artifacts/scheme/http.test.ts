// P5 O5 M2 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §C, §D): the artifact scheme over HTTP on a
// unix socket, both ends. `serveOverHttp` is the artifact endpoint's adapter from Node's request to the handler's, and
// `fetchOverSocket` the scheme proxy's from the handler's request to the endpoint's answer; between them an answer
// arrives exactly as the handler made it (status, every header it set, the bytes), so the proxy is invisible to a page.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ArtifactKind } from '@shared/artifacts/entity';
import { artifactUrl } from '@shared/artifacts/scheme';
import type { CommandInput, CommandResult } from '@shared/ipc/schema';
import { createArtifactHandler, type SchemeHandler } from './artifact-handler';
import { BRIDGE_SCRIPT } from './bridge-script';
import { ENDPOINT_UNAVAILABLE, endpointPath, fetchOverSocket, serveOverHttp } from './http';

const PAGE = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const DOC = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const ASSET = randomBytes(1_000);
const LARGE = randomBytes(3 * 1024 * 1024 + 17);

let root: string;
let socketPath: string;
let server: Server;
let asked: CommandInput<'artifacts.content'>[];
let files: Map<string, { kind: ArtifactKind; path: string; name: string }>;
let direct: SchemeHandler;

function hold(artifactId: string, path: string, kind: ArtifactKind, bytes: string | Buffer): void {
  const file = join(root, `${artifactId}-${files.size}`);
  writeFileSync(file, bytes);
  files.set(`${artifactId} ${path}`, { kind, path: file, name: path.split('/').at(-1)! });
}

beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-scheme-http-')));
  socketPath = join(root, 'artifacts.sock');
  asked = [];
  files = new Map();
  direct = createArtifactHandler(async (input) => {
    asked.push(input);
    const found = files.get(`${input.artifactId} ${input.path}`);
    if (!found) return { ok: false, error: { code: 'invalid_input', message: 'not found' } } as CommandResult<'artifacts.content'>;
    return { ok: true, value: { revision: 1, kind: found.kind, name: found.name, size: 0, sha256: 'x', path: found.path } };
  });
  server = createServer(serveOverHttp(direct));
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  hold(PAGE, 'index.html', 'html', '<!doctype html><html><head><title>t</title></head><body><p>page</p></body></html>');
  hold(PAGE, 'assets/blob', 'html', ASSET);
  hold(PAGE, 'assets/large', 'html', LARGE);
  hold(DOC, 'assets/report.pdf', 'document', '%PDF-1.7 a report');
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

const proxied = (url: string, init: RequestInit = {}) => fetchOverSocket(socketPath, new Request(url, init));
const headersOf = (response: Response) => Object.fromEntries(response.headers);
const bytesOf = async (response: Response) => Buffer.from(await response.arrayBuffer());

// A raw request on the socket, as any HTTP client would send it: its status, headers and body
function raw(path: string, method = 'GET'): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ socketPath, path, method, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('the artifact scheme over HTTP (serveOverHttp at the endpoint, fetchOverSocket at the proxy)', () => {
  it('answers a page through the socket exactly as the handler answers it: the status, every header, the bridge script once', async () => {
    const url = artifactUrl(PAGE, 'live', 'index.html');
    const [through, at] = await Promise.all([proxied(url), direct(new Request(url))]);
    expect(through.status).toBe(200);
    expect(headersOf(through)).toEqual(headersOf(at));
    expect(Object.keys(headersOf(through)).sort()).toEqual(['accept-ranges', 'access-control-allow-origin', 'cache-control', 'content-disposition', 'content-length', 'content-security-policy', 'content-type', 'x-content-type-options']);
    const text = (await bytesOf(through)).toString('utf8');
    expect(text).toBe((await bytesOf(at)).toString('utf8'));
    expect(text.split(BRIDGE_SCRIPT)).toHaveLength(2);
  });

  it('carries an asset byte for byte, a large one streamed whole, and a PDF with no frame policy', async () => {
    expect((await bytesOf(await proxied(artifactUrl(PAGE, 'live', 'assets/blob')))).equals(ASSET)).toBe(true);
    const large = await proxied(artifactUrl(PAGE, 'live', 'assets/large'));
    expect(large.headers.get('content-length')).toBe(String(LARGE.length));
    expect((await bytesOf(large)).equals(LARGE)).toBe(true);
    const pdf = await proxied(artifactUrl(DOC, 'live', 'assets/report.pdf'));
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.headers.get('content-security-policy')).toBeNull();
    expect(pdf.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('relays a range 206 with the same Content-Range and Content-Length, and a range past the end 416 with bytes */<size>', async () => {
    const url = artifactUrl(PAGE, 'live', 'assets/blob');
    const part = await proxied(url, { headers: { Range: 'bytes=100-199' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 100-199/1000');
    expect(part.headers.get('content-length')).toBe('100');
    expect((await bytesOf(part)).equals(ASSET.subarray(100, 200))).toBe(true);
    const tail = await proxied(url, { headers: { Range: 'bytes=-10' } });
    expect(tail.headers.get('content-range')).toBe('bytes 990-999/1000');
    expect((await bytesOf(tail)).equals(ASSET.subarray(990))).toBe(true);
    const past = await proxied(url, { headers: { Range: 'bytes=1000-' } });
    expect(past.status).toBe(416);
    expect(past.headers.get('content-range')).toBe('bytes */1000');
  });

  it('answers HEAD with the headers and no body', async () => {
    const head = await proxied(artifactUrl(PAGE, 'live', 'assets/blob'), { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('1000');
    expect(head.body).toBeNull();
  });

  it('carries none of the hop-by-hop headers of the HTTP leg', async () => {
    const answer = await proxied(artifactUrl(PAGE, 'live', 'index.html'));
    for (const name of ['connection', 'keep-alive', 'transfer-encoding', 'date']) expect(answer.headers.has(name), name).toBe(false);
    const missing = await proxied(artifactUrl(PAGE, 'live', 'nothing.html'));
    expect(missing.status).toBe(404);
    expect(missing.headers.has('transfer-encoding')).toBe(false);
  });

  it('answers 404 before any dispatch for a request that is not exactly a scheme URL, and 405 for a method but GET and HEAD', async () => {
    for (const path of ['/index.html', '/', `/${artifactUrl(PAGE, 'live', 'index.html')}`, endpointPath('https://example.com/x'), endpointPath(`maws-artifact://report/live/index.html`), endpointPath(`maws-artifact://${PAGE}/latest/index.html`), '/%E0%A4%A']) {
      expect((await raw(path)).status, path).toBe(404);
    }
    expect(asked).toEqual([]);
    expect((await raw(endpointPath(artifactUrl(PAGE, 'live', 'index.html')), 'POST')).status).toBe(405);
    expect((await raw(endpointPath(artifactUrl(PAGE, 'live', 'index.html')), 'DELETE')).status).toBe(405);
    expect(asked).toEqual([]);
    expect((await raw(endpointPath(artifactUrl(PAGE, 'live', 'index.html')))).status).toBe(200);
  });

  it('answers 503 with one line, at once, when nothing listens at the socket', async () => {
    const started = Date.now();
    const absent = await fetchOverSocket(join(root, 'none.sock'), new Request(artifactUrl(PAGE, 'live', 'index.html')));
    expect(absent.status).toBe(503);
    expect(await absent.text()).toBe(ENDPOINT_UNAVAILABLE);
    expect(ENDPOINT_UNAVAILABLE).not.toContain('\n');
    writeFileSync(join(root, 'stale.sock'), ''); // a file where a socket was: refused as well
    expect((await fetchOverSocket(join(root, 'stale.sock'), new Request(artifactUrl(PAGE, 'live', 'index.html')))).status).toBe(503);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
