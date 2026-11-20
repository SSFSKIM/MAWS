// What the viewer draws for a file, decided once from the first `files.read` answer (C8c execution document, Interfaces
// *Viewer kinds and caps*): markdown rendered, an image inline, an "Open externally" row, a bounded head of a text too
// large to hold, or code. UX wave U6b-2 (M5, decision 1): a PDF, an HTML page, a video or a sound is drawn in a frame
// main serves (`frame`), whatever its size; `externalKindOf` still names a row's kind. The binary decision is the service's per-file `encoding` (a NUL in the file's first
// BINARY_SNIFF_BYTES, or a mime that is not text), never the extension alone, so a `.txt` full of NULs is external and a
// `.dat` of text is code. Pure; no CodeMirror here (this module is in the main chunk).
import { framedKindOf } from '@shared/files/framed';
import { isMarkdownName, MARKDOWN_RENDER_CAP } from '@shared/files/markdown';
import type { FilesReadOutput } from '@shared/ipc/schema/files';

export type ViewerKind = 'code' | 'markdown' | 'image' | 'frame' | 'external' | 'head';
export type ExternalKind = 'PDF' | 'HTML' | 'Audio' | 'Video' | 'Image' | 'Binary';
type Encoding = FilesReadOutput['encoding'];

export const CODE_CAP = 4 * 1024 * 1024; // a text past this opens as a bounded head
export { MARKDOWN_RENDER_CAP }; // markdown past this is shown as its source; the daemon's follow shares it (UX wave U6b-4c)
export const IMAGE_CAP = 8 * 1024 * 1024; // one files.read call (FILES_READ_MAX_LENGTH)

// The image types Chromium draws in an <img>; another image type (tiff, heic) is an external row.
const INLINE_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/x-icon', 'image/avif', 'image/svg+xml']);

export const isInlineImage = (mime: string, bytes: number): boolean => INLINE_IMAGES.has(mime) && bytes <= IMAGE_CAP;

// The row's kind for a file that is not drawn in MAWS, or null for one that is.
export function externalKindOf({ mime, bytes, encoding }: { mime: string; bytes: number; encoding: Encoding }): ExternalKind | null {
  if (mime === 'application/pdf') return 'PDF';
  if (mime === 'text/html') return 'HTML';
  if (mime.startsWith('audio/')) return 'Audio';
  if (mime.startsWith('video/')) return 'Video';
  if (mime.startsWith('image/')) return isInlineImage(mime, bytes) ? null : 'Image';
  return encoding === 'base64' ? 'Binary' : null;
}

export function kindOf(file: { name: string; mime: string; bytes: number; encoding: Encoding }): ViewerKind {
  if (isInlineImage(file.mime, file.bytes)) return 'image';
  if (framedKindOf(file.mime) !== null) return 'frame'; // UX wave U6b-2
  if (externalKindOf(file) !== null) return 'external';
  if (file.bytes > CODE_CAP) return 'head';
  if (isMarkdownName(file.name) && file.bytes <= MARKDOWN_RENDER_CAP) return 'markdown';
  return 'code';
}

// An <img> source from a read: base64 content as is; utf8 content (an svg, text by the service's rule) base64-encoded
// from its UTF-8 bytes, so non-ASCII text survives (never `data:…;base64,<utf8 text>`).
export function dataUrl(mime: string, encoding: Encoding, content: string): string {
  return `data:${mime};base64,${encoding === 'base64' ? content : base64OfBytes(new TextEncoder().encode(content))}`;
}

function base64OfBytes(bytes: Uint8Array): string {
  let binary = '';
  const STEP = 0x8000; // String.fromCharCode's argument count stays bounded
  for (let i = 0; i < bytes.length; i += STEP) binary += String.fromCharCode(...bytes.subarray(i, i + STEP));
  return btoa(binary);
}

export type JumpTarget = { kind: 'none' } | { kind: 'wait' } | { kind: 'end' } | { kind: 'line'; line: number };

// Where a 1-based line jump lands against the loaded document: the line once it is loaded, nothing yet while it may
// still arrive in a later chunk, and the end (with no flash) when the complete document is shorter.
export function jumpTarget({ line, lines, complete }: { line: number | null; lines: number; complete: boolean }): JumpTarget {
  if (line === null) return { kind: 'none' };
  const wanted = Math.max(1, line);
  if (wanted <= lines) return { kind: 'line', line: wanted };
  return complete ? { kind: 'end' } : { kind: 'wait' };
}
