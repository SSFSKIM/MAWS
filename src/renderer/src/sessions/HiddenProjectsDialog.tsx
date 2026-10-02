// The projects removed from the sidebar (W11, I5): the sidebar's "Hidden projects…" opens this list, each project with
// its home-abbreviated path and "Show again", which adds its directory as the user's project (`session.projects.add`
// unhides it). The list follows `session.projects.changed`, so a project shown again leaves it.
import { useState } from 'react';
import type { ProjectId } from '@shared/graph/ids';
import { formatCwd } from '../composer/frame/LocationChip';
import { ipc } from '../ipc/client';
import { selectHiddenProjects, useSessions } from '../stores/sessions';
import { Sheet } from './Sheet';
import { SECONDARY } from './ui';

export function HiddenProjectsDialog() {
  const hidden = useSessions(selectHiddenProjects);
  const [busy, setBusy] = useState<ProjectId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showAgain = async (id: ProjectId, directory: string) => {
    setBusy(id);
    setError(null);
    const result = await ipc.invoke('session.projects.add', { directory });
    setBusy(null);
    if (!result.ok) setError(result.error.message);
  };

  return (
    <Sheet title="Hidden projects" width="w-[min(520px,92vw)]">
      {hidden.length === 0 ? (
        <p className="m-0 text-fg-muted">No hidden projects.</p>
      ) : (
        <ul aria-label="Hidden projects" className="m-0 flex max-h-[50vh] list-none flex-col overflow-auto p-0">
          {hidden.map((p) => (
            <li key={p.id} aria-label={p.name} className="flex items-center gap-2 border-b border-border py-1.5 last:border-b-0">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-fg">{p.name}</span>
                <span title={p.directory} className="truncate font-mono text-ui-sm text-fg-muted">
                  {formatCwd(p.directory)}
                </span>
              </div>
              <button type="button" disabled={busy !== null} onClick={() => void showAgain(p.id, p.directory)} className={SECONDARY}>
                Show again
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="m-0 mt-2 text-ui-sm text-danger">{error}</p>}
    </Sheet>
  );
}
