// The toolbar, which is also the window's title bar (`titleBarStyle: 'hiddenInset'`, §3; mockup 01): a drag region
// with the traffic lights' 78 px clearance and sidebar/Overview toggles across the sidebar's width,
// the project chip and the focused pane's active tab as the title (with the branch chip on a session), the session
// actions menu and the panel toggle, then, at the title bar's own right end, the usage slot (UX wave U7b, O-47: the ring,
// after the surface icons and outside their overflow; on a page too, where it stands at the window's right edge).
// Every control is `no-drag`, so clicks reach it rather than moving the window.
// UX wave U7b (docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md, M5 decision 5): while a
// page is open the title bar spans to the window's right edge and holds, after the sidebar and Overview buttons, Back and
// the page's name (the page's level-1 heading) where the chip and the strip were. The chip, the surface icons and the
// session menu are not drawn; the two slots the strips mount in stay mounted, invisible and inert, so a strip keeps its
// scroll and its "+" is not drawn either.
import { preserveSubmenuPointer } from '@artifacts/ui/menu-pointer';
import { type ReactNode } from 'react';
import { DropdownMenu } from 'radix-ui';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { Destination, TabRef } from '@shared/ipc/schema/layout';
import { runAction, useCurrentRow } from '../keymap/actions-runtime';
import { revealRow, sidebarListsRow } from '../sidebar/reveal';
import { selectNeedsYou, useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { activeTab, currentSet } from '../stores/layout-model';
import { branchLabel } from '../sessions/branch-label';
import { workingBranch } from '@shared/sessions/working-folder'; // UX wave U8c-2
import { useSessions, type ListedSession } from '../stores/sessions';
import { machineName, rowName, selectOrgIndex } from '../stores/org-projects'; // P5 O6 M5
import { useMachines } from '../stores/machines';
import { ipc } from '../ipc/client';
import { FolderIcon, Icon, IconButton, SidebarIcon } from './IconButton';
import { DESTINATION } from '../destination/copy';
import { PAGE_TITLE_ID } from '../destination/DestinationPage';
import { useShellGeometry, useShellView } from './shell-view';
import { useSlot } from './slots';
import { mountChromeTabs } from '../main/chrome-tabs';
import { SurfaceRow } from '../panel/SurfaceRow';
import { runSessionAction, SESSION_ACTIONS, sessionActionsFor, useSessionActionEnabled, type SessionActionId } from './session-actions';
import { useLaneAState } from '../stores/lane-a'; // P5 O9 M5
import { useRemoteLaneA } from '../lane-a/remote-session'; // P5 O9 M9
import { useSessionControls } from '../session/controls/controls-for'; // P5 O9 M9
import { isRemoteLaneB } from '../lane-b/remote-session'; // P5 O7 M2
import { useReaderRowsOf } from '../lane-b/reader-rows'; // P5 O8 M6a
import { useSessionActionUnavailable } from '../lane-b/remote-unavailable'; // the UX wave, U9
import { openAddOwner, openShare, useCanAddOwner, useCanShare } from '../sessions/share/target'; // P5 O8 M6b, M5b
import { OWNER, SHARE } from '../sessions/share/copy'; // P5 O8 M6b, M5b
import { displayTitle } from '../sessions/title';
// P3-L start
import { LIBRARY_COPY } from '../library/copy';
// P3-L end
// E4a start
import { BROWSER_COPY } from '../tools/browser/copy';
// E4a end
import { CHANNEL } from '../channel/copy'; // P5 O8 M7a

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

// E4a: `browserTitle` is a `browser` tab's page title (else host), when the browser store lists the tab. (E2's
// `deliverable` tab and its title left with P3-L's cutover, M6b.)
export function toolbarTitle(
  tab: TabRef | null,
  records: ReadonlyMap<AppSessionId, SessionRecord>,
  browserTitle: string | null = null, // E4a
  artifactTitle: string | null = null, // P3-L: an `artifact` tab's row title, when the library store holds it
  listed: ReadonlyMap<AppSessionId, ListedSession> = new Map(), // P5 O9 M9: another machine's session, titled by its row
  channelProject: string | null = null, // P5 O8 M7a: a `channel` tab's org project's name, when the sidebar's index holds it
): { title: string; branch: string | null } {
  switch (tab?.kind) {
    case undefined:
      return { title: '', branch: null }; // an empty main area (W5: the Overview is no tab)
    case 'session':
    case 'agent': {
      const record = records.get(tab.appSessionId);
      const row = record ? undefined : listed.get(tab.appSessionId)?.title.trim(); // P5 O9 M9: a session of another machine has its row alone
      const title = row || displayTitle(record); // no record yet (an unstarted session) or no title yet: "New chat"
      return { title: tab.kind === 'agent' ? `${title} · agent` : title, branch: branchLabel(record ? workingBranch(record) : null) }; // W9 (H2); UX wave U8c-2: the working folder's
    }
    case 'file':
      return { title: basename(tab.path), branch: null };
    case 'diff':
      return { title: `Diff · ${tab.ref}`, branch: null };
    case 'diagnostics':
      return { title: 'Diagnostics', branch: null };
    case 'artifact': // P3-L
      return { title: artifactTitle ?? LIBRARY_COPY.fallbackTitle, branch: null };
    case 'browser': // E4a
      return { title: browserTitle ?? BROWSER_COPY.title, branch: null };
    case 'channel': // P5 O8 M7a: "<project> · channel"
      return { title: CHANNEL.title(channelProject), branch: null };
  }
}

// The room the usage ring takes from the surface icons' count: its 28 px button (UX wave U7b, M7 decision 1).
const USAGE_RING_ROOM = 28;

export function Toolbar() {
  const sidebar = useLayout((s) => s.regions.sidebar);
  const geometry = useShellGeometry();
  const overlay = useShellView((s) => s.sidebarOverlay);
  const tab = useLayout((s) => activeTab(s.main));
  const records = useSessions((s) => s.records);
  const recordsVersion = useSessions((s) => s.recordsVersion);
  const listed = useSessions((s) => s.listed); // P5 O7 M6: another machine's listed rows count
  const waiting = useAttention((s) => selectNeedsYou(s, { records, recordsVersion, listed }).filter((row) => row.tier === 1).length);
  const overviewOpen = useLayout((s) => s.overviewOpen);
  const destination = useLayout((s) => s.destination); // UX wave U7b
  const appSessionId = tab?.kind === 'session' ? tab.appSessionId : null;
  const split = useLayout((s) => currentSet(s.main).panes.length === 2);
  // Budget against the grid's actual header, not the window: a full-height surface can leave only 360px.
  // Preserve a usable, scrolling strip (including New chat) before allocating optional chrome controls.
  const leading = geometry.sidebar || 150;
  const stripRoom = split ? 240 : 180;
  const projectChip = geometry.chrome >= leading + stripRoom + 322;
  const controlsRoom = geometry.chrome - leading - 16 - stripRoom - (projectChip ? 96 : 0);
  const surfaceIcons = Math.max(0, Math.floor((controlsRoom - 28 - USAGE_RING_ROOM) / 30));
  const Usage = useSlot('topBarEnd');

  return (
    <header data-toolbar className={`${geometry.mainHidden || destination !== null ? 'col-span-3' : 'col-span-2'} row-start-1 flex h-(--toolbar-h) min-w-0 items-center border-b border-border bg-bg select-none [-webkit-app-region:drag]`}>
      <div
        className="flex h-full shrink-0 items-center justify-end gap-2 pr-3 pl-[78px]"
        style={{ width: leading }}
      >
        <div className="flex items-center gap-1">
          <IconButton label="Toggle sidebar" action="sidebar.toggle" pressed={geometry.sidebarAside ? overlay : !sidebar.collapsed} onClick={() => runAction('sidebar.toggle')}>
            <SidebarIcon />
          </IconButton>
          <IconButton
            label={waiting > 0 ? `Overview, ${waiting} waiting` : 'Overview'}
            action="tab.overview"
            pressed={overviewOpen}
            onClick={() => useLayout.getState().setOverviewOpen(!overviewOpen)}
            className="relative"
          >
            <BoardIcon />
            {waiting > 0 && (
              <span aria-hidden className="absolute -right-1 -bottom-1 rounded-sm bg-bg-raised px-0.5 text-ui-sm leading-none text-warning tabular-nums">
                ◐{waiting}
              </span>
            )}
          </IconButton>
        </div>
      </div>
      {/* UX wave U7, O-03: the wrapper owns the chip's 96 px and clips; the button fills it and truncates, its focus ring inset */}
      {destination !== null && <PageTitle destination={destination} />}
      {projectChip && destination === null && <div className="max-w-24 min-w-0 shrink overflow-hidden"><ProjectChip /></div>}
      <div ref={mountChromeTabs} data-chrome-tabs inert={destination !== null} className={`flex h-full min-w-0 flex-1 items-stretch ${destination !== null ? 'invisible' : ''}`}>
        <div data-chrome-slot="0" className="contents" />
        <div data-chrome-slot="1" className="contents" />
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1 px-2">
        {destination === null && <SurfaceRow maxIcons={surfaceIcons} overflowControls={<>
          {appSessionId && <SessionMenuOverflow appSessionId={appSessionId} />}
        </>} />}
        {/* eslint-disable-next-line react-hooks/static-components -- the usage slot is registered once at composition */}
        <Usage />
      </div>
    </header>
  );
}

// P3-F wave S (F17, the owner's obs 8; W12's label, which named the set at the strip's left edge until the owner moved it
// out of the crowded strip), left of the title. UX wave U13a (O-31): it names the current project's row (`useCurrentRow`:
// the row of the session in front), a project's or a machine's own, and none with no session in front or for a chat with
// no project. A click, Enter or Space reveals that row in the sidebar (`revealRow`, a hidden project's restored first);
// it creates nothing, and has no menu.
export const PROJECT_CHIP_COPY = {
  reveal: (name: string) => `Reveal ${name} in sidebar`,
  show: (name: string) => `Show ${name} in sidebar`, // a row the sidebar does not list: restored first
} as const;

function ProjectChip() {
  const current = useCurrentRow(); // U13a: the current project's row
  const local = ipc.localMachine;
  const index = useSessions((s) => selectOrgIndex(s, local));
  const machines = useMachines((s) => s.machines);
  const name = current === null ? null : rowName(index, current, (m) => machineName(machines, m, local));
  if (current === null || name === null) return null;
  const label = sidebarListsRow(index, current) ? PROJECT_CHIP_COPY.reveal(name) : PROJECT_CHIP_COPY.show(name);
  return (
    <button
      type="button"
      data-toolbar-project={current}
      aria-label={label}
      title={label}
      onClick={() => revealRow(current)}
      className="flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-sm px-1.5 text-ui-sm text-fg-muted outline-accent [-webkit-app-region:no-drag] hover:bg-bg-hover hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2"
    >
      <FolderIcon className="size-[12px] shrink-0" />
      <span className="truncate">{name}</span>
    </button>
  );
}

// UX wave U7b: Back and the page's name; Back leaves the page (U6b's history takes it over when it lands).
function PageTitle({ destination }: { destination: Destination }) {
  return (
    <div data-page-title className="flex min-w-0 shrink items-center gap-1 pr-2">
      <button
        type="button"
        aria-label={DESTINATION.back}
        title={DESTINATION.backTitle}
        onClick={() => useLayout.getState().closeDestination()}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent [-webkit-app-region:no-drag] hover:bg-bg-hover hover:text-fg focus-visible:outline-2"
      >
        <Icon><path d="M10 3.5 5.5 8l4.5 4.5" /></Icon>
      </button>
      <h1 id={PAGE_TITLE_ID} className="m-0 min-w-0 truncate text-ui font-semibold text-fg">{DESTINATION.names[destination.kind]}</h1>
    </div>
  );
}

const BoardIcon = () => (
  <Icon>
    <rect x="2" y="2.5" width="5" height="5" rx="1" />
    <rect x="9" y="2.5" width="5" height="5" rx="1" />
    <rect x="2" y="9.5" width="5" height="4" rx="1" />
    <rect x="9" y="9.5" width="5" height="4" rx="1" />
  </Icon>
);

// §5.1's session actions for the session on screen, as its sidebar menus offer them (`sessionActionsFor`: a
// foreign-live session has none here); "Open" and "Open in new tab" are left out because it is the open tab. A session
// with no record (an unstarted one) offers nothing yet, and with nothing to offer the menu is disabled. P5 O9 M9:
// another machine's terminal session (a listed lane A row, no record here) offers Take over, disabled in place with the
// reason its controls port gives (Q2: a gap is shown where the control would be). P5 O8 M6b: and Share, for a session you
// own, listed or a record. P5 O8 M5b: and Add owner after it, for the session's owners (`useCanAddOwner`).
function SessionMenuOverflow({ appSessionId }: { appSessionId: AppSessionId }) {
  const record = useSessions((s) => s.records.get(appSessionId));
  const bridged = useLaneAState(appSessionId)?.bridge === 'live'; // P5 O9 M5: Take over and Fork for a bridged terminal session
  const remote = useRemoteLaneA(appSessionId) && !record;
  const controls = useSessionControls(appSessionId);
  const remoteReading = useReaderRowsOf(appSessionId) !== 'refused'; // P5 O8 M6a
  const shareable = useCanShare(appSessionId); // P5 O8 M6b
  const ownable = useCanAddOwner(appSessionId); // P5 O8 M5b
  const mine = useSessions((s) => s.listed.get(appSessionId)?.mine ?? false); // the UX wave, U9: the listing's
  if (remote) {
    const takeOver = controls?.capability('take-over') ?? null;
    return <SessionMenu disabled={false}>
      <SessionMenuItem id="takeOver" appSessionId={appSessionId} label={SESSION_ACTIONS.takeOver} gap={takeOver === null || takeOver.available ? null : takeOver.reason} />
      {shareable && <ShareMenuItem appSessionId={appSessionId} />}
      {ownable && <AddOwnerMenuItem appSessionId={appSessionId} />}
    </SessionMenu>;
  }
  const ids = record ? sessionActionsFor(record, { bridged, remote: isRemoteLaneB(record.appId) /* P5 O7 M2 */, remoteReading, mine }).filter((id) => id !== 'open' && id !== 'openInNewTab') : [];
  return <SessionMenu disabled={ids.length === 0 && !shareable}>
    {record && ids.map((id) => <SessionMenuItem key={id} id={id} appSessionId={record.appId} label={id === 'pin' && record.pinned ? 'Unpin' : SESSION_ACTIONS[id]} />)}
    {shareable && <ShareMenuItem appSessionId={appSessionId} />}
    {ownable && <AddOwnerMenuItem appSessionId={appSessionId} />}
  </SessionMenu>;
}

// P5 O8 M6b: the session's Share sheet, for a session you own (sessions/share/target.ts)
function ShareMenuItem({ appSessionId }: { appSessionId: AppSessionId }) {
  return (
    <DropdownMenu.Item onSelect={() => openShare(appSessionId)} className="flex h-7 cursor-default items-center rounded-sm px-2 outline-none select-none data-highlighted:bg-bg-hover">
      {SHARE.menuItem}
    </DropdownMenu.Item>
  );
}

// P5 O8 M5b: the session's Add owner sheet, for its owners (sessions/share/target.ts)
function AddOwnerMenuItem({ appSessionId }: { appSessionId: AppSessionId }) {
  return (
    <DropdownMenu.Item onSelect={() => openAddOwner(appSessionId)} className="flex h-7 cursor-default items-center rounded-sm px-2 outline-none select-none data-highlighted:bg-bg-hover">
      {OWNER.menuItem}
    </DropdownMenu.Item>
  );
}

function SessionMenu({ disabled, children }: { disabled: boolean; children: ReactNode }) {
  return <DropdownMenu.Sub>
    <DropdownMenu.SubTrigger onPointerLeave={preserveSubmenuPointer} disabled={disabled} className="flex h-8 items-center rounded-sm px-2 text-ui outline-none data-disabled:text-fg-faint data-highlighted:bg-bg-hover">Session actions</DropdownMenu.SubTrigger>
    <DropdownMenu.Portal><DropdownMenu.SubContent className="z-50 min-w-48 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg">
      {children}
    </DropdownMenu.SubContent></DropdownMenu.Portal>
  </DropdownMenu.Sub>;
}

// `gap`: why the session can't take the action at all (P5 O9 M9), shown in place of the unregistered words; the UX wave,
// U9: else the window's helper's sentence for an act on another machine.
function SessionMenuItem({ id, appSessionId, label, gap: given = null }: { id: SessionActionId; appSessionId: AppSessionId; label: string; gap?: string | null }) {
  const remoteGap = useSessionActionUnavailable(id, appSessionId);
  const gap = given ?? remoteGap;
  const enabled = useSessionActionEnabled(id) && gap === null;
  return (
    <DropdownMenu.Item
      disabled={!enabled}
      onSelect={() => runSessionAction(id, appSessionId)}
      title={enabled ? undefined : (gap ?? 'Not available here')}
      className="flex h-7 cursor-default items-center rounded-sm px-2 outline-none select-none data-disabled:text-fg-faint data-highlighted:bg-bg-hover"
    >
      {label}
    </DropdownMenu.Item>
  );
}
