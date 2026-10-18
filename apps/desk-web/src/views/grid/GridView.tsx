// The home: the grid of the org's projects (§4), live from the registry socket, in the states of the approved mockup
// (mockups/desk/01-grid.html, card B): connecting on first load (tile shapes only — no zeros, which would claim nobody
// is waiting), empty (enrolling a machine is the one next step), and reconnecting (the last counts held, dimmed, with
// how old they are; tiles still open). Once the hub refuses this browser (its sign-in expired), the notice says so and
// offers to sign in again, in place of waiting for an answer that will not come. On a phone, two columns of the same
// tiles (mockups/desk/05-phone.html, 2).
import { useMemo } from 'react';
import { useAccess } from '../../hub/access';
import { useDeskLayout } from '../../shell/layout';
import { sortForGrid, useGrid } from '../../state/grid';
import { LapsedBanner } from '../access/SignInAgain';
import { GridPushBanner } from '../notifications/PushBanner';
import { ProjectCard } from './ProjectCard';

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function GridView({ onEnroll }: { onEnroll: () => void }) {
  const { projects, loaded, status, asOf } = useGrid();
  const navigate = useDeskLayout((s) => s.navigate);
  const sorted = useMemo(() => sortForGrid(projects), [projects]);
  const lapsed = useAccess((s) => s.lapsed);
  const stale = loaded && (status === 'connecting' || lapsed !== null);
  const asOfText = `Counts as of ${asOf === null ? 'the last connection' : time(asOf)}.`;
  return (
    <main className="h-full overflow-y-auto bg-bg" aria-label="Projects">
      <GridPushBanner />
      {lapsed !== null ? (
        <LapsedBanner lapse={lapsed} what="the grid" lead={stale && sorted.length > 0 ? asOfText : undefined} />
      ) : (
        stale &&
        sorted.length > 0 && (
          <div className="flex items-center gap-2 border-b border-border bg-bg-raised px-6 py-2 text-ui-sm text-fg-muted" role="status" data-testid="grid-stale">
            <strong className="font-medium text-fg">{asOfText}</strong> They may have changed since; the grid updates as soon as the hub answers.
          </div>
        )
      )}
      <div className="mx-auto max-w-[1120px] px-4 py-4 md:px-6 md:py-6">
        {!loaded ? (
          <ul className="m-0 grid list-none grid-cols-2 gap-2 md:grid-cols-[repeat(auto-fill,minmax(240px,1fr))] md:gap-3 p-0" aria-busy="true" aria-label="Loading projects" data-testid="grid-loading">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex h-[132px] flex-col justify-between rounded-lg border border-border bg-bg-raised p-3.5" aria-hidden>
                <i className="block h-2.5 w-[58%] rounded-sm bg-bg-active" />
                <i className="block h-[22px] w-[34%] rounded-sm bg-bg-active" />
              </li>
            ))}
          </ul>
        ) : sorted.length === 0 ? (
          <div className="mx-auto mt-16 max-w-[420px] text-center" data-testid="grid-empty">
            <h2 className="m-0 text-ui font-semibold text-fg">No projects yet</h2>
            <p className="text-ui-sm leading-5 text-fg-muted">Projects appear here once a Mac running your Claude Code sessions is enrolled in the org. Each project it serves shows up as a tile.</p>
            <button type="button" onClick={onEnroll} className="rounded-sm bg-fg px-3.5 py-1.5 text-ui-sm font-semibold text-bg hover:bg-fg-muted">
              Enroll a machine
            </button>
            <p className="mt-3 text-ui-sm text-fg-muted">Enrolling takes a minute on the Mac itself.</p>
          </div>
        ) : (
          <ul className={['m-0 grid list-none grid-cols-2 gap-2 md:grid-cols-[repeat(auto-fill,minmax(240px,1fr))] md:gap-3 p-0', stale ? 'opacity-60' : ''].join(' ')} data-testid="grid">
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
