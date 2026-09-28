// The sidebar (§5.1; mockup 01, light-first; C5 execution document, M3): search; Needs you with its hover cards;
// Pinned; the project tree with roll-ups, "+" and disclosure; Other sessions; the footer. Everything reads the stores
// through `derive.ts`; expansion and sort persist in the `regions` layout key, the search and "Show more" do not. One
// context menu serves every row, and the three trees share one roving tab stop (`tree.ts`).
import { ContextMenu, DropdownMenu } from 'radix-ui';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { FolderIcon, GearIcon, IconButton, PlusIcon, SortIcon } from '../app/IconButton';
import { createSession, useSessionCreatorRegistered } from '../keymap/actions-runtime';
import { selectNeedsYou, useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { selectProjectOrder, useSessions } from '../stores/sessions';
import type { SidebarSort } from '../overview/derive';
import { PROJECT_PAGE, sidebarModel, type SidebarModel } from './derive';
import { menuTargetOf, SidebarMenuContent, type MenuTarget } from './menus';
import { NeedsYou } from './NeedsYou';
import { ProjectGroup } from './ProjectGroup';
import { runAddProject, useAddProjectEnabled } from './project-actions';
import { Search } from './Search';
import { SectionHeading } from './SectionHeading';
import { SessionRow } from './SessionRow';
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

type Section = 'pinned' | 'other';

// The tree items on screen, in order: what the arrow keys walk.
function visibleNodes(model: SidebarModel, open: { pinned: boolean; other: boolean; project(id: ProjectId): boolean; all(id: ProjectId): boolean }): TreeNode[] {
  const session = (appSessionId: AppSessionId, parent: string | null): TreeNode => ({ id: sessionNodeId(appSessionId), kind: 'session', appSessionId, parent });
  const nodes: TreeNode[] = open.pinned ? model.pinned.map((r) => session(r.appId, null)) : [];
  for (const { project, sessions } of model.projects) {
    const id = projectNodeId(project.id);
    const expanded = open.project(project.id);
    nodes.push({ id, kind: 'project', projectId: project.id, expanded });
    if (!expanded) continue;
    const shown = open.all(project.id) ? sessions : sessions.slice(0, PROJECT_PAGE);
    nodes.push(...shown.map((r) => session(r.appId, id)));
    if (shown.length < sessions.length) nodes.push({ id: moreNodeId(project.id), kind: 'more', projectId: project.id, parent: id });
  }
  if (open.other) nodes.push(...model.other.map((r) => session(r.appId, null)));
  return nodes;
}

function SidebarBody() {
  const records = useSessions((s) => s.records);
  const recordsVersion = useSessions((s) => s.recordsVersion);
  const digests = useSessions((s) => s.digests);
  const projects = useSessions(selectProjectOrder);
  const rows = useAttention((s) => selectNeedsYou(s, { records, recordsVersion }));
  const sidebar = useLayout((s) => s.regions.sidebar);
  const selected = useLayout((s) => {
    const tab = activeTab(s.main);
    return tab?.kind === 'session' ? tab.appSessionId : null;
  });

  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState<ReadonlySet<ProjectId>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null); // a tree item to focus once a render shows it
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const model = useMemo(
    () => sidebarModel({ records, digests, projects, rows, sort: sidebar.sort, query }),
    [records, digests, projects, rows, sidebar.sort, query],
  );
  // A search shows its matches whatever is collapsed, without changing what is.
  const open = {
    pinned: model.searching || !sidebar.collapsedSections.includes('pinned'),
    other: model.searching || !sidebar.collapsedSections.includes('other'),
    project: (id: ProjectId) => model.searching || !sidebar.collapsedProjects.includes(id),
    all: (id: ProjectId) => showAll.has(id),
  };
  const nodes = visibleNodes(model, open);
  const tabStop = nodes.some((n) => n.id === focused) ? focused : (nodes[0]?.id ?? null);

  const itemElement = (id: string) => scroller.current?.querySelector<HTMLElement>(`[data-tree-id="${id}"]`) ?? null;
  const focusItem = (id: string) => {
    const element = itemElement(id);
    if (element) element.focus();
    else pendingFocus.current = id;
  };
  // An item not on screen yet (the first of a revealed page) takes focus after the render that shows it.
  useEffect(() => {
    const id = pendingFocus.current;
    const element = id === null ? null : itemElement(id);
    if (!element) return;
    pendingFocus.current = null;
    element.focus();
  });

  const toggleSection = (section: Section) => {
    const list = sidebar.collapsedSections;
    useLayout.getState().setSidebar({ collapsedSections: list.includes(section) ? list.filter((s) => s !== section) : [...list, section] });
  };
  const toggleProject = (id: ProjectId) => {
    if (model.searching) return;
    const list = sidebar.collapsedProjects;
    useLayout.getState().setSidebar({ collapsedProjects: list.includes(id) ? list.filter((p) => p !== id) : [...list, id] });
  };
  const showMore = (id: ProjectId) => {
    setShowAll(new Set(showAll).add(id));
    const next = model.projects.find((p) => p.project.id === id)?.sessions[PROJECT_PAGE];
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
        toggleProject(command.projectId);
        break;
      case 'more':
        showMore(command.projectId);
        break;
    }
  };

  const tree = { tabStop, selected, onFocusItem: setFocused };
  const treeProps = { onKeyDown: onTreeKeyDown, className: 'flex flex-col' };

  return (
    <TreeContext.Provider value={tree}>
      <ContextMenu.Root modal={false} onOpenChange={(isOpen) => !isOpen && setMenuTarget(null)}>
        <ContextMenu.Trigger asChild>
          <div
            ref={scroller}
            onContextMenu={(event) => {
              const target = menuTargetOf(event.target as Element);
              if (target) setMenuTarget(target);
              else event.preventDefault(); // no row, no menu
            }}
            className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5 [scrollbar-width:thin]"
          >
            <Search value={query} onChange={setQuery} onLeave={() => tabStop && focusItem(tabStop)} />
            <NeedsYou rows={model.needsYou} />

            {model.hasPinned && (
              <>
                <SectionHeading title="Pinned" collapse={{ expanded: open.pinned, onToggle: () => toggleSection('pinned'), controls: 'sidebar-pinned' }} />
                {open.pinned && (
                  <div role="tree" id="sidebar-pinned" aria-label="Pinned" {...treeProps}>
                    {model.pinned.map((r) => (
                      <SessionRow key={r.appId} record={r} level={1} />
                    ))}
                  </div>
                )}
              </>
            )}

            <SectionHeading title="Projects">
              <SortMenu sort={sidebar.sort} />
              {projects.length > 0 && <AddProjectButton />}
            </SectionHeading>
            {projects.length === 0 ? (
              <EmptyProjects />
            ) : (
              <div role="tree" aria-label="Projects" {...treeProps}>
                {model.projects.map((section) => (
                  <ProjectGroup
                    key={section.project.id}
                    section={section}
                    expanded={open.project(section.project.id)}
                    showAll={open.all(section.project.id)}
                    onToggle={toggleProject}
                    onShowMore={showMore}
                  />
                ))}
              </div>
            )}

            {model.hasOther && (
              <>
                <SectionHeading title="Other sessions" collapse={{ expanded: open.other, onToggle: () => toggleSection('other'), controls: 'sidebar-other' }} />
                {open.other && (
                  <div role="tree" id="sidebar-other" aria-label="Other sessions" {...treeProps}>
                    {model.other.map((r) => (
                      <SessionRow key={r.appId} record={r} level={1} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </ContextMenu.Trigger>
        <SidebarMenuContent target={menuTarget} />
      </ContextMenu.Root>
    </TreeContext.Provider>
  );
}

const SORTS: { value: SidebarSort; label: string }[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'recency', label: 'Recency' },
];

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

// An empty workspace (residue *Empty and loading states*): the two ways in, each disabled until its handler exists.
function EmptyProjects() {
  const canAdd = useAddProjectEnabled();
  const canCreate = useSessionCreatorRegistered();
  return (
    <div className="flex flex-col gap-2.5 px-2.5 py-2">
      <p className="m-0 text-ui-sm text-fg-muted">No projects yet</p>
      <div className="flex gap-2">
        <button type="button" disabled={!canAdd} title={canAdd ? undefined : 'Arrives with C10'} onClick={runAddProject} className={TEXT_BUTTON}>
          Add project
        </button>
        <button type="button" disabled={!canCreate} title={canCreate ? undefined : 'Arrives with C10'} onClick={() => void createSession(null)} className={TEXT_BUTTON}>
          New session
        </button>
      </div>
    </div>
  );
}

// Until both snapshots have loaded: three placeholder rows under each section's heading.
function SidebarSkeleton() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden px-2.5 py-2.5">
      <div className="mx-0.5 mb-3.5 h-8 rounded-sm border border-border" />
      {['Needs you', 'Projects', 'Other sessions'].map((title) => (
        <div key={title}>
          <SectionHeading title={title} tone={title === 'Needs you' ? 'warning' : 'muted'} />
          {[0, 1, 2].map((i) => (
            <div key={i} data-testid="skeleton-row" aria-hidden className="flex h-[47px] flex-col justify-center gap-2 px-[9px]">
              <div className="h-2.5 w-3/5 animate-pulse rounded-sm bg-bg-active motion-reduce:animate-none" />
              <div className="h-2 w-4/5 animate-pulse rounded-sm bg-bg-hover motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Footer() {
  return (
    <footer className="flex min-h-[43px] items-center gap-2 border-t border-border px-4 py-[7px] text-ui-sm text-fg-muted">
      <FolderIcon />
      <span>Local workspace</span>
      <button
        type="button"
        disabled
        aria-label="Workspace settings"
        title="Arrives with C11"
        className="ml-auto inline-flex size-7 items-center justify-center rounded-sm text-fg-faint"
      >
        <GearIcon />
      </button>
    </footer>
  );
}
