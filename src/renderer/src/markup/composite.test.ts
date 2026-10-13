// P3-G (§D4.3): Add to chat composites the still at its pixel size with the marks scaled by still.width / rect.width,
// encodes PNG and falls back to JPEG 0.85 over 3.5 MiB. The canvas is a recording fake: happy-dom paints nothing.
import { describe, expect, it } from 'vitest';
import { CROP_MAX_BYTES } from '@shared/browser/comment';
import type { CapturedImage } from '@shared/markup/image';
import { compositeMarkup, type CompositeDeps } from './composite';
import type { Mark } from './drawing';

const INK = (name: string) => `ink:${name}`; // the resolved token, by name (no colour literal outside tokens.css)

function fakeCanvas(sizes: { png: number; jpeg: number } = { png: 1000, jpeg: 500 }) {
  const calls: unknown[][] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get: (target, key: string) =>
      key in target ? target[key] : (...args: unknown[]) => void calls.push([key, ...args.map((a) => (a && typeof a === 'object' && 'path' in a ? (a as { path: string }).path : a))]),
    set: (target, key: string, value) => {
      target[key] = value;
      calls.push([`${key}=`, value]);
      return true;
    },
  });
  const encoded: unknown[] = [];
  const deps: CompositeDeps = {
    canvas: (width, height) => {
      calls.push(['canvas', width, height]);
      return {
        getContext: () => ctx as unknown as CanvasRenderingContext2D,
        convertToBlob: async (options) => {
          encoded.push(options);
          const size = options.type === 'image/png' ? sizes.png : sizes.jpeg;
          return new Blob([new Uint8Array(size)], { type: options.type });
        },
      };
    },
    decode: async (still) => ({ decoded: still.data }) as unknown as CanvasImageSource,
    path: (d) => ({ path: d }) as unknown as Path2D,
    ink: INK,
    font: () => 'Inter',
  };
  return { deps, calls, encoded };
}

const still: CapturedImage = { mediaType: 'image/png', data: 'c3RpbGw=', width: 1600, height: 1000 };
const marks: Mark[] = [
  { tool: 'box', ink: 'red', from: { x: 10, y: 10 }, to: { x: 50, y: 30 } },
  { tool: 'text', ink: 'red', at: { x: 20, y: 40 }, text: 'here' },
  { tool: 'text', ink: 'white', at: { x: 20, y: 80 }, text: 'and here' },
];

describe('compositeMarkup', () => {
  it('draws the still at its pixel size, then the marks scaled by still.width / surface width', async () => {
    const { deps, calls } = fakeCanvas();
    await compositeMarkup(still, marks, 800, deps);
    expect(calls[0]).toEqual(['canvas', 1600, 1000]);
    expect(calls).toContainEqual(['drawImage', { decoded: 'c3RpbGw=' }, 0, 0, 1600, 1000]);
    const scale = calls.findIndex((c) => c[0] === 'setTransform');
    expect(calls[scale]).toEqual(['setTransform', 2, 0, 0, 2, 0, 0]);
    expect(scale).toBeGreaterThan(calls.findIndex((c) => c[0] === 'drawImage'));
    // the box in surface px through the shared draw operations, stroked 4 px in its ink with round joins
    const stroke = calls.findIndex((c) => c[0] === 'stroke');
    expect(calls[stroke]).toEqual(['stroke', 'M10 10H50V30H10Z']);
    expect(calls.slice(scale, stroke)).toEqual(expect.arrayContaining([['strokeStyle=', 'ink:red'], ['lineWidth=', 4], ['lineJoin=', 'round'], ['lineCap=', 'round']]));
  });

  it('gives text a 2 px halo of the opposite ink under its fill, at 16 px semibold', async () => {
    const { deps, calls } = fakeCanvas();
    await compositeMarkup(still, marks, 800, deps);
    const texts = calls.filter((c) => c[0] === 'strokeText' || c[0] === 'fillText');
    expect(texts).toEqual([
      ['strokeText', 'here', 20, 56],
      ['fillText', 'here', 20, 56],
      ['strokeText', 'and here', 20, 96],
      ['fillText', 'and here', 20, 96],
    ]);
    const first = calls.findIndex((c) => c[0] === 'strokeText');
    expect(calls.slice(0, first)).toEqual(expect.arrayContaining([['font=', '600 16px Inter'], ['lineWidth=', 4], ['strokeStyle=', 'ink:white']]));
    expect(calls.slice(first, first + 3)).toContainEqual(['fillStyle=', 'ink:red']);
    // the white ink's halo is black
    const second = calls.findIndex((c, i) => i > first + 1 && c[0] === 'strokeText');
    const before = calls.slice(first + 2, second);
    expect(before).toContainEqual(['strokeStyle=', 'ink:black']);
    expect(calls.slice(second)).toContainEqual(['fillStyle=', 'ink:white']);
  });

  it('encodes PNG, and JPEG at 0.85 when the PNG is over 3.5 MiB', async () => {
    const small = fakeCanvas();
    const png = await compositeMarkup(still, [], 800, small.deps);
    expect(png.type).toBe('image/png');
    expect(small.encoded).toEqual([{ type: 'image/png' }]);
    const big = fakeCanvas({ png: CROP_MAX_BYTES + 1, jpeg: 2000 });
    const jpeg = await compositeMarkup(still, [], 800, big.deps);
    expect(jpeg.type).toBe('image/jpeg');
    expect(big.encoded).toEqual([{ type: 'image/png' }, { type: 'image/jpeg', quality: 0.85 }]);
  });
});
