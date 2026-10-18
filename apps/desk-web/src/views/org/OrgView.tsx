// "All sessions" (smns org directory §8): every live session of every project on one screen, waiting on the owner
// first, then working, then idle; an ended session is not drawn. It is each project's own view lifted over the grid:
// the view holds every project's connection while it is mounted (`useProjectConnection`, shared with any project view
// open in the tab), reads each one's sessions as that project's sidebar does (`useDeskSessions`: its verified log and
// its live state), and merges them (`mergeOrgGroups`). A row names the session (`SessionLabel`: title, else alias, with
// its machine), its project and its in-charge line; a click opens the session's channel in its project. The browser
// draws only what it has verified with the org key, so a locked tab draws the grid's counts — the hub's, which the grid
// shows anyway — and no session, and opens no project. The view says how complete its roster is, as the project view
// does: the projects still being read (backlog or verification), those whose socket dropped (their sessions shown as
// last seen), and those holding events that failed verification (not drawn); "no session is running" is said only when
// every project is connected, caught up and fully checked, with nothing refused. A project whose roster was current
// says nothing of a disruption shorter than the reader's grace (`QUIET_MS`, #61's rule: the composite's "A machine's
// reconnect is invisible to the reader", MAWS #57) — a dropped socket, its backlog read again after the reconnect, a
// live event still being checked — and keeps its rows as they were; past the grace it is said as it is.
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { QUIET_MS } from '../../depth/source/keeper';
import { useStore } from 'zustand';
import type { Me } from '../../hub/me';
import { useKeyHolder } from '../../key/holder';
import { refused } from '../../log/project-log';
import type { SessionGroup } from '../../log/projection';
import { useProjectConnection } from '../../project/registry';
import { orgWaiting } from '../../pwa/badge';
import { useDeskLayout } from '../../shell/layout';
import { feedState, mergeOrgGroups, ORG_GROUPS, type FeedState, type OrgGroup, type OrgSession } from '../../shell/org-sessions';
import { SessionLabel } from '../../shell/SessionLabel';
import { useDeskSessions, type DeskSession } from '../../shell/sessions';
import { useGrid } from '../../state/grid';
import { UnlockForm } from '../key/UnlockForm';

const HEADINGS: Record<OrgGroup, string> = { waiting: 'Waiting on you', working: 'Working', idle: 'Idle' };

/** What one project's feed reports: its sessions grouped, how far they can be taken as current, and its refusals. */
type Fed = { groups: Record<SessionGroup, DeskSession[]>; state: FeedState; refused: number };

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
  const state = (id: string): FeedState => fed[id]?.state ?? 'reading';
  const reading = projects.filter((p) => state(p.id) === 'reading');
  const stale = projects.filter((p) => state(p.id) === 'stale');
  const refusing = projects.filter((p) => (fed[p.id]?.refused ?? 0) > 0);
  const staleIds = new Set(stale.map((p) => p.id));
  const complete = reading.length === 0 && stale.length === 0 && refusing.length === 0;
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
            {loaded && reading.length > 0 && (
              <p className="m-0 mb-3 text-ui-sm text-fg-muted" role="status" data-testid="org-reading">
                Reading {names(reading)}: {reading.length === 1 ? 'its sessions appear' : 'their sessions appear'} once {reading.length === 1 ? 'its log has' : 'their logs have'} arrived and been checked.
              </p>
            )}
            {stale.length > 0 && (
              <p className="m-0 mb-3 text-ui-sm text-warning" role="status" data-testid="org-stale">
                Reconnecting to {names(stale)}: {stale.length === 1 ? 'its' : 'their'} sessions are shown as last seen, and may have changed since.
              </p>
            )}
            {refusing.length > 0 && (
              <p className="m-0 mb-3 text-ui-sm text-danger" role="alert" data-testid="org-refused">
                {refusing.map((p) => `${p.name}: ${fed[p.id].refused === 1 ? 'One event' : `${fed[p.id].refused} events`} failed verification and ${fed[p.id].refused === 1 ? 'is' : 'are'} not shown`).join('; ')}; the project's own view names each.
              </p>
            )}
            {loaded && complete && shown.length === 0 && (
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
                      <Row session={session} group={group} stale={staleIds.has(session.project)} />
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
  const connected = useStore(connection.live, (s) => s.connected);
  const pending = useStore(connection.log.store, (s) => s.entries.filter((e) => e.verdict === 'pending').length);
  const refusedCount = useStore(connection.log.store, (s) => refused(s).length);
  const state = useGraced(feedState({ connected, caughtUp, pending, refused: refusedCount }));
  useEffect(() => report(project, { groups, state, refused: refusedCount }), [project, groups, state, refusedCount, report]);
  useEffect(() => () => report(project, null), [project, report]);
  return null;
});

/**
 * A feed's state as the reader is told it: once the feed has been current, a disruption — any state but current — reads
 * as current until it has lasted `QUIET_MS`, and as itself from then until the feed is current again. A feed never
 * current is told as it is.
 */
function useGraced(raw: FeedState): FeedState {
  const [wasCurrent, setWasCurrent] = useState(raw === 'current');
  const [lapsed, setLapsed] = useState(false);
  if (raw === 'current' && wasCurrent === false) setWasCurrent(true);
  if (raw === 'current' && lapsed) setLapsed(false);
  const disrupted = wasCurrent && raw !== 'current';
  useEffect(() => {
    if (!disrupted) return;
    const timer = setTimeout(() => setLapsed(true), QUIET_MS);
    return () => clearTimeout(timer);
  }, [disrupted]);
  return disrupted && !lapsed ? 'current' : raw;
}

/** "MAWS", "MAWS and mini", "MAWS, mini and arkho". */
function names(projects: ReadonlyArray<{ name: string }>): string {
  const all = projects.map((p) => p.name);
  return all.length <= 1 ? (all[0] ?? '') : `${all.slice(0, -1).join(', ')} and ${all.at(-1)}`;
}

/** `stale`: its project's socket dropped, so the row is as last seen. */
function Row({ session, group, stale }: { session: OrgSession; group: OrgGroup; stale: boolean }) {
  const navigate = useDeskLayout((s) => s.navigate);
  const offline = session.machineOnline === false || stale;
  return (
    <button
      type="button"
      onClick={() => navigate({ view: 'project', project: session.project, channel: { kind: 'session', session: session.session } })}
      data-testid="org-session"
      data-session={session.session}
      data-project={session.project}
      data-group={group}
      data-stale={stale || undefined}
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
