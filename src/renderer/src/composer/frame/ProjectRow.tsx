// New chat (2026-10-01, the owner's ruling): an unstarted tab's row inside the frame, above the box, as Codex's
// new-thread composer has it (`ComposerUtilityBar`'s home layout, readable/chatgpt-26.928.40906/renderer/app/
// composer-utility-bar-e3a99627a7ad.js:9341-9356; its row "flex min-w-0 items-center justify-between gap-2 py-1.5" in a
// "px-1" item, app-primary-fc3cefe64ba8.js:43960-44014). At the left the project chip with its status dot and, read-only
// beside it, the checkout's branch (Codex's label, max-w-40, worktree-environment-dropdown-a806956d556a.js:1027-1088); at
// the right the "Worktree" checkbox, its label before the box (composer-utility-bar:8150-8216), hidden with no project,
// outside git and on an existing worktree (composer-utility-bar:8019, 8147). The chip's menu is Codex's project picker
// (app-primary:147519-147702, 154066-154125): "Search projects", the projects most recently active first (the sidebar's
// order) with a check on the chosen one and the folder's name where it differs from the project's, "No projects
// found", then "New project" and "Don't work in a project". Once the session starts the row is gone and the toolbar's
// location chip reads where it runs.
import { Command } from 'cmdk';
import { Popover } from 'radix-ui';
import { useMemo, useState } from 'react';
import type { ProjectRecord } from '@shared/ipc/schema';
import { projectList } from '../../sidebar/derive';
import { selectProjectOrder, useSessions } from '../../stores/sessions';
import type { HookResult } from '../setup-intent';
import type { ProjectRowBinding } from './bindings';
import { CHIP, POPOVER } from './chip-style';
import { formatCwd } from './LocationChip';

export const CHOOSE_PROJECT = 'Choose a project';
export const NEW_PROJECT = 'New project';
export const NO_PROJECT = "Don't work in a project";

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

// Every project the index lists, most recently active first: the sidebar's level-one order (`projectList`).
export function recentProjects(input: Parameters<typeof projectList>[0]): ProjectRecord[] {
  return projectList(input).flatMap((entry) => (entry.project ? [entry.project] : []));
}

// Codex's search over a project: its name, its folder and its path (app-primary:154181-154183).
export function matchesProject(project: ProjectRecord, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || project.name.toLowerCase().includes(q) || project.directory.toLowerCase().includes(q);
}

const ITEM = 'flex h-7 cursor-default items-center gap-2 rounded-sm px-2 text-ui outline-none select-none data-[selected=true]:bg-bg-hover data-[disabled=true]:text-fg-faint';

