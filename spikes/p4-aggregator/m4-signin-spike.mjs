// P4-AGG M4's spike (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, M4 "The spike comes first"): can
// MAWS drive the engine's own MCP sign-in over a ready session's control client, against M1's engine-mode OAuth fixture?
// Its deliverable is a verdict: promote (path A or B) or discard.
//
// Runs only on the Mac mini through the gate (Decision Log 6), from e2e/discover-connectors.spec.ts, which owns what this
// script must not: the OAuth fixture (engine mode), the scratch CLAUDE_CONFIG_DIR, and the Keychain custody of the one item
// that directory names (claimed before this runs, released after every engine it started has exited). The engine runs
// under the runner's HOME, since a scratch HOME hides the login keychain (Decision Log 5). Nothing here reads or removes a
// Keychain item.
//
//   node m4-signin-spike.mjs <input.json>
//   input: {bin, configDir, project, resourceUrl, outDir}
//   writes <outDir>/frames.jsonl (every control exchange, OAuth query values redacted), <outDir>/result.json (the
//   answers per question and each failure's classification), <outDir>/pids.txt (every engine pid, one per line, as it
//   starts) and <outDir>/debug-*.log (the engine's debug files); <outDir>/fx-plugin is the plugin question's plugin
//
// Each question runs in its own engine process over the same configuration, so the credential one question stores is
// what the last question's file-configured session reads.
//   custom      mcp_authenticate with MAWS's http://127.0.0.1:<port>/callback: redirectScheme 'custom'? Then the browser
//               step (the fixture's /authorize, auto-approving, followed by hand), mcp_oauth_callback_url with the
//               redirect, and mcp_status until the server reports connected.
//   localhost   mcp_authenticate with no redirectUri: redirectScheme 'localhost' with callbackPort; the redirect is
//               delivered to the engine's own listener and mcp_status is watched.
//   pending     a second mcp_authenticate while the first is pending: its answer, and which flow's callback is accepted.
//   cancel      the host abandons a flow (as Cancel does: MAWS closes its listener, the engine's flow is left pending), then
//               a retry: does a new mcp_authenticate start and complete; is the stale flow's callback refused?
//   late        a server added to the file configuration after the session started: what mcp_authenticate answers
//               (fact 2 says "Server not found"), and whether mcp_status ever lists it.
//   pathA       mcp_set_servers into a session that already holds a dynamic server (--mcp-config) and an SDK server: what
//               survives a call naming only the new server, and one naming both; then the sign-in of the loaded server.
//   next        a fresh session over the file configuration (every server above, pathA's added to the file now): which
//               servers it reports connected, so whether a sign-in's credential is what the next session uses.
// The UX wave's U11a M1 (docs/doperpowers/plans/2026-11-12-ux-wave-U11a-settings-connectors-org.md, Proof P1) adds two,
// for the servers the engine reports with scope `dynamic`, each signed in as MAWS's operation signs one in
// (src/services/connectors/sign-in.ts: mcp_authenticate with MAWS's redirect, the browser step, mcp_oauth_callback_url,
// then mcp_reconnect and mcp_status until connected; the engine's own listener if it answers another scheme), in a
// session holding an SDK server as MAWS's hold `maws`; then a second process launched the same way reads the server.
//   dynamic     fx-own, a server of the launch's own list (--mcp-config, as MAWS passes Settings' MCP servers).
//   plugin      fx-oauth of the plugin fx-plugin, given by --plugin-dir: the engine names it plugin:fx-plugin:fx-oauth.
// For either, a custom callback or reconnect the engine refuses is followed by a second sign-in through the engine's own
// listener in the same session (`fallback`).
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { bin, configDir, project, resourceUrl, outDir } = input;
mkdirSync(outDir, { recursive: true });
const FRAMES = join(outDir, 'frames.jsonl');
const PIDS = join(outDir, 'pids.txt');
writeFileSync(FRAMES, '');
writeFileSync(PIDS, '');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ENGINE_ENV = (() => {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir, DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' };
  for (const key of ['CLAUDECODE', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_SECURESTORAGE_CONFIG_DIR', 'CLAUDE_CODE_CUSTOM_OAUTH_URL', 'MAWS_E2E', 'MAWS_E2E_ENGINE_BIN']) delete env[key];
  return env;
})();

// OAuth values never reach the recording: every query value of an authorization or callback URL, and any token field.
const SECRET_PARAMS = ['state', 'code', 'code_challenge', 'client_id'];
function redactUrl(text) {
  try {
    const url = new URL(text);
    for (const name of SECRET_PARAMS) if (url.searchParams.has(name)) url.searchParams.set(name, '[redacted]');
    return url.href;
  } catch {
    return text;
  }
}
function redact(value) {
  if (typeof value === 'string') return /^https?:\/\//.test(value) ? redactUrl(value) : value;
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, key === 'state' || /token/i.test(key) ? '[redacted]' : redact(inner)]));
  return value;
}
const record = (row) => appendFileSync(FRAMES, `${JSON.stringify(redact({ at: new Date().toISOString(), ...row }))}\n`);

