// A file's type for `files.read` (C8c execution document, M1's decisions): the shared name table (`text/plain` for any
// name it does not know, so an unknown text file stays readable), refined here by the file's head:
// `application/octet-stream` for a text-typed name whose head holds a NUL (an unknown binary is never shown as text).
// The type decides the encoding with the sniff: base64 unless the type is text and the head holds no NUL.
import { isTextMime, mimeOf } from '@shared/files/mime';

export { isTextMime }; // the name-only table is shared with the viewer (src/shared/files/mime.ts)

export function isBinaryHead(head: Uint8Array): boolean {
  return head.includes(0);
}

// The type `files.read` answers for a file, from its name and its first BINARY_SNIFF_BYTES.
export function fileMime(name: string, head: Uint8Array): string {
  const mime = mimeOf(name);
  return isTextMime(mime) && isBinaryHead(head) ? 'application/octet-stream' : mime;
}
