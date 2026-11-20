// D6 / UX2-K: one app destination, with disk configuration independent of session lifetime.
// UX wave U11c (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §D; the child's O-14): My items | Discover
// outside and the kind as a filter inside, "Show: All · Plugins · Skills · Connectors". Where the page is, its view and
// its Show value, is U7b's `destination`, which `DestinationPage` passes here and which every press writes through
// `openDestination`: a change of view keeps Show, a change of Show keeps the view. Under the head (./CustomizeHead.tsx)
// each kind's body is drawn as its section drew it (./bodies.tsx), and what a person started is held by the page's one
// place (./place.tsx) for the place the page is about.
import { useEffect, useMemo, useState } from 'react';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { ipc } from '../ipc/client';
import { useCurrentRow } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { projectLabels } from '../sidebar/project-labels';
import { displayTitle } from '../sessions/title';
import { homeAbbreviated } from '../tools/session-info/model';
import { focusSearch } from '../widgets/WidgetFrame';
import { useCustomizeProject } from './open';
import { machineOf } from '@shared/machine/address';
import { customizePlace } from '../destination/discover'; // UX wave U7b
import { CustomizeBody } from './bodies';
import { CustomizeHead, type PageView } from './CustomizeHead';
import { dropOpenRequest, useOpenRequest, type CustomizeShow } from './page';
import { CustomizePlace } from './place';

const DIRECTORY_PAGE = '\0directory'; // the selector's value for a directory page: no project id or '' can equal it

export function CustomizeView({ view, show }: { view: PageView; show: CustomizeShow }) {
  // P5 O6 M4: Customize reads and changes this machine's configuration until O4 spans machines, so its pages are this
  // machine's projects, directories and live sessions only: another machine's project at the same path is never read or
  // changed here as if it were this one's. (`useCustomizeProject.directory` comes from `openDiscover`, which takes only
  // this machine's directories.)
  const allProjects = useSessions((s) => s.projects);
  const projects = useMemo(() => new Map([...allProjects].filter(([id]) => machineOf(id) === ipc.localMachine)), [allProjects]);
  const records = useSessions((s) => s.records);
  const engine = useSessions((s) => s.engine);
  const current = useCurrentRow(); // U13a: the current project
  const chosen = useCustomizeProject((s) => s.projectId);
  // a directory no project has as its own (Open Discover from a session there, Decision Log 10): the page is that directory
  const directory = useCustomizeProject((s) => s.directory);
  // UX wave U7b: the one rule of Customize's place
  const { project, cwd } = customizePlace({ projectId: chosen, directory }, current, allProjects);
  const labels = useMemo(() => projectLabels([...projects.values()]), [projects]);
  // Attach only a ready process in exactly the chosen directory. Project membership alone would also match a worktree
  // with different local configuration. A page never acquires a session, including after an attached process exits.
  const live = [...engine.values()].filter((status) => status.process === 'ready' && cwd !== null && status.cwd === cwd && machineOf(status.appSessionId) === ipc.localMachine)
    .sort((a, b) => a.appSessionId.localeCompare(b.appSessionId));
  const [pickedSession, setPickedSession] = useState<AppSessionId | null>(null);
  const attached = live.find((status) => status.appSessionId === pickedSession) ?? live[0] ?? null;
  const setProject = (value: string) => {
    if (value === DIRECTORY_PAGE) return;
    useCustomizeProject.setState({ projectId: value === '' ? null : value as ProjectId }, true);
    setPickedSession(null);
  };

  // A plugin's or a skill's detail is open (no tools); pressing the view shown or a Show value returns it to its list.
  const [inDetail, setInDetail] = useState(false);
  const [toList, setToList] = useState(0);
  const go = (next: { view?: PageView; show?: CustomizeShow }) => useLayout.getState().openDestination({ kind: 'customize', view: next.view ?? view, show: next.show ?? show });
  const onView = (next: PageView) => {
    if (next === view) setToList((n) => n + 1);
    else go({ view: next });
  };
  const onShow = (next: CustomizeShow) => {
    setToList((n) => n + 1);
    go({ show: next });
  };
  // `openMine`'s request for a plugin's detail ends when the page is elsewhere: another view, Show value or place
  useEffect(() => {
    const request = useOpenRequest.getState().request;
    if (request !== null && (view !== 'mine' || request.show !== show || request.place !== cwd)) dropOpenRequest();
  }, [view, show, cwd]);
  // and with the page: a request left when Customize closes is not opened by a later way in (the branch panel's finding)
  useEffect(() => dropOpenRequest, []);

  const projectSelect = (
    <label className="flex min-w-0 max-w-full items-center gap-2 text-ui-sm text-fg-muted @max-sm/customize:w-full">
      <span className="shrink-0">Showing</span>
      <select aria-label="Project" value={directory !== undefined ? DIRECTORY_PAGE : (project?.id ?? '')} onChange={(event) => setProject(event.target.value)} className="max-w-64 min-w-0 rounded-sm border border-border bg-bg-raised px-2 py-1 text-ui text-fg outline-accent focus-visible:outline-2 @max-sm/customize:max-w-full @max-sm/customize:flex-1">
        <option value="">User configuration</option>
        {directory !== undefined && <option value={DIRECTORY_PAGE}>{homeAbbreviated(directory)}</option>}
        {[...projects.values()].sort((a, b) => a.name.localeCompare(b.name)).map((item) => <option key={item.id} value={item.id}>{labels.get(item.id)}</option>)}
      </select>
    </label>
  );
  const liveScope = attached && <label className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-ui-sm text-fg-muted @max-sm/customize:w-full">
    <span className="shrink-0">Live session</span>
    <select aria-label="Live session" value={attached.appSessionId} onChange={(event) => setPickedSession(event.target.value as AppSessionId)} className="max-w-64 min-w-0 rounded-sm border border-border bg-bg-raised px-2 py-1 text-fg outline-accent focus-visible:outline-2 @max-sm/customize:max-w-full @max-sm/customize:flex-1">
      {live.map((status) => <option key={status.appSessionId} value={status.appSessionId}>{records.has(status.appSessionId) ? displayTitle(records.get(status.appSessionId)!) : status.appSessionId}</option>)}
    </select>
  </label>;
  return (
    <div
      data-customize-page
      data-customize-view={view}
      data-customize-show={show}
      // the keyboard's place when what held it leaves (a detailed plugin gone from the list), inside the `/` below
      tabIndex={-1}
      // `/` focuses the head's search field, as the libraries' frame did; not from a sheet drawn over the page
      onKeyDown={(event) => {
        if (event.currentTarget.contains(event.target as Node)) focusSearch(event);
      }}
      className="@container/customize flex h-full min-h-0 flex-col bg-bg text-ui text-fg outline-none"
    >
      <CustomizePlace cwd={cwd} projectId={project?.id ?? null} name={project?.name ?? (cwd === null ? null : homeAbbreviated(cwd))} attached={attached?.appSessionId ?? null}>
        <CustomizeHead view={view} show={show} inDetail={inDetail} onView={onView} onShow={onShow} project={projectSelect} live={liveScope} />
        <CustomizeBody view={view} show={show} onDetail={setInDetail} toList={toList} />
      </CustomizePlace>
    </div>
  );
}
