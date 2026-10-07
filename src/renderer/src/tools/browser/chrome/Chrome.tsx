// E4a (Task 3.3): the chrome (E4a execution document, Design §4; Decision Log 17 and 48), above the pane in both
// surfaces: the tab strip, the navigation row, then the zoom banner while the page is not at 100%, the find bar while it
// is open, and the notice lines. Every row sits on whole px, so the pane under it starts on an integral edge.
//
// Main's `browser.chrome.command` (⌘L, ⌘F, and Esc pressed inside a page) goes to the chrome whose pane holds the page's
// view (`owns`), for the tab it names: `focusAddress` focuses the address field, `openFind` opens the find bar (or takes
// the keyboard back to it), `closeFind` closes it (main already stopped finding).
import { useEffect, useRef, useState } from 'react';
import type { BrowserTab } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { onChromeCommand } from '../store';
import { FindBar } from './FindBar';
import { NavRow } from './NavRow';
import { Notices } from './Notices';
import { TabStrip } from './TabStrip';
import { ZoomBanner } from './ZoomBanner';

export interface ChromeProps {
  appSessionId: AppSessionId;
  surface: 'panel' | 'main';
  tab: BrowserTab | null; // the tab the pane shows; null for the empty state
  tabs: BrowserTab[]; // the session's tabs, in main's order
  owns?: boolean; // this surface's pane holds the page's view, so main's chrome commands are this chrome's
}

type Finding = { tabId: string; focus: number };

// The find bar opened for a tab, or asked for again while open (its input takes the keyboard back).
const findOpened = (tabId: string) => (open: Finding | null) => ({ tabId, focus: (open?.tabId === tabId ? open.focus : 0) + 1 });

export function Chrome({ appSessionId, surface, tab, tabs, owns = false }: ChromeProps) {
  const addressRef = useRef<HTMLInputElement>(null);
  const [finding, setFinding] = useState<Finding | null>(null); // the open find bar
  const tabId = tab?.tabId ?? null;
  if (finding !== null && finding.tabId !== tabId) setFinding(null); // another tab shown: its bar is closed

  const openFind = () => {
    if (tabId !== null) setFinding(findOpened(tabId));
  };

  useEffect(() => {
    if (!owns || tabId === null) return;
    return onChromeCommand((command) => {
      if (command.tabId !== tabId) return;
      if (command.command === 'focusAddress') addressRef.current?.focus();
      else if (command.command === 'openFind') setFinding(findOpened(tabId));
      else setFinding(null);
    });
  }, [owns, tabId]);

  return (
    <div data-browser-chrome="" className="relative z-10 flex shrink-0 flex-col border-b border-border bg-bg-raised">
      <TabStrip appSessionId={appSessionId} surface={surface} tabs={tabs} shownId={tabId} />
      <NavRow appSessionId={appSessionId} surface={surface} tab={tab} addressRef={addressRef} owns={owns} onFind={openFind} />
      {tab && tab.zoom !== 1 && <ZoomBanner tab={tab} />}
      {tab && finding !== null && <FindBar tab={tab} focusRequest={finding.focus} onClose={() => setFinding(null)} />}
      <Notices appSessionId={appSessionId} tab={tab} />
    </div>
  );
}
