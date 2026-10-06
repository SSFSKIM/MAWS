// The one path main opens for an anchored comment (E3 execution document, Design §9): a screenshot under an allowed
// root, a regular file of at most 5 MiB, typed by its magic bytes.
import { execFileSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../../test/support/index-fixture';
import { readScreenshotBlock, ScreenshotRefused } from './screenshot';

// a 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

describe('readScreenshotBlock', () => {
  let root: ReturnType<typeof tempDir>;
  let outside: ReturnType<typeof tempDir>;
  beforeEach(() => {
    root = tempDir('maws-shot-root-');
    outside = tempDir('maws-shot-outside-');
  });
  afterEach(() => {
    root.dispose();
    outside.dispose();
  });

  const refusal = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => (error instanceof ScreenshotRefused ? error.message : `unexpected: ${String(error)}`),
    );

  it('reads a PNG under a root as an image block typed by its magic bytes, whatever its name', async () => {
    mkdirSync(join(root.path, 'shots'));
    const path = join(root.path, 'shots', 'capture.bin');
    writeFileSync(path, PNG);
    expect(await readScreenshotBlock(path, [root.path])).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') } });
  });

  it('types JPEG, GIF and WebP by their magic bytes', async () => {
    const write = (name: string, bytes: number[] | string) => {
      const path = join(root.path, name);
      writeFileSync(path, typeof bytes === 'string' ? Buffer.from(bytes, 'latin1') : Buffer.from(bytes));
      return path;
    };
    const typeOf = async (path: string) => ((await readScreenshotBlock(path, [root.path])).source as { media_type: string }).media_type;
    expect(await typeOf(write('a.png', [0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(await typeOf(write('b', 'GIF89a\x01\x00'))).toBe('image/gif');
    expect(await typeOf(write('c', 'RIFF\x10\x00\x00\x00WEBPVP8 '))).toBe('image/webp');
  });

  it('refuses a path outside the roots, and a symlink under a root that points outside', async () => {
    const away = join(outside.path, 'shot.png');
    writeFileSync(away, PNG);
    expect(await refusal(readScreenshotBlock(away, [root.path]))).toBe('screenshot: not under an allowed root');
    const link = join(root.path, 'link.png');
    symlinkSync(away, link);
    expect(await refusal(readScreenshotBlock(link, [root.path]))).toBe('screenshot: not under an allowed root');
    // `/shots2` is not under `/shots`
    mkdirSync(join(root.path, 'shots'));
    mkdirSync(join(root.path, 'shots2'));
    writeFileSync(join(root.path, 'shots2', 'shot.png'), PNG);
    expect(await refusal(readScreenshotBlock(join(root.path, 'shots2', 'shot.png'), [join(root.path, 'shots')]))).toBe('screenshot: not under an allowed root');
  });

  it('refuses a file over 5 MiB, a text file named .png, a directory and a missing file', async () => {
    const big = join(root.path, 'big.png');
    writeFileSync(big, Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]));
    expect(await refusal(readScreenshotBlock(big, [root.path]))).toBe('screenshot: larger than 5 MiB');
    const text = join(root.path, 'notes.png');
    writeFileSync(text, 'just some text, not an image\n');
    expect(await refusal(readScreenshotBlock(text, [root.path]))).toBe('screenshot: not a PNG, JPEG, GIF or WebP');
    mkdirSync(join(root.path, 'dir.png'));
    expect(await refusal(readScreenshotBlock(join(root.path, 'dir.png'), [root.path]))).toBe('screenshot: not a regular file');
    expect(await refusal(readScreenshotBlock(join(root.path, 'missing.png'), [root.path]))).toBe('screenshot: not found');
  });

  // the final fix wave: a FIFO under a root (no writer) is opened without blocking, so it cannot stall a libuv thread,
  // and is refused as not a regular file
  it('refuses a FIFO at once, without waiting for a writer', async () => {
    const fifo = join(root.path, 'pipe.png');
    execFileSync('mkfifo', [fifo]);
    expect(await refusal(readScreenshotBlock(fifo, [root.path]))).toBe('screenshot: not a regular file');
  }, 2_000);
});
