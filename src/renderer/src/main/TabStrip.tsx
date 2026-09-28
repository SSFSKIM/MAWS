// A pane's tab strip (§5.2, D-13; residue *Tab strip*): a custom `role="tablist"`, browser-like, the Overview first.
// One tab stop (the active tab); ArrowLeft and ArrowRight move focus along the strip, wrapping, Enter activates the
// focused tab and Delete closes it. Overflow scrolls horizontally with the active tab kept in view. Drops: a tab
// (`application/x-maws-tab`) moves to the pointer's position, computed against the tabs' midpoints, and a sidebar row
// (`application/x-maws-session`) opens its session there. Under a split the focused pane's strip carries an accent
// inset.
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { requestCloseTab } from '../keymap/actions-runtime';
import { SESSION_DRAG_TYPE } from '../sidebar/SessionRow';
import { useLayout } from '../stores/layout';
import { Tab, TAB_DRAG_TYPE } from './Tab';

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

const accepts = (event: DragEvent) => event.dataTransfer.types.includes(TAB_DRAG_TYPE) || event.dataTransfer.types.includes(SESSION_DRAG_TYPE);

// Moves a tab (open anywhere) to `index` of `pane`, counting the index in the strip as it was seen, with the tab
// still in it.
function dropTab(id: string, pane: Pane, index: number) {
  const layout = useLayout.getState();
  const from = layout.main.panes[pane]?.tabs.findIndex((t) => t.id === id) ?? -1;
  layout.moveTab(id, pane, from !== -1 && from < index ? index - 1 : index);
}

export function TabStrip({ pane, split, idPrefix }: { pane: Pane; split: boolean; idPrefix: string }) {
  const state = useLayout((s) => s.main.panes[pane]);
  const focused = useLayout((s) => s.main.focusedPane === pane);
  const strip = useRef<HTMLDivElement>(null);
  const [marker, setMarker] = useState<number | null>(null); // the insertion line's x while a drag hovers
  const activeTabId = state?.activeTabId;

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
        if (tab.kind === 'overview') return;
        focusAt(index === tabs.length - 1 ? index - 1 : index + 1);
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
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes(TAB_DRAG_TYPE) ? 'move' : 'copy';
    setMarker(dropPoint(event.currentTarget, event.clientX).left);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!accepts(event)) return;
    event.preventDefault();
    const { index } = dropPoint(event.currentTarget, event.clientX);
    setMarker(null);
    const tabId = event.dataTransfer.getData(TAB_DRAG_TYPE);
    const layout = useLayout.getState();
    if (tabId) {
      dropTab(tabId, pane, index);
      layout.setDragging(null);
      return;
    }
    const appSessionId = event.dataTransfer.getData(SESSION_DRAG_TYPE) as AppSessionId;
    if (!appSessionId) return;
    const id = `session:${appSessionId}`;
    const open = layout.main.panes.some((p) => p.tabs.some((t) => t.id === id));
    if (open) {
      dropTab(id, pane, index);
      return;
    }
    // Opened after the active tab, then moved to the drop point; the index stays right because the new tab was not in
    // the strip the pointer saw.
    layout.openTab({ kind: 'session', appSessionId }, { pane });
    useLayout.getState().moveTab(id, pane, index);
  };

  const label = split ? (pane === 0 ? 'Left pane tabs' : 'Right pane tabs') : 'Open tabs';
  const stop = tabs.some((t) => t.id === state.activeTabId) ? state.activeTabId : tabs[0]?.id;

  return (
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
      className={`relative flex h-10 shrink-0 items-stretch overflow-x-auto border-b border-border [scrollbar-width:none] ${
        split && focused ? 'shadow-[inset_0_2px_0_0_var(--accent)]' : ''
      }`}
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
        <span aria-hidden className="pointer-events-none absolute inset-y-1 w-0.5 -translate-x-1/2 bg-accent" style={{ left: marker }} />
      )}
    </div>
  );
}
