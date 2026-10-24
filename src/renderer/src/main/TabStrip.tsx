// A pane's tab strip (§5.2, D-13; residue *Tab strip*): a custom `role="tablist"`, browser-like.
// One tab stop (the active tab); ArrowLeft and ArrowRight move focus along the strip, wrapping, Enter activates the
// focused tab and Delete closes it. Overflow scrolls horizontally with the active tab kept in view. Drops: a tab
// (`application/x-maws-tab`) moves to the pointer's position, computed against the tabs' midpoints, and a sidebar row
// (`application/x-maws-session`) opens its session there; P4-B3 (X38): a panel record (`application/x-maws-panel-tab`)
// moves there as a main tab, its insertion line labelled "Move to tab". Under a split the focused pane's strip carries an
// accent inset. W12 (I3): the strips show the current project's tab set; P3-F wave S (F17, the owner's obs 8): its name
// is the title bar's project chip (app/Toolbar.tsx), so the crowded strip carries tabs only.
import { DropdownMenu } from 'radix-ui';
import type { TabRef } from '@shared/ipc/schema/layout';
import { Icon, IconButton } from '../app/IconButton';
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { createSession, focusedProject, NEW_CHAT, requestCloseTab, useSessionCreatorRegistered } from '../keymap/actions-runtime';
import { SESSION_DRAG_TYPE } from '../sidebar/SessionRow';
import { dragAccepted, dropPanelRecord, endDrag, moveMainTab, PANEL_TAB_DRAG_TYPE } from '../shell/transfer'; // P4-B3
import { useLayout } from '../stores/layout';
import { currentSet } from '../stores/layout-model';
import { TRANSFER_COPY } from '../tools/artifacts/copy'; // P4-B3
import { Tab, useTabLabel, TAB_DRAG_TYPE } from './Tab';
import { useKeyChord } from '../keymap/useKeyChord';
import { focusPaneElement } from './pane-dom';

export { TAB_DRAG_TYPE };

type Pane = 0 | 1;

// Where a drop at `clientX` lands: before the first tab whose midpoint lies right of it. `left` is where the insertion
// line goes, in the strip's own coordinates.
function dropPoint(strip: HTMLElement, clientX: number): { index: number; left: number } {
  const tabs = [...strip.querySelectorAll<HTMLElement>('[role="tab"]')];
  const index = tabs.findIndex((t) => {
    const rect = t.getBoundingClientRect();
    return clientX < rect.left + rect.width / 2;
  });
  if (index !== -1) return { index, left: tabs[index].offsetLeft };
  const last = tabs.at(-1);
  return { index: tabs.length, left: last ? last.offsetLeft + last.offsetWidth : 0 };
}

// A panel tab is taken only while the drag under way is a record the transfer allows (P4-B3; a refused one never
// prevents the event, so the cursor says no-drop).
const panelRecord = (event: DragEvent) => event.dataTransfer.types.includes(PANEL_TAB_DRAG_TYPE) && dragAccepted('main');
const accepts = (event: DragEvent) => event.dataTransfer.types.includes(TAB_DRAG_TYPE) || event.dataTransfer.types.includes(SESSION_DRAG_TYPE) || panelRecord(event);

// Moves a tab (open anywhere) to `index` of `pane`, counting the index in the strip as it was seen, with the tab
// still in it.
const dropTab = (id: string, pane: Pane, index: number) => moveMainTab(id, pane, index, true);

