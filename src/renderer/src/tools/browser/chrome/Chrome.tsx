// E4a (Task 3.3): the chrome (E4a execution document, Design §4; Decision Log 17 and 48), above the pane in both
// surfaces: the tab strip, the navigation row, then the zoom banner while the page is not at 100%, the find bar while it
// is open, and the notice lines. Every row sits on whole px, so the pane under it starts on an integral edge.
//
// Main's `browser.chrome.command` (⌘L, ⌘F, and Esc pressed inside a page) goes to the chrome whose pane holds the page's
// view (`owns`), for the tab it names: `focusAddress` focuses the address field, `openFind` opens the find bar (or takes
// the keyboard back to it), `closeFind` closes it (main already stopped finding). cua #90: an extensions menu's choice
// made in main (`browser.extensions.reveal`) goes to every chrome showing the tab: the options tab main opened is shown
// (a main tab moves to it; the panel shows the session's selected tab already), and Manage extensions… opens Settings ›
// Browser. An options tab main replaced with a page is the store's (`connectBrowser` retargets its main tab in place).
//
// P3-G (M2, the coordinator's ruling): in the panel, while the pane holds the page, the tab row's right end hosts the
// floating card's pill when the card is closed (the page is a native view: a pill over it could not be seen).
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { DEFAULT_PARTITION, type BrowserTab } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { ChromePill } from '../../../shell/FloatingPill';
import { useLayout } from '../../../stores/layout';
import { openMainTab } from '../actions';
import { useBrowserImport } from '../import/store';
import { toggleBookmarksBar } from '../settings';
import { onChromeCommand, onExtensionReveal, tabOpened } from '../store';
import { BookmarksBar } from './BookmarksBar';
import { canShowBar } from './bookmarks-bar';
import { ControlSlot } from './ControlSlot';
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
  const partition = tab?.partition ?? DEFAULT_PARTITION;
  const barCapable = useBrowserImport((s) => canShowBar(s.records, partition)); // cua #90: ⌘⇧B is the bar's here
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
      else if (command.command === 'toggleBookmarksBar') {
        if (barCapable) void toggleBookmarksBar(); // cua #90
      }
      else setFinding(null);
    });
  }, [owns, tabId, barCapable]);

  // cua #90: what an extensions menu chose, or the options tab main replaced, for this chrome's tab: every chrome showing
  // the tab follows (a main tab and the panel may both show it while only one pane holds its view)
  useEffect(() => {
    if (tabId === null) return;
    return onExtensionReveal(({ tabId: from, show }) => {
      if (from !== tabId) return;
      if (show.kind === 'settings') return useLayout.getState().openTab({ kind: 'settings', section: 'browser' });
      if (show.kind !== 'tab') return; // a replacement never reaches here (`connectBrowser`)
      tabOpened(show.tab);
      if (surface === 'main') openMainTab(appSessionId, show.tab.tabId);
    });
  }, [tabId, surface, appSessionId]);

  // cua #90: ⌘⇧B with the chrome focused (inside the page, keys.ts takes it)
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!barCapable || !event.metaKey || !event.shiftKey || event.altKey || event.ctrlKey || event.key.toLowerCase() !== 'b') return;
    event.preventDefault();
    void toggleBookmarksBar();
  };

  return (
    <div data-browser-chrome="" onKeyDown={onKeyDown} className="relative z-10 flex shrink-0 flex-col border-b border-border bg-bg-raised">
      <TabStrip appSessionId={appSessionId} surface={surface} tabs={tabs} shownId={tabId} trailing={surface === 'panel' && owns ? <ChromePill /> : null} />
      <NavRow appSessionId={appSessionId} surface={surface} tab={tab} addressRef={addressRef} owns={owns} onFind={openFind} />
      {tab?.control === 'human' && <ControlSlot tab={tab} />}
      {tab && tab.partition !== DEFAULT_PARTITION && <BookmarksBar tab={tab} /> /* cua #90 */}
      {tab && tab.zoom !== 1 && <ZoomBanner tab={tab} owns={owns} />}
      {tab && finding !== null && <FindBar tab={tab} focusRequest={finding.focus} onClose={() => setFinding(null)} />}
      <Notices appSessionId={appSessionId} tab={tab} />
    </div>
  );
}
