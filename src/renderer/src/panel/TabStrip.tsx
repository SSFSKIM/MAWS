// The panel's strip (C8a execution document, M1): the tabs in `PanelHostProps.tabs` order (pins first), and "+". One row
// that never wraps; each tab is `icon · title · suffix`, at most 192 px, with its pin and close glyphs revealed on hover,
// focus and selection (Codex §3). A tab is chosen by id (`panelHost.selectTab`) and closed through the host, so
// `beforeClose` runs; the strip never submits its tabs as a list. UX wave U8b (M2): the side column's strip, one per
// group, with the region's controls at the first one's end (`trailing`); while its tabs do not fit, the tabs not in view
// stand as their icons alone, the rightmost first, then the tab in view is cut down to 72 px, and only then does the row
// scroll (`fitTabs`, the owner's "Shrink to icons" of 2026-11-12). P4-B3 (X38; its Decision Log 17, 21): a tab whose
// tool moves to main (the Artifacts tool) drags while it shows a record, and its context menu offers "Move to main
// area", disabled with the reason a drag of it would be refused. UX wave U8b (M3): the menu then offers "Move below" on a
// tab of the upper group (while the column has two groups or its one group more than one tab) and "Move above" on a tab
// of the lower one; it opens on a right click and on Shift+F10. A strip knows its group and hands it to its "+".
import { ContextMenu, DropdownMenu } from 'radix-ui';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { PanelTabRef } from '@shared/ipc/schema/layout';
import { Icon, IconButton } from '../app/IconButton';
import { useLayout } from '../stores/layout';
import { COPY } from './copy';
import { openPaneTab, usePanes } from '../engine-surface/panes'; // R2
import { PANE_COPY } from '../engine-surface/PaneTool'; // R2
import { beginDrag, endDragFrom, moveArtifactToTab, panelTabMoves, usePanelRecord, useTransferRefusal } from '../shell/transfer'; // P4-B3
import { TRANSFER_COPY } from '../tools/artifacts/copy'; // P4-B3
import { panelHost, togglePinned, usePanelHost, useTabLabel, type PanelHostState } from './host';
import { groupOf, sideGroups, type SideGroupName } from './surface-model';

interface TabStripProps {
  appSessionId: AppSessionId | null;
  group: SideGroupName; // the group the strip heads
  tabs: PanelTabRef[]; // the group's tabs, in strip order
  activeTabId: string | null; // the group's tab in view
  bodyId: string;
  trailing?: ReactNode; // after "+": the region's controls on the column's first strip
}

export function TabStrip({ appSessionId, group, tabs, activeTabId, bodyId, trailing }: TabStripProps) {
  const list = useRef<HTMLDivElement>(null);
  const fit = useTabFit(list, tabs, activeTabId, group);
  const split = useLayout((s) => sideGroups(s, appSessionId).lower !== null);
  // Where a tab's menu offers to move it (M3, decision 1): below from the upper group once there is something to split or
  // a group to join, above from the lower group.
  const moveTo: SideGroupName | null = group === 'lower' ? 'upper' : split || tabs.length > 1 ? 'lower' : null;
  // The tab comes into view in the other group's strip, where it mounts again; the keyboard goes to its button there, that
  // strip's Tab stop (the branch review's finding 4: the strip decides where the keyboard lands after its own act). Answers
  // the group the tab ended up in: not the one asked for when the move was refused, or when it emptied the upper group,
  // which joins both groups into the upper one (`groupsAfterMove`); then the hand-off is dropped and the tab keeps the
  // keyboard in this strip.
  const move = (tabId: string, to: SideGroupName): SideGroupName | null => {
    handKeyboardTo(tabId, to);
    useLayout.getState().moveSurfaceTab(appSessionId, tabId, to);
    const landed = groupOf(sideGroups(useLayout.getState(), appSessionId), tabId);
    if (landed !== to) takesKeyboard(tabId, to);
    return landed;
  };
  // Arrow keys move focus along the tabs (the WAI-ARIA tabs pattern, manual activation).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at === -1) return;
    event.preventDefault();
    buttons[(at + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length].focus();
  };

  return (
    <div data-side-strip className="flex h-9 min-w-0 shrink-0 items-center gap-1 border-b border-border px-1">
      <div ref={list} role="tablist" aria-label="Panel tools" onKeyDown={onKeyDown} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {tabs.map((tab) => {
          const selected = tab.id === activeTabId;
          const shape: TabShape = fit.icons.has(tab.id) ? 'icon' : selected && fit.shownMax !== null ? 'cut' : 'whole';
          return <Tab key={tab.id} tab={tab} group={group} selected={selected} shape={shape} maxWidth={shape === 'cut' ? fit.shownMax : null} canPin={appSessionId !== null} bodyId={bodyId} onSelect={() => panelHost.selectTab(tab.id)} moveTo={moveTo} onMove={(to) => move(tab.id, to)} />;
        })}
      </div>
      <AddMenu appSessionId={appSessionId} group={group} />
      {trailing}
    </div>
  );
}

