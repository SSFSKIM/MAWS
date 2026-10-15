// What is left of a request body the Worker answered without reading (a refusal before the body: too large, no
// assertion, not a member), read and dropped before the answer goes out. Behind Cloudflare's edge the client always gets
// the answer; on a bare workerd, a connection closed with request bytes unread is reset, and on Linux the reset can
// overtake the answer (the local stand-in's proxy saw `write ECONNRESET` and answered 502 in 4 of 200 oversized bodies
// on the CI runner). The drain is bounded in bytes, exactly, and in time, so a body that is huge or stalls never holds
// the answer longer than the deadline.

/** At most this many bytes are read. */
export const DRAIN_LIMIT = 1024 * 1024;
/** For at most this long. */
export const DRAIN_MS = 1000;
/** The read size: a chunk larger than what is left of the budget is read only to the budget. */
const READ_BYTES = 64 * 1024;

/**
 * Reads and drops at most `limit` bytes of `body` for at most `ms`, and returns how many it read. Reads go into a buffer
 * the reader fills (BYOB), never past the budget, so a large chunk is taken only in part; a body that ends is left
 * ended, and any other is cancelled once the budget or the deadline is spent. A body already taken is left alone.
 */
export async function drain(body: ReadableStream<Uint8Array>, limit = DRAIN_LIMIT, ms = DRAIN_MS): Promise<number> {
  if (body.locked) return 0;
  let reader: ReadableStreamBYOBReader;
  try {
    reader = body.getReader({ mode: 'byob' });
  } catch {
    return 0;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ms)));
  let buffer = new ArrayBuffer(Math.min(READ_BYTES, limit));
  let read = 0;
  let ended = false;
  try {
    while (read < limit) {
      const next = await Promise.race([reader.read(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, limit - read))), late]);
      if (next === null) break;
      if (next.done) {
        ended = true;
        break;
      }
      read += next.value.byteLength;
      // The reader hands the buffer back with what it read; the next read reuses the whole of it.
      buffer = next.value.buffer as ArrayBuffer;
    }
  } catch {
    // the client went: nothing more to read
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (!ended) reader.cancel().catch(() => {});
  }
  return read;
}
