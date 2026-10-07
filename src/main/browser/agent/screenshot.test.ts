import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { screenshotPath } from '@shared/maws/deliverable-files';
import { BROWSER_ACTION_TIMEOUT_MS, BROWSER_SCREENSHOT_MAX_BYTES, BROWSER_TOOL_ERRORS, type BrowserWaitReason } from '@shared/maws/browser';
import type { TabEntry } from '../tabs';
import { BrowserToolError } from './errors';
import { FakePage, jpegBytes as jpeg, pngBytes as png, type ScreenshotOptions } from './page.fake';
import { captureScreenshot, CURSOR_HIDE_GRACE_MS, imageSize, saveScreenshot, SCREENSHOT_STYLE, type Picture } from './screenshot';

// browser_screenshot's capture, cap, dimension reader and file (E4c Design §7; A-34; Decision Log 23, 43, 44 (b)): the
// capture over a recording fake Page, the cover's rules over a minimal tab and store, the file in a temp directory.

const OVER = BROWSER_SCREENSHOT_MAX_BYTES + 1;

describe('imageSize: the PNG IHDR and the JPEG SOF', () => {
  it('reads a PNG width and height from its IHDR', () => {
    expect(imageSize(png(1280, 800))).toEqual({ width: 1280, height: 800 });
    expect(imageSize(png(1, 65_537))).toEqual({ width: 1, height: 65_537 });
  });

  it('reads a JPEG from its first frame header, past segments that are not one (DHT is 0xC4)', () => {
    expect(imageSize(jpeg(1280, 800))).toEqual({ width: 1280, height: 800 });
    expect(imageSize(jpeg(640, 480, { sof: 0xc2 }))).toEqual({ width: 640, height: 480 }); // progressive
  });

  it('answers null for bytes that are neither, or cut before the size', () => {
    expect(imageSize(Buffer.from('GIF89a........'))).toBeNull();
    expect(imageSize(Buffer.alloc(0))).toBeNull();
    expect(imageSize(png(10, 10).subarray(0, 20))).toBeNull();
    expect(imageSize(jpeg(10, 10).subarray(0, 48))).toBeNull(); // the SOF begins at 41: its size bytes are cut
    expect(imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull(); // no frame header at all
  });
});

// A tab as the capture reads it (its cover, its view's webContents and bounds), with the store's update hook.
function harness({ covered = false } = {}) {
  vi.useFakeTimers({ now: 1_000_000 });
  const listeners = new Set<(entry: TabEntry) => void>();
  const log: string[] = [];
  const image = {
    isEmpty: vi.fn(() => false),
    resize: vi.fn((size: { width: number; height: number }) => {
      log.push(`resize ${size.width}x${size.height}`);
      return image;
    }),
    toPNG: vi.fn(() => png(800, 600)),
    toJPEG: vi.fn((quality: number) => (log.push(`toJPEG ${quality}`), jpeg(800, 600))),
  };
  const contents = { capturePage: vi.fn(async () => (log.push('capturePage'), image)) };
  const entry = {
    tab: { tabId: 'b_000000000001', covered },
    view: { webContents: contents, getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }) },
  } as unknown as TabEntry;
  const store = {
    onUpdated: (listener: (entry: TabEntry) => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  const page = new FakePage();
  const controller = new AbortController();
  const waits: (BrowserWaitReason | null)[] = [];
  const deps = {
    store,
    signal: controller.signal,
    report: (reason: BrowserWaitReason | null) => void waits.push(reason),
    now: Date.now,
    hideCursor: vi.fn(() => void log.push('hide')),
  };
  const cover = (on: boolean) => {
    (entry.tab as { covered: boolean }).covered = on;
    for (const listener of [...listeners]) listener(entry);
  };
  const capture = (aim: { selector?: string; fullPage?: boolean } = {}) =>
    captureScreenshot(entry, page.asPage(), { locator: aim.selector ? page.locator(aim.selector).asLocator() : null, fullPage: aim.fullPage ?? false }, deps);
  return { entry, page, image, contents, log, waits, deps, controller, cover, capture, listeners };
}

// A screenshot that waits until its signal aborts (a capture a cover or a cancel interrupts).
const pending = (options: ScreenshotOptions) =>
  new Promise<Buffer>((_, reject) => options.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }));

