// E4a: one session's browser as a surface shows it (Design §4; Decision Log 17): the chrome over the pane, mounted by the
// Browser tool (the session's selected tab) and by a `browser` main tab (its own tab) alike. The session is listed afresh
// on mount (Decision Log 44 (a)). A main tab whose tab main no longer knows shows the session's browser with no tab,
// headed "That tab was closed" (Decision Log 21; X14's restore rule). P5 O7 M3: in the panel, a forwarded link whose
// forward was refused shows that in place of the pane while the session's selected tab is the one it was over (the pane's
// unmount gives the page's view back, so the page drawn here is not under it). P5 O5 M5: under the chrome, why the
// session's agent has no browser on its machine, while it has none (agent/capability.tsx). P5 O17 M10: in the panel, a
// session on another machine shows the agent's tabs there too (remote/View.tsx; docs/doperpowers/plans/2026-11-01-p5-o17-
// browser.md, M10): their group follows the person's own tabs in the strip, and an agent tab shown is its live picture in
// place of the pane. The view is open while the panel shows the tool, so a hidden or collapsed tool closes its feed and
// B's tab goes on. The agent's browser is shown when the person picks one of its tabs, or of itself while the person has
// no tab of their own shown; a chip of the person's shows theirs again, as does a new tab of theirs selected (a forwarded
// link opened, the agent's show_pane), whichever was shown. The capability's notice gives way to the view's
// own states, which carry the machine's reason, except for an older MAWS there, whose capabilities are all it tells.
// U12a (Interfaces §D): the room a device size has to fit is this mount's, told by its pane while the pane holds the view
// (beside `owns`) and handed to its chrome; a second mount of the tab at another size has its own.
import { useEffect, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { isAddress, machineOf } from '@shared/machine/address';
import { ipc } from '../../ipc/client';
import { AgentBrowserNotice } from './agent/capability'; // P5 O5 M5
import { Chrome } from './chrome/Chrome';
import { useForwards } from './forward';
import { ForwardFailedPage } from './pages/ForwardFailed';
import { BrowserPane } from './Pane';
import { listSession, sessionTabs, useBrowser } from './store';
import type { Room } from './viewport'; // U12a
import { TabStrip } from './chrome/TabStrip'; // P5 O17 M10
import { AgentGroup, RemoteCanvas, RemoteNav, useMachineName, useRemoteBrowser } from './remote/View'; // P5 O17 M10

const isAddressElsewhere = (appSessionId: AppSessionId): boolean => isAddress(appSessionId) && machineOf(appSessionId) !== ipc.localMachine;

export interface BrowserViewProps {
  appSessionId: AppSessionId;
  surface: 'panel' | 'main';
  browserTabId?: string; // a main tab's own tab; absent, the session's selected tab (the panel)
  visible?: boolean; // P5 O17 M10: the panel is open (a collapsed one keeps its tool mounted)
}

export function BrowserView({ appSessionId, surface, browserTabId, visible = true }: BrowserViewProps) {
  useEffect(() => listSession(appSessionId), [appSessionId]);
  const { tabs, selected } = useBrowser((s) => sessionTabs(s, appSessionId));
  // P5 O7 M3: the app-wide list is this Mac's sessions only; another machine's session is known once its own list is in
  const known = useBrowser((s) => s.sessions.has(appSessionId) || (s.ready && !isAddressElsewhere(appSessionId)));
  const shownId = browserTabId ?? selected;
  const tab = tabs.find((candidate) => candidate.tabId === shownId) ?? null;
  const gone = browserTabId !== undefined && known && tab === null;
  const [owns, setOwns] = useState(false); // the pane holds the page's view
  const [room, setRoom] = useState<Room | null>(null); // U12a: its page box's size, while it holds the view
  const refused = useForwards((s) => (surface === 'panel' ? (s.failures.get(appSessionId) ?? null) : null));
  const failure = refused !== null && refused.selected === selected ? refused : null;
  // P5 O17 M10: the agent's tabs on the session's machine
  const elsewhere = surface === 'panel' && isAddressElsewhere(appSessionId);
  const remote = useRemoteBrowser(appSessionId, elsewhere && visible);
  const client = remote?.client ?? null;
  const machine = useMachineName(appSessionId);
  const [choice, setChoice] = useState<boolean | null>(null); // the person's: the agent's browser, their own tabs, or not chosen yet
  const [seenSelected, setSeenSelected] = useState(selected);
  if (selected !== seenSelected) {
    setSeenSelected(selected);
    if (selected !== null) setChoice(false); // a tab of the person's newly selected is theirs to see
  }
  const agentHasTabs = remote !== null && remote.state.view.kind === 'live' && remote.state.inventory?.state === 'ready' && remote.state.inventory.tabs.length > 0;
  // not chosen yet: shown once the agent has a tab and the person shows none of theirs, and kept through the view's states
  const wantsAgent = choice ?? (remote?.state.showing === true || (selected === null && agentHasTabs));
  useEffect(() => {
    if (wantsAgent) client?.showAgent();
    else client?.hide();
  }, [client, wantsAgent]);
  const shownRemote = remote !== null && wantsAgent && remote.state.showing ? remote : null; // the agent's tab is what shows
  const onLocal = () => setChoice(false);
  const agent = remote && (
    <AgentGroup
      remote={remote}
      machine={machine}
      onShow={(tabId) => {
        setChoice(true);
        remote.client.show(tabId);
      }}
    />
  );
  return (
    <div data-browser-view={surface} className="@container flex h-full min-h-0 flex-col bg-bg">
      {shownRemote ? (
        <div data-browser-chrome="" className="relative z-10 flex shrink-0 flex-col border-b border-border bg-bg-raised">
          <TabStrip appSessionId={appSessionId} surface={surface} tabs={tabs} shownId={null} agent={agent} onLocal={onLocal} />
          <RemoteNav remote={shownRemote} machine={machine} />
        </div>
      ) : (
        <Chrome appSessionId={appSessionId} surface={surface} tab={tab} tabs={tabs} owns={owns} room={room} agent={agent ?? undefined} onLocal={elsewhere ? onLocal : undefined} />
      )}
      {(!elsewhere || remote?.state.view.kind === 'unsupported') && <AgentBrowserNotice appSessionId={appSessionId} />}
      <div className="min-h-0 flex-1">
        {shownRemote ? (
          <RemoteCanvas remote={shownRemote} machine={machine} />
        ) : failure ? (
          <div className="relative h-full w-full overflow-hidden bg-bg">
            <ForwardFailedPage appSessionId={appSessionId} failure={failure} />
          </div>
        ) : (
          <BrowserPane tab={tab} surface={surface} gone={gone} onOwns={setOwns} onRoom={setRoom} />
        )}
      </div>
    </div>
  );
}
