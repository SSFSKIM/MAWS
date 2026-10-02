// A project's page, the sidebar's second level (§5.1 as amended 2026-10-01, W5): "‹ Projects" back, the project's name
// with the session sort and its "+", then its sessions: pinned ones on top, then Main and each worktree in
// `git worktree list` order, each group headed by the folder name with the branch beside it and a "+" that opens an
// unstarted session in that checkout. A project with no worktree session is one flat list. The page scrolls; nothing is
// capped.
import { DropdownMenu } from 'radix-ui';
import type { KeyboardEvent, RefObject } from 'react';
import { ChevronLeftIcon, IconButton, PlusIcon, SortIcon } from '../app/IconButton';
import { createSession, useSessionCreatorRegistered } from '../keymap/actions-runtime';
import type { SidebarSort } from '../overview/derive';
import { useLayout } from '../stores/layout';
import type { ProjectEntry, ProjectPage as Page, SessionGroup } from './derive';
import { SessionRow } from './SessionRow';

export interface ProjectPageProps {
  entry: ProjectEntry;
  page: Page;
  sort: SidebarSort;
  searching: boolean;
  backRef: RefObject<HTMLButtonElement | null>;
  onBack(): void;
  onTreeKeyDown(event: KeyboardEvent<HTMLElement>): void;
}

export function ProjectPage({ entry, page, sort, searching, backRef, onBack, onTreeKeyDown }: ProjectPageProps) {
  const { project, name } = entry;
  const canCreate = useSessionCreatorRegistered();
  const empty = page.pinned.length === 0 && page.groups.every((g) => g.sessions.length === 0);

  return (
    <div className="flex flex-col">
      <button
        ref={backRef}
        type="button"
        aria-label="Back to projects"
        onClick={onBack}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'Backspace') {
            event.preventDefault();
            onBack();
          }
        }}
        className="flex h-7 w-fit cursor-default items-center gap-1 rounded-sm pr-2 pl-1 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2"
      >
        <ChevronLeftIcon className="size-[13px]" />
        Projects
      </button>
      <div className="mt-0.5 mb-1 flex h-(--row-h) items-center gap-0.5 pr-1 pl-[9px]">
        <h2 className="m-0 min-w-0 flex-1 truncate text-ui font-semibold text-fg">{name}</h2>
        <SortMenu sort={sort} />
        {project && (
          <IconButton
            label={`New chat in ${name}`}
            disabled={!canCreate}
            onClick={() => void createSession(project.id)}
            className="size-[22px]"
          >
            <PlusIcon className="size-[13px]" />
          </IconButton>
        )}
      </div>
      {empty ? (
        <p className="m-0 px-[9px] py-1.5 text-ui-sm text-fg-faint">{searching ? 'No sessions match' : 'No sessions yet'}</p>
      ) : (
        <div role="tree" aria-label={name} onKeyDown={onTreeKeyDown} className="flex flex-col">
          {page.pinned.map((record) => (
            <SessionRow key={record.appId} record={record} level={1} />
          ))}
          {page.grouped
            ? page.groups.map((group) => <Group key={group.key} group={group} entry={entry} />)
            : page.groups[0]?.sessions.map((record) => <SessionRow key={record.appId} record={record} level={1} />)}
        </div>
      )}
    </div>
  );
}

const groupName = (group: SessionGroup) => (group.branch ? `${group.label} · ${group.branch}` : group.label);

function Group({ group, entry }: { group: SessionGroup; entry: ProjectEntry }) {
  const canCreate = useSessionCreatorRegistered();
  const project = entry.project;
  const create = () => {
    if (!project) return;
    void (group.path === null ? createSession(project.id) : createSession(project.id, { location: { kind: 'existingWorktree', repoRoot: project.directory, path: group.path } }));
  };
  return (
    <div role="group" aria-label={groupName(group)} data-group={group.kind} className="flex flex-col">
      <div className="group/heading mt-2 flex h-6 items-center gap-1.5 pr-1 pl-[9px] text-ui-sm select-none">
        <span aria-hidden className="min-w-0 truncate font-medium text-fg-muted">
          {group.label}
        </span>
        {group.branch && (
          <span aria-hidden className="min-w-0 truncate text-fg-faint">
            ⎇ {group.branch}
          </span>
        )}
        {project && (
          <button
            type="button"
            aria-label={`New chat in ${group.label}`}
            title={canCreate ? `New chat in ${group.label}` : 'Not available here'}
            disabled={!canCreate}
            onClick={create}
            className="ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-muted opacity-0 outline-accent group-hover/heading:opacity-100 hover:bg-bg-hover hover:text-fg focus-visible:opacity-100 focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent"
          >
            <PlusIcon className="size-3" />
          </button>
        )}
      </div>
      {group.sessions.map((record) => (
        <SessionRow key={record.appId} record={record} level={2} />
      ))}
    </div>
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
