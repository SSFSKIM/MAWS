// P5 O5 M2 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, M2's Proves; Interfaces §C): `mawsd`'s artifact
// endpoint over a real unix socket, its handler the real scheme library over a content lookup that stands in for the
// engine host's `artifacts.content`. Nothing loads before the first use; a connection made while the library loads is
// answered once it is in; a load that fails answers 503 and the next use loads again; `fetch` answers as the socket
// does; `close` ends the connections it holds.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { artifactUrl } from '@shared/artifacts/scheme';
import type { CommandInput, CommandResult } from '@shared/ipc/schema';
import { ENDPOINT_UNAVAILABLE, endpointPath, fetchOverSocket } from '../services/artifacts/scheme/http';
import { createArtifactsEndpoint, type ArtifactsEndpoint, type EndpointChunk } from './artifacts-endpoint';

const PAGE = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const ASSET = randomBytes(500);

let root: string;
let socketPath: string;
let endpoint: ArtifactsEndpoint | null;
let server: Server | null;
let asked: CommandInput<'artifacts.content'>[];
let lines: string[];
let loads: number;
let gate: Promise<void> | null;
let failNext: Error | null;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-artifacts-endpoint-')));
  socketPath = join(root, 'artifacts.sock');
  writeFileSync(join(root, 'page'), '<!doctype html><head></head><p>page</p>');
  writeFileSync(join(root, 'asset'), ASSET);
  asked = [];
  lines = [];
  loads = 0;
  gate = null;
  failNext = null;
  endpoint = null;
  server = null;
});

afterEach(async () => {
  endpoint?.close();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

const content = async (input: CommandInput<'artifacts.content'>): Promise<CommandResult<'artifacts.content'>> => {
  asked.push(input);
  const file = input.path === 'index.html' ? 'page' : input.path === 'assets/a' ? 'asset' : null;
  if (file === null) return { ok: false, error: { code: 'invalid_input', message: 'not found' } } as CommandResult<'artifacts.content'>;
  return { ok: true, value: { revision: 1, kind: 'html', name: input.path!.split('/').at(-1)!, size: 0, sha256: 'x', path: join(root, file) } };
};

// The real chunk, counted, held at `gate` and failed once with `failNext`
const load = async (): Promise<EndpointChunk> => {
  loads += 1;
  if (gate) await gate;
  if (failNext) {
    const error = failNext;
    failNext = null;
    throw error;
  }
  return import('../services/artifacts/scheme/endpoint-library');
};

async function serve(): Promise<ArtifactsEndpoint> {
  endpoint = createArtifactsEndpoint({ content, load, log: (line) => void lines.push(line) });
  server = endpoint.server;
  await new Promise<void>((resolve) => server!.listen(socketPath, resolve));
  return endpoint;
}

const get = (path: string, init: RequestInit = {}) => fetchOverSocket(socketPath, new Request(artifactUrl(PAGE, 'live', path), init));

describe('the artifact endpoint (artifacts.sock)', () => {
  it('loads nothing until its first connection, then the library once, and counts the requests the handler answers', async () => {
    const at = await serve();
    expect(loads).toBe(0);
    expect(at.status()).toEqual({ loaded: false, requests: 0 });
    const page = await get('index.html');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('data-maws-bridge');
    expect((await get('assets/a', { headers: { Range: 'bytes=10-19' } })).headers.get('content-range')).toBe('bytes 10-19/500');
    expect(loads).toBe(1);
    expect(at.status()).toEqual({ loaded: true, requests: 2 });
    expect(lines).toEqual(['the artifact endpoint’s handler loaded at its first use']);
  });

  it('answers a connection made while the library loads, its request sent before the load ended', async () => {
    let release!: () => void;
    gate = new Promise((resolve) => (release = resolve));
    await serve();
    const answered = get('index.html');
    await new Promise((resolve) => setTimeout(resolve, 50)); // the request is written and waits, unread
    expect(loads).toBe(1);
    release();
    expect((await answered).status).toBe(200);
  });

  it('answers 503 in one line when the library cannot load, and loads it again at the next use', async () => {
    failNext = new Error('mawsd’s bundle was replaced');
    await serve();
    const refused = await get('index.html');
    expect(refused.status).toBe(503);
    expect(await refused.text()).toBe('the artifact endpoint could not load: mawsd’s bundle was replaced');
    expect(lines).toContain('the artifact endpoint’s handler could not load: mawsd’s bundle was replaced');
    expect((await get('index.html')).status).toBe(200);
    expect(loads).toBe(2);
  });

  it('fetch: the socket’s answer for a URL, a range and HEAD; a URL not of the scheme’s shape 404 before the host is asked, a method but GET and HEAD 405', async () => {
    const at = await serve();
    const whole = await at.fetch({ url: artifactUrl(PAGE, 'live', 'assets/a'), method: 'GET' });
    expect(whole.status).toBe(200);
    expect(whole.headers).toMatchObject({ 'content-length': '500', 'accept-ranges': 'bytes', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
    expect(Buffer.from(await new Response(whole.body).arrayBuffer()).equals(ASSET)).toBe(true);
    const part = await at.fetch({ url: artifactUrl(PAGE, 'live', 'assets/a'), method: 'GET', range: 'bytes=0-9' });
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toBe('bytes 0-9/500');
    expect(Buffer.from(await new Response(part.body).arrayBuffer()).equals(ASSET.subarray(0, 10))).toBe(true);
    const head = await at.fetch({ url: artifactUrl(PAGE, 'live', 'index.html'), method: 'HEAD' });
    expect(head).toMatchObject({ status: 200, body: null });
    asked = [];
    for (const url of ['https://example.com/x', `maws-artifact://${PAGE}/latest/index.html`, 'not a url']) expect((await at.fetch({ url, method: 'GET' })).status, url).toBe(404);
    expect(asked).toEqual([]);
    expect((await at.fetch({ url: artifactUrl(PAGE, 'live', 'index.html'), method: 'POST' as 'GET' })).status).toBe(405);
  });

  it('a path not exactly one encoded URL is 404 before the host is asked', async () => {
    await serve();
    const answer = await new Promise<string>((resolve) => {
      const socket = createConnection(socketPath);
      let text = '';
      socket.on('data', (chunk) => (text += chunk.toString('latin1')));
      socket.on('close', () => resolve(text));
      socket.write(`GET /${artifactUrl(PAGE, 'live', 'index.html')} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    });
    expect(answer).toMatch(/^HTTP\/1\.1 404 /);
    expect(asked).toEqual([]);
    expect(endpointPath('x')).toBe('/x');
  });

  it('close ends the connections it holds, one waiting on the load included', async () => {
    gate = new Promise(() => {}); // never loads
    const at = await serve();
    const socket = createConnection(socketPath);
    const closed = new Promise<void>((resolve) => socket.on('close', () => resolve()));
    socket.on('error', () => {});
    await new Promise((resolve) => socket.on('connect', resolve));
    await new Promise((resolve) => setTimeout(resolve, 20));
    at.close();
    await closed;
  });

  it('the proxy reads a closed endpoint as not running', async () => {
    const at = await serve();
    expect((await get('index.html')).status).toBe(200);
    at.close();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
    const absent = await get('index.html');
    expect(absent.status).toBe(503);
    expect(await absent.text()).toBe(ENDPOINT_UNAVAILABLE);
  });
});
