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
// UX wave U6b-1 (docs/doperpowers/plans/2026-11-14-ux-wave-U6b-1-file-beside-chat.md, Decisions 6 and 16): a tab of Files
// that holds a file is titled by the file's name, in italics while it is the session's preview tab (`data-preview`),
// which a double-click on it keeps; it has no pin glyph. "+ ▸ Files" shows the tree-only tab the scope has (the tool's
// `reuse`) and adds one only when it has none. M2: while the file has unsaved edits the tab carries the dot a main file
// tab carries (`data-dirty`), read from the viewer's entry under the file's key. M4 (Interfaces §D; U8b's §C.3): every
// tab drags; a strip takes a tab dragged from the other group's strip, and the lower part of a one-group column takes
// one while the group has another (`LowerGroupDrop`), the tab kept either way; a tab whose tool has a main-tab form (an
// artifact's record, a file) also drags onto the main area's targets and its menu moves it there. The selected tab is
// scrolled into view, the nearest way, when it becomes selected and when the keyboard arrives on it, so no caller asks.
import { ContextMenu, DropdownMenu } from 'radix-ui';
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { PanelTabRef } from '@shared/ipc/schema/layout';
import { machineOf } from '@shared/machine/address';
import { Icon, IconButton } from '../app/IconButton';
import { useLayout, type LayoutState } from '../stores/layout';
import { RefusedMenuItem } from '../ui/refused-menu-item';
import { Tip } from '../ui/tip';
import { COPY } from './copy';
import { openPaneTab, usePanes } from '../engine-surface/panes'; // R2
import { PANE_COPY } from '../engine-surface/copy'; // R2
import { beginDrag, endDrag, endDragFrom, holdSideViews, moveToMain, panelTabMoves, panelTabOfDrop, usePanelRecord, useTransferRefusal } from '../shell/transfer'; // P4-B3
import { DropHighlight, DropOverlay } from '../shell/DropOverlay'; // UX wave U6b-1 (M4)
import { TRANSFER_COPY } from '../tools/artifacts/copy'; // P4-B3
import { EDITOR_COPY } from '../tools/code/copy'; // UX wave U6b-1
import { fileKey, fileOfTab, FILES_TOOL_ID, keep, pinnableTab, sideFileOf } from '../tools/code/files/tabs'; // UX wave U6b-1
import { useViewer } from '../tools/code/viewer/viewer-store'; // UX wave U6b-1
import { personsOpenBeside } from '../tools/code/open-file'; // UX wave U6e (decision 19): a person's click on a file's tab, or its move, is the person's open
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
    const landed = moveBetweenGroups(appSessionId, tabId, to);
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

  const drop = useGroupDrop(appSessionId, group);
  return (
    <div data-side-strip {...drop.handlers} className="relative flex h-9 min-w-0 shrink-0 items-center gap-1 border-b border-border px-1">
      {drop.over && <DropHighlight label={group === 'lower' ? COPY.moveBelow : COPY.moveAbove} className="inset-0 z-10" />}
      <div ref={list} role="tablist" aria-label="Panel tools" onKeyDown={onKeyDown} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {tabs.map((tab) => {
          const selected = tab.id === activeTabId;
          const shape: TabShape = fit.icons.has(tab.id) ? 'icon' : selected && fit.shownMax !== null ? 'cut' : 'whole';
          return <Tab key={tab.id} tab={tab} appSessionId={appSessionId} group={group} selected={selected} shape={shape} maxWidth={shape === 'cut' ? fit.shownMax : null} canPin={appSessionId !== null} bodyId={bodyId} onSelect={() => { panelHost.selectTab(tab.id); personsOpenBeside(tab.id); }} moveTo={moveTo} onMove={(to) => move(tab.id, to)} />;
        })}
      </div>
      <AddMenu appSessionId={appSessionId} group={group} />
      {trailing}
    </div>
  );
}

// ---- a side tab dragged between the groups (UX wave U6b-1, M4; U8's O-36) -------------------------------------------------

