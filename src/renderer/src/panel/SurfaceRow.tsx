import { ASK_SHEET_TOOL_ID } from '@shared/maws/panes';
import { settleWaitingAsks } from '../tools/maws/ask/connect';
import { preserveSubmenuPointer } from '@artifacts/ui/menu-pointer';
import type { ReactElement, ReactNode } from 'react';
import { ContextMenu, DropdownMenu } from 'radix-ui';
import type { ActionId } from '@shared/keymap/actions';
import type { PanelTabRef } from '@shared/ipc/schema/layout';
import { Icon, IconButton } from '../app/IconButton';
import { useLayout } from '../stores/layout';
import { activeTab, sessionOfTab } from '../stores/layout-model';
import { usePanes, openPaneTab } from '../engine-surface/panes';
import { panelHost, usePanelHost } from './host';
import { surfaceSession, surfaceTabs } from './surface-model';
import { useShellGeometry, useShellView } from '../app/shell-view';
import { useWindowWidth } from '../app/regions';
import { shellGeometry } from '../app/shell-geometry';
import { useSessions } from '../stores/sessions';

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
  if (toolId === ASK_SHEET_TOOL_ID && session) settleWaitingAsks(session);
  const held = state.effectivePanelTabs(session).find((tab) => tab.toolId === toolId);
  if (!held && (!session || !usePanelHost.getState().tools.has(toolId))) return;
  if (held) state.setPanelTabs(session, { tabs: state.effectivePanelTabs(session), activeTabId: held.id });
  else if (session) panelHost.addTool(toolId, { appSessionId: session });
  state.setPanel({ collapsed: false });
}

export function toggleSessionCards() {
  const state = useLayout.getState();
  const session = sessionOfTab(activeTab(state.main));
  if (session === null || !useSessions.getState().records.has(session)) return;
  const visible = surfaceTabs(state, surfaceSession(state));
  const geometry = shellGeometry(state.regions, window.innerWidth, visible.length > 0, false);
  const cards = !state.regions.panel.collapsed && visible.length === 0 && (window.innerWidth - geometry.sidebar >= 960 || useShellView.getState().cardsOverlay);
  if (cards) state.setPanel({ collapsed: true });
  else { state.setSurfaceStack(session, []); state.setPanel({ collapsed: false, maximized: false, floating: false }); useShellView.setState({ cardsOverlay: true }); }
}

const SURFACE_ACTIONS: Readonly<Record<string, ActionId>> = {
  terminal: 'surface.terminal', review: 'surface.review', browser: 'surface.browser', files: 'surface.files',
  'source-control': 'surface.source-control', subagents: 'surface.subagents', background: 'surface.background',
  'session-info': 'surface.session-info', 'ask-sheet': 'surface.ask-sheet',
};

