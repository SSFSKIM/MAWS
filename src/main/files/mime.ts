// A file's type for `files.read` (C8c execution document, M1's decisions): a table of common extensions, `text/plain`
// for any name it does not know (an unknown text file stays readable), and `application/octet-stream` for a text-typed
// name whose head holds a NUL (an unknown binary is never shown as text). The type decides the encoding with the sniff:
// base64 unless the type is text and the head holds no NUL.
import { extname } from 'node:path';

const TABLE: Record<string, string> = {
  // images
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  ico: 'image/x-icon', avif: 'image/avif', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic',
  // documents and archives
  pdf: 'application/pdf', zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar', wasm: 'application/wasm',
  // audio and video
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  // fonts
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  // text the viewer treats specially or names by type
  html: 'text/html', htm: 'text/html', css: 'text/css', csv: 'text/csv', md: 'text/markdown', mdx: 'text/markdown',
  markdown: 'text/markdown', txt: 'text/plain', json: 'application/json', xml: 'application/xml',
  js: 'application/javascript', mjs: 'application/javascript', cjs: 'application/javascript', jsx: 'text/jsx',
  ts: 'text/x-typescript', tsx: 'text/x-typescript', sh: 'application/x-sh', yaml: 'text/yaml', yml: 'text/yaml',
};

const TEXT_APPLICATION = new Set(['application/json', 'application/xml', 'application/javascript', 'application/x-sh', 'image/svg+xml']);

export function mimeOf(name: string): string {
  return TABLE[extname(name).slice(1).toLowerCase()] ?? 'text/plain';
}

export function isTextMime(mime: string): boolean {
  return mime.startsWith('text/') || TEXT_APPLICATION.has(mime);
}

export function isBinaryHead(head: Uint8Array): boolean {
  return head.includes(0);
}

// The type `files.read` answers for a file, from its name and its first BINARY_SNIFF_BYTES.
export function fileMime(name: string, head: Uint8Array): string {
  const mime = mimeOf(name);
  return isTextMime(mime) && isBinaryHead(head) ? 'application/octet-stream' : mime;
}
