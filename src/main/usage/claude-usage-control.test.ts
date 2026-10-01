// ClaudeUsage's control API client (W6 route executor) against a stub HTTP server on an ephemeral loopback port and a
// token file in a temporary directory: the state and its absence, every action, each refusal, a wrong token and a
// silent server. Nothing here reads ClaudeUsage's real directory or reaches its relay.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeUsageControl, parseState, TOKEN_FILE } from './claude-usage-control';

const TOKEN = 'c0ffee-token';
const ROUTED = '477e393c-5c1a-4413-a3e6-7f5d1ed72cc3';
const STATE = {
  version: 1,
  updatedAt: '2026-10-01T12:00:00Z',
  routing: { enabled: true, ready: true, port: 8641, drainTarget: '2aca3c4b-1e77-4091-908b-d183f6b0f092', drainTargetIsManual: false, futureField: 1 },
  accounts: [
    { uuid: ROUTED, email: '1@example.test', status: 'ok', isRoutingHere: false },
    { uuid: '2aca3c4b-1e77-4091-908b-d183f6b0f092', email: '3@example.test', status: 'ok', isRoutingHere: true, plan: 'Max' },
  ],
  codex: [{ id: 'c0de0001', label: '6@example.test', isDrainTarget: true }],
};

interface Seen {
  method: string;
  path: string;
  authorization: string | undefined;
  body: unknown;
}
type Handler = (seen: Seen, res: ServerResponse) => void;

let dir: string;
let server: Server;
let port: number;
let seen: Seen[];
let handler: Handler;

