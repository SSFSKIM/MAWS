// A file's type by name (C8c execution document, M1's decisions), shared by main's `files.*` service and the renderer's
// viewer: a table of common extensions, and `text/plain` for any name it does not know, so an unknown text file stays
// readable. Main refines it by the file's head (`src/main/files/mime.ts`, `fileMime`): a text-typed name whose head
// holds a NUL is `application/octet-stream`. No Node imports: the renderer bundles this module.

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

// The extension of a name or path, lower case, without its dot; '' for none and for a dotfile (`.env`), as
// `path.extname` answers.
export function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

export function mimeOf(name: string): string {
  return TABLE[extensionOf(name)] ?? 'text/plain';
}

export function isTextMime(mime: string): boolean {
  return mime.startsWith('text/') || TEXT_APPLICATION.has(mime);
}