// ---- where the keyboard goes after a strip's own act (UX wave U8b; the branch review's findings 4 and 5) -----------------

// A tab whose button takes the keyboard the next time it is drawn in `group`'s strip: after a move, in the strip it lands
// in; after a fold to its icon, which takes away the glyph that held the keyboard, in its own.
let keyboardFor: { tabId: string; group: SideGroupName } | null = null;
function handKeyboardTo(tabId: string, group: SideGroupName): void {
  keyboardFor = { tabId, group };
}
function takesKeyboard(tabId: string, group: SideGroupName): boolean {
  if (keyboardFor?.tabId !== tabId || keyboardFor.group !== group) return false;
  keyboardFor = null;
  return true;
}

// ---- a strip too narrow for its tabs (UX wave U8b, M2, decision 5) ------------------------------------------------------

export const ICON_TAB_PX = 28; // a tab drawn as its icon alone
export const MIN_TAB_PX = 72; // the tab in view is never cut below this (the strip scrolls instead)
const TAB_GAP_PX = 2; // the tablist's gap-0.5

export interface TabFit { icons: ReadonlySet<string>; shownMax: number | null }
const WHOLE: TabFit = { icons: new Set(), shownMax: null };

// What fits in `room` px of tabs whose whole widths are given in strip order: the tabs not in view become icons, the
// rightmost first, until the row fits; with all of them icons, the tab in view is cut to what is left, down to
// MIN_TAB_PX, below which the row scrolls.
export function fitTabs(room: number, tabs: readonly { id: string; whole: number }[], shownId: string | null): TabFit {
  let total = tabs.reduce((sum, tab) => sum + tab.whole, 0) + TAB_GAP_PX * Math.max(0, tabs.length - 1);
  if (total <= room) return WHOLE;
  const icons = new Set<string>();
  for (const tab of [...tabs].reverse()) {
    if (total <= room) break;
    if (tab.id === shownId || tab.whole <= ICON_TAB_PX) continue;
    icons.add(tab.id);
    total -= tab.whole - ICON_TAB_PX;
  }
  const shown = tabs.find((tab) => tab.id === shownId);
  if (total <= room || shown === undefined) return { icons, shownMax: null };
  return { icons, shownMax: Math.max(MIN_TAB_PX, Math.floor(shown.whole - (total - room))) };
}

const sameFit = (a: TabFit, b: TabFit) => a.shownMax === b.shownMax && a.icons.size === b.icons.size && [...a.icons].every((id) => b.icons.has(id));

