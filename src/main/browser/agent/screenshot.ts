// browser_screenshot's picture (E4c execution document, Design §7; X12, A-34; Decision Log 17, 23, 43, 44 (b), 47).
//
// The capture: the viewport, one element (a target the handler resolved) or the full page, through Playwright at
// `scale: 'css'` (a Retina capture would quadruple the bytes for nothing the model needs) with a stylesheet that hides
// the agent's cursor overlay, so the picture never carries it and a screenshot sends no cursor message of its own. The
// cap: a PNG over BROWSER_SCREENSHOT_MAX_BYTES is retaken as a JPEG at quality 80, and a JPEG still over it is
// `screenshotTooLarge`. The size reported is read from the encoded bytes (the PNG's IHDR, the JPEG's frame header).
//
// A covered page (a sheet over a placed view) presents no frame to `Page.captureScreenshot`: a viewport capture is taken
// through Electron's `capturePage` instead (it reads the view's last frame while hidden), after a `hide` to the cursor
// and a short grace, and sized back to the view's CSS bounds; a target or full-page capture waits for the cover to lift,
// reported as an action's wait is (`withoutCover`). An unplaced tab is captured at its parked size (visible.ts).
//
// The file: main derives its path from the record's id (`screenshotPath`, `.png` or `.jpg` by what was taken) and
// writes it whole through `writeAtomic`; the host checks the answer's path against its own derivation (Decision Log 47).
import type { Locator, Page } from 'playwright-core';
import type { AppSessionId } from '@shared/graph/ids';
import { screenshotPath, writeAtomic } from '@shared/maws/deliverable-files';
import { BROWSER_ACTION_TIMEOUT_MS, BROWSER_SCREENSHOT_MAX_BYTES, BROWSER_TOOL_ERRORS } from '@shared/maws/browser';
import type { TabEntry } from '../tabs';
import { sleep, unlessCovered, withoutCover, type CoverDeps } from './act';
import { BrowserToolError, firstLine } from './errors';
import { isTimeout } from './locate';

// Playwright applies it during the capture only (`style`, types.d.ts): the cursor overlay's host element (Design §9).
export const SCREENSHOT_STYLE = 'maws-agent-cursor{display:none!important}';
export const SCREENSHOT_JPEG_QUALITY = 80;
export const CURSOR_HIDE_GRACE_MS = 50; // the overlay's `hide` reaches the page before capturePage reads the frame

type MimeType = 'image/png' | 'image/jpeg';

export interface Picture {
  data: Buffer;
  mimeType: MimeType;
  width: number; // pixels, from the encoded bytes
  height: number;
}

export interface ScreenshotAim {
  locator: Locator | null; // the target the handler resolved; null for the page
  fullPage: boolean;
}

export interface ScreenshotDeps extends CoverDeps {
  hideCursor(): void; // before capturePage, which no stylesheet reaches
}

export async function captureScreenshot(entry: TabEntry, page: Page, aim: ScreenshotAim, deps: ScreenshotDeps): Promise<Picture> {
  try {
    const shot = await shoot(entry, page, aim, deps);
    const size = imageSize(shot.data);
    if (!size) throw new BrowserToolError(BROWSER_TOOL_ERRORS.screenshotFailed('the picture could not be read'));
    return { ...shot, ...size };
  } catch (error) {
    if (deps.signal.aborted) throw deps.signal.reason;
    if (error instanceof BrowserToolError) throw error;
    if (isTimeout(error)) {
      const seconds = BROWSER_ACTION_TIMEOUT_MS / 1000;
      throw new BrowserToolError(BROWSER_TOOL_ERRORS.screenshotFailed(aim.locator ? `the element was not visible and stable within ${seconds} s` : `the page did not present a frame within ${seconds} s`));
    }
    throw new BrowserToolError(BROWSER_TOOL_ERRORS.screenshotFailed(firstLine(error)));
  }
}

type Shot = Pick<Picture, 'data' | 'mimeType'>;
type Encoding = { type: 'png' } | { type: 'jpeg'; quality: number };

