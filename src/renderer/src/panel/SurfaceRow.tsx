import { preserveSubmenuPointer } from '@artifacts/ui/menu-pointer';
import type { ReactElement, ReactNode } from 'react';
import { ContextMenu, DropdownMenu } from 'radix-ui';
import type { ActionId } from '@shared/keymap/actions';
import { Icon, IconButton } from '../app/IconButton';
import { pageOpen, useLayout } from '../stores/layout';
import { currentSet, paramsHoldFile } from '../stores/layout-model'; // UX wave U6b-1; U6b-5a: currentSet
import { useComposerStore } from '../stores/composer'; // UX wave U6b-5a
import { focusedSession, focusFocused } from '../composer/ComposerAppKeys'; // UX wave U6b-5a
import { focusPaneElement } from '../main/pane-dom'; // UX wave U6b-5a
import { available, focusSurfaceStop, sideSurfaceOf } from '../keymap/shell-navigation'; // UX wave U6b-5a
import { usePanes, openPaneTab } from '../engine-surface/panes';
import { lastInViewOf, panelHost, requestFocus, usePanelHost } from './host';
import { COPY } from './copy';
import { sideGroups, surfaceRefs, surfaceSession, surfaceTabs } from './surface-model';
import { cardColumnNow, useCardColumn, useShellView } from '../app/shell-view';

const PRIMARY = ['terminal', 'review', 'browser', 'files'];
const ITEM = 'flex h-8 cursor-default items-center gap-2 rounded-sm px-2 text-ui outline-none data-highlighted:bg-bg-hover data-disabled:text-fg-faint';
const MENU = 'z-50 min-w-48 rounded-md border border-border-strong bg-bg-overlay p-1 text-fg shadow-float';

// The one entry of a tool's icon, its menu rows and its `surface.*` action (UX wave U8b, M2, decision 3). The tool in
// view on an open right side: the column hides, closing nothing. Else its tab comes into view: the one of that tool last
// in view in this run, else the one a group remembers as shown (what a relaunch restores), else its last in the strip;
// a tool with no tab is added. Nothing is ever placed under another by it.
// UX wave U7b (M6, decision 6; the owner's answer to question 4): with a page open it only shows. The page is left, and
// a tool already in view behind it stays in view, so leaving the page is all it does; any other tool is shown as above.
// UX wave U6b-5a (M1, decisions 1 to 3): the keyboard follows, the same from every control. A tool shown has it
// (`focusShown`); the column hidden gives it back in the next frame (`giveKeyboardBack`). With a page open and the tool
// in view behind it, leaving the page moves no keyboard.
export function toggleSurface(toolId: string) {
  const state = useLayout.getState();
  const session = surfaceSession(state);
  if (!state.regions.panel.collapsed && surfaceTabs(state, session).some((tab) => tab.toolId === toolId)) {
    if (pageOpen(state)) state.closeDestination();
    else {
      const returns = keyboardInColumn();
      state.hideSurfaces(session);
      if (returns) giveKeyboardBack();
    }
    return;
  }
  const groups = sideGroups(state, session);
  const remembered = [groups.upper.shown, groups.lower?.shown].find((tab) => tab?.toolId === toolId);
  const held = lastInViewOf(session, toolId) ?? remembered ?? surfaceRefs(state, session).findLast((tab) => tab.toolId === toolId);
  if (!held && (!session || !usePanelHost.getState().tools.has(toolId))) return;
  state.closeDestination();
  let shown: string | null = null;
  if (held) {
    state.showSurfaceTab(session, held.id);
    shown = held.id;
  } else if (session) shown = panelHost.addTool(toolId, { appSessionId: session });
  state.setPanel({ collapsed: false });
  if (shown !== null) focusShown(shown);
}

