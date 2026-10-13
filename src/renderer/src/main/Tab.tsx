// One tab of a pane's strip (§5.2; mockup 01 `.tab`; residue *Tab strip*): the status glyph of a session, the title,
// the project as `small`, and a close control revealed on hover and focus. It is a `div role="tab"` rather than a
// button because it holds that inner button and native drag attributes. A middle-click closes it; its context menu
// pins it, moves it to the other pane and closes it or the others. (The Overview is no tab since W5: it floats over the
// main area.)
import { ContextMenu } from 'radix-ui';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { UNPINNABLE_KINDS, type TabRef } from '@shared/ipc/schema/layout';
import { PinIcon, useChordHint } from '../app/IconButton';
import { GlyphMark } from '../attention/GlyphMark';
import { glyphFor, type Glyph } from '../attention/glyph';
import { requestCloseTab, useUnstartedTitle } from '../keymap/actions-runtime';
import { selectEndedWithErrorOf, selectPendingOf, useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { currentSet } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { displayTitle } from '../sessions/title';
// E5 start
import { EDITOR_COPY } from '../tools/code/copy';
import { useViewer } from '../tools/code/viewer/viewer-store';
// E5 end
// E2 start
import { DELIVERABLES_COPY } from '../tools/deliverables/copy';
import { useDeliverableTitle } from '../tools/deliverables/store';
// E2 end
// P3-L start
import { LIBRARY_COPY } from '../library/copy';
import { useArtifactTitle } from '../library/store';
// P3-L end
// E4a start
import { BROWSER_COPY } from '../tools/browser/copy';
import { useBrowserTitle } from '../tools/browser/store';
// E4a end

export const TAB_DRAG_TYPE = 'application/x-maws-tab';

export interface TabLabel {
  title: string;
  secondary: string | null;
  glyph: Glyph | null;
  fileType: string | null; // a file tab's extension, as the mockup marks it
}

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;
const extension = (path: string) => {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : null;
};

function useProjectName(appSessionId: AppSessionId | null): string | null {
  return useSessions((s) => {
    const projectId = appSessionId ? s.records.get(appSessionId)?.projectId : null;
    return projectId ? (s.projects.get(projectId)?.name ?? null) : null;
  });
}

// A session tab's label: the record's title, project and glyph; with no record yet it is an unstarted session, titled
// through `registerUnstartedTitle` and without a glyph.
function useSessionLabel(appSessionId: AppSessionId): TabLabel {
  const record = useSessions((s) => s.records.get(appSessionId));
  const digest = useSessions((s) => s.digests.get(appSessionId));
  const pending = useAttention((s) => selectPendingOf(s, appSessionId));
  const ended = useAttention((s) => selectEndedWithErrorOf(s, appSessionId)); // E11 F2b
  const project = useProjectName(appSessionId);
  const unstarted = useUnstartedTitle(appSessionId);
  if (!record) return { title: unstarted.title, secondary: unstarted.project, glyph: null, fileType: null };
  return { title: displayTitle(record), secondary: project, glyph: glyphFor(record, digest ?? null, pending, ended), fileType: null };
}

function useTabLabel(tab: TabRef): TabLabel {
  const appSessionId = tab.kind === 'session' || tab.kind === 'agent' ? tab.appSessionId : ('' as AppSessionId);
  const session = useSessionLabel(appSessionId);
  const deliverableTitle = useDeliverableTitle(tab.kind === 'deliverable' ? tab.appSessionId : null, tab.kind === 'deliverable' ? tab.deliverableId : null); // E2
  const browserTitle = useBrowserTitle(tab.kind === 'browser' ? tab.appSessionId : null, tab.kind === 'browser' ? tab.browserTabId : null); // E4a
  const artifactTitle = useArtifactTitle(tab.kind === 'artifact' ? tab.artifactId : null); // P3-L
  switch (tab.kind) {
    case 'session':
      return session;
    case 'agent':
      return { title: session.title, secondary: 'agent', glyph: null, fileType: null };
    case 'file':
      return { title: basename(tab.path), secondary: null, glyph: null, fileType: extension(tab.path) };
    case 'diff':
      return { title: `Diff · ${tab.ref}`, secondary: null, glyph: null, fileType: null };
    case 'diagnostics':
      return { title: 'Diagnostics', secondary: null, glyph: null, fileType: null };
    case 'settings':
      return { title: 'Settings', secondary: null, glyph: null, fileType: null };
    case 'artifacts': // P3-G
      return { title: 'Artifacts', secondary: null, glyph: null, fileType: null };
    case 'artifact': // P3-L
      return { title: artifactTitle ?? LIBRARY_COPY.fallbackTitle, secondary: null, glyph: null, fileType: null };
    case 'deliverable': // E2
      return { title: deliverableTitle ?? DELIVERABLES_COPY.fallbackTitle, secondary: null, glyph: null, fileType: null };
    case 'browser': // E4a
      return { title: browserTitle ?? BROWSER_COPY.title, secondary: null, glyph: null, fileType: null };
  }
}

// E11 F2b (plan 2.5; owner decision 2): opening a session replaces the shown tab unless it is pinned.
export const PINNED_HINT = 'Pinned: stays open when you open another session';

export interface TabProps {
  tab: TabRef;
  pane: 0 | 1;
  domId: string;
  active: boolean;
  stop: boolean; // the strip's one tab stop
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
}

export function Tab({ tab, pane, domId, active, stop, onKeyDown }: TabProps) {
  const label = useTabLabel(tab);
  const name = label.secondary ? `${label.title} · ${label.secondary}` : label.title;
  const closeChord = useChordHint('tab.close');
  const dirty = useFileTabDirty(tab); // E5

  const onAuxClick = (event: MouseEvent) => {
    if (event.button === 1) void requestCloseTab(tab.id);
  };

  const element = (
    <div
      role="tab"
      id={domId}
      aria-selected={active}
      aria-label={name}
      tabIndex={stop ? 0 : -1}
      data-tab-id={tab.id}
      data-dirty={dirty ? 'true' : undefined} // E5
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(TAB_DRAG_TYPE, tab.id);
        event.dataTransfer.effectAllowed = 'move';
        useLayout.getState().setDragging({ tabId: tab.id, fromPane: pane });
      }}
      onDragEnd={() => useLayout.getState().setDragging(null)}
      onClick={() => useLayout.getState().activateTab(tab.id)}
      onMouseDown={(event) => event.button === 1 && event.preventDefault()} // no autoscroll on a middle press
      onAuxClick={onAuxClick}
      onKeyDown={onKeyDown}
      className={`group/tab relative flex max-w-60 shrink-0 cursor-default items-center gap-1.5 border-r border-border px-2.5 text-ui-sm whitespace-nowrap outline-accent select-none focus-visible:outline-2 focus-visible:-outline-offset-2 ${
        active ? 'bg-bg-raised text-fg shadow-[inset_0_-2px_0_0_var(--accent)]' : 'text-fg-muted hover:bg-bg-hover hover:text-fg'
      }`}
    >
      {label.glyph && <GlyphMark glyph={label.glyph} />}
      {label.fileType && <span className="font-mono text-info">{label.fileType}</span>}
      {/* E11 F2b (plan 2.5): a pin you can see, saying what it does */}
      {tab.pinned && (
        <span aria-label="Pinned" role="img" title={PINNED_HINT} className="inline-flex shrink-0 text-fg-muted">
          <PinIcon className="size-[11px]" />
        </span>
      )}
      {dirty && <DirtyMark />}{/* E5 */}
      <span className="truncate">{label.title}</span>
      {label.secondary && <small className="shrink-0 text-fg-muted">{label.secondary}</small>}
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Close ${label.title}`}
        title={closeChord ? `Close tab · ${closeChord}` : 'Close tab'}
        onClick={(event) => {
          event.stopPropagation();
          void requestCloseTab(tab.id);
        }}
        className={`-mr-1 ml-0.5 inline-flex size-4 items-center justify-center rounded-sm text-fg-muted hover:bg-bg-active hover:text-fg ${
          active ? '' : 'invisible group-hover/tab:visible group-focus-visible/tab:visible'
        }`}
      >
        <span aria-hidden>×</span>
      </button>
    </div>
  );

  return (
    <ContextMenu.Root modal={false}>
      <ContextMenu.Trigger asChild>{element}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content data-tab-focus-owner={tab.id} className="z-50 min-w-44 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg">
          {!UNPINNABLE_KINDS.has(tab.kind) && (
            <TabMenuItem onSelect={() => useLayout.getState().togglePinned(tab.id)}>{tab.pinned ? 'Unpin tab' : 'Pin tab'}</TabMenuItem>
          )}
          <TabMenuItem onSelect={() => moveToOtherPane(tab.id, pane)}>Move to other pane</TabMenuItem>
          <ContextMenu.Separator className="my-1 h-px bg-border" />
          <TabMenuItem onSelect={() => void requestCloseTab(tab.id)}>Close tab</TabMenuItem>
          <TabMenuItem onSelect={() => void closeOthers(tab.id, pane)}>Close other tabs</TabMenuItem>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function TabMenuItem({ children, onSelect }: { children: string; onSelect(): void }) {
  return (
    <ContextMenu.Item
      onSelect={onSelect}
      className="flex h-7 cursor-default items-center rounded-sm px-2 outline-none select-none data-disabled:text-fg-faint data-highlighted:bg-bg-hover"
    >
      {children}
    </ContextMenu.Item>
  );
}

function moveToOtherPane(id: string, pane: 0 | 1) {
  const layout = useLayout.getState();
  const to = pane === 0 ? 1 : 0;
  layout.moveTab(id, to, currentSet(layout.main).panes[to]?.tabs.length ?? 0);
}

// The pane's other tabs, except the pinned ones, each through its close guard.
async function closeOthers(id: string, pane: 0 | 1) {
  const others = currentSet(useLayout.getState().main).panes[pane]?.tabs.filter((t) => t.id !== id && !t.pinned) ?? [];
  for (const other of others) await requestCloseTab(other.id);
}

// E5 start: a file tab with unsaved edits (E5 execution document, M2's decisions): a dot before the title and
// `data-dirty`, from the viewer store, which is already in the main chunk.
function useFileTabDirty(tab: TabRef): boolean {
  return useViewer((s) => tab.kind === 'file' && (s.entries.get(tab.id)?.dirty ?? false));
}

function DirtyMark() {
  return (
    <span role="img" aria-label={EDITOR_COPY.unsaved} className="shrink-0 text-fg">
      •
    </span>
  );
}
// E5 end
