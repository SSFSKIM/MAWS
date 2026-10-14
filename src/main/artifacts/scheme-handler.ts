// The serving of the app's store scheme (E2 execution document, Design §3, Decision Log 6 and 12; P3-A M7, Decision Log
// 35e): a resolver names the file a URL serves (or nothing) and `createSchemeHandler` serves it, never anything named
// by the URL itself, so a scheme serves exactly the store's files. E2's `maws-deliverable:` was served here too until
// P3-L's cutover (M6b), which left `maws-artifact:` (`./protocol.ts`, its resolver) alone.
//
// Every answer carries `nosniff`, `inline`, `no-store` and `Accept-Ranges`; a `Range` is answered 206 from a bounded
// read of the opened file (media seek through it). Every answer but a PDF's also carries a policy whose leading
// `sandbox allow-scripts` sandboxes the document wherever it loads (the viewer's frame doubles it; the capture window,
// which loads it top-level, has nothing else) and which admits no network source and no `'self'`: a self-contained page
// needs nothing from any origin. The app-wide policy (`window.ts`) leaves this scheme's answers alone, so this one reaches the frame.
// An `html` artifact's page gets the bridge script as the first element of its `<head>` (Design §10); any other file
// (an asset, a File artifact's HTML) is served byte for byte.
import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { extensionOf, mimeOf } from '@shared/files/mime';
import { BRIDGE_SCRIPT } from './bridge-script';

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
].join('; ');

// The store scheme's privileges: a standard, secure scheme (its own origin per artifact, a secure context), streamed,
// with no fetch (nothing is ever fetched from it but a frame's, an image's, a font's or a media element's own load).
export const STORE_SCHEME_PRIVILEGES = { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false, stream: true } as const;

// The file a scheme's URL names: its path on disk, the name its type is read from (an artifact's asset is stored under
// its hash, with no extension), and whether it is an `html` artifact's page, which gets the bridge script.
export interface SchemeFile {
  path: string;
  name: string;
  bridge: boolean;
}
// A URL to the file it names, or null (unknown, malformed, unreadable: nothing is said about which). Never throws.
export type SchemeResolver = (url: string) => Promise<SchemeFile | null>;

// One scheme's handler over its resolver. `cors` adds `Access-Control-Allow-Origin: *` to every answer, for a scheme
// whose fonts are loaded across origins (the artifact scheme's; a font load is a CORS request).
export function createSchemeHandler(resolve: SchemeResolver, options: { cors?: boolean } = {}): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405, 'method not allowed');
    const resolved = await resolve(request.url).catch(() => null);
    if (!resolved) return notFound();

    let file: FileHandle;
    try {
      file = await open(resolved.path, constants.O_RDONLY | constants.O_NONBLOCK); // a FIFO never blocks the open
    } catch {
      return notFound();
    }
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new Error('not a regular file');
      const mime = typeOf(resolved.name);
      const headers = new Headers({
        'Content-Type': mime,
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
        'Cache-Control': 'no-store',
        'Accept-Ranges': 'bytes',
      });
      if (options.cors) headers.set('Access-Control-Allow-Origin', '*');
      // Every answer but a PDF's: SVG and XML documents run script too, and a frame may load any type as a document. A PDF
      // has none, since Chromium's viewer draws it (the PDF trial) and the sandbox directive would keep the viewer out.
      if (mime !== 'application/pdf') headers.set('Content-Security-Policy', STORE_FRAME_CSP);
      const head = request.method === 'HEAD';
      // An artifact's HTML is read whole (16 MiB at most, the tool's cap) for the bridge script; anything else streams.
      const bytes = resolved.bridge && mime === 'text/html' ? insertBridgeScript(await file.readFile()) : null;
      const size = bytes ? bytes.length : stat.size;
      const range = rangeOf(request.headers.get('Range'), size);
      if (range === 'unsatisfiable') {
        await file.close();
        headers.set('Content-Range', `bytes */${size}`);
        return new Response(null, { status: 416, headers });
      }
      const { start, end } = range ?? { start: 0, end: size - 1 };
      headers.set('Content-Length', String(end - start + 1));
      if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
      const status = range ? 206 : 200;
      if (head || bytes || end < start) {
        await file.close();
        return new Response(head ? null : (bytes?.subarray(start, end + 1) ?? new Uint8Array()), { status, headers });
      }
      // The descriptor opened above, so the bytes served are the file that was checked; the stream closes it.
      const stream = Readable.toWeb(file.createReadStream({ start, end })) as ReadableStream<Uint8Array>;
      return new Response(stream, { status, headers });
    } catch {
      await file.close().catch(() => {});
      return notFound();
    }
  };
}

