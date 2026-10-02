// The sidebar (§5.1 as amended 2026-10-01, W11; C5 execution document, M3): Codex's flat tree under the New chat row and
// one search field. The project rows, most recently active first, five of them and then "Show more" for the rest, with
// Other sessions last; each expands in place to its sessions (`ProjectRow.tsx`), and which are expanded persists in the
// `regions` layout key (`expandedProjects`), so a relaunch shows what the person left; the search and the "Show more"
// reveals do not persist. The search filters every project (by name, or holding a matching session) and shows each
// listed project open on its matching sessions without changing what is expanded. Cross-project attention is the
// Overview's, the notifier's, the dock badge's and ⌘⇧J's, which read the attention table directly. One context menu
// serves every row, and the tree is one roving tab stop (`tree.ts`). A project removed from the sidebar (I5) is listed
// nowhere, its sessions with it, and "Hidden projects…" at the end offers it back.
import { ContextMenu, DropdownMenu } from 'radix-ui';
import { Fragment, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from 'react';
import type { SessionRecord } from '@shared/graph/session';
import { FolderIcon, GearIcon, IconButton, PlusIcon, SortIcon } from '../app/IconButton';
import { useChordHint } from '../app/IconButton'; // C11
import { createSession, focusedProject, NEW_CHAT, useSessionCreatorRegistered } from '../keymap/actions-runtime';
import { runAction, useActionEnabled } from '../keymap/actions-runtime'; // C11: the footer's gear opens Settings
import type { SidebarSort } from '../overview/derive';
import { selectNeedsYou, useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { selectHiddenProjects, selectProjectOrder, useSessions } from '../stores/sessions';
import { openDialog } from '../sessions/dialogs';
import { filterProjectList, projectList, projectSessions, PROJECTS_FIRST, SESSIONS_CAP, sessionMatcher, shownCount, type ProjectEntry, type ProjectKey } from './derive';
import { menuTargetOf, SidebarMenuContent, type MenuTarget } from './menus';
import { ProjectRow, ShowMoreRow } from './ProjectRow';
import { ResumePickerHost } from './ResumePicker';
import { registerProjectRevealer } from './reveal';
import { runAddProject, useAddProjectEnabled } from './project-actions';
import { Search } from './Search';
import { SectionHeading } from './SectionHeading';
import { moreNodeId, projectNodeId, sessionNodeId, treeCommand, TreeContext, type TreeNode } from './tree';

export function Sidebar() {
  const sessionsLoaded = useSessions((s) => s.loaded);
  const attentionLoaded = useAttention((s) => s.loaded);
  const loaded = sessionsLoaded && attentionLoaded;
  return (
    <div className="flex min-h-0 flex-1 flex-col text-fg" aria-busy={!loaded}>
      {loaded ? <SidebarBody /> : <SidebarSkeleton />}
      <Footer />
    </div>
  );
}

// A listed project as the tree shows it: open or not, the sessions it shows and how many more its "Show more" reveals.
interface ShownProject {
  entry: ProjectEntry;
  open: boolean;
  sessions: SessionRecord[];
  more: number;
}

const MORE_PROJECTS = moreNodeId(null);

function SidebarBody() {
  const records = useSessions((s) => s.records);
  const recordsVersion = useSessions((s) => s.recordsVersion);
  const digests = useSessions((s) => s.digests);
  const projects = useSessions(selectProjectOrder);
  const hiddenProjects = useSessions(selectHiddenProjects);
  const rows = useAttention((s) => selectNeedsYou(s, { records, recordsVersion }));
  const sidebar = useLayout((s) => s.regions.sidebar);
  const selected = useLayout((s) => {
    const tab = activeTab(s.main);
    return tab?.kind === 'session' ? tab.appSessionId : null;
  });

  const [query, setQuery] = useState('');
  const [allProjects, setAllProjects] = useState(false); // the list's own "Show more" (transient)
  const [more, setMore] = useState<ReadonlySet<ProjectKey>>(new Set()); // projects whose "Show more" was clicked (transient)
  const [focused, setFocused] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null); // a tree item to focus once a render shows it
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const scroller = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const hidden = useMemo(() => new Set(hiddenProjects.map((p) => p.id)), [hiddenProjects]);
  const everyEntry = useMemo(() => projectList({ records, digests, projects, rows, hidden }), [records, digests, projects, rows, hidden]);
  const searching = query.trim() !== '';
  const matches = useMemo(() => sessionMatcher(query, byId), [query, byId]);
  const expanded = useMemo(() => new Set(sidebar.expandedProjects), [sidebar.expandedProjects]);

  // Five project rows, then "Show more" for the rest (Codex's `maxGroups`); Other sessions stays last whatever is folded.
  // A search lists every project it finds.
  const { listed, folded } = useMemo(() => {
    const found = filterProjectList(everyEntry, query, byId);
    if (searching || allProjects) return { listed: found, folded: 0 };
    const real = found.filter((e) => e.project !== null);
    const other = found.filter((e) => e.project === null);
    return { listed: [...real.slice(0, PROJECTS_FIRST), ...other], folded: Math.max(0, real.length - PROJECTS_FIRST) };
  }, [everyEntry, query, byId, searching, allProjects]);

  const shown: ShownProject[] = useMemo(
    () =>
      listed.map((entry) => {
        const open = searching || expanded.has(entry.key);
        if (!open) return { entry, open, sessions: [], more: 0 };
        const all = projectSessions({ sessions: entry.sessions, digests, rows, sort: sidebar.sort, matches });
        const count = shownCount(all.length, more.has(entry.key));
        return { entry, open, sessions: all.slice(0, count), more: Math.min(all.length, SESSIONS_CAP) - count };
      }),
    [listed, searching, expanded, digests, rows, sidebar.sort, matches, more],
  );
  // The list's "Show more" sits after the last project row, before Other sessions.
  const moreAt = folded > 0 ? shown.filter((p) => p.entry.project !== null).length : -1;

  // The tree items on screen, in order: what the arrow keys walk.
  const nodes = useMemo(() => {
    const out: TreeNode[] = [];
    shown.forEach(({ entry, open, sessions, more: hidden }, i) => {
      if (i === moreAt) out.push({ id: MORE_PROJECTS, kind: 'more', key: null, parent: null });
      const id = projectNodeId(entry.key);
      out.push({ id, kind: 'project', key: entry.key, expanded: open });
      if (!open) return;
      out.push(...sessions.map((r): TreeNode => ({ id: sessionNodeId(r.appId), kind: 'session', appSessionId: r.appId, parent: id })));
      if (hidden > 0) out.push({ id: moreNodeId(entry.key), kind: 'more', key: entry.key, parent: id });
    });
    if (moreAt === shown.length) out.push({ id: MORE_PROJECTS, kind: 'more', key: null, parent: null });
    return out;
  }, [shown, moreAt]);
  const selectedNode = selected === null ? null : sessionNodeId(selected);
  const tabStop = nodes.some((n) => n.id === focused) ? focused : nodes.some((n) => n.id === selectedNode) ? selectedNode : (nodes[0]?.id ?? null);

  const itemElement = (id: string) => scroller.current?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`) ?? null;
  const focusItem = (id: string) => {
    const element = itemElement(id);
    if (element) element.focus();
    else pendingFocus.current = id;
  };
  // An item not on screen yet (the first row a "Show more" revealed, a revealed project) takes focus, and with it the
  // scroll, after the render that shows it.
  useEffect(() => {
    const id = pendingFocus.current;
    const element = id === null ? null : itemElement(id);
    if (!element) return;
    pendingFocus.current = null;
    element.focus();
  });

  // A project revealed from outside (`reveal.ts`, the ⌘K palette) is expanded there; here the search clears and the
  // folded projects show, so its row is on screen, and the row takes focus after the render that shows it (and that
  // lifts a collapsed sidebar's `inert`).
  useEffect(
    () =>
      registerProjectRevealer((projectId) => {
        setQuery('');
        setAllProjects(true);
        setFocused(null);
        pendingFocus.current = projectNodeId(projectId);
        rerender(); // the row may be on screen already: the focus effect still runs
      }),
    [],
  );

  const toggleProject = (key: ProjectKey) => {
    if (searching) return; // a search shows its matches open without changing what is expanded
    const open = sidebar.expandedProjects.includes(key);
    if (open && more.has(key)) {
      const next = new Set(more);
      next.delete(key);
      setMore(next); // a project opened again shows its first five
    }
    // Closes or opens the row as seen, over whatever list it lands on (a click before the layout hydrates is replayed
    // over the saved expansions).
    useLayout.getState().setSidebar(({ expandedProjects: list }) => ({
      expandedProjects: open ? list.filter((k) => k !== key) : list.includes(key) ? list : [...list, key],
    }));
  };
  const showMore = (key: ProjectKey | null) => {
    if (key === null) {
      const next = everyEntry.filter((e) => e.project !== null)[PROJECTS_FIRST];
      setAllProjects(true);
      if (next) focusItem(projectNodeId(next.key));
      return;
    }
    const group = shown.find((p) => p.entry.key === key);
    if (!group) return;
    setMore(new Set(more).add(key));
    const next = projectSessions({ sessions: group.entry.sessions, digests, rows, sort: sidebar.sort, matches })[group.sessions.length];
    if (next) focusItem(sessionNodeId(next.appId));
  };

  const onTreeKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const id = (event.target as HTMLElement).getAttribute('data-tree-id');
    if (id === null) return; // a key on a control inside a row is the control's
    const command = treeCommand(nodes, id, event.key);
    if (!command) return;
    event.preventDefault();
    switch (command.kind) {
      case 'focus':
        focusItem(command.id);
        break;
      case 'open':
        useLayout.getState().openSession(command.appSessionId);
        break;
      case 'toggle':
        toggleProject(command.key);
        break;
      case 'more':
        showMore(command.key);
        break;
    }
  };

  const tree = { tabStop, selected, onFocusItem: setFocused };
  const listEmpty = everyEntry.length === 0;
  const moreProjects = <ShowMoreRow id={MORE_PROJECTS} level={1} onShow={() => showMore(null)} />;

  return (
    <TreeContext.Provider value={tree}>
      <div className="px-2.5 pt-2.5">
        <NewChatRow />
      </div>
      <div className="px-2.5 pt-1">
        <Search value={query} onChange={setQuery} label="Search projects and sessions" onLeave={() => tabStop && focusItem(tabStop)} />
      </div>
      <ContextMenu.Root modal={false} onOpenChange={(isOpen) => !isOpen && setMenuTarget(null)}>
        <ContextMenu.Trigger asChild>
          <div
            ref={scroller}
            data-testid="sidebar-tree"
            onContextMenu={(event) => {
              const target = menuTargetOf(event.target as Element);
              if (target) setMenuTarget(target);
              else event.preventDefault(); // no row, no menu
            }}
            className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2.5 [scrollbar-width:thin]"
          >
            <SectionHeading title="Projects">
              <SortMenu sort={sidebar.sort} />
              {projects.length > 0 && <AddProjectButton />}
            </SectionHeading>
            {listEmpty ? (
              <EmptyProjects />
            ) : listed.length === 0 ? (
              <p className="m-0 px-[9px] py-1.5 text-ui-sm text-fg-faint">No projects match</p>
            ) : (
              <div role="tree" aria-label="Projects" onKeyDown={onTreeKeyDown} className="flex flex-col gap-px">
                {shown.map((group, i) => (
                  <Fragment key={group.entry.key}>
                    {i === moreAt && moreProjects}
                    <ProjectRow entry={group.entry} open={group.open} sessions={group.sessions} more={group.more} onToggle={toggleProject} onShowMore={showMore} />
                  </Fragment>
                ))}
                {moreAt === shown.length && moreProjects}
              </div>
            )}
            {hiddenProjects.length > 0 && !searching && (
              <button
                type="button"
                onClick={() => openDialog({ kind: 'hiddenProjects' })}
                className="mt-1 flex h-(--row-h) w-full cursor-default items-center rounded-sm pr-[9px] pl-[30px] text-left text-ui-sm text-fg-muted outline-accent select-none hover:bg-bg-hover hover:text-fg focus-visible:outline-2"
              >
                Hidden projects…
              </button>
            )}
          </div>
        </ContextMenu.Trigger>
        <SidebarMenuContent target={menuTarget} />
      </ContextMenu.Root>
      <ResumePickerHost />
    </TreeContext.Provider>
  );
}

const SORTS: { value: SidebarSort; label: string }[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'recency', label: 'Recency' },
];

// The order of each project's sessions, on the Projects heading (W11; it sat on W5's project page).
function SortMenu({ sort }: { sort: SidebarSort }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <IconButton label="Sort sessions" className="size-[22px]">
          <SortIcon className="size-[13px]" />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-36 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg">
          <DropdownMenu.Label className="px-2 py-1 text-ui-sm text-fg-muted">Sort sessions by</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={sort} onValueChange={(value) => useLayout.getState().setSidebar({ sort: value as SidebarSort })}>
            {SORTS.map(({ value, label }) => (
              <DropdownMenu.RadioItem
                key={value}
                value={value}
                className="flex h-7 cursor-default items-center gap-2 rounded-sm px-2 outline-none select-none data-highlighted:bg-bg-hover"
              >
                <span className="w-3 text-accent">
                  <DropdownMenu.ItemIndicator>●</DropdownMenu.ItemIndicator>
                </span>
                {label}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// New chat (2026-10-01): the sidebar's first row, above the search and the tree, as Codex's first nav row sits above its
// projects (readable/chatgpt-26.928.40906/renderer/app/app-initial-27bc4044d9e8.js:519957-519987, 520284-520293). It
// starts in the active session's project, else the first expanded one, else in none ("Choose a project").
function NewChatRow() {
  const canCreate = useSessionCreatorRegistered();
  const chord = useChordHint('session.new');
  return (
    <button
      type="button"
      aria-label={NEW_CHAT}
      disabled={!canCreate}
      title={canCreate ? (chord ? `${NEW_CHAT} · ${chord}` : NEW_CHAT) : 'Not available here'}
      onClick={() => void createSession(focusedProject())}
      className="group/new flex h-(--row-h) w-full cursor-default items-center gap-[7px] rounded-sm pr-1 pl-[9px] text-ui text-fg outline-accent select-none hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent"
    >
      <NewChatIcon className="size-[13px] text-fg-muted" />
      <span className="min-w-0 flex-1 truncate text-left">{NEW_CHAT}</span>
      {chord && <kbd className="font-ui text-ui-sm text-fg-faint opacity-0 group-hover/new:opacity-100 group-focus-visible/new:opacity-100">{chord}</kbd>}
    </button>
  );
}

// A pencil over a square, the new-chat glyph (tokens only: it draws in the current colour).
const NewChatIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" aria-hidden className={`shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.5] ${className ?? ''}`}>
    <path d="M7 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9" />
    <path d="M11.5 2.5l2 2L8 10H6V8z" />
  </svg>
);

function AddProjectButton() {
  const enabled = useAddProjectEnabled();
  return (
    <IconButton label="Add project" disabled={!enabled} onClick={runAddProject} className="size-[22px]">
      <PlusIcon className="size-[13px]" />
    </IconButton>
  );
}

const TEXT_BUTTON =
  'rounded-sm border border-border-strong px-2.5 py-1 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:border-border disabled:text-fg-faint disabled:hover:bg-transparent';

// An empty workspace (residue *Empty and loading states*): Add project, disabled until its handler exists; the other way
// in is the New chat row above (New chat, 2026-10-01).
function EmptyProjects() {
  const canAdd = useAddProjectEnabled();
  return (
    <div className="flex flex-col gap-2.5 px-2.5 py-2">
      <p className="m-0 text-ui-sm text-fg-muted">No projects yet</p>
      <div className="flex gap-2">
        <button type="button" disabled={!canAdd} title={canAdd ? undefined : 'Not available here'} onClick={runAddProject} className={TEXT_BUTTON}>
          Add project
        </button>
      </div>
    </div>
  );
}

// Until both snapshots have loaded: the search field and a few placeholder project rows.
function SidebarSkeleton() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden px-2.5 py-2.5">
      <div className="mx-0.5 mb-3.5 h-8 rounded-sm border border-border" />
      <SectionHeading title="Projects" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} data-testid="skeleton-row" aria-hidden className="flex h-9 items-center px-[9px]">
          <div className="h-2.5 w-3/5 animate-pulse rounded-sm bg-bg-active motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

function Footer() {
  const settings = useActionEnabled('settings.open'); // C11
  const chord = useChordHint('settings.open'); // C11
  return (
    <footer className="flex min-h-[43px] items-center gap-2 border-t border-border px-4 py-[7px] text-ui-sm text-fg-muted">
      <FolderIcon />
      <span>Local workspace</span>
      {/* C11 start: the gear opens the Settings tab (settings.open) once C11's handler is registered */}
      <button
        type="button"
        disabled={!settings}
        aria-label="Workspace settings"
        title={settings ? `Settings${chord ? ` · ${chord}` : ''}` : 'Not available here'}
        onClick={() => runAction('settings.open')}
        className="ml-auto inline-flex size-7 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent"
      >
        <GearIcon />
      </button>
      {/* C11 end */}
    </footer>
  );
}
