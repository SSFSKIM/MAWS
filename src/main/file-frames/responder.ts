// The responder of file frames' tokens (UX wave U6b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md,
// Interfaces §C; M3, decisions 1 to 5; "The refusals of the route"). Asked first on the default partition's chain (M4),
// it answers a request whose host is a token's and leaves every other request (an artifact's id) to the next responder.
//
// - A token answers at one path: exactly one segment after the host whose decoded value is the name recorded at its issue
//   (L3, as corrected). Another name, a longer path, an empty path, a segment that does not decode and any query are 404,
//   one answer for every cause, as a token it does not hold and a released one are. A method but GET and HEAD is 405.
// - The first read fixes the response: the file's size and its identity. For a request with no range, or a range with a
//   start, it is a page at that start; for a suffix range, one byte at offset 0, to learn the size. The range is then the
//   store's rule (`rangeOf`): 206 for one `bytes=` range, 416 for one past the end, the whole file for anything else.
// - The body is read a page per pull, so a frame that stops reading stops the reads; before each page the token must
//   still be held, and every page must answer the first read's identity, so every byte of a response is of one version.
// - One failure path (A3): every read made for a live token that fails tells the owner (`failed`), once per response,
//   the first read and a suffix range's probe included: before the answer exists it is 404, after it the stream errors.
//   A token released under a response errors the stream and tells nobody: nothing owns it any more.
//
// The headers are the store's (`createSchemeHandler`), with the type and the policy the token was issued with (none for a
// PDF), and no `Access-Control-Allow-Origin`: nothing loads a file's frame across origins.
import { frameTokenOf } from '@shared/files/framed';
import type { SchemeResponder } from '../../services/artifacts/scheme/artifact-handler';
import { rangeOf } from '../../services/artifacts/scheme/scheme-handler';
import { FRAME_PAGE_BYTES, type Page } from './source';
import type { FrameToken, FrameTokens } from './tokens';

export function fileFrameResponder(tokens: Pick<FrameTokens, 'get'>, failed: (token: FrameToken) => void, entered?: (request: Request) => void): SchemeResponder {
  return async (request) => {
    const token = frameTokenOf(request.url);
    if (token === null) return null;
    entered?.(request);
    if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405, 'method not allowed');
    const held = tokens.get(token);
    if (!held || !atItsName(request.url, token, held.name)) return notFound();
    return answer(request, held, tokens, failed);
  };
}

// The URL past its host is exactly `/<segment>`, with no query, and the segment decodes to `name`. A fragment never names
// another resource, so it is set aside: Chromium sends none, and the PDF viewer's own (`#toolbar=0`) stays in the window.
function atItsName(url: string, token: string, name: string): boolean {
  const rest = url.slice(`maws-artifact://${token}`.length).replace(/#.*$/s, '');
  const segment = /^\/([^/?]*)$/.exec(rest)?.[1];
  if (segment === undefined) return false;
  try {
    return decodeURIComponent(segment) === name;
  } catch {
    return false; // a segment that does not decode
  }
}

// What the request's `Range` asks before the size is known: where the first read starts, and how much it takes.
function firstRead(header: string | null): { offset: number; length: number } {
  const match = header === null ? null : /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return { offset: 0, length: FRAME_PAGE_BYTES }; // the whole file
  if (match[1] === '') return { offset: 0, length: 1 }; // a suffix range: the probe that learns the size
  const start = Number(match[1]);
  if (!Number.isSafeInteger(start)) return { offset: 0, length: 1 }; // past any file's end: the size says 416
  const end = match[2] === '' ? null : Number(match[2]);
  if (end !== null && end < start) return { offset: 0, length: FRAME_PAGE_BYTES }; // malformed: the whole file
  return { offset: start, length: end === null ? FRAME_PAGE_BYTES : Math.max(1, Math.min(FRAME_PAGE_BYTES, end - start + 1)) };
}

async function answer(request: Request, held: FrameToken, tokens: Pick<FrameTokens, 'get'>, failed: (token: FrameToken) => void): Promise<Response> {
  const live = () => tokens.get(held.token) === held;
  let told = false;
  const tell = () => {
    if (told || !live()) return; // once per response, and never for a token that was released
    told = true;
    failed(held);
  };

  const header = request.headers.get('Range');
  const asked = request.method === 'HEAD' ? { offset: 0, length: 1 } : firstRead(header); // HEAD needs the size alone
  let first: Page;
  try {
    first = await held.source.read(asked.offset, asked.length);
  } catch {
    tell();
    return notFound();
  }
  if (!live()) return notFound();
  const { size, identity } = first;

  const headers = new Headers({
    'Content-Type': held.mime,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'bytes',
  });
  if (held.csp !== null) headers.set('Content-Security-Policy', held.csp);
  const range = rangeOf(header, size);
  if (range === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  headers.set('Content-Length', String(end - start + 1));
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  const status = range ? 206 : 200;
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  if (end < start) return new Response(new Uint8Array(), { status, headers });

  // The first read's bytes open the body when it read from where the body starts (a suffix's probe usually does not).
  let pending: Uint8Array | null = asked.offset === start && first.bytes.length > 0 ? first.bytes.subarray(0, end - start + 1) : null;
  let at = start;
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        if (!live()) return controller.error(new Error('the file frame was released'));
        let bytes = pending;
        pending = null;
        if (bytes === null) {
          let page: Page;
          try {
            page = await held.source.read(at, Math.min(FRAME_PAGE_BYTES, end + 1 - at));
          } catch (error) {
            tell();
            return controller.error(error);
          }
          if (!live()) return controller.error(new Error('the file frame was released'));
          // another version; or no bytes where the size promised some, which would otherwise be read again forever
          if (page.identity !== identity || page.bytes.length === 0) {
            tell();
            return controller.error(new Error('the file changed while it was served'));
          }
          bytes = page.bytes.subarray(0, end + 1 - at);
        }
        controller.enqueue(bytes);
        at += bytes.length;
        if (at > end) controller.close();
      },
    },
    { highWaterMark: 0 }, // nothing is read ahead of the frame
  );
  return new Response(body, { status, headers });
}

const plain = (status: number, body: string) => new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
const notFound = () => plain(404, 'not found');
