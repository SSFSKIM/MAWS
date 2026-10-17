// A minimal stdio MCP server for the connector e2e runs (P3-H): newline-delimited JSON-RPC 2.0 with no SDK, serving the
// tools its arguments name and appending every request it receives to a shared call log, so a run can prove which
// server answered a call and that a silent stretch saw none.
//   node connector-mcp-server.mjs --id <id> --log <file> --tools '<json array of tool names>'
// A tool call answers `{server: <id>, tool, arguments, n}` as text and as structuredContent, n counting this
// process's calls.
import { appendFileSync, existsSync } from 'node:fs';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { clearInterval, setInterval } from 'node:timers'; // P3-HD M4b

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) throw new Error(`connector-mcp-server: --${name} is required`);
  return process.argv[i + 1];
};
const id = arg('id');
const log = arg('log');
const tools = JSON.parse(arg('tools'));
// P3-HD M4: an optional hold file. While it exists a tools/call is logged on receipt (the evidence of its submission) and
// not answered, so a scene can keep a call pending on this process. Absent the option (every H scene), nothing changes.
// P3-HD M4b: once the file is removed, each held call is answered late (logged `released` first), so a scene can show
// that a result arriving after a revoke or delete never reaches the page; a process ended meanwhile answers nothing.
const holdIndex = process.argv.indexOf('--hold');
const hold = holdIndex === -1 ? null : process.argv[holdIndex + 1];
let calls = 0;
const held = []; // P3-HD M4b
let releasing = null;

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
      const structuredContent = { server: id, tool: params.name, arguments: params.arguments ?? {}, n: calls };
      return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent };
    }
    default:
      return { error: { code: -32601, message: `method not found: ${method}` } };
  }
}

const reply = (message) => {
  const result = answer(message.method, message.params);
  send(result.error ? { id: message.id, error: result.error } : { id: message.id, result });
};

// P3-HD M4b: the held calls answered once the hold file is gone; the timer never keeps the process up by itself.
function releaseLater() {
  if (releasing !== null) return;
  releasing = setInterval(() => {
    if (existsSync(hold)) return;
    clearInterval(releasing);
    releasing = null;
    for (const message of held.splice(0)) {
      record({ method: null, event: 'released', tool: message.params?.name, rpcId: message.id });
      reply(message);
    }
  }, 100);
  releasing.unref();
}
if (hold !== null) process.stdout.on('error', () => {}); // P3-HD M4b: a late answer to a reader that has gone is dropped

for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === '') continue;
  const message = JSON.parse(line);
  // P3-HD M4b: with a hold file, a tools/call is logged with its JSON-RPC id, so a scene can tell which held call was released
  record({ method: message.method ?? null, ...(message.method === 'tools/call' ? { tool: message.params?.name, arguments: message.params?.arguments ?? {}, ...(hold !== null && { rpcId: message.id }) } : {}) });
  if (hold !== null && message.method === 'tools/call' && existsSync(hold)) {
    // P3-HD M4: submitted and held; M4b: answered when the hold file is removed
    if (message.id !== undefined) held.push(message);
    releaseLater();
    continue;
  }
  if (message.id === undefined || message.method === undefined) continue; // a notification, or a response to nothing we asked
  reply(message);
}
