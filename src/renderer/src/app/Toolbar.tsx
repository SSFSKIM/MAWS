// The toolbar, which is also the window's title bar (`titleBarStyle: 'hiddenInset'`, §3; mockup 01): a drag region
// with the traffic lights' 78 px clearance and sidebar/Overview toggles across the sidebar's width,
// the focused pane's active tab as the title (with the branch chip on a session; the word cut, W4, took the project chip
// left of the tabs, whose room the tabs and the surface icons take), the session
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
import { runAction } from '../keymap/actions-runtime';
import { selectNeedsYou, useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { activeTab, currentSet } from '../stores/layout-model';
import { branchLabel } from '../sessions/branch-label';
import { workingBranch } from '@shared/sessions/working-folder'; // UX wave U8c-2
import { useSessions, type ListedSession } from '../stores/sessions';
import { Icon, IconButton, SidebarIcon } from './IconButton';
import { HiddenHeading } from '../ui/hidden-heading';
import { NamedGlyph } from '../ui/glyph';
import { RefusedMenuItem } from '../ui/refused-menu-item';
import { DESTINATION } from '../destination/copy';
import { PAGE_TITLE_ID } from '../destination/DestinationPage';
import { useShellGeometry, useShellView } from './shell-view';
import { useZoom } from '../stores/zoom'; // UX wave U6b-5b
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
import { OpenInSubmenu } from '../open-in/OpenInMenu'; // UX wave U6b-4a
import { useOtherMachine } from '../open-in/open'; // UX wave U6b-4a
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
// UX wave U6b-5b (placement 5; its Decision Log 18): the traffic lights keep 78 window points clear, which is 78 ÷ the
// window's zoom CSS pixels, and the leading box holds that clearance, its two 28 px buttons, the 4 px between them and its
// 12 px of right padding: 150 at 100 %, as before. It is never narrower than that at any zoom, the sidebar's width or not.
const LIGHTS_CLEAR_PT = 78;
const LEADING_CONTROLS = 28 + 4 + 28 + 12;
const leadingFloor = (zoom: number) => Math.ceil(LIGHTS_CLEAR_PT / zoom) + LEADING_CONTROLS;

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
  const zoom = useZoom((s) => s.factor); // UX wave U6b-5b
  const leading = Math.max(geometry.sidebar || 150, leadingFloor(zoom));
  const stripRoom = split ? 240 : 180;
  const controlsRoom = geometry.chrome - leading - 16 - stripRoom;
  const surfaceIcons = Math.max(0, Math.floor((controlsRoom - 28 - USAGE_RING_ROOM) / 30));
  const Usage = useSlot('topBarEnd');

  return (
    <header data-toolbar className={`${geometry.mainHidden || destination !== null ? 'col-start-1 col-span-3' : 'col-span-2'} row-start-1 flex h-(--toolbar-h) min-w-0 items-center border-b border-border bg-bg select-none [-webkit-app-region:drag]`}>
      <div
        className="flex h-full shrink-0 items-center justify-end gap-2 pr-3 pl-[calc(78px/var(--app-zoom,1))]"
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
      {destination !== null && <PageTitle destination={destination} />}
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

// UX wave U7b: Back and the page's name; Back leaves the page (U6b's history takes it over when it lands). The word cut
// (W6, the owner's ruling of 2026-11-20): the name is drawn on the Projects page alone; Customize and Artifacts keep it as
// a hidden heading, which still labels the page's region.
const NAMED_PAGES: ReadonlySet<Destination['kind']> = new Set(['projects']);

function PageTitle({ destination }: { destination: Destination }) {
  const name = DESTINATION.names[destination.kind];
  return (
    <div data-page-title className="flex min-w-0 shrink items-center gap-1 pr-2">
      <NamedGlyph label={DESTINATION.back} shortcut={DESTINATION.backChord} onClick={() => useLayout.getState().closeDestination()}>
        <Icon><path d="M10 3.5 5.5 8l4.5 4.5" /></Icon>
      </NamedGlyph>
      {NAMED_PAGES.has(destination.kind) ? (
        <h1 id={PAGE_TITLE_ID} className="m-0 min-w-0 truncate text-ui font-semibold text-fg">{name}</h1>
      ) : (
        <HiddenHeading level={1} id={PAGE_TITLE_ID}>{name}</HiddenHeading>
      )}
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
// UX wave U6b-4a: Open in, after the session's actions and before Share, for a record and for another machine's terminal
// session (drawn disabled there, saying where the folder is).
function SessionMenuOverflow({ appSessionId }: { appSessionId: AppSessionId }) {
  const record = useSessions((s) => s.records.get(appSessionId));
  const bridged = useLaneAState(appSessionId)?.bridge === 'live'; // P5 O9 M5: Take over and Fork for a bridged terminal session
  const remote = useRemoteLaneA(appSessionId) && !record;
  const controls = useSessionControls(appSessionId);
  const remoteReading = useReaderRowsOf(appSessionId) !== 'refused'; // P5 O8 M6a
  const shareable = useCanShare(appSessionId); // P5 O8 M6b
  const ownable = useCanAddOwner(appSessionId); // P5 O8 M5b
  const mine = useSessions((s) => s.listed.get(appSessionId)?.mine ?? false); // the UX wave, U9: the listing's
  const elsewhere = useOtherMachine(appSessionId) !== null; // UX wave U6b-4a: by its address, before any record arrives
  if (remote) {
    const takeOver = controls?.capability('take-over') ?? null;
    return <SessionMenu disabled={false}>
      <SessionMenuItem id="takeOver" appSessionId={appSessionId} label={SESSION_ACTIONS.takeOver} gap={takeOver === null || takeOver.available ? null : takeOver.reason} />
      <OpenInSubmenu appSessionId={appSessionId} menu="dropdown" />
      {shareable && <ShareMenuItem appSessionId={appSessionId} />}
      {ownable && <AddOwnerMenuItem appSessionId={appSessionId} />}
    </SessionMenu>;
  }
  const ids = record ? sessionActionsFor(record, { bridged, remote: isRemoteLaneB(record.appId) /* P5 O7 M2 */, remoteReading, mine }).filter((id) => id !== 'open' && id !== 'openInNewTab') : [];
  return <SessionMenu disabled={!record && !shareable && !elsewhere}>
    {record && ids.map((id) => <SessionMenuItem key={id} id={id} appSessionId={record.appId} label={id === 'pin' && record.pinned ? 'Unpin' : SESSION_ACTIONS[id]} />)}
    {(record || elsewhere) && <OpenInSubmenu appSessionId={appSessionId} menu="dropdown" /> /* UX wave U6b-4a: the working folder; disabled for another machine */}
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

const SESSION_ITEM = 'flex h-7 cursor-default items-center rounded-sm px-2 outline-none select-none aria-disabled:text-fg-faint data-highlighted:bg-bg-hover';

// `gap`: why the session can't take the action at all (P5 O9 M9), shown in place of the unregistered words; the UX wave,
// U9: else the window's helper's sentence for an act on another machine.
function SessionMenuItem({ id, appSessionId, label, gap: given = null }: { id: SessionActionId; appSessionId: AppSessionId; label: string; gap?: string | null }) {
  const remoteGap = useSessionActionUnavailable(id, appSessionId);
  const gap = given ?? remoteGap;
  const enabled = useSessionActionEnabled(id) && gap === null;
  // board ticket 815: a greyed item keeps the menu's keyboard, its reason its description and its row note
  if (!enabled) return <RefusedMenuItem kit={DropdownMenu} label={label} reason={gap ?? 'Not available here'} className={SESSION_ITEM} />;
  return (
    <DropdownMenu.Item onSelect={() => runSessionAction(id, appSessionId)} className={SESSION_ITEM}>
      {label}
    </DropdownMenu.Item>
  );
}
