// The token host's two halves the spike needs of main (execution document, Interfaces §C): a table of tokens with their
// owners, and a responder that answers a token's one path from bytes in memory, page by page with a short pause between
// pages, with the headers of M3's decision 5. The handler writes its entry into the ordered record before anything else.
import { randomBytes } from 'node:crypto';
import { log } from './record.mjs';
import { hostOf, TOKEN } from './policies.mjs';

export const STORE_FRAME_CSP = [
  'sandbox allow-scripts',
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' data: blob:",
  "style-src 'unsafe-inline' data: blob:",
  'img-src data: blob:',
  'font-src data: blob:',
  'media-src data: blob:',
  'connect-src data: blob:',
  'worker-src blob:',
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; '); // src/services/artifacts/scheme/scheme-handler.ts at 281ef5a6c, copied

export const FRAME_PAGE_BYTES = 1024 * 1024;

export function createTokens() {
  const byToken = new Map();
  return {
    // `token` may be given (row d's all-digit token); else 16 random bytes as hex, drawn again while it holds no letter.
    issue({ owner, name, mime, bytes, kind, token }) {
      let t = token;
      while (!t || byToken.has(t)) {
        t = randomBytes(16).toString('hex');
        if (!/[a-f]/.test(t)) t = null;
      }
      const fixed = { token: t, owner, name, mime, bytes, kind, csp: mime === 'application/pdf' ? null : STORE_FRAME_CSP, url: `maws-artifact://${t}/${encodeURIComponent(name)}` };
      byToken.set(t, fixed);
      return fixed;
    },
    get: (token) => byToken.get(token) ?? null,
    ownerOf(host) {
      if (!TOKEN.test(host)) return undefined;
      return byToken.get(host)?.owner ?? null;
    },
    release: (token) => byToken.delete(token),
    all: () => [...byToken.values()],
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plain = (status, body) => new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });

// `serve.ranges`: answer a `Range` with 206 (the product's rule); false: answer every request whole, 200, with no
// Accept-Ranges (row a's second variant). `serve.pauseMs`: the pause before each page after the first. Both are read at
// each request, so a suite can switch them between loads.
export function fileFrameResponder(tokens, partition, serve = { ranges: true, pauseMs: 20 }) {
  return async (request) => {
    const { ranges, pauseMs } = serve;
    log('entry', { partition, url: request.url, method: request.method, range: request.headers.get('Range') ?? '-' });
    const host = hostOf(request.url);
    if (host === null || !TOKEN.test(host)) return plain(404, 'not found');
    if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405, 'method not allowed');
    const t = tokens.get(host);
    if (!t) return plain(404, 'not found');
    const u = new URL(request.url);
    let name;
    try {
      name = u.pathname.split('/').length === 2 ? decodeURIComponent(u.pathname.slice(1)) : null;
    } catch {
      name = null;
    }
    if (name !== t.name || u.search !== '') return plain(404, 'not found');
    const size = t.bytes.length;
    const headers = new Headers({ 'Content-Type': t.mime, 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline', 'Cache-Control': 'no-store' });
    if (ranges) headers.set('Accept-Ranges', 'bytes');
    if (t.csp) headers.set('Content-Security-Policy', t.csp);
    const range = ranges ? rangeOf(request.headers.get('Range'), size) : null;
    if (range === 'unsatisfiable') {
      headers.set('Content-Range', `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    const { start, end } = range ?? { start: 0, end: size - 1 };
    headers.set('Content-Length', String(end - start + 1));
    if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    const status = range ? 206 : 200;
    if (request.method === 'HEAD' || end < start) return new Response(null, { status, headers });
    let at = start;
    let first = true;
    const body = new ReadableStream({
      async pull(controller) {
        if (!first) await sleep(pauseMs);
        first = false;
        if (!tokens.get(host)) return controller.error(new Error('released'));
        const next = Math.min(at + FRAME_PAGE_BYTES, end + 1);
        controller.enqueue(new Uint8Array(t.bytes.subarray(at, next)));
        at = next;
        if (at > end) controller.close();
      },
    });
    return new Response(body, { status, headers });
  };
}

// The store handler's rule, copied from scheme-handler.ts `rangeOf` at 281ef5a6c: one `bytes=` range; a multi-range or a
// malformed one is the whole file (null); a start past the end is unsatisfiable.
function rangeOf(header, size) {
  const match = header === null ? null : /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  if (size === 0) return 'unsatisfiable';
  if (match[1] === '') {
    const suffix = Number(match[2]);
    return suffix === 0 ? 'unsatisfiable' : { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  if (start >= size) return 'unsatisfiable';
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  return end < start ? null : { start, end };
}