// The strip's fit, followed through resizes of the row and of its tabs. A tab's whole width is read while it is drawn
// whole and kept for when it is not; a tab not measured yet is drawn whole first. A row not laid out (0 px) fits all.
function useTabFit(list: RefObject<HTMLDivElement | null>, tabs: readonly PanelTabRef[], shownId: string | null, group: SideGroupName): TabFit {
  const [fit, setFit] = useState<TabFit>(WHOLE);
  const whole = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const measure = () => {
      for (const node of element.querySelectorAll<HTMLElement>('[data-tab-id]')) {
        if (node.dataset.tabShape === 'whole') whole.current.set(node.dataset.tabId!, node.offsetWidth);
      }
      const room = element.clientWidth;
      const next = room === 0 ? WHOLE : fitTabs(room, tabs.map((tab) => ({ id: tab.id, whole: whole.current.get(tab.id) ?? MIN_TAB_PX })), shownId);
      // A tab that folds now while one of its glyphs holds the keyboard hands it to the tab's own button.
      const glyph = document.activeElement instanceof HTMLElement && document.activeElement.getAttribute('role') !== 'tab' ? document.activeElement : null;
      const holder = glyph && element.contains(glyph) ? glyph.closest<HTMLElement>('[data-tab-id]') : null;
      if (holder && holder.dataset.tabShape !== 'icon' && next.icons.has(holder.dataset.tabId!)) handKeyboardTo(holder.dataset.tabId!, group);
      setFit((previous) => (sameFit(previous, next) ? previous : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const node of element.children) observer.observe(node);
    return () => observer.disconnect();
  }, [list, tabs, shownId, fit, group]);
  return fit;
}

type TabShape = 'whole' | 'icon' | 'cut';

interface TabProps {
  tab: PanelTabRef;
  group: SideGroupName; // the group whose strip draws it
  selected: boolean;
  shape: TabShape;
  maxWidth: number | null;
  canPin: boolean;
  bodyId: string;
  onSelect(): void;
  moveTo: SideGroupName | null; // the group its menu offers to move it to
  onMove(to: SideGroupName): SideGroupName | null; // answers the group the tab ended up in
}

