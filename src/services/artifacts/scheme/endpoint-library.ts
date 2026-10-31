// The artifact endpoint's library (P5 O5 M2; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §C): what
// `mawsd`'s artifact endpoint (src/mawsd/artifacts-endpoint.ts) loads at its first use, a chunk of its own, never at
// `mawsd`'s start. Over one content lookup (the engine host's `artifacts.content`) it serves the scheme's answers to the
// connections the endpoint accepted on `artifacts.sock` (an HTTP server that never listens itself; the endpoint ends
// the connections it accepted) and to `fetch`, the endpoint's call for O10's module and O7's RL2 kind.
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { createArtifactHandler, type ContentLookup, type SchemeHandler } from './artifact-handler';
import { schemeRequest, serveOverHttp } from './http';

export interface ArtifactFetchRequest {
  url: string;
  method: 'GET' | 'HEAD';
  range?: string;
}
export interface ArtifactFetchAnswer {
  status: number;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array> | null;
}

export interface EndpointLibrary {
  accept(socket: Socket): void; // a connection the endpoint accepted (paused at its accept), served as HTTP from here on
  fetch(request: ArtifactFetchRequest): Promise<ArtifactFetchAnswer>;
}

// `onRequest`: told of each request the scheme's handler answers (one over HTTP or a `fetch`), for the endpoint's count.
export function endpointLibrary(content: ContentLookup, onRequest: () => void = () => {}): EndpointLibrary {
  const artifacts = createArtifactHandler(content);
  const handle: SchemeHandler = (request) => {
    onRequest();
    return artifacts(request);
  };
  const server = createServer(serveOverHttp(handle));
  return {
    accept(socket) {
      server.emit('connection', socket);
      socket.resume();
    },
    async fetch({ url, method, range }) {
      const request = schemeRequest(url, method, range);
      const response = request instanceof Request ? await handle(request) : request;
      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => (headers[name] = value));
      return { status: response.status, headers, body: response.body as ReadableStream<Uint8Array> | null };
    },
  };
}

export type { ContentLookup };
