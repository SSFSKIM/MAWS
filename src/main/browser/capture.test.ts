import { describe, expect, it } from 'vitest';
import { CROP_MAX_BYTES } from '@shared/browser/comment';
import { CapturedImageSchema } from '@shared/markup/image';
import { CommandFailure } from '../ipc/router';
import type { CropImage } from './comment/crop';
import { captureTabView, capturedImage, type CaptureTarget } from './capture';

// A NativeImage as the encoder reads it: its size, and encodings of chosen byte lengths.
function image(width: number, height: number, bytes: { png?: number; jpeg?: number } = {}): CropImage {
  return {
    isEmpty: () => width === 0 || height === 0,
    getSize: () => ({ width, height }),
    resize: (options) => image(options.width, options.height, bytes),
    toPNG: () => Buffer.alloc(bytes.png ?? 12, 1),
    toJPEG: () => Buffer.alloc(bytes.jpeg ?? 6, 2),
  };
}

describe('capturedImage (P3-G §D4.1): a capture under the crop caps, as the still crosses IPC', () => {
  it('answers PNG at the capture size with its bytes in base64, valid for the schema', () => {
    const still = capturedImage(image(800, 600));
    expect(still).toEqual({ mediaType: 'image/png', data: Buffer.alloc(12, 1).toString('base64'), width: 800, height: 600 });
    expect(CapturedImageSchema.safeParse(still).success).toBe(true);
  });

  it('scales the longer edge to 1568 and falls back to JPEG over the byte cap', () => {
    expect(capturedImage(image(3136, 1000))).toMatchObject({ mediaType: 'image/png', width: 1568, height: 500 });
    expect(capturedImage(image(800, 600, { png: CROP_MAX_BYTES + 1 }))).toMatchObject({ mediaType: 'image/jpeg', data: Buffer.alloc(6, 2).toString('base64') });
  });

  it('answers null for an empty capture and for one over the cap as JPEG too', () => {
    expect(capturedImage(image(0, 0))).toBeNull();
    expect(capturedImage(image(800, 600, { png: CROP_MAX_BYTES + 1, jpeg: CROP_MAX_BYTES + 1 }))).toBeNull();
  });
});

describe('captureTabView (P3-G §D4.1): browser.view.capture for a tab this window holds', () => {
  const win = { id: 1 };
  const other = { id: 2 };
  const target = (overrides: Partial<CaptureTarget> = {}): CaptureTarget => ({
    tabId: 'b_0123456789ab',
    window: win,
    shown: true,
    contents: { isDestroyed: () => false, capturePage: async () => image(1600, 1200) },
    ...overrides,
  });
  const contents = (capturePage: () => Promise<CropImage>) => ({ isDestroyed: () => false, capturePage });

  it('captures the whole view (no rect) and answers the encoded still', async () => {
    const asked: unknown[][] = [];
    const answer = await captureTabView(
      target({
        contents: contents(async (...args: unknown[]) => {
          asked.push(args);
          return image(1600, 1200);
        }),
      }),
      win,
    );
    expect(asked).toEqual([[]]);
    expect(answer).toEqual({ image: expect.objectContaining({ mediaType: 'image/png', width: 1568, height: 1176 }) });
  });

  it('refuses a tab placed in another window, or in none, and a sender with no app window', async () => {
    await expect(captureTabView(target({ window: other }), win)).rejects.toBeInstanceOf(CommandFailure);
    await expect(captureTabView(target({ window: null }), win)).rejects.toMatchObject({ error: { code: 'invalid_input' } });
    await expect(captureTabView(target(), null)).rejects.toBeInstanceOf(CommandFailure);
  });

  it('answers null when the page is not on show (an error, a crash, suspended: the pane draws those), has no live view, or the capture fails', async () => {
    const never = contents(() => Promise.reject(new Error('should not capture')));
    expect(await captureTabView(target({ shown: false, contents: never }), win)).toEqual({ image: null });
    expect(await captureTabView(target({ contents: null }), win)).toEqual({ image: null });
    expect(await captureTabView(target({ contents: { isDestroyed: () => true, capturePage: async () => image(10, 10) } }), win)).toEqual({ image: null });
    expect(await captureTabView(target({ contents: contents(() => Promise.reject(new Error('gone'))) }), win)).toEqual({ image: null });
    expect(await captureTabView(target({ contents: contents(async () => image(0, 0)) }), win)).toEqual({ image: null });
  });
});