afterEach(() => {
  vi.useRealTimers();
});

describe('captureScreenshot: viewport, target or full page, at CSS pixels with the cursor hidden', () => {
  it('takes the viewport as a PNG at scale css with the cursor-hiding style, and reads its size from the bytes', async () => {
    const h = harness();
    h.page.onScreenshot = () => png(1280, 800, 4_000);
    const picture = await h.capture();
    expect(picture).toEqual({ data: png(1280, 800, 4_000), mimeType: 'image/png', width: 1280, height: 800 });
    expect(h.page.calls).toHaveLength(1);
    expect(h.page.calls[0]).toMatchObject({ method: 'screenshot', selector: 'page', args: [{ type: 'png', scale: 'css', style: SCREENSHOT_STYLE, timeout: BROWSER_ACTION_TIMEOUT_MS }] });
    expect((h.page.calls[0].args[0] as ScreenshotOptions).fullPage).toBeUndefined();
    expect((h.page.calls[0].args[0] as ScreenshotOptions).signal).toBeInstanceOf(AbortSignal);
    expect(SCREENSHOT_STYLE).toBe('maws-agent-cursor{display:none!important}');
    expect(h.deps.hideCursor).not.toHaveBeenCalled(); // a Playwright capture sends no cursor message: the style hides it
    expect(h.contents.capturePage).not.toHaveBeenCalled();
  });

  it('takes the full page and a target the same way', async () => {
    const h = harness();
    h.page.onScreenshot = () => png(1280, 3_000);
    expect(await h.capture({ fullPage: true })).toMatchObject({ width: 1280, height: 3_000 });
    h.page.onScreenshot = () => png(120, 40);
    expect(await h.capture({ selector: 'aria-ref=e5' })).toMatchObject({ mimeType: 'image/png', width: 120, height: 40 });
    expect(h.page.calls).toMatchObject([
      { method: 'screenshot', selector: 'page', args: [{ type: 'png', scale: 'css', style: SCREENSHOT_STYLE, fullPage: true }] },
      { method: 'screenshot', selector: 'aria-ref=e5', args: [{ type: 'png', scale: 'css', style: SCREENSHOT_STYLE, timeout: BROWSER_ACTION_TIMEOUT_MS }] },
    ]);
  });

  it('retakes a PNG over 3.5 MiB as a JPEG at quality 80', async () => {
    const h = harness();
    h.page.onScreenshot = (_selector, options) => (options.type === 'png' ? png(1280, 9_000, OVER) : jpeg(1280, 9_000, { size: 900_000 }));
    const picture = await h.capture({ fullPage: true });
    expect(picture).toMatchObject({ mimeType: 'image/jpeg', width: 1280, height: 9_000 });
    expect(picture.data.length).toBe(900_000);
    expect(h.page.calls.map((call) => call.args[0])).toMatchObject([
      { type: 'png', scale: 'css', style: SCREENSHOT_STYLE, fullPage: true },
      { type: 'jpeg', quality: 80, scale: 'css', style: SCREENSHOT_STYLE, fullPage: true },
    ]);
  });

  it('keeps a PNG of exactly 3.5 MiB', async () => {
    const h = harness();
    h.page.onScreenshot = () => png(1280, 800, BROWSER_SCREENSHOT_MAX_BYTES);
    expect(await h.capture()).toMatchObject({ mimeType: 'image/png' });
    expect(h.page.calls).toHaveLength(1);
  });

  it('refuses a picture still over 3.5 MiB as a JPEG: screenshotTooLarge with the JPEG size', async () => {
    const h = harness();
    h.page.onScreenshot = (_selector, options) => (options.type === 'png' ? png(1280, 40_000, OVER + 10) : jpeg(1280, 40_000, { size: OVER + 5 }));
    await expect(h.capture({ fullPage: true })).rejects.toEqual(new BrowserToolError(BROWSER_TOOL_ERRORS.screenshotTooLarge(OVER + 5)));
  });

  it('answers screenshotFailed for a picture whose size cannot be read, and for what Playwright throws', async () => {
    const h = harness();
    h.page.onScreenshot = () => Buffer.from('not an image');
    await expect(h.capture()).rejects.toEqual(new BrowserToolError(BROWSER_TOOL_ERRORS.screenshotFailed('the picture could not be read')));
    h.page.onScreenshot = () => Promise.reject(new Error('page.screenshot: Target page, context or browser has been closed\nCall log: …'));
    await expect(h.capture()).rejects.toEqual(new BrowserToolError(BROWSER_TOOL_ERRORS.screenshotFailed('Target page, context or browser has been closed')));
  });

  it('names a timeout by what did not come: the element, or the page', async () => {
    const h = harness();
    h.page.onScreenshot = () => Promise.reject(Object.assign(new Error('locator.screenshot: Timeout 10000ms exceeded.'), { name: 'TimeoutError' }));
    await expect(h.capture({ selector: 'aria-ref=e5' })).rejects.toEqual(new BrowserToolError(BROWSER_TOOL_ERRORS.screenshotFailed('the element was not visible and stable within 10 s')));
    await expect(h.capture()).rejects.toEqual(new BrowserToolError(BROWSER_TOOL_ERRORS.screenshotFailed('the page did not present a frame within 10 s')));
  });

  it('rejects with the abort and maps nothing when the request is cancelled during the capture', async () => {
    const h = harness();
    h.page.onScreenshot = (_selector, options) => pending(options);
    const capture = h.capture();
    await vi.advanceTimersByTimeAsync(10);
    h.controller.abort('cancelled');
    await expect(capture).rejects.toBe('cancelled');
  });
});

