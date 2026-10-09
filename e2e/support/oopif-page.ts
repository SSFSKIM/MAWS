// The OOPIF page of E11's sitting S4 case 7 and the owner's step F (docs/doperpowers/plans/2026-10-06-e11-finish.md,
// Design §5 S4 and §6 F): `http://127.0.0.1:17393/oopif.html` frames `http://localhost:17393/field.html`, which holds
// one text field labelled "Note" (`name="note"`). `127.0.0.1` and `localhost` are two sites under site isolation, so the
// frame is out of process, as E4c's `/embed.html` was (its e2e server, retired with the browser tools on 2026-10-08); a public page was not chosen
// because no page with a cross-site text field stays put (the field must be there for the owner too, offline or not).
// Listens on both 127.0.0.1 and [::1] so `localhost` resolves whichever family Chromium tries first; a busy port fails
// loudly. The owner's step F serves it with no build and no dependency (Node strips the types), and stops it with ⌃C:
//   node --experimental-strip-types --no-warnings e2e/support/oopif-page.ts
// Node built-ins only, and only erasable TypeScript, so that command runs this file as written.
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

export const OOPIF_PORT = 17393;
export const OOPIF_FIELD = { label: 'Note', name: 'note' } as const;

const html = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="margin:0;padding:16px;font:15px system-ui;background:#fdfdfb;color:#1b1b1b">${body}</body></html>`;

export interface OopifPage {
  page: string; // the top document, on 127.0.0.1
  frame: string; // the framed document, on localhost (a second site)
  close(): Promise<void>;
}

// `port` 0 takes a free port (the unit test); the sitting and the owner use OOPIF_PORT, which the script names.
export async function startOopifPage(port: number = OOPIF_PORT): Promise<OopifPage> {
  const sockets = new Set<Socket>();
  const servers: Server[] = [];
  let frame = '';
  const pages = (path: string): string | undefined =>
    path === '/oopif.html'
      ? html('E11 OOPIF page', `<main><h1>A field in a cross-site frame</h1><iframe title="Second site" src="${frame}" style="width:420px;height:120px;border:1px solid #ccc"></iframe></main>`)
      : path === '/field.html'
        ? html('E11 OOPIF frame', `<form onsubmit="return false"><p><label>${OOPIF_FIELD.label} <input name="${OOPIF_FIELD.name}" autocomplete="off"></label></p></form>`)
        : undefined;
  const handler = (request: IncomingMessage, response: ServerResponse) => {
    const body = pages(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    response.writeHead(body === undefined ? 404 : 200, { 'content-type': body === undefined ? 'text/plain' : 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(body ?? 'not found');
  };
  const close = async () => {
    for (const socket of sockets) socket.destroy();
    await Promise.all(servers.filter((server) => server.listening).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  };
  const listen = (host: string, at: number) =>
    new Promise<number>((resolve, reject) => {
      const server = createServer(handler);
      servers.push(server);
      server.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
      });
      server.once('error', (error) => reject(new Error(`the OOPIF page could not listen on ${host}:${at}: ${error.message}`)));
      server.listen(at, host, () => resolve((server.address() as { port: number }).port));
    });
  try {
    const bound = await listen('127.0.0.1', port); // the first family fixes the port a `0` asked for
    await listen('::1', bound);
    frame = `http://localhost:${bound}/field.html`;
    return { page: `http://127.0.0.1:${bound}/oopif.html`, frame, close };
  } catch (error) {
    await close();
    throw error;
  }
}

// Run as a script (the owner's step F): serve until interrupted.
if (process.argv[1]?.endsWith('oopif-page.ts')) {
  void startOopifPage().then((served) => {
    console.log(`Open ${served.page} in a MAWS Browser tab; the framed field "${OOPIF_FIELD.label}" is served from ${served.frame}. ⌃C stops it.`);
    process.on('SIGINT', () => void served.close().then(() => process.exit(0)));
  });
}
