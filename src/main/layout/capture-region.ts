// P3-G (§D4.1): `layout.captureRegion`, Mark-up's still of a surface the renderer draws (the deliverable viewer now, the
// document and slide editors later; an iframe included, which the compositor paints). The sender window's own page is
// captured at the rect (CSS px of its content area, in DIP times the page's zoom, cut at the window's edges, as the
// comment crop maps a pick) and encoded under the crop's caps. A native browser view is not the page's, so it is never
// in this capture; the renderer takes its still before it draws the overlay, so the overlay is not in it either.
import type { Rectangle } from 'electron';
import type { CapturedImage, CaptureRect } from '@shared/markup/image';
import { capturedImage } from '../browser/capture';
import { cropRect, type CropImage } from '../browser/comment/crop';

export interface RegionSender {
  getZoomFactor(): number;
  capturePage(rect: Rectangle): Promise<CropImage>;
}

export async function captureRegion({ rect }: { rect: CaptureRect }, sender: RegionSender, window: { getContentBounds(): Rectangle } | null): Promise<{ image: CapturedImage | null }> {
  if (window === null) return { image: null };
  const region = cropRect(rect, sender.getZoomFactor(), window.getContentBounds());
  if (region === null) return { image: null };
  try {
    return { image: capturedImage(await sender.capturePage(region)) };
  } catch {
    return { image: null }; // the window closing meanwhile
  }
}
