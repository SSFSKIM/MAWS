import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CROP_FILES_MAX, CROP_MAX_BYTES, CROP_RETENTION_MS } from '@shared/browser/comment';
import { captureCrop, cropRect, encodeCrop, sweepCrops, writeCrop, type CropImage } from './crop';

// A NativeImage as the crop reads it: its size, and encodings of chosen byte lengths.
function image(width: number, height: number, bytes: { png?: (w: number, h: number) => number; jpeg?: (w: number, h: number) => number } = {}): CropImage & { resized: unknown[] } {
  const resized: unknown[] = [];
  const png = bytes.png ?? (() => 100);
  const jpeg = bytes.jpeg ?? (() => 50);
  return {
    resized,
    isEmpty: () => width === 0 || height === 0,
    getSize: () => ({ width, height }),
    resize: (options) => {
      resized.push(options);
      return image(options.width!, options.height!, bytes);
    },
    toPNG: () => Buffer.alloc(png(width, height), 1),
    toJPEG: (quality) => {
      expect(quality).toBe(85);
      return Buffer.alloc(jpeg(width, height), 2);
    },
  };
}

describe('cropRect (Design §5): CSS px of the viewport to DIP of the view', () => {
  const bounds = { width: 800, height: 600 };

  it('is the rect itself at zoom 1, rounded outward', () => {
    expect(cropRect({ x: 10, y: 20, width: 100, height: 30 }, 1, bounds)).toEqual({ x: 10, y: 20, width: 100, height: 30 });
    expect(cropRect({ x: 10.6, y: 20.2, width: 99.1, height: 29.5 }, 1, bounds)).toEqual({ x: 10, y: 20, width: 100, height: 30 });
  });

  it('scales by the zoom factor (a page at 125 % reports CSS px; the view is in DIP)', () => {
    // 63.1 CSS px at 1.25 is 78.875 DIP (E4-0's 63.1 → 78.9): floor of the origin, ceil of the far edge
    expect(cropRect({ x: 63.1, y: 40, width: 80, height: 24 }, 1.25, bounds)).toEqual({ x: 78, y: 50, width: 101, height: 30 });
  });

  it('clamps to the view, so an area dragged past the edge is cut at it', () => {
    expect(cropRect({ x: -20, y: 500, width: 100, height: 300 }, 1, bounds)).toEqual({ x: 0, y: 500, width: 80, height: 100 });
    expect(cropRect({ x: 600, y: 0, width: 200, height: 10 }, 1.25, bounds)).toEqual({ x: 750, y: 0, width: 50, height: 13 });
  });

  it('answers null for an empty intersection or an empty rect', () => {
    expect(cropRect({ x: 900, y: 10, width: 50, height: 50 }, 1, bounds)).toBeNull();
    expect(cropRect({ x: 10, y: -80, width: 50, height: 50 }, 1, bounds)).toBeNull();
    expect(cropRect({ x: 10, y: 10, width: 0, height: 50 }, 1, bounds)).toBeNull();
  });
});

describe('encodeCrop (Design §5): the composer\'s image rule, then the byte cap', () => {
  it('keeps a small image as PNG at its size', () => {
    const small = image(200, 100);
    expect(encodeCrop(small)).toMatchObject({ ext: 'png', width: 200, height: 100 });
    expect(small.resized).toEqual([]);
  });

  it('scales the longer edge down to 1568 (a 3200 × 400 capture becomes 1568 × 196)', () => {
    const wide = image(3200, 400);
    expect(encodeCrop(wide)).toMatchObject({ ext: 'png', width: 1568, height: 196 });
    expect(wide.resized).toEqual([{ width: 1568, height: 196, quality: 'best' }]);
    expect(encodeCrop(image(300, 4000))).toMatchObject({ width: 118, height: 1568 });
  });

  it('falls back to JPEG over the byte cap, and refuses as tooLarge when JPEG is over it too', () => {
    const over = () => CROP_MAX_BYTES + 1;
    const jpeg = encodeCrop(image(1000, 1000, { png: over }));
    expect(jpeg).toMatchObject({ ext: 'jpg', width: 1000, height: 1000 });
    expect(typeof jpeg === 'object' && jpeg.bytes[0]).toBe(2);
    expect(encodeCrop(image(1000, 1000, { png: () => CROP_MAX_BYTES }))).toMatchObject({ ext: 'png' }); // at the cap is within it
    expect(encodeCrop(image(1000, 1000, { png: over, jpeg: over }))).toBe('tooLarge');
  });

  it('answers failed for an empty capture (Electron answers one rather than throwing for a page never painted)', () => {
    expect(encodeCrop(image(0, 0))).toBe('failed');
  });
});