function ProjectMenu({ binding, disabled, onWrite }: { binding: ProjectRowBinding; disabled: boolean; onWrite(write: () => Promise<HookResult>): void }) {
  const [query, setQuery] = useState('');
  const records = useSessions((s) => s.records);
  const digests = useSessions((s) => s.digests);
  const projects = useSessions(selectProjectOrder);
  const ordered = useMemo(() => recentProjects({ records, digests, projects, rows: [] }), [records, digests, projects]);
  const shown = ordered.filter((p) => matchesProject(p, query));
  const collides = useMemo(() => {
    const count = new Map<string, number>();
    for (const p of ordered) count.set(p.name, (count.get(p.name) ?? 0) + 1);
    return (p: ProjectRecord) => (count.get(p.name) ?? 0) > 1;
  }, [ordered]);
  const noProject = binding.projectId === null && binding.label !== null;
  return (
    <Command label="Projects" shouldFilter={false} loop>
      <Command.Input
        value={query}
        onValueChange={setQuery}
        placeholder="Search projects"
        aria-label="Search projects"
        className="h-8 w-full border-b border-border bg-transparent px-2 text-ui text-fg outline-none placeholder:text-fg-faint"
      />
      <Command.List>
        {/* about five project rows show before they scroll (Codex, app-primary:147583); actions stay visible */}
        <Command.Group className="max-h-40 overflow-y-auto py-1">
          {/* the footer's items are cmdk items too, so its own Empty never shows: the list says it */}
          {shown.length === 0 && <p className="m-0 px-2 py-1.5 text-ui-sm text-fg-muted">No projects found</p>}
          {shown.map((project) => {
            const folder = basename(project.directory);
            const chosen = project.id === binding.projectId;
            return (
              <Command.Item
                key={project.id}
                value={`project:${project.id}`}
                disabled={disabled}
                onSelect={() => onWrite(() => binding.choose(project.id))}
                title={collides(project) ? formatCwd(project.directory) : undefined}
                aria-current={chosen || undefined}
                className={ITEM}
              >
                <span className="min-w-0 truncate">{project.name}</span>
                {folder !== project.name && <span className="min-w-0 shrink truncate text-ui-sm text-fg-muted">{folder}</span>}
                <span aria-hidden className="ml-auto w-3 shrink-0 text-accent">
                  {chosen ? '✓' : ''}
                </span>
              </Command.Item>
            );
          })}
        </Command.Group>
        <Command.Separator alwaysRender className="border-t border-border" />
        <Command.Group className="py-1">
          <Command.Item value="new-project" disabled={disabled} onSelect={() => onWrite(binding.newProject)} className={ITEM}>
            {NEW_PROJECT}
          </Command.Item>
          {!noProject && (
            <Command.Item value="no-project" disabled={disabled} onSelect={() => onWrite(() => binding.choose(null))} className={ITEM}>
              {NO_PROJECT}
            </Command.Item>
          )}
        </Command.Group>
      </Command.List>
    </Command>
  );
}

export function ProjectRow({ binding }: { binding: ProjectRowBinding }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const chosen = binding.label !== null;
  const disabled = binding.disabled !== null || pending;
  // All row writes share this lock: a worktree location must use the settled project's repository facts.
  const run = async (write: () => Promise<HookResult>) => {
    if (disabled) return;
    setPending(true);
    try {
      const result = await write();
      setError(result.ok ? null : result.error);
      if (result.ok) setOpen(false);
    } finally {
      setPending(false);
    }
  };
  const title = binding.disabled ?? (chosen ? `${binding.path ?? binding.label} · Change the project for this chat` : 'Select a project to run your chat in');
  return (
    <div data-project-row className="flex min-w-0 flex-col">
      <div className="flex min-w-0 items-center justify-between gap-2 px-1 py-1.5">
        <div className="flex min-w-0 items-center gap-1">
          <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger aria-label={chosen ? `Project ${binding.label}` : CHOOSE_PROJECT} title={title} className={`${CHIP} ${chosen ? 'text-fg' : ''}`}>
              {/* the status dot: ready to run where the chip says, or waiting for a project (Codex's size-2 badge, app-initial:453119-453146) */}
              <span aria-hidden className={`size-2 shrink-0 rounded-full ${chosen ? 'bg-success' : 'bg-fg-faint'}`} />
              <span className="truncate">{chosen ? binding.label : CHOOSE_PROJECT}</span>
              <span aria-hidden className="shrink-0 text-fg-faint">⌄</span>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content aria-label="Choose a project" side="top" align="start" sideOffset={6} collisionPadding={8} className={`${POPOVER} w-72 p-0`}>
                <ProjectMenu binding={binding} disabled={disabled} onWrite={(write) => void run(write)} />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          {binding.branch !== null && (
            <span aria-label={`Branch ${binding.branch}`} title={binding.branch} className="max-w-40 truncate font-mono text-ui-sm text-fg-muted">
              ⎇ {binding.branch}
            </span>
          )}
        </div>
        {binding.worktree !== null && (
          <label title={binding.disabled ?? 'Run this chat in a new git worktree'} className="relative flex shrink-0 items-center gap-2 pe-2 text-ui-sm text-fg-muted select-none">
            Worktree
            <input
              type="checkbox"
              checked={binding.worktree}
              disabled={disabled}
              onChange={(event) => void run(() => binding.setWorktree(event.target.checked))}
              className="size-3.5 accent-accent"
            />
          </label>
        )}
      </div>
      {error !== null && (
        <p role="alert" className="m-0 px-2 pb-1 text-ui-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