// ---- one engine session over stream-json ---------------------------------------------------------------------------
const FLAGS = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio', '--include-partial-messages', '--setting-sources', 'user,project,local'];

class Engine {
  constructor(label, { mcpConfig = null, sdkServers = [], pluginDirs = [] } = {}) {
    this.label = label;
    this.sdkServers = sdkServers;
    this.pending = new Map();
    this.sdkSeen = [];
    const args = [...FLAGS, '--debug-file', join(outDir, `debug-${label}.log`), ...(mcpConfig ? ['--mcp-config', JSON.stringify(mcpConfig)] : []), ...pluginDirs.flatMap((dir) => ['--plugin-dir', dir])];
    this.child = spawn(bin, args, { cwd: project, env: ENGINE_ENV, stdio: ['pipe', 'pipe', 'pipe'] });
    appendFileSync(PIDS, `${this.child.pid}\n`);
    record({ engine: label, event: 'spawn', pid: this.child.pid, args });
    let buffer = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.trim()) this.receive(line);
      }
    });
    this.stderr = '';
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk; });
    this.child.stdin.on('error', () => {});
    this.closed = new Promise((resolve) => this.child.on('close', (code, signal) => {
      record({ engine: label, event: 'exit', code, signal, stderr: this.stderr.slice(-2000) });
      for (const waiter of this.pending.values()) waiter.reject(new Error(`engine ${label} exited`));
      resolve({ code, signal });
    }));
  }

  receive(line) {
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      return;
    }
    if (frame.type === 'control_response') {
      const waiter = this.pending.get(frame.response.request_id);
      if (waiter) {
        this.pending.delete(frame.response.request_id);
        record({ engine: this.label, direction: 'in', frame });
        waiter.resolve(frame.response);
      }
      return;
    }
    if (frame.type === 'control_request') {
      const { subtype } = frame.request;
      let response;
      if (subtype === 'mcp_message' && this.sdkServers.includes(frame.request.server_name)) response = { mcp_response: this.sdk(frame.request.message) };
      else if (subtype === 'can_use_tool') response = { behavior: 'deny', message: 'the spike runs no tools' };
      if (response === undefined) {
        record({ engine: this.label, event: 'engine_request_refused', subtype });
        this.write({ type: 'control_response', response: { subtype: 'error', request_id: frame.request_id, error: `the spike does not answer ${subtype}` } });
      } else this.write({ type: 'control_response', response: { subtype: 'success', request_id: frame.request_id, response } });
    }
  }

  // A minimal SDK MCP server (one tool), so the session holds an SDK server as MAWS's do (its `maws`).
  sdk(message) {
    this.sdkSeen.push(message.method ?? null);
    const { id, method, params } = message;
    if (id === undefined || id === null) return { jsonrpc: '2.0', id: 0, result: {} };
    if (method === 'initialize') return { jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'spike-sdk', version: '0.0.1' } } };
    if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: [{ name: 'noop', description: 'does nothing', inputSchema: { type: 'object', properties: {} } }] } };
    return { jsonrpc: '2.0', id, result: {} };
  }

  write(frame) {
    this.child.stdin.write(`${JSON.stringify(frame)}\n`);
  }

  request(subtype, payload = {}, timeout = 30_000) {
    const request_id = randomUUID();
    const frame = { type: 'control_request', request_id, request: { subtype, ...payload } };
    record({ engine: this.label, direction: 'out', frame });
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request_id);
        record({ engine: this.label, event: 'request_timeout', subtype });
        resolve({ subtype: 'timeout', error: `no answer to ${subtype} in ${timeout} ms`, ms: Date.now() - started });
      }, timeout);
      this.pending.set(request_id, {
        resolve: (response) => { clearTimeout(timer); resolve({ ...response, ms: Date.now() - started }); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.write(frame);
    });
  }

  async init() {
    return this.request('initialize', { hooks: {}, ...(this.sdkServers.length > 0 && { sdkMcpServers: this.sdkServers }) });
  }

  async status() {
    const answer = await this.request('mcp_status', {}, 15_000);
    return answer.response?.mcpServers ?? [];
  }

  async statusOf(name) {
    return (await this.status()).find((server) => server.name === name) ?? null;
  }

  // mcp_status until the server `matches` picks reads one of `states` (or the bound), every 1.5 s; the last reading.
  async untilMatch(matches, states, bound = 30_000) {
    const stop = Date.now() + bound;
    for (;;) {
      const server = (await this.status()).find(matches) ?? null;
      if ((server !== null && states.includes(server.status)) || Date.now() > stop) return server;
      await delay(1500);
    }
  }

  until(name, states, bound) {
    return this.untilMatch((server) => server.name === name, states, bound);
  }

  async stop() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return this.closed;
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill('SIGTERM'), 5000);
    const killer = setTimeout(() => this.child.kill('SIGKILL'), 10_000);
    const result = await this.closed;
    clearTimeout(timer);
    clearTimeout(killer);
    return result;
  }
}

