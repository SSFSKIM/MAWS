// E4a: one session's browser as a surface shows it (Design §4; Decision Log 17): the chrome over the pane, mounted by the
// Browser tool (the session's selected tab) and by a `browser` main tab (its own tab) alike. The session is listed afresh
// on mount (Decision Log 44 (a)). A main tab whose tab main no longer knows shows the session's browser with no tab,
// headed "That tab was closed" (Decision Log 21; X14's restore rule). P5 O7 M3: in the panel, a forwarded link whose
// forward was refused shows that in place of the pane while the session's selected tab is the one it was over (the pane's
// unmount gives the page's view back, so the page drawn here is not under it).
import { useEffect, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { isAddress, machineOf } from '@shared/machine/address';
import { ipc } from '../../ipc/client';
import { Chrome } from './chrome/Chrome';
import { useForwards } from './forward';
import { ForwardFailedPage } from './pages/ForwardFailed';
import { BrowserPane } from './Pane';
import { listSession, sessionTabs, useBrowser } from './store';

const isAddressElsewhere = (appSessionId: AppSessionId): boolean => isAddress(appSessionId) && machineOf(appSessionId) !== ipc.localMachine;

export interface BrowserViewProps {
  appSessionId: AppSessionId;
  surface: 'panel' | 'main';
  browserTabId?: string; // a main tab's own tab; absent, the session's selected tab (the panel)
}

export function BrowserView({ appSessionId, surface, browserTabId }: BrowserViewProps) {
  useEffect(() => listSession(appSessionId), [appSessionId]);
  const { tabs, selected } = useBrowser((s) => sessionTabs(s, appSessionId));
  // P5 O7 M3: the app-wide list is this Mac's sessions only; another machine's session is known once its own list is in
  const known = useBrowser((s) => s.sessions.has(appSessionId) || (s.ready && !isAddressElsewhere(appSessionId)));
  const shownId = browserTabId ?? selected;
  const tab = tabs.find((candidate) => candidate.tabId === shownId) ?? null;
  const gone = browserTabId !== undefined && known && tab === null;
  const [owns, setOwns] = useState(false); // the pane holds the page's view
  const refused = useForwards((s) => (surface === 'panel' ? (s.failures.get(appSessionId) ?? null) : null));
  const failure = refused !== null && refused.selected === selected ? refused : null;
  return (
    <div data-browser-view={surface} className="flex h-full min-h-0 flex-col bg-bg">
      <Chrome appSessionId={appSessionId} surface={surface} tab={tab} tabs={tabs} owns={owns} />
      <div className="min-h-0 flex-1">
        {failure ? (
          <div className="relative h-full w-full overflow-hidden bg-bg">
            <ForwardFailedPage appSessionId={appSessionId} failure={failure} />
          </div>
        ) : (
          <BrowserPane tab={tab} surface={surface} gone={gone} onOwns={setOwns} />
        )}
      </div>
    </div>
  );
}
