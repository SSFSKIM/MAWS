// The page server's standing headers and a refusal's bytes (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md,
// §M; T7, T12). On the daemon's run path, beside serve.ts, so an answer made without the handler's chunk (the chunk
// that would not load, an `Expect`, what Node's own parser refuses) carries the same headers as every other: §8.2's
// rule 3 (`Referrer-Policy`, `nosniff`, a content policy that loads nothing from outside the page) and T12's framing
// and cross-origin headers. Imports nothing, so the run path pays a few constants for it.

export const SHEET_HOST = 'sheet.localhost';
export const SHEET_PORT = 47590;

export const HEADERS_MAX = 64; // a request or an upgrade with more header pairs is refused whole (§J)

// The page's origin, `http://sheet.localhost:<port>`: one string, which the Host check, the Origin check and the
// registration's `url` are all read from (T7).
export const pageOrigin = (port: number): string => `http://${SHEET_HOST}:${port}`;

// Every response carries these, a refusal and a refused upgrade among them. The WebSocket's own origin is named beside
// 'self' because not every engine reads 'self' as covering ws:. Inline styles stand (the highlighter and the component
// library write them, as the app's own policy allows); inline script and eval do not.
export function STANDING_HEADERS(port: number): Record<string, string> {
  return {
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src 'self' ws://${SHEET_HOST}:${port}`,
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}

// A refusal: its status and one of a fixed list of sentences. Nothing of the request is ever written back (T7). 408 is
// Node's own deadline, which the page server answers itself (§J).
export type RefusalStatus = 400 | 401 | 403 | 404 | 405 | 408 | 413 | 417 | 421 | 429 | 431 | 500 | 503;
export interface Refusal {
  status: RefusalStatus;
  body: string;
}

const SENTENCES: Record<RefusalStatus, readonly [reason: string, sentence: string]> = {
  400: ['Bad Request', 'This request is not one this page answers.'],
  401: ['Unauthorized', 'This browser is not paired.'],
  403: ['Forbidden', 'This request did not come from the sheet page.'],
  404: ['Not Found', 'Nothing is here.'],
  405: ['Method Not Allowed', 'This address does not take that method.'],
  408: ['Request Timeout', 'The request took too long.'],
  413: ['Content Too Large', 'The request is too large.'],
  417: ['Expectation Failed', 'This page takes no Expect header.'],
  421: ['Misdirected Request', 'This server does not answer that host.'],
  429: ['Too Many Requests', 'Too many tries. Wait a minute.'],
  431: ['Request Header Fields Too Large', 'The request has too many headers.'],
  500: ['Internal Server Error', 'Something went wrong.'],
  503: ['Service Unavailable', 'The sheet page is not available right now.'],
};

export const refusal = (status: RefusalStatus): Refusal => ({ status, body: SENTENCES[status][1] });
export const isRefusal = (value: object): value is Refusal => 'status' in value && 'body' in value;

// The headers of a refusal answered through Node's response: the standing ones, plain text, never stored, and the
// connection closed after it.
export function refusalHeaders(port: number, refused: Refusal): Record<string, string> {
  return { ...STANDING_HEADERS(port), 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': String(Buffer.byteLength(refused.body)), Connection: 'close' };
}

// A whole HTTP/1.1 response with the headers above, for an answer written to a bare socket (a refused upgrade, Node's
// clientError).
export function refusalBytes(port: number, refused: Refusal): Buffer {
  const head = [`HTTP/1.1 ${refused.status} ${SENTENCES[refused.status][0]}`, ...Object.entries(refusalHeaders(port, refused)).map(([name, value]) => `${name}: ${value}`)];
  return Buffer.from(`${head.join('\r\n')}\r\n\r\n${refused.body}`, 'utf8');
}
