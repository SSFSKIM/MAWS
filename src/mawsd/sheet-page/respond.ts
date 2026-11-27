// A response's body written in slices (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, §J): each a
// view of the one buffer (no copy), the next written only once the socket has drained the last, so a peer that reads,
// however slowly, makes progress serve.ts can see, and one that stops reading is ended by its stall deadline. In the
// chunk, beside handler.ts and sheet-routes.ts.
import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';

export const SLICE_BYTES = 64 * 1024;

export function sendBytes(res: ServerResponse, status: number, headers: OutgoingHttpHeaders, bytes: Buffer): void {
  res.writeHead(status, { ...headers, 'Content-Length': String(bytes.length) });
  let at = 0;
  const pump = () => {
    while (at < bytes.length && !res.destroyed) {
      const slice = bytes.subarray(at, Math.min(at + SLICE_BYTES, bytes.length));
      at += slice.length;
      if (at >= bytes.length) return void res.end(slice);
      if (!res.write(slice)) return void res.once('drain', pump);
    }
    if (at >= bytes.length && !res.writableEnded && !res.destroyed) res.end();
  };
  pump();
}