export function SurfaceRow({ maxIcons = Infinity, overflowControls }: { maxIcons?: number; overflowControls?: ReactNode }) {
  const state = useLayout();
  const session = surfaceSession(state);
  const tools = usePanelHost((s) => s.tools);
  const visible = surfaceTabs(state, session);
  const held = state.effectivePanelTabs(session);
  const panes = usePanes(session);
  const candidates = [...new Set([...PRIMARY, ...state.panelSurfaces.pinnedTools, ...visible.map((tab) => tab.toolId)])].filter((id) => tools.has(id));
  const ids = candidates.slice(0, maxIcons);
  const cardsIcon = maxIcons > ids.length;
  // Artifacts is the project Library card now; a saved artifact editor remains reachable until explicitly closed.
  const overflow = [...new Set([...candidates.filter((id) => !ids.includes(id)), ...[...tools.values()].filter((tool) => tool.menu !== false && tool.id !== 'artifacts' && !ids.includes(tool.id)).map((tool) => tool.id)])].map((id) => tools.get(id)!);
  const activeSession = sessionOfTab(activeTab(state.main));
  const hasSessionTab = useSessions((s) => activeSession !== null && s.records.has(activeSession));
  const geometry = useShellGeometry();
  const width = useWindowWidth();
  const forcedCards = useShellView((s) => s.cardsOverlay);
  const cards = !state.regions.panel.collapsed && visible.length === 0 && hasSessionTab && (width - geometry.sidebar >= 960 || forcedCards);
  return (
    <div data-surface-row role="toolbar" aria-label="Session surfaces" className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
      {cardsIcon && <IconButton label="Session cards" action="panel.toggle" pressed={cards} disabled={!hasSessionTab} onClick={toggleSessionCards}><Icon><rect x="2.5" y="2.5" width="11" height="11" rx="2" /><path d="M5 6h6M5 9h6" /></Icon></IconButton>}
      {ids.map((id) => {
        const tool = tools.get(id)!;
        const ToolIcon = tool.icon;
        const tab = held.find((tab) => tab.toolId === id);
        const opened = !state.regions.panel.collapsed && visible.some((tab) => tab.toolId === id);
        return <SurfaceContext key={id} toolId={id}>
          <IconButton label={tool.title} action={SURFACE_ACTIONS[id]} pressed={opened} disabled={!session && !tab} onClick={() => toggleSurface(id)}><ToolIcon className="size-4" /></IconButton>
        </SurfaceContext>;
      })}
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild><IconButton label="More surfaces"><Icon><path d="M3 8h.01M8 8h.01M13 8h.01" strokeWidth="2.5" /></Icon></IconButton></DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={6} className={MENU}>
          {overflow.map((tool) => <SurfaceContext key={tool.id} toolId={tool.id}><DropdownMenu.Item disabled={!session && !held.some((tab) => tab.toolId === tool.id)} className={ITEM} onSelect={() => toggleSurface(tool.id)}><tool.icon className="size-4 text-fg-muted" />{tool.title}</DropdownMenu.Item></SurfaceContext>)}
          {!cardsIcon && <DropdownMenu.Item disabled={!hasSessionTab} className={ITEM} onSelect={toggleSessionCards}>Session cards</DropdownMenu.Item>}
          {overflowControls}
          {held.filter((tab) => tab.toolId === 'artifacts' && !candidates.includes(tab.toolId)).map((tab: PanelTabRef) => <SurfaceContext key={tab.id} toolId={tab.toolId}><DropdownMenu.Item className={ITEM} onSelect={() => toggleSurface(tab.toolId)}>Open saved artifact</DropdownMenu.Item></SurfaceContext>)}
          {held.filter((tab) => !tools.has(tab.toolId)).map((tab) => <DropdownMenu.Sub key={tab.id}>
            <DropdownMenu.SubTrigger onPointerLeave={preserveSubmenuPointer} className={ITEM}>{tab.toolId} (unavailable)</DropdownMenu.SubTrigger>
            <DropdownMenu.Portal><DropdownMenu.SubContent className={MENU}>
              <DropdownMenu.Item className={ITEM} onSelect={() => toggleSurface(tab.toolId)}>Show saved surface</DropdownMenu.Item>
              {session && <DropdownMenu.Item className={ITEM} onSelect={() => state.setPanelTabPinned(session, tab.id, !tab.pinned)}>{tab.pinned ? 'Keep with this session only' : 'Keep open for every session'}</DropdownMenu.Item>}
              <DropdownMenu.Item className={ITEM} onSelect={() => void panelHost.closeTab(tab.id)}>Close saved tab</DropdownMenu.Item>
            </DropdownMenu.SubContent></DropdownMenu.Portal>
          </DropdownMenu.Sub>)}
          {panes.length > 0 && <DropdownMenu.Separator className="my-1 h-px bg-border" />}
          {panes.map((pane) => <DropdownMenu.Item key={pane.id} className={ITEM} onSelect={() => session && openPaneTab(session, pane.id)}>{pane.title || pane.id}<span className="ml-auto text-fg-muted">{pane.plugin}</span></DropdownMenu.Item>)}
          {overflow.length === 0 && panes.length === 0 && <DropdownMenu.Item disabled className={ITEM}>No other surfaces</DropdownMenu.Item>}
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

// Icons and their folded menu items have the same context actions, including the keyboard menu key.
function SurfaceContext({ toolId, children }: { toolId: string; children: ReactElement }) {
  const state = useLayout();
  const session = surfaceSession(state);
  const tool = usePanelHost((s) => s.tools.get(toolId));
  const pinned = state.panelSurfaces.pinnedTools.includes(toolId);
  const tab = state.effectivePanelTabs(session).find((tab) => tab.toolId === toolId);
  const opened = !state.regions.panel.collapsed && surfaceTabs(state, session).some((tab) => tab.toolId === toolId);
  return <ContextMenu.Root modal={false}>
    <ContextMenu.Trigger asChild onKeyDown={(event) => {
      if (!event.shiftKey || event.key !== 'F10') return;
      event.preventDefault();
      const box = event.currentTarget.getBoundingClientRect();
      event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.left, clientY: box.bottom }));
    }}>{children}</ContextMenu.Trigger>
    <ContextMenu.Portal><ContextMenu.Content className={MENU}>
      {!PRIMARY.includes(toolId) && <ContextMenu.Item className={ITEM} onSelect={() => state.toggleSurfacePin(toolId)}>{pinned ? 'Unpin from toolbar' : 'Pin to toolbar'}</ContextMenu.Item>}
      {tab && tool?.pinnable && session && <ContextMenu.Item className={ITEM} onSelect={() => state.setPanelTabPinned(session, tab.id, !tab.pinned)}>{tab.pinned ? 'Keep with this session only' : 'Keep open for every session'}</ContextMenu.Item>}
      <ContextMenu.Item className={ITEM} onSelect={() => toggleSurface(toolId)}>{opened ? 'Close surface' : 'Open surface'}</ContextMenu.Item>
    </ContextMenu.Content></ContextMenu.Portal>
  </ContextMenu.Root>;
}
