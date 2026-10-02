// A pane's tab strip (§5.2, D-13; residue *Tab strip*): a custom `role="tablist"`, browser-like.
// One tab stop (the active tab); ArrowLeft and ArrowRight move focus along the strip, wrapping, Enter activates the
// focused tab and Delete closes it. Overflow scrolls horizontally with the active tab kept in view. Drops: a tab
// (`application/x-maws-tab`) moves to the pointer's position, computed against the tabs' midpoints, and a sidebar row
// (`application/x-maws-session`) opens its session there. Under a split the focused pane's strip carries an accent
// inset. W12 (I3): the strips show the current project's tab set, whose name labels the left one.
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { NO_PROJECT } from '@shared/ipc/schema/layout';
import { FolderIcon } from '../app/IconButton';
import { createSession, focusedProject, NEW_CHAT, requestCloseTab, useSessionCreatorRegistered } from '../keymap/actions-runtime';
import { revealProject } from '../sidebar/reveal';
import { SESSION_DRAG_TYPE } from '../sidebar/SessionRow';
import { useLayout } from '../stores/layout';
import { currentSet, isOpen } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { focusPaneElement } from './pane-dom';
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
  const from = currentSet(layout.main).panes[pane]?.tabs.findIndex((t) => t.id === id) ?? -1;
  layout.moveTab(id, pane, from !== -1 && from < index ? index - 1 : index);
}

export function TabStrip({ pane, split, idPrefix }: { pane: Pane; split: boolean; idPrefix: string }) {
  const state = useLayout((s) => currentSet(s.main).panes[pane]);
  const focused = useLayout((s) => currentSet(s.main).focusedPane === pane);
  const strip = useRef<HTMLDivElement>(null);
  const [marker, setMarker] = useState<number | null>(null); // the insertion line's x while a drag hovers
  const activeTabId = state?.activeTabId;

  // Keep the active tab in view.
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId]);

  // After a keyboard close, focus goes to the tab that took the closed one's place (or the new last tab), or, when the
  // pane survives with none (the only pane's last tab), to the empty pane's own controls.
  const refocus = useRef<{ id: string; index: number } | null>(null);
  const stripTabs = state?.tabs;
  useEffect(() => {
    const pending = refocus.current;
    if (!pending || stripTabs?.some((t) => t.id === pending.id)) return;
    refocus.current = null;
    const remaining = strip.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [];
    if (remaining.length === 0) focusPaneElement(pane);
    else remaining[Math.min(pending.index, remaining.length - 1)].focus();
  }, [stripTabs, pane]);

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
        // Focus stays on the tab while its guard decides; only a close that happens hands it to the neighbour (the
        // effect below, once the tab has left the strip).
        refocus.current = { id: tab.id, index };
        void requestCloseTab(tab.id).then(() => {
          const main = useLayout.getState().main;
          if (isOpen(main, tab.id)) refocus.current = null; // kept
          else if (!currentSet(main).panes[pane]) focusPaneElement(0); // the pane collapsed with its last tab
        });
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
    <div className="relative flex h-10 shrink-0 items-stretch border-b border-border">
      {pane === 0 && <ProjectLabel />}
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
        className="relative flex min-w-0 items-stretch overflow-x-auto [scrollbar-width:none]"
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
      <NewSessionButton pane={pane} />
      {/* The focused pane's mark under a split, drawn over the tabs rather than under their backgrounds. */}
      {split && focused && <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 bg-accent" />}
    </div>
  );
}

// W12 (§5.2 as amended 2026-10-01): the name of the project whose tab set the strips show, at the left strip's edge, so a
// strip that changed with a project is never a surprise; a click reveals the project in the sidebar. The no-project set
// (and a project the index no longer lists) shows none.
function ProjectLabel() {
  const current = useLayout((s) => s.main.current);
  const project = useSessions((s) => (current === NO_PROJECT ? undefined : s.projects.get(current)));
  if (!project) return null;
  return (
    <button
      type="button"
      data-strip-project={project.id}
      aria-label={`Tabs of ${project.name}`}
      title={`Reveal ${project.name} in the sidebar`}
      onClick={() => revealProject(project.id)}
      className="flex max-w-48 shrink-0 items-center gap-1.5 border-r border-border px-2.5 text-ui-sm text-fg-muted outline-accent select-none hover:bg-bg-hover hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2"
    >
      <FolderIcon className="size-[12px] shrink-0" />
      <span className="truncate">{project.name}</span>
    </button>
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