// The side tab under drag that may join `group`: one of the scope's tabs in the other group (a strip never takes its own
// group's tab; reordering inside a strip is nobody's), read from the drag state, since a `dragover` cannot read the payload.
function draggedInto(appSessionId: AppSessionId | null, group: SideGroupName, state: LayoutState = useLayout.getState()): string | null {
  const dragging = state.dragging;
  if (dragging?.source !== 'panel') return null;
  const from = groupOf(sideGroups(state, appSessionId), dragging.tabId);
  return from !== null && from !== group ? dragging.tabId : null;
}

// A side tab into the other group, by the drag or the menu, answering the group it ended in (`moveSurfaceTab` refuses a
// group's only tab when it would make the second group; a tab no list holds any more moves nothing). A file's view mounts again
// there, so its key is held first, as for a move to the main area (Decision 20b; the branch review's third finding): the
// prune of the view that goes, and the viewer's cap, leave its entry for the view that comes. A tab whose move was made
// is kept (Decision 6; the fifth finding: the menu's move as the drag's), wherever it lands: the upper group's only tab
// moved below joins both groups into the upper one.
function moveBetweenGroups(appSessionId: AppSessionId | null, tabId: string, to: SideGroupName): SideGroupName | null {
  const file = sideFileOf(tabId);
  if (file !== null) holdSideViews(file.key);
  const before = useLayout.getState();
  before.moveSurfaceTab(appSessionId, tabId, to);
  if (useLayout.getState() !== before) {
    keep(tabId); // a refused move sets nothing
    personsOpenBeside(tabId); // U6e (decision 19): the person's move, so the agent's mark goes, from a kept tab too
  }
  return groupOf(sideGroups(useLayout.getState(), appSessionId), tabId);
}

// The highlight shows while a drag the strip would take is over it; it goes with that drag, by whichever path the drag
// ends (a drop elsewhere, its source removed), and a later drag does not find it on.
function useGroupDrop(appSessionId: AppSessionId | null, group: SideGroupName) {
  const [over, setOver] = useState(false);
  const live = useLayout((state) => draggedInto(appSessionId, group, state) !== null);
  if (over && !live) setOver(false);
  const accept = (event: DragEvent) => {
    if (draggedInto(appSessionId, group) === null) return false;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    return true;
  };
  const handlers = {
    onDragEnter: (event: DragEvent) => void (accept(event) && setOver(true)),
    onDragOver: accept,
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
    },
    onDrop: (event: DragEvent) => {
      setOver(false);
      const tabId = draggedInto(appSessionId, group);
      if (tabId === null || (panelTabOfDrop(event)?.tabId ?? tabId) !== tabId) return;
      event.preventDefault();
      endDrag();
      moveBetweenGroups(appSessionId, tabId, group);
    },
  };
  return { over: over && live, handlers };
}

// The lower part of a column with one group, a target while one of its tabs drags and the group has another to keep;
// the drop makes the second group with that tab (U8's "a drag of the tab onto the lower part of the column").
export function LowerGroupDrop({ appSessionId }: { appSessionId: AppSessionId | null }) {
  const tabId = useLayout((s) => {
    const groups = sideGroups(s, appSessionId);
    const dragging = s.dragging;
    if (dragging?.source !== 'panel' || groups.lower !== null || groups.upper.tabs.length < 2) return null;
    return groups.upper.tabs.some((tab) => tab.id === dragging.tabId) ? dragging.tabId : null;
  });
  if (tabId === null) return null;
  return (
    <div data-side-lower-drop className="absolute inset-x-0 bottom-0 z-20 h-1/2">
      <DropOverlay accepts label={COPY.moveBelow} onDrop={() => void moveBetweenGroups(appSessionId, tabId, 'lower')} />
    </div>
  );
}

// ---- the selected tab kept in view (UX wave U6b-1, M4) ---------------------------------------------------------------------

