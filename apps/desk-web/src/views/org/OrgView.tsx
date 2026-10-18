// "All sessions" (smns org directory §8): every live session of every project on one screen, waiting on the owner
// first, then working, then idle; an ended session is not drawn. It is each project's own view lifted over the grid:
// the view holds every project's connection while it is mounted (`useProjectConnection`, shared with any project view
// open in the tab), reads each one's sessions as that project's sidebar does (`useDeskSessions`: its verified log and
// its live state), and merges them (`mergeOrgGroups`). A row names the session (`SessionLabel`: title, else alias, with
// its machine), its project and its in-charge line; a click opens the session's channel in its project. The browser
// draws only what it has verified with the org key, so a locked tab draws the grid's counts — the hub's, which the grid
// shows anyway — and no session, and opens no project.
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { Me } from '../../hub/me';
import { useKeyHolder } from '../../key/holder';
import type { SessionGroup } from '../../log/projection';
import { useProjectConnection } from '../../project/registry';
import { orgWaiting } from '../../pwa/badge';
import { useDeskLayout } from '../../shell/layout';
import { mergeOrgGroups, ORG_GROUPS, type OrgGroup, type OrgSession } from '../../shell/org-sessions';
import { SessionLabel } from '../../shell/SessionLabel';
import { useDeskSessions, type DeskSession } from '../../shell/sessions';
import { useGrid } from '../../state/grid';
import { UnlockForm } from '../key/UnlockForm';

const HEADINGS: Record<OrgGroup, string> = { waiting: 'Waiting on you', working: 'Working', idle: 'Idle' };

/** What one project's feed reports: its sessions grouped, and whether its backlog has arrived. */
type Fed = { groups: Record<SessionGroup, DeskSession[]>; caughtUp: boolean };

export function OrgView({ me }: { me: Me }) {
  const projects = useGrid((s) => s.projects);
  const loaded = useGrid((s) => s.loaded);
  const keyState = useKeyHolder((s) => s.state);
  const [fed, setFed] = useState<Record<string, Fed>>({});
  const report = useCallback((project: string, next: Fed | null) => {
    setFed((all) => {
      if (next !== null) return { ...all, [project]: next };
      const rest = { ...all };
      delete rest[project];
      return rest;
    });
  }, []);
  const groups = useMemo(() => mergeOrgGroups(projects.filter((p) => fed[p.id]).map((p) => ({ project: p.id, name: p.name, groups: fed[p.id].groups }))), [projects, fed]);
  const reading = projects.filter((p) => !fed[p.id]?.caughtUp).length;
  const shown = ORG_GROUPS.filter((g) => groups[g].length > 0);
  const locked = keyState !== 'unlocked';
  return (
    <main className="h-full overflow-y-auto bg-bg" aria-label="All sessions" data-testid="org-view">
      <div className="mx-auto max-w-[880px] px-4 py-4 md:px-6 md:py-6">
        {keyState === 'loading' ? null : locked ? (
          <Locked me={me} />
        ) : (
          <>
            {projects.map((p) => (
              <ProjectFeed key={p.id} project={p.id} report={report} />
            ))}
            {loaded && reading > 0 && (
              <p className="m-0 mb-3 text-ui-sm text-fg-muted" role="status" data-testid="org-reading">
                Reading {reading === 1 ? 'one project' : `${reading} projects`} of {projects.length}…
              </p>
            )}
            {loaded && reading === 0 && shown.length === 0 && (
              <p className="m-0 text-ui-sm text-fg-muted" data-testid="org-empty">
                No session is running in any project.
              </p>
            )}
            {shown.map((group) => (
              <section key={group} aria-label={HEADINGS[group]} data-group={group} className="mb-4">
                <h3 className={['m-0 flex h-[22px] items-center gap-2 px-2.5 text-label font-semibold tracking-[1px] uppercase', group === 'waiting' ? 'text-warning' : 'text-fg-muted'].join(' ')}>
                  {HEADINGS[group]}
                  <span className="font-normal tabular-nums">{groups[group].length}</span>
                </h3>
                <ul className="m-0 list-none p-0">
                  {groups[group].map((session) => (
                    <li key={`${session.project}:${session.session}`}>
                      <Row session={session} group={group} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
    </main>
  );
}

/** One project's sessions, read from its connection, reported to the view; draws nothing itself. */
const ProjectFeed = memo(function ProjectFeed({ project, report }: { project: string; report: (project: string, fed: Fed | null) => void }) {
  const connection = useProjectConnection(project);
  const { groups } = useDeskSessions(connection);
  const caughtUp = useStore(connection.live, (s) => s.caughtUp);
  useEffect(() => report(project, { groups, caughtUp }), [project, groups, caughtUp, report]);
  useEffect(() => () => report(project, null), [project, report]);
  return null;
});

function Row({ session, group }: { session: OrgSession; group: OrgGroup }) {
  const navigate = useDeskLayout((s) => s.navigate);
  const offline = session.machineOnline === false;
  return (
    <button
      type="button"
      onClick={() => navigate({ view: 'project', project: session.project, channel: { kind: 'session', session: session.session } })}
      data-testid="org-session"
      data-session={session.session}
      data-project={session.project}
      data-group={group}
      className={['block w-full rounded-sm px-2.5 py-2 text-left hover:bg-bg-hover', offline ? 'text-fg-muted' : 'text-fg'].join(' ')}
    >
      <span className="flex min-w-0 items-baseline gap-1.5 text-ui-sm">
        <SessionLabel session={session} offline />
        <span className="ml-auto shrink-0 rounded-sm border border-border px-1.5 text-ui-sm text-fg-muted" data-testid="org-project">
          {session.projectName}
        </span>
      </span>
      {session.charge && (
        <span className="mt-0.5 block truncate text-ui-sm text-fg-muted" data-testid="charge">
          {session.charge}
        </span>
      )}
    </button>
  );
}

function Locked({ me }: { me: Me }) {
  const waiting = useGrid((s) => orgWaiting(s.projects));
  const working = useGrid((s) => s.projects.reduce((n, p) => n + p.working, 0));
  return (
    <div className="mx-auto mt-[6vh] max-w-[440px]" data-testid="org-locked">
      <p className="m-0 text-center text-ui text-fg">
        {waiting} waiting on you · {working} working
      </p>
      <p className="text-center text-ui-sm leading-5 text-fg-muted">This browser can't check who wrote the projects' logs until it holds your org key, so no session is shown.</p>
      <UnlockForm me={me} />
    </div>
  );
}