describe('captureScreenshot under a cover (Design §7, Decision Log 23)', () => {
  it('takes a covered viewport through capturePage after a cursor hide and its grace, at the view size, never through Playwright', async () => {
    const h = harness({ covered: true });
    const capture = h.capture();
    await vi.advanceTimersByTimeAsync(CURSOR_HIDE_GRACE_MS - 1);
    expect(h.log).toEqual(['hide']); // the grace runs before the capture
    await vi.advanceTimersByTimeAsync(1);
    expect(await capture).toEqual({ data: png(800, 600), mimeType: 'image/png', width: 800, height: 600 });
    expect(h.log).toEqual(['hide', 'capturePage', 'resize 800x600']);
    expect(CURSOR_HIDE_GRACE_MS).toBe(50);
    expect(h.page.calls).toEqual([]);
    expect(h.waits).toEqual([]); // nothing waited for
  });

  it('falls back to JPEG 80 under a cover too, and refuses what is still too large', async () => {
    const h = harness({ covered: true });
    h.image.toPNG.mockReturnValue(png(800, 600, OVER));
    const capture = h.capture();
    await vi.advanceTimersByTimeAsync(CURSOR_HIDE_GRACE_MS);
    expect(await capture).toMatchObject({ mimeType: 'image/jpeg', width: 800, height: 600 });
    expect(h.log).toContain('toJPEG 80');
    h.image.toJPEG.mockReturnValue(jpeg(800, 600, { size: OVER }));
    const again = h.capture();
    const failed = expect(again).rejects.toEqual(new BrowserToolError(BROWSER_TOOL_ERRORS.screenshotTooLarge(OVER)));
    await vi.advanceTimersByTimeAsync(CURSOR_HIDE_GRACE_MS);
    await failed;
  });

  it('answers screenshotFailed for an empty capture or one Electron refuses', async () => {
    const h = harness({ covered: true });
    h.image.isEmpty.mockReturnValue(true);
    const empty = expect(h.capture()).rejects.toEqual(new BrowserToolError(BROWSER_TOOL_ERRORS.screenshotFailed('the covered page has no picture yet')));
    await vi.advanceTimersByTimeAsync(CURSOR_HIDE_GRACE_MS);
    await empty;
    h.contents.capturePage.mockRejectedValueOnce(new Error('Current display surface not available for capture'));
    const refused = expect(h.capture()).rejects.toEqual(new BrowserToolError(BROWSER_TOOL_ERRORS.screenshotFailed('Current display surface not available for capture')));
    await vi.advanceTimersByTimeAsync(CURSOR_HIDE_GRACE_MS);
    await refused;
  });

  it('switches a viewport capture to capturePage when a cover comes during it', async () => {
    const h = harness();
    h.page.onScreenshot = (_selector, options) => pending(options);
    const capture = h.capture();
    await vi.advanceTimersByTimeAsync(10);
    h.cover(true);
    await vi.advanceTimersByTimeAsync(CURSOR_HIDE_GRACE_MS);
    expect(await capture).toMatchObject({ mimeType: 'image/png', width: 800, height: 600 });
    expect(h.log).toEqual(['hide', 'capturePage', 'resize 800x600']);
    expect(h.listeners.size).toBe(0); // the cover watch is gone
  });

  it('waits out a cover for a target or full-page capture, reporting it, and captures once it lifts', async () => {
    const h = harness({ covered: true });
    h.page.onScreenshot = () => png(1280, 3_000);
    const capture = h.capture({ fullPage: true });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(h.page.calls).toEqual([]);
    expect(h.waits).toEqual(['cover']);
    h.cover(false);
    expect(await capture).toMatchObject({ width: 1280, height: 3_000 });
    expect(h.waits).toEqual(['cover', null]);
    expect(h.contents.capturePage).not.toHaveBeenCalled();
    expect(h.deps.hideCursor).not.toHaveBeenCalled();
  });

  it('restarts a target capture a cover interrupts, after the cover lifts', async () => {
    const h = harness();
    let shots = 0;
    h.page.onScreenshot = (_selector, options) => (++shots === 1 ? pending(options) : png(120, 40));
    const capture = h.capture({ selector: 'aria-ref=e5' });
    await vi.advanceTimersByTimeAsync(10);
    h.cover(true);
    await vi.advanceTimersByTimeAsync(2_000);
    h.cover(false);
    expect(await capture).toMatchObject({ width: 120, height: 40 });
    expect(h.page.calls.map((call) => call.selector)).toEqual(['aria-ref=e5', 'aria-ref=e5']);
    expect(h.waits).toEqual(['cover', null]);
  });
});

