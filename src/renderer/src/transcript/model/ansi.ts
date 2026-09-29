// ANSI escape sequences in assistant text (C3's live acceptance, 2026-09-28: a MessageDisplay hook can put colour codes
// into the model's text). They are stripped, never rendered: the reducer cleans a block's text as it streams and when
// it completes, so every surface and every copy sees the same clean text.

// CSI (`ESC [` … final byte), OSC (`ESC ]` … BEL or `ESC \`, hyperlinks included) and the two-byte escapes.
// eslint-disable-next-line no-control-regex -- matching control characters is this pattern's purpose
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

export function stripAnsi(text: string): string {
  return text.includes('\u001b') ? text.replace(ANSI, '') : text;
}

// A streamed block's buffer after one more piece. A sequence split across deltas stays in the buffer, unstripped,
// until the delta that completes it arrives; only a buffer holding an escape is scanned again.
export function appendStripped(buffer: string, piece: string): string {
  const next = buffer + piece;
  return piece.includes('\u001b') || buffer.includes('\u001b') ? stripAnsi(next) : next;
}