// Decision 2: the tool is asked (its own answer: Terminal's shell, Files' view or tree, a mod's pane), and two frames
// later, once its answer has had a render to land, the keyboard goes to F6's stop for the tab unless it is inside the
// tab's surface already. Nothing moves when the person pressed a key or a pointer in between (the press that ran this
// one was dispatched before it began), or when by then the tab is out of view or a dialog holds the keyboard.
function focusShown(tabId: string): void {
  requestFocus(tabId);
  const request = usePanelHost.getState().focus[tabId] ?? 0;
  showing.set(tabId, request);
  let pressed = false;
  const heard = () => void (pressed = true);
  window.addEventListener('keydown', heard, true);
  window.addEventListener('pointerdown', heard, true);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (showing.get(tabId) === request) showing.delete(tabId);
    window.removeEventListener('keydown', heard, true);
    window.removeEventListener('pointerdown', heard, true);
    if (pressed || (sideSurfaceOf(tabId)?.contains(document.activeElement) ?? false)) return;
    focusSurfaceStop(tabId);
  }));
}

// The focus request a surface's key made, by tab, until its second frame. The host also asks a tab for the keyboard when
// it opens something in it (a link's file, the agent's show), with a later value of the same counter; a tool that answers
// only the person's show by a surface's key (Files) asks for the value it was given, so those opens, even one that reuses
// the tab before the second frame, leave the keyboard where it was.
const showing = new Map<string, number>();
export const shownByItsKey = (tabId: string, request: number): boolean => showing.get(tabId) === request;

// Decision 3: the keyboard comes back from the column when the column held it or nothing did; anywhere else (the
// sidebar, the main area) it stays. Read before the hide.
function keyboardInColumn(): boolean {
  const holder = document.activeElement;
  return holder === null || holder === document.body || (document.getElementById('region-panel')?.contains(holder) ?? false);
}

// The composer of the session on screen takes it, else the pane in front, in the next frame: a side surface that covered
// the main area (maximized, a sheet) leaves it inert until the hide has been drawn, and inert takes no keyboard (as the
// sheet's own dismissal waits, `dismissSheet`). Nothing moves when by then something outside the column holds it (the
// person moved it).
function giveKeyboardBack(): void {
  requestAnimationFrame(() => {
    const holder = document.activeElement;
    if (holder instanceof HTMLElement && holder !== document.body && holder.isConnected && available(holder) && !(document.getElementById('region-panel')?.contains(holder) ?? false)) return;
    const session = focusedSession();
    if (session !== null && useComposerStore.getState().focusTargets.has(session)) focusFocused();
    else focusPaneElement(currentSet(useLayout.getState().main).focusedPane);
  });
}

// The Session cards icon and its menu row: off when the column is shown, else shown (UX wave U8b: read from its one source).
// UX wave U7b (M6, decision 6): with a page open it only shows: the page is left, and a column placed behind it is shown
// again by that alone.
export function toggleSessionCards() {
  const state = useLayout.getState();
  const { session, sessionTab, placed, shown } = cardColumnNow(state, window.innerWidth);
  if (session === null || !sessionTab) return;
  if (pageOpen(state)) {
    state.closeDestination();
    if (placed) return;
  } else if (shown) {
    state.setPanel({ collapsed: true });
    return;
  }
  state.hideSurfaces(session);
  state.setPanel({ collapsed: false, maximized: false, floating: false });
  useShellView.setState({ cardsOverlay: true });
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
  const overflow = [...new Set([...candidates.filter((id) => !ids.includes(id)), ...[...tools.values()].filter((tool) => tool.menu !== false && !ids.includes(tool.id)).map((tool) => tool.id)])].map((id) => tools.get(id)!);
  const { sessionTab: hasSessionTab, shown: cards } = useCardColumn();
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
  // UX wave U6b-1 (Decision 16): the tab "Keep open for every session" acts on is the tool's first that holds no file (for
  // Files, the tree-only tab), and the item is absent when the scope has none
  const tab = state.effectivePanelTabs(session).find((tab) => tab.toolId === toolId && !paramsHoldFile(state.panelParams[tab.id]));
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
      <ContextMenu.Item className={ITEM} onSelect={() => toggleSurface(toolId)}>{opened ? COPY.hideSurface : COPY.openSurface}</ContextMenu.Item>
    </ContextMenu.Content></ContextMenu.Portal>
  </ContextMenu.Root>;
}
