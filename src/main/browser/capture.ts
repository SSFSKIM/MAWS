// P3-G (§D4.1): Mark-up's still of a browser page, `browser.view.capture`. The tab's view is captured whole at device
// pixels (`capturePage` works while the view is hidden, as the comment crop's note says) and encoded under the crop's caps
// (`encodeCrop`: the longer edge at most 1568, PNG then JPEG, at most 3.5 MiB); the still crosses IPC as base64 and is
// never written to disk. Only the window the tab is placed in may take it: another window's pane does not hold the page.
// U12a (the UX wave's U12, l9-browser-delivery-06; Interfaces §D, §K): Copy screenshot, `browser.view.copyScreenshot`,
// takes the same capture under the same rule and writes it to the clipboard in main, whole: the caps are for a still sent
// to the model, and a paste wants what the pane shows at full resolution.
import { ipcError } from '@shared/ipc/errors';
import type { CapturedImage } from '@shared/markup/image';
import { CommandFailure } from '../ipc/router';
import { encodeCrop, type CropImage } from './comment/crop';

// A capture under the crop caps, as the still crosses IPC; null for an empty capture or one over the cap.
export function capturedImage(image: CropImage): CapturedImage | null {
  const encoded = encodeCrop(image);
  if (encoded === 'failed' || encoded === 'tooLarge') return null;
  return { mediaType: encoded.ext === 'png' ? 'image/png' : 'image/jpeg', data: encoded.bytes.toString('base64'), width: encoded.width, height: encoded.height };
}

// What the handler reads off a tab's entry: the window it is placed in (null: unplaced), whether its own page is on
// show (view.ts's `shown`: an error, a crash, a suspended or never-navigated tab is drawn by the pane, not the view),
// and the view's page.
export interface CaptureTarget<I extends CropImage = CropImage> {
  tabId: string;
  window: unknown;
  shown: boolean;
  contents: { isDestroyed(): boolean; capturePage(): Promise<I> } | null;
}

// The view's whole capture for the window the tab is placed in (any other window is refused); null when the tab's own page
// is not on show, the view is gone, or the capture failed.
async function captureFor<I extends CropImage>(target: CaptureTarget<I>, senderWindow: unknown): Promise<I | null> {
  if (senderWindow === null || target.window !== senderWindow) {
    throw new CommandFailure(ipcError('invalid_input', `browser tab ${target.tabId} is not placed in this window`));
  }
  const { contents } = target;
  if (!target.shown || contents === null || contents.isDestroyed()) return null;
  try {
    return await contents.capturePage();
  } catch {
    return null; // the view destroyed meanwhile
  }
}

export async function captureTabView(target: CaptureTarget, senderWindow: unknown): Promise<{ image: CapturedImage | null }> {
  const image = await captureFor(target, senderWindow);
  return { image: image === null ? null : capturedImage(image) };
}

// U12a: the capture written to the clipboard as it is; `copied: false`, with nothing written, when there is no picture.
export async function copyTabScreenshot<I extends CropImage>(target: CaptureTarget<I>, senderWindow: unknown, write: (image: I) => Promise<void>): Promise<{ copied: boolean }> {
  const image = await captureFor(target, senderWindow);
  if (image === null || image.isEmpty()) return { copied: false };
  try {
    await write(image);
    return { copied: true };
  } catch (error) {
    console.warn('[browser] writing the screenshot to the clipboard failed:', error instanceof Error ? error.message : error);
    return { copied: false };
  }
}