const send = (res: ServerResponse, status: number, body?: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

// The contract as the parallel ClaudeUsage worker builds it, with a refusal for each 409 it names.
const contract: Handler = (req, res) => {
  if (req.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { ok: false, reason: 'unauthorized', message: 'wrong token' });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const key = `${req.method} ${req.path}`;
  if (key === 'GET /claudeusage/state') return send(res, 200, STATE);
  if (key === 'POST /claudeusage/route') {
    if (body.uuid === 'not-ready') return send(res, 409, { ok: false, reason: 'not_ready', message: 'Routing is off in ClaudeUsage' });
    if (body.uuid === 'nobody') return send(res, 409, { ok: false, reason: 'unknown_account', message: 'ClaudeUsage has no such account' });
    if (body.uuid === 'spent') return send(res, 409, { ok: false, reason: 'unusable', message: '4@example.test is at its limit' });
    return send(res, 200, { ok: true, drainTarget: body.uuid });
  }
  if (key === 'POST /claudeusage/accounts/add') return send(res, 202, { ok: true });
  if (key === 'POST /claudeusage/accounts/reconnect') return send(res, 202, { ok: true });
  if (key === 'POST /claudeusage/accounts/remove') {
    if (body.confirm !== true) return send(res, 409, { ok: false, reason: 'confirm_required', message: 'Removing an account needs confirm' });
    return send(res, 200, { ok: true });
  }
  if (key === 'POST /claudeusage/panel') return send(res, 200, { ok: true, open: true });
  send(res, 404, { type: 'error' });
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'maws-usage-control-'));
  writeFileSync(join(dir, TOKEN_FILE), `${TOKEN}\n`);
  seen = [];
  handler = contract;
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (text += chunk));
    req.on('end', () => {
      const entry = { method: req.method ?? '', path: req.url ?? '', authorization: req.headers.authorization, body: text ? (JSON.parse(text) as unknown) : null };
      seen.push(entry);
      handler(entry, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

// Through the port, as main reaches ClaudeUsage: no base URL, the port gateway.json names.
const client = (options: Partial<ConstructorParameters<typeof ClaudeUsageControl>[0]> = {}) =>
  new ClaudeUsageControl({ dir, port: async () => port, log: () => {}, ...options });

describe('settings.usageControls', () => {
  it('answers the state through gateway.json’s port with the token as a bearer, read leniently', async () => {
    const answer = await client().controls();
    expect(answer).toEqual({
      available: true,
      reason: null,
      state: {
        updatedAt: '2026-10-01T12:00:00Z',
        routing: { enabled: true, ready: true, port: 8641, drainTarget: '2aca3c4b-1e77-4091-908b-d183f6b0f092', drainTargetIsManual: false },
        accounts: [
          { uuid: ROUTED, email: '1@example.test', status: 'ok', isRoutingHere: false },
          { uuid: '2aca3c4b-1e77-4091-908b-d183f6b0f092', email: '3@example.test', status: 'ok', isRoutingHere: true },
        ],
        codex: [{ id: 'c0de0001', label: '6@example.test', isDrainTarget: true }],
      },
    });
    expect(seen).toEqual([{ method: 'GET', path: '/claudeusage/state', authorization: `Bearer ${TOKEN}`, body: null }]);
  });

  it('reaches a base URL in place of the port when one is named (MAWS_CLAUDE_USAGE_CONTROL_URL)', async () => {
    const answer = await client({ port: async () => null, baseUrl: `http://127.0.0.1:${port}/` }).controls();
    expect(answer.available).toBe(true);
    expect(seen.map((s) => s.path)).toEqual(['/claudeusage/state']);
  });

  it('reads the token on every use', async () => {
    const control = client();
    await control.controls();
    writeFileSync(join(dir, TOKEN_FILE), 'rotated');
    expect(await control.controls()).toEqual({ available: false, reason: 'bad_token', state: null });
    expect(seen.map((s) => s.authorization)).toEqual([`Bearer ${TOKEN}`, 'Bearer rotated']);
  });

  it('asks once for callers that overlap', async () => {
    const control = client();
    const [a, b] = await Promise.all([control.controls(), control.controls()]);
    expect(a).toBe(b);
    expect(seen).toHaveLength(1);
  });

  it('is no_route without a token file, without a port, on a 404 and on a refused connection; nothing is sent without a token', async () => {
    rmSync(join(dir, TOKEN_FILE));
    expect(await client().controls()).toEqual({ available: false, reason: 'no_route', state: null });
    expect(seen).toEqual([]);
    writeFileSync(join(dir, TOKEN_FILE), TOKEN);
    expect(await client({ port: async () => null }).controls()).toEqual({ available: false, reason: 'no_route', state: null });
    expect(seen).toEqual([]);
    handler = (_req, res) => send(res, 404, { type: 'error', error: { type: 'not_found_error' } });
    expect((await client().controls()).reason).toBe('no_route');
    const closed = port;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await client({ port: async () => closed }).controls()).toEqual({ available: false, reason: 'no_route', state: null });
    server = createServer(); // afterEach closes a server
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  it('is bad_token on a 401, and for a token file that is empty or not a header value', async () => {
    writeFileSync(join(dir, TOKEN_FILE), 'wrong');
    expect(await client().controls()).toEqual({ available: false, reason: 'bad_token', state: null });
    writeFileSync(join(dir, TOKEN_FILE), '\n');
    expect((await client().controls()).reason).toBe('bad_token');
    writeFileSync(join(dir, TOKEN_FILE), 'two words');
    expect((await client().controls()).reason).toBe('bad_token');
    expect(seen).toHaveLength(1); // only the first was sent
  });

  it('is timeout when the server does not answer in time', async () => {
    handler = () => {}; // never answers
    const started = Date.now();
    expect(await client({ stateTimeoutMs: 200 }).controls()).toEqual({ available: false, reason: 'timeout', state: null });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('is failed on another status or an answer that is not the state', async () => {
    handler = (_req, res) => send(res, 500, { ok: false });
    expect((await client().controls()).reason).toBe('failed');
    handler = (_req, res) => send(res, 200, { hello: 'world' });
    expect((await client().controls()).reason).toBe('failed');
    handler = (_req, res) => {
      res.writeHead(200);
      res.end('not json');
    };
    expect((await client().controls()).reason).toBe('failed');
  });
});

describe('settings.usageAction', () => {
  it('posts each action with its body and answers ClaudeUsage’s result', async () => {
    const control = client();
    expect(await control.act({ action: 'route', uuid: ROUTED })).toEqual({ ok: true, drainTarget: ROUTED });
    expect(await control.act({ action: 'add', email: null })).toEqual({ ok: true, drainTarget: null });
    expect(await control.act({ action: 'add', email: 'new@example.test' })).toEqual({ ok: true, drainTarget: null });
    expect(await control.act({ action: 'add' })).toEqual({ ok: true, drainTarget: null });
    expect(await control.act({ action: 'reconnect', uuid: ROUTED })).toEqual({ ok: true, drainTarget: null });
    expect(await control.act({ action: 'remove', uuid: ROUTED, confirm: true })).toEqual({ ok: true, drainTarget: null });
    expect(await control.act({ action: 'panel' })).toEqual({ ok: true, drainTarget: null });
    expect(seen.map(({ method, path, body }) => [method, path, body])).toEqual([
      ['POST', '/claudeusage/route', { uuid: ROUTED }],
      ['POST', '/claudeusage/accounts/add', { email: null }],
      ['POST', '/claudeusage/accounts/add', { email: 'new@example.test' }],
      ['POST', '/claudeusage/accounts/add', { email: null }],
      ['POST', '/claudeusage/accounts/reconnect', { uuid: ROUTED }],
      ['POST', '/claudeusage/accounts/remove', { uuid: ROUTED, confirm: true }],
      ['POST', '/claudeusage/panel', {}],
    ]);
    for (const s of seen) expect(s.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('answers each refusal with ClaudeUsage’s own reason and message', async () => {
    const control = client();
    expect(await control.act({ action: 'route', uuid: 'not-ready' })).toEqual({ ok: false, reason: 'not_ready', message: 'Routing is off in ClaudeUsage' });
    expect(await control.act({ action: 'route', uuid: 'nobody' })).toEqual({ ok: false, reason: 'unknown_account', message: 'ClaudeUsage has no such account' });
    expect(await control.act({ action: 'route', uuid: 'spent' })).toEqual({ ok: false, reason: 'unusable', message: '4@example.test is at its limit' });
    expect(await control.act({ action: 'remove', uuid: ROUTED })).toEqual({ ok: false, reason: 'confirm_required', message: 'Removing an account needs confirm' });
    handler = (_req, res) => send(res, 409, 'refused');
    expect(await control.act({ action: 'route', uuid: ROUTED })).toEqual({ ok: false, reason: 'refused', message: 'ClaudeUsage refused this (refused)' });
  });

  it('answers a route’s drain target as ClaudeUsage named it, else the account asked for', async () => {
    handler = (_req, res) => send(res, 200, { ok: true });
    expect(await client().act({ action: 'route', uuid: ROUTED })).toEqual({ ok: true, drainTarget: ROUTED });
  });

  it('answers the reason, not a throw, when ClaudeUsage is not reached', async () => {
    writeFileSync(join(dir, TOKEN_FILE), 'wrong');
    expect(await client().act({ action: 'route', uuid: ROUTED })).toMatchObject({ ok: false, reason: 'bad_token' });
    rmSync(join(dir, TOKEN_FILE));
    expect(await client().act({ action: 'panel' })).toMatchObject({ ok: false, reason: 'no_route' });
    writeFileSync(join(dir, TOKEN_FILE), TOKEN);
    handler = (_req, res) => send(res, 404);
    expect(await client().act({ action: 'add', email: null })).toMatchObject({ ok: false, reason: 'no_route' });
    handler = (_req, res) => send(res, 503);
    expect(await client().act({ action: 'add', email: null })).toEqual({ ok: false, reason: 'failed', message: "ClaudeUsage's control route failed (HTTP 503)" });
    handler = () => {};
    expect(await client({ actionTimeoutMs: 200 }).act({ action: 'route', uuid: ROUTED })).toMatchObject({ ok: false, reason: 'timeout' });
  });
});

describe('parseState', () => {
  it('needs the version, the routing object and the accounts list; the rest defaults', () => {
    expect(parseState(null)).toBeNull();
    expect(parseState({ routing: {}, accounts: [] })).toBeNull();
    expect(parseState({ version: 1, accounts: [] })).toBeNull();
    expect(parseState({ version: 1, routing: {}, accounts: {} })).toBeNull();
    expect(parseState({ version: 2, routing: {}, accounts: [{ email: 'no-uuid' }, 7, { uuid: 'u' }] })).toEqual({
      updatedAt: null,
      routing: { enabled: false, ready: false, port: null, drainTarget: null, drainTargetIsManual: false },
      accounts: [{ uuid: 'u', email: '', status: '', isRoutingHere: false }],
      codex: [],
    });
  });
});
