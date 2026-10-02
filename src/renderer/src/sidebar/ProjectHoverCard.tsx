// A project row's hover card (§5.1 as amended 2026-10-01, W11, I6; the owner: "adopt Codex's hover-project: … cwd,
// project name, and more"), in the sidebar's shared card shell (`SidebarHoverCard`). Codex's card names the project, its
// counts and its paths (readable/chatgpt-26.928.40906/renderer/app/app-initial-27bc4044d9e8.js:525811-526198, the
// summary line at :527226-527250, the path rows home-abbreviated at :525682-525721); MAWS's says the name, the full
// path home-abbreviated, how many sessions it holds with how many wait and work, when it last moved, and its worktrees
// with their branches, read from git when the card opens (`git.worktree.list`), never while it is closed.
import { useEffect, useState, type ReactNode } from 'react';
import type { ProjectRecord } from '@shared/ipc/schema';
import type { WorktreeInfo } from '@shared/sessions/worktree';
import { useNow } from '../app/use-now';
import { formatCwd } from '../composer/frame/LocationChip';
import { ipc } from '../ipc/client';
import { formatAge, type ProjectEntry } from './derive';
import { SidebarHoverCard } from './HoverCard';

export interface ProjectHoverCardProps {
  entry: ProjectEntry & { project: ProjectRecord };
  open: boolean;
  onOpenChange(open: boolean): void;
  children: ReactNode;
}

export function ProjectHoverCard({ entry, open, onOpenChange, children }: ProjectHoverCardProps) {
  return (
    <SidebarHoverCard label={entry.name} content={<Body entry={entry} />} open={open} onOpenChange={onOpenChange}>
      {children}
    </SidebarHoverCard>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

function Body({ entry }: { entry: ProjectEntry & { project: ProjectRecord } }) {
  const { project, sessions, rollup, lastActivity } = entry;
  const now = useNow();
  const age = lastActivity === null ? null : formatAge(now - lastActivity);
  const counts = [plural(sessions.length, 'session', 'sessions'), `${rollup.waiting} waiting`, `${rollup.working} working`].join(' · ');

  return (
    <div className="flex flex-col gap-2 text-ui-sm text-fg">
      <h3 className="m-0 truncate text-ui leading-[18px] font-semibold">{entry.name}</h3>
      <p data-testid="project-path" title={project.directory} className="m-0 font-mono break-all text-fg-muted">
        {formatCwd(project.directory)}
      </p>
      <p data-testid="project-counts" className="m-0 text-fg-muted tabular-nums">
        {counts}
      </p>
      <p data-testid="project-activity" className="m-0 text-fg-muted tabular-nums">
        {age === null ? 'No activity yet' : age === 'now' ? 'Active now' : `Last active ${age} ago`}
      </p>
      <Worktrees directory={project.directory} />
    </div>
  );
}

type Read = { state: 'reading' } | { state: 'read'; worktrees: WorktreeInfo[] } | { state: 'none' };

// The checkouts of the project's repository in git's order, the main one first; nothing for a folder git does not know.
function Worktrees({ directory }: { directory: string }) {
  const [read, setRead] = useState<Read>({ state: 'reading' });
  useEffect(() => {
    let live = true;
    void ipc.invoke('git.worktree.list', { repoRoot: directory }).then(
      (result) => live && setRead(result.ok ? { state: 'read', worktrees: result.value.worktrees } : { state: 'none' }),
      () => live && setRead({ state: 'none' }),
    );
    return () => {
      live = false;
    };
  }, [directory]);

  if (read.state === 'none') return null;
  return (
    <div className="mt-1 border-t border-border pt-2">
      <h4 className="m-0 mb-1 text-ui-sm font-medium text-fg-muted">Worktrees</h4>
      {read.state === 'reading' ? (
        <p className="m-0 text-fg-faint">Reading…</p>
      ) : (
        <ul aria-label="Worktrees" className="m-0 flex max-h-40 list-none flex-col gap-0.5 overflow-y-auto p-0 [scrollbar-width:thin]">
          {read.worktrees.map((w) => (
            <li key={w.path} title={w.path} className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 truncate">{w.branch ? `⎇ ${w.branch}` : 'detached'}</span>
              <span className="ml-auto shrink-0 truncate text-fg-faint">{w.isMain ? 'main checkout' : basename(w.path)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