describe('saveScreenshot: the file at the path main derives (Design §7, Decision Log 43, 47)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const A = 'App-A' as AppSessionId;
  const ID = '6f1c2a4e-3b5d-4c7e-8f90-a1b2c3d4e5f6';

  it('writes a PNG as .png and a JPEG as .jpg under the session\'s screenshots directory, whole, with no temp file left', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'maws-e4c-shot-'));
    dirs.push(userData);
    const shot: Picture = { data: png(10, 10, 100), mimeType: 'image/png', width: 10, height: 10 };
    const pngPath = await saveScreenshot(userData, A, ID, shot);
    expect(pngPath).toBe(screenshotPath(userData, A, ID, 'png'));
    expect(readFileSync(pngPath).equals(shot.data)).toBe(true);
    const jpegShot: Picture = { data: jpeg(10, 10, { size: 200 }), mimeType: 'image/jpeg', width: 10, height: 10 };
    const jpgPath = await saveScreenshot(userData, A, ID, jpegShot);
    expect(jpgPath).toBe(screenshotPath(userData, A, ID, 'jpg'));
    expect(readFileSync(jpgPath).equals(jpegShot.data)).toBe(true);
    expect(readdirSync(join(userData, 'deliverables', A, 'screenshots')).sort()).toEqual([`${ID}.jpg`, `${ID}.png`]);
  });
});
