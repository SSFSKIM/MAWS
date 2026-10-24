import { ContextMenu, DropdownMenu } from 'radix-ui';
import type { PanelTabRef } from '@shared/ipc/schema/layout';
import { Icon, IconButton } from '../app/IconButton';
import { useLayout } from '../stores/layout';
import { activeTab, sessionOfTab } from '../stores/layout-model';
import { usePanes, openPaneTab } from '../engine-surface/panes';
import { panelHost, usePanelHost } from './host';
import { surfaceSession, surfaceTabs } from './surface-model';
import { useShellGeometry, useShellView } from '../app/shell-view';
import { useWindowWidth } from '../app/regions';

const PRIMARY = ['terminal', 'review', 'browser', 'files'];
const ITEM = 'flex h-8 cursor-default items-center gap-2 rounded-sm px-2 text-ui outline-none data-highlighted:bg-bg-hover data-disabled:text-fg-faint';
const MENU = 'z-50 min-w-48 rounded-md border border-border-strong bg-bg-overlay p-1 text-fg shadow-float';

export function closeSurface(toolId: string) {
  const state = useLayout.getState();
  const session = surfaceSession(state);
  state.setSurfaceStack(session, surfaceTabs(state, session).filter((tab) => tab.toolId !== toolId).map((tab) => tab.id));
}

export function toggleSurface(toolId: string) {
  const state = useLayout.getState();
  const session = surfaceSession(state);
  const visible = surfaceTabs(state, session);
  if (!state.regions.panel.collapsed && visible.some((tab) => tab.toolId === toolId)) {
    closeSurface(toolId);
    return;
  }
  const held = state.effectivePanelTabs(session).find((tab) => tab.toolId === toolId);
  if (held) state.setPanelTabs(session, { tabs: state.effectivePanelTabs(session), activeTabId: held.id });
  else if (session) panelHost.addTool(toolId, { appSessionId: session });
  state.setPanel({ collapsed: false });
}

export function SurfaceRow() {
  const state = useLayout();
  const session = surfaceSession(state);
  const tools = usePanelHost((s) => s.tools);
  const visible = surfaceTabs(state, session);
  const held = state.effectivePanelTabs(session);
  const panes = usePanes(session);
  const ids = [...new Set([...PRIMARY, ...state.panelSurfaces.pinnedTools, ...visible.map((tab) => tab.toolId)])].filter((id) => tools.has(id));
  // Artifacts is the project Library card now; a saved artifact editor remains reachable until explicitly closed.
  const overflow = [...tools.values()].filter((tool) => tool.menu !== false && tool.id !== 'artifacts' && !ids.includes(tool.id));
  const hasSessionTab = sessionOfTab(activeTab(state.main)) !== null;
  const geometry = useShellGeometry();
  const width = useWindowWidth();
  const forcedCards = useShellView((s) => s.cardsOverlay);
  const cards = !state.regions.panel.collapsed && visible.length === 0 && hasSessionTab && (width - geometry.sidebar >= 960 || forcedCards);
  return (
    <div data-surface-row role="toolbar" aria-label="Session surfaces" className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
      <IconButton label="Session cards" action="panel.toggle" pressed={cards} disabled={!hasSessionTab} onClick={() => {
        if (cards) state.setPanel({ collapsed: true });
        else { state.setSurfaceStack(session, []); state.setPanel({ collapsed: false }); useShellView.setState({ cardsOverlay: true }); }
      }}><Icon><rect x="2.5" y="2.5" width="11" height="11" rx="2" /><path d="M5 6h6M5 9h6" /></Icon></IconButton>
      {ids.map((id) => {
        const tool = tools.get(id)!;
        const ToolIcon = tool.icon;
        const pinned = state.panelSurfaces.pinnedTools.includes(id);
        const tab = held.find((tab) => tab.toolId === id);
        const opened = !state.regions.panel.collapsed && visible.some((tab) => tab.toolId === id);
        return <ContextMenu.Root key={id} modal={false}>
          <ContextMenu.Trigger asChild>
            <IconButton label={tool.title} pressed={opened} disabled={!session && !tab} onClick={() => toggleSurface(id)} onKeyDown={(event) => {
              if (event.shiftKey && event.key === 'F10') {
                event.preventDefault();
                const box = event.currentTarget.getBoundingClientRect();
                event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: box.left, clientY: box.bottom }));
              }
            }}><ToolIcon className="size-4" /></IconButton>
          </ContextMenu.Trigger>
          <ContextMenu.Portal><ContextMenu.Content className={MENU}>
            {!PRIMARY.includes(id) && <ContextMenu.Item className={ITEM} onSelect={() => state.toggleSurfacePin(id)}>{pinned ? 'Unpin from toolbar' : 'Pin to toolbar'}</ContextMenu.Item>}
            {tab && tool.pinnable && session && <ContextMenu.Item className={ITEM} onSelect={() => state.setPanelTabPinned(session, tab.id, !tab.pinned)}>{tab.pinned ? 'Keep with this session only' : 'Keep open for every session'}</ContextMenu.Item>}
            <ContextMenu.Item className={ITEM} onSelect={() => toggleSurface(id)}>{opened ? 'Close surface' : 'Open surface'}</ContextMenu.Item>
          </ContextMenu.Content></ContextMenu.Portal>
        </ContextMenu.Root>;
      })}
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild><IconButton label="More surfaces"><Icon><path d="M3 8h.01M8 8h.01M13 8h.01" strokeWidth="2.5" /></Icon></IconButton></DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={6} className={MENU}>
          {overflow.map((tool) => <DropdownMenu.Item key={tool.id} disabled={!session} className={ITEM} onSelect={() => toggleSurface(tool.id)}><tool.icon className="size-4 text-fg-muted" />{tool.title}</DropdownMenu.Item>)}
          {held.filter((tab) => tab.toolId === 'artifacts' && !ids.includes(tab.toolId)).map((tab: PanelTabRef) => <DropdownMenu.Item key={tab.id} className={ITEM} onSelect={() => toggleSurface(tab.toolId)}>Open saved artifact</DropdownMenu.Item>)}
          {panes.length > 0 && <DropdownMenu.Separator className="my-1 h-px bg-border" />}
          {panes.map((pane) => <DropdownMenu.Item key={pane.id} className={ITEM} onSelect={() => session && openPaneTab(session, pane.id)}>{pane.title || pane.id}<span className="ml-auto text-fg-muted">{pane.plugin}</span></DropdownMenu.Item>)}
          {overflow.length === 0 && panes.length === 0 && <DropdownMenu.Item disabled className={ITEM}>No other surfaces</DropdownMenu.Item>}
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
