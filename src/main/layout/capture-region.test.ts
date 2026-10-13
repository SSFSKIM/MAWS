import { describe, expect, it } from 'vitest';
import { CROP_MAX_BYTES } from '@shared/browser/comment';
import type { CropImage } from '../browser/comment/crop';
import { captureRegion } from './capture-region';

function image(width: number, height: number, png = 40): CropImage {
  return {
    isEmpty: () => width === 0 || height === 0,
    getSize: () => ({ width, height }),
    resize: (options) => image(options.width, options.height, png),
    toPNG: () => Buffer.alloc(png, 3),
    toJPEG: () => Buffer.alloc(png, 4),
  };
}

describe('captureRegion (P3-G §D4.1): layout.captureRegion, the sender window’s own page at a rect', () => {
  const window = { getContentBounds: () => ({ x: 120, y: 60, width: 1200, height: 800 }) };
  const sender = (capture: (rect: unknown) => Promise<CropImage>, zoom = 1) => ({ getZoomFactor: () => zoom, capturePage: capture });

  it('captures the rect in DIP of the window (times its zoom, rounded outward) and answers the encoded still', async () => {
    const asked: unknown[] = [];
    const answer = await captureRegion(
      { rect: { x: 400.4, y: 100, width: 300, height: 200.2 } },
      sender(async (rect) => {
        asked.push(rect);
        return image(600, 401); // device pixels at DPR 2
      }),
      window,
    );
    expect(asked).toEqual([{ x: 400, y: 100, width: 301, height: 201 }]);
    expect(answer).toEqual({ image: { mediaType: 'image/png', data: Buffer.alloc(40, 3).toString('base64'), width: 600, height: 401 } });
    await captureRegion({ rect: { x: 100, y: 40, width: 80, height: 24 } }, sender(async (rect) => (asked.push(rect), image(10, 10)), 1.25), window);
    expect(asked[1]).toEqual({ x: 125, y: 50, width: 100, height: 30 });
  });

  it('cuts the rect at the window’s edges, and answers null when nothing of it is inside', async () => {
    const asked: unknown[] = [];
    await captureRegion({ rect: { x: 1100, y: -20, width: 300, height: 100 } }, sender(async (rect) => (asked.push(rect), image(10, 10))), window);
    expect(asked).toEqual([{ x: 1100, y: 0, width: 100, height: 80 }]);
    const never = sender(() => Promise.reject(new Error('should not capture')));
    expect(await captureRegion({ rect: { x: 1300, y: 0, width: 50, height: 50 } }, never, window)).toEqual({ image: null });
  });

  it('answers null for a sender with no window, a failing or empty capture, and one over the cap', async () => {
    expect(await captureRegion({ rect: { x: 0, y: 0, width: 50, height: 50 } }, sender(async () => image(10, 10)), null)).toEqual({ image: null });
    expect(await captureRegion({ rect: { x: 0, y: 0, width: 50, height: 50 } }, sender(() => Promise.reject(new Error('gone'))), window)).toEqual({ image: null });
    expect(await captureRegion({ rect: { x: 0, y: 0, width: 50, height: 50 } }, sender(async () => image(0, 0)), window)).toEqual({ image: null });
    expect(await captureRegion({ rect: { x: 0, y: 0, width: 50, height: 50 } }, sender(async () => image(10, 10, CROP_MAX_BYTES + 1)), window)).toEqual({ image: null });
  });
});
