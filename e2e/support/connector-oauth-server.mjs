// P3-HD M4a: the toy OAuth-protected MCP server of route D's OAuth scenes, over HTTP on 127.0.0.1 only. Its logic, the
// two phases and what it logs are ./connector-oauth-core.mjs's; this binds a random port, reads the scene's control
// file on every request (absent or invalid means the open phase), and appends each request's safe entry to the log and
// what it saw or minted to the secrets file (created 0600; a scene scans its evidence against it and never retains it).
// Grants live in this process's memory, so they outlast an app relaunch while the scene keeps the process.
//   node connector-oauth-server.mjs --id <id> --log <file> --control <file> --secrets <file> [--tools '<json>'] [--mode maws|engine]
// P4-AGG M1: `--mode engine` registers the engine's own callbacks (./connector-oauth-core.mjs).
//   (prints {"port":n} once listening)
import { Buffer } from 'node:buffer';
import { appendFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import process from 'node:process';
import { createOAuthFixtureCore, parseOAuthControl } from './connector-oauth-core.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= argv.length) {
    if (fallback !== undefined) return fallback;
    throw new Error(`connector-oauth-server: --${name} is required`);
  }
  return argv[i + 1];
};
const id = arg('id');
const log = arg('log');
const controlFile = arg('control');
const secretsFile = arg('secrets');
const tools = JSON.parse(arg('tools', '["read_series"]'));
const mode = arg('mode', 'maws'); // P4-AGG M1
const BODY_LIMIT = 1_000_000;

function control() {
  try {
    return parseOAuthControl(readFileSync(controlFile, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return parseOAuthControl(null);
    throw error;
  }
}

let core = null;
const server = createServer((req, res) => {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > BODY_LIMIT) req.destroy();
    else chunks.push(chunk);
  });
  req.on('end', () => {
    const headers = Object.fromEntries(Object.entries(req.headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : value]));
    const { response, entry, secrets } = core.handle({ method: req.method ?? '', url: req.url ?? '/', headers, body: Buffer.concat(chunks).toString('utf8') }, control());
    if (secrets.length > 0) appendFileSync(secretsFile, secrets.map((secret) => `${JSON.stringify(secret)}\n`).join(''), { mode: 0o600 });
    appendFileSync(log, `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...entry })}\n`);
    res.writeHead(response.status, { ...response.headers, connection: 'close' });
    res.end(response.body);
  });
});
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  core = createOAuthFixtureCore({ id, origin: `http://127.0.0.1:${port}`, tools, mode, now: Date.now, randomToken: () => randomBytes(32).toString('base64url') });
  appendFileSync(log, `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, server: id, event: 'start', port })}\n`);
  process.stdout.write(`${JSON.stringify({ port })}\n`);
});
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  server.closeAllConnections();
});