// ---- the CLI and the browser step ----------------------------------------------------------------------------------
function cli(args) {
  try {
    const stdout = execFileSync(bin, args, { cwd: project, env: ENGINE_ENV, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout: stdout.trim(), stderr: '' };
  } catch (error) {
    return { code: error.status ?? null, stdout: String(error.stdout ?? '').trim(), stderr: String(error.stderr ?? '').trim() };
  }
}

// The person's browser: follow the authorization URL to its redirect (the fixture approves at once). `waitMs` is the
// consent's delay.
async function browse(authUrl, waitMs = 0) {
  if (waitMs > 0) await delay(waitMs);
  const response = await fetch(authUrl, { redirect: 'manual' });
  const location = response.headers.get('location');
  return { status: response.status, location, body: location === null ? (await response.text()).slice(0, 300) : null };
}

// MAWS's loopback listener: 127.0.0.1, an ephemeral port, /callback. The spike only needs its address; the redirect
// is taken from the browser step rather than received here, and the listener answers anything 400.
function listener() {
  const server = createServer((request, response) => {
    response.writeHead(400, { 'content-type': 'text/plain' });
    response.end('spike');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, redirectUri: `http://127.0.0.1:${server.address().port}/callback` })));
}

const brief = (server) => (server === null ? null : { status: server.status, scope: server.scope ?? null, error: server.error ?? null, tools: (server.tools ?? []).map((tool) => tool.name) });
const answerOf = (answer) => ({ subtype: answer.subtype, ms: answer.ms, error: answer.error ?? null, response: answer.response === undefined ? null : redact(answer.response) });