function Tab({ tab, group, selected, shape, maxWidth, canPin, bodyId, onSelect, moveTo, onMove }: TabProps) {
  const { tool, title, suffix } = useTabLabel(tab); // the header reads the same label (P3-G)
  const closing = usePanelHost((s) => s.closing.has(tab.id));
  const pinnable = tool ? tool.pinnable : true;
  const ToolIcon = tool?.icon;
  const label = suffix ? `${title} · ${suffix}` : title;
  const iconOnly = shape === 'icon';
  const revealed = selected ? '' : 'hidden group-hover:inline-flex group-focus-within:inline-flex'; // unrevealed glyphs take no width
  const record = usePanelRecord(tab.id); // P4-B3: the artifact it shows, which a drag moves to main
  useEffect(() => () => endDragFrom('panel', tab.id), [tab.id]); // INV-5: a tab unmounting mid-drag ends its drag
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (takesKeyboard(tab.id, group)) button.current?.focus();
  });
  // A move remounts the tab in the other strip, which takes the keyboard, or leaves it in this strip, focused already: the
  // menu's close after the move gives none back. Once: a tab that stayed is the same instance, and a later menu of its
  // dismissed gives the keyboard back to it as usual.
  const moved = useRef(false);

  const element = (
    <div
      data-tab-id={tab.id}
      data-tab-shape={shape}
      draggable={record !== null || undefined}
      onDragStart={record === null ? undefined : (event) => beginDrag(event, { source: 'panel', tabId: tab.id, toolId: tab.toolId, artifactId: record })}
      style={maxWidth === null ? undefined : { maxWidth }}
      className={`group flex h-7 shrink-0 items-center rounded-sm ${iconOnly ? 'w-7' : 'max-w-48 min-w-18'} ${selected ? 'bg-bg-active text-fg' : 'text-fg-muted hover:bg-bg-hover hover:text-fg'}`}
    >
      <button
        ref={button}
        type="button"
        role="tab"
        aria-selected={selected}
        aria-controls={selected ? bodyId : undefined}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        tabIndex={selected ? 0 : -1}
        onClick={onSelect}
        className={`flex h-full min-w-0 flex-1 items-center rounded-sm text-ui outline-accent focus-visible:outline-2 ${iconOnly ? 'justify-center' : 'gap-1.5 pr-1 pl-2'}`}
      >
        {ToolIcon ? <ToolIcon className="size-3.5 shrink-0" /> : iconOnly && <span aria-hidden>{title.slice(0, 1).toUpperCase()}</span>}
        {!iconOnly && (
          <span className="truncate">
            {title}
            {suffix && <span className="text-fg-faint"> · {suffix}</span>}
          </span>
        )}
      </button>
      {!iconOnly && pinnable && (
        <GlyphButton
          label={tab.pinned ? COPY.unpin(title) : COPY.pin(title)}
          pressed={tab.pinned}
          disabled={!canPin}
          className={tab.pinned ? 'text-fg' : revealed}
          onClick={() => togglePinned(tab.id)}
        >
          <PinIcon />
        </GlyphButton>
      )}
      {!iconOnly && (
        <GlyphButton label={COPY.close(title)} disabled={closing} className={revealed} onClick={() => void panelHost.closeTab(tab.id)}>
          <CloseIcon />
        </GlyphButton>
      )}
    </div>
  );
  // Every tab is a trigger, disabled while its menu would be empty, so a tab is not mounted again when its menu gains or
  // loses its items (a second tab opened, a group closed) and the keyboard stays on it.
  const toMain = panelTabMoves(tab);
  return (
    <ContextMenu.Root modal={false}>
      <ContextMenu.Trigger asChild disabled={!toMain && moveTo === null} onKeyDown={openMenuOnShiftF10}>{element}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content onCloseAutoFocus={(event) => {
            if (moved.current) event.preventDefault();
            moved.current = false;
          }} className="z-50 min-w-44 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg">
          {toMain && <MoveToMainItem tabId={tab.id} />}
          {moveTo !== null && (
            <ContextMenu.Item
              onSelect={() => {
                moved.current = true;
                if (onMove(moveTo) === group) button.current?.focus(); // still in this strip: no remount takes the keyboard
              }}
              className={MENU_ITEM}
            >
              {moveTo === 'lower' ? COPY.moveBelow : COPY.moveAbove}
            </ContextMenu.Item>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

const MENU_ITEM = 'flex h-7 cursor-default items-center rounded-sm px-2 outline-none select-none data-disabled:text-fg-faint data-highlighted:bg-bg-hover';

// Shift+F10 opens a tab's menu at the tab, as it opens an icon's (`SurfaceRow.tsx`).
function openMenuOnShiftF10(event: KeyboardEvent<HTMLDivElement>) {
  if (!event.shiftKey || event.key !== 'F10') return;
  event.preventDefault();
  const box = event.currentTarget.getBoundingClientRect();
  event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.left, clientY: box.bottom }));
}

// P4-B3 (M3 of the prior art): the record into a main tab, appended to the focused pane, as the record bar's Move to tab.
function MoveToMainItem({ tabId }: { tabId: string }) {
  const refusal = useTransferRefusal({ to: 'tab', panelTabId: tabId });
  return (
    <ContextMenu.Item
      disabled={refusal !== null}
      title={refusal ?? undefined}
      onSelect={() => void moveArtifactToTab(tabId)}
      className={MENU_ITEM}
    >
      {TRANSFER_COPY.moveToMain}
    </ContextMenu.Item>
  );
}

function GlyphButton(props: { label: string; pressed?: boolean; disabled?: boolean; className: string; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      aria-pressed={props.pressed}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className={`inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:pointer-events-none disabled:text-fg-faint ${props.className}`}
    >
      {props.children}
    </button>
  );
}

// The §5.6 order "+" lists tools in; any other registered tool follows in registration order.
const MENU_ORDER: readonly string[] = ['subagents', 'review', 'terminal', 'files', 'background', 'session-info'];

