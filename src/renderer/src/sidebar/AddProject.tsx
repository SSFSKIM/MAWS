import { Dialog } from 'radix-ui';
import { useMemo, useState } from 'react';
import type { ProjectRecord } from '@shared/ipc/schema';
import { IconButton, PlusIcon } from '../app/IconButton';
import { ipc } from '../ipc/client';
import { useSessions } from '../stores/sessions';
import { projectLabels } from './project-labels';
import { isSidebarProject, projectGroups } from './project-groups';
import { runAddProject, useAddProjectEnabled } from './project-actions';
import { Search } from './Search';

// Discovery supplies choices, never membership. Adding uses the persisted user-origin path, also used by Finder.
export function AddProject() {
  const projects = useSessions((s) => s.projects);
  const groups = useMemo(() => projectGroups([...projects.values()]), [projects]);
  const labels = useMemo(() => projectLabels([...projects.values()]), [projects]);
  const canChooseFolder = useAddProjectEnabled();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choose = async (project: ProjectRecord) => {
    setBusy(true);
    setError(null);
    try {
      const result = await ipc.invoke('session.projects.add', { directory: project.directory });
      if (result.ok) setOpen(false);
      else setError(result.error.message);
    } finally { setBusy(false); }
  };
  const q = query.trim().toLowerCase();
  const found = groups.map((group) => ({ ...group, projects: group.projects.filter((p) => `${p.name} ${p.directory}`.toLowerCase().includes(q)) })).filter((group) => group.projects.length > 0);
  return <Dialog.Root open={open} onOpenChange={(next) => { setOpen(next); if (next) { setQuery(''); setError(null); } }}>
    <Dialog.Trigger asChild><IconButton label="Add project" className="size-[22px]"><PlusIcon className="size-[13px]" /></IconButton></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-bg-active" />
      <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[80vh] w-[min(480px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-md border border-border-strong bg-bg-overlay p-4 text-ui text-fg shadow-float">
        <Dialog.Title className="m-0 text-ui font-semibold">Add project</Dialog.Title>
        <Dialog.Description className="m-0 text-ui-sm text-fg-muted">Your sidebar projects come first. Add a hidden or discovered project, or choose a folder.</Dialog.Description>
        <Search value={query} onChange={setQuery} label="Search projects" onLeave={() => {}} />
        <div className="min-h-0 overflow-y-auto">
          {found.map((group) => <div role="group" aria-label={group.label} key={group.label} className="mb-3">
            <h2 className="m-0 px-2 py-1 text-ui-sm font-medium text-fg-muted">{group.label}</h2>
            {group.projects.map((p) => <button key={p.id} type="button" disabled={busy || isSidebarProject(p)} aria-label={isSidebarProject(p) ? `In sidebar: ${labels.get(p.id)}` : `Add ${labels.get(p.id)}`} onClick={() => void choose(p)}
              className="flex w-full flex-col rounded-sm px-2 py-2 text-left outline-accent enabled:hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-muted">
              <span className="flex w-full min-w-0 items-center gap-2"><span className="min-w-0 flex-1 truncate">{labels.get(p.id)}</span>{isSidebarProject(p) && <span className="shrink-0 text-ui-sm text-fg-faint">In sidebar</span>}</span>
              <span className="max-w-full truncate text-ui-sm text-fg-muted" title={p.directory}>{p.directory}</span>
            </button>)}
          </div>)}
          {found.length === 0 && <p className="m-0 px-2 py-2 text-ui-sm text-fg-muted">{q ? 'No matching projects' : 'No projects yet'}</p>}
        </div>
        {error && <p role="alert" className="m-0 text-ui-sm text-danger">{error}</p>}
        <div className="flex justify-between gap-2 border-t border-border pt-3">
          <button type="button" disabled={!canChooseFolder || busy} onClick={() => { setOpen(false); runAddProject(); }}
            className="rounded-sm px-2 py-1 outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint">Choose folder…</button>
          <Dialog.Close className="rounded-sm px-2 py-1 outline-accent hover:bg-bg-hover focus-visible:outline-2">Cancel</Dialog.Close>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
