// P3-H spike U2 (docs/doperpowers/plans/2026-10-12-p3-co-work.md §4.12 U2, §5 P3-H; parent pin blob 8474a047 at c73ba534).
// MAWS as its own MCP client, outside any engine session: stdio, unauthenticated Streamable HTTP (local and public),
// and an OAuth-guarded server through MAWS's own authorization flow (DCR + PKCE + RFC 8707 + loopback redirect).
//   node client-probe.mjs <stdio|http-local|http-public|oauth|maws-shim|all>
// Each probe prints one JSON line and writes results/<probe>.json.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError, refreshAuthorization, discoverAuthorizationServerMetadata } from '@modelcontextprotocol/sdk/client/auth.js';

const here = dirname(fileURLToPath(import.meta.url));
const ms = (t0) => Math.round((performance.now() - t0) * 10) / 10;
const record = (name, value) => {
  mkdirSync(join(here, 'results'), { recursive: true });
  writeFileSync(join(here, 'results', `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
  console.log(JSON.stringify({ probe: name, ...value }).slice(0, 2000));
  return value;
};
const newClient = () => new Client({ name: 'maws-artifact-bridge-probe', version: '0.0.1' });

// list + N calls on a connected client, with timings
async function exercise(client, tool, args, n = 5) {
  let t0 = performance.now();
  const { tools } = await client.listTools();
  const listMs = ms(t0);
  const callMs = [];
  let first;
  for (let i = 0; i < n; i++) {
    t0 = performance.now();
    const r = await client.callTool({ name: tool, arguments: args });
    callMs.push(ms(t0));
    first ??= r;
  }
  return {
    server: client.getServerVersion(),
    protocolVersion: client.transport?.protocolVersion ?? client.transport?._protocolVersion ?? null,
    tools: tools.map((t) => ({ name: t.name, annotations: t.annotations ?? null, hasOutputSchema: !!t.outputSchema })),
    listMs,
    callMs,
    firstResult: first.structuredContent ?? first.content?.[0]?.text?.slice(0, 300),
    isError: !!first.isError,
  };
}

async function probeStdio() {
  const t0 = performance.now();
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(here, 'toy-server.mjs'), 'stdio'], stderr: 'pipe' });
  const client = newClient();
  await client.connect(transport); // spawn + initialize + notifications/initialized
  const connectMs = ms(t0);
  const out = await exercise(client, 'metrics_snapshot', { series: 'revenue', points: 3 });
  const pid = transport.pid;
  await client.close();
  return record('stdio', { connectMs, pid, ...out });
}

function startNode(args, readyPattern) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: here, stdio: ['ignore', 'ignore', 'pipe'] });
    let buf = '';
    child.stderr.on('data', (d) => { buf += d; if (readyPattern.test(buf)) resolve(child); });
    child.on('exit', (code) => reject(new Error(`exited ${code}: ${buf}`)));
    setTimeout(() => reject(new Error(`not ready: ${buf}`)), 10_000);
  });
}

async function probeHttpLocal() {
  const port = 47811;
  const server = await startNode([join(here, 'toy-server.mjs'), 'http', String(port)], /toy-metrics http/);
  try {
    const t0 = performance.now();
    const client = newClient();
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    const connectMs = ms(t0);
    const out = await exercise(client, 'metrics_snapshot', { series: 'revenue', points: 3 });
    await client.close();
    return record('http-local', { connectMs, ...out });
  } finally {
    server.kill();
  }
}

// A public MCP server that needs no auth (DeepWiki's, from Cognition), read-only tools over public GitHub repositories.
async function probeHttpPublic() {
  const url = new URL('https://mcp.deepwiki.com/mcp');
  const t0 = performance.now();
  const client = newClient();
  await client.connect(new StreamableHTTPClientTransport(url));
  const connectMs = ms(t0);
  const out = await exercise(client, 'read_wiki_structure', { repoName: 'modelcontextprotocol/typescript-sdk' }, 2);
  await client.close();
  return record('http-public', { url: url.href, connectMs, ...out });
}

// --- OAuth: MAWS's own client registration, the engine's as a separate one --------------------------------------------
// An OAuthClientProvider whose storage is a plain object (in MAWS: the host's store sealed with Electron safeStorage).
// redirectToAuthorization stands in for shell.openExternal: it follows the authorization server's redirect (the
// auto-approving consent page) to the loopback listener, as the system browser would.
async function loopback() {
  const codes = [];
  let waiter;
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    codes.push({ code: u.searchParams.get('code'), state: u.searchParams.get('state') });
    waiter?.();
    res.end('You can close this window.');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}/callback`,
    next: () => (codes.length ? Promise.resolve(codes.shift()) : new Promise((r) => { waiter = () => r(codes.shift()); })),
    close: () => server.close(),
  };
}

function provider(name, redirectUrl, store) {
  return {
    get redirectUrl() { return redirectUrl; },
    get clientMetadata() {
      return { client_name: name, redirect_uris: [redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
    },
    state: () => `st-${Math.random().toString(36).slice(2)}`,
    clientInformation: () => store.client,
    saveClientInformation: (c) => { store.client = c; },
    tokens: () => store.tokens,
    saveTokens: (t) => { store.tokens = t; },
    saveCodeVerifier: (v) => { store.verifier = v; },
    codeVerifier: () => store.verifier,
    discoveryState: () => store.discovery,
    saveDiscoveryState: (d) => { store.discovery = d; },
    invalidateCredentials: (scope) => { if (scope === 'all' || scope === 'tokens') delete store.tokens; if (scope === 'all' || scope === 'client') delete store.client; },
    redirectToAuthorization: async (authUrl) => {
      store.authorizationUrl = authUrl.href;
      const r = await fetch(authUrl, { redirect: 'manual' }); // the "browser": consent auto-approved by auth-server.mjs
      await fetch(r.headers.get('location')); // lands on the loopback
    },
  };
}

// connect with an auth provider; on the first 401 run the flow and reconnect (the SDK's documented two-step pattern)
async function connectWithAuth(url, prov, lb) {
  const steps = [];
  try {
    const c = newClient();
    await c.connect(new StreamableHTTPClientTransport(url, { authProvider: prov }));
    steps.push('connected with stored tokens');
    return { client: c, steps };
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) throw e;
    steps.push('401 -> discovery, registration, authorize redirect');
  }
  const { code } = await lb.next();
  const t = new StreamableHTTPClientTransport(url, { authProvider: prov });
  await t.finishAuth(code);
  steps.push('code exchanged at token endpoint');
  const c = newClient();
  await c.connect(new StreamableHTTPClientTransport(url, { authProvider: prov }));
  steps.push('connected');
  return { client: c, steps };
}

async function probeOauth() {
  const authPort = 47820;
  const portA = 47821; // the connector both MAWS and "the engine" use
  const portB = 47822; // another connector behind the same authorization server
  const auth = await startNode([join(here, 'auth-server.mjs'), String(authPort)], /auth server on/);
  const a = await startNode([join(here, 'toy-server.mjs'), 'http', String(portA), '--auth', String(authPort)], /toy-metrics http/);
  const b = await startNode([join(here, 'toy-server.mjs'), 'http', String(portB), '--auth', String(authPort)], /toy-metrics http/);
  const urlA = new URL(`http://127.0.0.1:${portA}/mcp`);
  const urlB = new URL(`http://127.0.0.1:${portB}/mcp`);
  const lb = await loopback();
  const out = {};
  try {
    // 1. unauthenticated request: what the resource answers
    const raw = await fetch(urlA, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'x', version: '0' } } }) });
    out.unauthenticated = { status: raw.status, wwwAuthenticate: raw.headers.get('www-authenticate') };

    // 2. MAWS's own flow
    const mawsStore = {};
    let t0 = performance.now();
    const maws = await connectWithAuth(urlA, provider('MAWS', lb.url, mawsStore), lb);
    out.mawsFlow = { ms: ms(t0), steps: maws.steps, clientId: mawsStore.client?.client_id, authorizationUrlParams: Object.fromEntries([...new URL(mawsStore.authorizationUrl).searchParams].filter(([k]) => k !== 'state' && k !== 'code_challenge')), tokenFields: Object.keys(mawsStore.tokens ?? {}) };
    out.mawsCall = await exercise(maws.client, 'metrics_snapshot', { series: 'revenue', points: 2 }, 2);
    await maws.client.close();

    // 3. a fresh process with the stored grant: no browser, no registration
    const lb2 = await loopback();
    const again = await connectWithAuth(urlA, provider('MAWS', lb.url, mawsStore), lb2);
    out.mawsReconnect = { steps: again.steps };
    await again.client.close();
    lb2.close();

    // 4. audience binding: MAWS's token for A presented to B is refused (a grant is per connector)
    const cross = await fetch(urlB, { method: 'POST', headers: { authorization: `Bearer ${mawsStore.tokens.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' });
    out.crossAudience = { status: cross.status, wwwAuthenticate: cross.headers.get('www-authenticate') };

    // 5. "reuse the engine's grant", simulated with a second registration standing in for the engine's client
    const engineStore = {};
    const eng = await connectWithAuth(urlA, provider('Claude Code (stand-in)', lb.url, engineStore), lb);
    await eng.client.close();
    const borrowed = { tokens: engineStore.tokens };
    const borrow = newClient();
    await borrow.connect(new StreamableHTTPClientTransport(urlA, { requestInit: { headers: { authorization: `Bearer ${borrowed.tokens.access_token}` } } }));
    out.borrowedAccessToken = { works: !(await borrow.callTool({ name: 'metrics_snapshot', arguments: { series: 'x', points: 1 } })).isError, note: 'a bearer token works for whoever holds it, within its audience and lifetime' };
    await borrow.close();
    // the borrowed token expires in 60 s here (hours in practice); keeping it alive means refreshing it as the engine's client
    const asMeta = await discoverAuthorizationServerMetadata(new URL(`http://127.0.0.1:${authPort}`));
    const mawsRefresh = await refreshAuthorization(new URL(`http://127.0.0.1:${authPort}`), { metadata: asMeta, clientInformation: engineStore.client, refreshToken: engineStore.tokens.refresh_token, resource: urlA });
    out.mawsRefreshedEnginesGrant = { ok: !!mawsRefresh.access_token, rotated: mawsRefresh.refresh_token !== engineStore.tokens.refresh_token };
    let engineRefresh;
    try {
      await refreshAuthorization(new URL(`http://127.0.0.1:${authPort}`), { metadata: asMeta, clientInformation: engineStore.client, refreshToken: engineStore.tokens.refresh_token, resource: urlA });
      engineRefresh = 'ok';
    } catch (e) {
      engineRefresh = `${e.constructor.name}: ${e.message}`;
    }
    out.enginesNextRefresh = engineRefresh;
    return record('oauth', out);
  } finally {
    lb.close();
    for (const p of [a, b, auth]) p.kill();
  }
}

// MAWS's own `maws` server, adapted to stdio by maws-shim (bundled from src/ by esbuild): a stock SDK client against it
async function probeMawsShim() {
  const shim = join(here, 'build', 'maws-shim.mjs');
  const t0 = performance.now();
  const transport = new StdioClientTransport({ command: process.execPath, args: [shim], stderr: 'pipe' });
  const client = newClient();
  await client.connect(transport);
  const connectMs = ms(t0);
  const out = await exercise(client, 'shim_echo', { text: 'hello' }, 2);
  await client.close();
  return record('maws-shim', { connectMs, ...out });
}

const probes = { stdio: probeStdio, 'http-local': probeHttpLocal, 'http-public': probeHttpPublic, oauth: probeOauth, 'maws-shim': probeMawsShim };
const which = process.argv[2] ?? 'all';
for (const [name, fn] of Object.entries(probes)) {
  if (which !== 'all' && which !== name) continue;
  try {
    await fn();
  } catch (e) {
    record(name, { error: `${e.constructor?.name}: ${e.message}` });
  }
}
process.exit(0);
