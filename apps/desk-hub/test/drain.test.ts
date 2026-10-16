// The Worker's drain of a body it answered without reading: at most its byte budget, exactly, whatever the chunks, and
// at most its time, however slowly the body comes.
import { describe, expect, it } from 'vitest';
import { drain, readLimited } from '../src/drain';

/** A byte stream that serves `chunks` as they are asked for, then ends, or with `close` false stalls: nothing more
 * comes, and it never ends. */
function body(chunks: number[], close = true) {
  let next = 0;
  const stream = new ReadableStream<Uint8Array>({
    type: 'bytes',
    pull(controller) {
      if (next < chunks.length) controller.enqueue(new Uint8Array(chunks[next++]));
      else if (close) controller.close();
    },
  });
  return { stream };
}

describe('drain', () => {
  it('reads a body under its budget to the end', async () => {
    const { stream } = body([1000, 2000]);
    expect(await drain(stream, 1024 * 1024, 1000)).toBe(3000);
  });

  it('stops at the budget exactly, without asking for more, at a chunk boundary', async () => {
    const limit = 1024 * 1024;
    const { stream } = body([limit, 1]);
    expect(await drain(stream, limit, 1000)).toBe(limit);
  });

  it('takes no more than the budget from one chunk larger than it', async () => {
    const limit = 1024 * 1024;
    const { stream } = body([2 * limit]);
    expect(await drain(stream, limit, 1000)).toBe(limit);
  });

  it('gives up on a body that stalls, at its deadline', async () => {
    const { stream } = body([1], false);
    const at = Date.now();
    expect(await drain(stream, 1024 * 1024, 200)).toBe(1);
    expect(Date.now() - at).toBeLessThan(1000);
  });
});

describe('readLimited', () => {
  it('reads a body of exactly its limit whole', async () => {
    const { stream } = body([1000, 24]);
    expect((await readLimited(stream, 1024))?.byteLength).toBe(1024);
  });

  it('refuses a body one byte past its limit', async () => {
    const { stream } = body([1000, 25]);
    expect(await readLimited(stream, 1024)).toBeNull();
  });

  it('refuses a body as it passes its limit, though the body never ends', async () => {
    const { stream } = body([600, 600], false);
    const at = Date.now();
    expect(await readLimited(stream, 1024)).toBeNull();
    expect(Date.now() - at).toBeLessThan(3000);
  });
});