async function shoot(entry: TabEntry, page: Page, { locator, fullPage }: ScreenshotAim, deps: ScreenshotDeps): Promise<Shot> {
  const options = (encoding: Encoding, signal: AbortSignal, timeout: number) => ({ ...encoding, scale: 'css' as const, style: SCREENSHOT_STYLE, timeout, signal });
  if (locator || fullPage) {
    // a hidden page presents no frame: wait for the cover to lift, as an action does
    const { value } = await withoutCover(entry, deps, BROWSER_ACTION_TIMEOUT_MS, (signal, budget) =>
      underCap((encoding) => (locator ? locator.screenshot(options(encoding, signal, budget)) : page.screenshot({ ...options(encoding, signal, budget), fullPage: true }))),
    );
    return value;
  }
  const shown = await unlessCovered(entry, deps, (signal) => underCap((encoding) => page.screenshot(options(encoding, signal, BROWSER_ACTION_TIMEOUT_MS))));
  return shown ?? (await capturedUnderCover(entry, deps));
}

// The PNG, else the JPEG retake (A-34), else the refusal.
async function underCap(take: (encoding: Encoding) => Promise<Buffer>): Promise<Shot> {
  const png = await take({ type: 'png' });
  if (png.length <= BROWSER_SCREENSHOT_MAX_BYTES) return { data: png, mimeType: 'image/png' };
  const jpeg = await take({ type: 'jpeg', quality: SCREENSHOT_JPEG_QUALITY });
  if (jpeg.length <= BROWSER_SCREENSHOT_MAX_BYTES) return { data: jpeg, mimeType: 'image/jpeg' };
  throw new BrowserToolError(BROWSER_TOOL_ERRORS.screenshotTooLarge(jpeg.length));
}

// A covered viewport through Electron (Decision Log 23), at the view's CSS size as E4a's cover placeholder is.
async function capturedUnderCover(entry: TabEntry, deps: ScreenshotDeps): Promise<Shot> {
  const view = entry.view!;
  deps.hideCursor();
  await sleep(CURSOR_HIDE_GRACE_MS, deps.signal);
  const image = await view.webContents.capturePage();
  deps.signal.throwIfAborted();
  if (image.isEmpty()) throw new BrowserToolError(BROWSER_TOOL_ERRORS.screenshotFailed('the covered page has no picture yet'));
  const { width, height } = view.getBounds();
  const sized = width > 0 && height > 0 ? image.resize({ width, height }) : image;
  return underCap(async (encoding) => (encoding.type === 'png' ? sized.toPNG() : sized.toJPEG(encoding.quality)));
}

// The picture at the path main derives for the record (`.png` or `.jpg` by its format), written whole.
export async function saveScreenshot(userData: string, appSessionId: AppSessionId, deliverableId: string, picture: Picture): Promise<string> {
  const path = screenshotPath(userData, appSessionId, deliverableId, picture.mimeType === 'image/png' ? 'png' : 'jpg');
  await writeAtomic(path, picture.data);
  return path;
}

// ---- the dimension reader -------------------------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// A PNG's or a JPEG's pixel size from its header; null for anything else or bytes cut before the size.
export function imageSize(data: Uint8Array): { width: number; height: number } | null {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (bytes.length >= 24 && PNG_SIGNATURE.every((byte, i) => bytes[i] === byte) && bytes.toString('latin1', 12, 16) === 'IHDR') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }; // IHDR is always the first chunk
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes);
  return null;
}

// Walks the JPEG's marker segments to its first frame header (SOF0 to SOF15 but DHT, JPG and DAC): precision, height,
// width. Standalone markers carry no length; fill bytes (0xFF) may pad between segments; scan data starts at SOS.
function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // the end, or the scan, before any frame header
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 9 > bytes.length) return null;
      return { width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5) };
    }
    i += 2 + bytes.readUInt16BE(i + 2);
  }
  return null;
}
