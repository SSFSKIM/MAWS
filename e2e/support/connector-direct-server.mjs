// P3-HD's fixture MCP server (e2e/connectors-direct.spec.ts): newline-delimited JSON-RPC over stdio, or Streamable HTTP
// in JSON-response mode on 127.0.0.1 only, with no SDK. Every request goes to a shared call log; a stdio instance first
// logs what it was started with (its cwd, its arguments, its MAWS_PROBE_* environment and the SDK-minimal keys), so a
// run can compare the instance the engine started with the entry MAWS would start from the same file. `--auth` answers
// the MCP endpoint 401 with protected-resource and authorization-server metadata, and never issues a token. It is for
// MAWS's own client only: no engine is ever configured with an `--auth` instance (P3-HD Decision Log 23; an engine's
// discovery may enter its native credential custody), which support/connector-direct-probe.ts refuses at launch.
//   node connector-direct-server.mjs stdio --id <id> --log <file> [--tools '<json>'] [any further arguments, logged]
//   node connector-direct-server.mjs http --id <id> --log <file> [--tools '<json>'] [--auth]   (prints {"port":n})
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import process from 'node:process';
import { URL } from 'node:url';
import { createInterface } from 'node:readline';

const argv = process.argv.slice(2);
const mode = argv[0];
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= argv.length) {
    if (fallback !== undefined) return fallback;
    throw new Error(`connector-direct-server: --${name} is required`);
  }
  return argv[i + 1];
};
const id = arg('id');
const log = arg('log');
const tools = JSON.parse(arg('tools', '["rows"]'));
let calls = 0;

const record = (entry) => appendFileSync(log, `${JSON.stringify({ at: new Date().toISOString(), server: id, pid: process.pid, ...entry })}\n`);

function answer(method, params) {
  switch (method) {
    case 'initialize':
      return { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'maws-direct-fixture', version: '0.0.1' } };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: tools.map((name) => ({ name, description: `Fixture tool ${name} of ${id}`, inputSchema: { type: 'object', properties: {}, additionalProperties: true }, annotations: { readOnlyHint: true } })) };
    case 'tools/call': {
      if (!tools.includes(params?.name)) return { error: { code: -32602, message: `unknown tool ${String(params?.name)}` } };
      calls += 1;
      const structuredContent = { server: id, tool: params.name, arguments: params.arguments ?? {}, n: calls };
      return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent };
    }
    default:
      return { error: { code: -32601, message: `method not found: ${method}` } };
  }
}
const reply = (message) => {
  const result = answer(message.method, message.params);
  return { jsonrpc: '2.0', id: message.id, ...(result.error ? { error: result.error } : { result }) };
};

if (mode === 'stdio') {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('MAWS_PROBE_')));
  const sdk = Object.fromEntries(['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER'].filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
  record({ event: 'start', cwd: process.cwd(), argv, env, sdk });
  for await (const line of createInterface({ input: process.stdin })) {
    if (line.trim() === '') continue;
    const message = JSON.parse(line);
    record({ method: message.method ?? null, ...(message.method === 'tools/call' ? { tool: message.params?.name } : {}) });
    if (message.id === undefined || message.method === undefined) continue;
    process.stdout.write(`${JSON.stringify(reply(message))}\n`);
  }
} else if (mode === 'http') {
  const auth = argv.includes('--auth');
  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      const path = new URL(req.url ?? '/', origin).pathname;
      let message;
      try {
        message = body ? JSON.parse(body) : null;
      } catch {
        message = null;
      }
      record({ event: 'http', method: message?.method ?? null, httpMethod: req.method, path, probeHeader: req.headers['x-probe-header'] ?? null, authorization: req.headers.authorization === undefined ? null : 'present' });
      if (path.startsWith('/.well-known/oauth-protected-resource')) return auth ? json(res, 200, { resource: `${origin}/mcp`, authorization_servers: [origin] }) : json(res, 404, { error: 'not_found' });
      if (path === '/.well-known/oauth-authorization-server' || path === '/.well-known/openid-configuration')
        return auth ? json(res, 200, { issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] }) : json(res, 404, { error: 'not_found' });
      if (path !== '/mcp') return json(res, path === '/register' || path === '/token' ? 400 : 404, { error: 'invalid_request', error_description: 'a fixture: no client is registered and no token issued' });
      if (auth && req.headers.authorization === undefined) return json(res, 401, { error: 'invalid_token' }, { 'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` });
      if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' }, { allow: 'POST' }); // no standalone SSE stream
      if (message === null || Array.isArray(message)) return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'one JSON-RPC message per request' } });
      if (message.id === undefined) {
        res.writeHead(202);
        return res.end();
      }
      return json(res, 200, reply(message));
    });
  });
  server.listen(0, '127.0.0.1', () => process.stdout.write(`${JSON.stringify({ port: server.address().port })}\n`));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
} else {
  throw new Error(`connector-direct-server: unknown mode ${mode}`);
}