// "+": every registered tool offered from the menu, in the §5.6 order then registration order, less a single-instance
// tool that already has a tab here. With no session shown there is nothing for a tool to read, so it is disabled. R2:
// then the shown session's plugin panes under "Plugin panes", each selecting its pane's tab (added when it has none).
export function menuTools(tools: PanelHostState['tools'], tabs: PanelTabRef[]) {
  const rank = (id: string) => (MENU_ORDER.includes(id) ? MENU_ORDER.indexOf(id) : MENU_ORDER.length);
  return [...tools.values()]
    .filter((t) => t.menu !== false && (t.multiInstance || !tabs.some((r) => r.toolId === t.id)))
    .sort((a, b) => rank(a.id) - rank(b.id));
}

// "+" reads the scope's whole list (the pins, then the session's own), whichever group's strip it ends. Its tools open in
// that group (M3, decision 3); its menu is marked with the group, so an item that opens through an opener naming no group
// (a plugin pane's) finds it by the keyboard's place (`panel/host.ts`).
function AddMenu({ appSessionId, group }: { appSessionId: AppSessionId | null; group: SideGroupName }) {
  const tools = usePanelHost((s) => s.tools);
  const pinned = useLayout((s) => s.panelPinned);
  const own = useLayout((s) => (appSessionId === null ? undefined : s.panelBySession.get(appSessionId)?.tabs));
  const tabs = [...pinned, ...(own ?? [])];
  const panes = usePanes(appSessionId); // R2: the session's plugin panes, listed under their own heading
  if (appSessionId === null) {
    return (
      <IconButton label={COPY.addNoSession} disabled>
        <PlusIcon />
      </IconButton>
    );
  }
  const offered = menuTools(tools, tabs);
  const anyOffered = [...tools.values()].some((t) => t.menu !== false);
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <IconButton label={COPY.add}>
          <PlusIcon />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} data-side-group-menu={group} className="z-50 min-w-44 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg">
          {offered.length === 0 && (
            <DropdownMenu.Item disabled className="flex h-7 cursor-default items-center rounded-sm px-2 text-fg-faint outline-none select-none">
              {anyOffered ? COPY.allOpen : COPY.noTools}
            </DropdownMenu.Item>
          )}
          {offered.map((tool) => {
            const ToolIcon = tool.icon;
            return (
              <DropdownMenu.Item
                key={tool.id}
                onSelect={() => panelHost.addTool(tool.id, { appSessionId, group })}
                className="flex h-7 cursor-default items-center gap-2 rounded-sm px-2 outline-none select-none data-highlighted:bg-bg-hover"
              >
                <ToolIcon className="size-3.5 shrink-0 text-fg-muted" />
                {tool.title}
              </DropdownMenu.Item>
            );
          })}
          {panes.length > 0 && (
            <DropdownMenu.Group aria-label={PANE_COPY.menu}>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Label className="px-2 py-1 text-ui-sm text-fg-faint select-none">{PANE_COPY.menu}</DropdownMenu.Label>
              {panes.map((pane) => (
                <DropdownMenu.Item
                  key={pane.id}
                  onSelect={() => openPaneTab(appSessionId, pane.id)}
                  className="flex h-7 cursor-default items-center gap-2 rounded-sm px-2 outline-none select-none data-highlighted:bg-bg-hover"
                >
                  <span className="min-w-0 truncate">{pane.title || pane.id}</span>
                  <span className="ml-auto shrink-0 text-ui-sm text-fg-faint">{pane.plugin}</span>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Group>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// The strip's glyphs, drawn like the shell's 16 px stroke icons.
const PinIcon = () => (
  <Icon className="size-3">
    <path d="M6 2.5h4M7 2.5v4L4.5 9h7L9 6.5v-4M8 9v4.5" />
  </Icon>
);
const CloseIcon = () => (
  <Icon className="size-3">
    <path d="m4 4 8 8M12 4l-8 8" />
  </Icon>
);
const PlusIcon = () => (
  <Icon>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);
