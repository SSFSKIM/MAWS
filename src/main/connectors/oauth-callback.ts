// P3-HD M3a: the loopback listener an owner's Connect receives its authorization callback on
// (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md, OAuth custody: "Bind the callback listener to 127.0.0.1,
// random port ... No wildcard or localhost listener"). The flow (./oauth-flow.ts) owns what a request means; this
// only binds, answers with the flow's reply and closes. Bound on the literal 127.0.0.1 with port 0, so the redirect
// URI is `http://127.0.0.1:<port>/callback`; it answers each request with fixed text and never reads a body.
import { createServer, type Server } from 'node:http';

export interface LoopbackRequest {
  readonly method: string;
  readonly url: string; // the request target as received: path and query
}
export interface LoopbackReply {
  readonly status: number;
  readonly body: string;
}
export interface LoopbackListener {
  readonly port: number;
  close(): Promise<void>;
}
export type ListenLoopback = (handle: (request: LoopbackRequest) => LoopbackReply) => Promise<LoopbackListener>;

export const OAUTH_CALLBACK_HOST = '127.0.0.1';

export const listenLoopback: ListenLoopback = (handle) => new Promise((resolve, reject) => {
  const server: Server = createServer((request, response) => {
    let reply: LoopbackReply;
    try {
      reply = handle({ method: request.method ?? '', url: request.url ?? '' });
    } catch {
      reply = { status: 500, body: 'MAWS could not read this request.' };
    }
    response.writeHead(reply.status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', connection: 'close' });
    response.end(reply.body);
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 10_000;
  server.maxHeadersCount = 64;
  server.once('error', reject);
  server.listen({ host: OAUTH_CALLBACK_HOST, port: 0, exclusive: true }, () => {
    server.off('error', reject);
    const address = server.address();
    if (address === null || typeof address === 'string' || address.address !== OAUTH_CALLBACK_HOST) {
      server.close();
      reject(new Error('loopback listener did not bind 127.0.0.1'));
      return;
    }
    let closing: Promise<void> | null = null;
    resolve({
      port: address.port,
      close: () => closing ??= new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      }),
    });
  });
});
