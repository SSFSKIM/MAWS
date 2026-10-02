// One project on the sidebar's first level (§5.1 as amended 2026-10-01, W5): its name, how many of its sessions wait
// for the human (◐, warning) and how many work (●, accent), and a "+" on hover that opens an unstarted session tab in it.
// A click opens the project's page. "Other sessions" is the same row without a "+" or a context menu.
import { FolderIcon, PlusIcon } from '../app/IconButton';
import { createSession, useSessionCreatorRegistered } from '../keymap/actions-runtime';
import type { ProjectEntry, ProjectKey } from './derive';
import { projectNodeId, useTree } from './tree';

export function ProjectRow({ entry, onOpen }: { entry: ProjectEntry; onOpen(key: ProjectKey): void }) {
  const { key, project, name, rollup } = entry;
  const tree = useTree();
  const canCreate = useSessionCreatorRegistered();
  const nodeId = projectNodeId(key);

  return (
    <div
      role="treeitem"
      aria-level={1}
      aria-selected={false}
      aria-label={name}
      tabIndex={tree.tabStop === nodeId ? 0 : -1}
      data-tree-id={nodeId}
      data-kind="project"
      data-menu={project ? `project:${project.id}` : undefined}
      onFocus={(event) => event.target === event.currentTarget && tree.onFocusItem(nodeId)}
      onClick={() => onOpen(key)}
      className="group/project flex h-(--row-h) cursor-default items-center gap-[7px] rounded-sm pr-1 pl-[9px] outline-accent select-none hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2"
    >
      <FolderIcon className={`size-[13px] ${project ? 'text-fg-muted' : 'text-fg-faint'}`} />
      <span className={`min-w-0 flex-1 truncate text-ui ${project ? 'text-fg' : 'text-fg-muted'}`}>{name}</span>
      {rollup.waiting > 0 && (
        <span aria-label={`${rollup.waiting} waiting`} className="text-ui-sm text-warning tabular-nums">
          ◐{rollup.waiting}
        </span>
      )}
      {rollup.working > 0 && (
        <span aria-label={`${rollup.working} working`} className="text-ui-sm text-accent tabular-nums">
          ●{rollup.working}
        </span>
      )}
      {project ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`New chat in ${name}`}
          title={canCreate ? `New chat in ${name}` : 'Not available here'}
          disabled={!canCreate}
          onClick={(event) => {
            event.stopPropagation();
            void createSession(project.id);
          }}
          className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-sm text-fg-muted opacity-0 group-hover/project:opacity-100 group-focus-visible/project:opacity-100 hover:bg-bg-hover hover:text-fg disabled:text-fg-faint disabled:hover:bg-transparent"
        >
          <PlusIcon className="size-[13px]" />
        </button>
      ) : (
        <span aria-hidden className="size-[22px] shrink-0" />
      )}
    </div>
  );
}
