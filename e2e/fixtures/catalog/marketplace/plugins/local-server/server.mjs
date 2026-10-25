// The local-server plugin's stdio MCP server (the Discover e2e group's test marketplace): newline-delimited JSON-RPC 2.0
// with no SDK and no dependency, so the plugin works from wherever the engine copies it. One tool, `echo`, answering its
// `text` argument.
import process from 'node:process';
import { createInterface } from 'node:readline';

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) return; // a notification
  switch (message.method) {
    case 'initialize':
      return send({ id: message.id, result: { protocolVersion: message.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'maws-discover-echo', version: '0.1.0' } } });
    case 'ping':
      return send({ id: message.id, result: {} });
    case 'tools/list':
      return send({ id: message.id, result: { tools: [{ name: 'echo', description: 'Answers its text argument.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] } });
    case 'tools/call':
      return send({ id: message.id, result: { content: [{ type: 'text', text: String(message.params?.arguments?.text ?? '') }] } });
    default:
      return send({ id: message.id, error: { code: -32601, message: `method not found: ${String(message.method)}` } });
  }
});