// ---- the questions ---------------------------------------------------------------------------------------------------
const result = { input: { bin, configDir, project, resourceUrl }, engineVersion: cli(['--version']).stdout, adds: {}, questions: {}, failures: [] };
const fail = (question, owner, detail) => result.failures.push({ question, owner, detail });
const save = () => writeFileSync(join(outDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);

const NAMES = ['fx-custom', 'fx-localhost', 'fx-pending', 'fx-cancel'];
for (const name of NAMES) result.adds[name] = cli(['mcp', 'add', '--transport', 'http', name, resourceUrl, '--scope', 'user']);
result.adds['fx-custom (again)'] = cli(['mcp', 'add', '--transport', 'http', 'fx-custom', resourceUrl, '--scope', 'user']);
save();

async function question(name, body) {
  const q = (result.questions[name] = { steps: [] });
  const step = (label, value) => { q.steps.push({ label, ...value }); save(); };
  try {
    await body(q, step);
  } catch (error) {
    q.error = String(error.stack ?? error);
    fail(name, 'spike', q.error);
  }
  save();
}

// `reconnectAfterCallback`: as MAWS's operation does, an accepted custom callback is followed at once by mcp_reconnect,
// since the engine does not reconnect a server whose callback came that way (findings-m4.txt 1).
async function signIn(engine, name, { redirectUri, consentDelayMs = 0, reconnectAfterCallback = false } = {}, step) {
  const auth = await engine.request('mcp_authenticate', { serverName: name, ...(redirectUri && { redirectUri }) }, 45_000);
  step('mcp_authenticate', answerOf(auth));
  if (auth.subtype !== 'success' || !auth.response?.authUrl) return { auth, connected: null };
  const browsed = await browse(auth.response.authUrl, consentDelayMs);
  step('browser', { status: browsed.status, location: browsed.location === null ? null : redactUrl(browsed.location), body: browsed.body });
  if (browsed.location === null) return { auth, browsed, connected: null };
  let callback = null;
  let reconnect = null;
  let delivered = null;
  if (auth.response.redirectScheme === 'custom') {
    callback = await engine.request('mcp_oauth_callback_url', { serverName: name, callbackUrl: browsed.location }, 45_000);
    step('mcp_oauth_callback_url', answerOf(callback));
    if (reconnectAfterCallback && callback.subtype === 'success') {
      step('mcp_status after the callback', { server: brief(await engine.statusOf(name)) });
      reconnect = await engine.request('mcp_reconnect', { serverName: name }, 30_000);
      step('mcp_reconnect', answerOf(reconnect));
    }
  } else {
    // the engine's own listener receives the redirect, as the person's browser would deliver it
    delivered = await fetch(browsed.location, { redirect: 'manual' }).then(async (response) => ({ status: response.status, body: (await response.text()).slice(0, 200) }), (error) => ({ error: String(error) }));
    step('delivered to the engine listener', delivered);
  }
  const server = await engine.until(name, ['connected', 'failed'], 30_000);
  step('mcp_status after', { server: brief(server) });
  return { auth, browsed, callback, reconnect, delivered, connected: server?.status === 'connected' };
}

// A control answer in a word for the summary: `ok`, the engine's refusal, or null when the step was not reached.
const outcomeOf = (answer) => (answer === null ? null : answer.subtype === 'success' ? 'ok' : (answer.error ?? answer.subtype));

// dynamic and plugin: `launch` is the Engine's options for both processes, `expectedName` the name the server should be
// listed under, `matches` how it is found in mcp_status whatever its name turns out to be.
// `fallback`: when the first attempt answered `custom` and its callback or reconnect was refused, a second sign-in in the
// same session with no redirect of MAWS's (the engine's own localhost listener, which the fixture's consent is delivered
// to), as M8 would sign that kind in instead. Null when it was not needed or not reached; `fallback.next` is the second
// process's reading, which comes after both attempts.
async function dynamicQuestion(kind, { launch, expectedName, matches }) {
  await question(kind, async (q, step) => {
    const options = { ...launch, sdkServers: ['spike-sdk'] };
    q.expectedName = expectedName;
    q.fallback = null;
    const engine = new Engine(kind, options);
    const { server, redirectUri } = await listener();
    try {
      step('initialize', answerOf(await engine.init()));
      const listed = await engine.untilMatch(matches, ['needs-auth', 'connected', 'failed'], 30_000);
      step('mcp_status before', { servers: (await engine.status()).map((s) => ({ name: s.name, status: s.status, scope: s.scope ?? null })) });
      q.name = listed?.name ?? null;
      q.before = brief(listed);
      if (q.name === null) {
        fail(kind, 'undetermined', 'the server is not listed in mcp_status');
        return;
      }
      const outcome = await signIn(engine, q.name, { redirectUri, reconnectAfterCallback: true }, step);
      q.authenticate = outcomeOf(outcome.auth);
      q.redirectScheme = outcome.auth.response?.redirectScheme ?? null;
      q.callback = outcomeOf(outcome.callback ?? null);
      q.reconnect = outcomeOf(outcome.reconnect ?? null);
      q.connected = outcome.connected;
      if (outcome.auth.subtype !== 'success') fail(kind, 'engine', outcome.auth.error);
      else if (outcome.connected !== true) fail(kind, 'undetermined', 'the server did not report connected');
      const refused = (answer) => answer !== null && answer !== undefined && answer.subtype !== 'success';
      if (q.redirectScheme === 'custom' && outcome.connected !== true && (refused(outcome.callback) || refused(outcome.reconnect))) {
        const second = await signIn(engine, q.name, {}, (label, value) => step(`fallback: ${label}`, value));
        q.fallback = {
          authenticate: outcomeOf(second.auth),
          scheme: second.auth.response?.redirectScheme ?? null,
          delivered: second.delivered ? (second.delivered.status ?? second.delivered.error) : null,
          connected: second.connected,
          next: null,
        };
        if (second.connected !== true) fail(kind, 'undetermined', 'the fallback through the engine\'s own listener did not report connected');
      }
    } finally {
      server.close();
      step('exit', await engine.stop());
    }
    if (q.name === null) return;
    const next = new Engine(`${kind}-next`, options);
    try {
      step('next: initialize', answerOf(await next.init()));
      q.next = brief(await next.until(q.name, ['needs-auth', 'connected', 'failed'], 30_000));
      if (q.fallback) q.fallback.next = q.next;
      step('next: mcp_status', { server: q.next });
    } finally {
      step('next: exit', await next.stop());
    }
  });
}

// The plugin question's plugin: a manifest and an .mcp.json naming the fixture's resource.
function scratchPlugin() {
  const root = join(outDir, 'fx-plugin');
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: 'fx-plugin', version: '0.0.1', description: 'The sign-in spike\'s plugin: one HTTP server, the OAuth fixture' }, null, 2)}\n`);
  writeFileSync(join(root, '.mcp.json'), `${JSON.stringify({ mcpServers: { 'fx-oauth': { type: 'http', url: resourceUrl } } }, null, 2)}\n`);
  return root;
}

async function main() {
  // custom: MAWS's 127.0.0.1 redirect URI, then mcp_oauth_callback_url; a consent delayed 15 s
  await question('custom', async (q, step) => {
    const engine = new Engine('custom');
    try {
      step('initialize', answerOf(await engine.init()));
      step('mcp_status before', { server: brief(await engine.until('fx-custom', ['needs-auth', 'connected', 'failed'], 30_000)) });
      const { server, redirectUri } = await listener();
      try {
        const outcome = await signIn(engine, 'fx-custom', { redirectUri, consentDelayMs: 15_000 }, step);
        q.redirectScheme = outcome.auth.response?.redirectScheme ?? null;
        q.connected = outcome.connected;
        if (outcome.auth.subtype !== 'success') fail('custom', 'engine', outcome.auth.error);
        else if (outcome.connected !== true) fail('custom', 'undetermined', 'the server did not report connected');
      } finally {
        server.close();
      }
      if (q.connected !== true) {
        const reconnect = await engine.request('mcp_reconnect', { serverName: 'fx-custom' }, 30_000);
        step('mcp_reconnect (only when not connected)', answerOf(reconnect));
        step('mcp_status after reconnect', { server: brief(await engine.until('fx-custom', ['connected', 'failed'], 20_000)) });
      }
    } finally {
      step('exit', await engine.stop());
    }
  });

  // localhost: no redirectUri, the engine's own listener
  await question('localhost', async (q, step) => {
    const engine = new Engine('localhost');
    try {
      step('initialize', answerOf(await engine.init()));
      step('mcp_status before', { server: brief(await engine.until('fx-localhost', ['needs-auth', 'connected', 'failed'], 30_000)) });
      const outcome = await signIn(engine, 'fx-localhost', {}, step);
      q.redirectScheme = outcome.auth.response?.redirectScheme ?? null;
      q.callbackPort = outcome.auth.response?.callbackPort ?? null;
      q.connected = outcome.connected;
      if (outcome.auth.subtype !== 'success') fail('localhost', 'engine', outcome.auth.error);
      else if (outcome.connected !== true) fail('localhost', 'undetermined', 'the server did not report connected');
    } finally {
      step('exit', await engine.stop());
    }
  });

  // pending: a second mcp_authenticate while the first waits; which flow's callback completes
  await question('pending', async (q, step) => {
    const engine = new Engine('pending');
    const { server, redirectUri } = await listener();
    try {
      step('initialize', answerOf(await engine.init()));
      await engine.until('fx-pending', ['needs-auth', 'connected', 'failed'], 30_000);
      const first = await engine.request('mcp_authenticate', { serverName: 'fx-pending', redirectUri }, 45_000);
      step('first mcp_authenticate', answerOf(first));
      const second = await engine.request('mcp_authenticate', { serverName: 'fx-pending', redirectUri }, 45_000);
      step('second mcp_authenticate while the first is pending', answerOf(second));
      q.secondAnswer = second.subtype === 'success' ? 'a new flow' : second.error;
      if (first.response?.authUrl) {
        const browsed = await browse(first.response.authUrl);
        const stale = await engine.request('mcp_oauth_callback_url', { serverName: 'fx-pending', callbackUrl: browsed.location }, 30_000);
        step('the first flow\'s callback', answerOf(stale));
        q.firstFlowCallback = stale.subtype === 'success' ? 'accepted' : stale.error;
      }
      if (second.response?.authUrl) {
        const browsed = await browse(second.response.authUrl);
        const fresh = await engine.request('mcp_oauth_callback_url', { serverName: 'fx-pending', callbackUrl: browsed.location }, 30_000);
        step('the second flow\'s callback', answerOf(fresh));
        q.secondFlowCallback = fresh.subtype === 'success' ? 'accepted' : fresh.error;
      }
      q.final = brief(await engine.until('fx-pending', ['connected', 'failed'], 20_000));
      step('mcp_status after', { server: q.final });
    } finally {
      server.close();
      step('exit', await engine.stop());
    }
  });

  // cancel: MAWS abandons the flow (its listener closed), then a retry
  await question('cancel', async (q, step) => {
    const engine = new Engine('cancel');
    try {
      step('initialize', answerOf(await engine.init()));
      await engine.until('fx-cancel', ['needs-auth', 'connected', 'failed'], 30_000);
      const abandoned = await listener();
      const first = await engine.request('mcp_authenticate', { serverName: 'fx-cancel', redirectUri: abandoned.redirectUri }, 45_000);
      step('mcp_authenticate, then Cancel', answerOf(first));
      abandoned.server.close();
      const staleLocation = first.response?.authUrl ? (await browse(first.response.authUrl)).location : null;
      await delay(1000);
      const retry = await listener();
      try {
        const outcome = await signIn(engine, 'fx-cancel', { redirectUri: retry.redirectUri }, step);
        q.retryConnected = outcome.connected;
        if (outcome.connected !== true) fail('cancel', outcome.auth.subtype === 'success' ? 'undetermined' : 'engine', 'the retry did not complete');
      } finally {
        retry.server.close();
      }
      if (staleLocation !== null) {
        const stale = await engine.request('mcp_oauth_callback_url', { serverName: 'fx-cancel', callbackUrl: staleLocation }, 30_000);
        step('the abandoned flow\'s callback after the retry', answerOf(stale));
        q.staleCallback = stale.subtype === 'success' ? 'accepted' : stale.error;
      }
    } finally {
      step('exit', await engine.stop());
    }
  });

  // late: added to the file configuration after the session started
  await question('late', async (q, step) => {
    const engine = new Engine('late');
    try {
      step('initialize', answerOf(await engine.init()));
      await engine.until('fx-custom', ['needs-auth', 'connected', 'failed'], 30_000);
      const added = cli(['mcp', 'add', '--transport', 'http', 'fx-late', resourceUrl, '--scope', 'user']);
      step('mcp add after the start', added);
      await delay(5000);
      const listed = await engine.statusOf('fx-late');
      step('mcp_status 5 s later', { server: brief(listed) });
      q.listedAfterAdd = listed !== null;
      const auth = await engine.request('mcp_authenticate', { serverName: 'fx-late', redirectUri: 'http://127.0.0.1:9/callback' }, 30_000);
      step('mcp_authenticate', answerOf(auth));
      q.authenticate = auth.subtype === 'success' ? 'started' : auth.error;
      const reconnect = await engine.request('mcp_reconnect', { serverName: 'fx-late' }, 30_000);
      step('mcp_reconnect', answerOf(reconnect));
      q.reconnect = reconnect.subtype === 'success' ? 'ok' : reconnect.error;
    } finally {
      step('exit', await engine.stop());
      step('mcp remove', cli(['mcp', 'remove', 'fx-late', '--scope', 'user']));
    }
  });

  // pathA: mcp_set_servers into a session holding a --mcp-config server and an SDK server
  await question('pathA', async (q, step) => {
    const localServer = { type: 'stdio', command: process.execPath, args: ['-e', 'process.stdin.resume()'] };
    const engine = new Engine('pathA', { mcpConfig: { mcpServers: { 'spike-keep': localServer } }, sdkServers: ['spike-sdk'] });
    const { server, redirectUri } = await listener();
    try {
      step('initialize', answerOf(await engine.init()));
      await delay(3000);
      const before = await engine.status();
      step('mcp_status before', { servers: before.map((s) => ({ name: s.name, status: s.status, scope: s.scope ?? null })) });
      const only = await engine.request('mcp_set_servers', { servers: { 'fx-dynamic': { type: 'http', url: resourceUrl } } }, 30_000);
      step('mcp_set_servers naming only the new server', answerOf(only));
      await delay(2000);
      const afterOnly = await engine.status();
      step('mcp_status after', { servers: afterOnly.map((s) => ({ name: s.name, status: s.status, scope: s.scope ?? null })) });
      q.keepsDynamicWhenOmitted = afterOnly.some((s) => s.name === 'spike-keep');
      q.keepsSdkWhenOmitted = afterOnly.some((s) => s.name === 'spike-sdk');
      const both = await engine.request('mcp_set_servers', { servers: { 'spike-keep': localServer, 'fx-dynamic': { type: 'http', url: resourceUrl } } }, 30_000);
      step('mcp_set_servers naming both', answerOf(both));
      await delay(2000);
      const afterBoth = await engine.status();
      step('mcp_status after both', { servers: afterBoth.map((s) => ({ name: s.name, status: s.status, scope: s.scope ?? null })) });
      q.keepsDynamicWhenNamed = afterBoth.some((s) => s.name === 'spike-keep');
      q.keepsSdkWhenNamed = afterBoth.some((s) => s.name === 'spike-sdk');
      await engine.until('fx-dynamic', ['needs-auth', 'connected', 'failed'], 20_000);
      const outcome = await signIn(engine, 'fx-dynamic', { redirectUri }, step);
      q.redirectScheme = outcome.auth.response?.redirectScheme ?? null;
      q.connected = outcome.connected;
      if (outcome.connected !== true) fail('pathA', outcome.auth.subtype === 'success' ? 'undetermined' : 'engine', 'the loaded server did not sign in');
    } finally {
      server.close();
      step('exit', await engine.stop());
    }
    step('mcp add fx-dynamic to the file configuration', cli(['mcp', 'add', '--transport', 'http', 'fx-dynamic', resourceUrl, '--scope', 'user']));
  });

  // next: a fresh file-configured session; whose sign-in it inherits
  await question('next', async (q, step) => {
    const engine = new Engine('next');
    try {
      step('initialize', answerOf(await engine.init()));
      const names = [...NAMES, 'fx-dynamic'];
      const stop = Date.now() + 30_000;
      let servers = [];
      for (;;) {
        servers = await engine.status();
        const settled = names.every((name) => { const s = servers.find((x) => x.name === name); return s && s.status !== 'pending'; });
        if (settled || Date.now() > stop) break;
        await delay(1500);
      }
      q.status = Object.fromEntries(names.map((name) => [name, servers.find((s) => s.name === name)?.status ?? null]));
      step('mcp_status', { status: q.status });
    } finally {
      step('exit', await engine.stop());
    }
  });

  // dynamic: a server of the launch's own list, shaped as appMcpConfig shapes MAWS's (src/shared/engine/app-mcp-servers.ts)
  await dynamicQuestion('dynamic', { launch: { mcpConfig: { mcpServers: { 'fx-own': { type: 'http', url: resourceUrl } } } }, expectedName: 'fx-own', matches: (server) => server.name === 'fx-own' });

  // The engine drops a plugin's server whose address a file-configured server already names ("Suppressing plugin MCP
  // server … duplicates manually-configured …", gate run 43357272365: the plugin's server was never listed), so the
  // file-configured servers leave the configuration before the plugin is asked.
  result.removes = {};
  for (const name of [...NAMES, 'fx-dynamic']) result.removes[name] = cli(['mcp', 'remove', name, '--scope', 'user']);

  // plugin: a plugin's server; found by its own name's end, so a name form other than the expected one is still asked
  await dynamicQuestion('plugin', { launch: { pluginDirs: [scratchPlugin()] }, expectedName: 'plugin:fx-plugin:fx-oauth', matches: (server) => server.name.startsWith('plugin:') && server.name.endsWith(':fx-oauth') });

  result.plaintextCredentials = existsSync(join(configDir, '.credentials.json'));
  save();
}

main().then(() => process.exit(0), (error) => {
  result.error = String(error.stack ?? error);
  save();
  process.exit(1);
});
