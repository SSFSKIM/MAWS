// The toolbar, which is also the window's title bar (`titleBarStyle: 'hiddenInset'`, §3; mockup 01): a drag region
// with the traffic lights' 78 px clearance, the wordmark and sidebar toggle across the sidebar's width, the focused
// pane's active tab as the title (with the branch chip on a session), the session actions menu and the panel toggle.
// Every control is `no-drag`, so clicks reach it rather than moving the window.
import { DropdownMenu } from 'radix-ui';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { TabRef } from '@shared/ipc/schema/layout';
import { runAction, useUnstartedTitle } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { IconButton, PanelIcon, SidebarIcon } from './IconButton';
import { sidebarWidth, useWindowWidth } from './regions';
import { runSessionAction, SESSION_ACTIONS, sessionActionsFor, useSessionActionEnabled, type SessionActionId } from './session-actions';

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

export function toolbarTitle(tab: TabRef | null, records: ReadonlyMap<AppSessionId, SessionRecord>): { title: string; branch: string | null } {
  switch (tab?.kind) {
    case undefined:
    case 'overview':
      return { title: 'Overview', branch: null };
    case 'session':
    case 'agent': {
      const record = records.get(tab.appSessionId);
      const title = record?.title.text ?? 'New session'; // no record yet: an unstarted session
      return { title: tab.kind === 'agent' ? `${title} · agent` : title, branch: record?.branch ?? record?.worktree?.branch ?? null };
    }
    case 'file':
      return { title: basename(tab.path), branch: null };
    case 'diff':
      return { title: `Diff · ${tab.ref}`, branch: null };
    case 'diagnostics':
      return { title: 'Diagnostics', branch: null };
    case 'accounts':
      return { title: 'Accounts', branch: null };
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
  const appSessionId = tab?.kind === 'session' ? tab.appSessionId : null;
  const unstarted = useUnstartedTitle(appSessionId ?? ('' as AppSessionId));
  const titled = toolbarTitle(tab, records);
  // An unstarted session is titled like its tab.
  const { title, branch } = appSessionId && !records.has(appSessionId) ? { title: unstarted.title, branch: null } : titled;

  return (
    <header className="col-span-full row-start-1 flex h-(--toolbar-h) min-w-0 items-center border-b border-border bg-bg-raised select-none [-webkit-app-region:drag]">
      <div
        className="flex h-full shrink-0 items-center justify-between gap-2 pr-3 pl-[78px]"
        style={sidebar.collapsed ? undefined : { width }}
      >
        <span className="text-ui-sm font-semibold tracking-[0.14em] text-fg-muted">MAWS</span>
        <IconButton label="Toggle sidebar" action="sidebar.toggle" pressed={!sidebar.collapsed} onClick={() => runAction('sidebar.toggle')}>
          <SidebarIcon />
        </IconButton>
      </div>
      <div className="flex min-w-0 items-center gap-3 pl-5">
        <span className="truncate font-medium text-fg">{title}</span>
        {branch && (
          <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-ui-sm text-fg-muted">⎇ {branch}</span>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1 px-3">
        <SessionMenu appSessionId={appSessionId} />
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        <IconButton label="Toggle right panel" action="panel.toggle" pressed={!panelCollapsed} onClick={() => runAction('panel.toggle')}>
          <PanelIcon />
        </IconButton>
      </div>
    </header>
  );
}

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
      title={enabled ? undefined : 'Arrives with C10'}
      className="flex h-7 cursor-default items-center rounded-sm px-2 outline-none select-none data-disabled:text-fg-faint data-highlighted:bg-bg-hover"
    >
      {label}
    </DropdownMenu.Item>
  );
}
