// P3-G (§D4.1): Mark-up's still of a browser page, `browser.view.capture`. The tab's view is captured whole at device
// pixels (`capturePage` works while the view is hidden, as the comment crop's note says) and encoded under the crop's caps
// (`encodeCrop`: the longer edge at most 1568, PNG then JPEG, at most 3.5 MiB); the still crosses IPC as base64 and is
// never written to disk. Only the window the tab is placed in may take it: another window's pane does not hold the page.
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
export interface CaptureTarget {
  tabId: string;
  window: unknown;
  shown: boolean;
  contents: { isDestroyed(): boolean; capturePage(): Promise<CropImage> } | null;
}

export async function captureTabView(target: CaptureTarget, senderWindow: unknown): Promise<{ image: CapturedImage | null }> {
  if (senderWindow === null || target.window !== senderWindow) {
    throw new CommandFailure(ipcError('invalid_input', `browser tab ${target.tabId} is not placed in this window`));
  }
  const { contents } = target;
  if (!target.shown || contents === null || contents.isDestroyed()) return { image: null };
  try {
    return { image: capturedImage(await contents.capturePage()) };
  } catch {
    return { image: null }; // the view destroyed meanwhile
  }
}
