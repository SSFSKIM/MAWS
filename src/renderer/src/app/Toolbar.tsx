// The toolbar, which is also the window's title bar (`titleBarStyle: 'hiddenInset'`, §3; mockup 01): a drag region
// with the traffic lights' 78 px clearance, the wordmark and sidebar/Overview toggles across the sidebar's width,
// the focused pane's active tab as the title (with the branch chip on a session), the usage slot,
// the session actions menu and the panel toggle.
// Every control is `no-drag`, so clicks reach it rather than moving the window.
import { DropdownMenu } from 'radix-ui';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { TabRef } from '@shared/ipc/schema/layout';
import { runAction, useUnstartedTitle } from '../keymap/actions-runtime';
import { selectNeedsYou, useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { branchLabel, recordBranch } from '../sessions/branch-label';
import { useSessions } from '../stores/sessions';
import { Icon, IconButton, PanelIcon, SidebarIcon } from './IconButton';
import { sidebarWidth, useWindowWidth } from './regions';
import { runSessionAction, SESSION_ACTIONS, sessionActionsFor, useSessionActionEnabled, type SessionActionId } from './session-actions';
import { useSlot } from './slots';
import { displayTitle } from '../sessions/title';

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

export function toolbarTitle(tab: TabRef | null, records: ReadonlyMap<AppSessionId, SessionRecord>): { title: string; branch: string | null } {
  switch (tab?.kind) {
    case undefined:
      return { title: '', branch: null }; // an empty main area (W5: the Overview is no tab)
    case 'session':
    case 'agent': {
      const record = records.get(tab.appSessionId);
      const title = displayTitle(record); // no record yet (an unstarted session) or no title yet: "New chat"
      return { title: tab.kind === 'agent' ? `${title} · agent` : title, branch: branchLabel(recordBranch(record)) }; // W9 (H2)
    }
    case 'file':
      return { title: basename(tab.path), branch: null };
    case 'diff':
      return { title: `Diff · ${tab.ref}`, branch: null };
    case 'diagnostics':
      return { title: 'Diagnostics', branch: null };
    case 'settings':
      return { title: 'Settings', branch: null };
  }
}

export function Toolbar() {
  const sidebar = useLayout((s) => s.regions.sidebar);
  const panelCollapsed = useLayout((s) => s.regions.panel.collapsed);
  const windowWidth = useWindowWidth();
  const width = useLayout((s) => sidebarWidth(s.regions, windowWidth));
  const tab = useLayout((s) => activeTab(s.main));
  const records = useSessions((s) => s.records);
  const recordsVersion = useSessions((s) => s.recordsVersion);
  const waiting = useAttention((s) => selectNeedsYou(s, { records, recordsVersion }).filter((row) => row.tier === 1).length);
  const overviewOpen = useLayout((s) => s.overviewOpen);
  const End = useSlot('topBarEnd');
  const appSessionId = tab?.kind === 'session' ? tab.appSessionId : null;
  const unstarted = useUnstartedTitle(appSessionId ?? ('' as AppSessionId));
  const titled = toolbarTitle(tab, records);
  // An unstarted session is titled like its tab.
  const { title, branch } = appSessionId && !records.has(appSessionId) ? { title: unstarted.title, branch: null } : titled;

  return (
    <header data-toolbar className="col-span-full row-start-1 flex h-(--toolbar-h) min-w-0 items-center border-b border-border bg-bg-raised select-none [-webkit-app-region:drag]">
      <div
        className="flex h-full shrink-0 items-center justify-between gap-2 pr-3 pl-[78px]"
        style={sidebar.collapsed ? undefined : { width }}
      >
        <span className="text-ui-sm font-semibold tracking-[0.14em] text-fg-muted">MAWS</span>
        <div className="flex items-center gap-1">
          <IconButton label="Toggle sidebar" action="sidebar.toggle" pressed={!sidebar.collapsed} onClick={() => runAction('sidebar.toggle')}>
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
      <div className="flex min-w-0 items-center gap-3 pl-5">
        <span className="truncate font-medium text-fg">{title}</span>
        {branch && (
          <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-ui-sm text-fg-muted">⎇ {branch}</span>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1 px-3">
        <div data-toolbar-end className="flex items-center [-webkit-app-region:no-drag]">
          {/* eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render */}
          <End />
        </div>
        <SessionMenu appSessionId={appSessionId} />
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        <IconButton label="Toggle right panel" action="panel.toggle" pressed={!panelCollapsed} onClick={() => runAction('panel.toggle')}>
          <PanelIcon />
        </IconButton>
      </div>
    </header>
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
// foreign-live session has none here); "Open" is left out because it is the open tab. A session with no record (an
// unstarted one) offers nothing yet, and with nothing to offer the menu is disabled.
function SessionMenu({ appSessionId }: { appSessionId: AppSessionId | null }) {
  const record = useSessions((s) => (appSessionId ? s.records.get(appSessionId) : undefined));
  const ids = record ? sessionActionsFor(record).filter((id) => id !== 'open') : [];
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild disabled={ids.length === 0}>
        <IconButton label="Session actions">
          <span aria-hidden className="text-ui leading-none tracking-tight">•••</span>
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-48 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg"
        >
          {record &&
            ids.map((id) => (
              <SessionMenuItem key={id} id={id} appSessionId={record.appId} label={id === 'pin' && record.pinned ? 'Unpin' : SESSION_ACTIONS[id]} />
            ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function SessionMenuItem({ id, appSessionId, label }: { id: SessionActionId; appSessionId: AppSessionId; label: string }) {
  const enabled = useSessionActionEnabled(id);
  return (
    <DropdownMenu.Item
      disabled={!enabled}
      onSelect={() => runSessionAction(id, appSessionId)}
      title={enabled ? undefined : 'Not available here'}
      className="flex h-7 cursor-default items-center rounded-sm px-2 outline-none select-none data-disabled:text-fg-faint data-highlighted:bg-bg-hover"
    >
      {label}
    </DropdownMenu.Item>
  );
}
