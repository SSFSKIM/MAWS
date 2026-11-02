import { useState, type ReactNode } from 'react';
import type { ProjectId } from '@shared/graph/ids';
import { openArtifactTab } from '../../library/actions';
import { KindIcon } from '../../library/icons';
import { refreshLibrary, useLibraryList } from '../../library/store';
import { setLibraryView } from '../../library/view';
import { openArtifacts } from '../../main/artifacts';
import { useSessions } from '../../stores/sessions';
import { FloatingCard } from './FloatingCard';
import { actionClass } from './Section';
import { machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../../ipc/client';

// P5 O7 M5a (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5): the card is its session's machine's, as the
// Artifacts tool's list is: it offers that machine's projects, reads a project's artifacts there (the library store reads
// a project's list on the machine its address names), and opens its rows and the Library there.
export function Artifacts({ projectId, machine }: { projectId: ProjectId | null; machine: MachineRef }) {
  const [selected, setSelected] = useState(projectId);
  const projects = useSessions((s) => s.projects);
  const picker = (
    <label className="flex min-w-0 items-center gap-2 text-ui-sm text-fg-muted">
      <span className="shrink-0">Project</span>
      <select aria-label="Artifacts project" value={selected ?? ''} onChange={(event) => setSelected(event.target.value as ProjectId || null)} className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-bg-raised px-1 text-ui-sm text-fg outline-accent focus-visible:outline-2">
        <option value="" disabled>Choose a project</option>
        {selected && !projects.has(selected) && <option value={selected}>Current project</option>}
        {[...projects.values()].filter((project) => machineOf(project.id) === machine).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
    </label>
  );
  // No project is not an unfiltered Library query: it would leak every project's rows into this card.
  return selected === null ? (
    <FloatingCard title="Artifacts" summary="Choose project">
      {picker}
      <p className="text-ui-sm text-fg-muted">Choose a project to see its artifacts</p>
      <LibraryLink machine={machine} />
    </FloatingCard>
  ) : <ProjectArtifacts projectId={selected} machine={machine} picker={picker} />;
}

function ProjectArtifacts({ projectId, machine, picker }: { projectId: ProjectId; machine: MachineRef; picker: ReactNode }) {
  const read = useLibraryList({ projectId });
  const rows = read.value?.rows;
  const summary = rows ? `${rows.length} in this project` : read.error ? 'Unavailable' : 'Loading…';
  return (
    <FloatingCard title="Artifacts" summary={summary}>
      {picker}
      {read.error && <div role="status" className="text-ui-sm text-fg-muted"><p>{read.error}</p><button type="button" className={actionClass} onClick={() => refreshLibrary(ipc, machine)}>Retry</button></div>}
      {!rows && !read.error && <p className="text-ui-sm text-fg-muted">Loading artifacts…</p>}
      {rows?.length === 0 && <p className="text-ui-sm text-fg-muted">No artifacts in this project yet</p>}
      {rows && rows.length > 0 && <ul className="flex flex-col">
        {rows.slice(0, 4).map((row) => <li key={row.id} className="min-w-0">
          <button type="button" aria-label={row.title} title={row.title} onClick={() => openArtifactTab(row.id, undefined, machine)} className="flex h-8 w-full min-w-0 items-center gap-2 rounded-sm px-1 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2">
            <KindIcon kind={row.kind} className="size-3.5 shrink-0 text-fg-muted" />
            <span className="min-w-0 truncate">{row.title}</span>
          </button>
        </li>)}
      </ul>}
      {rows && rows.length > 4 && <p className="text-ui-sm text-fg-muted">{rows.length - 4} more in Library</p>}
      <LibraryLink machine={machine} />
    </FloatingCard>
  );
}

function LibraryLink({ machine }: { machine: MachineRef }) {
  return <button type="button" className="self-end rounded-sm px-1 py-0.5 text-ui-sm text-fg-muted outline-accent hover:text-fg focus-visible:outline-2" onClick={() => {
    setLibraryView({ view: 'all', query: '', kind: null, spaceId: null, machine: machine === ipc.localMachine ? null : machine });
    openArtifacts();
  }}>All in Library</button>;
}
