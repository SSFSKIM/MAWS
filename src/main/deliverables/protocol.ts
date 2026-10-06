// The `maws-deliverable:` scheme (E2 execution document, Design §3, Decision Log 6 and 12): the store's files served to
// the viewer's frames and to the capture window, one recorded file per URL. `maws-deliverable://<recordId>/<appSessionId>/<n>`
// names version `n` of a record; the handler reads the record through the reader and opens the file by the path the
// record holds, never by anything in the URL, so it serves exactly the store's files and nothing beside them.
//
// Every answer carries `nosniff`, `inline`, `no-store` and `Accept-Ranges`; a `Range` is answered 206 from a bounded
// read of the opened file (media seek through it). HTML also carries a policy whose leading `sandbox allow-scripts`
// sandboxes the document wherever it loads (the viewer's frame doubles it; the capture window, which loads it
// top-level, has nothing else) and which admits no network source and no `'self'`: a self-contained page needs nothing
// from any origin. The app-wide policy (`window.ts`) leaves this scheme's answers alone, so this one reaches the frame.
// An artifact's HTML gets the bridge script as the first element of its `<head>` (Design §10); a delivered HTML file is
// served byte for byte.
import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { basename } from 'node:path';
import { Readable } from 'node:stream';
import { protocol, type Session } from 'electron';
import { isSafeAppSessionId } from '@shared/engine/app-session-id';
import { extensionOf, mimeOf } from '@shared/files/mime';
import { DELIVERABLE_SCHEME, parseDeliverableUrl } from '@shared/maws/deliverable';
import { BRIDGE_SCRIPT } from './bridge-script';
import type { DeliverableReader } from './reader';

export const DELIVERABLE_HTML_CSP = [
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

// Before `app.whenReady()`, once: a standard, secure scheme (its own origin per record, a secure context), streamed,
// with no fetch and no CORS (nothing is ever fetched from it but a frame's or a media element's own load).
export function registerDeliverableScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: DELIVERABLE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false, stream: true } },
  ]);
}

// The handler on a session: the window's default session and the capture partition get the same one.
export function serveDeliverables(session: Session, reader: DeliverableReader): void {
  session.protocol.handle(DELIVERABLE_SCHEME, createDeliverableHandler(reader));
}

export function createDeliverableHandler(reader: Pick<DeliverableReader, 'get'>): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405, 'method not allowed');
    const target = parseDeliverableUrl(request.url);
    if (!target || !isSafeAppSessionId(target.appSessionId)) return notFound();
    const record = await reader.get(target.appSessionId, target.id).then(
      (lookup) => lookup.record,
      () => null, // an id that is not a record uuid, an unreadable directory: nothing is said about either
    );
    const version = record?.versions[target.version - 1];
    if (!record || !version) return notFound();

    let file: FileHandle;
    try {
      file = await open(version.path, constants.O_RDONLY | constants.O_NONBLOCK); // a FIFO never blocks the open
    } catch {
      return notFound();
    }
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new Error('not a regular file');
      const mime = typeOf(basename(version.path));
      const headers = new Headers({
        'Content-Type': mime,
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
        'Cache-Control': 'no-store',
        'Accept-Ranges': 'bytes',
      });
      if (mime === 'text/html') headers.set('Content-Security-Policy', DELIVERABLE_HTML_CSP);
      const head = request.method === 'HEAD';
      // An artifact's HTML is read whole (16 MiB at most, the tool's cap) for the bridge script; anything else streams.
      const bytes = record.kind === 'artifact' && mime === 'text/html' ? insertBridgeScript(await file.readFile()) : null;
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

// The bridge script as the first element of `<head>`; with no `<head>`, right after the doctype (a script ahead of it
// would put the page in quirks mode); with neither, first. Searched over the bytes as latin1, so a byte offset is a
// string offset and bytes that are not UTF-8 pass through untouched.
export function insertBridgeScript(html: Buffer): Buffer {
  const text = html.toString('latin1');
  const head = /<head(?=[\s>])[^>]*>/i.exec(text);
  const doctype = /^(?:\xef\xbb\xbf)?\s*<!doctype[^>]*>/i.exec(text);
  const at = head ? head.index + head[0].length : doctype ? doctype[0].length : 0;
  const tag = Buffer.from(`<script data-maws-bridge>${BRIDGE_SCRIPT}</script>`, 'utf8');
  return Buffer.concat([html.subarray(0, at), tag, html.subarray(at)]);
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
