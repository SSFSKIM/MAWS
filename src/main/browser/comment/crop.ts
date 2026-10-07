// Comment mode's crop (E4d execution document, Design §5; Decision Log 10 and 26(d)): the picture of what the person
// pointed at, taken by main from the tab's view at the rect the preload reported, before anything reaches the renderer.
// `capturePage` needs no debugger attachment and works while the view is hidden under the sheet's cover; its image is
// in device pixels. The composer's image rule bounds it (the longer edge at most 1568, PNG then JPEG, at most 3.5 MiB),
// and it is written once, by exclusive create, under `<userData>/browser/crops/`, where E3's reader accepts it at send.
// The transcript then carries the pixels itself, so the file is only kept for a sheet left open: the boot sweep drops
// crops older than a week and the oldest beyond 200.
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NativeImage, Rectangle } from 'electron';
import type { AnchorScreenshot } from '@shared/anchor/anchor';
import { CROP_FILES_MAX, CROP_MAX_BYTES, CROP_MAX_EDGE, CROP_RETENTION_MS } from '@shared/browser/comment';
import type { PickRect } from '@shared/browser/comment-protocol';

// What became of a pick's picture, as `browser.comment.picked` says it.
export type Crop = { crop: 'attached'; screenshot: AnchorScreenshot } | { crop: 'none' | 'tooLarge' | 'failed' };

export type CropImage = Pick<NativeImage, 'isEmpty' | 'getSize' | 'toPNG' | 'toJPEG'> & {
  resize(options: { width: number; height: number; quality: 'best' }): CropImage;
};
export type EncodedCrop = { bytes: Buffer; ext: 'png' | 'jpg'; width: number; height: number };

const JPEG_QUALITY = 85;

// The report's rect (CSS px of the viewport) in DIP of the view: times the page's zoom, rounded outward, cut at the
// view's edges (an area dragged past the viewport). Null when nothing of it is inside the view.
export function cropRect(rect: PickRect, zoom: number, bounds: { width: number; height: number }): Rectangle | null {
  const left = Math.max(0, Math.floor(rect.x * zoom));
  const top = Math.max(0, Math.floor(rect.y * zoom));
  const right = Math.min(Math.floor(bounds.width), Math.ceil((rect.x + rect.width) * zoom));
  const bottom = Math.min(Math.floor(bounds.height), Math.ceil((rect.y + rect.height) * zoom));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

// The capture under the composer's caps (`attachments.ts`'s `scaledSize`, A-34's bytes). An empty image is a failure:
// Electron answers one rather than throwing for a page that never painted, and a 0 × 0 screenshot is no anchor's.
export function encodeCrop(image: CropImage): EncodedCrop | 'tooLarge' | 'failed' {
  if (image.isEmpty()) return 'failed';
  const size = image.getSize();
  if (size.width < 1 || size.height < 1) return 'failed';
  const longest = Math.max(size.width, size.height);
  let current = image;
  if (longest > CROP_MAX_EDGE) {
    const scale = CROP_MAX_EDGE / longest;
    current = image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'best' });
  }
  const { width, height } = current.getSize();
  const png = current.toPNG();
  if (png.length <= CROP_MAX_BYTES) return { bytes: png, ext: 'png', width, height };
  const jpeg = current.toJPEG(JPEG_QUALITY);
  if (jpeg.length <= CROP_MAX_BYTES) return { bytes: jpeg, ext: 'jpg', width, height };
  return 'tooLarge';
}

type WriteBytes = (path: string, bytes: Buffer, options: { flag: 'wx'; mode: number }) => Promise<void>;

// `<dir>/<tabId>-<ms>-<4 hex>.<ext>`, created exclusively and owner-only: an existing name (or a symlink planted at it)
// fails rather than being written through, so the path main hands out is always a file this call made whole. A write
// that throws after creating the file (ENOSPC) unlinks it; one that never created it (EEXIST) leaves the other file be.
export async function writeCrop(
  dir: string,
  tabId: string,
  encoded: EncodedCrop,
  now: number,
  random: () => string = () => randomBytes(2).toString('hex'),
  write: WriteBytes = writeFile,
): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${tabId}-${now}-${random()}.${encoded.ext}`);
  try {
    await write(path, encoded.bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') await unlink(path).catch(() => {});
    throw error;
  }
  return path;
}

export interface CropView {
  getBounds(): Rectangle;
  webContents: { getZoomFactor(): number; capturePage(rect: Rectangle): Promise<CropImage> };
}

// The pick's picture, end to end: the rect in the view, the capture, the caps, the file. Never throws.
export async function captureCrop(view: CropView, rect: PickRect, target: { dir: string; tabId: string; now?: () => number }): Promise<Crop> {
  const region = cropRect(rect, view.webContents.getZoomFactor(), view.getBounds());
  if (region === null) return { crop: 'none' };
  let encoded: EncodedCrop | 'tooLarge' | 'failed';
  try {
    encoded = encodeCrop(await view.webContents.capturePage(region));
  } catch {
    return { crop: 'failed' }; // a view destroyed meanwhile, a page never painted
  }
  if (encoded === 'tooLarge' || encoded === 'failed') return { crop: encoded };
  try {
    const path = await writeCrop(target.dir, target.tabId, encoded, (target.now ?? Date.now)());
    return { crop: 'attached', screenshot: { path, width: encoded.width, height: encoded.height } };
  } catch (error) {
    console.warn('[browser] comment crop not written:', (error as NodeJS.ErrnoException).code ?? 'error');
    return { crop: 'failed' };
  }
}

// The boot sweep: crops older than `CROP_RETENTION_MS`, then the oldest beyond `CROP_FILES_MAX`. Regular files only
// (lstat: a link is never followed), and a directory that does not exist yet is nothing to sweep.
export async function sweepCrops(dir: string, now: number): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  const files: { path: string; at: number }[] = [];
  for (const name of names) {
    const path = join(dir, name);
    const stat = await lstat(path).catch(() => null);
    if (stat?.isFile()) files.push({ path, at: stat.mtimeMs });
  }
  const kept = files.filter((file) => now - file.at <= CROP_RETENTION_MS).sort((a, b) => b.at - a.at);
  const gone = [...files.filter((file) => now - file.at > CROP_RETENTION_MS), ...kept.slice(CROP_FILES_MAX)];
  await Promise.all(gone.map((file) => unlink(file.path).catch(() => {})));
}
