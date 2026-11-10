// A registry project's locations in its row's hover card (docs/doperpowers/plans/2026-11-10-project-registry.md,
// Interfaces §J.3; design §6: "The hover card lists the locations: machine, path, state, and Remove and Locate… for a
// missing one"): each location's machine and path, its state in words (`locations.ts`), and on a machine you own its
// actions: Locate… and Remove for a missing folder, Use this folder and Remove for a replaced one, a suggestion's one
// button; then the project's removals held for a machine that is off, each with Cancel.
import { useState } from 'react';
import { formatCwd } from '../composer/frame/LocationChip';
import { openDialog } from '../sessions/dialogs';
import { QUIET } from '../sessions/ui';
import { toast } from '../stores/notices';
import type { HeldRemoval, OrgProjects, RegistryProject } from '../stores/registry';
import { useSessions } from '../stores/sessions';
import { locationLines, pendingWords, type LocationLine, type LocationView } from './locations';
import { cancelRemoval, linkLocation, relocateLocation, removeLocation, type ActAnswer } from './registry-acts';
import { REGISTRY } from './registry-copy';

const said = (answer: ActAnswer) => {
  if (!answer.ok) toast({ level: 'danger', text: answer.words, actions: [], dismissible: true });
};

export function ProjectLocations({ project, view }: { project: RegistryProject; view: LocationView }) {
  const registry = useSessions((s) => s.registry);
  const held = registry.removals.filter((r) => r.project === project.id);
  const lines = locationLines(project, registry, view);
  return (
    <div className="mt-1 border-t border-border pt-2">
      <h4 className="m-0 mb-1 text-ui-sm font-medium text-fg-muted">{REGISTRY.locations}</h4>
      <ul aria-label={REGISTRY.locations} className="m-0 flex max-h-56 list-none flex-col gap-1.5 overflow-y-auto p-0 [scrollbar-width:thin]">
        {lines.map((line) => (
          <Location key={line.address} line={line} />
        ))}
        {held.map((removal) => (
          <Pending key={removal.id} removal={removal} view={view} />
        ))}
      </ul>
    </div>
  );
}

function Location({ line }: { line: LocationLine }) {
  const [busy, setBusy] = useState(false);
  const { location, address, machine, state, suggestion } = line;
  const run = (act: () => Promise<ActAnswer>) => async () => {
    setBusy(true);
    said(await act());
    setBusy(false);
  };
  const remove = run(() => removeLocation({ address, machine: location.machine, pid: location.pid, up: line.up }, machine));
  const acts = location.acts && line.up;
  return (
    <li data-location={address} data-location-state={state?.kind} className="flex min-w-0 flex-col gap-0.5">
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 text-fg">{machine}</span>
        <span title={location.path} className="min-w-0 truncate font-mono text-fg-muted">
          {formatCwd(location.path)}
        </span>
      </span>
      {state !== null && (
        <span data-location-words className={state.kind === 'offline' ? 'text-fg-muted' : 'text-warning'}>
          {state.kind === 'offline' ? state.card : state.words}
        </span>
      )}
      {acts && state?.kind === 'missing' && (
        <span className="flex gap-1">
          <button type="button" className={QUIET} disabled={busy} onClick={() => openDialog({ kind: 'locateProject', address, path: location.path })}>
            {REGISTRY.locate}
          </button>
          <button type="button" className={QUIET} disabled={busy} onClick={() => void remove()}>
            {REGISTRY.remove}
          </button>
        </span>
      )}
      {acts && state?.kind === 'replaced' && (
        <span className="flex gap-1">
          <button type="button" className={QUIET} disabled={busy} onClick={() => void run(() => relocateLocation(address, location.path, machine))()}>
            {REGISTRY.useThisFolder}
          </button>
          <button type="button" className={QUIET} disabled={busy} onClick={() => void remove()}>
            {REGISTRY.remove}
          </button>
        </span>
      )}
      {suggestion !== null && (
        <span data-location-suggestion className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="min-w-0 text-fg-muted">{suggestion.words}</span>
          <button type="button" className={QUIET} disabled={busy} onClick={() => void run(() => linkLocation(address, suggestion.into, machine))()}>
            {suggestion.button}
          </button>
        </span>
      )}
    </li>
  );
}

function Pending({ removal, view }: { removal: HeldRemoval; view: LocationView }) {
  const [busy, setBusy] = useState(false);
  return (
    <li data-held-removal={removal.id} className="flex min-w-0 flex-col gap-0.5">
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 text-fg">{view.machine(removal.machine).name}</span>
        <span title={removal.path} className="min-w-0 truncate font-mono text-fg-muted">
          {formatCwd(removal.path)}
        </span>
      </span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="text-fg-muted">{pendingWords(removal, view)}</span>
        <button
          type="button"
          className={QUIET}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void cancelRemoval(removal.id).then((answer) => {
              said(answer);
              setBusy(false);
            });
          }}
        >
          {REGISTRY.cancel}
        </button>
      </span>
    </li>
  );
}

/** The removals held for machines that are off, every project's (the Hidden projects sheet's), each with Cancel. */
export function PendingRemovals({ removals, view }: { removals: OrgProjects['removals']; view: LocationView }) {
  if (removals.length === 0) return null;
  return (
    <section aria-label={REGISTRY.pendingTitle} className="mt-3 flex flex-col gap-1.5">
      <h3 className="m-0 text-ui-sm font-medium text-fg-muted">{REGISTRY.pendingTitle}</h3>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {removals.map((removal) => (
          <Pending key={removal.id} removal={removal} view={view} />
        ))}
      </ul>
    </section>
  );
}