// The strip scrolls by the least that shows the whole tab; nothing else scrolls (no ancestor, no window).
function revealTab(tab: HTMLElement | null): void {
  const strip = tab?.parentElement;
  if (!tab || !strip) return;
  const box = strip.getBoundingClientRect();
  const at = tab.getBoundingClientRect();
  if (at.left < box.left) strip.scrollLeft -= box.left - at.left;
  else if (at.right > box.right) strip.scrollLeft += Math.min(at.right - box.right, at.left - box.left);
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
  appSessionId: AppSessionId | null; // the strip's scope: the session whose list holds a file's tab
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

function Tab({ tab, appSessionId, group, selected, shape, maxWidth, canPin, bodyId, onSelect, moveTo, onMove }: TabProps) {
  const label = useTabLabel(tab); // the header reads the same label (P3-G)
  const { tool, suffix } = label;
  const params = useLayout((s) => s.panelParams[tab.id]);
  const file = tab.toolId === FILES_TOOL_ID ? fileOfTab(params) : null; // UX wave U6b-1
  const title = file ? file.file.slice(file.file.lastIndexOf('/') + 1) : label.title;
  const preview = file?.preview === true;
  const dirty = useViewer((s) => file !== null && appSessionId !== null && (s.entries.get(fileKey(machineOf(appSessionId), file.file))?.dirty ?? false));
  const closing = usePanelHost((s) => s.closing.has(tab.id));
  const pinnable = (tool ? tool.pinnable : true) && pinnableTab(params);
  const ToolIcon = tool?.icon;
  const name = suffix ? `${title} · ${suffix}` : title;
  const iconOnly = shape === 'icon';
  const revealed = selected ? '' : 'hidden group-hover:inline-flex group-focus-within:inline-flex'; // unrevealed glyphs take no width
  const record = usePanelRecord(tab.id); // P4-B3: the artifact it shows, which a drag moves to main
  // INV-5: a tab unmounting mid-drag ends its drag; UX wave U6b-1 (sequence 7): so does a file's tab given another file
  const held = file?.file ?? null;
  useEffect(() => () => endDragFrom('panel', tab.id), [tab.id, held]);
  const button = useRef<HTMLButtonElement>(null);
  const outer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (takesKeyboard(tab.id, group)) button.current?.focus();
  });
  // UX wave U6b-1: in view when it becomes selected (by the host, a click, an opener), and again when its shape changes
  // under the selection (a tab drawn as its icon until now grows)
  useLayoutEffect(() => {
    if (selected) revealTab(outer.current);
  }, [selected, shape, maxWidth]);
  // A move remounts the tab in the other strip, which takes the keyboard, or leaves it in this strip, focused already: the
  // menu's close after the move gives none back. Once: a tab that stayed is the same instance, and a later menu of its
  // dismissed gives the keyboard back to it as usual.
  const moved = useRef(false);

  const element = (
    <div
      ref={outer}
      data-tab-id={tab.id}
      data-tab-shape={shape}
      data-preview={preview ? 'true' : undefined}
      data-dirty={dirty ? 'true' : undefined}
      draggable
      onDragStart={(event) => beginDrag(event, { source: 'panel', tabId: tab.id, toolId: tab.toolId, ...(record !== null ? { artifactId: record } : {}) })}
      style={maxWidth === null ? undefined : { maxWidth }}
      className={`group flex h-7 shrink-0 items-center rounded-sm ${iconOnly ? 'w-7' : 'max-w-48 min-w-18'} ${selected ? 'bg-bg-active text-fg' : 'text-fg-muted hover:bg-bg-hover hover:text-fg'}`}
    >
      {/* UX wave U6e (decision 11): a file's tab has its full path as its tooltip and its description; a tab drawn as its
          icon alone has its name as its tooltip (ticket 815: a Tip the keyboard reaches, no longer a system title) */}
      <Tip content={file ? file.file : iconOnly ? name : null} description={file?.file}>
        <button
          ref={button}
          type="button"
          role="tab"
          aria-selected={selected}
          aria-controls={selected ? bodyId : undefined}
          aria-label={iconOnly ? name : undefined}
          tabIndex={selected ? 0 : -1}
          onClick={onSelect}
          onFocus={() => revealTab(outer.current)} // the F6 stop and the arrows focus without scrolling
          onDoubleClick={preview ? () => keep(tab.id) : undefined}
          className={`flex h-full min-w-0 flex-1 items-center rounded-sm text-ui outline-accent focus-visible:outline-2 ${iconOnly ? 'justify-center' : 'gap-1.5 pr-1 pl-2'}`}
        >
          {ToolIcon ? <ToolIcon className="size-3.5 shrink-0" /> : iconOnly && <span aria-hidden>{title.slice(0, 1).toUpperCase()}</span>}
          {!iconOnly && (
            <span className={preview ? 'truncate italic' : 'truncate'}>
              {title}
              {suffix && <span className="text-fg-faint"> · {suffix}</span>}
            </span>
          )}
        </button>
      </Tip>
      {!iconOnly && dirty && (
        <span role="img" aria-label={EDITOR_COPY.unsaved} className="shrink-0 px-0.5 text-fg">
          •
        </span>
      )}
      {!iconOnly && pinnable && (
        <GlyphButton
          label={tab.pinned ? COPY.unpin(title) : COPY.pin(title)}
          tip={tab.pinned ? COPY.unpinTip : COPY.pinTip}
          pressed={tab.pinned}
          disabled={!canPin}
          className={tab.pinned ? 'text-fg' : revealed}
          onClick={() => togglePinned(tab.id)}
        >
          <PinIcon />
        </GlyphButton>
      )}
      {!iconOnly && (
        <GlyphButton label={COPY.close(title)} tip={COPY.closeTip} disabled={closing} className={revealed} onClick={() => void panelHost.closeTab(tab.id)}>
          <CloseIcon />
        </GlyphButton>
      )}
    </div>
  );
  // Every tab is a trigger, disabled while its menu would be empty, so a tab is not mounted again when its menu gains or
  // loses its items (a second tab opened, a group closed) and the keyboard stays on it.
  const toMain = panelTabMoves(tab, params); // the subscribed params: a file given to a tree-only tab shows here
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

