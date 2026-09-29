// A project's archived sessions (C10 execution document, Actions: `project.archived`): a dialog list, not a sidebar
// section (C5 hides archived rows and C10 adds none). Each row offers Unarchive (C4's `session.update`), Delete, and,
// for a session in a managed worktree, "Remove worktree…" (the cleanup dialog).
import { useEffect, useState } from 'react';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { ipc } from '../ipc/client';
import { useSessions } from '../stores/sessions';
import { isManagedWorktree } from './ArchiveDialog';
import { cleanupTargetOf } from './CleanupDialog';
import { openDialog } from './dialogs';
import { Sheet } from './Sheet';
import { QUIET, SECONDARY } from './ui';

export function ArchivedSessionsDialog({ projectId }: { projectId: ProjectId }) {
  const project = useSessions((s) => s.projects.get(projectId) ?? null);
  const [rows, setRows] = useState<SessionRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // read again after an unarchive

  useEffect(() => {
    let live = true;
    void ipc.invoke('session.list', { includeArchived: true }).then((result) => {
      if (!live) return;
      if (!result.ok) return setError(result.error.message);
      setRows(result.value.sessions.filter((r) => r.archived && r.projectId === projectId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    });
    return () => {
      live = false;
    };
  }, [projectId, version]);

  const unarchive = async (appSessionId: AppSessionId) => {
    const result = await ipc.invoke('session.update', { appSessionId, patch: { archived: false } });
    if (!result.ok) setError(result.error.message);
    setVersion((v) => v + 1);
  };

  return (
    <Sheet title={`Archived sessions${project ? ` · ${project.name}` : ''}`} width="w-[min(560px,92vw)]">
      {rows === null ? (
        <p className="m-0 text-fg-muted">{error ?? 'Loading…'}</p>
      ) : rows.length === 0 ? (
        <p className="m-0 text-fg-muted">No archived sessions.</p>
      ) : (
        <ul aria-label="Archived sessions" className="m-0 flex max-h-[50vh] list-none flex-col overflow-auto p-0">
          {rows.map((r) => (
            <li key={r.appId} aria-label={r.title.text} className="flex items-center gap-2 border-b border-border py-1.5 last:border-b-0">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-fg">{r.title.text}</span>
                <span className="truncate font-mono text-ui-sm text-fg-muted">{r.worktree?.path ?? r.directory}</span>
              </div>
              <button type="button" onClick={() => void unarchive(r.appId)} className={SECONDARY}>
                Unarchive
              </button>
              {r.worktree !== null && isManagedWorktree(r.worktree.path) && (
                <button type="button" onClick={() => openDialog({ kind: 'cleanup', target: cleanupTargetOf(r)! })} className={QUIET}>
                  Remove worktree…
                </button>
              )}
              <button type="button" onClick={() => openDialog({ kind: 'delete', appSessionId: r.appId })} className={QUIET}>
                Delete…
              </button>
            </li>
          ))}
        </ul>
      )}
      {rows !== null && error && <p className="m-0 mt-2 text-ui-sm text-danger">{error}</p>}
    </Sheet>
  );
}
