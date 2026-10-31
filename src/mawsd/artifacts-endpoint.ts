// `mawsd`'s artifact endpoint (P5 O5 M2; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §C): the one
// source of a `maws-artifact:` URL's bytes on the machine, served over HTTP on `<socketDir>/artifacts.sock` (0600, in the
// daemon's 0700 directory, made and checked as `mawsd`'s other sockets are; no loopback port, no token: P5 §6,
// acceptance 15), to the app's and the render host's scheme proxy, and through `fetch` to O10's module (O7 M5's RL2
// kind). The answers are the scheme library's (src/services/artifacts/scheme/), resolving each URL through the engine
// host's `artifacts.content` (`content`), never through the spine, so a page loads while the spine is cold; a request
// while the engine host is parked wakes it, as any remote request does.
//
// At idle it costs one bound socket and nothing loaded (acceptance 14): the server here is Node's `net`, its accepted
// connections paused, and the library (its HTTP server, the handler, the bridge script) is a chunk loaded at the first
// accepted connection or `fetch`, then handed every connection. A load that fails (the bundle replaced under a running
// daemon) answers that request 503 in one line and the next use loads again.
import { createServer, type Server, type Socket } from 'node:net';
import type { CommandInput, CommandResult } from '@shared/ipc/schema';
import type { DaemonArtifacts } from '@shared/ipc/schema/daemon';
import type { EndpointLibrary } from '../services/artifacts/scheme/endpoint-library';
import type { DaemonServices } from './endpoint-seam';

export type EndpointChunk = { endpointLibrary(content: ArtifactsEndpointOptions['content'], onRequest?: () => void): EndpointLibrary };

export interface ArtifactsEndpointOptions {
  content(input: CommandInput<'artifacts.content'>): Promise<CommandResult<'artifacts.content'>>; // the engine host's
  load?(): Promise<EndpointChunk>; // the library's chunk (a test's, or one the bundle swap refuses)
  log(line: string): void;
}

export interface ArtifactsEndpoint {
  server: Server; // the daemon listens it at artifacts.sock with its other sockets (start step 6)
  fetch: DaemonServices['artifacts']['fetch'];
  status(): DaemonArtifacts; // daemon.status.artifacts
  close(): void; // every connection it holds ends (the exit order)
}

export const loadEndpointChunk = (): Promise<EndpointChunk> => import('../services/artifacts/scheme/endpoint-library');

export function createArtifactsEndpoint({ content, load = loadEndpointChunk, log }: ArtifactsEndpointOptions): ArtifactsEndpoint {
  const sockets = new Set<Socket>();
  let library: EndpointLibrary | null = null;
  let loading: Promise<EndpointLibrary> | null = null;
  let requests = 0;
  let closed = false;

  const ensure = (): Promise<EndpointLibrary> => {
    if (library) return Promise.resolve(library);
    loading ??= load().then(
      (chunk) => {
        library = chunk.endpointLibrary(content, () => void requests++);
        log('the artifact endpoint’s handler loaded at its first use');
        return library;
      },
      (error: unknown) => {
        loading = null;
        const why = error instanceof Error ? error.message : String(error);
        log(`the artifact endpoint’s handler could not load: ${why}`);
        throw new Error(`the artifact endpoint could not load: ${why}`);
      },
    );
    return loading;
  };

  // Paused at the accept (nothing read until the library takes it), so a request written before the load ends waits.
  const server = createServer({ pauseOnConnect: true }, (socket) => {
    if (closed) return void socket.destroy();
    sockets.add(socket);
    socket.on('close', () => void sockets.delete(socket));
    socket.on('error', () => {}); // a client gone mid-answer
    ensure().then(
      (served) => {
        if (!socket.destroyed) served.accept(socket);
      },
      (error: Error) => socket.end(unavailable(error.message)),
    );
  });

  return {
    server,
    async fetch(request) {
      let served: EndpointLibrary;
      try {
        served = await ensure();
      } catch (error) {
        return { status: 503, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' }, body: new Response((error as Error).message).body };
      }
      return served.fetch(request);
    },
    status: () => ({ loaded: library !== null, requests }),
    close() {
      closed = true;
      for (const socket of sockets) socket.destroy();
      sockets.clear();
    },
  };
}

// A 503 written on a connection with no HTTP library loaded: one line, and the connection ends.
function unavailable(message: string): string {
  const body = Buffer.from(message, 'utf8');
  return `HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/plain\r\nCache-Control: no-store\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${message}`;
}
