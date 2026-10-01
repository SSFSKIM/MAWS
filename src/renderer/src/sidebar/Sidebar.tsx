// The sidebar (§5.1 as amended 2026-10-01, W5; C5 execution document, M3): a two-level drill-in under one search field.
// Level one is the project list, most recently active first, with Other sessions at the end; a click on a project slides
// its page in from the right (a short transform, none under reduced motion), and "‹ Projects" slides back. The open
// project persists in the `regions` layout key (`openProject`), so a relaunch opens where the person left; the search
// does not persist. The search filters the level on screen: projects (by name, or holding a matching session) on the
// list, the open project's sessions on its page. Cross-project attention is the Overview's, the notifier's, the dock
// badge's and ⌘⇧J's, which read the attention table directly. One context menu serves every row, and each level is one
// roving tab stop (`tree.ts`).
import { ContextMenu } from 'radix-ui';
import { useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from 'react';
import type { WorktreeInfo } from '@shared/sessions/worktree';
import { FolderIcon, GearIcon, IconButton, PlusIcon } from '../app/IconButton';
import { useChordHint } from '../app/IconButton'; // C11
import { ipc } from '../ipc/client';
import { createSession, useSessionCreatorRegistered } from '../keymap/actions-runtime';
import { runAction, useActionEnabled } from '../keymap/actions-runtime'; // C11: the footer's gear opens Settings
import { selectNeedsYou, useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { selectProjectOrder, useSessions } from '../stores/sessions';
import { filterProjectList, hasWorktreeSessions, projectList, projectPage, sessionMatcher, type ProjectKey } from './derive';
import { menuTargetOf, SidebarMenuContent, type MenuTarget } from './menus';
import { ProjectPage } from './ProjectPage';
import { ProjectRow } from './ProjectRow';
import { registerProjectRevealer } from './reveal';
import { runAddProject, useAddProjectEnabled } from './project-actions';
import { Search } from './Search';
import { SectionHeading } from './SectionHeading';
import { projectNodeId, sessionNodeId, treeCommand, TreeContext, type TreeNode } from './tree';

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

// The checkouts of a project's repository in git's order (Main first), read when its page shows a worktree session and
// read again when a worktree the page has not seen appears; null until the answer arrives or when it fails.
function useWorktrees(directory: string | null, paths: string): readonly WorktreeInfo[] | null {
  const [answer, setAnswer] = useState<{ directory: string; worktrees: WorktreeInfo[] } | null>(null);
  useEffect(() => {
    if (directory === null) return;
    let live = true;
    void ipc.invoke('git.worktree.list', { repoRoot: directory }).then(
      (result) => live && setAnswer(result.ok ? { directory, worktrees: result.value.worktrees } : null),
      () => live && setAnswer(null),
    );
    return () => {
      live = false;
    };
  }, [directory, paths]);
  return answer?.directory === directory ? answer.worktrees : null;
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
  const [focused, setFocused] = useState<string | null>(null);
  // The page that slides out after "‹ Projects" stays rendered until its transform ends.
  const [leaving, setLeaving] = useState<ProjectKey | null>(null);
  const pendingFocus = useRef<string | 'page' | null>(null); // what takes focus once a render shows it
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const container = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);

  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const everyEntry = useMemo(() => projectList({ records, digests, projects, rows }), [records, digests, projects, rows]);
  const entries = useMemo(() => filterProjectList(everyEntry, query, byId), [everyEntry, query, byId]);
  const searching = query.trim() !== '';

  // The open project, when the list still holds it (a removed project, or Other sessions emptied, shows the list).
  const openEntry = sidebar.openProject === null ? null : (everyEntry.find((e) => e.key === sidebar.openProject) ?? null);
  const shownEntry = openEntry ?? (leaving === null ? null : (everyEntry.find((e) => e.key === leaving) ?? null));
  const shownSessions = shownEntry?.sessions;
  const worktreePaths = useMemo(
    () => [...new Set((shownSessions ?? []).flatMap((r) => (r.worktree ? [r.worktree.path] : [])))].sort().join('\n'),
    [shownSessions],
  );
  const worktreeDirectory = shownEntry?.project && shownSessions && hasWorktreeSessions(shownSessions) ? shownEntry.project.directory : null;
  const worktrees = useWorktrees(worktreeDirectory, worktreePaths);
  const page = useMemo(
    () =>
      shownSessions === undefined
        ? null
        : projectPage({ sessions: shownSessions, digests, rows, sort: sidebar.sort, matches: sessionMatcher(query, byId), worktrees }),
    [shownSessions, digests, rows, sidebar.sort, query, byId, worktrees],
  );

  const projectNodes: TreeNode[] = entries.map((e) => ({ id: projectNodeId(e.key), kind: 'project' as const, key: e.key }));
  const sessionNodes: TreeNode[] = page
    ? [...page.pinned, ...page.groups.flatMap((g) => g.sessions)].map((r) => ({ id: sessionNodeId(r.appId), kind: 'session' as const, appSessionId: r.appId }))
    : [];
  const nodes = openEntry ? sessionNodes : projectNodes;
  const selectedNode = selected === null ? null : sessionNodeId(selected);
  const tabStop = nodes.some((n) => n.id === focused) ? focused : nodes.some((n) => n.id === selectedNode) ? selectedNode : (nodes[0]?.id ?? null);

  const itemElement = (id: string) => container.current?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`) ?? null;
  const focusItem = (id: string) => {
    const element = itemElement(id);
    if (element) element.focus();
    else pendingFocus.current = id;
  };
  // What waits for a render takes focus after it: a page just opened on its first row (the selected session's when it is
  // there) or its back control, a project row after "‹ Projects". `preventScroll`, since the levels sit side by side in
  // a strip that is moving.
  useEffect(() => {
    const pending = pendingFocus.current;
    if (pending === null) return;
    if (pending === 'page') {
      if (!openEntry) return;
      pendingFocus.current = null;
      const stop = tabStop === null ? null : itemElement(tabStop);
      (stop ?? backRef.current)?.focus({ preventScroll: true });
      return;
    }
    const element = itemElement(pending);
    if (!element) return;
    pendingFocus.current = null;
    element.focus({ preventScroll: true });
  });

  const openProject = (key: ProjectKey) => {
    setLeaving(null);
    setFocused(null);
    pendingFocus.current = 'page';
    useLayout.getState().setSidebar({ openProject: key });
  };
  const back = () => {
    const key = sidebar.openProject;
    if (key === null) return;
    setLeaving(key);
    setFocused(projectNodeId(key));
    pendingFocus.current = projectNodeId(key);
    useLayout.getState().setSidebar({ openProject: null });
  };

  // A project revealed from outside (`reveal.ts`, the ⌘K palette) opens its page; the search clears so the page is
  // whole, and the page takes focus after the render that shows it (and that lifts a collapsed sidebar's `inert`).
  useEffect(
    () =>
      registerProjectRevealer(() => {
        setQuery('');
        setLeaving(null);
        setFocused(null);
        pendingFocus.current = 'page';
        rerender(); // the page may already be open: the focus effect still runs
      }),
    [],
  );

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
      case 'drill':
        openProject(command.key);
        break;
      case 'back':
        back();
        break;
    }
  };

  const open = openEntry !== null;
  const tree = { tabStop, selected, onFocusItem: setFocused };
  const listEmpty = everyEntry.length === 0;

  return (
    <TreeContext.Provider value={tree}>
      <div className="px-2.5 pt-2.5">
        <Search
          value={query}
          onChange={setQuery}
          label={open ? `Search ${openEntry.name}` : 'Search projects and sessions'}
          onLeave={() => (tabStop ? focusItem(tabStop) : open && backRef.current?.focus())}
        />
      </div>
      <ContextMenu.Root modal={false} onOpenChange={(isOpen) => !isOpen && setMenuTarget(null)}>
        <ContextMenu.Trigger asChild>
          <div
            ref={container}
            onContextMenu={(event) => {
              const target = menuTargetOf(event.target as Element);
              if (target) setMenuTarget(target);
              else event.preventDefault(); // no row, no menu
            }}
            className="relative min-h-0 flex-1 overflow-clip"
          >
            <div
              data-testid="sidebar-levels"
              data-level={open ? 2 : 1}
              data-open-project={openEntry?.key}
              onTransitionEnd={(event) => event.target === event.currentTarget && !open && setLeaving(null)}
              className="flex h-full w-[200%] transition-transform duration-200 ease-out motion-reduce:transition-none"
              style={{ transform: open ? 'translateX(-50%)' : 'translateX(0)' }}
            >
              <div
                data-level-pane={1}
                inert={open}
                aria-hidden={open || undefined}
                className="h-full w-1/2 overflow-y-auto px-2.5 pb-2.5 [scrollbar-width:thin]"
              >
                <SectionHeading title="Projects">{projects.length > 0 && <AddProjectButton />}</SectionHeading>
                {listEmpty ? (
                  <EmptyProjects />
                ) : entries.length === 0 ? (
                  <p className="m-0 px-[9px] py-1.5 text-ui-sm text-fg-faint">No projects match</p>
                ) : (
                  <div role="tree" aria-label="Projects" onKeyDown={onTreeKeyDown} className="flex flex-col">
                    {entries.map((entry) => (
                      <ProjectRow key={entry.key} entry={entry} onOpen={openProject} />
                    ))}
                  </div>
                )}
              </div>
              <div
                data-level-pane={2}
                inert={!open}
                aria-hidden={!open || undefined}
                className="h-full w-1/2 overflow-y-auto px-2.5 pb-2.5 [scrollbar-width:thin]"
              >
                {shownEntry && page && (
                  <ProjectPage
                    entry={shownEntry}
                    page={page}
                    sort={sidebar.sort}
                    searching={searching}
                    backRef={backRef}
                    onBack={back}
                    onTreeKeyDown={onTreeKeyDown}
                  />
                )}
              </div>
            </div>
          </div>
        </ContextMenu.Trigger>
        <SidebarMenuContent target={menuTarget} />
      </ContextMenu.Root>
    </TreeContext.Provider>
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
        <button type="button" disabled={!canAdd} title={canAdd ? undefined : 'Not available here'} onClick={runAddProject} className={TEXT_BUTTON}>
          Add project
        </button>
        <button type="button" disabled={!canCreate} title={canCreate ? undefined : 'Not available here'} onClick={() => void createSession(null)} className={TEXT_BUTTON}>
          New session
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
        <div key={i} data-testid="skeleton-row" aria-hidden className="flex h-(--row-h) items-center px-[9px]">
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
