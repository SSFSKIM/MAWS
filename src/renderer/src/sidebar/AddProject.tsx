import { Dialog } from 'radix-ui';
import { useMemo, useState } from 'react';
import type { ProjectRecord } from '@shared/ipc/schema';
import { IconButton, PlusIcon } from '../app/IconButton';
import { ipc } from '../ipc/client';
import { useSessions } from '../stores/sessions';
import { projectLabels } from './project-labels';
import { runAddProject, useAddProjectEnabled } from './project-actions';
import { Search } from './Search';

// Discovery supplies choices, never membership. Adding uses the persisted user-origin path, also used by Finder.
export function AddProject() {
  const projects = useSessions((s) => s.projects);
  const candidates = useMemo(() => [...projects.values()].filter((p) => p.hidden || p.discovered).sort((a, b) => a.name.localeCompare(b.name)), [projects]);
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
  const found = candidates.filter((p) => `${p.name} ${p.directory}`.toLowerCase().includes(q));
  return <Dialog.Root open={open} onOpenChange={(next) => { setOpen(next); if (next) { setQuery(''); setError(null); } }}>
    <Dialog.Trigger asChild><IconButton label="Add project" className="size-[22px]"><PlusIcon className="size-[13px]" /></IconButton></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-bg-active" />
      <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[80vh] w-[min(480px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-md border border-border-strong bg-bg-overlay p-4 text-ui text-fg shadow-float">
        <Dialog.Title className="m-0 text-ui font-semibold">Add project</Dialog.Title>
        <Dialog.Description className="m-0 text-ui-sm text-fg-muted">Choose a discovered project or a folder. Only projects you add appear in the sidebar.</Dialog.Description>
        <Search value={query} onChange={setQuery} label="Search discovered projects" onLeave={() => {}} />
        <div className="min-h-0 overflow-y-auto">
          {found.map((p) => <button key={p.id} type="button" disabled={busy} aria-label={`Add ${labels.get(p.id)}`} onClick={() => void choose(p)}
            className="flex w-full flex-col rounded-sm px-2 py-2 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint">
            <span>{labels.get(p.id)}</span><span className="max-w-full truncate text-ui-sm text-fg-muted" title={p.directory}>{p.directory}</span>
          </button>)}
          {found.length === 0 && <p className="m-0 px-2 py-2 text-ui-sm text-fg-muted">{q ? 'No matching projects' : 'No other discovered projects'}</p>}
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
