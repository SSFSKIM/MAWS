// One project in the tree (§5.1; mockup 01 `.project-head` and `.project-sessions`): a disclosure row with the
// project's name, its roll-up while collapsed (sessions needing you in warning, working in accent) and a "+" that opens
// an unstarted session tab in it; below, its sessions in the chosen sort, at most a page of them before "Show N more"
// (residue *Sidebar scale*).
import type { ProjectId } from '@shared/graph/ids';
import { ChevronDownIcon, FolderIcon, PlusIcon } from '../app/IconButton';
import { createSession, useSessionCreatorRegistered } from '../keymap/actions-runtime';
import { PROJECT_PAGE, type ProjectSection } from './derive';
import { SessionRow } from './SessionRow';
import { moreNodeId, projectNodeId, useTree } from './tree';

export interface ProjectGroupProps {
  section: ProjectSection;
  expanded: boolean;
  showAll: boolean;
  onToggle(projectId: ProjectId): void;
  onShowMore(projectId: ProjectId): void;
}

export function ProjectGroup({ section, expanded, showAll, onToggle, onShowMore }: ProjectGroupProps) {
  const { project, sessions, rollup } = section;
  const tree = useTree();
  const canCreate = useSessionCreatorRegistered();
  const nodeId = projectNodeId(project.id);
  const shown = showAll ? sessions : sessions.slice(0, PROJECT_PAGE);
  const hidden = sessions.length - shown.length;
  const more = moreNodeId(project.id);

  return (
    <div
      role="treeitem"
      aria-level={1}
      aria-expanded={expanded}
      aria-selected={false}
      aria-label={project.name}
      tabIndex={tree.tabStop === nodeId ? 0 : -1}
      data-tree-id={nodeId}
      data-kind="project"
      data-menu={`project:${project.id}`}
      onFocus={(event) => event.target === event.currentTarget && tree.onFocusItem(nodeId)}
      className="group/project outline-none"
    >
      <div
        onClick={() => onToggle(project.id)}
        className="group/line flex h-(--row-h) cursor-default items-center gap-[5px] rounded-sm px-[7px] select-none group-focus-visible/project:outline-2 group-focus-visible/project:-outline-offset-2 group-focus-visible/project:outline-accent hover:bg-bg-hover"
      >
        <ChevronDownIcon className={`size-[13px] text-fg-muted transition-transform motion-reduce:transition-none ${expanded ? '' : '-rotate-90'}`} />
        <FolderIcon className="size-[13px] text-fg-muted" />
        <span className="min-w-0 flex-1 truncate text-ui-sm text-fg">{project.name}</span>
        {!expanded && rollup.needsYou > 0 && (
          <span aria-label={`${rollup.needsYou} need you`} className="text-ui-sm text-warning tabular-nums">
            ◐{rollup.needsYou}
          </span>
        )}
        {!expanded && rollup.working > 0 && (
          <span aria-label={`${rollup.working} working`} className="text-ui-sm text-accent tabular-nums">
            ●{rollup.working}
          </span>
        )}
        <button
          type="button"
          tabIndex={-1}
          aria-label={`New session in ${project.name}`}
          title={canCreate ? `New session in ${project.name}` : 'Arrives with C10'}
          disabled={!canCreate}
          onClick={(event) => {
            event.stopPropagation();
            void createSession(project.id);
          }}
          className="inline-flex size-[22px] items-center justify-center rounded-sm text-fg-muted opacity-0 group-hover/line:opacity-100 group-focus/project:opacity-100 hover:bg-bg-hover hover:text-fg disabled:text-fg-faint disabled:hover:bg-transparent"
        >
          <PlusIcon className="size-[13px]" />
        </button>
      </div>
      {expanded && (
        <div role="group" aria-label={project.name} className="ml-2.5 border-l border-border pl-[5px]">
          {shown.map((record) => (
            <SessionRow key={record.appId} record={record} level={2} />
          ))}
          {hidden > 0 && (
            <div
              role="treeitem"
              aria-level={2}
              aria-selected={false}
              aria-label={`Show ${hidden} more`}
              tabIndex={tree.tabStop === more ? 0 : -1}
              data-tree-id={more}
              data-kind="more"
              onFocus={(event) => event.target === event.currentTarget && tree.onFocusItem(more)}
              onClick={() => onShowMore(project.id)}
              className="flex h-(--row-h) cursor-default items-center rounded-sm px-[9px] text-ui-sm text-fg-muted outline-accent select-none hover:bg-bg-hover hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2"
            >
              Show {hidden} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}
