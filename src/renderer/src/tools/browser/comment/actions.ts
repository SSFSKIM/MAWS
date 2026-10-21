// E4d (Task 3.3): a page anchor opens its page (E4d execution document, Design §10; Decision Log 15). The transcript's
// chip on a `browser-element` comment and a side thread's header open the anchor's `pageUrl` in the in-app browser,
// the surface E3 deferred to E4: the Browser tool is added with the URL as its target, and the tool itself opens it
// through `browser.tabs.open` with `reuse: 'url'`, so a second click selects the tab the first one opened.
//
// Which browser: a side thread's page opens in its parent's, where the commented tab lives (a thread is the parent
// conversation's branch, Design §12), never in a fresh tab of the thread's own session. The panel rule holds: nothing
// switches the main view; the tool is activated only when its session is the one shown, and otherwise waits in that
// session's panel with a line saying where (a toast, or a browser chrome's line while a browser is on screen).
import { validateBrowserUrl } from '@shared/browser/url';
import type { AppSessionId } from '@shared/graph/ids';
import { panelHost, shownSession } from '../../../panel/host';
import { titleOf } from '../../../sessions/record-ops';
import { toast } from '../../../stores/notices';
import { useSessions } from '../../../stores/sessions';
import { browserTool, type BrowserParams } from '../BrowserTool';
import { sessionsOnScreen } from '../covering';
import { raiseNotice } from '../store';
import { COMMENT_COPY } from './copy';

// The session whose browser holds a session's pages: a side thread's parent, else the session itself.
export function browserSessionOf(appSessionId: AppSessionId): AppSessionId {
  const lineage = useSessions.getState().records.get(appSessionId)?.lineage;
  return lineage?.kind === 'side-thread' ? lineage.parentAppSessionId : appSessionId;
}

export function openBrowserUrl(appSessionId: AppSessionId, url: string): void {
  const checked = validateBrowserUrl(url);
  if (!checked.ok) {
    say('commentCannotOpen', url, { level: 'warning', text: COMMENT_COPY.cannotOpen(url) });
    return;
  }
  const session = browserSessionOf(appSessionId);
  const shown = shownSession() === session;
  panelHost.addTool<BrowserParams>(browserTool.id, { appSessionId: session, params: { target: checked.url, appSessionId: session }, activate: shown });
  if (!shown) say('commentOpenedElsewhere', titleOf(session), { level: 'info', text: COMMENT_COPY.openedElsewhere(titleOf(session)) });
}

// P4 W2-C (tracker 2026-10-07; E4a Decision Log 28, A-47): an app toast over a browser pane on screen freezes the pane to
// its placeholder for the toast's life, so while a pane is on screen the line goes into a browser's chrome: the shown
// session's when its browser is on screen, else the first on screen. A toast only when none is.
function say(kind: 'commentCannotOpen' | 'commentOpenedElsewhere', name: string, fallback: { level: 'warning' | 'info'; text: string }): void {
  const onScreen = sessionsOnScreen();
  const shown = shownSession();
  const chrome = shown !== null && onScreen.includes(shown) ? shown : onScreen[0];
  if (chrome !== undefined) raiseNotice({ appSessionId: chrome, tabId: null, kind, name });
  else toast({ ...fallback, actions: [], dismissible: true });
}
