// A write-shaped stdio MCP server standing in for a Drive or Notion connector in P3-H's Send to live run (P3 Decision
// Log 81, 87): one tool, `send_document(local_path)`, which reads the named file, records its byte count and SHA-256 in
// a delivery log and answers what it received, so no file content crosses the model. It reads only regular files under
// the one directory it is allowed (the scratch profile's artifact store, where `artifacts.export` writes), resolved
// through symlinks; anything else is refused and logged. Newline-delimited JSON-RPC 2.0, no SDK, no network.
//   node send-to-mcp-server.mjs --service 'Google Drive' --log <deliveries.jsonl> --allow <dir>
import { appendFileSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, sep } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) throw new Error(`send-to-mcp-server: --${name} is required`);
  return process.argv[i + 1];
};
const service = arg('service');
const log = arg('log');
const allow = arg('allow'); // resolved at each call: the store may make it after this server starts
const TOOL = 'send_document';

const record = (entry) => appendFileSync(log, `${JSON.stringify({ at: new Date().toISOString(), service, pid: process.pid, ...entry })}\n`);
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const text = (value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }];

// The delivery: the file's bytes as this server read them, or why it read none.
function deliver(localPath) {
  if (typeof localPath !== 'string' || localPath === '') return { refused: 'local_path must be the absolute path of a file' };
  let real;
  try {
    real = realpathSync(localPath);
  } catch {
    return { refused: `no file at ${localPath}` };
  }
  let allowed;
  try {
    allowed = realpathSync(allow);
  } catch {
    return { refused: `the folder this connector may read (${allow}) does not exist` };
  }
  if (!real.startsWith(`${allowed}${sep}`)) return { refused: `${localPath} is outside the folder this connector may read` };
  if (!statSync(real).isFile()) return { refused: `${localPath} is not a file` };
  const bytes = readFileSync(real);
  return { name: basename(real), path: real, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function answer(method, params) {
  switch (method) {
    case 'initialize':
      return { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: `maws-send-to-fixture (${service})`, version: '0.0.1' } };
    case 'ping':
      return {};
    case 'tools/list':
      return {
        tools: [
          {
            name: TOOL,
            description: `Upload a file from this computer to ${service}. Pass the file's absolute local path; the file is uploaded as it is.`,
            inputSchema: { type: 'object', properties: { local_path: { type: 'string', description: 'Absolute path of the file to upload' } }, required: ['local_path'], additionalProperties: false },
            annotations: { title: `Upload to ${service}`, readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
          },
        ],
      };
    case 'tools/call': {
      if (params?.name !== TOOL) return { error: { code: -32602, message: `unknown tool ${String(params?.name)}` } };
      const localPath = params.arguments?.local_path;
      const delivered = deliver(localPath);
      record({ tool: TOOL, local_path: localPath ?? null, ...delivered });
      if (delivered.refused) return { content: text(`Not uploaded: ${delivered.refused}`), isError: true };
      const receipt = { service, name: delivered.name, bytes: delivered.bytes, sha256: delivered.sha256 };
      return { content: text(`Uploaded ${delivered.name} to ${service} (${delivered.bytes} bytes, sha256 ${delivered.sha256}).`), structuredContent: receipt };
    }
    default:
      return { error: { code: -32601, message: `method not found: ${method}` } };
  }
}

for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === '') continue;
  const message = JSON.parse(line);
  if (message.method !== undefined) record({ method: message.method });
  if (message.id === undefined || message.method === undefined) continue; // a notification, or a response to nothing we asked
  const result = answer(message.method, message.params);
  send(result.error ? { id: message.id, error: result.error } : { id: message.id, result });
}