describe('writeCrop and sweepCrops (Design §5; Decision Log 26(d)): the files under <userData>/browser/crops/', () => {
  let dir: string;
  beforeEach(() => {
    dir = join(mkdtempSync(join(tmpdir(), 'maws-crops-')), 'browser', 'crops');
  });
  afterEach(() => rmSync(join(dir, '..', '..'), { recursive: true, force: true }));

  const encoded = { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]), ext: 'png' as const, width: 4, height: 2 };

  it('creates the directory and writes <tabId>-<ms>-<hex4>.<ext> owner-only', async () => {
    const path = await writeCrop(dir, 'b_0123456789ab', encoded, 1_700_000_000_123);
    expect(path).toMatch(new RegExp(`^${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/b_0123456789ab-1700000000123-[0-9a-f]{4}\\.png$`));
    expect(readFileSync(path)).toEqual(encoded.bytes);
    expect(lstatSync(path).mode & 0o777).toBe(0o600);
    const jpg = await writeCrop(dir, 'b_0123456789ab', { ...encoded, ext: 'jpg' }, 1_700_000_000_123);
    expect(jpg).toMatch(/\.jpg$/);
    expect(jpg).not.toBe(path); // two picks in one millisecond stay apart
  });

  it('never writes through an existing name, and leaves that file alone (exclusive create)', async () => {
    await writeCrop(dir, 'b_0123456789ab', encoded, 5); // creates the directory
    const victim = join(dir, 'victim.txt');
    writeFileSync(victim, 'not a crop');
    const planted = join(dir, 'b_0123456789ab-6-abcd.png');
    symlinkSync(victim, planted);
    await expect(writeCrop(dir, 'b_0123456789ab', encoded, 6, () => 'abcd')).rejects.toThrow(/EEXIST/);
    expect(readFileSync(victim, 'utf8')).toBe('not a crop');
    expect(lstatSync(planted).isSymbolicLink()).toBe(true);
  });

  it('unlinks the partial file of a write that throws after creating it (ENOSPC)', async () => {
    await writeCrop(dir, 'b_0123456789ab', encoded, 0);
    for (const f of readdirSync(dir)) rmSync(join(dir, f));
    const failing = async (path: string) => {
      writeFileSync(path, 'half');
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    };
    await expect(writeCrop(dir, 'b_0123456789ab', encoded, 7, undefined, failing)).rejects.toThrow(/ENOSPC/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('sweeps crops older than the retention, then the oldest beyond the count, and nothing else', async () => {
    await writeCrop(dir, 'b_0123456789ab', encoded, 0); // the directory
    for (const f of readdirSync(dir)) rmSync(join(dir, f));
    const now = 1_800_000_000_000;
    const at = (name: string, ms: number) => {
      writeFileSync(join(dir, name), 'x');
      utimesSync(join(dir, name), ms / 1000, ms / 1000);
    };
    at('old.png', now - CROP_RETENTION_MS - 1000);
    for (let i = 0; i < CROP_FILES_MAX + 3; i += 1) at(`n${String(i).padStart(3, '0')}.png`, now - 1000 * (CROP_FILES_MAX + 3 - i));
    await sweepCrops(dir, now);
    const left = readdirSync(dir).sort();
    expect(left).toHaveLength(CROP_FILES_MAX);
    expect(left).not.toContain('old.png');
    expect(left.slice(0, 1)).toEqual(['n003.png']); // n000 to n002 were the oldest three beyond the count
  });

  it('sweeps nothing when the directory does not exist yet', async () => {
    await expect(sweepCrops(join(dir, 'absent'), Date.now())).resolves.toBeUndefined();
  });
});

describe('captureCrop (Design §5): the view captured at the rect, encoded, written', () => {
  let dir: string;
  beforeEach(() => {
    dir = join(mkdtempSync(join(tmpdir(), 'maws-crops-')), 'crops');
  });
  afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true }));

  const view = (capture: (rect: unknown) => Promise<CropImage>, zoom = 1) => ({
    getBounds: () => ({ x: 300, y: 80, width: 800, height: 600 }),
    webContents: { getZoomFactor: () => zoom, capturePage: capture },
  });
  const rect = { x: 10, y: 20, width: 100, height: 30 };

  it('captures the DIP rect and attaches the written file with the encoded size', async () => {
    const asked: unknown[] = [];
    const crop = await captureCrop(
      view(async (r) => {
        asked.push(r);
        return image(250, 76); // device pixels at DPR 2, roughly
      }, 1.25),
      rect,
      { dir, tabId: 'b_0123456789ab', now: () => 42 },
    );
    expect(asked).toEqual([{ x: 12, y: 25, width: 126, height: 38 }]);
    expect(crop).toMatchObject({ crop: 'attached', screenshot: { width: 250, height: 76 } });
    expect(crop.crop === 'attached' && existsSync(crop.screenshot.path)).toBe(true);
  });

  it('answers none for a rect outside the view, failed for a throwing or empty capture, tooLarge over the cap', async () => {
    const never = async () => {
      throw new Error('should not capture');
    };
    expect(await captureCrop(view(never), { x: 900, y: 0, width: 10, height: 10 }, { dir, tabId: 'b_0123456789ab' })).toEqual({ crop: 'none' });
    expect(await captureCrop(view(async () => Promise.reject(new Error('gone'))), rect, { dir, tabId: 'b_0123456789ab' })).toEqual({ crop: 'failed' });
    expect(await captureCrop(view(async () => image(0, 0)), rect, { dir, tabId: 'b_0123456789ab' })).toEqual({ crop: 'failed' });
    const huge = () => CROP_MAX_BYTES + 1;
    expect(await captureCrop(view(async () => image(100, 30, { png: huge, jpeg: huge })), rect, { dir, tabId: 'b_0123456789ab' })).toEqual({ crop: 'tooLarge' });
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });

  it('answers failed when the file cannot be written', async () => {
    writeFileSync(join(dir, '..', 'blocker'), 'a file where the directory would go');
    const blocked = join(dir, '..', 'blocker', 'crops');
    expect(await captureCrop(view(async () => image(100, 30)), rect, { dir: blocked, tabId: 'b_0123456789ab' })).toEqual({ crop: 'failed' });
  });
});
