// A minimal stdio MCP server for the connector e2e runs (P3-H): newline-delimited JSON-RPC 2.0 with no SDK, serving the
// tools its arguments name and appending every request it receives to a shared call log, so a run can prove which
// server answered a call and that a silent stretch saw none.
//   node connector-mcp-server.mjs --id <id> --log <file> --tools '<json array of tool names>'
// A tool call answers `{server: <id>, tool, arguments, n}` as text and as structuredContent, n counting this
// process's calls.
//
// E3 M4 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R5): `--mode rows --control <file>` is a live
// dataset's server instead. A call answers the standard `{rows: [...]}` envelope of flat records (as text and as
// structuredContent), the reply named by the control file's JSON, read at each call so one query can answer differently:
//   {"reply": "rows", "rows": [{...}, ...]}   these records
//   {"reply": "invalid"}                       structuredContent whose `rows` is not an array (a malformed result)
//   {"reply": "isError"}                       a tool error
// each with an optional "delayMs" before the answer, during which other requests are answered. No control file: the
// built-in DEFAULT_ROWS. A control file naming no such reply answers an error, never rows.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createInterface } from 'node:readline';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) throw new Error(`connector-mcp-server: --${name} is required`);
  return process.argv[i + 1];
};
const id = arg('id');
const log = arg('log');
const tools = JSON.parse(arg('tools'));
let calls = 0;

// E3 start: the rows mode
const mode = process.argv.includes('--mode') ? arg('mode') : null;
if (mode !== null && mode !== 'rows') throw new Error(`connector-mcp-server: unknown --mode ${mode}`);
const control = mode === 'rows' ? arg('control') : null;
const DEFAULT_ROWS = [
  { day: '2026-10-01', signups: 12 },
  { day: '2026-10-02', signups: 18 },
  { day: '2026-10-03', signups: 15 },
];
const envelope = (structuredContent) => ({ content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent });
const REPLIES = {
  rows: (reply) => (Array.isArray(reply.rows) ? envelope({ rows: reply.rows }) : null),
  invalid: () => envelope({ rows: 'not rows' }),
  isError: () => ({ content: [{ type: 'text', text: `fixture ${id}: the series is unavailable` }], isError: true }),
};
// The control file's reply as an MCP result, after its delay; an error when it names none.
async function rowsCall() {
  let reply;
  try {
    reply = existsSync(control) ? JSON.parse(readFileSync(control, 'utf8')) : { reply: 'rows', rows: DEFAULT_ROWS };
  } catch {
    reply = readFileSync(control, 'utf8'); // not JSON: answered as not understood
  }
  const result = Object.hasOwn(REPLIES, reply?.reply) ? REPLIES[reply.reply](reply) : null;
  const delayMs = reply?.delayMs ?? 0;
  if (result === null || !Number.isInteger(delayMs) || delayMs < 0) return { error: { code: -32603, message: `fixture reply not understood: ${JSON.stringify(reply)}` } };
  if (delayMs > 0) await sleep(delayMs);
  return result;
}
// E3 end

const record = (entry) => appendFileSync(log, `${JSON.stringify({ at: new Date().toISOString(), server: id, pid: process.pid, ...entry })}\n`);
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

function answer(method, params) {
  switch (method) {
    case 'initialize':
      return { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'maws-connector-fixture', version: '0.0.1' } };
    case 'ping':
      return {};
    case 'tools/list':
      return {
        tools: tools.map((name) => ({ name, description: `Fixture tool ${name} of ${id}`, inputSchema: { type: 'object', properties: {}, additionalProperties: true }, annotations: { readOnlyHint: true } })),
      };
    case 'tools/call': {
      if (!tools.includes(params?.name)) return { error: { code: -32602, message: `unknown tool ${String(params?.name)}` } };
      calls += 1;
      if (mode === 'rows') return rowsCall(); // E3
      const structuredContent = { server: id, tool: params.name, arguments: params.arguments ?? {}, n: calls };
      return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent };
    }
    default:
      return { error: { code: -32601, message: `method not found: ${method}` } };
  }
}

for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === '') continue;
  const message = JSON.parse(line);
  record({ method: message.method ?? null, ...(message.method === 'tools/call' ? { tool: message.params?.name, arguments: message.params?.arguments ?? {} } : {}) });
  if (message.id === undefined || message.method === undefined) continue; // a notification, or a response to nothing we asked
  const reply = (result) => send(result.error ? { id: message.id, error: result.error } : { id: message.id, result });
  const result = answer(message.method, message.params);
  if (result instanceof Promise) void result.then(reply); // E3: a rows call answers when its delay is over
  else reply(result);
}