const MENU_ITEM = 'flex h-7 cursor-default items-center rounded-sm px-2 outline-none select-none data-disabled:text-fg-faint aria-disabled:text-fg-faint data-highlighted:bg-bg-hover';

// Shift+F10 opens a tab's menu at the tab, as it opens an icon's (`SurfaceRow.tsx`).
function openMenuOnShiftF10(event: KeyboardEvent<HTMLDivElement>) {
  if (!event.shiftKey || event.key !== 'F10') return;
  event.preventDefault();
  const box = event.currentTarget.getBoundingClientRect();
  event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.left, clientY: box.bottom }));
}

// P4-B3 (M3 of the prior art): the record into a main tab, appended to the focused pane, as the record bar's Move to tab;
// UX wave U6b-1: a file likewise.
function MoveToMainItem({ tabId }: { tabId: string }) {
  const refusal = useTransferRefusal({ to: 'tab', panelTabId: tabId });
  if (refusal !== null) return <RefusedMenuItem kit={ContextMenu} label={TRANSFER_COPY.moveToMain} reason={refusal} className={MENU_ITEM} />; // the word cut (N94's pattern)
  return (
    <ContextMenu.Item onSelect={() => void moveToMain(tabId)} className={MENU_ITEM}>
      {TRANSFER_COPY.moveToMain}
    </ContextMenu.Item>
  );
}

// The word cut (P11): the glyph's tooltip is its verb alone ("Pin", "Close"), a Tip the keyboard reaches; its accessible
// name keeps the tab's title ("Pin Terminal"), which the tooltip does not repeat as a description.
function GlyphButton(props: { label: string; tip: string; pressed?: boolean; disabled?: boolean; className: string; onClick(): void; children: ReactNode }) {
  return (
    <Tip content={props.tip}>
      <button
        type="button"
        aria-label={props.label}
        aria-describedby={undefined}
        aria-pressed={props.pressed}
        disabled={props.disabled}
        onClick={props.onClick}
        className={`inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:pointer-events-none disabled:text-fg-faint ${props.className}`}
      >
        {props.children}
      </button>
    </Tip>
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
      <IconButton label={COPY.add} unavailable={COPY.addNoSession}>
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