// The bridge script as the first element of `<head>`; with no `<head>`, after the doctype and the `<html>` tag (a script
// ahead of the doctype would put the page in quirks mode); with none of them, first (after a byte-order mark, which
// must stay the first bytes). The place is found by walking the page's prologue as the HTML parser reads it, token by
// token: whitespace, comments (a `<head>` inside one is no head), bogus comments (`<?xml …?>`), the doctype and the
// `<html>` tag; the walk stops at the first `<head>` or at anything else, so nothing past the prologue (a `<head>` in
// the body's script text) is ever taken for the head. Searched over the bytes as latin1, so a byte offset is a string
// offset and bytes that are not UTF-8 pass through untouched.
export function insertBridgeScript(html: Buffer): Buffer {
  const at = bridgeScriptOffset(html.toString('latin1'));
  const tag = Buffer.from(`<script data-maws-bridge>${BRIDGE_SCRIPT}</script>`, 'utf8');
  return Buffer.concat([html.subarray(0, at), tag, html.subarray(at)]);
}

const UTF8_BOM = '\xef\xbb\xbf';
const ATTRIBUTES = String.raw`(?=[\s/>])(?:"[^"]*"|'[^']*'|[^'">])*>`; // a start tag's rest, a quoted value may hold a `>`
const HEAD = new RegExp(`<head${ATTRIBUTES}`, 'iy');
const WHITESPACE = /\s+/y;
const PROLOGUE = [
  /<!--(?:-?>|[\s\S]*?--!?>)/y, // a comment, the abrupt `<!-->` and `<!--->` included; one that never closes stops the walk
  /<!doctype[^>]*>/iy,
  /<(?:\?|!(?!--))[^>]*>/y, // a bogus comment
  new RegExp(`<html${ATTRIBUTES}`, 'iy'),
];

function bridgeScriptOffset(text: string): number {
  let pos = text.startsWith(UTF8_BOM) ? UTF8_BOM.length : 0;
  let at = pos; // the end of the last token read: the script goes right after it, before any whitespace that follows
  const read = (pattern: RegExp): number | null => {
    pattern.lastIndex = pos;
    return pattern.exec(text) ? pattern.lastIndex : null;
  };
  for (;;) {
    const head = read(HEAD);
    if (head !== null) return head;
    const blank = read(WHITESPACE);
    if (blank !== null) {
      pos = blank;
      continue;
    }
    const token = PROLOGUE.map(read).find((end): end is number => end !== null);
    if (token === undefined) return at;
    pos = at = token;
  }
}

// The shared name table, except that a name it does not know is binary here, never text.
function typeOf(name: string): string {
  const mime = mimeOf(name);
  return mime === 'text/plain' && extensionOf(name) !== 'txt' ? 'application/octet-stream' : mime;
}

// One `bytes=` range of a `size`-byte body: null to answer the whole (none asked, a multi-range, a malformed one),
// 'unsatisfiable' for a range that starts past the end.
function rangeOf(header: string | null, size: number): { start: number; end: number } | 'unsatisfiable' | null {
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

const plain = (status: number, body: string) => new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
const notFound = () => plain(404, 'not found');
