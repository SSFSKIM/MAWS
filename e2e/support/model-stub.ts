// P4-AGG M5 (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, acceptance 12): a loopback stand-in for the
// relay MAWS routes a gateway session through (MAWS_RELAY_URL, src/engine-host/launch.ts), so a real engine's turn
// records what it sends the model without reaching Anthropic or spending anything. It answers the relay's health check
// (GET /api/hello), count_tokens with a fixed count, and every POST /v1/messages with one short text turn, streamed when
// asked; each Messages request's body is kept. Any other path answers 404. The shape follows
// spikes/protocol-probe/stub-api.mjs (P4-B4), reduced to the one fixed answer.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ModelRequest {
  body: Record<string, unknown>;
  raw: string;
  main: boolean; // the engine's main loop (it sends the tool list), not a side request such as a title
}

export interface ModelStub {
  url: string; // http://127.0.0.1:<port>, the form MAWS_RELAY_URL admits
  requests: ModelRequest[];
  main(): ModelRequest[];
  close(): Promise<void>;
}

const event = (type: string, data: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

function sse(id: string, model: unknown, text: string): string {
  const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  return [
    event('message_start', { message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage } }),
    event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    event('content_block_delta', { index: 0, delta: { type: 'text_delta', text } }),
    event('content_block_stop', { index: 0 }),
    event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }),
    event('message_stop', {}),
  ].join('');
}

export async function startModelStub(text = 'ok'): Promise<ModelStub> {
  const requests: ModelRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0];
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'GET' && path === '/api/hello') return json(200, { ok: true });
      if (req.method === 'POST' && path === '/v1/messages/count_tokens') return json(200, { input_tokens: 1 });
      if (req.method !== 'POST' || path !== '/v1/messages') return json(404, { type: 'error', error: { type: 'not_found_error', message: 'model stub' } });
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'not JSON' } });
      }
      const tools = Array.isArray(body.tools) ? (body.tools as { name?: unknown }[]) : [];
      requests.push({ body, raw, main: tools.some((t) => t?.name === 'Bash' || t?.name === 'Read') });
      const id = `msg_stub_${requests.length}`;
      if (body.stream === true) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        return res.end(sse(id, body.model, text));
      }
      return json(200, { id, type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    main: () => requests.filter((r) => r.main),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
