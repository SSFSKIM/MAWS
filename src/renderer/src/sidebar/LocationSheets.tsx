// A registry location's sheets (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §J.3 and §G; design §10):
// Locate… points a missing location at its folder's new path (`session.projects.relocate`, Touch ID for another machine's,
// main's step-up), and Rename… names the project at one location's machine (`session.projects.update`; §J.3: this Mac's
// when it has one, else the first in order that is up), where a `.smns` does not name it.
import { useState } from 'react';
import type { ProjectId } from '@shared/graph/ids';
import { machineOf } from '@shared/machine/address';
import { ipc } from '../ipc/client';
import { closeDialog } from '../sessions/dialogs';
import { Sheet, SheetForm } from '../sessions/Sheet';
import { FIELD, PRIMARY } from '../sessions/ui';
import { useMachines } from '../stores/machines';
import { machineName } from '../stores/org-projects';
import { FolderField } from './FolderField';
import { relocateLocation, renameAt } from './registry-acts';
import { REGISTRY } from './registry-copy';

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

export function LocateSheet({ address, path }: { address: ProjectId; path: string }) {
  const machine = machineOf(address);
  const local = machine === ipc.localMachine;
  const name = useMachines((s) => machineName(s.machines, machine, ipc.localMachine));
  const [directory, setDirectory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = directory.trim();
  const submit = async () => {
    setBusy(true);
    setError(null);
    const answer = await relocateLocation(address, chosen, name);
    setBusy(false);
    if (answer.ok) closeDialog();
    else setError(answer.words);
  };
  return (
    <Sheet title={REGISTRY.locateTitle(basename(path), name)} width="w-[min(520px,92vw)]" data-locate={address}>
      <SheetForm canSubmit={chosen.startsWith('/') && !busy} onSubmit={() => void submit()} submitLabel={REGISTRY.useThisFolder} submitClass={PRIMARY}>
        <p className="m-0 text-ui-sm text-fg-muted">{REGISTRY.locateHint(path)}</p>
        <FolderField machine={machine} name={name} local={local} value={directory} onChange={setDirectory} disabled={busy} />
        {busy && (
          <p role="status" className="m-0 text-ui-sm text-fg-muted">
            {REGISTRY.locating(name)}
          </p>
        )}
        {error !== null && (
          <p role="alert" className="m-0 text-ui-sm text-danger">
            {error}
          </p>
        )}
      </SheetForm>
    </Sheet>
  );
}

export function RenameProjectSheet({ address, name: current }: { address: ProjectId; name: string }) {
  const machine = useMachines((s) => machineName(s.machines, machineOf(address), ipc.localMachine));
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const submit = async () => {
    setBusy(true);
    setError(null);
    const answer = await renameAt(address, trimmed, machine);
    setBusy(false);
    if (answer.ok) closeDialog();
    else setError(answer.words);
  };
  return (
    <Sheet title={REGISTRY.renameTitle}>
      <SheetForm canSubmit={trimmed !== '' && trimmed !== current && !busy} onSubmit={() => void submit()} submitLabel={REGISTRY.save} submitClass={PRIMARY}>
        <label className="flex flex-col gap-1">
          <span className="text-ui-sm text-fg-muted">{REGISTRY.renameLabel}</span>
          <input type="text" autoFocus className={FIELD} value={name} maxLength={128} disabled={busy} onChange={(event) => setName(event.target.value)} />
        </label>
        {error !== null && (
          <p role="alert" className="m-0 text-ui-sm text-danger">
            {error}
          </p>
        )}
      </SheetForm>
    </Sheet>
  );
}
