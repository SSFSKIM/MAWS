// The home: the grid of the org's projects (§4), live from the registry socket.
import { useMemo } from 'react';
import { useDeskLayout } from '../../shell/layout';
import { sortForGrid, useGrid } from '../../state/grid';
import { ProjectCard } from './ProjectCard';

export function GridView() {
  const { projects, loaded } = useGrid();
  const navigate = useDeskLayout((s) => s.navigate);
  const sorted = useMemo(() => sortForGrid(projects), [projects]);
  return (
    <main className="h-full overflow-y-auto bg-bg" aria-label="Projects">
      <div className="mx-auto max-w-[1120px] px-6 py-6">
        {!loaded ? (
          <p className="text-ui-sm text-fg-muted">Loading projects…</p>
        ) : sorted.length === 0 ? (
          <div className="mx-auto mt-16 max-w-[420px] text-center">
            <h2 className="m-0 text-ui font-semibold text-fg">No projects yet</h2>
            <p className="text-ui-sm leading-5 text-fg-muted">A project appears here once a machine serving it is enrolled in the org.</p>
          </div>
        ) : (
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3 p-0" data-testid="grid">
            {sorted.map((project) => (
              <li key={project.id}>
                <ProjectCard project={project} onOpen={() => navigate({ view: 'project', project: project.id, channel: { kind: 'group' } })} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
