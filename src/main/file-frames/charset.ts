// Red first: the names exist, their bodies are built next.
export const FRAME_HEAD_BYTES = 64 * 1024;
export function htmlContentType(_head: Uint8Array): 'text/html' | 'text/html; charset=utf-8' {
  throw new Error('not built');
}