export function TabStrip({ pane, split, idPrefix }: { pane: Pane; split: boolean; idPrefix: string }) {
  const state = useLayout((s) => currentSet(s.main).panes[pane]);
  const focused = useLayout((s) => currentSet(s.main).focusedPane === pane);
  const strip = useRef<HTMLDivElement>(null);
  // A strip portaled into the window chrome is outside its pane's native DOM. Own Ctrl+Tab here as well as in the pane.
  const cycle = (delta: 1 | -1) => {
    useLayout.getState().focusPane(pane);
    useLayout.getState().cycleTab(delta);
    requestAnimationFrame(() => focusPaneElement(pane));
  };
  useKeyChord('tab.next', () => cycle(1), { within: strip });
  useKeyChord('tab.previous', () => cycle(-1), { within: strip });
  // The insertion line's x while a drag hovers, and the outcome's label for a panel record (P4-B3, Z7).
  const [marker, setMarker] = useState<{ left: number; label: string | null; labelLeft: number } | null>(null);
  const activeTabId = state?.activeTabId;
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const measure = () => {
      setOverflow(element.scrollWidth > element.clientWidth + 1);
      element.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [state?.tabs]);

  // Keep the active tab in view.
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId]);

  if (!state) return null;
  const tabs = state.tabs;

  const onTabKeyDown = (index: number) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const tab = tabs[index];
    const focusAt = (i: number) => strip.current?.querySelectorAll<HTMLElement>('[role="tab"]')[(i + tabs.length) % tabs.length]?.focus();
    switch (event.key) {
      case 'ArrowRight':
        focusAt(index + 1);
        break;
      case 'ArrowLeft':
        focusAt(index - 1);
        break;
      case 'Enter':
        useLayout.getState().activateTab(tab.id);
        break;
      case 'Delete':
      case 'Backspace':
        // Every close path shares the guard and focus handoff in requestCloseTab.
        void requestCloseTab(tab.id);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!accepts(event)) return;
    event.preventDefault();
    const record = panelRecord(event);
    event.dataTransfer.dropEffect = record || event.dataTransfer.types.includes(TAB_DRAG_TYPE) ? 'move' : 'copy';
    const { left } = dropPoint(event.currentTarget, event.clientX);
    setMarker({ left, label: record ? TRANSFER_COPY.moveToTab : null, labelLeft: left - event.currentTarget.scrollLeft });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!accepts(event)) return;
    event.preventDefault();
    const { index } = dropPoint(event.currentTarget, event.clientX);
    setMarker(null);
    if (event.dataTransfer.types.includes(PANEL_TAB_DRAG_TYPE)) {
      endDrag();
      dropPanelRecord(event, { pane, index });
      return;
    }
    const tabId = event.dataTransfer.getData(TAB_DRAG_TYPE);
    const layout = useLayout.getState();
    if (tabId) {
      dropTab(tabId, pane, index);
      endDrag();
      return;
    }
    const appSessionId = event.dataTransfer.getData(SESSION_DRAG_TYPE) as AppSessionId;
    if (!appSessionId) return;
    const id = `session:${appSessionId}`;
    const shown = layout.main.current;
    if (currentSet(layout.main).panes.some((p) => p.tabs.some((t) => t.id === id))) {
      dropTab(id, pane, index);
      return;
    }
    // Opened after the active tab, then moved to the drop point; the index stays right because the new tab was not in
    // the strip the pointer saw. W12: a session of another project opens in its own project's set, which the strips
    // then show, so the drop point no longer applies.
    layout.openTab({ kind: 'session', appSessionId }, { pane });
    if (useLayout.getState().main.current === shown) useLayout.getState().moveTab(id, pane, index);
  };

  const label = split ? (pane === 0 ? 'Left pane tabs' : 'Right pane tabs') : 'Open tabs';
  const stop = tabs.some((t) => t.id === state.activeTabId) ? state.activeTabId : tabs[0]?.id;

  return (
    <div className="relative flex h-full min-w-0 items-stretch [-webkit-app-region:no-drag]">
      <div
        ref={strip}
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        data-focused={split && focused ? 'true' : undefined}
        onDragOver={onDragOver}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMarker(null);
        }}
        onDrop={onDrop}
        className="relative flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none]"
      >
        {tabs.map((tab, index) => (
          <Tab
            key={tab.id}
            tab={tab}
            pane={pane}
            domId={`${idPrefix}-tab-${index}`}
            active={tab.id === state.activeTabId}
            stop={tab.id === stop}
            onKeyDown={onTabKeyDown(index)}
          />
        ))}
        {marker !== null && (
          <span aria-hidden className="pointer-events-none absolute inset-y-1 w-0.5 -translate-x-1/2 bg-accent" style={{ left: marker.left }} />
        )}
      </div>
      {/* P4-B3 (Z7): the outcome, beside the line; outside the scrolling list, so it never clips or scrolls it. */}
      {marker?.label && (
        <span className="pointer-events-none absolute top-1/2 z-20 ml-1.5 -translate-y-1/2 rounded-sm border border-border-strong bg-bg-overlay px-1.5 py-0.5 text-ui-sm whitespace-nowrap text-fg shadow-float" style={{ left: marker.labelLeft }}>
          {marker.label}
        </span>
      )}
      {overflow && <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild><IconButton label="All tabs" className="self-center"><Icon><path d="m4 6 4 4 4-4" /></Icon></IconButton></DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={4} className="z-50 max-h-80 min-w-48 max-w-96 overflow-y-auto rounded-md border border-border-strong bg-bg-overlay p-1 text-fg shadow-float">
          <DropdownMenu.RadioGroup value={activeTabId ?? ''} onValueChange={(id) => { useLayout.getState().focusPane(pane); useLayout.getState().activateTab(id); }}>
            {tabs.map((tab) => <OverflowTab key={tab.id} tab={tab} />)}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>}
      <NewSessionButton pane={pane} />
      {/* The focused pane's mark under a split, drawn over the tabs rather than under their backgrounds. */}
      {split && focused && <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 bg-accent" />}
    </div>
  );
}

// §5.2's "+" at the strip's end: a New chat in this pane (2026-10-01), in the project whose tab set the strips show
// (W12), else in none. Disabled until a session creator is registered (C10; the stub's in launch mode scenario), like
// the sidebar's "+".
function NewSessionButton({ pane }: { pane: Pane }) {
  const canCreate = useSessionCreatorRegistered();
  return (
    <button
      type="button"
      aria-label={NEW_CHAT}
      title={canCreate ? NEW_CHAT : 'Not available here'}
      disabled={!canCreate}
      onClick={() => void createSession(focusedProject(), { pane })}
      className="mx-1 inline-flex size-7 shrink-0 items-center justify-center self-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent"
    >
      <span aria-hidden className="text-ui leading-none">
        +
      </span>
    </button>
  );
}

function OverflowTab({ tab }: { tab: TabRef }) {
  const label = useTabLabel(tab);
  return <DropdownMenu.RadioItem value={tab.id} className="flex min-h-8 items-center gap-2 rounded-sm px-2 py-1 text-ui outline-none data-highlighted:bg-bg-hover data-[state=checked]:bg-bg-active">
    <span>{label.title}{label.secondary && <small className="ml-2 text-fg-muted">{label.secondary}</small>}</span>
  </DropdownMenu.RadioItem>;
}
