// One project in Codex's flat tree (§5.1 as amended 2026-10-01, W11, I4 and I8): a 36px disclosure row (Codex's is 30px;
// the owner asked for a little taller) with a folder that opens while expanded and no chevron, the name, the waiting (◐,
// warning) and working (●, accent) counts while collapsed, and its actions on hover in their place (Codex's hover swaps
// the collapsed status for its actions: readable/chatgpt-26.928.40906/renderer/app/app-initial-27bc4044d9e8.js:543909-
// 543917 for the folders, :544150 and :466180 for the swap). A click, Enter or Space expands it in place with the shared
// disclosure motion (`ui/disclosure.tsx`, Codex's group motion at :377892-377927), no slide. Expanded, its sessions in
// one flat list of 30px rows (pinned first, worktree sessions marked by their ⎇ branch), their titles under the
// project's name as Codex's leading slot sets them (:437865-437867), at most five, then "Show more" to eight; a gap
// after the group (Codex's `pb-2`, :377821). A project's hover card is `ProjectHoverCard.tsx` (I6). "Other sessions" is
// the same row without actions, a context menu or a card. The pre-W5 group (`ProjectGroup.tsx` at 6d50bf26^) is the
// template.
import { useState } from 'react';
import type { ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { ArchiveIcon, FolderIcon, Icon, PlusIcon } from '../app/IconButton';
import { createSession, useSessionCreatorRegistered } from '../keymap/actions-runtime';
import { DisclosureBody } from '../ui/disclosure';
import type { ProjectEntry, ProjectKey } from './derive';
import { focusVisible } from './HoverCard';
import { ProjectHoverCard } from './ProjectHoverCard';
import { runProjectAction, useProjectActionEnabled } from './project-actions';
import { SessionRow } from './SessionRow';
import { moreNodeId, projectNodeId, useTree } from './tree';

export interface ProjectRowProps {
  entry: ProjectEntry;
  open: boolean;
  sessions: SessionRecord[]; // the rows shown while open (ordered and capped); empty while closed
  more: number; // how many more "Show more" reveals; 0: no Show more row
  onToggle(key: ProjectKey): void;
  onShowMore(key: ProjectKey): void;
}

export function ProjectRow({ entry, open, sessions, more, onToggle, onShowMore }: ProjectRowProps) {
  const { key, project, name, rollup } = entry;
  const tree = useTree();
  const nodeId = projectNodeId(key);
  // The rows stay as they were through the close, so the body folds over what it showed.
  const [kept, setKept] = useState({ sessions, more });
  if (open && (kept.sessions !== sessions || kept.more !== more)) setKept({ sessions, more });
  const shown = open ? { sessions, more } : kept;
  // The hover card (I6) hangs on the line, so a pointer over the expanded sessions does not open it; keyboard focus sits
  // on the treeitem, which opens it (a focus the pointer caused does not, as on every card).
  const [card, setCard] = useState(false);

  const line = (
    <div
      data-project-line
      onClick={() => onToggle(key)}
      className="group/line flex h-9 cursor-default items-center gap-[7px] rounded-sm pr-1 pl-[9px] select-none hover:bg-bg-hover group-focus-visible/project:outline-2 group-focus-visible/project:-outline-offset-2 group-focus-visible/project:outline-accent"
    >
      {open ? <FolderOpenIcon className={`size-[13px] ${project ? 'text-fg-muted' : 'text-fg-faint'}`} /> : <FolderIcon className={`size-[13px] ${project ? 'text-fg-muted' : 'text-fg-faint'}`} />}
      <span className={`min-w-0 flex-1 truncate text-ui ${project ? 'text-fg' : 'text-fg-muted'}`}>{name}</span>
      {!open && (rollup.waiting > 0 || rollup.working > 0) && (
        <span className="flex shrink-0 items-center gap-[7px] group-hover/line:hidden group-focus-visible/project:hidden">
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
        </span>
      )}
      {project ? <ProjectActions projectId={project.id} name={name} /> : <span aria-hidden className="size-[22px] shrink-0" />}
    </div>
  );

  return (
    <div
      role="treeitem"
      aria-level={1}
      aria-expanded={open}
      aria-selected={false}
      aria-label={name}
      tabIndex={tree.tabStop === nodeId ? 0 : -1}
      data-tree-id={nodeId}
      data-kind="project"
      data-menu={project ? `project:${project.id}` : undefined}
      onFocus={(event) => {
        if (event.target !== event.currentTarget) return;
        tree.onFocusItem(nodeId);
        if (project && focusVisible(event.currentTarget)) setCard(true);
      }}
      onBlur={(event) => event.target === event.currentTarget && setCard(false)}
      className="group/project outline-none"
    >
      {project ? (
        <ProjectHoverCard entry={{ ...entry, project }} open={card} onOpenChange={setCard}>
          {line}
        </ProjectHoverCard>
      ) : (
        line
      )}
      <DisclosureBody open={open} role="group" aria-label={name} className="pt-px pb-2">
        {shown.sessions.map((record) => (
          <SessionRow key={record.appId} record={record} level={2} />
        ))}
        {shown.more > 0 && <ShowMoreRow id={moreNodeId(key)} level={2} onShow={() => onShowMore(key)} />}
      </DisclosureBody>
    </div>
  );
}

const ACTION =
  'inline-flex size-[22px] shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-bg-active hover:text-fg disabled:text-fg-faint disabled:hover:bg-transparent';

// The row's hover actions, out of the tab order (the row is the tree's stop; its context menu carries the same actions
// for the keyboard): the archive icon removes the project from the sidebar after a confirm (I5; the menu's "Remove from
// sidebar…"), and "+" opens an unstarted session tab in the project ("New chat in X", the New chat landing's open copy
// item).
function ProjectActions({ projectId, name }: { projectId: ProjectId; name: string }) {
  const canCreate = useSessionCreatorRegistered();
  const canRemove = useProjectActionEnabled('removeProject');
  return (
    <span className="hidden shrink-0 items-center group-hover/line:flex group-focus-visible/project:flex">
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Remove ${name} from sidebar`}
        title={canRemove ? 'Remove from sidebar' : 'Not available here'}
        disabled={!canRemove}
        onClick={(event) => {
          event.stopPropagation();
          runProjectAction('removeProject', projectId);
        }}
        className={ACTION}
      >
        <ArchiveIcon className="size-[13px]" />
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`New chat in ${name}`}
        title={canCreate ? `New chat in ${name}` : 'Not available here'}
        disabled={!canCreate}
        onClick={(event) => {
          event.stopPropagation();
          void createSession(projectId);
        }}
        className={ACTION}
      >
        <PlusIcon className="size-[13px]" />
      </button>
    </span>
  );
}

// "Show more" (Codex's label, `sidebarElectron.showMore`): a tree item of its own, so the keyboard reaches it.
export function ShowMoreRow({ id, level, onShow }: { id: string; level: 1 | 2; onShow(): void }) {
  const tree = useTree();
  return (
    <div
      role="treeitem"
      aria-level={level}
      aria-selected={false}
      aria-label="Show more"
      tabIndex={tree.tabStop === id ? 0 : -1}
      data-tree-id={id}
      data-kind="more"
      onFocus={(event) => event.target === event.currentTarget && tree.onFocusItem(id)}
      onClick={onShow}
      className="flex h-(--row-h) cursor-default items-center rounded-sm pr-[9px] pl-[30px] text-ui-sm text-fg-muted outline-accent select-none hover:bg-bg-hover hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2"
    >
      Show more
    </div>
  );
}

// A folder with its front swung open (Codex's `folder-open` beside `folder` for an expanded project).
const FolderOpenIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M2 13V4h5l1.5 2H13v1.5M2 13l1.6-5.5H15L13.4 13z" />
  </Icon>
);
