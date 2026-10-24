// The sidebar (§5.1 as amended 2026-10-01, W11; C5 execution document, M3): Codex's flat tree under the New chat row and
// one search field. The project rows, most recently active first, five of them and then "Show more" for the rest, with
// Other sessions last; each expands in place to its sessions (`ProjectRow.tsx`), and which are expanded persists in the
// `regions` layout key (`expandedProjects`), so a relaunch shows what the person left; the search and the "Show more"
// reveals do not persist. The search filters every project (by name, or holding a matching session) and shows each
// listed project open on its matching sessions without changing what is expanded. M2 restores Needs you above the
// tree, independent of search and hidden projects, from the same attention table as the Overview. One context menu
// serves every row, and the tree is one roving tab stop (`tree.ts`). A project removed from the sidebar (I5) is listed
// nowhere, its sessions with it, and "Hidden projects…" at the end offers it back.
import { ContextMenu, DropdownMenu } from 'radix-ui';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { FolderIcon, GearIcon, IconButton, SortIcon } from '../app/IconButton';
import { openCustomize, openProjects } from '../customize/open';
import { useChordHint } from '../app/IconButton'; // C11
import { useSlot } from '../app/slots';
import { createSession, focusedProject, NEW_CHAT, useSessionCreatorRegistered } from '../keymap/actions-runtime';
import { runAction, useActionEnabled } from '../keymap/actions-runtime'; // C11: the footer's gear opens Settings
import type { ProjectId } from '@shared/graph/ids';
import { ProjectFilter } from './ProjectFilter';
import type { SidebarSort } from '../overview/derive';
import { selectNeedsYou, useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { openArtifacts } from '../main/artifacts'; // P3-G
import { selectHiddenProjects, selectProjectOrder, useSessions } from '../stores/sessions';
import { openDialog } from '../sessions/dialogs';
import { filterProjectList, nestLineage, OTHER_SESSIONS, projectList, projectSessions, PROJECTS_FIRST, SESSIONS_CAP, sessionMatcher, shownCount, type ProjectEntry, type ProjectKey, type SessionTreeRow } from './derive';
import { menuTargetOf, SidebarMenuContent, type MenuTarget } from './menus';
import { ProjectRow, ShowMoreRow } from './ProjectRow';
import { ResumeChooserHost } from '../resume/host'; // P2-D
import { registerProjectRevealer } from './reveal';
import { AddProject } from './AddProject';
import { Search } from './Search';
import { SidebarInteractionContext } from './interaction';
import { openConversationSearch, openPalette } from '../palette/CommandPalette';
import { NeedsYou } from './NeedsYou';
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
  sessions: SessionTreeRow[]; // E3: each nested under its lineage parent when that is listed
  more: number;
}

const MORE_PROJECTS = moreNodeId(null);

