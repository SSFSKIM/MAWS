// Paste and drop classification (C7 execution document, "Sizes and caps"): what a pasted text or a pasted, dropped or
// picked file becomes. Text past 1,024 characters or 10 lines becomes a pasted atom (the terminal keeps inline paste
// content up to 1,024 characters). A file is attached as bytes only when the API reads it: PNG, JPEG, GIF and WebP
// images and PDFs, within their caps; any other file with a path becomes a mention of that path (HEIC, BMP and TIFF
// included: never bytes), and a file with no path (dragged from a browser) is read as text or refused. Pure.

export const PASTE_INLINE_MAX_CHARS = 1024;
export const PASTE_INLINE_MAX_LINES = 10;
export const IMAGE_BYTE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MiB = 1024 * 1024;
export const MAX_SOURCE_IMAGE_BYTES = 20 * MiB; // what `layout.pickFiles` reads as bytes; a larger source is not decoded
export const MAX_PDF_BYTES = 32 * MiB;
export const MAX_TEXT_FILE_BYTES = MiB;

export function classifyText(text: string): 'inline' | 'atom' {
  return text.length > PASTE_INLINE_MAX_CHARS || text.split('\n').length > PASTE_INLINE_MAX_LINES ? 'atom' : 'inline';
}

export type FileAction = { kind: 'image' } | { kind: 'pdf' } | { kind: 'mention'; path: string } | { kind: 'text' } | { kind: 'refused'; reason: string };

// `path` is Electron's (`pathForFile`), '' when it has none.
export function classifyFile(file: { name: string; type: string; size: number }, path: string): FileAction {
  const byPath = (reason: string): FileAction => (path !== '' ? { kind: 'mention', path } : { kind: 'refused', reason });
  if (file.type.startsWith('image/')) {
    if (!IMAGE_BYTE_TYPES.has(file.type)) return byPath(`${file.name} can't be attached; attach a PNG, JPEG, GIF or WebP image`);
    if (file.size > MAX_SOURCE_IMAGE_BYTES) return byPath(`${file.name} is over 20 MB`);
    return { kind: 'image' };
  }
  if (file.type === 'application/pdf') return file.size > MAX_PDF_BYTES ? byPath(`${file.name} is over 32 MB`) : { kind: 'pdf' };
  if (path !== '') return { kind: 'mention', path };
  return file.size > MAX_TEXT_FILE_BYTES ? { kind: 'refused', reason: `${file.name} is over 1 MB; attach it by path instead` } : { kind: 'text' };
}

// A mention's id: relative to cwd when the path is inside it, absolute otherwise.
export function mentionPath(path: string, cwd: string): string {
  const root = cwd.endsWith('/') ? cwd.slice(0, -1) : cwd;
  return root !== '' && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}
