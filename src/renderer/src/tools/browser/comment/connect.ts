// E4d (Task 3.2): this window's side of comment mode (E4d execution document, Design §6 and §8; Decision Log 9, 14 and
// 35). `browser.comment.changed` (every window) moves the toggle's store, and a refused pick says the element could not
// be named, so the toggle never stays pressed after a pick without a word. `browser.comment.picked` (sent to the window
// whose pane owns the tab alone) opens E3's comment composer through E5's seam on the anchor main built and validated,
// for the tab's session; E3's sheet then owns the crop chip, the destination and the send.
//
// Where each word goes: with no sheet over the page (a refused pick, an arm the page never confirmed) it is a line in
// the tab's chrome, E4a's notice path, since the toast viewport covers a panel's page and would freeze it to a still
// picture for the toast's life (E4a's Decision 28); a crop that could not be attached is a toast, since the sheet covers
// the page by then and a chrome line under it would not be read (Decision Log 9).
//
// P2-E2: a pick opens the comment card docked in the strip of the pane that holds the tab's view (`dock.ts`), never over
// the page and with no cover; the sheet opens only for a tab no pane of this window holds. The card leaves the page on
// screen, so a missing crop is then a chrome line, as every other word with nothing over the page. The pick's `position`
// (the element's point in the pane's pixels, main's) is the card's pin; without it the card docks with none.
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../../ipc/client';
import { toast } from '../../../stores/notices';
import { openCommentComposer } from '../../code/anchor/anchor';
import { browser, raiseNotice, type CommentNoticeKind } from '../store';
import { COMMENT_COPY } from './copy';
import { dockOf } from './dock';
import { setCommentArmed } from './store';

const warn = (text: string) => void toast({ level: 'warning', text, actions: [], dismissible: true });

// The session whose chrome shows the tab, from this window's mirror of main's tabs. A tab it does not list has no
// chrome in this window to speak in, so nothing is said here.
function sessionOf(tabId: string): AppSessionId | null {
  for (const [appSessionId, { tabs }] of browser.getState().sessions) if (tabs.some((tab) => tab.tabId === tabId)) return appSessionId;
  return null;
}

function sayInChrome(tabId: string, kind: CommentNoticeKind): void {
  const appSessionId = sessionOf(tabId);
  if (appSessionId !== null) raiseNotice({ appSessionId, tabId, kind });
}

export function connectBrowserComment(client: MawsBridge = ipc): () => void {
  const offChanged = client.on('browser.comment.changed', ({ tabId, on, reason }) => {
    setCommentArmed(tabId, on);
    if (reason === 'refused') sayInChrome(tabId, 'commentCannotName');
    else if (reason === 'unavailable') sayInChrome(tabId, 'commentUnavailable'); // no preload answered (Decision Log 34)
  });
  const offPicked = client.on('browser.comment.picked', ({ tabId, appSessionId, anchor, crop, position }) => {
    const hostId = dockOf(tabId);
    if (hostId === null) {
      openCommentComposer(anchor, { appSessionId });
      if (crop === 'tooLarge') warn(COMMENT_COPY.cropTooLarge);
      else if (crop === 'failed') warn(COMMENT_COPY.cropFailed);
      return;
    }
    // the pin: the element's point in the pane's pixels, as a rect of no size (the card's pin is its x and its bottom)
    const rect = position && { x: position.x, y: position.y, width: 0, height: 0 };
    openCommentComposer(anchor, { appSessionId, placement: { kind: 'card', host: 'browser', hostId, ...(rect && { rect }) } });
    if (crop === 'tooLarge') sayInChrome(tabId, 'commentCropTooLarge');
    else if (crop === 'failed') sayInChrome(tabId, 'commentCropFailed');
  });
  return () => {
    offChanged();
    offPicked();
  };
}
