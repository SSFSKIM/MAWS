// One tab of a pane's strip (§5.2; mockup 01 `.tab`; residue *Tab strip*): the status glyph of a session, the title,
// the project as `small`, and a close control revealed on hover and focus. It is a `div role="tab"` rather than a
// button because it holds that inner button and native drag attributes. A middle-click closes it; its context menu
// pins it, moves it to the other pane and closes it or the others. The Overview has no close control, no menu and
// does not drag: it is first and permanent.
import { ContextMenu } from 'radix-ui';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { UNPINNABLE_KINDS, type TabRef } from '@shared/ipc/schema/layout';
import { useChordHint } from '../app/IconButton';
import { GlyphMark } from '../attention/GlyphMark';
import { glyphFor, type Glyph } from '../attention/glyph';
import { requestCloseTab, useUnstartedTitle } from '../keymap/actions-runtime';
import { selectPendingOf, useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';

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
  const project = useProjectName(appSessionId);
  const unstarted = useUnstartedTitle(appSessionId);
  if (!record) return { title: unstarted.title, secondary: unstarted.project, glyph: null, fileType: null };
  return { title: record.title.text, secondary: project, glyph: glyphFor(record, digest ?? null, pending), fileType: null };
}

function useTabLabel(tab: TabRef): TabLabel {
  const appSessionId = tab.kind === 'session' || tab.kind === 'agent' ? tab.appSessionId : ('' as AppSessionId);
  const session = useSessionLabel(appSessionId);
  switch (tab.kind) {
    case 'overview':
      return { title: 'Overview', secondary: null, glyph: null, fileType: null };
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
    case 'accounts':
      return { title: 'Accounts', secondary: null, glyph: null, fileType: null };
    case 'settings':
      return { title: 'Settings', secondary: null, glyph: null, fileType: null };
  }
}

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
  const permanent = tab.kind === 'overview';
  const closeChord = useChordHint('tab.close');

  const onAuxClick = (event: MouseEvent) => {
    if (event.button === 1 && !permanent) void requestCloseTab(tab.id);
  };

  const element = (
    <div
      role="tab"
      id={domId}
      aria-selected={active}
      aria-label={name}
      tabIndex={stop ? 0 : -1}
      data-tab-id={tab.id}
      draggable={!permanent}
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
      {tab.pinned && !permanent && <span aria-label="Pinned" role="img" className="size-1 shrink-0 rounded-full bg-fg-muted" />}
      <span className="truncate">{label.title}</span>
      {label.secondary && <small className="shrink-0 text-fg-muted">{label.secondary}</small>}
      {!permanent && (
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
      )}
    </div>
  );

  if (permanent) return element;
  return (
    <ContextMenu.Root modal={false}>
      <ContextMenu.Trigger asChild>{element}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-44 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg">
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
  layout.moveTab(id, to, layout.main.panes[to]?.tabs.length ?? 0);
}

// The pane's other tabs, except the pinned ones and the Overview, each through its close guard.
async function closeOthers(id: string, pane: 0 | 1) {
  const others = useLayout.getState().main.panes[pane]?.tabs.filter((t) => t.id !== id && !t.pinned) ?? [];
  for (const other of others) await requestCloseTab(other.id);
}