function SidebarBody() {
  const searchChord = useChordHint('palette.open');
  const records = useSessions((s) => s.records);
  const recordsVersion = useSessions((s) => s.recordsVersion);
  const digests = useSessions((s) => s.digests);
  const [projectFilter, setProjectFilter] = useState<ReadonlySet<ProjectId> | null>(null);
  const allKnownProjects = useSessions(selectProjectOrder);
  const hiddenProjects = useSessions(selectHiddenProjects);
  const rows = useAttention((s) => selectNeedsYou(s, { records, recordsVersion }));
  const projects = useMemo(() => {
    const waiting = new Set(rows.map((row) => row.appSessionId));
    const retained = new Set([...records.values()].filter((r) => !r.archived && (r.pinned || r.holder.kind !== 'none' || waiting.has(r.appId)
      || digests.get(r.appId)?.phase === 'working' || digests.get(r.appId)?.phase === 'starting')).map((r) => r.projectId));
    return allKnownProjects.filter((p) => !p.discovered || retained.has(p.id) || projectFilter?.has(p.id));
  }, [allKnownProjects, records, digests, rows, projectFilter]);
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
  const [pointerWithin, setPointerWithin] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const pointerOwner = useRef<Node | null>(null);
  const focusOwner = useRef<Node | null>(null);
  const ownPointer = (target: EventTarget, fallback: HTMLElement) => {
    // Row and portal shells survive incidental icon/text replacement; their actual removal still ends ownership.
    pointerOwner.current = (target as Element).closest('[role="treeitem"], [data-needs-you], [role="dialog"], [role="menu"]') ?? fallback;
    setPointerWithin(true);
  };
  const releaseRemoved = useCallback((removed: Node) => {
    if (pointerOwner.current && removed.contains(pointerOwner.current)) {
      pointerOwner.current = null;
      setPointerWithin(false);
    }
    if (focusOwner.current && removed.contains(focusOwner.current)) {
      focusOwner.current = null;
      setFocusWithin(false);
    }
  }, []);
  useLayoutEffect(() => {
    // Removing a row can omit leave/blur and move focus to BODY without focusin. Reconcile after this
    // sidebar's commit; surviving targets and focus transfers performed by children keep their ownership.
    for (const owner of [pointerOwner.current, focusOwner.current]) {
      if (owner && !owner.isConnected) releaseRemoved(owner);
    }
  });
  useEffect(() => {
    // Clear at document capture first; this subtree's React capture renews ownership for its own controls,
    // including portals. A focus elsewhere also clears stale ownership left by a removed portal.
    const clearFocus = () => { focusOwner.current = null; setFocusWithin(false); };
    document.addEventListener('focusin', clearFocus, true);
    return () => document.removeEventListener('focusin', clearFocus, true);
  }, []);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const scroller = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const hidden = useMemo(() => new Set([...hiddenProjects, ...allKnownProjects.filter((p) => !projects.some((listed) => listed.id === p.id))].map((p) => p.id)), [hiddenProjects, allKnownProjects, projects]);
  const rankedEntries = useMemo(() => projectList({ records, digests, projects, rows, hidden }).map((entry) => ({
    ...entry,
    sessions: projectSessions({ sessions: entry.sessions, digests, rows, sort: sidebar.sort, matches: () => true }),
  })), [records, digests, projects, rows, hidden, sidebar.sort]);
  // Hold ranks, not data: titles, glyphs and counts remain live. Pointer presence, keyboard focus (including
  // portalled cards/menus), or an open context menu keeps the same targets in place until the person leaves.
  // A deliberate sort change is immediate; no timer can reshuffle a row between two actions.
  const holding = pointerWithin || focusWithin || menuTarget !== null;
  const [settledOrder, setSettledOrder] = useState({ entries: rankedEntries, sort: sidebar.sort });
  if ((!holding || settledOrder.sort !== sidebar.sort) && settledOrder.entries !== rankedEntries) {
    setSettledOrder({ entries: rankedEntries, sort: sidebar.sort });
  }
  const everyEntry = useMemo(() => {
    if (!holding) return rankedEntries;
    const previous = new Map(settledOrder.entries.map((entry) => [entry.key, entry]));
    return holdOrder(rankedEntries, settledOrder.entries, (entry) => entry.key).map((entry) => ({
      ...entry,
      sessions: holdOrder(entry.sessions, previous.get(entry.key)?.sessions ?? [], (record) => record.appId),
    }));
  }, [rankedEntries, settledOrder, holding]);
  const searching = query.trim() !== '';
  const matches = useMemo(() => sessionMatcher(query, byId), [query, byId]);
  const expanded = useMemo(() => new Set(sidebar.expandedProjects), [sidebar.expandedProjects]);

  // Five project rows, then "Show more" for the rest (Codex's `maxGroups`); Other sessions stays last whatever is folded.
  // A search lists every project it finds.
  const { listed, folded } = useMemo(() => {
    const found = filterProjectList(everyEntry, query, byId).filter((entry) => projectFilter === null || (entry.project !== null && projectFilter.has(entry.project.id)));
    if (searching || allProjects || projectFilter !== null) return { listed: found, folded: 0 };
    const real = found.filter((e) => e.project !== null);
    const other = found.filter((e) => e.project === null);
    return { listed: [...real.slice(0, PROJECTS_FIRST), ...other], folded: Math.max(0, real.length - PROJECTS_FIRST) };
  }, [everyEntry, query, byId, searching, allProjects, projectFilter]);

  const shown: ShownProject[] = useMemo(
    () =>
      listed.map((entry) => {
        const open = searching || expanded.has(entry.key);
        if (!open) return { entry, open, sessions: [], more: 0 };
        const all = nestLineage(entry.sessions.filter(matches)); // E3: the caps count trees; rank was settled above
        const count = searching ? all.length : shownCount(all.length, more.has(entry.key));
        return { entry, open, sessions: all.slice(0, count).flatMap((tree) => tree.rows), more: searching ? 0 : Math.min(all.length, SESSIONS_CAP) - count };
      }),
    [listed, searching, expanded, matches, more],
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
      // E3: a nested row's parent is its lineage parent's row, so ArrowLeft lands there
      out.push(...sessions.map(({ record: r, nestedUnder }): TreeNode => ({ id: sessionNodeId(r.appId), kind: 'session', appSessionId: r.appId, parent: nestedUnder === null ? id : sessionNodeId(nestedUnder) })));
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
        setProjectFilter(null);
        setAllProjects(true);
        setFocused(null);
        pendingFocus.current = projectNodeId(projectId);
        rerender(); // the row may be on screen already: the focus effect still runs
      }),
    [],
  );

  // A project's activation, one path for a click on its row and its keys (Enter, Space, ArrowRight, ArrowLeft): the strip
  // shows the project's tab set (W12; Other sessions: the no-project set), and the row opens or closes.
  const toggleProject = (key: ProjectKey) => {
    useLayout.getState().setCurrentProject(key === OTHER_SESSIONS ? null : key);
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
    const shownTrees = group.sessions.filter((row) => row.nestedUnder === null).length; // E3: the next tree's root
    const next = nestLineage(group.entry.sessions.filter(matches))[shownTrees]?.root;
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
  const listEmpty = projects.length === 0 && everyEntry.every((entry) => entry.sessions.length === 0);
  const moreProjects = <ShowMoreRow id={MORE_PROJECTS} level={1} onShow={() => showMore(null)} />;

  return (
    <TreeContext.Provider value={tree}>
      <SidebarInteractionContext.Provider value={releaseRemoved}>
      <div className="flex min-h-0 flex-1 flex-col"
        onPointerEnter={(event) => ownPointer(event.target, event.currentTarget)}
        onPointerOverCapture={(event) => ownPointer(event.target, event.currentTarget)}
        onPointerLeave={() => { pointerOwner.current = null; setPointerWithin(false); }}
        onFocusCapture={(event) => { focusOwner.current = event.target; setFocusWithin(true); }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) { focusOwner.current = null; setFocusWithin(false); }
        }}>
        <SidebarDestinations>
          <div ref={search}>
            <Search value={query} onChange={setQuery} label="Search projects and sessions" onSearch={openPalette} chord={searchChord} onLeave={() => {
              const waiting = scroller.current?.querySelector<HTMLButtonElement>('[data-needs-you][tabindex="0"]');
              if (waiting) waiting.focus();
              else if (tabStop) focusItem(tabStop);
            }} />
            {searching && <button type="button" onClick={() => openConversationSearch(query.trim())}
              className="mb-1 w-full rounded-sm px-[9px] py-1.5 text-left text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover focus-visible:outline-2">
              Search in conversations for ‘{query.trim()}’
            </button>}
          </div>
        </SidebarDestinations>
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
              <NeedsYou rows={rows} selected={selected} onEmptyFocus={() => search.current?.querySelector('input')?.focus()} />
              <SectionHeading title="Projects">
                <ProjectFilter projects={allKnownProjects} current={selected ? records.get(selected)?.projectId ?? null : null} selected={projectFilter} onChange={setProjectFilter} />
                <SortMenu sort={sidebar.sort} />
                <AddProject />
              </SectionHeading>
              {listEmpty && <EmptyProjects />}
              {listed.length === 0 ? (
                searching && <p className="m-0 px-[9px] py-1.5 text-ui-sm text-fg-faint">No projects match</p>
              ) : (
                <div role="tree" aria-label="Projects" onKeyDown={onTreeKeyDown} className="flex flex-col gap-px">
                  {shown.map((group, i) => (
                    <Fragment key={group.entry.key}>
                      {i === moreAt && moreProjects}
                      <ProjectRow entry={group.entry} open={group.open} sessions={group.sessions} more={group.more} matchCount={searching ? group.sessions.length : undefined} onToggle={toggleProject} onShowMore={showMore} />
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
              {!searching && (
                <button
                  type="button"
                  onClick={() => openDialog({ kind: 'archived', projectId: null })}
                  className="mt-1 flex h-(--row-h) w-full cursor-default items-center rounded-sm pr-[9px] pl-[30px] text-left text-ui-sm text-fg-muted outline-accent select-none hover:bg-bg-hover hover:text-fg focus-visible:outline-2"
                >
                  Archived sessions…
                </button>
              )}
            </div>
          </ContextMenu.Trigger>
          <SidebarMenuContent target={menuTarget} />
        </ContextMenu.Root>
        <ResumeChooserHost />
      </div>
      </SidebarInteractionContext.Provider>
    </TreeContext.Provider>
  );
}

function holdOrder<T>(current: T[], previous: T[], key: (item: T) => string): T[] {
  const rank = new Map(previous.map((item, index) => [key(item), index]));
  // New arrivals follow the held rows; stable sort keeps the arrivals' live ordering.
  return [...current].sort((a, b) => (rank.get(key(a)) ?? previous.length) - (rank.get(key(b)) ?? previous.length));
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

// New chat (M2): directly under the sidebar wordmark, above the search and tree, as Codex's first nav row sits above its
// projects (readable/chatgpt-26.928.40906/renderer/app/app-initial-27bc4044d9e8.js:519957-519987, 520284-520293). It
// starts in the project whose tab set the strip shows (`focusedProject`), else in none ("Choose a project").
function SidebarDestinations({ children }: { children: ReactNode }) {
  return <nav aria-label="App destinations" className="shrink-0 px-2.5 pt-2.5 pb-1">
    {children}
    <NewChatRow />
    <DestinationRow kind="projects" />
    <ArtifactsRow />
    <DestinationRow kind="customize" />
  </nav>;
}

function DestinationRow({ kind }: { kind: 'projects' | 'customize' }) {
  const current = useLayout((s) => activeTab(s.main)?.kind === kind);
  const label = { projects: 'Projects', customize: 'Customize' }[kind];
  const open = () => { if (kind === 'projects') openProjects(); else openCustomize(); };
  return <button type="button" aria-current={current ? 'page' : undefined} onClick={open}
    className={`flex h-(--row-h) w-full cursor-default items-center gap-[7px] rounded-sm pr-1 pl-[9px] text-ui text-fg outline-accent select-none hover:bg-bg-hover focus-visible:outline-2 ${current ? 'bg-bg-active' : ''}`}>
    {kind === 'projects' ? <FolderIcon className="size-[13px]" /> : <CustomizeIcon />}
    <span className="min-w-0 flex-1 truncate text-left">{label}</span>
  </button>;
}
const CustomizeIcon = () => <svg viewBox="0 0 16 16" aria-hidden className="size-[13px] shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-width:1.5]">
  <path d="M2 4h3m4 0h5M2 12h7m4 0h1" /><circle cx="7" cy="4" r="2" /><circle cx="11" cy="12" r="2" />
</svg>;

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
      <NewChatIcon className="size-[13px]" />
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

// P3-G (§D5): Artifacts, under New chat in its row style, opens or activates the singleton Artifacts tab (the action
// `artifacts.open` does the same from the palette and the View menu); it reads as the current page while that tab is
// the one shown.
function ArtifactsRow() {
  const current = useLayout((s) => activeTab(s.main)?.kind === 'artifacts');
  return (
    <button
      type="button"
      aria-current={current ? 'page' : undefined}
      onClick={openArtifacts}
      className={`flex h-(--row-h) w-full cursor-default items-center gap-[7px] rounded-sm pr-1 pl-[9px] text-ui text-fg outline-accent select-none hover:bg-bg-hover focus-visible:outline-2 ${current ? 'bg-bg-active' : ''}`}
    >
      <ArtifactsIcon className="size-[13px]" />
      <span className="min-w-0 flex-1 truncate text-left">Artifacts</span>
    </button>
  );
}

// A grid of four squares, the library's glyph (tokens only: it draws in the current colour).
const ArtifactsIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" aria-hidden className={`shrink-0 fill-none stroke-current [stroke-linejoin:round] [stroke-width:1.5] ${className ?? ''}`}>
    <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
    <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
  </svg>
);

function EmptyProjects() {
  return <p className="m-0 px-2.5 py-2 text-ui-sm text-fg-muted">No projects yet</p>;
}

// Until both snapshots have loaded: the search field and a few placeholder project rows.
function SidebarSkeleton() {
  return (
    <>
    <SidebarDestinations><div className="mx-0.5 mb-2.5 h-8 rounded-sm border border-border" /></SidebarDestinations>
    <div className="min-h-0 flex-1 overflow-hidden px-2.5 py-2.5">
      <SectionHeading title="Projects" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} data-testid="skeleton-row" aria-hidden className="flex h-9 items-center px-[9px]">
          <div className="h-2.5 w-3/5 animate-pulse rounded-sm bg-bg-active motion-reduce:animate-none" />
        </div>
      ))}
    </div>
    </>
  );
}

function Footer() {
  const Usage = useSlot('topBarEnd');
  const settings = useActionEnabled('settings.open'); // C11
  const chord = useChordHint('settings.open'); // C11
  return (
    <footer className="flex min-h-[43px] items-center gap-2 border-t border-border px-4 py-[7px] text-ui-sm text-fg-muted">
      <div data-sidebar-usage className="flex min-w-0 items-center">
        {/* eslint-disable-next-line react-hooks/static-components -- the usage slot is registered once at composition */}
        <Usage />
      </div>
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
