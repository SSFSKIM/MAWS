import { useId, useMemo, useState } from 'react';
import type { ProjectRecord } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { SECONDARY } from '../sessions/ui';
import { projectLabels } from '../sidebar/project-labels';
import { isSidebarProject, projectGroups } from '../sidebar/project-groups';
import { runAddProject, runProjectAction, useAddProjectEnabled, useProjectActionEnabled } from '../sidebar/project-actions';
import { useSessions } from '../stores/sessions';
import { SearchField } from '../widgets/plugins/LibraryHeader';

// UX2-K: UX1's Add-project chooser as an app destination. Discovery is a choice, not sidebar membership;
// only the add command promotes it. Removal and the native chooser keep the shell's existing action paths.
export function ProjectsView() {
  const heading = useId();
  const projects = useSessions((s) => s.projects);
  const loaded = useSessions((s) => s.loaded);
  const groups = useMemo(() => projectGroups([...projects.values()]), [projects]);
  const labels = useMemo(() => projectLabels([...projects.values()]), [projects]);
  const canChooseFolder = useAddProjectEnabled();
  const canHide = useProjectActionEnabled('removeProject');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const found = groups.map((group) => ({ ...group, projects: group.projects.filter((p) => `${p.name} ${p.directory}`.toLowerCase().includes(q)) })).filter((group) => group.projects.length > 0);

  const show = async (project: ProjectRecord) => {
    setBusy(true);
    setError(null);
    try {
      const result = await ipc.invoke('session.projects.add', { directory: project.directory });
      if (!result.ok) setError(result.error.message);
      // The revisioned project-list event updates membership, never this unrevisioned response.
    } finally { setBusy(false); }
  };

  return (
    <section aria-labelledby={heading} className="@container/projects flex h-full min-h-0 min-w-0 flex-col bg-bg text-ui text-fg">
      <header className="shrink-0 border-b border-border">
        <div className="mx-auto flex w-full max-w-(--measure-wide) flex-wrap items-center gap-x-3 gap-y-2 px-6 py-3 @max-lg/projects:px-3">
          <h1 id={heading} className="m-0 text-ui font-semibold">Projects</h1>
          <div className="ml-auto flex min-w-0 items-center gap-2 @max-lg/projects:ml-0 @max-lg/projects:w-full @max-lg/projects:flex-wrap [&>label]:max-w-full @max-lg/projects:[&>label]:flex-1">
            <SearchField label="Search projects" value={query} onChange={setQuery} />
            <button type="button" disabled={!canChooseFolder || busy} title={canChooseFolder ? undefined : 'Not available here'} onClick={runAddProject} className={`${SECONDARY} text-ui-sm`}>
              Choose folder…
            </button>
          </div>
        </div>
      </header>
      <div className="min-h-0 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto w-full max-w-(--measure-wide) px-6 py-4 @max-lg/projects:px-3">
          <p className="m-0 mb-4 text-ui-sm leading-normal text-fg-muted">Choose projects to keep in your sidebar. Hiding a project does not delete its sessions.</p>
          {error && <p role="alert" className="m-0 mb-3 text-ui-sm text-danger">{error}</p>}
          {!loaded && projects.size === 0 ? (
            <p role="status" className="m-0 py-3 text-ui-sm text-fg-muted">Loading projects…</p>
          ) : found.length === 0 ? (
            <p className="m-0 py-3 text-ui-sm text-fg-muted">{q ? 'No matching projects' : 'No projects yet'}</p>
          ) : (
            found.map((group) => (
              <section key={group.label} className="mb-5">
                <h2 className="m-0 mb-2 text-ui-sm font-medium text-fg-muted">{group.label}</h2>
                <ul aria-label={group.label} className="m-0 list-none divide-y divide-border border-y border-border p-0">
                  {group.projects.map((project) => {
                    const label = labels.get(project.id)!;
                    const member = isSidebarProject(project);
                    const action = member ? 'Hide from sidebar' : 'Show in sidebar';
                    return (
                      <li key={project.id} aria-label={label} className="flex min-w-0 items-center gap-4 py-3 @max-lg/projects:flex-col @max-lg/projects:items-start @max-lg/projects:gap-2">
                        <div className="min-w-0 flex-1 @max-lg/projects:w-full">
                          <div className="truncate font-medium" title={label}>{label}</div>
                          <div className="mt-0.5 truncate text-ui-sm text-fg-muted @max-lg/projects:break-all @max-lg/projects:whitespace-normal" title={project.directory}>{project.directory}</div>
                        </div>
                        <button
                          type="button"
                          aria-label={`${action}: ${label}`}
                          disabled={busy || (member && !canHide)}
                          title={member && !canHide ? 'Not available here' : undefined}
                          onClick={() => { if (member) runProjectAction('removeProject', project.id); else void show(project); }}
                          className={`${SECONDARY} shrink-0 text-ui-sm`}
                        >
                          {action}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
