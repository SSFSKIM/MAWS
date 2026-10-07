// E4a: one session's browser as a surface shows it (Design §4; Decision Log 17): the chrome over the pane, mounted by the
// Browser tool (the session's selected tab) and by a `browser` main tab (its own tab) alike. The session is listed afresh
// on mount (Decision Log 44 (a)). A main tab whose tab main no longer knows shows the session's browser with no tab,
// headed "That tab was closed" (Decision Log 21; X14's restore rule).
import { useEffect } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { Chrome } from './chrome/Chrome';
import { BrowserPane } from './Pane';
import { listSession, sessionTabs, useBrowser } from './store';

export interface BrowserViewProps {
  appSessionId: AppSessionId;
  surface: 'panel' | 'main';
  browserTabId?: string; // a main tab's own tab; absent, the session's selected tab (the panel)
}

export function BrowserView({ appSessionId, surface, browserTabId }: BrowserViewProps) {
  useEffect(() => listSession(appSessionId), [appSessionId]);
  const { tabs, selected } = useBrowser((s) => sessionTabs(s, appSessionId));
  const known = useBrowser((s) => s.ready || s.sessions.has(appSessionId));
  const shownId = browserTabId ?? selected;
  const tab = tabs.find((candidate) => candidate.tabId === shownId) ?? null;
  const gone = browserTabId !== undefined && known && tab === null;
  return (
    <div data-browser-view={surface} className="flex h-full min-h-0 flex-col bg-bg">
      <Chrome appSessionId={appSessionId} surface={surface} tab={tab} tabs={tabs} />
      <div className="min-h-0 flex-1">
        <BrowserPane tab={tab} surface={surface} gone={gone} />
      </div>
    </div>
  );
}
