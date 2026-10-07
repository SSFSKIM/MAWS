// E4d (Task 3.2): this window's side of comment mode (E4d execution document, Design §6 and §8; Decision Log 9 and 14).
// `browser.comment.changed` (every window) moves the toggle's store, and a refused pick says the element could not be
// named, so the toggle never stays pressed after a pick without a word. `browser.comment.picked` (sent to the window
// whose pane owns the tab alone) opens E3's comment composer through E5's seam on the anchor main built and validated,
// for the tab's session; E3's sheet then owns the crop chip, the destination and the send. A crop that could not be
// attached is said in a toast, not a chrome notice: the sheet covers the page by then.
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../../ipc/client';
import { toast } from '../../../stores/notices';
import { openCommentComposer } from '../../code/anchor/anchor';
import { COMMENT_COPY } from './copy';
import { setCommentArmed } from './store';

const warn = (text: string) => void toast({ level: 'warning', text, actions: [], dismissible: true });

export function connectBrowserComment(client: MawsBridge = ipc): () => void {
  const offChanged = client.on('browser.comment.changed', ({ tabId, on, reason }) => {
    setCommentArmed(tabId, on);
    if (reason === 'refused') warn(COMMENT_COPY.cannotName);
  });
  const offPicked = client.on('browser.comment.picked', ({ appSessionId, anchor, crop }) => {
    openCommentComposer(anchor, { appSessionId });
    if (crop === 'tooLarge') warn(COMMENT_COPY.cropTooLarge);
    else if (crop === 'failed') warn(COMMENT_COPY.cropFailed);
  });
  return () => {
    offChanged();
    offPicked();
  };
}
